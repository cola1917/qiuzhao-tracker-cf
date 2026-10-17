import { Hono } from 'hono';
type Bindings = { DB: D1Database; ASSETS: Fetcher };
type Interview = { phase: 'pending' | 'scheduled' | 'feedback'; at: string; location: string };
export type Company = {
    id: string; name: string; link: string; deadline: string; roles: string[]; dept: string;
    appliedAt: string; status: string; note: string; updatedAt?: number;
    starred?: boolean; deletedAt?: number; interview?: Interview;
};
type History = { id: string; companyId: string; kind: string; fromStatus: string; toStatus: string; detail: string; at: number; recordedAt: number };
type Snapshot = { v: number; revision: number; roles: string[]; companies: Company[]; trash?: Company[]; history?: History[]; activity?: History[]; historyEdits?: { id: string; at: number }[] };
const statuses = ['未投', '已投', '测评', '笔试', '一面', '二面', '三面', 'OC', '已挂'];
const fields = ['id', 'name', 'link', 'deadline', 'dept', 'appliedAt', 'status', 'note'] as const;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const validTime = (t: unknown): t is number => Number.isSafeInteger(t) && Number(t) >= 0 && Number(t) <= 8640000000000000;
const noInterview = (): Interview => ({ phase: 'pending', at: '', location: '' });
export function validateSnapshot(input: unknown): Snapshot {
    const data = input as Snapshot;
    if (!data || !Array.isArray(data.companies) || data.companies.length > 2000 || !Array.isArray(data.roles) || data.roles.length > 200 || !Number.isSafeInteger(data.revision) || data.revision < 0 || (data.trash !== undefined && (!Array.isArray(data.trash) || data.trash.length > 2000)))
        throw new Error('备份结构或版本无效');
    if (new TextEncoder().encode(JSON.stringify({ ...data, history: undefined })).length > 1000000)
        throw new Error('数据量超过上限，请精简备注后重试');
    if (data.roles.some(r => typeof r !== 'string' || !r.trim() || r.length > 100) || new Set(data.roles).size !== data.roles.length)
        throw new Error('岗位名称无效或重复');
    const ids = new Set<string>();
    for (const co of [...data.companies, ...(data.trash || [])]) {
        if (!co || fields.some(f => typeof co[f] !== 'string' || co[f].length > 5000) || !validId(co.id) || ids.has(co.id)) throw new Error('公司字段或编号无效');
        ids.add(co.id);
        if (co.updatedAt !== undefined && !validTime(co.updatedAt)) throw new Error('编辑时间无效');
        if (co.deletedAt !== undefined && !validTime(co.deletedAt)) throw new Error('删除时间无效');
        if (co.starred !== undefined && typeof co.starred !== 'boolean') throw new Error('星标无效');
        if (!statuses.includes(co.status) || !Array.isArray(co.roles) || co.roles.some(r => typeof r !== 'string' || r.length > 100 || !r.trim())) throw new Error('状态或岗位无效');
        if (data.companies.includes(co) && co.roles.some(r => !data.roles.includes(r))) throw new Error('公司岗位未定义');
        for (const date of [co.deadline, co.appliedAt])
            if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('日期无效');
        const meeting = co.interview;
        if (meeting !== undefined && (!meeting || !['pending', 'scheduled', 'feedback'].includes(meeting.phase) || typeof meeting.at !== 'string' || typeof meeting.location !== 'string' || meeting.location.length > 2000 || (meeting.phase !== 'pending' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(meeting.at) || !Number.isFinite(Date.parse(meeting.at)) || new Date(meeting.at).toISOString() !== meeting.at)) || (meeting.phase === 'pending' && meeting.at !== '')))
            throw new Error('面试安排无效');
    }
    if (data.historyEdits !== undefined && (!Array.isArray(data.historyEdits) || data.historyEdits.length > 100 || data.historyEdits.some(e => !e || !validId(e.id) || !validTime(e.at)))) throw new Error('反馈时间无效');
    if(data.activity!==undefined){
        if(!Array.isArray(data.activity)||data.activity.length>500)throw new Error('待同步历史过多，请先完成同步');
        const checked=validateSnapshot({...data,activity:undefined,history:data.activity});
        if(checked.history?.some(h=>h.kind==='baseline'))throw new Error('不能补造历史起点');
    }
    if (data.history !== undefined) {
        if (!Array.isArray(data.history) || data.history.length > 20000 || new TextEncoder().encode(JSON.stringify(data.history)).length > 8000000) throw new Error('历史备份过大');
        const eventIds = new Set<string>();
        for (const h of data.history) {
            if (!h || !validId(h.id) || eventIds.has(h.id) || !ids.has(h.companyId) || !['baseline','created','status','schedule','complete','cancel','restore'].includes(h.kind) || !validTime(h.at) || !validTime(h.recordedAt) || typeof h.detail !== 'string' || h.detail.length > 5000 || typeof h.fromStatus !== 'string' || typeof h.toStatus !== 'string' || (h.fromStatus && !statuses.includes(h.fromStatus)) || (h.toStatus && !statuses.includes(h.toStatus))) throw new Error('历史备份无效');
            eventIds.add(h.id);
        }
    }
    return { ...data, v: 3 };
}
const app = new Hono<{ Bindings: Bindings }>();
app.use('/api/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
async function read(db: D1Database): Promise<Snapshot> {
    const [companies, roles, meta] = await db.batch<Record<string, unknown>>([
        db.prepare('SELECT * FROM companies ORDER BY position, created_at DESC, id'),
        db.prepare('SELECT name FROM roles ORDER BY sort_order'),
        db.prepare('SELECT revision FROM sync_meta WHERE id = 1'),
    ]);
    const records: Company[] = companies.results.map(r => ({ id:String(r.id), name:String(r.name), link:String(r.link), deadline:String(r.deadline), roles:JSON.parse(String(r.roles)), dept:String(r.dept), appliedAt:String(r.applied_at), status:String(r.status), note:String(r.note), updatedAt:Math.round(Number(r.updated_at)*1000), starred:!!r.starred, deletedAt:Number(r.deleted_at), interview:JSON.parse(String(r.interview)) }));
    return { v:3, revision:Number(meta.results[0].revision), roles:roles.results.map(r => String(r.name)), companies:records.filter(r => !r.deletedAt), trash:records.filter(r => r.deletedAt) };
}
async function history(db: D1Database, companyId?: string): Promise<History[]> {
    const [result] = await db.batch<Record<string, unknown>>([db.prepare(companyId ? 'SELECT * FROM company_history WHERE company_id = ? ORDER BY occurred_at DESC, recorded_at DESC, rowid DESC' : 'SELECT * FROM company_history ORDER BY occurred_at DESC, recorded_at DESC, rowid DESC').bind(...(companyId ? [companyId] : []))]);
    return result.results.map(r => ({ id:String(r.id), companyId:String(r.company_id), kind:String(r.kind), fromStatus:String(r.from_status), toStatus:String(r.to_status), detail:String(r.detail), at:Number(r.occurred_at), recordedAt:Number(r.recorded_at) }));
}
async function write(db: D1Database, data: Snapshot, restoreHistory = false) {
    const previous = await read(db);
    if (previous.revision !== data.revision) return false;
    const now = Date.now(), old = new Map([...previous.companies, ...(previous.trash || [])].map(r => [r.id,r]));
    const active = data.companies.map(r => ({ ...r, starred:r.starred ?? old.get(r.id)?.starred ?? false, interview:r.interview ?? old.get(r.id)?.interview ?? noInterview(), deletedAt:0 }));
    const ids = new Set(active.map(r => r.id));
    const archive = new Map((previous.trash || []).filter(r => !ids.has(r.id)).map(r => [r.id,r]));
    for (const r of data.trash || []) if (!ids.has(r.id)) archive.set(r.id,{...r, starred:r.starred ?? old.get(r.id)?.starred ?? false, interview:r.interview ?? old.get(r.id)?.interview ?? noInterview(), deletedAt:r.deletedAt || now});
    for (const r of previous.companies) if (!ids.has(r.id) && !archive.has(r.id)) archive.set(r.id,{...r,deletedAt:now});
    const records = [...active,...archive.values()];
    if (archive.size > 2000 || records.length > 4000 || new TextEncoder().encode(JSON.stringify(records)).length > 1000000) throw new Error('记录及回收站数据超过上限，请先备份并精简备注');
    const events: History[] = [];
    const addEvent = (r:Company,kind:string,fromStatus='',detail='') => events.push({id:crypto.randomUUID(),companyId:r.id,kind,fromStatus,toStatus:r.status,detail,at:now,recordedAt:now});
    for (const r of active) {
        const before = old.get(r.id);
        if (!before) {
            addEvent(r,'created','','创建记录');
            if(r.interview.phase==='scheduled')addEvent(r,'schedule','',JSON.stringify(r.interview));
        }
        else {
            if (before.deletedAt) addEvent(r,'restore','','从回收站恢复');
            if (before.status !== r.status) addEvent(r,'status',before.status,'阶段进展');
            const a = before.interview || noInterview(), b = r.interview;
            if (a.phase!==b.phase || a.at!==b.at || a.location!==b.location) {
                if (b.phase === 'feedback' && a.phase === 'scheduled' && a.at === b.at) addEvent(r,'complete','',JSON.stringify(b));
                else if (b.phase === 'scheduled') addEvent(r,'schedule','',JSON.stringify({ ...b, previousAt:a.at!==b.at?a.at:'' }));
                else if (a.phase==='scheduled' && a.at) addEvent(r,'cancel','',JSON.stringify(a));
            }
        }
    }
    if(data.activity?.length && !restoreHistory){
        const covered=new Set(data.activity.map(h=>h.companyId));
        for(const id of covered){
            const changes=data.activity.filter(h=>h.companyId===id&&h.kind==='status');
            let status=old.get(id)?.status;
            for(const h of changes){if(status && h.fromStatus!==status)throw new Error('历史状态与当前版本不一致，请重新载入');status=h.toStatus;}
            if(changes.length&&status!==records.find(r=>r.id===id)?.status)throw new Error('历史状态与记录不一致');
        }
        const fallback=events.filter(h=>!covered.has(h.companyId));
        events.splice(0,events.length,...fallback,...data.activity.map(h=>({...h,recordedAt:now})));
    }
    const token = crypto.randomUUID(), gate = 'EXISTS (SELECT 1 FROM sync_meta WHERE id = 1 AND write_token = ?)';
    const batch = [
        db.prepare('UPDATE sync_meta SET revision = revision + 1, write_token = ? WHERE id = 1 AND revision = ?').bind(token,data.revision),
        db.prepare(`DELETE FROM companies WHERE ${gate}`).bind(token),
        db.prepare(`DELETE FROM roles WHERE ${gate}`).bind(token),
        db.prepare(`INSERT INTO roles(name,sort_order) SELECT value,key FROM json_each(?) WHERE ${gate}`).bind(JSON.stringify(data.roles),token),
        db.prepare(`INSERT INTO companies(id,name,link,deadline,roles,dept,applied_at,status,note,position,updated_at,starred,deleted_at,interview)
            SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.link'),json_extract(value,'$.deadline'),json_extract(value,'$.roles'),json_extract(value,'$.dept'),json_extract(value,'$.appliedAt'),json_extract(value,'$.status'),json_extract(value,'$.note'),key,COALESCE(json_extract(value,'$.updatedAt'),0)/1000.0,json_extract(value,'$.starred'),COALESCE(json_extract(value,'$.deletedAt'),0),COALESCE(json_extract(value,'$.interview'),'{"phase":"pending","at":"","location":""}') FROM json_each(?) WHERE ${gate}`).bind(JSON.stringify(records),token),
    ];
    if (restoreHistory && data.history) {
        const incomingIds = [...data.companies,...(data.trash || [])].map(r => r.id);
        const existingEvents = new Map((await history(db)).map(h => [h.id,h.companyId]));
        if (data.history.some(h => existingEvents.has(h.id) && existingEvents.get(h.id) !== h.companyId)) throw new Error('历史编号与其他记录冲突');
        batch.push(db.prepare(`DELETE FROM company_history WHERE company_id IN (SELECT value FROM json_each(?)) AND ${gate}`).bind(JSON.stringify(incomingIds),token));
        const covered = new Set(data.history.map(h => h.companyId));
        events.splice(0,events.length,...data.history,...events.filter(h => !covered.has(h.companyId)));
    }
    batch.push(db.prepare(`INSERT INTO company_history(id,company_id,kind,from_status,to_status,detail,occurred_at,recorded_at)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.companyId'),json_extract(value,'$.kind'),json_extract(value,'$.fromStatus'),json_extract(value,'$.toStatus'),json_extract(value,'$.detail'),json_extract(value,'$.at'),json_extract(value,'$.recordedAt') FROM json_each(?) WHERE ${gate}`).bind(JSON.stringify(events),token));
    for (const edit of data.historyEdits || []) batch.push(db.prepare(`UPDATE company_history SET occurred_at = ? WHERE id = ? AND kind IN ('baseline','created','status') AND ${gate}`).bind(edit.at,edit.id,token));
    const result = await db.batch(batch);
    return result[0].meta.changes > 0;
}
app.get('/api/data', async c => c.json(await read(c.env.DB)));
app.get('/api/history/:id', async c => {
    if (!validId(c.req.param('id'))) return c.json({error:'编号无效'},400);
    return c.json({history:await history(c.env.DB,c.req.param('id'))});
});
app.get('/api/backup', async c => {
    for (let n=0;n<3;n++) {
        const data = await read(c.env.DB), events = await history(c.env.DB), latest = await read(c.env.DB);
        if (data.revision === latest.revision) {
            const ids=new Set([...data.companies,...(data.trash||[])].map(r=>r.id));
            return c.json({...data,history:events.filter(h=>ids.has(h.companyId))});
        }
    }
    return c.json({error:'数据正在更新，请稍后备份'},409);
});
for (const path of ['/api/data','/api/backup']) app.put(path,async c => {
    let data:Snapshot;
    try { data=validateSnapshot(await c.req.json()); } catch(e) {return c.json({error:e instanceof Error?e.message:'数据无效'},400);}
    try {
        if (path==='/api/data') delete data.history;
        if (!await write(c.env.DB,data,path==='/api/backup')) return c.json({error:'另一台设备已更新数据，请先备份当前修改，再重新载入'},409);
        return c.json({ok:true,revision:data.revision+1});
    } catch(e) {
        if(e instanceof Error && /超过上限|编号.*冲突|历史状态/.test(e.message)) return c.json({error:e.message},400);
        throw e;
    }
});
app.get('/api/roles',async c => {const data=await read(c.env.DB);return c.json({roles:data.roles,revision:data.revision});});
app.post('/api/roles',async c => {
    let body:{name:string;revision:number};try{body=await c.req.json();}catch{return c.json({error:'数据无效'},400);}
    if(typeof body?.name!=='string'||!body.name.trim()||body.name.length>100)return c.json({error:'岗位名称无效'},400);
    const data=await read(c.env.DB);if(body.revision!==data.revision)return c.json({error:'数据版本已变化'},409);
    if(!data.roles.includes(body.name.trim()))data.roles.push(body.name.trim());
    try{validateSnapshot(data);}catch{return c.json({error:'岗位数量或数据无效'},400);}
    if(!await write(c.env.DB,data))return c.json({error:'数据版本已变化'},409);
    return c.json({ok:true,revision:data.revision+1});
});
app.delete('/api/roles/:name',async c => {
    const data=await read(c.env.DB);if(c.req.header('If-Match')!==String(data.revision))return c.json({error:'请提供当前数据版本 If-Match'},409);
    const name=c.req.param('name');data.roles=data.roles.filter(r=>r!==name);
    data.companies.forEach(co=>{if(co.roles.includes(name)){co.roles=co.roles.filter(r=>r!==name);co.updatedAt=Math.max(Date.now(),(co.updatedAt||0)+1);}});
    if(!await write(c.env.DB,data))return c.json({error:'数据版本已变化'},409);
    return c.json({ok:true,revision:data.revision+1});
});
app.onError((e,c)=>{console.error(e);return c.json({error:'服务暂时不可用，请保留本地备份后重试'},500);});
app.get('*',c=>c.env.ASSETS.fetch(c.req.raw));
export default app;
