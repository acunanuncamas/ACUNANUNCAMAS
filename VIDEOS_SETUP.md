# Instalar videos en la galería

El código está preparado localmente. No se ha desplegado el Worker, ejecutado SQL en D1, subido archivos reales ni publicado la web.

## 1. Crear únicamente la tabla de videos

En Cloudflare, abre la base D1 que ya está vinculada como `DB` al Worker. En su consola ejecuta el contenido de `backend/videos.sql`. Usa esa misma base, no una nueva.

Este SQL crea `gallery_videos` y su índice si no existen. No borra ni modifica `gallery`, `votes`, `counter` ni `news`.

## 2. Instalar el Worker

En Workers & Pages → mafia-tacna-api → Editar código, conserva una copia del código actual y reemplaza el archivo principal con TODO el contenido de `backend/worker-cloudflare.js`. Este archivo único incluye las funciones de videos y el Worker original.

Si trabajas con módulos locales, el equivalente es `backend/worker.js` más `backend/worker-videos.js`; no uses ambos formatos a la vez.

Conserva los bindings existentes: `DB`, `GALLERY_BUCKET`, `ADMIN_TOKEN` e `IP_HASH_SECRET`. No necesitas un bucket ni un token nuevos. Los videos se guardan bajo `videos/` en el bucket existente.

Publica ese Worker cuando estés listo. El código original de fotos, noticias y contador se conserva; se añaden rutas de videos y se permiten HEAD/Range en CORS.

## 3. Usar el panel

Abre `admin-gallery.html`, entra con tu token y pulsa VIDEOS. Elige o arrastra MP4/WebM, revisa las vistas previas, añade título/descripción/orden y pulsa Subir pendientes. Las subidas son consecutivas. El token sigue en memoria o, si lo elegiste, en sessionStorage de esa pestaña.

Límite por archivo: 80 MB. Para compatibilidad móvil, se recomienda MP4 con video H.264 y audio AAC; el panel no convierte ni comprime archivos y una extensión MP4 no garantiza que su códec pueda reproducirse. Utiliza archivos cortos y comprimidos para las vistas previas del carrusel. La entrega desde R2 no es un servicio de transcodificación.

Si la conexión se corta durante una subida, actualiza la lista antes de reintentar para comprobar si ya se guardó.

Las tarjetas de videos inactivos no descargan la vista previa pública. Puedes editar o reactivar esos registros desde el panel.

## 4. Galería pública

Publica también los cambios del frontend cuando estés listo. La pestaña VIDEOS consulta GET `/api/gallery/videos`. Sin videos activos mantiene el espacio negro. Si el Worker aún no tiene las rutas o falta la tabla, el panel muestra el error y la galería registra el fallo en consola, sin afectar fotos ni inicio.

Las columnas conservan la estética y el movimiento alternado de Fotos, con tarjetas 9:16 y orden aleatorio por columna. Solo los videos visibles cargan y reproducen sus vistas previas: muted, loop y playsinline. Los que salen del área visible liberan su fuente. Al tocar uno, las vistas previas y el audio de fondo se pausan y el reproductor grande empieza desde el inicio con sonido y controles. Al cerrar, el carrusel y el audio de fondo continúan respetando el silencio del usuario.

Al ocultar la pestaña se pausa la reproducción. El video grande queda pausado al volver para evitar sonido inesperado. Con prefers-reduced-motion se detienen las animaciones y la reproducción automática de vistas previas; siguen disponibles las tarjetas con ▶. Algunos dispositivos pueden bloquear autoplay por sus políticas de batería o datos.

## API nueva

- GET `/api/gallery/videos`: `{ items: [{ id, title, description, video_url, sort_order, active, created_at }] }`, solo activos.
- GET y HEAD `/api/gallery/video/:id`: archivo activo desde R2; admite un rango `Range: bytes=...`, devuelve 206 o 416 cuando corresponde.
- GET `/api/admin/videos`: todos los registros.
- POST `/api/admin/videos`: FormData con `video`, `title`, `description` y opcional `sort_order`.
- PATCH `/api/admin/videos/:id`: JSON con `title`, `description`, `sort_order`, `active` (1/0).
- DELETE `/api/admin/videos/:id`: oculta el registro, elimina el objeto y elimina el registro. Si falla R2 se puede reintentar.

Las rutas admin requieren `Authorization: Bearer ADMIN_TOKEN`. No coloques ese secreto en los archivos.

Se comprobó la implementación de rangos con la documentación oficial: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

## Verificación realizada

Pruebas locales con API/R2/D1 simulados: autorización, listado, subida y validación de formatos, GET/HEAD, rangos normales/sufijo/inválidos, privacidad de inactivos, edición y eliminación.

Pruebas de DOM en Chrome headless con API, reproducción multimedia, visibilidad y eventos de cierre simulados: Fotos sigue funcionando; pestañas, columnas de Videos, vistas silenciadas, apertura desde cero, pausa y limpieza al cerrar; admin con varias subidas, FormData video, progreso, edición/ocultación, eliminación y retorno a Fotos.

No se han comprobado todavía archivos reales en R2 ni reproducción real en un celular: requieren instalar el Worker y la tabla, y subir un video de prueba.