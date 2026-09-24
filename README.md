# La mafia del norte en Tacna

Landing responsive en HTML, CSS y JavaScript puro. Sin instalación ni compilación.

## Abrir

Abre `index.html` con Live Server en Visual Studio Code. También funciona abriendo el archivo directamente. Google Fonts requiere conexión; hay fuentes de respaldo locales.

## Personalizar

- `index.html`: edita el título en `h1` (un `span` por línea), la pregunta en `#question` y el botón en `#say-no`.
- `style.css`: colores en `:root`, texturas y adaptación responsive.
- `script.js`: intro y respuesta visual del botón.
- Los archivos originales de `img/` permanecen sin modificaciones.

El contador 004320 es una muestra, no representa participaciones reales y no cambia al pulsar. Para cambiarlo en HTML, actualiza las seis celdas, `data-value` y `aria-label`. La función `renderCounter(value)` actualiza esos elementos juntos y admite hasta seis dígitos, incluido cero. Los enlaces del menú son marcadores `#`.

La intro prioriza WebM con MP4 como alternativa. Se cierra al terminar, ante un error de reproducción o tras un máximo de 10 segundos. Se puede omitir con el botón o Escape. Con movimiento reducido, se omite; sin JavaScript, el contenido permanece visible.

No incluye backend, APIs, formularios, analytics, cookies ni almacenamiento de votos.
