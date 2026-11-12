const { getDatabase } = require('../db/database');

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

  return await db.transaction(async (tx) => {
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
}

/**
 * Retrieve ticket by ID or ticket_code (excluding file_data BLOB from attachments)
 */
async function getTicketById(idOrCode, customDb = null) {
  const db = customDb || getDatabase();
  let ticket = null;

  if (typeof idOrCode === 'number' || /^\d+$/.test(String(idOrCode))) {
    ticket = await db.get('SELECT * FROM tickets WHERE id = ?', [Number(idOrCode)]);
  } else {
    ticket = await db.get('SELECT * FROM tickets WHERE ticket_code = ?', [String(idOrCode)]);
  }

  if (!ticket) {
    const err = new Error(`Ticket not found: "${idOrCode}".`);
    err.status = 404;
    throw err;
  }

  const rawAttachments = await db.query(
    'SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, created_at FROM attachments WHERE ticket_id = ? ORDER BY id ASC',
    [ticket.id]
  );
  ticket.attachments = formatAttachments(rawAttachments, ticket.id);

  ticket.history = await db.query(
    'SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY created_at ASC',
    [ticket.id]
  );

  return ticket;
}

/**
 * List tickets with flexible filtering, batch-fetching attachments without N+1 overhead
 */
async function listTickets(filters = {}, customDb = null) {
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

  const totalCountRow = await db.get(
    `SELECT COUNT(*) as total FROM tickets ${whereClause}`,
    params
  );
  const total = totalCountRow ? totalCountRow.total : 0;

  let query = `SELECT * FROM tickets ${whereClause} ORDER BY created_at DESC`;
  const queryParams = [...params];

  if (filters.limit) {
    const limit = parseInt(filters.limit, 10);
    query += ' LIMIT ?';
    queryParams.push(limit);

    if (filters.offset) {
      const offset = parseInt(filters.offset, 10);
      query += ' OFFSET ?';
      queryParams.push(offset);
    }
  }

  const tickets = await db.query(query, queryParams);

  // Eliminate N+1: batch-fetch attachments for all retrieved tickets
  if (tickets.length > 0) {
    const ticketIds = tickets.map((t) => t.id);
    const placeholders = ticketIds.map(() => '?').join(',');
    const allAttachments = await db.query(
      `SELECT id, ticket_id, stored_filename, original_filename, mime_type, file_size, created_at
       FROM attachments
       WHERE ticket_id IN (${placeholders})
       ORDER BY id ASC`,
      ticketIds
    );

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
  }

  return {
    total,
    tickets
  };
}

/**
 * Update ticket status according to lifecycle state machine
 */
async function updateTicketStatus(ticketId, { status: newStatus, notes, changed_by }, customDb = null) {
  const db = customDb || getDatabase();

  if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
    const err = new Error(`Invalid status "${newStatus}". Allowed: ${VALID_STATUSES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const ticket = await getTicketById(ticketId, db);
  const currentStatus = ticket.status;

  if (currentStatus === newStatus) {
    return ticket;
  }

  const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowedNext.includes(newStatus)) {
    const err = new Error(
      `Invalid status transition from "${currentStatus}" to "${newStatus}". Allowed transitions: ${allowedNext.length > 0 ? allowedNext.join(', ') : 'None'}.`
    );
    err.status = 400;
    throw err;
  }

  // Transition to Resolved requires resolution notes
  if (newStatus === 'Resolved') {
    const resolutionNotes = notes ? notes.trim() : '';
    if (!resolutionNotes || resolutionNotes.length === 0) {
      const err = new Error('Resolution notes are required when resolving a ticket.');
      err.status = 400;
      throw err;
    }
  }

  const now = new Date().toISOString();
  const operator = (changed_by && changed_by.trim()) || 'IT Support';

  return await db.transaction(async (tx) => {
    let resolvedAt = ticket.resolved_at;
    let closedAt = ticket.closed_at;
    let resolutionNotes = ticket.resolution_notes;

    if (newStatus === 'Resolved') {
      resolvedAt = now;
      resolutionNotes = notes ? notes.trim() : resolutionNotes;
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
      [newStatus, resolutionNotes, resolvedAt, closedAt, now, ticket.id]
    );

    await tx.run(
      `INSERT INTO ticket_history (ticket_id, from_status, to_status, notes, changed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ticket.id, currentStatus, newStatus, notes ? notes.trim() : null, operator, now]
    );

    return await getTicketById(ticket.id, tx);
  });
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
  VALID_STATUSES,
  VALID_CATEGORIES,
  VALID_PRIORITIES,
  ALLOWED_TRANSITIONS
};
