# Galería y panel administrativo

El frontend utiliza el Worker existente en https://mafia-tacna-api.acunanuncamas.workers.dev. El almacenamiento R2 y los metadatos D1 se gestionan mediante su API; este proyecto no modifica esos recursos.

## Abrir el panel

Abre `admin-gallery.html` directamente en Chrome o Edge y escribe tu ADMIN_TOKEN en el formulario. El token se mantiene en memoria; solo se guarda en `sessionStorage` si marcas “Mantener acceso en esta pestaña”. Cerrar sesión elimina esa copia. No escribas el token en los archivos ni en la URL.

La comprobación de CORS del Worker permite el origen de GitHub Pages y el origen `null` utilizado al abrir el archivo directamente. La comprobación desde `http://127.0.0.1:5500` devolvió `Access-Control-Allow-Origin: null`, por lo que Live Server requiere que el backend permita su origen exacto. El panel informa los errores de conexión/CORS.

Una vez publicado, el panel estará en `/admin-gallery.html` dentro del mismo sitio. Esta implementación no se ha publicado.

## Gestionar fotos

1. Selecciona archivos o arrástralos al recuadro. Revisa las previews y completa título, descripción y orden si lo necesitas.
2. Pulsa “Subir pendientes”. Los archivos se envían consecutivamente con progreso individual. El campo del archivo se llama `image`; el navegador genera el encabezado multipart de `FormData`.
3. La lista se actualiza al finalizar. Las subidas completadas no se repiten al volver a pulsar el botón.
4. Edita título, descripción, orden o la casilla de visibilidad y pulsa “Guardar cambios”.
5. “Eliminar” solicita confirmación antes de enviar DELETE.
6. Ante una subida con respuesta incierta por red o timeout, actualiza la lista antes de reintentar para comprobar si el servidor la recibió.

## Endpoints utilizados

- Público: GET `/api/gallery` (JSON con `items`) e imágenes en `/api/gallery/image/:id`.
- Administrativo: GET y POST `/api/admin/gallery`; PATCH y DELETE `/api/admin/gallery/:id`.
- Todas las peticiones administrativas llevan `Authorization: Bearer` con el token introducido por el usuario.
- PATCH envía JSON con `title`, `description`, `sort_order` y `active` (1 o 0).
- La galería pública no recibe el token. Resuelve las URL relativas contra el Worker y utiliza la ruta de imagen por ID si no se proporciona `image_url`.

Los archivos del panel son independientes: `admin-gallery.html`, `admin-gallery.css` y `admin-gallery.js`. No cargan el código de votación ni las animaciones de la página pública.


## Videos
El panel ahora incluye FOTOS y VIDEOS. Para instalar el soporte de videos en el Worker y D1, sigue VIDEOS_SETUP.md. Las rutas y el campo image de fotografías se mantienen.
