const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createTestServer, VALID_JPEG_BUFFER } = require('./helpers/testServer');

test('Tier 4: Complete Real-World IT HelpDesk User Journey & System E2E', async (t) => {
  const env = await createTestServer();
  const { baseUrl, cleanup } = env;

  t.after(async () => {
    await cleanup();
  });

  await t.test('T4.1: End-to-end IT support workflow with media upload, transitions, audit history, and dashboard verification', async () => {
    // Step 1: Health check
    const resHealth = await fetch(`${baseUrl}/api/health`);
    assert.equal(resHealth.status, 200);
    const health = await resHealth.json();
    assert.equal(health.status, 'OK');

    // Step 2: Employee submits a hardware ticket with an attached error photo
    const formData = new FormData();
    formData.append('title', 'Corporate Laptop Battery Swelling & Overheating');
    formData.append('description', 'The bottom chassis of the ThinkPad X1 is bulging and laptop shuts down abruptly when unplugged.');
    formData.append('category', 'Hardware');
    formData.append('priority', 'Critical');
    formData.append('requester_name', 'Marcus Vance (Engineering)');
    formData.append('requester_email', 'marcus.vance@company.internal');

    const photoBlob = new Blob([VALID_JPEG_BUFFER], { type: 'image/jpeg' });
    formData.append('attachments', photoBlob, 'battery-chassis-bulge.jpg');

    const resCreate = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      body: formData
    });

    assert.equal(resCreate.status, 201);
    const ticket = await resCreate.json();
    assert.ok(ticket.id);
    assert.match(ticket.ticket_code, /^HD-\d{6}-\d{4}$/);
    assert.equal(ticket.status, 'Open');
    assert.equal(ticket.attachments.length, 1);
    assert.equal(ticket.attachments[0].original_filename, 'battery-chassis-bulge.jpg');

    const ticketId = ticket.id;
    const attachmentId = ticket.attachments[0].id;

    // Step 3: HelpDesk Technician reviews ticket and checks uploaded photo
    const resDetail = await fetch(`${baseUrl}/api/tickets/${ticketId}`);
    assert.equal(resDetail.status, 200);
    const detailData = await resDetail.json();
    assert.equal(detailData.id, ticketId);
    assert.equal(detailData.priority, 'Critical');

    const resPhoto = await fetch(`${baseUrl}/api/tickets/${ticketId}/attachments/${attachmentId}/view`);
    assert.equal(resPhoto.status, 200);
    assert.equal(resPhoto.headers.get('content-type'), 'image/jpeg');
    const photoBytes = await resPhoto.arrayBuffer();
    assert.equal(photoBytes.byteLength, VALID_JPEG_BUFFER.length);

    // Step 4: Technician accepts ticket and transitions to In Progress
    const resProg = await fetch(`${baseUrl}/api/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'In Progress',
        notes: 'Device collected at Level 4 IT Bar; battery quarantined.',
        changed_by: 'Sarah Connor (IT Senior Tech)'
      })
    });
    assert.equal(resProg.status, 200);
    const progData = await resProg.json();
    assert.equal(progData.status, 'In Progress');

    // Step 5: Technician replaces battery, runs diagnostics, transitions to Resolved
    const resolutionText = 'Replaced swollen battery with genuine OEM 57Wh battery. Performed 100% load cycle test with normal thermals.';
    const resResolve = await fetch(`${baseUrl}/api/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'Resolved',
        notes: resolutionText,
        changed_by: 'Sarah Connor (IT Senior Tech)'
      })
    });
    assert.equal(resResolve.status, 200);
    const resolvedTicket = await resResolve.json();
    assert.equal(resolvedTicket.status, 'Resolved');
    assert.equal(resolvedTicket.resolution_notes, resolutionText);
    assert.ok(resolvedTicket.resolved_at);

    // Step 6: Requester verifies device and IT closes ticket
    const resClose = await fetch(`${baseUrl}/api/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'Closed',
        notes: 'User returned to workstation; confirmed 7-hour battery life.',
        changed_by: 'HelpDesk Dispatcher'
      })
    });
    assert.equal(resClose.status, 200);
    const closedTicket = await resClose.json();
    assert.equal(closedTicket.status, 'Closed');
    assert.ok(closedTicket.closed_at);

    // Step 7: Verify complete audit history
    assert.equal(closedTicket.history.length, 4, 'Audit history must contain 4 lifecycle events');
    assert.equal(closedTicket.history[0].to_status, 'Open');
    assert.equal(closedTicket.history[1].to_status, 'In Progress');
    assert.equal(closedTicket.history[2].to_status, 'Resolved');
    assert.equal(closedTicket.history[3].to_status, 'Closed');

    // Step 8: Dashboard metrics reflection
    const resDash = await fetch(`${baseUrl}/api/dashboard/metrics`);
    assert.equal(resDash.status, 200);
    const dash = await resDash.json();
    assert.equal(dash.total, 1);
    assert.equal(dash.pending_backlog, 0);
    assert.equal(dash.in_progress, 0);
    assert.equal(dash.resolved_closed, 1);
    assert.equal(dash.by_status.Closed, 1);
    assert.equal(dash.by_category.Hardware, 1);
    assert.equal(dash.by_priority.Critical, 1);
    assert.equal(dash.resolution_rate, 100.0);
  });
});

