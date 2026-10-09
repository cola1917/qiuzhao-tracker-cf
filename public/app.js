'use strict';
const $ = id => document.getElementById(id);
const STATUSES = ['未投', '已投', '测评', '笔试', '一面', '二面', '三面', 'OC', '已挂'];
const LIVE = ['测评', '笔试', '一面', '二面', '三面'];
const DEFAULT_ROLES = ['具身智能算法', '机器人算法', 'VLA / 多模态算法', '机器人仿真', 'Sim2Real', '感知算法', 'SLAM / 定位', '运动规划', '运动控制', '强化学习', '大模型算法', 'AI Infra', '端侧部署', '机械工程师', '结构工程师', '软件开发'];
const emptyState = () => ({ v: 2, revision: 0, roles: [...DEFAULT_ROLES], companies: [] });
let state = emptyState(), mode = 'locked', token = '', dirty = false, saving = false, generation = 0, timer, blocked = false, pending = null;
let view = 'all';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const days = date => date ? Math.round((Date.parse(date + 'T00:00:00') - Date.parse(today() + 'T00:00:00')) / 86400000) : null;
const copy = value => JSON.parse(JSON.stringify(value));
function readStorage(key) { try {
    return JSON.parse(localStorage.getItem(key) || 'null');
}
catch {
    return null;
} }
function cacheKey() { return mode === 'server' ? 'qiuzhao-cloud-draft-v3' : 'qiuzhao-local-v3'; }
function cache() { try {
    localStorage.setItem(cacheKey(), JSON.stringify({ state, pending: dirty }));
    return true;
}
catch {
    return false;
} }
function flag(kind, message) { $('saveflag').dataset.s = kind; $('savetext').textContent = message; }
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = 'notice' + (error ? ' error' : ''); $('notice').hidden = !message; }
function normalize(raw) {
    if (!raw || !Array.isArray(raw.companies) || raw.companies.length > 2000)
        throw new Error('备份缺少有效的 companies 列表，或记录超过 2000 条');
    if (new TextEncoder().encode(JSON.stringify(raw)).length > 1000000)
        throw new Error('数据量超过上限，请精简备注后重试');
    const result = { v: 2, revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0, roles: [], companies: [] };
    const roles = Array.isArray(raw.roles) ? raw.roles : DEFAULT_ROLES;
    for (const r of roles) {
        if (typeof r !== 'string' || !r.trim() || r.length > 100)
            throw new Error('岗位名称无效');
        if (!result.roles.includes(r.trim()))
            result.roles.push(r.trim());
    }
    const ids = new Set();
    for (const original of raw.companies) {
        if (!original || typeof original !== 'object' || Array.isArray(original))
            throw new Error('公司记录格式无效');
        const co = {};
        co.id = typeof original.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(original.id) && !ids.has(original.id) ? original.id : crypto.randomUUID();
        ids.add(co.id);
        for (const f of ['name', 'link', 'deadline', 'dept', 'appliedAt', 'note']) {
            co[f] = typeof original[f] === 'string' ? original[f] : '';
            if (co[f].length > 5000)
                throw new Error('字段内容过长');
        }
        for (const date of [co.deadline, co.appliedAt])
            if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))
                throw new Error('备份中有无效日期');
        co.status = STATUSES.includes(original.status) ? original.status : '未投';
        co.roles = [];
        for (const r of Array.isArray(original.roles) ? original.roles : []) {
            if (typeof r !== 'string' || !r.trim() || r.length > 100)
                throw new Error('公司岗位无效');
            const role = r.trim();
            if (!co.roles.includes(role))
                co.roles.push(role);
            if (!result.roles.includes(role))
                result.roles.push(role);
        }
        result.companies.push(co);
    }
    if (result.roles.length > 200)
        throw new Error('岗位不能超过 200 个');
    return result;
}
async function api(path, options = {}) {
    const response = await fetch('/api/' + path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...options.headers } });
    const data = await response.json().catch(() => ({ error: '服务返回了无效响应' }));
    if (!response.ok) {
        const error = new Error(data.error || '连接失败');
        error.status = response.status;
        throw error;
    }
    return data;
}
function changed(refresh = true) { generation++; dirty = true; blocked = false; const persisted = cache(); flag('saving', mode === 'server' ? '修改已暂存，等待同步' : '正在保存'); if (!persisted)
    notice('浏览器存储不可用，请及时导出 JSON 备份。', true); clearTimeout(timer); timer = setTimeout(save, 500); if (refresh)
    render();
else
    renderStats(); }
async function save() {
    if (!dirty || saving || blocked || mode === 'locked')
        return;
    if (mode === 'local') {
        dirty = false;
        if (cache())
            flag('ok', '已保存到此浏览器');
        else {
            dirty = true;
            flag('error', '本地保存失败，请备份');
        }
        return;
    }
    saving = true;
    const version = generation;
    const snapshot = copy(state);
    flag('saving', '正在同步…');
    try {
        const result = await api('data', { method: 'PUT', body: JSON.stringify(snapshot) });
        state.revision = result.revision;
        if (generation === version)
            dirty = false;
        cache();
        flag('ok', dirty ? '继续同步新修改…' : '已同步到云端');
    }
    catch (error) {
        dirty = true;
        cache();
        flag('error', '修改尚未同步');
        if ([401, 409, 503, 400].includes(error.status)) {
            blocked = true;
            notice(error.message + '。可在「数据管理」中备份当前数据。', true);
        }
        else {
            notice('连接中断，修改已在本机暂存，将自动重试。', true);
        }
    }
    finally {
        saving = false;
        if (dirty && !blocked) {
            clearTimeout(timer);
            timer = setTimeout(save, 1500);
        }
    }
}
async function connect() {
    const data = normalize(await api('data'));
    state = data;
    mode = 'server';
    dirty = false;
    blocked = false;
    pending = readStorage('qiuzhao-cloud-recovery-v3') || readStorage(cacheKey());
    if (pending?.pending) {
        try {
            localStorage.setItem('qiuzhao-cloud-recovery-v3', JSON.stringify(pending));
        }
        catch {
            notice('浏览器存储不可用，请先备份未同步数据。', true);
        }
    }
    $('recovery').hidden = !(pending?.pending && pending.state);
    if (!pending?.pending)
        cache();
    $('auth').close();
    $('storage-label').textContent = '私人空间 · 云端同步';
    $('reload').hidden = false;
    flag('ok', '已同步到云端');
    notice('');
    render();
    const legacy = readStorage('qiuzhao-tracker-v2');
    if (!state.companies.length && !pending?.pending && legacy?.companies?.length) {
        pending = { state: legacy, pending: true };
        $('recovery').hidden = false;
        notice('发现旧版浏览器记录，点击「恢复修改」确认迁移。原备份会保留。');
    }
}
function renderStats() {
    const n = { all: state.companies.length, todo: 0, live: 0, oc: 0, sent: 0, out: 0 };
    state.companies.forEach(co => { if (co.status === '未投')
        n.todo++;
    else
        n.sent++; if (LIVE.includes(co.status))
        n.live++; if (co.status === 'OC')
        n.oc++; if (co.status === '已挂')
        n.out++; });
    $('navcount').textContent = n.all;
    $('stats').innerHTML = [[n.all, '全部投递', '把握每一个值得尝试的机会', '↗'], [n.todo, '待投递', '准备好，就向前一步', '◷'], [n.live, '进行中', '笔试与面试，持续向前', '↗'], [n.oc, '收获 Offer', '努力正在得到回响', '✧']].map(([value, label, desc, icon]) => `<div class="stat"><div class="stat-label">${label}<i>${icon}</i></div><strong>${value.toString().padStart(2, '0')}</strong><small>${desc}</small></div>`).join('');
    const stageCounts = [n.todo, n.sent - n.live - n.oc - n.out, n.live, n.oc, n.out];
    $('pipeline').innerHTML = ['待投递', '已投递', '笔试 / 面试', 'Offer', '已结束'].map((label, i) => `<div class="stage"><div class="track"><i style="width:${n.all ? Math.round(stageCounts[i] / n.all * 100) : 0}%"></i></div><span class="stage-label">${label}</span><b>${stageCounts[i].toString().padStart(2, '0')}</b></div>`).join('');
    const upcoming = state.companies.filter(co => co.status === '未投' && co.deadline && days(co.deadline) >= 0 && days(co.deadline) <= 7).sort((a, b) => a.deadline.localeCompare(b.deadline));
    $('upcoming').innerHTML = upcoming.length ? upcoming.slice(0, 3).map(co => `<div class="upcoming-item"><i></i><button data-edit="${esc(co.id)}">${esc(co.name || '未命名公司')}</button><small>${days(co.deadline) === 0 ? '今天截止' : days(co.deadline) + ' 天后截止'}</small></div>`).join('') + (upcoming.length > 3 ? `<p class="quiet">另有 ${upcoming.length - 3} 家即将截止，筛选「待投清单」查看</p>` : '') : '<p class="quiet">暂无即将截止的待投机会，按自己的节奏前进。</p>';
}
function render() { renderStats(); renderTable(); }
function renderTable() {
    const query = $('q').value.trim().toLowerCase(), status = $('statusfilter').value;
    const list = state.companies.filter(co => (view === 'all' || view === 'todo' && co.status === '未投' || view === 'live' && LIVE.includes(co.status) || view === 'oc' && co.status === 'OC') && (!status || co.status === status) && (!query || [co.name, co.dept, co.note, ...co.roles].join(' ').toLowerCase().includes(query)));
    const sort = $('sort').value;
    if (sort === 'deadline')
        list.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    if (sort === 'name')
        list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    if (sort === 'status')
        list.sort((a, b) => STATUSES.indexOf(b.status) - STATUSES.indexOf(a.status));
    $('view-title').innerHTML = ({ all: '全部投递', todo: '待投清单', live: '进行中', oc: '收获 Offer' }[view]) + ` <span>${list.length}</span>`;
    $('rows').innerHTML = list.map(co => {
        const remaining = days(co.deadline);
        const input = (field, placeholder = '', type = 'text') => `<input class="inline-input ${field === 'name' ? 'company-name' : ''}" data-field="${field}" data-id="${esc(co.id)}" aria-label="${esc(co.name || '新投递')} ${({ name: '公司名称', link: '投递链接', dept: '部门', deadline: '截止日期', appliedAt: '投递时间', note: '备注' })[field]}" type="${type}" value="${esc(co[field])}" placeholder="${placeholder}" maxlength="${field === 'note' ? 5000 : 2000}">`;
        return `<tr data-row="${esc(co.id)}"><td class="company-cell">${input('name', '公司名称…')}${input('link', '投递链接 / 来源')}</td><td class="role-cell"><details class="role-select" data-role-menu="${esc(co.id)}"><summary>${roleSummary(co)}</summary><div class="role-menu">${state.roles.map((r, i) => `<div class="role-choice"><label><input type="checkbox" data-company-role="${esc(co.id)}" data-role-index="${i}" ${co.roles.includes(r) ? 'checked' : ''}>${esc(r)}</label><button type="button" data-delete-role="${i}" aria-label="删除岗位 ${esc(r)}">×</button></div>`).join('')}<div class="role-add"><input class="new-role" aria-label="新岗位" maxlength="100" placeholder="添加岗位…"><button type="button" data-add-role="${esc(co.id)}">＋</button></div></div></details>${input('dept', '部门 / 团队')}</td><td><select class="inline-status ${statusClass(co.status)}" data-status="${esc(co.id)}" aria-label="${esc(co.name || '新投递')} 投递状态">${STATUSES.map(s => `<option ${co.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td class="date">${input('deadline', '', 'date')}<span class="due ${remaining < 0 ? 'late' : ''}" data-due>${dueText(co.deadline)}</span></td><td class="date">${input('appliedAt', '', 'date')}</td><td>${input('note', '内推码、面试安排…')}</td><td><button class="delete-row" data-delete="${esc(co.id)}" aria-label="删除 ${esc(co.name || '此记录')}">×</button></td></tr>`;
    }).join('');
    $('empty').hidden = !!list.length;
    $('rows').closest('table').hidden = !list.length;
    $('empty').querySelector('h3').textContent = state.companies.length ? '没有匹配的投递' : '下一份机会，从这里开始';
    $('empty').querySelector('p').textContent = state.companies.length ? '试试其他关键词，或调整筛选条件。' : '记下感兴趣的公司，让每一次投递都有迹可循。';
    $('footcount').textContent = `显示 ${list.length} 条 / 共 ${state.companies.length} 条记录`;
}
function statusClass(status) { return status === 'OC' ? 'oc' : LIVE.includes(status) ? 'live' : status === '已投' ? 'sent' : status === '已挂' ? 'out' : ''; }
function dueText(date) { const n = days(date); return n === null ? '' : n < 0 ? '已截止' : n === 0 ? '今天截止' : '剩余 ' + n + ' 天'; }
function roleSummary(co) { return co.roles.length ? co.roles.map(r => `<span class="role-chip">${esc(r)}</span>`).join('') : '<span class="placeholder">选择岗位…</span>'; }
function addCompany() {
    if (mode === 'locked')
        return;
    if (state.companies.length >= 2000) {
        notice('最多保存 2000 条记录。', true);
        return;
    }
    const co = { id: crypto.randomUUID(), name: '', link: '', deadline: '', appliedAt: '', roles: [], dept: '', status: '未投', note: '' };
    state.companies.unshift(co);
    view = 'all';
    $('q').value = '';
    $('statusfilter').value = '';
    $('sort').value = 'added';
    document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === 'all'));
    changed();
    const input = document.querySelector('[data-row="' + co.id + '"] [data-field="name"]');
    input.focus({ preventScroll: true });
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function download(name, text, mime = 'application/json') { const url = URL.createObjectURL(new Blob([text], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function backup(data = state) { download('投递备份-' + today() + '.json', JSON.stringify(data, null, 2)); }
$('add').onclick = $('empty-add').onclick = addCompany;
document.addEventListener('click', e => {
    const nav = e.target.closest('[data-view]');
    if (nav) {
        view = nav.dataset.view;
        document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el === nav));
        $('statusfilter').value = '';
        render();
    }
    const jump = e.target.closest('[data-edit]');
    if (jump) {
        view = 'all';
        $('q').value = '';
        $('statusfilter').value = '';
        document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === 'all'));
        render();
        const input = document.querySelector('[data-row="' + jump.dataset.edit + '"] [data-field="name"]');
        input?.focus();
    }
    const del = e.target.closest('[data-delete]');
    if (del) {
        const co = state.companies.find(c => c.id === del.dataset.delete);
        if (co && confirm('删除「' + (co.name || '此记录') + '」？')) {
            state.companies = state.companies.filter(c => c.id !== co.id);
            changed();
        }
    }
    const add = e.target.closest('[data-add-role]');
    if (add) {
        const input = add.parentElement.querySelector('input');
        const role = input.value.trim();
        if (!role)
            return;
        if (state.roles.length >= 200 && !state.roles.includes(role)) {
            notice('最多添加 200 个岗位。', true);
            return;
        }
        if (!state.roles.includes(role))
            state.roles.push(role);
        const co = state.companies.find(c => c.id === add.dataset.addRole);
        if (!co.roles.includes(role))
            co.roles.push(role);
        changed();
        document.querySelector('[data-role-menu="' + co.id + '"]').open = true;
    }
    const remove = e.target.closest('[data-delete-role]');
    if (remove) {
        const role = state.roles[Number(remove.dataset.deleteRole)];
        if (confirm('从所有投递中移除岗位「' + role + '」？')) {
            state.roles = state.roles.filter(r => r !== role);
            state.companies.forEach(c => c.roles = c.roles.filter(r => r !== role));
            changed();
        }
    }
});
$('rows').addEventListener('input', e => {
    const field = e.target.dataset.field;
    if (!field)
        return;
    const co = state.companies.find(c => c.id === e.target.dataset.id);
    if (!co)
        return;
    co[field] = e.target.value;
    if (field === 'deadline') {
        const due = e.target.parentElement.querySelector('[data-due]');
        due.textContent = dueText(co.deadline);
        due.classList.toggle('late', days(co.deadline) < 0);
    }
    changed(false);
});
$('rows').addEventListener('change', e => {
    if (e.target.dataset.status) {
        const co = state.companies.find(c => c.id === e.target.dataset.status);
        co.status = e.target.value;
        e.target.className = 'inline-status ' + statusClass(co.status);
        if (co.status !== '未投' && !co.appliedAt) {
            co.appliedAt = today();
            e.target.closest('tr').querySelector('[data-field="appliedAt"]').value = co.appliedAt;
        }
        changed(false);
    }
    if (e.target.dataset.companyRole) {
        const co = state.companies.find(c => c.id === e.target.dataset.companyRole), role = state.roles[Number(e.target.dataset.roleIndex)];
        co.roles = co.roles.filter(r => r !== role);
        if (e.target.checked)
            co.roles.push(role);
        e.target.closest('details').querySelector('summary').innerHTML = roleSummary(co);
        changed(false);
    }
});
$('rows').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.new-role')) {
    e.preventDefault();
    e.target.parentElement.querySelector('button').click();
} });
for (const id of ['q', 'statusfilter', 'sort'])
    $(id).addEventListener(id === 'q' ? 'input' : 'change', render);
$('statusfilter').insertAdjacentHTML('beforeend', STATUSES.map(s => `<option>${s}</option>`).join(''));
$('expjson').onclick = () => backup();
$('expcsv').onclick = () => { const cell = value => '"' + (/^[=+\-@\t\r\n]/.test(String(value)) ? "'" : '') + String(value ?? '').replace(/"/g, '""') + '"'; const rows = [['公司', '岗位', '部门', '状态', '截止日期', '投递时间', '链接', '备注'], ...state.companies.map(c => [c.name, c.roles.join(' / '), c.dept, c.status, c.deadline, c.appliedAt, c.link, c.note])]; download('投递记录-' + today() + '.csv', '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8'); };
$('impjson').onclick = () => $('fileinput').click();
$('fileinput').onchange = async (e) => { const file = e.target.files[0]; e.target.value = ''; if (!file)
    return; try {
    if (file.size > 10 * 1024 * 1024)
        throw new Error('备份文件不能超过 10 MB');
    const incoming = normalize(JSON.parse(await file.text()));
    if (!confirm(`用备份中的 ${incoming.companies.length} 条记录替换当前 ${state.companies.length} 条记录？`))
        return;
    incoming.revision = state.revision;
    state = incoming;
    notice('已恢复备份，正在保存。');
    changed();
}
catch (error) {
    notice('恢复失败：' + error.message, true);
} };
$('recover').onclick = () => { if (!pending?.state)
    return; try {
    const restored = normalize(pending.state);
    if (!confirm('恢复此浏览器未同步的修改？若云端已更新，将保留修改并提示版本冲突。'))
        return;
    if (!('revision' in pending.state))
        restored.revision = state.revision;
    state = restored;
    $('recovery').hidden = true;
    pending = null;
    try {
        localStorage.removeItem('qiuzhao-cloud-recovery-v3');
    }
    catch { }
    changed();
}
catch (error) {
    notice(error.message, true);
} };
$('backup-pending').onclick = () => { if (pending?.state)
    backup(pending.state); };
$('reload').onclick = async () => { if (saving) {
    notice('正在保存，请稍后重新载入。');
    return;
} if (dirty && !confirm('重新载入会放弃当前未同步修改。建议先导出 JSON 备份，确定继续？'))
    return; clearTimeout(timer); try {
    await connect();
}
catch (error) {
    notice(error.message, true);
} };
$('login').onsubmit = async (e) => { e.preventDefault(); const button = e.target.querySelector('[type=submit]'); button.disabled = true; token = $('token').value; try {
    await connect();
    try {
        sessionStorage.setItem('qiuzhao-token', token);
    }
    catch { }
    $('token').value = '';
}
catch (error) {
    $('auth-error').textContent = error.message;
}
finally {
    button.disabled = false;
} };
$('auth').addEventListener('cancel', e => e.preventDefault());
$('local-mode').onclick = () => { mode = 'local'; token = ''; try {
    state = normalize(readStorage(cacheKey())?.state || readStorage('qiuzhao-tracker-v2') || emptyState());
}
catch {
    state = emptyState();
    notice('本地数据格式无效，请从备份文件恢复。', true);
} dirty = false; $('auth').close(); $('recovery').hidden = true; $('reload').hidden = true; $('storage-label').textContent = '仅存于此浏览器 · 记得定期备份'; flag('ok', '浏览器模式'); render(); };
$('lock').onclick = () => { if (saving) {
    notice('正在同步，请稍后退出。');
    return;
} if (dirty && !confirm('有未同步修改，已尝试暂存到浏览器。确定退出？'))
    return; clearTimeout(timer); if (dirty)
    cache(); try {
    sessionStorage.removeItem('qiuzhao-token');
}
catch { } token = ''; mode = 'locked'; dirty = false; state = emptyState(); notice(''); $('recovery').hidden = true; render(); flag('ok', '已退出'); $('auth').showModal(); };
let theme;
try {
    theme = localStorage.getItem('qiuzhao-theme');
}
catch { }
if (!theme)
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
function applyTheme() { document.documentElement.dataset.theme = theme; $('theme').textContent = theme === 'dark' ? '◐ 切换浅色' : '◐ 切换深色'; }
applyTheme();
$('theme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; applyTheme(); try {
    localStorage.setItem('qiuzhao-theme', theme);
}
catch { } };
window.addEventListener('beforeunload', e => { if (dirty || saving) {
    cache();
    e.preventDefault();
    e.returnValue = '';
} });
window.addEventListener('online', () => { if (dirty && !blocked)
    save(); });
$('today').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) + '  /  YOUR NEXT CHAPTER';
render();
$('auth').showModal();
try {
    token = sessionStorage.getItem('qiuzhao-token') || '';
}
catch { }
if (token)
    connect().catch(error => { $('auth-error').textContent = error.message; });
