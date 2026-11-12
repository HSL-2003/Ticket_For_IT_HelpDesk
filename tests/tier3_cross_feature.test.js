const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers/testServer');
const ticketService = require('../src/services/ticketService');

test('Tier 3: Cross-Feature Combinations & Strict Parity Tests', async (t) => {
  const env = await createTestServer();
  const { baseUrl, db, cleanup } = env;

  t.after(async () => {
    await cleanup();
  });

  await t.test('T3.1: Multi-month / multi-year cohort isolation without crosstalk', async () => {
    // Populate tickets across multiple cohorts
    // Cohort 2025-11: 3 tickets
    await ticketService.createTicket({ title: '2025 Nov Ticket 1', description: 'Cohort A1', created_at: '2025-11-05T10:00:00Z' }, [], db);
    await ticketService.createTicket({ title: '2025 Nov Ticket 2', description: 'Cohort A2', created_at: '2025-11-15T10:00:00Z' }, [], db);
    await ticketService.createTicket({ title: '2025 Nov Ticket 3', description: 'Cohort A3', created_at: '2025-11-25T10:00:00Z' }, [], db);

    // Cohort 2025-12: 2 tickets
    await ticketService.createTicket({ title: '2025 Dec Ticket 1', description: 'Cohort B1', created_at: '2025-12-10T10:00:00Z' }, [], db);
    await ticketService.createTicket({ title: '2025 Dec Ticket 2', description: 'Cohort B2', created_at: '2025-12-20T10:00:00Z' }, [], db);

    // Cohort 2026-01: 4 tickets
    await ticketService.createTicket({ title: '2026 Jan Ticket 1', description: 'Cohort C1', created_at: '2026-01-02T10:00:00Z' }, [], db);
    await ticketService.createTicket({ title: '2026 Jan Ticket 2', description: 'Cohort C2', created_at: '2026-01-14T10:00:00Z' }, [], db);
    await ticketService.createTicket({ title: '2026 Jan Ticket 3', description: 'Cohort C3', created_at: '2026-01-20T10:00:00Z' }, [], db);
    await ticketService.createTicket({ title: '2026 Jan Ticket 4', description: 'Cohort C4', created_at: '2026-01-28T10:00:00Z' }, [], db);

    // 1. Check 2025 total (3 + 2 = 5)
    const res2025 = await fetch(`${baseUrl}/api/dashboard/metrics?year=2025`);
    const metrics2025 = await res2025.json();
    assert.equal(metrics2025.total, 5, 'Year 2025 must have exactly 5 tickets');

    // 2. Check 2025-11 (exactly 3)
    const res2025Nov = await fetch(`${baseUrl}/api/dashboard/metrics?year=2025&month=11`);
    const metrics2025Nov = await res2025Nov.json();
    assert.equal(metrics2025Nov.total, 3, 'November 2025 must have exactly 3 tickets');

    // 3. Check 2025-12 (exactly 2)
    const res2025Dec = await fetch(`${baseUrl}/api/dashboard/metrics?year=2025&month=12`);
    const metrics2025Dec = await res2025Dec.json();
    assert.equal(metrics2025Dec.total, 2, 'December 2025 must have exactly 2 tickets');

    // 4. Check 2026-01 (exactly 4)
    const res2026Jan = await fetch(`${baseUrl}/api/dashboard/metrics?year=2026&month=1`);
    const metrics2026Jan = await res2026Jan.json();
    assert.equal(metrics2026Jan.total, 4, 'January 2026 must have exactly 4 tickets');
  });

  await t.test('T3.2: Strict 100% count and status parity between Dashboard and Ticket List', async () => {
    // Modify statuses of tickets in 2026-01
    const janTickets = await db.query("SELECT id FROM tickets WHERE created_at LIKE '2026-01%' ORDER BY id ASC");
    assert.equal(janTickets.length, 4);

    // Set statuses: 1 Open, 1 In Progress, 1 Resolved, 1 Closed
    // Ticket 1: Open
    // Ticket 2: In Progress
    await ticketService.updateTicketStatus(janTickets[1].id, { status: 'In Progress' }, db);
    // Ticket 3: In Progress -> Resolved
    await ticketService.updateTicketStatus(janTickets[2].id, { status: 'In Progress' }, db);
    await ticketService.updateTicketStatus(janTickets[2].id, { status: 'Resolved', notes: 'Fixed Jan issue' }, db);
    // Ticket 4: In Progress -> Resolved -> Closed
    await ticketService.updateTicketStatus(janTickets[3].id, { status: 'In Progress' }, db);
    await ticketService.updateTicketStatus(janTickets[3].id, { status: 'Resolved', notes: 'Resolved before close' }, db);
    await ticketService.updateTicketStatus(janTickets[3].id, { status: 'Closed' }, db);

    // Fetch dashboard metrics for 2026-01
    const resDash = await fetch(`${baseUrl}/api/dashboard/metrics?year=2026&month=1`);
    assert.equal(resDash.status, 200);
    const dash = await resDash.json();

    // Fetch ticket list for 2026-01
    const resList = await fetch(`${baseUrl}/api/tickets?year=2026&month=1`);
    assert.equal(resList.status, 200);
    const list = await resList.json();

    // Assert strict parity
    assert.equal(list.total, dash.total, 'Ticket list count must exactly match dashboard total');
    assert.equal(list.tickets.length, dash.total);

    // Compute status counts from ticket list
    const manualStatusCounts = {
      'Open': 0,
      'Pending': 0,
      'In Progress': 0,
      'Resolved': 0,
      'Closed': 0
    };
    for (const t of list.tickets) {
      manualStatusCounts[t.status] = (manualStatusCounts[t.status] || 0) + 1;
    }

    assert.deepEqual(
      dash.by_status,
      manualStatusCounts,
      'Dashboard status breakdown must 100% match ticket list manual count'
    );

    assert.equal(dash.pending_backlog, manualStatusCounts['Open'] + manualStatusCounts['Pending']);
    assert.equal(dash.in_progress, manualStatusCounts['In Progress']);
    assert.equal(dash.resolved_closed, manualStatusCounts['Resolved'] + manualStatusCounts['Closed']);
    assert.equal(dash.total, dash.pending_backlog + dash.in_progress + dash.resolved_closed);

    // Resolution rate check: (2 / 4) * 100 = 50.0%
    assert.equal(dash.resolution_rate, 50.0);
  });

  await t.test('T3.3: Lifecycle status changes dynamically reflect in Dashboard metrics', async () => {
    // Create new ticket in current month
    const ticket = await ticketService.createTicket({
      title: 'Dynamic Lifecycle Reflection Ticket',
      description: 'Testing metric shift across state changes',
      category: 'Software',
      priority: 'High'
    }, [], db);

    // Initial check: Pending / Backlog should increase
    const m1 = await (await fetch(`${baseUrl}/api/dashboard/metrics`)).json();
    const initPending = m1.pending_backlog;
    const initInProgress = m1.in_progress;
    const initResolved = m1.resolved_closed;

    // Transition to In Progress
    await fetch(`${baseUrl}/api/tickets/${ticket.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'In Progress' })
    });

    const m2 = await (await fetch(`${baseUrl}/api/dashboard/metrics`)).json();
    assert.equal(m2.pending_backlog, initPending - 1);
    assert.equal(m2.in_progress, initInProgress + 1);
    assert.equal(m2.resolved_closed, initResolved);

    // Transition to Resolved
    await fetch(`${baseUrl}/api/tickets/${ticket.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Resolved', notes: 'Patch deployed successfully' })
    });

    const m3 = await (await fetch(`${baseUrl}/api/dashboard/metrics`)).json();
    assert.equal(m3.pending_backlog, initPending - 1);
    assert.equal(m3.in_progress, initInProgress);
    assert.equal(m3.resolved_closed, initResolved + 1);
  });
});

