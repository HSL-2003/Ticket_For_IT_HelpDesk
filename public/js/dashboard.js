/**
 * IT HelpDesk - Analytics Dashboard Controller
 */

function renderBreakdown(containerId, items, total, colorMap) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const entries = Object.entries(items);
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

    // Update KPI cards
    document.getElementById('kpi-total').textContent = data.total;
    document.getElementById('kpi-pending').textContent = data.pending_backlog;
    document.getElementById('kpi-in-progress').textContent = data.in_progress;
    document.getElementById('kpi-resolved').textContent = data.resolved_closed;
    document.getElementById('kpi-rate').textContent = `${data.resolution_rate}%`;

    // Render Status Breakdown
    renderBreakdown('status-breakdown-container', data.by_status, data.total, {
      'Open': '#2563eb',
      'Pending': '#d97706',
      'In Progress': '#7c3aed',
      'Resolved': '#16a34a',
      'Closed': '#475569'
    });

    // Render Priority Breakdown
    renderBreakdown('priority-breakdown-container', data.by_priority, data.total, {
      'Low': '#64748b',
      'Medium': '#0284c7',
      'High': '#ea580c',
      'Critical': '#dc2626'
    });

    // Render Category Breakdown
    renderBreakdown('category-breakdown-container', data.by_category, data.total, {
      'Hardware': '#0d9488',
      'Software': '#4f46e5',
      'Network': '#0891b2',
      'Access': '#c026d3',
      'Other': '#64748b'
    });
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

