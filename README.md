# IT HelpDesk Ticket System

A production-ready, full-stack IT HelpDesk Ticket Management System built with Node.js, Express, Turso Cloud Database (`@libsql/client`) with local SQLite fallback, in-memory image attachments with database BLOB persistence, Vercel serverless deployment support, and a modern responsive English Single Page Application (SPA).

## Features

### 1. Support Ticket Lifecycle Management (R1)
- Submit tickets with Title, Description, Priority (`Low`, `Medium`, `High`, `Critical`), Category (`Hardware`, `Software`, `Network`, `Access`, `Other`), and Requester Info.
- Lossless image attachments (PNG, JPEG, GIF, WEBP up to 4MB, up to 5 files) with drag-and-drop preview.
- In-memory upload processing (`multer.memoryStorage()`) with magic-byte header inspection.
- Database-backed binary `BLOB` persistence (`attachments.file_data`) ensuring attachments survive serverless container restarts.
- Auto-generated sequential ticket codes (e.g. `HD-202611-0001`).
- Enforced state machine lifecycle transitions:
  - `Open` -> `In Progress`, `Pending`, `Closed`
  - `Pending` -> `In Progress`, `Open`, `Closed`
  - `In Progress` -> `Resolved` (mandatory resolution notes), `Pending`, `Open`
  - `Resolved` -> `Closed`, `In Progress` (reopen)
  - `Closed` -> `Open` (reopen)
- Full audit history tracking transitions, timestamps, and operator notes.

### 2. Turso Cloud & Local Fallback Database (R1)
- **Cloud Mode**: Connects to Turso cloud via `@libsql/client` using `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
- **Local Fallback Mode**: Gracefully runs locally against SQLite when cloud credentials are not supplied.
- Unified async database adapter with BigInt safe serialization, transaction rollbacks, and multi-statement schema migrations.

### 3. Vercel Serverless Function Ready (R3)
- Serverless entrypoint (`api/index.js`) and `vercel.json` rewrites.
- Read-only filesystem resilience (guarded cold starts without `EROFS`).
- Step-by-step deployment guide in [DEPLOYMENT.md](DEPLOYMENT.md).

### 4. Analytics Dashboard
- Real-time KPI Metric cards:
  - Total Tickets
  - Pending / Backlog
  - In Progress
  - Resolved / Closed
  - Resolution Rate (%)
- Status, Priority, and Category distribution visual breakdowns with progress bars.
- Temporal filtering by Year and Month using strict half-open UTC intervals (`[start, end)`), preventing leap day (Feb 29) and month-boundary anomalies.
- Guaranteed 100% count and status parity between dashboard KPIs and underlying ticket records.
- Concurrent aggregation queries via `Promise.all` for low-latency cloud execution.

### 5. Localization & Language
- 100% natural English language across all user interfaces, labels, forms, buttons, toasts, tooltips, and API error responses.

### 6. Comprehensive 6-Tier Automated Test Suite (R4)
- 100% pass rate across 29 tests in under 1 second via `npm test`.
- Zero external test runner dependencies (uses Node.js native `node:test` and `node:assert/strict`).
- Isolated test servers, in-memory simulation, container recycle verification, and payload boundary checks.

## Prerequisites

- **Node.js**: `v24.x` (or newer)
- **npm**: `11.x` (or newer)

## Installation & Startup

```bash
# Install dependencies
npm install

# (Optional) Provision remote schema on Turso Cloud
npm run db:init

# Start the application server locally
npm start
```

Access the Web Portal at: `http://localhost:3000`

## Automated Test Execution

Run the complete 6-tier test suite:

```bash
npm test
```

### Test Tiers Overview
- **Tier 1 (Feature Coverage)**: Ticket creation with PNG image attachment, image retrieval & binary hash integrity, detail view, lifecycle transitions, dashboard metrics.
- **Tier 2 (Boundary & Corner Cases)**: Field validation, disallowed extensions (.exe), zero-byte files, spoofed headers, illegal status transitions, missing resolution notes, leap days (Feb 29), zero-ticket division by zero.
- **Tier 3 (Cross-Feature Combinations)**: Multi-month / multi-year cohort isolation, strict parity between ticket list and dashboard counts, real-time KPI updates.
- **Tier 4 (Real-World E2E Workflows)**: End-to-end IT support workflow covering submission, triage, investigation, resolution, closure, audit history, and dashboard verification.
- **Tier 5 (Database Adapter & Fallback Integrity)**: Local fallback initialization, async CRUD, BigInt number casting, transaction rollback atomicity, multi-statement DDL.
- **Tier 6 (Serverless Entrypoint & Persistent Storage)**: `api/index.js` export, simulated container recycle with 100% SHA-256 byte parity, multi-instance concurrency, and 4MB payload limits.

## Deployment to Vercel

See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions on provisioning Turso and deploying to Vercel.

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

