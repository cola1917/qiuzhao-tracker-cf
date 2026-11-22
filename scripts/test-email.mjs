// Send a one-off test interview-reminder email via Resend.
// Usage:
//   RESEND_API_KEY=re_xxx node scripts/test-email.mjs [recipient]
// It also reads RESEND_API_KEY / NOTIFY_EMAIL from .dev.vars if present.
import { readFileSync } from 'node:fs';

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

if (!key) {
  console.error('缺少 RESEND_API_KEY。请设置环境变量或写入 .dev.vars 后重试。');
  process.exit(1);
}

const when = new Date(Date.now() + 6 * 3600000).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    from,
    to,
    subject: `面试提醒测试：星河机器人 一面 · ${when}`,
    html: `<div style="font-family:system-ui,'PingFang SC',sans-serif;max-width:560px;color:#242726">
      <h2 style="color:#c55333;margin:0 0 12px">面试提醒（测试）</h2>
      <p>这是一封来自「投递 · 求职工作台」的测试邮件，说明 Cron 邮件链路已打通。</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#687060">公司</td><td><strong>星河机器人</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#687060">轮次</td><td>一面</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#687060">时间</td><td>${when}（北京时间）</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#687060">地点</td><td>线上会议（示例）</td></tr>
      </table>
      <p style="margin-top:16px;font-size:12px;color:#687060">如果你收到这封邮件，提醒功能已配置成功。</p>
    </div>`,
  }),
});

const body = await res.text();
if (res.ok) console.log(`测试邮件已发送到 ${to}（Resend: ${body}）`);
else { console.error(`发送失败 ${res.status}: ${body}`); process.exit(1); }
