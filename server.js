const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');
const { getDatabase } = require('./src/db/database');
const ticketsRouter = require('./src/routes/tickets');
const dashboardRouter = require('./src/routes/dashboard');
const attachmentsRouter = require('./src/routes/attachments');
const errorHandler = require('./src/middleware/errorHandler');

const app = express();

// Ensure storage directories exist
if (!fs.existsSync(config.UPLOADS_DIR)) {
  fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
}
const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Global middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/tickets', ticketsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', attachmentsRouter);

// Fallback for SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Centralized error handling
app.use(errorHandler);

// If run directly via node server.js
if (require.main === module) {
  // Initialize database
  getDatabase();

  const server = app.listen(config.PORT, () => {
    console.log(`[IT HelpDesk System] Server running on port ${config.PORT}`);
    console.log(`[IT HelpDesk System] Web UI: http://localhost:${config.PORT}`);
  });

  const shutdown = () => {
    console.log('\n[IT HelpDesk System] Gracefully shutting down...');
    server.close(() => {
      try {
        const db = getDatabase();
        db.close();
      } catch (e) {}
      console.log('[IT HelpDesk System] Shutdown complete.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;

