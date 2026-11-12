# IT HelpDesk Ticket System

A production-ready, full-stack IT HelpDesk Ticket Management System built with Node.js, Express, native SQLite (`node:sqlite`), and a modern responsive English Single Page Application (SPA).

## Features

### 1. Support Ticket Lifecycle Management (R1)
- Submit tickets with Title, Description, Priority (`Low`, `Medium`, `High`, `Critical`), Category (`Hardware`, `Software`, `Network`, `Access`, `Other`), and Requester Info.
- Lossless image attachments (PNG, JPEG, GIF, WEBP up to 5MB, up to 5 files) with drag-and-drop preview.
- Magic-byte validation header inspection preventing file spoofing.
- Auto-generated sequential ticket codes (e.g. `HD-202611-0001`).
- Enforced state machine lifecycle transitions:
  - `Open` -> `In Progress`, `Pending`, `Closed`
  - `Pending` -> `In Progress`, `Open`, `Closed`
  - `In Progress` -> `Resolved` (mandatory resolution notes), `Pending`, `Open`
  - `Resolved` -> `Closed`, `In Progress` (reopen)
  - `Closed` -> `Open` (reopen)
- Full audit history tracking transitions, timestamps, and operator notes.

### 2. Analytics Dashboard (R2)
- Real-time KPI Metric cards:
  - Total Tickets
  - Pending / Backlog
  - In Progress
  - Resolved / Closed
  - Resolution Rate (%)
- Status, Priority, and Category distribution visual breakdowns with progress bars.
- Temporal filtering by Year and Month using strict half-open UTC intervals (`[start, end)`), preventing leap day (Feb 29) and month-boundary anomalies.
- Guaranteed 100% count and status parity between dashboard KPIs and underlying ticket records.

### 3. Localization & Language (R3)
- 100% natural English language across all user interfaces, labels, forms, buttons, toasts, tooltips, and API error responses.

### 4. Comprehensive 4-Tier Automated Test Suite (R4)
- Single-command test runner via `npm test` (<1s execution time).
- Zero external test runner dependencies (uses Node.js native `node:test` and `node:assert/strict`).
- Dynamic port binding (`server.listen(0)`) and isolated temporary SQLite databases preventing Windows socket lingering (`EADDRINUSE`).

## Prerequisites

- **Node.js**: `v24.x` (or newer supporting `node:sqlite`)
- **npm**: `11.x` (or newer)

## Installation & Startup

```bash
# Install dependencies
npm install

# Start the application server
npm start
```

Access the Web Portal at: `http://localhost:3000`

## Automated Test Execution

Run the complete 4-tier test suite:

```bash
npm test
```

### Test Tiers Overview
- **Tier 1 (Feature Coverage)**: Ticket creation with PNG image attachment, image retrieval & binary hash integrity, detail view, lifecycle transitions, dashboard metrics.
- **Tier 2 (Boundary & Corner Cases)**: Field validation, disallowed extensions (.exe), zero-byte files, spoofed headers, illegal status transitions, missing resolution notes, leap days (Feb 29), zero-ticket division by zero.
- **Tier 3 (Cross-Feature Combinations)**: Multi-month / multi-year cohort isolation, strict parity between ticket list and dashboard counts, real-time KPI updates.
- **Tier 4 (Real-World E2E Workflows)**: End-to-end IT support workflow covering submission, triage, investigation, resolution, closure, audit history, and dashboard verification.

## API Reference

### Tickets
- `POST /api/tickets` - Create ticket (multipart/form-data or JSON)
- `GET /api/tickets` - List tickets (supports `status`, `category`, `priority`, `year`, `month`, `search`)
- `GET /api/tickets/:id` - Get ticket details with attachments and audit history
- `PATCH /api/tickets/:id/status` - Transition lifecycle status (`{ status, notes, changed_by }`)

### Attachments
- `GET /api/tickets/:ticketId/attachments/:id/view` - Stream image attachment inline
- `GET /api/tickets/:ticketId/attachments/:id/download` - Download image attachment

### Dashboard
- `GET /api/dashboard/metrics` - Aggregated KPI metrics (query params: `year`, `month`)

### System
- `GET /api/health` - Server health check

