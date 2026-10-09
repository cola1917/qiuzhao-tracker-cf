import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const jsonResponse = (body, init = {}) => new Response(body, {...init, headers: {'Content-Type': 'application/json'}});
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').split("$('add').onclick")[0];
function harness(fetch) { const storage = new Map(), nodes = new Map(); const ctx = vm.createContext({ crypto, console, fetch, structuredClone, TextEncoder, setTimeout: () => 1, clearTimeout: () => { }, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, document: { getElementById(id) { if (!nodes.has(id))
            nodes.set(id, { dataset: {}, close() { }, focus() { }, textContent: '', hidden: false }); return nodes.get(id); } }, Date, URL, Blob }); vm.runInContext(script + '\nrender=()=>{};', ctx); return { ctx, storage, run: s => vm.runInContext(s, ctx) }; }
const co = (id) => ({ id, name: '公司', roles: [], status: '未投', link: '', deadline: '', appliedAt: '', dept: '', note: '' });
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
