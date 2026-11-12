/**
 * Standardized English JSON Error Handler Middleware
 */
function errorHandler(err, req, res, next) {
  // If response has already started streaming, delegate to default express handler
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || 'An unexpected internal server error occurred.';

  const responsePayload = {
    error: message
  };

  if (err.details) {
    responsePayload.details = err.details;
  }

  // Include stack trace only in development if explicitly requested
  if (process.env.NODE_ENV === 'development' && err.stack) {
    responsePayload.stack = err.stack;
  }

  res.status(statusCode).json(responsePayload);
}

module.exports = errorHandler;

