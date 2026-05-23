// ================================================================
// TALITHA CONFECCIONISTAS — app.js
// ================================================================

// ================================================================
// 1. CONFIGURACIÓN
// ================================================================
const SUPABASE_URL      = 'https://ztqhdxvvffuxifupgftr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0cWhkeHZ2ZmZ1eGlmdXBnZnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NzAwMTIsImV4cCI6MjA5NTA0NjAxMn0.y2BJorv6NQUJSI2PNQ9M408bsv8nannAq1b3zpPinto';
const DOMAIN            = 'talitha-conf.app';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } }
});

// ================================================================
// 2. CONSTANTES
// ================================================================
const STATUSES = {
  pending:     { label: 'Pendiente',   class: 'status-pending',     icon: '⏳' },
  in_progress: { label: 'En proceso',  class: 'status-in_progress', icon: '🧵' },
  delivered:   { label: 'Entregado',   class: 'status-delivered',   icon: '✅' }
};

// ================================================================
// 3. ESTADO GLOBAL
// ================================================================
const state = {
  user:                null,
  profile:             null,
  tasks:               [],
  garments:            [],
  garmentParts:        {},   // { garment_id: [parts] }
  confeccionistas:     [],
  currentTask:         null,
  currentTaskParts:    [],
  currentGarment:      null,
  currentGarmentParts: [],
  taskFilter:          'all',
  currentView:         'view-tasks',
  prevView:            null,
  realtimeSub:         null,
  pendingConfirm:      null
};

// ================================================================
// 4. INICIALIZACIÓN
// ================================================================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  showSection('view-loading');
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await loadProfile(session.user);
  } else {
    showSection('view-login');
  }
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session && !state.profile) {
      await loadProfile(session.user);
    } else if (event === 'SIGNED_OUT') {
      resetState();
      showSection('view-login');
    }
  });
}

function resetState() {
  state.user = null;
  state.profile = null;
  state.tasks = [];
  state.garments = [];
  state.garmentParts = {};
  state.confeccionistas = [];
  state.currentTask = null;
  state.currentTaskParts = [];
  state.currentGarment = null;
  state.currentGarmentParts = [];
  if (state.realtimeSub) { state.realtimeSub.unsubscribe(); state.realtimeSub = null; }
}

// ================================================================
// 5. AUTH
// ================================================================
async function handleLogin() {
  const phone    = document.getElementById('login-phone').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('btn-login');

  if (!phone || !password) {
    errEl.textContent = 'Ingresa celular y contraseña.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.textContent = 'Ingresando...';
  btn.disabled = true;
  errEl.classList.add('hidden');

  const { error } = await sb.auth.signInWithPassword({
    email: `${phone}@${DOMAIN}`,
    password
  });

  btn.textContent = 'Ingresar';
  btn.disabled = false;

  if (error) {
    errEl.textContent = 'Celular o contraseña incorrectos.';
    errEl.classList.remove('hidden');
  }
}

async function handleLogout() {
  await sb.auth.signOut();
}

// ================================================================
// 6. PERFIL Y SETUP DE UI
// ================================================================
async function loadProfile(user) {
  state.user = user;
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (!data) {
    await sb.auth.signOut();
    showSection('view-login');
    return;
  }
  if (!data.is_active) {
    showToast('Tu cuenta está desactivada. Contacta al administrador.', 'error');
    await sb.auth.signOut();
    showSection('view-login');
    return;
  }
  state.profile = data;
  setupUI();
}

async function setupUI() {
  const isAdmin = state.profile?.role === 'admin';

  // Nav
  document.getElementById('nav-admin').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('nav-conf').style.display  = isAdmin ? 'none' : 'flex';

  // Stats bar only for admin
  document.getElementById('tasks-stats').classList.toggle('hidden', !isAdmin);

  showSection('app-shell');

  // Load data
  await loadTasks();
  if (isAdmin) {
    await Promise.all([loadGarments(), loadConfeccionistas()]);
  }

  setupRealtime();
  showMainView('view-tasks');
}

// ================================================================
// 7. CARGA DE DATOS
// ================================================================
async function loadTasks() {
  const isAdmin = state.profile?.role === 'admin';
  let query = sb.from('tasks')
    .select('*, profiles!tasks_confeccionista_id_fkey(full_name), garments(name, reference)')
    .order('created_at', { ascending: false });

  if (!isAdmin) {
    query = query.eq('confeccionista_id', state.user.id);
  }

  const { data } = await query;
  state.tasks = data || [];
  renderTasks();
  updateStats();
}

async function loadGarments() {
  const { data } = await sb.from('garments').select('*').order('created_at', { ascending: false });
  state.garments = data || [];
  renderGarments();
}

async function loadConfeccionistas() {
  const { data } = await sb.from('profiles')
    .select('*')
    .eq('role', 'confeccionista')
    .order('full_name');
  state.confeccionistas = data || [];
  renderUsers();
}

async function loadGarmentParts(garmentId) {
  const { data } = await sb.from('garment_parts')
    .select('*')
    .eq('garment_id', garmentId)
    .order('sort_order');
  state.garmentParts[garmentId] = data || [];
  return data || [];
}

async function loadTaskDetail(taskId) {
  const { data: task } = await sb.from('tasks')
    .select('*, profiles!tasks_confeccionista_id_fkey(full_name), garments(name, reference)')
    .eq('id', taskId)
    .single();
  const { data: parts } = await sb.from('task_parts')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at');

  state.currentTask = task;
  state.currentTaskParts = parts || [];
  renderTaskDetail();
  showDetailView('view-task-detail', task?.garments?.name || 'Tarea');
}

async function loadGarmentDetail(garmentId) {
  const garment = state.garments.find(g => g.id === garmentId);
  state.currentGarment = garment;
  const parts = await loadGarmentParts(garmentId);
  state.currentGarmentParts = parts;
  renderGarmentDetail();
  showDetailView('view-garment-detail', garment?.name || 'Prenda');
}

// ================================================================
// 8. REALTIME
// ================================================================
function setupRealtime() {
  if (state.realtimeSub) state.realtimeSub.unsubscribe();

  const isAdmin = state.profile?.role === 'admin';

  state.realtimeSub = sb.channel('conf-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, payload => {
      const { eventType, new: newRec, old: oldRec } = payload;
      if (eventType === 'INSERT') {
        if (!isAdmin && newRec.confeccionista_id !== state.user.id) return;
        loadTasks();
      } else if (eventType === 'UPDATE') {
        const idx = state.tasks.findIndex(t => t.id === newRec.id);
        if (idx >= 0) {
          state.tasks[idx] = { ...state.tasks[idx], ...newRec };
          renderTasks();
          updateStats();
          if (state.currentTask?.id === newRec.id) {
            state.currentTask = { ...state.currentTask, ...newRec };
            renderTaskDetail();
          }
        } else {
          loadTasks();
        }
      } else if (eventType === 'DELETE') {
        state.tasks = state.tasks.filter(t => t.id !== oldRec.id);
        renderTasks();
        updateStats();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_parts' }, payload => {
      if (state.currentTask) {
        const { eventType, new: newRec, old: oldRec } = payload;
        if (eventType === 'UPDATE') {
          const idx = state.currentTaskParts.findIndex(p => p.id === newRec.id);
          if (idx >= 0) state.currentTaskParts[idx] = { ...state.currentTaskParts[idx], ...newRec };
          renderTaskDetail();
        } else if (eventType === 'INSERT') {
          state.currentTaskParts.push(newRec);
          renderTaskDetail();
        } else if (eventType === 'DELETE') {
          state.currentTaskParts = state.currentTaskParts.filter(p => p.id !== oldRec.id);
          renderTaskDetail();
        }
      }
    })
    .subscribe();
}

// ================================================================
// 9. RENDER — TASKS LIST
// ================================================================
function setTaskFilter(filter) {
  state.taskFilter = filter;
  document.querySelectorAll('.task-filter-btn').forEach(btn => {
    btn.classList.toggle('active-filter', btn.dataset.filter === filter);
    btn.classList.toggle('bg-gold-500', btn.dataset.filter === filter);
    btn.classList.toggle('text-white', btn.dataset.filter === filter);
    btn.classList.toggle('border-gold-500', btn.dataset.filter === filter);
  });
  renderTasks();
}

function renderTasks() {
  const container = document.getElementById('tasks-list');
  const isAdmin   = state.profile?.role === 'admin';
  let tasks = state.tasks;

  if (state.taskFilter !== 'all') {
    tasks = tasks.filter(t => t.status === state.taskFilter);
  }

  if (tasks.length === 0) {
    container.innerHTML = `<div class="text-center py-10 text-slate-500">
      <p class="text-4xl mb-3">🧵</p>
      <p class="text-sm">${state.taskFilter === 'all' ? 'Sin tareas asignadas.' : 'Sin tareas en este estado.'}</p>
    </div>`;
    return;
  }

  container.innerHTML = tasks.map(task => {
    const st = STATUSES[task.status];
    const confName = task.profiles?.full_name || 'Sin asignar';
    const garmentName = task.garments?.name || 'Prenda';
    const garmentRef  = task.garments?.reference || '';
    return `
    <div onclick="loadTaskDetail('${task.id}')"
      class="dark:bg-talitha-card bg-white rounded-2xl p-4 shadow-sm border dark:border-neutral-800 border-slate-200 cursor-pointer active:scale-95 transition-all fade-in">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-sm truncate">${escHtml(garmentName)}</h3>
          <p class="text-xs text-gold-400 font-mono">${escHtml(garmentRef)}</p>
        </div>
        <span class="text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 ${st.class}">${st.icon} ${st.label}</span>
      </div>
      <div class="flex items-center gap-3 text-xs text-slate-400">
        ${isAdmin ? `<span class="flex items-center gap-1"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>${escHtml(confName)}</span>` : ''}
        <span class="flex items-center gap-1"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg>${task.quantity} unid.</span>
        <span class="ml-auto">${formatDate(task.created_at)}</span>
      </div>
      ${task.delivery_photo_url ? '<div class="mt-2 flex items-center gap-1 text-xs text-blue-400"><span>📦</span> Insumos entregados</div>' : ''}
      ${task.completion_photo_url ? '<div class="mt-1 flex items-center gap-1 text-xs text-green-400"><span>✅</span> Producto entregado</div>' : ''}
    </div>`;
  }).join('');
}

function updateStats() {
  if (state.profile?.role !== 'admin') return;
  document.getElementById('stat-pending').textContent     = state.tasks.filter(t => t.status === 'pending').length;
  document.getElementById('stat-in-progress').textContent = state.tasks.filter(t => t.status === 'in_progress').length;
  document.getElementById('stat-delivered').textContent   = state.tasks.filter(t => t.status === 'delivered').length;
}

// ================================================================
// 10. RENDER — TASK DETAIL
// ================================================================
function renderTaskDetail() {
  const task  = state.currentTask;
  const parts = state.currentTaskParts;
  if (!task) return;

  const isAdmin = state.profile?.role === 'admin';
  const isConf  = state.profile?.role === 'confeccionista';
  const st = STATUSES[task.status];

  document.getElementById('td-garment-name').textContent = task.garments?.name || '—';
  document.getElementById('td-garment-ref').textContent  = task.garments?.reference || '';
  document.getElementById('td-conf-name').textContent    = task.profiles?.full_name || '—';
  document.getElementById('td-quantity').textContent     = task.quantity + ' unid.';
  document.getElementById('td-created-at').textContent   = formatDateTime(task.created_at);

  const badge = document.getElementById('td-status-badge');
  badge.className = `text-xs font-semibold px-3 py-1.5 rounded-xl flex-shrink-0 ${st.class}`;
  badge.textContent = `${st.icon} ${st.label}`;

  // Delivered date
  if (task.delivered_at) {
    document.getElementById('td-delivered-row').classList.remove('hidden');
    document.getElementById('td-delivered-at').textContent = formatDateTime(task.delivered_at);
  } else {
    document.getElementById('td-delivered-row').classList.add('hidden');
  }

  // Notes
  if (task.notes) {
    document.getElementById('td-notes-row').classList.remove('hidden');
    document.getElementById('td-notes').textContent = task.notes;
  } else {
    document.getElementById('td-notes-row').classList.add('hidden');
  }

  // Parts
  const partsContainer = document.getElementById('td-parts-list');
  const completedParts = parts.filter(p => p.quantity_delivered >= p.quantity_assigned && p.quantity_assigned > 0).length;
  document.getElementById('td-parts-progress').textContent = parts.length > 0 ? `${completedParts}/${parts.length} partes` : '';

  if (parts.length === 0) {
    partsContainer.innerHTML = '<p class="text-xs text-slate-500 text-center py-2">Sin partes registradas.</p>';
  } else {
    partsContainer.innerHTML = parts.map(part => {
      const done = part.quantity_delivered >= part.quantity_assigned && part.quantity_assigned > 0;
      return `
      <div class="rounded-xl border ${done ? 'dark:border-green-700/30 border-green-300' : 'dark:border-neutral-700 border-slate-200'} overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 dark:bg-neutral-800/50 bg-slate-50">
          <div class="flex-1 min-w-0">
            <span class="font-semibold text-sm ${done ? 'line-through text-slate-500' : ''}">${escHtml(part.part_name)}</span>
            ${part.fabric_type ? `<span class="text-xs text-slate-400 ml-2 italic">${escHtml(part.fabric_type)}</span>` : ''}
          </div>
          <span class="text-xs ${done ? 'text-green-400 font-bold' : 'text-slate-400'}">${part.quantity_delivered}/${part.quantity_assigned}</span>
        </div>
        ${isConf && task.status !== 'delivered' ? `
        <div class="flex items-center gap-2 px-3 py-2">
          <label class="text-xs text-slate-500 flex-shrink-0">Entregado:</label>
          <input type="number" min="0" max="${part.quantity_assigned}" value="${part.quantity_delivered}"
            class="flex-1 px-2 py-1.5 rounded-lg border dark:border-neutral-700 border-slate-300 dark:bg-neutral-900 bg-slate-50 text-sm text-center focus:outline-none focus:ring-2 focus:ring-gold-500"
            onchange="updatePartDelivered('${part.id}', this.value, ${part.quantity_assigned})" />
          <span class="text-xs text-slate-500">/ ${part.quantity_assigned}</span>
        </div>` : ''}
      </div>`;
    }).join('');
  }

  // Delivery photo (admin uploads)
  const delivImg = document.getElementById('td-delivery-photo-img');
  const delivNone = document.getElementById('td-delivery-no-photo');
  const delivUpload = document.getElementById('td-delivery-upload-section');

  if (task.delivery_photo_url) {
    delivImg.src = task.delivery_photo_url;
    delivImg.classList.remove('hidden');
    delivNone.classList.add('hidden');
  } else {
    delivImg.classList.add('hidden');
    delivNone.classList.remove('hidden');
  }
  delivUpload.classList.toggle('hidden', !isAdmin);

  // Completion photo (confeccionista uploads)
  const compImg = document.getElementById('td-completion-photo-img');
  const compNone = document.getElementById('td-completion-no-photo');
  const compUpload = document.getElementById('td-completion-upload-section');

  if (task.completion_photo_url) {
    compImg.src = task.completion_photo_url;
    compImg.classList.remove('hidden');
    compNone.classList.add('hidden');
  } else {
    compImg.classList.add('hidden');
    compNone.classList.remove('hidden');
  }
  compUpload.classList.toggle('hidden', !(isConf && task.status === 'in_progress'));

  // Action buttons
  const actionsEl = document.getElementById('td-actions');
  actionsEl.innerHTML = '';

  if (isConf) {
    if (task.status === 'pending') {
      actionsEl.innerHTML = `<button onclick="updateTaskStatus('${task.id}', 'in_progress')"
        class="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-sm active:scale-95 transition-all">
        🧵 Iniciar trabajo
      </button>`;
    } else if (task.status === 'in_progress') {
      actionsEl.innerHTML = `<button onclick="markTaskDelivered('${task.id}')"
        class="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm active:scale-95 transition-all">
        ✅ Marcar como Entregado
      </button>`;
    }
  }

  if (isAdmin) {
    if (task.status !== 'delivered') {
      const nextStatus = task.status === 'pending' ? 'in_progress' : 'delivered';
      const nextLabel  = task.status === 'pending' ? '🧵 Poner En Proceso' : '✅ Marcar Entregado';
      actionsEl.innerHTML = `<button onclick="updateTaskStatus('${task.id}', '${nextStatus}')"
        class="w-full py-3 border border-gold-500/40 text-gold-400 rounded-xl text-sm font-medium hover:bg-gold-500/10 transition-all active:scale-95">
        ${nextLabel}
      </button>`;
    }
    document.getElementById('td-admin-delete').classList.remove('hidden');
  } else {
    document.getElementById('td-admin-delete').classList.add('hidden');
  }
}

// ================================================================
// 11. RENDER — GARMENTS
// ================================================================
function renderGarments() {
  const container = document.getElementById('garments-list');
  const emptyEl   = document.getElementById('garments-empty');

  if (state.garments.length === 0) {
    container.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  container.innerHTML = state.garments.map(g => `
    <div onclick="loadGarmentDetail('${g.id}')"
      class="dark:bg-talitha-card bg-white rounded-2xl p-4 shadow-sm border dark:border-neutral-800 border-slate-200 cursor-pointer active:scale-95 transition-all fade-in">
      <div class="flex items-center justify-between">
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-sm">${escHtml(g.name)}</h3>
          <p class="text-xs text-gold-400 font-mono mt-0.5">${escHtml(g.reference)}</p>
          ${g.description ? `<p class="text-xs text-slate-400 mt-1 truncate">${escHtml(g.description)}</p>` : ''}
        </div>
        <svg class="w-5 h-5 text-slate-600 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
      </div>
    </div>
  `).join('');
}

function renderGarmentDetail() {
  const g = state.currentGarment;
  if (!g) return;

  document.getElementById('gd-name').textContent = g.name;
  document.getElementById('gd-ref').textContent  = g.reference;
  document.getElementById('gd-desc').textContent = g.description || '';

  const partsEl  = document.getElementById('gd-parts-list');
  const emptyEl  = document.getElementById('gd-parts-empty');
  const parts    = state.currentGarmentParts;

  if (parts.length === 0) {
    partsEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
    partsEl.innerHTML = parts.map(p => `
      <div class="flex items-center gap-3 px-3 py-2.5 rounded-xl dark:bg-neutral-800/50 bg-slate-50">
        <div class="flex-1 min-w-0">
          <span class="font-semibold text-sm">${escHtml(p.part_name)}</span>
          ${p.fabric_type ? `<span class="text-xs text-slate-400 ml-2 italic">${escHtml(p.fabric_type)}</span>` : ''}
          <span class="text-xs text-slate-500 ml-2">× ${p.quantity_per_unit} por unidad</span>
        </div>
        <button onclick="deleteGarmentPart('${p.id}')" class="p-1.5 text-red-400/50 hover:text-red-400 transition-colors flex-shrink-0">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    `).join('');
  }
}

// ================================================================
// 12. RENDER — USERS
// ================================================================
function renderUsers() {
  const container = document.getElementById('users-list');
  const emptyEl   = document.getElementById('users-empty');

  if (state.confeccionistas.length === 0) {
    container.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  container.innerHTML = state.confeccionistas.map(u => `
    <div class="dark:bg-talitha-card bg-white rounded-2xl p-4 shadow-sm border dark:border-neutral-800 border-slate-200 fade-in">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full dark:bg-neutral-700 bg-slate-200 flex items-center justify-center flex-shrink-0">
            <span class="text-sm font-bold dark:text-slate-300 text-slate-600">${escHtml(u.full_name.charAt(0).toUpperCase())}</span>
          </div>
          <div>
            <p class="font-semibold text-sm">${escHtml(u.full_name)}</p>
            <p class="text-xs text-slate-500">${escHtml(u.phone)}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs px-2 py-1 rounded-lg ${u.is_active ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}">${u.is_active ? 'Activo' : 'Inactivo'}</span>
          <button onclick="toggleUserActive('${u.id}', ${u.is_active})" class="p-1.5 text-slate-400 hover:text-amber-400 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </button>
          <button onclick="confirmDeleteUser('${u.id}', '${escHtml(u.full_name)}')" class="p-1.5 text-red-400/50 hover:text-red-400 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// ================================================================
// 13. CRUD — TASKS
// ================================================================
function previewTaskParts() {
  const garmentId = document.getElementById('nt-garment').value;
  const qty       = parseInt(document.getElementById('nt-quantity').value) || 0;
  const previewEl = document.getElementById('nt-parts-preview');
  const listEl    = document.getElementById('nt-parts-list');

  if (!garmentId || qty < 1) { previewEl.classList.add('hidden'); return; }

  const parts = state.garmentParts[garmentId];
  if (!parts || parts.length === 0) { previewEl.classList.add('hidden'); return; }

  previewEl.classList.remove('hidden');
  listEl.innerHTML = parts.map(p => {
    const totalQty = p.quantity_per_unit * qty;
    return `<div class="flex items-center justify-between px-3 py-2 rounded-lg dark:bg-neutral-800/50 bg-slate-50 text-sm">
      <span>${escHtml(p.part_name)}${p.fabric_type ? ` <span class="text-xs text-slate-400 italic">${escHtml(p.fabric_type)}</span>` : ''}</span>
      <span class="font-bold text-gold-400">${totalQty}</span>
    </div>`;
  }).join('');
}

async function saveNewTask() {
  const garmentId = document.getElementById('nt-garment').value;
  const confId    = document.getElementById('nt-conf').value;
  const qty       = parseInt(document.getElementById('nt-quantity').value);
  const notes     = document.getElementById('nt-notes').value.trim();
  const errEl     = document.getElementById('nt-error');
  const btn       = document.getElementById('btn-save-task');

  if (!garmentId || !confId || !qty || qty < 1) {
    errEl.textContent = 'Prenda, confeccionista y cantidad son obligatorios.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.textContent = '⏳ Creando...';
  btn.disabled = true;
  errEl.classList.add('hidden');

  const { data: task, error } = await sb.from('tasks').insert({
    garment_id: garmentId,
    confeccionista_id: confId,
    quantity: qty,
    notes: notes || null,
    created_by: state.user.id
  }).select().single();

  if (error) {
    errEl.textContent = 'Error al crear tarea: ' + error.message;
    errEl.classList.remove('hidden');
    btn.textContent = '✓ Crear Tarea';
    btn.disabled = false;
    return;
  }

  // Auto-create task_parts from BOM
  const parts = state.garmentParts[garmentId] || [];
  if (parts.length > 0) {
    const rows = parts.map(p => ({
      task_id: task.id,
      part_name: p.part_name,
      fabric_type: p.fabric_type,
      quantity_assigned: p.quantity_per_unit * qty,
      quantity_delivered: 0
    }));
    await sb.from('task_parts').insert(rows);
  }

  closeModal('modal-new-task');
  btn.textContent = '✓ Crear Tarea';
  btn.disabled = false;
  await loadTasks();
  showToast('Tarea creada ✓');
}

async function updateTaskStatus(taskId, newStatus) {
  const updates = { status: newStatus };
  if (newStatus === 'delivered') updates.delivered_at = new Date().toISOString();

  const { error } = await sb.from('tasks').update(updates).eq('id', taskId);
  if (error) { showToast('Error al actualizar estado.', 'error'); return; }

  if (state.currentTask?.id === taskId) {
    state.currentTask = { ...state.currentTask, ...updates };
    renderTaskDetail();
  }
  const idx = state.tasks.findIndex(t => t.id === taskId);
  if (idx >= 0) { state.tasks[idx] = { ...state.tasks[idx], ...updates }; renderTasks(); updateStats(); }
  showToast(`Estado: ${STATUSES[newStatus].label} ✓`);
}

async function markTaskDelivered(taskId) {
  // Check if completion photo exists
  const task = state.currentTask;
  if (!task.completion_photo_url) {
    showToast('Sube la foto del producto terminado antes de marcar como entregado.', 'error');
    return;
  }
  await updateTaskStatus(taskId, 'delivered');
}

function confirmDeleteTask() {
  state.pendingConfirm = () => deleteTask(state.currentTask.id);
  document.getElementById('confirm-title').textContent = '¿Eliminar tarea?';
  document.getElementById('confirm-msg').textContent   = 'Esta acción eliminará la tarea y todas sus partes. No se puede deshacer.';
  document.getElementById('confirm-ok-btn').onclick = () => { closeModal('modal-confirm'); state.pendingConfirm(); };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

async function deleteTask(taskId) {
  await sb.from('tasks').delete().eq('id', taskId);
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  renderTasks();
  updateStats();
  showToast('Tarea eliminada.');
  goBack();
}

// ================================================================
// 14. CRUD — TASK PARTS
// ================================================================
async function updatePartDelivered(partId, value, maxQty) {
  const qty = Math.min(Math.max(0, parseInt(value) || 0), maxQty);
  const { error } = await sb.from('task_parts').update({ quantity_delivered: qty }).eq('id', partId);
  if (error) { showToast('Error al guardar.', 'error'); return; }
  const idx = state.currentTaskParts.findIndex(p => p.id === partId);
  if (idx >= 0) { state.currentTaskParts[idx].quantity_delivered = qty; renderTaskDetail(); }
}

// ================================================================
// 15. CRUD — GARMENTS + BOM
// ================================================================
async function saveNewGarment() {
  const name = document.getElementById('ng-name').value.trim();
  const ref  = document.getElementById('ng-ref').value.trim();
  const desc = document.getElementById('ng-desc').value.trim();
  const errEl = document.getElementById('ng-error');

  if (!name || !ref) {
    errEl.textContent = 'Nombre y referencia son obligatorios.';
    errEl.classList.remove('hidden');
    return;
  }

  const { data, error } = await sb.from('garments').insert({
    name, reference: ref, description: desc || null, created_by: state.user.id
  }).select().single();

  if (error) {
    errEl.textContent = 'Error: ' + error.message;
    errEl.classList.remove('hidden');
    return;
  }

  closeModal('modal-new-garment');
  state.garments.unshift(data);
  renderGarments();
  showToast('Prenda creada ✓');
  // Open garment detail to add parts
  await loadGarmentDetail(data.id);
}

async function saveGarmentPart() {
  const name    = document.getElementById('np-name').value.trim();
  const fabric  = document.getElementById('np-fabric').value.trim();
  const qty     = parseFloat(document.getElementById('np-qty').value) || 1;

  if (!name) { showToast('El nombre de la pieza es obligatorio.', 'error'); return; }

  const sortOrder = state.currentGarmentParts.length;
  const { data, error } = await sb.from('garment_parts').insert({
    garment_id: state.currentGarment.id,
    part_name: name,
    fabric_type: fabric || null,
    quantity_per_unit: qty,
    sort_order: sortOrder
  }).select().single();

  if (error) { showToast('Error al agregar parte.', 'error'); return; }

  state.currentGarmentParts.push(data);
  state.garmentParts[state.currentGarment.id] = state.currentGarmentParts;
  renderGarmentDetail();

  // Clear form
  document.getElementById('np-name').value = '';
  document.getElementById('np-fabric').value = '';
  document.getElementById('np-qty').value = '1';
  showToast('Parte agregada ✓');
}

async function deleteGarmentPart(partId) {
  await sb.from('garment_parts').delete().eq('id', partId);
  state.currentGarmentParts = state.currentGarmentParts.filter(p => p.id !== partId);
  state.garmentParts[state.currentGarment.id] = state.currentGarmentParts;
  renderGarmentDetail();
  showToast('Parte eliminada.');
}

function confirmDeleteGarment() {
  state.pendingConfirm = () => deleteGarment(state.currentGarment.id);
  document.getElementById('confirm-title').textContent = '¿Eliminar prenda?';
  document.getElementById('confirm-msg').textContent   = 'Esto eliminará la prenda y su lista de materiales. Las tareas existentes no se verán afectadas.';
  document.getElementById('confirm-ok-btn').onclick = () => { closeModal('modal-confirm'); state.pendingConfirm(); };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

async function deleteGarment(garmentId) {
  await sb.from('garments').delete().eq('id', garmentId);
  state.garments = state.garments.filter(g => g.id !== garmentId);
  renderGarments();
  showToast('Prenda eliminada.');
  goBack();
}

// ================================================================
// 16. CRUD — USERS
// ================================================================
async function saveNewUser() {
  const name     = document.getElementById('nu-name').value.trim();
  const phone    = document.getElementById('nu-phone').value.trim();
  const password = document.getElementById('nu-password').value;
  const errEl    = document.getElementById('nu-error');
  const btn      = document.getElementById('btn-save-user');

  if (!name || !phone || !password || password.length < 6) {
    errEl.textContent = 'Todos los campos son obligatorios. Contraseña mínimo 6 caracteres.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.textContent = '⏳ Creando...';
  btn.disabled = true;
  errEl.classList.add('hidden');

  const sessionResult = await sb.auth.getSession();
  const session = sessionResult?.data?.session;
  if (!session) {
    errEl.textContent = 'Sesión expirada. Vuelve a iniciar sesión.';
    errEl.classList.remove('hidden');
    btn.textContent = '✓ Crear Confeccionista';
    btn.disabled = false;
    return;
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ phone, password, full_name: name, role: 'confeccionista' }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const result = await response.json();

  btn.textContent = '✓ Crear Confeccionista';
  btn.disabled = false;

  if (!response.ok || result.error) {
    errEl.textContent = result.error || 'Error al crear usuario.';
    errEl.classList.remove('hidden');
    return;
  }

  closeModal('modal-new-user');
  await loadConfeccionistas();
  showToast(`${name} creado ✓`);
}

function confirmDeleteUser(userId, name) {
  state.pendingConfirm = () => deleteUser(userId);
  document.getElementById('confirm-title').textContent = '¿Eliminar confeccionista?';
  document.getElementById('confirm-msg').textContent   = `Eliminarás a ${name}. Sus tareas asignadas quedarán sin confeccionista.`;
  document.getElementById('confirm-ok-btn').onclick = () => { closeModal('modal-confirm'); state.pendingConfirm(); };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

async function deleteUser(userId) {
  const session = (await sb.auth.getSession())?.data?.session;
  if (!session) return;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ user_id: userId }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) { showToast('Error al eliminar usuario.', 'error'); return; }
  state.confeccionistas = state.confeccionistas.filter(u => u.id !== userId);
  renderUsers();
  showToast('Usuario eliminado.');
}

async function toggleUserActive(userId, currentActive) {
  const { error } = await sb.from('profiles').update({ is_active: !currentActive }).eq('id', userId);
  if (error) { showToast('Error al actualizar.', 'error'); return; }
  const idx = state.confeccionistas.findIndex(u => u.id === userId);
  if (idx >= 0) {
    state.confeccionistas[idx].is_active = !currentActive;
    renderUsers();
  }
  showToast((!currentActive ? 'Activado' : 'Desactivado') + ' ✓');
}

// ================================================================
// 17. FOTOS
// ================================================================
async function handlePhotoUpload(type, input) {
  const file = input.files?.[0];
  if (!file || !state.currentTask) return;

  showToast('Subiendo foto...', 'info');
  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `tasks/${state.currentTask.id}/${type}.${ext}`;

  const { error: uploadErr } = await sb.storage.from('production-photos').upload(path, file, { upsert: true });
  if (uploadErr) { showToast('Error al subir foto.', 'error'); return; }

  const { data: urlData } = sb.storage.from('production-photos').getPublicUrl(path);
  const photoUrl = urlData.publicUrl + '?t=' + Date.now();

  const field = type === 'delivery' ? 'delivery_photo_url' : 'completion_photo_url';
  const { error: updateErr } = await sb.from('tasks').update({ [field]: photoUrl }).eq('id', state.currentTask.id);
  if (updateErr) { showToast('Error al guardar URL.', 'error'); return; }

  state.currentTask[field] = photoUrl;
  const idx = state.tasks.findIndex(t => t.id === state.currentTask.id);
  if (idx >= 0) state.tasks[idx][field] = photoUrl;

  renderTaskDetail();
  showToast('Foto guardada ✓');
  input.value = '';
}

function viewPhoto(src) {
  document.getElementById('photo-viewer-img').src = src;
  document.getElementById('photo-viewer').classList.remove('hidden');
}

function closePhotoViewer() {
  document.getElementById('photo-viewer').classList.add('hidden');
}

// ================================================================
// 18. NAVEGACIÓN
// ================================================================
let _backView = 'view-tasks';

function showSection(id) {
  ['view-login','view-loading','app-shell'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
}

function showMainView(viewId) {
  // Show bottom nav view
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(viewId);
  if (el) el.classList.add('active');

  // Update nav highlights
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
    btn.classList.toggle('text-gold-400', btn.dataset.view === viewId);
  });

  // Header
  const titles = {
    'view-tasks':    'Talitha Confeccionistas',
    'view-garments': 'Prendas',
    'view-users':    'Confeccionistas'
  };
  document.getElementById('header-title').textContent = titles[viewId] || 'Talitha';
  document.getElementById('header-subtitle').classList.add('hidden');
  document.getElementById('header-back').classList.add('hidden');

  const isAdmin = state.profile?.role === 'admin';
  const actionEl = document.getElementById('header-action');
  const actionLabel = document.getElementById('header-action-label');

  if (isAdmin && viewId === 'view-tasks') {
    actionEl.classList.remove('hidden');
    actionLabel.textContent = 'Tarea';
  } else if (isAdmin && viewId === 'view-garments') {
    actionEl.classList.remove('hidden');
    actionLabel.textContent = 'Prenda';
  } else if (isAdmin && viewId === 'view-users') {
    actionEl.classList.remove('hidden');
    actionLabel.textContent = 'Usuario';
  } else {
    actionEl.classList.add('hidden');
  }

  state.currentView = viewId;
  _backView = viewId;

  // Populate selects for task modal
  if (viewId === 'view-tasks' && isAdmin) {
    populateTaskModal();
  }
}

function showDetailView(viewId, title) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(viewId);
  if (el) el.classList.add('active');

  document.getElementById('header-title').textContent = title;
  document.getElementById('header-subtitle').classList.add('hidden');
  document.getElementById('header-back').classList.remove('hidden');
  document.getElementById('header-action').classList.add('hidden');
  state.currentView = viewId;
}

function goBack() {
  showMainView(_backView);
  state.currentTask = null;
  state.currentGarment = null;
}

function handleHeaderAction() {
  if (state.currentView === 'view-tasks')    { populateTaskModal(); openModal('modal-new-task'); }
  if (state.currentView === 'view-garments') { openModal('modal-new-garment'); }
  if (state.currentView === 'view-users')    { openModal('modal-new-user'); }
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  // Clear errors
  const errEls = document.querySelectorAll(`#${id} [id$="-error"]`);
  errEls.forEach(el => el.classList.add('hidden'));
}

async function populateTaskModal() {
  const garmentSel = document.getElementById('nt-garment');
  const confSel    = document.getElementById('nt-conf');
  if (!garmentSel || !confSel) return;

  garmentSel.innerHTML = '<option value="">Seleccionar prenda...</option>';
  state.garments.forEach(g => {
    garmentSel.innerHTML += `<option value="${g.id}">${escHtml(g.name)} (${escHtml(g.reference)})</option>`;
  });

  confSel.innerHTML = '<option value="">Seleccionar confeccionista...</option>';
  state.confeccionistas.filter(u => u.is_active).forEach(u => {
    confSel.innerHTML += `<option value="${u.id}">${escHtml(u.full_name)}</option>`;
  });

  // Pre-load BOM for all garments if not cached
  for (const g of state.garments) {
    if (!state.garmentParts[g.id]) {
      await loadGarmentParts(g.id);
    }
  }

  // Reset form
  document.getElementById('nt-quantity').value = '';
  document.getElementById('nt-notes').value = '';
  document.getElementById('nt-parts-preview').classList.add('hidden');
}

// ================================================================
// 19. UTILIDADES
// ================================================================
let _toastTimeout;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg text-white whitespace-nowrap pointer-events-none transition-all`;
  el.classList.add(type === 'error' ? 'bg-red-500' : type === 'info' ? 'bg-blue-500' : 'bg-green-600');
  el.classList.remove('hidden');
  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => el.classList.add('hidden'), 3000);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-CO', { day:'2-digit', month:'short' }) + ' ' +
         d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Close modals on backdrop click
document.addEventListener('click', e => {
  ['modal-new-task','modal-new-garment','modal-new-user'].forEach(id => {
    const modal = document.getElementById(id);
    if (modal && e.target === modal) closeModal(id);
  });
});
