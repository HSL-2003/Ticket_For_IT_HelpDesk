const { getDatabase } = require('../db/database');

/**
 * Compute dashboard metrics with strict half-open UTC interval filtering
 * Executes the 4 aggregation queries concurrently via Promise.all for cloud efficiency.
 *
 * @param {object} options { year, month }
 * @param {object|null} customDb
 */
async function getDashboardMetrics({ year, month } = {}, customDb = null) {
  const db = customDb || getDatabase();
  const conditions = [];
  const params = [];

  let parsedYear = null;
  let parsedMonth = null;
  let startDate = null;
  let endDate = null;

  if (year !== undefined && year !== null && year !== '') {
    parsedYear = parseInt(year, 10);
    if (!isNaN(parsedYear)) {
      if (month !== undefined && month !== null && month !== '') {
        parsedMonth = parseInt(month, 10);
        if (!isNaN(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) {
          startDate = new Date(Date.UTC(parsedYear, parsedMonth - 1, 1)).toISOString();
          endDate = new Date(Date.UTC(parsedYear, parsedMonth, 1)).toISOString();
          conditions.push('created_at >= ? AND created_at < ?');
          params.push(startDate, endDate);
        }
      } else {
        startDate = new Date(Date.UTC(parsedYear, 0, 1)).toISOString();
        endDate = new Date(Date.UTC(parsedYear + 1, 0, 1)).toISOString();
        conditions.push('created_at >= ? AND created_at < ?');
        params.push(startDate, endDate);
      }
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Execute independent aggregation queries concurrently
  const [totalRow, statusRows, priorityRows, categoryRows] = await Promise.all([
    db.get(`SELECT COUNT(*) as cnt FROM tickets ${whereClause}`, params),
    db.query(`SELECT status, COUNT(*) as cnt FROM tickets ${whereClause} GROUP BY status`, params),
    db.query(`SELECT priority, COUNT(*) as cnt FROM tickets ${whereClause} GROUP BY priority`, params),
    db.query(`SELECT category, COUNT(*) as cnt FROM tickets ${whereClause} GROUP BY category`, params)
  ]);

  const total = totalRow ? totalRow.cnt : 0;

  // Status counts
  const by_status = {
    'Open': 0,
    'Pending': 0,
    'In Progress': 0,
    'Resolved': 0,
    'Closed': 0
  };
  for (const row of statusRows) {
    if (by_status.hasOwnProperty(row.status)) {
      by_status[row.status] = row.cnt;
    }
  }

  // High-level KPI aggregations
  const pending_backlog = by_status['Open'] + by_status['Pending'];
  const in_progress = by_status['In Progress'];
  const resolved_closed = by_status['Resolved'] + by_status['Closed'];

  // Priority counts
  const by_priority = {
    'Low': 0,
    'Medium': 0,
    'High': 0,
    'Critical': 0
  };
  for (const row of priorityRows) {
    if (by_priority.hasOwnProperty(row.priority)) {
      by_priority[row.priority] = row.cnt;
    }
  }

  // Category counts
  const by_category = {
    'Hardware': 0,
    'Software': 0,
    'Network': 0,
    'Access': 0,
    'Other': 0
  };
  for (const row of categoryRows) {
    if (by_category.hasOwnProperty(row.category)) {
      by_category[row.category] = row.cnt;
    }
  }

  // Resolution rate guarded against division by zero
  const resolution_rate = total > 0 ? Number(((resolved_closed / total) * 100).toFixed(1)) : 0.0;

  return {
    filter: {
      year: parsedYear,
      month: parsedMonth,
      start_date: startDate,
      end_date: endDate
    },
    total,
    pending_backlog,
    in_progress,
    resolved_closed,
    by_status,
    by_priority,
    by_category,
    resolution_rate
  };
}

module.exports = {
  getDashboardMetrics
};
