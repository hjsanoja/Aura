// Prueba de la fase 2 (modo admin) en Chromium sin ventana a 390×844.
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
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

(async () => {
  const { createFakeApi } = await import('../mock/fake-api.js');
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mock', 'catalog.json'), 'utf8'));
  let fake = createFakeApi(seed.items);

  const server = await start();
  const URL_APP = `http://127.0.0.1:${server.address().port}${BASE}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });

  // ── Apps Script de mentira ──
  const log = [];          // peticiones recibidas
  let inject = null;       // 'abort' | {ok:false,...} para la próxima acción admin
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  // Nota: el Apps Script real responde con una redirección 302 que el navegador sigue solo;
  // Playwright no puede interceptar ese segundo salto, así que respondemos directo.
  await ctx.route('https://script.google.com/**', async (route) => {
    const req = route.request();
    const headers = req.headers();
    const body = req.method() === 'GET' ? Object.fromEntries(new URL(req.url()).searchParams) : JSON.parse(req.postData() || '{}');
    log.push({ method: req.method(), contentType: headers['content-type'], body });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 405, headers: cors, body: '' });
    let res;
    if (inject && body.action !== 'catalog' && body.action !== 'admin_catalog') {
      const i = inject; inject = null;
      if (i === 'abort') return route.abort('internetdisconnected');
      res = i;
    } else {
      res = fake.handle(body);
    }
    route.fulfill({ status: 200, headers: cors, body: JSON.stringify(res) });
  });

  const consoleErrors = [];
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  const toastText = () => page.locator('.toast').last().textContent();
  const units = async () => Number(await page.textContent('#stUnits'));
  const card = (text) => page.locator('.pc', { hasText: text });

  // 1) Catálogo público desde el "Apps Script"
  await page.goto(URL_APP);
  await page.waitForSelector('.pc:not(.sk)');
  check('Catálogo real (ruta Apps Script) carga 17 tarjetas', (await page.$$('.pc')).length === 17);
  check('Sin sesión no hay botones Vender', (await page.$$('.sell-btn')).length === 0);
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
  check('Login: "Hola, Demo" y botón Salir', (await page.textContent('#hello')) === 'Hola, Demo' && await page.isVisible('#logoutBtn'));
  const loginReq = log.find((l) => l.body.action === 'login' && l.body.pin === '1234');
  check('POST text/plain;charset=utf-8 (sin preflight CORS)', loginReq.method === 'POST' && loginReq.contentType === 'text/plain;charset=utf-8' && !log.some((l) => l.method === 'OPTIONS'), loginReq.contentType);
  check('Usa admin_catalog con sesión', log.some((l) => l.body.action === 'admin_catalog'));
  check('PIN recordado en este dispositivo', await page.evaluate(() => !!localStorage.getItem('aura.session.v1')));
  await page.waitForTimeout(400);
  await shot(page, '11-admin-catalogo.png');

  // 4) dup:true
  const dupBtns = card('Medias Nike Azul Claro').locator('.sell-btn');
  check('dup:true → botón deshabilitado', await dupBtns.first().isDisabled());
  check('dup:true → aviso "Código+talla repetido"', (await card('Medias Nike Azul Claro').locator('.dup-note').textContent()).includes('Código+talla repetido: corrígelo en el Sheet'));
  await card('Medias Nike Azul Claro').scrollIntoViewIfNeeded();
  await shot(page, '12-dup.png');

  // 5) Vender con precio cobrado y nota
  const before = await units();
  await card('Top y Leggings Lavanda').scrollIntoViewIfNeeded();
  await card('Top y Leggings Lavanda').locator('.sell-btn').click();
  await page.waitForSelector('#sellSheet[open]');
  check('Hoja de venta: precio prellenado con el de lista', (await page.inputValue('#sellPrice')) === '22.00');
  await page.fill('#sellPrice', '20,5');
  await page.fill('#sellNote', 'Cliente Ana');
  await page.waitForTimeout(350); // fin de la animación
  await shot(page, '13-hoja-venta.png');
  await page.locator('#sellSubmit').dblclick(); // doble toque: solo debe registrar una
  await page.waitForSelector('.toast >> text=Venta registrada');
  const sells = log.filter((l) => l.body.action === 'sell');
  check('Doble toque registra una sola venta', sells.length === 1, String(sells.length));
  check('Envía key, precio cobrado y nota', sells[0].body.key === 'CJ-ALO-LAV|S' && sells[0].body.precio === 20.5 && sells[0].body.nota === 'Cliente Ana', JSON.stringify(sells[0].body));
  check('Tarjeta actualizada sin recargar (Agotado)', (await card('Top y Leggings Lavanda').locator('.stk').textContent()) === 'Agotado');
  check('No recargó el catálogo', log.filter((l) => l.body.action === 'admin_catalog').length === 1);
  check('Cabecera: unidades −1', (await units()) === before - 1, `${before} → ${await units()}`);
  check('Aviso con botón Deshacer', await page.isVisible('.toast button:has-text("Deshacer")'));
  await shot(page, '14-venta-deshacer.png');

  // 6) Deshacer
  await page.click('.toast button:has-text("Deshacer")');
  await page.waitForSelector('.toast >> text=Venta anulada');
  check('Deshacer llama undo con el saleId', log.some((l) => l.body.action === 'undo' && l.body.saleId === 'V-0001'));
  check('Deshacer devuelve la unidad', (await card('Top y Leggings Lavanda').locator('.stk').textContent()) === 'Última unidad' && (await units()) === before);

  // 7) El aviso Deshacer desaparece a los 8 s
  await card('Alo Yoga Mostaza').locator('.sell-btn').first().click();
  await page.click('#sellSubmit');
  await page.waitForSelector('.toast >> text=Venta registrada');
  await page.waitForTimeout(8300);
  check('Deshacer desaparece tras 8 s', !(await page.isVisible('.toast button:has-text("Deshacer")')));

  // 8) Errores al vender
  await card('Short Deportivo Alo Yoga').scrollIntoViewIfNeeded();
  await card('Short Deportivo Alo Yoga').locator('.sell-btn').click();
  await page.fill('#sellPrice', 'abc');
  await page.click('#sellSubmit');
  check('Precio inválido: aviso en la hoja', (await page.textContent('#sellError')).startsWith('Escribe un precio válido'));
  await page.fill('#sellPrice', '19');
  inject = { ok: false, error: 'La hoja "Ventas" está protegida.' };
  await page.click('#sellSubmit');
  await page.waitForFunction(() => document.querySelector('#sellError').textContent.includes('protegida'));
  check('Error del servidor se muestra tal cual', (await page.textContent('#sellError')) === 'La hoja "Ventas" está protegida.');
  inject = 'abort';
  await page.click('#sellSubmit');
  await page.waitForFunction(() => document.querySelector('#sellError').textContent.includes('conexión'));
  check('Fallo de red: "Necesitas conexión para registrar ventas"', (await page.textContent('#sellError')).startsWith('Necesitas conexión para registrar ventas'));
  await shot(page, '15-venta-error.png');
  await page.click('#sellSheet [data-close]');

  // 9) Mostrar agotados
  const visibleBefore = (await page.$$('.pc')).length;
  await page.click('#soldOutWrap');
  const visibleAfter = (await page.$$('.pc')).length;
  check('Mostrar agotados añade los agotados en gris', visibleAfter === visibleBefore + 2 && (await page.$$('.pc.out')).length === 2, `${visibleBefore} → ${visibleAfter}`);
  check('Agotados: talla L de Mostaza visible, sin botón Vender', (await page.locator('.sell-btn[data-key="CJ-ALO-MOS|L"]').count()) === 0 && (await card('Alo Yoga Mostaza').locator('.sr.out').allTextContents()).join(' ').includes('LAgotado'));
  await card('Pantalón Deportivo Adidas').scrollIntoViewIfNeeded();
  await shot(page, '16-agotados.png');
  await page.click('#soldOutWrap');
  check('Ocultar agotados', (await page.$$('.pc')).length === visibleBefore);

  // 10) Ventas y anular
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#tabSales');
  await page.waitForSelector('.sale');
  const salesReq = log.filter((l) => l.body.action === 'sales').pop();
  check('Ventas pide limit 40', salesReq.body.limit === 40);
  const rows = await page.$$('.sale');
  check('Lista: 2 ventas (1 activa, 1 anulada)', rows.length === 2 && (await page.$$('.sale.void')).length === 1);
  check('Solo las activas tienen "Anular"', (await page.$$('[data-void]')).length === 1);
  check('Muestra precio cobrado, quién y nota', (await page.textContent('.sales')).includes('Demo') && (await page.textContent('.sale.void')).includes('$20.50') && (await page.textContent('.sale.void')).includes('Cliente Ana'));
  await page.waitForTimeout(300);
  await shot(page, '17-ventas.png');
  await page.click('[data-void]');
  await page.waitForSelector('#confirmSheet[open]');
  await page.waitForTimeout(350); // fin de la animación
  await shot(page, '18-confirmar-anular.png');
  await page.click('#confirmOk');
  await page.waitForSelector('.toast >> text=Venta anulada');
  await page.waitForFunction(() => document.querySelectorAll('.sale.void').length === 2);
  check('Anular desde la lista', (await page.$$('[data-void]')).length === 0 && (await page.textContent('.sales-sum')).includes('$0.00'));
  await page.click('#tabCatalog');
  check('Al volver al catálogo, la unidad anulada volvió', (await card('Alo Yoga Mostaza').locator('.sr').first().textContent()).includes('1 disp.') && !(await page.locator('.sell-btn[data-key="CJ-ALO-MOS|S"]').isDisabled()));

  // 11) Sin conexión en modo admin
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForSelector('#banner:not([hidden])');
  check('Sin conexión: aviso "Necesitas conexión para registrar ventas"', (await page.textContent('#banner')).includes('Necesitas conexión para registrar ventas'));
  await card('Alo Yoga Mostaza').locator('.sell-btn').first().click();
  check('Sin conexión: Vender no abre la hoja', !(await page.isVisible('#sellSheet[open]')) && (await toastText()).includes('Necesitas conexión'));
  await shot(page, '19-admin-sin-conexion.png');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // 12) Sesión recordada al reabrir
  await page.reload();
  await page.waitForSelector('#hello:not([hidden])');
  await page.waitForSelector('.sell-btn:not([disabled])');
  check('Sesión recordada al reabrir la app', (await page.textContent('#hello')) === 'Hola, Demo');

  // 13) Salir
  await page.click('#logoutBtn');
  await page.waitForSelector('#lockBtn:not([hidden])');
  check('Salir: vuelve al catálogo público y olvida el PIN', (await page.$$('.sell-btn')).length === 0 && await page.evaluate(() => !localStorage.getItem('aura.session.v1') && !localStorage.getItem('aura.admin.v1')));

  // 14) Bloqueo tras 8 PIN fallidos
  fake = createFakeApi(seed.items);
  await page.click('#lockBtn');
  for (let i = 0; i < 8; i++) {
    await page.fill('#pin', '000' + i);
    await page.click('#loginSubmit');
    await page.waitForFunction((k) => document.querySelector('#loginSubmit').textContent === 'Entrar' && !document.querySelector('#loginSubmit').disabled, i);
  }
  await page.fill('#pin', '1234');
  await page.click('#loginSubmit');
  await page.waitForFunction(() => document.querySelector('#loginError').textContent.includes('Demasiados'));
  check('Bloqueo tras 8 fallos: mensaje tal cual', (await page.textContent('#loginError')).startsWith('Demasiados intentos fallidos'));
  await shot(page, '20-bloqueo.png');
  await page.click('#loginSheet [data-close]');

  // 15) PIN cambiado: la sesión recordada se cierra con aviso
  await page.evaluate(() => localStorage.setItem('aura.session.v1', JSON.stringify({ user: 'Demo', pin: '4321' })));
  fake = createFakeApi(seed.items);
  await page.reload();
  await page.waitForSelector('#lockBtn:not([hidden])');
  await page.waitForSelector('.toast.err');
  check('PIN guardado ya no vale → cierra sesión con aviso', (await toastText()).includes('PIN incorrecto') && await page.evaluate(() => !localStorage.getItem('aura.session.v1')));

  // 16) Demo ?mock=1 también permite practicar
  const p2 = await ctx.newPage();
  await p2.goto(URL_APP + '?mock=1');
  await p2.waitForSelector('.pc:not(.sk)');
  await p2.click('#lockBtn');
  await p2.fill('#pin', '1234');
  await p2.click('#loginSubmit');
  await p2.waitForSelector('.sell-btn:not([disabled])');
  await p2.locator('.pc', { hasText: 'Lavanda' }).locator('.sell-btn').click();
  await p2.click('#sellSubmit');
  await p2.waitForSelector('.toast >> text=Venta registrada');
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
