// ================================================================
// TALITHA CONFECCIONISTAS — app.js
// ================================================================

// ================================================================
// 1. CONFIGURACIÓN
// ================================================================
const SUPABASE_URL      = 'https://ztqhdxvvffuxifupgftr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0cWhkeHZ2ZmZ1eGlmdXBnZnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NzAwMTIsImV4cCI6MjA5NTA0NjAxMn0.y2BJorv6NQUJSI2PNQ9M408bsv8nannAq1b3zpPinto';
const DOMAIN            = 'talitha-conf.app';
const EDGE_BASE         = `${SUPABASE_URL}/functions/v1`;

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } }
});

// ================================================================
// 2. ESTADO
// ================================================================
const state = {
  user:                null,
  profile:             null,
  prendas:             [],
  confeccionistas:     [],
  currentPrenda:       null,
  currentAsignaciones: [],
  currentFilter:       'todas',
  currentNav:          'view-prendas',
  prevView:            null,
  realtimeSub:         null,
  pendingConfirm:      null
};

// ================================================================
// 3. UTILIDADES
// ================================================================
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' });
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `px-5 py-3 rounded-2xl text-sm font-medium shadow-2xl show ${
    type === 'error' ? 'bg-red-900 text-red-200' :
    type === 'warn'  ? 'bg-yellow-900 text-yellow-200' :
    'bg-zinc-800 text-green-400'
  }`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function confirmAction(title, msg, fn) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent   = msg;
  state.pendingConfirm = fn;
  openModal('modal-confirm');
}

function runConfirm() {
  if (state.pendingConfirm) { state.pendingConfirm(); state.pendingConfirm = null; }
  closeModal('modal-confirm');
}

function openPhoto(url) {
  document.getElementById('photo-overlay-img').src = url;
  document.getElementById('photo-overlay').classList.add('open');
}
function closePhoto() {
  document.getElementById('photo-overlay').classList.remove('open');
}

function statusBadge(status) {
  const map = {
    por_procesar: ['badge-por-procesar', '🟡 Por procesar'],
    en_proceso:   ['badge-en-proceso',   '🔵 En proceso'],
    entregado:    ['badge-entregado',    '✅ Entregado']
  };
  const [cls, label] = map[status] || ['',''];
  return `<span class="text-xs px-2.5 py-1 rounded-full font-medium ${cls}">${label}</span>`;
}

// ================================================================
// 4. INICIALIZACIÓN
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('confirm-btn').onclick = runConfirm;
  init();
});

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
  Object.assign(state, {
    user:null, profile:null, prendas:[], confeccionistas:[],
    currentPrenda:null, currentAsignaciones:[], currentFilter:'todas',
    currentNav:'view-prendas', prevView:null, pendingConfirm:null
  });
  if (state.realtimeSub) { sb.removeChannel(state.realtimeSub); state.realtimeSub = null; }
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
    errEl.classList.remove('hidden'); return;
  }
  btn.textContent = 'Ingresando...'; btn.disabled = true;
  errEl.classList.add('hidden');

  const { error } = await sb.auth.signInWithPassword({
    email: `${phone}@${DOMAIN}`, password
  });

  btn.textContent = 'Ingresar'; btn.disabled = false;
  if (error) {
    errEl.textContent = 'Celular o contraseña incorrectos.';
    errEl.classList.remove('hidden');
  }
}

async function handleLogout() {
  await sb.auth.signOut();
}

// ================================================================
// 6. PERFIL Y SETUP UI
// ================================================================
async function loadProfile(user) {
  state.user = user;
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (!data || error) { await sb.auth.signOut(); showSection('view-login'); return; }
  if (!data.is_active) {
    showToast('Tu cuenta está desactivada. Contacta al administrador.', 'error');
    await sb.auth.signOut(); showSection('view-login'); return;
  }
  state.profile = data;
  await setupUI();
}

async function setupUI() {
  const isAdmin = state.profile?.role === 'admin';
  document.getElementById('nav-admin').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('nav-conf').style.display  = isAdmin ? 'none'  : 'block';
  document.getElementById('prendas-stats').classList.toggle('hidden', !isAdmin);
  showSection('app-shell');
  await loadPrendas();
  if (isAdmin) await loadConfeccionistas();
  switchNav('view-prendas', 'nav-btn-prendas');
  setupRealtime();
}

// ================================================================
// 7. REALTIME
// ================================================================
function setupRealtime() {
  if (state.realtimeSub) sb.removeChannel(state.realtimeSub);
  state.realtimeSub = sb.channel('conf-realtime')
    .on('postgres_changes', { event:'*', schema:'public', table:'prendas' }, () => loadPrendas())
    .on('postgres_changes', { event:'*', schema:'public', table:'asignaciones' }, async () => {
      await loadPrendas();
      if (state.currentPrenda) await loadPrendaDetail(state.currentPrenda.id, false);
    })
    .subscribe();
}

// ================================================================
// 8. CARGA DE DATOS
// ================================================================
async function loadPrendas() {
  const { data, error } = await sb.from('prendas')
    .select('*, asignaciones(id, confeccionista_id)')
    .order('created_at', { ascending: false });

  if (error) { console.error('loadPrendas:', error); return; }

  const isAdmin = state.profile?.role === 'admin';
  state.prendas = isAdmin
    ? (data || [])
    : (data || []).filter(p => p.asignaciones?.some(a => a.confeccionista_id === state.user.id));

  renderPrendas();
}

async function loadConfeccionistas() {
  const { data } = await sb.from('profiles')
    .select('*').eq('role','confeccionista').order('full_name');
  state.confeccionistas = data || [];
}

async function loadPrendaDetail(prendaId, navigate = true) {
  const { data: prenda, error: pErr } = await sb.from('prendas')
    .select('*').eq('id', prendaId).single();
  if (pErr || !prenda) { showToast('Error cargando prenda', 'error'); return; }

  const { data: asigs } = await sb.from('asignaciones')
    .select('*, confeccionista:profiles!confeccionista_id(id, full_name, phone)')
    .eq('prenda_id', prendaId)
    .order('created_at');

  state.currentPrenda       = prenda;
  state.currentAsignaciones = asigs || [];
  renderPrendaDetail();
  if (navigate) showDetailView('view-prenda-detail', state.currentNav);
}

// ================================================================
// 9. RENDER — LISTA DE PRENDAS
// ================================================================
function renderPrendas() {
  const isAdmin   = state.profile?.role === 'admin';
  const container = document.getElementById('prendas-list');

  if (isAdmin) {
    document.getElementById('stat-por-procesar').textContent = state.prendas.filter(p => p.status==='por_procesar').length;
    document.getElementById('stat-en-proceso').textContent   = state.prendas.filter(p => p.status==='en_proceso').length;
    document.getElementById('stat-entregado').textContent    = state.prendas.filter(p => p.status==='entregado').length;
  }

  let prendas = state.prendas;
  if (state.currentFilter !== 'todas') prendas = prendas.filter(p => p.status === state.currentFilter);

  if (prendas.length === 0) {
    container.innerHTML = `<div class="text-center py-16 text-slate-500">
      <div class="text-5xl mb-4">🧵</div>
      <p class="text-sm">${state.currentFilter === 'todas'
        ? (isAdmin ? 'No hay prendas. Toca + para crear la primera.' : 'No tienes prendas asignadas aún.')
        : 'No hay prendas en este estado.'}</p>
    </div>`;
    return;
  }

  container.innerHTML = prendas.map(p => {
    const numAsigs = p.asignaciones?.length || 0;
    return `
    <div onclick="loadPrendaDetail('${p.id}')" class="card p-4 cursor-pointer fade-in">
      <div class="flex items-start justify-between gap-2 mb-2">
        <h3 class="font-bold text-white text-base leading-tight">${escHtml(p.nombre)}</h3>
        ${statusBadge(p.status)}
      </div>
      ${p.descripcion ? `<p class="text-slate-500 text-sm mb-2 line-clamp-2">${escHtml(p.descripcion)}</p>` : ''}
      <div class="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>📦 ${Number(p.total_unidades).toLocaleString()} unidades</span>
        ${isAdmin ? `<span>👷 ${numAsigs} asignación${numAsigs!==1?'es':''}</span>` : ''}
        <span>${formatDate(p.created_at)}</span>
      </div>
    </div>`;
  }).join('');
}

// ================================================================
// 10. RENDER — DETALLE DE PRENDA
// ================================================================
function renderPrendaDetail() {
  const prenda  = state.currentPrenda;
  const asigs   = state.currentAsignaciones;
  const isAdmin = state.profile?.role === 'admin';

  document.getElementById('header-title').textContent = prenda.nombre;

  const nextStatus = { por_procesar:'en_proceso', en_proceso:'entregado', entregado:null }[prenda.status];
  const nextLabel  = { en_proceso:'🔵 Marcar En proceso', entregado:'✅ Marcar Entregado' }[nextStatus] || '';

  document.getElementById('detail-prenda-info').innerHTML = `
    <div class="card p-4">
      <div class="flex items-start justify-between gap-2 mb-2">
        <h2 class="font-bold text-white text-lg leading-tight">${escHtml(prenda.nombre)}</h2>
        ${statusBadge(prenda.status)}
      </div>
      ${prenda.descripcion ? `<p class="text-slate-400 text-sm mb-2">${escHtml(prenda.descripcion)}</p>` : ''}
      <p class="text-sm text-slate-500">📦 <strong class="text-white">${Number(prenda.total_unidades).toLocaleString()}</strong> unidades totales</p>
      ${isAdmin ? `
      <div class="mt-3 pt-3 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
        ${nextStatus ? `<button onclick="updatePrendaStatus('${prenda.id}','${nextStatus}')"
          class="text-xs px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700">${nextLabel}</button>` : ''}
        <button onclick="confirmDeletePrenda('${prenda.id}')"
          class="text-xs text-red-400 hover:text-red-300 ml-auto">🗑 Eliminar prenda</button>
      </div>` : ''}
    </div>`;

  const container = document.getElementById('detail-asignaciones-list');
  isAdmin
    ? renderAsignacionesAdmin(asigs, container)
    : renderAsignacionesConf(asigs.filter(a => a.confeccionista_id === state.user.id), container);
}

function renderAsignacionesAdmin(asigs, container) {
  const groups = {};
  asigs.forEach(a => {
    if (!groups[a.confeccionista_id])
      groups[a.confeccionista_id] = { name: a.confeccionista?.full_name, phone: a.confeccionista?.phone, items: [] };
    groups[a.confeccionista_id].items.push(a);
  });

  let html = Object.entries(groups).map(([, g]) => `
    <div class="card overflow-hidden mb-3">
      <div class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
        <div class="w-9 h-9 rounded-full bg-gold-500/20 flex items-center justify-center text-gold-400 font-bold shrink-0">
          ${(g.name||'?').charAt(0).toUpperCase()}
        </div>
        <div class="min-w-0">
          <p class="font-semibold text-white text-sm">${escHtml(g.name||'Sin nombre')}</p>
          <p class="text-slate-500 text-xs">${escHtml(g.phone||'')}</p>
        </div>
      </div>
      ${g.items.map(a => `
        <div class="px-4 py-3 border-b border-zinc-900/80 last:border-0">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-semibold text-white text-sm">${escHtml(a.parte)}</p>
              ${a.descripcion ? `<p class="text-slate-400 text-xs mt-0.5">${escHtml(a.descripcion)}</p>` : ''}
              ${a.nota ? `<p class="text-yellow-400/80 text-xs mt-0.5">📝 ${escHtml(a.nota)}</p>` : ''}
            </div>
            <button onclick="confirmDeleteAsig('${a.id}')" class="text-red-400/40 hover:text-red-400 text-xl shrink-0">×</button>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
            <span class="text-slate-400">Asignadas: <strong class="text-white">${a.cantidad_asignada}</strong></span>
            <span class="text-slate-400">Confeccionadas: <strong class="text-blue-400">${a.cantidad_confeccionada}</strong></span>
            <span class="text-slate-400">Entregadas: <strong class="text-green-400">${a.cantidad_entregada}</strong></span>
            <span class="text-slate-400">Pendientes: <strong class="text-yellow-400">${Math.max(0, a.cantidad_asignada - a.cantidad_entregada)}</strong></span>
          </div>
          ${a.foto_url
            ? `<img src="${escHtml(a.foto_url)}" onclick="openPhoto('${escHtml(a.foto_url)}')"
                    class="h-24 w-36 object-cover rounded-xl cursor-pointer mt-2 border border-zinc-700" />`
            : '<p class="text-slate-600 text-xs mt-2">Sin foto de entrega</p>'}
        </div>`).join('')}
    </div>`).join('');

  if (!html) html = `<p class="text-center text-slate-500 text-sm py-8">Aún no hay asignaciones.<br>Usa el botón de abajo para agregar.</p>`;

  html += `<button onclick="openNewAsignacionModal()"
    class="w-full py-4 mt-1 border-2 border-dashed border-zinc-700 hover:border-gold-500/50 rounded-2xl
           text-slate-400 hover:text-gold-400 text-sm transition-colors flex items-center justify-center gap-2">
    <span class="text-xl font-light">+</span> Agregar Asignación
  </button>`;

  container.innerHTML = html;
}

function renderAsignacionesConf(asigs, container) {
  if (!asigs.length) {
    container.innerHTML = `<p class="text-center text-slate-500 text-sm py-8">No tienes asignaciones para esta prenda.</p>`;
    return;
  }
  container.innerHTML = asigs.map(a => `
    <div class="card p-4 mb-3">
      <p class="font-bold text-white text-base mb-0.5">${escHtml(a.parte)}</p>
      ${a.descripcion ? `<p class="text-slate-400 text-sm">${escHtml(a.descripcion)}</p>` : ''}
      ${a.nota ? `<p class="text-yellow-400/80 text-sm mt-1">📝 ${escHtml(a.nota)}</p>` : ''}

      <div class="bg-zinc-900 rounded-xl p-4 mt-3 border border-zinc-800 space-y-3">
        <p class="text-xs text-slate-500">Total asignadas: <strong class="text-white text-sm">${a.cantidad_asignada}</strong></p>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-slate-400 mb-1 block">Confeccionadas</label>
            <input type="number" id="inp-conf-${a.id}" value="${a.cantidad_confeccionada}"
                   min="0" max="${a.cantidad_asignada}"
                   oninput="calcPendientes('${a.id}',${a.cantidad_asignada})"
                   class="w-full px-3 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-xl font-bold text-center focus:outline-none focus:border-gold-500" />
          </div>
          <div>
            <label class="text-xs text-slate-400 mb-1 block">Entregadas</label>
            <input type="number" id="inp-entr-${a.id}" value="${a.cantidad_entregada}"
                   min="0" max="${a.cantidad_asignada}"
                   oninput="calcPendientes('${a.id}',${a.cantidad_asignada})"
                   class="w-full px-3 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-xl font-bold text-center focus:outline-none focus:border-gold-500" />
          </div>
        </div>
        <div class="flex items-center justify-between text-sm">
          <span class="text-slate-500">Pendientes: <strong id="pend-${a.id}" class="text-yellow-400">${Math.max(0, a.cantidad_asignada - a.cantidad_entregada)}</strong></span>
        </div>
        <button onclick="saveAsignacionProgress('${a.id}')" class="btn-gold py-3">💾 Guardar progreso</button>
      </div>

      <div class="mt-3 pt-3 border-t border-zinc-800">
        <p class="text-xs text-slate-500 mb-2">📸 Foto del trabajo terminado</p>
        ${a.foto_url ? `<img src="${escHtml(a.foto_url)}" onclick="openPhoto('${escHtml(a.foto_url)}')"
              class="w-full h-44 object-cover rounded-xl cursor-pointer mb-3 border border-zinc-700" />` : ''}
        <label class="flex items-center justify-center gap-2 w-full py-3 border border-zinc-700 hover:border-gold-500
                      rounded-xl text-sm text-slate-400 hover:text-gold-400 cursor-pointer transition-colors">
          📸 ${a.foto_url ? 'Cambiar foto' : 'Subir foto del trabajo'}
          <input type="file" accept="image/*" capture="environment" class="hidden"
                 onchange="handlePhotoUpload('${a.id}', this)" />
        </label>
      </div>
    </div>`).join('');
}

function calcPendientes(asigId, total) {
  const entr = parseInt(document.getElementById(`inp-entr-${asigId}`)?.value) || 0;
  const el   = document.getElementById(`pend-${asigId}`);
  if (el) el.textContent = Math.max(0, total - entr);
}

// ================================================================
// 11. CRUD — PRENDAS
// ================================================================
async function saveNewPrenda() {
  const nombre      = document.getElementById('new-prenda-nombre').value.trim();
  const descripcion = document.getElementById('new-prenda-descripcion').value.trim();
  const total       = parseInt(document.getElementById('new-prenda-total').value);

  if (!nombre)           { showToast('Ingresa el nombre de la prenda', 'error'); return; }
  if (!total || total<1) { showToast('Ingresa el total de unidades', 'error'); return; }

  const { error } = await sb.from('prendas').insert({
    nombre, descripcion, total_unidades: total,
    status: 'por_procesar', created_by: state.user.id
  });
  if (error) { showToast('Error al guardar', 'error'); console.error(error); return; }

  closeModal('modal-new-prenda');
  ['new-prenda-nombre','new-prenda-descripcion','new-prenda-total'].forEach(id =>
    document.getElementById(id).value = '');
  showToast('✅ Prenda creada');
  await loadPrendas();
}

async function updatePrendaStatus(prendaId, newStatus) {
  const { error } = await sb.from('prendas').update({ status: newStatus }).eq('id', prendaId);
  if (error) { showToast('Error al actualizar estado', 'error'); return; }
  showToast('Estado actualizado');
  await loadPrendaDetail(prendaId, false);
  await loadPrendas();
}

function confirmDeletePrenda(prendaId) {
  confirmAction(
    '¿Eliminar prenda?',
    'Se eliminarán también todas sus asignaciones. Esta acción no se puede deshacer.',
    async () => {
      const { error } = await sb.from('prendas').delete().eq('id', prendaId);
      if (error) { showToast('Error al eliminar', 'error'); return; }
      showToast('Prenda eliminada');
      goBack();
      await loadPrendas();
    }
  );
}

// ================================================================
// 12. CRUD — ASIGNACIONES
// ================================================================
async function saveNewAsignacion() {
  const confId      = document.getElementById('asig-confeccionista').value;
  const parte       = document.getElementById('asig-parte').value.trim();
  const descripcion = document.getElementById('asig-descripcion').value.trim();
  const nota        = document.getElementById('asig-nota').value.trim();
  const cantidad    = parseInt(document.getElementById('asig-cantidad').value);

  if (!confId)          { showToast('Selecciona un confeccionista', 'error'); return; }
  if (!parte)           { showToast('Ingresa la parte de la prenda', 'error'); return; }
  if (!cantidad || cantidad<1) { showToast('Ingresa la cantidad a asignar', 'error'); return; }

  const prendaId = state.currentPrenda.id;
  const { error } = await sb.from('asignaciones').insert({
    prenda_id: prendaId, confeccionista_id: confId,
    parte, descripcion, nota, cantidad_asignada: cantidad
  });
  if (error) { showToast('Error al guardar asignación', 'error'); console.error(error); return; }

  if (state.currentPrenda.status === 'por_procesar') {
    await sb.from('prendas').update({ status: 'en_proceso' }).eq('id', prendaId);
  }

  closeModal('modal-new-asignacion');
  ['asig-parte','asig-descripcion','asig-nota','asig-cantidad'].forEach(id =>
    document.getElementById(id).value = '');
  document.getElementById('asig-confeccionista').value = '';
  showToast('✅ Asignación guardada');
  await loadPrendaDetail(prendaId, false);
  await loadPrendas();
}

async function saveAsignacionProgress(asigId) {
  const confeccionada = parseInt(document.getElementById(`inp-conf-${asigId}`)?.value) || 0;
  const entregada     = parseInt(document.getElementById(`inp-entr-${asigId}`)?.value) || 0;

  const { error } = await sb.from('asignaciones').update({
    cantidad_confeccionada: confeccionada,
    cantidad_entregada:     entregada
  }).eq('id', asigId);

  if (error) { showToast('Error al guardar', 'error'); return; }
  showToast('✅ Progreso guardado');
  await loadPrendaDetail(state.currentPrenda.id, false);
}

function confirmDeleteAsig(asigId) {
  confirmAction(
    '¿Eliminar asignación?',
    'Se eliminará esta asignación.',
    async () => {
      const { error } = await sb.from('asignaciones').delete().eq('id', asigId);
      if (error) { showToast('Error al eliminar', 'error'); return; }
      showToast('Asignación eliminada');
      await loadPrendaDetail(state.currentPrenda.id, false);
    }
  );
}

// ================================================================
// 13. FOTO
// ================================================================
async function handlePhotoUpload(asigId, input) {
  const file = input.files[0];
  if (!file) return;
  showToast('Subiendo foto...', 'warn');

  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `asignaciones/${asigId}-${Date.now()}.${ext}`;

  const { error: upErr } = await sb.storage.from('production-photos').upload(path, file, { upsert: true });
  if (upErr) { showToast('Error al subir foto', 'error'); return; }

  const { data: { publicUrl } } = sb.storage.from('production-photos').getPublicUrl(path);
  const { error } = await sb.from('asignaciones').update({ foto_url: publicUrl }).eq('id', asigId);
  if (error) { showToast('Error al guardar URL', 'error'); return; }

  showToast('📸 Foto subida');
  await loadPrendaDetail(state.currentPrenda.id, false);
}

// ================================================================
// 14. USUARIOS
// ================================================================
async function loadUsers() {
  const { data } = await sb.from('profiles')
    .select('*').order('role').order('full_name');
  state.allUsers = data || [];
  renderUsers();
}

function renderUsers() {
  const container = document.getElementById('users-list');
  const users = state.allUsers || [];
  if (!users.length) {
    container.innerHTML = `<div class="text-center py-16 text-slate-500">
      <div class="text-5xl mb-4">👷</div>
      <p class="text-sm">No hay usuarios. Toca "Crear nuevo usuario" para agregar.</p>
    </div>`;
    return;
  }
  container.innerHTML = users.map(u => {
    const isAdmin = u.role === 'admin';
    const roleBadge = isAdmin
      ? `<span class="text-xs px-2 py-0.5 rounded-full bg-gold-500/20 text-gold-400 border border-gold-500/30 font-medium">⭐ Admin</span>`
      : `<span class="text-xs px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-800/40 font-medium">🧵 Confeccionista</span>`;
    return `
    <div class="card p-4 flex items-center gap-3">
      <div class="w-11 h-11 rounded-full bg-gold-500/20 flex items-center justify-center text-gold-400 font-bold text-base shrink-0">
        ${(u.full_name||'?').charAt(0).toUpperCase()}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="font-semibold text-white text-sm truncate">${escHtml(u.full_name||'')}</p>
          ${roleBadge}
        </div>
        <p class="text-slate-500 text-xs mt-0.5">${escHtml(u.phone||'')}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button onclick="toggleUserActive('${u.id}',${u.is_active})"
          class="text-xs px-3 py-1.5 rounded-lg border transition-colors ${u.is_active
            ? 'border-green-800 text-green-400 hover:text-red-400 hover:border-red-800'
            : 'border-red-800 text-red-400 hover:text-green-400 hover:border-green-800'}">
          ${u.is_active ? 'Activo' : 'Inactivo'}
        </button>
        <button onclick="confirmDeleteUser('${u.id}','${escHtml(u.full_name||'')}')"
          class="text-red-400/40 hover:text-red-400 text-xl">×</button>
      </div>
    </div>`;
  }).join('');
}

async function saveNewUser() {
  const name     = document.getElementById('new-user-name').value.trim();
  const phone    = document.getElementById('new-user-phone').value.trim();
  const password = document.getElementById('new-user-password').value;
  const errEl    = document.getElementById('new-user-error');
  const btn      = document.getElementById('btn-save-user');

  if (!name || !phone || !password) {
    errEl.textContent = 'Completa todos los campos.'; errEl.classList.remove('hidden'); return;
  }
  if (password.length < 6) {
    errEl.textContent = 'Contraseña mínimo 6 caracteres.'; errEl.classList.remove('hidden'); return;
  }

  btn.textContent = 'Creando...'; btn.disabled = true; errEl.classList.add('hidden');

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${EDGE_BASE}/create-user`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${session.access_token}` },
      body: JSON.stringify({ phone, password, full_name: name, role: document.getElementById('new-user-role').value || 'confeccionista' }),
      signal: ctrl.signal
    });
    clearTimeout(timeout);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error al crear');

    closeModal('modal-new-user');
    ['new-user-name','new-user-phone','new-user-password'].forEach(id => document.getElementById(id).value = '');
    selectRole('confeccionista'); // reset role selector
    showToast('✅ Usuario creado');
    await loadUsers();
    await loadConfeccionistas();
  } catch (err) {
    clearTimeout(timeout);
    errEl.textContent = err.name === 'AbortError' ? 'Tiempo agotado.' : (err.message || 'Error al crear.');
    errEl.classList.remove('hidden');
  } finally {
    btn.textContent = 'Crear Usuario'; btn.disabled = false;
  }
}

async function toggleUserActive(userId, current) {
  const { error } = await sb.from('profiles').update({ is_active: !current }).eq('id', userId);
  if (error) { showToast('Error al actualizar', 'error'); return; }
  showToast(current ? 'Usuario desactivado' : 'Usuario activado');
  await loadUsers();      // refresh full user list
  await loadConfeccionistas(); // keep confeccionistas in sync for asignacion modal
}

function confirmDeleteUser(userId, name) {
  confirmAction(
    `¿Eliminar a ${name}?`,
    'Se eliminará el usuario permanentemente.',
    async () => {
      try {
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch(`${EDGE_BASE}/delete-user`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${session.access_token}` },
          body: JSON.stringify({ userId })
        });
        if (!res.ok) throw new Error();
        showToast('Usuario eliminado');
        await loadUsers();
        await loadConfeccionistas();
      } catch { showToast('Error al eliminar', 'error'); }
    }
  );
}

// ================================================================
// 15. MODALES
// ================================================================
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function openNewPrendaModal() {
  ['new-prenda-nombre','new-prenda-descripcion','new-prenda-total']
    .forEach(id => document.getElementById(id).value = '');
  openModal('modal-new-prenda');
  setTimeout(() => document.getElementById('new-prenda-nombre').focus(), 200);
}

function openNewAsignacionModal() {
  const sel = document.getElementById('asig-confeccionista');
  sel.innerHTML = '<option value="">Seleccionar confeccionista...</option>' +
    state.confeccionistas.map(c =>
      `<option value="${c.id}">${escHtml(c.full_name)} — ${escHtml(c.phone||'')}</option>`).join('');
  ['asig-parte','asig-descripcion','asig-nota','asig-cantidad']
    .forEach(id => document.getElementById(id).value = '');
  openModal('modal-new-asignacion');
  setTimeout(() => document.getElementById('asig-confeccionista').focus(), 200);
}

function openNewUserModal() {
  ['new-user-name','new-user-phone','new-user-password']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('new-user-error').classList.add('hidden');
  selectRole('confeccionista'); // default role
  openModal('modal-new-user');
  setTimeout(() => document.getElementById('new-user-name').focus(), 200);
}

function selectRole(role) {
  document.getElementById('new-user-role').value = role;
  const activeClass   = 'border-gold-500 bg-gold-500/10 text-gold-400';
  const inactiveClass = 'border-zinc-700 bg-transparent text-slate-400';
  document.getElementById('role-btn-conf').className  =
    `role-btn py-3 px-4 rounded-xl border text-sm font-medium text-center transition-all ${role === 'confeccionista' ? activeClass : inactiveClass}`;
  document.getElementById('role-btn-admin').className =
    `role-btn py-3 px-4 rounded-xl border text-sm font-medium text-center transition-all ${role === 'admin' ? activeClass : inactiveClass}`;
}

// ================================================================
// 16. NAVEGACIÓN
// ================================================================
function showSection(id) {
  const sections = { 'view-loading':true, 'view-login':true, 'app-shell':true };
  Object.keys(sections).forEach(s => {
    const el = document.getElementById(s);
    if (!el) return;
    el.style.display = (s === id) ? 'flex' : 'none';
  });
  if (id === 'view-loading') {
    document.getElementById('view-loading').style.display = 'flex';
  }
}

function showMainView(viewId) {
  ['view-prendas','view-prenda-detail','view-users'].forEach(v =>
    document.getElementById(v)?.classList.toggle('active', v === viewId));

  document.getElementById('btn-back').classList.add('hidden');
  document.getElementById('header-logo').style.display = 'block';

  const isAdmin   = state.profile?.role === 'admin';
  const actionBtn = document.getElementById('btn-header-action');

  if (viewId === 'view-prendas') {
    document.getElementById('header-title').textContent = 'Talitha Confeccionistas';
    actionBtn.classList.toggle('hidden', !isAdmin);
  } else if (viewId === 'view-users') {
    document.getElementById('header-title').textContent = 'Usuarios';
    actionBtn.classList.toggle('hidden', !isAdmin);
    loadUsers();
  }
  state.prevView = null;
}

function showDetailView(viewId, backView) {
  state.prevView = backView;
  ['view-prendas','view-prenda-detail','view-users'].forEach(v =>
    document.getElementById(v)?.classList.toggle('active', v === viewId));

  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('header-logo').style.display = 'none';

  const isAdmin   = state.profile?.role === 'admin';
  const actionBtn = document.getElementById('btn-header-action');

  if (viewId === 'view-prenda-detail') {
    const done = state.currentPrenda?.status === 'entregado';
    actionBtn.classList.toggle('hidden', !isAdmin || done);
  } else {
    actionBtn.classList.add('hidden');
  }
}

function goBack() {
  const prev = state.prevView || state.currentNav;
  const btnId = prev === 'view-users' ? 'nav-btn-users' : 'nav-btn-prendas';
  switchNav(prev, btnId);
}

function switchNav(viewId, btnId) {
  state.currentNav = viewId;
  ['nav-btn-prendas','nav-btn-users'].forEach(id =>
    document.getElementById(id)?.classList.toggle('active', id === btnId));
  showMainView(viewId);
}

function setFilter(filter) {
  state.currentFilter = filter;
  ['todas','por_procesar','en_proceso','entregado'].forEach(f =>
    document.getElementById(`filter-${f}`)?.classList.toggle('active', f === filter));
  renderPrendas();
}

function handleHeaderAction() {
  const active = document.querySelector('.view.active')?.id;
  if (active === 'view-prendas')        openNewPrendaModal();
  else if (active === 'view-prenda-detail') openNewAsignacionModal();
  else if (active === 'view-users')     openNewUserModal();
}
