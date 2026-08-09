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

// Tallas disponibles en orden
const TALLAS_KIDS  = ['8','10','12','14','16'];
const TALLAS_ADULT = ['S','M','L','XL','2XL'];
const TODAS_TALLAS = [...TALLAS_KIDS, ...TALLAS_ADULT];

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
  currentFotos:        {},
  currentAsigInsumos:  {},
  exportPrendas:       [],
  exportAsignaciones:  [],
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

// Toggle mostrar/ocultar contraseña en login
function togglePasswordVisibility() {
  const inp = document.getElementById('login-password');
  const btn = document.getElementById('btn-toggle-pass');
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  } else {
    inp.type = 'password';
    btn.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
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
    currentPrenda:null, currentAsignaciones:[], currentAsigInsumos:{},
    currentFilter:'todas', currentNav:'view-prendas', prevView:null, pendingConfirm:null
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
  // Usar classList para evitar conflicto con clase 'hidden' de Tailwind
  document.getElementById('nav-admin').classList.toggle('hidden', !isAdmin);
  document.getElementById('nav-conf').classList.toggle('hidden', isAdmin);
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
function hasActiveEditing() {
  const cont = document.getElementById('detail-asignaciones-list');
  if (!cont) return false;
  const active = document.activeElement;
  if (active && cont.contains(active) && ['INPUT','TEXTAREA'].includes(active.tagName)) return true;
  return !!cont.querySelector('[id^="asig-edit-"]:not(.hidden)');
}

function setupRealtime() {
  if (state.realtimeSub) sb.removeChannel(state.realtimeSub);
  state.realtimeSub = sb.channel('conf-realtime')
    .on('postgres_changes', { event:'*', schema:'public', table:'prendas' }, (payload) => {
      loadPrendas();
      // Si la prenda que se está viendo fue eliminada, navegar de regreso
      if (payload.eventType === 'DELETE' && state.currentPrenda?.id === payload.old?.id) {
        showToast('⚠️ Esta prenda fue eliminada', 'warn');
        state.currentPrenda = null;
        state.currentAsignaciones = [];
        state.currentFotos = {};
        state.currentAsigInsumos = {};
        goBack();
      }
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'asignaciones' }, () => {
      // loadPrendas sin await para no bloquear la actualización del detalle
      loadPrendas();
      // Siempre actualizar el detalle si está visible (sin bloquear por edición del admin)
      if (state.currentPrenda) loadPrendaDetail(state.currentPrenda.id, false);
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'asignacion_fotos' }, () => {
      if (state.currentPrenda) loadPrendaDetail(state.currentPrenda.id, false);
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'asignacion_insumos' }, () => {
      if (state.currentPrenda) loadPrendaDetail(state.currentPrenda.id, false);
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
  if (pErr || !prenda) {
    // La prenda ya no existe (fue eliminada) — navegar al inicio sin error
    if (state.currentPrenda?.id === prendaId) {
      state.currentPrenda = null;
      state.currentAsignaciones = [];
      state.currentFotos = {};
      state.currentAsigInsumos = {};
      goBack();
    }
    return;
  }

  const isAdmin = state.profile?.role === 'admin';
  const asigSelect = isAdmin
    ? '*, confeccionista:profiles!confeccionista_id(id, full_name, phone)'
    : '*';
  const { data: asigs } = await sb.from('asignaciones')
    .select(asigSelect)
    .eq('prenda_id', prendaId)
    .order('created_at');

  // Fotos
  const fotosPorAsig = {};
  const asigIds = (asigs || []).map(a => a.id);
  if (asigIds.length) {
    const { data: fotos } = await sb.from('asignacion_fotos')
      .select('*')
      .in('asignacion_id', asigIds)
      .order('created_at');
    (fotos || []).forEach(f => {
      (fotosPorAsig[f.asignacion_id] ||= []).push(f);
    });
  }

  // Insumos por asignación — cada confeccionista tiene los suyos (nombre + cantidad propios)
  const asigInsumosMap = {};
  if (asigIds.length) {
    const { data: asigInsumos } = await sb.from('asignacion_insumos')
      .select('*')
      .in('asignacion_id', asigIds)
      .order('created_at');
    (asigInsumos || []).forEach(ai => {
      (asigInsumosMap[ai.asignacion_id] ||= []).push(ai);
    });
  }

  state.currentPrenda       = prenda;
  state.currentAsignaciones = asigs || [];
  state.currentFotos        = fotosPorAsig;
  state.currentAsigInsumos  = asigInsumosMap;
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
      ${isAdmin ? `<p class="text-sm text-slate-500">📦 <strong class="text-white">${Number(prenda.total_unidades).toLocaleString()}</strong> unidades totales en el pedido</p>` : ''}
      ${isAdmin ? `
      <div class="mt-3 pt-3 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
        ${nextStatus ? `<button onclick="updatePrendaStatus('${prenda.id}','${nextStatus}')"
          class="text-xs px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700">${nextLabel}</button>` : ''}
        <button onclick="confirmDeletePrenda('${prenda.id}')"
          class="text-xs text-red-400 hover:text-red-300 ml-auto">🗑 Eliminar prenda</button>
      </div>` : ''}
    </div>
    ${isAdmin ? renderTableroGeneral(prenda, asigs) : ''}`;

  const container = document.getElementById('detail-asignaciones-list');
  isAdmin
    ? renderAsignacionesAdmin(asigs, container)
    : renderAsignacionesConf(asigs.filter(a => a.confeccionista_id === state.user.id), container);
}

// ================================================================
// 10b. TABLERO GENERAL DEL PEDIDO
// ================================================================
function calcPrendaStats(prenda, asigs) {
  const total = Number(prenda.total_unidades) || 0;
  let asignadas = 0, confirmadas = 0, devoluciones = 0, noConfAprobadas = 0;
  asigs.forEach(a => {
    asignadas    += Number(a.cantidad_asignada) || 0;
    confirmadas  += Number(a.cantidad_confirmada) || 0;
    devoluciones += Number(a.cantidad_devoluciones) || 0;
    if (a.no_conf_estado === 'aprobado') noConfAprobadas += Number(a.cantidad_no_confeccionadas) || 0;
  });
  // cantidad_confirmada ya queda neta de devoluciones (se resta en el origen), así
  // que no se vuelve a restar "devoluciones" aquí para evitar doble conteo.
  const confirmadasNetas = confirmadas;
  const totalAjustado    = Math.max(0, total - noConfAprobadas);
  const pendientes       = Math.max(0, totalAjustado - confirmadasNetas);
  const avance           = totalAjustado > 0 ? Math.round((confirmadasNetas / totalAjustado) * 100) : 0;
  return { total, asignadas, confirmadas, devoluciones, confirmadasNetas, noConfAprobadas, totalAjustado, pendientes, avance };
}

function renderTableroGeneral(prenda, asigs) {
  const s = calcPrendaStats(prenda, asigs);
  return `
  <div class="card p-4 mb-3">
    <div class="flex items-center justify-between mb-2">
      <p class="text-xs text-slate-500 font-medium">📊 Resumen del pedido — ${s.total.toLocaleString()} unidades</p>
      <span class="text-xs font-bold text-gold-400">${s.avance}% completado</span>
    </div>
    <div class="w-full h-3 bg-zinc-800 rounded-full overflow-hidden mb-3">
      <div class="h-full bg-gradient-to-r from-gold-600 to-gold-400 rounded-full transition-all duration-500" style="width:${s.avance}%"></div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs text-center">
      <div class="bg-zinc-800 rounded-xl p-2.5">
        <div class="text-white mb-0.5">👷 Asignadas</div>
        <div class="text-white font-bold text-lg">${s.asignadas}</div>
      </div>
      <div class="bg-zinc-800 rounded-xl p-2.5">
        <div class="text-yellow-500 mb-0.5">⏳ Pendientes</div>
        <div class="text-white font-bold text-lg">${s.pendientes}</div>
      </div>
      <div class="bg-zinc-800 rounded-xl p-2.5">
        <div class="text-slate-400 mb-0.5">❌ No conf. (aprobadas)</div>
        <div class="text-white font-bold text-lg">${s.noConfAprobadas}</div>
      </div>
      <div class="bg-zinc-800 rounded-xl p-2.5">
        <div class="text-red-400 mb-0.5">🔄 Devoluciones</div>
        <div class="text-white font-bold text-lg">${s.devoluciones}</div>
      </div>
      <div class="col-span-2 bg-zinc-800 rounded-xl p-2.5">
        <div class="text-green-400 mb-0.5">✅ Confirmadas (netas)</div>
        <div class="text-white font-bold text-lg">${s.confirmadasNetas}</div>
      </div>
    </div>
  </div>`;
}

// ================================================================
// 10c. INSUMOS POR ASIGNACIÓN — cada confeccionista tiene los suyos,
// independientes entre sí (nombre + cantidad, sin catálogo compartido)
// ================================================================
function renderAsigInsumos(asigId, isAdmin) {
  const items = state.currentAsigInsumos?.[asigId] || [];

  // Confeccionista: solo mostrar si tiene insumos asignados
  if (!isAdmin && !items.length) return '';

  const listaHtml = items.length
    ? items.map(ai => `
      <div class="flex items-center justify-between py-1.5 border-b border-zinc-800/60 last:border-0">
        <span class="text-sm text-slate-300">${escHtml(ai.nombre || '')}</span>
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold text-white">${ai.cantidad}</span>
          ${isAdmin ? `<button onclick="deleteAsigInsumo('${ai.id}','${asigId}')"
            class="text-red-400/50 hover:text-red-400 text-lg leading-none px-1">×</button>` : ''}
        </div>
      </div>`).join('')
    : `<p class="text-xs text-slate-600 py-1">Sin insumos asignados a esta confeccionista aún.</p>`;

  const formHtml = isAdmin ? `
    <div class="mt-2 pt-2 border-t border-zinc-800/60">
      <p class="text-xs text-slate-500 mb-1.5">Agregar insumo a esta confeccionista:</p>
      <div class="grid grid-cols-12 gap-1.5">
        <input type="text" id="ai-nombre-${asigId}" placeholder="Nombre (ej: botones)"
          class="col-span-7 px-2.5 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-xs focus:outline-none focus:border-gold-500" />
        <input type="number" id="ai-cant-${asigId}" placeholder="Cant." min="1"
          class="col-span-3 px-2 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-xs text-center focus:outline-none focus:border-gold-500" />
        <button onclick="saveAsigInsumo('${asigId}')"
          class="col-span-2 py-2 bg-gold-500 hover:bg-gold-600 text-black font-bold rounded-lg text-xs transition-colors">+</button>
      </div>
    </div>` : '';

  return `
  <div class="px-4 py-3 border-t border-zinc-800">
    <p class="text-xs font-semibold text-slate-400 mb-2">🧵 ${isAdmin ? 'Insumos de esta confeccionista' : 'Insumos que recibiste'}</p>
    ${listaHtml}
    ${formHtml}
  </div>`;
}

async function saveAsigInsumo(asigId) {
  const nombre   = document.getElementById(`ai-nombre-${asigId}`)?.value?.trim();
  const cantidad = parseInt(document.getElementById(`ai-cant-${asigId}`)?.value) || 0;

  if (!nombre)      { showToast('Escribe el nombre del insumo', 'error'); return; }
  if (cantidad < 1) { showToast('La cantidad debe ser mayor a 0', 'error'); return; }

  const { error } = await sb.from('asignacion_insumos')
    .insert({ asignacion_id: asigId, nombre, cantidad });

  if (error) { showToast('Error al guardar insumo', 'error'); console.error(error); return; }

  const nombreEl = document.getElementById(`ai-nombre-${asigId}`);
  const cantEl   = document.getElementById(`ai-cant-${asigId}`);
  if (nombreEl) nombreEl.value = '';
  if (cantEl)   cantEl.value   = '';
  showToast('✅ Insumo agregado');
  await loadPrendaDetail(state.currentPrenda.id, false);
}

async function deleteAsigInsumo(asigInsumoId, asigId) {
  confirmAction('¿Quitar insumo?', 'Se eliminará este insumo de la asignación de esta confeccionista.', async () => {
    const { error } = await sb.from('asignacion_insumos').delete().eq('id', asigInsumoId);
    if (error) { showToast('Error al eliminar', 'error'); return; }
    showToast('Insumo eliminado');
    await loadPrendaDetail(state.currentPrenda.id, false);
  });
}

// ================================================================
// 10c-2. INSUMOS EN EL MODAL "AGREGAR ASIGNACIÓN" — filas dinámicas
// ================================================================
let asigInsumoRowSeq = 0;

function addAsigInsumoRow() {
  const container = document.getElementById('asig-insumos-rows');
  if (!container) return;
  const n = asigInsumoRowSeq++;
  const row = document.createElement('div');
  row.className = 'grid grid-cols-12 gap-1.5 items-center';
  row.id = `asig-insumo-row-${n}`;
  row.innerHTML =
    '<input type="text" id="asig-insumo-nombre-' + n + '" placeholder="Nombre (ej: botones)"'
    + ' class="col-span-7 px-2.5 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-xs focus:outline-none focus:border-gold-500" />'
    + '<input type="number" id="asig-insumo-cant-' + n + '" placeholder="Cant." min="0"'
    + ' class="col-span-3 px-2 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-xs text-center focus:outline-none focus:border-gold-500" />'
    + '<button type="button" onclick="removeAsigInsumoRow(' + n + ')"'
    + ' class="col-span-2 text-red-400/60 hover:text-red-400 text-lg leading-none">×</button>';
  container.appendChild(row);
}

function removeAsigInsumoRow(n) {
  document.getElementById(`asig-insumo-row-${n}`)?.remove();
}

function resetAsigInsumoRows() {
  const container = document.getElementById('asig-insumos-rows');
  if (!container) return;
  container.innerHTML = '';
  addAsigInsumoRow();
}

function readAsigInsumoRows() {
  const container = document.getElementById('asig-insumos-rows');
  if (!container) return [];
  const items = [];
  container.querySelectorAll('[id^="asig-insumo-row-"]').forEach(row => {
    const n = row.id.replace('asig-insumo-row-', '');
    const nombre   = document.getElementById(`asig-insumo-nombre-${n}`)?.value?.trim();
    const cantidad = parseInt(document.getElementById(`asig-insumo-cant-${n}`)?.value) || 0;
    if (nombre && cantidad > 0) items.push({ nombre, cantidad });
  });
  return items;
}

// ================================================================
// 10d. TALLAS — helpers
// ================================================================
function renderTallasInput(prefix, curva, onInput = '') {
  // curva: {S:30, M:40, ...} — solo muestra las que tienen valor o todas para input
  const grupos = [
    { label: '👧 Tallas niño', tallas: TALLAS_KIDS },
    { label: '👔 Tallas adulto', tallas: TALLAS_ADULT }
  ];
  return grupos.map(g => {
    const hasTallas = g.tallas.some(t => (curva[t] || 0) > 0);
    return `
    <div class="mb-2">
      <p class="text-xs text-slate-500 mb-1">${g.label}</p>
      <div class="grid grid-cols-5 gap-1">
        ${g.tallas.map(t => `
        <div class="text-center">
          <div class="text-xs text-slate-500 mb-0.5">${t}</div>
          <input type="number" id="${prefix}-${t}" value="${curva[t] || ''}" min="0"
            step="1" placeholder="0" ${onInput ? `oninput="${onInput}"` : ''}
            onfocus="if(this.value==='0'||this.value==='')this.value='';this.select()"
            class="w-full px-1 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold text-center focus:outline-none focus:border-gold-500" />
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function readTallasInput(prefix) {
  const resultado = {};
  TODAS_TALLAS.forEach(t => {
    const val = parseInt(document.getElementById(`${prefix}-${t}`)?.value) || 0;
    if (val > 0) resultado[t] = val;
  });
  return resultado;
}

function validarEntregaPorTallas(asigId) {
  const asig = state.currentAsignaciones.find(x => x.id === asigId);
  const asignada = Number(asig?.cantidad_asignada) || 0;
  const curva = asig?.curva_tallas || {};
  const tallas = {};
  const errores = [];
  let total = 0;

  TODAS_TALLAS.forEach(t => {
    const inp = document.getElementById(`tp-${asigId}-${t}`);
    if (!inp) return;
    const raw = inp.value.trim();
    const cantidad = raw === '' ? 0 : Number(raw);
    const maximo = Number(curva[t]) > 0 ? Number(curva[t]) : asignada;
    const invalida = !Number.isInteger(cantidad) || cantidad < 0 || cantidad > maximo;
    inp.classList.toggle('border-red-500', invalida);
    inp.setCustomValidity(invalida ? `La talla ${t} no puede superar ${maximo} unidades.` : '');
    if (invalida) {
      errores.push(`La talla ${t} debe estar entre 0 y ${maximo}.`);
      return;
    }
    if (cantidad > 0) tallas[t] = cantidad;
    total += cantidad;
  });

  if (total > asignada) errores.push(`El total entregado (${total}) supera las ${asignada} unidades asignadas.`);
  return { tallas, total, pendientes: Math.max(0, asignada - total), errores };
}

function syncEntregaResumen(asigId) {
  const resultado = validarEntregaPorTallas(asigId);
  const entregadas = document.getElementById(`conf-entregadas-${asigId}`);
  const pendientes = document.getElementById(`conf-pendientes-${asigId}`);
  const totalVivo = document.getElementById(`entrega-total-${asigId}`);
  const pendientesVivo = document.getElementById(`entrega-pendientes-${asigId}`);
  const aviso = document.getElementById(`entrega-warn-${asigId}`);
  [entregadas, totalVivo].forEach(el => { if (el) el.textContent = resultado.total; });
  [pendientes, pendientesVivo].forEach(el => { if (el) el.textContent = resultado.pendientes; });
  if (aviso) {
    aviso.textContent = resultado.errores[0] || '';
    aviso.classList.toggle('hidden', resultado.errores.length === 0);
  }
  return resultado;
}

function renderTallasResumen(curva, progreso, isAdmin, confirmadas = {}) {
  // Mostrar tallas que tienen curva > 0 O que tienen progreso registrado
  const tallasActivas = TODAS_TALLAS.filter(t => (curva[t] || 0) > 0 || (progreso[t] || 0) > 0);
  if (!tallasActivas.length) return '';

  if (isAdmin) {
    // Admin: muestra asignadas, reportadas y confirmadas por talla
    return `
    <div class="mt-2 mb-2">
      <p class="text-xs text-slate-500 font-medium mb-1.5">📐 Curva de tallas</p>
      <div class="grid grid-cols-5 gap-1 text-center text-xs">
        ${tallasActivas.map(t => {
          const asig  = curva[t] || 0;
          const hecho = progreso[t] || 0;
          const conf  = confirmadas[t] || 0;
          const pct   = asig > 0 ? Math.min(100, Math.round(hecho/asig*100)) : 0;
          const pctConf = asig > 0 ? Math.min(100, Math.round(conf/asig*100)) : 0;
          return `
          <div class="bg-zinc-800 rounded-lg py-1.5 px-1">
            <div class="text-slate-400 font-medium mb-0.5">${t}</div>
            <div class="text-white font-bold text-sm">${hecho}<span class="text-slate-500 font-normal">/${asig}</span></div>
            ${conf > 0 ? `<div class="text-green-400 text-xs font-semibold">✅ ${conf} (${pctConf}%)</div>` : (asig > 0 ? `<div class="text-xs ${hecho >= asig ? 'text-green-400' : 'text-slate-600'}">${pct}%</div>` : '')}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // Confeccionista: muestra terminadas, confirmadas por talla y barra de progreso
  const tieneConfirmadas = tallasActivas.some(t => (confirmadas[t] || 0) > 0);
  return `
  <div class="mt-2 mb-2">
    <p class="text-xs text-slate-500 font-medium mb-1.5">📐 Estado por talla</p>
    <div class="space-y-1">
      ${tallasActivas.map(t => {
        const curva_t  = curva[t]    || 0;
        const hecho_t  = progreso[t] || 0;
        const conf_t   = confirmadas[t] || 0;
        // Denominador: usa curva si está definida, sino usa lo que reportó
        const denom    = curva_t > 0 ? curva_t : hecho_t;
        const pct_conf = denom > 0 ? Math.min(100, Math.round(conf_t / denom * 100)) : 0;
        const pendConf = Math.max(0, hecho_t - conf_t);
        const mostrarBarra = hecho_t > 0 || conf_t > 0;
        const colorBarra = pct_conf >= 100 ? 'bg-green-400' : 'bg-green-500';
        const colorPct   = pct_conf >= 100 ? 'text-green-400' : (pct_conf > 0 ? 'text-gold-400' : 'text-slate-500');
        return '<div class="bg-zinc-800 rounded-lg px-3 py-2 flex items-center gap-2">'
          + '<span class="text-xs font-bold text-white w-8 shrink-0">' + t + '</span>'
          + '<div style="flex:1;min-width:0">'
          +   '<div class="text-xs text-slate-400">'
          +     'Hice: <strong class="text-white">' + hecho_t + '</strong>'
          +     (conf_t > 0 ? ' &middot; <span class="text-green-400 font-semibold">✅ ' + conf_t + ' aprobadas</span>' : '')
          +     (pendConf > 0 && tieneConfirmadas ? ' &middot; <span class="text-yellow-500">⏳ ' + pendConf + ' por aprobar</span>' : '')
          +   '</div>'
          +   (mostrarBarra
              ? '<div style="margin-top:4px;width:100%;height:6px;background:#3f3f46;border-radius:9999px;overflow:hidden">'
                + '<div style="height:100%;border-radius:9999px;width:' + pct_conf + '%;background:' + (pct_conf >= 100 ? '#4ade80' : '#22c55e') + '"></div>'
                + '</div>'
              : '')
          + '</div>'
          + (mostrarBarra ? '<span class="text-xs font-bold shrink-0 ' + colorPct + '">' + pct_conf + '%</span>' : '')
          + '</div>';
      }).join('')}
    </div>
  </div>`;
}

// ================================================================
// 10c. HELPER — "no pude confeccionar" por talla (confeccionista)
// ================================================================
function renderNoConfInput(asigId, curva, totalNoConf, tallasNoConf) {
  const tallasConCurva = TODAS_TALLAS.filter(t => (curva[t] || 0) > 0);

  if (!tallasConCurva.length) {
    // Sin curva: input único como antes
    return '<input type="number" id="inp-noconf-' + asigId + '" value="' + totalNoConf + '" min="0"'
      + ' onfocus="if(this.value===\'0\'||this.value===\'\')this.value=\'\';this.select()"'
      + ' class="w-full px-3 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 text-white text-xl font-bold text-center focus:outline-none focus:border-red-500" />';
  }

  // Con curva: grid por talla
  const grupos = [
    { label: '👧 Niño',   tallas: TALLAS_KIDS.filter(t => tallasConCurva.includes(t)) },
    { label: '👔 Adulto', tallas: TALLAS_ADULT.filter(t => tallasConCurva.includes(t)) }
  ].filter(g => g.tallas.length > 0);

  let rows = '';
  grupos.forEach(g => {
    rows += '<p class="text-xs text-slate-500 mb-1">' + g.label + '</p>';
    rows += '<div class="grid grid-cols-5 gap-1 mb-2">';
    g.tallas.forEach(t => {
      const maxT = curva[t] || 0;
      const valT = tallasNoConf[t] || 0;
      rows += '<div class="text-center">'
        + '<div class="text-xs text-slate-400 mb-0.5">' + t + '</div>'
        + '<div class="text-xs text-slate-600 mb-0.5">de ' + maxT + '</div>'
        + '<input type="number" id="inp-noconf-' + asigId + '-' + t + '" value="' + valT + '" min="0" max="' + maxT + '"'
        + ' onfocus="this.select()" oninput="syncNoConfTotal(\'' + asigId + '\')"'
        + ' class="w-full px-0.5 py-1.5 rounded-lg bg-zinc-800 border border-red-900/40 text-red-300 text-sm font-bold text-center focus:outline-none focus:border-red-500" />'
        + '</div>';
    });
    rows += '</div>';
  });

  return rows
    + '<input type="hidden" id="inp-noconf-' + asigId + '" value="' + totalNoConf + '" />'
    + '<p id="noconf-total-' + asigId + '" class="text-xs text-red-400 mt-1 text-center'
    + (totalNoConf > 0 ? '' : ' hidden') + '">Total: ' + totalNoConf + ' piezas que no puedes confeccionar</p>';
}

function syncNoConfTotal(asigId) {
  const curva = state.currentAsignaciones?.find(a => a.id === asigId)?.curva_tallas || {};
  const tallasConCurva = TODAS_TALLAS.filter(t => (curva[t] || 0) > 0);
  const total = tallasConCurva.reduce((sum, t) => {
    return sum + (parseInt(document.getElementById('inp-noconf-' + asigId + '-' + t)?.value) || 0);
  }, 0);
  const hiddenEl = document.getElementById('inp-noconf-' + asigId);
  if (hiddenEl) hiddenEl.value = total;
  const labelEl = document.getElementById('noconf-total-' + asigId);
  if (labelEl) {
    labelEl.textContent = 'Total: ' + total + ' piezas que no puedes confeccionar';
    if (total > 0) labelEl.classList.remove('hidden');
    else labelEl.classList.add('hidden');
  }
}

// ================================================================
// 10d. HELPER — devoluciones por talla en modo edición admin
// ================================================================
function renderDevolucionesEdit(asigId, curva, confirmadas, devolucionesPrevias, totalDevols) {
  // Tallas disponibles para devolver: las que tienen curva O que fueron confirmadas
  const tallasDisp = TODAS_TALLAS.filter(t => (curva[t] || 0) > 0 || (confirmadas[t] || 0) > 0);
  if (!tallasDisp.length) {
    // Sin tallas: input simple
    return '<div class="mb-3">'
      + '<label class="text-xs text-red-400 mb-1 block">🔄 Devoluciones (total)</label>'
      + '<input type="number" id="edit-asig-devols-' + asigId + '" value="' + totalDevols + '" min="0"'
      + ' onfocus="this.select()"'
      + ' class="w-full px-3 py-2.5 rounded-xl bg-zinc-800 border border-red-900/50 text-white text-xl font-bold text-center focus:outline-none focus:border-red-500" />'
      + '</div>';
  }

  // Con tallas: grid por talla
  const grupos = [
    { label: '👧 Niño',   tallas: TALLAS_KIDS.filter(t => tallasDisp.includes(t)) },
    { label: '👔 Adulto', tallas: TALLAS_ADULT.filter(t => tallasDisp.includes(t)) }
  ].filter(g => g.tallas.length > 0);

  let rows = '';
  grupos.forEach(g => {
    rows += '<p class="text-xs text-slate-500 mb-1">' + g.label + '</p>';
    rows += '<div class="grid grid-cols-5 gap-1 mb-2">';
    g.tallas.forEach(t => {
      const maxDev = confirmadas[t] || curva[t] || 0;
      const valPrev = devolucionesPrevias[t] || 0;
      rows += '<div class="text-center">'
        + '<div class="text-xs text-slate-400 mb-0.5">' + t + '</div>'
        + '<div class="text-xs text-slate-600 mb-0.5">máx:' + maxDev + '</div>'
        + '<input type="number" id="edit-devol-' + asigId + '-' + t + '" value="' + valPrev + '" min="0" max="' + maxDev + '"'
        + ' onfocus="this.select()" oninput="syncDevolucionesTotal(\'' + asigId + '\')"'
        + ' class="w-full px-0.5 py-1.5 rounded-lg bg-zinc-800 border border-red-900/40 text-red-300 text-sm font-bold text-center focus:outline-none focus:border-red-500" />'
        + '</div>';
    });
    rows += '</div>';
  });

  return '<div class="pt-3 border-t border-zinc-800 mb-3">'
    + '<div class="flex items-center justify-between mb-2">'
    +   '<p class="text-xs text-red-400 font-semibold">🔄 Devoluciones por talla</p>'
    +   '<span id="devols-total-badge-' + asigId + '" class="text-xs bg-red-900/30 text-red-400 font-bold px-2 py-0.5 rounded-full">'
    +     (totalDevols > 0 ? 'Total: ' + totalDevols : '0') + '</span>'
    + '</div>'
    + rows
    + '<input type="hidden" id="edit-asig-devols-' + asigId + '" value="' + totalDevols + '" />'
    + '</div>';
}

function syncDevolucionesTotal(asigId) {
  const total = TODAS_TALLAS.reduce((sum, t) => {
    return sum + (parseInt(document.getElementById('edit-devol-' + asigId + '-' + t)?.value) || 0);
  }, 0);
  const hiddenEl = document.getElementById('edit-asig-devols-' + asigId);
  if (hiddenEl) hiddenEl.value = total;
  const badge = document.getElementById('devols-total-badge-' + asigId);
  if (badge) badge.textContent = 'Total: ' + total;
}

// ================================================================
// 10e. HELPER — bloque de confirmación por talla (extrae nesting)
// ================================================================
function renderConfirmacionEntrega(a, porConfirmar, progreso, tallas_conf_actual, hasTallasPendientes, reportado, confirmado, devols) {
  if (porConfirmar <= 0) {
    if (confirmado > 0) {
      const asignadaTotal = Number(a.cantidad_asignada) || 0;
      const pctConfirmado = asignadaTotal > 0 ? Math.min(100, Math.round(confirmado / asignadaTotal * 100)) : 0;
      const devolsTxt = devols > 0 ? ` · 🔄 ${devols} devueltas` : '';
      return `<p class="text-xs text-green-400/70 mt-2 px-1">✅ ${confirmado} aceptadas (${pctConfirmado}%)${devolsTxt}</p>`;
    }
    return '';
  }

  const fechaHtml = a.fecha_entrega
    ? ` · <span class="text-slate-400">Entrega: ${formatDate(a.fecha_entrega)}</span>`
    : '';

  let inputsHtml = '';
  if (hasTallasPendientes) {
    const rows = TODAS_TALLAS
      .filter(t => (progreso[t] || 0) > 0)
      .map(t => {
        const rep_t  = progreso[t] || 0;
        const conf_t = tallas_conf_actual[t] || 0;
        const pend_t = Math.max(0, rep_t - conf_t);
        if (pend_t <= 0) return '';
        return '<div class="text-center">'
          + '<div class="text-xs text-slate-400 mb-0.5">' + t + '</div>'
          + '<div class="text-xs text-slate-600 mb-0.5">Pend:' + pend_t + '</div>'
          + '<input type="number" id="ctalla-' + a.id + '-' + t + '" value="' + pend_t + '" min="0" max="' + pend_t + '"'
          + ' onfocus="this.select()"'
          + ' class="w-full px-0.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold text-center focus:outline-none focus:border-gold-500" />'
          + '<div class="text-[10px] text-slate-600 mt-0.5">Acepta</div>'
          + '<input type="number" id="rtalla-' + a.id + '-' + t + '" value="0" min="0" max="' + pend_t + '"'
          + ' onfocus="this.select()"'
          + ' class="w-full mt-1 px-0.5 py-1.5 rounded-lg bg-zinc-800 border border-red-900/40 text-red-300 text-sm font-bold text-center focus:outline-none focus:border-red-500" />'
          + '<div class="text-[10px] text-slate-600 mt-0.5">Rechaza</div>'
          + '</div>';
      })
      .join('');
    inputsHtml = '<p class="text-xs text-slate-500 mb-2">Ajusta cuántas aceptas y cuántas rechazas por talla:</p>'
      + '<div class="grid grid-cols-5 gap-1 mb-3">' + rows + '</div>';
  } else {
    inputsHtml = '<p class="text-xs text-slate-500 mb-2">¿Cuántas aceptas y cuántas rechazas? (total pendiente: ' + porConfirmar + ')</p>'
      + '<div class="flex gap-2 items-center mb-2">'
      + '<div class="flex-1">'
      + '<label class="text-[10px] text-slate-500 block mb-0.5">Aceptas</label>'
      + '<input type="number" id="confirm-cant-' + a.id + '" value="' + porConfirmar + '" min="0" max="' + porConfirmar + '"'
      + ' onfocus="this.select()" oninput="validarCantidadConfirm(\'' + a.id + '\',' + porConfirmar + ')"'
      + ' class="w-full px-2 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-center font-bold text-lg focus:outline-none focus:border-gold-500" />'
      + '</div>'
      + '<div class="flex-1">'
      + '<label class="text-[10px] text-slate-500 block mb-0.5">Rechazas</label>'
      + '<input type="number" id="reject-cant-' + a.id + '" value="0" min="0" max="' + porConfirmar + '"'
      + ' onfocus="this.select()"'
      + ' class="w-full px-2 py-2.5 rounded-xl bg-zinc-800 border border-red-900/40 text-red-300 text-center font-bold text-lg focus:outline-none focus:border-red-500" />'
      + '</div>'
      + '</div>'
      + '<span id="confirm-warn-' + a.id + '" class="text-xs text-red-400 hidden">⚠️ Máximo ' + porConfirmar + '</span>';
  }

  return '<div class="mt-3 p-3 bg-gold-500/5 border border-gold-500/20 rounded-xl">'
    + '<p class="text-xs text-gold-400/90 font-semibold mb-2">📦 Por revisar: <strong>' + porConfirmar + '</strong> terminadas' + fechaHtml + '</p>'
    + inputsHtml
    + '<textarea id="confirm-nota-' + a.id + '" rows="2" placeholder="Nota opcional para lo que aceptas (ej: calidad ok, revisar costuras...)"'
    + ' class="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700/60 text-white text-xs focus:outline-none focus:border-gold-500 resize-none mb-2"></textarea>'
    + '<input type="text" id="reject-motivo-' + a.id + '" placeholder="Motivo del rechazo (obligatorio si rechazas alguna unidad)"'
    + ' class="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-red-900/40 text-red-200 text-xs focus:outline-none focus:border-red-500 mb-2 placeholder:text-red-400/40" />'
    + '<div class="flex gap-2">'
    + '<button onclick="confirmarEntrega(\'' + a.id + '\',' + hasTallasPendientes + ')"'
    + ' class="flex-1 py-2.5 bg-gold-500 hover:bg-gold-600 text-black font-bold rounded-xl text-xs transition-colors">✅ Confirmar aceptadas</button>'
    + '<button onclick="rechazarEntregaParcial(\'' + a.id + '\',' + hasTallasPendientes + ')"'
    + ' class="px-3 py-2.5 bg-zinc-800 hover:bg-red-900/30 border border-red-900/40 text-red-400 font-bold rounded-xl text-xs transition-colors">✕ Rechazar</button>'
    + '</div>'
    + '</div>';
}

// ================================================================
// 11. RENDER — ADMIN
// ================================================================
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
      ${g.items.map(a => {
        const curva              = a.curva_tallas       || {};
        const progreso           = a.tallas_progreso    || {};
        const tallas_conf_actual = a.tallas_confirmadas || {};
        const tieneTallas = TODAS_TALLAS.some(t => (curva[t] || 0) > 0);
        // Tallas con unidades pendientes de confirmar (reportadas - ya confirmadas)
        const tallasConPendiente = TODAS_TALLAS.filter(t =>
          (progreso[t] || 0) > (tallas_conf_actual[t] || 0));
        const hasTallasPendientes = tallasConPendiente.length > 0;
        const devols   = Number(a.cantidad_devoluciones) || 0;
        const noConf   = Number(a.cantidad_no_confeccionadas) || 0;
        const reportado  = Number(a.cantidad_entregada) || 0;
        const confirmado = Number(a.cantidad_confirmada) || 0;
        const porConfirmar = Math.max(0, reportado - confirmado);
        // Nota: cantidad_confirmada ya queda neta de devoluciones (tanto el rechazo
        // en revisión como la edición manual restan en el origen), por lo que NO se
        // vuelve a restar "devols" aquí para evitar doble conteo. "Aceptadas" = confirmado.
        const asignadaTotal = Number(a.cantidad_asignada) || 0;
        const pendientes = Math.max(0, asignadaTotal - reportado);
        // % de lo asignado que ya fue aceptado/confirmado por el admin
        const pctAceptadas = asignadaTotal > 0 ? Math.min(100, Math.round(confirmado / asignadaTotal * 100)) : 0;

        return `
        <div class="border-b border-zinc-900/80 last:border-0">
          <!-- VIEW MODE -->
          <div id="asig-view-${a.id}" class="px-4 py-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-white text-sm">${escHtml(a.parte)}</p>
                ${a.descripcion ? `<p class="text-slate-400 text-xs mt-0.5">${escHtml(a.descripcion)}</p>` : ''}
                ${a.nota ? `<p class="text-yellow-400/80 text-xs mt-0.5">📝 Admin: ${escHtml(a.nota)}</p>` : ''}
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button onclick="toggleAsigEdit('${a.id}')"
                  class="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-slate-300 border border-zinc-700">✏️</button>
                <button onclick="confirmDeleteAsig('${a.id}')" class="text-red-400/40 hover:text-red-400 text-xl px-1">×</button>
              </div>
            </div>

            <!-- Tallas: resumen si hay datos, hint si no está configurado -->
            ${renderTallasResumen(curva, progreso, true, tallas_conf_actual) ||
              '<p class="text-xs text-slate-600/70 mt-1.5 mb-1 px-0.5">📐 Sin curva de tallas · Toca ✏️ para configurar</p>'}

            <!-- CONTEO VISUAL -->
            <div class="grid grid-cols-4 gap-1.5 mt-2 text-xs text-center">
              <div class="bg-zinc-800 rounded-lg p-2">
                <div class="text-white mb-0.5">Asignadas</div>
                <div class="text-white font-bold text-base">${a.cantidad_asignada}</div>
              </div>
              <div class="bg-zinc-800 rounded-lg p-2">
                <div class="text-blue-400 mb-0.5">En proceso</div>
                <div class="text-white font-bold text-base">${a.cantidad_confeccionada}</div>
              </div>
              <div class="bg-zinc-800 rounded-lg p-2">
                <div class="text-yellow-500 mb-0.5">Pendientes</div>
                <div class="text-white font-bold text-base">${pendientes}</div>
              </div>
              <div class="bg-zinc-800 rounded-lg p-2">
                <div class="text-gold-400 mb-0.5">Reportadas</div>
                <div class="text-white font-bold text-base">${reportado}</div>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-1.5 mt-1.5 text-xs text-center">
              <div class="bg-zinc-800 rounded-lg p-2">
                <div class="text-green-400 mb-0.5">✅ Aceptadas</div>
                <div class="text-white font-bold text-base">${confirmado} <span class="text-xs font-semibold">(${pctAceptadas}%)</span></div>
              </div>
              <div class="bg-zinc-800 rounded-lg p-2">
                <div class="text-red-400 mb-0.5">🔄 Devueltas</div>
                <div class="text-white font-bold text-base">${devols}</div>
              </div>
              <div class="bg-zinc-800 rounded-lg p-2">
                <div class="text-slate-500 mb-0.5">❌ No conf.</div>
                <div class="text-white font-bold text-base">${noConf}</div>
              </div>
            </div>

            <!-- CONFIRMACIÓN DE ENTREGA — delega a función para evitar anidamiento profundo -->
            ${renderConfirmacionEntrega(a, porConfirmar, progreso, tallas_conf_actual, hasTallasPendientes, reportado, confirmado, devols)}

            <!-- APROBACIÓN DE "NO PUDE CONFECCIONAR" -->
            ${noConf > 0 ? (() => {
              const ncEst       = a.no_conf_estado || 'pendiente';
              const tallasNoConf = a.tallas_no_confeccionadas || {};
              const tieneTallasNC = Object.keys(tallasNoConf).length > 0;
              // Detalle por talla
              const detalleNC = tieneTallasNC
                ? '<div class="flex flex-wrap gap-1 mb-2">'
                  + TODAS_TALLAS.filter(t => (tallasNoConf[t] || 0) > 0)
                    .map(t => '<span class="text-xs px-2 py-0.5 rounded-full font-bold" style="background:rgba(220,38,38,0.12);color:#fca5a5">'
                      + t + ': ' + tallasNoConf[t] + '</span>').join('')
                  + '</div>'
                : '';
              return `
              <div class="mt-2 p-3 rounded-xl border ${
                ncEst === 'aprobado'  ? 'bg-green-900/10 border-green-900/30' :
                ncEst === 'rechazado' ? 'bg-zinc-800/40 border-zinc-700/40' :
                'bg-red-500/5 border-red-500/20'}">
                <p class="text-xs ${ncEst === 'aprobado' ? 'text-green-400/90' : ncEst === 'rechazado' ? 'text-slate-400' : 'text-red-400/90'} mb-1">
                  ❌ No pudo confeccionar <strong>${noConf}</strong> piezas.
                  ${ncEst === 'pendiente' ? ' ¿Apruebas descontarlas?' : ''}
                  ${ncEst === 'aprobado'  ? ' <strong>✓ Aprobado</strong> — ya se descontaron.' : ''}
                  ${ncEst === 'rechazado' ? ' <strong>✕ Rechazado</strong> — siguen pendientes.' : ''}
                </p>
                ${detalleNC}
                ${ncEst === 'pendiente' ? `
                <div class="flex gap-2">
                  <button onclick="resolverNoConfeccionado('${a.id}','aprobado')"
                    class="flex-1 py-2 bg-green-700 hover:bg-green-600 text-white font-bold rounded-lg text-xs">✓ Aprobar</button>
                  <button onclick="resolverNoConfeccionado('${a.id}','rechazado')"
                    class="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-bold rounded-lg text-xs">✕ Rechazar</button>
                </div>` : `
                <button onclick="resolverNoConfeccionado('${a.id}','pendiente')"
                  class="text-xs text-slate-500 hover:text-slate-300 underline">Revisar de nuevo</button>`}
              </div>`;
            })() : ''}

            ${a.nota_confeccionista ? `<p class="text-blue-300/80 text-xs mt-2">💬 Conf: <em>${escHtml(a.nota_confeccionista)}</em></p>` : ''}
            ${a.rechazo_nota ? `<p class="text-red-400/80 text-xs mt-2">✕ Rechazo: <em>${escHtml(a.rechazo_nota)}</em></p>` : ''}
            ${a.confirmacion_nota ? `<p class="text-green-400/70 text-xs mt-1">✅ Nota confirm.: <em>${escHtml(a.confirmacion_nota)}</em></p>` : ''}
            ${renderAsigInsumos(a.id, true)}
            ${renderFotosGaleria(a.id, true)}
          </div>

          <!-- EDIT MODE -->
          <div id="asig-edit-${a.id}" class="hidden px-4 py-4 bg-zinc-900/60 border-t border-zinc-800">
            <p class="text-xs text-gold-400 font-semibold mb-3">✏️ Editar asignación</p>
            <div class="mb-3">
              <label class="text-xs text-slate-400 mb-1 block">Unidades asignadas</label>
              <input type="number" id="edit-asig-cant-${a.id}" value="${a.cantidad_asignada}" min="1"
                onfocus="this.select()"
                class="w-full px-3 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-xl font-bold text-center focus:outline-none focus:border-gold-500" />
            </div>
            <!-- CURVA DE TALLAS — editable por el admin -->
            <div class="pt-3 border-t border-zinc-800 mb-3">
              <p class="text-xs text-slate-400 font-semibold mb-2">📐 Curva de tallas <span class="text-slate-600 font-normal">(deja en 0 si no aplica)</span></p>
              ${renderTallasInput(`edit-talla-${a.id}`, curva)}
            </div>
            <!-- DEVOLUCIONES POR TALLA -->
            ${renderDevolucionesEdit(a.id, curva, tallas_conf_actual, a.tallas_devoluciones || {}, devols)}
            <div class="flex gap-2 mt-3">
              <button onclick="saveAdminAsigEdit('${a.id}')"
                class="flex-1 py-2.5 bg-gold-500 hover:bg-gold-600 text-black font-bold rounded-xl text-sm">💾 Guardar</button>
              <button onclick="toggleAsigEdit('${a.id}')"
                class="px-4 py-2.5 border border-zinc-700 rounded-xl text-slate-400 text-sm">Cancelar</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`).join('');

  if (!html) html = `<p class="text-center text-slate-500 text-sm py-8">Aún no hay asignaciones.<br>Usa el botón de abajo para agregar.</p>`;

  html += `<button onclick="openNewAsignacionModal()"
    class="w-full py-4 mt-1 border-2 border-dashed border-zinc-700 hover:border-gold-500/50 rounded-2xl
           text-slate-400 hover:text-gold-400 text-sm transition-colors flex items-center justify-center gap-2">
    <span class="text-xl font-light">+</span> Agregar Asignación
  </button>`;

  container.innerHTML = html;
}

// ================================================================
// 12. RENDER — CONFECCIONISTA (diseño móvil mejorado)
// ================================================================
function renderAsignacionesConf(asigs, container) {
  if (!asigs.length) {
    container.innerHTML = `<p class="text-center text-slate-500 text-sm py-8">No tienes asignaciones para esta prenda.</p>`;
    return;
  }

  container.innerHTML = asigs.map(a => {
    const curva       = a.curva_tallas       || {};
    const progreso    = a.tallas_progreso         || {};
    const confirmadas = a.tallas_confirmadas       || {};
    const tallasDevol = a.tallas_devoluciones      || {};
    const tieneTallas = TODAS_TALLAS.some(t => (curva[t] || 0) > 0);
    const devols   = Number(a.cantidad_devoluciones) || 0;
    const noConf   = Number(a.cantidad_no_confeccionadas) || 0;
    const asignada = Number(a.cantidad_asignada) || 0;
    const entregada = Number(a.cantidad_entregada) || 0;
    // cantidad_entregada ya queda neta de devoluciones (se resta en el origen tanto
    // al rechazar en revisión como al registrar una devolución manual), por lo que
    // NO se vuelve a restar "devols" aquí para evitar doble conteo.
    const terminadasEfectivas = entregada;
    // Pendientes correctas: asignado menos terminadas efectivas
    const pendientes = Math.max(0, asignada - terminadasEfectivas);

    return `
    <div class="card mb-4 overflow-hidden">

      <!-- CABECERA DE LA ASIGNACIÓN -->
      <div class="px-4 pt-4 pb-3 border-b border-zinc-800/60">
        <p class="font-bold text-white text-lg leading-tight">${escHtml(a.parte)}</p>
        ${a.descripcion ? `<p class="text-slate-400 text-sm mt-0.5">${escHtml(a.descripcion)}</p>` : ''}
        ${a.nota ? `
        <div class="mt-2 px-3 py-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg">
          <p class="text-yellow-400 text-xs font-semibold">📝 Nota del administrador</p>
          <p class="text-yellow-300/90 text-sm mt-0.5">${escHtml(a.nota)}</p>
        </div>` : ''}
        ${a.rechazo_nota ? `
        <div class="mt-2 px-3 py-2 bg-red-900/15 border border-red-800/40 rounded-lg">
          <p class="text-red-400 text-xs font-semibold">⚠️ El admin no aceptó tu última entrega:</p>
          <p class="text-red-300/90 text-sm mt-0.5">${escHtml(a.rechazo_nota)}</p>
        </div>` : ''}
      </div>

      <!-- TABLERO DE RESUMEN (grande y claro) -->
      <div class="px-4 py-3">
        <p class="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2">Tu avance</p>

        <!-- Números principales - 2 columnas grandes -->
        <div class="grid grid-cols-2 gap-2 mb-2">
          <div class="rounded-2xl p-4 text-center" style="background:#1c2a1c; border:1px solid #2d4a2d">
            <div class="text-green-400 text-xs font-semibold mb-1">✅ TERMINADAS</div>
            <div id="conf-entregadas-${a.id}" class="text-white font-black" style="font-size:2.5rem;line-height:1">${terminadasEfectivas}</div>
            ${devols > 0 ? `<div class="text-xs text-red-400/80 mt-1">(reportaste ${entregada + devols} · se devolvieron ${devols})</div>` : ''}
          </div>
          <div class="rounded-2xl p-4 text-center" style="background:#2a1c0a; border:1px solid #4a3010">
            <div class="text-yellow-500 text-xs font-semibold mb-1">⏳ PENDIENTES</div>
            <div id="conf-pendientes-${a.id}" class="text-white font-black" style="font-size:2.5rem;line-height:1">${pendientes}</div>
            <div class="text-xs text-slate-500 mt-1">de ${asignada} asignadas</div>
          </div>
        </div>

        <!-- Fila secundaria de datos -->
        <div class="grid grid-cols-3 gap-1.5 text-center text-xs">
          <div class="bg-zinc-800/60 rounded-xl py-2.5 px-1">
            <div class="text-blue-400 mb-1">🔧 En proceso</div>
            <div class="text-white font-bold text-xl">${a.cantidad_confeccionada}</div>
          </div>
          <div class="bg-zinc-800/60 rounded-xl py-2.5 px-1">
            <div class="text-gold-400 mb-1">📦 Asignadas</div>
            <div class="text-white font-bold text-xl">${asignada}</div>
          </div>
          ${devols > 0 ? `
          <div class="rounded-xl py-2.5 px-1 text-center" style="background:rgba(220,38,38,0.08); border:1px solid rgba(220,38,38,0.2)">
            <div class="text-red-400 mb-1">🔄 Devueltas</div>
            <div class="text-white font-bold text-xl">${devols}</div>
          </div>` : `
          <div class="bg-zinc-800/60 rounded-xl py-2.5 px-1">
            <div class="text-slate-500 mb-1">❌ No conf.</div>
            <div class="text-white font-bold text-xl">${noConf}</div>
          </div>`}
        </div>

        <!-- Devoluciones por talla (si el admin especificó) -->
        ${devols > 0 && Object.keys(tallasDevol).length > 0 ? (() => {
          const items = TODAS_TALLAS.filter(t => (tallasDevol[t] || 0) > 0)
            .map(t => '<span class="text-xs px-2 py-1 rounded-lg font-bold" style="background:rgba(220,38,38,0.1);color:#f87171">'
              + t + ': ' + tallasDevol[t] + '</span>')
            .join('');
          return '<div class="mt-2 px-1">'
            + '<p class="text-xs text-red-400/80 mb-1.5">🔄 Te devolvemos estas tallas:</p>'
            + '<div class="flex flex-wrap gap-1">' + items + '</div>'
            + '</div>';
        })() : ''}

        <!-- Barra de progreso -->
        ${asignada > 0 ? (() => {
          const pct = Math.min(100, Math.round(terminadasEfectivas/asignada*100));
          return `
          <div class="mt-3">
            <div class="flex justify-between text-xs text-slate-500 mb-1">
              <span>Progreso</span><span class="font-bold text-gold-400">${pct}%</span>
            </div>
            <div class="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
              <div class="h-full bg-gradient-to-r from-gold-600 to-gold-400 rounded-full transition-all" style="width:${pct}%"></div>
            </div>
          </div>`;
        })() : ''}

        <!-- Tallas resumen — muestra estado por talla con confirmaciones -->
        ${renderTallasResumen(curva, progreso, false, confirmadas)}
      </div>

      <!-- SEPARADOR con etiqueta -->
      <div class="relative my-1 mx-4">
        <div class="border-t border-zinc-700"></div>
        <span class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 px-3 text-xs text-slate-500 font-semibold uppercase tracking-wide">
          📝 Reporta tu avance
        </span>
      </div>

      <!-- CAMPOS QUE LLENA EL CONFECCIONISTA -->
      <div class="px-4 pb-4 pt-5 space-y-4">

        <!-- TALLAS PROGRESO — siempre visible para que el confeccionista reporte por talla -->
        <div>
          <p class="text-sm font-bold text-white mb-1">✅ ¿Cuántas terminaste por talla?</p>
          ${tieneTallas ? '' : `<p class="text-xs text-slate-500 mb-2">Llena solo las tallas que aplican a esta asignación.</p>`}
          ${renderTallasInput(`tp-${a.id}`, progreso, `syncEntregaResumen('${a.id}')`)}
        </div>

        <!-- TOTALES CALCULADOS AUTOMÁTICAMENTE DESDE LAS TALLAS -->
        <div class="grid grid-cols-2 gap-2 rounded-2xl bg-zinc-800/70 border border-zinc-700 p-3 text-center">
          <div>
            <div class="text-xs text-green-400 font-semibold">ENTREGADAS</div>
            <div id="entrega-total-${a.id}" class="text-2xl text-white font-black">${terminadasEfectivas}</div>
          </div>
          <div>
            <div class="text-xs text-yellow-500 font-semibold">PENDIENTES</div>
            <div id="entrega-pendientes-${a.id}" class="text-2xl text-white font-black">${pendientes}</div>
          </div>
        </div>
        <p id="entrega-warn-${a.id}" class="hidden text-xs text-red-400 -mt-2"></p>

        <!-- NO PUDE CONFECCIONAR — por talla si hay curva, sino total -->
        <div>
          <label class="text-sm font-semibold text-slate-300 mb-2 block">❌ No pude confeccionar
            <span class="text-xs text-slate-500 font-normal ml-1">(solo piezas que definitivamente no puedes hacer)</span>
          </label>
          ${renderNoConfInput(a.id, curva, noConf, a.tallas_no_confeccionadas || {})}
        </div>

        <!-- FECHA DE ENTREGA -->
        <div>
          <label class="text-sm font-semibold text-slate-300 mb-2 block">📅 Fecha de entrega</label>
          <input type="date" id="inp-fecha-${a.id}" value="${a.fecha_entrega ? a.fecha_entrega.slice(0,10) : ''}"
            class="w-full px-3 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-gold-500" />
        </div>

        <!-- NOTA -->
        <div>
          <label class="text-sm font-semibold text-slate-300 mb-2 block">📝 Mi nota</label>
          <textarea id="inp-nota-${a.id}" rows="3" placeholder="Escribe un mensaje al administrador (problemas, avances, preguntas...)"
            class="w-full px-3 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-gold-500 resize-none">${escHtml(a.nota_confeccionista||'')}</textarea>
        </div>

        <!-- BOTÓN GUARDAR (grande y dorado) -->
        <button onclick="saveAsignacionProgress('${a.id}')"
          class="btn-gold py-4 text-base flex items-center justify-center gap-2">
          💾 Guardar mi avance
        </button>
      </div>

      ${renderAsigInsumos(a.id, false)}
      ${renderFotosGaleria(a.id, false)}
    </div>`;
  }).join('');
}

// ================================================================
// 13. CRUD — PRENDAS
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
// 14. CRUD — ASIGNACIONES
// ================================================================
// Auto-suma tallas en el modal de nueva asignación → actualiza el campo cantidad
function syncTallasTotal() {
  const total = TODAS_TALLAS.reduce((sum, t) => {
    return sum + (parseInt(document.getElementById(`modal-talla-${t}`)?.value) || 0);
  }, 0);
  const cantEl = document.getElementById('asig-cantidad');
  if (cantEl && total > 0) cantEl.value = total;
  // Badge visible con el total calculado
  const badge = document.getElementById('asig-tallas-total-badge');
  if (badge) {
    if (total > 0) {
      badge.textContent = `Total: ${total}`;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

async function saveNewAsignacion() {
  const confId      = document.getElementById('asig-confeccionista').value;
  const parte       = document.getElementById('asig-parte').value.trim();
  const descripcion = document.getElementById('asig-descripcion').value.trim();
  const nota        = document.getElementById('asig-nota').value.trim();
  const cantidad    = parseInt(document.getElementById('asig-cantidad').value);

  if (!confId)               { showToast('Selecciona un confeccionista', 'error'); return; }
  if (!parte)                { showToast('Ingresa la parte de la prenda', 'error'); return; }
  if (!cantidad || cantidad<1) { showToast('Ingresa la cantidad a asignar', 'error'); return; }

  // Leer curva de tallas del modal
  const curva_tallas = readTallasInput('modal-talla');
  const totalTallas  = Object.values(curva_tallas).reduce((s, v) => s + v, 0);

  // Validar que si hay tallas, la suma no supere la cantidad asignada
  if (totalTallas > cantidad) {
    showToast(`La suma de tallas (${totalTallas}) supera la cantidad asignada (${cantidad})`, 'error');
    return;
  }

  // Insumos específicos para esta confeccionista (opcional)
  const insumoRows = readAsigInsumoRows();

  const prendaId = state.currentPrenda.id;
  const { data: newAsig, error } = await sb.from('asignaciones').insert({
    prenda_id: prendaId, confeccionista_id: confId,
    parte, descripcion, nota, cantidad_asignada: cantidad,
    curva_tallas
  }).select('id').single();
  if (error) { showToast('Error al guardar asignación', 'error'); console.error(error); return; }

  if (insumoRows.length && newAsig?.id) {
    const { error: insErr } = await sb.from('asignacion_insumos').insert(
      insumoRows.map(r => ({ asignacion_id: newAsig.id, nombre: r.nombre, cantidad: r.cantidad }))
    );
    if (insErr) {
      console.error(insErr);
      showToast('Asignación creada, pero hubo un error al guardar los insumos', 'error');
    }
  }

  if (state.currentPrenda.status === 'por_procesar') {
    await sb.from('prendas').update({ status: 'en_proceso' }).eq('id', prendaId);
  }

  closeModal('modal-new-asignacion');
  ['asig-parte','asig-descripcion','asig-nota','asig-cantidad'].forEach(id =>
    document.getElementById(id).value = '');
  document.getElementById('asig-confeccionista').value = '';
  // Limpiar tallas
  TODAS_TALLAS.forEach(t => {
    const el = document.getElementById(`modal-talla-${t}`);
    if (el) el.value = '';
  });
  resetAsigInsumoRows();
  showToast('✅ Asignación guardada');
  await loadPrendaDetail(prendaId, false);
  await loadPrendas();
}

async function saveAsignacionProgress(asigId) {
  const notaConf      = document.getElementById(`inp-nota-${asigId}`)?.value || '';
  const fechaRaw      = document.getElementById(`inp-fecha-${asigId}`)?.value || '';
  const fechaEntrega  = fechaRaw ? new Date(fechaRaw).toISOString() : null;

  const asig = state.currentAsignaciones.find(x => x.id === asigId);
  const curva = asig?.curva_tallas || {};
  const tallasConCurva = TODAS_TALLAS.filter(t => (curva[t] || 0) > 0);

  // Leer "no pude confeccionar" — por talla si hay curva, sino campo único
  let noConf = 0;
  const tallas_no_confeccionadas = {};
  if (tallasConCurva.length > 0) {
    tallasConCurva.forEach(t => {
      const v = parseInt(document.getElementById(`inp-noconf-${asigId}-${t}`)?.value) || 0;
      if (v > 0) tallas_no_confeccionadas[t] = v;
      noConf += v;
    });
  } else {
    noConf = parseInt(document.getElementById(`inp-noconf-${asigId}`)?.value) || 0;
  }

  // El total entregado y "en proceso" se derivan de las cantidades por talla.
  const entrega = syncEntregaResumen(asigId);
  if (entrega.errores.length) {
    showToast(entrega.errores[0], 'error');
    return;
  }
  const tallas_progreso = entrega.tallas;
  const entregada = entrega.total;

  const updateData = {
    cantidad_confeccionada:     entregada,
    cantidad_entregada:         entregada,
    cantidad_no_confeccionadas: noConf,
    tallas_no_confeccionadas,
    nota_confeccionista:        notaConf,
    fecha_entrega:              fechaEntrega,
    tallas_progreso
  };

  // Si cambió la cantidad de "no pude confeccionar", resetear estado de aprobación
  const noConfAnterior = Number(asig?.cantidad_no_confeccionadas) || 0;
  if (noConf !== noConfAnterior) {
    updateData.no_conf_estado = 'pendiente';
  }

  // Si el confeccionista actualiza entregado (trabaja de nuevo), limpiar rechazo
  const entregadaAnterior = Number(asig?.cantidad_entregada) || 0;
  if (entregada !== entregadaAnterior && asig?.rechazo_nota) {
    updateData.rechazo_nota = null;
  }

  const { error } = await sb.from('asignaciones').update(updateData).eq('id', asigId);
  if (error) { showToast('Error al guardar', 'error'); return; }
  showToast('✅ Progreso guardado');
  await loadPrendaDetail(state.currentPrenda.id, false);
}

function toggleAsigEdit(asigId) {
  document.getElementById(`asig-view-${asigId}`)?.classList.toggle('hidden');
  document.getElementById(`asig-edit-${asigId}`)?.classList.toggle('hidden');
}

async function saveAdminAsigEdit(asigId) {
  const cantidadInput = parseInt(document.getElementById(`edit-asig-cant-${asigId}`)?.value) || 0;
  const curva_tallas  = readTallasInput(`edit-talla-${asigId}`);

  if (cantidadInput < 1) { showToast('La cantidad debe ser mayor a 0', 'error'); return; }

  // Validar que la suma de tallas no supere la cantidad asignada
  const sumaTallas = Object.values(curva_tallas).reduce((s, v) => s + v, 0);
  if (sumaTallas > 0 && sumaTallas > cantidadInput) {
    showToast(`La suma de tallas (${sumaTallas}) supera la cantidad asignada (${cantidadInput})`, 'error');
    return;
  }

  const asig = state.currentAsignaciones.find(x => x.id === asigId);
  const tallasDevolAnteriores = asig?.tallas_devoluciones || {};
  const devolsAnteriores      = Number(asig?.cantidad_devoluciones) || 0;
  const tallasProgresoActual  = { ...(asig?.tallas_progreso    || {}) };
  const tallasConfActual      = { ...(asig?.tallas_confirmadas || {}) };
  let entregadaActual  = Number(asig?.cantidad_entregada)  || 0;
  let confirmadoActual = Number(asig?.cantidad_confirmada) || 0;

  // Leer devoluciones nuevas — por talla si hay grid, sino del campo simple/hidden
  const tallas_devoluciones = {};
  TODAS_TALLAS.forEach(t => {
    const el = document.getElementById(`edit-devol-${asigId}-${t}`);
    if (el) {
      const v = parseInt(el.value) || 0;
      if (v > 0) tallas_devoluciones[t] = v;
    }
  });
  const nuevasDevolsFlat = parseInt(document.getElementById(`edit-asig-devols-${asigId}`)?.value) || 0;
  const usaTallasDevol = Object.keys(tallas_devoluciones).length > 0 || Object.keys(tallasDevolAnteriores).length > 0;

  // IMPORTANTE: para que "confirmado" y "entregada" queden siempre netos de
  // devoluciones (y así no restar dos veces en las pantallas de admin/confeccionista),
  // cualquier cambio en devoluciones desde este formulario se aplica de inmediato
  // como delta sobre entregada/confirmado (y sus versiones por talla), igual que
  // hace el rechazo en revisión. Si el admin reduce una devolución (la "deshace"),
  // las unidades se restituyen.
  if (usaTallasDevol) {
    TODAS_TALLAS.forEach(t => {
      const anterior = tallasDevolAnteriores[t] || 0;
      const nueva    = tallas_devoluciones[t]   || 0;
      const delta    = nueva - anterior; // positivo = se devuelven más; negativo = se restituyen
      if (delta === 0) return;
      tallasProgresoActual[t] = Math.max(0, (tallasProgresoActual[t] || 0) - delta);
      tallasConfActual[t]     = Math.max(0, (tallasConfActual[t]     || 0) - delta);
    });
    entregadaActual  = Object.values(tallasProgresoActual).reduce((s, v) => s + v, 0);
    confirmadoActual = Object.values(tallasConfActual).reduce((s, v) => s + v, 0);
  } else {
    const delta = nuevasDevolsFlat - devolsAnteriores;
    if (delta !== 0) {
      entregadaActual  = Math.max(0, entregadaActual  - delta);
      confirmadoActual = Math.max(0, confirmadoActual - delta);
    }
  }

  const cantidad_devoluciones = usaTallasDevol
    ? Object.values(tallas_devoluciones).reduce((s, v) => s + v, 0)
    : nuevasDevolsFlat;

  const updateData = {
    cantidad_asignada:    cantidadInput,
    cantidad_devoluciones,
    tallas_devoluciones,
    curva_tallas,
    cantidad_entregada:   entregadaActual,
    cantidad_confirmada:  confirmadoActual
  };
  if (usaTallasDevol) {
    updateData.tallas_progreso    = tallasProgresoActual;
    updateData.tallas_confirmadas = tallasConfActual;
  }

  const { error } = await sb.from('asignaciones').update(updateData).eq('id', asigId);

  if (error) { showToast('Error al guardar', 'error'); console.error(error); return; }
  showToast('✅ Asignación actualizada');
  await loadPrendaDetail(state.currentPrenda.id, false);
}

// Validar en tiempo real que confirm-cant no supere el máximo
function validarCantidadConfirm(asigId, max) {
  const inp  = document.getElementById(`confirm-cant-${asigId}`);
  const warn = document.getElementById(`confirm-warn-${asigId}`);
  if (!inp || !warn) return;
  const val = parseInt(inp.value) || 0;
  if (val > max) {
    inp.classList.add('border-red-500');
    warn.classList.remove('hidden');
  } else {
    inp.classList.remove('border-red-500');
    warn.classList.add('hidden');
  }
}

// Confirmación de entrega — por talla individual o total
const _accionesEnCurso = new Set();
async function confirmarEntrega(asigId, hasTallasPendientes = false) {
  if (_accionesEnCurso.has(`confirmar-${asigId}`)) return;
  _accionesEnCurso.add(`confirmar-${asigId}`);
  try {
    const nota = document.getElementById(`confirm-nota-${asigId}`)?.value?.trim() || null;
    const asig = state.currentAsignaciones.find(x => x.id === asigId);
    if (!asig) return;

    const reportado    = Number(asig.cantidad_entregada) || 0;
    const confirmado   = Number(asig.cantidad_confirmada) || 0;
    const porConfirmar = Math.max(0, reportado - confirmado);

    const tallas_progreso        = asig.tallas_progreso    || {};
    const tallas_conf_previas    = asig.tallas_confirmadas || {};

    let cantidad = 0;
    const updateData = { confirmacion_nota: nota };

    if (hasTallasPendientes) {
      // Leer inputs por talla y calcular nuevas confirmadas acumuladas
      const nuevas_tallas_conf = { ...tallas_conf_previas };
      TODAS_TALLAS.forEach(t => {
        const rep_t  = tallas_progreso[t]     || 0;
        const prev_t = tallas_conf_previas[t] || 0;
        const pend_t = Math.max(0, rep_t - prev_t);
        if (pend_t <= 0) return;
        const inp = document.getElementById(`ctalla-${asigId}-${t}`);
        if (!inp) return;
        const val = Math.min(pend_t, Math.max(0, parseInt(inp.value) || 0));
        nuevas_tallas_conf[t] = prev_t + val;
        cantidad += val;
      });
      updateData.tallas_confirmadas = nuevas_tallas_conf;
    } else {
      // Confirmación total (sin tallas)
      const inp = document.getElementById(`confirm-cant-${asigId}`);
      cantidad = parseInt(inp?.value) || 0;
    }

    if (cantidad < 1) { showToast('Ingresa al menos 1 unidad para confirmar', 'error'); return; }

    // Validación: no puede aceptar más de lo reportado pendiente
    if (cantidad > porConfirmar) {
      showToast(`⚠️ Solo puedes aceptar hasta ${porConfirmar} (lo que reportó el confeccionista)`, 'error');
      return;
    }

    updateData.cantidad_confirmada = confirmado + cantidad;

    const { data: actualizado, error } = await sb.from('asignaciones')
      .update(updateData)
      .eq('id', asigId)
      .eq('cantidad_confirmada', confirmado) // optimistic locking
      .select('id');

    if (error) { showToast('Error al confirmar', 'error'); console.error(error); return; }
    if (!actualizado || !actualizado.length) {
      showToast('Otro administrador ya actualizó esta asignación. Recargando...', 'warn');
      await loadPrendaDetail(state.currentPrenda.id, false);
      return;
    }

    const rechazadas = porConfirmar - cantidad;
    const msg = rechazadas > 0
      ? `✅ ${cantidad} aceptadas · ${rechazadas} sin confirmar aún`
      : `✅ ${cantidad} unidades confirmadas`;
    showToast(msg);
    await loadPrendaDetail(state.currentPrenda.id, false);
  } finally {
    _accionesEnCurso.delete(`confirmar-${asigId}`);
  }
}

// Rechazar una cantidad específica (total o por talla), con motivo obligatorio.
// Resta de lo reportado (cantidad_entregada / tallas_progreso) y suma a devoluciones
// (cantidad_devoluciones / tallas_devoluciones), para que el confeccionista vea el
// motivo, las unidades vuelvan a "pendientes" y no se cuenten como terminadas.
async function rechazarEntregaParcial(asigId, hasTallasPendientes = false) {
  if (_accionesEnCurso.has(`rechazar-${asigId}`)) return;
  _accionesEnCurso.add(`rechazar-${asigId}`);
  try {
    const motivo = document.getElementById(`reject-motivo-${asigId}`)?.value?.trim() || '';
    const asig = state.currentAsignaciones.find(x => x.id === asigId);
    if (!asig) return;

    const reportado = Number(asig.cantidad_entregada) || 0;

    const tallas_progreso      = asig.tallas_progreso      || {};
    const tallas_conf_previas  = asig.tallas_confirmadas   || {};
    const tallas_devol_previas = asig.tallas_devoluciones  || {};

    let cantidadRechazo = 0;
    const updateData = {};

    if (hasTallasPendientes) {
      // Leer inputs de rechazo por talla y ajustar progreso/devoluciones por talla
      const nuevas_tallas_progreso = { ...tallas_progreso };
      const nuevas_tallas_devol    = { ...tallas_devol_previas };
      TODAS_TALLAS.forEach(t => {
        const rep_t  = tallas_progreso[t]     || 0;
        const prev_t = tallas_conf_previas[t] || 0;
        const pend_t = Math.max(0, rep_t - prev_t);
        if (pend_t <= 0) return;
        const inp = document.getElementById(`rtalla-${asigId}-${t}`);
        if (!inp) return;
        const val = Math.min(pend_t, Math.max(0, parseInt(inp.value) || 0));
        if (val <= 0) return;
        nuevas_tallas_progreso[t] = Math.max(0, rep_t - val);
        nuevas_tallas_devol[t]    = (tallas_devol_previas[t] || 0) + val;
        cantidadRechazo += val;
      });
      updateData.tallas_progreso     = nuevas_tallas_progreso;
      updateData.tallas_devoluciones = nuevas_tallas_devol;
      updateData.cantidad_entregada    = Object.values(nuevas_tallas_progreso).reduce((s, v) => s + v, 0);
      updateData.cantidad_devoluciones = Object.values(nuevas_tallas_devol).reduce((s, v) => s + v, 0);
    } else {
      const confirmado   = Number(asig.cantidad_confirmada) || 0;
      const porConfirmar = Math.max(0, reportado - confirmado);
      const inp = document.getElementById(`reject-cant-${asigId}`);
      cantidadRechazo = Math.min(porConfirmar, Math.max(0, parseInt(inp?.value) || 0));
      if (cantidadRechazo > 0) {
        const sumaProgreso = Object.values(tallas_progreso).reduce((s, v) => s + v, 0);
        if (sumaProgreso > 0) {
          // Descontar también de tallas_progreso (aunque esta asignación no tenga
          // curva configurada) para que el próximo guardado del confeccionista —
          // que siempre recalcula cantidad_entregada desde tallas_progreso — no
          // restaure el valor rechazado.
          let restante = cantidadRechazo;
          const nuevas_tallas_progreso = { ...tallas_progreso };
          TODAS_TALLAS.forEach(t => {
            if (restante <= 0) return;
            const disponible = nuevas_tallas_progreso[t] || 0;
            if (disponible <= 0) return;
            const quitar = Math.min(disponible, restante);
            nuevas_tallas_progreso[t] = disponible - quitar;
            restante -= quitar;
          });
          updateData.tallas_progreso    = nuevas_tallas_progreso;
          updateData.cantidad_entregada = Object.values(nuevas_tallas_progreso).reduce((s, v) => s + v, 0);
        } else {
          updateData.cantidad_entregada = Math.max(0, reportado - cantidadRechazo);
        }
        updateData.cantidad_devoluciones = (Number(asig.cantidad_devoluciones) || 0) + cantidadRechazo;
      }
    }

    if (cantidadRechazo < 1) { showToast('Ingresa al menos 1 unidad para rechazar', 'error'); return; }
    if (!motivo) { showToast('Escribe el motivo del rechazo', 'error'); return; }

    updateData.rechazo_nota = motivo;

    const { data: actualizado, error } = await sb.from('asignaciones')
      .update(updateData)
      .eq('id', asigId)
      .eq('cantidad_entregada', reportado) // optimistic locking
      .select('id');

    if (error) { showToast('Error al rechazar', 'error'); console.error(error); return; }
    if (!actualizado || !actualizado.length) {
      showToast('Otro administrador ya actualizó esta asignación. Recargando...', 'warn');
      await loadPrendaDetail(state.currentPrenda.id, false);
      return;
    }

    showToast(`✕ ${cantidadRechazo} unidad(es) rechazada(s) — el confeccionista verá el motivo`);
    await loadPrendaDetail(state.currentPrenda.id, false);
  } finally {
    _accionesEnCurso.delete(`rechazar-${asigId}`);
  }
}

// Aprobación / rechazo de "no pude confeccionar"
async function resolverNoConfeccionado(asigId, decision) {
  const asig   = state.currentAsignaciones.find(x => x.id === asigId);
  const noConf = Number(asig?.cantidad_no_confeccionadas) || 0;
  const estadoActual = asig?.no_conf_estado || 'pendiente';
  const tallasNoConf = asig?.tallas_no_confeccionadas || {};

  const updateData = { no_conf_estado: decision };

  if (decision === 'aprobado' && noConf > 0) {
    // Descontar del total asignado
    updateData.cantidad_asignada = Math.max(0, (Number(asig?.cantidad_asignada) || 0) - noConf);
    // Descontar también de la curva de tallas si hay info por talla
    if (Object.keys(tallasNoConf).length > 0) {
      const nuevaCurva = { ...(asig?.curva_tallas || {}) };
      TODAS_TALLAS.forEach(t => {
        if (tallasNoConf[t] > 0) {
          nuevaCurva[t] = Math.max(0, (nuevaCurva[t] || 0) - tallasNoConf[t]);
          if (nuevaCurva[t] === 0) delete nuevaCurva[t];
        }
      });
      updateData.curva_tallas = nuevaCurva;
    }
  } else if (decision === 'pendiente' && estadoActual === 'aprobado' && noConf > 0) {
    // Restaurar lo que se había descontado al aprobar
    updateData.cantidad_asignada = (Number(asig?.cantidad_asignada) || 0) + noConf;
    if (Object.keys(tallasNoConf).length > 0) {
      const nuevaCurva = { ...(asig?.curva_tallas || {}) };
      TODAS_TALLAS.forEach(t => {
        if (tallasNoConf[t] > 0) {
          nuevaCurva[t] = (nuevaCurva[t] || 0) + tallasNoConf[t];
        }
      });
      updateData.curva_tallas = nuevaCurva;
    }
  }

  const { error } = await sb.from('asignaciones').update(updateData).eq('id', asigId);
  if (error) { showToast('Error al guardar decisión', 'error'); return; }

  const msg = decision === 'aprobado'  ? `✓ Aprobado — se descontaron ${noConf} piezas`
            : decision === 'rechazado' ? '✕ Rechazado — el confeccionista sigue siendo responsable'
            : 'Marcado para revisión';
  showToast(msg);
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
// 15. FOTOS MÚLTIPLES
// ================================================================
const MAX_FOTOS_ASIG = 4;

function renderFotosGaleria(asigId, isAdmin) {
  const fotos = state.currentFotos?.[asigId] || [];
  const puedeSubir = fotos.length < MAX_FOTOS_ASIG;

  const grid = fotos.length ? `
    <div class="grid grid-cols-2 gap-2 mb-3">
      ${fotos.map(f => {
        const puedeBorrar = isAdmin || f.uploaded_by === state.user?.id;
        return `
        <div class="relative">
          <img src="${escHtml(f.foto_url)}" onclick="openPhoto('${escHtml(f.foto_url)}')"
               class="w-full h-28 object-cover rounded-xl cursor-pointer border border-zinc-700" />
          ${puedeBorrar ? `
          <button onclick="event.stopPropagation(); eliminarFoto('${f.id}')"
            class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 hover:bg-red-600 text-white text-xs flex items-center justify-center">✕</button>` : ''}
          ${f.descripcion ? `<p class="text-[11px] text-slate-400 mt-1 leading-snug line-clamp-2">${escHtml(f.descripcion)}</p>` : ''}
        </div>`;
      }).join('')}
    </div>` : `<p class="text-xs text-slate-500 mb-2">Sin fotos todavía.</p>`;

  const uploader = puedeSubir ? `
    <input type="text" id="foto-desc-${asigId}" placeholder="Descripción de la foto (opcional)"
           class="w-full px-3 py-2.5 mb-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-gold-500" />
    <div class="grid grid-cols-2 gap-2">
      <label class="flex items-center justify-center gap-1.5 py-2.5 border border-zinc-700 hover:border-gold-500 rounded-xl text-xs text-slate-400 hover:text-gold-400 cursor-pointer">
        📷 Tomar foto
        <input type="file" accept="image/*" capture="environment" class="hidden" onchange="handleFotoUpload('${asigId}', this)" />
      </label>
      <label class="flex items-center justify-center gap-1.5 py-2.5 border border-zinc-700 hover:border-gold-500 rounded-xl text-xs text-slate-400 hover:text-gold-400 cursor-pointer">
        🖼️ De galería
        <input type="file" accept="image/*" class="hidden" onchange="handleFotoUpload('${asigId}', this)" />
      </label>
    </div>` : `<p class="text-xs text-slate-500 text-center">Máximo de ${MAX_FOTOS_ASIG} fotos alcanzado.</p>`;

  return `
    <div class="px-4 py-3 border-t border-zinc-800">
      <p class="text-xs text-slate-500 mb-2">📸 Fotos del trabajo (${fotos.length}/${MAX_FOTOS_ASIG})</p>
      ${grid}
      ${uploader}
    </div>`;
}

async function handleFotoUpload(asigId, input) {
  const file = input.files[0];
  if (!file) return;

  const fotosActuales = state.currentFotos?.[asigId] || [];
  if (fotosActuales.length >= MAX_FOTOS_ASIG) {
    showToast(`Máximo ${MAX_FOTOS_ASIG} fotos por asignación`, 'error');
    input.value = ''; return;
  }

  showToast('Subiendo foto...', 'warn');
  const descripcion = document.getElementById(`foto-desc-${asigId}`)?.value.trim() || '';
  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `asignaciones/${asigId}-${Date.now()}.${ext}`;

  const { error: upErr } = await sb.storage.from('production-photos').upload(path, file, { upsert: true });
  if (upErr) { showToast('Error al subir foto', 'error'); return; }

  const { data: { publicUrl } } = sb.storage.from('production-photos').getPublicUrl(path);
  const { error } = await sb.from('asignacion_fotos').insert({
    asignacion_id: asigId, foto_url: publicUrl, descripcion, uploaded_by: state.user.id
  });
  if (error) { showToast('Error al guardar la foto', 'error'); return; }

  showToast('📸 Foto agregada');
  input.value = '';
  await loadPrendaDetail(state.currentPrenda.id, false);
}

function eliminarFoto(fotoId) {
  confirmAction('¿Eliminar foto?', 'Esta acción no se puede deshacer.', async () => {
    const { error } = await sb.from('asignacion_fotos').delete().eq('id', fotoId);
    if (error) { showToast('Error al eliminar la foto', 'error'); return; }
    showToast('Foto eliminada');
    await loadPrendaDetail(state.currentPrenda.id, false);
  });
}

// ================================================================
// 16. USUARIOS
// ================================================================
async function loadUsers() {
  const { data } = await sb.from('profiles').select('*').order('role').order('full_name');
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
    const isAdm = u.role === 'admin';
    const roleBadge = isAdm
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
          class="text-xs px-3 py-1.5 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-900/20">🗑</button>
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
    selectRole('confeccionista');
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
  await loadUsers();
  await loadConfeccionistas();
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
          body: JSON.stringify({ user_id: userId })
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
// 17. MODALES
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
  TODAS_TALLAS.forEach(t => {
    const el = document.getElementById(`modal-talla-${t}`);
    if (el) el.value = '';
  });
  // Resetear badge del total
  const badge = document.getElementById('asig-tallas-total-badge');
  if (badge) badge.classList.add('hidden');
  // Resetear filas de insumos a una sola fila vacía
  resetAsigInsumoRows();
  openModal('modal-new-asignacion');
  setTimeout(() => document.getElementById('asig-confeccionista').focus(), 200);
}

function openNewUserModal() {
  ['new-user-name','new-user-phone','new-user-password']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('new-user-error').classList.add('hidden');
  selectRole('confeccionista');
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
// 18. NAVEGACIÓN
// ================================================================
function showSection(id) {
  ['view-loading','view-login','app-shell'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = (s === id) ? 'flex' : 'none';
  });
}

function showMainView(viewId) {
  ['view-prendas','view-prenda-detail','view-users','view-export'].forEach(v =>
    document.getElementById(v)?.classList.toggle('active', v === viewId));

  document.getElementById('btn-back').classList.add('hidden');
  document.getElementById('btn-refresh').classList.add('hidden');
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
  } else if (viewId === 'view-export') {
    document.getElementById('header-title').textContent = 'Exportar a Excel';
    actionBtn.classList.add('hidden');
    loadExportData();
  }
  state.prevView = null;
}

function showDetailView(viewId, backView) {
  state.prevView = backView;
  ['view-prendas','view-prenda-detail','view-users','view-export'].forEach(v =>
    document.getElementById(v)?.classList.toggle('active', v === viewId));

  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('header-logo').style.display = 'none';
  // Mostrar botón actualizar solo en detalle de prenda
  document.getElementById('btn-refresh').classList.toggle('hidden', viewId !== 'view-prenda-detail');

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
  const prev  = state.prevView || state.currentNav;
  const btnMap = { 'view-users': 'nav-btn-users', 'view-export': 'nav-btn-export' };
  const btnId  = btnMap[prev] || 'nav-btn-prendas';
  switchNav(prev, btnId);
}

function switchNav(viewId, btnId) {
  state.currentNav = viewId;
  ['nav-btn-prendas','nav-btn-users','nav-btn-export'].forEach(id =>
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

// ================================================================
// 19. EXPORTACIÓN A EXCEL
// ================================================================
async function loadExportData() {
  document.getElementById('export-summary').textContent = 'Cargando datos...';

  const { data: prendas, error: pErr } = await sb.from('prendas')
    .select('*').order('created_at', { ascending: false });

  const { data: asigs, error: aErr } = await sb.from('asignaciones')
    .select('*, confeccionista:profiles!confeccionista_id(id, full_name, phone)')
    .order('created_at', { ascending: false });

  if (pErr || aErr) {
    document.getElementById('export-summary').textContent = 'Error al cargar los datos.';
    return;
  }

  state.exportPrendas      = prendas || [];
  state.exportAsignaciones = asigs || [];
  renderExportPreview();
}

function getAsigEstado(a) {
  const entregada   = Number(a.cantidad_entregada) || 0;
  const confirmada  = Number(a.cantidad_confirmada) || 0;
  const confeccionada = Number(a.cantidad_confeccionada) || 0;
  const estados = [];
  if (entregada === 0 && confeccionada === 0) estados.push('pendiente');
  if (confeccionada > 0) estados.push('en_proceso');
  if (entregada > 0 && confirmada < entregada) estados.push('entregada');
  if (confirmada > 0) estados.push('confirmada');
  return estados;
}

function getExportFiltered() {
  const q = (document.getElementById('export-search')?.value || '').trim().toLowerCase();
  const prendas = state.exportPrendas || [];
  const asigs   = state.exportAsignaciones || [];

  const fPend  = document.getElementById('filter-pendiente')?.checked;
  const fProc  = document.getElementById('filter-en-proceso')?.checked;
  const fEntr  = document.getElementById('filter-entregada')?.checked;
  const fConf  = document.getElementById('filter-confirmada')?.checked;
  const anyFilterActive = fPend || fProc || fEntr || fConf;

  if (!q && !anyFilterActive) return { prendas, asigs };

  const matchFecha = (dateStr) => {
    if (!dateStr) return false;
    const iso  = dateStr.slice(0, 10);
    const corto = formatDate(dateStr).toLowerCase();
    const dmy  = new Date(dateStr).toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' });
    return iso.includes(q) || corto.includes(q) || dmy.includes(q);
  };

  const prendasFiltradas = !q ? prendas : prendas.filter(p =>
    (p.nombre || '').toLowerCase().includes(q) || matchFecha(p.created_at)
  );
  const idsPrendasFiltradas = new Set(prendasFiltradas.map(p => p.id));

  const asigsFiltradas = asigs.filter(a => {
    const nombrePrenda = state.exportPrendas.find(p => p.id === a.prenda_id)?.nombre || '';
    const passText = !q || idsPrendasFiltradas.has(a.prenda_id)
        || (a.confeccionista?.full_name || '').toLowerCase().includes(q)
        || (nombrePrenda.toLowerCase().includes(q))
        || matchFecha(a.created_at);
    let passEstado = true;
    if (anyFilterActive) {
      const estados = getAsigEstado(a);
      passEstado = (fPend && estados.includes('pendiente'))
               || (fProc && estados.includes('en_proceso'))
               || (fEntr && estados.includes('entregada'))
               || (fConf && estados.includes('confirmada'));
    }
    return passText && passEstado;
  });

  const idsExtra = new Set(asigsFiltradas.map(a => a.prenda_id));
  const prendasFinal = prendas.filter(p => idsPrendasFiltradas.has(p.id) || idsExtra.has(p.id));

  return { prendas: prendasFinal, asigs: asigsFiltradas };
}

function renderExportPreview() {
  const { prendas, asigs } = getExportFiltered();
  const totalAsignado   = asigs.reduce((s, a) => s + (Number(a.cantidad_asignada) || 0), 0);
  const totalConfirmado = asigs.reduce((s, a) => s + (Number(a.cantidad_confirmada) || 0), 0);

  document.getElementById('export-summary').textContent =
    `${prendas.length} prenda${prendas.length !== 1 ? 's' : ''} · ${asigs.length} asignación${asigs.length !== 1 ? 'es' : ''} · ` +
    `${totalAsignado.toLocaleString()} unidades asignadas · ${totalConfirmado.toLocaleString()} confirmadas.`;

  const cont = document.getElementById('export-preview');
  if (!prendas.length) {
    cont.innerHTML = `<div class="text-center py-10 text-slate-500 text-sm">Sin resultados.</div>`;
    return;
  }

  cont.innerHTML = prendas.map(p => {
    const asigsP = asigs.filter(a => a.prenda_id === p.id);
    return `
    <div class="card p-4">
      <div class="flex items-start justify-between gap-2 mb-1">
        <h3 class="font-bold text-white text-sm">${escHtml(p.nombre)}</h3>
        ${statusBadge(p.status)}
      </div>
      <p class="text-xs text-slate-500 mb-2">📦 ${Number(p.total_unidades).toLocaleString()} unidades · ${formatDate(p.created_at)}</p>
      ${asigsP.length ? `
      <div class="space-y-1.5 mt-2">
        ${asigsP.map(a => `
          <div class="flex items-center justify-between text-xs bg-zinc-900 rounded-lg px-3 py-2 border border-zinc-800">
            <span class="text-slate-300 truncate">🧵 ${escHtml(a.confeccionista?.full_name || 'Sin confeccionista')}</span>
            <span class="text-slate-500 shrink-0 ml-2">Asig: <strong class="text-white">${a.cantidad_asignada}</strong> · Conf: <strong class="text-green-400">${a.cantidad_confirmada || 0}</strong></span>
          </div>`).join('')}
      </div>` : `<p class="text-xs text-slate-600">Sin confeccionistas asignados.</p>`}
    </div>`;
  }).join('');
}

function exportarExcel() {
  const { prendas, asigs } = getExportFiltered();
  if (!prendas.length) { showToast('No hay datos para exportar', 'error'); return; }
  if (typeof XLSX === 'undefined') { showToast('No se pudo cargar la librería de Excel', 'error'); return; }

  const fechaHoy = new Date().toISOString().slice(0, 10);

  const hojaDetalle = asigs.map(a => {
    const prenda = state.exportPrendas.find(p => p.id === a.prenda_id);
    const devols = Number(a.cantidad_devoluciones) || 0;
    const conf   = Number(a.cantidad_confirmada) || 0;
    // cantidad_confirmada ya queda neta de devoluciones — no restar de nuevo.
    const neto   = conf;
    const curva       = a.curva_tallas       || {};
    const tallasConf  = a.tallas_confirmadas || {};
    const tallasProg  = a.tallas_progreso    || {};
    const tallasStr      = TODAS_TALLAS.filter(t => curva[t]).map(t => `${t}:${curva[t]}`).join(', ');
    const tallasProgStr  = TODAS_TALLAS.filter(t => tallasProg[t]).map(t => `${t}:${tallasProg[t]}`).join(', ');
    const tallasConfStr  = TODAS_TALLAS.filter(t => tallasConf[t]).map(t => `${t}:${tallasConf[t]}`).join(', ');
    return {
      'Prenda':                  prenda?.nombre || '',
      'Confeccionista':          a.confeccionista?.full_name || '',
      'Teléfono':                a.confeccionista?.phone || '',
      'Fecha de entrega':        a.fecha_entrega ? formatDate(a.fecha_entrega) : '',
      'Curva de tallas':         tallasStr,
      'Tallas reportadas':       tallasProgStr,
      'Tallas confirmadas':      tallasConfStr,
      'Asignadas':               Number(a.cantidad_asignada) || 0,
      'En proceso':              Number(a.cantidad_confeccionada) || 0,
      'Terminadas (reportadas)': Number(a.cantidad_entregada) || 0,
      'Aceptadas por admin':     conf,
      'Devoluciones':            devols,
      'Entregado neto':          neto,
      'No confeccionadas':       Number(a.cantidad_no_confeccionadas) || 0,
      'Estado novedad':          a.no_conf_estado || 'pendiente',
      'Nota confeccionista':     a.nota_confeccionista || '',
      'Nota admin':              a.nota || '',
      'Nota confirmación':       a.confirmacion_nota || '',
      'Fecha asignación':        formatDate(a.created_at)
    };
  });

  const hojaPrendas = prendas.map(p => {
    const s = calcPrendaStats(p, state.exportAsignaciones.filter(a => a.prenda_id === p.id));
    const asigsP = state.exportAsignaciones.filter(a => a.prenda_id === p.id);
    return {
      'Prenda':                   p.nombre,
      'Descripción':              p.descripcion || '',
      'Total unidades pedido':    s.total,
      'Estado':                   p.status,
      'Fecha creación':           formatDate(p.created_at),
      '# Confeccionistas':        asigsP.length,
      'Total asignado':           s.asignadas,
      'Total confirmado':         s.confirmadas,
      'Devoluciones':             s.devoluciones,
      'Entregado neto':           s.confirmadasNetas,
      'No confeccionadas aprobadas': s.noConfAprobadas,
      'Pendientes':               s.pendientes,
      '% Avance':                 s.avance
    };
  });

  const porConf = {};
  asigs.forEach(a => {
    const nombre = a.confeccionista?.full_name || 'Sin confeccionista';
    if (!porConf[nombre]) {
      porConf[nombre] = {
        'Confeccionista': nombre, 'Teléfono': a.confeccionista?.phone || '',
        '# Prendas': new Set(), 'Total asignado': 0, 'En proceso': 0,
        'Terminadas (reportadas)': 0, 'Aceptadas por admin': 0,
        'Devoluciones': 0, 'No confeccionadas': 0
      };
    }
    const c = porConf[nombre];
    c['# Prendas'].add(a.prenda_id);
    c['Total asignado']          += Number(a.cantidad_asignada)        || 0;
    c['En proceso']              += Number(a.cantidad_confeccionada)   || 0;
    c['Terminadas (reportadas)'] += Number(a.cantidad_entregada)       || 0;
    c['Aceptadas por admin']     += Number(a.cantidad_confirmada)      || 0;
    c['Devoluciones']            += Number(a.cantidad_devoluciones)    || 0;
    c['No confeccionadas']       += Number(a.cantidad_no_confeccionadas) || 0;
  });
  const hojaConf = Object.values(porConf).map(c => {
    // "Aceptadas por admin" ya queda neta de devoluciones — no restar de nuevo.
    const neto   = c['Aceptadas por admin'];
    const avance = c['Total asignado'] > 0 ? Math.round((neto / c['Total asignado']) * 100) : 0;
    return { ...c, '# Prendas': c['# Prendas'].size, 'Entregado neto': neto, '% Avance': avance };
  });

  const hojaNovedades = asigs
    .filter(a => (Number(a.cantidad_devoluciones) > 0) || (Number(a.cantidad_no_confeccionadas) > 0) || a.nota_confeccionista || a.nota)
    .map(a => {
      const prenda = state.exportPrendas.find(p => p.id === a.prenda_id);
      return {
        'Prenda':              prenda?.nombre || '',
        'Confeccionista':      a.confeccionista?.full_name || '',
        'Devoluciones':        Number(a.cantidad_devoluciones) || 0,
        'No confeccionadas':   Number(a.cantidad_no_confeccionadas) || 0,
        'Estado novedad':      a.no_conf_estado || 'pendiente',
        'Nota confeccionista': a.nota_confeccionista || '',
        'Nota admin':          a.nota || '',
        'Fecha':               formatDate(a.created_at)
      };
    });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaDetalle),    'Asignado vs Entregado');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaPrendas),    'Prendas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaConf),       'Confeccionistas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaNovedades.length ? hojaNovedades : [{ 'Sin novedades': 'No hay novedades' }]), 'Devoluciones y novedades');

  let totAsig=0, totConf=0, totDevols=0, totNoConf=0, totAjust=0, totNeto=0;
  prendas.forEach(p => {
    const s = calcPrendaStats(p, state.exportAsignaciones.filter(a => a.prenda_id === p.id));
    totAsig   += s.asignadas; totConf   += s.confirmadas;
    totDevols += s.devoluciones; totNoConf += s.noConfAprobadas;
    totAjust  += s.totalAjustado; totNeto   += s.confirmadasNetas;
  });
  const hojaTotales = [{
    'Generado':                  formatDate(new Date().toISOString()),
    '# Prendas':                 prendas.length,
    '# Asignaciones':            asigs.length,
    'Total asignado':            totAsig,
    'Total confirmado':          totConf,
    'Total devoluciones':        totDevols,
    'No confeccionado aprobado': totNoConf,
    'Total ajustado':            totAjust,
    'Total neto':                totNeto,
    'Pendientes':                Math.max(0, totAjust - totNeto),
    '% Avance global':           totAjust > 0 ? Math.round((totNeto/totAjust)*100) : 0
  }];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaTotales), 'Totales generales');

  XLSX.writeFile(wb, `Talitha_Confeccionistas_${fechaHoy}.xlsx`);
  showToast('📊 Excel generado y descargado');
}

// ================================================================
// 20. ACTUALIZACIÓN MANUAL DEL DETALLE
// ================================================================
async function refreshDetail() {
  if (!state.currentPrenda) return;
  const btn = document.getElementById('btn-refresh');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  try {
    await loadPrendaDetail(state.currentPrenda.id, false);
    showToast('✅ Actualizado');
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}
