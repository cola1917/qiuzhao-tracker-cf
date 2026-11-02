'use strict';
let selectedNote = null;
function normalizeNotes(raw, ids) {
    if(raw===undefined)return [];
    if(!Array.isArray(raw)||raw.length>1000||new TextEncoder().encode(JSON.stringify(raw)).length>1000000)throw new Error('面试笔记超过上限');
    const seen=new Set();
    return raw.map(n=>{
        if(!n||!n.id||!/^[a-zA-Z0-9_-]{1,100}$/.test(n.id)||seen.has(n.id)||!ids.has(n.companyId)||typeof n.eventId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(n.eventId)||!['一面','二面','三面'].includes(n.stage)||typeof n.meetingAt!=='string'||(n.meetingAt&&(!Number.isFinite(Date.parse(n.meetingAt))||new Date(n.meetingAt).toISOString()!==n.meetingAt))||typeof n.title!=='string'||n.title.length>200||typeof n.body!=='string'||n.body.length>20000||!['面经','复盘','碎碎念'].includes(n.category)||!Number.isSafeInteger(n.updatedAt)||n.updatedAt<0)throw new Error('面试笔记无效');
        seen.add(n.id);return {...n};
    });
}
// An interview keeps its anchor through scheduling, rescheduling and completion.
// A later attempt after cancellation gets a new anchor, even within the same round.
function interviewContext(event) {
    const events=(state.history||[]).filter(h=>h.companyId===event.companyId).slice().reverse().sort((a,b)=>a.recordedAt-b.recordedAt||a.at-b.at);
    let anchor=null,stage='',meetingAt='';
    for(const h of events){
        if(['status','baseline','created'].includes(h.kind)){anchor=h.id;stage=h.toStatus;meetingAt='';}
        if(isInterview(h.toStatus)&&['schedule','complete','cancel'].includes(h.kind)){
            if(!anchor||stage!==h.toStatus){anchor=h.id;stage=h.toStatus;}
            try{meetingAt=JSON.parse(h.detail).at||meetingAt;}catch{}
        }
        if(h.id===event.id)return {eventId:anchor||h.id,stage:h.toStatus,meetingAt};
        if(h.kind==='cancel')anchor=null;
    }
    return {eventId:event.id,stage:event.toStatus,meetingAt:''};
}
function noteAction(h) {
    if(!isInterview(h.toStatus)||!['baseline','created','status','schedule','complete','cancel'].includes(h.kind))return '';
    const anchor=interviewContext(h).eventId;
    const count=(state.notes||[]).filter(n=>n.companyId===h.companyId&&n.eventId===anchor).length;
    return `<button type="button" class="text-btn note-shortcut" data-write-note="${esc(h.id)}">＋ 写面试记录${count?` · 已有 ${count} 篇`:''}</button>`;
}
function notePreview(text) {
    // Escape HTML first; links only accept HTTP(S). Never render authored HTML.
    return text.split('\n').map(line=>{
        let body=esc(line).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
        body=body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
        if(body.startsWith('## '))return `<h4>${body.slice(3)}</h4>`;
        if(body.startsWith('- '))return `<div>• ${body.slice(2)}</div>`;
        if(body.startsWith('&gt; '))return `<blockquote>${body.slice(5)}</blockquote>`;
        return `<div>${body||'<br>'}</div>`;
    }).join('');
}
function renderNoteEditor(co) {
    const notes=(state.notes||[]).filter(n=>n.companyId===co.id).slice().sort((a,b)=>b.updatedAt-a.updatedAt);
    const n=notes.find(n=>n.id===selectedNote);
    const list=notes.length?`<div class="note-list">${notes.map(note=>`<button type="button" data-open-note="${esc(note.id)}" aria-pressed="${note.id===selectedNote}"><strong>${esc(note.title||'未命名记录')}</strong><small>${esc(note.stage)} · ${esc(note.category)}${note.meetingAt?' · '+esc(formatTime(note.meetingAt)):''}</small></button>`).join('')}</div>`:'<p class="quiet">在左侧面试历史旁点「写面试记录」，记下面经、复盘或碎碎念。</p>';
    if(!n)return `<section class="interview-notes"><h3>面试记录</h3>${list}</section>`;
    return `<section class="interview-notes"><h3>面试记录</h3>${list}<div class="note-editor" data-note-editor="${esc(n.id)}"><p class="note-association">关联：${esc(co.name)} · ${esc(n.stage)}${n.meetingAt?' · '+esc(formatTime(n.meetingAt)):' · 时间未记录'}</p><label>标题<input data-note-field="title" value="${esc(n.title)}" maxlength="200" placeholder="这次面试，想记点什么？"></label><label>类型<select data-note-field="category">${['面经','复盘','碎碎念'].map(c=>`<option${n.category===c?' selected':''}>${c}</option>`).join('')}</select></label><div class="note-tools" aria-label="文本格式">${[['bold','加粗'],['heading','标题'],['list','列表'],['quote','引用'],['link','链接']].map(([cmd,label])=>`<button type="button" class="btn" data-note-format="${cmd}">${label}</button>`).join('')}</div><label>正文<textarea data-note-field="body" maxlength="20000" rows="9" placeholder="面试问题、回答思路、感受、下一次要准备的内容…">${esc(n.body)}</textarea></label><small>自动保存 · 同步状态见页面右上角 · 支持 Markdown</small><details><summary>预览</summary><div class="note-preview" data-note-preview>${notePreview(n.body)}</div></details><button type="button" class="text-btn" data-close-note>收起编辑</button></div></section>`;
}
function updateNoteEditor(editor) {
    const n=(state.notes||[]).find(n=>n.id===editor.dataset.noteEditor);if(!n)return;
    for(const input of editor.querySelectorAll('[data-note-field]'))n[input.dataset.noteField]=input.value;
    n.updatedAt=Date.now();
    const label=document.querySelector(`[data-open-note="${n.id}"] strong`);
    if(label)label.textContent=n.title||'未命名记录';
    const co=state.companies.find(c=>c.id===n.companyId);if(co)touchCompany(co);
    editor.querySelector('[data-note-preview]').innerHTML=notePreview(n.body);
    changed(false);
}
function initInterviewNotes(){
    document.addEventListener('input',e=>{const editor=e.target.closest('[data-note-editor]');if(editor&&e.target.matches('[data-note-field]'))updateNoteEditor(editor);});
    document.addEventListener('change',e=>{const editor=e.target.closest('[data-note-editor]');if(editor&&e.target.matches('select[data-note-field]'))updateNoteEditor(editor);});
    document.addEventListener('click',e=>{
        const b=e.target.closest('button');if(!b)return;
        if(b.dataset.writeNote){
            const event=(state.history||[]).find(h=>h.id===b.dataset.writeNote);if(!event||!isInterview(event.toStatus))return;
            if((state.notes||[]).length>=1000){notice('最多保存 1000 篇面试笔记，请先备份整理。',true);return;}
            const n={id:crypto.randomUUID(),companyId:event.companyId,...interviewContext(event),title:'',body:'',category:'复盘',updatedAt:Date.now()};
            (state.notes??=[]).push(n);selectedNote=n.id;changed();
            document.querySelector('[data-note-field="title"]')?.focus();
        }
        if(b.dataset.openNote){selectedNote=b.dataset.openNote;renderTable();}
        if(b.hasAttribute('data-close-note')){selectedNote=null;renderTable();}
        if(b.dataset.noteFormat){
            const editor=b.closest('[data-note-editor]'),area=editor.querySelector('textarea');
            const selected=area.value.slice(area.selectionStart,area.selectionEnd);
            const formats={bold:`**${selected||'加粗文字'}**`,heading:`\n## ${selected||'小标题'}`,list:`\n- ${selected||'列表内容'}`,quote:`\n> ${selected||'引用内容'}`,link:`[${selected||'链接文字'}](https://)`};
            area.setRangeText(formats[b.dataset.noteFormat],area.selectionStart,area.selectionEnd,'select');area.focus();updateNoteEditor(editor);
        }
    });
}
