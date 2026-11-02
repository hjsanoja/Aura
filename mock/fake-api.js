// Apps Script "de mentira" para la demo (?mock=1) y las pruebas automáticas.
// Imita el contrato real: catalog, login, admin_catalog, sell, undo, sales, pdf.
// Los datos viven en memoria: al recargar la página la demo vuelve a empezar.

const DEMO_USERS = { '1234': 'Demo', '5678': 'Socio' };
const MAX_FAILS = 8;
const LOCK_MS = 10 * 60 * 1000;

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

export function createFakeApi(seedItems, { users = DEMO_USERS, now = () => new Date() } = {}) {
  const items = seedItems.map((it) => ({ ...it, stock: it.stock ?? it.disponible, vendida: it.vendida ?? 0 }));
  items.push(...clone(EXTRA));
  const keyCount = {};
  items.forEach((i) => { keyCount[i.key] = (keyCount[i.key] || 0) + 1; });
  items.forEach((i) => { i.dup = keyCount[i.key] > 1; });

  const sales = [];
  let fails = [];
  let seq = 0;

  const adminItem = (i) => ({ ...i });
  const publicItem = (i) => Object.fromEntries(PUBLIC_FIELDS.map((f) => [f, i[f]]));
  const recalc = (i) => { i.disponible = Math.max(0, i.stock - i.vendida); };

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
      return { ok: true, updated: now().toISOString(), items: items.filter((i) => i.disponible > 0).map(publicItem) };
    }
    const a = auth(req.pin);
    if (a.error) return fail(a.error);
    const user = a.user;

    switch (action) {
      case 'login':
        return { ok: true, user };

      case 'admin_catalog':
        return { ok: true, user, updated: now().toISOString(), items: items.map(adminItem) };

      case 'sell': {
        const matches = items.filter((i) => i.key === req.key);
        if (!matches.length) return fail('No se encontró ese producto. Actualiza el catálogo.');
        if (matches.length > 1) return fail('Código+talla repetido en el Sheet: corrígelo antes de vender.');
        const it = matches[0];
        if (it.disponible <= 0) return fail('Ya no quedan unidades de esta talla.');
        let precio = it.precio;
        if (req.precio !== undefined && req.precio !== null && req.precio !== '') {
          precio = Number(req.precio);
          if (!isFinite(precio) || precio < 0) return fail('El precio cobrado no es válido.');
        }
        it.vendida += 1;
        recalc(it);
        const id = `V-${String(++seq).padStart(4, '0')}`;
        sales.unshift({
          id, fecha: now().toISOString(), key: it.key, talla: it.talla, producto: `${it.nombre} · ${it.color}`,
          precioCatalogo: it.precio, precioCobrado: precio, vendio: user, estado: 'Activa', nota: String(req.nota || ''),
        });
        return { ok: true, saleId: id, item: adminItem(it) };
      }

      case 'undo': {
        const s = sales.find((x) => x.id === req.saleId);
        if (!s) return fail('No se encontró esa venta.');
        if (s.estado !== 'Activa') return fail('Esa venta ya estaba anulada.');
        const it = items.find((i) => i.key === s.key);
        it.vendida = Math.max(0, it.vendida - 1);
        recalc(it);
        s.estado = 'Anulada';
        return { ok: true, item: adminItem(it) };
      }

      case 'sales': {
        const limit = Math.max(1, Math.min(500, Number(req.limit) || 40));
        return { ok: true, sales: clone(sales.slice(0, limit)) };
      }

      case 'pdf':
        return fail('Compartir PDF todavía no está disponible (fase 3).');

      default:
        return fail(`Acción desconocida: ${action}`);
    }
  }

  return { handle, _items: items, _sales: sales };
}
