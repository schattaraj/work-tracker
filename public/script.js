/* ==========================================================================
   DevTrack — Personal Developer Work Tracker
   Vanilla JS (ES6+), Bootstrap 5, Web Speech API.
   Data (tasks/bugs/logs/screenshots/etc.) is a shared workspace persisted
   server-side as JSON via /api/data (see lib/store.js) — every active,
   logged-in user reads and writes the same file. Only per-browser UI
   preferences (theme/accent/compact/large-text) stay in localStorage, since
   those are personal, tiny, and not what was filling up storage.
   Organized into cohesive modules (objects/classes) that each own one
   concern. Event delegation is used for any dynamically-rendered lists so
   listeners never need to be re-bound.
   ========================================================================== */

(function () {
  'use strict';

  /* ========================================================================
     CONSTANTS
     ==================================================================== */
  const SETTINGS_KEY = 'devtrack_settings_v1';
  const PAGE_SIZE = 8;
  const STATUS_LIST = ['Todo', 'In Progress', 'Waiting', 'Testing', 'Completed', 'Blocked'];
  const KANBAN_STATUSES = ['Todo', 'In Progress', 'Waiting', 'Testing', 'Completed', 'Blocked'];
  const PRIORITY_LIST = ['Low', 'Medium', 'High', 'Critical'];
  const CATEGORY_LIST = ['Feature', 'Bug', 'Learning', 'Meeting', 'Research', 'Personal'];
  const BUG_STATUS_LIST = ['Open', 'In Progress', 'Retesting', 'Resolved', 'Closed', 'Reopened'];
  const VIEWS = ['dashboard', 'tasks', 'bugs', 'dailylog', 'voice', 'screenshots', 'kanban', 'calendar', 'reports', 'settings'];

  /* ========================================================================
     UTILS — small, reusable, pure helper functions
     ==================================================================== */
  const Utils = {
    uid() {
      return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    },
    todayStr() { return Utils.toDateStr(new Date()); },
    toDateStr(d) {
      const yy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    },
    nowIso() { return new Date().toISOString(); },
    formatDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    },
    formatDateTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
    timeAgo(iso) {
      if (!iso) return '';
      const diff = Date.now() - new Date(iso).getTime();
      const s = Math.floor(diff / 1000);
      if (s < 5) return 'just now';
      if (s < 60) return `${s}s ago`;
      const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
      const d2 = Math.floor(h / 24); if (d2 < 30) return `${d2}d ago`;
      return `${Math.floor(d2 / 30)}mo ago`;
    },
    escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    debounce(fn, wait) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    },
    clamp(n, min, max) { return Math.min(max, Math.max(min, n)); },
    cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); },
    markdownLite(text) {
      if (!text || !text.trim()) return '<span class="text-muted">Nothing here yet…</span>';
      let escaped = Utils.escapeHtml(text);
      escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
      escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      const lines = escaped.split('\n');
      let html = '', inList = false;
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ')) {
          if (!inList) { html += '<ul>'; inList = true; }
          html += `<li>${trimmed.slice(2)}</li>`;
        } else {
          if (inList) { html += '</ul>'; inList = false; }
          html += trimmed.length ? `<p>${line}</p>` : '';
        }
      });
      if (inList) html += '</ul>';
      return html || '<span class="text-muted">Nothing here yet…</span>';
    },
    downloadFile(filename, content, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
    readFileAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }
  };

  /* ========================================================================
     STORE — shared workspace data, persisted server-side via /api/data.
     `load()` fetches the current JSON once at boot; every mutation after
     that happens on the in-memory `data` object (so the UI stays perfectly
     synchronous and unchanged), with `save()` firing an async PUT to persist
     it. Failures surface as a toast rather than being silently lost.
     ==================================================================== */
  const Store = {
    data: null,
    defaultData() {
      return {
        tasks: [], bugs: [], dailyLogs: {}, voiceNotes: [], screenshots: [], activity: [],
        meta: { taskSeq: 0, bugSeq: 0 }
      };
    },
    async load() {
      try {
        const res = await fetch('/api/data', { credentials: 'same-origin' });
        if (res.status === 401) {
          window.location.href = '/login.html';
          return this.data = this.defaultData();
        }
        if (!res.ok) throw new Error(`GET /api/data → ${res.status}`);
        this.data = Object.assign(this.defaultData(), await res.json());
        if (!this.data.meta) this.data.meta = this.defaultData().meta;
      } catch (e) {
        console.error('DevTrack: failed to load workspace data.', e);
        toast('Could not load your workspace — check your connection and reload.', 'danger', { delay: 8000 });
        this.data = this.defaultData();
      }
      return this.data;
    },
    async save() {
      try {
        const res = await fetch('/api/data', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.data)
        });
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        if (!res.ok) throw new Error(`PUT /api/data → ${res.status}`);
      } catch (e) {
        console.error('DevTrack: failed to save workspace data.', e);
        toast('Failed to save — check your connection. Your changes are only on this screen until it saves.', 'danger', { delay: 6000 });
      }
    },
    nextId(prefix, counterKey) {
      this.data.meta[counterKey] = (this.data.meta[counterKey] || 0) + 1;
      return `${prefix}-${this.data.meta[counterKey]}`;
    }
  };

  /* ========================================================================
     APP SETTINGS — personal UI preferences only (theme/accent/compact/large
     text). Small and per-browser, so this stays in localStorage rather than
     the shared server workspace.
     ==================================================================== */
  const AppSettings = {
    data: null,
    defaults() { return { theme: 'light', accent: 'blue', compact: false, largeText: false }; },
    load() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
      } catch {
        this.data = this.defaults();
      }
      return this.data;
    },
    save() {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
    }
  };

  /* ========================================================================
     AUTH — who's logged in, admin-gating of dangerous UI, logout.
     The server (middleware + every API route) is the real enforcement;
     this just drives what the signed-in user sees and can click.
     ==================================================================== */
  const Auth = {
    user: null,
    async init() {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (!res.ok) { window.location.href = '/login.html'; return false; }
        const data = await res.json();
        Auth.user = data.user;
      } catch (e) {
        console.error('DevTrack: failed to load session.', e);
        window.location.href = '/login.html';
        return false;
      }

      const isAdmin = Auth.user.role === 'admin';
      const nameEl = document.getElementById('navUserName');
      if (nameEl) nameEl.textContent = `${Auth.user.name} · ${Auth.user.email}`;
      const adminLink = document.getElementById('navAdminLink');
      if (adminLink) adminLink.classList.toggle('d-none', !isAdmin);
      document.querySelectorAll('.admin-only-action, .admin-only-note').forEach(el => el.classList.toggle('d-none', !isAdmin));

      const logoutBtn = document.getElementById('btnLogout');
      if (logoutBtn) logoutBtn.addEventListener('click', Auth.logout);

      return true;
    },
    async logout() {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      window.location.href = '/login.html';
    }
  };

  /* ========================================================================
     TEAM MEMBERS — roster of active accounts, used to populate the
     "Assign To" dropdown on team tasks and to resolve id → name for display.
     ==================================================================== */
  const TeamMembers = {
    list: [],
    async load() {
      try {
        const res = await fetch('/api/team', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        TeamMembers.list = data.members || [];
      } catch (e) {
        console.error('DevTrack: failed to load team members.', e);
      }
    },
    nameFor(id) {
      if (!id) return '';
      const m = TeamMembers.list.find(x => x.id === id);
      return m ? m.name : 'Former member';
    },
    initialsFor(id) {
      const name = TeamMembers.nameFor(id);
      if (!name) return '?';
      const parts = name.trim().split(/\s+/);
      return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
    },
    populateSelect(selectEl, selectedId) {
      selectEl.innerHTML = '<option value="">Unassigned</option>' +
        TeamMembers.list.map(m => `<option value="${m.id}">${Utils.escapeHtml(m.name)}${Auth.user && m.id === Auth.user.id ? ' (You)' : ''}</option>`).join('');
      selectEl.value = selectedId || '';
    }
  };

  /* ========================================================================
     APP STATE (in-memory / transient UI state)
     ==================================================================== */
  const State = {
    currentView: 'dashboard',
    taskFilters: { status: '', priority: '', category: '', project: '', date: '', created: '', taskType: 'personal', assignee: '', favorite: false, pinned: false, archived: false },
    taskPage: 1,
    bugFilters: { status: '', severity: '', priority: '', module: '' }
  };

  let lastDeletedRestore = null;

  /* ========================================================================
     TOAST / CONFIRM / ACTIVITY — shared UI helpers
     ==================================================================== */
  function toast(message, variant = 'primary', opts = {}) {
    const container = document.getElementById('toastContainer');
    const id = 'toast-' + Utils.uid();
    const actionHtml = opts.actionLabel ? `<button type="button" class="btn btn-sm btn-light ms-2" id="${id}-action">${Utils.escapeHtml(opts.actionLabel)}</button>` : '';
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${variant} border-0`;
    el.id = id;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${Utils.escapeHtml(message)}${actionHtml}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    container.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: opts.delay || 3500 });
    if (opts.onAction) {
      el.querySelector(`#${id}-action`).addEventListener('click', () => { opts.onAction(); t.hide(); });
    }
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
    return t;
  }

  function offerUndo(message, restoreFn) {
    lastDeletedRestore = restoreFn;
    toast(message, 'dark', {
      actionLabel: 'Undo', delay: 6000,
      onAction: () => { if (lastDeletedRestore) { lastDeletedRestore(); lastDeletedRestore = null; } }
    });
  }

  function confirmAction(title, body, onConfirm) {
    document.getElementById('confirmModalTitle').innerHTML = `<i class="bi bi-exclamation-triangle-fill text-warning me-2"></i>${Utils.escapeHtml(title)}`;
    document.getElementById('confirmModalBody').textContent = body;
    const modalEl = document.getElementById('confirmModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const oldBtn = document.getElementById('btnConfirmAction');
    const newBtn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(newBtn, oldBtn);
    newBtn.addEventListener('click', () => { onConfirm(); modal.hide(); });
    modal.show();
  }

  function addActivity(icon, message) {
    Store.data.activity.unshift({ id: Utils.uid(), icon, message, date: Utils.nowIso() });
    if (Store.data.activity.length > 200) Store.data.activity.length = 200;
    Store.save();
    renderActivity();
  }

  function renderActivity() {
    const recent = Store.data.activity.slice(0, 8);
    const dashEl = document.getElementById('dashActivityList');
    if (dashEl) {
      dashEl.innerHTML = recent.length ? recent.map(a => `
        <div class="list-group-item d-flex align-items-start gap-2 px-0">
          <i class="bi ${a.icon} mt-1"></i>
          <div class="flex-fill">
            <div>${Utils.escapeHtml(a.message)}</div>
            <div class="text-muted" style="font-size:.72rem;">${Utils.timeAgo(a.date)}</div>
          </div>
        </div>`).join('') : '<p class="text-muted small mb-0">No recent activity.</p>';
    }
    const ocEl = document.getElementById('activityOffcanvasList');
    if (ocEl) {
      const items = Store.data.activity.slice(0, 50);
      ocEl.innerHTML = items.length ? items.map(a => `
        <div class="list-group-item d-flex align-items-start gap-2">
          <i class="bi ${a.icon} mt-1"></i>
          <div class="flex-fill">
            <div>${Utils.escapeHtml(a.message)}</div>
            <div class="text-muted" style="font-size:.72rem;">${Utils.formatDateTime(a.date)}</div>
          </div>
        </div>`).join('') : '<p class="text-muted small">No activity yet.</p>';
    }
    const dot = document.getElementById('activityDot');
    if (dot) dot.classList.toggle('d-none', Store.data.activity.length === 0);
  }

  /* ========================================================================
     VOICE RECORDER — Web Speech API wrapper (Start/Stop/Pause/Resume)
     ==================================================================== */
  class VoiceRecorder {
    constructor(container) {
      this.container = container;
      this.context = container.dataset.context;
      this.targetFieldId = container.dataset.targetField;
      this.targetEl = this.targetFieldId ? document.getElementById(this.targetFieldId) : null;
      this.isSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      this.finalTranscript = '';
      this.isRecording = false;
      this.isPaused = false;
      this.renderUI();
      if (this.isSupported) this.setupRecognition();
    }
    renderUI() {
      this.container.innerHTML = `
        <span class="mic-indicator" data-role="mic" title="Microphone status"></span>
        <button type="button" class="btn btn-sm btn-outline-danger" data-action="start" ${this.isSupported ? '' : 'disabled'}><i class="bi bi-mic-fill me-1"></i>Start</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="stop" disabled><i class="bi bi-stop-fill me-1"></i>Stop</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="pause" disabled><i class="bi bi-pause-fill me-1"></i>Pause</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="resume" disabled><i class="bi bi-play-fill me-1"></i>Resume</button>
        ${this.isSupported ? '' : '<span class="small text-danger ms-1">Not supported in this browser</span>'}
      `;
      this.btnStart = this.container.querySelector('[data-action="start"]');
      this.btnStop = this.container.querySelector('[data-action="stop"]');
      this.btnPause = this.container.querySelector('[data-action="pause"]');
      this.btnResume = this.container.querySelector('[data-action="resume"]');
      this.micEl = this.container.querySelector('[data-role="mic"]');
      this.btnStart.addEventListener('click', () => this.start());
      this.btnStop.addEventListener('click', () => this.stop());
      this.btnPause.addEventListener('click', () => this.pause());
      this.btnResume.addEventListener('click', () => this.resume());
    }
    setupRecognition() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SR();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
      this.recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) this.finalTranscript += res[0].transcript + ' ';
          else interim += res[0].transcript;
        }
        this.updateTarget(this.finalTranscript + interim);
      };
      this.recognition.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          toast('Microphone access denied. Please allow microphone permissions in your browser.', 'danger');
          this.forceStopUI();
        } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('Speech recognition error:', e.error);
        }
      };
      this.recognition.onend = () => {
        if (this.isRecording && !this.isPaused) {
          try { this.recognition.start(); } catch (err) { /* already running */ }
        } else {
          this.micEl.classList.remove('live');
        }
      };
    }
    updateTarget(text) {
      if (this.targetEl) {
        this.targetEl.value = text;
        this.targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    start() {
      if (!this.isSupported) return;
      this.finalTranscript = this.targetEl && this.targetEl.value ? this.targetEl.value + ' ' : '';
      this.isRecording = true; this.isPaused = false;
      try { this.recognition.start(); } catch (err) { /* noop */ }
      this.micEl.classList.add('live');
      this.btnStart.disabled = true; this.btnStop.disabled = false; this.btnPause.disabled = false; this.btnResume.disabled = true;
    }
    stop() {
      this.isRecording = false; this.isPaused = false;
      try { this.recognition.stop(); } catch (err) { /* noop */ }
      this.micEl.classList.remove('live');
      this.btnStart.disabled = false; this.btnStop.disabled = true; this.btnPause.disabled = true; this.btnResume.disabled = true;
    }
    pause() {
      if (!this.isRecording) return;
      this.isPaused = true;
      try { this.recognition.stop(); } catch (err) { /* noop */ }
      this.micEl.classList.remove('live');
      this.btnPause.disabled = true; this.btnResume.disabled = false; this.btnStop.disabled = false;
    }
    resume() {
      if (!this.isPaused) return;
      this.isPaused = false;
      try { this.recognition.start(); } catch (err) { /* noop */ }
      this.micEl.classList.add('live');
      this.btnPause.disabled = false; this.btnResume.disabled = true;
    }
    forceStopUI() {
      this.isRecording = false; this.isPaused = false;
      this.micEl.classList.remove('live');
      this.btnStart.disabled = false; this.btnStop.disabled = true; this.btnPause.disabled = true; this.btnResume.disabled = true;
    }
  }

  function initVoiceRecorders() {
    document.querySelectorAll('.voice-recorder').forEach(el => new VoiceRecorder(el));
    const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const alertEl = document.getElementById('speechUnsupported');
    if (alertEl) alertEl.classList.toggle('d-none', supported);
  }

  /* ========================================================================
     CHARTS — thin Chart.js wrapper; colors come from CSS vars (theme-aware)
     ==================================================================== */
  const Charts = {
    instances: {},
    destroy(id) { if (Charts.instances[id]) { Charts.instances[id].destroy(); delete Charts.instances[id]; } },
    renderPie(id, labels, data, colors) {
      Charts.destroy(id);
      const ctx = document.getElementById(id);
      if (!ctx || typeof Chart === 'undefined') return;
      Charts.instances[id] = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: Utils.cssVar('--surface-1'), borderWidth: 2 }] },
        options: { plugins: { legend: { position: 'bottom', labels: { color: Utils.cssVar('--text-secondary'), boxWidth: 12, padding: 12 } } }, cutout: '62%', maintainAspectRatio: false }
      });
    },
    renderBarCategorical(id, labels, data, colors) {
      Charts.destroy(id);
      const ctx = document.getElementById(id);
      if (!ctx || typeof Chart === 'undefined') return;
      Charts.instances[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 40 }] },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: Utils.cssVar('--text-secondary') } },
            y: { beginAtZero: true, ticks: { precision: 0, color: Utils.cssVar('--text-secondary') }, grid: { color: Utils.cssVar('--gridline') } }
          }
        }
      });
    },
    renderBarSingle(id, labels, data, color, label) {
      Charts.destroy(id);
      const ctx = document.getElementById(id);
      if (!ctx || typeof Chart === 'undefined') return;
      Charts.instances[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: label || 'Count', data, backgroundColor: color, borderRadius: 4, maxBarThickness: 40 }] },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: Utils.cssVar('--text-secondary') } },
            y: { beginAtZero: true, ticks: { precision: 0, color: Utils.cssVar('--text-secondary') }, grid: { color: Utils.cssVar('--gridline') } }
          }
        }
      });
    }
  };

  /* ========================================================================
     SCREENSHOT MANAGER
     ==================================================================== */
  const ScreenshotManager = {
    add(files, linkedType, linkedId, onDone) {
      const arr = Array.from(files || []);
      if (!arr.length) return;
      let remaining = arr.length;
      arr.forEach(file => {
        Utils.readFileAsDataURL(file).then(dataUrl => {
          Store.data.screenshots.push({ id: Utils.uid(), name: file.name, dataUrl, date: Utils.nowIso(), linkedType, linkedId });
          Store.save();
        }).catch(err => console.error(err)).finally(() => {
          remaining--;
          if (remaining === 0) {
            addActivity('bi-image', 'Uploaded screenshot(s)');
            if (onDone) onDone();
          }
        });
      });
    },
    getFor(linkedType, linkedId) {
      return Store.data.screenshots.filter(s => s.linkedType === linkedType && s.linkedId === linkedId);
    },
    delete(id, onDone) {
      const idx = Store.data.screenshots.findIndex(s => s.id === id);
      if (idx === -1) return;
      const [removed] = Store.data.screenshots.splice(idx, 1);
      Store.save();
      if (onDone) onDone();
      offerUndo('Screenshot deleted.', () => { Store.data.screenshots.push(removed); Store.save(); if (onDone) onDone(); });
    },
    renderGrid(container, linkedType, linkedId, opts = {}) {
      const items = ScreenshotManager.getFor(linkedType, linkedId);
      if (!items.length) { container.innerHTML = opts.emptyHtml || ''; return; }
      container.innerHTML = items.map(s => `
        <div class="${opts.colClass || 'col-6 col-md-4 col-lg-3'}">
          <div class="screenshot-thumb">
            <img src="${s.dataUrl}" data-id="${s.id}" alt="${Utils.escapeHtml(s.name)}">
            <div class="thumb-actions">
              <button type="button" class="btn btn-light btn-sm" data-shot-view="${s.id}" title="View"><i class="bi bi-arrows-fullscreen"></i></button>
              <button type="button" class="btn btn-light btn-sm" data-shot-download="${s.id}" title="Download"><i class="bi bi-download"></i></button>
              <button type="button" class="btn btn-danger btn-sm" data-shot-delete="${s.id}" title="Delete"><i class="bi bi-trash3"></i></button>
            </div>
            <div class="thumb-caption">${Utils.escapeHtml(s.name)}</div>
          </div>
        </div>`).join('');
    },
    renderGallery() {
      ScreenshotManager.renderGrid(document.getElementById('screenshotGallery'), 'gallery', null, { emptyHtml: '' });
      document.getElementById('screenshotsEmptyState').classList.toggle('d-none', ScreenshotManager.getFor('gallery', null).length > 0);
    }
  };

  function refreshAllScreenshotGrids() {
    if (State.currentView === 'screenshots') ScreenshotManager.renderGallery();
    if (TaskManager.draft) TaskManager.renderTaskScreenshots();
    if (BugManager.draft) BugManager.renderScreenshots();
  }

  let viewerShotId = null, viewerZoom = 1;
  function openImageViewer(id) {
    const s = Store.data.screenshots.find(x => x.id === id);
    if (!s) return;
    viewerShotId = id; viewerZoom = 1;
    document.getElementById('imageViewerImg').src = s.dataUrl;
    document.getElementById('imageViewerImg').style.transform = 'scale(1)';
    document.getElementById('imageViewerTitle').textContent = s.name;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('imageViewerModal')).show();
  }

  /* ========================================================================
     TASK MANAGER
     ==================================================================== */
  const TaskManager = {
    draft: null, isNew: false, originalSnapshot: null, savedThisSession: false, timerInterval: null,

    getById(id) { return Store.data.tasks.find(t => t.id === id); },

    blank() {
      const now = Utils.nowIso();
      return {
        id: Store.nextId('TASK', 'taskSeq'), title: '', description: '', category: 'Feature', priority: 'Medium',
        status: 'Todo', tags: [], project: '', createdDate: now, updatedDate: now, dueDate: '',
        estimatedHours: '', actualHours: '', checklist: [], notes: '', favorite: false, pinned: false,
        archived: false, history: [{ date: now, message: 'Task created' }], timerStart: null,
        // Team assignment: personal tasks are just the creator's own; team
        // tasks can be handed to any other active member.
        taskType: State.taskFilters.taskType === 'team' ? 'team' : 'personal',
        assigneeId: '',
        createdById: Auth.user ? Auth.user.id : null,
        createdByName: Auth.user ? Auth.user.name : ''
      };
    },

    checklistPct(t) {
      if (!t.checklist || !t.checklist.length) return 0;
      return Math.round(t.checklist.filter(c => c.done).length / t.checklist.length * 100);
    },

    dueBadge(t) {
      if (!t.dueDate) return '';
      const due = new Date(t.dueDate + 'T23:59:59');
      const now = new Date();
      if (t.status === 'Completed') return `<span class="badge bg-secondary-subtle text-secondary-emphasis">${Utils.formatDate(t.dueDate)}</span>`;
      const diffDays = Math.floor((due - now) / 86400000);
      if (diffDays < 0) return `<span class="badge badge-due-overdue">Overdue</span>`;
      if (diffDays === 0) return `<span class="badge badge-due-today">Due Today</span>`;
      if (diffDays <= 3) return `<span class="badge badge-due-soon">Due Soon</span>`;
      return `<span class="badge bg-secondary-subtle text-secondary-emphasis">${Utils.formatDate(t.dueDate)}</span>`;
    },

    assigneeChip(t) {
      if ((t.taskType || 'personal') !== 'team') return '<span class="text-muted small">—</span>';
      if (!t.assigneeId) return '<span class="badge bg-secondary-subtle text-secondary-emphasis">Unassigned</span>';
      const name = TeamMembers.nameFor(t.assigneeId);
      return `<span class="assignee-chip"><span class="avatar-badge">${Utils.escapeHtml(TeamMembers.initialsFor(t.assigneeId))}</span>${Utils.escapeHtml(name)}</span>`;
    },

    openModal(id = null) {
      const modalEl = document.getElementById('taskModal');
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      if (id) {
        const t = TaskManager.getById(id);
        if (!t) return;
        TaskManager.draft = JSON.parse(JSON.stringify(t));
        TaskManager.originalSnapshot = JSON.parse(JSON.stringify(t));
        TaskManager.isNew = false;
        document.getElementById('taskModalTitle').innerHTML = `<i class="bi bi-card-checklist me-2"></i>Edit Task <span class="text-secondary small">#${t.id}</span>`;
        document.getElementById('btnDeleteTaskModal').classList.remove('d-none');
      } else {
        TaskManager.draft = TaskManager.blank();
        TaskManager.originalSnapshot = null;
        TaskManager.isNew = true;
        document.getElementById('taskModalTitle').innerHTML = `<i class="bi bi-card-checklist me-2"></i>New Task`;
        document.getElementById('btnDeleteTaskModal').classList.add('d-none');
      }
      TaskManager.savedThisSession = false;
      TaskManager.fillForm();
      const firstTabBtn = modalEl.querySelector('#taskModalTabs .nav-link');
      bootstrap.Tab.getOrCreateInstance(firstTabBtn).show();
      modal.show();
    },

    fillForm() {
      const d = TaskManager.draft;
      document.getElementById('taskId').value = d.id;
      document.getElementById('taskTitle').value = d.title;
      document.getElementById('taskDescription').value = d.description;
      document.getElementById('taskType').value = d.taskType || 'personal';
      document.getElementById('taskAssigneeWrap').classList.toggle('d-none', (d.taskType || 'personal') !== 'team');
      TeamMembers.populateSelect(document.getElementById('taskAssignee'), d.assigneeId);
      document.getElementById('taskCategory').value = d.category;
      document.getElementById('taskPriority').value = d.priority;
      document.getElementById('taskStatus').value = d.status;
      document.getElementById('taskProject').value = d.project;
      document.getElementById('taskTags').value = (d.tags || []).join(', ');
      document.getElementById('taskDueDate').value = d.dueDate || '';
      document.getElementById('taskEstHours').value = d.estimatedHours || '';
      document.getElementById('taskActHours').value = d.actualHours || '';
      document.getElementById('taskNotes').value = d.notes || '';
      document.getElementById('taskFavorite').checked = !!d.favorite;
      document.getElementById('taskPinned').checked = !!d.pinned;
      document.getElementById('taskArchived').checked = !!d.archived;
      document.getElementById('taskMetaLabel').textContent = `Created ${Utils.formatDateTime(d.createdDate)}${d.createdByName ? ' by ' + d.createdByName : ''} · Updated ${Utils.formatDateTime(d.updatedDate)}`;
      document.getElementById('taskNotesPreview').innerHTML = Utils.markdownLite(d.notes);
      document.getElementById('taskVoiceOutput').value = '';
      TaskManager.populateProjectOptions();
      TaskManager.renderChecklist();
      TaskManager.renderTaskScreenshots();
      TaskManager.renderTaskVoiceNotes();
      TaskManager.renderHistory();
      TaskManager.resetTimerUI();
    },

    renderChecklist() {
      const d = TaskManager.draft;
      const list = document.getElementById('checklistItems');
      list.innerHTML = d.checklist.map(c => `
        <li class="list-group-item d-flex align-items-center gap-2" data-cid="${c.id}">
          <input type="checkbox" class="form-check-input" ${c.done ? 'checked' : ''} data-cl-action="toggle">
          <span class="flex-fill ${c.done ? 'text-decoration-line-through text-muted' : ''}">${Utils.escapeHtml(c.text)}</span>
          <button type="button" class="btn btn-sm btn-outline-danger" data-cl-action="remove"><i class="bi bi-x-lg"></i></button>
        </li>`).join('') || '<li class="list-group-item text-muted small">No checklist items yet.</li>';
      document.getElementById('checklistProgressBar').style.width = TaskManager.checklistPct(d) + '%';
    },

    addChecklistItem() {
      const input = document.getElementById('checklistInput');
      const text = input.value.trim();
      if (!text) return;
      TaskManager.draft.checklist.push({ id: Utils.uid(), text, done: false });
      input.value = '';
      TaskManager.renderChecklist();
    },

    renderTaskScreenshots() {
      ScreenshotManager.renderGrid(document.getElementById('taskScreenshotGrid'), 'task', TaskManager.draft.id,
        { colClass: 'col-6 col-md-4', emptyHtml: '<p class="text-muted small">No screenshots attached.</p>' });
    },

    renderTaskVoiceNotes() {
      const items = Store.data.voiceNotes.filter(v => v.linkedType === 'task' && v.linkedId === TaskManager.draft.id);
      document.getElementById('taskVoiceNotesList').innerHTML = items.length ? items.map(v => `
        <div class="list-group-item" data-vn="${v.id}">
          <div class="d-flex justify-content-between">
            <small class="text-muted">${Utils.formatDateTime(v.date)}</small>
            <button type="button" class="btn btn-sm btn-link text-danger p-0" data-vn-delete="${v.id}"><i class="bi bi-trash3"></i></button>
          </div>
          <div>${Utils.escapeHtml(v.text)}</div>
        </div>`).join('') : '<p class="text-muted small">No saved voice notes for this task.</p>';
    },

    renderHistory() {
      const items = TaskManager.draft.history.slice().reverse();
      document.getElementById('taskHistoryList').innerHTML = items.map(h => `
        <li class="list-group-item d-flex justify-content-between">
          <span>${Utils.escapeHtml(h.message)}</span>
          <span class="text-muted">${Utils.formatDateTime(h.date)}</span>
        </li>`).join('') || '<li class="list-group-item text-muted">No history yet.</li>';
    },

    populateProjectOptions() {
      const projects = Array.from(new Set(Store.data.tasks.map(t => t.project).filter(Boolean)));
      document.getElementById('projectList').innerHTML = projects.map(p => `<option value="${Utils.escapeHtml(p)}">`).join('');
    },

    resetTimerUI() {
      const btn = document.getElementById('btnTimerToggle');
      const disp = document.getElementById('timerDisplay');
      if (TaskManager.timerInterval) { clearInterval(TaskManager.timerInterval); TaskManager.timerInterval = null; }
      if (TaskManager.draft.timerStart) {
        btn.innerHTML = '<i class="bi bi-stop-fill"></i> Stop Timer';
        btn.classList.remove('btn-outline-success'); btn.classList.add('btn-outline-danger');
        TaskManager.timerInterval = setInterval(TaskManager.tickTimer, 1000);
        TaskManager.tickTimer();
      } else {
        btn.innerHTML = '<i class="bi bi-play-fill"></i> Start Timer';
        btn.classList.add('btn-outline-success'); btn.classList.remove('btn-outline-danger');
        disp.textContent = TaskManager.formatDuration(Math.round((parseFloat(TaskManager.draft.actualHours) || 0) * 3600));
      }
    },
    tickTimer() {
      const d = TaskManager.draft; if (!d || !d.timerStart) return;
      const baseSec = Math.round((parseFloat(d.actualHours) || 0) * 3600);
      const elapsed = Math.floor((Date.now() - new Date(d.timerStart).getTime()) / 1000);
      document.getElementById('timerDisplay').textContent = TaskManager.formatDuration(baseSec + elapsed);
    },
    formatDuration(totalSec) {
      totalSec = Math.max(0, totalSec);
      const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      return `${h}:${m}:${s}`;
    },

    // Computes a [start, end] Date window for the "Created Date" filter, anchored
    // on today's local date. Used to bucket tasks by their createdDate.
    createdRange(key) {
      const now = new Date();
      const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const today0 = startOfDay(now);
      const endOfToday = new Date(today0.getTime() + 86400000 - 1);
      switch (key) {
        case 'today':
          return { start: today0, end: endOfToday };
        case 'last2': {
          const start = new Date(today0); start.setDate(start.getDate() - 1);
          return { start, end: endOfToday };
        }
        case 'week': {
          const start = new Date(today0); start.setDate(start.getDate() - start.getDay());
          const end = new Date(start.getTime() + 7 * 86400000 - 1);
          return { start, end };
        }
        case 'month': {
          const start = new Date(now.getFullYear(), now.getMonth(), 1);
          const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() - 1;
          return { start, end: new Date(end) };
        }
        default:
          return null;
      }
    },

    getFiltered() {
      const f = State.taskFilters;
      let list = Store.data.tasks.slice();
      list = list.filter(t => {
        if (f.taskType && (t.taskType || 'personal') !== f.taskType) return false;
        if (f.assignee === 'me' && (!Auth.user || t.assigneeId !== Auth.user.id)) return false;
        if (f.assignee === 'unassigned' && t.assigneeId) return false;
        if (f.status && t.status !== f.status) return false;
        if (f.priority && t.priority !== f.priority) return false;
        if (f.category && t.category !== f.category) return false;
        if (f.project && t.project !== f.project) return false;
        if (f.favorite && !t.favorite) return false;
        if (f.pinned && !t.pinned) return false;
        if (f.archived) { if (!t.archived) return false; } else { if (t.archived) return false; }
        if (f.date) {
          if (!t.dueDate) return false;
          const due = new Date(t.dueDate + 'T00:00:00');
          const today = new Date(Utils.todayStr() + 'T00:00:00');
          if (f.date === 'overdue' && !(due < today && t.status !== 'Completed')) return false;
          if (f.date === 'today' && t.dueDate !== Utils.todayStr()) return false;
          if (f.date === 'week') {
            const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
            if (!(due >= today && due <= weekEnd)) return false;
          }
        }
        if (f.created) {
          const range = TaskManager.createdRange(f.created);
          const created = new Date(t.createdDate);
          if (!range || !(created >= range.start && created <= range.end)) return false;
        }
        return true;
      });
      list.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return new Date(b.updatedDate) - new Date(a.updatedDate);
      });
      return list;
    },

    populateFilterOptions() {
      const statusSel = document.getElementById('filterStatus');
      if (statusSel.options.length <= 1) STATUS_LIST.forEach(s => statusSel.add(new Option(s, s)));
      const prioSel = document.getElementById('filterPriority');
      if (prioSel.options.length <= 1) PRIORITY_LIST.forEach(p => prioSel.add(new Option(p, p)));
      const catSel = document.getElementById('filterCategory');
      if (catSel.options.length <= 1) CATEGORY_LIST.forEach(c => catSel.add(new Option(c, c)));
      const projSel = document.getElementById('filterProject');
      const currentVal = projSel.value;
      const projects = Array.from(new Set(Store.data.tasks.map(t => t.project).filter(Boolean)));
      projSel.innerHTML = '<option value="">All Projects</option>' + projects.map(p => `<option value="${Utils.escapeHtml(p)}">${Utils.escapeHtml(p)}</option>`).join('');
      projSel.value = currentVal;
    },

    renderList() {
      TaskManager.populateFilterOptions();
      const all = TaskManager.getFiltered();
      const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
      State.taskPage = Utils.clamp(State.taskPage, 1, totalPages);
      const pageItems = all.slice((State.taskPage - 1) * PAGE_SIZE, State.taskPage * PAGE_SIZE);
      const tbody = document.getElementById('tasksTableBody');
      tbody.innerHTML = pageItems.map(t => {
        const pct = TaskManager.checklistPct(t);
        return `
        <tr data-id="${t.id}">
          <td>
            <div class="d-flex flex-column align-items-center gap-1">
              <i class="bi ${t.favorite ? 'bi-star-fill text-warning' : 'bi-star'} pin-star-btn" data-action="fav" title="Favorite"></i>
              <i class="bi ${t.pinned ? 'bi-pin-angle-fill text-primary' : 'bi-pin-angle'} pin-star-btn" data-action="pin" title="Pin"></i>
            </div>
          </td>
          <td>
            <div class="fw-semibold" data-action="open" role="button" style="cursor:pointer;">${Utils.escapeHtml(t.title)}${t.archived ? ' <span class="badge bg-secondary-subtle text-secondary-emphasis">Archived</span>' : ''}</div>
            <div class="small text-muted text-truncate" style="max-width:320px;">${Utils.escapeHtml(t.description || '')}</div>
            <div class="mt-1">${(t.tags || []).map(tag => `<span class="badge bg-secondary-subtle text-secondary-emphasis me-1">#${Utils.escapeHtml(tag)}</span>`).join('')}</div>
          </td>
          <td class="d-none d-md-table-cell"><span class="badge bg-secondary-subtle text-secondary-emphasis">${t.category}</span></td>
          <td class="d-none d-xl-table-cell">${TaskManager.assigneeChip(t)}</td>
          <td><span class="badge badge-priority-${t.priority}">${t.priority}</span></td>
          <td><span class="badge badge-status-${t.status.replace(' ', '')}">${t.status}</span></td>
          <td class="d-none d-lg-table-cell">${TaskManager.dueBadge(t) || '<span class="text-muted small">—</span>'}</td>
          <td class="d-none d-lg-table-cell" style="min-width:110px;">
            <div class="d-flex align-items-center gap-2">
              <div class="progress flex-fill" style="height:6px;"><div class="progress-bar" style="width:${pct}%"></div></div>
              <span class="small text-muted">${pct}%</span>
            </div>
          </td>
          <td class="text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-primary" data-action="open" title="Edit"><i class="bi bi-pencil"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" title="Delete"><i class="bi bi-trash3"></i></button>
          </td>
        </tr>`;
      }).join('');
      document.getElementById('tasksEmptyState').classList.toggle('d-none', all.length > 0);
      TaskManager.renderPagination(totalPages);
    },

    renderPagination(totalPages) {
      const pag = document.getElementById('tasksPagination');
      if (totalPages <= 1) { pag.innerHTML = ''; return; }
      let html = '';
      for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === State.taskPage ? 'active' : ''}"><button type="button" class="page-link" data-page="${i}">${i}</button></li>`;
      }
      pag.innerHTML = html;
      pag.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => { State.taskPage = parseInt(btn.dataset.page, 10); TaskManager.renderList(); }));
    },

    toggleFlag(id, field) {
      const t = TaskManager.getById(id); if (!t) return;
      t[field] = !t[field];
      t.updatedDate = Utils.nowIso();
      Store.save();
      TaskManager.renderList();
      Dashboard.refreshIfActive();
      if (State.currentView === 'kanban') KanbanManager.render();
    },

    confirmDelete(id) {
      const t = TaskManager.getById(id); if (!t) return;
      confirmAction('Delete Task?', `Delete "${t.title}"? You can undo this immediately after.`, () => {
        const idx = Store.data.tasks.findIndex(x => x.id === id);
        if (idx === -1) return;
        const [removed] = Store.data.tasks.splice(idx, 1);
        Store.save();
        addActivity('bi-trash3', `Deleted task "${t.title}"`);
        TaskManager.renderList();
        Dashboard.refreshIfActive();
        if (State.currentView === 'kanban') KanbanManager.render();
        offerUndo('Task deleted.', () => {
          Store.data.tasks.splice(idx, 0, removed);
          Store.save();
          TaskManager.renderList();
          Dashboard.refreshIfActive();
          if (State.currentView === 'kanban') KanbanManager.render();
        });
      });
    },

    save() {
      const d = TaskManager.draft;
      d.title = document.getElementById('taskTitle').value.trim();
      d.description = document.getElementById('taskDescription').value;
      d.taskType = document.getElementById('taskType').value === 'team' ? 'team' : 'personal';
      const newAssigneeId = d.taskType === 'team' ? document.getElementById('taskAssignee').value : '';
      d.category = document.getElementById('taskCategory').value;
      d.priority = document.getElementById('taskPriority').value;
      const newStatus = document.getElementById('taskStatus').value;
      d.project = document.getElementById('taskProject').value.trim();
      d.tags = document.getElementById('taskTags').value.split(',').map(s => s.trim()).filter(Boolean);
      d.dueDate = document.getElementById('taskDueDate').value;
      d.estimatedHours = document.getElementById('taskEstHours').value;
      d.actualHours = document.getElementById('taskActHours').value;
      d.notes = document.getElementById('taskNotes').value;
      d.favorite = document.getElementById('taskFavorite').checked;
      d.pinned = document.getElementById('taskPinned').checked;
      d.archived = document.getElementById('taskArchived').checked;
      d.updatedDate = Utils.nowIso();

      if (!TaskManager.isNew && TaskManager.originalSnapshot) {
        if (TaskManager.originalSnapshot.status !== newStatus) d.history.push({ date: d.updatedDate, message: `Status changed from ${TaskManager.originalSnapshot.status} to ${newStatus}` });
        if (TaskManager.originalSnapshot.priority !== d.priority) d.history.push({ date: d.updatedDate, message: `Priority changed from ${TaskManager.originalSnapshot.priority} to ${d.priority}` });
        if ((TaskManager.originalSnapshot.assigneeId || '') !== (newAssigneeId || '')) {
          const from = TeamMembers.nameFor(TaskManager.originalSnapshot.assigneeId) || 'Unassigned';
          const to = TeamMembers.nameFor(newAssigneeId) || 'Unassigned';
          d.history.push({ date: d.updatedDate, message: `Reassigned from ${from} to ${to}` });
        }
      } else if (d.taskType === 'team' && newAssigneeId) {
        d.history.push({ date: d.updatedDate, message: `Assigned to ${TeamMembers.nameFor(newAssigneeId)}` });
      }
      d.status = newStatus;
      d.assigneeId = newAssigneeId;

      if (TaskManager.isNew) {
        Store.data.tasks.unshift(d);
        addActivity('bi-plus-circle', `Created ${d.taskType === 'team' ? 'team ' : ''}task "${d.title}"`);
      } else {
        const idx = Store.data.tasks.findIndex(t => t.id === d.id);
        Store.data.tasks[idx] = d;
        addActivity('bi-pencil', `Updated task "${d.title}"`);
      }
      Store.save();
      TaskManager.savedThisSession = true;
    }
  };

  /* ========================================================================
     BUG MANAGER
     ==================================================================== */
  const BugManager = {
    draft: null, isNew: false, originalSnapshot: null, savedThisSession: false,

    getById(id) { return Store.data.bugs.find(b => b.id === id); },

    blank() {
      const now = Utils.nowIso();
      return {
        id: Store.nextId('BUG', 'bugSeq'), title: '', severity: 'High', priority: 'Medium', environment: 'Development',
        module: '', browser: '', stepsToReproduce: '', expectedResult: '', actualResult: '', rootCause: '', fixNotes: '',
        status: 'Open', createdDate: now, resolvedDate: '', history: [{ date: now, message: 'Bug reported' }]
      };
    },

    severityVar(sev) { return { Low: '--status-good', Medium: '--series-4', High: '--status-serious', Critical: '--status-critical' }[sev] || '--text-muted'; },

    openModal(id = null) {
      const modalEl = document.getElementById('bugModal');
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      if (id) {
        const b = BugManager.getById(id);
        if (!b) return;
        BugManager.draft = JSON.parse(JSON.stringify(b));
        BugManager.originalSnapshot = JSON.parse(JSON.stringify(b));
        BugManager.isNew = false;
        document.getElementById('bugModalTitle').innerHTML = `<i class="bi bi-bug-fill me-2"></i>Edit Bug <span class="text-secondary small">#${b.id}</span>`;
        document.getElementById('btnDeleteBugModal').classList.remove('d-none');
      } else {
        BugManager.draft = BugManager.blank();
        BugManager.originalSnapshot = null;
        BugManager.isNew = true;
        document.getElementById('bugModalTitle').innerHTML = `<i class="bi bi-bug-fill me-2"></i>Report Bug`;
        document.getElementById('btnDeleteBugModal').classList.add('d-none');
      }
      BugManager.savedThisSession = false;
      BugManager.fillForm();
      modal.show();
    },

    fillForm() {
      const b = BugManager.draft;
      document.getElementById('bugId').value = b.id;
      document.getElementById('bugTitle').value = b.title;
      document.getElementById('bugSeverity').value = b.severity;
      document.getElementById('bugPriority').value = b.priority;
      document.getElementById('bugStatus').value = b.status;
      document.getElementById('bugEnvironment').value = b.environment;
      document.getElementById('bugModule').value = b.module;
      document.getElementById('bugBrowser').value = b.browser;
      document.getElementById('bugSteps').value = b.stepsToReproduce;
      document.getElementById('bugExpected').value = b.expectedResult;
      document.getElementById('bugActual').value = b.actualResult;
      document.getElementById('bugRootCause').value = b.rootCause;
      document.getElementById('bugFixNotes').value = b.fixNotes;
      document.getElementById('bugMetaLabel').textContent = `Created ${Utils.formatDateTime(b.createdDate)}${b.resolvedDate ? ' · Resolved ' + Utils.formatDateTime(b.resolvedDate) : ''}`;
      BugManager.renderScreenshots();
    },

    renderScreenshots() {
      ScreenshotManager.renderGrid(document.getElementById('bugScreenshotGrid'), 'bug', BugManager.draft.id,
        { colClass: 'col-6 col-md-4', emptyHtml: '<p class="text-muted small">No screenshots attached.</p>' });
    },

    save() {
      const b = BugManager.draft;
      b.title = document.getElementById('bugTitle').value.trim();
      b.severity = document.getElementById('bugSeverity').value;
      b.priority = document.getElementById('bugPriority').value;
      const newStatus = document.getElementById('bugStatus').value;
      b.environment = document.getElementById('bugEnvironment').value;
      b.module = document.getElementById('bugModule').value.trim();
      b.browser = document.getElementById('bugBrowser').value.trim();
      b.stepsToReproduce = document.getElementById('bugSteps').value;
      b.expectedResult = document.getElementById('bugExpected').value;
      b.actualResult = document.getElementById('bugActual').value;
      b.rootCause = document.getElementById('bugRootCause').value;
      b.fixNotes = document.getElementById('bugFixNotes').value;

      if (!BugManager.isNew && BugManager.originalSnapshot && BugManager.originalSnapshot.status !== newStatus) {
        b.history.push({ date: Utils.nowIso(), message: `Status changed from ${BugManager.originalSnapshot.status} to ${newStatus}` });
      }
      if ((newStatus === 'Resolved' || newStatus === 'Closed') && !b.resolvedDate) b.resolvedDate = Utils.nowIso();
      if (newStatus === 'Reopened') b.resolvedDate = '';
      b.status = newStatus;

      if (BugManager.isNew) {
        Store.data.bugs.unshift(b);
        addActivity('bi-bug-fill', `Reported bug "${b.title}"`);
      } else {
        const idx = Store.data.bugs.findIndex(x => x.id === b.id);
        Store.data.bugs[idx] = b;
        addActivity('bi-pencil', `Updated bug "${b.title}"`);
      }
      Store.save();
      BugManager.savedThisSession = true;
    },

    confirmDelete(id) {
      const b = BugManager.getById(id); if (!b) return;
      confirmAction('Delete Bug?', `Delete "${b.title}"? You can undo this immediately after.`, () => {
        const idx = Store.data.bugs.findIndex(x => x.id === id);
        if (idx === -1) return;
        const [removed] = Store.data.bugs.splice(idx, 1);
        Store.save();
        addActivity('bi-trash3', `Deleted bug "${b.title}"`);
        BugManager.renderList();
        Dashboard.refreshIfActive();
        offerUndo('Bug deleted.', () => { Store.data.bugs.splice(idx, 0, removed); Store.save(); BugManager.renderList(); Dashboard.refreshIfActive(); });
      });
    },

    getFiltered() {
      const f = State.bugFilters;
      return Store.data.bugs.filter(b => {
        if (f.status && b.status !== f.status) return false;
        if (f.severity && b.severity !== f.severity) return false;
        if (f.priority && b.priority !== f.priority) return false;
        if (f.module && !(b.module || '').toLowerCase().includes(f.module.toLowerCase())) return false;
        return true;
      }).sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
    },

    populateFilterOptions() {
      const statusSel = document.getElementById('filterBugStatus');
      if (statusSel.options.length <= 1) BUG_STATUS_LIST.forEach(s => statusSel.add(new Option(s, s)));
      const sevSel = document.getElementById('filterBugSeverity');
      if (sevSel.options.length <= 1) PRIORITY_LIST.forEach(s => sevSel.add(new Option(s, s)));
      const prioSel = document.getElementById('filterBugPriority');
      if (prioSel.options.length <= 1) PRIORITY_LIST.forEach(s => prioSel.add(new Option(s, s)));
    },

    renderList() {
      BugManager.populateFilterOptions();
      const list = BugManager.getFiltered();
      document.getElementById('bugsGrid').innerHTML = list.map(b => `
        <div class="col-md-6 col-lg-4">
          <div class="glass-card p-3 h-100 fade-in">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <h6 class="fw-bold mb-0">${Utils.escapeHtml(b.title)}</h6>
              <span class="badge" style="background:var(${BugManager.severityVar(b.severity)});">${b.severity}</span>
            </div>
            <div class="d-flex flex-wrap gap-1 mb-2">
              <span class="badge badge-priority-${b.priority}">${b.priority}</span>
              <span class="badge bg-secondary-subtle text-secondary-emphasis">${b.status}</span>
              ${b.module ? `<span class="badge bg-secondary-subtle text-secondary-emphasis"><i class="bi bi-puzzle me-1"></i>${Utils.escapeHtml(b.module)}</span>` : ''}
            </div>
            <p class="small text-muted mb-2">${Utils.escapeHtml((b.actualResult || b.stepsToReproduce || 'No details yet.')).slice(0, 110)}</p>
            <div class="d-flex justify-content-between align-items-center">
              <small class="text-muted">${Utils.formatDate(b.createdDate)}</small>
              <div>
                <button type="button" class="btn btn-sm btn-outline-primary" data-bug-edit="${b.id}"><i class="bi bi-pencil"></i></button>
                <button type="button" class="btn btn-sm btn-outline-danger" data-bug-delete="${b.id}"><i class="bi bi-trash3"></i></button>
              </div>
            </div>
          </div>
        </div>`).join('');
      document.getElementById('bugsEmptyState').classList.toggle('d-none', list.length > 0);
    }
  };

  /* ========================================================================
     DAILY LOG MANAGER
     ==================================================================== */
  const DailyLogManager = {
    currentDate: Utils.todayStr(),

    render() {
      const input = document.getElementById('dailyLogDate');
      if (!input.value) input.value = DailyLogManager.currentDate;
      DailyLogManager.loadDate(input.value);
      DailyLogManager.renderPastLogs();
    },

    loadDate(ds) {
      DailyLogManager.currentDate = ds;
      const log = Store.data.dailyLogs[ds] || {};
      document.querySelectorAll('#dailyLogForm .auto-save-field').forEach(el => { el.value = log[el.dataset.field] || ''; });
      document.getElementById('dailyLogSavedLabel').textContent = log.updatedDate ? `Last saved ${Utils.timeAgo(log.updatedDate)}` : 'Not saved yet';
    },

    saveField(field, value) {
      const ds = DailyLogManager.currentDate;
      if (!Store.data.dailyLogs[ds]) Store.data.dailyLogs[ds] = { date: ds };
      Store.data.dailyLogs[ds][field] = value;
      Store.data.dailyLogs[ds].updatedDate = Utils.nowIso();
      Store.save();
      document.getElementById('dailyLogSavedLabel').textContent = `Saved at ${new Date().toLocaleTimeString()}`;
      DailyLogManager.updateStreakUI();
    },

    saveAll() {
      document.querySelectorAll('#dailyLogForm .auto-save-field').forEach(el => DailyLogManager.saveField(el.dataset.field, el.value));
      addActivity('bi-journal-text', `Saved daily log for ${Utils.formatDate(DailyLogManager.currentDate)}`);
      DailyLogManager.renderPastLogs();
    },

    logHasContent(ds) {
      const log = Store.data.dailyLogs[ds];
      if (!log) return false;
      return Object.keys(log).some(k => k !== 'date' && k !== 'updatedDate' && (log[k] || '').toString().trim().length > 0);
    },

    computeStreak() {
      let d = new Date();
      if (!DailyLogManager.logHasContent(Utils.toDateStr(d))) d.setDate(d.getDate() - 1);
      let streak = 0;
      while (DailyLogManager.logHasContent(Utils.toDateStr(d))) { streak++; d.setDate(d.getDate() - 1); }
      return streak;
    },

    updateStreakUI() {
      const s = DailyLogManager.computeStreak();
      const el = document.getElementById('streakCount');
      if (el) el.innerHTML = `${s} <i class="bi bi-fire text-warning"></i>`;
    },

    renderPastLogs() {
      const dates = Object.keys(Store.data.dailyLogs).filter(DailyLogManager.logHasContent).sort((a, b) => b.localeCompare(a));
      const acc = document.getElementById('pastLogsAccordion');
      if (!dates.length) { acc.innerHTML = '<p class="text-muted small">No past logs yet — start writing today\'s log above.</p>'; return; }
      const fieldsMap = [['goals', 'Goals'], ['completedWork', 'Completed Work'], ['pendingWork', 'Pending Work'], ['blockers', 'Blockers'], ['meetingNotes', 'Meeting Notes'], ['learning', 'Learning'], ['tomorrowPlan', "Tomorrow's Plan"], ['voiceNote', 'Voice Note']];
      acc.innerHTML = dates.map(ds => {
        const log = Store.data.dailyLogs[ds];
        const body = fieldsMap.filter(([k]) => log[k]).map(([k, label]) => `<p class="mb-1"><strong>${label}:</strong> ${Utils.escapeHtml(log[k])}</p>`).join('') || '<p class="text-muted">No details.</p>';
        const safeId = ds.replace(/-/g, '');
        return `
        <div class="accordion-item">
          <h2 class="accordion-header">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#log-${safeId}">
              ${Utils.formatDate(ds)}${ds === Utils.todayStr() ? ' <span class="badge bg-primary ms-2">Today</span>' : ''}
            </button>
          </h2>
          <div id="log-${safeId}" class="accordion-collapse collapse" data-bs-parent="#pastLogsAccordion">
            <div class="accordion-body small">
              ${body}
              <button type="button" class="btn btn-sm btn-outline-primary mt-2" data-load-log="${ds}"><i class="bi bi-pencil me-1"></i>Load into Editor</button>
            </div>
          </div>
        </div>`;
      }).join('');
      acc.querySelectorAll('[data-load-log]').forEach(btn => btn.addEventListener('click', () => {
        document.getElementById('dailyLogDate').value = btn.dataset.loadLog;
        DailyLogManager.loadDate(btn.dataset.loadLog);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
    }
  };

  /* ========================================================================
     STANDALONE VOICE NOTES VIEW
     ==================================================================== */
  const VoiceNotesView = {
    render() {
      const items = Store.data.voiceNotes.filter(v => v.linkedType === 'standalone').sort((a, b) => new Date(b.date) - new Date(a.date));
      document.getElementById('voiceNotesList').innerHTML = items.map(v => `
        <div class="list-group-item" data-vn="${v.id}">
          <div class="d-flex justify-content-between align-items-start">
            <small class="text-muted">${Utils.formatDateTime(v.date)}</small>
            <div>
              <button type="button" class="btn btn-sm btn-link p-0 me-2" data-vn-edit="${v.id}"><i class="bi bi-pencil"></i></button>
              <button type="button" class="btn btn-sm btn-link text-danger p-0" data-vn-delete="${v.id}"><i class="bi bi-trash3"></i></button>
            </div>
          </div>
          <p class="mb-0 mt-1">${Utils.escapeHtml(v.text)}</p>
        </div>`).join('');
      document.getElementById('voiceEmptyState').classList.toggle('d-none', items.length > 0);
    }
  };

  /* ========================================================================
     KANBAN MANAGER
     ==================================================================== */
  const KanbanManager = {
    render() {
      const board = document.getElementById('kanbanBoard');
      const tasks = Store.data.tasks.filter(t => !t.archived);
      board.innerHTML = KANBAN_STATUSES.map(status => {
        const items = tasks.filter(t => t.status === status);
        return `
        <div class="kanban-column">
          <div class="kanban-column-header"><span>${status}</span><span class="badge text-bg-secondary">${items.length}</span></div>
          <div class="kanban-cards" data-dropzone="${status}">
            ${items.map(t => KanbanManager.cardHtml(t)).join('') || '<div class="text-center text-muted small py-3">No tasks</div>'}
          </div>
        </div>`;
      }).join('');
      KanbanManager.wireDnD();
    },
    cardHtml(t) {
      const pct = TaskManager.checklistPct(t);
      const due = TaskManager.dueBadge(t);
      return `
      <div class="kanban-card" draggable="true" data-id="${t.id}">
        <div class="kc-title">${Utils.escapeHtml(t.title)}</div>
        <div class="kc-meta">
          <span class="badge badge-priority-${t.priority}">${t.priority}</span>
          ${t.favorite ? '<i class="bi bi-star-fill text-warning"></i>' : ''}
          ${t.pinned ? '<i class="bi bi-pin-angle-fill text-primary"></i>' : ''}
          ${due}
        </div>
        ${(t.taskType || 'personal') === 'team' ? `<div class="mt-2">${TaskManager.assigneeChip(t)}</div>` : ''}
        ${t.checklist.length ? `<div class="progress mt-2" style="height:5px;"><div class="progress-bar" style="width:${pct}%"></div></div>` : ''}
      </div>`;
    },
    wireDnD() {
      const board = document.getElementById('kanbanBoard');
      board.querySelectorAll('.kanban-card').forEach(card => {
        card.addEventListener('dragstart', e => {
          card.classList.add('dragging');
          e.dataTransfer.setData('text/plain', card.dataset.id);
          e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('click', () => TaskManager.openModal(card.dataset.id));
      });
      board.querySelectorAll('[data-dropzone]').forEach(zone => {
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
          e.preventDefault();
          zone.classList.remove('drag-over');
          const id = e.dataTransfer.getData('text/plain');
          const newStatus = zone.dataset.dropzone;
          const t = TaskManager.getById(id);
          if (t && t.status !== newStatus) {
            const old = t.status;
            t.status = newStatus;
            t.updatedDate = Utils.nowIso();
            t.history.push({ date: t.updatedDate, message: `Status changed from ${old} to ${newStatus} (Kanban)` });
            Store.save();
            addActivity('bi-columns-gap', `Moved "${t.title}" to ${newStatus}`);
            KanbanManager.render();
            Dashboard.refreshIfActive();
          }
        });
      });
    }
  };

  /* ========================================================================
     CALENDAR MANAGER
     ==================================================================== */
  const CalendarManager = {
    current: new Date(),
    render() {
      const y = CalendarManager.current.getFullYear(), m = CalendarManager.current.getMonth();
      document.getElementById('calendarMonthLabel').textContent = CalendarManager.current.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const firstDay = new Date(y, m, 1);
      const startOffset = firstDay.getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
      const todayStr = Utils.todayStr();
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let html = dow.map(d => `<div class="calendar-dow">${d}</div>`).join('');
      for (let i = 0; i < totalCells; i++) {
        const date = new Date(y, m, i - startOffset + 1);
        const ds = Utils.toDateStr(date);
        const other = date.getMonth() !== m;
        const dueTasks = Store.data.tasks.filter(t => t.dueDate === ds && !t.archived);
        const hasLog = DailyLogManager.logHasContent(ds);
        html += `<div class="calendar-day ${other ? 'other-month' : ''} ${ds === todayStr ? 'today' : ''}" data-date="${ds}">
          <div class="cd-num">${date.getDate()}</div>
          <div class="cd-badges">
            ${dueTasks.slice(0, 4).map(t => `<span class="badge badge-priority-${t.priority}" style="font-size:.55rem;padding:.2em .4em;">●</span>`).join('')}
          </div>
          ${hasLog ? '<span class="cd-log-dot" title="Daily log exists"></span>' : ''}
        </div>`;
      }
      document.getElementById('calendarGrid').innerHTML = html;
      document.querySelectorAll('.calendar-day').forEach(el => el.addEventListener('click', () => CalendarManager.showDay(el.dataset.date)));
    },
    showDay(ds) {
      const dueTasks = Store.data.tasks.filter(t => t.dueDate === ds);
      const log = Store.data.dailyLogs[ds];
      document.getElementById('dayDetailTitle').textContent = Utils.formatDate(ds);
      let body = '<h6 class="small fw-bold">Tasks Due</h6>';
      body += dueTasks.length ? `<div class="list-group list-group-flush mb-3">${dueTasks.map(t => `<a href="#" class="list-group-item list-group-item-action small d-flex justify-content-between" data-open-task="${t.id}">${Utils.escapeHtml(t.title)}<span class="badge badge-status-${t.status.replace(' ', '')}">${t.status}</span></a>`).join('')}</div>` : `<p class="small text-muted">No tasks due.</p>`;
      body += '<h6 class="small fw-bold">Daily Log</h6>';
      body += DailyLogManager.logHasContent(ds) ? `<p class="small">${Utils.escapeHtml((log.completedWork || log.goals || 'Log entry exists.')).slice(0, 200)}</p><button type="button" class="btn btn-sm btn-outline-primary" id="btnOpenLogDay">Open in Daily Log</button>` : `<p class="small text-muted">No log for this day.</p>`;
      document.getElementById('dayDetailBody').innerHTML = body;
      const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('dayDetailModal'));
      modal.show();
      document.querySelectorAll('[data-open-task]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); modal.hide(); setTimeout(() => TaskManager.openModal(a.dataset.openTask), 300); }));
      const btnLog = document.getElementById('btnOpenLogDay');
      if (btnLog) btnLog.addEventListener('click', () => { modal.hide(); switchView('dailylog'); document.getElementById('dailyLogDate').value = ds; DailyLogManager.loadDate(ds); });
    }
  };

  /* ========================================================================
     REPORTS MANAGER
     ==================================================================== */
  const ReportsManager = {
    render() {
      const tasks = Store.data.tasks;
      const bugs = Store.data.bugs;
      const completed = tasks.filter(t => t.status === 'Completed');
      const pending = tasks.filter(t => t.status !== 'Completed' && !t.archived);
      const avgHours = (() => {
        const durations = completed.map(t => (new Date(t.updatedDate) - new Date(t.createdDate)) / 3600000).filter(n => n >= 0);
        if (!durations.length) return '0';
        return (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1);
      })();
      const stats = [
        { label: 'Total Completed', value: completed.length, icon: 'bi-check2-circle', cls: 's6' },
        { label: 'Pending', value: pending.length, icon: 'bi-hourglass-split', cls: 's4' },
        { label: 'Avg Completion Time', value: avgHours + 'h', icon: 'bi-stopwatch', cls: 's1' },
        { label: 'Bugs Resolved', value: bugs.filter(b => b.status === 'Resolved' || b.status === 'Closed').length, icon: 'bi-bug', cls: 's8' }
      ];
      document.getElementById('reportStatsRow').innerHTML = stats.map(s => `
        <div class="col-6 col-lg-3">
          <div class="stat-card ${s.cls}"><i class="bi ${s.icon} stat-icon"></i><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>
        </div>`).join('');
      ReportsManager.renderWeekly(tasks);
      ReportsManager.renderMonthly(tasks);
      ReportsManager.renderMostActiveDay();
    },
    renderWeekly(tasks) {
      const labels = [], data = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString(undefined, { weekday: 'short' }));
        data.push(tasks.filter(t => t.status === 'Completed' && Utils.toDateStr(new Date(t.updatedDate)) === Utils.toDateStr(d)).length);
      }
      Charts.renderBarSingle('chartReportWeekly', labels, data, Utils.cssVar('--accent'), 'Completed');
    },
    renderMonthly(tasks) {
      const labels = [], data = [];
      for (let w = 4; w >= 0; w--) {
        const end = new Date(); end.setDate(end.getDate() - w * 7);
        const start = new Date(end); start.setDate(start.getDate() - 6);
        labels.push(`${start.getMonth() + 1}/${start.getDate()}–${end.getMonth() + 1}/${end.getDate()}`);
        const count = tasks.filter(t => t.status === 'Completed' && new Date(t.updatedDate) >= start && new Date(t.updatedDate) <= end).length;
        data.push(count);
      }
      Charts.renderBarSingle('chartReportMonthly', labels, data, Utils.cssVar('--series-3'), 'Completed');
    },
    renderMostActiveDay() {
      const counts = [0, 0, 0, 0, 0, 0, 0];
      Store.data.activity.forEach(a => counts[new Date(a.date).getDay()]++);
      const dow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const max = Math.max(...counts);
      const el = document.getElementById('mostActiveDayText');
      if (max === 0) { el.textContent = 'Not enough activity data yet — keep working and check back!'; return; }
      el.innerHTML = `<strong>${dow[counts.indexOf(max)]}</strong> is your most active day with ${max} recorded activities.`;
    }
  };

  /* ========================================================================
     DASHBOARD
     ==================================================================== */
  const Dashboard = {
    render() {
      document.getElementById('todayDateLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const tasks = Store.data.tasks.filter(t => !t.archived);
      const bugs = Store.data.bugs;
      const todayStr = Utils.todayStr();
      const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
      const counts = {
        total: tasks.length,
        pending: tasks.filter(t => t.status === 'Todo').length,
        inprogress: tasks.filter(t => t.status === 'In Progress').length,
        waiting: tasks.filter(t => t.status === 'Waiting').length,
        testing: tasks.filter(t => t.status === 'Testing').length,
        completed: tasks.filter(t => t.status === 'Completed').length,
        bugs: bugs.length,
        highPriority: tasks.filter(t => t.priority === 'High' || t.priority === 'Critical').length,
        today: tasks.filter(t => t.dueDate === todayStr).length,
        week: tasks.filter(t => t.dueDate && new Date(t.dueDate) >= new Date(todayStr) && new Date(t.dueDate) <= weekEnd).length,
        assignedToMe: Auth.user ? tasks.filter(t => t.assigneeId === Auth.user.id && t.status !== 'Completed').length : 0
      };
      const cards = [
        { label: 'Total Tasks', value: counts.total, icon: 'bi-list-check', cls: 's1' },
        { label: 'Pending', value: counts.pending, icon: 'bi-hourglass', cls: 's4' },
        { label: 'In Progress', value: counts.inprogress, icon: 'bi-arrow-repeat', cls: 's1' },
        { label: 'Waiting', value: counts.waiting, icon: 'bi-pause-circle', cls: 's4' },
        { label: 'Testing', value: counts.testing, icon: 'bi-clipboard-check', cls: 's7' },
        { label: 'Completed', value: counts.completed, icon: 'bi-check2-circle', cls: 's6' },
        { label: 'Bugs', value: counts.bugs, icon: 'bi-bug-fill', cls: 's8' },
        { label: 'High Priority', value: counts.highPriority, icon: 'bi-exclamation-triangle-fill', cls: 's2' },
        { label: "Today's Tasks", value: counts.today, icon: 'bi-calendar-day', cls: 's3' },
        { label: 'This Week', value: counts.week, icon: 'bi-calendar-week', cls: 's5' },
        { label: 'Assigned to Me', value: counts.assignedToMe, icon: 'bi-person-check-fill', cls: 's3' }
      ];
      document.getElementById('statCardsRow').innerHTML = cards.map(c => `
        <div class="col-6 col-md-4 col-lg-3">
          <div class="stat-card ${c.cls}"><i class="bi ${c.icon} stat-icon"></i><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div>
        </div>`).join('');

      const statusColors = [Utils.cssVar('--text-muted'), Utils.cssVar('--series-1'), Utils.cssVar('--series-4'), Utils.cssVar('--series-7'), Utils.cssVar('--status-good'), Utils.cssVar('--status-critical')];
      Charts.renderPie('chartStatus', STATUS_LIST, STATUS_LIST.map(s => tasks.filter(t => t.status === s).length), statusColors);

      const prioColors = [Utils.cssVar('--status-good'), Utils.cssVar('--series-4'), Utils.cssVar('--status-serious'), Utils.cssVar('--status-critical')];
      Charts.renderBarCategorical('chartPriority', PRIORITY_LIST, PRIORITY_LIST.map(p => tasks.filter(t => t.priority === p).length), prioColors);

      const labels = [], data = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString(undefined, { weekday: 'short' }));
        data.push(tasks.filter(t => t.status === 'Completed' && Utils.toDateStr(new Date(t.updatedDate)) === Utils.toDateStr(d)).length);
      }
      Charts.renderBarSingle('chartWeekly', labels, data, Utils.cssVar('--accent'), 'Completed');

      const pinnedFav = tasks.filter(t => t.pinned || t.favorite).slice(0, 6);
      document.getElementById('dashPinnedList').innerHTML = pinnedFav.length ? pinnedFav.map(t => `
        <a href="#" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-open-task="${t.id}">
          <span>${t.pinned ? '<i class="bi bi-pin-angle-fill text-primary me-1"></i>' : ''}${t.favorite ? '<i class="bi bi-star-fill text-warning me-1"></i>' : ''}${Utils.escapeHtml(t.title)}</span>
          <span class="badge badge-status-${t.status.replace(' ', '')}">${t.status}</span>
        </a>`).join('') : '<p class="text-muted small mb-0">Nothing pinned yet.</p>';

      const todayTasks = tasks.filter(t => t.dueDate === todayStr).slice(0, 6);
      document.getElementById('dashTodayList').innerHTML = todayTasks.length ? todayTasks.map(t => `
        <a href="#" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-open-task="${t.id}">
          <span>${Utils.escapeHtml(t.title)}</span><span class="badge badge-priority-${t.priority}">${t.priority}</span>
        </a>`).join('') : '<p class="text-muted small mb-0">Nothing due today. 🎉</p>';

      document.querySelectorAll('#dashPinnedList [data-open-task], #dashTodayList [data-open-task]').forEach(a => {
        a.addEventListener('click', e => { e.preventDefault(); TaskManager.openModal(a.dataset.openTask); });
      });

      renderActivity();
      DailyLogManager.updateStreakUI();
    },
    refreshIfActive() { if (State.currentView === 'dashboard') Dashboard.render(); }
  };

  /* ========================================================================
     SETTINGS MANAGER
     ==================================================================== */
  const SettingsManager = {
    defaults() { return AppSettings.defaults(); },
    apply() {
      const s = AppSettings.data;
      document.documentElement.setAttribute('data-bs-theme', s.theme);
      document.documentElement.setAttribute('data-theme', s.theme);
      document.documentElement.setAttribute('data-accent', s.accent);
      document.body.classList.toggle('compact', !!s.compact);
      document.body.classList.toggle('large-text', !!s.largeText);
      const icon = document.getElementById('themeIcon');
      if (icon) icon.className = s.theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
    },
    render() {
      const s = AppSettings.data;
      document.getElementById(s.theme === 'dark' ? 'themeDark' : 'themeLight').checked = true;
      document.querySelectorAll('.accent-swatch').forEach(sw => sw.classList.toggle('active', sw.dataset.accent === s.accent));
      document.getElementById('settingCompact').checked = !!s.compact;
      document.getElementById('settingLargeText').checked = !!s.largeText;
      const bytes = new Blob([JSON.stringify(Store.data)]).size;
      document.getElementById('storageUsageLabel').textContent = `Shared workspace size: ${(bytes / 1024).toFixed(1)} KB`;
    },
    update(patch) {
      Object.assign(AppSettings.data, patch);
      AppSettings.save();
      SettingsManager.apply();
      if (document.getElementById('view-settings') && !document.getElementById('view-settings').classList.contains('d-none')) SettingsManager.render();
      if (State.currentView === 'dashboard') Dashboard.render();
      if (State.currentView === 'reports') ReportsManager.render();
    }
  };

  /* ========================================================================
     SEARCH
     ==================================================================== */
  const SearchManager = {
    search(query) {
      query = query.trim().toLowerCase();
      if (!query) return [];
      const results = [];
      Store.data.tasks.forEach(t => {
        const hay = [t.title, t.description, t.notes, t.project, (t.tags || []).join(' '), TeamMembers.nameFor(t.assigneeId)].join(' ').toLowerCase();
        if (hay.includes(query)) results.push({ type: 'Task', icon: 'bi-list-check', id: t.id, title: t.title, sub: `${t.status}${(t.taskType || 'personal') === 'team' ? ' · Team' : ''}` });
      });
      Store.data.bugs.forEach(b => {
        const hay = [b.title, b.stepsToReproduce, b.actualResult, b.module].join(' ').toLowerCase();
        if (hay.includes(query)) results.push({ type: 'Bug', icon: 'bi-bug-fill', id: b.id, title: b.title, sub: b.status });
      });
      Store.data.voiceNotes.forEach(v => {
        if ((v.text || '').toLowerCase().includes(query)) results.push({ type: 'Voice Note', icon: 'bi-mic-fill', id: v.id, title: v.text.slice(0, 60), sub: Utils.formatDate(v.date) });
      });
      return results.slice(0, 20);
    }
  };

  /* ========================================================================
     ROUTER
     ==================================================================== */
  function switchView(view) {
    if (!VIEWS.includes(view)) view = 'dashboard';
    VIEWS.forEach(v => document.getElementById('view-' + v).classList.toggle('d-none', v !== view));
    document.querySelectorAll('#mainNav .nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    location.hash = view;
    State.currentView = view;
    const sidebarEl = document.getElementById('appSidebar');
    const oc = bootstrap.Offcanvas.getInstance(sidebarEl);
    if (oc) oc.hide();
    renderView(view);
  }

  function renderView(view) {
    switch (view) {
      case 'dashboard': Dashboard.render(); break;
      case 'tasks': TaskManager.renderList(); break;
      case 'bugs': BugManager.renderList(); break;
      case 'dailylog': DailyLogManager.render(); break;
      case 'voice': VoiceNotesView.render(); break;
      case 'screenshots': ScreenshotManager.renderGallery(); break;
      case 'kanban': KanbanManager.render(); break;
      case 'calendar': CalendarManager.render(); break;
      case 'reports': ReportsManager.render(); break;
      case 'settings': SettingsManager.render(); break;
    }
  }

  /* ========================================================================
     APP INIT — DOM wiring
     ==================================================================== */
  async function init() {
    AppSettings.load();
    SettingsManager.apply(); // apply theme/accent immediately, before any network round-trip

    const authed = await Auth.init();
    if (!authed) return; // Auth.init() already redirected to /login.html

    await Promise.all([Store.load(), TeamMembers.load()]);
    initVoiceRecorders();
    wireNav();
    wireTaskModal();
    wireBugModal();
    wireDailyLog();
    wireVoiceNotesView();
    wireScreenshots();
    wireCalendar();
    wireSettings();
    wireSearch();
    wireQuickCapture();
    wireShortcuts();

    const hash = location.hash.replace('#', '') || 'dashboard';
    switchView(hash);

    // Auto-save heartbeat every 30s
    setInterval(() => {
      Store.save();
      if (State.currentView === 'dailylog') {
        const label = document.getElementById('dailyLogSavedLabel');
        if (label) label.textContent = `Auto-saved at ${new Date().toLocaleTimeString()}`;
      }
    }, 30000);
  }

  function wireNav() {
    document.getElementById('mainNav').addEventListener('click', e => {
      const a = e.target.closest('.nav-link'); if (!a) return;
      e.preventDefault();
      switchView(a.dataset.view);
    });
    document.getElementById('btnSidebarToggle').addEventListener('click', () => {
      bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('appSidebar')).toggle();
    });
    document.getElementById('btnNewTaskNav').addEventListener('click', () => TaskManager.openModal());
    document.getElementById('btnNewTask').addEventListener('click', () => TaskManager.openModal());
    document.getElementById('fabNewTask').addEventListener('click', () => TaskManager.openModal());
    document.getElementById('btnNewBug').addEventListener('click', () => BugManager.openModal());
    document.getElementById('btnThemeToggle').addEventListener('click', () => {
      SettingsManager.update({ theme: AppSettings.data.theme === 'dark' ? 'light' : 'dark' });
    });

    // Task filter bar
    const filterMap = { filterStatus: 'status', filterPriority: 'priority', filterCategory: 'category', filterProject: 'project', filterDate: 'date', filterCreated: 'created', filterAssignee: 'assignee' };
    Object.keys(filterMap).forEach(id => {
      document.getElementById(id).addEventListener('change', e => {
        State.taskFilters[filterMap[id]] = e.target.value;
        State.taskPage = 1;
        TaskManager.renderList();
      });
    });
    document.querySelectorAll('.toggle-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle;
        State.taskFilters[key] = !State.taskFilters[key];
        btn.classList.toggle('active', State.taskFilters[key]);
        State.taskPage = 1;
        TaskManager.renderList();
      });
    });

    // Personal / Team task tabs
    document.getElementById('taskTypeTabs').addEventListener('click', e => {
      const btn = e.target.closest('[data-task-type]'); if (!btn) return;
      document.querySelectorAll('#taskTypeTabs .nav-link').forEach(b => b.classList.toggle('active', b === btn));
      const type = btn.dataset.taskType;
      State.taskFilters.taskType = type;
      State.taskFilters.assignee = '';
      document.getElementById('filterAssignee').value = '';
      document.getElementById('filterAssignedToMeWrap').classList.toggle('d-none', type !== 'team');
      State.taskPage = 1;
      TaskManager.renderList();
    });
    document.getElementById('tasksTableBody').addEventListener('click', e => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const id = tr.dataset.id;
      const actionEl = e.target.closest('[data-action]'); if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'open') TaskManager.openModal(id);
      else if (action === 'delete') TaskManager.confirmDelete(id);
      else if (action === 'fav') TaskManager.toggleFlag(id, 'favorite');
      else if (action === 'pin') TaskManager.toggleFlag(id, 'pinned');
    });

    // Bug filter bar
    const bugFilterMap = { filterBugStatus: 'status', filterBugSeverity: 'severity', filterBugPriority: 'priority' };
    Object.keys(bugFilterMap).forEach(id => {
      document.getElementById(id).addEventListener('change', e => { State.bugFilters[bugFilterMap[id]] = e.target.value; BugManager.renderList(); });
    });
    document.getElementById('filterBugModule').addEventListener('input', Utils.debounce(e => { State.bugFilters.module = e.target.value; BugManager.renderList(); }, 300));
    document.getElementById('bugsGrid').addEventListener('click', e => {
      const editBtn = e.target.closest('[data-bug-edit]');
      const delBtn = e.target.closest('[data-bug-delete]');
      if (editBtn) BugManager.openModal(editBtn.dataset.bugEdit);
      else if (delBtn) BugManager.confirmDelete(delBtn.dataset.bugDelete);
    });
  }

  function wireTaskModal() {
    document.getElementById('taskType').addEventListener('change', e => {
      const isTeam = e.target.value === 'team';
      document.getElementById('taskAssigneeWrap').classList.toggle('d-none', !isTeam);
      if (isTeam) TeamMembers.populateSelect(document.getElementById('taskAssignee'), TaskManager.draft ? TaskManager.draft.assigneeId : '');
    });
    document.getElementById('taskForm').addEventListener('submit', e => {
      e.preventDefault();
      const title = document.getElementById('taskTitle').value.trim();
      if (!title) { toast('Task title is required.', 'danger'); return; }
      TaskManager.save();
      toast('Task saved.', 'success');
      bootstrap.Modal.getInstance(document.getElementById('taskModal')).hide();
      if (State.currentView === 'tasks') TaskManager.renderList();
      if (State.currentView === 'kanban') KanbanManager.render();
      if (State.currentView === 'calendar') CalendarManager.render();
      Dashboard.refreshIfActive();
    });
    document.getElementById('taskModal').addEventListener('hidden.bs.modal', () => {
      if (TaskManager.isNew && !TaskManager.savedThisSession && TaskManager.draft) {
        const did = TaskManager.draft.id;
        Store.data.screenshots = Store.data.screenshots.filter(s => !(s.linkedType === 'task' && s.linkedId === did));
        Store.data.voiceNotes = Store.data.voiceNotes.filter(v => !(v.linkedType === 'task' && v.linkedId === did));
        Store.save();
      }
      if (TaskManager.timerInterval) { clearInterval(TaskManager.timerInterval); TaskManager.timerInterval = null; }
      TaskManager.draft = null;
      TaskManager.savedThisSession = false;
    });
    document.getElementById('btnDeleteTaskModal').addEventListener('click', () => {
      if (!TaskManager.draft) return;
      const id = TaskManager.draft.id;
      bootstrap.Modal.getInstance(document.getElementById('taskModal')).hide();
      setTimeout(() => TaskManager.confirmDelete(id), 300);
    });

    document.getElementById('checklistItems').addEventListener('click', e => {
      const li = e.target.closest('[data-cid]'); if (!li) return;
      if (e.target.closest('[data-cl-action="remove"]')) {
        TaskManager.draft.checklist = TaskManager.draft.checklist.filter(c => c.id !== li.dataset.cid);
        TaskManager.renderChecklist();
      }
    });
    document.getElementById('checklistItems').addEventListener('change', e => {
      if (e.target.dataset.clAction === 'toggle') {
        const li = e.target.closest('[data-cid]');
        const item = TaskManager.draft.checklist.find(c => c.id === li.dataset.cid);
        if (item) { item.done = e.target.checked; TaskManager.renderChecklist(); }
      }
    });
    document.getElementById('btnAddChecklistItem').addEventListener('click', () => TaskManager.addChecklistItem());
    document.getElementById('checklistInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); TaskManager.addChecklistItem(); } });

    document.getElementById('taskNotes').addEventListener('input', Utils.debounce(e => {
      document.getElementById('taskNotesPreview').innerHTML = Utils.markdownLite(e.target.value);
    }, 200));

    document.getElementById('btnAppendVoiceToNotes').addEventListener('click', () => {
      const val = document.getElementById('taskVoiceOutput').value.trim();
      if (!val) return;
      const notesEl = document.getElementById('taskNotes');
      notesEl.value = (notesEl.value ? notesEl.value + '\n' : '') + val;
      document.getElementById('taskNotesPreview').innerHTML = Utils.markdownLite(notesEl.value);
      toast('Appended to notes.', 'success');
    });
    document.getElementById('btnSaveTaskVoiceNote').addEventListener('click', () => {
      const val = document.getElementById('taskVoiceOutput').value.trim();
      if (!val || !TaskManager.draft) { toast('Nothing to save.', 'warning'); return; }
      Store.data.voiceNotes.unshift({ id: Utils.uid(), text: val, date: Utils.nowIso(), linkedType: 'task', linkedId: TaskManager.draft.id });
      Store.save();
      document.getElementById('taskVoiceOutput').value = '';
      TaskManager.renderTaskVoiceNotes();
      toast('Voice note saved to task.', 'success');
    });
    document.getElementById('taskVoiceNotesList').addEventListener('click', e => {
      const delBtn = e.target.closest('[data-vn-delete]'); if (!delBtn) return;
      const idx = Store.data.voiceNotes.findIndex(v => v.id === delBtn.dataset.vnDelete);
      if (idx > -1) { Store.data.voiceNotes.splice(idx, 1); Store.save(); TaskManager.renderTaskVoiceNotes(); }
    });

    document.getElementById('btnTimerToggle').addEventListener('click', () => {
      const d = TaskManager.draft; if (!d) return;
      if (d.timerStart) {
        const elapsedH = (Date.now() - new Date(d.timerStart).getTime()) / 3600000;
        d.actualHours = (parseFloat(d.actualHours || 0) + elapsedH).toFixed(2);
        document.getElementById('taskActHours').value = d.actualHours;
        d.history.push({ date: Utils.nowIso(), message: `Logged ${elapsedH.toFixed(2)}h via timer` });
        d.timerStart = null;
      } else {
        d.timerStart = Utils.nowIso();
      }
      TaskManager.resetTimerUI();
    });

    document.getElementById('btnTaskAddScreenshot').addEventListener('click', () => document.getElementById('taskScreenshotInput').click());
    document.getElementById('taskScreenshotInput').addEventListener('change', e => {
      if (!e.target.files.length || !TaskManager.draft) return;
      ScreenshotManager.add(e.target.files, 'task', TaskManager.draft.id, () => TaskManager.renderTaskScreenshots());
      e.target.value = '';
    });
  }

  function wireBugModal() {
    document.getElementById('bugForm').addEventListener('submit', e => {
      e.preventDefault();
      const title = document.getElementById('bugTitle').value.trim();
      if (!title) { toast('Bug title is required.', 'danger'); return; }
      BugManager.save();
      toast('Bug saved.', 'success');
      bootstrap.Modal.getInstance(document.getElementById('bugModal')).hide();
      BugManager.renderList();
      Dashboard.refreshIfActive();
    });
    document.getElementById('bugModal').addEventListener('hidden.bs.modal', () => {
      if (BugManager.isNew && !BugManager.savedThisSession && BugManager.draft) {
        const did = BugManager.draft.id;
        Store.data.screenshots = Store.data.screenshots.filter(s => !(s.linkedType === 'bug' && s.linkedId === did));
        Store.save();
      }
      BugManager.draft = null;
      BugManager.savedThisSession = false;
    });
    document.getElementById('btnDeleteBugModal').addEventListener('click', () => {
      if (!BugManager.draft) return;
      const id = BugManager.draft.id;
      bootstrap.Modal.getInstance(document.getElementById('bugModal')).hide();
      setTimeout(() => BugManager.confirmDelete(id), 300);
    });
    document.getElementById('btnBugAddScreenshot').addEventListener('click', () => document.getElementById('bugScreenshotInput').click());
    document.getElementById('bugScreenshotInput').addEventListener('change', e => {
      if (!e.target.files.length || !BugManager.draft) return;
      ScreenshotManager.add(e.target.files, 'bug', BugManager.draft.id, () => BugManager.renderScreenshots());
      e.target.value = '';
    });
  }

  function wireDailyLog() {
    document.getElementById('dailyLogDate').addEventListener('change', e => DailyLogManager.loadDate(e.target.value));
    document.getElementById('dailyLogForm').addEventListener('input', Utils.debounce(e => {
      if (e.target.classList.contains('auto-save-field')) DailyLogManager.saveField(e.target.dataset.field, e.target.value);
    }, 700));
    document.getElementById('dailyLogForm').addEventListener('submit', e => {
      e.preventDefault();
      DailyLogManager.saveAll();
      toast('Daily log saved.', 'success');
    });
  }

  function wireVoiceNotesView() {
    document.getElementById('btnSaveVoiceNote').addEventListener('click', () => {
      const val = document.getElementById('voiceTranscriptEditable').value.trim();
      if (!val) { toast('Nothing to save.', 'warning'); return; }
      Store.data.voiceNotes.unshift({ id: Utils.uid(), text: val, date: Utils.nowIso(), linkedType: 'standalone', linkedId: null });
      Store.save();
      addActivity('bi-mic-fill', 'Saved a voice note');
      document.getElementById('voiceTranscriptEditable').value = '';
      VoiceNotesView.render();
      toast('Voice note saved.', 'success');
    });
    document.getElementById('voiceNotesList').addEventListener('click', e => {
      const delBtn = e.target.closest('[data-vn-delete]');
      const editBtn = e.target.closest('[data-vn-edit]');
      if (delBtn) {
        const id = delBtn.dataset.vnDelete;
        const idx = Store.data.voiceNotes.findIndex(v => v.id === id);
        if (idx === -1) return;
        const [removed] = Store.data.voiceNotes.splice(idx, 1);
        Store.save();
        VoiceNotesView.render();
        offerUndo('Voice note deleted.', () => { Store.data.voiceNotes.splice(idx, 0, removed); Store.save(); VoiceNotesView.render(); });
      } else if (editBtn) {
        const v = Store.data.voiceNotes.find(x => x.id === editBtn.dataset.vnEdit);
        if (v) document.getElementById('voiceTranscriptEditable').value = v.text;
      }
    });
  }

  function wireScreenshots() {
    document.getElementById('btnUploadScreenshot').addEventListener('click', () => document.getElementById('screenshotInput').click());
    document.getElementById('screenshotInput').addEventListener('change', e => {
      if (!e.target.files.length) return;
      ScreenshotManager.add(e.target.files, 'gallery', null, () => ScreenshotManager.renderGallery());
      e.target.value = '';
    });
    document.addEventListener('click', e => {
      const viewBtn = e.target.closest('[data-shot-view]');
      const dlBtn = e.target.closest('[data-shot-download]');
      const delBtn = e.target.closest('[data-shot-delete]');
      const img = e.target.closest('.screenshot-thumb img');
      if (viewBtn) openImageViewer(viewBtn.dataset.shotView);
      else if (img && !e.target.closest('.thumb-actions')) openImageViewer(img.dataset.id);
      else if (dlBtn) {
        const s = Store.data.screenshots.find(x => x.id === dlBtn.dataset.shotDownload);
        if (s) { const a = document.createElement('a'); a.href = s.dataUrl; a.download = s.name || 'screenshot.png'; a.click(); }
      } else if (delBtn) {
        confirmAction('Delete Screenshot?', 'This will permanently remove the screenshot.', () => ScreenshotManager.delete(delBtn.dataset.shotDelete, refreshAllScreenshotGrids));
      }
    });
    document.getElementById('btnImgZoomIn').addEventListener('click', () => {
      viewerZoom = Utils.clamp(viewerZoom + 0.25, 0.5, 4);
      document.getElementById('imageViewerImg').style.transform = `scale(${viewerZoom})`;
    });
    document.getElementById('btnImgZoomOut').addEventListener('click', () => {
      viewerZoom = Utils.clamp(viewerZoom - 0.25, 0.5, 4);
      document.getElementById('imageViewerImg').style.transform = `scale(${viewerZoom})`;
    });
    document.getElementById('btnImgDownload').addEventListener('click', () => {
      const s = Store.data.screenshots.find(x => x.id === viewerShotId);
      if (s) { const a = document.createElement('a'); a.href = s.dataUrl; a.download = s.name || 'screenshot.png'; a.click(); }
    });
    document.getElementById('btnImgDelete').addEventListener('click', () => {
      if (!viewerShotId) return;
      confirmAction('Delete Screenshot?', 'This will permanently remove the screenshot.', () => {
        ScreenshotManager.delete(viewerShotId, refreshAllScreenshotGrids);
        bootstrap.Modal.getInstance(document.getElementById('imageViewerModal')).hide();
      });
    });
  }

  function wireCalendar() {
    document.getElementById('btnCalPrev').addEventListener('click', () => { CalendarManager.current.setMonth(CalendarManager.current.getMonth() - 1); CalendarManager.render(); });
    document.getElementById('btnCalNext').addEventListener('click', () => { CalendarManager.current.setMonth(CalendarManager.current.getMonth() + 1); CalendarManager.render(); });
    document.getElementById('btnCalToday').addEventListener('click', () => { CalendarManager.current = new Date(); CalendarManager.render(); });
  }

  function wireSettings() {
    document.getElementById('themeLight').addEventListener('change', () => SettingsManager.update({ theme: 'light' }));
    document.getElementById('themeDark').addEventListener('change', () => SettingsManager.update({ theme: 'dark' }));
    document.querySelectorAll('.accent-swatch').forEach(sw => sw.addEventListener('click', () => SettingsManager.update({ accent: sw.dataset.accent })));
    document.getElementById('settingCompact').addEventListener('change', e => SettingsManager.update({ compact: e.target.checked }));
    document.getElementById('settingLargeText').addEventListener('change', e => SettingsManager.update({ largeText: e.target.checked }));
    document.getElementById('btnResetSettings').addEventListener('click', () => {
      confirmAction('Reset Settings?', 'This restores default appearance settings.', () => {
        AppSettings.data = AppSettings.defaults();
        AppSettings.save();
        SettingsManager.apply();
        SettingsManager.render();
        toast('Settings reset.', 'success');
      });
    });

    // Export is safe for anyone — it only reads. Import/Backup/Restore/Clear
    // mutate the shared workspace for every user, so they're admin-only:
    // hidden client-side (see Auth.init) and, for Backup/Restore, enforced
    // server-side too via the /api/admin/* routes.
    document.getElementById('btnExportJson').addEventListener('click', () => {
      Utils.downloadFile(`devtrack-export-${Utils.todayStr()}.json`, JSON.stringify(Store.data, null, 2), 'application/json');
      toast('Data exported successfully.', 'success');
    });
    document.getElementById('btnImportJson').addEventListener('click', () => document.getElementById('importFileInput').click());
    document.getElementById('importFileInput').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          confirmAction('Import Data?', 'This will overwrite the shared workspace for every user with the imported file. This cannot be undone.', async () => {
            Store.data = Object.assign(Store.defaultData(), parsed);
            await Store.save();
            switchView(State.currentView);
            toast('Data imported successfully.', 'success');
          });
        } catch (err) { toast('Invalid JSON file.', 'danger'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    document.getElementById('btnBackup').addEventListener('click', async () => {
      const res = await fetch('/api/admin/backup', { method: 'POST' }).catch(() => null);
      if (!res || !res.ok) { toast('Backup failed.', 'danger'); return; }
      toast('Backup saved on the server.', 'success');
    });
    document.getElementById('btnRestore').addEventListener('click', () => {
      confirmAction('Restore Backup?', 'This will overwrite the shared workspace for every user with the last server backup.', async () => {
        const res = await fetch('/api/admin/restore', { method: 'POST' }).catch(() => null);
        const data = await res?.json().catch(() => ({}));
        if (!res || !res.ok) { toast(data?.error || 'Restore failed.', 'danger'); return; }
        await Store.load();
        switchView(State.currentView);
        toast('Backup restored.', 'success');
      });
    });
    document.getElementById('btnClearStorage').addEventListener('click', () => {
      confirmAction('Clear All Storage?', 'This will permanently delete all tasks, bugs, logs, notes, and screenshots for every user. This cannot be undone.', async () => {
        Store.data = Store.defaultData();
        await Store.save();
        switchView('dashboard');
        toast('All storage cleared.', 'success');
      });
    });
  }

  function wireSearch() {
    const debouncedSearch = Utils.debounce(q => {
      const panel = document.getElementById('searchResults');
      if (!q.trim()) { panel.classList.add('d-none'); return; }
      const results = SearchManager.search(q);
      panel.innerHTML = results.length ? results.map(r => `
        <div class="search-item" data-type="${r.type}" data-id="${r.id}">
          <i class="bi ${r.icon} me-2"></i><strong>${Utils.escapeHtml(r.title)}</strong>
          <span class="badge bg-secondary float-end">${r.type}</span>
          <div class="text-muted small">${Utils.escapeHtml(r.sub || '')}</div>
        </div>`).join('') : '<div class="p-3 text-muted small">No results found.</div>';
      panel.classList.remove('d-none');
    }, 250);
    document.getElementById('globalSearch').addEventListener('input', e => debouncedSearch(e.target.value));
    document.getElementById('searchResults').addEventListener('click', e => {
      const item = e.target.closest('.search-item'); if (!item) return;
      const { type, id } = item.dataset;
      document.getElementById('searchResults').classList.add('d-none');
      document.getElementById('globalSearch').value = '';
      if (type === 'Task') { switchView('tasks'); setTimeout(() => TaskManager.openModal(id), 150); }
      else if (type === 'Bug') { switchView('bugs'); setTimeout(() => BugManager.openModal(id), 150); }
      else if (type === 'Voice Note') switchView('voice');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.nav-search-wrap')) document.getElementById('searchResults').classList.add('d-none');
    });
  }

  function wireQuickCapture() {
    const modalEl = document.getElementById('quickCaptureModal');
    document.getElementById('btnQuickCapture').addEventListener('click', () => {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
      setTimeout(() => document.getElementById('quickCaptureInput').focus(), 300);
    });
    modalEl.addEventListener('hidden.bs.modal', () => { document.getElementById('quickCaptureInput').value = ''; });
    document.getElementById('quickCaptureInput').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const val = e.target.value.trim();
      if (!val) return;
      const t = TaskManager.blank();
      t.title = val;
      Store.data.tasks.unshift(t);
      Store.save();
      addActivity('bi-lightning-charge-fill', `Quick captured "${val}"`);
      bootstrap.Modal.getInstance(modalEl).hide();
      toast('Task captured!', 'success');
      if (State.currentView === 'tasks') TaskManager.renderList();
      if (State.currentView === 'kanban') KanbanManager.render();
      Dashboard.refreshIfActive();
    });
  }

  function wireShortcuts() {
    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); TaskManager.openModal(); }
      else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); document.getElementById('globalSearch').focus(); }
      else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (document.getElementById('taskModal').classList.contains('show')) document.getElementById('taskForm').requestSubmit();
        else if (document.getElementById('bugModal').classList.contains('show')) document.getElementById('bugForm').requestSubmit();
        else if (State.currentView === 'dailylog') document.getElementById('dailyLogForm').requestSubmit();
        else { Store.save(); toast('All changes saved.', 'secondary'); }
      } else if (e.key === 'Escape') {
        document.getElementById('searchResults').classList.add('d-none');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => console.error('DevTrack: init() failed.', err));
  });
})();
