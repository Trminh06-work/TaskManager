(function () {
  function el(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function refreshTaskCount() {
    const list = document.getElementById('task-list');
    const count = list ? list.querySelectorAll('li.task').length : 0;
    const countEl = document.getElementById('task-count');
    if (countEl) countEl.textContent = count;
    const emptyMsg = document.getElementById('empty-msg');
    if (emptyMsg) emptyMsg.hidden = count > 0;
  }

  function taskHtml(task) {
    const desc = task.description
      ? `<span class="muted desc-text">${escapeHtml(task.description)}</span>`
      : `<span class="muted desc-text desc-empty"><em>No description</em></span>`;
    const due = task.due_date
      ? `<div class="muted small">Due: ${escapeHtml(task.due_date)}</div>`
      : '';
    const checked = task.status === 'done' ? '☑' : '☐';
    const doneClass = task.status === 'done' ? ' task-done' : '';
    return `
      <li class="task${doneClass}" data-task-id="${task.id}">
        <div class="task-main">
          <form method="POST" action="/tasks/${task.id}/toggle" class="inline">
            <button type="submit" class="toggle" aria-label="Toggle status">${checked}</button>
          </form>
          <div class="task-body">
            <strong>${escapeHtml(task.title)}</strong>
            <div class="desc-view" data-task-id="${task.id}">
              ${desc}
              <button type="button" class="link small edit-desc-btn" data-task-id="${task.id}">Edit</button>
            </div>
            <div class="desc-edit hidden" data-task-id="${task.id}">
              <textarea class="desc-input" rows="2">${escapeHtml(task.description || '')}</textarea>
              <div class="desc-edit-actions">
                <button type="button" class="primary small save-desc-btn" data-task-id="${task.id}">Save</button>
                <button type="button" class="small cancel-desc-btn" data-task-id="${task.id}">Cancel</button>
                <span class="desc-status muted small" data-task-id="${task.id}"></span>
              </div>
            </div>
            ${due}
          </div>
        </div>
        <div class="task-actions">
          <span class="badge">${escapeHtml(task.status)}</span>
          <button type="button" class="danger delete-task-btn" data-task-id="${task.id}">Delete</button>
        </div>
      </li>`;
  }

  function setEditing(id, editing) {
    el(`.desc-view[data-task-id="${id}"]`).classList.toggle('hidden', editing);
    el(`.desc-edit[data-task-id="${id}"]`).classList.toggle('hidden', !editing);
    if (editing) {
      const input = el(`.desc-edit[data-task-id="${id}"] .desc-input`);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function renderDescription(id, description) {
    const text = el(`.desc-view[data-task-id="${id}"] .desc-text`);
    text.textContent = '';
    if (description) {
      text.textContent = description;
      text.classList.remove('desc-empty');
    } else {
      const em = document.createElement('em');
      em.textContent = 'No description';
      text.appendChild(em);
      text.classList.add('desc-empty');
    }
  }

  async function saveDescription(id) {
    const input = el(`.desc-edit[data-task-id="${id}"] .desc-input`);
    const status = el(`.desc-status[data-task-id="${id}"]`);
    const saveBtn = el(`.save-desc-btn[data-task-id="${id}"]`);
    const newValue = input.value.trim();

    saveBtn.disabled = true;
    status.textContent = 'Saving…';

    try {
      const res = await fetch(`/api/tasks/${id}/description`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newValue })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const task = await res.json();
      renderDescription(id, task.description);
      setEditing(id, false);
      status.textContent = '';
    } catch (err) {
      status.textContent = 'Save failed: ' + err.message;
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function deleteTask(id, btn) {
    if (!confirm('Delete this task?')) return;
    btn.disabled = true;
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (res.status !== 204) throw new Error(`HTTP ${res.status}`);
      const li = btn.closest('li.task');
      if (li) li.remove();
      refreshTaskCount();
    } catch (err) {
      alert('Could not delete: ' + err.message);
      btn.disabled = false;
    }
  }

  async function createTask(form) {
    const data = new FormData(form);
    const body = {
      title: data.get('title'),
      description: data.get('description') || null,
      due_date: data.get('due_date') || null
    };
    const submitBtn = form.querySelector('button[type="submit"]');
    const status = document.getElementById('new-task-status');
    submitBtn.disabled = true;
    status.textContent = 'Adding…';
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status !== 201) throw new Error(`HTTP ${res.status}`);
      const task = await res.json();
      const list = document.getElementById('task-list');
      list.insertAdjacentHTML('afterbegin', taskHtml(task));
      form.reset();
      status.textContent = '';
      refreshTaskCount();
    } catch (err) {
      status.textContent = 'Could not add task: ' + err.message;
    } finally {
      submitBtn.disabled = false;
    }
  }

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'new-task-form') {
      e.preventDefault();
      createTask(e.target);
    }
  });

  document.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const id = target.dataset.taskId;
    if (!id) return;

    if (target.classList.contains('edit-desc-btn')) {
      setEditing(id, true);
    } else if (target.classList.contains('cancel-desc-btn')) {
      const original = el(`.desc-edit[data-task-id="${id}"] .desc-input`);
      const view = el(`.desc-view[data-task-id="${id}"] .desc-text`);
      original.value = view.classList.contains('desc-empty')
        ? ''
        : view.textContent.trim();
      el(`.desc-status[data-task-id="${id}"]`).textContent = '';
      setEditing(id, false);
    } else if (target.classList.contains('save-desc-btn')) {
      saveDescription(id);
    } else if (target.classList.contains('delete-task-btn')) {
      deleteTask(id, target);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('desc-input')) return;
    const id = e.target.closest('.desc-edit').dataset.taskId;
    if (e.key === 'Escape') {
      el(`.cancel-desc-btn[data-task-id="${id}"]`).click();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      saveDescription(id);
    }
  });
})();
