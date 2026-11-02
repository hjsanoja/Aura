// Prueba de las mejoras con el Apps Script v2: venta con cantidad en una fila, filtros de ventas,
// detalle de producto e imagen para redes (Números está oculto). También compatibilidad con v1.
// Uso: node tests/fase4.cjs [carpeta_capturas]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { start, BASE } = require('./server.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'capturas'));
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name) }); };

(async () => {
  const { createFakeApi } = await import('../mock/fake-api.js');
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mock', 'catalog.json'), 'utf8'));
  const server = await start();
  const URL_APP = `http://127.0.0.1:${server.address().port}${BASE}`;
  const browser = await chromium.launch();
  const consoleErrors = [];

  async function setup(version) {
    const fake = createFakeApi(seed.items, { version });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
    const log = [];
    await ctx.route('https://script.google.com/**', (route) => {
      const req = route.request();
      const body = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
      log.push(body);
      route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(fake.handle(body)) });
    });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    await page.addInitScript(() => {
      window.__shared = [];
      navigator.canShare = () => true;
      navigator.share = async (d) => { window.__shared.push({ n: d.files ? d.files.length : 0, type: d.files && d.files[0] && d.files[0].type, name: d.files && d.files[0] && d.files[0].name }); };
    });
    await page.goto(URL_APP);
    await page.waitForSelector('.pc:not(.sk)');
    await page.click('#lockBtn');
    await page.fill('#pin', '1234');
    await page.click('#loginSubmit');
    await page.waitForSelector('.sell-btn:not([disabled])');
    await page.waitForTimeout(4200);
    return { fake, ctx, page, log };
  }
  const card = (page, text) => page.locator('.pc', { hasText: text });
  const calls = (log, a) => log.filter((b) => b.action === a);

  // ── Apps Script v2 ──
  let { fake, ctx, page, log } = await setup(2);
  await page.click('#menuBtn');
  check('Menú indica "Apps Script v2"', (await page.textContent('#versionNote')).includes('Apps Script v2'));
  await page.click('#menu [data-close]');
  check('Fotos con srcset (400w y 800w)', ((await page.getAttribute('.pc img', 'srcset')) || '').includes('800w'));

  // 1) Venta de 3 unidades en una sola llamada
  await card(page, 'Logo Rosa').scrollIntoViewIfNeeded();
  await card(page, 'Logo Rosa').locator('.sell-btn').click();
  await page.click('.size-opt[data-key="ME-NIK-BRO|M"]');
  await page.click('#qtyPlus');
  await page.click('#qtyPlus');
  await page.fill('#sellNote', 'Cliente Luisa');
  await page.click('#sellSubmit');
  await page.waitForSelector('.toast >> text=Vendiste 3 ×');
  const s1 = calls(log, 'sell');
  check('v2: UNA llamada "sell" con cantidad 3', s1.length === 1 && s1[0].cantidad === 3 && s1[0].nota === 'Cliente Luisa', JSON.stringify(s1));
  check('v2: tarjeta M agotada', (await card(page, 'Logo Rosa').locator('.szd').allTextContents()).join(' ') === 'M: 0 L: 2');
  await page.click('.toast button:has-text("Deshacer")');
  await page.waitForSelector('.toast >> text=3 unidades volvieron al stock');
  check('v2: Deshacer = UNA llamada "undo" y vuelven las 3', calls(log, 'undo').length === 1 && (await card(page, 'Logo Rosa').locator('.szd').allTextContents()).join(' ') === 'M: 3 L: 2');

  // 2) Ventas: cantidad, periodo y vendedor
  await card(page, 'Logo Rosa').locator('.sell-btn').click();
  await page.click('.size-opt[data-key="ME-NIK-BRO|L"]');
  await page.click('#qtyPlus');
  await page.click('#sellSubmit');
  await page.waitForSelector('.toast >> text=Vendiste 2 ×');
  fake.handle({ action: 'sell', pin: '5678', key: 'FR-NIK-LIL|M', precio: 17 }); // venta del socio
  const old = new Date(); old.setDate(old.getDate() - 45);
  fake._sales.push({ id: 'V-OLD', fecha: old.toISOString(), key: 'FA-ALO-GRI|L', talla: 'L', producto: 'Falda Short Deportiva · Gris oscuro', precioCatalogo: 19, precioCobrado: 19, cantidad: 1, vendio: 'Demo', estado: 'Activa', nota: '' });
  await page.click('#tabSales');
  await page.waitForSelector('.sale');
  check('Ventas: muestra "2 × $2.50" y total $5.00', (await page.textContent('.sales')).includes('2 × $2.50') && (await page.textContent('.sales')).includes('$5.00'));
  check('Periodo por defecto: 30 días (oculta la venta de hace 45 días)', (await page.$$('.sale')).length === 3);
  check('Resumen 30 días: $22.00 · 3 unidades', (await page.textContent('.kpi')).includes('$22.00') && (await page.$$eval('.kpi', (k) => k[1].textContent)).includes('3'));
  await page.click('[data-sf="periodo"][data-value="todo"]');
  check('Periodo "Todo": aparece la venta antigua', (await page.$$('.sale')).length === 4);
  await page.click('[data-sf="vendio"][data-value="Socio"]');
  check('Filtro por vendedor: solo las del socio', (await page.$$('.sale')).length === 1 && (await page.textContent('.sale')).includes('Socio'));
  await shot(page, '30-ventas-filtros.png');
  await page.click('[data-sf="vendio"][data-value=""]');
  await page.click('[data-sf="periodo"][data-value="hoy"]');
  check('Periodo "Hoy"', (await page.$$('.sale')).length === 3);

  // 3) Números: oculto por ahora
  const tabs = await page.$$eval('#adminNav button', (bs) => bs.filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()));
  check('Barra: solo Catálogo · Ventas · Compartir PDF (Números oculto)', tabs.join(' · ') === 'Catálogo · Ventas · Compartir PDF', tabs.join(' · '));
  check('Números oculto: no se piden costos ("stats")', calls(log, 'stats').length === 0);
  await page.click('#tabCatalog');
  await shot(page, '31-barra-admin.png');

  // 4) Detalle de producto
  await card(page, 'Lavanda').locator('button.pi').click();
  await page.waitForSelector('#detailSheet[open]');
  check('Detalle: foto grande (w1000)', ((await page.getAttribute('#detailImg img', 'src')) || '').includes('sz=w1000'));
  check('Detalle: descripción, tallas y precio', (await page.textContent('#detailBody')).includes('Tela ligera') && (await page.textContent('#detailBody')).includes('S: 1') && (await page.textContent('#detailBody')).includes('22.00'));
  check('Detalle (admin): botones Vender e Imagen para redes', await page.isVisible('[data-dact="sell"]') && await page.isVisible('[data-dact="social"]'));
  await shot(page, '33-detalle.png');
  await page.click('[data-dact="sell"]');
  await page.waitForSelector('#sellSheet[open]');
  check('Detalle → Vender abre la hoja de venta', (await page.textContent('#sellProduct')).includes('Lavanda'));
  await page.click('#sellSheet [data-close]');

  // 5) Imagen para redes
  await card(page, 'Lavanda').locator('button.pi').click();
  await page.click('[data-dact="social"]');
  await page.waitForSelector('#socialDownload:not([hidden])');
  const dims = await page.$eval('#socialCanvas', (c) => [c.width, c.height]);
  check('Historia: 1080 × 1920', dims.join('x') === '1080x1920');
  check('Descarga: archivo …_historia.jpg', ((await page.getAttribute('#socialDownload', 'download')) || '').endsWith('_historia.jpg') && ((await page.getAttribute('#socialDownload', 'href')) || '').startsWith('blob:'));
  check('Pide la foto al Apps Script ("photo")', calls(log, 'photo').length === 1);
  const story = await page.$eval('#socialCanvas', (c) => c.toDataURL('image/jpeg', 0.85));
  fs.writeFileSync(path.join(OUT, '34-historia.jpg'), Buffer.from(story.split(',')[1], 'base64'));
  await shot(page, '35-hoja-redes.png');
  await page.click('[data-format="post"]');
  await page.waitForFunction(() => (document.querySelector('#socialDownload').download || '').endsWith('_post.jpg'));
  check('Publicación: 1080 × 1350 y foto reutilizada', (await page.$eval('#socialCanvas', (c) => `${c.width}x${c.height}`)) === '1080x1350' && calls(log, 'photo').length === 1);
  const post = await page.$eval('#socialCanvas', (c) => c.toDataURL('image/jpeg', 0.85));
  fs.writeFileSync(path.join(OUT, '36-publicacion.jpg'), Buffer.from(post.split(',')[1], 'base64'));
  await page.click('#socialShare');
  await page.waitForFunction(() => window.__shared.length === 1);
  const shared = await page.evaluate(() => window.__shared[0]);
  check('Compartir envía la imagen como archivo JPEG', shared.n === 1 && shared.type === 'image/jpeg' && shared.name.endsWith('_post.jpg'), JSON.stringify(shared));
  await ctx.close();

  // ── Compatibilidad con el Apps Script anterior (v1) ──
  ({ fake, ctx, page, log } = await setup(1));
  await card(page, 'Logo Rosa').locator('.sell-btn').click();
  await page.click('.size-opt[data-key="ME-NIK-BRO|M"]');
  await page.click('#qtyPlus');
  await page.click('#sellSubmit');
  await page.waitForSelector('.toast >> text=Vendiste 2 ×');
  check('v1: 2 unidades = 2 llamadas "sell" (sin "cantidad")', calls(log, 'sell').length === 2 && calls(log, 'sell').every((b) => b.cantidad === undefined));
  await card(page, 'Lavanda').locator('button.pi').click();
  await page.click('[data-dact="social"]');
  await page.waitForSelector('#socialStatus.err');
  check('v1: Imagen para redes explica que falta el Apps Script nuevo', (await page.textContent('#socialStatus')).includes('Apps Script nuevo') && calls(log, 'photo').length === 0);
  await ctx.close();

  // ── Público: el detalle también funciona sin sesión, sin botones de admin ──
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await c3.newPage();
  await p3.goto(URL_APP + '?mock=1');
  await p3.waitForSelector('.pc:not(.sk)');
  await p3.locator('.pc', { hasText: 'Lavanda' }).locator('.pname-btn').click();
  await p3.waitForSelector('#detailSheet[open]');
  check('Público: detalle sin botones de admin', await p3.isHidden('#detailActions'));
  await c3.close();

  const own = consoleErrors.filter((e) => !/Failed to load resource|net::/.test(e));
  check('Sin errores de JavaScript en consola', own.length === 0, own.join(' | '));
  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas. Capturas en ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
