/**
 * ═══════════════════════════════════════════════════════════════
 *  AURA CATÁLOGO · Apps Script (versión 2)
 *  API de la app + PDF vertical (A4) + rentabilidad + fotos para redes
 * ═══════════════════════════════════════════════════════════════
 *
 *  INSTALACIÓN (resumen; los pasos completos están en el README):
 *   1. En tu Sheet: Extensiones → Apps Script. Borra el código viejo
 *      (guárdalo antes en un archivo aparte por si acaso) y pega este.
 *   2. Servicios (+) → "Google Slides API" → Agregar.   ← necesario para el PDF vertical
 *   3. Configuración del proyecto → Propiedades del script:
 *        PIN_Nando = 1234        (una propiedad por persona: PIN_<Nombre> = <pin>)
 *   4. Implementar → Gestionar implementaciones → ✏️ → Versión: "Nueva versión" → Implementar.
 *      (Así la URL /exec NO cambia y no hay que tocar config.js.)
 *
 *  Nunca se envían al catálogo público: Costo, Inversión ni Ganancia.
 */

const AURA = {
  VERSION: 2,
  HOJA_INVENTARIO: 'Inventario',
  HOJA_VENTAS: 'Ventas',
  CARPETA_PDF: 'Catalogos Aura PDF',
  AJUSTE_COSTO: 0.15,   // +15 % al costo en "Rentabilidad" (igual que tu hoja "Margen Ajustado"). Pon 0 para no ajustar.
  MAX_FALLOS: 8,        // PIN fallidos permitidos…
  VENTANA_MIN: 10,      // …en estos minutos
};

// ─────────────────────────────────────────────────────────────
//  Entrada HTTP
// ─────────────────────────────────────────────────────────────
function doGet(e) {
  const p = (e && e.parameter) || {};
  return respond_(() => route_(p.action || 'catalog', p));
}

function doPost(e) {
  return respond_(() => {
    let body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (err) { throw new Error('Petición no válida.'); }
    return route_(body.action, body);
  });
}

function respond_(fn) {
  let out;
  try { out = fn(); }
  catch (err) { out = { ok: false, error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route_(action, req) {
  if (action === 'catalog') return apiCatalog_();
  const user = auth_(req.pin);
  switch (action) {
    case 'login': return { ok: true, user: user, version: AURA.VERSION };
    case 'admin_catalog': return apiAdminCatalog_(user);
    case 'sell': return withLock_(() => apiSell_(req, user));
    case 'undo': return withLock_(() => apiUndo_(req, user));
    case 'sales': return apiSales_(req);
    case 'stats': return apiStats_();
    case 'photo': return apiPhoto_(req);
    case 'pdf': return apiPdf_();
    default: throw new Error('Acción desconocida: ' + action);
  }
}

// ─────────────────────────────────────────────────────────────
//  Seguridad: PIN y bloqueo por intentos
// ─────────────────────────────────────────────────────────────
function auth_(pin) {
  const cache = CacheService.getScriptCache();
  const now = Date.now();
  let fails = [];
  try { fails = JSON.parse(cache.get('aura_fallos') || '[]'); } catch (e) { fails = []; }
  fails = fails.filter((t) => now - t < AURA.VENTANA_MIN * 60000);
  if (fails.length >= AURA.MAX_FALLOS) {
    throw new Error('Demasiados intentos fallidos. Espera ' + AURA.VENTANA_MIN + ' minutos antes de volver a intentarlo.');
  }
  const props = PropertiesService.getScriptProperties().getProperties();
  const users = {};
  Object.keys(props).forEach((k) => {
    if (/^PIN_/i.test(k) && String(props[k]).trim()) users[String(props[k]).trim()] = k.slice(4);
  });
  if (!Object.keys(users).length) {
    throw new Error('No hay PIN configurados. En Apps Script → Configuración → Propiedades del script, añade PIN_TuNombre.');
  }
  const user = users[String(pin == null ? '' : pin).trim()];
  if (!user) {
    fails.push(now);
    cache.put('aura_fallos', JSON.stringify(fails), AURA.VENTANA_MIN * 60);
    throw new Error('PIN incorrecto.');
  }
  return user;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('El sistema está ocupado. Inténtalo de nuevo en unos segundos.');
  try { return fn(); }
  finally { lock.releaseLock(); }
}

// ─────────────────────────────────────────────────────────────
//  Lectura de hojas (por nombre de columna, no por letra)
// ─────────────────────────────────────────────────────────────
function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v == null ? '' : v).replace(/[^0-9,.\-]/g, '');
  if (!s) return 0;
  const n = parseFloat(s.indexOf(',') >= 0 && s.indexOf('.') < 0 ? s.replace(',', '.') : s.replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}

function headerMap_(row) {
  const map = {};
  row.forEach((h, i) => { const k = norm_(h); if (k && !(k in map)) map[k] = i; });
  return map;
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('No encuentro la hoja "' + name + '".');
  return sh;
}

function fileIdFrom_(link) {
  const s = String(link || '');
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(s.trim()) ? s.trim() : '');
}

/** Lee el inventario. Cada fila = una talla. */
function readInventory_() {
  const sh = sheet_(AURA.HOJA_INVENTARIO);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { sh: sh, col: {}, items: [] };
  const col = headerMap_(values[0]);
  ['nombre', 'codigo', 'talla', 'precio', 'stock', 'vendida'].forEach((c) => {
    if (!(c in col)) throw new Error('Falta la columna "' + c + '" en la hoja ' + AURA.HOJA_INVENTARIO + '.');
  });
  const get = (r, c) => (c in col ? r[col[c]] : '');
  const items = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const codigo = String(get(r, 'codigo')).trim();
    const nombre = String(get(r, 'nombre')).trim();
    if (!codigo && !nombre) continue;
    const talla = String(get(r, 'talla')).trim();
    const stock = num_(get(r, 'stock'));
    const vendida = num_(get(r, 'vendida'));
    items.push({
      row: i + 1,
      key: codigo + '|' + talla,
      codigo: codigo,
      fileId: fileIdFrom_(get(r, 'drivelink')),
      nombre: nombre,
      marca: String(get(r, 'marca')).trim(),
      color: String(get(r, 'color')).trim(),
      talla: talla,
      genero: String(get(r, 'genero')).trim(),
      categoria: String(get(r, 'categoria')).trim(),
      descripcion: String(get(r, 'descripcion')).trim(),
      precio: num_(get(r, 'precio')),
      costo: num_(get(r, 'costo')),
      inversion: num_(get(r, 'inversion')),
      stock: stock,
      vendida: vendida,
      disponible: Math.max(0, stock - vendida),
    });
  }
  const count = {};
  items.forEach((it) => { count[it.key] = (count[it.key] || 0) + 1; });
  items.forEach((it) => { it.dup = count[it.key] > 1; });
  return { sh: sh, col: col, items: items };
}

const PUBLIC_FIELDS_ = ['key', 'codigo', 'fileId', 'nombre', 'marca', 'color', 'talla', 'genero', 'categoria', 'precio', 'disponible', 'descripcion'];
const ADMIN_FIELDS_ = PUBLIC_FIELDS_.concat(['stock', 'vendida', 'dup']);
function pick_(o, fields) { const r = {}; fields.forEach((f) => { r[f] = o[f]; }); return r; }

const VENTAS_HEADERS_ = ['ID', 'Fecha', 'Clave', 'Código', 'Talla', 'Producto', 'Precio catálogo', 'Precio cobrado', 'Vendió', 'Estado', 'Anulada el', 'Anulada por', 'Nota', 'Cantidad'];

/** Hoja Ventas; crea la hoja o la columna "Cantidad" si faltan. */
function ventas_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(AURA.HOJA_VENTAS);
  if (!sh) {
    sh = ss.insertSheet(AURA.HOJA_VENTAS);
    sh.getRange(1, 1, 1, VENTAS_HEADERS_.length).setValues([VENTAS_HEADERS_]);
  }
  const lastCol = Math.max(1, sh.getLastColumn());
  let headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  let col = headerMap_(headers);
  VENTAS_HEADERS_.forEach((h) => {
    if (!(norm_(h) in col)) {
      const c = headers.filter((x) => String(x).trim() !== '').length + 1;
      sh.getRange(1, c).setValue(h);
      headers = sh.getRange(1, 1, 1, Math.max(c, sh.getLastColumn())).getValues()[0];
      col = headerMap_(headers);
    }
  });
  return { sh: sh, col: col, width: headers.length };
}

function parseFecha_(v) {
  if (v instanceof Date) return v;
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function fmt_(d, pattern) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), pattern);
}

// ─────────────────────────────────────────────────────────────
//  Acciones
// ─────────────────────────────────────────────────────────────
function apiCatalog_() {
  const inv = readInventory_();
  return {
    ok: true, version: AURA.VERSION, updated: new Date().toISOString(),
    items: inv.items.filter((i) => i.disponible > 0).map((i) => pick_(i, PUBLIC_FIELDS_)),
  };
}

function apiAdminCatalog_(user) {
  const inv = readInventory_();
  return { ok: true, user: user, version: AURA.VERSION, updated: new Date().toISOString(), items: inv.items.map((i) => pick_(i, ADMIN_FIELDS_)) };
}

function apiSell_(req, user) {
  const inv = readInventory_();
  const matches = inv.items.filter((i) => i.key === req.key);
  if (!matches.length) throw new Error('No se encontró ese producto. Actualiza el catálogo.');
  if (matches.length > 1) throw new Error('Código+talla repetido en el Sheet: corrígelo antes de vender.');
  const it = matches[0];
  const cantidad = req.cantidad === undefined || req.cantidad === null || req.cantidad === '' ? 1 : Number(req.cantidad);
  if (!(cantidad >= 1) || Math.floor(cantidad) !== cantidad) throw new Error('La cantidad no es válida.');
  if (it.disponible <= 0) throw new Error('Ya no quedan unidades de esta talla.');
  if (cantidad > it.disponible) throw new Error('Solo quedan ' + it.disponible + ' unidad' + (it.disponible === 1 ? '' : 'es') + ' de esta talla.');
  let precio = it.precio;
  if (req.precio !== undefined && req.precio !== null && req.precio !== '') {
    precio = Number(req.precio);
    if (!isFinite(precio) || precio < 0) throw new Error('El precio cobrado no es válido.');
  }
  // 1) Inventario: suma a VENDIDA
  inv.sh.getRange(it.row, inv.col.vendida + 1).setValue(it.vendida + cantidad);
  it.vendida += cantidad;
  it.disponible = Math.max(0, it.stock - it.vendida);
  // 2) Ventas: una fila con la cantidad
  const v = ventas_();
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  const row = new Array(v.width).fill('');
  const put = (h, val) => { const c = v.col[norm_(h)]; if (c !== undefined) row[c] = val; };
  put('ID', id); put('Fecha', new Date()); put('Clave', it.key); put('Código', it.codigo); put('Talla', it.talla);
  put('Producto', it.nombre + (it.color ? ' · ' + it.color : '')); put('Precio catálogo', it.precio); put('Precio cobrado', precio);
  put('Vendió', user); put('Estado', 'Activa'); put('Nota', String(req.nota || '').slice(0, 300)); put('Cantidad', cantidad);
  v.sh.appendRow(row);
  return { ok: true, saleId: id, saleIds: [id], cantidad: cantidad, item: pick_(it, ADMIN_FIELDS_) };
}

function apiUndo_(req, user) {
  const v = ventas_();
  const values = v.sh.getDataRange().getValues();
  const c = (h) => v.col[norm_(h)];
  let r = -1;
  for (let i = values.length - 1; i >= 1; i--) if (String(values[i][c('ID')]) === String(req.saleId)) { r = i; break; }
  if (r < 0) throw new Error('No se encontró esa venta.');
  if (norm_(values[r][c('Estado')]) !== 'activa') throw new Error('Esa venta ya estaba anulada.');
  const cantidad = Math.max(1, num_(values[r][c('Cantidad')]) || 1);
  const inv = readInventory_();
  const it = inv.items.filter((i) => i.key === String(values[r][c('Clave')]))[0];
  if (it) {
    it.vendida = Math.max(0, it.vendida - cantidad);
    inv.sh.getRange(it.row, inv.col.vendida + 1).setValue(it.vendida);
    it.disponible = Math.max(0, it.stock - it.vendida);
  }
  v.sh.getRange(r + 1, c('Estado') + 1).setValue('Anulada');
  if (c('Anulada el') !== undefined) v.sh.getRange(r + 1, c('Anulada el') + 1).setValue(fmt_(new Date(), 'yyyy-MM-dd HH:mm'));
  if (c('Anulada por') !== undefined) v.sh.getRange(r + 1, c('Anulada por') + 1).setValue(user);
  return { ok: true, cantidad: cantidad, item: it ? pick_(it, ADMIN_FIELDS_) : null };
}

function readSales_() {
  const v = ventas_();
  const values = v.sh.getDataRange().getValues();
  const c = (h) => v.col[norm_(h)];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!String(r[c('ID')] || '').trim()) continue;
    const f = parseFecha_(r[c('Fecha')]);
    out.push({
      id: String(r[c('ID')]),
      fecha: f ? f.toISOString() : String(r[c('Fecha')] || ''),
      key: String(r[c('Clave')] || ''),
      codigo: String(r[c('Código')] || ''),
      talla: String(r[c('Talla')] || ''),
      producto: String(r[c('Producto')] || ''),
      precioCatalogo: num_(r[c('Precio catálogo')]),
      precioCobrado: num_(r[c('Precio cobrado')]),
      cantidad: Math.max(1, num_(c('Cantidad') === undefined ? 1 : r[c('Cantidad')]) || 1),
      vendio: String(r[c('Vendió')] || ''),
      estado: String(r[c('Estado')] || ''),
      nota: String(r[c('Nota')] || ''),
    });
  }
  return out.reverse(); // más reciente primero
}

function apiSales_(req) {
  const limit = Math.max(1, Math.min(1000, Number(req.limit) || 40));
  return { ok: true, sales: readSales_().slice(0, limit) };
}

/** Datos para "Rentabilidad". Solo con PIN: incluye costos. */
function apiStats_() {
  const inv = readInventory_();
  const sales = readSales_().filter((s) => norm_(s.estado) === 'activa')
    .map((s) => ({ fecha: s.fecha, key: s.key, cantidad: s.cantidad, precioCobrado: s.precioCobrado, vendio: s.vendio }));
  return {
    ok: true, ajusteCosto: AURA.AJUSTE_COSTO,
    items: inv.items.map((i) => pick_(i, ['key', 'nombre', 'marca', 'categoria', 'genero', 'color', 'talla', 'fileId', 'precio', 'costo', 'inversion', 'stock', 'vendida', 'disponible'])),
    sales: sales,
  };
}

/** Foto de un producto del inventario (para las imágenes para redes). */
function apiPhoto_(req) {
  const id = String(req.fileId || '');
  const inv = readInventory_();
  if (!id || !inv.items.some((i) => i.fileId === id)) throw new Error('Esa foto no pertenece al inventario.');
  const blob = photoBlob_(id, 1080);
  if (!blob) throw new Error('No se pudo leer la foto en Drive.');
  if (blob.getBytes().length > 5 * 1024 * 1024) throw new Error('La foto es demasiado grande (más de 5 MB).');
  return { ok: true, mime: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) };
}

function photoBlob_(fileId, width) {
  try {
    const res = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + fileId + '&sz=w' + width, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: true,
    });
    if (res.getResponseCode() === 200 && /^image\//.test(String(res.getHeaders()['Content-Type'] || res.getBlob().getContentType()))) return res.getBlob();
  } catch (e) { /* seguimos con el original */ }
  try { return DriveApp.getFileById(fileId).getBlob(); } catch (e) { return null; }
}

// ─────────────────────────────────────────────────────────────
//  Catálogo agrupado (igual que en la app)
// ─────────────────────────────────────────────────────────────
const GENEROS_ = ['Mujer', 'Hombre', 'Unisex'];
const TALLAS_ = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', 'U', 'UNICA', 'ÚNICA'];

function sizeRank_(t) {
  const u = String(t).toUpperCase().trim();
  const i = TALLAS_.indexOf(u);
  if (i >= 0) return i;
  const n = parseFloat(u);
  return isNaN(n) ? 500 : 100 + n;
}

function buildCards_(items) {
  const map = {};
  const order = [];
  const catOrder = {};
  items.filter((i) => i.disponible > 0).forEach((it) => {
    if (!(it.categoria in catOrder)) catOrder[it.categoria] = Object.keys(catOrder).length;
    const k = [it.fileId, it.nombre, it.color, it.precio].join('¦');
    if (!map[k]) {
      map[k] = { fileId: it.fileId, nombre: it.nombre, marca: it.marca, color: it.color, genero: it.genero, categoria: it.categoria, precio: it.precio, sizes: [], total: 0 };
      order.push(k);
    }
    map[k].sizes.push({ talla: it.talla, disponible: it.disponible });
    map[k].total += it.disponible;
  });
  const g = (x) => { const i = GENEROS_.indexOf(x); return i < 0 ? 9 : i; };
  const cards = order.map((k) => map[k]);
  cards.forEach((c) => c.sizes.sort((a, b) => sizeRank_(a.talla) - sizeRank_(b.talla)));
  cards.sort((a, b) => (catOrder[a.categoria] - catOrder[b.categoria]) || (g(a.genero) - g(b.genero)) ||
    String(a.marca).localeCompare(b.marca, 'es') || String(a.nombre).localeCompare(b.nombre, 'es'));
  return cards;
}

// ─────────────────────────────────────────────────────────────
//  PDF vertical (A4) — diseño
//  Se calcula primero un "plano" de cada página (rectángulos, textos, fotos)
//  y después se dibuja en Google Slides con tamaño A4 vertical.
// ─────────────────────────────────────────────────────────────
const PDF_ = {
  W: 595.28, H: 841.89, M: 34, GAP: 12, COLS: 3, ROWS: 2,
  SERIF: 'Cormorant Garamond', SANS: 'Inter',
  C: {
    bg: '#faf7f2', dark: '#181512', ink: '#1a1a1a', soft: '#6b6b6b', line: '#ebe4d8', lineSoft: '#f1e8dd',
    coral: '#c97b63', coralInk: '#9a5440', coralLight: '#e59982', card: '#ffffff', frame: '#f3ece3',
    ok: '#5fa563', low: '#f2a341', foot: '#a39587',
    chip: '#faf7f2', chipLine: '#e0d8cb', chipInk: '#444444', lowChip: '#fde8d4', lowLine: '#f0c896', lowInk: '#8a5a2a',
  },
  GENERO: {
    Mujer: { fill: '#f4d4d4', ink: '#884444' },
    Hombre: { fill: '#d4e0ed', ink: '#2c4863' },
    Unisex: { fill: '#d8e4d4', ink: '#3d5c3d' },
  },
};

function money_(n) { return (Number(n) || 0).toFixed(2); }
function plural_(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function clip_(s, max) { s = String(s || ''); return s.length > max ? s.slice(0, max - 1).trim() + '…' : s; }

/** Texto de una línea o párrafos con estilos. */
function txt_(x, y, w, h, paragraphs, opts) {
  opts = opts || {};
  return { t: 'text', x: x, y: y, w: w, h: h, paragraphs: paragraphs, valign: opts.valign || 'TOP', fill: opts.fill, stroke: opts.stroke, shape: opts.shape };
}
function run_(text, size, color, opts) {
  opts = opts || {};
  return { text: String(text), size: size, color: color, font: opts.font || PDF_.SANS, bold: !!opts.bold, italic: !!opts.italic };
}
function para_(runs, align) { return { align: align || 'START', runs: runs }; }
function rect_(x, y, w, h, fill, opts) {
  opts = opts || {};
  return { t: 'rect', x: x, y: y, w: w, h: h, fill: fill, alpha: opts.alpha, stroke: opts.stroke, strokeAlpha: opts.strokeAlpha, shape: opts.shape || 'RECTANGLE', front: !!opts.front };
}

/** Ancho aproximado de un texto corto (para chips y etiquetas). */
function textW_(s, size, bold) { return String(s).length * size * (bold ? 0.62 : 0.56); }

function layoutCatalog_(cards, meta) {
  const P = PDF_, C = P.C;
  const pages = [];
  const brands = {};
  let units = 0;
  cards.forEach((c) => { brands[c.marca] = 1; units += c.total; });

  // Secciones: categoría → género, en bloques de 6
  const sections = [];
  cards.forEach((c) => {
    let s = sections[sections.length - 1];
    if (!s || s.cat !== c.categoria || s.gen !== c.genero) { s = { cat: c.categoria, gen: c.genero, cards: [] }; sections.push(s); }
    s.cards.push(c);
  });
  const per = P.COLS * P.ROWS;
  const catPages = [];
  sections.forEach((s) => {
    for (let i = 0; i < s.cards.length; i += per) {
      catPages.push({ cat: s.cat, gen: s.gen, total: s.cards.length, cont: i > 0, cards: s.cards.slice(i, i + per) });
    }
  });
  // Índice: página donde empieza cada categoría / género (portada = 1, índice = 2)
  const index = [];
  catPages.forEach((p, i) => {
    const pageNo = i + 3;
    let cat = index[index.length - 1];
    if (!cat || cat.cat !== p.cat) { cat = { cat: p.cat, page: pageNo, models: 0, gens: [] }; index.push(cat); }
    if (!p.cont) { cat.models += p.total; cat.gens.push({ gen: p.gen, models: p.total, page: pageNo }); }
  });

  pages.push(coverPage_(cards.length, units, Object.keys(brands).length, meta));
  pages.push(indexPage_(index, catPages.length + 2));
  catPages.forEach((p, i) => pages.push(categoryPage_(p, i + 3, catPages.length + 2)));
  return pages;
}

function coverPage_(models, units, brands, meta) {
  const P = PDF_, C = P.C, W = P.W, H = P.H;
  const els = [
    rect_(W * 0.32, -H * 0.18, W * 0.95, H * 0.62, C.coral, { alpha: 0.14, shape: 'ELLIPSE' }),
    rect_(-W * 0.3, H * 0.62, W * 0.8, H * 0.5, C.coral, { alpha: 0.07, shape: 'ELLIPSE' }),
    txt_(40, H * 0.27, W - 80, 96, [para_([run_('A U R A', 78, '#ffffff', { font: P.SERIF })], 'CENTER')], { valign: 'MIDDLE' }),
    rect_(W / 2 - 32, H * 0.27 + 104, 64, 2, C.coral),
    txt_(40, H * 0.27 + 116, W - 80, 24, [para_([run_('A C T I V E W E A R', 11, '#d18d77', { bold: true })], 'CENTER')]),
  ];
  const boxW = 120, boxH = 82, gap = 16, y = H * 0.55;
  const x0 = (W - (boxW * 3 + gap * 2)) / 2;
  [[models, 'MODELOS\nDISPONIBLES'], [units, 'UNIDADES\nEN STOCK'], [brands, 'MARCAS']].forEach((s, i) => {
    const x = x0 + i * (boxW + gap);
    els.push(rect_(x, y, boxW, boxH, '#ffffff', { alpha: 0.06, stroke: C.coral, strokeAlpha: 0.35 }));
    els.push(txt_(x, y + 6, boxW, 40, [para_([run_(s[0], 32, C.coralLight, { font: P.SERIF, bold: true })], 'CENTER')], { valign: 'MIDDLE' }));
    els.push(txt_(x, y + 44, boxW, 32, [para_([run_(s[1], 7, '#c0b3a5', { bold: true })], 'CENTER')], { valign: 'TOP' }));
  });
  els.push(txt_(40, H - 92, W - 80, 20, [para_([run_('CATÁLOGO DE DISPONIBLES', 9, '#d18d77', { bold: true })], 'CENTER')]));
  els.push(txt_(40, H - 72, W - 80, 20, [para_([run_(meta.fechaLarga, 9, C.foot)], 'CENTER')]));
  return { bg: C.dark, els: els };
}

function indexPage_(index, totalPages) {
  const P = PDF_, C = P.C, W = P.W, H = P.H, M = P.M;
  const els = [
    txt_(M - 6, 40, 300, 44, [para_([run_('Índice', 30, C.ink, { font: P.SERIF, bold: true })])], { valign: 'MIDDLE' }),
    rect_(M, 88, W - 2 * M, 2, C.coral),
  ];
  let y = 108;
  index.forEach((c) => {
    els.push(txt_(M - 6, y, W - 2 * M - 120, 28, [para_([run_(c.cat, 18, C.ink, { font: P.SERIF, bold: true })])], { valign: 'MIDDLE' }));
    els.push(txt_(W - M - 170, y, 176, 28, [para_([run_(plural_(c.models, 'modelo', 'modelos') + '   ·   pág. ' + c.page, 9, C.soft, { bold: true })], 'END')], { valign: 'MIDDLE' }));
    y += 28;
    c.gens.forEach((g) => {
      els.push(txt_(M + 10, y, 220, 18, [para_([run_(g.gen || 'Otros', 10, '#555555')])], { valign: 'MIDDLE' }));
      els.push(txt_(W - M - 170, y, 176, 18, [para_([run_(String(g.models), 10, C.coralInk, { bold: true }), run_('   ·   pág. ' + g.page, 9, C.soft)], 'END')], { valign: 'MIDDLE' }));
      y += 18;
    });
    y += 8;
    els.push(rect_(M, y, W - 2 * M, 0.75, C.line));
    y += 12;
  });

  // Guía de lectura
  const gy = Math.max(y + 16, H - 190);
  els.push(rect_(M, gy, W - 2 * M, 118, C.card, { stroke: C.line }));
  els.push(txt_(M + 10, gy + 10, 300, 20, [para_([run_('Cómo leer el catálogo', 13, C.ink, { font: P.SERIF, bold: true })])]));
  const rows = [
    [{ chip: 'M: 2' }, 'Talla y unidades disponibles de esa talla.'],
    [{ chip: 'S: 1', low: true }, 'Queda 1 sola unidad en esa talla.'],
    [{ tag: '5 disp.', color: C.ok }, 'Total de unidades del modelo (más de 3).'],
    [{ tag: 'Última unidad', color: C.low }, 'Pocas unidades: si te gusta, ¡apártala!'],
  ];
  rows.forEach((r, i) => {
    const ry = gy + 38 + i * 19;
    const k = r[0];
    if (k.chip) els.push(chip_(M + 16, ry, k.chip, k.low));
    else els.push(tag_(M + 16, ry, k.tag, k.color));
    els.push(txt_(M + 100, ry - 3, W - 2 * M - 110, 20, [para_([run_(r[1], 9, '#555555')])], { valign: 'MIDDLE' }));
  });
  els.push(footer_(2, totalPages));
  return { bg: C.bg, els: [].concat.apply([], els) };
}

function chip_(x, y, label, low) {
  const C = PDF_.C;
  const w = Math.max(32, textW_(label, 7.5, true) + 18);  // + márgenes internos de Slides
  return [txt_(x, y, w, 14, [para_([run_(label, 7.5, low ? C.lowInk : C.chipInk, { bold: true })], 'CENTER')],
    { valign: 'MIDDLE', fill: low ? C.lowChip : C.chip, stroke: low ? C.lowLine : C.chipLine, shape: 'ROUND_RECTANGLE' })];
}

function tag_(x, y, label, color, right) {
  const w = textW_(label, 7, true) + 20;
  return [txt_(right ? x - w : x, y, w, 15, [para_([run_(label, 7, PDF_.C.ink, { bold: true })], 'CENTER')],
    { valign: 'MIDDLE', fill: color, shape: 'ROUND_RECTANGLE' })];
}

function footer_(pageNo, total) {
  const P = PDF_, C = P.C;
  return [
    txt_(P.M, P.H - 30, P.W - 2 * P.M, 14, [para_([run_('AURA · ACTIVEWEAR', 7, C.foot, { bold: true })], 'CENTER')], { valign: 'MIDDLE' }),
    txt_(P.W - P.M - 60, P.H - 30, 66, 14, [para_([run_(pageNo + ' / ' + total, 7, C.foot)], 'END')], { valign: 'MIDDLE' }),
  ];
}

function categoryPage_(p, pageNo, totalPages) {
  const P = PDF_, C = P.C, W = P.W, H = P.H, M = P.M;
  const sub = (p.gen ? p.gen.toUpperCase() + ' · ' : '') + (p.cont ? 'CONTINUACIÓN' : plural_(p.total, 'MODELO', 'MODELOS'));
  const els = [
    txt_(M - 6, 26, W - 2 * M - 160, 40, [para_([run_(p.cat || 'Otros', 26, C.ink, { font: P.SERIF, bold: true })])], { valign: 'BOTTOM' }),
    txt_(W - M - 194, 40, 200, 22, [para_([run_(sub, 8, C.soft, { bold: true })], 'END')], { valign: 'BOTTOM' }),
    rect_(M, 68, W - 2 * M, 1.5, C.coral),
  ];
  const top = 82, bottom = H - 46;
  const cw = (W - 2 * M - (P.COLS - 1) * P.GAP) / P.COLS;
  const ch = (bottom - top - (P.ROWS - 1) * P.GAP) / P.ROWS;
  p.cards.forEach((c, i) => {
    const x = M + (i % P.COLS) * (cw + P.GAP);
    const y = top + Math.floor(i / P.COLS) * (ch + P.GAP);
    els.push(cardEls_(c, x, y, cw, ch));
  });
  els.push(footer_(pageNo, totalPages));
  return { bg: C.bg, els: [].concat.apply([], [].concat.apply([], els)) };
}

function cardEls_(c, x, y, w, h) {
  const P = PDF_, C = P.C;
  const pad = 6, fh = Math.round((w - 2 * pad) * 4 / 3);  // foto 3:4
  const els = [
    rect_(x, y, w, h, C.card, { stroke: C.line }),
    rect_(x + pad, y + pad, w - 2 * pad, fh, C.frame),
  ];
  if (c.fileId) els.push({ t: 'image', x: x + pad, y: y + pad, w: w - 2 * pad, h: fh, fileId: c.fileId });
  const gs = P.GENERO[c.genero];
  if (gs) {
    const label = c.genero.toUpperCase();
    els.push(txt_(x + pad + 6, y + pad + 6, textW_(label, 6.5, true) + 20, 14,
      [para_([run_(label, 6.5, gs.ink, { bold: true })], 'CENTER')], { valign: 'MIDDLE', fill: gs.fill, shape: 'ROUND_RECTANGLE' }));
    els[els.length - 1].front = true;
  }
  let ty = y + pad + fh + 6;
  els.push(txt_(x + 3, ty, w - 6, 62, [
    para_([run_(String(c.marca || '').toUpperCase(), 6.5, C.coralInk, { bold: true })]),
    para_([run_(clip_(c.nombre, 62), 9, C.ink, { bold: true })]),
    para_([run_(c.color, 7.5, C.soft)]),
  ]));
  ty += 64;
  // Tallas en chips (pueden ocupar 2 líneas)
  let cx = x + 10;
  c.sizes.forEach((s) => {
    const label = s.talla + ': ' + s.disponible;
    const cwid = Math.max(32, textW_(label, 7.5, true) + 18);
    if (cx + cwid > x + w - 10) { cx = x + 10; ty += 17; }
    els.push(chip_(cx, ty, label, s.disponible <= 1));
    cx += cwid + 4;
  });
  // Pie: precio + stock
  const fy = y + h - 34;
  els.push(rect_(x + 10, fy, w - 20, 0.75, C.lineSoft));
  els.push(txt_(x + 3, fy + 4, w / 2 + 10, 28, [para_([run_('$', 8.5, C.coralInk, { bold: true }), run_(money_(c.precio), 16, C.ink, { font: P.SERIF, bold: true })])], { valign: 'MIDDLE' }));
  const label = c.total > 3 ? c.total + ' disp.' : c.total === 1 ? 'Última unidad' : c.total + ' disp.';
  els.push(tag_(x + w - 10, fy + 10, label, c.total > 3 ? C.ok : C.low, true));
  return els;
}

// ─────────────────────────────────────────────────────────────
//  PDF vertical — dibujo en Google Slides (A4) y exportación
// ─────────────────────────────────────────────────────────────
function apiPdf_() {
  if (typeof Slides === 'undefined') {
    throw new Error('Activa el servicio "Google Slides API" en Apps Script (Servicios → +) para generar el PDF vertical.');
  }
  const inv = readInventory_();
  const cards = buildCards_(inv.items);
  if (!cards.length) throw new Error('No hay productos disponibles para el catálogo.');
  const now = new Date();
  const fechaLarga = fechaLarga_(now);
  const pages = layoutCatalog_(cards, { fechaLarga: fechaLarga });
  const name = 'Catalogo Aura ' + fmt_(now, 'yyyy-MM-dd') + '.pdf';
  const file = renderPdf_(pages, name);
  return {
    ok: true, url: file.getUrl(), download: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
    name: name, fileId: file.getId(), pages: pages.length, models: cards.length,
    units: cards.reduce((n, c) => n + c.total, 0),
  };
}

function fechaLarga_(d) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(d, tz, 'd') + ' de ' + meses[Number(Utilities.formatDate(d, tz, 'M')) - 1] + ' de ' + Utilities.formatDate(d, tz, 'yyyy');
}

function hex_(h) {
  const n = parseInt(String(h).slice(1), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

/** Convierte el plano de páginas en peticiones de la API de Slides. */
function slideRequests_(pages, scale) {
  const k = scale && Math.abs(scale - 1) > 0.01 ? scale : 1;
  const reqs = [];
  const images = [];
  const front = [];
  let n = 0;
  const id = (p) => 'aura_' + p + '_' + (++n);
  const size = (w, h) => ({ width: { magnitude: Math.max(0.5, w * k), unit: 'PT' }, height: { magnitude: Math.max(0.5, h * k), unit: 'PT' } });
  const tf = (x, y) => ({ scaleX: 1, scaleY: 1, translateX: x * k, translateY: y * k, unit: 'PT' });

  pages.forEach((pg, pi) => {
    const sid = 'pagina_' + (pi + 1);
    reqs.push({ createSlide: { objectId: sid, insertionIndex: pi, slideLayoutReference: { predefinedLayout: 'BLANK' } } });
    reqs.push({ updatePageProperties: { objectId: sid, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: hex_(pg.bg) } } } }, fields: 'pageBackgroundFill.solidFill.color' } });
    pg.els.forEach((e) => {
      if (e.t === 'image') { images.push({ slide: sid, x: e.x * k, y: e.y * k, w: e.w * k, h: e.h * k, fileId: e.fileId }); return; }
      const oid = id(e.t === 'rect' ? 'r' : 't');
      const shapeType = e.t === 'text' ? (e.shape || 'TEXT_BOX') : e.shape;
      reqs.push({ createShape: { objectId: oid, shapeType: shapeType, elementProperties: { pageObjectId: sid, size: size(e.w, e.h), transform: tf(e.x, e.y) } } });
      const props = {};
      const fields = [];
      if (e.fill) {
        props.shapeBackgroundFill = { solidFill: { color: { rgbColor: hex_(e.fill) }, alpha: e.alpha == null ? 1 : e.alpha } };
        fields.push('shapeBackgroundFill.solidFill.color', 'shapeBackgroundFill.solidFill.alpha');
      } else if (e.t === 'rect' || e.shape) {
        props.shapeBackgroundFill = { propertyState: 'NOT_RENDERED' }; fields.push('shapeBackgroundFill.propertyState');
      }
      if (e.stroke) {
        props.outline = { outlineFill: { solidFill: { color: { rgbColor: hex_(e.stroke) }, alpha: e.strokeAlpha == null ? 1 : e.strokeAlpha } }, weight: { magnitude: 0.75, unit: 'PT' } };
        fields.push('outline.outlineFill.solidFill.color', 'outline.outlineFill.solidFill.alpha', 'outline.weight');
      } else {
        props.outline = { propertyState: 'NOT_RENDERED' }; fields.push('outline.propertyState');
      }
      if (e.t === 'text') { props.contentAlignment = e.valign || 'TOP'; fields.push('contentAlignment'); }
      reqs.push({ updateShapeProperties: { objectId: oid, shapeProperties: props, fields: fields.join(',') } });
      if (e.front) front.push(oid);
      if (e.t !== 'text') return;
      e.paragraphs.forEach((p) => { if (!p.runs.some((r) => r.text.length)) p.runs = [Object.assign({}, p.runs[0] || run_('', 8, '#000000'), { text: ' ' })]; });
      const text = e.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
      reqs.push({ insertText: { objectId: oid, text: text, insertionIndex: 0 } });
      let at = 0;
      e.paragraphs.forEach((p) => {
        const start = at;
        p.runs.forEach((r) => {
          if (r.text.length) {
            reqs.push({ updateTextStyle: {
              objectId: oid, textRange: { type: 'FIXED_RANGE', startIndex: at, endIndex: at + r.text.length },
              style: { fontFamily: r.font, fontSize: { magnitude: r.size * k, unit: 'PT' }, bold: r.bold, italic: r.italic, foregroundColor: { opaqueColor: { rgbColor: hex_(r.color) } } },
              fields: 'fontFamily,fontSize,bold,italic,foregroundColor',
            } });
          }
          at += r.text.length;
        });
        reqs.push({ updateParagraphStyle: {
          objectId: oid, textRange: { type: 'FIXED_RANGE', startIndex: start, endIndex: at },
          style: { alignment: p.align || 'START', lineSpacing: 100, spaceAbove: { magnitude: 0, unit: 'PT' }, spaceBelow: { magnitude: p === e.paragraphs[e.paragraphs.length - 1] ? 0 : 1.5, unit: 'PT' } },
          fields: 'alignment,lineSpacing,spaceAbove,spaceBelow',
        } });
        at += 1; // salto de línea
      });
    });
  });
  return { reqs: reqs, images: images, front: front };
}

/** Crea una presentación A4 vertical. Si Google ignora el tamaño, usa la plantilla PLANTILLA_PDF. */
function crearPresentacionA4_(title) {
  const P = PDF_;
  const plantilla = PropertiesService.getScriptProperties().getProperty('PLANTILLA_PDF');
  let presId;
  if (plantilla) {
    presId = DriveApp.getFileById(plantilla).makeCopy(title).getId();
  } else {
    presId = Slides.Presentations.create({
      title: title,
      pageSize: { width: { magnitude: P.W, unit: 'PT' }, height: { magnitude: P.H, unit: 'PT' } },
    }).presentationId;
  }
  const pres = Slides.Presentations.get(presId);
  const ps = pres.pageSize || {};
  const toPt = (d) => (d && d.magnitude ? (d.unit === 'EMU' ? d.magnitude / 12700 : d.magnitude) : 0);
  const w = toPt(ps.width), h = toPt(ps.height);
  if (!(h > w)) {
    try { DriveApp.getFileById(presId).setTrashed(true); } catch (e) { /* nada */ }
    throw new Error('Google no aceptó el tamaño vertical. Crea una presentación en blanco, ponle Archivo → Configurar página → ' +
      'Personalizado 21 x 29,7 cm, y guarda su ID en la propiedad PLANTILLA_PDF (ver README).');
  }
  return { presId: presId, existing: (pres.slides || []).map((s) => s.objectId), scale: w / P.W };
}

function renderPdf_(pages, name) {
  const created = crearPresentacionA4_(name.replace(/\.pdf$/, ''));
  const presId = created.presId;
  try {
    const plan = slideRequests_(pages, created.scale);
    const first = created.existing;
    const all = plan.reqs.concat(first.map((oid) => ({ deleteObject: { objectId: oid } })));
    for (let i = 0; i < all.length; i += 400) Slides.Presentations.batchUpdate({ requests: all.slice(i, i + 400) }, presId);

    // Fotos (se ajustan dentro del marco sin deformarse)
    if (plan.images.length) {
      const deck = SlidesApp.openById(presId);
      const bySlide = {};
      deck.getSlides().forEach((s) => { bySlide[s.getObjectId()] = s; });
      const cache = {};
      plan.images.forEach((im) => {
        const blob = cache[im.fileId] || (cache[im.fileId] = photoBlob_(im.fileId, 800));
        if (!blob) return;
        try { bySlide[im.slide].insertImage(blob, im.x, im.y, im.w, im.h); } catch (e) { /* foto no disponible: queda el marco */ }
      });
      deck.saveAndClose();
      if (plan.front.length) {
        Slides.Presentations.batchUpdate({ requests: [{ updatePageElementsZOrder: { pageElementObjectIds: plan.front, operation: 'BRING_TO_FRONT' } }] }, presId);
      }
    }
    const pdf = DriveApp.getFileById(presId).getAs('application/pdf').setName(name);
    const folder = carpeta_();
    folder.getFilesByName(name).hasNext() && trashByName_(folder, name);
    const file = folder.createFile(pdf);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* cuentas de empresa pueden bloquearlo */ }
    return file;
  } finally {
    try { DriveApp.getFileById(presId).setTrashed(true); } catch (e) { /* nada */ }
  }
}

function carpeta_() {
  const it = DriveApp.getFoldersByName(AURA.CARPETA_PDF);
  return it.hasNext() ? it.next() : DriveApp.createFolder(AURA.CARPETA_PDF);
}

function trashByName_(folder, name) {
  const files = folder.getFilesByName(name);
  while (files.hasNext()) files.next().setTrashed(true);
}

/** Para probar desde el editor: Ejecutar → probarPdf. Mira el resultado en "Registro de ejecución". */
function probarPdf() {
  Logger.log(JSON.stringify(apiPdf_(), null, 2));
}
