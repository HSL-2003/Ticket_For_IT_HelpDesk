const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer, VALID_PNG_BUFFER } = require('./helpers/testServer');
const ticketService = require('../src/services/ticketService');

test('Tier 2: Boundary & Corner Cases Tests', async (t) => {
  const env = await createTestServer();
  const { baseUrl, db, cleanup } = env;

  t.after(async () => {
    await cleanup();
  });

  await t.test('T2.1: Mandatory field validation boundaries (missing / too short / invalid enum)', async () => {
    // 1. Missing title
    const resNoTitle = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Valid description with sufficient length' })
    });
    assert.equal(resNoTitle.status, 400);
    const errNoTitle = await resNoTitle.json();
    assert.match(errNoTitle.error, /Ticket title is required/i);

    // 2. Title too short (< 3 chars)
    const resShortTitle = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'AB', description: 'Valid description with sufficient length' })
    });
    assert.equal(resShortTitle.status, 400);

    // 3. Missing description
    const resNoDesc = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Valid Title Here' })
    });
    assert.equal(resNoDesc.status, 400);

    // 4. Description too short (< 5 chars)
    const resShortDesc = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Valid Title Here', description: 'Bad' })
    });
    assert.equal(resShortDesc.status, 400);

    // 5. Invalid category
    const resBadCat = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Valid Title Here',
        description: 'Valid description with sufficient length',
        category: 'NonExistentCategory'
      })
    });
    assert.equal(resBadCat.status, 400);
    const errBadCat = await resBadCat.json();
    assert.match(errBadCat.error, /Invalid category/i);

    // 6. Invalid priority
    const resBadPri = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Valid Title Here',
        description: 'Valid description with sufficient length',
        priority: 'ExtremeUrgent'
      })
    });
    assert.equal(resBadPri.status, 400);
  });

  await t.test('T2.2: Image upload boundary checks (disallowed extension, zero-byte file, fake header)', async () => {
    // 1. Disallowed file extension (.exe)
    const formExe = new FormData();
    formExe.append('title', 'Testing executable block');
    formExe.append('description', 'Attempting to attach a script');
    formExe.append('attachments', new Blob(['fake binary content'], { type: 'application/octet-stream' }), 'malware.exe');

    const resExe = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      body: formExe
    });
    assert.equal(resExe.status, 400);
    const errExe = await resExe.json();
    assert.match(errExe.error, /Unsupported file type/i);

    // 2. Zero-byte file
    const formZero = new FormData();
    formZero.append('title', 'Testing empty file block');
    formZero.append('description', 'Attempting to attach an empty file');
    formZero.append('attachments', new Blob([], { type: 'image/png' }), 'empty.png');

    const resZero = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      body: formZero
    });
    assert.equal(resZero.status, 400);
    const errZero = await resZero.json();
    assert.match(errZero.error, /empty \(0 bytes\)/i);

    // 3. Fake magic byte: text content named .png
    const formFake = new FormData();
    formFake.append('title', 'Testing disguised text file');
    formFake.append('description', 'Attempting to spoof MIME type with text');
    formFake.append('attachments', new Blob(['THIS IS PLAIN TEXT NOT A PNG IMAGE'], { type: 'image/png' }), 'spoofed.png');

    const resFake = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      body: formFake
    });
    assert.equal(resFake.status, 400);
    const errFake = await resFake.json();
    assert.match(errFake.error, /does not match allowed image formats/i);
  });

  await t.test('T2.3: Invalid lifecycle status transitions & missing resolution notes', async () => {
    // Create an initial open ticket
    const ticket = await ticketService.createTicket({
      title: 'Lifecycle Boundary Ticket',
      description: 'Testing illegal status transitions',
      category: 'Software',
      priority: 'Low'
    }, [], db);

    // 1. Illegal jump: Open -> Resolved directly without In Progress
    const resJump = await fetch(`${baseUrl}/api/tickets/${ticket.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Resolved', notes: 'Trying to skip in progress' })
    });
    assert.equal(resJump.status, 400);
    const errJump = await resJump.json();
    assert.match(errJump.error, /Invalid status transition/i);

    // 2. Move to In Progress
    const resProg = await fetch(`${baseUrl}/api/tickets/${ticket.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'In Progress' })
    });
    assert.equal(resProg.status, 200);

    // 3. In Progress -> Resolved WITHOUT notes
    const resNoNotes = await fetch(`${baseUrl}/api/tickets/${ticket.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Resolved', notes: '   ' })
    });
    assert.equal(resNoNotes.status, 400);
    const errNoNotes = await resNoNotes.json();
    assert.match(errNoNotes.error, /Resolution notes are required/i);

    // 4. Invalid status string
    const resInvalidStatus = await fetch(`${baseUrl}/api/tickets/${ticket.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SuperResolved' })
    });
    assert.equal(resInvalidStatus.status, 400);
  });

  await t.test('T2.4: Temporal boundary tests (Leap day Feb 29, month boundaries, year boundaries)', async () => {
    // Insert tickets on exact edge boundaries
    // 1. Leap day: 2024-02-29T23:59:59.000Z
    await ticketService.createTicket({
      title: 'Leap Year Ticket',
      description: 'Submitted on Feb 29 2024 leap day',
      created_at: '2024-02-29T23:59:59.000Z'
    }, [], db);

    // 2. Month boundary: April 30 2026 vs May 1 2026
    await ticketService.createTicket({
      title: 'End of April Ticket',
      description: 'Submitted on 2026-04-30T23:59:59.000Z',
      created_at: '2026-04-30T23:59:59.000Z'
    }, [], db);

    await ticketService.createTicket({
      title: 'Start of May Ticket',
      description: 'Submitted on 2026-05-01T00:00:00.000Z',
      created_at: '2026-05-01T00:00:00.000Z'
    }, [], db);

    // 3. Year boundary: Dec 31 2026 vs Jan 1 2027
    await ticketService.createTicket({
      title: 'End of Year Ticket',
      description: 'Submitted on 2026-12-31T23:59:59.000Z',
      created_at: '2026-12-31T23:59:59.000Z'
    }, [], db);

    await ticketService.createTicket({
      title: 'New Year Ticket',
      description: 'Submitted on 2027-01-01T00:00:00.000Z',
      created_at: '2027-01-01T00:00:00.000Z'
    }, [], db);

    // Verify Leap Day filtering: Year 2024, Month 2
    const resLeap = await fetch(`${baseUrl}/api/dashboard/metrics?year=2024&month=2`);
    assert.equal(resLeap.status, 200);
    const dataLeap = await resLeap.json();
    assert.equal(dataLeap.total, 1, 'Leap day ticket must be counted in February 2024');

    // Verify April 2026 filtering
    const resApr = await fetch(`${baseUrl}/api/dashboard/metrics?year=2026&month=4`);
    const dataApr = await resApr.json();
    assert.equal(dataApr.total, 1, 'April 2026 must count April 30 ticket');

    // Verify May 2026 filtering
    const resMay = await fetch(`${baseUrl}/api/dashboard/metrics?year=2026&month=5`);
    const dataMay = await resMay.json();
    assert.equal(dataMay.total, 1, 'May 2026 must count May 1 ticket, not April 30');

    // Verify Year 2027 filtering
    const res2027 = await fetch(`${baseUrl}/api/dashboard/metrics?year=2027`);
    const data2027 = await res2027.json();
    assert.equal(data2027.total, 1, 'Year 2027 must count Jan 1 2027 ticket, not 2026');
  });

  await t.test('T2.5: Zero-ticket query periods (No division by zero, 0.0 resolution rate)', async () => {
    // Query a month with no tickets: Year 2030, Month 6
    const res = await fetch(`${baseUrl}/api/dashboard/metrics?year=2030&month=6`);
    assert.equal(res.status, 200);

    const metrics = await res.json();
    assert.equal(metrics.total, 0);
    assert.equal(metrics.pending_backlog, 0);
    assert.equal(metrics.in_progress, 0);
    assert.equal(metrics.resolved_closed, 0);
    assert.equal(metrics.resolution_rate, 0.0, 'Resolution rate must be safe 0.0, not NaN or null');
    assert.equal(typeof metrics.resolution_rate, 'number');
  });
});

