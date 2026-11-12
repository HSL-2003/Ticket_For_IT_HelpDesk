const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');

const config = require('../../config');
const { initializeDatabase, setDatabaseInstance } = require('../../src/db/database');
const ticketsRouter = require('../../src/routes/tickets');
const dashboardRouter = require('../../src/routes/dashboard');
const attachmentsRouter = require('../../src/routes/attachments');
const errorHandler = require('../../src/middleware/errorHandler');

// Minimal valid 67-byte PNG buffer
const VALID_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

// Minimal valid JPEG header buffer
const VALID_JPEG_BUFFER = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48]),
  Buffer.alloc(64, 0xaa),
  Buffer.from([0xff, 0xd9])
]);

// Minimal valid GIF header buffer
const VALID_GIF_BUFFER = Buffer.from('47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b', 'hex');

/**
 * Creates and starts an isolated test server instance
 */
async function createTestServer() {
  const tempDir = path.join(os.tmpdir(), `helpdesk-test-${crypto.randomUUID()}`);
  const testDbDir = path.join(tempDir, 'data');
  const testUploadsDir = path.join(tempDir, 'uploads', 'tickets');

  fs.mkdirSync(testDbDir, { recursive: true });
  fs.mkdirSync(testUploadsDir, { recursive: true });

  const testDbPath = path.join(testDbDir, 'test.db');

  // Override config paths for this test run
  config.UPLOADS_DIR = testUploadsDir;
  config.DB_PATH = testDbPath;

  const db = initializeDatabase(testDbPath);
  await db.initSchema();
  setDatabaseInstance(db);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  app.use('/api/tickets', ticketsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api', attachmentsRouter);

  app.use(errorHandler);

  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function cleanup() {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    await db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup error on Windows file locks
    }
  }

  return {
    server,
    baseUrl,
    db,
    tempDir,
    uploadsDir: testUploadsDir,
    cleanup
  };
}

module.exports = {
  createTestServer,
  VALID_PNG_BUFFER,
  VALID_JPEG_BUFFER,
  VALID_GIF_BUFFER
};
