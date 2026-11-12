/**
 * IT HelpDesk - Ticket List Controller
 */

let searchTimeout = null;

window.renderTicketTable = function(tickets) {
  const tbody = document.getElementById('tickets-table-body');
  const emptyState = document.getElementById('tickets-empty-state');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!tickets || tickets.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  for (const ticket of tickets) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-ticket-id', ticket.id);
    if (ticket._isOptimistic) {
      tr.className = 'ticket-row-pending';
    }

    const attachmentCount = (ticket.attachments && ticket.attachments.length) || 0;
    const attachmentBadge = attachmentCount > 0
      ? `<span class="badge" style="background:#e0f2fe; color:#0369a1;">📎 ${attachmentCount} image${attachmentCount > 1 ? 's' : ''}</span>`
      : '<span style="color:#94a3b8;">None</span>';

    const syncingBadge = ticket._isOptimistic ? ' <span class="badge badge-syncing">Syncing...</span>' : '';
    const statusPulse = ticket._isOptimistic ? ' sync-pulse' : '';

    tr.innerHTML = `
      <td class="code-cell">${ticket.ticket_code}${syncingBadge}</td>
      <td class="title-cell" title="${ticket.title}">${ticket.title}</td>
      <td><span class="badge badge-category">${ticket.category}</span></td>
      <td><span class="badge ${window.getPriorityBadgeClass(ticket.priority)}">${ticket.priority}</span></td>
      <td><span class="badge ${window.getStatusBadgeClass(ticket.status)}${statusPulse}">${ticket.status}</span></td>
      <td>${ticket.requester_name}</td>
      <td>${attachmentBadge}</td>
      <td>${window.formatDateTime(ticket.created_at)}</td>
      <td>
        <button class="btn btn-sm btn-outline btn-view-ticket" data-id="${ticket.id}">
          View
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  }

  // Attach click handlers to View buttons
  tbody.querySelectorAll('.btn-view-ticket').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ticketId = btn.getAttribute('data-id');
      if (window.openTicketDetail) {
        window.openTicketDetail(ticketId);
      }
    });
  });
};

window.loadTickets = async function() {
  const searchInput = document.getElementById('ticket-search');
  const statusFilter = document.getElementById('ticket-filter-status');
  const categoryFilter = document.getElementById('ticket-filter-category');
  const priorityFilter = document.getElementById('ticket-filter-priority');
  const tbody = document.getElementById('tickets-table-body');
  const emptyState = document.getElementById('tickets-empty-state');

  if (!tbody) return;

  const params = new URLSearchParams();
  if (searchInput && searchInput.value.trim()) params.append('search', searchInput.value.trim());
  if (statusFilter && statusFilter.value) params.append('status', statusFilter.value);
  if (categoryFilter && categoryFilter.value) params.append('category', categoryFilter.value);
  if (priorityFilter && priorityFilter.value) params.append('priority', priorityFilter.value);

  try {
    const res = await fetch(`/api/tickets?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Failed to load tickets: ${res.statusText}`);
    }
    const data = await res.json();
    const tickets = data.tickets || [];

    if (window.AppStore) {
      window.AppStore.ticketList = tickets;
      for (const t of tickets) {
        window.AppStore.tickets.set(String(t.id), t);
      }
    }

    window.renderTicketTable(tickets);
  } catch (err) {
    console.error('Error fetching tickets:', err);
    window.showToast(err.message, 'error');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('ticket-search');
  const statusFilter = document.getElementById('ticket-filter-status');
  const categoryFilter = document.getElementById('ticket-filter-category');
  const priorityFilter = document.getElementById('ticket-filter-priority');
  const btnRefresh = document.getElementById('btn-refresh-tickets');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        window.loadTickets();
      }, 300);
    });
  }

  if (statusFilter) {
    statusFilter.addEventListener('change', () => window.loadTickets());
  }
  if (categoryFilter) {
    categoryFilter.addEventListener('change', () => window.loadTickets());
  }
  if (priorityFilter) {
    priorityFilter.addEventListener('change', () => window.loadTickets());
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      window.loadTickets();
      window.showToast('Ticket list refreshed', 'success');
    });
  }
});

