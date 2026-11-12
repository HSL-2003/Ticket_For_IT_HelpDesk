const path = require('node:path');

const config = {
  PORT: process.env.PORT || 3000,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'helpdesk.db'),
  UPLOADS_DIR: process.env.UPLOADS_DIR || path.join(__dirname, 'uploads', 'tickets'),
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB per file
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

