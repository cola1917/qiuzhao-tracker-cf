'use strict';
let selectedNote = null, currentPage = 'workbench', editingReviewNote = null, newReviewFormOpen = false;
let reviewFilter = { q: '', category: '', stage: '', keyword: '', sort: 'newest' };
let aiTopicsState = { fingerprint: '', loading: false, topics: null, summary: '', model: '', error: '' }, aiTimer = null;

const TOPIC_CLUSTERS = [
    { word: 'Pipeline 组件通信', patterns: ['pipeline', '组件如何交流', '组件交流', '组件通信', '模块通信', '模块间通信', '数据流', '消息传递', '上下游接口'] },
    { word: '项目与底层细节', patterns: ['了解细节', '实现细节', '底层细节', '技术细节', '细节深挖', '原理细节', '工程细节', '考察细节', '项目熟悉程度', '项目熟悉度', '项目细节', '项目深挖', '细节'] },
    { word: '技术路线对比', patterns: ['路线优劣', '技术路线', '方案对比', '方案优劣', '路线选择', '方案选型'] },
    { word: 'Sim2Real 与仿真评测', patterns: ['sim2real', '仿真评测', '迁移误差', '数据合成', '仿真闭环', 'isaac', 'mujoco', '真机部署'] },
    { word: '3DGS 与三维重建', patterns: ['3dgs', 'nerf', '三维重建', '点云', '多视图', 'slam', '空间感知', '视觉定位'] },
    { word: 'VLA 与具身算法', patterns: ['vla', '多模态', '具身智能', '动作生成', 'diffusion', '扩散模型', '强化学习', '模仿学习'] },
    { word: '算子与推理优化', patterns: ['算子', 'cuda', 'tensorrt', '端侧部署', '量化', '推理加速', '内存布局', '内存优化', '性能优化'] },
    { word: '多线程与实时通信', patterns: ['多线程', '并发', '实时性', '延迟控制', '通信延迟', '锁机制', '异步', '状态机', 'ros'] },
    { word: '代码手撕与算法题', patterns: ['手撕', 'leetcode', '滑动窗口', '动态规划', '二叉树', '双指针', '图论', '编程题'] },
    { word: 'C++ 与八股基础', patterns: ['c++', '八股', '虚函数', '智能指针', '内存管理', '操作系统', '计算机网络'] }
];

const STOP_WORDS = new Set([
    'http', 'https', 'com', 'cn', 'net', 'org', 'www', 'html', 'feishu', 'hire', 'short_url',
    '一面', '二面', '三面', '复盘', '面经', '碎碎念', '面试', '记录', '未命名',
    '要了解', '需要了解', '了解', '同时', '如何', '以及', '还要', '注意', '需要', '不能', '不要', '怎么', '关于', '强化', '加强', '掌握', '熟悉',
    '算法', '流程', '算法面试', '面试流程', '通了', '也不行', '不行', '可以', '没有', '问题', '回答', '感觉', '今天', '这次'
]);

const ACTION_PREFIX = /^(?:(?:\d+[.、)）]|[-•*])\s*)*(?:需要深挖|需要了解|要了解|需要掌握|需要熟悉|需要补充|重点了解|重点复习|追问了|考察了|问到了|问了|同时要|同时|还需要|还要|强化|加强|补充|了解|掌握|熟悉|复习|关于)\s*/i;
const NARRATIVE_NOISE = /(?:也不行|通了|没答上来|感觉一般|再接再厉|加油|准备一下|差不多)$/;

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
    const sameRound=(state.history||[]).filter(item=>item.companyId===h.companyId&&isInterview(item.toStatus)&&['baseline','created','status','schedule','complete','cancel'].includes(item.kind)&&interviewContext(item).eventId===anchor).sort((a,b)=>b.at-a.at||b.recordedAt-a.recordedAt);
    if(sameRound.length&&sameRound[0].id!==h.id)return '';
    const count=(state.notes||[]).filter(n=>n.companyId===h.companyId&&n.eventId===anchor).length;
    return `<button type="button" class="text-btn note-shortcut" data-write-note="${esc(h.id)}">${count?`查看 / 编辑面试记录 · 已有 ${count} 篇`:'＋ 写面试记录'}</button>`;
}
function highlightSafeHtml(html, terms) {
    const list=(Array.isArray(terms)?terms:[terms]).map(t=>String(t||'').trim()).filter(Boolean);
    if(!list.length)return html;
    const escaped=list.map(t=>esc(t).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).filter(Boolean).sort((a,b)=>b.length-a.length);
    if(!escaped.length)return html;
    const regex=new RegExp(`(${escaped.join('|')})`,'gi');
    return html.split(/(<[^>]+>)/g).map(part=>part.startsWith('<')?part:part.replace(regex,'<mark class="kw-mark">$1</mark>')).join('');
}
function notePreview(text, highlightTerms='') {
    // Escape HTML first; links only accept HTTP(S). Never render authored HTML.
    const rendered=String(text??'').split('\n').map(line=>{
        let body=esc(line).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
        body=body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
        if(body.startsWith('## '))return `<h4>${body.slice(3)}</h4>`;
        if(body.startsWith('- '))return `<div>• ${body.slice(2)}</div>`;
        if(body.startsWith('&gt; '))return `<blockquote>${body.slice(5)}</blockquote>`;
        return `<div>${body||'<br>'}</div>`;
    }).join('');
    return highlightTerms ? highlightSafeHtml(rendered, highlightTerms) : rendered;
}
function renderNoteEditor(co) {
    const notes=(state.notes||[]).filter(n=>n.companyId===co.id).slice().sort((a,b)=>b.updatedAt-a.updatedAt);
    const n=notes.find(n=>n.id===selectedNote);
    const addBtn=(isInterview(co.status)||notes.length)?`<button type="button" class="text-btn note-add-inline" data-new-company-note="${esc(co.id)}">＋ 新增记录</button>`:'';
    const head=`<div class="section-title"><h3>面试记录</h3>${addBtn}</div>`;
    const list=notes.length?`<div class="note-list">${notes.map(note=>`<button type="button" data-open-note="${esc(note.id)}" aria-pressed="${note.id===selectedNote}"><strong>${esc(note.title||'未命名记录')}</strong><small>${esc(note.stage)} · ${esc(note.category)}${note.meetingAt?' · '+esc(formatTime(note.meetingAt)):''}</small></button>`).join('')}</div>`:'<p class="quiet">在左侧面试历史旁点「写面试记录」，记下面经、复盘或碎碎念。</p>';
    if(!n)return `<section class="interview-notes">${head}${list}</section>`;
    return `<section class="interview-notes">${head}${list}${noteEditorMarkup(n, co, false)}</section>`;
}
function noteEditorMarkup(n, co, inReviews=false) {
    const companyName=co?co.name:'未知公司';
    return `<div class="note-editor" data-note-editor="${esc(n.id)}"><p class="note-association">关联：${esc(companyName)} · ${esc(n.stage)}${n.meetingAt?' · '+esc(formatTime(n.meetingAt)):' · 时间未记录'}</p><div class="note-editor-row"><label>标题<input data-note-field="title" value="${esc(n.title)}" maxlength="200" placeholder="这次面试，想记点什么？"></label><label>类型<select data-note-field="category">${['面经','复盘','碎碎念'].map(c=>`<option${n.category===c?' selected':''}>${c}</option>`).join('')}</select></label></div><div class="note-tools" aria-label="文本格式">${[['bold','加粗'],['heading','标题'],['list','列表'],['quote','引用'],['link','链接']].map(([cmd,label])=>`<button type="button" class="btn" data-note-format="${cmd}">${label}</button>`).join('')}</div><label>正文<textarea data-note-field="body" maxlength="20000" rows="9" placeholder="面试问题、回答思路、感受、下一次要准备的内容…（用 **加粗** 标记重点会提炼到复盘页顶部）">${esc(n.body)}</textarea></label><small>自动保存 · 同步状态见页面右上角 · 支持 Markdown 与 **重点提取**</small><details${inReviews?' open':''}><summary>预览</summary><div class="note-preview" data-note-preview>${notePreview(n.body, activeHighlightTerms())}</div></details><div class="note-editor-foot"><div class="note-editor-actions"><button type="button" class="text-btn" data-close-note>${inReviews?'完成编辑':'收起编辑'}</button>${!inReviews?`<button type="button" class="text-btn" data-open-reviews="${esc(n.id)}">在复盘页查看 ↗</button>`:''}</div><button type="button" class="text-btn danger" data-delete-note="${esc(n.id)}">删除记录</button></div></div>`;
}
function deleteNote(id) {
    const n=(state.notes||[]).find(note=>note.id===id);if(!n)return false;
    const hasContent=!!(n.title.trim()||n.body.trim());
    if(hasContent && typeof confirm==='function' && !confirm(`确定删除面试记录「${n.title||'未命名记录'}」吗？`))return false;
    state.notes=(state.notes||[]).filter(note=>note.id!==id);
    if(selectedNote===id)selectedNote=null;
    if(editingReviewNote===id)editingReviewNote=null;
    const co=state.companies.find(c=>c.id===n.companyId);if(co)touchCompany(co);
    changed();
    if(typeof featureToast==='function')featureToast(`已删除面试记录「${n.title||'未命名记录'}」`);
    return true;
}
function extractHighlights(notes=state.notes||[]) {
    const companyMap=new Map([...(state.companies||[]),...(state.trash||[])].map(c=>[c.id,c]));
    const items=[], seen=new Set();
    const sorted=notes.slice().sort((a,b)=>b.updatedAt-a.updatedAt);
    for(const n of sorted){
        const co=companyMap.get(n.companyId);
        const addItem=raw=>{
            const text=String(raw||'').trim().replace(/\s+/g,' ');
            if(text.length<3||seen.has(text))return;
            seen.add(text);
            items.push({noteId:n.id,companyId:n.companyId,companyName:co?.name||'未命名公司',stage:n.stage,category:n.category,text,updatedAt:n.updatedAt});
        };
        const boldMatches=[...String(n.body||'').matchAll(/\*\*([^*]+)\*\*/g)];
        for(const m of boldMatches)addItem(m[1]);
        if(!boldMatches.length){
            for(const line of String(n.body||'').split(/\r?\n/)){
                const cleaned=line.replace(/^\s*(?:\d+[.、)）]|[-•*])\s*/,'').trim();
                if(cleaned.length>=4&&cleaned.length<=60)addItem(cleaned);
            }
        }
    }
    return items;
}
function extractHotKeywords(notes=state.notes||[]) {
    const stats=new Map();
    const findCluster=phrase=>{
        const lower=phrase.toLowerCase();
        return TOPIC_CLUSTERS.find(c=>c.word.toLowerCase()===lower || c.patterns.some(p=>lower.includes(p.toLowerCase())||p.toLowerCase().includes(lower)&&lower.length>=3));
    };
    const addTopic=(word, alias, noteId, isBold=false)=>{
        const cleaned=String(word||'').trim();
        if(cleaned.length<2||cleaned.length>16)return;
        const key=cleaned.toLowerCase();
        if(STOP_WORDS.has(cleaned)||STOP_WORDS.has(key)||NARRATIVE_NOISE.test(cleaned)||/^\d+$/.test(key))return;
        const entry=stats.get(key)||{word:cleaned,aliases:new Set([cleaned]),notes:new Set(),score:0,bold:false};
        if(alias)entry.aliases.add(alias);
        entry.notes.add(noteId);
        entry.score+=isBold?2:1;
        if(isBold)entry.bold=true;
        stats.set(key,entry);
    };
    for(const n of notes){
        const full=`${n.title||''}\n${n.body||''}`.replace(/https?:\/\/[^\s)]+/g,' ');
        const lower=full.toLowerCase();
        const boldSpans=[...String(n.body||'').matchAll(/\*\*([^*]+)\*\*/g)].map(m=>m[1].toLowerCase());
        const coveredRanges=[];
        // 1. Semantic clusters: consolidate synonymous terms into a single canonical topic
        for(const cluster of TOPIC_CLUSTERS){
            const matched=cluster.patterns.filter(p=>lower.includes(p.toLowerCase()));
            if(matched.length){
                const inBold=matched.some(p=>boldSpans.some(b=>b.includes(p.toLowerCase())));
                for(const m of matched){
                    coveredRanges.push(m.toLowerCase());
                    addTopic(cluster.word, m, n.id, inBold);
                }
            }
        }
        // 2. Explicit #tags
        for(const m of full.matchAll(/#([\u4e00-\u9fa5a-zA-Z0-9_+-]{2,16})/g)){
            addTopic(m[1], m[1], n.id, true);
            coveredRanges.push(m[1].toLowerCase());
        }
        // 3. Clause-level extraction for numbered/bulleted items and comma-separated phrases (e.g., "1. 需要了解 路线优劣， 规划数据， ego数据，动捕数据")
        const rawSegments=String(n.body||'').replace(/\*\*/g,'').split(/[\r\n，,、；;。！？!?]+/);
        for(const seg of rawSegments){
            let phrase=seg.trim();
            while(ACTION_PREFIX.test(phrase))phrase=phrase.replace(ACTION_PREFIX,'').trim();
            phrase=phrase.replace(/^(?:的|了|和|与|及|或)\s*/,'').replace(/\s*(?:等|等等|方面|问题|部分)$/,'').trim();
            if(phrase.length<2||phrase.length>12||STOP_WORDS.has(phrase)||STOP_WORDS.has(phrase.toLowerCase())||NARRATIVE_NOISE.test(phrase))continue;
            const cluster=findCluster(phrase);
            const inBold=boldSpans.some(b=>b.includes(phrase.toLowerCase()));
            if(cluster){
                addTopic(cluster.word, phrase, n.id, inBold);
            }else if(!coveredRanges.some(c=>c.includes(phrase.toLowerCase())||phrase.toLowerCase().includes(c))){
                addTopic(phrase, phrase, n.id, inBold);
                coveredRanges.push(phrase.toLowerCase());
            }
        }
        // 4. Standalone technical English/mixed terms not yet part of a phrase (e.g., "ego数据" stays "ego数据", not split into "ego")
        for(const m of full.matchAll(/[a-zA-Z][a-zA-Z0-9+#._-]{1,16}[\u4e00-\u9fa5]{0,4}/g)){
            const term=m[0].trim();
            const tLower=term.toLowerCase();
            if(coveredRanges.some(c=>c.includes(tLower)||tLower.includes(c)))continue;
            addTopic(term, term, n.id, boldSpans.some(b=>b.includes(tLower)));
        }
    }
    return [...stats.values()].map(e=>({
        word:e.word,
        aliases:[...e.aliases],
        noteIds:[...e.notes],
        count:e.notes.size,
        bold:e.bold,
        score:e.score+e.notes.size*3
    })).sort((a,b)=>b.count-a.count||b.score-a.score||a.word.localeCompare(b.word,'zh')).slice(0,15);
}
function notesFingerprint(notes=state.notes||[]) {
    const active=notes.filter(n=>(n.title||'').trim()||(n.body||'').trim()).slice().sort((a,b)=>a.id.localeCompare(b.id));
    if(!active.length)return '';
    return active.map(n=>`${n.id}:${(n.title||'').trim()}:${(n.body||'').trim()}`).join('|');
}
function loadCachedAiTopics(fp) {
    if(!fp)return false;
    try{
        const cached=JSON.parse(localStorage.getItem('qiuzhao-ai-topics-v1')||'null');
        if(cached&&cached.fingerprint===fp&&Array.isArray(cached.topics)&&cached.topics.length){
            aiTopicsState={fingerprint:fp,loading:false,topics:cached.topics,summary:cached.summary||'',model:cached.model||'Workers AI',error:''};
            return true;
        }
    }catch{}
    return false;
}
function scheduleAiTopics() {
    clearTimeout(aiTimer);
    aiTimer=setTimeout(()=>{if(currentPage==='reviews')requestAiTopics(false);},1500);
}
async function requestAiTopics(force=false) {
    const notes=(state.notes||[]).filter(n=>(n.title||'').trim()||(n.body||'').trim());
    const fp=notesFingerprint(notes);
    if(!fp){aiTopicsState={fingerprint:'',loading:false,topics:null,summary:'',model:'',error:''};return;}
    if(!force && (aiTopicsState.loading || aiTopicsState.fingerprint===fp || loadCachedAiTopics(fp)))return;
    if(mode!=='server')return;
    aiTopicsState.loading=true;aiTopicsState.error='';
    const hw=typeof document.querySelector==='function'?document.querySelector('[data-hotwords-container]'):null;
    if(hw)hw.innerHTML=renderHotwordsSection();
    try{
        const existing=(aiTopicsState.topics||extractHotKeywords(notes)).map(t=>t.word);
        const result=await api('ai/topics',{method:'POST',body:JSON.stringify({notes,existingTopics:existing})});
        if(Array.isArray(result.topics)&&result.topics.length){
            aiTopicsState={fingerprint:fp,loading:false,topics:result.topics,summary:result.summary||'',model:result.model||'Workers AI',error:''};
            try{localStorage.setItem('qiuzhao-ai-topics-v1',JSON.stringify(aiTopicsState));}catch{}
        }else{
            aiTopicsState.loading=false;aiTopicsState.fingerprint=fp;
        }
    }catch(err){
        aiTopicsState.loading=false;aiTopicsState.error=err.message||'AI 提炼暂不可用';
    }
    const nextHw=typeof document.querySelector==='function'?document.querySelector('[data-hotwords-container]'):null;
    if(nextHw)nextHw.innerHTML=renderHotwordsSection();
}
function currentTopics(notes=state.notes||[]) {
    const fp=notesFingerprint(notes);
    if(!fp)return [];
    if(aiTopicsState.fingerprint!==fp)loadCachedAiTopics(fp);
    if(aiTopicsState.fingerprint===fp&&Array.isArray(aiTopicsState.topics)&&aiTopicsState.topics.length)return aiTopicsState.topics;
    return extractHotKeywords(notes);
}
function activeHighlightTerms() {
    if(!reviewFilter.keyword && !reviewFilter.q.trim())return '';
    const terms=[];
    if(reviewFilter.q.trim())terms.push(reviewFilter.q.trim());
    if(reviewFilter.keyword){
        const topic=currentTopics().find(t=>t.word.toLowerCase()===reviewFilter.keyword.toLowerCase());
        if(topic&&Array.isArray(topic.aliases))terms.push(...topic.aliases);
        else terms.push(reviewFilter.keyword);
    }
    return terms;
}
function switchPage(page, shouldRender=true) {
    currentPage = page === 'reviews' ? 'reviews' : 'workbench';
    if(typeof document.querySelectorAll==='function'){
        document.querySelectorAll('[data-page]').forEach(btn=>{
            const active=btn.dataset.page===currentPage;
            btn.classList?.toggle('active',active);
            btn.setAttribute?.('aria-pressed',String(active));
        });
        document.querySelectorAll('.stats, .agenda-strip, .records').forEach(sec=>{sec.hidden=currentPage==='reviews';});
    }
    const reviewsNode=$('reviews-page');
    if(reviewsNode)reviewsNode.hidden=currentPage!=='reviews';
    const crumb=$('page-breadcrumb');
    if(crumb)crumb.innerHTML=`个人空间 <span class="slash">/</span> ${currentPage==='reviews'?'面试复盘':'求职工作台'}`;
    if(shouldRender && typeof render==='function')render();
    if(currentPage==='reviews')requestAiTopics(false);
}
function buildMacroOverview(notes=state.notes||[], keywords=[]) {
    const active=notes.filter(n=>(n.title||'').trim()||(n.body||'').trim());
    if(!active.length)return '';
    const fp=notesFingerprint(notes);
    if(fp && aiTopicsState.fingerprint===fp && aiTopicsState.summary)return aiTopicsState.summary;
    const companies=new Set(active.map(n=>n.companyId)).size;
    const stages=[...new Set(active.map(n=>n.stage))].join(' / ');
    const core=keywords.filter(k=>k.count>1).map(k=>k.word);
    const others=keywords.filter(k=>k.count===1).slice(0,4).map(k=>k.word);
    if(core.length){
        return `累计复盘 ${ companies } 家公司（${ stages }），跨场次共性高频考察集中于「${ core.slice(0,3).join('、') }」${ others.length?`，同时涉及 ${ others.join('、') } 等方向`:'' }；建议后续面试优先吃透共性考点的底层实现与项目边界。`;
    }
    if(others.length){
        return `累计复盘 ${ companies } 家公司（${ stages }），当前重点涉及「${ others.join('、') }」等方向；随着复盘增多将自动提炼跨公司共性考点。`;
    }
    return `累计复盘 ${ companies } 家公司（${ stages }），记录越多，跨场次共性考点越清晰。`;
}
function renderHotwordsSection() {
    const notes=state.notes||[];
    const fp=notesFingerprint(notes);
    const isAi=fp && aiTopicsState.fingerprint===fp && Array.isArray(aiTopicsState.topics) && aiTopicsState.topics.length>0;
    const keywords=currentTopics(notes);
    const overview=buildMacroOverview(notes, keywords);
    const aiBtn=mode==='server'&&fp?`<button type="button" class="text-btn ai-refresh-btn" data-ai-refresh ${aiTopicsState.loading?'disabled':''}>${aiTopicsState.loading?'✦ CF AI 正在生成总览…':isAi?'✦ CF AI 已总结 · 重新提炼':'✦ 用 CF AI 生成全局总览'}</button>`:'';
    const summaryBanner=overview?`<div class="ai-summary-banner"><strong>${isAi?'✦ AI 全局总览：':'全局复盘总览：'}</strong><span>${esc(overview)}</span></div>`:'';
    const kwMarkup=keywords.length?`<div class="hotwords-list"><button type="button" class="kw-chip ${!reviewFilter.keyword?'active':''}" data-review-keyword="">全部考点 <b>${notes.length}</b></button>${keywords.map(k=>`<button type="button" class="kw-chip ${reviewFilter.keyword.toLowerCase()===k.word.toLowerCase()?'active':''} ${k.bold?'kw-bold':''}" data-review-keyword="${esc(k.word)}" title="${esc((k.aliases||[k.word]).join(' / '))}">${esc(k.word)} <b>${k.count}</b></button>`).join('')}</div>`:'<p class="quiet">在复盘正文中使用 <strong>**加粗**</strong> 或分条记录技术问题，系统会自动归并同义考点。</p>';
    return `<div class="hotwords-panel"><div class="section-title"><h3>复盘总览与高频考点</h3><div class="hotwords-meta"><span>${isAi?'已由 Cloudflare Workers AI 跨篇归纳总览与同义考点':'已自动归并同义技术考点 · 点击词条筛选并高亮原文'}</span>${aiBtn}</div></div>${summaryBanner}${kwMarkup}</div>`;
}
function renderReviewsPage() {
    const container=$('reviews-page');if(!container)return;
    const notes=(state.notes||[]).slice();
    const topics=currentTopics(notes);
    const activeTopic=reviewFilter.keyword?topics.find(t=>t.word.toLowerCase()===reviewFilter.keyword.toLowerCase()):null;
    const companyMap=new Map([...(state.companies||[]),...(state.trash||[])].map(c=>[c.id,c]));
    const companySet=new Set(notes.map(n=>n.companyId));
    const q=reviewFilter.q.trim().toLowerCase(), kw=reviewFilter.keyword.trim().toLowerCase();
    const filtered=notes.filter(n=>{
        const co=companyMap.get(n.companyId);
        if(reviewFilter.category && n.category!==reviewFilter.category)return false;
        if(reviewFilter.stage && n.stage!==reviewFilter.stage)return false;
        const searchable=[n.title,n.body,n.stage,n.category,co?.name||'',...(co?.roles||[])].join(' ').toLowerCase();
        if(q && !searchable.includes(q))return false;
        if(kw){
            if(activeTopic){
                const byId=Array.isArray(activeTopic.noteIds)&&activeTopic.noteIds.includes(n.id);
                const byAlias=Array.isArray(activeTopic.aliases)&&activeTopic.aliases.some(a=>searchable.includes(a.toLowerCase()));
                if(!byId&&!byAlias)return false;
            }else if(!searchable.includes(kw))return false;
        }
        return true;
    }).sort((a,b)=>{
        const ta=a.meetingAt?Date.parse(a.meetingAt):a.updatedAt;
        const tb=b.meetingAt?Date.parse(b.meetingAt):b.updatedAt;
        return reviewFilter.sort==='oldest' ? (ta-tb || a.updatedAt-b.updatedAt) : (tb-ta || b.updatedAt-a.updatedAt);
    });
    const candidateCompanies=state.companies.slice().sort((a,b)=>Number(isInterview(b.status))-Number(isInterview(a.status)));
    const newForm=newReviewFormOpen?`<div class="new-review-bar"><div class="new-review-fields"><label>关联公司<select id="new-review-company">${candidateCompanies.map(c=>`<option value="${esc(c.id)}">${esc(c.name||'未命名公司')}（${esc(c.status)}）</option>`).join('')}</select></label><label>面试轮次<select id="new-review-stage">${['一面','二面','三面'].map(s=>`<option${candidateCompanies[0]&&candidateCompanies[0].status===s?' selected':''}>${s}</option>`).join('')}</select></label><label>记录类型<select id="new-review-category">${['复盘','面经','碎碎念'].map(c=>`<option>${c}</option>`).join('')}</select></label></div><div class="new-review-actions"><button type="button" class="btn primary" data-create-review-note>开始撰写</button><button type="button" class="btn" data-cancel-new-review>取消</button></div></div>`:'';
    const highlightTerms=activeHighlightTerms();
    const cards=filtered.length?`<ol class="reviews-timeline">${filtered.map(n=>{
        const co=companyMap.get(n.companyId);
        const coName=co?.name||'未命名公司';
        const roles=(co?.roles||[]).map(r=>`<span class="role-chip">${esc(r)}</span>`).join('');
        const timeStr=formatTime(n.meetingAt||n.updatedAt);
        const isEditing=editingReviewNote===n.id;
        return `<li class="review-item" data-review-card="${esc(n.id)}"><div class="review-rail"><span class="review-stage-badge">${esc(n.stage)}</span><time>${esc(timeStr)}</time></div><article class="review-card ${isEditing?'is-editing':''}"><header class="review-card-head"><div class="review-card-meta"><button type="button" class="review-company-link" data-jump-company="${esc(n.companyId)}" title="在投递工作台中定位此公司">${esc(coName)} ↗</button><span class="review-cat-tag">${esc(n.category)}</span>${co?`<span class="inline-status ${statusClass(co.status)} review-status-pill">${esc(co.status)}${phaseName(co)?' · '+esc(phaseName(co)):''}</span>`:''}${roles}</div><div class="review-card-actions"><button type="button" class="btn" data-edit-review="${esc(n.id)}">${isEditing?'收起编辑':'编辑'}</button><button type="button" class="text-btn danger" data-delete-note="${esc(n.id)}">删除</button></div></header><h4 class="review-card-title" data-review-card-title="${esc(n.id)}">${highlightTerms?highlightSafeHtml(esc(n.title||'未命名记录'),highlightTerms):esc(n.title||'未命名记录')}</h4>${isEditing?noteEditorMarkup(n,co,true):`<div class="review-card-body note-preview">${notePreview(n.body||'（暂无正文，点击右侧「编辑」补充内容）',highlightTerms)}</div>`}</article></li>`;
    }).join('')}</ol>`:`<div class="empty"><span>✳</span><h3>${notes.length?'没有匹配的复盘记录':'还没有面试复盘记录'}</h3><p>${notes.length?'试试点击「全部考点」或清除筛选条件。':'可以在投递工作台的面试历史旁点击「＋ 写面试记录」，或直接点击右上角「＋ 新增复盘」。'}</p><button type="button" class="btn primary" data-toggle-new-review>＋ 新增复盘</button></div>`;
    container.innerHTML=`<div class="records-head reviews-head"><div><h2>面试复盘与历程 <span>${notes.length}</span></h2><p>共 ${notes.length} 篇记录，覆盖 ${companySet.size} 家公司 · 串联每一次实战问答与复盘反思。</p></div><div class="records-actions"><button type="button" class="btn primary" data-toggle-new-review>＋ 新增复盘</button><button type="button" class="btn" data-page="workbench">返回投递表</button></div></div>${newForm}<div data-hotwords-container>${renderHotwordsSection()}</div><div class="toolbar reviews-toolbar"><label class="search"><span>⌕</span><input type="search" data-review-q aria-label="搜索复盘" value="${esc(reviewFilter.q)}" placeholder="搜索公司、问题、复盘正文或岗位…"></label><label class="select-wrap"><span>类型</span><select data-review-category aria-label="按类型筛选"><option value="">全部类型</option>${['复盘','面经','碎碎念'].map(c=>`<option value="${c}"${reviewFilter.category===c?' selected':''}>${c}</option>`).join('')}</select></label><label class="select-wrap"><span>轮次</span><select data-review-stage aria-label="按轮次筛选"><option value="">全部轮次</option>${['一面','二面','三面'].map(s=>`<option value="${s}"${reviewFilter.stage===s?' selected':''}>${s}</option>`).join('')}</select></label><label class="select-wrap"><select data-review-sort aria-label="复盘排序"><option value="newest"${reviewFilter.sort==='newest'?' selected':''}>历程顺序：最新在前</option><option value="oldest"${reviewFilter.sort==='oldest'?' selected':''}>历程顺序：从早到晚</option></select></label>${reviewFilter.keyword?`<button type="button" class="btn" data-review-keyword="">清除考点「${esc(reviewFilter.keyword)}」×</button>`:''}</div>${cards}`;
}
function createCompanyNote(companyId, stage, category='复盘', eventObj=null) {
    if((state.notes||[]).length>=1000){notice('最多保存 1000 篇面试笔记，请先备份整理。',true);return null;}
    const co=state.companies.find(c=>c.id===companyId);if(!co)return null;
    let ctx;
    if(eventObj){
        ctx=interviewContext(eventObj);
    }else{
        const matchEvent=(state.history||[]).filter(h=>h.companyId===companyId&&h.toStatus===stage).sort((a,b)=>b.at-a.at)[0];
        ctx=matchEvent?interviewContext(matchEvent):{eventId:co.id,stage:stage||(isInterview(co.status)?co.status:'一面'),meetingAt:isInterview(co.status)&&co.interview?.at?co.interview.at:''};
    }
    const n={id:crypto.randomUUID(),companyId:co.id,...ctx,title:`${ctx.stage}${category}`,body:'',category,updatedAt:Date.now()};
    (state.notes??=[]).push(n);
    touchCompany(co);
    return n;
}
function updateNoteEditor(editor) {
    const n=(state.notes||[]).find(n=>n.id===editor.dataset.noteEditor);if(!n)return;
    for(const input of editor.querySelectorAll('[data-note-field]'))n[input.dataset.noteField]=input.value;
    n.updatedAt=Date.now();
    const label=document.querySelector(`[data-open-note="${n.id}"] strong`);
    if(label)label.textContent=n.title||'未命名记录';
    const cardTitle=document.querySelector(`[data-review-card-title="${n.id}"]`);
    if(cardTitle)cardTitle.textContent=n.title||'未命名记录';
    const co=state.companies.find(c=>c.id===n.companyId);if(co)touchCompany(co);
    const preview=editor.querySelector('[data-note-preview]');
    if(preview)preview.innerHTML=notePreview(n.body, activeHighlightTerms());
    const hw=document.querySelector('[data-hotwords-container]');
    if(hw)hw.innerHTML=renderHotwordsSection();
    scheduleAiTopics();
    changed(false);
}
function initInterviewNotes(){
    document.addEventListener('input',e=>{
        const editor=e.target.closest?.('[data-note-editor]');
        if(editor&&e.target.matches?.('[data-note-field]')){updateNoteEditor(editor);return;}
        if(e.target.matches?.('[data-review-q]')){
            reviewFilter.q=e.target.value;
            const pos=e.target.selectionStart;
            renderReviewsPage();
            const nextInput=document.querySelector('[data-review-q]');
            if(nextInput){nextInput.focus();nextInput.setSelectionRange?.(pos,pos);}
        }
    });
    document.addEventListener('change',e=>{
        const editor=e.target.closest?.('[data-note-editor]');
        if(editor&&e.target.matches?.('select[data-note-field]')){updateNoteEditor(editor);return;}
        if(e.target.matches?.('[data-review-category]')){reviewFilter.category=e.target.value;renderReviewsPage();}
        if(e.target.matches?.('[data-review-stage]')){reviewFilter.stage=e.target.value;renderReviewsPage();}
        if(e.target.matches?.('[data-review-sort]')){reviewFilter.sort=e.target.value;renderReviewsPage();}
        if(e.target.id==='new-review-company'){
            const co=state.companies.find(c=>c.id===e.target.value),stageSelect=$('new-review-stage');
            if(co&&stageSelect&&isInterview(co.status))stageSelect.value=co.status;
        }
    });
    document.addEventListener('click',async e=>{
        const b=e.target.closest?.('button');if(!b)return;
        if(b.dataset.page){switchPage(b.dataset.page);return;}
        if(b.hasAttribute('data-ai-refresh')){await requestAiTopics(true);return;}
        if(b.dataset.writeNote){
            const event=(state.history||[]).find(h=>h.id===b.dataset.writeNote);if(!event||!isInterview(event.toStatus))return;
            const ctx=interviewContext(event);
            const existing=(state.notes||[]).filter(n=>n.companyId===event.companyId&&n.eventId===ctx.eventId).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
            if(existing){
                selectedNote=existing.id;renderTable();
                document.querySelector('[data-note-field="title"]')?.focus();
                return;
            }
            const n=createCompanyNote(event.companyId,event.toStatus,'复盘',event);if(!n)return;
            selectedNote=n.id;changed();
            document.querySelector('[data-note-field="title"]')?.focus();
        }
        if(b.dataset.newCompanyNote){
            const co=state.companies.find(c=>c.id===b.dataset.newCompanyNote);if(!co)return;
            const latestEvent=(state.history||[]).filter(h=>h.companyId===co.id&&isInterview(h.toStatus)).sort((a,b)=>b.at-a.at)[0];
            const n=createCompanyNote(co.id,isInterview(co.status)?co.status:(latestEvent?.toStatus||'一面'),'复盘',latestEvent||null);
            if(!n)return;
            selectedNote=n.id;changed();
            document.querySelector('[data-note-field="title"]')?.focus();
        }
        if(b.dataset.openNote){selectedNote=b.dataset.openNote;renderTable();}
        if(b.hasAttribute('data-close-note')){selectedNote=null;editingReviewNote=null;if(currentPage==='reviews'){renderReviewsPage();requestAiTopics(false);}else renderTable();}
        if(b.dataset.deleteNote){if(deleteNote(b.dataset.deleteNote)&&currentPage==='reviews')requestAiTopics(false);}
        if(b.dataset.openReviews){
            const noteId=b.dataset.openReviews;
            editingReviewNote=noteId;
            switchPage('reviews');
            document.querySelector(`[data-review-card="${noteId}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});
        }
        if(b.hasAttribute('data-toggle-new-review')){
            if(!state.companies.length){notice('请先在投递工作台中新增至少一家公司。',true);return;}
            newReviewFormOpen=!newReviewFormOpen;renderReviewsPage();
        }
        if(b.hasAttribute('data-cancel-new-review')){newReviewFormOpen=false;renderReviewsPage();}
        if(b.hasAttribute('data-create-review-note')){
            const coId=$('new-review-company')?.value,stage=$('new-review-stage')?.value||'一面',cat=$('new-review-category')?.value||'复盘';
            if(!coId)return;
            if(mode==='server')await loadHistory(coId);
            const matchEvent=(state.history||[]).filter(h=>h.companyId===coId&&h.toStatus===stage).sort((a,b)=>b.at-a.at)[0];
            const n=createCompanyNote(coId,stage,cat,matchEvent||null);if(!n)return;
            newReviewFormOpen=false;editingReviewNote=n.id;selectedNote=n.id;changed();
            document.querySelector(`[data-note-editor="${n.id}"] [data-note-field="body"]`)?.focus();
        }
        if(b.dataset.editReview){
            const closing=editingReviewNote===b.dataset.editReview;
            editingReviewNote=closing?null:b.dataset.editReview;
            selectedNote=editingReviewNote;
            renderReviewsPage();
            if(closing)requestAiTopics(false);
            else document.querySelector(`[data-note-editor="${editingReviewNote}"] [data-note-field="body"]`)?.focus();
        }
        if(b.dataset.reviewKeyword!==undefined){
            const next=b.dataset.reviewKeyword;
            reviewFilter.keyword=reviewFilter.keyword.toLowerCase()===next.toLowerCase()? '' : next;
            renderReviewsPage();
        }
        if(b.dataset.focusReview){
            const noteId=b.dataset.focusReview;
            reviewFilter.keyword='';reviewFilter.q='';reviewFilter.category='';reviewFilter.stage='';
            renderReviewsPage();
            document.querySelector(`[data-review-card="${noteId}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});
        }
        if(b.dataset.jumpCompany){
            await openCompany(b.dataset.jumpCompany);
        }
        if(b.dataset.noteFormat){
            const editor=b.closest('[data-note-editor]'),area=editor.querySelector('textarea');
            const selected=area.value.slice(area.selectionStart,area.selectionEnd);
            const formats={bold:`**${selected||'加粗文字'}**`,heading:`\n## ${selected||'小标题'}`,list:`\n- ${selected||'列表内容'}`,quote:`\n> ${selected||'引用内容'}`,link:`[${selected||'链接文字'}](https://)`};
            area.setRangeText(formats[b.dataset.noteFormat],area.selectionStart,area.selectionEnd,'select');area.focus();updateNoteEditor(editor);
        }
    });
}
