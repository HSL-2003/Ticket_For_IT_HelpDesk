const express = require('express');
const router = express.Router();
const path = require('node:path');
const fs = require('node:fs');
const ticketService = require('../services/ticketService');
const config = require('../../config');

function serveAttachmentFile(res, attachment, isDownload = false) {
  res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
  const disposition = isDownload ? 'attachment' : 'inline';
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${encodeURIComponent(attachment.original_filename)}"`
  );

  // 1. Serve directly from database-backed binary BLOB
  if (attachment.file_data) {
    const buffer = Buffer.from(attachment.file_data);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  }

  // 2. Fallback for legacy files stored on local disk
  const filePath = path.join(config.UPLOADS_DIR, attachment.stored_filename);
  const resolvedPath = path.resolve(filePath);
  const uploadsDirResolved = path.resolve(config.UPLOADS_DIR);

  if (!resolvedPath.startsWith(uploadsDirResolved)) {
    return res.status(403).json({ error: 'Access denied: invalid file path.' });
  }

  if (fs.existsSync(resolvedPath)) {
    return fs.createReadStream(resolvedPath).pipe(res);
  }

  return res.status(404).json({ error: 'Attachment file not found.' });
}

// GET /api/tickets/:ticketId/attachments/:id/view - View attachment inline
router.get('/tickets/:ticketId/attachments/:id/view', async (req, res, next) => {
  try {
    const attachment = await ticketService.getAttachment(req.params.ticketId, req.params.id);
    serveAttachmentFile(res, attachment, false);
  } catch (err) {
    next(err);
  }
});

// GET /api/tickets/:ticketId/attachments/:id/download - Download attachment
router.get('/tickets/:ticketId/attachments/:id/download', async (req, res, next) => {
  try {
    const attachment = await ticketService.getAttachment(req.params.ticketId, req.params.id);
    serveAttachmentFile(res, attachment, true);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
