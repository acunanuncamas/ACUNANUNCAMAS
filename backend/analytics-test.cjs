// Integration tests use real SQLite via Python; no Cloudflare resources are accessed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const python = process.env.PYTHON || 'python';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-test-'));
const database = path.join(temporary, 'test.sqlite');
const bridge = `import sqlite3,json,sys
con=sqlite3.connect(sys.argv[1]); con.row_factory=sqlite3.Row
payload=json.load(sys.stdin)
with con:
 if 'schema' in payload: con.executescript(payload['schema'])
 result=[]
 for statement in payload.get('statements',[]):
  cur=con.execute(statement['sql'],statement.get('args',[]))
  result.append({'results':[dict(row) for row in cur.fetchall()]})
print(json.dumps(result))`;
function execute(statements = [], schema) {
  const child = spawnSync(python, ['-c', bridge, database], { input: JSON.stringify({ statements, schema }), encoding: 'utf8' });
  if (child.status !== 0) throw new Error(child.stderr || child.error?.message);
  return JSON.parse(child.stdout);
}
class Statement {
  constructor(sql) { this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async run() { return execute([this])[0]; }
  async all() { return execute([this])[0]; }
  async first() { return execute([this])[0].results[0] || null; }
}
const env = { ADMIN_TOKEN: 'test-only', DB: { prepare: (sql) => new Statement(sql), batch: async (statements) => execute(statements) } };
const origin = 'https://lamafiadelnorteentacna.github.io';
let now = Date.parse('2026-09-26T17:00:00Z');
const originalNow = Date.now;
Date.now = () => now;
const id = '12345678-1234-4123-8123-123456789abc';
async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'analytics.sql'), 'utf8');
  execute([], schema); execute([], schema); // Idempotent migration.
  const source = fs.readFileSync(path.join(__dirname, 'worker-cloudflare.js'), 'utf8');
  const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  async function call(route, { method = 'POST', body = { visitorId: id }, auth = false, requestOrigin = origin } = {}) {
    const headers = { Origin: requestOrigin };
    if (auth) headers.Authorization = 'Bearer test-only';
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    const response = await worker.fetch(new Request('https://api.test' + route, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }), env);
    return { status: response.status, data: await response.json() };
  }
  const stats = async () => (await call('/api/admin/stats', { method: 'GET', auth: true })).data;
  assert.equal((await call('/api/admin/stats', { method: 'GET' })).status, 401);
  assert.equal((await call('/api/analytics/visit', { method: 'GET' })).status, 405);
  assert.equal((await call('/api/analytics/visit', { requestOrigin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/api/analytics/visit', { body: { visitorId: 'bad' } })).status, 400);
  assert.equal((await call('/api/analytics/visit', { body: { visitorId: id, extra: 'x'.repeat(300) } })).status, 413);
  assert.equal((await call('/api/analytics/visit')).status, 200);
  await Promise.all(Array.from({ length: 15 }, () => call('/api/analytics/visit')));
  let data = await stats();
  assert.equal(data.total, 1); assert.equal(data.today, 1); assert.equal(data.uniqueToday, 1); assert.equal(data.online, 1);
  assert.equal(data.days.length, 7); assert.equal(data.days[0].visits, 0);
  now += 120000; await call('/api/analytics/heartbeat');
  assert.equal((await stats()).total, 1);
  now += 300001; assert.equal((await stats()).online, 0);
  await call('/api/analytics/heartbeat'); assert.equal((await stats()).online, 1);
  now += 30 * 60000; await call('/api/analytics/visit');
  data = await stats(); assert.equal(data.total, 2); assert.equal(data.uniqueToday, 1);
  await call('/api/analytics/visit', { body: { visitorId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } });
  data = await stats(); assert.equal(data.total, 3); assert.equal(data.uniqueToday, 2); assert.equal(data.online, 2);
  now = Date.parse('2026-09-27T04:59:59Z'); await call('/api/analytics/visit');
  assert.equal((await stats()).days[6].day, '2026-09-26');
  now += 2000; data = await stats(); assert.equal(data.today, 0); assert.equal(data.days[6].day, '2026-09-27');
  now += 31 * 60000; await call('/api/analytics/visit'); data = await stats(); assert.equal(data.today, 1); assert.equal(data.uniqueToday, 1);
  const total = data.total;
  now += 9 * 86400000; data = await stats(); assert.equal(data.total, total); assert.equal(data.online, 0);
  assert.equal(execute([{ sql: 'SELECT COUNT(*) AS n FROM analytics_uniques' }])[0].results[0].n, 0);
  await call('/api/analytics/heartbeat'); assert.equal((await stats()).online, 1); assert.equal((await stats()).total, total);
  assert.equal((await call('/', { method: 'GET' })).status, 200);
  assert.equal((await call('/api/admin/gallery', { method: 'GET' })).status, 401);
  assert.equal((await call('/api/admin/videos', { method: 'GET' })).status, 401);
  // Test the admin lifecycle with a DOM/API double; this is not visual browser QA.
  const vm = require('node:vm');
  class Element {
    constructor() { this.hidden = false; this.value = ''; this.dataset = {}; this.style = {}; this.children = []; this.listeners = {}; this.classList = { add() {}, remove() {} }; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    setAttribute(name, value) { this[name] = value; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    prepend(...children) { this.children.unshift(...children); }
    querySelectorAll() { return []; }
    get options() { return this.children; }
  }
  const elements = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  element('workspace').hidden = true;
  const listeners = {};
  const document = { hidden: false, getElementById: element, querySelectorAll: () => [], createElement: () => new Element(), createTextNode: (text) => text, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const requests = []; let failStats = false; let unauthorizedStats = false;
  const intervals = new Map(); let timer = 0;
  const storage = new Map();
  const context = {
    document, console, URL, Intl, Date, AbortController, TypeError, Error,
    setTimeout: () => ++timer, clearTimeout() {},
    setInterval: (fn) => { intervals.set(++timer, fn); return timer; }, clearInterval: (id) => intervals.delete(id),
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/stats') && failStats) throw new TypeError('offline');
      const denied = url.endsWith('/stats') && unauthorizedStats;
      return { ok: !denied, status: denied ? 401 : 200, text: async () => JSON.stringify(url.endsWith('/stats') ? (denied ? {error:'Unauthorized'} : { today: 2, uniqueToday: 1, online: 1, total: 4, days: Array.from({length:7}, (_,i) => ({day:'2026-09-' + (20+i),visits:i})) }) : {items:[]}) };
    }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../admin-news.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../admin-gallery.js'), 'utf8'), context);
  const flush = async () => { for(let i=0;i<10;i++) await Promise.resolve(); };
  element('admin-token').value = 'test-only';
  await element('login-form').listeners.submit({preventDefault(){}}); await flush();
  assert.equal(element('workspace').hidden, false); assert.equal(element('stats-today').textContent, '2');
  assert.equal(element('stats-chart').children.length, 7); assert.equal(intervals.size, 1);
  assert.ok(requests.find((r) => r.url.endsWith('/stats')).options.headers.Authorization === 'Bearer test-only');
  document.hidden = true; const before = requests.length;
  for(const fn of intervals.values()) fn(); await flush(); assert.equal(requests.length, before);
  document.hidden = false; failStats = true;
  element('stats-refresh').listeners.click(); await flush();
  assert.equal(element('workspace').hidden, false); assert.equal(element('stats-today').textContent, '—');
  assert.equal(element('stats-status').dataset.error, 'true');
  failStats = false; element('stats-refresh').listeners.click(); await flush();
  assert.equal(element('stats-today').textContent, '2');
  unauthorizedStats = true; element('stats-refresh').listeners.click(); await flush();
  assert.equal(element('workspace').hidden, true); assert.equal(intervals.size, 0);
  assert.equal(element('stats-chart').children.length, 0);
  console.log('PASS: admin automatic load, seven bars, bearer auth, hidden-tab pause, independent error, retry and expired-session cleanup (DOM double).');
  // Confirm modular and paste-ready variants use identical analytics implementations.
  const module = fs.readFileSync(path.join(__dirname, 'worker-analytics.js'), 'utf8').replace(/\nexport \{ handleAnalyticsRequest \};\n$/, '');
  assert.ok(source.startsWith(module));
  console.log('PASS: migration, real SQL, F5 dedup, unique visitors, heartbeat, expiry, Lima midnight, retained totals, authorization, route isolation, Worker parity.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  Date.now = originalNow;
  fs.rmSync(temporary, { recursive: true, force: true });
});
