// Interview reminder email template. Uses inline styles + table layout for email-client compatibility.

export function escapeHtml(s: string): string {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function safeUrl(value: string): string {
    const v = String(value || '').trim();
    try {
        const u = new URL(v);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch { return ''; }
}

// Bulletproof button: a table cell with a background color wrapping a padded link.
function button(href: string, label: string, bg: string, color: string): string {
    if (!href) return '';
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block"><tr>
      <td bgcolor="${bg}" style="border-radius:6px">
        <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:11px 20px;font-family:system-ui,'PingFang SC',sans-serif;font-size:13px;font-weight:600;color:${color};text-decoration:none;border-radius:6px">${escapeHtml(label)}</a>
      </td></tr></table>`;
}

export type ReminderEmail = {
    type: 't1' | 'd0';
    name: string;
    status: string;
    when: string;          // already formatted in Asia/Shanghai
    location: string;
    roles: string;
    hoursLeft: number;
    appUrl: string;
    interviewUrl?: string; // optional explicit link to the meeting/interview page
};

export function renderReminderEmail(p: ReminderEmail): { subject: string; html: string } {
    const isT1 = p.type === 't1';
    const title = isT1 ? '明日面试提醒' : '今日面试提醒';
    const lead = isT1
        ? '这场面试在<strong>明天</strong>，今晚可以再过一遍项目细节与高频考点。'
        : `这场面试就在<strong>今天</strong>，距开始约 <strong>${Math.max(1, Math.round(p.hoursLeft))} 小时</strong>，请提前做好准备。`;
    const subject = `【${title}】${p.name} ${p.status} · ${p.when}`;

    const meetingUrl = safeUrl(p.interviewUrl || '') || safeUrl(p.location);
    const meetingBtn = button(meetingUrl, '查看会议链接 ↗', '#c55333', '#ffffff');
    const appBtn = button(safeUrl(p.appUrl), '打开工作台 ↗', '#fffefa', '#c55333');
    const actionRow = (meetingBtn || appBtn)
        ? `<tr><td style="padding:20px 0 0">
             <table role="presentation" cellpadding="0" cellspacing="0"><tr>
               <td style="padding-right:10px">${meetingBtn}</td>
               <td>${appBtn}</td>
             </tr></table>
           </td></tr>`
        : '';

    const html = `<div style="margin:0;padding:24px 12px;background:#f8f7f3;font-family:system-ui,'PingFang SC','Microsoft YaHei',sans-serif">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:auto;background:#fffefa;border:1px solid #dedfd6;border-radius:8px;overflow:hidden">
        <!-- Brand banner -->
        <tr><td bgcolor="#c55333" style="padding:18px 24px">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td style="font-size:22px;font-weight:700;color:#fff;letter-spacing:1px">↗ 投递</td>
            <td align="right" style="font-size:9px;letter-spacing:1.5px;color:#f7e7df;font-family:Consolas,monospace">CAREER WORKSPACE</td>
          </tr></table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:26px 24px 24px">
          <div style="font-size:22px;font-weight:700;color:#242726;margin:0 0 14px">${title}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#fcf6f0;border-left:3px solid #c55333;border-radius:4px;margin-bottom:18px"><tr>
            <td style="padding:12px 15px;font-size:14px;line-height:1.7;color:#202820">${lead}</td>
          </tr></table>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e7e9df;border-radius:5px">
            <tr><td style="padding:14px 16px;border-bottom:1px solid #eef0e8">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
                <td style="font-size:13px;color:#687060;width:84px">公司 / 轮次</td>
                <td style="font-size:14px;font-weight:600;color:#242726">${escapeHtml(p.name)} <span style="color:#c55333">· ${escapeHtml(p.status)}</span></td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:14px 16px;border-bottom:1px solid #eef0e8">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
                <td style="font-size:13px;color:#687060;width:84px">时间</td>
                <td style="font-size:14px;font-weight:600;color:#242726">${escapeHtml(p.when)}（北京时间）</td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:14px 16px">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
                <td style="font-size:13px;color:#687060;width:84px;vertical-align:top">地点 / 链接</td>
                <td style="font-size:14px;color:#242726;overflow-wrap:anywhere">${escapeHtml(p.location)}</td>
              </tr></table>
            </td></tr>
          </table>
          ${actionRow}
        </td></tr>
        <!-- Footer -->
        <tr><td bgcolor="#f8f7f3" style="padding:14px 24px;border-top:1px solid #dedfd6;font-size:12px;color:#81837b">
          岗位：${escapeHtml(p.roles) || '—'} · 来自「投递 · 求职工作台」<br/>祝你面试顺利，每一步都算数。
        </td></tr>
      </table>
    </div>`;
    return { subject, html };
}
