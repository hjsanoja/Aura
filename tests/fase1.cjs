// Prueba de la fase 1 en Chromium sin ventana, a 390×844 (iPhone 12–15).
// Uso: node tests/fase1.cjs [carpeta_capturas]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { start, BASE } = require('./server.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'capturas'));
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const server = await start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const URL_APP = origin + BASE;
  const browser = await chromium.launch();
  const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' };

  const consoleErrors = [];
  const externalFailures = [];
  const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => { if (!r.url().startsWith(origin)) externalFailures.push(r.url()); });
  };

  // 1) Sin configurar
  let ctx = await browser.newContext(ctxOpts);
  let page = await ctx.newPage();
  watch(page);
  // Simula un config.js sin URL (como recién descargado)
  await page.route(/\/config\.js$/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const API_URL = "PEGAR_AQUI_URL_DE_APPS_SCRIPT";' }));
  await page.goto(URL_APP);
  await page.waitForSelector('.state h2');
  await page.unroute(/\/config\.js$/);
  check('Sin URL configurada muestra instrucciones', (await page.textContent('.state h2')).includes('Falta conectar'), await page.textContent('.state h2'));
  await page.screenshot({ path: path.join(OUT, '1-sin-configurar.png') });

  // 2) Demo ?mock=1
  await page.goto(URL_APP + '?mock=1');
  await page.waitForSelector('.pc:not(.sk)');
  const stats = await page.$$eval('.stats dd', (d) => d.map((x) => x.textContent));
  check('Cabecera: 17 modelos · 35 unidades · 5 marcas', stats.join('/') === '17/35/5', stats.join('/'));
  check('17 tarjetas', (await page.$$('.pc')).length === 17);
  const mostaza = await page.locator('.pc', { hasText: 'Alo Yoga Mostaza' }).locator('.szd').allTextContents();
  check('Agrupa tallas en una tarjeta (S:1 M:2)', mostaza.join(' ') === 'S: 1 M: 2', mostaza.join(' '));
  const sections = await page.$$eval('.sh', (h) => h.map((x) => x.firstChild.textContent.trim()));
  check('Secciones en orden del Sheet', sections.join('|') === 'Conjunto Deportivo|Franela Deportiva|Pantalón deportivo|Short deportivo|Faldas|Medias', sections.join(' | '));
  const franela = await page.locator('.section', { hasText: 'Franela Deportiva' }).locator('.pc .gb').allTextContents();
  check('Dentro de categoría: Mujer antes que Hombre', franela.join(',') === 'Mujer,Mujer,Mujer,Hombre,Hombre', franela.join(','));
  check('Stock verde si > 3', await page.locator('.pc', { hasText: 'Logo Rosa' }).locator('.stk.ok').count() === 1);
  check('"Última unidad" si queda 1', await page.locator('.pc', { hasText: 'Lavanda' }).locator('.stk.low').textContent() === 'Última unidad');
  check('"Actualizado hace…"', (await page.textContent('#updated')).startsWith('Actualizado hace'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '2-catalogo.png') });
  await page.screenshot({ path: path.join(OUT, '3-catalogo-completo.png'), fullPage: true });

  // 3) Filtros y búsqueda
  await page.click('.chip[data-field="genero"][data-value="Hombre"]');
  check('Filtro Hombre → 3 modelos', (await page.textContent('#count')) === '3 modelos');
  await page.evaluate(() => window.scrollTo(0, 330));
  await page.screenshot({ path: path.join(OUT, '4-filtro-hombre.png') });
  await page.click('.chip[data-field="genero"][data-value=""]');
  await page.fill('#q', 'lila');
  await page.waitForTimeout(300);
  check('Búsqueda "lila" → 1 modelo', (await page.textContent('#count')) === '1 modelo');
  await page.fill('#q', 'PANTALON');
  await page.waitForTimeout(300);
  check('Búsqueda sin tildes/mayúsculas', (await page.textContent('#count')) === '1 modelo');
  await page.fill('#q', 'zzzz');
  await page.waitForTimeout(300);
  check('Estado vacío con "Limpiar filtros"', await page.isVisible('text=Limpiar filtros'));
  await page.click('text=Limpiar filtros');
  check('Limpiar filtros restaura 17', (await page.textContent('#count')) === '17 modelos');

  // 4) Service worker y manifest
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('.pc:not(.sk)');
  const sw = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { active: !!(r && r.active), scope: r && r.scope, controlled: !!navigator.serviceWorker.controller };
  });
  check('Service worker registrado y controlando', sw.active && sw.controlled, sw.scope);
  check('Scope del SW = subcarpeta', sw.scope === URL_APP);
  const man = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const m = await (await fetch(href)).json();
    const icons = await Promise.all(m.icons.map(async (i) => (await fetch(new URL(i.src, href))).ok));
    return { m, icons };
  });
  check('Manifest válido (start_url/scope "./", standalone, íconos 192/512/maskable)',
    man.m.start_url === './' && man.m.scope === './' && man.m.display === 'standalone' &&
    man.m.icons.some((i) => i.sizes === '192x192') && man.m.icons.some((i) => i.purpose === 'maskable') && man.icons.every(Boolean));
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  check('Chrome la considera instalable', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));
  const appleIcon = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=apple-touch-icon]').href)).ok);
  check('apple-touch-icon disponible', appleIcon);

  // 5) Menú
  await page.click('#menuBtn');
  await page.waitForSelector('#menu[open]');
  await page.screenshot({ path: path.join(OUT, '5-menu.png') });
  await page.click('#menu [data-act="update"]');
  await page.waitForSelector('.toast >> text=última versión', { timeout: 8000 }).then(() => check('Buscar actualización responde', true)).catch(() => check('Buscar actualización responde', false));

  // 6) Sin conexión: abre desde caché y muestra la última copia
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.pc:not(.sk)');
  await page.waitForSelector('#banner:not([hidden])');
  check('Sin conexión: abre y muestra aviso', (await page.textContent('#banner')).startsWith('Sin conexión · mostrando copia de'), await page.textContent('#banner'));
  check('Sin conexión: mantiene las 17 tarjetas', (await page.$$('.pc')).length === 17);
  await page.screenshot({ path: path.join(OUT, '6-sin-conexion.png') });
  await ctx.setOffline(false);
  await ctx.close();

  // 7) Cargando (esqueletos) y error de red sin copia guardada
  ctx = await browser.newContext(ctxOpts);
  page = await ctx.newPage();
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/mock/catalog.json', async (route) => { await gate; route.abort('internetdisconnected'); });
  await page.goto(URL_APP + '?mock=1');
  await page.waitForSelector('.sk');
  await page.screenshot({ path: path.join(OUT, '7-cargando.png') });
  release();
  await page.waitForSelector('.state[role=alert]');
  check('Error de red muestra "Reintentar"', await page.isVisible('text=Reintentar'));
  await page.screenshot({ path: path.join(OUT, '8-error-red.png') });
  await page.unroute('**/mock/catalog.json');
  await page.click('text=Reintentar');
  await page.waitForSelector('.pc:not(.sk)');
  check('Reintentar carga el catálogo', (await page.$$('.pc')).length === 17);

  // 8) Error del servidor {ok:false}
  await page.route('**/mock/catalog.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'La hoja "Inventario" no existe.' }) }));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.state[role=alert]');
  check('Error del servidor se muestra tal cual', (await page.textContent('.state p')).includes('La hoja "Inventario" no existe.'));
  await ctx.close();

  // 9) Pantalla grande
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  await page.goto(URL_APP + '?mock=1');
  await page.waitForSelector('.pc:not(.sk)');
  const cols = await page.$eval('.grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  check('4 columnas en pantalla grande', cols === 4, String(cols));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, '9-escritorio.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  check('Sin scroll horizontal', !overflow);
  await ctx.close();

  // Consola
  const own = consoleErrors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(e));
  check('Sin errores de JavaScript en consola', own.length === 0, own.join(' | '));
  const resErr = consoleErrors.length - own.length;
  console.log(`ℹ️  Errores de carga de recursos (esperados en pruebas sin red/abort): ${resErr}; externos fallidos: ${new Set(externalFailures.map((u) => new URL(u).host)).size ? [...new Set(externalFailures.map((u) => new URL(u).host))].join(', ') : 'ninguno'}`);

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas. Capturas en ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
