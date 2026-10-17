import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const jsonResponse = (body, init = {}) => new Response(body, {...init, headers: {'Content-Type': 'application/json'}});
const script = readFileSync(new URL('../public/workbench.js', import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').split("$('add').onclick")[0];
function harness(fetch) { const storage = new Map(), nodes = new Map(); const ctx = vm.createContext({ crypto, console, fetch, structuredClone, TextEncoder, setTimeout: () => 1, clearTimeout: () => { }, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, document: { getElementById(id) { if (!nodes.has(id))
            nodes.set(id, { dataset: {}, close() { }, focus() { }, textContent: '', hidden: false }); return nodes.get(id); } }, Date, URL, Blob }); vm.runInContext(script + '\nrender=()=>{};', ctx); return { ctx, storage, run: s => vm.runInContext(s, ctx) }; }
const co = (id) => ({ id, name: '公司', roles: [], status: '未投', link: '', deadline: '', appliedAt: '', dept: '', note: '' });

test('application dates sort newest first, with blanks last and stable ties, without changing saved order', () => {
 const h = harness();
 h.ctx.records = [co('blank'), {...co('older'), appliedAt:'2026-09-30'}, {...co('newer'), appliedAt:'2026-10-09'}, {...co('same-day'), appliedAt:'2026-10-09'}];
 assert.equal(h.run("sortCompanies(records, 'applied').map(c=>c.id).join(',')"), 'newer,same-day,older,blank');
 assert.equal(h.ctx.records.map(c=>c.id).join(','), 'blank,older,newer,same-day');
 assert.equal(h.run("sortCompanies(records, 'added')[0].id"), 'blank');
});

test('default record order uses last edit time, preserves legacy ties, and retains metadata through normalization', () => {
 const h = harness();
 h.ctx.records = [{...co('legacy'), updatedAt:0}, {...co('old'), updatedAt:1000}, {...co('recent'), updatedAt:2000}, co('legacy-two')];
 assert.equal(h.run("sortCompanies(records, 'added').map(c=>c.id).join(',')"), 'recent,old,legacy,legacy-two');
 h.run('state.companies=records;touchCompany(records[1])');
 assert.equal(h.run("sortCompanies(records, 'added')[0].id"), 'old');
 assert.equal(h.run('records[2].updatedAt'), 2000);
 assert.equal(h.run('normalize({companies:records, roles:[]}).companies[1].updatedAt'), h.run('records[1].updatedAt'));
 assert.match(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), /id="sort"[^>]*><option value="added">/);
 h.ctx.records[0].updatedAt = 'invalid';
 assert.throws(()=>h.run('normalize({companies:records, roles:[]})'), /编辑时间/);
});

test('inline note, status and role edits advance record order without changing untouched records', () => {
 const h = harness();
 h.ctx.handlers = {};
 h.ctx.rowNode = {addEventListener:(event, handler)=>{h.ctx.handlers[event]=handler;}};
 h.run("document.getElementById = () => rowNode; changed=()=>{};renderTable=()=>{};renderAgenda=()=>{};state.companies=[{id:'a',note:'old',roles:[],status:'未投',appliedAt:'2026-10-01',updatedAt:1},{id:'b',updatedAt:2}];state.roles=['R']");
 const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
 h.run(source.slice(source.indexOf("$('rows').addEventListener('input'"),source.indexOf("$('rows').addEventListener('focusout'")));
 h.run("handlers.input({target:{dataset:{field:'note',id:'a'},value:'new'}})");
 assert.equal(h.run("sortCompanies(state.companies,'added')[0].id"),'a');
 const noteTime=h.run('state.companies[0].updatedAt');
 h.run("handlers.input({target:{dataset:{field:'note',id:'a'},value:'new'}})");
 assert.equal(h.run('state.companies[0].updatedAt'),noteTime);
 h.run("handlers.change({target:{dataset:{status:'a'},value:'一面'}})");
 assert.ok(h.run('state.companies[0].updatedAt')>noteTime);
 const statusTime=h.run('state.companies[0].updatedAt');
 h.run("handlers.change({target:{dataset:{companyRole:'a',roleIndex:'0'},checked:true,closest:()=>({querySelector:()=>({})})}})");
 assert.ok(h.run('state.companies[0].updatedAt')>statusTime);
 assert.equal(h.run('state.companies[1].updatedAt'),2);
});
test('import replaces unsafe IDs and never interpolates raw markup', () => { const h = harness(); h.ctx.input = { roles: [], companies: [co('x" autofocus onfocus="alert(1)')] }; const normalized = h.run('normalize(input)'); assert.match(normalized.companies[0].id, /^[a-z0-9-]+$/); assert.equal(h.run('esc(`<img src=x onerror="alert(1)">`)'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'); });
test('boot retains custom server roles and does not silently write local migration', async () => { const calls = []; const h = harness(async (url, options) => { calls.push([url, options.method]); return jsonResponse(JSON.stringify({ roles: ['custom'], companies: [], revision: 4 })); }); h.storage.set('qiuzhao-tracker-v2', JSON.stringify({ roles: ['legacy'], companies: [co('old')] })); await h.run('connect()'); assert.equal(h.run('state.roles[0]'), 'custom'); assert.equal(h.run('state.companies.length'), 0); assert.equal(h.run('pending.state.companies.length'), 1); assert.equal(calls.length, 1); assert.equal(calls[0][1], undefined); assert.equal(JSON.parse(h.storage.get('qiuzhao-tracker-v2')).companies.length, 1); });
test('queued edits are not marked clean by an older save response', async () => { let resolve; const h = harness(() => new Promise(r => resolve = r)); h.run("mode='server';state={v:2,revision:0,roles:[],companies:[]};dirty=true;generation=1"); const promise = h.run('save()'); h.run("state.companies.push({id:'new'});generation++;dirty=true"); resolve(jsonResponse(JSON.stringify({ revision: 1 }))); await promise; assert.equal(h.run('dirty'), true); assert.equal(h.run('state.revision'), 1); assert.equal(JSON.parse(h.storage.get('qiuzhao-cloud-draft-v3')).pending, true); });
test('conflict keeps unsynced data and blocks automatic overwrites', async () => { const h = harness(async () => jsonResponse(JSON.stringify({ error: 'conflict' }), { status: 409 })); h.run("mode='server';dirty=true"); await h.run('save()'); assert.equal(h.run('dirty'), true); assert.equal(h.run('blocked'), true); assert.equal(JSON.parse(h.storage.get('qiuzhao-cloud-draft-v3')).pending, true); });
test('pending recovery survives reconnect without being overwritten by server state', async () => { const h = harness(async () => jsonResponse(JSON.stringify({ revision: 3, roles: [], companies: [] }))); h.storage.set('qiuzhao-cloud-draft-v3', JSON.stringify({ pending: true, state: { revision: 1, roles: [], companies: [co('unsynced')] } })); await h.run('connect()'); assert.equal(JSON.parse(h.storage.get('qiuzhao-cloud-recovery-v3')).state.companies[0].id, 'unsynced'); assert.equal(h.run('state.revision'), 3); });

test('Cloudflare login HTML is rejected instead of overwriting loaded data', async () => {
 const h=harness(async()=>new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}}));
 await assert.rejects(h.run('connect()'),/Cloudflare/);
 assert.equal(h.run('mode'),'loading');
});
test('API uses the Cloudflare session without an application bearer token', async () => {
 let headers;
 const h=harness(async(url,options)=>{headers=options.headers;return jsonResponse(JSON.stringify({revision:0,roles:[],companies:[]}));});
 await h.run('connect()');
 assert.equal(headers.Authorization,undefined);
});

test('bulk input removes blank lines and repeated input while identifying active and archived names',()=>{
 const h=harness();h.ctx.active=[{...co('a'),name:'已有公司'}];h.ctx.trash=[{...co('b'),name:'已删公司'}];
 const result=h.run("parseBulkCompanies(' 新公司 \\n\\n已有公司\\n已删公司\\n新公司',active,trash)");
 assert.equal(result.duplicates,1);assert.equal(result.items.length,3);assert.equal(result.items[1].existing.id,'a');assert.equal(result.items[2].deleted.id,'b');
});

test('new metadata and local history survive backup normalization without reviving archived roles',()=>{
 const h=harness();h.ctx.data={roles:[],companies:[{...co('a'),starred:true,interview:{phase:'scheduled',at:'2026-10-22T06:30:00.000Z',location:'线上'}}],trash:[{...co('b'),roles:['旧岗位'],deletedAt:100}],history:[]};
 assert.equal(h.run('normalize(data).companies[0].interview.at'),'2026-10-22T06:30:00.000Z');assert.equal(h.run('normalize(data).companies[0].starred'),true);assert.equal(h.run('normalize(data).roles.length'),0);assert.equal(h.run('normalize(data).trash[0].roles[0]'),'旧岗位');
});

test('queued activities remain during an in-flight save and only acknowledged operations are removed',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));
 h.run("mode='server';state.companies=[{id:'a',status:'一面'}];state.activity=[];addLocalHistory(state.companies[0],'status','已投');dirty=true;generation=1");
 const promise=h.run('save()');h.run("state.companies[0].status='二面';addLocalHistory(state.companies[0],'status','一面');generation++;dirty=true");
 resolve(jsonResponse(JSON.stringify({revision:1})));await promise;
 assert.equal(h.run('state.activity.length'),1);assert.equal(h.run('state.activity[0].toStatus'),'二面');assert.equal(h.run('dirty'),true);
});
