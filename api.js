// Comunicación con el Apps Script (o con el servidor de mentira de ?mock=1).
import { API_URL } from './config.js';

export const MOCK = new URLSearchParams(location.search).has('mock');

export function isConfigured() {
  return MOCK || /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(API_URL || '');
}

export class ApiError extends Error {
  constructor(message, { network = false, timeout = false } = {}) {
    super(message);
    this.network = network;
    this.timeout = timeout;
  }
}

async function request(url, options = {}, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', cache: 'no-store', ...options, signal: ctrl.signal });
  } catch (err) {
    const timeout = err.name === 'AbortError';
    const msg = timeout ? 'El servidor tardó demasiado en responder.' : 'No hay conexión con el servidor.';
    throw new ApiError(msg, { network: true, timeout });
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`Respuesta inesperada del servidor (código ${res.status}). Revisa la URL en config.js.`);
  }
  return check(data);
}

function check(data) {
  if (!data || data.ok !== true) {
    throw new ApiError((data && data.error) || 'El servidor devolvió un error desconocido.');
  }
  return data;
}

// ── Demo: Apps Script de mentira en el navegador ──────────────
let fake = null;
async function mockApi() {
  // Siempre pedimos el archivo de ejemplo: así la demo se comporta como la red real
  // (sin conexión → error de red → se usa la copia guardada).
  const seed = await request('./mock/catalog.json');
  if (!fake) {
    try {
      const { createFakeApi } = await import('./mock/fake-api.js');
      fake = createFakeApi(seed.items, { pdfUrl: new URL('./mock/catalogo-demo.pdf', location.href).href });
    } catch {
      throw new ApiError('No hay conexión con el servidor.', { network: true });
    }
  }
  await new Promise((r) => setTimeout(r, 350)); // simula la demora del servidor
  return fake;
}

/** GET público: catálogo sin costos, solo disponibles. */
export async function getCatalog() {
  if (MOCK) return check((await mockApi()).handle({ action: 'catalog' }));
  return request(`${API_URL}?action=catalog`);
}

/** POST de administración. text/plain evita el "preflight" CORS que Apps Script no soporta. */
export async function post(action, body = {}, timeoutMs = 30000) {
  if (MOCK) {
    const api = await mockApi();
    if (action === 'pdf') await new Promise((r) => setTimeout(r, 2500)); // el PDF real tarda más
    return check(JSON.parse(JSON.stringify(api.handle({ action, ...body }))));
  }
  return request(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...body }),
  }, timeoutMs);
}

/** Genera el catálogo en PDF (puede tardar 20–60 s; se corta a los 90 s). */
export const PDF_TIMEOUT_MS = 90000;
export function generatePdf(pin) {
  return post('pdf', { pin }, PDF_TIMEOUT_MS);
}
