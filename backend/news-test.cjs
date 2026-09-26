// Integration tests use real SQLite via Python; no Cloudflare resources are accessed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const python = process.env.PYTHON || 'python';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'news-test-'));
const database = path.join(temporary, 'test.sqlite');
const bridge = `import sqlite3,json,sys
con=sqlite3.connect(sys.argv[1]); con.row_factory=sqlite3.Row
payload=json.load(sys.stdin)
with con:
 if 'schema' in payload: con.executescript(payload['schema'])
 result=[]
 for statement in payload.get('statements',[]):
  cur=con.execute(statement['sql'],statement.get('args',[]))
  result.append({'results':[dict(row) for row in cur.fetchall()], 'meta':{'last_row_id':cur.lastrowid,'changes':max(0,cur.rowcount)}})
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

const objects = new Map(); let failDelete = false;
const bucket = {
 async put(key, data, options) { objects.set(key, {data: new Uint8Array(data), options}); },
 async get(key) { const item=objects.get(key); return item ? {body:item.data, writeHttpMetadata(headers){headers.set('Content-Type',item.options.httpMetadata.contentType);}} : null; },
 async delete(key) { if(failDelete) throw new Error('R2 deletion unavailable'); objects.delete(key); }
};
const env = { ADMIN_TOKEN: 'test-only', GALLERY_BUCKET: bucket, DB: { prepare: sql => new Statement(sql), batch: async statements => execute(statements) } };
const draft = {title:'Noticia de prueba',url:'https://example.org/test',date:'2026-09-26',visual_type:'principal',sort_order:3,published:0};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBf0AAAAASUVORK5CYII=','base64');
function form(values, image=png, type='image/png') {
 const data=new FormData(); for(const [key,value] of Object.entries(values)) data.set(key,String(value));
 if(image!==null) data.set('image',new Blob([image],{type}),'image.png'); return data;
}
async function main() {
 execute([], 'CREATE TABLE news (id INTEGER PRIMARY KEY,title TEXT); INSERT INTO news VALUES (1,\'legacy preserved\');');
 const schema=fs.readFileSync(path.join(__dirname,'news.sql'),'utf8'); execute([],schema); execute([],schema);
 assert.equal(execute([{sql:'SELECT title FROM news'}])[0].results[0].title,'legacy preserved');
 const source=fs.readFileSync(path.join(__dirname,'worker-cloudflare.js'),'utf8');
 const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 async function call(route, method='GET', body, auth=true) {
  const headers={Origin:'null'}; if(auth)headers.Authorization='Bearer test-only';
  let payload=body; if(body!==undefined && !(body instanceof FormData)){headers['Content-Type']='application/json';payload=JSON.stringify(body);}
  const response=await worker.fetch(new Request('https://api.test'+route,{method,headers,...(body!==undefined?{body:payload}:{})}),env);
  const data=(response.headers.get('Content-Type')||'').includes('json')?await response.json():new Uint8Array(await response.arrayBuffer());
  return {status:response.status,data,headers:response.headers};
 }
 for(const [route,method,body] of [['/api/admin/news','GET'],['/api/admin/news','POST',draft],['/api/admin/news/1','PATCH',draft],['/api/admin/news/1','DELETE'],['/api/admin/news/1/image','GET']]) assert.equal((await call(route,method,body,false)).status,401);
 assert.equal((await call('/api/news','POST',draft)).status,405);
 assert.equal((await call('/api/admin/news','POST',{...draft,url:'javascript:alert(1)'})).status,400);
 assert.equal((await call('/api/admin/news','POST',{...draft,url:'https://user:pass@example.org'})).status,400);
 for(const invalid of [{title:''},{title:'x'.repeat(301)},{date:'2026-02-30'},{date:false},{visual_type:'fake'},{sort_order:''},{sort_order:1.5},{published:'true'}]) assert.equal((await call('/api/admin/news','POST',{...draft,...invalid})).status,400);
 assert.equal((await call('/api/admin/news','POST',form(draft,Buffer.from('not an image')))).status,400);
 assert.equal((await call('/api/admin/news','POST',form(draft,Buffer.from('<svg/>'),'image/svg+xml'))).status,400);
 assert.equal((await call('/api/admin/news','POST',form(draft,Buffer.alloc(10*1024*1024+1)))).status,413);
 assert.equal((await call('/api/admin/news','POST',form(draft,Buffer.alloc(0)))).status,400);
 assert.equal(objects.size,0);
 let result=await call('/api/admin/news','POST',form(draft)); assert.equal(result.status,201);
 const id=result.data.item.id; assert.equal(result.data.item.has_image,true); assert.equal(result.data.item.image_url,null);
 assert.ok([...objects.keys()][0].startsWith('news/'));
 assert.equal((await call('/api/news')).data.items.length,0);
 assert.equal((await call('/api/news/image/'+id)).status,404);
 assert.equal((await call('/api/admin/news/'+id+'/image')).status,200);
 assert.equal((await call('/api/admin/news')).data.items[0].published,0);
 result=await call('/api/admin/news/'+id,'PATCH',{published:1}); assert.equal(result.status,200);
 let published=(await call('/api/news')).data.items[0]; assert.equal(published.title,draft.title); assert.ok(published.image_url.endsWith('/api/news/image/'+id)); assert.equal('r2_key' in published,false); assert.equal('has_image' in published,false);
 let image=await call('/api/news/image/'+id); assert.equal(image.status,200); assert.equal(image.headers.get('Cache-Control'),'no-store'); assert.deepEqual(Buffer.from(image.data),png);
 assert.equal((await call('/api/news/image/'+id,'HEAD')).status,200);
 result=await call('/api/admin/news/'+id,'PATCH',form({...draft,published:1,title:'Nueva imagen'})); assert.equal(result.status,200); assert.equal(objects.size,1);
 result=await call('/api/admin/news/'+id,'PATCH',{remove_image:true}); assert.equal(result.status,200); assert.equal(objects.size,0); assert.equal((await call('/api/news/image/'+id)).status,404);
 const second=(await call('/api/admin/news','POST',{...draft,title:'Primero',sort_order:-1,published:1})).data.item.id;
 assert.equal((await call('/api/news')).data.items[0].id,second);
 assert.equal((await call('/api/admin/news/'+second,'PATCH',{published:0})).status,200); assert.equal((await call('/api/news')).data.items.length,1);
 assert.equal((await call('/api/admin/news/'+id,'PATCH',form({...draft,published:1}))).status,200);
 const oldConsoleError=console.error; console.error=()=>{};
 execute([{sql:"CREATE TRIGGER fail_news BEFORE INSERT ON news_entries WHEN NEW.title = 'fail-db' BEGIN SELECT RAISE(ABORT, 'test failure'); END;"}]);
 assert.equal((await call('/api/admin/news','POST',form({...draft,title:'fail-db'}))).status,500); assert.equal(objects.size,1,'failed insert cleans uploaded object');
 failDelete=true; assert.equal((await call('/api/admin/news/'+id,'DELETE')).status,500); assert.equal((await call('/api/news')).data.items.length,0); assert.equal((await call('/api/news/image/'+id)).status,404);
 failDelete=false; assert.equal((await call('/api/admin/news/'+id,'DELETE')).status,200); assert.equal(objects.size,0);
 console.error=oldConsoleError;
 assert.equal((await call('/api/admin/news/'+id,'PATCH',{title:'missing'})).status,404);
 assert.equal((await call('/api/admin/news/'+second,'DELETE')).status,200); assert.equal((await call('/api/admin/news')).data.items.length,0);
 assert.equal((await call('/api/admin/gallery','GET',undefined,false)).status,401);
 assert.equal((await call('/api/admin/videos','GET',undefined,false)).status,401);
 assert.equal((await call('/','GET')).status,200);
 const newsModule=fs.readFileSync(path.join(__dirname,'worker-news.js'),'utf8').replace(/\nexport \{ handleNewsRequest \};\n$/,'');
 assert.ok(source.includes(newsModule));
 const {default:modular}=await import(pathToFileURL(path.join(__dirname,'worker.js')).href);
 const response=await modular.fetch(new Request('https://api.test/api/news'),env);assert.equal(response.status,200);assert.equal((await response.json()).items.length,0);
 console.log('PASS: idempotent SQL/legacy preservation, auth, validation, upload/signatures/size, drafts/image privacy, publish/unpublish, ordering, update/remove images, R2 retry, failed-write cleanup, delete, route isolation and both Workers.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(temporary,{recursive:true,force:true}));
