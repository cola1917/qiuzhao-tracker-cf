import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const jsonResponse = (body, init = {}) => new Response(body, {...init, headers: {'Content-Type': 'application/json'}});
const script = readFileSync(new URL('../public/role-picker.js', import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/interview-notes.js', import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/workbench.js', import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').split("$('add').onclick")[0];
function harness(fetch) { const storage = new Map(), nodes = new Map(); const ctx = vm.createContext({ crypto, console, fetch, structuredClone, TextEncoder, setTimeout: () => 1, clearTimeout: () => { }, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, document: { getElementById(id) { if (!nodes.has(id))
            nodes.set(id, { dataset: {}, close() { }, focus() { }, textContent: '', hidden: false }); return nodes.get(id); } }, Date, URL, Blob }); vm.runInContext(script + '\nrender=()=>{};', ctx); return { ctx, storage, run: s => vm.runInContext(s, ctx) }; }
const co = (id) => ({ id, name: '公司', roles: [], status: '未投', link: '', deadline: '', appliedAt: '', dept: '', note: '' });

test('meeting time offers only whole hours and preserves an existing precise appointment', () => {
 const h=harness();
 const empty=h.run("renderMeetingTime('a')");
 const values=[...empty.matchAll(/<option value="([^"]*)"/g)].map(match=>match[1]);
 assert.deepEqual(values,['',...Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')+':00')]);
 assert.match(empty, /value="" disabled selected/);
 assert.match(h.run("renderMeetingTime('a','14:00')"), /value="14:00" selected/);
 assert.match(h.run("renderMeetingTime('a','14:35')"), /value="14:35" selected hidden/);
 const details=h.run("renderCompanyDetails({id:'a',status:'一面',interview:emptyInterview()})");
 assert.match(details,/type="date"/);
 assert.doesNotMatch(details,/type="time"/);
 const collapsed=h.run("renderCompanyDetails({id:'b',status:'未投',interview:emptyInterview()})");
 assert.match(collapsed,/notes-collapsed/);
 assert.doesNotMatch(collapsed,/note-editor/);
});

test('legacy stage baseline and appointment events never appear as duplicate stage transitions', () => {
 const h=harness();
 h.ctx.events=[
  {id:'baseline',companyId:'a',kind:'baseline',toStatus:'一面',detail:'',at:100,recordedAt:100},
  {id:'schedule',companyId:'a',kind:'schedule',toStatus:'一面',detail:JSON.stringify({at:'2026-10-10T08:00:00.000Z'}),at:200,recordedAt:200},
  {id:'cancel',companyId:'a',kind:'cancel',toStatus:'一面',detail:JSON.stringify({at:'2026-10-10T08:00:00.000Z'}),at:300,recordedAt:300}
 ];
 h.run('state.history=events');
 const markup=h.run("historyMarkup('a')");
 assert.match(markup,/历史起点：当时处于一面/);
 assert.match(markup,/安排一面时间：/);
 assert.match(markup,/取消一面安排 · 原定/);
 assert.match(markup,/历史启用时间：/);
 assert.match(markup,/记录时间：/);
 assert.doesNotMatch(markup,/history-stage/);
 assert.equal((markup.match(/<li>/g)||[]).length,3);
 assert.match(h.run("historyTitleMarkup({kind:'status',fromStatus:'一面',toStatus:'二面'})"), /history-stage/);
 assert.match(h.run("historyTitleMarkup({kind:'baseline',toStatus:'<img src=x>',detail:''})"), /&lt;img src=x&gt;/);
});

test('application dates sort newest first, with blanks last and stable ties, without changing saved order', () => {
 const h = harness();
 h.ctx.records = [co('blank'), {...co('older'), appliedAt:'2026-09-30'}, {...co('newer'), appliedAt:'2026-10-09'}, {...co('same-day'), appliedAt:'2026-10-09'}];
 assert.equal(h.run("sortCompanies(records, 'applied').map(c=>c.id).join(',')"), 'newer,same-day,older,blank');
 assert.equal(h.ctx.records.map(c=>c.id).join(','), 'blank,older,newer,same-day');
 assert.equal(h.run("sortCompanies(records, 'added')[0].id"), 'blank');
});

test('optional recent-edit order retains metadata; default order stays stable', () => {
 const h = harness();
 h.ctx.records = [{...co('legacy'), updatedAt:0}, {...co('old'), updatedAt:1000}, {...co('recent'), updatedAt:2000}, co('legacy-two')];
 assert.equal(h.run("sortCompanies(records, 'updated').map(c=>c.id).join(',')"), 'recent,old,legacy,legacy-two');
 h.run('state.companies=records;touchCompany(records[1])');
 assert.equal(h.run("sortCompanies(records, 'updated')[0].id"), 'old');
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
 h.run(source.slice(source.indexOf("$('rows').addEventListener('input'"),source.indexOf("$('rows').addEventListener('keydown'")));
 h.run("handlers.input({target:{dataset:{field:'note',id:'a'},value:'new'}})");
 assert.equal(h.run("sortCompanies(state.companies,'updated')[0].id"),'a');
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


test('editing never moves the default list, including after normalization and new insertion',()=>{
 const h=harness();h.run("state.companies=[{id:'first',updatedAt:1},{id:'second',updatedAt:2}];touchCompany(state.companies[1])");
 assert.equal(h.run("sortCompanies(state.companies,'added').map(c=>c.id).join(',')"),'first,second');
 h.run("state.companies.unshift({id:'new',updatedAt:3})");
 assert.equal(h.run("sortCompanies(state.companies,'added').map(c=>c.id).join(',')"),'new,first,second');
 assert.equal(h.run("sortCompanies(state.companies,'updated')[0].id"),'second');
});

test('interview note anchors survive rescheduling and completion; later round and cancelled retries are distinct',()=>{
 const h=harness();
 const e=(id,kind,stage,at,detail={})=>({id,companyId:'a',kind,toStatus:stage,at,recordedAt:at,detail:JSON.stringify(detail)});
 h.ctx.events=[e('start','status','一面',1),e('plan','schedule','一面',2,{at:'2026-11-02T06:00:00.000Z'}),e('reschedule','schedule','一面',3,{at:'2026-11-03T06:00:00.000Z',previousAt:'2026-11-02T06:00:00.000Z'}),e('done','complete','一面',4),e('round2','status','二面',5),e('cancel','cancel','二面',6),e('retry','schedule','二面',7)];
 h.run('state.history=events.slice().reverse()');
 assert.equal(h.run('interviewContext(events[2]).eventId'),'start');
 assert.equal(h.run('interviewContext(events[3]).eventId'),'start');
 assert.equal(h.run('interviewContext(events[4]).eventId'),'round2');
 assert.equal(h.run('interviewContext(events[6]).eventId'),'retry');
 assert.match(h.run("notePreview('**重点**\\n<script>alert(1)</script> [bad](javascript:alert)')"), /&lt;script&gt;/);
 assert.doesNotMatch(h.run("notePreview('[bad](javascript:alert)')"), /href=/);
});

test('statistics are the sole accessible view controls',()=>{
 const h=harness();h.run('renderStats()');
 const markup=h.run("document.getElementById('stats').innerHTML");
 for(const view of ['all','todo','live','oc'])assert.match(markup,new RegExp('data-view="'+view+'"'));
 assert.match(markup,/aria-pressed="true"/);
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/nav aria-label="工作台视图"/);
});


test('role picker keeps original role indices, prioritizes selections and usage, and searches every role',()=>{
 const h=harness();h.run("state.roles=['A','B','C','D','E','F','G','H','I'];state.companies=[{id:'a',roles:['I']},{id:'b',roles:['H']},{id:'c',roles:['H']}]");
 assert.equal(h.run('groupedRoles(state.companies[0]).selected[0].name'),'I');
 assert.equal(h.run('groupedRoles(state.companies[0]).common[0].name'),'H');
 assert.equal(h.run('groupedRoles(state.companies[0]).common[0].index'),7);
 assert.equal(h.run('groupedRoles(state.companies[0]).other.length'),2);
 assert.match(h.run("roleOptionsMarkup(state.companies[0],'g')"),/data-role-index="6"/);
 assert.match(h.run("roleOptionsMarkup(state.companies[0],'missing')"),/没有匹配/);
 assert.match(h.run('roleOptionsMarkup(state.companies[0])'),/details class="role-more">/);
 h.run("state.roles=['AI Infra']");
 assert.equal(h.run("existingRoleName(' ai   infra ')"),'AI Infra');
});

test('role picker closes outside, keeps inside selection open and supports Escape',()=>{
 const h=harness(),listeners={};
 h.ctx.document.addEventListener=(name,fn)=>listeners[name]=fn;
 const menu={dataset:{roleMenu:'a'},open:true,contains:()=>true,querySelector:()=>({focus(){menu.focused=true;}})};
 h.ctx.document.querySelectorAll=()=>[menu];h.run('initRolePicker()');
 listeners.click({target:{closest:()=>({dataset:{roleMenu:'a'}})}});assert.equal(menu.open,true);
 listeners.click({target:{closest:()=>null}});assert.equal(menu.open,false);
 menu.open=true;listeners.keydown({key:'Escape'});assert.equal(menu.open,false);assert.equal(menu.focused,true);
});


test('new role entry resolves semantic aliases to the canonical label',()=>{
 const h=harness();h.run("state.roles=['机器人算法'];state.roleAliases={'机器人算法研究员':'机器人算法'}");
 assert.equal(h.run("existingRoleName('机器人算法研究员')"),'机器人算法');
});

test('application heatmap counts submissions by day and funnel bar reflects the stage mix',()=>{
 const h=harness();
 h.run("(()=>{const d=new Date();const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');state.companies=[{appliedAt:k},{appliedAt:k}];})()");
 h.run('renderHeatmap()');
 const html=h.run("document.getElementById('heatmap').innerHTML");
 assert.match(html,/heat-cell/);
 assert.match(html,/data-level="[1-4]"/);
 const summary=h.run("document.getElementById('heatmap-summary').innerHTML");
 assert.match(summary,/2<\/b> 份投递/);
 // Color depth must be monotonic across the whole range, not computed from a running max.
 const keys=h.run("(()=>{const d=new Date();const mk=n=>{const x=new Date(d);x.setDate(x.getDate()-n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')};const small=mk(9),big=mk(3);state.companies=[...Array(3).fill({appliedAt:small}),...Array(9).fill({appliedAt:big})];return {small,big}})()");
 h.run('renderHeatmap()');
 const levels=h.run("(()=>{const map={};document.getElementById('heatmap').innerHTML.replace(/data-level=\"(\\d+)\" title=\"([\\d-]+)/g,(_,lv,k)=>{map[k]=Number(lv);return ''});return map;})()");
 assert.ok(levels[keys.small] < levels[keys.big], '3 份投递不应比 9 份颜色更深');
 assert.match(h.run("document.getElementById('heat-weekdays').innerHTML"),/一/);
 assert.match(h.run("document.getElementById('heat-months').innerHTML"),/月/);
 // Year navigation changes which calendar year is rendered.
 const thisYear=new Date().getFullYear();
 assert.equal(h.run("document.getElementById('heatmap-year').textContent"),String(thisYear));
 h.run(`heatmapYear=${thisYear-1};renderHeatmap()`);
 assert.equal(h.run("document.getElementById('heatmap-year').textContent"),String(thisYear-1));
 assert.match(h.run("document.getElementById('heatmap-summary').innerHTML"),new RegExp(`${thisYear-1} 年共`));
 h.run(`heatmapYear=${thisYear};renderHeatmap()`);
 h.run("state.companies=[{status:'未投'},{status:'一面'},{status:'OC'}]");
 h.run('renderStats()');
 const pipe=h.run("document.getElementById('pipeline').innerHTML");
 assert.match(pipe,/funnel-bar/);
 assert.match(pipe,/funnel-seg f2/);
 assert.match(pipe,/funnel-seg f4/);
});

test('dark theme variables are defined and the theme toggle is reachable',()=>{
 const editorial=readFileSync(new URL('../public/editorial.css',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(editorial,/--accent:#e07a55/);
 assert.doesNotMatch(editorial,/body\{background:#f8f7f3/);
 const btn=html.match(/<button id="theme"[^>]*>/)[0];
 assert.doesNotMatch(btn,/hidden/);
 assert.match(html,/class="header-actions"/);
 assert.match(html,/id="heatmap"/);
});

test('agenda does not pair an empty-state notice with pending interview scheduling',()=>{
 const h=harness();
 h.run("state.companies=[{id:'a',name:'远山科技',status:'一面',interview:{phase:'pending',at:'',location:''}}]");
 h.run('renderAgenda()');
 let html=h.run("document.getElementById('agenda').innerHTML");
 assert.match(html,/1 场面试待安排/);
 assert.doesNotMatch(html,/暂无已确定/);
 h.run('state.companies=[]');h.run('renderAgenda()');
 html=h.run("document.getElementById('agenda').innerHTML");
 assert.match(html,/近期暂无面试安排/);
 assert.doesNotMatch(html,/场面试待安排/);
});

test('interview notes deduplicate round shortcuts, support deletion, and render standalone review timeline with hotwords',()=>{
 const h=harness();
 h.run("state.companies=[{id:'a',name:'星河机器人',roles:['具身智能算法'],status:'一面',interview:{phase:'feedback',at:'2026-11-16T03:00:00.000Z',location:'https://example.com/meeting'}},{id:'b',name:'远山科技',roles:['具身智能算法'],status:'一面'}]");
 h.run("state.history=[{id:'h2',companyId:'a',kind:'complete',toStatus:'一面',detail:'{}',at:200,recordedAt:200},{id:'h1',companyId:'a',kind:'status',fromStatus:'已投',toStatus:'一面',detail:'',at:100,recordedAt:100}]");
 h.run("state.notes=[{id:'n1',companyId:'a',eventId:'h1',stage:'一面',meetingAt:'2026-11-16T03:00:00.000Z',title:'一面复盘',body:'算法面试流程通了也不行， **要了解pipeline  组件如何交流 ， 同时 了解细节**',category:'复盘',updatedAt:300},{id:'n2',companyId:'a',eventId:'h1',stage:'一面',meetingAt:'',title:'',body:'',category:'复盘',updatedAt:301},{id:'n3',companyId:'b',eventId:'b',stage:'一面',meetingAt:'2026-11-18T08:00:00.000Z',title:'一面复盘',body:'1. 需要了解 路线优劣， 仿真数据， 传感器数据\\n2. 强化项目熟悉程度',category:'复盘',updatedAt:302}]");
 assert.equal(h.run("noteAction(state.history[1])"),'');
 assert.match(h.run("noteAction(state.history[0])"),/查看 \/ 编辑面试记录 · 已有 2 篇/);
 assert.equal(h.run("deleteNote('n2')"),true);
 assert.equal(h.run("state.notes.length"),2);
 const keywords=[...h.run("extractHotKeywords(state.notes).map(k=>k.word)")];
 assert.deepEqual(keywords,['项目与底层细节','Pipeline 组件通信','技术路线对比','传感器数据','仿真数据']);
 assert.ok(!keywords.includes('要了解')&&!keywords.includes('同时')&&!keywords.includes('流程')&&!keywords.includes('算法'));
 const overview=h.run("buildMacroOverview(state.notes, extractHotKeywords(state.notes))");
 assert.match(overview,/项目与底层细节/);
 h.run("renderReviewsPage()");
 const html=h.run("document.getElementById('reviews-page').innerHTML");
 assert.match(html,/星河机器人/);
 assert.match(html,/远山科技/);
 assert.match(html,/复盘总览与高频考点/);
 assert.doesNotMatch(html,/核心反思与重点摘录/);
});
