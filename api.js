// Comunicación con el Apps Script (o con el catálogo de prueba ?mock=1).
import { API_URL } from './config.js';

export const MOCK = new URLSearchParams(location.search).has('mock');

export function isConfigured() {
  return MOCK || /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(API_URL || '');
}

export class ApiError extends Error {
  constructor(message, { network = false } = {}) {
    super(message);
    this.network = network;
  }
}

async function request(url, options = {}, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', cache: 'no-store', ...options, signal: ctrl.signal });
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'El servidor tardó demasiado en responder.'
      : 'No hay conexión con el servidor.';
    throw new ApiError(msg, { network: true });
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`Respuesta inesperada del servidor (código ${res.status}). Revisa la URL en config.js.`);
  }
  if (!data || data.ok !== true) {
    throw new ApiError((data && data.error) || 'El servidor devolvió un error desconocido.');
  }
  return data;
}

/** GET público: catálogo sin costos, solo disponibles. */
export function getCatalog() {
  const url = MOCK ? './mock/catalog.json' : `${API_URL}?action=catalog`;
  return request(url);
}

/** POST de administración (se usará en la fase 2).
 *  text/plain evita el "preflight" CORS que Apps Script no soporta. */
export function post(action, body = {}, timeoutMs = 30000) {
  return request(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...body }),
  }, timeoutMs);
}
