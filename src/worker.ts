import { Hono } from 'hono';
type Bindings = {
    DB: D1Database;
    ASSETS: Fetcher;
    ACCESS_TOKEN?: string;
};
export type Company = {
    id: string;
    name: string;
    link: string;
    deadline: string;
    roles: string[];
    dept: string;
    appliedAt: string;
    status: string;
    note: string;
};
type Snapshot = {
    v: number;
    revision: number;
    roles: string[];
    companies: Company[];
};
const statuses = ['未投', '已投', '测评', '笔试', '一面', '二面', '三面', 'OC', '已挂'];
const fields = ['id', 'name', 'link', 'deadline', 'dept', 'appliedAt', 'status', 'note'] as const;
export function validateSnapshot(input: unknown): Snapshot {
    const data = input as Snapshot;
    if (new TextEncoder().encode(JSON.stringify(input)).length > 1000000)
        throw new Error('数据量超过上限，请精简备注后重试');
    if (!data || !Array.isArray(data.companies) || data.companies.length > 2000 || !Array.isArray(data.roles) || data.roles.length > 200 || !Number.isSafeInteger(data.revision) || data.revision < 0)
        throw new Error('备份结构或版本无效');
    const roles = data.roles;
    if (roles.some(r => typeof r !== 'string' || !r.trim() || r.length > 100) || new Set(roles).size !== roles.length)
        throw new Error('岗位名称无效或重复');
    const ids = new Set<string>();
    for (const co of data.companies) {
        if (!co || fields.some(f => typeof co[f] !== 'string' || co[f].length > 5000) || !/^[a-zA-Z0-9_-]{1,100}$/.test(co.id) || ids.has(co.id))
            throw new Error('公司字段或编号无效');
        ids.add(co.id);
        if (!statuses.includes(co.status) || !Array.isArray(co.roles) || co.roles.some(r => !roles.includes(r)))
            throw new Error('状态或岗位无效');
        for (const date of [co.deadline, co.appliedAt])
            if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))
                throw new Error('日期无效');
    }
    return { v: 2, revision: data.revision, roles, companies: data.companies };
}
const app = new Hono<{
    Bindings: Bindings;
}>();
app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (!c.env.ACCESS_TOKEN)
        return c.json({ error: '请先为 Worker 配置 ACCESS_TOKEN 访问密钥' }, 503);
    const token = c.req.header('Authorization')?.replace(/^Bearer /, '') || '';
    const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    const [a, b] = await Promise.all([digest(token), digest(c.env.ACCESS_TOKEN)]);
    let difference = 0;
    for (let i = 0; i < a.length; i++)
        difference |= a[i] ^ b[i];
    if (difference)
        return c.json({ error: '访问密钥不正确' }, 401);
    await next();
});
async function read(db: D1Database): Promise<Snapshot> {
    const [companies, roles, meta] = await db.batch<Record<string, unknown>>([
        db.prepare('SELECT * FROM companies ORDER BY position, created_at DESC, id'),
        db.prepare('SELECT name FROM roles ORDER BY sort_order'),
        db.prepare('SELECT revision FROM sync_meta WHERE id = 1'),
    ]);
    return { v: 2, revision: Number(meta.results[0].revision), roles: roles.results.map(r => String(r.name)), companies: companies.results.map(r => ({ id: String(r.id), name: String(r.name), link: String(r.link), deadline: String(r.deadline), roles: JSON.parse(String(r.roles)), dept: String(r.dept), appliedAt: String(r.applied_at), status: String(r.status), note: String(r.note) })) };
}
async function write(db: D1Database, data: Snapshot) {
    const token = crypto.randomUUID();
    const gate = 'EXISTS (SELECT 1 FROM sync_meta WHERE id = 1 AND write_token = ?)';
    const batch = [
        db.prepare('UPDATE sync_meta SET revision = revision + 1, write_token = ? WHERE id = 1 AND revision = ?').bind(token, data.revision),
        db.prepare(`DELETE FROM companies WHERE ${gate}`).bind(token),
        db.prepare(`DELETE FROM roles WHERE ${gate}`).bind(token),
        db.prepare(`INSERT INTO roles(name,sort_order) SELECT value,key FROM json_each(?) WHERE ${gate}`).bind(JSON.stringify(data.roles), token),
        db.prepare(`INSERT INTO companies(id,name,link,deadline,roles,dept,applied_at,status,note,position)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.link'),json_extract(value,'$.deadline'),json_extract(value,'$.roles'),json_extract(value,'$.dept'),json_extract(value,'$.appliedAt'),json_extract(value,'$.status'),json_extract(value,'$.note'),key FROM json_each(?) WHERE ${gate}`).bind(JSON.stringify(data.companies), token),
    ];
    const results = await db.batch(batch);
    return results[0].meta.changes > 0;
}
app.get('/api/data', async (c) => c.json(await read(c.env.DB)));
app.put('/api/data', async (c) => {
    let data: Snapshot;
    try {
        data = validateSnapshot(await c.req.json());
    }
    catch (e) {
        return c.json({ error: e instanceof Error ? e.message : '数据无效' }, 400);
    }
    if (!await write(c.env.DB, data))
        return c.json({ error: '另一台设备已更新数据，请先备份当前修改，再重新载入' }, 409);
    return c.json({ ok: true, revision: data.revision + 1 });
});
app.get('/api/roles', async (c) => { const data = await read(c.env.DB); return c.json({ roles: data.roles, revision: data.revision }); });
app.post('/api/roles', async (c) => {
    let body: {
        name: string;
        revision: number;
    };
    try {
        body = await c.req.json();
    }
    catch {
        return c.json({ error: '数据无效' }, 400);
    }
    if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 100)
        return c.json({ error: '岗位名称无效' }, 400);
    const data = await read(c.env.DB);
    if (body.revision !== data.revision)
        return c.json({ error: '数据版本已变化' }, 409);
    if (!data.roles.includes(body.name.trim()))
        data.roles.push(body.name.trim());
    try {
        validateSnapshot(data);
    }
    catch {
        return c.json({ error: '岗位数量或数据无效' }, 400);
    }
    if (!await write(c.env.DB, data))
        return c.json({ error: '数据版本已变化' }, 409);
    return c.json({ ok: true, revision: data.revision + 1 });
});
app.delete('/api/roles/:name', async (c) => {
    const data = await read(c.env.DB);
    if (c.req.header('If-Match') !== String(data.revision))
        return c.json({ error: '请提供当前数据版本 If-Match' }, 409);
    const name = c.req.param('name');
    data.roles = data.roles.filter(r => r !== name);
    data.companies.forEach(co => co.roles = co.roles.filter(r => r !== name));
    if (!await write(c.env.DB, data))
        return c.json({ error: '数据版本已变化' }, 409);
    return c.json({ ok: true, revision: data.revision + 1 });
});
app.onError((e, c) => { console.error(e); return c.json({ error: '服务暂时不可用，请保留本地备份后重试' }, 500); });
app.get('*', c => c.env.ASSETS.fetch(c.req.raw));
export default app;
