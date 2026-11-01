// Aura Catálogo — lógica principal (fase 1: catálogo de solo lectura)
import { getCatalog, isConfigured, MOCK } from './api.js';

export const APP_VERSION = '1.0.0';
const STORE_KEY = MOCK ? 'aura.catalog.mock.v1' : 'aura.catalog.v1';
const GENDER_ORDER = ['Mujer', 'Hombre', 'Unisex'];
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', 'U', 'UNICA', 'ÚNICA'];

const $ = (s, el = document) => el.querySelector(s);
const state = {
  items: [],          // items crudos (uno por talla)
  cards: [],          // agrupados por producto
  updated: null,      // Date del catálogo
  offline: false,     // mostrando copia guardada
  loading: false,
  q: '',
  filters: { genero: null, categoria: null, marca: null },
};

// ── Utilidades ────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const money = (n) => (Number(n) || 0).toFixed(2);
const storage = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio o modo privado */ } },
};

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

function sizeRank(t) {
  const u = String(t).toUpperCase().trim();
  const i = SIZE_ORDER.indexOf(u);
  if (i >= 0) return i;
  const n = parseFloat(u);
  return isNaN(n) ? 500 : 100 + n;
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
        id: k, fileId: it.fileId, nombre: it.nombre, marca: it.marca, color: it.color,
        genero: it.genero, categoria: it.categoria, precio: Number(it.precio) || 0,
        sizes: [], total: 0,
      };
      c.search = norm([it.nombre, it.marca, it.color, it.categoria, it.genero, it.codigo].join(' '));
      map.set(k, c);
    }
    const disp = Number(it.disponible) || 0;
    c.sizes.push({ key: it.key, talla: it.talla, disponible: disp });
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

// ── Pintar ────────────────────────────────────────────────────
function stockTag(total) {
  if (total > 3) return `<span class="stk ok">${total} disp.</span>`;
  if (total === 1) return '<span class="stk low">Última unidad</span>';
  return `<span class="stk low">${total} disp.</span>`;
}

function cardHTML(c) {
  const g = norm(c.genero);
  const img = c.fileId
    ? `<img src="https://drive.google.com/thumbnail?id=${encodeURIComponent(c.fileId)}&amp;sz=w400" alt="${esc(c.nombre)}, color ${esc(c.color)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  const sizes = c.sizes.map((s) =>
    `<span class="szd${s.disponible <= 1 ? ' szlow' : ''}" aria-label="Talla ${esc(s.talla)}: ${s.disponible} disponible${s.disponible === 1 ? '' : 's'}">${esc(s.talla)}: ${s.disponible}</span>`).join('');
  return `<article class="pc">
  <div class="pi${c.fileId ? '' : ' noimg'}">${img}${c.genero ? `<span class="gb g-${esc(g)}">${esc(c.genero)}</span>` : ''}</div>
  <div class="pb">
    <div class="pbrand">${esc(c.marca)}</div>
    <h3 class="pname">${esc(c.nombre)}</h3>
    <div class="pmeta">${esc(c.color)}</div>
    <div class="psizes">${sizes}</div>
    <div class="pfoot"><div class="pp" aria-label="Precio ${money(c.precio)} dólares"><small>$</small>${money(c.precio)}</div>${stockTag(c.total)}</div>
  </div>
</article>`;
}

function visibleCards() {
  const { q, filters: f } = state;
  const terms = norm(q).split(/\s+/).filter(Boolean);
  return state.cards.filter((c) =>
    (!f.genero || c.genero === f.genero) &&
    (!f.categoria || c.categoria === f.categoria) &&
    (!f.marca || c.marca === f.marca) &&
    terms.every((t) => c.search.includes(t)));
}

function renderStats() {
  const cards = state.cards;
  $('#stModels').textContent = cards.length;
  $('#stUnits').textContent = cards.reduce((n, c) => n + c.total, 0);
  $('#stBrands').textContent = new Set(cards.map((c) => c.marca).filter(Boolean)).size;
}

function renderFilters() {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const generos = uniq(state.cards.map((c) => c.genero)).sort((a, b) => {
    const ia = GENDER_ORDER.indexOf(a), ib = GENDER_ORDER.indexOf(b);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });
  const categorias = uniq(state.cards.map((c) => c.categoria));
  const marcas = uniq(state.cards.map((c) => c.marca)).sort((a, b) => a.localeCompare(b, 'es'));
  const row = (field, label, values) => {
    if (values.length < 2) return '';
    const cur = state.filters[field];
    const chip = (v, text) => `<button type="button" class="chip" data-field="${field}" data-value="${esc(v)}" aria-pressed="${cur === v || (!cur && v === '') ? 'true' : 'false'}">${esc(text)}</button>`;
    return `<div class="frow" role="group" aria-label="${label}"><span class="flabel" aria-hidden="true">${label}</span>${chip('', 'Todos')}${values.map((v) => chip(v, v)).join('')}</div>`;
  };
  $('#filters').innerHTML = row('genero', 'Género', generos) + row('categoria', 'Categoría', categorias) + row('marca', 'Marca', marcas);
}

function renderGrid() {
  const main = $('#content');
  const cards = visibleCards();
  $('#count').textContent = state.cards.length ? `${cards.length} ${cards.length === 1 ? 'modelo' : 'modelos'}` : '';
  if (!state.cards.length) {
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
  <div class="grid">${s.cards.map(cardHTML).join('')}</div>
</section>`;
  }).join('');
}

function renderUpdated() {
  $('#updated').textContent = state.updated ? `Actualizado ${timeAgo(state.updated)}` : '';
  const banner = $('#banner');
  if (state.offline) {
    banner.textContent = `Sin conexión · mostrando copia de ${timeAgo(state.savedAt || state.updated)}`;
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
function applyData(data, { offline = false, savedAt = null } = {}) {
  state.items = Array.isArray(data.items) ? data.items.filter((i) => Number(i.disponible) > 0) : [];
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

async function load({ user = false } = {}) {
  if (!isConfigured()) { renderNotConfigured(); return; }
  if (state.loading) return;
  state.loading = true;
  const btn = $('#refreshBtn');
  btn.classList.add('spin');
  btn.disabled = true;
  if (!state.cards.length) renderSkeleton();
  try {
    const data = await getCatalog();
    const savedAt = new Date().toISOString();
    storage.set(STORE_KEY, { savedAt, data });
    applyData(data);
    if (user) toast('Catálogo actualizado');
  } catch (err) {
    const saved = storage.get(STORE_KEY);
    if (err.network && saved && saved.data) {
      applyData(saved.data, { offline: true, savedAt: saved.savedAt });
      if (user) toast('Sin conexión: se muestra la última copia guardada', { error: true });
    } else if (state.cards.length) {
      toast(err.message, { error: true });
    } else {
      renderError(err);
    }
  } finally {
    state.loading = false;
    btn.classList.remove('spin');
    btn.disabled = false;
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
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
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
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'refresh') load({ user: true });
    if (act === 'clear-filters') {
      state.filters = { genero: null, categoria: null, marca: null };
      state.q = ''; q.value = ''; $('#qClear').hidden = true;
      renderFilters(); renderGrid();
    }
  });

  // Foto que no carga → marcador "AURA". (los errores de <img> no burbujean: usamos captura)
  $('#content').addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') e.target.parentElement.classList.add('noimg');
  }, true);

  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', () => menu.showModal());
  menu.addEventListener('click', async (e) => {
    if (e.target === menu) { menu.close(); return; } // toque fuera
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    menu.close();
    if (act === 'refresh') load({ user: true });
    if (act === 'update') checkForUpdate();
    if (act === 'install' && installEvt) {
      installEvt.prompt();
      await installEvt.userChoice;
      installEvt = null;
      $('#installItem').hidden = true;
    }
  });
  $('#versionNote').textContent = `Aura Catálogo · versión ${APP_VERSION}${MOCK ? ' · modo demo' : ''}`;

  // Buscador fijo: añade borde cuando se pega arriba
  const sb = $('.searchbar');
  const sentinel = document.createElement('div');
  sb.before(sentinel);
  new IntersectionObserver(([en]) => sb.classList.toggle('stuck', !en.isIntersecting)).observe(sentinel);

  window.addEventListener('online', () => { if (state.offline) load(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.updated && Date.now() - state.updated > 5 * 60e3) load();
  });
  setInterval(renderUpdated, 30e3);
}

// ── Inicio ────────────────────────────────────────────────────
$('#demoBadge').hidden = !MOCK;
bind();
// Muestra al instante la última copia guardada mientras llega la nueva
const saved = storage.get(STORE_KEY);
if (saved && saved.data && isConfigured()) applyData(saved.data, { savedAt: saved.savedAt });
load();
registerSW();
