// News has its own additive table; the legacy news table is left intact.
const NEWS_TYPES = new Set(['principal', 'mediana', 'pequena', 'tipografica']);
const NEWS_IMAGE_TYPES = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif']]);
const NEWS_IMAGE_LIMIT = 10 * 1024 * 1024;
function newsImageSignature(buffer, type) {
  const b = new Uint8Array(buffer);
  const text = (start, length) => String.fromCharCode(...b.subarray(start, start + length));
  if (type === 'image/jpeg') return b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (type === 'image/png') return b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n);
  if (type === 'image/webp') return b.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP';
  return type === 'image/gif' && ['GIF87a', 'GIF89a'].includes(text(0, 6));
}
function newsRecord(request, row, admin = false) {
  const item = { id: row.id, title: row.title, date: row.date, url: row.external_url, visual_type: row.visual_type, sort_order: row.sort_order, published: row.published, created_at: row.created_at, updated_at: row.updated_at,
    image_url: row.r2_key && row.published ? new URL('/api/news/image/' + row.id, request.url).href : null };
  if (admin) item.has_image = Boolean(row.r2_key);
  return item;
}
function validateNews(body, existing = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Datos inválidos.');
  const get = (name, fallback) => Object.prototype.hasOwnProperty.call(body, name) ? body[name] : existing[name] ?? fallback;
  const title = get('title', '');
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 300 || /[\u0000-\u001f]/.test(title)) throw new Error('El titular es obligatorio y admite hasta 300 caracteres.');
  const rawUrl = Object.prototype.hasOwnProperty.call(body, 'url') ? body.url : existing.external_url;
  let url;
  try { url = new URL(rawUrl); } catch (_) { throw new Error('Introduce una URL externa absoluta.'); }
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048 || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('La URL debe usar HTTP o HTTPS, sin credenciales.');
  const rawDate = get('date', null);
  const date = rawDate === '' || rawDate === null ? null : rawDate;
  if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) throw new Error('Fecha inválida.');
  const type = get('visual_type', 'mediana');
  if (!NEWS_TYPES.has(type)) throw new Error('Tipo visual inválido.');
  const rawOrder = get('sort_order', 0);
  const order = typeof rawOrder === 'number' || typeof rawOrder === 'string' && /^-?\d+$/.test(rawOrder) ? Number(rawOrder) : NaN;
  if (!Number.isSafeInteger(order) || Math.abs(order) > 2147483647) throw new Error('El orden debe ser un entero válido.');
  const flag = get('published', 0);
  if (![true, false, 1, 0, '1', '0'].includes(flag)) throw new Error('Estado de publicación inválido.');
  const remove = body.remove_image ?? false;
  if (![true, false, 1, 0, '1', '0'].includes(remove)) throw new Error('Estado de imagen inválido.');
  return { title: title.trim(), url: url.href, date, type, order, published: [true, 1, '1'].includes(flag) ? 1 : 0, remove: [true, 1, '1'].includes(remove) };
}
async function readNewsBody(request) {
  const type = request.headers.get('Content-Type') || '';
  const multipart = type.startsWith('multipart/form-data');
  if (!multipart && !type.startsWith('application/json')) throw Object.assign(new Error('Usa JSON o multipart/form-data.'), { status: 415 });
  const limit = multipart ? NEWS_IMAGE_LIMIT + 16384 : 8192;
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Cuerpo requerido.');
  const parts = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw Object.assign(new Error('La imagen supera 10 MB o el formulario es demasiado grande.'), { status: 413 }); }
    parts.push(value);
  }
  const buffer = new Uint8Array(size); let offset = 0;
  parts.forEach((part) => { buffer.set(part, offset); offset += part.byteLength; });
  if (!multipart) {
    try { return { body: JSON.parse(new TextDecoder().decode(buffer)), file: null }; }
    catch (_) { throw new Error('JSON inválido.'); }
  }
  let form;
  try { form = await new Response(buffer, { headers: { 'Content-Type': type } }).formData(); }
  catch (_) { throw new Error('Formulario inválido.'); }
  const body = {};
  for (const name of ['title', 'url', 'date', 'visual_type', 'sort_order', 'published', 'remove_image']) {
    if (form.has(name)) { const value = form.get(name); if (typeof value !== 'string') throw new Error('Campo inválido.'); body[name] = value; }
  }
  const file = form.get('image');
  if (file !== null && (typeof file === 'string' || typeof file.arrayBuffer !== 'function')) throw new Error('Imagen inválida.');
  if (file && !file.size) throw new Error('La imagen está vacía.');
  return { body, file };
}
async function handleNewsRequest(request, env, helpers) {
  const { json, isAdmin, origin, allowedOrigin } = helpers;
  const path = new URL(request.url).pathname;
  const adminMatch = path.match(/^\/api\/admin\/news(?:\/(\d+)(?:\/(image))?)?$/);
  const publicImage = path.match(/^\/api\/news\/image\/(\d+)$/);
  const list = path === '/api/news';
  if (!adminMatch && !publicImage && !list) return null;
  const respond = (body, status = 200) => json(body, status, origin);
  if (adminMatch && !isAdmin(request, env)) return respond({ error: 'No autorizado.' }, 401);
  const id = Number(adminMatch?.[1] || publicImage?.[1] || 0);
  if ((adminMatch?.[1] || publicImage) && (!Number.isSafeInteger(id) || id <= 0)) return respond({ error: 'ID inválido.' }, 400);
  const image = publicImage || adminMatch?.[2];
  const methods = image ? ['GET', 'HEAD'] : list ? ['GET'] : id ? ['PATCH', 'DELETE'] : ['GET', 'POST'];
  if (!methods.includes(request.method)) return respond({ error: 'Método no permitido.' }, 405);
  if (image) {
    const row = await env.DB.prepare('SELECT r2_key, published FROM news_entries WHERE id = ?').bind(id).first();
    if (!row?.r2_key || !adminMatch && !row.published) return respond({ error: 'Imagen no encontrada.' }, 404);
    if (!env.GALLERY_BUCKET) return respond({ error: 'GALLERY_BUCKET no configurado.' }, 500);
    const object = await env.GALLERY_BUCKET.get(row.r2_key);
    if (!object) return respond({ error: 'Imagen no encontrada.' }, 404);
    const headers = new Headers({ 'Access-Control-Allow-Origin': origin === allowedOrigin ? allowedOrigin : 'null', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  }
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM news_entries ' + (list ? 'WHERE published = 1 ' : '') + 'ORDER BY sort_order ASC, created_at DESC, id DESC').all();
    return respond({ items: (rows.results || []).map((row) => newsRecord(request, row, Boolean(adminMatch))) });
  }
  const existing = id ? await env.DB.prepare('SELECT * FROM news_entries WHERE id = ?').bind(id).first() : null;
  if (id && !existing) return respond({ error: 'Noticia no encontrada.' }, 404);
  if (request.method === 'DELETE') {
    if (existing.r2_key && !env.GALLERY_BUCKET) return respond({ error: 'GALLERY_BUCKET no configurado.' }, 500);
    // Unpublish before object removal; an R2 failure can be retried safely.
    await env.DB.prepare("UPDATE news_entries SET published = 0, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    if (existing.r2_key) await env.GALLERY_BUCKET.delete(existing.r2_key);
    await env.DB.prepare('DELETE FROM news_entries WHERE id = ?').bind(id).run();
    return respond({ success: true, deletedId: id });
  }
  let input, data, buffer, extension;
  try {
    input = await readNewsBody(request); data = validateNews(input.body, existing || {});
    if (input.file) {
      extension = NEWS_IMAGE_TYPES.get(input.file.type);
      if (!extension) throw new Error('Usa JPG, PNG, WebP o GIF.');
      if (input.file.size > NEWS_IMAGE_LIMIT) throw Object.assign(new Error('La imagen supera 10 MB.'), { status: 413 });
      if (data.remove) throw new Error('No puedes quitar y subir una imagen a la vez.');
      buffer = await input.file.arrayBuffer();
      if (!newsImageSignature(buffer, input.file.type)) throw new Error('El archivo no coincide con su formato de imagen.');
    }
  } catch (error) { return respond({ error: error.message }, error.status || 400); }
  if ((input.file || data.remove && existing?.r2_key) && !env.GALLERY_BUCKET) return respond({ error: 'GALLERY_BUCKET no configurado.' }, 500);
  const uploadedKey = input.file ? 'news/' + crypto.randomUUID() + '.' + extension : null;
  const key = uploadedKey || (data.remove ? null : existing?.r2_key || null);
  if (uploadedKey) await env.GALLERY_BUCKET.put(uploadedKey, buffer, { httpMetadata: { contentType: input.file.type, cacheControl: 'no-store' } });
  const timestamp = new Date().toISOString();
  let savedId = id;
  try {
    if (id) {
      const result = await env.DB.prepare(`UPDATE news_entries SET title = ?, date = ?, external_url = ?, visual_type = ?, sort_order = ?, published = ?, r2_key = ?, updated_at = ? WHERE id = ? AND r2_key IS ?`)
        .bind(data.title, data.date, data.url, data.type, data.order, data.published, key, timestamp, id, existing.r2_key).run();
      if (result.meta?.changes === 0) throw Object.assign(new Error('La noticia cambió. Actualiza la lista antes de reintentar.'), { status: 409 });
    } else {
      const result = await env.DB.prepare(`INSERT INTO news_entries (title, date, external_url, visual_type, sort_order, published, r2_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(data.title, data.date, data.url, data.type, data.order, data.published, key, timestamp, timestamp).run();
      savedId = result.meta?.last_row_id;
      if (!savedId) throw new Error('No se pudo crear la noticia.');
    }
  } catch (error) {
    if (uploadedKey) await env.GALLERY_BUCKET.delete(uploadedKey);
    if (error.status) return respond({ error: error.message }, error.status);
    throw error;
  }
  if (existing?.r2_key && existing.r2_key !== key) {
    try { await env.GALLERY_BUCKET.delete(existing.r2_key); } catch (error) { console.error('News old image cleanup failed:', error); }
  }
  const row = await env.DB.prepare('SELECT * FROM news_entries WHERE id = ?').bind(savedId).first();
  return respond({ success: true, item: newsRecord(request, row, true) }, id ? 200 : 201);
}

export { handleNewsRequest };
