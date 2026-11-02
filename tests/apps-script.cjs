// Prueba del Apps Script (apps-script/Codigo.gs) con un Sheet simulado en memoria.
// También dibuja una vista previa del PDF vertical para revisarlo sin Google.
// Uso: node tests/apps-script.cjs [carpeta_capturas]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'capturas'));
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

// ── Sheet simulado (mismas columnas que Inventario_Aura) ──
const INV_HEADERS = ['Imagen', 'driveLink', 'Código QR', 'Nombre', 'Marca', 'Codigo', 'Color', 'Talla', 'Genero', 'Categoria', 'Proveedor', 'Costo', 'Inversion', 'Precio', 'Ganacia brutal', 'Stock', 'MinStock', 'Descripcion', 'Alerta Inconsistencia', 'VENDIDA', 'USD VENDIDOS', 'Disponible'];
const VENTAS_HEADERS = ['ID', 'Fecha', 'Clave', 'Código', 'Talla', 'Producto', 'Precio catálogo', 'Precio cobrado', 'Vendió', 'Estado', 'Anulada el', 'Anulada por', 'Nota'];

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows.map((r) => r.slice()); }
  width() { return Math.max(0, ...this.rows.map((r) => r.length)); }
  getDataRange() { const w = this.width(); return { getValues: () => this.rows.map((r) => { const c = r.slice(); while (c.length < w) c.push(''); return c; }) }; }
  getLastColumn() { return this.width(); }
  getLastRow() { return this.rows.length; }
  getRange(r, c, nr = 1, nc = 1) {
    const self = this;
    const ensure = (rr) => { while (self.rows.length < rr) self.rows.push([]); };
    return {
      setValue(v) { ensure(r); const row = self.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; },
      getValue() { return (self.rows[r - 1] || [])[c - 1] ?? ''; },
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = self.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] ?? ''); out.push(o); } return out; },
      setValues(vals) { vals.forEach((vr, i) => vr.forEach((v, j) => self.getRange(r + i, c + j).setValue(v))); },
    };
  }
  appendRow(row) { this.rows.push(row.slice()); }
}

function seedInventory() {
  const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mock', 'catalog.json'), 'utf8'));
  const rows = [INV_HEADERS];
  const add = (it, { stock, vendida, costo }) => {
    const r = new Array(INV_HEADERS.length).fill('');
    const set = (h, v) => { r[INV_HEADERS.indexOf(h)] = v; };
    set('driveLink', `https://drive.google.com/file/d/${it.fileId}/view`);
    set('Nombre', it.nombre); set('Marca', it.marca); set('Codigo', it.codigo); set('Color', it.color); set('Talla', it.talla);
    set('Genero', it.genero); set('Categoria', it.categoria); set('Costo', costo); set('Inversion', costo * stock);
    set('Precio', it.precio); set('Stock', stock); set('VENDIDA', vendida || ''); set('Descripcion', `Descripción de ${it.nombre}`);
    set('Disponible', stock - (vendida || 0));
    rows.push(r);
  };
  cat.items.forEach((it) => add(it, { stock: it.disponible + 1, vendida: 1, costo: it.precio > 5 ? 8 : 1 }));
  // agotado + código repetido
  add({ ...cat.items[0], codigo: 'PA-ADI-BEI', talla: 'M', nombre: 'Pantalón Deportivo Adidas', categoria: 'Pantalón deportivo', genero: 'Hombre', color: 'Beige', precio: 20, fileId: '1tFKoBQmR2wKXs4NM6KChGjEty7BmuqzA' }, { stock: 1, vendida: 1, costo: 12 });
  add({ ...cat.items[0], codigo: 'DUP-1', talla: 'M', nombre: 'Medias repetidas A' }, { stock: 1, vendida: 0, costo: 1 });
  add({ ...cat.items[0], codigo: 'DUP-1', talla: 'M', nombre: 'Medias repetidas B' }, { stock: 1, vendida: 0, costo: 1 });
  return rows;
}

function makeEnv({ props = { PIN_Nando: '1234', PIN_Socio: '5678' } } = {}) {
  const sheets = {
    Inventario: new Sheet('Inventario', seedInventory()),
    Ventas: new Sheet('Ventas', [VENTAS_HEADERS, ['9cd42bb6', '1/11/2026 20:25:53', 'NIK-MV2-239-M|M', 'NIK-MV2-239-M', 'M', 'Medias Nike Color Vino', 2.5, 2.5, 'Nando', 'Anulada', '2026-11-01 20:26', 'Nando', 'Prueba']]),
  };
  const cache = new Map();
  const pad = (n) => String(n).padStart(2, '0');
  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = new Sheet(n, [])) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }), getProperty: (k) => props[k] ?? null }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      formatDate: (d, tz, p) => p.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
        .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace(/^d$/, String(d.getDate())).replace(/^M$/, String(d.getMonth() + 1)),
    },
    Session: { getScriptTimeZone: () => 'America/Caracas' },
    UrlFetchApp: { fetch: () => { throw new Error('sin red'); } },
    ScriptApp: { getOAuthToken: () => 'x' },
    Logger: { log: () => {} },
    Slides: {},
    DriveApp: { getFileById: (id) => ({ getBlob: () => ({ getBytes: () => Buffer.from('JPEGDATA-' + id), getContentType: () => 'image/jpeg' }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Codigo.gs'), 'utf8') + '\n;globalThis.PDF_ = PDF_; globalThis.AURA = AURA;', ctx);
  const get = (params) => JSON.parse(ctx.doGet({ parameter: params }).body);
  const postReq = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  return { ctx, sheets, get, post: postReq };
}

const INV = (env) => env.sheets.Inventario;
const cell = (sheet, row, header) => sheet.rows[row - 1][sheet.rows[0].indexOf(header)];
const rowOfKey = (env, key) => INV(env).rows.findIndex((r, i) => i > 0 && `${r[5]}|${r[7]}` === key) + 1;

// ── 1) API ──
let env = makeEnv();
const cat = env.get({ action: 'catalog' });
check('catalog: ok y versión 2', cat.ok && cat.version === 2);
check('catalog: solo disponibles', cat.items.length > 0 && cat.items.every((i) => i.disponible > 0) && !cat.items.some((i) => i.key === 'PA-ADI-BEI|M'));
check('catalog: nunca envía costo, inversión ni stock', cat.items.every((i) => !('costo' in i) && !('inversion' in i) && !('stock' in i) && !('vendida' in i)));
check('catalog: clave Codigo|Talla y fileId desde driveLink', cat.items[0].key === 'CJ-ALO-MOS|S' && cat.items[0].fileId === '1enogQP5wMiwmCfrMapD0uC3ktxdiPiI5');
check('catalog: incluye descripción', cat.items[0].descripcion.startsWith('Descripción de'));
check('PIN incorrecto', env.post({ action: 'login', pin: '0000' }).error === 'PIN incorrecto.');
const login = env.post({ action: 'login', pin: '1234' });
check('login con PIN_Nando', login.ok && login.user === 'Nando' && login.version === 2);
const fmt2 = makeEnv({ props: { PIN_Nando: 'Nando=173479', PIN_Valeria: 'Valeria=1903' } });
check('PIN escrito como "Nando=173479" también funciona', fmt2.post({ action: 'login', pin: '173479' }).user === 'Nando' && fmt2.post({ action: 'login', pin: '1903' }).user === 'Valeria');
check('Formato PINS = "Nando=1, Valeria=2"', makeEnv({ props: { PINS: 'Nando=111, Valeria=222' } }).post({ action: 'login', pin: '222' }).user === 'Valeria');
const diag = env.ctx.diagnosticoAura();
check('diagnosticoAura: detecta el código nuevo y los PIN', diag[0].startsWith('✅') && diag.some((l) => l.includes('PIN configurados para: Nando, Socio')));
const viejo = makeEnv();
vm.runInContext('function doPost(e) { return pdfViejo(); } function probarPdf() { Logger.log("viejo"); }', viejo.ctx);
const diag2 = viejo.ctx.diagnosticoAura();
check('diagnosticoAura: avisa si otro archivo con código viejo lo pisa', diag2[0].startsWith('❌') && diag2.some((l) => l.includes('OTRO archivo .gs')));
const noPins = makeEnv({ props: {} }).post({ action: 'login', pin: '1234' });
check('Sin PIN configurados: mensaje claro', /No hay PIN configurados/.test(noPins.error));
const adm = env.post({ action: 'admin_catalog', pin: '1234' });
check('admin_catalog: incluye agotados, stock, vendida y dup', adm.items.some((i) => i.key === 'PA-ADI-BEI|M' && i.disponible === 0) && adm.items.filter((i) => i.dup).length === 2 && 'stock' in adm.items[0]);

// Vender con cantidad
const key = 'ME-NIK-BRO|M'; // disponible 3 (stock 4, vendida 1)
const r0 = rowOfKey(env, key);
const sell = env.post({ action: 'sell', pin: '1234', key, cantidad: 2, precio: 2.25, nota: 'Instagram' });
check('sell cantidad 2: ok y disponible 3 → 1', sell.ok && sell.cantidad === 2 && sell.item.disponible === 1, JSON.stringify(sell.item));
check('sell: VENDIDA del Sheet 1 → 3', cell(INV(env), r0, 'VENDIDA') === 3);
const V = env.sheets.Ventas;
check('Ventas: añade la columna "Cantidad"', V.rows[0][13] === 'Cantidad');
const last = V.rows[V.rows.length - 1];
check('Ventas: una fila con cantidad 2, precio, vendió y nota', last[13] === 2 && last[7] === 2.25 && last[8] === 'Nando' && last[9] === 'Activa' && last[12] === 'Instagram' && last[2] === key, JSON.stringify(last));
check('sell: más de lo disponible → "Solo quedan 1 unidad"', /Solo quedan 1 unidad de esta talla/.test(env.post({ action: 'sell', pin: '1234', key, cantidad: 2 }).error || ''));
check('sell: cantidad 0 no vale', env.post({ action: 'sell', pin: '1234', key, cantidad: 0 }).error === 'La cantidad no es válida.');
check('sell: código repetido bloqueado', /repetido/.test(env.post({ action: 'sell', pin: '1234', key: 'DUP-1|M' }).error));
check('sell sin cantidad = 1 (compatible con la app vieja)', env.post({ action: 'sell', pin: '1234', key: 'CJ-ALO-LAV|S' }).cantidad === 1);

// Deshacer
const undo = env.post({ action: 'undo', pin: '5678', saleId: sell.saleId });
check('undo: devuelve las 2 unidades', undo.ok && undo.cantidad === 2 && undo.item.disponible === 3 && cell(INV(env), r0, 'VENDIDA') === 1);
const vr = V.rows.find((r) => r[0] === sell.saleId);
check('undo: Estado Anulada, fecha y quién', vr[9] === 'Anulada' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(vr[10]) && vr[11] === 'Socio');
check('undo dos veces → error', env.post({ action: 'undo', pin: '1234', saleId: sell.saleId }).error === 'Esa venta ya estaba anulada.');

// Ventas
const sales = env.post({ action: 'sales', pin: '1234', limit: 500 });
check('sales: la más reciente primero', sales.sales[0].key === 'CJ-ALO-LAV|S');
const legacy = sales.sales.find((s) => s.id === '9cd42bb6');
check('sales: fecha "1/11/2026 20:25:53" se entiende como 1 de noviembre', new Date(legacy.fecha).getMonth() === 10 && new Date(legacy.fecha).getDate() === 1 && legacy.cantidad === 1);

// Rentabilidad
const st = env.post({ action: 'stats', pin: '1234' });
check('stats: costos solo con PIN y ajuste 15 %', st.ok && st.ajusteCosto === 0.15 && st.items.every((i) => typeof i.costo === 'number'));
check('stats: solo ventas activas', st.sales.length === 1 && st.sales[0].key === 'CJ-ALO-LAV|S');
check('stats sin PIN → error', env.post({ action: 'stats' }).error === 'PIN incorrecto.');

// Foto
check('photo: solo fotos del inventario', env.post({ action: 'photo', pin: '1234', fileId: 'OTRO_ARCHIVO_123456789' }).error === 'Esa foto no pertenece al inventario.');
const ph = env.post({ action: 'photo', pin: '1234', fileId: '1enogQP5wMiwmCfrMapD0uC3ktxdiPiI5' });
check('photo: devuelve la imagen en base64', ph.ok && Buffer.from(ph.data, 'base64').toString().startsWith('JPEGDATA-'));

// Bloqueo
env = makeEnv();
for (let i = 0; i < 8; i++) env.post({ action: 'login', pin: 'x' + i });
check('Bloqueo tras 8 PIN fallidos', /Demasiados intentos/.test(env.post({ action: 'login', pin: '1234' }).error));

// ── 2) PDF vertical: plano de páginas ──
env = makeEnv();
const { ctx } = env;
const inv = ctx.readInventory_();
const cards = ctx.buildCards_(inv.items);
const pages = ctx.layoutCatalog_(cards, { fechaLarga: '2 de noviembre de 2026' });
check('PDF: tamaño A4 vertical (595 × 842 pt)', ctx.PDF_.W < ctx.PDF_.H && Math.round(ctx.PDF_.W) === 595 && Math.round(ctx.PDF_.H) === 842);
check('PDF: portada + índice + páginas de categoría', pages.length >= 3 && pages[0].bg === '#181512');
const cardPages = pages.slice(2);
const perPage = cardPages.map((p) => p.els.filter((e) => e.t === 'image').length);
check('PDF: máximo 6 productos por página', perPage.every((n) => n <= 6), perPage.join(','));
check('PDF: cada producto con foto', perPage.reduce((a, b) => a + b, 0) === cards.length);
const out = [];
pages.forEach((p, i) => p.els.forEach((e) => {
  if (i === 0 && e.shape === 'ELLIPSE') return; // brillos decorativos de la portada
  if (e.x < -0.5 || e.y < -0.5 || e.x + e.w > ctx.PDF_.W + 0.5 || e.y + e.h > ctx.PDF_.H + 0.5) out.push(`p${i + 1}:${e.t}`);
}));
check('PDF: nada se sale de la página', out.length === 0, out.slice(0, 5).join(' '));
const plan = ctx.slideRequests_(pages, 1);
const bad = plan.reqs.filter((r) => (r.updateTextStyle && r.updateTextStyle.textRange.endIndex <= r.updateTextStyle.textRange.startIndex) ||
  (r.updateParagraphStyle && r.updateParagraphStyle.textRange.endIndex <= r.updateParagraphStyle.textRange.startIndex));
check('Slides: rangos de texto válidos', bad.length === 0, String(bad.length));
const ids = plan.reqs.map((r) => (r.createShape || r.createSlide || {}).objectId).filter(Boolean);
check('Slides: IDs únicos y válidos', new Set(ids).size === ids.length && ids.every((x) => /^[a-zA-Z0-9_]{5,50}$/.test(x)));
check('Slides: insígnias de género por encima de la foto', plan.front.length === cards.length);
fs.writeFileSync(path.join(OUT, 'pdf-plan.json'), JSON.stringify({ W: ctx.PDF_.W, H: ctx.PDF_.H, pages }, null, 1));

// ── 3) Vista previa del PDF (aprox. a como lo dibuja Slides) ──
(async () => {
  const { chromium } = require('playwright');
  const fileIds = new Set(cards.map((c) => c.fileId));
  const ph = (id) => {
    // foto simulada 9:16 (como las de Aura) para ver el encaje
    const hue = [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1365"><rect width="768" height="1365" fill="hsl(${hue},25%,88%)"/><rect x="214" y="260" width="340" height="860" rx="60" fill="hsl(${hue},35%,45%)"/></svg>`)}`;
  };
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#888;display:flex;flex-wrap:wrap;gap:16px;padding:16px}
.pg{position:relative;width:${ctx.PDF_.W}pt;height:${ctx.PDF_.H}pt;overflow:hidden}
.e{position:absolute;box-sizing:border-box}
.t{padding:3.6pt 7.2pt;display:flex;flex-direction:column;overflow:visible;line-height:1.15}
.t p{margin:0 0 1.5pt}
.img{display:flex;align-items:center;justify-content:center}.img img{max-width:100%;max-height:100%}
</style></head><body>${pages.map((p) => `<div class="pg" style="background:${p.bg}">${p.els.map((e) => {
    const box = `left:${e.x}pt;top:${e.y}pt;width:${e.w}pt;height:${e.h}pt;`;
    const shape = e.shape === 'ELLIPSE' ? 'border-radius:50%;' : e.shape === 'ROUND_RECTANGLE' ? `border-radius:${Math.min(e.w, e.h) * 0.1667}pt;` : '';
    const fill = e.fill ? `background:${e.fill};opacity:1;` : '';
    const alpha = e.alpha != null ? `background:color-mix(in srgb, ${e.fill} ${Math.round(e.alpha * 100)}%, transparent);` : '';
    const stroke = e.stroke ? `border:0.75pt solid ${e.strokeAlpha != null ? `color-mix(in srgb, ${e.stroke} ${Math.round(e.strokeAlpha * 100)}%, transparent)` : e.stroke};` : '';
    if (e.t === 'image') return `<div class="e img" style="${box}"><img src="${ph(e.fileId)}"></div>`;
    if (e.t === 'rect') return `<div class="e" style="${box}${shape}${fill}${alpha}${stroke}"></div>`;
    const just = { TOP: 'flex-start', MIDDLE: 'center', BOTTOM: 'flex-end' }[e.valign || 'TOP'];
    return `<div class="e t" style="${box}${shape}${fill}${stroke}justify-content:${just}">${e.paragraphs.map((pp) => `<p style="text-align:${{ START: 'left', CENTER: 'center', END: 'right' }[pp.align]}">${pp.runs.map((r) =>
      `<span style="font-family:'${r.font}';font-size:${r.size}pt;color:${r.color};font-weight:${r.bold ? 700 : 400}">${r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</span>`).join('')}</p>`).join('')}</div>`;
  }).join('')}</div>`).join('')}</body></html>`;
  const file = path.join(OUT, 'pdf-preview.html');
  fs.writeFileSync(file, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto('file://' + file);
  await page.waitForTimeout(1500);
  const els = await page.$$('.pg');
  for (let i = 0; i < Math.min(els.length, 4); i++) await els[i].screenshot({ path: path.join(OUT, `pdf-pagina-${i + 1}.png`) });
  // ¿Algún texto se desborda de su caja? (aprox.)
  const overflow = await page.$$eval('.t', (ts) => ts.filter((t) => t.scrollHeight > t.clientHeight + 2 || t.scrollWidth > t.clientWidth + 2).map((t) => t.textContent.slice(0, 30)));
  check('Vista previa: ningún texto se desborda', overflow.length === 0, overflow.slice(0, 6).join(' | '));
  await browser.close();
  check('Vista previa generada', fs.existsSync(file) && fileIds.size > 0);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas. Vista previa en ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
