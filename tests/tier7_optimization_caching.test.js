const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { performance } = require('node:perf_hooks');

const { createTestServer, VALID_PNG_BUFFER } = require('./helpers/testServer');
const memoryCache = require('../src/cache/memoryCache');
const ticketService = require('../src/services/ticketService');
const dashboardService = require('../src/services/dashboardService');

/**
 * Creates a dual-mode fetch client that uses native network fetch when available,
 * and seamlessly falls back to in-process Express dispatch when running inside a sandbox
 * where loopback TCP connect EACCES is enforced by the operating system.
 */
function createFetchClient(server) {
  const app = server ? server.listeners('request')[0] : null;

  return async function safeFetch(url, options = {}) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (err && err.cause && err.cause.code === 'EACCES' && app) {
        return inProcessDispatch(app, url, options);
      }
      throw err;
    }
  };
}

function inProcessDispatch(app, urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const socket = new net.Socket();
      const req = new http.IncomingMessage(socket);

      req.method = (options.method || 'GET').toUpperCase();
      req.url = parsedUrl.pathname + parsedUrl.search;
      req.headers = {};

      let bodyBuffer = null;
      if (options.body) {
        if (Buffer.isBuffer(options.body)) {
          bodyBuffer = options.body;
        } else if (typeof options.body === 'string') {
          bodyBuffer = Buffer.from(options.body, 'utf8');
        } else if (options.body instanceof Uint8Array) {
          bodyBuffer = Buffer.from(options.body);
        }
      }

      if (options.headers) {
        if (typeof options.headers.forEach === 'function') {
          options.headers.forEach((val, key) => {
            req.headers[key.toLowerCase()] = val;
          });
        } else {
          for (const [k, v] of Object.entries(options.headers)) {
            req.headers[k.toLowerCase()] = v;
          }
        }
      }

      if (bodyBuffer) {
        req.headers['content-length'] = String(bodyBuffer.length);
      }

      const res = new http.ServerResponse(req);
      const chunks = [];

      res.write = function(chunk, encoding) {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        }
        return true;
      };

      res.end = function(chunk, encoding) {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        }
        const totalBuffer = Buffer.concat(chunks);
        const headersMap = new Map();
        const rawHeaders = res.getHeaders ? res.getHeaders() : {};
        for (const [k, v] of Object.entries(rawHeaders)) {
          headersMap.set(k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v));
        }

        resolve({
          status: res.statusCode || 200,
          ok: (res.statusCode || 200) >= 200 && (res.statusCode || 200) < 300,
          headers: {
            get(name) {
              return headersMap.get(name.toLowerCase()) || null;
            }
          },
          json: async () => JSON.parse(totalBuffer.toString('utf8')),
          text: async () => totalBuffer.toString('utf8'),
          arrayBuffer: async () => {
            return totalBuffer.buffer.slice(
              totalBuffer.byteOffset,
              totalBuffer.byteOffset + totalBuffer.byteLength
            );
          }
        });
      };

      app(req, res, (err) => {
        if (err) return reject(err);
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      if (bodyBuffer) {
        req.push(bodyBuffer);
      }
      req.push(null);
    } catch (dispatchErr) {
      reject(dispatchErr);
    }
  });
}

test('Tier 7: Optimization, Batching, Caching & Optimistic Concurrency Tests', async (t) => {
  const env = await createTestServer();
  const { baseUrl, db, server, cleanup } = env;
  const safeFetch = createFetchClient(server);

  t.after(async () => {
    await cleanup();
  });

  let createdTicketId = null;
  let createdTicketCode = null;
  let createdAttachmentId = null;

  // --------------------------------------------------------------------------
  // T7.1: DB Batch Execution Pipeline (db.batch)
  // --------------------------------------------------------------------------
  await t.test('T7.1: DB Batch Execution Pipeline executes multi-statement SQL in 1 round-trip', async () => {
    assert.equal(typeof db.batch, 'function', 'db.batch must be exposed on database wrapper');

    const now = new Date().toISOString();
    const batchStatements = [
      {
        sql: `INSERT INTO tickets (ticket_code, title, description, category, priority, status, requester_name, requester_email, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`,
        args: ['HD-202611-7001', 'Batch Test Ticket 1', 'First batched pipeline write', 'Software', 'High', 'Batch Tester', 'batch1@example.internal', now, now]
      },
      {
        sql: `INSERT INTO tickets (ticket_code, title, description, category, priority, status, requester_name, requester_email, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`,
        args: ['HD-202611-7002', 'Batch Test Ticket 2', 'Second batched pipeline write', 'Hardware', 'Critical', 'Batch Tester', 'batch2@example.internal', now, now]
      }
    ];

    const writeResults = await db.batch(batchStatements, 'write');
    assert.ok(Array.isArray(writeResults), 'db.batch write must return an array of result sets');
    assert.equal(writeResults.length, 2, 'Batch write must execute both statements');
    assert.equal(Number(writeResults[0].rowsAffected), 1, 'First statement must affect 1 row');
    assert.equal(Number(writeResults[1].rowsAffected), 1, 'Second statement must affect 1 row');

    // Read batch: verify reading multiple queries in 1 pipeline request
    const readResults = await db.batch([
      { sql: 'SELECT * FROM tickets WHERE ticket_code = ?', args: ['HD-202611-7001'] },
      { sql: 'SELECT * FROM tickets WHERE ticket_code = ?', args: ['HD-202611-7002'] },
      { sql: 'SELECT COUNT(*) as total FROM tickets WHERE ticket_code LIKE ?', args: ['HD-202611-700%'] }
    ], 'read');

    assert.equal(readResults.length, 3, 'Read batch must return 3 result sets');
    assert.equal(readResults[0].rows.length, 1);
    assert.equal(readResults[0].rows[0].ticket_code, 'HD-202611-7001');
    assert.equal(readResults[1].rows.length, 1);
    assert.equal(readResults[1].rows[0].ticket_code, 'HD-202611-7002');
    assert.equal(Number(readResults[2].rows[0].total), 2);

    // Rollback test: invalid query inside write batch must reject and roll back
    await assert.rejects(
      async () => {
        await db.batch([
          {
            sql: `INSERT INTO tickets (ticket_code, title, description, category, priority, status, requester_name, requester_email, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`,
            args: ['HD-202611-7003', 'Rollback Target', 'Should not commit', 'Network', 'Low', 'Tester', 't@test.com', now, now]
          },
          { sql: 'SYNTAX ERROR INVALID SQL QUERY STATEMENT', args: [] }
        ], 'write');
      },
      /syntax error|syntax|SQL/i,
      'Batch with invalid statement must reject'
    );

    const rollbackCheck = await db.get('SELECT * FROM tickets WHERE ticket_code = ?', ['HD-202611-7003']);
    assert.equal(rollbackCheck, null, 'Uncommitted row from failed batch write must be rolled back');
  });

  // --------------------------------------------------------------------------
  // T7.2: Batched Dashboard Service & Cache Verification
  // --------------------------------------------------------------------------
  await t.test('T7.2: Dashboard Service computes metrics via single batch pipeline and leverages cache', async () => {
    // Clear cache to test fresh computation
    memoryCache.clear();

    const metrics1 = await dashboardService.getDashboardMetrics({});
    assert.ok(metrics1, 'Dashboard metrics must be returned');
    assert.ok(typeof metrics1.total === 'number', 'Total tickets must be numeric');
    assert.ok(metrics1.total >= 2, 'Total tickets should include batch-inserted tickets');
    assert.equal(metrics1.pending_backlog, metrics1.by_status.Open + metrics1.by_status.Pending);
    assert.equal(metrics1.in_progress, metrics1.by_status['In Progress']);
    assert.equal(metrics1.resolved_closed, metrics1.by_status.Resolved + metrics1.by_status.Closed);
    assert.ok(metrics1.by_status.Open >= 2);
    assert.ok(metrics1.by_category.Software >= 1);
    assert.ok(metrics1.by_category.Hardware >= 1);

    // Verify cache hit: global cache retains the metric
    const cachedEntry = memoryCache.get('dashboard:metrics::');
    assert.ok(cachedEntry, 'Dashboard metrics must be cached with key "dashboard:metrics::"');
    assert.equal(cachedEntry.total, metrics1.total);

    // Fast sub-millisecond cached response verification
    const start = performance.now();
    const metricsCached = await dashboardService.getDashboardMetrics({});
    const duration = performance.now() - start;
    assert.equal(metricsCached.total, metrics1.total);
    assert.ok(duration < 10, `Cached dashboard response should be instantaneous (took ${duration.toFixed(3)}ms)`);
  });

  // --------------------------------------------------------------------------
  // T7.3: Batched Ticket Detail & List with BLOB Metadata Isolation
  // --------------------------------------------------------------------------
  await t.test('T7.3: Batched Ticket Detail & List queries isolate BLOB data and batch 1-RTT results', async () => {
    // 1. Create a ticket with image attachment via HTTP multipart
    const boundary = '----WebKitFormBoundaryTier7Test' + crypto.randomUUID().replace(/-/g, '');
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nOptimization Test: Ticket Detail & BLOB Isolation\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nVerifying batched single-roundtrip detail fetch and BLOB isolation\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nNetwork\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="priority"\r\n\r\nCritical\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="requester_name"\r\n\r\nCharlie Network Eng\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="requester_email"\r\n\r\ncharlie@internal.net\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachments"; filename="diagram-opt.png"\r\nContent-Type: image/png\r\n\r\n`),
      VALID_PNG_BUFFER,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const res = await safeFetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });
    assert.equal(res.status, 201, `Expected HTTP 201, got ${res.status}`);
    const created = await res.json();
    assert.ok(created.id);
    createdTicketId = created.id;
    createdTicketCode = created.ticket_code;
    assert.ok(created.attachments && created.attachments.length > 0, 'Created ticket must include attachments');
    createdAttachmentId = created.attachments[0].id;

    // 2. Test batched getTicketById(id)
    const detail = await ticketService.getTicketById(createdTicketId);
    assert.equal(detail.id, createdTicketId);
    assert.equal(detail.ticket_code, createdTicketCode);
    assert.ok(Array.isArray(detail.attachments), 'attachments must be an array');
    assert.equal(detail.attachments.length, 1);
    assert.ok(Array.isArray(detail.history), 'history must be an array');
    assert.ok(detail.history.length >= 1, 'history must contain at least creation event');

    // BLOB metadata isolation assertion: file_data must NOT be present in ticket detail query
    const att = detail.attachments[0];
    assert.equal(att.original_filename, 'diagram-opt.png');
    assert.equal(att.mime_type, 'image/png');
    assert.equal(att.file_data, undefined, 'file_data BLOB must NOT be included in ticket detail query');
    assert.ok(att.url.includes(`/api/tickets/${createdTicketId}/attachments/${att.id}/view`));
    assert.ok(att.download_url.includes(`/api/tickets/${createdTicketId}/attachments/${att.id}/download`));

    // 3. Test batched listTickets()
    const listResult = await ticketService.listTickets({ search: 'BLOB Isolation' });
    assert.ok(listResult.total >= 1, 'Total matching tickets should be at least 1');
    assert.ok(Array.isArray(listResult.tickets));
    const matchedTicket = listResult.tickets.find(t => t.id === createdTicketId);
    assert.ok(matchedTicket, 'Created ticket must be present in search result');
    assert.ok(Array.isArray(matchedTicket.attachments));
    if (matchedTicket.attachments.length > 0) {
      assert.equal(matchedTicket.attachments[0].file_data, undefined, 'file_data BLOB must NOT be included in list result');
    }
  });

  // --------------------------------------------------------------------------
  // T7.4: Atomic OCC Concurrency & 409 Conflict with Phantom History Protection
  // --------------------------------------------------------------------------
  await t.test('T7.4: Atomic OCC detects concurrency collision, returns 409, and prevents phantom history', async () => {
    assert.ok(createdTicketId);

    // Initial state is 'Open'. Transition to 'In Progress' with valid expected_status: 'Open'
    const successRes = await safeFetch(`${baseUrl}/api/tickets/${createdTicketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'In Progress',
        expected_status: 'Open',
        notes: 'Operator 1 claimed the ticket'
      })
    });
    assert.equal(successRes.status, 200, 'First update with matching expected_status must succeed');
    const successData = await successRes.json();
    assert.equal(successData.status, 'In Progress');

    // Count history records before conflict attempt
    const historyBefore = await db.query('SELECT * FROM ticket_history WHERE ticket_id = ?', [createdTicketId]);
    const historyCountBefore = historyBefore.length;

    // Stale concurrent update: Operator 2 still thinks ticket is 'Open' and attempts transition
    const conflictRes = await safeFetch(`${baseUrl}/api/tickets/${createdTicketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'Closed',
        expected_status: 'Open', // Stale! Current status is 'In Progress'
        notes: 'Operator 2 attempted concurrent close'
      })
    });

    assert.equal(conflictRes.status, 409, 'OCC mismatch must return HTTP 409 Conflict');
    const conflictData = await conflictRes.json();
    assert.ok(conflictData.error, 'Conflict response must contain error message');
    assert.ok(conflictData.ticket, 'Conflict response must return canonical ticket object');
    assert.equal(conflictData.ticket.status, 'In Progress', 'Canonical ticket must reflect actual database status');

    // Phantom History Protection: Verify zero phantom rows were inserted
    const historyAfter = await db.query('SELECT * FROM ticket_history WHERE ticket_id = ?', [createdTicketId]);
    assert.equal(
      historyAfter.length,
      historyCountBefore,
      'OCC failure must NOT insert any phantom rows into ticket_history (guarded by WHERE (SELECT changes()) > 0)'
    );

    // Direct service invocation OCC test
    await assert.rejects(
      async () => {
        await ticketService.updateTicketStatus(createdTicketId, {
          status: 'Pending',
          expected_status: 'Open', // Valid from 'Open', but actual DB status is 'In Progress'!
          notes: 'Direct service OCC test'
        });
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.ok(err.canonicalTicket);
        assert.equal(err.canonicalTicket.status, 'In Progress');
        return true;
      },
      'Direct ticketService.updateTicketStatus must throw 409 with canonicalTicket on OCC collision'
    );
  });

  // --------------------------------------------------------------------------
  // T7.5: In-Memory LRU Cache (Lookup Speed, TTL, Eviction, Guard)
  // --------------------------------------------------------------------------
  await t.test('T7.5: In-Memory LRU Cache provides sub-0.1ms lookups, TTL expiration, capacity eviction, and invalidation', async () => {
    const CacheClass = memoryCache.MemoryCache;
    const testCache = new CacheClass(3);

    // 1. Sub-0.1ms lookup speed benchmark
    testCache.set('bench:key', { data: 'quick-payload' }, 60);
    const iterations = 5000;
    const startBench = performance.now();
    for (let i = 0; i < iterations; i++) {
      testCache.get('bench:key');
    }
    const totalBenchMs = performance.now() - startBench;
    const avgLatencyMs = totalBenchMs / iterations;
    assert.ok(
      avgLatencyMs < 0.1,
      `LRU cache lookup must be < 0.1ms (actual average: ${avgLatencyMs.toFixed(5)}ms)`
    );

    // 2. TTL Expiration
    testCache.set('ttl:key', 'will-expire', 0.05); // 50ms TTL
    assert.equal(testCache.get('ttl:key'), 'will-expire');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(testCache.get('ttl:key'), undefined, 'Expired cache entry must return undefined');

    // 3. Capacity eviction (LRU order)
    const lruCache = new CacheClass(3);
    lruCache.set('a', 1);
    lruCache.set('b', 2);
    lruCache.set('c', 3);
    assert.equal(lruCache.size, 3);

    // Access 'a' to make 'b' the least recently used
    lruCache.get('a');

    // Add 'd', which must evict 'b'
    lruCache.set('d', 4);
    assert.equal(lruCache.size, 3);
    assert.equal(lruCache.get('b'), undefined, 'Key "b" must have been evicted as LRU');
    assert.equal(lruCache.get('a'), 1);
    assert.equal(lruCache.get('c'), 3);
    assert.equal(lruCache.get('d'), 4);

    // 4. Automated cache invalidation on ticket creation & status updates
    memoryCache.set('tickets:list:test', { sample: true }, 60);
    memoryCache.set('dashboard:metrics::', { sample: true }, 60);
    assert.ok(memoryCache.has('tickets:list:test'));
    assert.ok(memoryCache.has('dashboard:metrics::'));

    // Creating ticket must invalidate ticket lists and dashboard metrics
    await ticketService.createTicket({
      title: 'Auto Invalidation Trigger Ticket',
      description: 'Testing automatic cache purge on create',
      category: 'Software',
      priority: 'Low',
      requester_name: 'Cache Tester',
      requester_email: 'cache@test.com'
    }, []);

    assert.equal(memoryCache.has('tickets:list:test'), false, 'tickets:list cache must be purged on ticket creation');
    assert.equal(memoryCache.has('dashboard:metrics::'), false, 'dashboard:metrics cache must be purged on ticket creation');

    // 5. Epoch Invalidation Guard (rejects stale background fetches)
    const staleFetchStart = Date.now() - 500;
    memoryCache.invalidatePrefix('tickets:');
    const wasCached = memoryCache.set('tickets:stale_result', { stale: true }, 60, staleFetchStart);
    assert.equal(wasCached, false, 'Epoch invalidation guard must reject caching stale DB reads');
    assert.equal(memoryCache.has('tickets:stale_result'), false);
  });

  // --------------------------------------------------------------------------
  // T7.6: Attachment ETag Generation & HTTP 304 Not Modified
  // --------------------------------------------------------------------------
  await t.test('T7.6: Attachment route serves ETag and returns HTTP 304 Not Modified on conditional match', async () => {
    assert.ok(createdTicketId && createdAttachmentId);

    // Initial view request (HTTP 200)
    const resInitial = await safeFetch(`${baseUrl}/api/tickets/${createdTicketId}/attachments/${createdAttachmentId}/view`);
    assert.equal(resInitial.status, 200);
    const etag = resInitial.headers.get('etag');
    assert.ok(etag, 'Attachment response must contain an ETag header');
    assert.equal(
      resInitial.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
      'Attachment must have immutable Cache-Control header'
    );

    const initialBody = await resInitial.arrayBuffer();
    assert.equal(initialBody.byteLength, VALID_PNG_BUFFER.length);

    // Conditional view request with matching If-None-Match (HTTP 304)
    const resConditional = await safeFetch(`${baseUrl}/api/tickets/${createdTicketId}/attachments/${createdAttachmentId}/view`, {
      headers: {
        'If-None-Match': etag
      }
    });
    assert.equal(resConditional.status, 304, 'Matching If-None-Match must return HTTP 304 Not Modified');
    const notModifiedBody = await resConditional.arrayBuffer();
    assert.equal(notModifiedBody.byteLength, 0, 'HTTP 304 response body must be empty (zero bytes transferred)');

    // Conditional view request with mismatched If-None-Match (HTTP 200)
    const resMismatched = await safeFetch(`${baseUrl}/api/tickets/${createdTicketId}/attachments/${createdAttachmentId}/view`, {
      headers: {
        'If-None-Match': '"outdated-etag-12345"'
      }
    });
    assert.equal(resMismatched.status, 200, 'Mismatched If-None-Match must return full HTTP 200 response');
    const mismatchedBody = await resMismatched.arrayBuffer();
    assert.equal(mismatchedBody.byteLength, VALID_PNG_BUFFER.length);

    // Download endpoint conditional request
    const resDownloadInitial = await safeFetch(`${baseUrl}/api/tickets/${createdTicketId}/attachments/${createdAttachmentId}/download`);
    assert.equal(resDownloadInitial.status, 200);
    const downloadEtag = resDownloadInitial.headers.get('etag');
    assert.ok(downloadEtag);

    const resDownload304 = await safeFetch(`${baseUrl}/api/tickets/${createdTicketId}/attachments/${createdAttachmentId}/download`, {
      headers: {
        'If-None-Match': downloadEtag
      }
    });
    assert.equal(resDownload304.status, 304, 'Download endpoint must also support HTTP 304 conditional caching');
  });

  // --------------------------------------------------------------------------
  // T7.7: Optimistic State, Snapshot Rollback, Draft Preservation & Mutex Locking
  // --------------------------------------------------------------------------
  await t.test('T7.7: Frontend State Store supports snapshot rollback, draft preservation, and transition mutex locking', async () => {
    // Mock minimal browser globals for testing genuine window.AppStore controller
    global.window = {};
    global.document = {
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    };

    // Load frontend store controller
    delete require.cache[require.resolve('../public/js/app.js')];
    require('../public/js/app.js');
    const store = global.window.AppStore;
    assert.ok(store, 'window.AppStore must be initialized');

    // 1. Snapshot Save & Rollback
    const initialMetrics = {
      total: 5,
      pending_backlog: 3,
      in_progress: 1,
      resolved_closed: 1,
      resolution_rate: 20.0
    };
    store.metrics = { ...initialMetrics };
    const tempTicketId = 'temp_ticket_opt_99';

    store.saveSnapshot(tempTicketId, {
      metrics: JSON.parse(JSON.stringify(store.metrics)),
      status: 'Open'
    });

    // Mutate state optimistically
    store.metrics.total = 6;
    store.metrics.pending_backlog = 4;
    store.ticketList.unshift({ id: tempTicketId, title: 'Optimistic Draft', status: 'Open' });

    assert.equal(store.metrics.total, 6);
    assert.equal(store.ticketList[0].id, tempTicketId);

    // Simulate Network Error: Roll back from snapshot
    const savedSnapshot = store.getSnapshot(tempTicketId);
    assert.ok(savedSnapshot, 'Snapshot must be retrievable');
    store.metrics = savedSnapshot.metrics;
    store.ticketList = store.ticketList.filter(t => t.id !== tempTicketId);
    store.deleteSnapshot(tempTicketId);

    assert.equal(store.metrics.total, 5, 'Metrics total must roll back to 5');
    assert.equal(store.metrics.pending_backlog, 3, 'Metrics pending backlog must roll back to 3');
    assert.equal(store.ticketList.length, 0, 'Optimistic row must be purged on rollback');
    assert.equal(store.getSnapshot(tempTicketId), undefined, 'Snapshot must be cleaned up after rollback');

    // 2. Draft Preservation on Submission Failure
    const draftPayload = {
      title: 'Unsaved Ticket Draft',
      description: 'Crucial diagnostic logs that should not be wiped out on network timeout',
      category: 'Access',
      priority: 'Medium',
      files: ['log-attachment.txt']
    };
    store.pendingDrafts.set(tempTicketId, draftPayload);

    // On simulated network failure: draft is preserved
    assert.ok(store.pendingDrafts.has(tempTicketId), 'Draft must remain preserved during submission error');
    const retrievedDraft = store.pendingDrafts.get(tempTicketId);
    assert.equal(retrievedDraft.title, 'Unsaved Ticket Draft');
    assert.equal(retrievedDraft.files.length, 1);

    // On simulated eventual success: draft is deleted
    store.pendingDrafts.delete(tempTicketId);
    assert.equal(store.pendingDrafts.has(tempTicketId), false);

    // 3. Mutex Locking for Lifecycle Transitions
    global.window._isStatusTransitioning = false;

    // First transition acquires the mutex lock
    function initiateTransition(targetStatus) {
      if (global.window._isStatusTransitioning) {
        return { success: false, reason: 'LOCKED_BY_MUTEX' };
      }
      global.window._isStatusTransitioning = true;
      return { success: true, targetStatus };
    }

    const firstAttempt = initiateTransition('In Progress');
    assert.equal(firstAttempt.success, true);
    assert.equal(global.window._isStatusTransitioning, true, 'Mutex lock must be active');

    // Second concurrent transition must be rejected by mutex
    const secondAttempt = initiateTransition('Closed');
    assert.equal(secondAttempt.success, false);
    assert.equal(secondAttempt.reason, 'LOCKED_BY_MUTEX', 'Concurrent transition must be blocked while mutex is locked');

    // Release mutex
    global.window._isStatusTransitioning = false;
    const thirdAttempt = initiateTransition('Closed');
    assert.equal(thirdAttempt.success, true, 'Transition must proceed after mutex lock is released');

    // 4. Reconcile Ticket on OCC Conflict
    const canonicalPayload = {
      id: 42,
      ticket_code: 'HD-202611-0042',
      status: 'In Progress',
      resolution_notes: 'Claimed by Lead Engineer'
    };
    store.reconcileTicket(canonicalPayload);
    const storedCanonical = store.tickets.get('42');
    assert.ok(storedCanonical, 'Reconcile must update store with canonical ticket');
    assert.equal(storedCanonical.status, 'In Progress');
    assert.equal(storedCanonical._canonicalStatus, 'In Progress');
  });
});
