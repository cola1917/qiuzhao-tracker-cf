import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import app from '../src/worker.ts';
import { database, company } from '../tests/helpers.mjs';
const DB = database();
const roles = ['机器人算法', '软件开发', 'AI Infra'];
const companies = ['星河机器人', '远山科技', '青禾智能', '云帆科技', '新程汽车', '未央实验室'].map((name, i) => ({ ...company('demo-' + i, [roles[i % 3]]), name, status: ['未投', '一面', '已投', 'OC', '笔试', '未投'][i], deadline: i % 2 ? '' : new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10), appliedAt: i ? '2026-10-08' : '', note: ['准备简历与作品集', '技术面 · 等待安排', '已通过内推投递', '新的旅程，即将开始', '完成在线笔试', '关注秋招开放时间'][i] }));
const env = { DB, ASSETS: { async fetch(req) { const pathname = new URL(req.url).pathname; const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css', '/editorial.css': 'editorial.css' }; const name = files[pathname]; if (!name)
            return new Response('Not found', { status: 404 }); return new Response(await readFile(new URL('../public/' + name, import.meta.url)), { headers: { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' } }); } } };
await app.request('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, roles, companies }) }, env);
createServer(async (req, res) => { try {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    const response = await app.fetch(new Request('http://127.0.0.1:8790' + req.url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
}
catch (error) {
    res.writeHead(500);
    res.end(String(error));
} }).listen(8790, '127.0.0.1', () => console.log('Isolated preview: http://127.0.0.1:8790; in-memory sample data only'));
