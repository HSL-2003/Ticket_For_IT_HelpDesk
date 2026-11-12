/**
 * IT HelpDesk - Analytics Dashboard Controller
 */

function renderBreakdown(containerId, items, total, colorMap) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const entries = Object.entries(items || {});
  if (entries.length === 0) {
    container.innerHTML = '<p class="empty-state">No data available.</p>';
    return;
  }

  for (const [key, count] of entries) {
    const percent = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
    const color = (colorMap && colorMap[key]) || '#3b82f6';

    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.innerHTML = `
      <div class="breakdown-label-row">
        <span class="breakdown-label">${key}</span>
        <span class="breakdown-count">${count} (${percent}%)</span>
      </div>
      <div class="breakdown-bar-bg">
        <div class="breakdown-bar-fill" style="width: ${percent}%; background-color: ${color};"></div>
      </div>
    `;
    container.appendChild(row);
  }
}

window.renderBreakdown = renderBreakdown;

window.loadDashboardMetrics = async function() {
  const yearSelect = document.getElementById('filter-year');
  const monthSelect = document.getElementById('filter-month');

  const year = yearSelect ? yearSelect.value : '';
  const month = monthSelect ? monthSelect.value : '';

  const params = new URLSearchParams();
  if (year) params.append('year', year);
  if (month) params.append('month', month);

  try {
    const res = await fetch(`/api/dashboard/metrics?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Failed to load metrics: ${res.statusText}`);
    }
    const data = await res.json();

    if (window.AppStore) {
      window.AppStore.metrics = data;
      window.AppStore.renderDashboard();
    } else {
      // Null-safe update KPI cards
      const totalEl = document.getElementById('kpi-total');
      const pendingEl = document.getElementById('kpi-pending');
      const inProgressEl = document.getElementById('kpi-in-progress');
      const resolvedEl = document.getElementById('kpi-resolved');
      const rateEl = document.getElementById('kpi-rate');

      if (totalEl) totalEl.textContent = data.total;
      if (pendingEl) pendingEl.textContent = data.pending_backlog;
      if (inProgressEl) inProgressEl.textContent = data.in_progress;
      if (resolvedEl) resolvedEl.textContent = data.resolved_closed;
      if (rateEl) rateEl.textContent = `${data.resolution_rate}%`;

      // Render Status Breakdown
      renderBreakdown('status-breakdown-container', data.by_status || {}, data.total || 0, {
        'Open': '#2563eb',
        'Pending': '#d97706',
        'In Progress': '#7c3aed',
        'Resolved': '#16a34a',
        'Closed': '#475569'
      });

      // Render Priority Breakdown
      renderBreakdown('priority-breakdown-container', data.by_priority || {}, data.total || 0, {
        'Low': '#64748b',
        'Medium': '#0284c7',
        'High': '#ea580c',
        'Critical': '#dc2626'
      });

      // Render Category Breakdown
      renderBreakdown('category-breakdown-container', data.by_category || {}, data.total || 0, {
        'Hardware': '#0d9488',
        'Software': '#4f46e5',
        'Network': '#0891b2',
        'Access': '#c026d3',
        'Other': '#64748b'
      });
    }
  } catch (err) {
    console.error('Error fetching dashboard metrics:', err);
    window.showToast(err.message, 'error');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const btnApply = document.getElementById('btn-apply-dashboard-filter');
  const btnReset = document.getElementById('btn-reset-dashboard-filter');
  const yearSelect = document.getElementById('filter-year');
  const monthSelect = document.getElementById('filter-month');

  if (btnApply) {
    btnApply.addEventListener('click', () => {
      window.loadDashboardMetrics();
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (yearSelect) yearSelect.value = '';
      if (monthSelect) monthSelect.value = '';
      window.loadDashboardMetrics();
    });
  }

  if (yearSelect) {
    yearSelect.addEventListener('change', () => window.loadDashboardMetrics());
  }
  if (monthSelect) {
    monthSelect.addEventListener('change', () => window.loadDashboardMetrics());
  }
});

