# Deployment Guide: Vercel & Turso Cloud Migration

This document provides complete, step-by-step instructions for deploying the **IT HelpDesk Ticket System** to [Vercel](https://vercel.com/) with a production [Turso](https://turso.tech/) cloud database (`@libsql/client`), as well as local fallback execution.

---

## 1. Architecture Overview

- **Frontend**: Static single-page application served via Vercel Edge CDN from `/public`.
- **Backend API**: Express application wrapped as a Vercel Serverless Function entrypoint (`api/index.js`), configured via `vercel.json` rewrites (`/api/(.*)` -> `/api/index.js`).
- **Database**: Turso Cloud LibSQL database (`@libsql/client`), with zero-config local SQLite fallback when Turso credentials are not configured.
- **Image Attachments**: Persisted directly into the database as binary `BLOB`s (`attachments.file_data`) via `multer.memoryStorage()`, ensuring 100% SHA-256 byte parity across serverless container restarts without depending on local disk persistence.

---

## 2. Step 1: Provision a Turso Cloud Database

### 2.1 Install the Turso CLI
```bash
# macOS / Linux
curl -sSfL https://get.tur.so/install.sh | bash

# Windows (PowerShell)
irm https://get.tur.so/install.ps1 | iex
```

### 2.2 Authenticate & Create Database
```bash
# Login or sign up with Turso
turso auth login

# Create a new database for the IT HelpDesk system
turso db create helpdesk-db

# Retrieve the database connection URL
turso db show helpdesk-db --url
# Example output: libsql://helpdesk-db-yourusername.turso.io

# Create a permanent authentication token
turso db tokens create helpdesk-db
# Example output: eyJhbGciOiJFZERTQ...
```

### 2.3 Initialize the Database Schema
You can initialize the remote database schema using the project's built-in CLI provisioning script:
```bash
# Set your environment variables in your terminal or .env
export TURSO_DATABASE_URL="libsql://helpdesk-db-yourusername.turso.io"
export TURSO_AUTH_TOKEN="eyJhbGciOiJFZERTQ..."

# Run database schema initialization
npm run db:init
```

---

## 3. Step 2: Deploy to Vercel

### Method A: Deploy via Vercel CLI (Recommended)

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy from project directory**:
   ```bash
   cd c:\Users\ITPC\Downloads\Ticket_For_IT_HelpDesk
   vercel
   ```

4. **Add Environment Variables to Vercel**:
   ```bash
   vercel env add TURSO_DATABASE_URL production
   # Enter value: libsql://helpdesk-db-yourusername.turso.io

   vercel env add TURSO_AUTH_TOKEN production
   # Enter value: <your-turso-token>
   ```

5. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

---

### Method B: Deploy via Vercel Web Dashboard (GitHub Integration)

1. Push your repository to GitHub:
   ```bash
   git push origin main
   ```
2. Navigate to [vercel.com/new](https://vercel.com/new).
3. Import the repository: `HSL-2003/Ticket_For_IT_HelpDesk`.
4. In the **Configure Project** screen:
   - **Framework Preset**: Select `Other` (or leave default).
   - **Root Directory**: `./`
   - **Build Command**: Leave empty (no build step required for plain Node.js / Express).
   - **Output Directory**: Leave empty.
5. In **Environment Variables**, add:
   - `TURSO_DATABASE_URL`: `libsql://helpdesk-db-yourusername.turso.io`
   - `TURSO_AUTH_TOKEN`: `<your-turso-auth-token>`
6. Click **Deploy**.
7. Once deployed, Vercel will provide your production domain (e.g., `https://ticket-for-it-helpdesk.vercel.app`).

---

## 4. Verification & Testing

### 4.1 Production Verification Checklist
- [ ] Visit `https://<your-project>.vercel.app/` — English UI loads instantly.
- [ ] Visit `https://<your-project>.vercel.app/api/health` — Returns `{"status":"OK", "timestamp":"..."}`.
- [ ] Submit a ticket with title, description, category, priority, and screenshot image attachment.
- [ ] Verify the ticket appears in the Ticket List and the image displays properly in the preview modal.
- [ ] Download the image from the attachment menu and verify that the file opens intact.
- [ ] Transition ticket lifecycle: `Open` -> `In Progress` -> `Resolved` (with notes) -> `Closed`.
- [ ] Verify that Dashboard metrics (`/api/dashboard/metrics`) update in real time.

### 4.2 Local Offline Execution (Fallback Mode)
When running locally without Turso credentials:
```bash
# Ensure TURSO_DATABASE_URL is not set
npm start
```
The application will automatically initialize the local SQLite database at `./data/helpdesk.db` and run seamlessly with full attachment BLOB persistence.

### 4.3 Automated Test Suite
To verify the entire system across all 6 test tiers:
```bash
npm test
```
All 29 tests across happy paths, boundaries, cross-feature parity, E2E workflows, database fallback, and serverless persistence will run and pass in under 1 second.
