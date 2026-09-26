// Statistics are independent of votes, IPs and R2. All timestamps are server-side.
const ANALYTICS_WINDOW = 30 * 60 * 1000;
const analyticsDay = (time) => new Date(time - 5 * 3600000).toISOString().slice(0, 10);
async function analyticsHash(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function handleAnalyticsRequest(request, env, helpers) {
  const { json, isAdmin, origin, allowedOrigin } = helpers;
  const path = new URL(request.url).pathname;
  if (!['/api/analytics/visit', '/api/analytics/heartbeat', '/api/admin/stats'].includes(path)) return null;
  const respond = (data, status = 200) => json(data, status, origin);
  const admin = path === '/api/admin/stats';
  if (admin && !isAdmin(request, env)) return respond({ error: 'No autorizado.' }, 401);
  if (request.method !== (admin ? 'GET' : 'POST')) return respond({ error: 'Método no permitido.' }, 405);
  const now = Date.now();
  const today = analyticsDay(now);
  const since = analyticsDay(now - 6 * 86400000);
  if (admin) {
    // Keep only short-lived identifiers; daily aggregate counts are never deleted.
    const result = await env.DB.batch([
      env.DB.prepare('DELETE FROM analytics_presence WHERE last_seen < ?').bind(now - 86400000),
      env.DB.prepare('DELETE FROM analytics_uniques WHERE day < ?').bind(since),
      env.DB.prepare('SELECT COALESCE(SUM(visits), 0) AS total, COALESCE(SUM(CASE WHEN day = ? THEN visits ELSE 0 END), 0) AS today FROM analytics_daily').bind(today),
      env.DB.prepare('SELECT COUNT(*) AS count FROM analytics_uniques WHERE day = ?').bind(today),
      env.DB.prepare('SELECT COUNT(*) AS count FROM analytics_presence WHERE last_seen >= ?').bind(now - 300000),
      env.DB.prepare('SELECT day, visits FROM analytics_daily WHERE day >= ? AND day <= ? ORDER BY day').bind(since, today)
    ]);
    const counts = new Map(result[5].results.map((row) => [row.day, Number(row.visits)]));
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = analyticsDay(now - (6 - i) * 86400000);
      return { day, visits: counts.get(day) || 0 };
    });
    return respond({ today: Number(result[2].results[0].today), total: Number(result[2].results[0].total), uniqueToday: Number(result[3].results[0].count), online: Number(result[4].results[0].count), days, timezone: 'America/Lima' });
  }
  if (![allowedOrigin, 'null'].includes(origin)) return respond({ error: 'Origen no permitido.' }, 403);
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return respond({ error: 'Se requiere JSON.' }, 415);
  // Read a bounded body even if Content-Length is absent or dishonest.
  const reader = request.body?.getReader();
  if (!reader) return respond({ error: 'Cuerpo requerido.' }, 400);
  let bytes = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 256) { await reader.cancel(); return respond({ error: 'Cuerpo demasiado grande.' }, 413); }
    chunks.push(value);
  }
  let body;
  try { body = JSON.parse(chunks.map((chunk) => new TextDecoder().decode(chunk)).join('')); }
  catch (_) { return respond({ error: 'JSON inválido.' }, 400); }
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body?.visitorId || '')) return respond({ error: 'Identificador inválido.' }, 400);
  const id = await analyticsHash(body.visitorId.toLowerCase());
  if (path.endsWith('/heartbeat')) {
    await env.DB.prepare(`INSERT INTO analytics_presence (visitor_id, last_visit, last_seen) VALUES (?, 0, ?) ON CONFLICT(visitor_id) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen) WHERE last_seen < ?`).bind(id, now, now - 60000).run();
    return respond({ success: true });
  }
  const dailyId = await analyticsHash(today + ':' + id);
  // D1 batch is atomic: reloads and simultaneous tabs share the same rolling window.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO analytics_daily (day, visits)
      SELECT ?, 1 WHERE NOT EXISTS (SELECT 1 FROM analytics_presence WHERE visitor_id = ? AND last_visit > ?)
      ON CONFLICT(day) DO UPDATE SET visits = visits + 1`).bind(today, id, now - ANALYTICS_WINDOW),
    env.DB.prepare('INSERT OR IGNORE INTO analytics_uniques (day, visitor_id) VALUES (?, ?)').bind(today, dailyId),
    env.DB.prepare(`INSERT INTO analytics_presence (visitor_id, last_visit, last_seen) VALUES (?, ?, ?)
      ON CONFLICT(visitor_id) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen),
      last_visit = CASE WHEN last_visit <= ? THEN excluded.last_visit ELSE last_visit END`).bind(id, now, now, now - ANALYTICS_WINDOW)
  ]);
  return respond({ success: true });
}

export { handleAnalyticsRequest };
