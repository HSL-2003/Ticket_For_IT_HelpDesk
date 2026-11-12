const express = require('express');
const router = express.Router();
const path = require('node:path');
const fs = require('node:fs');
const ticketService = require('../services/ticketService');
const config = require('../../config');

function serveAttachmentFile(res, attachment, isDownload = false) {
  const filePath = path.join(config.UPLOADS_DIR, attachment.stored_filename);

  // Path traversal safety check
  const resolvedPath = path.resolve(filePath);
  const uploadsDirResolved = path.resolve(config.UPLOADS_DIR);
  if (!resolvedPath.startsWith(uploadsDirResolved)) {
    return res.status(403).json({ error: 'Access denied: invalid file path.' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Attachment file not found on disk.' });
  }

  res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
  const disposition = isDownload ? 'attachment' : 'inline';
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${encodeURIComponent(attachment.original_filename)}"`
  );

  const readStream = fs.createReadStream(resolvedPath);
  readStream.pipe(res);
}

// GET /api/tickets/:ticketId/attachments/:id/view - View attachment inline
router.get('/tickets/:ticketId/attachments/:id/view', (req, res, next) => {
  try {
    const attachment = ticketService.getAttachment(req.params.ticketId, req.params.id);
    serveAttachmentFile(res, attachment, false);
  } catch (err) {
    next(err);
  }
});

// GET /api/tickets/:ticketId/attachments/:id/download - Download attachment
router.get('/tickets/:ticketId/attachments/:id/download', (req, res, next) => {
  try {
    const attachment = ticketService.getAttachment(req.params.ticketId, req.params.id);
    serveAttachmentFile(res, attachment, true);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

