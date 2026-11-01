# Aura Catálogo

App de catálogo de **Aura Activewear**. Se instala en el teléfono (Android y iPhone) como cualquier app y muestra en todo momento lo que tienes disponible en tu Google Sheet. No tienes que volver a generar el catálogo a mano.

```
App (GitHub Pages)  ⇄  Apps Script (dentro de tu Sheet)  ⇄  Google Sheet + Drive
```

- **Costo: $0.** GitHub Pages y Apps Script son gratis.
- **Tus costos nunca salen del Sheet.** La app solo recibe nombre, marca, color, talla, precio y unidades disponibles.
- **Funciona sin señal.** Guarda la última versión del catálogo y la muestra con el aviso «Sin conexión».

> **Estado:** Fase 1 lista (catálogo, instalación en el teléfono y uso sin conexión).
> Faltan la fase 2 (modo admin para vender) y la fase 3 (compartir PDF).

---

## 1. Probar la demo (sin conectar nada)

Abre la dirección de tu app y añade `?mock=1` al final. Por ejemplo:

`https://hjsanoja.github.io/Aura/?mock=1`

Verás el catálogo con productos de ejemplo y la etiqueta **DEMO** arriba a la izquierda.

---

## 2. Publicar la app en GitHub Pages (una sola vez)

1. Entra a tu repositorio en github.com.
2. Toca **Settings** (Configuración), arriba a la derecha.
3. En el menú de la izquierda, toca **Pages**.
4. En **Source**, elige **Deploy from a branch**.
5. En **Branch**, elige **main** y la carpeta **/ (root)**. Toca **Save**.
6. Espera 1 o 2 minutos y recarga la página. Arriba aparece tu dirección, por ejemplo:
   `https://hjsanoja.github.io/Aura/`

Cada vez que se suba un cambio al repositorio, la app se actualiza sola en 1 o 2 minutos.

---

## 3. Conectar tu Google Sheet

Cuando tengas la URL de tu Apps Script (termina en `/exec`):

1. En GitHub, abre el archivo **`config.js`**.
2. Toca el lápiz ✏️ (**Edit this file**).
3. Cambia `PEGAR_AQUI_URL_DE_APPS_SCRIPT` por tu URL. Deja las comillas:
   ```js
   export const API_URL = "https://script.google.com/macros/s/XXXXXXXX/exec";
   ```
4. Toca **Commit changes…** y luego otra vez **Commit changes**.
5. Espera 1 o 2 minutos y abre la app (sin `?mock=1`).

Si la app dice **«Falta conectar tu Sheet»**, la URL no está pegada o está mal copiada.

---

## 4. Instalar la app en el teléfono

### Android (Chrome)
1. Abre la dirección de la app en **Chrome**.
2. Toca el menú **⋮** (arriba a la derecha).
3. Toca **Instalar app** (o **Añadir a pantalla de inicio**).
4. Confirma. El ícono **A** de Aura aparece con tus apps.

También puedes tocar el botón **⋯** de la app → **Instalar app**, si aparece.

### iPhone (Safari)
1. Abre la dirección de la app en **Safari**. Tiene que ser Safari, no Chrome.
2. Toca el botón **Compartir** (el cuadrado con la flecha hacia arriba).
3. Baja y toca **Añadir a pantalla de inicio**.
4. Toca **Añadir**.

---

## 5. Cómo se usa

- **Buscar:** escribe en la barra (nombre, marca, color o código). No importan las tildes ni las mayúsculas.
- **Filtrar:** toca los botones de **Género**, **Categoría** o **Marca**. Toca **Todos** para quitar el filtro.
- **Actualizar:** toca la flecha circular ⟳ junto a «Actualizado hace…». La app también se actualiza sola al abrirla.
- **Sin conexión:** verás el aviso amarillo «Sin conexión · mostrando copia de hace X». Cuando vuelva la señal, la app se actualiza sola.
- **Menú ⋯:**
  - **Actualizar catálogo**
  - **Buscar actualización de la app**: si hay una versión nueva, aparece el botón **Actualizar**.

### Qué significa cada etiqueta
| Etiqueta | Significado |
|---|---|
| Verde «5 disp.» | Más de 3 unidades en total |
| Naranja «2 disp.» | 3 unidades o menos |
| Naranja «Última unidad» | Queda 1 sola unidad |
| Talla en naranja (`S: 1`) | Queda 1 en esa talla |

El catálogo se ordena por **categoría** (en el mismo orden en que aparecen en tu Sheet), luego **Mujer → Hombre → Unisex**, luego **marca** y **nombre**.

Los productos que tienen la misma foto, nombre, color y precio se juntan en una sola tarjeta con sus tallas (`S: 1  M: 2`).

---

## Para quien mantenga el código

- HTML, CSS y JavaScript sin frameworks, sin `npm` y sin compilar. Los archivos se suben tal cual.
- Todas las rutas son relativas (`./`) porque Pages sirve la app en una subcarpeta.
- **Al cambiar cualquier archivo de la app, sube `CACHE_VERSION` en `sw.js`** (y `APP_VERSION` en `app.js`). Así los teléfonos descargan la versión nueva. `config.js` no lo necesita: siempre se pide primero a internet.
- No hay secretos en el repositorio. Los PIN se escribirán en pantalla (fase 2).

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Diseño (colores, letras, tarjetas) |
| `app.js` | Lógica: cargar, agrupar, filtrar y buscar |
| `api.js` | Conversación con el Apps Script |
| `config.js` | **Tu URL del Apps Script** |
| `sw.js` | Uso sin conexión y actualizaciones |
| `manifest.webmanifest` | Nombre, ícono y colores al instalar |
| `icons/` | Íconos (generados con `tools/make_icons.py`) |
| `mock/catalog.json` | Datos de ejemplo para `?mock=1` |
| `referencia/` | Catálogo PDF original (guía de diseño) |
| `tests/` | Pruebas automáticas (no afectan la app) |

### Pruebas
```bash
node tests/fase1.cjs
```
Abre la app en Chromium sin ventana a 390×844, revisa 28 puntos y guarda capturas en `tests/capturas/`.

Para verla en tu computador: `node tests/server.cjs` y abre `http://127.0.0.1:8080/aura-catalogo/?mock=1`.
