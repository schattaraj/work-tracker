(function () {
  'use strict';

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function toast(message, variant) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${variant || 'primary'} border-0`;
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${escapeHtml(message)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    container.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 3500 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }
  const spinner = (extraClass) => `<span class="spinner-border spinner-border-sm${extraClass ? ' ' + extraClass : ''}" role="status" aria-hidden="true"></span>`;

  const STATUS_BADGE = { active: 'success', pending: 'warning text-dark', suspended: 'danger', rejected: 'secondary' };

  let currentUserId = null;

  function showTableLoading() {
    document.getElementById('adminEmptyState').classList.add('d-none');
    document.getElementById('adminUsersBody').innerHTML =
      `<tr><td colspan="6" class="text-center text-muted py-4">${spinner('me-2')}Loading users…</td></tr>`;
  }

  async function loadMe() {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login.html'; return; }
    const { user } = await res.json();
    currentUserId = user.id;
    document.getElementById('adminWhoAmI').textContent = `${user.name} (${user.email})`;
  }

  async function loadUsers() {
    const res = await fetch('/api/admin/users');
    if (res.status === 403) {
      document.body.innerHTML = '<div class="p-5 text-center"><h4>Admins only.</h4><a href="/app.html">Back to app</a></div>';
      return;
    }
    if (!res.ok) {
      toast('Failed to load users.', 'danger');
      document.getElementById('adminUsersBody').innerHTML =
        '<tr><td colspan="6" class="text-center text-danger py-4">Failed to load users. <button type="button" class="btn btn-sm btn-outline-danger ms-2" id="btnRetryLoadUsers">Retry</button></td></tr>';
      document.getElementById('btnRetryLoadUsers')?.addEventListener('click', () => { showTableLoading(); loadUsers(); });
      return;
    }
    const { users } = await res.json();
    renderStats(users);
    renderTable(users);
  }

  function renderStats(users) {
    const counts = { total: users.length, pending: 0, active: 0, suspended: 0 };
    users.forEach(u => { if (counts[u.status] !== undefined) counts[u.status]++; });
    const cards = [
      { label: 'Total Users', value: counts.total, icon: 'bi-people-fill', cls: 's1' },
      { label: 'Pending Approval', value: counts.pending, icon: 'bi-hourglass-split', cls: 's4' },
      { label: 'Active', value: counts.active, icon: 'bi-check2-circle', cls: 's6' },
      { label: 'Suspended', value: counts.suspended, icon: 'bi-slash-circle', cls: 's8' }
    ];
    document.getElementById('adminStatsRow').innerHTML = cards.map(c => `
      <div class="col-6 col-lg-3">
        <div class="stat-card ${c.cls}"><i class="bi ${c.icon} stat-icon"></i><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div>
      </div>`).join('');
  }

  function renderTable(users) {
    const tbody = document.getElementById('adminUsersBody');
    tbody.innerHTML = users.map(u => {
      const badgeCls = STATUS_BADGE[u.status] || 'secondary';
      const actions = [];
      if (u.status !== 'active') actions.push(`<button type="button" class="btn btn-sm btn-outline-success" data-act="active" data-id="${u.id}"><i class="bi bi-check-lg"></i> Activate</button>`);
      if (u.status === 'active') actions.push(`<button type="button" class="btn btn-sm btn-outline-warning" data-act="suspended" data-id="${u.id}"><i class="bi bi-pause-fill"></i> Suspend</button>`);
      if (u.status === 'pending') actions.push(`<button type="button" class="btn btn-sm btn-outline-danger" data-act="rejected" data-id="${u.id}"><i class="bi bi-x-lg"></i> Reject</button>`);
      if (u.role === 'user') actions.push(`<button type="button" class="btn btn-sm btn-outline-primary" data-role-act="admin" data-id="${u.id}"><i class="bi bi-shield-plus"></i> Make Admin</button>`);
      if (u.role === 'admin') actions.push(`<button type="button" class="btn btn-sm btn-outline-secondary" data-role-act="user" data-id="${u.id}"><i class="bi bi-shield-minus"></i> Remove Admin</button>`);
      return `
        <tr>
          <td>${escapeHtml(u.name)}${u.id === currentUserId ? ' <span class="badge bg-secondary-subtle text-secondary-emphasis">You</span>' : ''}</td>
          <td>${escapeHtml(u.email)}</td>
          <td><span class="badge ${u.role === 'admin' ? 'bg-primary' : 'bg-secondary-subtle text-secondary-emphasis'}">${u.role}</span></td>
          <td><span class="badge text-bg-${badgeCls}">${u.status}</span></td>
          <td>${formatDate(u.createdAt)}</td>
          <td class="d-flex flex-wrap gap-1">${actions.join('')}</td>
        </tr>`;
    }).join('');
    document.getElementById('adminEmptyState').classList.toggle('d-none', users.length > 0);
  }

  async function patchUser(id, body) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || 'Action failed.', 'danger');
      return false;
    }
    return true;
  }

  document.getElementById('adminUsersBody').addEventListener('click', async (e) => {
    const statusBtn = e.target.closest('[data-act]');
    const roleBtn = e.target.closest('[data-role-act]');
    const actionBtn = statusBtn || roleBtn;
    if (!actionBtn) return;

    // Show a spinner on the button that was actually clicked, and disable
    // every action button in the table (not just this row) so a second
    // click can't fire a conflicting request while this one is in flight.
    const allActionButtons = Array.from(document.querySelectorAll('#adminUsersBody button[data-act], #adminUsersBody button[data-role-act]'));
    allActionButtons.forEach(b => { b.disabled = true; });
    const originalHtml = actionBtn.innerHTML;
    actionBtn.innerHTML = spinner();

    const ok = statusBtn
      ? await patchUser(statusBtn.dataset.id, { status: statusBtn.dataset.act })
      : await patchUser(roleBtn.dataset.id, { role: roleBtn.dataset.roleAct });

    if (ok) {
      toast('User updated.', 'success');
      await loadUsers(); // re-renders the whole table fresh, replacing these buttons entirely
    } else {
      // Request failed — the table wasn't touched, so restore the buttons
      // ourselves rather than leaving them stuck disabled/spinning.
      actionBtn.innerHTML = originalHtml;
      allActionButtons.forEach(b => { b.disabled = false; });
    }
  });

  document.getElementById('btnLogout').addEventListener('click', async () => {
    const btn = document.getElementById('btnLogout');
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = spinner('me-1') + 'Logging out…';
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    } catch (err) {
      toast('Network error — please try again.', 'danger');
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });

  (async function init() {
    showTableLoading();
    await loadMe();
    await loadUsers();
  })();
})();
