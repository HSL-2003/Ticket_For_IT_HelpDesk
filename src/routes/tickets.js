const express = require('express');
const router = express.Router();
const ticketService = require('../services/ticketService');
const { handleUpload } = require('../middleware/upload');

// POST /api/tickets - Create a new ticket
router.post('/', handleUpload, (req, res, next) => {
  try {
    const ticket = ticketService.createTicket(req.body, req.uploadedFiles);
    res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
});

// GET /api/tickets - List tickets with filtering
router.get('/', (req, res, next) => {
  try {
    const result = ticketService.listTickets(req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/tickets/:id - Get ticket details
router.get('/:id', (req, res, next) => {
  try {
    const ticket = ticketService.getTicketById(req.params.id);
    res.status(200).json(ticket);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tickets/:id/status - Update ticket lifecycle status
router.patch('/:id/status', (req, res, next) => {
  try {
    const updated = ticketService.updateTicketStatus(req.params.id, req.body);
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

