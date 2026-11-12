const { getDatabase } = require('../db/database');
const cache = require('../cache/memoryCache');

const VALID_STATUSES = ['Open', 'Pending', 'In Progress', 'Resolved', 'Closed'];
const VALID_CATEGORIES = ['Hardware', 'Software', 'Network', 'Access', 'Other'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

// Allowed state transitions
const ALLOWED_TRANSITIONS = {
  'Open': ['In Progress', 'Pending', 'Closed'],
  'Pending': ['In Progress', 'Open', 'Closed'],
  'In Progress': ['Resolved', 'Pending', 'Open'],
  'Resolved': ['Closed', 'In Progress'],
  'Closed': ['Open']
};

/**
 * Generate sequential ticket code: HD-YYYYMM-XXXX
 */
async function generateTicketCode(db, date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `HD-${year}${month}-`;

  const lastTicket = await db.get(
    'SELECT ticket_code FROM tickets WHERE ticket_code LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}%`]
  );

  let nextSeq = 1;
  if (lastTicket && lastTicket.ticket_code) {
    const parts = lastTicket.ticket_code.split('-');
    if (parts.length === 3) {
      const parsed = parseInt(parts[2], 10);
      if (!isNaN(parsed)) {
        nextSeq = parsed + 1;
      }
    }
  }

  const seqStr = String(nextSeq).padStart(4, '0');
  return `${prefix}${seqStr}`;
}

/**
 * Validate ticket creation input
 */
function validateTicketInput({ title, description, category, priority }) {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    const err = new Error('Ticket title is required.');
    err.status = 400;
    throw err;
  }
  if (title.trim().length < 3) {
    const err = new Error('Ticket title must be at least 3 characters long.');
    err.status = 400;
    throw err;
  }
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    const err = new Error('Ticket description is required.');
    err.status = 400;
    throw err;
  }
  if (description.trim().length < 5) {
    const err = new Error('Ticket description must be at least 5 characters long.');
    err.status = 400;
    throw err;
  }
  if (category && !VALID_CATEGORIES.includes(category)) {
    const err = new Error(`Invalid category "${category}". Allowed: ${VALID_CATEGORIES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    const err = new Error(`Invalid priority "${priority}". Allowed: ${VALID_PRIORITIES.join(', ')}`);
    err.status = 400;
    throw err;
  }
}

/**
 * Format attachment URLs for client (omitting binary file_data)
 */
function formatAttachments(attachments, ticketId) {
  if (!attachments) return [];
  return attachments.map((att) => ({
    id: att.id,
    ticket_id: att.ticket_id,
    stored_filename: att.stored_filename,
    original_filename: att.original_filename,
    mime_type: att.mime_type,
    file_size: att.file_size,
    created_at: att.created_at,
    url: `/api/tickets/${ticketId || att.ticket_id}/attachments/${att.id}/view`,
    download_url: `/api/tickets/${ticketId || att.ticket_id}/attachments/${att.id}/download`
  }));
}

/**
 * Create a new ticket
 */
async function createTicket(ticketData, uploadedFiles = [], customDb = null) {
  const db = customDb || getDatabase();
  validateTicketInput(ticketData);

  const title = ticketData.title.trim();
  const description = ticketData.description.trim();
  const category = ticketData.category || 'Software';
  const priority = ticketData.priority || 'Medium';
  const requester_name = (ticketData.requester_name && ticketData.requester_name.trim()) || 'IT User';
  const requester_email = (ticketData.requester_email && ticketData.requester_email.trim()) || 'user@company.internal';

  const now = (ticketData.created_at && new Date(ticketData.created_at).toISOString()) || new Date().toISOString();
  const dateObj = new Date(now);

  const createdTicket = await db.transaction(async (tx) => {
    const ticketCode = await generateTicketCode(tx, dateObj);

    const insertResult = await tx.run(
      `INSERT INTO tickets (
        ticket_code, title, description, category, priority, status,
        requester_name, requester_email, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`,
      [ticketCode, title, description, category, priority, requester_name, requester_email, now, now]
    );

    const ticketId = insertResult.lastInsertRowid;

    // Insert attachments into DB including file_data BLOB
    const savedAttachments = [];
    if (uploadedFiles && uploadedFiles.length > 0) {
      for (const file of uploadedFiles) {
        const storedName = file.filename;
        const originalName = file.originalname;
        const mimeType = file.detectedMime || file.mimetype || 'image/png';
        const fileSize = file.size;
        const fileData = file.buffer || null;

        const attResult = await tx.run(
          `INSERT INTO attachments (ticket_id, stored_filename, original_filename, mime_type, file_size, file_data, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [ticketId, storedName, originalName, mimeType, fileSize, fileData, now]
        );

        savedAttachments.push({
          id: attResult.lastInsertRowid,
          ticket_id: ticketId,
          stored_filename: storedName,
          original_filename: originalName,
          mime_type: mimeType,
          file_size: fileSize,
          created_at: now
        });
      }
    }

    // Insert initial history
    await tx.run(
      `INSERT INTO ticket_history (ticket_id, from_status, to_status, notes, changed_by, created_at)
       VALUES (?, NULL, 'Open', 'Ticket created', ?, ?)`,
      [ticketId, requester_name, now]
    );

    const ticket = await tx.get('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    ticket.attachments = formatAttachments(savedAttachments, ticketId);
    ticket.history = await tx.query(
      'SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY created_at ASC',
      [ticketId]
    );

    return ticket;
  });

  // Invalidate list and dashboard metrics caches on new ticket creation
  cache.invalidatePrefix('tickets:list');
  cache.invalidatePrefix('dashboard:metrics');

  return createdTicket;
}

/**
 * Retrieve ticket by ID or ticket_code (excluding file_data BLOB from attachments)
 * Batches ticket, attachments, and history into a single round-trip and caches for 60s.
 */
async function getTicketById(idOrCode, customDb = null) {
  const cacheKey = `tickets:detail:${idOrCode}`;
  if (!customDb) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const fetchStartTime = Date.now();
  const db = customDb || getDatabase();
  const isNumeric = typeof idOrCode === 'number' || /^\d+$/.test(String(idOrCode));

  let ticket = null;
  let rawAttachments = [];
  let rawHistory = [];

  if (typeof db.batch === 'function') {
    let statements;
    if (isNumeric) {
      const numId = Number(idOrCode);
      statements = [
        { sql: 'SELECT * FROM tickets WHERE id = ?', args: [numId] },
        { sql: 'SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, created_at FROM attachments WHERE ticket_id = ? ORDER BY id ASC', args: [numId] },
        { sql: 'SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY created_at ASC', args: [numId] }
      ];
    } else {
      const codeStr = String(idOrCode);
      statements = [
        { sql: 'SELECT * FROM tickets WHERE ticket_code = ?', args: [codeStr] },
        { sql: 'SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, created_at FROM attachments WHERE ticket_id = (SELECT id FROM tickets WHERE ticket_code = ?) ORDER BY id ASC', args: [codeStr] },
        { sql: 'SELECT * FROM ticket_history WHERE ticket_id = (SELECT id FROM tickets WHERE ticket_code = ?) ORDER BY created_at ASC', args: [codeStr] }
      ];
    }

    const results = await db.batch(statements, 'read');
    ticket = results[0].rows[0] || null;

    if (!ticket) {
      const err = new Error(`Ticket not found: "${idOrCode}".`);
      err.status = 404;
      throw err;
    }

    rawAttachments = Array.from(results[1].rows);
    rawHistory = Array.from(results[2].rows);
  } else {
    if (isNumeric) {
      ticket = await db.get('SELECT * FROM tickets WHERE id = ?', [Number(idOrCode)]);
    } else {
      ticket = await db.get('SELECT * FROM tickets WHERE ticket_code = ?', [String(idOrCode)]);
    }

    if (!ticket) {
      const err = new Error(`Ticket not found: "${idOrCode}".`);
      err.status = 404;
      throw err;
    }

    rawAttachments = await db.query(
      'SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, created_at FROM attachments WHERE ticket_id = ? ORDER BY id ASC',
      [ticket.id]
    );
    rawHistory = await db.query(
      'SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY created_at ASC',
      [ticket.id]
    );
  }

  ticket.attachments = formatAttachments(rawAttachments, ticket.id);
  ticket.history = rawHistory;

  if (!customDb) {
    cache.set(cacheKey, ticket, 60, fetchStartTime);
    cache.set(`tickets:detail:${ticket.id}`, ticket, 60, fetchStartTime);
    if (ticket.ticket_code) {
      cache.set(`tickets:detail:${ticket.ticket_code}`, ticket, 60, fetchStartTime);
    }
  }

  return ticket;
}

/**
 * List tickets with flexible filtering, batch-fetching attachments without N+1 overhead
 * Batches count, tickets, and attachments into a single round-trip and caches for 15s.
 */
async function listTickets(filters = {}, customDb = null) {
  const cacheKey = `tickets:list:${JSON.stringify(filters)}`;
  if (!customDb) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const fetchStartTime = Date.now();
  const db = customDb || getDatabase();
  const conditions = [];
  const params = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  if (filters.category) {
    conditions.push('category = ?');
    params.push(filters.category);
  }

  if (filters.priority) {
    conditions.push('priority = ?');
    params.push(filters.priority);
  }

  // Temporal filtering (UTC)
  if (filters.year) {
    const yr = parseInt(filters.year, 10);
    if (!isNaN(yr)) {
      if (filters.month) {
        const mo = parseInt(filters.month, 10);
        if (!isNaN(mo) && mo >= 1 && mo <= 12) {
          const startDate = new Date(Date.UTC(yr, mo - 1, 1)).toISOString();
          const endDate = new Date(Date.UTC(yr, mo, 1)).toISOString();
          conditions.push('created_at >= ? AND created_at < ?');
          params.push(startDate, endDate);
        }
      } else {
        const startDate = new Date(Date.UTC(yr, 0, 1)).toISOString();
        const endDate = new Date(Date.UTC(yr + 1, 0, 1)).toISOString();
        conditions.push('created_at >= ? AND created_at < ?');
        params.push(startDate, endDate);
      }
    }
  }

  if (filters.search && filters.search.trim()) {
    const searchParam = `%${filters.search.trim()}%`;
    conditions.push('(ticket_code LIKE ? OR title LIKE ? OR description LIKE ?)');
    params.push(searchParam, searchParam, searchParam);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let limitClause = '';
  const queryParams = [...params];

  if (filters.limit) {
    const limit = parseInt(filters.limit, 10);
    limitClause += ' LIMIT ?';
    queryParams.push(limit);

    if (filters.offset) {
      const offset = parseInt(filters.offset, 10);
      limitClause += ' OFFSET ?';
      queryParams.push(offset);
    }
  }

  let total = 0;
  let tickets = [];
  let allAttachments = [];

  if (typeof db.batch === 'function') {
    const attachmentSql = limitClause
      ? `SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, created_at
         FROM attachments
         WHERE ticket_id IN (SELECT id FROM (SELECT id FROM tickets ${whereClause} ORDER BY created_at DESC ${limitClause}))
         ORDER BY id ASC`
      : `SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, created_at
         FROM attachments
         WHERE ticket_id IN (SELECT id FROM tickets ${whereClause})
         ORDER BY id ASC`;

    const attachmentArgs = limitClause ? queryParams : params;

    const results = await db.batch([
      { sql: `SELECT COUNT(*) as total FROM tickets ${whereClause}`, args: params },
      { sql: `SELECT * FROM tickets ${whereClause} ORDER BY created_at DESC ${limitClause}`, args: queryParams },
      { sql: attachmentSql, args: attachmentArgs }
    ], 'read');

    const totalCountRow = results[0].rows[0];
    total = totalCountRow ? totalCountRow.total : 0;
    tickets = Array.from(results[1].rows);
    allAttachments = Array.from(results[2].rows);
  } else {
    const totalCountRow = await db.get(
      `SELECT COUNT(*) as total FROM tickets ${whereClause}`,
      params
    );
    total = totalCountRow ? totalCountRow.total : 0;

    let query = `SELECT * FROM tickets ${whereClause} ORDER BY created_at DESC ${limitClause}`;
    tickets = await db.query(query, queryParams);

    if (tickets.length > 0) {
      const ticketIds = tickets.map((t) => t.id);
      const placeholders = ticketIds.map(() => '?').join(',');
      allAttachments = await db.query(
        `SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, created_at
         FROM attachments
         WHERE ticket_id IN (${placeholders})
         ORDER BY id ASC`,
        ticketIds
      );
    }
  }

  const attachmentsByTicket = new Map();
  for (const att of allAttachments) {
    if (!attachmentsByTicket.has(att.ticket_id)) {
      attachmentsByTicket.set(att.ticket_id, []);
    }
    attachmentsByTicket.get(att.ticket_id).push(att);
  }

  for (const t of tickets) {
    t.attachments = formatAttachments(attachmentsByTicket.get(t.id) || [], t.id);
  }

  const result = {
    total,
    tickets
  };

  if (!customDb) {
    cache.set(cacheKey, result, 15, fetchStartTime);
  }

  return result;
}

/**
 * Update ticket status according to lifecycle state machine
 * Implements atomic OCC-guarded batching with phantom history protection.
 */
async function updateTicketStatus(ticketId, { expected_status, status: newStatus, notes, changed_by } = {}, customDb = null) {
  const db = customDb || getDatabase();

  if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
    const err = new Error(`Invalid status "${newStatus}". Allowed: ${VALID_STATUSES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  // Transition to Resolved requires resolution notes
  if (newStatus === 'Resolved') {
    const resNotes = notes ? notes.trim() : '';
    if (!resNotes || resNotes.length === 0) {
      const err = new Error('Resolution notes are required when resolving a ticket.');
      err.status = 400;
      throw err;
    }
  }

  let numericTicketId = (typeof ticketId === 'number' || /^\d+$/.test(String(ticketId)))
    ? Number(ticketId)
    : null;

  let currentStatus = expected_status;

  // Backward compatibility: If expected_status was omitted or ticketId is not numeric, look up current state
  let currentTicket = null;
  if (!currentStatus || numericTicketId === null) {
    currentTicket = await getTicketById(ticketId, db);
    numericTicketId = currentTicket.id;
    if (!currentStatus) {
      currentStatus = currentTicket.status;
    }
  }

  if (currentStatus === newStatus) {
    return currentTicket || await getTicketById(numericTicketId, db);
  }

  const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowedNext.includes(newStatus)) {
    const err = new Error(
      `Invalid status transition from "${currentStatus}" to "${newStatus}". Allowed transitions: ${allowedNext.length > 0 ? allowedNext.join(', ') : 'None'}.`
    );
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const operator = (changed_by && changed_by.trim()) || 'IT Support';
  const resolutionNotes = (notes && notes.trim()) ? notes.trim() : null;

  if (typeof db.batch === 'function') {
    // 5-statement atomic batch execution with phantom history protection
    const batchStatements = [
      {
        sql: `UPDATE tickets
              SET status = ?,
                  resolution_notes = CASE WHEN ? = 'Resolved' THEN ? ELSE resolution_notes END,
                  resolved_at = CASE WHEN ? = 'Resolved' THEN ? WHEN ? = 'Open' THEN NULL ELSE resolved_at END,
                  closed_at = CASE WHEN ? = 'Closed' THEN ? WHEN ? IN ('Open', 'In Progress') THEN NULL ELSE closed_at END,
                  updated_at = ?
              WHERE id = ? AND status = ?`,
        args: [
          newStatus,
          newStatus, resolutionNotes,
          newStatus, now, newStatus,
          newStatus, now, newStatus,
          now,
          numericTicketId,
          currentStatus
        ]
      },
      {
        sql: `INSERT INTO ticket_history (ticket_id, from_status, to_status, notes, changed_by, created_at)
              SELECT ?, ?, ?, ?, ?, ?
              WHERE (SELECT changes()) > 0`,
        args: [numericTicketId, currentStatus, newStatus, resolutionNotes, operator, now]
      },
      {
        sql: 'SELECT * FROM tickets WHERE id = ?',
        args: [numericTicketId]
      },
      {
        sql: 'SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, created_at FROM attachments WHERE ticket_id = ? ORDER BY id ASC',
        args: [numericTicketId]
      },
      {
        sql: 'SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY created_at ASC',
        args: [numericTicketId]
      }
    ];

    const results = await db.batch(batchStatements, 'write');

    // OCC Conflict check: If rowsAffected is 0, update failed due to concurrent modification
    const rowsAffected = Number(results[0].rowsAffected || 0);
    if (rowsAffected === 0) {
      const canonicalTicket = results[2].rows[0] || null;
      if (canonicalTicket) {
        canonicalTicket.attachments = formatAttachments(Array.from(results[3].rows), canonicalTicket.id);
        canonicalTicket.history = Array.from(results[4].rows);
      }
      cache.invalidate(`tickets:detail:${numericTicketId}`);
      cache.invalidate(`tickets:detail:${ticketId}`);
      const conflictError = new Error('Conflict: Ticket status was modified concurrently by another operator.');
      conflictError.status = 409;
      conflictError.canonicalTicket = canonicalTicket;
      throw conflictError;
    }

    const updatedTicket = results[2].rows[0];
    updatedTicket.attachments = formatAttachments(Array.from(results[3].rows), updatedTicket.id);
    updatedTicket.history = Array.from(results[4].rows);

    // Invalidate caches
    cache.invalidatePrefix('tickets:list');
    cache.invalidatePrefix('dashboard:metrics');
    cache.invalidate(`tickets:detail:${numericTicketId}`);
    cache.invalidate(`tickets:detail:${ticketId}`);
    if (updatedTicket.ticket_code) {
      cache.invalidate(`tickets:detail:${updatedTicket.ticket_code}`);
    }

    return updatedTicket;
  } else {
    // Transactional fallback if db does not support batch
    const ticketObj = currentTicket || await getTicketById(numericTicketId, db);
    return await db.transaction(async (tx) => {
      let resolvedAt = ticketObj.resolved_at;
      let closedAt = ticketObj.closed_at;
      let resNotes = ticketObj.resolution_notes;

      if (newStatus === 'Resolved') {
        resolvedAt = now;
        resNotes = resolutionNotes || resNotes;
      } else if (newStatus === 'Closed') {
        closedAt = now;
      } else if (newStatus === 'Open' || newStatus === 'In Progress') {
        if (currentStatus === 'Closed') {
          closedAt = null;
        }
      }

      await tx.run(
        `UPDATE tickets
         SET status = ?, resolution_notes = ?, resolved_at = ?, closed_at = ?, updated_at = ?
         WHERE id = ?`,
        [newStatus, resNotes, resolvedAt, closedAt, now, ticketObj.id]
      );

      await tx.run(
        `INSERT INTO ticket_history (ticket_id, from_status, to_status, notes, changed_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ticketObj.id, currentStatus, newStatus, resolutionNotes, operator, now]
      );

      const updated = await getTicketById(ticketObj.id, tx);

      // Invalidate caches
      cache.invalidatePrefix('tickets:list');
      cache.invalidatePrefix('dashboard:metrics');
      cache.invalidate(`tickets:detail:${ticketObj.id}`);
      cache.invalidate(`tickets:detail:${ticketId}`);
      if (ticketObj.ticket_code) {
        cache.invalidate(`tickets:detail:${ticketObj.ticket_code}`);
      }

      return updated;
    });
  }
}

/**
 * Add attachments to an existing ticket (asynchronous decoupled upload)
 */
async function addAttachments(ticketId, uploadedFiles = [], customDb = null) {
  const db = customDb || getDatabase();
  const ticket = await getTicketById(ticketId, db);

  if (!uploadedFiles || uploadedFiles.length === 0) {
    const err = new Error('No files provided for attachment.');
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const savedAttachments = [];

  for (const file of uploadedFiles) {
    const storedName = file.filename;
    const originalName = file.originalname;
    const mimeType = file.detectedMime || file.mimetype || 'image/png';
    const fileSize = file.size;
    const fileData = file.buffer || null;

    const attResult = await db.run(
      `INSERT INTO attachments (ticket_id, stored_filename, original_filename, mime_type, file_size, file_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticket.id, storedName, originalName, mimeType, fileSize, fileData, now]
    );

    savedAttachments.push({
      id: attResult.lastInsertRowid,
      ticket_id: ticket.id,
      stored_filename: storedName,
      original_filename: originalName,
      mime_type: mimeType,
      file_size: fileSize,
      created_at: now
    });
  }

  await db.run(
    `INSERT INTO ticket_history (ticket_id, from_status, to_status, notes, changed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ticket.id, ticket.status, ticket.status, `Added ${uploadedFiles.length} attachment(s)`, 'IT Support', now]
  );

  // Invalidate caches
  cache.invalidate(`tickets:detail:${ticket.id}`);
  if (ticket.ticket_code) {
    cache.invalidate(`tickets:detail:${ticket.ticket_code}`);
  }
  cache.invalidatePrefix('tickets:list');

  return formatAttachments(savedAttachments, ticket.id);
}

/**
 * Get attachment by ID (including file_data BLOB for streaming)
 */
async function getAttachment(ticketId, attachmentId, customDb = null) {
  const db = customDb || getDatabase();
  const att = await db.get(
    'SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, file_data, created_at FROM attachments WHERE id = ? AND ticket_id = ?',
    [Number(attachmentId), Number(ticketId)]
  );

  if (!att) {
    const err = new Error(`Attachment ${attachmentId} not found for ticket ${ticketId}.`);
    err.status = 404;
    throw err;
  }

  return att;
}

module.exports = {
  createTicket,
  getTicketById,
  listTickets,
  updateTicketStatus,
  getAttachment,
  addAttachments,
  VALID_STATUSES,
  VALID_CATEGORIES,
  VALID_PRIORITIES,
  ALLOWED_TRANSITIONS
};
