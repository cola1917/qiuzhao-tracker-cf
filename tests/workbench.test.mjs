import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,request,company} from './helpers.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const load=async env=>(await request(env)).json();
const history=async(env,id)=>(await (await request(env,'/api/history/'+id)).json()).history;
const save=(env,data)=>request(env,'/api/data','PUT',data);

test('migration preserves old records and establishes a truthful baseline',()=>{
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_init.sql','0003_sync.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 db.exec("INSERT INTO companies(id,name,status,note) VALUES('legacy','旧公司','二面','preserve')");
 db.exec(readFileSync(new URL('../migrations/0004_workbench.sql',import.meta.url),'utf8'));
 const co=db.prepare('SELECT * FROM companies').get(),event=db.prepare('SELECT * FROM company_history').get();
 assert.equal(co.note,'preserve');assert.equal(co.status,'二面');assert.equal(co.deleted_at,0);assert.equal(event.kind,'baseline');assert.equal(event.to_status,'二面');
});

test('status feedback and interview appointment are distinct, stable events; retries never duplicate them',async()=>{
 const env=environment();await save(env,{revision:0,roles:[],companies:[company('a')]});
 let data=await load(env);data.companies[0].status='二面';assert.equal((await save(env,data)).status,200);
 let events=await history(env,'a');assert.equal(events.filter(e=>e.kind==='status').length,1);assert.equal(events.filter(e=>e.kind==='schedule').length,0);
 assert.equal((await save(env,data)).status,409);
 data=await load(env);data.companies[0].interview={phase:'scheduled',at:'2026-10-22T06:00:00.000Z',location:'线上会议'};
 await save(env,data);events=await history(env,'a');assert.equal(events.filter(e=>e.kind==='schedule').length,1);
 data=await load(env);data.companies[0].note='only note';await save(env,data);
 assert.equal((await history(env,'a')).length,events.length);
});

test('rescheduling, completion and advancing rounds preserve earlier appointment history',async()=>{
 const env=environment();await save(env,{revision:0,roles:[],companies:[{...company('a'),status:'一面',interview:{phase:'scheduled',at:'2026-10-22T06:00:00.000Z',location:''}}]});
 let data=await load(env);data.companies[0].interview.at='2026-10-23T07:00:00.000Z';await save(env,data);
 let events=await history(env,'a');assert.equal(events.filter(e=>e.kind==='schedule').length,2);assert.match(events.find(e=>e.detail.includes('previousAt')).detail,/2026-10-22/);
 data=await load(env);data.companies[0].interview.phase='feedback';await save(env,data);
 data=await load(env);data.companies[0].status='二面';data.companies[0].interview={phase:'pending',at:'',location:''};await save(env,data);
 events=await history(env,'a');assert.equal(events.filter(e=>e.kind==='complete').length,1);assert.equal(events.filter(e=>e.kind==='cancel').length,0);
});

test('star never changes edit order; deletion and restoration retain history, star and meeting',async()=>{
 const env=environment();await save(env,{revision:0,roles:['R'],companies:[{...company('a',['R']),updatedAt:123,status:'一面',interview:{phase:'scheduled',at:'2026-10-22T06:00:00.000Z',location:'链接'}}]});
 let data=await load(env);data.companies[0].starred=true;await save(env,data);data=await load(env);assert.equal(data.companies[0].updatedAt,123);
 const count=(await history(env,'a')).length,co=data.companies[0];data.companies=[];data.trash=[{...co,deletedAt:Date.now()}];await save(env,data);
 data=await load(env);assert.equal(data.companies.length,0);assert.equal(data.trash[0].starred,true);assert.equal((await history(env,'a')).length,count);
 data.companies=[{...data.trash[0],deletedAt:0}];data.trash=[];await save(env,data);data=await load(env);
 assert.equal(data.companies[0].interview.location,'链接');assert.equal(data.trash.length,0);assert.equal((await history(env,'a')).filter(h=>h.kind==='restore').length,1);
});

test('legacy clients and snapshot imports cannot permanently remove archived data or reset newer metadata',async()=>{
 const env=environment();await save(env,{revision:0,roles:[],companies:[{...company('a'),starred:true},company('b')]});
 let data=await load(env);await save(env,{revision:data.revision,roles:[],companies:[company('a')]});
 data=await load(env);assert.equal(data.companies[0].starred,true);assert.equal(data.trash[0].id,'b');
 await save(env,{revision:data.revision,roles:[],companies:[]});data=await load(env);assert.deepEqual(new Set(data.trash.map(c=>c.id)),new Set(['a','b']));
});

test('backup round trip includes trash, events and appointments; forged normal-save history is ignored',async()=>{
 const env=environment();await save(env,{revision:0,roles:[],companies:[{...company('a'),status:'二面',starred:true}]});
 let data=await load(env);data.trash=[{...data.companies[0],deletedAt:Date.now()}];data.companies=[];await save(env,data);
 const backup=await (await request(env,'/api/backup')).json();assert.equal(backup.trash[0].starred,true);assert.equal(backup.history.length,1);
 const target=environment();backup.revision=0;assert.equal((await request(target,'/api/backup','PUT',backup)).status,200);
 const again=await (await request(target,'/api/backup')).json();assert.deepEqual(again.history,backup.history);assert.equal(again.trash[0].id,'a');
 data=await load(env);data.history=backup.history.map(e=>({...e,id:'forged'}));await save(env,data);assert.ok(!(await history(env,'a')).some(e=>e.id==='forged'));
});

test('feedback time correction retains original recorded time and is revision protected',async()=>{
 const env=environment();await save(env,{revision:0,roles:[],companies:[company('a')]});const before=(await history(env,'a'))[0];
 const data=await load(env);data.historyEdits=[{id:before.id,at:before.at-86400000}];assert.equal((await save(env,data)).status,200);
 const after=(await history(env,'a'))[0];assert.equal(after.at,before.at-86400000);assert.equal(after.recordedAt,before.recordedAt);
 assert.equal((await save(env,data)).status,409);
});

test('invalid meeting data, duplicate active/trash IDs and invalid histories leave state unchanged',async()=>{
 for(const bad of [{interview:{phase:'scheduled',at:'2026-02-30T06:00:00.000Z',location:''}},{starred:'yes'},{deletedAt:-1}]){
  const env=environment();assert.equal((await save(env,{revision:0,roles:[],companies:[{...company('a'),...bad}]})).status,400);assert.equal((await load(env)).revision,0);
 }
 const env=environment();assert.equal((await save(env,{revision:0,roles:[],companies:[company('a')],trash:[company('a')]})).status,400);
});

test('one hundred company records save atomically and keep paste order',async()=>{
 const env=environment(),companies=Array.from({length:100},(_,i)=>company('company-'+i));
 assert.equal((await save(env,{revision:0,roles:[],companies})).status,200);
 assert.deepEqual((await load(env)).companies.map(c=>c.id),companies.map(c=>c.id));
 assert.equal((await (await request(env,'/api/backup')).json()).history.length,100);
});

test('rapid completion and multiple round changes in one autosave retain every intermediate event',async()=>{
 const env=environment();await save(env,{revision:0,roles:[],companies:[{...company('a'),status:'一面',interview:{phase:'scheduled',at:'2026-10-22T06:00:00.000Z',location:''}}]});
 const data=await load(env),now=Date.now();data.companies[0].status='三面';data.companies[0].interview={phase:'pending',at:'',location:''};
 data.activity=[
  {id:'done',companyId:'a',kind:'complete',fromStatus:'',toStatus:'一面',detail:'{}',at:now,recordedAt:now},
  {id:'round2',companyId:'a',kind:'status',fromStatus:'一面',toStatus:'二面',detail:'',at:now+1,recordedAt:now},
  {id:'round3',companyId:'a',kind:'status',fromStatus:'二面',toStatus:'三面',detail:'',at:now+2,recordedAt:now},
 ];
 assert.equal((await save(env,data)).status,200);const events=await history(env,'a');
 assert.equal(events.filter(e=>e.kind==='complete').length,1);assert.deepEqual(events.filter(e=>e.kind==='status').map(e=>e.toStatus),['三面','二面']);assert.equal(events.filter(e=>e.kind==='cancel').length,0);
 assert.equal((await save(env,data)).status,409);assert.equal((await history(env,'a')).length,events.length);
});

test('stale or inconsistent queued status operations do not write records or history',async()=>{
 const env=environment();await save(env,{revision:0,roles:[],companies:[company('a')]});const data=await load(env),now=Date.now();
 data.activity=[{id:'bad',companyId:'a',kind:'status',fromStatus:'三面',toStatus:'OC',detail:'',at:now,recordedAt:now}];
 assert.equal((await save(env,data)).status,400);assert.equal((await load(env)).revision,1);assert.equal((await history(env,'a')).length,1);
});

test('failed history insertion rolls back records, archive and revision together',async()=>{
 const env=environment();await save(env,{revision:0,roles:[],companies:[company('a')]});
 env.DB.db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON company_history WHEN NEW.kind='status' BEGIN SELECT RAISE(ABORT,'test history rollback'); END;");
 const data=await load(env);data.companies[0].status='二面';
 assert.equal((await save(env,data)).status,500);const actual=await load(env);assert.equal(actual.revision,1);assert.equal(actual.companies[0].status,'未投');assert.equal((await history(env,'a')).length,1);
});
