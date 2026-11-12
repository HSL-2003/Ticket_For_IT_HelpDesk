const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const config = require('../../config');

// Ensure upload directory exists
if (!fs.existsSync(config.UPLOADS_DIR)) {
  fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  }
});

// Extension filter
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!config.ALLOWED_EXTENSIONS.includes(ext)) {
    const err = new Error(`Unsupported file type: ${ext}. Allowed types: ${config.ALLOWED_EXTENSIONS.join(', ')}`);
    err.status = 400;
    return cb(err, false);
  }
  cb(null, true);
};

const multerUpload = multer({
  storage,
  limits: {
    fileSize: config.MAX_FILE_SIZE, // 5MB
    files: config.MAX_FILES
  },
  fileFilter
}).fields([
  { name: 'attachments', maxCount: config.MAX_FILES },
  { name: 'attachment', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]);

/**
 * Validates file buffer against known image magic bytes
 * @param {Buffer} buffer
 * @returns {string|null} detected mime type or null
 */
function validateMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  // GIF: GIF87a or GIF89a (47 49 46 38)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WEBP: RIFF....WEBP (52 49 46 46 ... 57 45 42 50)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Clean up uploaded files in case of validation failure
 */
function cleanupFiles(files) {
  if (!files) return;
  for (const file of files) {
    try {
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (e) {
      // Ignore deletion errors
    }
  }
}

/**
 * Middleware wrapper supporting attachments, attachment, and image fields
 * with magic-byte verification and zero-byte protection.
 */
function handleUpload(req, res, next) {
  multerUpload(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File size limit exceeded. Maximum file size is 5MB.'
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            error: `File count limit exceeded. Maximum ${config.MAX_FILES} attachments allowed.`
          });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ error: err.message || 'File upload error' });
    }

    // Collect all uploaded files into an array
    const files = [];
    if (req.files) {
      if (Array.isArray(req.files.attachments)) {
        files.push(...req.files.attachments);
      }
      if (Array.isArray(req.files.attachment)) {
        files.push(...req.files.attachment);
      }
      if (Array.isArray(req.files.image)) {
        files.push(...req.files.image);
      }
    }

    // Validate each file
    for (const file of files) {
      // Check zero-byte file
      if (!file.size || file.size === 0) {
        cleanupFiles(files);
        return res.status(400).json({
          error: `File "${file.originalname}" is empty (0 bytes).`
        });
      }

      // Check magic bytes
      try {
        const fd = fs.openSync(file.path, 'r');
        const headerBuffer = Buffer.alloc(16);
        const bytesRead = fs.readSync(fd, headerBuffer, 0, 16, 0);
        fs.closeSync(fd);

        if (bytesRead < 4) {
          cleanupFiles(files);
          return res.status(400).json({
            error: `File "${file.originalname}" is invalid or corrupted.`
          });
        }

        const detectedMime = validateMagicBytes(headerBuffer);
        if (!detectedMime) {
          cleanupFiles(files);
          return res.status(400).json({
            error: `File "${file.originalname}" content does not match allowed image formats (PNG, JPEG, GIF, WEBP).`
          });
        }

        // Store detected MIME type
        file.detectedMime = detectedMime;
      } catch (readErr) {
        cleanupFiles(files);
        return res.status(500).json({
          error: `Failed to inspect uploaded file: ${readErr.message}`
        });
      }
    }

    req.uploadedFiles = files;
    next();
  });
}

module.exports = {
  handleUpload,
  validateMagicBytes,
  cleanupFiles
};

