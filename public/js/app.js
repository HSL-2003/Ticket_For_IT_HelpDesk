/**
 * IT HelpDesk - Global Application Controller
 */

// Global App State
window.AppState = {
  currentTab: 'dashboard',
  selectedTicket: null
};

// Reactive State Store
window.AppStore = {
  tickets: new Map(),
  ticketList: [],
  metrics: null,
  pendingSnapshots: new Map(),
  pendingDrafts: new Map(),
  lastStatusTransitionTimes: new Map(),
  lastCompletedTransitionTimes: new Map(),
  lastStatusTransitionTime: 0,
  lastCompletedTransitionTime: 0,

  setTransitionStartTime(ticketId, timestamp = Date.now()) {
    const idStr = String(ticketId);
    this.lastStatusTransitionTimes.set(idStr, timestamp);
    this.lastStatusTransitionTime = timestamp;
    return timestamp;
  },

  getTransitionStartTime(ticketId) {
    return this.lastStatusTransitionTimes.get(String(ticketId)) || 0;
  },

  setLastCompletedTransitionTime(ticketId, timestamp = Date.now()) {
    const idStr = String(ticketId);
    this.lastCompletedTransitionTimes.set(idStr, timestamp);
    this.lastCompletedTransitionTime = timestamp;
    return timestamp;
  },

  getLastCompletedTransitionTime(ticketId) {
    return this.lastCompletedTransitionTimes.get(String(ticketId)) || this.lastCompletedTransitionTime || 0;
  },

  saveSnapshot(id, data) {
    this.pendingSnapshots.set(String(id), data);
  },

  getSnapshot(id) {
    return this.pendingSnapshots.get(String(id));
  },

  deleteSnapshot(id) {
    this.pendingSnapshots.delete(String(id));
  },

  updateTicketState(ticketId, patch) {
    const idStr = String(ticketId);
    const existing = this.tickets.get(idStr);
    if (existing) {
      Object.assign(existing, patch);
    }
    const inList = this.ticketList.find(t => String(t.id) === idStr);
    if (inList) {
      Object.assign(inList, patch);
    }
  },

  renderDashboard() {
    if (!this.metrics) return;

    const totalEl = document.getElementById('kpi-total');
    const pendingEl = document.getElementById('kpi-pending');
    const inProgressEl = document.getElementById('kpi-in-progress');
    const resolvedEl = document.getElementById('kpi-resolved');
    const rateEl = document.getElementById('kpi-rate');

    if (totalEl) totalEl.textContent = this.metrics.total;
    if (pendingEl) pendingEl.textContent = this.metrics.pending_backlog;
    if (inProgressEl) inProgressEl.textContent = this.metrics.in_progress;
    if (resolvedEl) resolvedEl.textContent = this.metrics.resolved_closed;
    if (rateEl) rateEl.textContent = `${this.metrics.resolution_rate}%`;

    if (window.renderBreakdown) {
      window.renderBreakdown('status-breakdown-container', this.metrics.by_status || {}, this.metrics.total || 0, {
        'Open': '#2563eb',
        'Pending': '#d97706',
        'In Progress': '#7c3aed',
        'Resolved': '#16a34a',
        'Closed': '#475569'
      });

      window.renderBreakdown('priority-breakdown-container', this.metrics.by_priority || {}, this.metrics.total || 0, {
        'Low': '#64748b',
        'Medium': '#0284c7',
        'High': '#ea580c',
        'Critical': '#dc2626'
      });

      window.renderBreakdown('category-breakdown-container', this.metrics.by_category || {}, this.metrics.total || 0, {
        'Hardware': '#0d9488',
        'Software': '#4f46e5',
        'Network': '#0891b2',
        'Access': '#c026d3',
        'Other': '#64748b'
      });
    }
  },

  reconcileTicket(canonicalTicket) {
    if (!canonicalTicket) return;
    canonicalTicket._canonicalStatus = canonicalTicket.status;
    canonicalTicket._canonicalNotes = canonicalTicket.resolution_notes || '';
    if (canonicalTicket.history) canonicalTicket._canonicalHistory = canonicalTicket.history;
    const idStr = String(canonicalTicket.id);

    // Update store
    this.tickets.set(idStr, canonicalTicket);
    const listIndex = this.ticketList.findIndex(t => String(t.id) === idStr);
    if (listIndex !== -1) {
      this.ticketList[listIndex] = canonicalTicket;
    }

    // Update table row if present
    const row = document.querySelector(`tr[data-ticket-id="${canonicalTicket.id}"]`);
    if (row) {
      const badge = row.querySelector('.badge[class*="badge-status-"]') || (row.children && row.children[4] ? row.children[4].querySelector('.badge') : null);
      if (badge) {
        badge.className = `badge ${window.getStatusBadgeClass(canonicalTicket.status)}`;
        badge.textContent = canonicalTicket.status;
      }
      const codeCell = row.querySelector('.code-cell');
      if (codeCell) {
        codeCell.textContent = canonicalTicket.ticket_code;
      }
    }

    // If detail modal is open for this ticket, reconcile modal
    if (window.activeTicketId && String(window.activeTicketId) === idStr) {
      const detailBadge = document.getElementById('detail-status-badge');
      if (detailBadge) {
        detailBadge.className = `badge ${window.getStatusBadgeClass(canonicalTicket.status)}`;
        detailBadge.textContent = canonicalTicket.status;
      }

      const resSection = document.getElementById('detail-resolution-section');
      const resNotes = document.getElementById('detail-resolution-notes');
      if (resSection && resNotes) {
        if (canonicalTicket.resolution_notes) {
          resSection.classList.remove('hidden');
          resNotes.textContent = canonicalTicket.resolution_notes;
        } else {
          resSection.classList.add('hidden');
          resNotes.textContent = '';
        }
      }

      if (window.renderLifecycleButtons) {
        window.renderLifecycleButtons(canonicalTicket);
      }
      if (window.renderHistoryTimeline && canonicalTicket.history) {
        window.renderHistoryTimeline(canonicalTicket.history);
      }
    }

    // Revalidate dashboard in background to match canonical state
    if (window.loadDashboardMetrics) {
      window.loadDashboardMetrics();
    }
  }
};

// Toast Notification Utility
window.showToast = function(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3500);
};

// Utility: Format Date string in English
window.formatDateTime = function(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return isoStr;
  }
};

// Utility: Get status badge CSS class
window.getStatusBadgeClass = function(status) {
  switch (status) {
    case 'Open': return 'badge-status-open';
    case 'Pending': return 'badge-status-pending';
    case 'In Progress': return 'badge-status-in-progress';
    case 'Resolved': return 'badge-status-resolved';
    case 'Closed': return 'badge-status-closed';
    default: return 'badge-status-open';
  }
};

// Utility: Get priority badge CSS class
window.getPriorityBadgeClass = function(priority) {
  switch (priority) {
    case 'Low': return 'badge-priority-low';
    case 'Medium': return 'badge-priority-medium';
    case 'High': return 'badge-priority-high';
    case 'Critical': return 'badge-priority-critical';
    default: return 'badge-priority-medium';
  }
};

// Tab Switching
function initNavigation() {
  const navDashboard = document.getElementById('nav-dashboard');
  const navTickets = document.getElementById('nav-tickets');
  const dashboardView = document.getElementById('dashboard-view');
  const ticketsView = document.getElementById('tickets-view');

  function switchTab(tab) {
    window.AppState.currentTab = tab;
    if (tab === 'dashboard') {
      navDashboard.classList.add('active');
      navTickets.classList.remove('active');
      dashboardView.classList.add('active');
      ticketsView.classList.remove('active');

      // Instant UI rendering from cache
      if (window.AppStore && window.AppStore.metrics) {
        window.AppStore.renderDashboard();
      }

      // Background silent revalidation
      if (window.loadDashboardMetrics) {
        window.loadDashboardMetrics();
      }
    } else {
      navTickets.classList.add('active');
      navDashboard.classList.remove('active');
      ticketsView.classList.add('active');
      dashboardView.classList.remove('active');

      // Instant UI rendering from cache
      if (window.AppStore && window.AppStore.ticketList && window.AppStore.ticketList.length > 0) {
        if (window.renderTicketTable) {
          window.renderTicketTable(window.AppStore.ticketList);
        }
      }

      // Background silent revalidation
      if (window.loadTickets) {
        window.loadTickets();
      }
    }
  }

  navDashboard.addEventListener('click', () => switchTab('dashboard'));
  navTickets.addEventListener('click', () => switchTab('tickets'));
}

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  if (window.loadDashboardMetrics) {
    window.loadDashboardMetrics();
  }
});

