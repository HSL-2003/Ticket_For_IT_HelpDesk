/**
 * IT HelpDesk - Global Application Controller
 */

// Global App State
window.AppState = {
  currentTab: 'dashboard',
  selectedTicket: null
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
      if (window.loadDashboardMetrics) {
        window.loadDashboardMetrics();
      }
    } else {
      navTickets.classList.add('active');
      navDashboard.classList.remove('active');
      ticketsView.classList.add('active');
      dashboardView.classList.remove('active');
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

