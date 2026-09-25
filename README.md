# La mafia del norte en Tacna

Landing responsive en HTML, CSS y JavaScript puro. Sin instalación ni compilación.

## Abrir

Abre `index.html` con Live Server en Visual Studio Code. También funciona abriendo el archivo directamente. Google Fonts requiere conexión; hay fuentes de respaldo locales.

## Personalizar

- `index.html`: edita el título en `h1` (un `span` por línea), la pregunta en `#question` y el botón en `#say-no`.
- `style.css`: colores en `:root`, texturas y adaptación responsive.
- `script.js`: intro, audio, voto, contador y modo de prueba `?test=1`.
- `gallery.js`: navegación de galería, columnas dinámicas y lightbox.
- Los archivos originales de `img/` permanecen sin modificaciones.

El contador se carga desde el Worker de Cloudflare. La URL normal registra el voto real con validación por IP; `?test=1` repite la animación y simula el aumento solo en la pestaña, sin enviar votos.

El enlace GALERÍA DEL HORROR abre una vista en la misma página. Las fotos se obtendrán del endpoint de lectura configurado en `<meta name="gallery-api-endpoint">`; mientras no exista, la vista indica que la galería aún no está disponible. Para conectar R2, D1 y el futuro panel protegido, sigue `GALLERY_SETUP.md`.

La intro usa WebM con MP4 como alternativa y permite continuar cuando termina el video. Con movimiento reducido se muestra directamente la opción para continuar. El código del Worker y la base D1 no forman parte de este repositorio.
