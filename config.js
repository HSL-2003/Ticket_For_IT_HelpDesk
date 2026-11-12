require('dotenv').config();
const path = require('node:path');

const config = {
  PORT: process.env.PORT || 3000,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'helpdesk.db'),
  UPLOADS_DIR: process.env.UPLOADS_DIR || path.join(__dirname, 'uploads', 'tickets'),
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL || '',
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN || '',
  IS_TURSO: Boolean(process.env.TURSO_DATABASE_URL),
  MAX_FILE_SIZE: 4 * 1024 * 1024, // 4MB per file (compliant with Vercel 4.5MB payload limit)
  MAX_FILES: 5,
  ALLOWED_MIME_TYPES: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ],
  ALLOWED_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.gif', '.webp']
};

module.exports = config;

