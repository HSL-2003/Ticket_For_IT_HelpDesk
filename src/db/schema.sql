PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('Hardware', 'Software', 'Network', 'Access', 'Other')),
    priority TEXT NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low', 'Medium', 'High', 'Critical')),
    status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open', 'Pending', 'In Progress', 'Resolved', 'Closed')),
    requester_name TEXT NOT NULL DEFAULT 'IT User',
    requester_email TEXT NOT NULL DEFAULT 'user@company.internal',
    assigned_to TEXT DEFAULT NULL,
    resolution_notes TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT DEFAULT NULL,
    closed_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON tickets(status, created_at);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    stored_filename TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_ticket_id ON attachments(ticket_id);

CREATE TABLE IF NOT EXISTS ticket_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_status TEXT DEFAULT NULL,
    to_status TEXT NOT NULL,
    notes TEXT DEFAULT NULL,
    changed_by TEXT NOT NULL DEFAULT 'System Agent',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket_id ON ticket_history(ticket_id);

