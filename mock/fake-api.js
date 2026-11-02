// Apps Script "de mentira" para la demo (?mock=1) y las pruebas automáticas.
// Imita el contrato real. Con { version: 2 } imita el Apps Script nuevo (apps-script/Codigo.gs):
// venta con cantidad en una sola fila, rentabilidad (stats), fotos (photo) y descripción.
// Con { version: 1 } se comporta como el Apps Script anterior (1 unidad por venta).
// Los datos viven en memoria: al recargar la página la demo vuelve a empezar.

const DEMO_USERS = { '1234': 'Demo', '5678': 'Socio' };
const MAX_FAILS = 8;
const LOCK_MS = 10 * 60 * 1000;
const DEMO_PHOTO = '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'; // foto de ejemplo (JPEG 216×384)

// Filas extra que solo ve el admin: agotados y un código+talla repetido.
const EXTRA = [
  { key: 'PA-ADI-BEI|M', codigo: 'PA-ADI-BEI', fileId: '1tFKoBQmR2wKXs4NM6KChGjEty7BmuqzA', nombre: 'Pantalón Deportivo Adidas', marca: 'Adidas', color: 'Beige', talla: 'M', genero: 'Hombre', categoria: 'Pantalón deportivo', precio: 20, disponible: 0, stock: 2, vendida: 2 },
  { key: 'CJ-GEN-PLB|M', codigo: 'CJ-GEN-PLB', fileId: '1XZzdUkTb0lD7bXStMRjYvrZcSQTEJOuM', nombre: 'Conjunto Deportivo Top y Falda Plisada Blanco', marca: 'Genérica', color: 'Blanco', talla: 'M', genero: 'Mujer', categoria: 'Conjunto Deportivo', precio: 22, disponible: 0, stock: 1, vendida: 1 },
  { key: 'CJ-ALO-MOS|L', codigo: 'CJ-ALO-MOS', fileId: '1enogQP5wMiwmCfrMapD0uC3ktxdiPiI5', nombre: 'Conjunto Deportivo Alo Yoga Mostaza', marca: 'Alo Yoga', color: 'Mostaza', talla: 'L', genero: 'Mujer', categoria: 'Conjunto Deportivo', precio: 22, disponible: 0, stock: 1, vendida: 1 },
  { key: 'ME-NIK-AZU|M', codigo: 'ME-NIK-AZU', fileId: '1QnOBpO_NgPuWvOX-s5kk-bY80oxJWcny', nombre: 'Medias Nike Azul Claro', marca: 'Nike', color: 'Azul claro', talla: 'M', genero: 'Unisex', categoria: 'Medias', precio: 2.5, disponible: 2, stock: 2, vendida: 0 },
  { key: 'ME-NIK-AZU|M', codigo: 'ME-NIK-AZU', fileId: '1gtChXHH5ezNJ48vMm1P0hA1LuxCaMXJf', nombre: 'Calcetines deportivos Alo Yoga azul claro', marca: 'Alo Yoga', color: 'Celeste', talla: 'M', genero: 'Unisex', categoria: 'Medias', precio: 2.5, disponible: 1, stock: 1, vendida: 0 },
];

const PUBLIC_FIELDS = ['key', 'codigo', 'fileId', 'nombre', 'marca', 'color', 'talla', 'genero', 'categoria', 'precio', 'disponible'];
const clone = (o) => JSON.parse(JSON.stringify(o));
const fail = (error) => ({ ok: false, error });
const costOf = (precio) => (precio > 5 ? Math.round(precio * 0.4) : 1);

export function createFakeApi(seedItems, { users = DEMO_USERS, now = () => new Date(), pdfUrl = 'https://drive.google.com/file/d/DEMO_PDF/view', version = 2 } = {}) {
  const v2 = version >= 2;
  const items = seedItems.map((it) => ({ ...it, stock: it.stock ?? it.disponible, vendida: it.vendida ?? 0 }));
  items.push(...clone(EXTRA));
  items.forEach((i) => {
    i.costo = i.costo ?? costOf(i.precio);
    i.descripcion = i.descripcion ?? `${i.nombre} en color ${String(i.color).toLowerCase()}. Tela ligera y transpirable, ideal para entrenar o para el día a día.`;
  });
  const keyCount = {};
  items.forEach((i) => { keyCount[i.key] = (keyCount[i.key] || 0) + 1; });
  items.forEach((i) => { i.dup = keyCount[i.key] > 1; });

  const sales = [];
  let fails = [];
  let seq = 0;

  const publicFields = v2 ? [...PUBLIC_FIELDS, 'descripcion'] : PUBLIC_FIELDS;
  const adminItem = (i) => { const o = { ...i }; delete o.costo; if (!v2) delete o.descripcion; return o; };
  const publicItem = (i) => Object.fromEntries(publicFields.map((f) => [f, i[f]]));
  const recalc = (i) => { i.disponible = Math.max(0, i.stock - i.vendida); };
  const ver = v2 ? { version: 2 } : {};

  function auth(pin) {
    const t = now().getTime();
    fails = fails.filter((f) => t - f < LOCK_MS);
    if (fails.length >= MAX_FAILS) return { error: 'Demasiados intentos fallidos. Espera 10 minutos antes de volver a intentarlo.' };
    const user = users[String(pin ?? '')];
    if (!user) {
      fails.push(t);
      return { error: 'PIN incorrecto.' };
    }
    return { user };
  }

  function handle(req) {
    const action = req && req.action;
    if (action === 'catalog') {
      return { ok: true, ...ver, updated: now().toISOString(), items: items.filter((i) => i.disponible > 0).map(publicItem) };
    }
    const a = auth(req.pin);
    if (a.error) return fail(a.error);
    const user = a.user;

    switch (action) {
      case 'login':
        return { ok: true, user, ...ver };

      case 'admin_catalog':
        return { ok: true, user, ...ver, updated: now().toISOString(), items: items.map(adminItem) };

      case 'sell': {
        const matches = items.filter((i) => i.key === req.key);
        if (!matches.length) return fail('No se encontró ese producto. Actualiza el catálogo.');
        if (matches.length > 1) return fail('Código+talla repetido en el Sheet: corrígelo antes de vender.');
        const it = matches[0];
        if (it.disponible <= 0) return fail('Ya no quedan unidades de esta talla.');
        const cantidad = v2 && req.cantidad !== undefined ? Number(req.cantidad) : 1; // el Apps Script viejo ignora "cantidad"
        if (!(cantidad >= 1) || Math.floor(cantidad) !== cantidad) return fail('La cantidad no es válida.');
        if (cantidad > it.disponible) return fail(`Solo quedan ${it.disponible} unidad${it.disponible === 1 ? '' : 'es'} de esta talla.`);
        let precio = it.precio;
        if (req.precio !== undefined && req.precio !== null && req.precio !== '') {
          precio = Number(req.precio);
          if (!isFinite(precio) || precio < 0) return fail('El precio cobrado no es válido.');
        }
        it.vendida += cantidad;
        recalc(it);
        const id = `V-${String(++seq).padStart(4, '0')}`;
        sales.unshift({
          id, fecha: now().toISOString(), key: it.key, talla: it.talla, producto: `${it.nombre} · ${it.color}`,
          precioCatalogo: it.precio, precioCobrado: precio, cantidad, vendio: user, estado: 'Activa', nota: String(req.nota || ''),
        });
        return { ok: true, saleId: id, ...(v2 ? { saleIds: [id], cantidad } : {}), item: adminItem(it) };
      }

      case 'undo': {
        const s = sales.find((x) => x.id === req.saleId);
        if (!s) return fail('No se encontró esa venta.');
        if (s.estado !== 'Activa') return fail('Esa venta ya estaba anulada.');
        const it = items.find((i) => i.key === s.key);
        it.vendida = Math.max(0, it.vendida - s.cantidad);
        recalc(it);
        s.estado = 'Anulada';
        return { ok: true, ...(v2 ? { cantidad: s.cantidad } : {}), item: adminItem(it) };
      }

      case 'sales': {
        const limit = Math.max(1, Math.min(v2 ? 1000 : 500, Number(req.limit) || 40));
        return { ok: true, sales: clone(sales.slice(0, limit)).map((s) => { if (!v2) delete s.cantidad; return s; }) };
      }

      case 'stats': {
        if (!v2) return fail('Acción desconocida: stats');
        return {
          ok: true, ajusteCosto: 0.15,
          items: items.map((i) => ({ key: i.key, nombre: i.nombre, marca: i.marca, categoria: i.categoria, genero: i.genero, color: i.color, talla: i.talla, fileId: i.fileId, precio: i.precio, costo: i.costo, inversion: i.costo * i.stock, stock: i.stock, vendida: i.vendida, disponible: i.disponible })),
          sales: sales.filter((s) => s.estado === 'Activa').map((s) => ({ fecha: s.fecha, key: s.key, cantidad: s.cantidad, precioCobrado: s.precioCobrado, vendio: s.vendio })),
        };
      }

      case 'photo': {
        if (!v2) return fail('Acción desconocida: photo');
        if (!items.some((i) => i.fileId === req.fileId)) return fail('Esa foto no pertenece al inventario.');
        return { ok: true, mime: 'image/jpeg', data: DEMO_PHOTO };
      }

      case 'pdf': {
        const disp = items.filter((i) => i.disponible > 0);
        const models = new Set(disp.map((i) => [i.fileId, i.nombre, i.color, i.precio].join('|'))).size;
        const units = disp.reduce((n, i) => n + i.disponible, 0);
        const day = now().toISOString().slice(0, 10);
        const local = !/^https:\/\/drive\.google\.com\//.test(pdfUrl);
        return {
          ok: true,
          url: pdfUrl,
          download: local ? pdfUrl : 'https://drive.google.com/uc?export=download&id=DEMO_PDF',
          name: `Catalogo_Aura_${day}.pdf`,
          fileId: 'DEMO_PDF',
          pages: Math.ceil(models / 6) + 2,
          models,
          units,
        };
      }

      default:
        return fail(`Acción desconocida: ${action}`);
    }
  }

  return { handle, _items: items, _sales: sales };
}
