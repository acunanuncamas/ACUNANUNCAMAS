# Estadísticas de visitas

Implementado localmente; no se ejecutó SQL remoto ni se publicó el Worker o la web.

## Archivos y comportamiento

- Modificados: `index.html`, `admin-gallery.html`, `admin-gallery.css`, `admin-gallery.js`, `backend/worker.js`, `backend/worker-cloudflare.js`.
- Creados: `analytics.js`, `backend/worker-analytics.js`, `backend/analytics.sql`, `backend/analytics-test.cjs`, `backend/wrangler.analytics-local.jsonc` y este documento.
- POST `/api/analytics/visit`: una visita por navegador cada 30 minutos, con deduplicación en D1 incluso entre pestañas y recargas simultáneas. El navegador registra al abrir; permanecer en la página no añade visitas periódicas.
- POST `/api/analytics/heartbeat`: presencia cada dos minutos únicamente mientras la pestaña está visible. No incrementa visitas. Activo significa última señal dentro de cinco minutos.
- GET `/api/admin/stats`: requiere el mismo `Authorization: Bearer ADMIN_TOKEN` del panel. Resumen automático al iniciar/restaurar sesión y actualización cada minuto mientras el panel es visible. Cargando, error y reintento independientes del archivo de fotos/videos.
- Gráfico de barras CSS, siete fechas incluyendo ceros, responsive y con valores accesibles. Días en hora de Perú (UTC−5).
- Identificador UUID aleatorio en localStorage con respaldo en sessionStorage. Si ambos están bloqueados, se omite el registro para evitar recargas con identificadores nuevos. Borrar almacenamiento/cambiar de navegador produce otro único; no es una defensa contra bots que fabriquen identificadores.
- D1 guarda hashes del identificador, fechas y cantidades; no recibe ni guarda IP, ubicación, user-agent ni datos personales en estas tablas. Las solicitudes no envían Referer. Los hashes diarios rotan por fecha. Al consultar el resumen se eliminan identificadores diarios anteriores a siete días y presencias sin señales durante un día; las cantidades agregadas históricas se conservan. Sin consultas administrativas, la limpieza espera hasta la siguiente consulta.
- Votos, galerías, R2, audio y animaciones conservan su código. El total empieza desde la instalación de este registro, sin reconstruir visitas previas.

## Pruebas locales sin Cloudflare

Con Node 22 o superior y Python 3 en PATH, desde la raíz:

```powershell
node backend/analytics-test.cjs
node --check analytics.js
node --check admin-gallery.js
node --check backend/worker.js
node --check backend/worker-cloudflare.js
node --check backend/worker-analytics.js
```

Si Python no está en PATH, define `$env:PYTHON` con su ruta completa antes del test. El test utiliza SQLite real temporal y comprueba migración repetible, deduplicación, únicos, presencia/expiración, medianoche de Perú, conservación de totales, validación, autorización, aislamiento de rutas y equivalencia de los dos Workers.

## Worker local con D1

Estos comandos necesitan Node/npm y Wrangler. La configuración de prueba tiene una base local ficticia y un token de prueba, sin secretos reales. No la uses para deploy.

```powershell
npx wrangler d1 execute analytics-local --local --config backend/wrangler.analytics-local.jsonc --file backend/analytics.sql
npx wrangler dev --config backend/wrangler.analytics-local.jsonc --port 8787
```

En otra terminal:

```powershell
$visitor = @{visitorId = [guid]::NewGuid().ToString()} | ConvertTo-Json -Compress
Invoke-RestMethod http://127.0.0.1:8787/api/analytics/visit -Method Post -Headers @{Origin='null'} -ContentType application/json -Body $visitor
Invoke-RestMethod http://127.0.0.1:8787/api/analytics/visit -Method Post -Headers @{Origin='null'} -ContentType application/json -Body $visitor
Invoke-RestMethod http://127.0.0.1:8787/api/analytics/heartbeat -Method Post -Headers @{Origin='null'} -ContentType application/json -Body $visitor
Invoke-RestMethod http://127.0.0.1:8787/api/admin/stats -Headers @{Authorization='Bearer local-test-only'}
```

Resultado esperado: total y hoy 1, únicos 1, en línea 1, siete días. Sin Authorization devuelve 401. Pasados más de cinco minutos sin señales, en línea vuelve a cero. Esta base de prueba contiene solo estadísticas: las rutas originales requieren sus tablas y bindings habituales.

Para probar el dashboard local sin modificar la URL de producción en los archivos originales, crea una carpeta temporal dentro del proyecto:

```powershell
New-Item -ItemType Directory -Path .analytics-preview -Force
Copy-Item admin-gallery.html,admin-gallery.css -Destination .analytics-preview
(Get-Content admin-gallery.js -Raw).Replace('https://mafia-tacna-api.acunanuncamas.workers.dev','http://127.0.0.1:8787') | Set-Content .analytics-preview/admin-gallery.js -Encoding utf8
```

Con el Worker detenido, añade una tabla de galería vacía solo a la base local para que el login existente pueda comprobar el token:

```powershell
npx wrangler d1 execute analytics-local --local --config backend/wrangler.analytics-local.jsonc --command "CREATE TABLE IF NOT EXISTS gallery (id INTEGER PRIMARY KEY, title TEXT, description TEXT, image_url TEXT, sort_order INTEGER, active INTEGER, created_at TEXT, r2_key TEXT);"
```

Reinicia `wrangler dev` y abre `.analytics-preview/admin-gallery.html` como archivo (origen null). Ingresa `local-test-only`. Comprueba resumen, gráfico, actualización, cierre/restauración de sesión y diseño estrecho. Detén el Worker y pulsa Actualizar resumen: debe mostrar error sin bloquear el panel. No pruebes subidas ni videos con esta configuración mínima.

## Migración de producción: comandos exactos

No se conoce desde estos archivos el nombre/UUID de la D1 vinculada como `DB`. Consulta esa vinculación en Cloudflare y utiliza esa misma base, sin crear otra.

```powershell
npx wrangler login
npx wrangler d1 list
$D1Name = Read-Host 'Nombre exacto de la D1 vinculada como DB a mafia-tacna-api'
npx wrangler d1 execute $D1Name --remote --file backend/analytics.sql
```

El SQL es aditivo e idempotente: crea tres tablas y un índice; no altera tablas existentes. Los comandos `--local`/`--remote` y `--file` corresponden a la [documentación oficial de Wrangler D1](https://developers.cloudflare.com/d1/wrangler-commands/).

## Variables y publicación manual

No hacen falta secrets nuevos. Conserva `DB`, `ADMIN_TOKEN`, `IP_HASH_SECRET` y `GALLERY_BUCKET`. El token `local-test-only` pertenece exclusivamente a la configuración de prueba.

Después de la migración, publica manualmente `backend/worker-cloudflare.js` como archivo único desde el editor de Cloudflare, tal como en VIDEOS_SETUP.md. Si tu despliegue usa módulos, utiliza `backend/worker.js`, `backend/worker-videos.js` y `backend/worker-analytics.js`. Elige una modalidad. Publica luego los archivos de frontend modificados junto con `analytics.js`. No se ha hecho push ni deploy automático.

## Comprobar producción

1. Abre el panel publicado con tu token y anota el resumen. Acceder a `/api/admin/stats` sin token debe devolver 401.
2. Abre la web pública en otro navegador/perfil y vuelve al panel: deben aumentar visitas y únicos, y aparecer en línea. Recarga repetidamente la web: el mismo navegador no añade otra visita durante 30 minutos.
3. Abre otra pestaña del mismo navegador: no debe duplicar únicos ni presencia. Oculta todas sus pestañas durante más de cinco minutos: deja de aparecer en línea. Al volver a una pestaña visible, la señal siguiente recupera presencia (hasta dos minutos).
4. Comprueba INICIO, GALERÍA, fotos/videos, audio, animaciones, contador, voto único por IP y administración de archivos. Revisa Network para confirmar que las señales son espaciadas, no incluyen token y los errores de estadísticas no interrumpen la web.
5. Comprueba el gráfico y las tarjetas en móvil. El total conserva todos los días aunque los identificadores antiguos se limpien.

La sintaxis y el test SQLite se verificaron localmente. La reproducción multimedia, la revisión visual en navegador y el funcionamiento sobre Cloudflare real deben comprobarse con los pasos anteriores.
