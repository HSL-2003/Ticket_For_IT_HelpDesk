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
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Submitting...';

      const formData = new FormData(form);
      formData.delete('attachments'); // Clear default input bindings

      // Append tracked files
      for (const file of selectedFiles) {
        formData.append('attachments', file);
      }

      try {
        const res = await fetch('/api/tickets', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to submit ticket');
        }

        window.showToast(`Ticket ${data.ticket_code} created successfully!`, 'success');
        closeModal();

        // Refresh views
        if (window.loadTickets) window.loadTickets();
        if (window.loadDashboardMetrics) window.loadDashboardMetrics();
      } catch (err) {
        console.error('Submission error:', err);
        window.showToast(err.message, 'error');
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

// Detail Modal Handler
window.openTicketDetail = async function(ticketId) {
  activeTicketId = ticketId;
  const modal = document.getElementById('detail-modal');

  try {
    const res = await fetch(`/api/tickets/${ticketId}`);
    if (!res.ok) {
      throw new Error(`Ticket ${ticketId} not found`);
    }
    const ticket = await res.json();

    // Fill elements
    document.getElementById('detail-ticket-code').textContent = ticket.ticket_code;
    const badge = document.getElementById('detail-status-badge');
    badge.textContent = ticket.status;
    badge.className = `badge ${window.getStatusBadgeClass(ticket.status)}`;

    document.getElementById('detail-title').textContent = ticket.title;
    document.getElementById('detail-category').textContent = ticket.category;

    const priBadge = document.getElementById('detail-priority');
    priBadge.textContent = ticket.priority;
    priBadge.className = `badge ${window.getPriorityBadgeClass(ticket.priority)}`;

    document.getElementById('detail-requester').textContent = `${ticket.requester_name} (${ticket.requester_email})`;
    document.getElementById('detail-created').textContent = window.formatDateTime(ticket.created_at);
    document.getElementById('detail-updated').textContent = window.formatDateTime(ticket.updated_at);
    document.getElementById('detail-description').textContent = ticket.description;

    // Resolution Notes
    const resSection = document.getElementById('detail-resolution-section');
    const resNotes = document.getElementById('detail-resolution-notes');
    if (ticket.resolution_notes) {
      resSection.classList.remove('hidden');
      resNotes.textContent = ticket.resolution_notes;
    } else {
      resSection.classList.add('hidden');
      resNotes.textContent = '';
    }

    // Attachments Gallery
    const gallery = document.getElementById('detail-attachments-gallery');
    const attCount = document.getElementById('detail-attachment-count');
    const attachments = ticket.attachments || [];
    attCount.textContent = attachments.length;
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

    // Lifecycle Action Buttons
    renderLifecycleButtons(ticket);

    // Audit History Timeline
    renderHistoryTimeline(ticket.history || []);

    modal.classList.remove('hidden');
  } catch (err) {
    console.error('Error opening detail modal:', err);
    window.showToast(err.message, 'error');
  }
};

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
    btn.textContent = act.label;

    btn.addEventListener('click', () => {
      if (act.requiresNotes) {
        showPromptModal(act.nextStatus);
      } else {
        performStatusTransition(act.nextStatus);
      }
    });

    container.appendChild(btn);
  }
}

function renderHistoryTimeline(history) {
  const container = document.getElementById('detail-history-timeline');
  if (!container) return;
  container.innerHTML = '';

  if (history.length === 0) {
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

async function performStatusTransition(nextStatus, notes = null) {
  if (!activeTicketId) return;

  try {
    const payload = { status: nextStatus };
    if (notes) payload.notes = notes;

    const res = await fetch(`/api/tickets/${activeTicketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update status');
    }

    window.showToast(`Ticket status changed to ${nextStatus}`, 'success');

    // Reload detail modal
    window.openTicketDetail(activeTicketId);

    // Refresh tickets list and dashboard
    if (window.loadTickets) window.loadTickets();
    if (window.loadDashboardMetrics) window.loadDashboardMetrics();
  } catch (err) {
    console.error('Status transition error:', err);
    window.showToast(err.message, 'error');
  }
}

// Prompt Modal
function showPromptModal(nextStatus) {
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

