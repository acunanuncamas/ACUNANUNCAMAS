const MAX_VIDEO_SIZE = 80 * 1024 * 1024;
const TYPES = new Map([['video/mp4', 'mp4'], ['video/webm', 'webm']]);
const urlFor = (request, id) => new URL('/api/gallery/video/' + id, request.url).href;
const itemFor = (request, row) => ({ id: row.id, title: row.title, description: row.description, sort_order: row.sort_order, active: row.active, created_at: row.created_at, video_url: urlFor(request, row.id) });

export async function handleVideoRequest(request, env, helpers) {
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
    const headers = new Headers({ 'Access-Control-Allow-Origin': origin === allowedOrigin ? allowedOrigin : 'null', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600', 'ETag': head.httpEtag, 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' });
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