# Galería: conexión pendiente con Cloudflare

La interfaz de la galería está integrada en `index.html` y su lógica está en `gallery.js`. No hay fotografías escritas a mano en el HTML. Por ahora, el proyecto no contiene el código del Worker, una tabla de galería ni configuración R2; por eso la sección muestra “GALERÍA AÚN NO DISPONIBLE” y no intenta subir archivos.

## Contrato de lectura pública

Cuando exista el endpoint real de lectura, coloca su URL exacta en:

```html
<meta name="gallery-api-endpoint" content="">
```

Debe aceptar GET sin autenticación y devolver JSON:

```json
{
  "items": [
    {
      "id": 1,
      "image_url": "URL pública HTTPS de la fotografía",
      "title": "Título opcional",
      "active": true,
      "sort_order": 10
    }
  ]
}
```

El frontend también acepta un arreglo JSON directo. Filtra registros inactivos, ordena por `sort_order` y distribuye las fotografías entre las columnas. Las repeticiones necesarias para el bucle solo existen en el DOM. El endpoint debe permitir CORS desde el origen público de esta página.

## Esquema D1 propuesto (no ejecutado)

Después de comprobar que no exista una tabla equivalente, una opción mínima es:

```sql
CREATE TABLE gallery_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_key TEXT NOT NULL UNIQUE,
  image_url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

`image_key` identifica el objeto de R2 para poder borrarlo desde el panel protegido. Esta propuesta no se ha aplicado a la base real.
## Configuración externa necesaria antes de la subida

1. Crear un bucket en **R2 Object Storage** ([guía de R2](https://developers.cloudflare.com/r2/get-started/workers-api/)). Elegir cómo se servirán las imágenes públicamente: dominio propio conectado al bucket o un Worker de lectura. La URL `r2.dev` es para desarrollo, no para producción ([buckets públicos](https://developers.cloudflare.com/r2/buckets/public-buckets/)).
2. Vincular ese bucket al Worker que gestionará la galería. Registrar el nombre real del binding; este repositorio no lo conoce.
3. Identificar la base D1 existente y su binding real ([vincular D1 a un Worker](https://developers.cloudflare.com/d1/get-started/)). Crear una tabla de metadatos de galería tras revisar el esquema existente. No guardar binarios ni base64 en D1. Además de `id`, `image_url`, `title`, `created_at`, `active` y `sort_order`, conviene guardar la clave del objeto R2 para poder eliminarlo.
4. Crear el endpoint público de lectura y comprobar que devuelve las URL reales y los encabezados CORS necesarios para la página.
5. Proteger **por separado** las rutas administrativas para subir, listar, activar/desactivar y eliminar. Una opción es un Worker o ruta administrativa cubierta por Cloudflare Access con una política que permita solo a los administradores ([protección por rutas](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)). No proteger el Worker completo de votación si sus endpoints deben seguir siendo públicos.
6. Implementar el panel de administración una vez definidos el endpoint protegido y la autenticación. El panel necesitará vista previa local, envío del archivo, listado, cambio de estado y eliminación. La autorización debe validarse en el servidor; ocultar botones en el frontend no protege las rutas.

No se ha creado ni modificado ningún recurso de Cloudflare. Para completar el backend y el panel hacen falta el código actual del Worker, los nombres reales de los bindings D1/R2 y la configuración elegida para la ruta administrativa.