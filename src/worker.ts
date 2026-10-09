import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
};

type Company = {
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

const app = new Hono<{ Bindings: Bindings }>();

// 简单密钥中间件
const ACCESS_KEY = "toudi2024"; // 修改为你想要的密钥，建议改复杂点

app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const key = url.searchParams.get("key");
  const auth = c.req.header("Authorization");
  
  const valid = key === ACCESS_KEY || auth === `Bearer ${ACCESS_KEY}`;
  
  // 静态资源和登录页放行
  if (c.req.path.startsWith("/favicon") || c.req.path === "/login") {
    return next();
  }
  
  if (!valid) {
    // API 返回 401
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Unauthorized", message: "需要密钥访问，格式：?key=xxx 或 Header: Authorization: Bearer xxx" }, 401);
    }
    // 页面显示简单密钥输入页
    return c.html(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>投递管理 - 需要密钥</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:400px;margin:100px auto;padding:20px;text-align:center}input{padding:12px 16px;font-size:16px;border:1px solid #ddd;border-radius:8px;width:70%}button{padding:12px 24px;font-size:16px;background:#2f4a7d;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-left:8px}button:hover{filter:brightness(1.1)}</style>
</head><body>
<h2>🔒 投递管理</h2><p>请输入访问密钥</p>
<form onsubmit="event.preventDefault();const k=pwd.value;location.href='/?key='+encodeURIComponent(k)">
<input name="pwd" id="pwd" placeholder="输入密钥" autocomplete="off"><button>进入</button>
</form><p style="color:#666;font-size:14px;margin-top:16px">或在 URL 后加 <code>?key=你的密钥</code></p>
</body></html>`, 200);
  }
  await next();
});

app.use('*', cors({
  origin: ['*'],
  allowMethods: ['GET', 'PUT', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

const STATUSES = ['未投', '已投', '测评', '笔试', '一面', '二面', '三面', 'OC', '已挂'];

function validateCompany(data: unknown): Company {
  const obj = data as Record<string, unknown>;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.companies)) {
    throw new Error('数据结构不对，缺 companies 列表');
  }
  return obj as unknown as Company;
}

function rowToCompany(row: Record<string, unknown>): Company {
  return {
    id: row.id as string,
    name: row.name as string,
    link: row.link as string,
    deadline: row.deadline as string,
    roles: JSON.parse(row.roles as string || '[]'),
    dept: row.dept as string,
    appliedAt: row.applied_at as string,
    status: row.status as string,
    note: row.note as string,
  };
}

function companyToRow(co: Company): Record<string, unknown> {
  return {
    id: co.id,
    name: co.name,
    link: co.link,
    deadline: co.deadline,
    roles: JSON.stringify(co.roles),
    dept: co.dept,
    applied_at: co.appliedAt,
    status: co.status,
    note: co.note,
  };
}

app.get('/api/data', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM companies ORDER BY updated_at DESC'
  ).all();
  const companies = (results as Record<string, unknown>[]).map(rowToCompany);
  return c.json({ v: 2, roles: [], companies });
});

app.put('/api/data', async (c) => {
  try {
    const body = await c.req.json();
    const { companies } = validateCompany(body);

    const stmt = c.env.DB.prepare(
      `INSERT OR REPLACE INTO companies 
       (id, name, link, deadline, roles, dept, applied_at, status, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))`
    );

    const batch = companies.map((co: Company) => stmt.bind(
      co.id, co.name, co.link, co.deadline, JSON.stringify(co.roles),
      co.dept, co.appliedAt, co.status, co.note
    ));

    await c.env.DB.batch(batch);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.get('/api/roles', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT name FROM roles ORDER BY sort_order'
  ).all();
  const roles = (results as { name: string }[]).map(r => r.name);
  return c.json({ roles });
});

app.post('/api/roles', async (c) => {
  try {
    const { name } = await c.req.json<{ name: string }>();
    if (!name?.trim()) return c.json({ ok: false, error: '岗位名不能为空' }, 400);
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO roles (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM roles))'
    ).bind(name.trim()).run();
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: '添加失败' }, 500);
  }
});

app.delete('/api/roles/:name', async (c) => {
  const name = c.req.param('name');
  await c.env.DB.prepare('DELETE FROM roles WHERE name = ?').bind(name).run();
  await c.env.DB.prepare('UPDATE companies SET roles = json_remove(roles, json_array_index(roles, ?)) WHERE json_array_contains(roles, ?)').bind(name, name).run();
  return c.json({ ok: true });
});

app.get('*', serveStatic({ root: './public' }));
app.get('*', serveStatic({ path: './public/index.html' }));

export default app;