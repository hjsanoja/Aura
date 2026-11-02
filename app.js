// Aura Catálogo — lógica principal
// Fase 1: catálogo de solo lectura · Fase 2: modo admin (vender, deshacer, ventas, agotados)
// Fase 3: compartir el catálogo en PDF
import { getCatalog, post, generatePdf, isConfigured, MOCK } from './api.js';

export const APP_VERSION = '1.2.0';
const STORE_KEY = MOCK ? 'aura.catalog.mock.v1' : 'aura.catalog.v1';
const ADMIN_STORE_KEY = MOCK ? 'aura.admin.mock.v1' : 'aura.admin.v1';
const SESSION_KEY = MOCK ? 'aura.session.mock.v1' : 'aura.session.v1';
const GENDER_ORDER = ['Mujer', 'Hombre', 'Unisex'];
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', 'U', 'UNICA', 'ÚNICA'];
const UNDO_MS = 8000;
const OFFLINE_SELL_MSG = 'Necesitas conexión para registrar ventas';

const $ = (s, el = document) => el.querySelector(s);
const state = {
  items: [],          // items crudos (uno por talla). En admin incluye agotados.
  cards: [],          // agrupados por producto
  updated: null,      // Date del catálogo
  offline: false,     // mostrando copia guardada
  loading: false,
  q: '',
  filters: { genero: null, categoria: null, marca: null },
  admin: null,        // { user, pin } con sesión iniciada
  isAdminData: false, // los items vienen de admin_catalog (tienen stock/vendida/dup)
  showSoldOut: false,
  view: 'catalog',    // 'catalog' | 'sales'
  sales: null,
  salesLoading: false,
};

// ── Utilidades ────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const money = (n) => (Number(n) || 0).toFixed(2);
const storage = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio o modo privado */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};
const imgURL = (fileId) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w400`;

function timeAgo(date) {
  if (!date || isNaN(date)) return '';
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

function fmtDate(v) {
  const d = new Date(v);
  if (!v || isNaN(d)) return String(v ?? '');
  return d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function sizeRank(t) {
  const u = String(t).toUpperCase().trim();
  const i = SIZE_ORDER.indexOf(u);
  if (i >= 0) return i;
  const n = parseFloat(u);
  return isNaN(n) ? 500 : 100 + n;
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'c' + (h >>> 0).toString(36);
}

// ── Agrupar tallas en tarjetas ────────────────────────────────
function groupItems(items) {
  const map = new Map();
  const catOrder = new Map();
  for (const it of items) {
    if (!catOrder.has(it.categoria)) catOrder.set(it.categoria, catOrder.size);
    const k = [it.fileId, it.nombre, it.color, it.precio].join('¦');
    let c = map.get(k);
    if (!c) {
      c = {
        id: hash(k), fileId: it.fileId, nombre: it.nombre, marca: it.marca, color: it.color,
        genero: it.genero, categoria: it.categoria, precio: Number(it.precio) || 0,
        sizes: [], total: 0,
      };
      c.search = norm([it.nombre, it.marca, it.color, it.categoria, it.genero, it.codigo].join(' '));
      map.set(k, c);
    }
    const disp = Number(it.disponible) || 0;
    c.sizes.push({ key: it.key, talla: it.talla, disponible: disp, dup: !!it.dup });
    c.total += disp;
    if (it.codigo && !c.search.includes(norm(it.codigo))) c.search += ' ' + norm(it.codigo);
  }
  const g = (x) => { const i = GENDER_ORDER.indexOf(x); return i < 0 ? 9 : i; };
  const cards = [...map.values()];
  cards.forEach((c) => c.sizes.sort((a, b) => sizeRank(a.talla) - sizeRank(b.talla) || String(a.talla).localeCompare(b.talla)));
  // Orden: categoría (como aparece en el Sheet) → género → marca → nombre
  cards.sort((a, b) =>
    (catOrder.get(a.categoria) - catOrder.get(b.categoria)) ||
    (g(a.genero) - g(b.genero)) ||
    String(a.marca).localeCompare(b.marca, 'es') ||
    String(a.nombre).localeCompare(b.nombre, 'es'));
  return cards;
}

// ── Pintar catálogo ───────────────────────────────────────────
function stockTag(total) {
  if (total <= 0) return '<span class="stk none">Agotado</span>';
  if (total > 3) return `<span class="stk ok">${total} disp.</span>`;
  if (total === 1) return '<span class="stk low">Última unidad</span>';
  return `<span class="stk low">${total} disp.</span>`;
}

function sizesHTML(c, { all = false } = {}) {
  const sizes = state.admin && (state.showSoldOut || all) ? c.sizes : c.sizes.filter((s) => s.disponible > 0);
  if (!state.admin) {
    return `<div class="psizes">${sizes.map((s) =>
      `<span class="szd${s.disponible <= 1 ? ' szlow' : ''}" aria-label="Talla ${esc(s.talla)}: ${s.disponible} disponible${s.disponible === 1 ? '' : 's'}">${esc(s.talla)}: ${s.disponible}</span>`).join('')}</div>`;
  }
  const canSell = state.isAdminData;
  const rows = sizes.map((s) => {
    const out = s.disponible <= 0;
    const cls = out ? ' out' : s.disponible === 1 ? ' low' : '';
    const label = s.dup ? 'Revisar' : 'Vender';
    const disabled = !canSell || s.dup || out;
    const btn = out && !s.dup ? '' :
      `<button type="button" class="sell-btn" data-key="${esc(s.key)}" ${disabled ? 'disabled' : ''} aria-label="${esc(label)} talla ${esc(s.talla)} de ${esc(c.nombre)} ${esc(c.color)}">${label}</button>`;
    return `<li class="sr${cls}"><span class="sr-t">${esc(s.talla)}</span><span class="sr-d">${out ? 'Agotado' : `${s.disponible} disp.`}</span>${btn}</li>` +
      (s.dup ? '<li class="dup-note" role="note">Código+talla repetido: corrígelo en el Sheet</li>' : '');
  }).join('');
  return `<ul class="sell-list">${rows}</ul>`;
}

function cardHTML(c, opts = {}) {
  const g = norm(c.genero);
  const img = c.fileId
    ? `<img src="${esc(imgURL(c.fileId))}" alt="${esc(c.nombre)}, color ${esc(c.color)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  return `<article class="pc${c.total <= 0 ? ' out' : ''}" data-card="${c.id}">
  <div class="pi${c.fileId ? '' : ' noimg'}">${img}${c.genero ? `<span class="gb g-${esc(g)}">${esc(c.genero)}</span>` : ''}</div>
  <div class="pb">
    <div class="pbrand">${esc(c.marca)}</div>
    <h3 class="pname">${esc(c.nombre)}</h3>
    <div class="pmeta">${esc(c.color)}</div>
    ${sizesHTML(c, opts)}
    <div class="pfoot"><div class="pp" aria-label="Precio ${money(c.precio)} dólares"><small>$</small>${money(c.precio)}</div>${stockTag(c.total)}</div>
  </div>
</article>`;
}

function visibleCards() {
  const { q, filters: f } = state;
  const terms = norm(q).split(/\s+/).filter(Boolean);
  return state.cards.filter((c) =>
    (c.total > 0 || (state.admin && state.showSoldOut)) &&
    (!f.genero || c.genero === f.genero) &&
    (!f.categoria || c.categoria === f.categoria) &&
    (!f.marca || c.marca === f.marca) &&
    terms.every((t) => c.search.includes(t)));
}

function renderStats() {
  const cards = state.cards.filter((c) => c.total > 0);
  $('#stModels').textContent = cards.length;
  $('#stUnits').textContent = cards.reduce((n, c) => n + c.total, 0);
  $('#stBrands').textContent = new Set(cards.map((c) => c.marca).filter(Boolean)).size;
}

function renderFilters() {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const pool = state.cards.filter((c) => c.total > 0 || (state.admin && state.showSoldOut));
  const generos = uniq(pool.map((c) => c.genero)).sort((a, b) => {
    const ia = GENDER_ORDER.indexOf(a), ib = GENDER_ORDER.indexOf(b);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });
  const categorias = uniq(pool.map((c) => c.categoria));
  const marcas = uniq(pool.map((c) => c.marca)).sort((a, b) => a.localeCompare(b, 'es'));
  const row = (field, label, values) => {
    if (values.length < 2) return '';
    const cur = state.filters[field];
    const chip = (v, text) => `<button type="button" class="chip" data-field="${field}" data-value="${esc(v)}" aria-pressed="${cur === v || (!cur && v === '') ? 'true' : 'false'}">${esc(text)}</button>`;
    return `<div class="frow" role="group" aria-label="${label}"><span class="flabel" aria-hidden="true">${label}</span>${chip('', 'Todos')}${values.map((v) => chip(v, v)).join('')}</div>`;
  };
  $('#filters').innerHTML = row('genero', 'Género', generos) + row('categoria', 'Categoría', categorias) + row('marca', 'Marca', marcas);
}

function renderGrid() {
  if (state.view !== 'catalog') return;
  const main = $('#content');
  const cards = visibleCards();
  const anyVisible = state.cards.some((c) => c.total > 0 || (state.admin && state.showSoldOut));
  $('#count').textContent = anyVisible ? `${cards.length} ${cards.length === 1 ? 'modelo' : 'modelos'}` : '';
  if (!anyVisible) {
    main.innerHTML = `<div class="state"><h2>Sin productos disponibles</h2><p>Ahora mismo no hay productos con unidades disponibles en el catálogo.</p><div class="state-actions"><button class="btn" type="button" data-act="refresh">Actualizar</button></div></div>`;
    return;
  }
  if (!cards.length) {
    main.innerHTML = `<div class="state"><h2>Nada por aquí</h2><p>No hay productos que coincidan con tu búsqueda o filtros.</p><div class="state-actions"><button class="btn" type="button" data-act="clear-filters">Limpiar filtros</button></div></div>`;
    return;
  }
  const sections = [];
  let cur = null;
  for (const c of cards) {
    if (!cur || cur.cat !== c.categoria) { cur = { cat: c.categoria, cards: [] }; sections.push(cur); }
    cur.cards.push(c);
  }
  main.innerHTML = sections.map((s) => {
    const n = s.cards.length;
    const gens = [...new Set(s.cards.map((c) => c.genero).filter(Boolean))].join(' · ');
    return `<section class="section" aria-label="${esc(s.cat)}">
  <h2 class="sh">${esc(s.cat || 'Otros')} <span class="shs">${esc(gens)}${gens ? ' · ' : ''}${n} ${n === 1 ? 'modelo' : 'modelos'}</span></h2>
  <div class="grid">${s.cards.map((c) => cardHTML(c)).join('')}</div>
</section>`;
  }).join('');
}

function renderUpdated() {
  $('#updated').textContent = state.updated ? `Actualizado ${timeAgo(state.updated)}` : '';
  const banner = $('#banner');
  const offlineNow = state.offline || (state.admin && !navigator.onLine);
  if (offlineNow) {
    const parts = [];
    if (state.offline) parts.push(`Sin conexión · mostrando copia de ${timeAgo(state.savedAt || state.updated)}`);
    else parts.push('Sin conexión');
    if (state.admin) parts.push(OFFLINE_SELL_MSG);
    banner.textContent = parts.join(' · ');
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function renderAll() {
  renderStats();
  renderFilters();
  renderGrid();
  renderUpdated();
}

function renderSkeleton() {
  const card = `<div class="pc sk" aria-hidden="true"><div class="pi"></div><div class="pb"><div class="sk-line" style="width:40%"></div><div class="sk-line" style="width:90%"></div><div class="sk-line" style="width:60%"></div><div class="sk-line" style="width:35%;height:20px;margin-top:8px"></div></div></div>`;
  $('#content').innerHTML = `<div aria-busy="true" aria-label="Cargando catálogo"><div class="sk-line sk-title"></div><div class="grid">${card.repeat(6)}</div></div>`;
  $('#count').textContent = 'Cargando…';
}

function renderError(err) {
  $('#count').textContent = '';
  $('#content').innerHTML = `<div class="state" role="alert"><h2>No se pudo cargar</h2><p>${esc(err.message)}${err.network ? ' Revisa tu conexión a internet e inténtalo de nuevo.' : ''}</p><div class="state-actions"><button class="btn" type="button" data-act="refresh">Reintentar</button></div></div>`;
}

function renderNotConfigured() {
  $('#count').textContent = '';
  ['#stModels', '#stUnits', '#stBrands'].forEach((s) => { $(s).textContent = '–'; });
  $('#content').innerHTML = `<div class="state"><h2>Falta conectar tu Sheet</h2>
<p>La app todavía no sabe dónde está tu catálogo. Solo hay que hacerlo una vez:</p>
<ol>
  <li>En tu Google Sheet: <b>Extensiones → Apps Script → Implementar</b> y copia la URL que termina en <code>/exec</code>.</li>
  <li>En GitHub, abre el archivo <code>config.js</code>, toca el lápiz ✏️ y pega la URL entre las comillas.</li>
  <li>Guarda con <b>Commit changes</b> y espera 1–2 minutos.</li>
</ol>
<div class="state-actions"><a class="btn" href="./?mock=1">Ver demo con datos de ejemplo</a></div></div>`;
}

// ── Carga de datos ────────────────────────────────────────────
function applyData(data, { offline = false, savedAt = null, admin = false } = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  state.isAdminData = admin;
  state.items = admin ? items.map((i) => ({ ...i })) : items.filter((i) => Number(i.disponible) > 0);
  state.cards = groupItems(state.items);
  // En la demo la fecha del JSON es fija: usamos la hora en que se descargó.
  state.updated = MOCK ? new Date(savedAt || Date.now()) : new Date(data.updated || savedAt || Date.now());
  state.offline = offline;
  state.savedAt = savedAt ? new Date(savedAt) : null;
  // Si un filtro ya no existe (p. ej. se agotó la marca), lo quitamos.
  for (const f of Object.keys(state.filters)) {
    if (state.filters[f] && !state.cards.some((c) => c[f] === state.filters[f])) state.filters[f] = null;
  }
  renderAll();
}

function saveAdminCache() {
  if (!state.isAdminData) return;
  storage.set(ADMIN_STORE_KEY, { savedAt: new Date().toISOString(), data: { ok: true, updated: state.updated?.toISOString(), items: state.items } });
}

function setRefreshing(on) {
  const btn = $('#refreshBtn');
  btn.classList.toggle('spin', on);
  btn.disabled = on;
}

async function load({ user = false } = {}) {
  if (!isConfigured()) { renderNotConfigured(); return; }
  if (state.loading) return;
  state.loading = true;
  setRefreshing(true);
  if (!state.cards.length && state.view === 'catalog') renderSkeleton();
  const asAdmin = !!state.admin;
  try {
    let data;
    if (asAdmin) {
      data = await post('admin_catalog', { pin: state.admin.pin });
      if (data.user && state.admin) { state.admin.user = data.user; renderSession(); }
    } else {
      data = await getCatalog();
    }
    if (asAdmin !== !!state.admin) return; // la sesión cambió mientras cargaba
    storage.set(asAdmin ? ADMIN_STORE_KEY : STORE_KEY, { savedAt: new Date().toISOString(), data });
    applyData(data, { admin: asAdmin });
    if (user) toast('Catálogo actualizado');
  } catch (err) {
    if (asAdmin !== !!state.admin) return;
    if (asAdmin && !err.network) {
      // PIN cambiado, bloqueo por intentos, etc.: cerramos la sesión de admin.
      logout({ silent: true });
      toast(err.message, { error: true, duration: 7000 });
      return;
    }
    const saved = (asAdmin && storage.get(ADMIN_STORE_KEY)) || storage.get(STORE_KEY);
    if (err.network && saved && saved.data) {
      // Sin conexión nunca se puede vender: mostramos la copia con "Vender" deshabilitado.
      applyData(saved.data, { offline: true, savedAt: saved.savedAt, admin: false });
      if (user) toast('Sin conexión: se muestra la última copia guardada', { error: true });
    } else if (state.cards.length) {
      toast(err.message, { error: true });
    } else {
      renderError(err);
    }
  } finally {
    state.loading = false;
    setRefreshing(false);
  }
}

// ── Avisos ────────────────────────────────────────────────────
export function toast(msg, { error = false, action = null, duration = 4000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' err' : '');
  el.setAttribute('role', error ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.remove(); action.onClick(); });
    el.append(b);
  }
  $('#toasts').append(el);
  if (duration) setTimeout(() => el.remove(), duration);
  return el;
}

// ── Hojas (diálogos) ──────────────────────────────────────────
function openSheet(d) {
  if (!d.open) d.showModal();
}
function closeSheet(d) {
  if (d.open) d.close();
}
function wireSheet(d) {
  d.addEventListener('click', (e) => {
    if (e.target === d && !d.dataset.busy) closeSheet(d); // toque fuera
    if (e.target.closest('[data-close]') && !d.dataset.busy) closeSheet(d);
  });
  d.addEventListener('cancel', (e) => { if (d.dataset.busy) e.preventDefault(); });
}
function setBusy(d, btn, busy, label) {
  if (busy) { d.dataset.busy = '1'; btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; }
  else { delete d.dataset.busy; btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}
function showFormError(el, msg) {
  el.textContent = msg || '';
  el.hidden = !msg;
}

function confirmSheet({ title, text, ok }) {
  const d = $('#confirmSheet');
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = ok;
  openSheet(d);
  return new Promise((resolve) => {
    const done = (v) => { d.removeEventListener('close', onClose); $('#confirmOk').onclick = null; resolve(v); };
    const onClose = () => done(false);
    d.addEventListener('close', onClose);
    $('#confirmOk').onclick = () => { d.removeEventListener('close', onClose); closeSheet(d); done(true); };
  });
}

// ── Sesión de administrador ───────────────────────────────────
function renderSession() {
  const a = state.admin;
  document.body.classList.toggle('admin', !!a);
  $('#lockBtn').hidden = !!a;
  $('#hello').hidden = !a;
  $('#logoutBtn').hidden = !a;
  $('#adminbar').hidden = !a;
  if (a) $('#hello').textContent = `Hola, ${a.user || 'admin'}`;
  if (!a) setView('catalog');
}

async function login(e) {
  e.preventDefault();
  const d = $('#loginSheet');
  const pin = $('#pin').value.trim();
  const err = $('#loginError');
  if (!pin) { showFormError(err, 'Escribe tu PIN.'); $('#pin').focus(); return; }
  if (!isConfigured()) { showFormError(err, 'Primero conecta tu Sheet en config.js.'); return; }
  if (!navigator.onLine) { showFormError(err, 'Necesitas conexión para entrar al modo administrador.'); return; }
  showFormError(err, '');
  const btn = $('#loginSubmit');
  setBusy(d, btn, true, 'Entrando…');
  try {
    const res = await post('login', { pin });
    state.admin = { user: res.user, pin };
    if ($('#remember').checked) storage.set(SESSION_KEY, { user: res.user, pin });
    else storage.del(SESSION_KEY);
    setBusy(d, btn, false);
    closeSheet(d);
    $('#pin').value = '';
    renderSession();
    toast(`Hola, ${res.user}. Ya puedes registrar ventas.`);
    await load();
  } catch (ex) {
    setBusy(d, btn, false);
    showFormError(err, ex.network ? 'No hay conexión con el servidor. Inténtalo de nuevo.' : ex.message);
    $('#pin').select();
  }
}

function logout({ silent = false } = {}) {
  state.admin = null;
  state.sales = null;
  pdf.result = null;
  pdf.error = null;
  closeSheet($('#pdfSheet'));
  state.showSoldOut = false;
  $('#soldOut').checked = false;
  storage.del(SESSION_KEY);
  storage.del(ADMIN_STORE_KEY);
  renderSession();
  // Volvemos al catálogo público (sin datos de stock/vendidas).
  const saved = storage.get(STORE_KEY);
  if (saved && saved.data) applyData(saved.data, { savedAt: saved.savedAt });
  else { state.items = []; state.cards = []; }
  load();
  if (!silent) toast('Sesión cerrada');
}

// ── Vender ────────────────────────────────────────────────────
let selling = null; // { item, card }

function findItem(key) {
  return state.items.find((i) => i.key === key && !i.dup) || state.items.find((i) => i.key === key);
}

function openSell(key) {
  if (!state.admin) return;
  if (!navigator.onLine || !state.isAdminData) { toast(OFFLINE_SELL_MSG, { error: true }); return; }
  const item = findItem(key);
  if (!item) return;
  if (item.dup) { toast('Código+talla repetido: corrígelo en el Sheet', { error: true }); return; }
  if (Number(item.disponible) <= 0) { toast('Ya no quedan unidades de esta talla.', { error: true }); return; }
  selling = { key };
  const img = item.fileId ? `<img src="${esc(imgURL(item.fileId))}" alt="" referrerpolicy="no-referrer">` : '<div class="ph"></div>';
  $('#sellProduct').innerHTML = `${img}<div><b>${esc(item.nombre)}</b><span>${esc(item.color)} · Talla <strong>${esc(item.talla)}</strong></span><span>${item.disponible} disponible${item.disponible == 1 ? '' : 's'} · Lista: $${money(item.precio)}</span></div>`;
  $('#sellPrice').value = money(item.precio);
  $('#sellNote').value = '';
  showFormError($('#sellError'), '');
  openSheet($('#sellSheet'));
}

async function confirmSell(e) {
  e.preventDefault();
  const d = $('#sellSheet');
  if (d.dataset.busy || !selling) return; // evita doble envío
  const err = $('#sellError');
  const raw = $('#sellPrice').value.trim().replace(/\s/g, '').replace(',', '.');
  const precio = Number(raw);
  if (!raw || !isFinite(precio) || precio < 0) { showFormError(err, 'Escribe un precio válido (por ejemplo 19 o 19.50).'); $('#sellPrice').focus(); return; }
  if (!navigator.onLine) { showFormError(err, OFFLINE_SELL_MSG + '.'); return; }
  showFormError(err, '');
  const btn = $('#sellSubmit');
  setBusy(d, btn, true, 'Registrando…');
  const nota = $('#sellNote').value.trim();
  const { key } = selling;
  try {
    const res = await post('sell', { pin: state.admin.pin, key, precio: Math.round(precio * 100) / 100, ...(nota ? { nota } : {}) });
    setBusy(d, btn, false);
    closeSheet(d);
    selling = null;
    if (res.item) updateItem(res.item);
    state.sales = null; // la lista de ventas cambió
    const it = res.item || findItem(key) || {};
    toast(`Venta registrada: ${it.nombre || ''} · talla ${it.talla || ''}`, {
      duration: UNDO_MS,
      action: { label: 'Deshacer', onClick: () => undoSale(res.saleId) },
    });
  } catch (ex) {
    setBusy(d, btn, false);
    showFormError(err, ex.network ? `${OFFLINE_SELL_MSG}. No se registró la venta.` : ex.message);
  }
}

async function undoSale(saleId, { fromList = false } = {}) {
  if (!saleId || !state.admin) return false;
  if (!navigator.onLine) { toast(OFFLINE_SELL_MSG, { error: true }); return false; }
  try {
    const res = await post('undo', { pin: state.admin.pin, saleId });
    if (res.item) updateItem(res.item);
    if (state.sales) {
      const s = state.sales.find((x) => x.id === saleId);
      if (s) s.estado = 'Anulada';
    }
    if (!fromList && state.view === 'sales') renderSales();
    toast('Venta anulada. La unidad volvió al stock.');
    return true;
  } catch (ex) {
    toast(ex.network ? `${OFFLINE_SELL_MSG}. No se anuló la venta.` : ex.message, { error: true, duration: 6000 });
    return false;
  }
}

/** Actualiza una talla con el item que devuelve el servidor, sin recargar todo. */
function updateItem(item) {
  const i = state.items.findIndex((x) => x.key === item.key && !x.dup);
  if (i >= 0) state.items[i] = { ...state.items[i], ...item };
  else state.items.push(item);
  state.cards = groupItems(state.items);
  saveAdminCache();
  renderStats();
  const card = state.cards.find((c) => c.sizes.some((s) => s.key === item.key));
  const el = card && document.querySelector(`[data-card="${card.id}"]`);
  if (el && state.view === 'catalog') {
    el.outerHTML = cardHTML(card, { all: true });
  } else {
    renderGrid();
  }
}

// ── Ventas ────────────────────────────────────────────────────
function setView(v) {
  state.view = v;
  $('#tabCatalog').setAttribute('aria-selected', String(v === 'catalog'));
  $('#tabSales').setAttribute('aria-selected', String(v === 'sales'));
  const isCat = v === 'catalog';
  $('.searchbar').hidden = !isCat;
  $('#filters').hidden = !isCat;
  $('.meta').hidden = !isCat;
  $('#soldOutWrap').hidden = !isCat;
  if (isCat) renderGrid();
  else loadSales();
}

async function loadSales({ force = false } = {}) {
  if (!state.admin) return;
  if (state.sales && !force) { renderSales(); return; }
  if (!navigator.onLine) {
    $('#content').innerHTML = `<div class="state" role="alert"><h2>Sin conexión</h2><p>Necesitas conexión para ver las ventas.</p><div class="state-actions"><button class="btn" type="button" data-act="reload-sales">Reintentar</button></div></div>`;
    return;
  }
  if (state.salesLoading) return;
  state.salesLoading = true;
  $('#content').innerHTML = `<div aria-busy="true" aria-label="Cargando ventas"><div class="sk-line sk-title"></div>${'<div class="sk-line" style="height:72px;border-radius:12px;margin-bottom:10px"></div>'.repeat(4)}</div>`;
  try {
    const res = await post('sales', { pin: state.admin.pin, limit: 40 });
    state.sales = Array.isArray(res.sales) ? res.sales : [];
    if (state.view === 'sales') renderSales();
  } catch (ex) {
    if (state.view === 'sales') {
      $('#content').innerHTML = `<div class="state" role="alert"><h2>No se pudieron cargar las ventas</h2><p>${esc(ex.network ? 'No hay conexión con el servidor.' : ex.message)}</p><div class="state-actions"><button class="btn" type="button" data-act="reload-sales">Reintentar</button></div></div>`;
    }
  } finally {
    state.salesLoading = false;
  }
}

const isActive = (s) => norm(s.estado) === 'activa';

function renderSales() {
  if (state.view !== 'sales') return;
  const sales = state.sales || [];
  const active = sales.filter(isActive);
  const total = active.reduce((n, s) => n + (Number(s.precioCobrado) || 0), 0);
  const head = `<div class="sales-head"><h2>Últimas ventas</h2>
  <span class="sales-sum">${active.length} activa${active.length === 1 ? '' : 's'} · <b>$${money(total)}</b> cobrado
  <button class="refresh" type="button" data-act="reload-sales" aria-label="Actualizar ventas" style="display:inline-grid;vertical-align:middle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button></span></div>`;
  if (!sales.length) {
    $('#content').innerHTML = head + '<div class="state"><h2>Aún no hay ventas</h2><p>Cuando registres una venta desde el catálogo aparecerá aquí.</p></div>';
    return;
  }
  $('#content').innerHTML = head + `<ul class="sales">${sales.map((s) => {
    const act = isActive(s);
    const diff = Number(s.precioCatalogo) !== Number(s.precioCobrado) && s.precioCatalogo !== undefined && s.precioCatalogo !== '';
    return `<li class="sale${act ? '' : ' void'}">
  <div class="sale-main">
    <b>${esc(s.producto)}</b>
    <span class="l">Talla ${esc(s.talla)}${diff ? ` · lista $${money(s.precioCatalogo)}` : ''}</span>
    <span class="l">${esc(fmtDate(s.fecha))}${s.vendio ? ` · ${esc(s.vendio)}` : ''}</span>
    ${s.nota ? `<span class="l n">“${esc(s.nota)}”</span>` : ''}
  </div>
  <div class="sale-side">
    <span class="sale-price">$${money(s.precioCobrado)}</span>
    <span class="badge">${esc(s.estado || '')}</span>
    ${act ? `<button type="button" class="void-btn" data-void="${esc(s.id)}">Anular</button>` : ''}
  </div>
</li>`;
  }).join('')}</ul>`;
}

async function voidSale(id, btn) {
  const s = (state.sales || []).find((x) => x.id === id);
  if (!s) return;
  const ok = await confirmSheet({
    title: '¿Anular esta venta?',
    text: `${s.producto} · talla ${s.talla} · $${money(s.precioCobrado)}. La unidad volverá al stock.`,
    ok: 'Anular venta',
  });
  if (!ok) return;
  btn.disabled = true;
  btn.textContent = 'Anulando…';
  const done = await undoSale(id, { fromList: true });
  if (!done) { btn.disabled = false; btn.textContent = 'Anular'; return; }
  renderSales();
}

// ── Compartir PDF ─────────────────────────────────────────────
const pdf = { busy: false, result: null, at: null, error: null, started: 0, timer: null };
const PDF_SHARE_TEXT = 'Catálogo Aura actualizado';

function safeURL(u) {
  try {
    const x = new URL(u, location.href);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
  } catch { return ''; }
}

function pdfView(which) {
  ['#pdfWorking', '#pdfDone', '#pdfFail'].forEach((s) => { $(s).hidden = s !== which; });
}

function setPdfStatus(msg, error = false) {
  const el = $('#pdfStatus');
  el.textContent = msg;
  el.classList.toggle('err', error);
}

function renderPdfSheet() {
  if (pdf.busy) {
    pdfView('#pdfWorking');
    $('#pdfClose').textContent = 'Cerrar (sigue generando)';
    tickPdf();
    return;
  }
  $('#pdfClose').textContent = 'Cerrar';
  if (pdf.error) {
    $('#pdfError').textContent = pdf.error;
    pdfView('#pdfFail');
    return;
  }
  if (!pdf.result) return;
  const r = pdf.result;
  const n = (v, one, many) => (v === undefined || v === null || v === '' ? '' : `${v} ${Number(v) === 1 ? one : many}`);
  $('#pdfName').textContent = r.name || 'Catálogo Aura.pdf';
  $('#pdfMeta').textContent = [n(r.pages, 'página', 'páginas'), n(r.models, 'modelo', 'modelos'), n(r.units, 'unidad', 'unidades'), `generado ${timeAgo(pdf.at)}`].filter(Boolean).join(' · ');
  $('#pdfOpen').href = r.url;
  $('#pdfDownload').href = r.download || r.url;
  $('#pdfShare').hidden = typeof navigator.share !== 'function';
  setPdfStatus('');
  pdfView('#pdfDone');
}

function tickPdf() {
  const secs = Math.round((Date.now() - pdf.started) / 1000);
  $('#pdfElapsed').textContent = secs > 0 ? `Llevamos ${secs} s` : '';
  // Barra orientativa: llega al 95 % en ~60 s y espera ahí.
  $('#pdfWorking .pdf-bar span').style.width = `${Math.min(95, (secs / 60) * 95)}%`;
}

function setPdfButton(busy) {
  const b = $('#pdfBtn');
  b.setAttribute('aria-busy', String(busy));
  $('#pdfBtnText').textContent = busy ? 'Generando PDF…' : 'Compartir PDF';
}

function openPdf() {
  if (!state.admin) return;
  if (pdf.busy || pdf.result || pdf.error) {
    renderPdfSheet();
    openSheet($('#pdfSheet'));
    return;
  }
  startPdf();
}

async function startPdf() {
  if (pdf.busy || !state.admin) return; // evita doble clic mientras genera
  const sheet = $('#pdfSheet');
  pdf.result = null;
  pdf.error = null;
  if (!navigator.onLine) {
    pdf.error = 'Necesitas conexión para generar el PDF.';
    renderPdfSheet();
    openSheet(sheet);
    return;
  }
  pdf.busy = true;
  pdf.started = Date.now();
  setPdfButton(true);
  renderPdfSheet();
  openSheet(sheet);
  pdf.timer = setInterval(tickPdf, 1000);
  const pin = state.admin.pin;
  try {
    const res = await generatePdf(pin);
    const url = safeURL(res.url);
    if (!url) throw new Error('El servidor no devolvió el enlace del PDF.');
    pdf.result = { ...res, url, download: safeURL(res.download) || url };
    pdf.at = new Date();
  } catch (ex) {
    pdf.error = ex.timeout
      ? 'El PDF tardó más de 90 segundos y dejé de esperar. Inténtalo de nuevo en un momento.'
      : ex.network ? 'No hay conexión con el servidor. Inténtalo de nuevo.' : ex.message;
  } finally {
    pdf.busy = false;
    clearInterval(pdf.timer);
    setPdfButton(false);
  }
  if (!state.admin) { pdf.result = null; pdf.error = null; return; } // cerró sesión mientras tanto
  if (sheet.open) {
    renderPdfSheet();
    if (pdf.result) ($('#pdfShare').hidden ? $('#pdfOpen') : $('#pdfShare')).focus();
  } else if (pdf.result) {
    toast('Tu catálogo PDF está listo', { duration: 12000, action: { label: 'Ver', onClick: openPdf } });
  } else {
    toast(pdf.error, { error: true, duration: 8000, action: { label: 'Ver', onClick: openPdf } });
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    ta.style.cssText = 'position:fixed;opacity:0';
    $('#pdfSheet').append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* nada */ }
    ta.remove();
    return ok;
  }
}

async function copyPdfLink() {
  if (!pdf.result) return;
  const ok = await copyText(pdf.result.url);
  setPdfStatus(ok ? 'Enlace copiado' : 'No se pudo copiar. Mantén presionado «Abrir PDF» para copiar el enlace.', !ok);
}

async function sharePdf() {
  const r = pdf.result;
  if (!r) return;
  try {
    await navigator.share({ title: r.name || 'Catálogo Aura', text: PDF_SHARE_TEXT, url: r.url });
    setPdfStatus('¡Compartido!');
  } catch (ex) {
    if (ex && ex.name === 'AbortError') return; // la persona cerró el menú de compartir
    const ok = await copyText(r.url);
    setPdfStatus(ok ? 'No se pudo abrir el menú de compartir: copié el enlace para que lo pegues.' : 'No se pudo compartir. Usa «Abrir PDF».', !ok);
  }
}

// ── Service worker y actualizaciones de la app ────────────────
let swReg = null;
function promptReload(worker) {
  toast('Hay una nueva versión de la app', {
    duration: 0,
    action: { label: 'Actualizar', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
  });
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (e) {
    console.warn('No se pudo registrar el service worker', e);
    return;
  }
  if (swReg.waiting && navigator.serviceWorker.controller) promptReload(swReg.waiting);
  swReg.addEventListener('updatefound', () => {
    const w = swReg.installing;
    w && w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) promptReload(w);
    });
  });
  // Solo recargamos cuando una versión nueva reemplaza a otra (no en la primera visita).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}

async function checkForUpdate() {
  if (!swReg) { toast('Las actualizaciones no están disponibles en este navegador'); return; }
  if (!navigator.onLine) { toast('Necesitas conexión para buscar actualizaciones', { error: true }); return; }
  toast('Buscando actualización…', { duration: 1500 });
  try {
    await swReg.update();
    const w = swReg.installing || swReg.waiting;
    if (!w) toast('Ya tienes la última versión');
    else if (w.state === 'installed') promptReload(w);
  } catch {
    toast('No se pudo comprobar la actualización', { error: true });
  }
}

// Botón "Instalar app" (Android/Chrome)
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  $('#installItem').hidden = false;
});

// ── Eventos ───────────────────────────────────────────────────
function bind() {
  const q = $('#q');
  let t;
  q.addEventListener('input', () => {
    $('#qClear').hidden = !q.value;
    clearTimeout(t);
    t = setTimeout(() => { state.q = q.value; renderGrid(); }, 120);
  });
  $('#qClear').addEventListener('click', () => { q.value = ''; state.q = ''; $('#qClear').hidden = true; renderGrid(); q.focus(); });

  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const { field, value } = b.dataset;
    state.filters[field] = value && state.filters[field] !== value ? value : null;
    renderFilters();
    renderGrid();
  });

  $('#refreshBtn').addEventListener('click', () => load({ user: true }));
  $('#content').addEventListener('click', (e) => {
    const sell = e.target.closest('.sell-btn');
    if (sell && !sell.disabled) { openSell(sell.dataset.key); return; }
    const v = e.target.closest('[data-void]');
    if (v && !v.disabled) { voidSale(v.dataset.void, v); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'refresh') load({ user: true });
    if (act === 'reload-sales') loadSales({ force: true });
    if (act === 'clear-filters') {
      state.filters = { genero: null, categoria: null, marca: null };
      state.q = ''; q.value = ''; $('#qClear').hidden = true;
      renderFilters(); renderGrid();
    }
  });

  // Foto que no carga → marcador "AURA". (los errores de <img> no burbujean: usamos captura)
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    if (img.parentElement.classList.contains('pi')) img.parentElement.classList.add('noimg');
    else if (img.closest('.sell-product')) img.replaceWith(Object.assign(document.createElement('div'), { className: 'ph' }));
  }, true);

  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', () => openSheet(menu));
  menu.addEventListener('click', async (e) => {
    if (e.target === menu) { menu.close(); return; } // toque fuera
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    menu.close();
    if (act === 'refresh') { state.view === 'sales' ? loadSales({ force: true }) : load({ user: true }); }
    if (act === 'update') checkForUpdate();
    if (act === 'install' && installEvt) {
      installEvt.prompt();
      await installEvt.userChoice;
      installEvt = null;
      $('#installItem').hidden = true;
    }
  });
  $('#versionNote').textContent = `Aura Catálogo · versión ${APP_VERSION}${MOCK ? ' · modo demo (PIN 1234)' : ''}`;

  // Admin
  ['#loginSheet', '#sellSheet', '#confirmSheet', '#pdfSheet'].forEach((s) => wireSheet($(s)));
  $('#pdfBtn').addEventListener('click', openPdf);
  $('#pdfRetry').addEventListener('click', startPdf);
  $('#pdfRegen').addEventListener('click', startPdf);
  $('#pdfCopy').addEventListener('click', copyPdfLink);
  $('#pdfShare').addEventListener('click', sharePdf);
  $('#lockBtn').addEventListener('click', () => {
    showFormError($('#loginError'), '');
    $('#pin').value = '';
    openSheet($('#loginSheet'));
    $('#pin').focus();
  });
  $('#loginForm').addEventListener('submit', login);
  $('#logoutBtn').addEventListener('click', () => logout());
  $('#sellForm').addEventListener('submit', confirmSell);
  $('#sellSheet').addEventListener('close', () => { if (!$('#sellSheet').dataset.busy) selling = null; });
  $('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b && b.dataset.view !== state.view) setView(b.dataset.view);
  });
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = state.view === 'catalog' ? 'sales' : 'catalog';
    setView(next);
    $(next === 'catalog' ? '#tabCatalog' : '#tabSales').focus();
  });
  $('#soldOut').addEventListener('change', (e) => {
    state.showSoldOut = e.target.checked;
    renderFilters();
    renderGrid();
  });

  // Buscador fijo: añade borde cuando se pega arriba
  const sb = $('.searchbar');
  const sentinel = document.createElement('div');
  sb.before(sentinel);
  new IntersectionObserver(([en]) => sb.classList.toggle('stuck', !en.isIntersecting)).observe(sentinel);

  window.addEventListener('online', () => { renderUpdated(); if (state.offline || (state.admin && !state.isAdminData)) load(); });
  window.addEventListener('offline', renderUpdated);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.updated && Date.now() - state.updated > 5 * 60e3) load();
  });
  setInterval(renderUpdated, 30e3);
}

// ── Inicio ────────────────────────────────────────────────────
$('#demoBadge').hidden = !MOCK;
bind();
const session = isConfigured() && storage.get(SESSION_KEY);
if (session && session.pin) {
  state.admin = { user: session.user, pin: session.pin };
  $('#remember').checked = true;
}
renderSession();
// Muestra al instante la última copia guardada mientras llega la nueva
const saved = storage.get(STORE_KEY);
if (saved && saved.data && isConfigured()) applyData(saved.data, { savedAt: saved.savedAt });
load();
registerSW();
