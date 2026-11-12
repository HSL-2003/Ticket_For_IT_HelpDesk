/**
 * IT HelpDesk - Modal & Interactions Controller
 */

let selectedFiles = [];
let activeTicketId = null;
let pendingStatusChange = null;

// File Upload Drag & Drop and Preview
function setupFileUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const previewList = document.getElementById('file-preview-list');

  if (!dropZone || !fileInput || !previewList) return;

  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files) {
      handleFiles(Array.from(fileInput.files));
    }
  });

  function handleFiles(files) {
    for (const file of files) {
      if (selectedFiles.length >= 5) {
        window.showToast('Maximum 5 attachments allowed.', 'warning');
        break;
      }
      if (file.size > 5 * 1024 * 1024) {
        window.showToast(`File "${file.name}" exceeds 5MB limit.`, 'error');
        continue;
      }
      // Check duplicate
      if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
        continue;
      }
      selectedFiles.push(file);
    }
    renderFilePreviews();
  }

  function renderFilePreviews() {
    previewList.innerHTML = '';
    selectedFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'file-preview-item';
      const sizeKB = (file.size / 1024).toFixed(1);
      item.innerHTML = `
        <div class="file-preview-info">
          <span>📷</span>
          <span><strong>${file.name}</strong> (${sizeKB} KB)</span>
        </div>
        <button type="button" class="btn-remove-file" data-index="${index}">&times;</button>
      `;
      previewList.appendChild(item);
    });

    previewList.querySelectorAll('.btn-remove-file').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        selectedFiles.splice(idx, 1);
        renderFilePreviews();
      });
    });
  }

  window.resetFileUpload = function() {
    selectedFiles = [];
    fileInput.value = '';
    renderFilePreviews();
  };
}

// Helper: Apply optimistic metric delta for status transitions
function applyOptimisticMetricTransition(fromStatus, toStatus) {
  if (!window.AppStore || !window.AppStore.metrics) return;
  const m = window.AppStore.metrics;
  if (!m.by_status) m.by_status = {};
  if (fromStatus === toStatus) return;

  m.by_status[fromStatus] = Math.max(0, (m.by_status[fromStatus] || 1) - 1);
  m.by_status[toStatus] = (m.by_status[toStatus] || 0) + 1;

  const isBacklog = s => s === 'Open' || s === 'Pending';
  const isProgress = s => s === 'In Progress';
  const isResolvedClosed = s => s === 'Resolved' || s === 'Closed';

  if (isBacklog(fromStatus)) m.pending_backlog = Math.max(0, (m.pending_backlog || 1) - 1);
  else if (isProgress(fromStatus)) m.in_progress = Math.max(0, (m.in_progress || 1) - 1);
  else if (isResolvedClosed(fromStatus)) m.resolved_closed = Math.max(0, (m.resolved_closed || 1) - 1);

  if (isBacklog(toStatus)) m.pending_backlog = (m.pending_backlog || 0) + 1;
  else if (isProgress(toStatus)) m.in_progress = (m.in_progress || 0) + 1;
  else if (isResolvedClosed(toStatus)) m.resolved_closed = (m.resolved_closed || 0) + 1;

  if (m.total > 0) {
    m.resolution_rate = Number(((m.resolved_closed / m.total) * 100).toFixed(1));
  }
}

// Helper: Apply optimistic metric delta for new ticket creation
function applyOptimisticMetricCreation(ticket) {
  if (!window.AppStore || !window.AppStore.metrics) return;
  const m = window.AppStore.metrics;
  m.total = (m.total || 0) + 1;
  m.pending_backlog = (m.pending_backlog || 0) + 1;

  if (!m.by_status) m.by_status = {};
  m.by_status['Open'] = (m.by_status['Open'] || 0) + 1;

  if (ticket.priority) {
    if (!m.by_priority) m.by_priority = {};
    m.by_priority[ticket.priority] = (m.by_priority[ticket.priority] || 0) + 1;
  }
  if (ticket.category) {
    if (!m.by_category) m.by_category = {};
    m.by_category[ticket.category] = (m.by_category[ticket.category] || 0) + 1;
  }

  if (m.total > 0) {
    m.resolution_rate = Number((((m.resolved_closed || 0) / m.total) * 100).toFixed(1));
  }
}

// Create Ticket Form Handler
function setupCreateTicketModal() {
  const modal = document.getElementById('create-modal');
  const btnOpen = document.getElementById('btn-open-create-modal');
  const btnClose = document.getElementById('btn-close-create-modal');
  const btnCancel = document.getElementById('btn-cancel-create');
  const form = document.getElementById('create-ticket-form');
  const btnSubmit = document.getElementById('btn-submit-ticket');

  function openModal() {
    if (modal) modal.classList.remove('hidden');
  }

  function closeModal() {
    if (modal) modal.classList.add('hidden');
    if (form) form.reset();
    if (window.resetFileUpload) window.resetFileUpload();
  }

  if (btnOpen) btnOpen.addEventListener('click', openModal);
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const titleInput = document.getElementById('create-title');
      const catInput = document.getElementById('create-category');
      const priInput = document.getElementById('create-priority');
      const nameInput = document.getElementById('create-requester-name');
      const emailInput = document.getElementById('create-requester-email');
      const descInput = document.getElementById('create-description');

      const title = titleInput ? titleInput.value.trim() : '';
      const category = catInput ? catInput.value : '';
      const priority = priInput ? priInput.value : '';
      const requester_name = nameInput ? nameInput.value.trim() : '';
      const requester_email = emailInput ? emailInput.value.trim() : '';
      const description = descInput ? descInput.value.trim() : '';

      if (!title || !category || !priority || !requester_name || !requester_email || !description) {
        window.showToast('Please fill in all mandatory fields.', 'error');
        return;
      }

      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Submitting...';

      const tempId = 'temp_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(36).slice(2, 7)));

      // Save draft into store (draft preservation on failure)
      if (window.AppStore) {
        window.AppStore.pendingDrafts.set(tempId, {
          title, category, priority, requester_name, requester_email, description,
          files: [...selectedFiles]
        });
        window.AppStore.saveSnapshot(tempId, {
          metrics: window.AppStore.metrics ? JSON.parse(JSON.stringify(window.AppStore.metrics)) : null,
          tempId
        });
      }

      // Generate local blob preview attachments
      const localAttachments = selectedFiles.map((file, idx) => ({
        id: `temp_blob_${idx}_${Date.now()}`,
        original_filename: file.name,
        url: URL.createObjectURL(file),
        download_url: '#',
        isLocal: true
      }));

      const optimisticTicket = {
        id: tempId,
        ticket_code: 'HD-PENDING',
        title,
        category,
        priority,
        status: 'Open',
        requester_name,
        requester_email,
        description,
        attachments: localAttachments,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        history: [{
          action: 'CREATED',
          from_status: null,
          to_status: 'Open',
          changed_by: requester_name,
          created_at: new Date().toISOString(),
          notes: 'Ticket submitted (Syncing...)'
        }],
        _isOptimistic: true
      };

      // Prepend optimistic row to table
      const tbody = document.getElementById('tickets-table-body');
      const emptyState = document.getElementById('tickets-empty-state');
      let optimisticRow = null;

      if (tbody) {
        if (emptyState) emptyState.classList.add('hidden');

        optimisticRow = document.createElement('tr');
        optimisticRow.setAttribute('data-ticket-id', tempId);
        optimisticRow.className = 'ticket-row-pending';

        const attachmentCount = localAttachments.length;
        const attachmentBadge = attachmentCount > 0
          ? `<span class="badge" style="background:#e0f2fe; color:#0369a1;">📎 ${attachmentCount} image${attachmentCount > 1 ? 's' : ''}</span>`
          : '<span style="color:#94a3b8;">None</span>';

        optimisticRow.innerHTML = `
          <td class="code-cell">${optimisticTicket.ticket_code} <span class="badge badge-syncing">Syncing...</span></td>
          <td class="title-cell" title="${optimisticTicket.title}">${optimisticTicket.title}</td>
          <td><span class="badge badge-category">${optimisticTicket.category}</span></td>
          <td><span class="badge ${window.getPriorityBadgeClass(optimisticTicket.priority)}">${optimisticTicket.priority}</span></td>
          <td><span class="badge ${window.getStatusBadgeClass('Open')} sync-pulse">Open</span></td>
          <td>${optimisticTicket.requester_name}</td>
          <td>${attachmentBadge}</td>
          <td>${window.formatDateTime(optimisticTicket.created_at)}</td>
          <td>
            <button class="btn btn-sm btn-outline btn-view-ticket" data-id="${tempId}">
              View
            </button>
          </td>
        `;

        if (tbody.firstChild) {
          tbody.insertBefore(optimisticRow, tbody.firstChild);
        } else {
          tbody.appendChild(optimisticRow);
        }

        optimisticRow.querySelector('.btn-view-ticket').addEventListener('click', () => {
          window.openTicketDetail(tempId);
        });
      }

      // Update store & dashboard metrics
      if (window.AppStore) {
        window.AppStore.tickets.set(tempId, optimisticTicket);
        window.AppStore.ticketList.unshift(optimisticTicket);
        applyOptimisticMetricCreation(optimisticTicket);
        window.AppStore.renderDashboard();
      }

      // Immediately close modal (< 16ms) WITHOUT resetting form or clearing selectedFiles
      performance.mark('create-start');
      if (modal) modal.classList.add('hidden');

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          performance.mark('create-painted');
          try {
            performance.measure('Perceived_UI_Create_Ticket', 'create-start', 'create-painted');
          } catch (e) {}
        });
      });

      // Prepare payload
      const formData = new FormData();
      formData.append('title', title);
      formData.append('category', category);
      formData.append('priority', priority);
      formData.append('requester_name', requester_name);
      formData.append('requester_email', requester_email);
      formData.append('description', description);

      for (const file of selectedFiles) {
        formData.append('attachments', file);
      }

      try {
        const res = await fetch('/api/tickets', {
          method: 'POST',
          headers: {
            'X-Idempotency-Key': tempId
          },
          body: formData
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to submit ticket');
        }

        // Revoke blob URLs
        localAttachments.forEach(att => {
          try { URL.revokeObjectURL(att.url); } catch (e) {}
        });

        // Swap tempId with authoritative ticket in table
        if (optimisticRow) {
          optimisticRow.setAttribute('data-ticket-id', data.id);
          optimisticRow.classList.remove('ticket-row-pending');
          const codeCell = optimisticRow.querySelector('.code-cell');
          if (codeCell) codeCell.textContent = data.ticket_code;

          const stBadge = optimisticRow.querySelector('.badge[class*="badge-status-"]') || (optimisticRow.children && optimisticRow.children[4]?.querySelector('.badge'));
          if (stBadge) stBadge.classList.remove('sync-pulse');

          const viewBtn = optimisticRow.querySelector('.btn-view-ticket');
          if (viewBtn) viewBtn.setAttribute('data-id', data.id);

          const attCount = (data.attachments && data.attachments.length) || 0;
          if (optimisticRow.children && optimisticRow.children[6]) {
            optimisticRow.children[6].innerHTML = attCount > 0
              ? `<span class="badge" style="background:#e0f2fe; color:#0369a1;">📎 ${attCount} image${attCount > 1 ? 's' : ''}</span>`
              : '<span style="color:#94a3b8;">None</span>';
          }
        }

        // Update store
        if (window.AppStore) {
          window.AppStore.pendingDrafts.delete(tempId);
          window.AppStore.deleteSnapshot(tempId);
          window.AppStore.tickets.delete(tempId);
          window.AppStore.tickets.set(String(data.id), data);
          const idx = window.AppStore.ticketList.findIndex(t => t.id === tempId);
          if (idx !== -1) {
            window.AppStore.ticketList[idx] = data;
          }
        }

        // Clean up form & files ONLY after server confirms success
        form.reset();
        selectedFiles = [];
        if (window.resetFileUpload) window.resetFileUpload();

        window.showToast(`Ticket ${data.ticket_code} created successfully!`, 'success');

      } catch (err) {
        console.error('Submission error (preserving draft & rolling back UI):', err);

        // Revoke blob URLs
        localAttachments.forEach(att => {
          try { URL.revokeObjectURL(att.url); } catch (e) {}
        });

        // Remove optimistic row from table
        if (optimisticRow && optimisticRow.parentNode) {
          optimisticRow.parentNode.removeChild(optimisticRow);
        }
        if (tbody && tbody.children.length === 0) {
          if (emptyState) emptyState.classList.remove('hidden');
        }

        // Revert store & metrics
        if (window.AppStore) {
          window.AppStore.tickets.delete(tempId);
          window.AppStore.ticketList = window.AppStore.ticketList.filter(t => t.id !== tempId);
          const snap = window.AppStore.getSnapshot(tempId);
          if (snap && snap.metrics) {
            window.AppStore.metrics = snap.metrics;
            window.AppStore.renderDashboard();
          }
          window.AppStore.deleteSnapshot(tempId);
        }

        // Reopen modal to preserve user's form inputs & attachments!
        if (modal) modal.classList.remove('hidden');

        window.showToast(err.message || 'Network error. Failed to create ticket. Draft preserved.', 'error');

      } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Submit Ticket';
      }
    });
  }
}

// Lightbox Handler
function openLightbox(url, filename, downloadUrl) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  const caption = document.getElementById('lightbox-filename');
  const downloadLink = document.getElementById('lightbox-download-link');

  if (!modal || !img) return;

  img.src = url;
  if (caption) caption.textContent = filename;
  if (downloadLink) downloadLink.href = downloadUrl || url;

  modal.classList.remove('hidden');
}

// Helper: Populate Detail Modal with ticket data
function populateDetailModal(ticket) {
  const codeEl = document.getElementById('detail-ticket-code');
  if (codeEl) codeEl.textContent = ticket.ticket_code;

  const badge = document.getElementById('detail-status-badge');
  if (badge) {
    badge.textContent = ticket.status;
    badge.className = `badge ${window.getStatusBadgeClass(ticket.status)}${ticket._isOptimistic ? ' sync-pulse' : ''}`;
  }

  const titleEl = document.getElementById('detail-title');
  if (titleEl) titleEl.textContent = ticket.title;

  const catEl = document.getElementById('detail-category');
  if (catEl) catEl.textContent = ticket.category;

  const priBadge = document.getElementById('detail-priority');
  if (priBadge) {
    priBadge.textContent = ticket.priority;
    priBadge.className = `badge ${window.getPriorityBadgeClass(ticket.priority)}`;
  }

  const reqEl = document.getElementById('detail-requester');
  if (reqEl) reqEl.textContent = `${ticket.requester_name || ''} (${ticket.requester_email || ''})`;

  const createdEl = document.getElementById('detail-created');
  if (createdEl) createdEl.textContent = window.formatDateTime(ticket.created_at);

  const updatedEl = document.getElementById('detail-updated');
  if (updatedEl) updatedEl.textContent = window.formatDateTime(ticket.updated_at);

  const descEl = document.getElementById('detail-description');
  if (descEl) descEl.textContent = ticket.description || '';

  // Resolution Notes
  const resSection = document.getElementById('detail-resolution-section');
  const resNotes = document.getElementById('detail-resolution-notes');
  if (resSection && resNotes) {
    if (ticket.resolution_notes) {
      resSection.classList.remove('hidden');
      resNotes.textContent = ticket.resolution_notes;
    } else {
      resSection.classList.add('hidden');
      resNotes.textContent = '';
    }
  }

  // Attachments Gallery
  const gallery = document.getElementById('detail-attachments-gallery');
  const attCount = document.getElementById('detail-attachment-count');
  const attachments = ticket.attachments || [];
  if (attCount) attCount.textContent = attachments.length;
  if (gallery) {
    gallery.innerHTML = '';
    if (attachments.length === 0) {
      gallery.innerHTML = '<p class="empty-state" style="padding:1rem;">No image attachments attached.</p>';
    } else {
      attachments.forEach((att) => {
        const thumb = document.createElement('div');
        thumb.className = 'gallery-thumb';
        thumb.innerHTML = `
          <img src="${att.url}" alt="${att.original_filename}" loading="lazy">
          <div class="thumb-name">${att.original_filename}</div>
        `;
        thumb.addEventListener('click', () => {
          openLightbox(att.url, att.original_filename, att.download_url);
        });
        gallery.appendChild(thumb);
      });
    }
  }

  // Lifecycle Action Buttons
  renderLifecycleButtons(ticket);

  // Audit History Timeline
  renderHistoryTimeline(ticket.history || []);
}

// Detail Modal Handler with SWR (< 5ms cached render)
window.openTicketDetail = async function(ticketId) {
  activeTicketId = ticketId;
  window.activeTicketId = ticketId;
  const modal = document.getElementById('detail-modal');

  // Check cache first for SWR (< 5ms)
  let cached = null;
  if (window.AppStore) {
    cached = window.AppStore.tickets.get(String(ticketId)) ||
      (window.AppStore.ticketList && window.AppStore.ticketList.find(t => String(t.id) === String(ticketId)));
  }

  if (cached) {
    performance.mark('detail-open-start');
    populateDetailModal(cached);
    if (modal) modal.classList.remove('hidden');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        performance.mark('detail-open-painted');
        try {
          performance.measure('Perceived_UI_Open_Detail', 'detail-open-start', 'detail-open-painted');
        } catch (e) {}
      });
    });
  }

  // If this is an optimistic pending ticket, don't fetch from server yet
  if (String(ticketId).startsWith('temp_')) {
    return;
  }

  // Background fetch / revalidate
  try {
    const res = await fetch(`/api/tickets/${ticketId}`);
    if (!res.ok) {
      throw new Error(`Ticket ${ticketId} not found`);
    }
    const ticket = await res.json();
    ticket._canonicalStatus = ticket.status;
    ticket._canonicalNotes = ticket.resolution_notes;
    ticket._canonicalHistory = ticket.history;

    if (window.AppStore) {
      window.AppStore.tickets.set(String(ticket.id), ticket);
      window.AppStore.updateTicketState(ticket.id, ticket);
    }

    // Only update modal if user is still viewing this ticket
    if (String(window.activeTicketId) === String(ticketId)) {
      populateDetailModal(ticket);
      if (modal) modal.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Error fetching ticket detail:', err);
    if (!cached) {
      window.showToast(err.message, 'error');
    }
  }
};

const localTransitionStartTimes = new Map();
const localCompletedTransitionTimes = new Map();

function renderLifecycleButtons(ticket) {
  const container = document.getElementById('detail-action-buttons');
  if (!container) return;
  container.innerHTML = '';

  const status = ticket.status;
  const actions = [];

  if (status === 'Open') {
    actions.push({ label: 'Start Progress', nextStatus: 'In Progress', btnClass: 'btn-primary' });
    actions.push({ label: 'Mark Pending', nextStatus: 'Pending', btnClass: 'btn-warning' });
    actions.push({ label: 'Close Ticket', nextStatus: 'Closed', btnClass: 'btn-secondary' });
  } else if (status === 'Pending') {
    actions.push({ label: 'Resume Progress', nextStatus: 'In Progress', btnClass: 'btn-primary' });
    actions.push({ label: 'Re-open to Open', nextStatus: 'Open', btnClass: 'btn-outline' });
    actions.push({ label: 'Close Ticket', nextStatus: 'Closed', btnClass: 'btn-secondary' });
  } else if (status === 'In Progress') {
    actions.push({ label: 'Resolve Ticket', nextStatus: 'Resolved', btnClass: 'btn-success', requiresNotes: true });
    actions.push({ label: 'Mark Pending', nextStatus: 'Pending', btnClass: 'btn-warning' });
    actions.push({ label: 'Return to Open', nextStatus: 'Open', btnClass: 'btn-outline' });
  } else if (status === 'Resolved') {
    actions.push({ label: 'Close Ticket', nextStatus: 'Closed', btnClass: 'btn-secondary' });
    actions.push({ label: 'Re-open to In Progress', nextStatus: 'In Progress', btnClass: 'btn-warning' });
  } else if (status === 'Closed') {
    actions.push({ label: 'Re-open Ticket', nextStatus: 'Open', btnClass: 'btn-outline' });
  }

  for (const act of actions) {
    const btn = document.createElement('button');
    btn.className = `btn ${act.btnClass}`;
    if (window._isStatusTransitioning) {
      btn.disabled = true;
      btn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    btn.textContent = act.label;

    btn.addEventListener('click', () => {
      if (window._isStatusTransitioning) return;
      if (act.requiresNotes) {
        showPromptModal(act.nextStatus);
      } else {
        performStatusTransition(act.nextStatus);
      }
    });

    container.appendChild(btn);
  }
}

window.renderLifecycleButtons = renderLifecycleButtons;

function renderHistoryTimeline(history) {
  const container = document.getElementById('detail-history-timeline');
  if (!container) return;
  container.innerHTML = '';

  if (!history || history.length === 0) {
    container.innerHTML = '<p class="empty-state" style="padding:0.5rem;">No history records.</p>';
    return;
  }

  history.forEach((h) => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    const transitionText = h.from_status
      ? `Status changed from "${h.from_status}" to "${h.to_status}"`
      : `Ticket initialized with status "${h.to_status}"`;

    item.innerHTML = `
      <div class="timeline-meta">${window.formatDateTime(h.created_at)} • by ${h.changed_by}</div>
      <div class="timeline-text">${transitionText}</div>
      ${h.notes ? `<div class="timeline-notes" style="font-style:italic; color:#475569;">"${h.notes}"</div>` : ''}
    `;
    container.appendChild(item);
  });
}

window.renderHistoryTimeline = renderHistoryTimeline;

// Optimistic Status Transition (< 16ms) & Snapshot Rollback
async function performStatusTransition(nextStatus, notes = null) {
  if (window._isStatusTransitioning) return;

  const ticketId = window.activeTicketId || activeTicketId;
  if (!ticketId) return;

  window._isStatusTransitioning = true;

  // Disable all buttons in #detail-action-buttons upon initiating the transition
  const actionButtons = document.querySelectorAll('#detail-action-buttons button');
  actionButtons.forEach(btn => {
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
  });

  const transitionStartTime = Date.now();
  if (window.AppStore && typeof window.AppStore.setTransitionStartTime === 'function') {
    window.AppStore.setTransitionStartTime(ticketId, transitionStartTime);
  } else if (window.AppStore) {
    if (!window.AppStore.lastStatusTransitionTimes) {
      window.AppStore.lastStatusTransitionTimes = new Map();
    }
    window.AppStore.lastStatusTransitionTimes.set(String(ticketId), transitionStartTime);
    window.AppStore.lastStatusTransitionTime = transitionStartTime;
  }
  localTransitionStartTimes.set(String(ticketId), transitionStartTime);

  const currentTicket = (window.AppStore && window.AppStore.tickets && window.AppStore.tickets.get(String(ticketId))) ||
    (window.AppStore && window.AppStore.ticketList && window.AppStore.ticketList.find(t => String(t.id) === String(ticketId))) ||
    {};

  if (!currentTicket._canonicalStatus && currentTicket.status) {
    currentTicket._canonicalStatus = currentTicket.status;
    currentTicket._canonicalNotes = currentTicket.resolution_notes || '';
    if (currentTicket.history) currentTicket._canonicalHistory = currentTicket.history;
  }

  const canonicalStatus = currentTicket._canonicalStatus || currentTicket.status || document.getElementById('detail-status-badge')?.textContent.trim() || 'Open';
  const prevStatus = currentTicket.status || canonicalStatus;
  const canonicalNotes = currentTicket._canonicalNotes !== undefined ? currentTicket._canonicalNotes : (currentTicket.resolution_notes || '');
  const prevNotes = currentTicket.resolution_notes || document.getElementById('detail-resolution-notes')?.textContent.trim() || '';
  const canonicalHistory = currentTicket._canonicalHistory ? JSON.parse(JSON.stringify(currentTicket._canonicalHistory)) : (currentTicket.history ? JSON.parse(JSON.stringify(currentTicket.history)) : []);
  const prevHistory = currentTicket.history ? JSON.parse(JSON.stringify(currentTicket.history)) : [];

  const actionId = 'status_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const prevMetrics = (window.AppStore && window.AppStore.metrics)
    ? JSON.parse(JSON.stringify(window.AppStore.metrics))
    : null;

  // Snapshot before mutation - preserves canonical state for rollback
  const snapshot = {
    actionId,
    ticketId,
    status: canonicalStatus,
    resolutionNotes: canonicalNotes,
    history: canonicalHistory,
    metrics: prevMetrics
  };

  if (window.AppStore) {
    window.AppStore.saveSnapshot(actionId, snapshot);
  }

  const detailBadge = document.getElementById('detail-status-badge');
  const row = document.querySelector(`tr[data-ticket-id="${ticketId}"]`);
  const resSec = document.getElementById('detail-resolution-section');
  const resNotesEl = document.getElementById('detail-resolution-notes');

  try {
    // --- IMMEDIATE DOM MUTATION (< 16ms) ---
    performance.mark('status-start');

    // 1. Detail badge
    if (detailBadge) {
      detailBadge.textContent = nextStatus;
      detailBadge.className = `badge ${window.getStatusBadgeClass(nextStatus)} sync-pulse`;
    }

    // 2. Table row status badge
    if (row) {
      const rowBadge = row.querySelector('.badge[class*="badge-status-"]') || (row.children && row.children[4]?.querySelector('.badge'));
      if (rowBadge) {
        rowBadge.textContent = nextStatus;
        rowBadge.className = `badge ${window.getStatusBadgeClass(nextStatus)} sync-pulse`;
      }
    }

    // 3. Resolution notes
    if (notes) {
      if (resSec) resSec.classList.remove('hidden');
      if (resNotesEl) resNotesEl.textContent = notes;
    }

    // 4. Re-render lifecycle buttons for nextStatus immediately
    const patchedTicket = {
      ...currentTicket,
      status: nextStatus,
      resolution_notes: notes || currentTicket.resolution_notes
    };
    renderLifecycleButtons(patchedTicket);

    // 5. Append optimistic history row ("You (Saving...)")
    const optimisticHistoryItem = {
      action: 'STATUS_CHANGE',
      from_status: prevStatus,
      to_status: nextStatus,
      changed_by: 'You (Saving...)',
      created_at: new Date().toISOString(),
      notes: notes || null
    };
    const updatedHistory = [...prevHistory, optimisticHistoryItem];
    renderHistoryTimeline(updatedHistory);

    // 6. Update AppStore state & metrics
    if (window.AppStore) {
      window.AppStore.updateTicketState(ticketId, {
        status: nextStatus,
        resolution_notes: notes || currentTicket.resolution_notes,
        history: updatedHistory
      });
      applyOptimisticMetricTransition(prevStatus, nextStatus);
      window.AppStore.renderDashboard();
    }

    // Telemetry: measure Perceived_UI_Status_Transition via double-rAF
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        performance.mark('status-painted');
        try {
          performance.measure('Perceived_UI_Status_Transition', 'status-start', 'status-painted');
        } catch (e) {}
      });
    });

    // --- ASYNCHRONOUS BACKGROUND SYNC ---
    const payload = {
      expected_status: prevStatus,
      status: nextStatus
    };
    if (notes) payload.notes = notes;

    const res = await fetch(`/api/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.status === 409) {
      // OCC Conflict detected: reconcile with canonical server state
      if (window.AppStore) {
        window.AppStore.deleteSnapshot(actionId);
      }

      const lastCompleted = (window.AppStore && typeof window.AppStore.getLastCompletedTransitionTime === 'function')
        ? window.AppStore.getLastCompletedTransitionTime(ticketId)
        : (localCompletedTransitionTimes.get(String(ticketId)) || (window.AppStore && window.AppStore.lastCompletedTransitionTime) || 0);

      const lastStarted = (window.AppStore && typeof window.AppStore.getTransitionStartTime === 'function')
        ? window.AppStore.getTransitionStartTime(ticketId)
        : (localTransitionStartTimes.get(String(ticketId)) || (window.AppStore && window.AppStore.lastStatusTransitionTime) || 0);

      if (transitionStartTime < lastCompleted || transitionStartTime < lastStarted) {
        console.warn(`Ignoring stale 409 response for ticket ${ticketId}`);
        return;
      }

      if (data.ticket) {
        data.ticket._canonicalStatus = data.ticket.status;
        data.ticket._canonicalNotes = data.ticket.resolution_notes || '';
        if (data.ticket.history) data.ticket._canonicalHistory = data.ticket.history;
      }
      if (window.AppStore) {
        window.AppStore.reconcileTicket(data.ticket);
      }
      if (window.AppStore && typeof window.AppStore.setLastCompletedTransitionTime === 'function') {
        window.AppStore.setLastCompletedTransitionTime(ticketId, transitionStartTime);
      } else if (window.AppStore) {
        if (!window.AppStore.lastCompletedTransitionTimes) {
          window.AppStore.lastCompletedTransitionTimes = new Map();
        }
        window.AppStore.lastCompletedTransitionTimes.set(String(ticketId), transitionStartTime);
        window.AppStore.lastCompletedTransitionTime = transitionStartTime;
      }
      localCompletedTransitionTimes.set(String(ticketId), transitionStartTime);

      // Remove sync pulse
      if (detailBadge) detailBadge.classList.remove('sync-pulse');
      if (row) {
        const b = row.querySelector('.badge[class*="badge-status-"]') || (row.children && row.children[4]?.querySelector('.badge'));
        if (b) b.classList.remove('sync-pulse');
      }
      window.showToast('Conflict detected. Synced with server.', 'warning');
      return;
    }

    if (!res.ok) {
      throw new Error(data.error || 'Failed to update status');
    }

    // Success (HTTP 200)
    const lastCompletedTransitionTime = (window.AppStore && typeof window.AppStore.getLastCompletedTransitionTime === 'function')
      ? window.AppStore.getLastCompletedTransitionTime(ticketId)
      : (localCompletedTransitionTimes.get(String(ticketId)) || (window.AppStore && window.AppStore.lastCompletedTransitionTime) || 0);

    const lastStartedTransitionTime = (window.AppStore && typeof window.AppStore.getTransitionStartTime === 'function')
      ? window.AppStore.getTransitionStartTime(ticketId)
      : (localTransitionStartTimes.get(String(ticketId)) || (window.AppStore && window.AppStore.lastStatusTransitionTime) || 0);

    if (transitionStartTime < lastCompletedTransitionTime || transitionStartTime < lastStartedTransitionTime) {
      console.warn(`Ignoring stale response from transition started at ${transitionStartTime}, newer transition completed at ${lastCompletedTransitionTime}`);
      if (window.AppStore) {
        window.AppStore.deleteSnapshot(actionId);
      }
      return;
    }

    const canonical = data.ticket || data;
    canonical._canonicalStatus = canonical.status;
    canonical._canonicalNotes = canonical.resolution_notes || '';
    if (canonical.history) canonical._canonicalHistory = canonical.history;
    const currentStoredTicket = (window.AppStore && window.AppStore.tickets && window.AppStore.tickets.get(String(ticketId))) || {};
    if (canonical.updated_at && currentStoredTicket.updated_at) {
      const canonicalTime = new Date(canonical.updated_at).getTime();
      const currentStoredTime = new Date(currentStoredTicket.updated_at).getTime();
      if (canonicalTime < currentStoredTime) {
        console.warn(`Ignoring stale canonical update (canonical ${canonical.updated_at} < current ${currentStoredTicket.updated_at})`);
        if (window.AppStore) {
          window.AppStore.deleteSnapshot(actionId);
        }
        return;
      }
    }

    if (window.AppStore && typeof window.AppStore.setLastCompletedTransitionTime === 'function') {
      window.AppStore.setLastCompletedTransitionTime(ticketId, transitionStartTime);
    } else if (window.AppStore) {
      if (!window.AppStore.lastCompletedTransitionTimes) {
        window.AppStore.lastCompletedTransitionTimes = new Map();
      }
      window.AppStore.lastCompletedTransitionTimes.set(String(ticketId), transitionStartTime);
      window.AppStore.lastCompletedTransitionTime = transitionStartTime;
    }
    localCompletedTransitionTimes.set(String(ticketId), transitionStartTime);

    if (window.AppStore) {
      window.AppStore.deleteSnapshot(actionId);
      window.AppStore.updateTicketState(ticketId, canonical);
      window.AppStore.tickets.set(String(ticketId), canonical);
    }

    // Remove sync-pulse indicators
    if (detailBadge) detailBadge.classList.remove('sync-pulse');
    if (row) {
      const b = row.querySelector('.badge[class*="badge-status-"]') || (row.children && row.children[4]?.querySelector('.badge'));
      if (b) b.classList.remove('sync-pulse');
    }

    // Update canonical history and updated_at if still open
    if (String(window.activeTicketId) === String(ticketId)) {
      if (canonical.history) renderHistoryTimeline(canonical.history);
      const upd = document.getElementById('detail-updated');
      if (upd && canonical.updated_at) upd.textContent = window.formatDateTime(canonical.updated_at);
    }

    window.showToast(`Ticket status changed to ${nextStatus}`, 'success');

  } catch (err) {
    console.error('Status transition error (triggering rollback):', err);

    // Rollback from snapshot
    if (window.AppStore) {
      const snap = window.AppStore.getSnapshot(actionId);
      if (snap) {
        const lastCompleted = (window.AppStore && typeof window.AppStore.getLastCompletedTransitionTime === 'function')
          ? window.AppStore.getLastCompletedTransitionTime(ticketId)
          : (localCompletedTransitionTimes.get(String(ticketId)) || (window.AppStore && window.AppStore.lastCompletedTransitionTime) || 0);

        const lastStarted = (window.AppStore && typeof window.AppStore.getTransitionStartTime === 'function')
          ? window.AppStore.getTransitionStartTime(ticketId)
          : (localTransitionStartTimes.get(String(ticketId)) || (window.AppStore && window.AppStore.lastStatusTransitionTime) || 0);

        if (transitionStartTime >= lastCompleted && transitionStartTime >= lastStarted) {
          // Revert detail badge
          if (detailBadge) {
            detailBadge.textContent = snap.status;
            detailBadge.className = `badge ${window.getStatusBadgeClass(snap.status)}`;
          }

          // Revert table row badge
          if (row) {
            const b = row.querySelector('.badge[class*="badge-status-"]') || (row.children && row.children[4]?.querySelector('.badge'));
            if (b) {
              b.textContent = snap.status;
              b.className = `badge ${window.getStatusBadgeClass(snap.status)}`;
            }
          }

          // Revert resolution notes
          if (resSec && resNotesEl) {
            if (snap.resolutionNotes) {
              resSec.classList.remove('hidden');
              resNotesEl.textContent = snap.resolutionNotes;
            } else {
              resSec.classList.add('hidden');
              resNotesEl.textContent = '';
            }
          }

          // Revert history timeline
          renderHistoryTimeline(snap.history || []);

          // Revert lifecycle buttons
          renderLifecycleButtons({
            ...currentTicket,
            status: snap.status,
            resolution_notes: snap.resolutionNotes
          });

          // Revert metrics
          if (snap.metrics) {
            window.AppStore.metrics = snap.metrics;
            window.AppStore.renderDashboard();
          }

          // Revert ticket in store
          window.AppStore.updateTicketState(ticketId, {
            status: snap.status,
            resolution_notes: snap.resolutionNotes,
            history: snap.history,
            _canonicalStatus: snap.status,
            _canonicalNotes: snap.resolutionNotes,
            _canonicalHistory: snap.history
          });
          if (currentTicket) {
            currentTicket._canonicalStatus = snap.status;
            currentTicket._canonicalNotes = snap.resolutionNotes;
            currentTicket._canonicalHistory = snap.history;
          }
        }

        window.AppStore.deleteSnapshot(actionId);
      }
    }

    window.showToast(err.message || 'Network error. Reverted to previous state.', 'error');
  } finally {
    window._isStatusTransitioning = false;
    const actionButtons = document.querySelectorAll('#detail-action-buttons button');
    actionButtons.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
    });
  }
}

window.performStatusTransition = performStatusTransition;

// Prompt Modal
function showPromptModal(nextStatus) {
  if (window._isStatusTransitioning) return;
  pendingStatusChange = nextStatus;
  const modal = document.getElementById('prompt-modal');
  const textarea = document.getElementById('prompt-resolution-notes');
  if (textarea) textarea.value = '';
  if (modal) modal.classList.remove('hidden');
}

function closePromptModal() {
  const modal = document.getElementById('prompt-modal');
  if (modal) modal.classList.add('hidden');
  pendingStatusChange = null;
}

document.addEventListener('DOMContentLoaded', () => {
  setupFileUpload();
  setupCreateTicketModal();

  // Detail Modal Close
  const btnCloseDetail = document.getElementById('btn-close-detail-modal');
  const detailModal = document.getElementById('detail-modal');
  if (btnCloseDetail && detailModal) {
    btnCloseDetail.addEventListener('click', () => {
      detailModal.classList.add('hidden');
      activeTicketId = null;
    });
  }

  // Lightbox Close
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');
  const lightboxModal = document.getElementById('lightbox-modal');
  if (btnCloseLightbox && lightboxModal) {
    btnCloseLightbox.addEventListener('click', () => {
      lightboxModal.classList.add('hidden');
    });
  }

  // Prompt Modal Handlers
  const btnClosePrompt = document.getElementById('btn-close-prompt-modal');
  const btnCancelPrompt = document.getElementById('btn-cancel-prompt');
  const btnConfirmPrompt = document.getElementById('btn-confirm-prompt');
  const textareaPrompt = document.getElementById('prompt-resolution-notes');

  if (btnClosePrompt) btnClosePrompt.addEventListener('click', closePromptModal);
  if (btnCancelPrompt) btnCancelPrompt.addEventListener('click', closePromptModal);

  if (btnConfirmPrompt) {
    btnConfirmPrompt.addEventListener('click', () => {
      if (window._isStatusTransitioning) return;
      const notes = textareaPrompt ? textareaPrompt.value.trim() : '';
      if (!notes) {
        window.showToast('Please provide resolution notes before confirming.', 'warning');
        return;
      }
      const nextStatus = pendingStatusChange;
      closePromptModal();
      performStatusTransition(nextStatus, notes);
    });
  }
});

