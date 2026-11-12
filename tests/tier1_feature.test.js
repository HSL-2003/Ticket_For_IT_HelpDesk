const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createTestServer, VALID_PNG_BUFFER } = require('./helpers/testServer');

test('Tier 1: Feature Coverage & Happy Path Tests', async (t) => {
  const env = await createTestServer();
  const { baseUrl, cleanup } = env;

  t.after(async () => {
    await cleanup();
  });

  let createdTicketId = null;
  let createdAttachmentId = null;
  const originalPngHash = crypto.createHash('sha256').update(VALID_PNG_BUFFER).digest('hex');

  await t.test('T1.1: Create ticket with title, description, category, priority, and PNG attachment', async () => {
    const formData = new FormData();
    formData.append('title', 'Network switch malfunctioning in Server Room');
    formData.append('description', 'Switch #4 port 12 is reporting packet drops continuously.');
    formData.append('category', 'Network');
    formData.append('priority', 'High');
    formData.append('requester_name', 'Alice Network Admin');
    formData.append('requester_email', 'alice@company.internal');

    const fileBlob = new Blob([VALID_PNG_BUFFER], { type: 'image/png' });
    formData.append('attachments', fileBlob, 'switch-error.png');

    const res = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      body: formData
    });

    assert.equal(res.status, 201, `Expected HTTP 201, got ${res.status}`);
    const data = await res.json();

    assert.ok(data.id, 'Expected ticket id');
    assert.match(data.ticket_code, /^HD-\d{6}-\d{4}$/, 'Ticket code must match HD-YYYYMM-XXXX format');
    assert.equal(data.title, 'Network switch malfunctioning in Server Room');
    assert.equal(data.category, 'Network');
    assert.equal(data.priority, 'High');
    assert.equal(data.status, 'Open');
    assert.equal(data.requester_name, 'Alice Network Admin');
    assert.equal(data.requester_email, 'alice@company.internal');
    assert.equal(data.attachments.length, 1, 'Expected 1 attachment');
    assert.equal(data.attachments[0].original_filename, 'switch-error.png');
    assert.equal(data.attachments[0].mime_type, 'image/png');

    createdTicketId = data.id;
    createdAttachmentId = data.attachments[0].id;
  });

  await t.test('T1.2: Retrieve ticket details by ID with metadata and attachment list', async () => {
    assert.ok(createdTicketId, 'Ticket must be created');

    const res = await fetch(`${baseUrl}/api/tickets/${createdTicketId}`);
    assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}`);

    const data = await res.json();
    assert.equal(data.id, createdTicketId);
    assert.equal(data.title, 'Network switch malfunctioning in Server Room');
    assert.equal(data.status, 'Open');
    assert.equal(data.attachments.length, 1);
    assert.equal(data.attachments[0].id, createdAttachmentId);
    assert.ok(data.attachments[0].url.includes(`/api/tickets/${createdTicketId}/attachments/${createdAttachmentId}/view`));
    assert.ok(data.history.length >= 1, 'Expected at least 1 history item');
    assert.equal(data.history[0].to_status, 'Open');
  });

  await t.test('T1.3: Download and view image attachment with lossless binary integrity', async () => {
    assert.ok(createdTicketId && createdAttachmentId);

    const res = await fetch(`${baseUrl}/api/tickets/${createdTicketId}/attachments/${createdAttachmentId}/view`);
    assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    assert.equal(res.headers.get('content-type'), 'image/png');

    const arrayBuffer = await res.arrayBuffer();
    const retrievedBuffer = Buffer.from(arrayBuffer);
    const retrievedHash = crypto.createHash('sha256').update(retrievedBuffer).digest('hex');

    assert.equal(retrievedHash, originalPngHash, 'Downloaded image hash must match original uploaded image');
    assert.equal(retrievedBuffer.length, VALID_PNG_BUFFER.length);
  });

  await t.test('T1.4: Transition ticket status: Open -> In Progress -> Resolved -> Closed', async () => {
    assert.ok(createdTicketId);

    // 1. Open -> In Progress
    const resProgress = await fetch(`${baseUrl}/api/tickets/${createdTicketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'In Progress', notes: 'Technician dispatched to server room' })
    });
    assert.equal(resProgress.status, 200);
    const progressData = await resProgress.json();
    assert.equal(progressData.status, 'In Progress');

    // 2. In Progress -> Resolved (with notes)
    const resResolved = await fetch(`${baseUrl}/api/tickets/${createdTicketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'Resolved',
        notes: 'Replaced faulty SFP module and verified link stabilization.'
      })
    });
    assert.equal(resResolved.status, 200);
    const resolvedData = await resResolved.json();
    assert.equal(resolvedData.status, 'Resolved');
    assert.equal(resolvedData.resolution_notes, 'Replaced faulty SFP module and verified link stabilization.');
    assert.ok(resolvedData.resolved_at, 'resolved_at timestamp must be set');

    // 3. Resolved -> Closed
    const resClosed = await fetch(`${baseUrl}/api/tickets/${createdTicketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Closed', notes: 'Issue confirmed resolved with requester.' })
    });
    assert.equal(resClosed.status, 200);
    const closedData = await resClosed.json();
    assert.equal(closedData.status, 'Closed');
    assert.ok(closedData.closed_at, 'closed_at timestamp must be set');
  });

  await t.test('T1.5: Fetch dashboard metrics with default date range', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/metrics`);
    assert.equal(res.status, 200);

    const metrics = await res.json();
    assert.equal(metrics.total, 1, 'Total tickets should be 1');
    assert.equal(metrics.pending_backlog, 0);
    assert.equal(metrics.in_progress, 0);
    assert.equal(metrics.resolved_closed, 1);
    assert.equal(metrics.by_status.Closed, 1);
    assert.equal(metrics.by_category.Network, 1);
    assert.equal(metrics.by_priority.High, 1);
    assert.equal(metrics.resolution_rate, 100.0);
  });
});

