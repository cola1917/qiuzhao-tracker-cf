'use strict';
let openedCompany = null, lastDeletedCompany = null, historyLoading = new Set(), historyLoaded = new Set(), tableSortPending = false;
const emptyInterview = () => ({ phase: 'pending', at: '', location: '' });
const isInterview = status => ['一面', '二面', '三面'].includes(status);
const phaseName = co => !isInterview(co.status) ? '' : ({ pending: '待安排', scheduled: '已安排', feedback: '待反馈' }[co.interview?.phase || 'pending']);
const formatTime = time => time ? new Date(time).toLocaleString('zh-CN', { month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false }) : '';
const timeInput = time => { if (!time) return ''; const d=new Date(time); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
function normalizeCompanyExtras(co, original, deleted) {
    co.starred = original.starred ?? false;
    co.deletedAt = deleted ? original.deletedAt || Date.now() : 0;
    if (typeof co.starred !== 'boolean' || !Number.isSafeInteger(co.deletedAt) || co.deletedAt < 0) throw new Error('星标或删除时间无效');
    const m = original.interview ?? emptyInterview();
    if (!m || !['pending','scheduled','feedback'].includes(m.phase) || typeof m.at !== 'string' || typeof m.location !== 'string' || m.location.length>2000 || (m.phase!=='pending' && (!Number.isFinite(Date.parse(m.at)) || new Date(m.at).toISOString()!==m.at)) || (m.phase==='pending' && m.at!=='')) throw new Error('面试安排无效');
    co.interview = {...m};
}
function normalizeHistory(raw, ids) {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length>20000) throw new Error('历史数据无效');
    const seen=new Set();
    return raw.map(h=>{
        if(!h || !/^[a-zA-Z0-9_-]{1,100}$/.test(h.id) || seen.has(h.id) || !ids.has(h.companyId) || !['baseline','created','status','schedule','complete','cancel','restore'].includes(h.kind) || !Number.isSafeInteger(h.at) || h.at<0 || !Number.isFinite(new Date(h.at).getTime()) || !Number.isSafeInteger(h.recordedAt) || typeof h.detail!=='string' || h.detail.length>5000 || typeof h.fromStatus!=='string' || typeof h.toStatus!=='string') throw new Error('历史数据无效');
        seen.add(h.id);return {...h};
    });
}
function addLocalHistory(co, kind, fromStatus='', detail='') {
    state.history ??= [];
    const now=Date.now();
    const h={id:crypto.randomUUID(),companyId:co.id,kind,fromStatus,toStatus:co.status,detail,at:now,recordedAt:now};
    state.history.unshift(h);
    if(mode==='server')(state.activity??=[]).push(h);
}
function historyTitle(h) {
    if(h.kind==='status') return `${h.fromStatus} → ${h.toStatus}`;
    if(h.kind==='baseline') return `历史记录启用时的状态 · ${h.toStatus}`;
    if(h.kind==='created') return `创建记录 · ${h.toStatus}`;
    if(h.kind==='restore') return '从回收站恢复';
    let info;try{info=JSON.parse(h.detail);}catch{info={};}
    if(h.kind==='complete') return `${h.toStatus}已完成 · 等待反馈`;
    if(h.kind==='cancel') return `取消原面试安排 · ${formatTime(info.at)}`;
    return info.previousAt ? `面试改期：${formatTime(info.previousAt)} → ${formatTime(info.at)}` : `安排${h.toStatus}：${formatTime(info.at)}`;
}
function historyMarkup(id) {
    const list=(state.history || []).filter(h=>h.companyId===id).sort((a,b)=>b.at-a.at || b.recordedAt-a.recordedAt);
    if(!list.length) return `<p class="quiet">${mode==='server' ? (historyLoaded.has(id)?'暂无历史，保存变更后将自动记录。':'正在载入历史…') : '从下一次进度变更开始记录。'}</p>`;
    return `<ol class="history-list">${list.map(h=>`<li><div class="history-title">${historyTitleMarkup(h)}</div><div class="history-meta">${esc(formatTime(h.at))} · ${['status','created','baseline'].includes(h.kind)?'阶段进展':'面试安排'}${['status','created','baseline'].includes(h.kind)?` <button type="button" class="text-btn" data-correct="${esc(h.id)}">修正时间</button>`:''}</div></li>`).join('')}</ol>`;
}
function historyTitleMarkup(h) {
    const stage=(value,current=false)=>`<strong class="history-stage${current?' history-stage-current':''}">${esc(value)}</strong>`;
    if(h.kind==='status')return `${stage(h.fromStatus)}<span class="history-arrow" aria-label="变为">→</span>${stage(h.toStatus,true)}`;
    if(h.kind==='baseline')return `${stage(h.toStatus,true)}<span class="history-context">历史记录启用时的状态</span>`;
    if(h.kind==='created')return `${stage(h.toStatus,true)}<span class="history-context">创建记录</span>`;
    if(h.kind==='complete')return `${stage(h.toStatus)}<span class="history-context">已完成 · 等待反馈</span>`;
    if(h.kind==='schedule'){
        let info;try{info=JSON.parse(h.detail);}catch{info={};}
        return `${stage(h.toStatus,true)}<span>${info.previousAt?'改期：'+esc(formatTime(info.previousAt))+' → ':'安排：'}${esc(formatTime(info.at))}</span>`;
    }
    return esc(historyTitle(h));
}
async function loadHistory(id,force=false) {
    if(mode!=='server' || historyLoading.has(id) || (!force && historyLoaded.has(id))) return;
    historyLoading.add(id);
    const context=state,revision=state.revision;let reload=false;
    try {
        const result=await api('history/'+encodeURIComponent(id));
        if(context!==state||mode!=='server')return;
        if(revision!==state.revision){reload=true;return;}
        const ids=new Set([...state.companies,...(state.trash||[])].map(c=>c.id));
        const incoming=normalizeHistory(result.history,ids);
        const events=new Map(incoming.map(h=>[h.id,h]));
        for(const h of state.activity||[])if(h.companyId===id)events.set(h.id,h);
        state.history=(state.history||[]).filter(h=>h.companyId!==id).concat([...events.values()]);
        for(const edit of state.historyEdits||[]){const h=state.history.find(h=>h.id===edit.id);if(h)h.at=edit.at;}
        historyLoaded.add(id);
        const node=document.querySelector(`[data-history-list="${id}"]`);
        if(node) node.innerHTML=historyMarkup(id);
        cache();
    } catch(error) {
        const node=document.querySelector(`[data-history-list="${id}"]`);
        if(node) node.innerHTML=`<p class="quiet">${esc(error.message)} <button type="button" class="text-btn" data-history-retry="${esc(id)}">重试</button></p>`;
    } finally {historyLoading.delete(id);if(reload&&context===state)loadHistory(id,true);}
}
function renderMeetingCell(co) {
    if(!isInterview(co.status))return '<span class="quiet">—</span>';
    const m=co.interview||emptyInterview();
    return m.phase==='pending' ? `<button type="button" class="add-meeting" data-meeting="${esc(co.id)}">＋ 添加时间</button>` : `<button type="button" class="meeting-date" data-meeting="${esc(co.id)}"><strong>${esc(formatTime(m.at))}</strong><small>${m.phase==='feedback'?'已完成 · 等待反馈':esc(m.location||'地点待补充')}</small></button>`;
}
function renderMeetingTime(id, value='') {
    const hours=Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')+':00');
    const original=value && !hours.includes(value) ? `<option value="${esc(value)}" selected hidden>原时间 ${esc(value)}</option>` : '';
    return `<select data-meeting-time="${esc(id)}" required><option value="" disabled${value?'':' selected'}>选择整点</option>${original}${hours.map(hour=>`<option value="${hour}"${value===hour?' selected':''}>${hour}</option>`).join('')}</select>`;
}
function renderCompanyDetails(co) {
    const m=co.interview||emptyInterview(), local=timeInput(m.at), id=esc(co.id);
    const form=isInterview(co.status)?`<div class="meeting-phase">${esc(co.status)} · ${phaseName(co)}</div><div class="meeting-fields"><label>面试日期<input type="date" data-meeting-date="${id}" value="${local.slice(0,10)}" required></label><label>时间${renderMeetingTime(co.id,local.slice(11))}</label><label class="meeting-location">会议链接 / 地点<input data-meeting-location="${id}" value="${esc(m.location)}" placeholder="稍后补充也可以" maxlength="2000"></label></div><div class="meeting-actions"><button type="button" class="btn primary" data-save-meeting="${id}">${m.phase==='scheduled'?'保存安排':'确认面试时间'}</button>${m.phase==='scheduled'?`<button type="button" class="btn" data-complete-meeting="${id}">标记已完成</button>`:''}${m.at?`<button type="button" class="text-btn" data-cancel-meeting="${id}">取消安排</button>`:''}</div><p class="meeting-help">先记录阶段进展，面试时间可以稍后补充。</p>`:'<p class="quiet">进入面试阶段后，可在此补充面试时间。</p>';
    return `<tr class="company-details"><td colspan="7"><div class="details-grid"><section><div class="section-title"><h3>进展时间线</h3><span>最新在前</span></div><div data-history-list="${id}">${historyMarkup(co.id)}</div></section><section class="meeting-form"><h3>面试安排</h3>${form}</section></div></td></tr>`;
}
function renderAgenda() {
    const node=$('agenda');if(!node)return;
    const upcoming=state.companies.filter(c=>isInterview(c.status) && c.interview?.phase==='scheduled' && Date.parse(c.interview.at)>=Date.now()-86400000).sort((a,b)=>a.interview.at.localeCompare(b.interview.at));
    const pending=state.companies.filter(c=>isInterview(c.status) && (!c.interview || c.interview.phase==='pending'));
    node.innerHTML=(upcoming.slice(0,3).map(c=>`<button type="button" data-meeting="${esc(c.id)}"><strong>${esc(formatTime(c.interview.at))}</strong>　${esc(c.name||'未命名公司')} · ${esc(c.status)}<small>${esc(c.interview.location||'地点待补充')}</small></button>`).join('')||'<span class="quiet">暂无已确定的面试安排</span>')+(pending.length?`<button type="button" data-meeting="${esc(pending[0].id)}">${pending.length} 场面试待安排<small>已进入下一轮，时间待补充 →</small></button>`:'');
}
function featureToast(message,undo=false) {$('feature-toast').hidden=false;$('toast-message').textContent=message;$('undo-delete').hidden=!undo;}
function moveToTrash(co) {
    if((state.trash||[]).length>=2000){notice('回收站已达到 2000 条上限，请先备份数据。',true);return;}
    state.companies=state.companies.filter(c=>c.id!==co.id);co.deletedAt=Date.now();(state.trash??=[]).unshift(co);lastDeletedCompany=co.id;
    if(openedCompany===co.id)openedCompany=null;
    changed();featureToast(`已将「${co.name||'新投递'}」移入回收站`,true);
}
function restoreCompany(id) {
    if(state.companies.length>=2000){notice('最多保存 2000 条投递。',true);return;}
    const co=(state.trash||[]).find(c=>c.id===id);if(!co)return;
    if(state.companies.some(c=>c.name.trim()===co.name.trim()) && !confirm(`列表中已有「${co.name}」，仍恢复为另一条记录？`))return;
    const roles=[...new Set([...state.roles,...co.roles])];if(roles.length>200){notice('恢复后的岗位将超过 200 个，请先整理岗位。',true);return;}
    state.roles=roles;state.trash=state.trash.filter(c=>c.id!==id);co.deletedAt=0;touchCompany(co);state.companies.unshift(co);addLocalHistory(co,'restore');changed();renderTrash();featureToast(`已恢复「${co.name||'新投递'}」，星标和历史已保留`);
}
function renderTrash() {
    $('trash-list').innerHTML=(state.trash||[]).length?state.trash.slice().sort((a,b)=>b.deletedAt-a.deletedAt).map(c=>`<li><div>${esc(c.name||'未命名公司')}${c.starred?' ★':''}<small>${esc(c.status)} · ${esc(formatTime(c.deletedAt))} 删除</small></div><button type="button" class="btn" data-restore-company="${esc(c.id)}">恢复</button></li>`).join(''):'<li class="quiet">回收站为空</li>';
}
function parseBulkCompanies(text, companies=state.companies, trash=state.trash||[]) {
    const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean), names=[...new Set(lines)];
    return {duplicates:lines.length-names.length,items:names.map(name=>({name,existing:companies.find(c=>c.name.trim()===name),deleted:trash.find(c=>c.name.trim()===name)}))};
}
function renderBulkPreview() {
    const result=parseBulkCompanies($('bulk-text').value), include=$('bulk-duplicates').checked, count=result.items.filter(c=>include||!c.existing&&!c.deleted).length;
    $('bulk-summary').textContent=`识别 ${result.items.length} 家 · ${count} 家可新增${result.duplicates?` · 已去除 ${result.duplicates} 个输入重复项`:''}${count>100?' · 每次最多 100 家':''}`;
    $('bulk-preview').innerHTML=result.items.slice(0,8).map(c=>`<li><span>${c.existing||c.deleted?'!':'✓'}　${esc(c.name)}</span>${c.existing?`<small>已有记录 · ${esc(c.existing.status)}</small>`:c.deleted?`<button type="button" class="text-btn" data-restore-company="${esc(c.deleted.id)}">在回收站 · 恢复</button>`:'<small>新增 · 未投</small>'}</li>`).join('')+(result.items.length>8?`<li class="quiet">另有 ${result.items.length-8} 家</li>`:'');
    $('bulk-confirm').textContent=`新增 ${count} 条`;$('bulk-confirm').disabled=!count||count>100||state.companies.length+count>2000;
}
function newCompany(name='') {return {id:crypto.randomUUID(),name,link:'',deadline:'',appliedAt:'',roles:[],dept:'',status:'未投',note:'',starred:false,deletedAt:0,interview:emptyInterview()};}
function resetFilters() {view='all';$('q').value='';$('statusfilter').value='';$('starfilter').checked=false;$('sort').value='added';document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view==='all'));}
async function openCompany(id) {
    openedCompany=id;resetFilters();render();
    document.querySelector(`[data-row="${id}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest'});
    await loadHistory(id);
}
function buildSnapshot() {const result=copy(state);delete result.history;delete result.restoreHistory;return result;}
function initWorkbenchFeatures() {
    $('starfilter').onchange=render;
    $('bulk-open').onclick=()=>{if(mode==='loading')return;document.querySelector('.add-menu').open=false;$('bulk-dialog').showModal();renderBulkPreview();$('bulk-text').focus();};
    $('bulk-text').oninput=renderBulkPreview;$('bulk-duplicates').onchange=renderBulkPreview;
    $('bulk-confirm').onclick=()=>{
        const names=parseBulkCompanies($('bulk-text').value).items.filter(c=>$('bulk-duplicates').checked||!c.existing&&!c.deleted).map(c=>c.name);
        if(!names.length||names.length>100||state.companies.length+names.length>2000||names.some(n=>n.length>2000)){notice('每次最多 100 家，公司名称不超过 2000 字。',true);return;}
        const batch=names.map(name=>newCompany(name)), at=Math.max(Date.now(),...state.companies.map(c=>(c.updatedAt||0)+1));
        batch.forEach(co=>{co.updatedAt=at;addLocalHistory(co,'created');});state.companies.unshift(...batch);openedCompany=null;resetFilters();changed();$('bulk-dialog').close();$('bulk-text').value='';featureToast(`已新增 ${batch.length} 家公司，保持粘贴顺序`);
    };
    $('trash-open').onclick=()=>{if(mode==='loading')return;document.querySelector('.data-menu:not(.add-menu)').open=false;renderTrash();$('trash-dialog').showModal();};
    $('undo-delete').onclick=()=>{if(lastDeletedCompany)restoreCompany(lastDeletedCompany);lastDeletedCompany=null;};
    $('toast-close').onclick=()=>$('feature-toast').hidden=true;
    document.addEventListener('click',async e=>{
        if(!e.target.closest('.data-menu'))document.querySelectorAll('.data-menu').forEach(menu=>menu.open=false);
        const b=e.target.closest('button');if(!b)return;const d=b.dataset;
        if(d.closeDialog)$(d.closeDialog).close();
        if(d.star){const co=state.companies.find(c=>c.id===d.star);co.starred=!co.starred;changed();}
        if(d.history){openedCompany=openedCompany===d.history?null:d.history;renderTable();if(openedCompany)await loadHistory(openedCompany);}
        if(d.historyRetry)await loadHistory(d.historyRetry,true);
        if(d.meeting)await openCompany(d.meeting);
        if(d.restoreCompany){restoreCompany(d.restoreCompany);if($('bulk-dialog').open)renderBulkPreview();}
        if(d.saveMeeting){
            const co=state.companies.find(c=>c.id===d.saveMeeting), date=document.querySelector(`[data-meeting-date="${co.id}"]`), time=document.querySelector(`[data-meeting-time="${co.id}"]`), location=document.querySelector(`[data-meeting-location="${co.id}"]`);
            if(!date.reportValidity()||!time.reportValidity())return;
            const at=new Date(date.value+'T'+time.value);if(!Number.isFinite(at.getTime()))return;
            const next={phase:'scheduled',at:at.toISOString(),location:location.value.trim()};if(JSON.stringify(next)===JSON.stringify(co.interview))return;
            addLocalHistory(co,'schedule','',JSON.stringify({...next,previousAt:co.interview?.at||''}));co.interview=next;touchCompany(co);changed();featureToast('面试安排已保存，近期安排同步更新');
        }
        if(d.completeMeeting){const co=state.companies.find(c=>c.id===d.completeMeeting);co.interview.phase='feedback';addLocalHistory(co,'complete','',JSON.stringify(co.interview));touchCompany(co);changed();}
        if(d.cancelMeeting){const co=state.companies.find(c=>c.id===d.cancelMeeting);addLocalHistory(co,'cancel','',JSON.stringify(co.interview));co.interview=emptyInterview();touchCompany(co);changed();}
        if(d.correct){const h=(state.history||[]).find(h=>h.id===d.correct);if(!h)return;$('feedback-event').value=h.id;$('feedback-time').value=timeInput(h.at);$('feedback-dialog').showModal();}
    });
    $('feedback-save').onclick=()=>{
        if(!$('feedback-time').reportValidity())return;const h=state.history.find(h=>h.id===$('feedback-event').value);if(!h)return;
        const at=new Date($('feedback-time').value).getTime();if(!Number.isSafeInteger(at))return;
        h.at=at;state.historyEdits=(state.historyEdits||[]).filter(e=>e.id!==h.id);state.historyEdits.push({id:h.id,at});const co=state.companies.find(c=>c.id===h.companyId);if(co)touchCompany(co);changed();$('feedback-dialog').close();
    };
}
