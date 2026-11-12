const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const cors = require('cors');

const { createTestServer, VALID_PNG_BUFFER } = require('./helpers/testServer');
const { initializeDatabase, setDatabaseInstance } = require('../src/db/database');
const config = require('../config');
const ticketsRouter = require('../src/routes/tickets');
const dashboardRouter = require('../src/routes/dashboard');
const attachmentsRouter = require('../src/routes/attachments');
const errorHandler = require('../src/middleware/errorHandler');

test('Tier 6: Serverless Entrypoint & Persistent Storage Tests', async (t) => {
  const env = await createTestServer();
  const { baseUrl, db, uploadsDir, tempDir, cleanup } = env;

  t.after(async () => {
    await cleanup();
  });

  await t.test('T6.1: Serverless entrypoint (api/index.js) exports valid Express application', async () => {
    const app = require('../api/index');
    assert.ok(app, 'api/index.js must export an application');
    assert.equal(typeof app, 'function', 'api/index export must be callable');
    assert.equal(typeof app.handle, 'function', 'api/index export must be an Express application');
  });

  await t.test('T6.2: Image persistence across simulated container recycle (disk-independent retrieval)', async () => {
    // 1. Upload ticket with image attachment via HTTP multipart
    const boundary = '----WebKitFormBoundaryContainerTest' + crypto.randomUUID().replace(/-/g, '');
    const originalHash = crypto.createHash('sha256').update(VALID_PNG_BUFFER).digest('hex');

    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nPersistence Test Ticket\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nVerifying serverless image persistence\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nSoftware\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="priority"\r\n\r\nHigh\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="screenshot.png"\r\nContent-Type: image/png\r\n\r\n`),
      VALID_PNG_BUFFER,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const createRes = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });

    assert.equal(createRes.status, 201);
    const createdTicket = await createRes.json();
    assert.ok(createdTicket.id);
    assert.equal(createdTicket.attachments.length, 1);
    const attachmentId = createdTicket.attachments[0].id;

    // 2. Simulate container recycle / ephemeral disk purge:
    // Delete any files inside the uploads directory completely
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(uploadsDir, file));
        } catch (e) {}
      }
    }

    // Verify uploads dir has 0 files (no local disk files exist)
    const diskFiles = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
    assert.equal(diskFiles.length, 0, 'Local disk storage must be completely empty');

    // 3. Fetch attachment via /view endpoint
    const viewRes = await fetch(`${baseUrl}/api/tickets/${createdTicket.id}/attachments/${attachmentId}/view`);
    assert.equal(viewRes.status, 200, 'View endpoint must return 200 without local disk files');
    assert.equal(viewRes.headers.get('content-type'), 'image/png');
    const viewBuffer = Buffer.from(await viewRes.arrayBuffer());
    const retrievedHash = crypto.createHash('sha256').update(viewBuffer).digest('hex');
    assert.equal(retrievedHash, originalHash, 'Retrieved image must match original with 100% SHA-256 byte parity');

    // 4. Fetch attachment via /download endpoint
    const dlRes = await fetch(`${baseUrl}/api/tickets/${createdTicket.id}/attachments/${attachmentId}/download`);
    assert.equal(dlRes.status, 200, 'Download endpoint must return 200 without local disk files');
    assert.match(dlRes.headers.get('content-disposition'), /attachment; filename="screenshot.png"/);
    const dlBuffer = Buffer.from(await dlRes.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(dlBuffer).digest('hex'), originalHash);
  });

  await t.test('T6.3: Independent secondary serverless instance retrieval (multi-invocation simulation)', async () => {
    // Spin up an entirely separate HTTP instance pointing to the same DB but with NO uploads directory
    const secondApp = express();
    secondApp.use(cors());
    secondApp.use(express.json());
    secondApp.use('/api/tickets', ticketsRouter);
    secondApp.use('/api/dashboard', dashboardRouter);
    secondApp.use('/api', attachmentsRouter);
    secondApp.use(errorHandler);

    const secondServer = http.createServer(secondApp);
    await new Promise((resolve) => secondServer.listen(0, '127.0.0.1', resolve));
    const secondBaseUrl = `http://127.0.0.1:${secondServer.address().port}`;

    try {
      // Query ticket list from second serverless instance
      const listRes = await fetch(`${secondBaseUrl}/api/tickets`);
      assert.equal(listRes.status, 200);
      const listData = await listRes.json();
      assert.ok(listData.total >= 1, 'Second instance must access shared database state');

      const targetTicket = listData.tickets.find((t) => t.title === 'Persistence Test Ticket');
      assert.ok(targetTicket, 'Target ticket must be retrievable on second instance');

      // Update status on second instance: Open -> In Progress
      const updateRes = await fetch(`${secondBaseUrl}/api/tickets/${targetTicket.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'In Progress' })
      });
      assert.equal(updateRes.status, 200);
      const updated = await updateRes.json();
      assert.equal(updated.status, 'In Progress');

      // Fetch image from second instance
      const viewRes = await fetch(`${secondBaseUrl}/api/tickets/${targetTicket.id}/attachments/${targetTicket.attachments[0].id}/view`);
      assert.equal(viewRes.status, 200);
      const viewBuf = Buffer.from(await viewRes.arrayBuffer());
      const originalHash = crypto.createHash('sha256').update(VALID_PNG_BUFFER).digest('hex');
      assert.equal(crypto.createHash('sha256').update(viewBuf).digest('hex'), originalHash);
    } finally {
      await new Promise((resolve) => secondServer.close(resolve));
    }
  });

  await t.test('T6.4: Payload limit boundary enforcement (rejection of >4MB attachments)', async () => {
    // Generate an oversized dummy buffer (> 4MB, e.g. 4.2MB) with PNG magic bytes
    const oversizedSize = 4.2 * 1024 * 1024;
    const oversizedBuffer = Buffer.alloc(oversizedSize, 0x00);
    // Write valid PNG header
    Buffer.from('89504e470d0a1a0a', 'hex').copy(oversizedBuffer, 0);

    const boundary = '----WebKitFormBoundaryOversized' + crypto.randomUUID().replace(/-/g, '');
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nOversized Payload Ticket\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nTesting 4MB payload limit\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="large.png"\r\nContent-Type: image/png\r\n\r\n`),
      oversizedBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const res = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });

    assert.equal(res.status, 400, 'Payload exceeding 4MB must be rejected with 400 Bad Request');
    const err = await res.json();
    assert.match(err.error, /File size limit exceeded/i);
  });
});
