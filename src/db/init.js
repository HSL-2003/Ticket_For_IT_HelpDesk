require('dotenv').config();
const { getDatabase } = require('./database');

async function init() {
  console.log('[IT HelpDesk DB Init] Initializing database schema...');
  const db = getDatabase();
  await db.initSchema();
  console.log('[IT HelpDesk DB Init] Database schema initialized successfully.');
  await db.close();
}

if (require.main === module) {
  init().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('[IT HelpDesk DB Init] Error initializing database schema:', err);
    process.exit(1);
  });
}

module.exports = { init };
