'use strict';
function existingRoleName(name) {
    const key=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
    const normalized=name.trim().replace(/\s+/g,' ');
    const alias=Object.entries(state.roleAliases||{}).find(([from])=>key(from)===key(normalized));
    const target=alias?alias[1]:normalized;
    return state.roles.find(r=>key(r)===key(target))||target;
}
function groupedRoles(co,query='') {
    const counts=new Map();
    state.companies.forEach(c=>c.roles.forEach(r=>counts.set(r,(counts.get(r)||0)+1)));
    const matches=state.roles.map((name,index)=>({name,index,count:counts.get(name)||0})).filter(r=>r.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const selected=matches.filter(r=>co.roles.includes(r.name));
    const remaining=matches.filter(r=>!co.roles.includes(r.name)).sort((a,b)=>b.count-a.count||a.index-b.index);
    return {selected,common:remaining.slice(0,6),other:remaining.slice(6)};
}
function roleOptionsMarkup(co,query='') {
    const groups=groupedRoles(co,query);
    const choices=items=>items.map(r=>`<div class="role-choice"><label><input type="checkbox" data-company-role="${esc(co.id)}" data-role-index="${r.index}" ${co.roles.includes(r.name)?'checked':''}>${esc(r.name)}</label><button type="button" data-delete-role="${r.index}" aria-label="删除岗位 ${esc(r.name)}">×</button></div>`).join('');
    if(!groups.selected.length&&!groups.common.length)return '<p class="role-empty">没有匹配的岗位，可在下方添加。</p>';
    return (groups.selected.length?`<p class="role-group-title">已选岗位 · ${groups.selected.length}</p>${choices(groups.selected)}`:'')+(groups.common.length?`<p class="role-group-title">${query?'匹配岗位':'常用岗位'}</p>${choices(groups.common)}`:'')+(groups.other.length?`<details class="role-more"${query?' open':''}><summary>其他岗位 · ${groups.other.length}</summary>${choices(groups.other)}</details>`:'');
}
function roleMenuMarkup(co) {
    return `<div class="role-menu"><input class="role-search" data-role-search="${esc(co.id)}" aria-label="搜索岗位名称" placeholder="搜索岗位名称…" type="search"><div data-role-options>${roleOptionsMarkup(co)}</div><div class="role-add"><input class="new-role" aria-label="新岗位" maxlength="100" placeholder="添加岗位…"><button type="button" data-add-role="${esc(co.id)}">＋</button></div></div>`;
}
function initRolePicker() {
    document.addEventListener('click',e=>{
        const owner=e.target.closest('.role-select')?.dataset.roleMenu;
        document.querySelectorAll('.role-select[open]').forEach(menu=>{if(menu.dataset.roleMenu!==owner)menu.open=false;});
    });
    document.addEventListener('keydown',e=>{
        if(e.key!=='Escape')return;
        document.querySelectorAll('.role-select[open]').forEach(menu=>{menu.open=false;if(menu.contains(document.activeElement))menu.querySelector('summary').focus();});
    });
    document.addEventListener('input',e=>{
        if(!e.target.matches('[data-role-search]'))return;
        const co=state.companies.find(c=>c.id===e.target.dataset.roleSearch);if(!co)return;
        e.target.closest('.role-menu').querySelector('[data-role-options]').innerHTML=roleOptionsMarkup(co,e.target.value);
    });
    document.addEventListener('change',e=>{
        if(!e.target.matches('[data-company-role]'))return;
        const menu=e.target.closest('.role-menu'),co=state.companies.find(c=>c.id===e.target.dataset.companyRole);
        if(!co)return;
        const moreOpen=menu.querySelector('.role-more')?.open;
        menu.querySelector('[data-role-options]').innerHTML=roleOptionsMarkup(co,menu.querySelector('.role-search').value);
        if(moreOpen&&menu.querySelector('.role-more'))menu.querySelector('.role-more').open=true;
    });
}
