const { getDatabase } = require('../db/database');

/**
 * Compute dashboard metrics with strict half-open UTC interval filtering
 * @param {object} options { year, month }
 * @param {object|null} customDb
 */
function getDashboardMetrics({ year, month } = {}, customDb = null) {
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

  // 1. Total count
  const totalRow = db.get(`SELECT COUNT(*) as cnt FROM tickets ${whereClause}`, params);
  const total = totalRow ? totalRow.cnt : 0;

  // 2. Status counts
  const statusRows = db.query(
    `SELECT status, COUNT(*) as cnt FROM tickets ${whereClause} GROUP BY status`,
    params
  );
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

  // 3. High-level KPI aggregations
  const pending_backlog = by_status['Open'] + by_status['Pending'];
  const in_progress = by_status['In Progress'];
  const resolved_closed = by_status['Resolved'] + by_status['Closed'];

  // 4. Priority counts
  const priorityRows = db.query(
    `SELECT priority, COUNT(*) as cnt FROM tickets ${whereClause} GROUP BY priority`,
    params
  );
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

  // 5. Category counts
  const categoryRows = db.query(
    `SELECT category, COUNT(*) as cnt FROM tickets ${whereClause} GROUP BY category`,
    params
  );
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

  // 6. Resolution rate guarded against division by zero
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

