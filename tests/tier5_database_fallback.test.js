const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { initializeDatabase } = require('../src/db/database');
const { createTicket } = require('../src/services/ticketService');

test('Tier 5: Database Adapter & Fallback Integrity Tests', async (t) => {
  const tempDbPath = path.join(os.tmpdir(), `test-t5-${crypto.randomUUID()}.db`);
  let db;

  t.before(async () => {
    // Initialize in local fallback mode (no TURSO_DATABASE_URL)
    db = initializeDatabase(tempDbPath);
    await db.initSchema();
  });

  t.after(async () => {
    if (db) {
      await db.close();
    }
    try {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
    } catch (e) {
      // Ignore cleanup error
    }
  });

  await t.test('T5.1: Local fallback initialization and schema table provisioning', async () => {
    assert.ok(db, 'Database adapter instance must be created');
    assert.equal(typeof db.query, 'function', 'db.query must be a function');
    assert.equal(typeof db.get, 'function', 'db.get must be a function');
    assert.equal(typeof db.run, 'function', 'db.run must be a function');
    assert.equal(typeof db.transaction, 'function', 'db.transaction must be a function');
    assert.equal(typeof db.exec, 'function', 'db.exec must be a function');

    const tables = await db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    const tableNames = tables.map((r) => r.name);

    assert.ok(tableNames.includes('tickets'), 'tickets table must exist');
    assert.ok(tableNames.includes('attachments'), 'attachments table must exist');
    assert.ok(tableNames.includes('ticket_history'), 'ticket_history table must exist');

    // Verify attachments table has file_data column
    const columns = await db.query("PRAGMA table_info('attachments')");
    const colNames = columns.map((c) => c.name);
    assert.ok(colNames.includes('file_data'), 'attachments table must contain file_data column');
  });

  await t.test('T5.2: Async CRUD operations and BigInt-to-Number safe serialization', async () => {
    const now = new Date().toISOString();
    const runResult = await db.run(
      `INSERT INTO tickets (ticket_code, title, description, category, priority, status, requester_name, requester_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`,
      ['HD-202611-9901', 'T5 DB Test', 'Testing async adapter', 'Hardware', 'High', 'Tester', 'test@test.com', now, now]
    );

    // Verify BigInt safe conversion
    assert.equal(typeof runResult.lastInsertRowid, 'number', 'lastInsertRowid must be cast to a JavaScript number');
    assert.ok(runResult.lastInsertRowid > 0, 'lastInsertRowid must be positive integer');
    assert.equal(typeof runResult.changes, 'number', 'changes must be a number');
    assert.equal(runResult.changes, 1, 'changes must equal 1 for single INSERT');

    // Verify JSON.stringify does NOT throw BigInt serialization error
    const serializable = JSON.stringify({ id: runResult.lastInsertRowid });
    assert.ok(serializable.includes('"id":'), 'JSON serialization must succeed');

    // Verify db.get
    const row = await db.get('SELECT * FROM tickets WHERE id = ?', [runResult.lastInsertRowid]);
    assert.ok(row, 'db.get must return inserted row');
    assert.equal(row.ticket_code, 'HD-202611-9901');
    assert.equal(row.title, 'T5 DB Test');

    // Verify db.query
    const list = await db.query('SELECT * FROM tickets WHERE ticket_code = ?', ['HD-202611-9901']);
    assert.equal(Array.isArray(list), true, 'db.query must return an Array');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, runResult.lastInsertRowid);
  });

  await t.test('T5.3: Transaction session atomicity and error rollback', async () => {
    const preCountRow = await db.get('SELECT COUNT(*) as cnt FROM tickets');
    const preCount = preCountRow.cnt;

    let transactionErrorThrown = false;
    try {
      await db.transaction(async (tx) => {
        const now = new Date().toISOString();
        await tx.run(
          `INSERT INTO tickets (ticket_code, title, description, category, priority, status, requester_name, requester_email, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`,
          ['HD-202611-ROLLBACK', 'Rollback Title', 'Rollback Desc', 'Software', 'Low', 'User', 'u@u.com', now, now]
        );

        // Intentionally throw inside transaction to trigger rollback
        throw new Error('Simulated transaction failure for rollback verification');
      });
    } catch (err) {
      transactionErrorThrown = true;
      assert.equal(err.message, 'Simulated transaction failure for rollback verification');
    }

    assert.ok(transactionErrorThrown, 'Transaction error must be thrown to caller');

    // Verify that the row was rolled back and does not exist
    const postCountRow = await db.get('SELECT COUNT(*) as cnt FROM tickets');
    assert.equal(postCountRow.cnt, preCount, 'Row count must be unchanged after transaction rollback');

    const rolledBackRow = await db.get('SELECT * FROM tickets WHERE ticket_code = ?', ['HD-202611-ROLLBACK']);
    assert.equal(rolledBackRow, null, 'Rolled back ticket must not exist in database');
  });

  await t.test('T5.4: Multi-statement DDL execution via exec', async () => {
    const multiSql = `
      CREATE TABLE IF NOT EXISTS t5_temp_a (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS t5_temp_b (id INTEGER PRIMARY KEY, val TEXT);
    `;
    await db.exec(multiSql);

    const checkA = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 't5_temp_a'");
    const checkB = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 't5_temp_b'");

    assert.ok(checkA, 't5_temp_a table must be created by multi-statement exec');
    assert.ok(checkB, 't5_temp_b table must be created by multi-statement exec');
  });

  await t.test('T5.5: In-memory database initialization mode', async () => {
    const memDb = initializeDatabase(':memory:');
    assert.ok(memDb, 'In-memory database adapter must initialize');
    await memDb.initSchema();

    const memRes = await memDb.run(
      `INSERT INTO tickets (ticket_code, title, description, category, priority, status, requester_name, requester_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`,
      ['HD-MEM-0001', 'Memory Ticket', 'In-memory desc', 'Other', 'Low', 'MemUser', 'm@m.com', new Date().toISOString(), new Date().toISOString()]
    );
    assert.ok(memRes.lastInsertRowid > 0);

    const memTicket = await memDb.get('SELECT * FROM tickets WHERE id = ?', [memRes.lastInsertRowid]);
    assert.equal(memTicket.ticket_code, 'HD-MEM-0001');
    await memDb.close();
  });

  await t.test('T5.6: Concurrent write transactions and concurrent ticket creations without SQLITE_BUSY', async () => {
    // 1. Concurrent write transactions directly on db.transaction()
    const txCount = 10;
    const txPromises = Array.from({ length: txCount }, (_, i) => {
      return db.transaction(async (tx) => {
        const now = new Date().toISOString();
        return await tx.run(
          `INSERT INTO tickets (ticket_code, title, description, category, priority, status, requester_name, requester_email, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`,
          [`HD-T5-TX-${i}`, `Concurrent TX Title ${i}`, `Concurrent TX Desc ${i}`, 'Software', 'Medium', `User ${i}`, `user${i}@example.com`, now, now]
        );
      });
    });

    const txResults = await Promise.all(txPromises);
    assert.equal(txResults.length, txCount, 'All concurrent transactions must resolve');
    for (const res of txResults) {
      assert.equal(res.changes, 1, 'Each transaction must affect 1 row');
    }

    // 2. Concurrent service invocations via ticketService.createTicket()
    const svcCount = 5;
    const svcPromises = Array.from({ length: svcCount }, (_, i) => {
      return createTicket(
        {
          title: `Concurrent Service Ticket ${i}`,
          description: `Testing concurrent createTicket call #${i}`,
          category: 'Hardware',
          priority: 'High',
          requester_name: `Worker ${i}`,
          requester_email: `worker${i}@example.com`
        },
        [],
        db
      );
    });

    const svcResults = await Promise.all(svcPromises);
    assert.equal(svcResults.length, svcCount, 'All concurrent createTicket calls must resolve successfully');

    // Verify each generated a valid unique ticket code
    const codes = svcResults.map((r) => r.ticket_code);
    const uniqueCodes = new Set(codes);
    assert.equal(uniqueCodes.size, svcCount, 'All concurrent tickets must have unique ticket codes');

    for (const ticket of svcResults) {
      assert.ok(ticket.id, 'Ticket must have generated ID');
      assert.ok(ticket.ticket_code.startsWith('HD-'), 'Ticket code must start with prefix HD-');
    }

    // Verify row counts in the database
    const verifyRows = await db.query("SELECT ticket_code FROM tickets WHERE ticket_code LIKE 'HD-T5-TX-%'");
    assert.equal(verifyRows.length, txCount, 'All 10 transaction rows must be committed in the database');
  });
});
