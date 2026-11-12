const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');

// GET /api/dashboard/metrics - Aggregate metrics with optional month and year filters
router.get('/metrics', async (req, res, next) => {
  try {
    const metrics = await dashboardService.getDashboardMetrics(req.query);
    res.status(200).json(metrics);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
