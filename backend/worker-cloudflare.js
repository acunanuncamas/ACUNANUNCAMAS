const MAX_VIDEO_SIZE = 80 * 1024 * 1024;
const TYPES = new Map([['video/mp4', 'mp4'], ['video/webm', 'webm']]);
const urlFor = (request, id) => new URL('/api/gallery/video/' + id, request.url).href;
const itemFor = (request, row) => ({ id: row.id, title: row.title, description: row.description, sort_order: row.sort_order, active: row.active, created_at: row.created_at, video_url: urlFor(request, row.id) });

async function handleVideoRequest(request, env, helpers) {
  const { json, isAdmin, origin, allowedOrigin } = helpers;
  const path = new URL(request.url).pathname;
  const adminMatch = path.match(/^\/api\/admin\/videos(?:\/(\d+))?$/);
  const mediaMatch = path.match(/^\/api\/gallery\/video\/(\d+)$/);
  const publicList = path === '/api/gallery/videos';
  if (!adminMatch && !mediaMatch && !publicList) return null;
  const respond = (data, status = 200) => json(data, status, origin);
  if (adminMatch && !isAdmin(request, env)) return respond({ error: 'No autorizado.' }, 401);
  if (request.method === 'GET' && (publicList || adminMatch && !adminMatch[1])) {
    const result = await env.DB.prepare('SELECT * FROM gallery_videos ' + (publicList ? 'WHERE active = 1 ' : '') + 'ORDER BY sort_order ASC, created_at DESC').all();
    return respond({ items: (result.results || []).map((row) => itemFor(request, row)) });
  }
  if (mediaMatch && ['GET', 'HEAD'].includes(request.method)) {
    const row = await env.DB.prepare('SELECT r2_key, active FROM gallery_videos WHERE id = ?').bind(Number(mediaMatch[1])).first();
    if (!row || !row.active) return respond({ error: 'Video no encontrado.' }, 404);
    const head = await env.GALLERY_BUCKET.head(row.r2_key);
    if (!head) return respond({ error: 'Archivo no encontrado.' }, 404);
    const headers = new Headers({ 'Access-Control-Allow-Origin': origin === allowedOrigin ? allowedOrigin : 'null', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600', 'ETag': head.httpEtag, 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    head.writeHttpMetadata(headers);
    headers.set('Content-Length', String(head.size));
    if (request.method === 'HEAD') return new Response(null, { headers });
    let range;
    const rawRange = request.headers.get('Range');
    if (rawRange) {
      const match = rawRange.match(/^bytes=(\d*)-(\d*)$/);
      let start, end;
      if (match && (match[1] || match[2])) {
        if (!match[1]) { start = Math.max(0, head.size - Number(match[2])); end = head.size - 1; }
        else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), head.size - 1) : head.size - 1; }
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= head.size || end < start) {
        headers.set('Content-Range', 'bytes */' + head.size);
        headers.delete('Content-Length');
        return new Response(null, { status: 416, headers });
      }
      range = { offset: start, length: end - start + 1 };
      headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + head.size);
      headers.set('Content-Length', String(range.length));
    }
    const object = await env.GALLERY_BUCKET.get(row.r2_key, range ? { range } : undefined);
    if (!object) return respond({ error: 'Archivo no encontrado.' }, 404);
    return new Response(object.body, { status: range ? 206 : 200, headers });
  }
  if (adminMatch && !adminMatch[1] && request.method === 'POST') {
    if (!env.GALLERY_BUCKET) return respond({ error: 'GALLERY_BUCKET no configurado.' }, 500);
    if (!(request.headers.get('Content-Type') || '').includes('multipart/form-data')) return respond({ error: 'Se requiere multipart/form-data.' }, 400);
    let form;
    try { form = await request.formData(); } catch (_) { return respond({ error: 'Formulario inválido.' }, 400); }
    const file = form.get('video');
    if (!file || typeof file === 'string' || typeof file.stream !== 'function') return respond({ error: 'Selecciona un video.' }, 400);
    const extension = TYPES.get(file.type);
    if (!extension) return respond({ error: 'Usa MP4 o WebM.' }, 400);
    if (!file.size || file.size > MAX_VIDEO_SIZE) return respond({ error: 'El video debe pesar entre 1 byte y 80 MB.' }, 413);
    const supplied = form.get('sort_order');
    let order;
    if (supplied !== null && supplied !== '') order = Number(supplied);
    else { const row = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM gallery_videos').first(); order = Number(row?.max_order ?? -1) + 1; }
    if (!Number.isSafeInteger(order)) return respond({ error: 'El orden debe ser entero.' }, 400);
    const title = String(form.get('title') || '').trim().slice(0, 300);
    const description = String(form.get('description') || '').trim().slice(0, 5000);
    const key = 'videos/' + crypto.randomUUID() + '.' + extension;
    await env.GALLERY_BUCKET.put(key, file, { httpMetadata: { contentType: file.type } });
    let result;
    try {
      result = await env.DB.prepare('INSERT INTO gallery_videos (title, description, sort_order, active, r2_key) VALUES (?, ?, ?, 1, ?)').bind(title || null, description || null, order, key).run();
      if (!result.meta?.last_row_id) throw new Error('Insert failed');
    } catch (error) { await env.GALLERY_BUCKET.delete(key); throw error; }
    return respond({ success: true, item: { id: result.meta.last_row_id, video_url: urlFor(request, result.meta.last_row_id), title, description, sort_order: order, active: 1 } }, 201);
  }
  if (adminMatch?.[1] && ['PATCH', 'DELETE'].includes(request.method)) {
    const id = Number(adminMatch[1]);
    const row = await env.DB.prepare('SELECT * FROM gallery_videos WHERE id = ?').bind(id).first();
    if (!row) return respond({ error: 'Video no encontrado.' }, 404);
    if (request.method === 'DELETE') {
      // Hide before removing the object; a failed object deletion can be retried.
      await env.DB.prepare('UPDATE gallery_videos SET active = 0 WHERE id = ?').bind(id).run();
      await env.GALLERY_BUCKET.delete(row.r2_key);
      await env.DB.prepare('DELETE FROM gallery_videos WHERE id = ?').bind(id).run();
      return respond({ success: true, deletedId: id });
    }
    let body;
    try { body = await request.json(); } catch (_) { return respond({ error: 'JSON inválido.' }, 400); }
    if (!body || typeof body !== 'object') return respond({ error: 'JSON inválido.' }, 400);
    const order = body.sort_order === undefined ? row.sort_order : Number(body.sort_order);
    if (!Number.isSafeInteger(order)) return respond({ error: 'El orden debe ser entero.' }, 400);
    let active = row.active;
    if (body.active !== undefined) {
      if ([true, 1, '1'].includes(body.active)) active = 1;
      else if ([false, 0, '0'].includes(body.active)) active = 0;
      else return respond({ error: 'active debe ser 1 o 0.' }, 400);
    }
    const title = body.title === undefined ? row.title : String(body.title ?? '').trim().slice(0, 300);
    const description = body.description === undefined ? row.description : String(body.description ?? '').trim().slice(0, 5000);
    await env.DB.prepare('UPDATE gallery_videos SET title = ?, description = ?, sort_order = ?, active = ? WHERE id = ?').bind(title || null, description || null, order, active, id).run();
    return respond({ success: true, item: itemFor(request, { ...row, title, description, sort_order: order, active }) });
  }
  return respond({ error: 'Método no permitido.' }, 405);
}

const ALLOWED_ORIGIN = "https://lamafiadelnorteentacna.github.io";

/* =========================================
   RESPUESTAS / CORS
========================================= */

function corsHeaders(origin = "") {
  return {
    "Access-Control-Allow-Origin":
      origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
    "Content-Type": "application/json; charset=UTF-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

/* =========================================
   HASH DE IP
   La IP no se guarda directamente en D1.
========================================= */

async function hashIP(ip, secret) {
  const data = new TextEncoder().encode(`${secret}:${ip}`);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/* =========================================
   ADMIN
========================================= */

function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) {
    return false;
  }

  const authorization =
    request.headers.get("Authorization") || "";

  return authorization === `Bearer ${env.ADMIN_TOKEN}`;
}

/* =========================================
   GALERÍA - UTILIDADES
========================================= */

const MAX_GALLERY_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
]);

function hasImageSignature(buffer, type) {
  const bytes = new Uint8Array(buffer);
  const ascii = (offset, length) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  if (type === "image/jpeg") {
    return bytes.length >= 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (type === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length &&
      signature.every((value, index) => bytes[index] === value);
  }

  if (type === "image/webp") {
    return bytes.length >= 12 &&
      ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  }

  if (type === "image/gif") {
    if (bytes.length < 6) return false;
    const signature = ascii(0, 6);
    return signature === "GIF87a" || signature === "GIF89a";
  }

  if (type === "image/avif") {
    if (bytes.length < 12 || ascii(4, 4) !== "ftyp") return false;
    for (let offset = 8; offset + 4 <= bytes.length && offset < 64; offset += 4) {
      const brand = ascii(offset, 4);
      if (brand === "avif" || brand === "avis") return true;
    }
  }

  return false;
}

function methodNotAllowed(origin, allowedMethods) {
  const headers = new Headers(corsHeaders(origin));
  headers.set("Allow", allowedMethods.join(", "));
  return new Response(JSON.stringify({ error: "Método no permitido." }), {
    status: 405,
    headers,
  });
}

function galleryImageUrl(request, id) {
  const url = new URL(request.url);
  return `${url.origin}/api/gallery/image/${id}`;
}

/* =========================================
   WORKER
========================================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    /* ---------- PREFLIGHT ---------- */

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    try {
      const videoResponse = await handleVideoRequest(request, env, { json, isAdmin, origin, allowedOrigin: ALLOWED_ORIGIN });
      if (videoResponse) return videoResponse;
      /* =====================================
         HEALTH CHECK
      ===================================== */

      if (url.pathname === "/" && request.method === "GET") {
        return json(
          {
            ok: true,
            service: "mafia-tacna-api",
          },
          200,
          origin
        );
      }

      /* =====================================
         CONTADOR - OBTENER VALOR
      ===================================== */

      if (
        url.pathname === "/api/counter" &&
        request.method === "GET"
      ) {
        const row = await env.DB
          .prepare("SELECT value FROM counter WHERE id = 1")
          .first();

        return json(
          {
            value: row?.value ?? 0,
          },
          200,
          origin
        );
      }

      /* =====================================
         COMPROBAR SI ESTA IP YA PARTICIPÓ
      ===================================== */

      if (
        url.pathname === "/api/counter/status" &&
        request.method === "GET"
      ) {
        const ip = request.headers.get("CF-Connecting-IP");

        if (!ip || !env.IP_HASH_SECRET) {
          return json(
            {
              alreadyVoted: false,
            },
            200,
            origin
          );
        }

        const ipHash = await hashIP(
          ip,
          env.IP_HASH_SECRET
        );

        const vote = await env.DB
          .prepare(
            "SELECT id FROM votes WHERE ip_hash = ? LIMIT 1"
          )
          .bind(ipHash)
          .first();

        return json(
          {
            alreadyVoted: Boolean(vote),
          },
          200,
          origin
        );
      }

      /* =====================================
         CONTADOR - +1
         SOLO UNA VEZ POR IP
      ===================================== */

      if (
        url.pathname === "/api/counter/increment" &&
        request.method === "POST"
      ) {
        const ip = request.headers.get("CF-Connecting-IP");

        if (!ip) {
          return json(
            {
              success: false,
              error: "No se pudo identificar la conexión.",
            },
            400,
            origin
          );
        }

        if (!env.IP_HASH_SECRET) {
          console.error(
            "IP_HASH_SECRET no está configurado."
          );

          return json(
            {
              success: false,
              error: "Configuración incompleta del servidor.",
            },
            500,
            origin
          );
        }

        const ipHash = await hashIP(
          ip,
          env.IP_HASH_SECRET
        );

        const voteResult = await env.DB
          .prepare(`
            INSERT OR IGNORE INTO votes (ip_hash)
            VALUES (?)
          `)
          .bind(ipHash)
          .run();

        /* ----- YA PARTICIPÓ ----- */

        if (!voteResult.meta?.changes) {
          const row = await env.DB
            .prepare(
              "SELECT value FROM counter WHERE id = 1"
            )
            .first();

          return json(
            {
              success: false,
              alreadyVoted: true,
              value: row?.value ?? 0,
            },
            200,
            origin
          );
        }

        /* ----- NUEVA PARTICIPACIÓN ----- */

        await env.DB
          .prepare(`
            UPDATE counter
            SET value = value + 1
            WHERE id = 1
          `)
          .run();

        const row = await env.DB
          .prepare(
            "SELECT value FROM counter WHERE id = 1"
          )
          .first();

        return json(
          {
            success: true,
            alreadyVoted: false,
            value: row?.value ?? 0,
          },
          200,
          origin
        );
      }

      /* =====================================
         ADMIN - MODIFICAR CONTADOR
      ===================================== */

      if (
        url.pathname === "/api/admin/counter" &&
        request.method === "POST"
      ) {
        if (!env.ADMIN_TOKEN) {
          return json(
            {
              error: "ADMIN_TOKEN no configurado.",
            },
            500,
            origin
          );
        }

        if (!isAdmin(request, env)) {
          return json(
            {
              error: "No autorizado.",
            },
            401,
            origin
          );
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json(
            {
              error: "JSON inválido.",
            },
            400,
            origin
          );
        }

        const action = body.action;
        const value = Number(body.value);

        if (
          !Number.isInteger(value) ||
          value < 0
        ) {
          return json(
            {
              error:
                "El valor debe ser un entero igual o mayor a 0.",
            },
            400,
            origin
          );
        }

        /* PONER VALOR EXACTO */

        if (action === "set") {
          await env.DB
            .prepare(`
              UPDATE counter
              SET value = ?
              WHERE id = 1
            `)
            .bind(value)
            .run();
        }

        /* SUMAR */

        else if (action === "add") {
          await env.DB
            .prepare(`
              UPDATE counter
              SET value = value + ?
              WHERE id = 1
            `)
            .bind(value)
            .run();
        }

        /* RESTAR */

        else if (action === "subtract") {
          await env.DB
            .prepare(`
              UPDATE counter
              SET value = MAX(0, value - ?)
              WHERE id = 1
            `)
            .bind(value)
            .run();
        }

        else {
          return json(
            {
              error:
                "Acción inválida. Usa set, add o subtract.",
            },
            400,
            origin
          );
        }

        const row = await env.DB
          .prepare(
            "SELECT value FROM counter WHERE id = 1"
          )
          .first();

        return json(
          {
            success: true,
            action,
            value: row?.value ?? 0,
          },
          200,
          origin
        );
      }

      /* =====================================
         NOTICIAS
      ===================================== */

      if (
        url.pathname === "/api/news" &&
        request.method === "GET"
      ) {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              title,
              summary,
              content,
              image_url,
              published,
              created_at,
              updated_at
            FROM news
            WHERE published = 1
            ORDER BY created_at DESC
          `)
          .all();

        return json(
          {
            items: result.results ?? [],
          },
          200,
          origin
        );
      }

      /* =====================================
         GALERÍA - LISTA PÚBLICA
      ===================================== */

      if (
        url.pathname === "/api/gallery" &&
        request.method === "GET"
      ) {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              title,
              description,
              image_url,
              sort_order,
              active,
              created_at
            FROM gallery
            WHERE active = 1
            ORDER BY sort_order ASC, created_at DESC
          `)
          .all();

        const items = (result.results ?? []).map((item) => ({
          ...item,
          image_url: galleryImageUrl(request, item.id),
        }));

        return json(
          {
            items,
          },
          200,
          origin
        );
      }

      /* =====================================
         GALERÍA - SERVIR IMAGEN DESDE R2
      ===================================== */

      const publicImageMatch =
        url.pathname.match(/^\/api\/gallery\/image\/(\d+)$/);

      if (
        publicImageMatch &&
        request.method === "GET"
      ) {
        const id = Number(publicImageMatch[1]);

        const row = await env.DB
          .prepare(`
            SELECT r2_key, active
            FROM gallery
            WHERE id = ?
            LIMIT 1
          `)
          .bind(id)
          .first();

        if (!row || !row.active || !row.r2_key) {
          return json(
            {
              error: "Imagen no encontrada.",
            },
            404,
            origin
          );
        }

        const object = await env.GALLERY_BUCKET.get(row.r2_key);

        if (!object) {
          return json(
            {
              error: "Archivo no encontrado.",
            },
            404,
            origin
          );
        }

        const headers = new Headers();

        object.writeHttpMetadata(headers);

        if (!headers.get("Content-Type")) {
          headers.set(
            "Content-Type",
            object.httpMetadata?.contentType ||
              "application/octet-stream"
          );
        }

        headers.set(
          "Cache-Control",
          "public, max-age=86400"
        );

        headers.set("ETag", object.httpEtag);
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

        headers.set(
          "Access-Control-Allow-Origin",
          origin === ALLOWED_ORIGIN
            ? ALLOWED_ORIGIN
            : "null"
        );

        return new Response(object.body, {
          status: 200,
          headers,
        });
      }

      /* =====================================
         ADMIN GALERÍA - LISTAR TODO
      ===================================== */

      if (
        url.pathname === "/api/admin/gallery" &&
        request.method === "GET"
      ) {
        if (!env.ADMIN_TOKEN) {
          return json(
            {
              error: "ADMIN_TOKEN no configurado.",
            },
            500,
            origin
          );
        }

        if (!isAdmin(request, env)) {
          return json(
            {
              error: "No autorizado.",
            },
            401,
            origin
          );
        }

        const result = await env.DB
          .prepare(`
            SELECT
              id,
              title,
              description,
              image_url,
              sort_order,
              active,
              created_at,
              r2_key
            FROM gallery
            ORDER BY sort_order ASC, created_at DESC
          `)
          .all();

        const items = (result.results ?? []).map((item) => ({
          ...item,
          image_url: item.r2_key
            ? galleryImageUrl(request, item.id)
            : item.image_url,
        }));

        return json(
          {
            items,
          },
          200,
          origin
        );
      }

      /* =====================================
         ADMIN GALERÍA - SUBIR IMAGEN
      ===================================== */

      if (
        url.pathname === "/api/admin/gallery" &&
        request.method === "POST"
      ) {
        if (!env.ADMIN_TOKEN) {
          return json(
            {
              error: "ADMIN_TOKEN no configurado.",
            },
            500,
            origin
          );
        }

        if (!isAdmin(request, env)) {
          return json(
            {
              error: "No autorizado.",
            },
            401,
            origin
          );
        }

        if (!env.GALLERY_BUCKET) {
          return json(
            {
              error: "GALLERY_BUCKET no configurado.",
            },
            500,
            origin
          );
        }

        const contentType =
          request.headers.get("Content-Type") || "";

        if (!contentType.includes("multipart/form-data")) {
          return json(
            {
              error: "Se requiere multipart/form-data.",
            },
            400,
            origin
          );
        }

        let formData;

        try {
          formData = await request.formData();
        } catch {
          return json(
            {
              error: "No se pudo procesar el formulario.",
            },
            400,
            origin
          );
        }

        const image = formData.get("image");
        const title = String(
          formData.get("title") || ""
        ).trim();

        const description = String(
          formData.get("description") || ""
        ).trim();

        const requestedSortOrder =
          formData.get("sort_order");

        if (
          !image ||
          typeof image === "string" ||
          typeof image.arrayBuffer !== "function"
        ) {
          return json(
            {
              error: "Debes seleccionar una imagen.",
            },
            400,
            origin
          );
        }

        const extension =
          ALLOWED_IMAGE_TYPES.get(image.type);

        if (!extension) {
          return json(
            {
              error:
                "Formato no permitido. Usa JPG, PNG, WebP, GIF o AVIF.",
            },
            400,
            origin
          );
        }

        if (image.size <= 0) {
          return json(
            {
              error: "La imagen está vacía.",
            },
            400,
            origin
          );
        }

        if (image.size > MAX_GALLERY_FILE_SIZE) {
          return json(
            {
              error: "La imagen supera el límite de 10 MB.",
            },
            413,
            origin
          );
        }

        let sortOrder;

        if (
          requestedSortOrder !== null &&
          requestedSortOrder !== ""
        ) {
          sortOrder = Number(requestedSortOrder);

          if (!Number.isInteger(sortOrder)) {
            return json(
              {
                error: "sort_order debe ser un número entero.",
              },
              400,
              origin
            );
          }
        } else {
          const maxRow = await env.DB
            .prepare(`
              SELECT COALESCE(MAX(sort_order), -1) AS max_order
              FROM gallery
            `)
            .first();

          sortOrder =
            Number(maxRow?.max_order ?? -1) + 1;
        }

        const r2Key =
          `gallery/${crypto.randomUUID()}.${extension}`;

        const buffer = await image.arrayBuffer();

        if (!hasImageSignature(buffer, image.type)) {
          return json(
            {
              error: "El contenido del archivo no coincide con el formato de imagen declarado.",
            },
            400,
            origin
          );
        }

        await env.GALLERY_BUCKET.put(
          r2Key,
          buffer,
          {
            httpMetadata: {
              contentType: image.type,
              cacheControl:
                "public, max-age=86400",
            },
            customMetadata: {
              uploadedAt: new Date().toISOString(),
            },
          }
        );

        try {
          const insertResult = await env.DB
            .prepare(`
              INSERT INTO gallery (
                title,
                description,
                image_url,
                sort_order,
                active,
                r2_key
              )
              VALUES (?, ?, ?, ?, 1, ?)
            `)
            .bind(
              title || null,
              description || null,
              "",
              sortOrder,
              r2Key
            )
            .run();

          const id =
            insertResult.meta?.last_row_id;

          if (!id) {
            throw new Error(
              "No se pudo obtener el ID del registro."
            );
          }

          const imageUrl =
            galleryImageUrl(request, id);

          await env.DB
            .prepare(`
              UPDATE gallery
              SET image_url = ?
              WHERE id = ?
            `)
            .bind(imageUrl, id)
            .run();

          const row = await env.DB
            .prepare(`
              SELECT
                id,
                title,
                description,
                image_url,
                sort_order,
                active,
                created_at
              FROM gallery
              WHERE id = ?
            `)
            .bind(id)
            .first();

          return json(
            {
              success: true,
              item: row,
            },
            201,
            origin
          );
        } catch (error) {
          await env.GALLERY_BUCKET.delete(r2Key);
          throw error;
        }
      }

      /* =====================================
         ADMIN GALERÍA - EDITAR
      ===================================== */

      const adminGalleryMatch =
        url.pathname.match(/^\/api\/admin\/gallery\/(\d+)$/);

      if (
        adminGalleryMatch &&
        request.method === "PATCH"
      ) {
        if (!env.ADMIN_TOKEN) {
          return json(
            {
              error: "ADMIN_TOKEN no configurado.",
            },
            500,
            origin
          );
        }

        if (!isAdmin(request, env)) {
          return json(
            {
              error: "No autorizado.",
            },
            401,
            origin
          );
        }

        const id = Number(adminGalleryMatch[1]);

        const existing = await env.DB
          .prepare(`
            SELECT *
            FROM gallery
            WHERE id = ?
            LIMIT 1
          `)
          .bind(id)
          .first();

        if (!existing) {
          return json(
            {
              error: "Imagen no encontrada.",
            },
            404,
            origin
          );
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json(
            {
              error: "JSON inválido.",
            },
            400,
            origin
          );
        }

        const title =
          Object.prototype.hasOwnProperty.call(body, "title")
            ? String(body.title ?? "").trim()
            : existing.title;

        const description =
          Object.prototype.hasOwnProperty.call(body, "description")
            ? String(body.description ?? "").trim()
            : existing.description;

        let sortOrder = existing.sort_order;

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "sort_order"
          )
        ) {
          sortOrder = Number(body.sort_order);

          if (!Number.isInteger(sortOrder)) {
            return json(
              {
                error: "sort_order debe ser un número entero.",
              },
              400,
              origin
            );
          }
        }

        let active = existing.active;

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "active"
          )
        ) {
          if (
            body.active === true ||
            body.active === 1 ||
            body.active === "1"
          ) {
            active = 1;
          } else if (
            body.active === false ||
            body.active === 0 ||
            body.active === "0"
          ) {
            active = 0;
          } else {
            return json(
              {
                error: "active debe ser true/false o 1/0.",
              },
              400,
              origin
            );
          }
        }

        await env.DB
          .prepare(`
            UPDATE gallery
            SET
              title = ?,
              description = ?,
              sort_order = ?,
              active = ?
            WHERE id = ?
          `)
          .bind(
            title || null,
            description || null,
            sortOrder,
            active,
            id
          )
          .run();

        const updated = await env.DB
          .prepare(`
            SELECT
              id,
              title,
              description,
              image_url,
              sort_order,
              active,
              created_at
            FROM gallery
            WHERE id = ?
          `)
          .bind(id)
          .first();

        if (updated?.id) {
          updated.image_url =
            galleryImageUrl(request, updated.id);
        }

        return json(
          {
            success: true,
            item: updated,
          },
          200,
          origin
        );
      }

      /* =====================================
         ADMIN GALERÍA - ELIMINAR
      ===================================== */

      if (
        adminGalleryMatch &&
        request.method === "DELETE"
      ) {
        if (!env.ADMIN_TOKEN) {
          return json(
            {
              error: "ADMIN_TOKEN no configurado.",
            },
            500,
            origin
          );
        }

        if (!isAdmin(request, env)) {
          return json(
            {
              error: "No autorizado.",
            },
            401,
            origin
          );
        }

        if (!env.GALLERY_BUCKET) {
          return json(
            {
              error: "GALLERY_BUCKET no configurado.",
            },
            500,
            origin
          );
        }

        const id = Number(adminGalleryMatch[1]);

        const existing = await env.DB
          .prepare(`
            SELECT id, r2_key
            FROM gallery
            WHERE id = ?
            LIMIT 1
          `)
          .bind(id)
          .first();

        if (!existing) {
          return json(
            {
              error: "Imagen no encontrada.",
            },
            404,
            origin
          );
        }

        if (existing.r2_key) {
          await env.GALLERY_BUCKET.delete(
            existing.r2_key
          );
        }

        await env.DB
          .prepare(`
            DELETE FROM gallery
            WHERE id = ?
          `)
          .bind(id)
          .run();

        return json(
          {
            success: true,
            deletedId: id,
          },
          200,
          origin
        );
      }

      const routeMethods = new Map([
        ["/", ["GET"]],
        ["/api/counter", ["GET"]],
        ["/api/counter/status", ["GET"]],
        ["/api/counter/increment", ["POST"]],
        ["/api/admin/counter", ["POST"]],
        ["/api/news", ["GET"]],
        ["/api/gallery", ["GET"]],
        ["/api/admin/gallery", ["GET", "POST"]],
      ]);
      const allowedMethods = routeMethods.get(url.pathname) ||
        (publicImageMatch ? ["GET"] : null) ||
        (adminGalleryMatch ? ["PATCH", "DELETE"] : null);

      if (allowedMethods) {
        return methodNotAllowed(origin, allowedMethods);
      }

      /* =====================================
         404
      ===================================== */

      return json(
        {
          error: "Not found",
        },
        404,
        origin
      );
    } catch (error) {
      console.error("Worker error:", error);

      return json(
        {
          error: "Internal server error",
        },
        500,
        origin
      );
    }
  },
};