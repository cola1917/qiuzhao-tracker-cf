// Send a one-off REMINDER email using the exact production template (T-0 / 今日面试提醒).
// Usage:
//   RESEND_API_KEY=re_xxx node scripts/test-email.mjs [recipient]
// Reads RESEND_API_KEY / NOTIFY_EMAIL / NOTIFY_FROM / APP_URL from .dev.vars if present.
import { readFileSync } from 'node:fs';
import { renderReminderEmail } from '../src/email-template.ts';

function loadDevVars() {
  try {
    const text = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return out;
  } catch { return {}; }
}

const dev = loadDevVars();
const key = process.env.RESEND_API_KEY || dev.RESEND_API_KEY;
const to = process.argv[2] || process.env.NOTIFY_EMAIL || dev.NOTIFY_EMAIL || 'colawang1997@outlook.com';
const from = process.env.NOTIFY_FROM || dev.NOTIFY_FROM || '投递工作台 <onboarding@resend.dev>';
const appUrl = process.env.APP_URL || dev.APP_URL || 'https://toudi-guanli.wangjiangtao1997.workers.dev';

if (!key) {
  console.error('缺少 RESEND_API_KEY。请设置环境变量或写入 .dev.vars 后重试。');
  process.exit(1);
}

const hoursLeft = 2;
const at = Date.now() + hoursLeft * 3600000;
const when = new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const { subject, html } = renderReminderEmail({
  type: 'd0', name: '星河机器人', status: '一面', when,
  location: '线上会议（示例链接）', roles: '具身智能算法', hoursLeft, appUrl,
});

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ from, to, subject, html }),
});
const body = await res.text();
if (res.ok) console.log(`升级版提醒邮件已发送到 ${to}（Resend: ${body}）`);
else { console.error(`发送失败 ${res.status}: ${body}`); process.exit(1); }
