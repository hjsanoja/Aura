# Aura Catálogo

App de catálogo de **Aura Activewear**. Se instala en el teléfono (Android y iPhone) como cualquier app y muestra en todo momento lo que tienes disponible en tu Google Sheet. No tienes que volver a generar el catálogo a mano.

```
App (GitHub Pages)  ⇄  Apps Script (dentro de tu Sheet)  ⇄  Google Sheet + Drive
```

- **Costo: $0.** GitHub Pages y Apps Script son gratis.
- **Tus costos nunca salen al catálogo.** El catálogo público solo recibe nombre, marca, color, talla, precio, descripción y unidades disponibles. Los costos nunca se muestran en la app.
- **Funciona sin señal.** Guarda la última versión del catálogo y la muestra con el aviso «Sin conexión».

> **Importante:** para el **PDF vertical**, la **venta de varias unidades en una sola fila** y las **imágenes para redes**, instala el Apps Script nuevo (sección 9). Mientras no lo hagas, la app sigue funcionando como antes.

---

## 1. Probar la demo (sin conectar nada)

Abre la dirección de tu app y añade `?mock=1` al final:

`https://hjsanoja.github.io/Aura/?mock=1`

Verás productos de ejemplo y la etiqueta **DEMO** arriba a la izquierda. Puedes practicar el modo admin con el **PIN `1234`**. Las ventas de la demo son de mentira: no tocan tu Sheet y se borran al recargar la página.

---

## 2. Publicar la app en GitHub Pages (una sola vez)

1. Entra a tu repositorio en github.com.
2. Toca **Settings** (Configuración), arriba a la derecha.
3. En el menú de la izquierda, toca **Pages**.
4. En **Source**, elige **Deploy from a branch**.
5. En **Branch**, elige **main** y la carpeta **/ (root)**. Toca **Save**.
6. Espera 1 o 2 minutos. Tu dirección es `https://hjsanoja.github.io/Aura/`.

Cada vez que se suba un cambio al repositorio, la app se actualiza sola en 1 o 2 minutos.

---

## 3. Conectar tu Google Sheet

Cuando tengas la URL de tu Apps Script (termina en `/exec`):

1. En GitHub, abre el archivo **`config.js`** y toca el lápiz ✏️.
2. Cambia `PEGAR_AQUI_URL_DE_APPS_SCRIPT` por tu URL, dejando las comillas.
3. Toca **Commit changes…** y otra vez **Commit changes**. Espera 1 o 2 minutos.

Si la app dice **«Falta conectar tu Sheet»**, la URL no está pegada o está mal copiada.

---

## 4. Instalar la app en el teléfono

### Android (Chrome)
1. Abre la dirección de la app en **Chrome**.
2. Toca el menú **⋮** → **Instalar app** (o **Añadir a pantalla de inicio**).

### iPhone (Safari)
1. Abre la dirección de la app en **Safari** (tiene que ser Safari).
2. Toca **Compartir** (el cuadrado con la flecha) → **Añadir a pantalla de inicio** → **Añadir**.

---

## 5. Cómo se usa

- **Buscar:** escribe en la barra (nombre, marca, color o código). No importan las tildes ni las mayúsculas.
- **Categorías:** toca una de las pastillas bajo el buscador. Cada una dice cuántos modelos tiene.
- **Filtros:** el botón **Filtros** abre un panel con **Género** y **Marca**. El número en el botón indica cuántos filtros tienes puestos.
- **Limpiar filtros:** aparece junto al contador de modelos cuando hay algo filtrado o buscado.
- **Ver un producto en grande:** toca su **foto** o su **nombre**. Verás la foto grande, la descripción, las tallas y el precio.
- **Actualizar:** la flecha circular ⟳ junto a «Actualizado…». La app también se actualiza sola al abrirla.
- **Menú ☰:** actualizar catálogo, buscar actualización de la app y, en modo admin, cerrar sesión. Abajo dice qué versión del Apps Script tienes.

| Etiqueta | Significado |
|---|---|
| Verde «5 disp.» | Más de 3 unidades en total |
| Naranja «2 disp.» | 3 unidades o menos |
| Naranja «Última unidad» | Queda 1 sola unidad |
| Talla en naranja (`S: 1`) | Queda 1 en esa talla |

---

## 6. Modo admin

Solo para ti y tu socio. Toca el **candado 🔒**, escribe tu PIN y, si es tu teléfono, marca **Recordar en este dispositivo**. Abajo aparece una barra con:

**Catálogo · Ventas · Compartir PDF**

Si fallas el PIN 8 veces en 10 minutos, el Script bloquea la entrada un rato.

### Vender
1. Toca **Vender** en el producto (o ábrelo en grande y toca **Vender**).
2. Elige la **talla** (si solo hay una, ya viene elegida) y la **cantidad** con **−** y **+**.
3. Revisa el **precio por unidad**: viene con el precio de lista; cámbialo si hiciste descuento (`19`, `19.50` o `19,50`).
4. Si quieres, escribe una **nota** (cliente, forma de pago…).
5. Toca **Vender N unidades · $total**. La tarjeta se actualiza al momento y tu Sheet suma las unidades en `VENDIDA`.

Con el Apps Script nuevo, una venta de 3 unidades es **una sola fila** en la hoja Ventas (con la columna **Cantidad**). Con el anterior, queda una fila por unidad.

### ¿Te equivocaste?
- Justo después de vender aparece **Deshacer** durante 8 segundos (anula toda la venta).
- Después: pestaña **Ventas** → **Anular** → **Anular venta**. Las unidades vuelven al stock.

### Ventas
- Arriba eliges el **periodo**: **Hoy**, **7 días**, **30 días** o **Todo**, y **quién vendió** (si son varios).
- Ves lo **cobrado** y las **unidades** del periodo, y la lista agrupada por día con el total de cada día.

### Números (rentabilidad) — oculto por ahora
Está desactivado mientras se define qué debe mostrar. Para volver a activarlo, en `app.js` cambia `const SHOW_STATS = false;` por `true` (y sube `CACHE_VERSION` en `sw.js`).

### Imagen para redes — necesita el Apps Script nuevo
1. Abre un producto en grande y toca **Imagen para redes**.
2. Elige **Historia 9:16** (Instagram/WhatsApp estados) o **Publicación 4:5** (feed).
3. Toca **Compartir…** para mandarla directo a Instagram o WhatsApp, o **Descargar** para guardarla.

La imagen lleva tu logo, la foto del producto, nombre, color, tallas, precio y «Escríbenos para apartar».

### Otras opciones
- **Mostrar agotados:** dentro de **Filtros**.
- **«Código+talla repetido»:** dos filas del Sheet tienen el mismo código y talla. No se puede vender esa talla hasta corregirlo.
- **Sin conexión:** puedes ver el catálogo, pero no vender.

---

## 7. Compartir el catálogo en PDF (para tus clientes)

1. En modo admin, toca **Compartir PDF** (barra de abajo).
2. Espera (hasta 1 minuto). Puedes cerrar la ventana: te avisa cuando esté listo.
3. Elige **Compartir…**, **Abrir PDF**, **Descargar** o **Copiar enlace**.

Con el Apps Script nuevo el PDF sale **vertical (A4)**, como el catálogo original:
- **Portada** con modelos, unidades y marcas.
- **Índice** con el número de página de cada categoría y género, y una guía «Cómo leer el catálogo».
- **6 productos por página**, separados por **categoría y género**, con foto, marca, nombre, color, tallas, precio y disponibilidad.
- Número de página abajo («3 / 9»).

---

## 8. Orden del catálogo

Por **categoría** (en el orden en que aparecen en tu Sheet), luego **Mujer → Hombre → Unisex**, luego **marca** y **nombre**. Los productos con la misma foto, nombre, color y precio se juntan en una sola tarjeta con sus tallas.

---

## 9. Instalar el Apps Script nuevo (una sola vez, ~10 minutos)

El código está en este repositorio: **`apps-script/Codigo.gs`**. Usa las mismas hojas y columnas que ya tienes (Inventario y Ventas) y no borra nada; solo añade la columna **Cantidad** al final de la hoja Ventas.

1. **Guarda una copia del código viejo.** Abre tu Sheet → **Extensiones → Apps Script**. Selecciona todo el código (`Ctrl+A`), cópialo y pégalo en un documento aparte, por si hay que volver atrás.
2. **Pega el nuevo en el MISMO archivo.** En GitHub abre `apps-script/Codigo.gs`, toca **Copy raw file** (el ícono de copiar), vuelve a Apps Script, borra todo el código viejo y pega. Guarda con el disquete 💾.
   - ⚠️ En la lista de **Archivos** (a la izquierda) debe quedar **un solo archivo `.gs`**. Si hay otro con el código viejo, bórralo (⋮ junto al archivo → **Eliminar**). Si quedan los dos, Google puede seguir usando el viejo.
3. **Activa Google Slides** (para el PDF vertical): a la izquierda, junto a **Servicios**, toca **+** → busca **Google Slides API** → **Agregar**.
4. **Tus PIN.** Toca el engranaje ⚙️ **Configuración del proyecto** → abajo, **Propiedades del script** → **Agregar propiedad**:
   - Propiedad `PIN_Nando`, valor: **solo el número**, por ejemplo `173479`.
   - Propiedad `PIN_Valeria`, valor: **solo su número**, por ejemplo `1903`.
   - (Si escribiste `Nando=173479` en el valor, también funciona.)
   - El nombre después de `PIN_` es el que aparece en «Hola, …» y en la columna «Vendió».
5. **Revisa que todo esté bien:** arriba elige la función **diagnosticoAura** → **Ejecutar**. En **Registro de ejecución** todo debe salir con ✅. Si algo sale con ❌, la línea dice cómo arreglarlo.
6. **Prueba el PDF desde el editor:** elige la función **probarPdfAuraV2** → **Ejecutar**. La primera vez Google pide permisos: **Revisar permisos → tu cuenta → Configuración avanzada → Ir a … (no seguro) → Permitir**. Es normal: es tu propio script. Al terminar, en **Registro de ejecución** aparece el enlace del PDF con `"formato": "A4 vertical"`; ábrelo y revisa que sea vertical.
7. **Publica la versión nueva sin cambiar la URL:** **Implementar → Gestionar implementaciones** → lápiz ✏️ → en **Versión** elige **Nueva versión** → **Implementar**.
   - Así la URL `/exec` sigue igual y **no hay que tocar `config.js`**.
8. En la app: **☰ → Actualizar catálogo**. En el menú debe decir **Apps Script v2**.

**Si el PDF sigue saliendo horizontal:** el código viejo sigue activo. Ejecuta **diagnosticoAura**: si dice «Hay OTRO archivo .gs con el código viejo», bórralo, guarda y repite los pasos 6 y 7.

**Si el paso 6 dice «Google no aceptó el tamaño vertical»:** crea en Google Drive una **Presentación** en blanco → **Archivo → Configurar página → Personalizado → 21 × 29,7 cm → Aplicar**. Copia su ID (la parte larga de la dirección entre `/d/` y `/edit`) y guárdalo como propiedad `PLANTILLA_PDF`. Vuelve a ejecutar **probarPdf**.

**Si algo sale mal:** pega de nuevo el código viejo que guardaste en el paso 1 y vuelve a hacer el paso 6.

---

## Para quien mantenga el código

- HTML, CSS y JavaScript sin frameworks, sin `npm` y sin compilar.
- Rutas relativas (`./`), porque Pages sirve la app en una subcarpeta.
- **Al cambiar un archivo de la app, sube `CACHE_VERSION` en `sw.js`** (y `APP_VERSION` en `app.js`).
- La app detecta la versión del Apps Script (`version: 2` en las respuestas). Con v1 vende unidad por unidad y avisa que Imagen para redes necesita el Apps Script nuevo.
- No hay secretos en el repositorio. Los PIN viven en las Propiedades del script.

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app |
| `api.js` | Conversación con el Apps Script |
| `config.js` | **Tu URL del Apps Script** |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación y uso sin conexión |
| `apps-script/Codigo.gs` | **El Apps Script** (API, PDF vertical, Números, fotos) |
| `mock/` | Datos y Apps Script de mentira para la demo y las pruebas |
| `referencia/` | Catálogo PDF original (guía de diseño) |
| `tools/` | Scripts que generaron los íconos y el PDF de la demo |
| `tests/` | Pruebas automáticas (no afectan la app) |

### Pruebas
```bash
node tests/apps-script.cjs
node tests/fase1.cjs
node tests/fase2.cjs
node tests/fase3.cjs
node tests/fase4.cjs
```
- `apps-script`: el Apps Script con un Sheet simulado (38 puntos) y una vista previa del PDF vertical (`tests/capturas/pdf-preview.html`).
- `fase1`: catálogo, filtros y uso sin conexión (32).
- `fase2`: modo admin con el Apps Script anterior (56).
- `fase3`: Compartir PDF (30).
- `fase4`: Apps Script nuevo: cantidad en una fila, filtros de ventas, Números oculto, detalle e imagen para redes (26).

Para verla en tu computador: `node tests/server.cjs` y abre `http://127.0.0.1:8080/aura-catalogo/?mock=1`.
