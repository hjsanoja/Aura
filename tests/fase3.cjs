// Prueba de la fase 3 (Compartir PDF) en Chromium sin ventana a 390×844.
// Usa el Apps Script "de mentira" (mock/fake-api.js) en lugar de script.google.com.
// Uso: node tests/fase3.cjs [carpeta_capturas]
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

  // Contexto con Apps Script de mentira. pdfMode: 'ok' | 'error' | 'hang'
  async function newCtx() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL_APP });
    const fake = createFakeApi(seed.items);
    const api = { log: [], pdfMode: 'ok', pdfDelay: 1500, fake };
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    await ctx.route('https://script.google.com/**', async (route) => {
      const req = route.request();
      const body = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
      api.log.push(body);
      if (body.action === 'pdf') {
        if (api.pdfMode === 'hang') return; // nunca responde
        await new Promise((r) => setTimeout(r, api.pdfDelay));
        if (api.pdfMode === 'error') return route.fulfill({ status: 200, headers, body: JSON.stringify({ ok: false, error: 'No se encontró la carpeta "Catálogos" en Drive.' }) }).catch(() => {});
      }
      route.fulfill({ status: 200, headers, body: JSON.stringify(fake.handle(body)) }).catch(() => {});
    });
    return { ctx, api };
  }
  async function adminPage(ctx, { clock = false } = {}) {
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    if (clock) await page.clock.install();
    await page.addInitScript(() => {
      window.__shared = [];
      window.__shareMode = 'ok';
      navigator.share = async (data) => {
        if (window.__shareMode === 'abort') throw new DOMException('cancelado', 'AbortError');
        window.__shared.push(data);
      };
    });
    await page.goto(URL_APP);
    await page.waitForSelector('.pc:not(.sk)');
    await page.click('#lockBtn');
    await page.fill('#pin', '1234');
    await page.click('#loginSubmit');
    await page.waitForSelector('.sell-btn:not([disabled])');
    return page;
  }
  const pdfCalls = (api) => api.log.filter((b) => b.action === 'pdf').length;

  // 1) Generar, progreso y doble clic
  let { ctx, api } = await newCtx();
  let page = await adminPage(ctx);
  check('Botón "Compartir PDF" visible en modo admin', await page.isVisible('#pdfBtn'));
  await page.click('#pdfBtn');
  await page.waitForSelector('#pdfWorking:not([hidden])');
  check('Muestra "Generando catálogo… puede tardar hasta 1 minuto"', (await page.textContent('.pdf-msg')) === 'Generando catálogo… puede tardar hasta 1 minuto');
  check('Botón cambia a "Generando PDF…"', (await page.textContent('#pdfBtnText')) === 'Generando PDF…');
  await page.evaluate(() => { const b = document.querySelector('#pdfBtn'); b.click(); b.click(); });
  await shot(page, '21-pdf-generando.png');
  await page.waitForSelector('#pdfDone:not([hidden])');
  check('Doble clic no genera dos PDF', pdfCalls(api) === 1, String(pdfCalls(api)));
  const sent = api.log.find((b) => b.action === 'pdf');
  check('Envía action "pdf" con el PIN', sent.pin === '1234');

  // 2) Resultado
  const r = api.fake.handle({ action: 'pdf', pin: '1234' });
  check('Muestra nombre del archivo', (await page.textContent('#pdfName')) === r.name, await page.textContent('#pdfName'));
  check('Muestra páginas, modelos y unidades', (await page.textContent('#pdfMeta')).startsWith('5 páginas · 17 modelos · 35 unidades'), await page.textContent('#pdfMeta'));
  check('"Abrir PDF" apunta a url', (await page.getAttribute('#pdfOpen', 'href')) === r.url);
  check('"Descargar" apunta a download', (await page.getAttribute('#pdfDownload', 'href')) === r.download);
  check('Botón Compartir visible si existe navigator.share', await page.isVisible('#pdfShare'));
  check('Botón vuelve a "Compartir PDF"', (await page.textContent('#pdfBtnText')) === 'Compartir PDF');
  await shot(page, '22-pdf-listo.png');

  // 3) Compartir
  await page.click('#pdfShare');
  const shared = await page.evaluate(() => window.__shared);
  check('navigator.share({title: name, text, url})', shared.length === 1 && shared[0].title === r.name && shared[0].text === 'Catálogo Aura actualizado' && shared[0].url === r.url, JSON.stringify(shared[0]));
  check('Aviso "¡Compartido!"', (await page.textContent('#pdfStatus')) === '¡Compartido!');
  await page.evaluate(() => { window.__shareMode = 'abort'; });
  await page.click('#pdfShare');
  check('Si cierras el menú de compartir no muestra error', (await page.textContent('#pdfStatus')) === '¡Compartido!' && !(await page.$('#pdfStatus.err')));

  // 4) Copiar enlace
  await page.click('#pdfCopy');
  await page.waitForFunction(() => document.querySelector('#pdfStatus').textContent === 'Enlace copiado');
  check('Copiar enlace', (await page.evaluate(() => navigator.clipboard.readText())) === r.url);

  // 5) Reabrir muestra el último PDF sin volver a generarlo; "Generar de nuevo" sí
  await page.click('#pdfClose');
  await page.click('#pdfBtn');
  await page.waitForSelector('#pdfDone:not([hidden])');
  check('Reabrir muestra el último PDF sin generar otro', pdfCalls(api) === 1);
  await page.click('#pdfRegen');
  await page.waitForSelector('#pdfWorking:not([hidden])');
  await page.waitForSelector('#pdfDone:not([hidden])');
  check('"Generar de nuevo" crea otro PDF', pdfCalls(api) === 2);

  // 6) Cerrar mientras genera → aviso cuando está listo
  await page.click('#pdfRegen');
  await page.waitForSelector('#pdfWorking:not([hidden])');
  check('Texto del botón Cerrar mientras genera', (await page.textContent('#pdfClose')) === 'Cerrar (sigue generando)');
  await page.click('#pdfClose');
  await page.waitForSelector('.toast >> text=Tu catálogo PDF está listo');
  check('Aviso "Tu catálogo PDF está listo" al terminar', true);
  await shot(page, '23-pdf-aviso-listo.png');
  await page.click('.toast button:has-text("Ver")');
  await page.waitForSelector('#pdfSheet[open] #pdfDone:not([hidden])');
  check('"Ver" abre el PDF listo', true);
  await page.click('#pdfClose');

  // 7) Error del servidor y Reintentar
  api.pdfMode = 'error';
  await page.click('#pdfBtn');
  await page.click('#pdfRegen');
  await page.waitForSelector('#pdfFail:not([hidden])');
  check('Error del servidor se muestra tal cual', (await page.textContent('#pdfError')) === 'No se encontró la carpeta "Catálogos" en Drive.');
  await shot(page, '24-pdf-error.png');
  api.pdfMode = 'ok';
  await page.click('#pdfRetry');
  await page.waitForSelector('#pdfDone:not([hidden])');
  check('Reintentar funciona', true);
  await page.click('#pdfClose');

  // 8) Sin conexión
  await ctx.setOffline(true);
  await page.click('#pdfBtn');
  await page.click('#pdfRegen');
  await page.waitForSelector('#pdfFail:not([hidden])');
  check('Sin conexión: "Necesitas conexión para generar el PDF."', (await page.textContent('#pdfError')) === 'Necesitas conexión para generar el PDF.');
  await ctx.setOffline(false);
  await page.click('#pdfClose');

  // 9) Salir borra el PDF de la sesión
  await page.click('#logoutBtn');
  check('Sin sesión no hay botón PDF', !(await page.isVisible('#pdfBtn')));
  await ctx.close();

  // 10) Sin navigator.share (p. ej. computador): sin botón Compartir
  ({ ctx, api } = await newCtx());
  page = await adminPage(ctx);
  await page.evaluate(() => { delete navigator.share; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  api.pdfDelay = 200;
  await page.click('#pdfBtn');
  await page.waitForSelector('#pdfDone:not([hidden])');
  check('Sin navigator.share: oculta Compartir y deja Abrir/Descargar/Copiar', !(await page.isVisible('#pdfShare')) && await page.isVisible('#pdfOpen') && await page.isVisible('#pdfDownload') && await page.isVisible('#pdfCopy'));
  await ctx.close();

  // 11) Se corta a los 90 s
  ({ ctx, api } = await newCtx());
  page = await adminPage(ctx, { clock: true });
  api.pdfMode = 'hang';
  await page.click('#pdfBtn');
  await page.waitForSelector('#pdfWorking:not([hidden])');
  await page.clock.fastForward(60000);
  check('A los 60 s sigue esperando', await page.isVisible('#pdfWorking') && (await page.textContent('#pdfElapsed')).includes('s'));
  await page.clock.fastForward(31000);
  await page.waitForSelector('#pdfFail:not([hidden])');
  check('A los 90 s: mensaje claro de tiempo agotado', (await page.textContent('#pdfError')).startsWith('El PDF tardó más de 90 segundos'));
  check('Tras el tiempo agotado se puede reintentar', (await page.textContent('#pdfBtnText')) === 'Compartir PDF' && await page.isVisible('#pdfRetry'));
  await shot(page, '25-pdf-90s.png');
  await ctx.close();

  // 12) Demo ?mock=1
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.goto(URL_APP + '?mock=1');
  await p2.waitForSelector('.pc:not(.sk)');
  await p2.click('#lockBtn');
  await p2.fill('#pin', '1234');
  await p2.click('#loginSubmit');
  await p2.waitForSelector('.sell-btn:not([disabled])');
  await p2.click('#pdfBtn');
  await p2.waitForSelector('#pdfDone:not([hidden])', { timeout: 10000 });
  const demoHref = await p2.getAttribute('#pdfOpen', 'href');
  const demoOk = await p2.evaluate(async (u) => { const res = await fetch(u); return res.ok && res.headers.get('content-type') === 'application/pdf'; }, demoHref);
  check('Demo: genera y enlaza el PDF de ejemplo', demoHref.endsWith('/aura-catalogo/mock/catalogo-demo.pdf') && demoOk, demoHref);
  await ctx2.close();

  const own = consoleErrors.filter((e) => !/Failed to load resource|net::/.test(e));
  check('Sin errores de JavaScript en consola', own.length === 0, own.join(' | '));

  await browser.close();
  server.close();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas. Capturas en ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
