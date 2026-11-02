// Prueba del modo admin en Chromium sin ventana a 390×844.
// Usa un Apps Script "de mentira" (mock/fake-api.js) que responde en lugar de
// script.google.com, con las mismas cabeceras CORS que el real.
// Uso: node tests/fase2.cjs [carpeta_capturas]
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
  let fake = createFakeApi(seed.items, { version: 1 });

  const server = await start();
  const URL_APP = `http://127.0.0.1:${server.address().port}${BASE}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });

  // ── Apps Script de mentira ──
  const log = [];            // peticiones recibidas
  const inject = [];         // respuestas forzadas para las próximas acciones admin: null = normal, 'abort' = sin red
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  // Nota: el Apps Script real responde con una redirección 302 que el navegador sigue solo;
  // Playwright no puede interceptar ese segundo salto, así que respondemos directo.
  await ctx.route('https://script.google.com/**', async (route) => {
    const req = route.request();
    const headers = req.headers();
    const body = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    log.push({ method: req.method(), contentType: headers['content-type'], body });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 405, headers: cors, body: '' });
    const forced = inject.length && body.action !== 'catalog' && body.action !== 'admin_catalog' ? inject.shift() : null;
    if (forced === 'abort') return route.abort('internetdisconnected');
    const res = forced || fake.handle(body);
    route.fulfill({ status: 200, headers: cors, body: JSON.stringify(res) });
  });

  const consoleErrors = [];
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  const toastText = () => page.locator('.toast').last().textContent();
  const units = async () => Number(await page.textContent('#stUnits'));
  const card = (text) => page.locator('.pc', { hasText: text });
  const chips = (text) => card(text).locator('.szd').allTextContents();
  const calls = (action) => log.filter((l) => l.body.action === action);
  const openSell = async (text) => {
    await card(text).scrollIntoViewIfNeeded();
    await card(text).locator('.sell-btn').click();
    await page.waitForSelector('#sellSheet[open]');
  };

  // 1) Catálogo público desde el "Apps Script"
  await page.goto(URL_APP);
  await page.waitForSelector('.pc:not(.sk)');
  check('Catálogo real (ruta Apps Script) carga 17 tarjetas', (await page.$$('.pc')).length === 17);
  check('Sin sesión no hay botones Vender ni barra inferior', (await page.$$('.sell-btn')).length === 0 && await page.isHidden('#adminNav'));
  check('GET catalog sin cabeceras extra', log[0].method === 'GET' && log[0].body.action === 'catalog');

  // 2) PIN incorrecto
  await page.click('#lockBtn');
  await page.fill('#pin', '9999');
  await page.click('#loginSubmit');
  await page.waitForSelector('#loginError:not([hidden])');
  check('PIN incorrecto muestra el error del servidor', (await page.textContent('#loginError')) === 'PIN incorrecto.');
  await shot(page, '10-login-error.png');

  // 3) Login correcto y recordar
  await page.fill('#pin', '1234');
  await page.check('#remember');
  await page.click('#loginSubmit');
  await page.waitForSelector('#hello:not([hidden])');
  await page.waitForSelector('.sell-btn:not([disabled])');
  check('Login: "Hola, Demo" y barra inferior Catálogo/Ventas/PDF', (await page.textContent('#hello')) === 'Hola, Demo' && await page.isVisible('#adminNav'));
  check('Un solo botón Vender por producto', (await card('Alo Yoga Mostaza').locator('.sell-btn').count()) === 1);
  const loginReq = log.find((l) => l.body.action === 'login' && l.body.pin === '1234');
  check('POST text/plain;charset=utf-8 (sin preflight CORS)', loginReq.method === 'POST' && loginReq.contentType === 'text/plain;charset=utf-8' && !log.some((l) => l.method === 'OPTIONS'), loginReq.contentType);
  check('Usa admin_catalog con sesión', calls('admin_catalog').length === 1);
  check('PIN recordado en este dispositivo', await page.evaluate(() => !!localStorage.getItem('aura.session.v1')));
  await page.waitForTimeout(4200); // que se vaya el aviso de bienvenida
  await shot(page, '11-admin-catalogo.png');

  // 4) dup:true
  const dupBtn = card('Medias Nike Azul Claro').locator('.sell-btn');
  check('dup:true → botón deshabilitado "Revisar en el Sheet"', await dupBtn.isDisabled() && (await dupBtn.textContent()) === 'Revisar en el Sheet');
  check('dup:true → aviso "Código+talla repetido"', (await card('Medias Nike Azul Claro').locator('.dup-note').textContent()).includes('Código+talla repetido (M): corrígelo en el Sheet'));
  await card('Medias Nike Azul Claro').scrollIntoViewIfNeeded();
  await shot(page, '12-dup.png');

  // 5) Una sola talla: queda elegida, precio cobrado y nota, doble toque
  const before = await units();
  await openSell('Top y Leggings Lavanda');
  check('Una sola talla disponible: queda elegida', (await page.getAttribute('.size-opt[data-key="CJ-ALO-LAV|S"]', 'aria-checked')) === 'true');
  check('Precio prellenado con el de lista', (await page.inputValue('#sellPrice')) === '22.00');
  check('Cantidad máx. 1: "+" deshabilitado', await page.isDisabled('#qtyPlus') && (await page.textContent('#qtyLabel')) === 'Cantidad (máx. 1)');
  await page.fill('#sellPrice', '20,5');
  await page.fill('#sellNote', 'Cliente Ana');
  check('Botón muestra el total', (await page.textContent('#sellSubmit')) === 'Vender 1 unidad · $20.50');
  await page.locator('#sellSubmit').dblclick(); // doble toque: solo debe registrar una
  await page.waitForSelector('.toast >> text=Vendiste');
  check('Doble toque registra una sola venta', calls('sell').length === 1, String(calls('sell').length));
  const s1 = calls('sell')[0].body;
  check('Envía key, precio cobrado y nota', s1.key === 'CJ-ALO-LAV|S' && s1.precio === 20.5 && s1.nota === 'Cliente Ana', JSON.stringify(s1));
  check('Tarjeta actualizada sin recargar (Agotado)', (await card('Top y Leggings Lavanda').locator('.stk').textContent()) === 'Agotado');
  check('No recargó el catálogo', calls('admin_catalog').length === 1);
  check('Cabecera: unidades −1', (await units()) === before - 1, `${before} → ${await units()}`);
  await page.click('.toast button:has-text("Deshacer")');
  await page.waitForSelector('.toast >> text=Venta anulada');
  check('Deshacer devuelve la unidad', (await card('Top y Leggings Lavanda').locator('.stk').textContent()) === 'Última unidad' && (await units()) === before);

  // 6) Varias tallas y varias unidades
  await openSell('Nike Blancas con Logo Rosa');
  check('Varias tallas: pide elegir talla', (await page.textContent('#sellSubmit')) === 'Elige una talla' && await page.isDisabled('#sellSubmit'));
  await page.click('.size-opt[data-key="ME-NIK-BRO|M"]');
  await page.click('#qtyPlus');
  await page.click('#qtyPlus');
  check('Cantidad sube hasta el disponible (3)', (await page.textContent('#qty')) === '3' && await page.isDisabled('#qtyPlus'));
  check('Total: 3 × $2.50 = $7.50', (await page.textContent('#sellTotal')).includes('3 × $2.50') && (await page.textContent('#sellTotal')).includes('$7.50'));
  check('Botón "Vender 3 unidades · $7.50"', (await page.textContent('#sellSubmit')) === 'Vender 3 unidades · $7.50');
  await page.fill('#sellNote', 'Pedido Instagram');
  await shot(page, '13-hoja-venta.png');
  await page.click('#sellSubmit');
  await page.waitForSelector('.toast >> text=Vendiste 3 ×');
  const multi = calls('sell').slice(1);
  check('Registra 3 ventas de 1 unidad', multi.length === 3 && multi.every((c) => c.body.key === 'ME-NIK-BRO|M' && c.body.precio === 2.5));
  check('Nota de cada unidad: "… · unidad i de 3"', multi.map((c) => c.body.nota).join('|') === 'Pedido Instagram · unidad 1 de 3|Pedido Instagram · unidad 2 de 3|Pedido Instagram · unidad 3 de 3');
  check('Tarjeta: M agotada, quedan 2', (await chips('Logo Rosa')).join(' ') === 'M: 0 L: 2' && (await card('Logo Rosa').locator('.stk').textContent()) === '2 disp.');
  check('Aviso con total y Deshacer', (await toastText()).includes('$7.50') && await page.isVisible('.toast button:has-text("Deshacer")'));
  await shot(page, '14-venta-deshacer.png');
  await page.click('.toast button:has-text("Deshacer")');
  await page.waitForSelector('.toast >> text=3 unidades volvieron al stock');
  check('Deshacer anula las 3', calls('undo').length === 1 + 3 && (await chips('Logo Rosa')).join(' ') === 'M: 3 L: 2');

  // 7) Falla a mitad: se registra lo que se pudo y se avisa
  await openSell('Dri-FIT Lila');
  await page.click('.size-opt[data-key="FR-NIK-LIL|S"]');
  await page.click('#qtyPlus');
  inject.push(null, { ok: false, error: 'La hoja "Ventas" está protegida.' });
  await page.click('#sellSubmit');
  await page.waitForSelector('.toast.err >> text=Solo se registraron 1 de 2');
  check('Falla a mitad: avisa "Solo se registraron 1 de 2" con el motivo', (await toastText()).includes('La hoja "Ventas" está protegida.') && await page.isVisible('.toast.err button:has-text("Deshacer")'));
  check('Falla a mitad: la tarjeta refleja la que sí se vendió', (await chips('Dri-FIT Lila')).includes('S: 1'));

  // 8) Errores dentro de la hoja
  await openSell('Short Deportivo Alo Yoga');
  await page.fill('#sellPrice', 'abc');
  await page.click('#sellSubmit');
  check('Precio inválido: aviso en la hoja', (await page.textContent('#sellError')).startsWith('Escribe un precio válido'));
  await page.fill('#sellPrice', '19');
  inject.push({ ok: false, error: 'La hoja "Ventas" está protegida.' });
  await page.click('#sellSubmit');
  await page.waitForFunction(() => document.querySelector('#sellError').textContent.includes('protegida'));
  check('Error del servidor se muestra tal cual', (await page.textContent('#sellError')) === 'La hoja "Ventas" está protegida.');
  inject.push('abort');
  await page.click('#sellSubmit');
  await page.waitForFunction(() => document.querySelector('#sellError').textContent.includes('conexión'));
  check('Fallo de red: "Necesitas conexión para registrar ventas"', (await page.textContent('#sellError')).startsWith('Necesitas conexión para registrar ventas'));
  await shot(page, '15-venta-error.png');
  await page.click('#sellSheet [data-close]');

  // 9) El aviso Deshacer desaparece a los 8 s
  await openSell('Alo Yoga Mostaza');
  await page.click('.size-opt[data-key="CJ-ALO-MOS|S"]');
  await page.click('#sellSubmit');
  await page.waitForSelector('.toast >> text=Vendiste 1 ×');
  await page.waitForTimeout(8300);
  check('Deshacer desaparece tras 8 s', (await page.locator('.toast', { hasText: 'Vendiste 1 ×' }).count()) === 0);

  // 10) Mostrar agotados (en el panel de filtros)
  await page.evaluate(() => window.scrollTo(0, 0));
  const visibleBefore = (await page.$$('.pc')).length;
  await page.click('#filterBtn');
  await page.click('#soldOutWrap');
  await shot(page, '16a-filtros-admin.png');
  await page.click('#filterApply');
  const visibleAfter = (await page.$$('.pc')).length;
  check('Mostrar agotados añade los agotados en gris', visibleAfter === visibleBefore + 2 && (await page.$$('.pc.out')).length === 2, `${visibleBefore} → ${visibleAfter}`);
  check('Globo de Filtros cuenta "agotados"', (await page.textContent('#filterBadge')) === '1');
  check('Agotados: talla L de Mostaza tachada', (await chips('Alo Yoga Mostaza')).includes('L: 0') && (await card('Alo Yoga Mostaza').locator('.szd.out').count()) >= 1);
  await card('Pantalón Deportivo Adidas').scrollIntoViewIfNeeded();
  await shot(page, '16-agotados.png');
  await page.click('#clearAll');
  check('"Limpiar filtros" oculta agotados', (await page.$$('.pc')).length === visibleBefore);

  // 11) Ventas y anular
  await page.click('#tabSales');
  await page.waitForSelector('.sale');
  check('Pestaña Ventas marcada', (await page.getAttribute('#tabSales', 'aria-current')) === 'page');
  check('Ventas pide hasta 500 (para filtrar por periodo)', calls('sales').pop().body.limit === 500);
  const total = (await page.$$('.sale')).length;
  const voids = (await page.$$('.sale.void')).length;
  check('Lista: 6 ventas (2 activas, 4 anuladas)', total === 6 && voids === 4, `${total}/${voids}`);
  check('Agrupadas por día ("Hoy" con su total)', (await page.textContent('.day span')) === 'Hoy' && (await page.textContent('.day')).includes('$41.00'));
  const kpis = await page.$$eval('.kpi', (k) => k.map((x) => x.textContent));
  check('Resumen: $41.00 cobrado · 2 unidades', kpis[0].includes('$41.00') && kpis[1].includes('2') && kpis[1].includes('2 ventas'), kpis.join(' | '));
  check('Muestra precio cobrado, quién y nota', (await page.textContent('.sales')).includes('Demo') && (await page.textContent('#content')).includes('$20.50') && (await page.textContent('#content')).includes('Cliente Ana'));
  await shot(page, '17-ventas.png');
  await page.click('[data-void]'); // la más reciente: Mostaza S
  await page.waitForSelector('#confirmSheet[open]');
  await shot(page, '18-confirmar-anular.png');
  await page.click('#confirmOk');
  await page.waitForSelector('.toast >> text=Venta anulada');
  await page.waitForFunction(() => document.querySelectorAll('.sale.void').length === 5);
  check('Anular desde la lista', (await page.$$('[data-void]')).length === 1);
  await page.click('#tabCatalog');
  check('Al volver al catálogo, la unidad anulada volvió', (await chips('Alo Yoga Mostaza')).join(' ') === 'S: 1 M: 2');

  // 12) Sin conexión en modo admin
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForSelector('#banner:not([hidden])');
  check('Sin conexión: aviso "Necesitas conexión para registrar ventas"', (await page.textContent('#banner')).includes('Necesitas conexión para registrar ventas'));
  await card('Alo Yoga Mostaza').locator('.sell-btn').click();
  check('Sin conexión: Vender no abre la hoja', !(await page.isVisible('#sellSheet[open]')) && (await toastText()).includes('Necesitas conexión'));
  await shot(page, '19-admin-sin-conexion.png');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // 13) Sesión recordada al reabrir
  await page.reload();
  await page.waitForSelector('#hello:not([hidden])');
  await page.waitForSelector('.sell-btn:not([disabled])');
  check('Sesión recordada al reabrir la app', (await page.textContent('#hello')) === 'Hola, Demo');

  // 14) Cerrar sesión (desde el menú)
  await page.click('#menuBtn');
  await page.click('#logoutBtn');
  await page.waitForSelector('#lockBtn:not([hidden])');
  check('Cerrar sesión: catálogo público y olvida el PIN', (await page.$$('.sell-btn')).length === 0 && await page.isHidden('#adminNav') && await page.evaluate(() => !localStorage.getItem('aura.session.v1') && !localStorage.getItem('aura.admin.v1')));

  // 15) Bloqueo tras 8 PIN fallidos
  fake = createFakeApi(seed.items, { version: 1 });
  await page.click('#lockBtn');
  for (let i = 0; i < 8; i++) {
    await page.fill('#pin', '000' + i);
    await page.click('#loginSubmit');
    await page.waitForFunction(() => document.querySelector('#loginSubmit').textContent === 'Entrar' && !document.querySelector('#loginSubmit').disabled);
  }
  await page.fill('#pin', '1234');
  await page.click('#loginSubmit');
  await page.waitForFunction(() => document.querySelector('#loginError').textContent.includes('Demasiados'));
  check('Bloqueo tras 8 fallos: mensaje tal cual', (await page.textContent('#loginError')).startsWith('Demasiados intentos fallidos'));
  await shot(page, '20-bloqueo.png');
  await page.click('#loginSheet [data-close]');

  // 16) PIN cambiado: la sesión recordada se cierra con aviso
  await page.evaluate(() => localStorage.setItem('aura.session.v1', JSON.stringify({ user: 'Demo', pin: '4321' })));
  fake = createFakeApi(seed.items, { version: 1 });
  await page.reload();
  await page.waitForSelector('#lockBtn:not([hidden])');
  await page.waitForSelector('.toast.err');
  check('PIN guardado ya no vale → cierra sesión con aviso', (await toastText()).includes('PIN incorrecto') && await page.evaluate(() => !localStorage.getItem('aura.session.v1')));

  // 17) Demo ?mock=1 también permite practicar
  const p2 = await ctx.newPage();
  await p2.goto(URL_APP + '?mock=1');
  await p2.waitForSelector('.pc:not(.sk)');
  await p2.click('#lockBtn');
  await p2.fill('#pin', '1234');
  await p2.click('#loginSubmit');
  await p2.waitForSelector('.sell-btn:not([disabled])');
  await p2.locator('.pc', { hasText: 'Lavanda' }).locator('.sell-btn').click();
  await p2.click('#sellSubmit');
  await p2.waitForSelector('.toast >> text=Vendiste');
  check('Demo ?mock=1: login 1234 y venta funcionan', true);
  await p2.close();

  const own = consoleErrors.filter((e) => !/Failed to load resource|net::/.test(e));
  check('Sin errores de JavaScript en consola', own.length === 0, own.join(' | '));

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas. Capturas en ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
