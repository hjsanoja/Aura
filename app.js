// Aura Catálogo — lógica principal
// Catálogo de solo lectura · modo admin (vender por cantidad, deshacer, ventas, agotados) · compartir PDF
import { getCatalog, post, generatePdf, isConfigured, MOCK } from './api.js';

export const APP_VERSION = '1.3.0';
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
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const storage = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio o modo privado */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};
const imgURL = (fileId) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w400`;
const ICON_BAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';

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

function dayKey(v) {
  const d = new Date(v);
  return isNaN(d) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(v) {
  const d = new Date(v);
  if (isNaN(d)) return 'Sin fecha';
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Hoy';
  if (dayKey(d) === dayKey(yest)) return 'Ayer';
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' });
}
function fmtTime(v) {
  const d = new Date(v);
  return isNaN(d) ? String(v ?? '') : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
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

// ── Filtros ───────────────────────────────────────────────────
const inPool = (c) => c.total > 0 || (state.admin && state.showSoldOut);

function matches(c, { except = null } = {}) {
  const f = state.filters;
  const terms = norm(state.q).split(/\s+/).filter(Boolean);
  return inPool(c) &&
    (except === 'genero' || !f.genero || c.genero === f.genero) &&
    (except === 'categoria' || !f.categoria || c.categoria === f.categoria) &&
    (except === 'marca' || !f.marca || c.marca === f.marca) &&
    terms.every((t) => c.search.includes(t));
}
const visibleCards = () => state.cards.filter((c) => matches(c));

/** Filtros del panel (género, marca, agotados): los que cuentan para el globo del botón. */
function sheetFilterCount() {
  return (state.filters.genero ? 1 : 0) + (state.filters.marca ? 1 : 0) + (state.admin && state.showSoldOut ? 1 : 0);
}
const anyFilter = () => !!(state.q.trim() || state.filters.categoria || sheetFilterCount());

function chipHTML(field, value, text, count) {
  const cur = state.filters[field];
  const on = value ? cur === value : !cur;
  return `<button type="button" class="chip" data-field="${field}" data-value="${esc(value)}" aria-pressed="${on}">${esc(text)}${count !== undefined ? `<span class="n">${count}</span>` : ''}</button>`;
}

function renderCats() {
  const pool = state.cards.filter((c) => matches(c, { except: 'categoria' }));
  const cats = [...new Set(state.cards.filter(inPool).map((c) => c.categoria).filter(Boolean))];
  const nav = $('#cats');
  nav.hidden = cats.length < 2;
  nav.innerHTML = chipHTML('categoria', '', 'Todo', pool.length) +
    cats.map((cat) => chipHTML('categoria', cat, cat, pool.filter((c) => c.categoria === cat).length)).join('');
}

function renderFilterSheet() {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const pool = state.cards.filter(inPool);
  const generos = uniq(pool.map((c) => c.genero)).sort((a, b) => {
    const ia = GENDER_ORDER.indexOf(a), ib = GENDER_ORDER.indexOf(b);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });
  const marcas = uniq(pool.map((c) => c.marca)).sort((a, b) => a.localeCompare(b, 'es'));
  const group = (field, title, values, all) => {
    if (values.length < 2) return '';
    const base = state.cards.filter((c) => matches(c, { except: field }));
    return `<div class="fgroup" role="group" aria-label="${title}"><h3>${title}</h3><div class="chips">${chipHTML(field, '', all)}${values.map((v) => chipHTML(field, v, v, base.filter((c) => c[field] === v).length)).join('')}</div></div>`;
  };
  $('#filterBody').innerHTML = group('genero', 'Género', generos, 'Todos') + group('marca', 'Marca', marcas, 'Todas');
  $('#soldOutWrap').hidden = !state.admin;
  $('#soldOut').checked = state.showSoldOut;
  const n = visibleCards().length;
  $('#filterApply').textContent = `Ver ${plural(n, 'modelo', 'modelos')}`;
}

function renderFilterBadge() {
  const n = sheetFilterCount();
  const badge = $('#filterBadge');
  badge.hidden = !n;
  badge.textContent = n;
  $('#filterBtn').classList.toggle('on', !!n);
  $('#filterBtn').setAttribute('aria-label', n ? `Filtros (${n} activo${n === 1 ? '' : 's'})` : 'Filtros');
  $('#clearAll').hidden = !anyFilter();
}

function clearFilters() {
  state.filters = { genero: null, categoria: null, marca: null };
  state.q = '';
  $('#q').value = '';
  $('#qClear').hidden = true;
  if (state.showSoldOut) { state.showSoldOut = false; }
  refreshList();
}

/** Repinta todo lo que depende de los filtros. */
function refreshList() {
  renderCats();
  renderFilterBadge();
  renderGrid();
  if ($('#filterSheet').open) renderFilterSheet();
}

// ── Pintar catálogo ───────────────────────────────────────────
function stockTag(total) {
  if (total <= 0) return '<span class="stk none">Agotado</span>';
  if (total > 3) return `<span class="stk ok">${total} disp.</span>`;
  if (total === 1) return '<span class="stk low">Última unidad</span>';
  return `<span class="stk low">${total} disp.</span>`;
}

function cardHTML(c, { all = false } = {}) {
  const g = norm(c.genero);
  const img = c.fileId
    ? `<img src="${esc(imgURL(c.fileId))}" alt="${esc(c.nombre)}, color ${esc(c.color)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  const showAll = state.admin && (state.showSoldOut || all);
  const sizes = showAll ? c.sizes : c.sizes.filter((s) => s.disponible > 0);
  const chips = sizes.map((s) => {
    const cls = s.dup && state.admin ? ' dup' : s.disponible <= 0 ? ' out' : s.disponible === 1 ? ' szlow' : '';
    return `<span class="szd${cls}" aria-label="Talla ${esc(s.talla)}: ${s.disponible} disponible${s.disponible === 1 ? '' : 's'}">${esc(s.talla)}: ${s.disponible}</span>`;
  }).join('');
  let admin = '';
  if (state.admin) {
    const dups = c.sizes.filter((s) => s.dup).map((s) => s.talla);
    const sellable = c.sizes.some((s) => s.disponible > 0 && !s.dup);
    const disabled = !state.isAdminData || !sellable;
    const label = c.total <= 0 ? 'Agotado' : !sellable ? 'Revisar en el Sheet' : 'Vender';
    admin = (dups.length ? `<p class="dup-note" role="note">Código+talla repetido (${esc(dups.join(', '))}): corrígelo en el Sheet</p>` : '') +
      `<button type="button" class="sell-btn" data-card="${c.id}" ${disabled ? 'disabled' : ''} aria-label="${esc(label)}: ${esc(c.nombre)} ${esc(c.color)}">${label === 'Vender' ? ICON_BAG : ''}${label}</button>`;
  }
  return `<article class="pc${c.total <= 0 ? ' out' : ''}" data-card="${c.id}">
  <div class="pi${c.fileId ? '' : ' noimg'}">${img}${c.genero ? `<span class="gb g-${esc(g)}">${esc(c.genero)}</span>` : ''}</div>
  <div class="pb">
    <div class="pbrand">${esc(c.marca)}</div>
    <h3 class="pname">${esc(c.nombre)}</h3>
    <div class="pmeta">${esc(c.color)}</div>
    <div class="psizes">${chips}</div>
    <div class="pfoot"><div class="pp" aria-label="Precio ${money(c.precio)} dólares"><small>$</small>${money(c.precio)}</div>${stockTag(c.total)}</div>
    ${admin}
  </div>
</article>`;
}

function renderStats() {
  const cards = state.cards.filter((c) => c.total > 0);
  $('#stModels').textContent = cards.length;
  $('#stUnits').textContent = cards.reduce((n, c) => n + c.total, 0);
  $('#stBrands').textContent = new Set(cards.map((c) => c.marca).filter(Boolean)).size;
}

function renderGrid() {
  if (state.view !== 'catalog') return;
  const main = $('#content');
  const cards = visibleCards();
  const anyVisible = state.cards.some(inPool);
  $('#count').textContent = anyVisible ? plural(cards.length, 'modelo', 'modelos') : '';
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
  <h2 class="sh">${esc(s.cat || 'Otros')} <span class="shs">${esc(gens)}${gens ? ' · ' : ''}${plural(n, 'modelo', 'modelos')}</span></h2>
  <div class="grid">${s.cards.map((c) => cardHTML(c)).join('')}</div>
</section>`;
  }).join('');
}

function renderUpdated() {
  const ago = timeAgo(state.updated);
  $('#updated').textContent = state.updated ? `Actualizado ${ago === 'hace un momento' ? 'ahora' : ago}` : '';
  const banner = $('#banner');
  const offlineNow = state.offline || (state.admin && !navigator.onLine);
  if (offlineNow) {
    const parts = [state.offline ? `Sin conexión · mostrando copia de ${timeAgo(state.savedAt || state.updated)}` : 'Sin conexión'];
    if (state.admin) parts.push(OFFLINE_SELL_MSG);
    banner.textContent = parts.join(' · ');
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function renderAll() {
  renderStats();
  renderCats();
  renderFilterBadge();
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
function openSheet(d) { if (!d.open) d.showModal(); }
function closeSheet(d) { if (d.open) d.close(); }
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
  $('#adminNav').hidden = !a;
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
    toast(`Hola, ${res.user}. Toca «Vender» en cualquier producto.`);
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
  state.showSoldOut = false;
  pdf.result = null;
  pdf.error = null;
  ['#pdfSheet', '#sellSheet', '#filterSheet'].forEach((s) => closeSheet($(s)));
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

// ── Vender (talla + cantidad) ─────────────────────────────────
const sell = { cardId: null, key: null, qty: 1 };

function sellCard() { return state.cards.find((c) => c.id === sell.cardId); }
function sellSize() { return sellCard()?.sizes.find((s) => s.key === sell.key && !s.dup) || null; }
function findItem(key) { return state.items.find((i) => i.key === key && !i.dup); }

function parsePrice() {
  const raw = $('#sellPrice').value.trim().replace(/\s/g, '').replace(',', '.');
  const n = Number(raw);
  return raw && isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function renderSellSheet() {
  const c = sellCard();
  if (!c) return;
  const size = sellSize();
  const max = size ? size.disponible : 0;
  sell.qty = Math.max(1, Math.min(sell.qty, max || 1));
  $('#sizeOpts').innerHTML = c.sizes.map((s) => {
    const disabled = s.dup || s.disponible <= 0;
    const sub = s.dup ? 'revisar' : s.disponible <= 0 ? 'agotada' : `${s.disponible} disp.`;
    return `<button type="button" class="size-opt${s.dup ? ' dup' : ''}" role="radio" data-key="${esc(s.key)}" aria-checked="${s.key === sell.key && !s.dup}" ${disabled ? 'disabled' : ''} aria-label="Talla ${esc(s.talla)}, ${esc(sub)}"><b>${esc(s.talla)}</b><small>${esc(sub)}</small></button>`;
  }).join('');
  const dups = c.sizes.filter((s) => s.dup).map((s) => s.talla);
  const hint = $('#sizeHint');
  if (dups.length) { hint.textContent = `Código+talla repetido (${dups.join(', ')}): corrígelo en el Sheet para venderla.`; hint.className = 'hint warn'; }
  else if (!size) { hint.textContent = 'Elige la talla que vendiste.'; hint.className = 'hint'; }
  else { hint.textContent = ''; hint.className = 'hint'; }

  $('#qty').textContent = sell.qty;
  $('#qtyMinus').disabled = !size || sell.qty <= 1;
  $('#qtyPlus').disabled = !size || sell.qty >= max;
  $('#qtyLabel').textContent = size ? `Cantidad (máx. ${max})` : 'Cantidad';

  const price = parsePrice();
  const btn = $('#sellSubmit');
  if (!size) {
    $('#sellTotal').innerHTML = '';
    if (!$('#sellSheet').dataset.busy) { btn.textContent = 'Elige una talla'; btn.disabled = true; }
    return;
  }
  const total = price === null ? null : price * sell.qty;
  $('#sellTotal').innerHTML = total === null ? '' :
    `<span>${sell.qty} × $${money(price)} · talla ${esc(size.talla)}</span><b>$${money(total)}</b>`;
  if (!$('#sellSheet').dataset.busy) {
    btn.disabled = false;
    btn.textContent = total === null ? 'Confirmar venta' : `Vender ${plural(sell.qty, 'unidad', 'unidades')} · $${money(total)}`;
  }
}

function openSell(cardId) {
  if (!state.admin) return;
  if (!navigator.onLine || !state.isAdminData) { toast(OFFLINE_SELL_MSG, { error: true }); return; }
  const c = state.cards.find((x) => x.id === cardId);
  if (!c) return;
  const sellable = c.sizes.filter((s) => s.disponible > 0 && !s.dup);
  if (!sellable.length) { toast('Este producto no tiene tallas disponibles para vender.', { error: true }); return; }
  sell.cardId = cardId;
  sell.key = sellable.length === 1 ? sellable[0].key : null; // con varias tallas, que la persona elija
  sell.qty = 1;
  const img = c.fileId ? `<img src="${esc(imgURL(c.fileId))}" alt="" referrerpolicy="no-referrer">` : '<div class="ph"></div>';
  $('#sellProduct').innerHTML = `${img}<div><b>${esc(c.nombre)}</b><span>${esc(c.marca)} · ${esc(c.color)}</span><span>Precio de lista: $${money(c.precio)}</span></div>`;
  $('#sellPrice').value = money(c.precio);
  $('#sellNote').value = '';
  showFormError($('#sellError'), '');
  renderSellSheet();
  openSheet($('#sellSheet'));
}

async function confirmSell(e) {
  e.preventDefault();
  const d = $('#sellSheet');
  if (d.dataset.busy) return; // evita doble envío
  const err = $('#sellError');
  const size = sellSize();
  const card = sellCard();
  if (!size || !card) { showFormError(err, 'Elige la talla que vendiste.'); return; }
  const precio = parsePrice();
  if (precio === null) { showFormError(err, 'Escribe un precio válido (por ejemplo 19 o 19.50).'); $('#sellPrice').focus(); return; }
  if (!navigator.onLine) { showFormError(err, OFFLINE_SELL_MSG + '.'); return; }
  const qty = Math.min(sell.qty, size.disponible);
  showFormError(err, '');
  const btn = $('#sellSubmit');
  setBusy(d, btn, true, qty > 1 ? `Registrando 1 de ${qty}…` : 'Registrando…');
  const nota = $('#sellNote').value.trim();
  const key = size.key;
  const saleIds = [];
  let lastItem = null;
  let failure = null;
  // El Apps Script registra 1 unidad por llamada: repetimos «sell» tantas veces como unidades.
  for (let i = 1; i <= qty; i++) {
    if (qty > 1) btn.textContent = `Registrando ${i} de ${qty}…`;
    const notaN = qty > 1 ? `${nota ? nota + ' · ' : ''}unidad ${i} de ${qty}` : nota;
    try {
      const res = await post('sell', { pin: state.admin.pin, key, precio, ...(notaN ? { nota: notaN } : {}) });
      saleIds.push(res.saleId);
      if (res.item) lastItem = res.item;
    } catch (ex) {
      failure = ex;
      break;
    }
  }
  setBusy(d, btn, false);
  const errMsg = failure && (failure.network ? `${OFFLINE_SELL_MSG}.` : failure.message);
  if (!saleIds.length) {
    showFormError(err, failure.network ? `${OFFLINE_SELL_MSG}. No se registró la venta.` : failure.message);
    renderSellSheet();
    return;
  }
  closeSheet(d);
  if (lastItem) updateItem(lastItem);
  state.sales = null; // la lista de ventas cambió
  const what = `${saleIds.length} × ${card.nombre} (talla ${size.talla})`;
  const undo = { label: 'Deshacer', onClick: () => undoSales(saleIds) };
  if (failure) {
    toast(`Solo se registraron ${saleIds.length} de ${qty}: ${errMsg}`, { error: true, duration: 12000, action: undo });
  } else {
    toast(`Vendiste ${what} · $${money(precio * saleIds.length)}`, { duration: UNDO_MS, action: undo });
  }
}

async function undoSales(saleIds, { fromList = false } = {}) {
  if (!saleIds.length || !state.admin) return false;
  if (!navigator.onLine) { toast(OFFLINE_SELL_MSG, { error: true }); return false; }
  let done = 0;
  let lastItem = null;
  for (const id of [...saleIds].reverse()) {
    try {
      const res = await post('undo', { pin: state.admin.pin, saleId: id });
      done++;
      if (res.item) lastItem = res.item;
      const s = state.sales && state.sales.find((x) => x.id === id);
      if (s) s.estado = 'Anulada';
    } catch (ex) {
      if (lastItem) updateItem(lastItem);
      const msg = ex.network ? OFFLINE_SELL_MSG : ex.message;
      toast(done ? `Se anularon ${done} de ${saleIds.length}: ${msg}. Revisa la pestaña Ventas.` : `No se anuló la venta: ${msg}`, { error: true, duration: 8000 });
      if (!fromList && state.view === 'sales') renderSales();
      return false;
    }
  }
  if (lastItem) updateItem(lastItem);
  if (!fromList && state.view === 'sales') renderSales();
  toast(done > 1 ? `Venta anulada: ${done} unidades volvieron al stock.` : 'Venta anulada. La unidad volvió al stock.');
  return true;
}

/** Actualiza una talla con el item que devuelve el servidor, sin recargar todo. */
function updateItem(item) {
  const i = state.items.findIndex((x) => x.key === item.key && !x.dup);
  if (i >= 0) state.items[i] = { ...state.items[i], ...item };
  else state.items.push(item);
  state.cards = groupItems(state.items);
  saveAdminCache();
  renderStats();
  renderCats();
  const card = state.cards.find((c) => c.sizes.some((s) => s.key === item.key));
  const el = card && document.querySelector(`.pc[data-card="${card.id}"]`);
  if (el && state.view === 'catalog') el.outerHTML = cardHTML(card, { all: true });
  else renderGrid();
}

// ── Vistas: catálogo / ventas ─────────────────────────────────
function setView(v) {
  state.view = v;
  const isCat = v === 'catalog';
  const mark = (el, on) => (on ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current'));
  mark($('#tabCatalog'), isCat);
  mark($('#tabSales'), !isCat);
  $('.searchbar').hidden = !isCat;
  $('.meta').hidden = !isCat;
  document.body.classList.toggle('view-sales', !isCat);
  window.scrollTo({ top: 0 });
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
  const today = dayKey(new Date());
  const todays = active.filter((s) => dayKey(s.fecha) === today);
  const sum = (arr) => arr.reduce((n, s) => n + (Number(s.precioCobrado) || 0), 0);
  const head = `<div class="sales-head">
  <h2>Ventas <button class="refresh" type="button" data-act="reload-sales" aria-label="Actualizar ventas"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button></h2>
  <div class="kpis">
    <div class="kpi"><span>Hoy</span><b>$${money(sum(todays))}</b><small>${plural(todays.length, 'unidad', 'unidades')}</small></div>
    <div class="kpi"><span>Últimas ${sales.length || 40}</span><b>$${money(sum(active))}</b><small>${plural(active.length, 'activa', 'activas')}</small></div>
  </div>
</div>`;
  if (!sales.length) {
    $('#content').innerHTML = head + '<div class="state"><h2>Aún no hay ventas</h2><p>Cuando vendas desde el catálogo, aparecerán aquí.</p></div>';
    return;
  }
  let html = '';
  let lastDay = null;
  for (const s of sales) {
    const dk = dayKey(s.fecha);
    if (dk !== lastDay) {
      if (lastDay !== null) html += '</ul>';
      html += `<h3 class="day">${esc(dayLabel(s.fecha))}</h3><ul class="sales">`;
      lastDay = dk;
    }
    const act = isActive(s);
    const diff = s.precioCatalogo !== undefined && s.precioCatalogo !== '' && Number(s.precioCatalogo) !== Number(s.precioCobrado);
    html += `<li class="sale${act ? '' : ' void'}">
  <div class="sale-main">
    <b>${esc(s.producto)}</b>
    <span class="l">Talla ${esc(s.talla)}${diff ? ` · lista $${money(s.precioCatalogo)}` : ''}</span>
    <span class="l">${esc(fmtTime(s.fecha))}${s.vendio ? ` · ${esc(s.vendio)}` : ''}</span>
    ${s.nota ? `<span class="l n">“${esc(s.nota)}”</span>` : ''}
  </div>
  <div class="sale-side">
    <span class="sale-price">$${money(s.precioCobrado)}</span>
    <span class="badge">${esc(s.estado || '')}</span>
    ${act ? `<button type="button" class="void-btn" data-void="${esc(s.id)}">Anular</button>` : ''}
  </div>
</li>`;
  }
  $('#content').innerHTML = head + html + '</ul>';
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
  const done = await undoSales([id], { fromList: true });
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
  const n = (v, one, many) => (v === undefined || v === null || v === '' ? '' : plural(Number(v), one, many));
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
  $('#pdfBtn').setAttribute('aria-busy', String(busy));
  $('#pdfBtnText').textContent = busy ? 'Generando…' : 'Compartir PDF';
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
  try {
    const res = await generatePdf(state.admin.pin);
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
function onChip(e) {
  const b = e.target.closest('.chip[data-field]');
  if (!b) return;
  const { field, value } = b.dataset;
  state.filters[field] = value && state.filters[field] !== value ? value : null;
  refreshList();
  if (field === 'categoria') {
    const on = $('#cats .chip[aria-pressed="true"]');
    on && on.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
}

function bind() {
  const q = $('#q');
  let t;
  q.addEventListener('input', () => {
    $('#qClear').hidden = !q.value;
    clearTimeout(t);
    t = setTimeout(() => { state.q = q.value; refreshList(); }, 120);
  });
  $('#qClear').addEventListener('click', () => { q.value = ''; state.q = ''; $('#qClear').hidden = true; refreshList(); q.focus(); });

  $('#cats').addEventListener('click', onChip);
  $('#filterBody').addEventListener('click', onChip);
  $('#filterBtn').addEventListener('click', () => { renderFilterSheet(); openSheet($('#filterSheet')); });
  $('#filterClear').addEventListener('click', () => {
    state.filters.genero = null; state.filters.marca = null; state.showSoldOut = false;
    refreshList();
  });
  $('#soldOut').addEventListener('change', (e) => { state.showSoldOut = e.target.checked; refreshList(); });
  $('#clearAll').addEventListener('click', clearFilters);

  $('#refreshBtn').addEventListener('click', () => load({ user: true }));
  $('#content').addEventListener('click', (e) => {
    const sb = e.target.closest('.sell-btn');
    if (sb && !sb.disabled) { openSell(sb.dataset.card); return; }
    const v = e.target.closest('[data-void]');
    if (v && !v.disabled) { voidSale(v.dataset.void, v); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'refresh') load({ user: true });
    if (act === 'reload-sales') loadSales({ force: true });
    if (act === 'clear-filters') clearFilters();
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
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    menu.close();
    if (act === 'refresh') { state.view === 'sales' ? loadSales({ force: true }) : load({ user: true }); }
    if (act === 'update') checkForUpdate();
    if (act === 'logout') logout();
    if (act === 'install' && installEvt) {
      installEvt.prompt();
      await installEvt.userChoice;
      installEvt = null;
      $('#installItem').hidden = true;
    }
  });
  $('#versionNote').textContent = `Aura Catálogo · versión ${APP_VERSION}${MOCK ? ' · modo demo (PIN 1234)' : ''}`;

  // Admin
  ['#menu', '#filterSheet', '#loginSheet', '#sellSheet', '#confirmSheet', '#pdfSheet'].forEach((s) => wireSheet($(s)));
  $('#lockBtn').addEventListener('click', () => {
    showFormError($('#loginError'), '');
    $('#pin').value = '';
    openSheet($('#loginSheet'));
    $('#pin').focus();
  });
  $('#loginForm').addEventListener('submit', login);
  $('#sellForm').addEventListener('submit', confirmSell);
  $('#sizeOpts').addEventListener('click', (e) => {
    const b = e.target.closest('.size-opt');
    if (!b || b.disabled) return;
    sell.key = b.dataset.key;
    sell.qty = 1;
    showFormError($('#sellError'), '');
    renderSellSheet();
  });
  $('#qtyMinus').addEventListener('click', () => { sell.qty--; renderSellSheet(); });
  $('#qtyPlus').addEventListener('click', () => { sell.qty++; renderSellSheet(); });
  $('#sellPrice').addEventListener('input', renderSellSheet);
  $('#adminNav').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'pdfBtn') { openPdf(); return; }
    if (b.dataset.view && b.dataset.view !== state.view) setView(b.dataset.view);
  });
  $('#pdfRetry').addEventListener('click', startPdf);
  $('#pdfRegen').addEventListener('click', startPdf);
  $('#pdfCopy').addEventListener('click', copyPdfLink);
  $('#pdfShare').addEventListener('click', sharePdf);

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
