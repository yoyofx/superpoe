// Run after build:electron:main with node_modules/.bin/electron.cmd scripts/test_market_filter_picker.mjs.
// Uses a separate, temporary Electron profile and intercepts every HTTPS request.
import { app, BrowserWindow, session, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryProfile = mkdtempSync(path.join(os.tmpdir(), 'superpoe-filter-test-'))
app.setPath('userData', temporaryProfile)
let window
const submitted = []
const waitUntil = async (check, label) => {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error(`Timed out: ${label}`)
}

function fixture(globalRealm) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{background:#090b0c;color:#d7c08d;font:14px Arial;padding:25px}h1{font:24px Georgia;color:#ffe0a1}.filters{max-width:760px;display:grid;grid-template-columns:1fr 1fr;gap:18px}.filter-title{margin:8px 0}.multiselect{border:1px solid #62563f;padding:9px}input{background:#15120c;color:#ffe0a1}button{cursor:pointer}#stat-rows{margin:15px 0}.filter-group{grid-column:1/-1}</style></head>
  <style>.filter-group-header > .filter-title{float:left;display:block;margin:6px 0 0 22px}.filter-group-header:has(+ #filters){display:flow-root}</style>
  <style>button::before,button::after{content:'Official button chrome';position:absolute;inset:-5px;background:#a02080}</style>
  <style>
  .search-advanced-items .brown{box-sizing:border-box;padding:8px;background:#19130d;font:13px/1.5 Arial;color:#d7c08d}
  .search-advanced-items .brown .filter-group{margin-bottom:8px;border:1px solid #665137;background:#15120d}
  .search-advanced-items .brown .filter-group-header{display:flex;align-items:center;gap:8px;padding:8px;background:#302317}
  .search-advanced-items .brown .filter-group-header>.filter-title{float:none;flex:1;min-width:0;margin:0}
  .search-advanced-items .brown .filter-group-body{padding:8px}
  .search-advanced-items .brown .filter-property{display:grid;grid-template-columns:minmax(0,1fr) 68px 68px 20px auto;align-items:center;gap:6px;padding:6px 0}
  .search-advanced-items .brown .filter-property>.filter-body{grid-column:1/-1}
  .search-advanced-items .brown input.form-control{box-sizing:border-box;width:100%;min-width:0;height:26px;min-height:0;padding:3px 5px;border:1px solid #806843;background:#19130c;color:#e1d1aa;font:12px Arial}
  .search-advanced-items .brown button{position:relative;padding:3px 6px;border:1px solid #806843;border-radius:0;background:#342719;color:#d7c08d;font:11px Arial;min-height:0}
  .search-advanced-items .brown button::before,.search-advanced-items .brown button::after{content:none}
  .search-advanced-items .brown .toggle-btn{display:inline-flex}
  .search-advanced-items .brown .filter:not(.filter-property){display:table;width:100%}
  .search-advanced-items .brown .filter>.input-group-btn{display:table-cell;width:42px}
  .search-advanced-items .brown .filter>.filter-body{display:table;width:100%}
  .search-advanced-items .brown .filter>.filter-body>.filter-title{display:table-cell;width:100%}
  .search-advanced-items .brown .filter>.filter-body>input{display:table-cell;width:68px}
  /* Production button chrome and sprite icons depend on both official ancestors. */
  #trade .search-bar .btn{color:#e2e2e2;background-color:#1e2124;position:relative}
  #trade .search-bar .toggle-btn,#trade .search-bar .remove-btn{width:39px;height:30px;border:0;background-color:transparent}
  #trade .search-bar .toggle-btn::after,#trade .search-bar .remove-btn::after{content:' ';display:block;position:absolute;inset:auto;width:15px;height:15px;top:50%;left:50%;margin:-7.5px;background:linear-gradient(#a38b63,#e2e2e2)}
  #trade .search-bar .search-advanced-pane{width:50%;float:left}
  </style>
  <body><h1>SuperPoE2 · ${globalRealm ? 'Global' : 'CN'} market filters</h1>
  <div id="trade"><div class="search-bar"><div class="search-left"></div><div class="search-right"></div>
  <div class="search-advanced-items"><div class="search-advanced-pane blue"><div class="filter-group"><div class="filter-group-header"><span class="filter-title">Item & trade filters</span></div><div class="filter-group-body" id="filters"></div></div></div>
  <div class="search-advanced-pane brown" id="stats-pane"><div class="filter-group"><div class="filter-group-header"><button class="btn toggle-btn" id="stat-collapse" aria-label="Collapse"></button><span class="filter-title">Stat filters</span><select id="stat-operator"><option value="and">AND</option><option value="count">COUNT</option></select><label><input type="checkbox" id="stat-group-disabled">Disabled</label><button class="btn toggle-btn duplicate" id="stat-duplicate" aria-label="Duplicate group"></button><button class="btn remove-btn" id="stat-remove-group" aria-label="Remove group"></button></div><div class="filter-group-body" id="stat-controls"><div id="stat-rows"></div></div></div></div></div>
  <button id="search" class="search-btn">Search official market</button></div></div>
  <script>
  window.testQuery={query:{status:{option:'securable'},filters:{},stats:[{type:'and',filters:[]}]},sort:{price:'asc'}};
  window.statEditCount=0;
  window.renderStats=()=>{
    const host=document.getElementById('stat-rows');host.replaceChildren();
    if(window.app)window.app.$.subTree.children=window.app.$.subTree.children.filter(v=>!v.productionStatRow);
    for(const [index,entry] of window.testQuery.query.stats[0].filters.entries()){
      const row=document.createElement('div');row.className=window.productionStatRows?'filter full-span':'filter-property';
      if(!window.productionStatRows)row.dataset.statId=entry.id;
      // Match the live official Vue shape: no fixture-only data-stat-id or
      // filter-property class, descriptor separate from the query value.
      if(window.app)window.app.$.subTree.children.push({productionStatRow:true,component:{vnode:{el:row},proxy:{filter:{id:entry.id},index,get state(){return entry.value||{}},$parent:{get state(){return window.testQuery.query.stats[0]}}},subTree:{children:[]}}});
      const label=document.createElement('span');label.textContent=entry.id;label.className='filter-title filter-title-clickable';label.tabIndex=0;label.onclick=()=>window.statEditCount++;label.onkeydown=e=>{if(e.key==='Enter')window.statEditCount++};const edit=document.createElement('button');edit.className='edit-btn';edit.textContent='Edit';label.append(edit);row.append(label);
      for(const bound of ['min','max']){const input=document.createElement('input');input.type='number';input.className='form-control minmax';input.dataset.bound=bound;input.value=entry.value?.[bound]??'';input.oninput=()=>entry.value={...entry.value,[bound]:input.value};row.append(input)}
      const disabled=document.createElement('input');disabled.type='checkbox';disabled.checked=entry.disabled;disabled.onchange=()=>entry.disabled=disabled.checked;row.append(disabled);
      const remove=document.createElement('button');remove.className='remove-btn';remove.textContent='Remove';remove.onclick=()=>{window.testQuery.query.stats[0].filters=window.testQuery.query.stats[0].filters.filter(v=>v!==entry);window.renderStats()};row.append(remove);host.append(row);
      if(window.productionStatRows){const body=document.createElement('span');body.className='filter-body';body.append(label,...row.querySelectorAll('input.minmax'));const start=document.createElement('span'),end=document.createElement('span');start.className=end.className='input-group-btn';start.append(disabled);end.append(remove);row.replaceChildren(start,body,end)}
    }
  };
  document.getElementById('stat-operator').onchange=e=>window.testQuery.query.stats[0].type=e.target.value;
  document.getElementById('stat-group-disabled').onchange=e=>window.testQuery.query.stats[0].disabled=e.target.checked;
  document.getElementById('stat-collapse').onclick=()=>{const body=document.getElementById('stat-controls');body.style.display=body.style.display==='none'?'block':'none'};
  const fields=[
    ['items','Item',[...Array.from({length:237},(_,i)=>({id:'item'+i,type:'Base '+i,text:'Item '+i})),
      {id:'belt',type:'Utility Belt',text:'Utility Belt'},
      {id:'unique-belt',type:'Utility Belt',name:'Golden Girdle',text:'Golden Girdle Utility Belt',flags:{unique:true}},
      {id:'sword',type:'Longsword',text:'Longsword'},
      {id:'unique-sword',type:'Longsword',name:'Golden Blade',text:'Golden Blade Longsword',flags:{unique:true}}]],
    ['category','Item Category',[{id:null,text:'Any'},{id:'weapon',text:'Any Weapon'},{id:'accessory.belt',text:'Belt'}]],
    ['rarity','Item Rarity',[{id:null,text:'Any'},{id:'normal',text:'Normal'},{id:'magic',text:'Magic'},{id:'unique',text:'Unique'},{id:'rare',text:'Rare'}]],
    ['status','Status',${globalRealm ? "[{id:'securable',text:'Instant Buyout'},{id:'online',text:'Online'},{id:'any',text:'Any'}]" : "[{id:'securable',text:'立即购买'}]"}],
    ['price','Buyout Price',[{id:null,text:'Exalted Orb Equivalent'},{id:'divine',text:'Divine Orb'},{id:'chaos',text:'Chaos Orb'},...Array.from({length:234},(_,i)=>({id:'currency'+i,text:'Currency '+i}))]],
    ['corrupted','Corrupted',[{id:null,text:'Any'},{id:'true',text:'Yes'},{id:'false',text:'No'}]],
    ['indexed','Listed',[{id:null,text:'Any Time'},{id:'1day',text:'1 day'}]],
    ['league','League',[{id:'Test League',text:'Test League'},{id:'Standard',text:'Standard'}]],
    ['stats','Add stats',[{id:'explicit.life',text:'+# to maximum Life',type:'explicit'},{id:'implicit.life',text:'+# to maximum Life',type:'implicit'},{id:'explicit.fire',text:'+#% to Fire Resistance',type:'explicit'}]],
    ['stat-fixed','Fixed stat option',[{id:null,text:'Any'},{id:'normal',text:'Normal'},{id:'rare',text:'Rare'}]]
  ];
  const vnodeChildren=[];
  for(const [field,label,options] of fields){
    const body=document.createElement('div');body.className='filter-property';
    const row=document.createElement('span');row.className='filter-body';body.append(row);
    const title=document.createElement('div');title.className='filter-title';title.textContent=label;row.append(title);
    let element=document.createElement('div');element.className='multiselect '+(field==='items'?'search-select':field==='stats'?'filter-select-mutate':'filter-select');element.id='official-'+field;
    if(field==='league'||field==='status')element.className='multiselect status-select';
    const officialClass=element.className;
    element.innerHTML='<input placeholder="'+label+'"><span class="multiselect__single"></span><div class="multiselect__content-wrapper" style="display:block">Official options</div>';row.append(element);
    if(field==='items')document.querySelector('.search-left').append(element);
    else if(field==='league'||field==='status')document.querySelector('.search-right').append(element);
    else if(field==='stats'||field==='stat-fixed')document.getElementById('stat-controls').append(body);
    else document.getElementById('filters').append(body);
    if(field==='price')for(const bound of ['min','max']){
      const input=document.createElement('input');input.type='number';input.className='form-control minmax';input.id='price-'+bound;
      input.oninput=()=>window.testQuery.query.filters['price_'+bound]=input.value;row.append(input);
    }
    let value=field==='status'?options[${globalRealm ? 1 : 0}]:null;
    if(field==='status')window.testQuery.query.status.option=value.id;
    const vm={ options,get value(){return value},
      $parent:{$props:field==='stats'?{state:window.testQuery.query.stats[0]}:{filter:{id:field}}},
      getOptionLabel(option){return option?.text||''},$nextTick(callback){queueMicrotask(callback)},$forceUpdate(){window.renderStats()},activate(){element.dataset.nativeOpened='true'},
      select(option){
        element.className=officialClass;
        if(field==='stats'){
          if(!window.testQuery.query.stats[0].filters.some(v=>v.id===option.id))window.testQuery.query.stats[0].filters.push({id:option.id,value:{min:0},disabled:false});
          window.renderStats();
        }else{value=option;if(field==='status')window.testQuery.query.status.option=option?.id;else window.testQuery.query.filters[field]={option:option?.id??null};element.querySelector('.multiselect__single').textContent=option?.text||'';}
      }
    };
    const vnode={component:{proxy:vm,vnode:{el:element},subTree:{children:[]}}};
    vnodeChildren.push(vnode);
    if(field==='items')window.replaceOfficialItems=()=>{
      const next=element.cloneNode(true);next.className=officialClass;
      for(const name of ['data-superpoe-picker-token','data-superpoe-picker-managed','aria-hidden','inert'])next.removeAttribute(name);
      element.replaceWith(next);element=next;vnode.component.vnode.el=next;
    };
    if(field==='stat-fixed')element.querySelector('input').className='form-control';
  }
  window.app={$:{subTree:{children:vnodeChildren}}};
  for(const [id,type] of [['level','number'],['quality','number'],['seller','text']]){
    const row=document.createElement('div');row.className='filter-property';
    row.innerHTML='<span class="filter-body"><div class="filter-title">'+(id==='level'?'Item Level':id==='quality'?'Item Quality':id)+'</div><input id="official-'+id+'" class="form-control '+(type==='number'?'minmax':'text')+'" type="'+type+'"></span>';
    row.querySelector('input').oninput=(e)=>window.testQuery.query.filters[id]=e.target.value;
    if(type==='number'){
      const max=document.createElement('input');max.type='number';max.className='form-control minmax';max.id='official-'+id+'-max';
      max.oninput=()=>window.testQuery.query.filters[id+'_max']=max.value;row.firstElementChild.append(max);
      vnodeChildren.push({component:{proxy:{$props:{filter:{id:id==='level'?'ilvl':id}}},vnode:{el:row},subTree:{children:[]}}});
    }
    document.getElementById('filters').append(row);
  }
  document.getElementById('search').onclick=()=>fetch('/api/trade2/search/poe2/test',{method:'POST',body:JSON.stringify(window.testQuery)});
  window.groupToggleCount=0;
  for(const [index,label] of ['Weapon filters','Armour filters','Requirements'].entries()){
    const group=document.createElement('div');group.className='filter-group';group.id='condition-group-'+index;
    group.innerHTML='<div class="filter-group-header" role="button" tabindex="0" aria-expanded="false"><span class="filter-title">'+label+'</span><label><input type="checkbox" class="group-enabled">Enabled</label></div><div class="filter-group-body" style="display: none"></div>';
    const header=group.firstElementChild,body=group.lastElementChild;
    const toggle=()=>{window.groupToggleCount++;body.style.display=body.style.display==='none'?'block':'none';header.setAttribute('aria-expanded',String(body.style.display!=='none'))};
    header.onclick=toggle;header.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}};
    header.querySelector('label').onclick=e=>e.stopPropagation();
    for(const name of ['Minimum damage','Maximum damage','Attack speed','Critical chance','Defense','Requirement']){
      const row=document.createElement('div');row.className='filter-property';row.innerHTML='<span class="filter-body"><span class="filter-title">'+name+'</span><input type="number" class="form-control minmax"></span>';body.append(row);
    }
    document.querySelector('.search-advanced-pane.blue').append(group);
  }
  const emptyGroup=document.createElement('div');emptyGroup.className='filter-group';emptyGroup.innerHTML='<div class="filter-group-header"><span class="filter-title">Empty group</span></div>';document.querySelector('.search-advanced-pane.blue').append(emptyGroup);
  window.redrawOfficialClasses=()=>{for(const e of document.querySelectorAll('.multiselect'))e.classList.remove('sp-market-filter-managed')};
  window.captureStatStyles=()=>['#stats-pane .filter-group','#stats-pane .filter-group-header','#stats-pane .filter-group-header>.filter-title','#official-stat-fixed input','#stat-collapse','#stat-duplicate','#stat-remove-group'].map(selector=>{const element=document.querySelector(selector),style=getComputedStyle(element),icon=getComputedStyle(element,'::after');return [...['display','position','paddingTop','paddingLeft','marginLeft','fontFamily','fontSize','lineHeight','color','backgroundColor','borderTopWidth','boxSizing','minHeight'].map(property=>style[property]),...['content','position','width','height','backgroundImage'].map(property=>icon[property])]});
  window.originalStatStyles=window.captureStatStyles();
  </script></body></html>`
}

async function runIntegration() {
console.log('Electron filter integration runner ready')
try {
  const { loadMarketStatScopes } = await import('../dist-electron/electron/marketStatScopeCatalog.js')
  const { XiletradeDataCatalog } = await import('../dist-electron/electron/xiletradeDataCatalog.js')
  const { ItemTranslationIndex } = await import('../dist-electron/electron/itemTranslationIndex.js')
  const { resolveMarketStatScope } = await import('../dist-electron/src/engine/marketStatScope.js')
  const { resolveMarketStatTiers } = await import('../dist-electron/src/engine/marketStatTiers.js')
  const { runOfficialFilterCommand } = await import('../dist-electron/electron/marketFilterAdapter.js')
  const catalog = new XiletradeDataCatalog(path.join(root,'public/data/xiletrade'))
  const officialDescriptors = catalog.get('en-US').entries.map(e=>[e.id,e.text])
  const chineseDescriptors = new Map(catalog.get('zh-CN').entries.map(e=>[e.id,e.text]))
  const translations = new ItemTranslationIndex(path.join(root,'public/data/Translate/zh-rCN'))
  const realScopes = await loadMarketStatScopes(path.join(root,'public/pob-lua/Data'), officialDescriptors, [name=>translations.toChinese(name)||name])
  assert.equal(realScopes.uniques.find(e=>e.name==='Headhunter').ids.length,6,'real PoB scopes load inside Electron')
  assert.equal(realScopes.uniques.find(e=>e.name==='Astramentis').complete,true)
  console.log('PoB scope loader passed inside Electron')
  const runicItems = catalog.get('en-US').items.flatMap(g=>g.entries).filter(i=>i.name&&/^(Runeforged|Runemastered) /.test(i.type))
  const unresolved = runicItems.filter(item=>resolveMarketStatScope({item,category:'',rarity:'unique'},realScopes).kind==='unknown')
  console.log(`Runic unique identity coverage: ${runicItems.length-unresolved.length}/${runicItems.length}`)
  console.log('Unresolved official runic entries:',JSON.stringify(unresolved.map(i=>[i.name,i.type])))
  let runicFixture = false
  ipcMain.handle('market-filter-picker:item-categories', () => [['Utility Belt','accessory.belt'],['Longsword','weapon.onesword']])
  ipcMain.handle('market-filter-picker:stats', (_event, language) => runicFixture ? {
    entries: officialDescriptors.map(([id,text])=>[id,text,chineseDescriptors.get(id)||text]),
    affixes: [], scopes: realScopes,
  } : ({
    entries: [
      ['explicit.stat_3299347043', '+# to maximum Life', language === 'en' ? '+# to maximum Life' : '# 生命上限'],
      ['explicit.stat_3372524247', '+#% to Fire Resistance', language === 'en' ? '+#% to Fire Resistance' : '#% 火焰抗性'],
      ['explicit.stat_888', 'Shared modifier', language === 'en' ? 'Shared modifier' : '共用词缀'],
      ['implicit.stat_3299347043', '+# to maximum Life', language === 'en' ? '+# to maximum Life' : '# 生命上限'],
    ],
    affixes: [['3299347043', ['prefix']], ['3372524247', ['suffix']], ['888', ['prefix', 'suffix']]],
    scopes: { aliases: [['万用腰带','Utility Belt']], bases: [
      {name:'Utility Belt',category:'accessory.belt',ids:['explicit.stat_3299347043','implicit.stat_3299347043'],complete:true},
      {name:'Longsword',category:'weapon.onesword',ids:['explicit.stat_3372524247'],complete:true},
    ], uniques: [
      {name:'Golden Girdle',base:'Utility Belt',category:'accessory.belt',ids:['explicit.stat_3299347043','implicit.stat_3299347043'],complete:true},
    ] },
  }))
  const partition = session.fromPartition('filter-picker-integration')
  await partition.protocol.handle('https', async (request) => {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/trade2/search/')) {
      submitted.push(JSON.parse(await request.text()))
      return new Response(JSON.stringify({ id: 'test-search', result: [], total: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname === '/api/trade2/data/items') return new Response(JSON.stringify({ result: [
      { id: 'accessory', label: 'Accessories', entries: [{type:'Utility Belt'},{type:'Utility Belt',name:'Golden Girdle',flags:{unique:true}}] },
      { id: 'weapon', label: 'Weapons', entries: [{type:'Longsword'},{type:'Longsword',name:'Golden Blade',flags:{unique:true}}] },
    ] }), { headers: { 'Content-Type': 'application/json' } })
    if (url.pathname.startsWith('/api/')) return new Response(JSON.stringify({ result: [] }), { headers: { 'Content-Type': 'application/json' } })
    return new Response(fixture(url.hostname !== 'poe.game.qq.com'), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  })
  window = new BrowserWindow({ show: false, width: 1180, height: 850, webPreferences: {
    preload: path.join(root, 'dist-electron/electron/marketPreload.cjs'), session: partition,
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } })
  window.webContents.on('preload-error', (_event, _preload, error) => { console.error(error) })
  window.webContents.on('console-message', (event) => { if (event.level === 'error') console.error(event.message) })
  const js = (source) => Promise.race([window.webContents.executeJavaScript(source, true).catch((error) => { console.error('Failed script:', source); throw error }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`Script timed out: ${source.slice(0, 120)}`)), 7000); timer.unref() })])
  const click = async (selector) => {
    await waitUntil(() => js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), `click target ready: ${selector}`)
    return js(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }
  const managed = (field) => `#official-${field} + .sp-market-filter-host`
  const candidate = (label) => js(`Array.from(document.querySelectorAll('.sp-market-picker-option')).find(e=>e.querySelector('strong').textContent===${JSON.stringify(label)})?.click()`)
  for (const globalRealm of [false, true]) {
    runicFixture = false
    console.log('Loading fixture', globalRealm ? 'global' : 'CN')
    await Promise.race([window.loadURL(globalRealm ? 'https://www.pathofexile.com/trade2' : 'https://poe.game.qq.com/trade2'),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Fixture load timed out')), 10000); timer.unref() })])
    console.log('Fixture loaded')
    // Disabled translation explicitly verifies that the picker does not depend on it.
    window.webContents.send('market-enhancement:set-language', { schemaVersion: 1, language: 'en', enabled: false, source: 'disabled', uiPairs: [], gamePairs: [] })
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-unified-toolbar').length===1`), 'unified toolbar installed')
    const assertOriginal = async () => {
      assert.equal(await js(`document.querySelectorAll('.sp-market-filter-host, .sp-market-filter-managed, .sp-market-filter-options, [data-superpoe-picker-managed], [data-superpoe-picker-pending]').length`), 0)
      assert.equal(await js(`document.querySelector('#official-stats').classList.contains('sp-market-filter-managed')`), false)
      assert.equal(await js(`Array.from(document.querySelectorAll('.multiselect')).every(e=>!e.inert&&!e.hasAttribute('aria-hidden'))`), true, 'closing restores original control accessibility')
      assert.equal(await js(`document.querySelectorAll('[data-superpoe-stat-readonly],.sp-market-stat-locked-label').length`), 0, 'closing restores all original stat controls and removes static labels')
      assert.equal(await js(`document.querySelectorAll('.sp-market-stat-tier,[data-superpoe-tier-row-token]').length`), 0, 'closing removes all tier shortcuts and row tokens')
      assert.equal(await js(`Array.from(document.querySelectorAll('[id^=condition-group-]')).every(e=>getComputedStyle(e.lastElementChild).display==='none'&&e.firstElementChild.getAttribute('role')==='button'&&e.firstElementChild.getAttribute('tabindex')==='0'&&e.firstElementChild.getAttribute('aria-expanded')==='false')`), true, 'closing restores official collapsed groups and header accessibility')
    }
    if (process.argv.includes('--tiers-only')) {
      runicFixture = true
      await js(`void(window.pickFixture=(field,id)=>{const vm=window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-'+field).component.proxy;vm.select(vm.options.find(o=>o.id===id))})`)
      window.webContents.send('market-enhancement:set-language', {schemaVersion:1,language:'zh-rCN',enabled:true,source:'tier-test',uiPairs:[],gamePairs:[]})
      await waitUntil(()=>js(`document.querySelector('.sp-market-unified-open')?.textContent==='集市筛选'`),'focused tier fixture ready')
      if (globalRealm) window.setSize(780,850)
    } else {
    await assertOriginal()
    assert.notEqual(await js(`getComputedStyle(document.querySelector('.search-advanced-pane.blue')).display`), 'none')
    assert.equal(await js(`document.querySelector('.sp-market-unified-toolbar .sp-market-filter-native')===null`), true, 'original form toggle is removed from the toolbar')
    window.webContents.send('market-page:command', 'focus-filters')
    await waitUntil(() => js(`document.querySelector('.sp-market-unified[open]')?.getAttribute('aria-busy')==='false'`), 'sidebar filter shortcut opens unified dialog with original form visible')
    await js(`window.shortcutDialog=document.querySelector('.sp-market-unified');window.shortcutQuery=JSON.stringify(window.testQuery)`)
    window.webContents.send('market-page:command', 'focus-filters')
    await js(`new Promise(resolve=>setTimeout(resolve,250))`)
    assert.equal(await js(`document.querySelectorAll('.sp-market-unified[open]').length===1&&document.querySelector('.sp-market-unified')===window.shortcutDialog&&JSON.stringify(window.testQuery)===window.shortcutQuery`), true, 'repeated sidebar filter shortcut keeps the same dialog and current conditions')
    await click('.sp-market-unified-done')
    await assertOriginal()
    assert.notEqual(await js(`getComputedStyle(document.querySelector('.search-advanced-pane.blue')).display`), 'none')
    await js(`document.body.appendChild(document.createElement('hr')); window.redrawOfficialClasses()`)
    await new Promise((resolve) => setTimeout(resolve, 450))
    await assertOriginal()
    await js(`(()=>{const vm=window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-items').component.proxy;vm.select(vm.options[236]);window.originalPrice=document.querySelector('#official-price').closest('.filter-property')})()`)
    window.webContents.send('market-page:command', 'focus-filters')
    await waitUntil(() => js(`Boolean(document.querySelector('.sp-market-unified[open]'))`), 'sidebar filter shortcut opens unified dialog with original form visible')
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-filter-host').length===6 && window.testQuery.query.status.option==='securable'`), 'dialog enhancements installed')
    await waitUntil(() => js(`document.querySelector('.sp-market-unified').getAttribute('aria-busy')==='false'`), 'dialog prepared before showing reused controls')
    assert.equal(await js(`(()=>{const controls=Array.from(document.querySelectorAll('.multiselect')).filter(e=>e.nextElementSibling?.classList.contains('sp-market-filter-host'));document.querySelector('.sp-market-item-query').focus();const focused=document.activeElement;window.redrawOfficialClasses();return controls.length===6&&controls.every(e=>{e.querySelector('input').focus();return getComputedStyle(e).display==='none'&&e.inert&&e.getAttribute('aria-hidden')==='true'&&document.activeElement===focused})})()`), true, 'every replaced official control remains hidden and unfocusable immediately after a Vue class redraw')
    assert.equal(await js(`Array.from(document.querySelectorAll('.sp-market-control')).every(e=>getComputedStyle(e,'::after').content==='none'&&(e.matches('.sp-market-item-option,[role=tab]')||getComputedStyle(e,'::before').content==='none'))`), true, 'official button decoration cannot leak into any custom dialog control')
    await js(`(()=>{const control=document.createElement('div');control.id='new-official-control';control.className='multiselect filter-select-corrupted';control.innerHTML='<input><div class="multiselect__content-wrapper">New official UI</div>';window.newOfficialComponent={component:{vnode:{el:control},proxy:{options:[{id:null,text:'Any'},{id:'true',text:'Yes'}],value:null,$parent:{$props:{filter:{id:'corrupted'}}},select(){},getOptionLabel(v){return v?.text||''}},subTree:{children:[]}}};window.app.$.subTree.children.push(window.newOfficialComponent);document.querySelector('.sp-market-unified .search-left').append(control)})()`)
    assert.deepEqual(await js(`new Promise(resolve=>requestAnimationFrame(()=>{const control=document.querySelector('#new-official-control');resolve({display:getComputedStyle(control).display,inert:control.inert})}))`), {display:'none',inert:true}, 'new official controls are isolated before their first paint')
    await js(`(()=>{const control=document.querySelector('#new-official-control');if(control.nextElementSibling?.classList.contains('sp-market-filter-host'))control.nextElementSibling.remove();control.remove();window.app.$.subTree.children=window.app.$.subTree.children.filter(v=>v!==window.newOfficialComponent)})()`)
    await js(`window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-category').component.proxy.disabled=true;document.body.append(document.createElement('hr'))`)
    await waitUntil(() => js(`document.querySelector('${managed('category')} button')?.disabled===true`), 'disabled official fields retain a disabled custom control')
    assert.equal(await js(`getComputedStyle(document.querySelector('#official-category')).display==='none'&&document.querySelector('#official-category').inert`), true, 'disabled fields never fall back to visible official UI')
    await js(`window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-category').component.proxy.disabled=false;document.body.append(document.createElement('hr'))`)
    await waitUntil(() => js(`document.querySelector('${managed('category')} button')?.disabled===false`), 'custom field enabled again')
    await js(`window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-items').component.proxy.disabled=true;document.body.append(document.createElement('hr'))`)
    await waitUntil(() => js(`document.querySelector('.sp-market-item-query').disabled&&Array.from(document.querySelectorAll('.sp-market-item-option')).every(e=>e.disabled)`), 'disabled item search also uses its custom UI')
    await js(`window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-items').component.proxy.disabled=false;document.body.append(document.createElement('hr'))`)
    await waitUntil(() => js(`!document.querySelector('.sp-market-item-query').disabled&&!!document.querySelector('.sp-market-item-option:not(:disabled)')`), 'item search enabled again')
    assert.equal(await js(`Array.from(document.querySelectorAll('.sp-market-filter-host')).every(e=>e.closest('dialog.sp-market-unified[open]'))`), true)
    assert.equal(await js(`document.querySelector('#official-indexed').classList.contains('sp-market-filter-managed')`), false)
    assert.equal(await js(`document.querySelector('#official-league').classList.contains('sp-market-filter-managed')`), false)
    assert.equal(await js(`document.querySelectorAll('${managed('status')}, .sp-market-unified-purchase').length`), 0)
    assert.equal(await js(`window.testQuery.query.status.option`), 'securable')
    assert.equal(await js(`document.querySelectorAll('dialog .sp-market-filter-native').length`), 0)
    assert.equal(await js(`getComputedStyle(document.querySelector('.sp-market-unified .search-left')).display!=='none' && getComputedStyle(document.querySelector('.sp-market-unified .search-right')).display==='none'`), true)
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.sp-market-unified-tabs [role=tab] > span:first-child')).map(e=>e.textContent)`), ['Item search','Conditions','Stats'])
    assert.equal(await js(`document.querySelector('[data-filter-tab=items]').hidden===false && document.querySelector('[data-filter-tab=conditions]').hidden && document.querySelector('[data-filter-tab=stats]').hidden`), true)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-item-option').length===100`), 'item search embedded on open')
    assert.equal(await js(`document.querySelectorAll('dialog[open]').length`), 1)
    assert.equal(await js(`!!document.querySelector('.sp-market-unified-item-search #official-category') && !!document.querySelector('.sp-market-unified-item-search #official-rarity')`), true)
    assert.equal(await js(`(()=>{const rows=['rarity','level','quality'].map(id=>document.querySelector('#official-'+id).closest('.filter-property')),center=row=>{const box=row.getBoundingClientRect();return box.top+box.height/2};return rows.every(row=>row.parentElement.classList.contains('sp-market-unified-item-details'))&&rows.every(row=>Math.abs(center(row)-center(rows[0]))<2)})()`), true, 'rarity, item level, and quality share one row')
    await click('.sp-market-item-more')
    assert.equal(await js(`document.querySelectorAll('.sp-market-item-option').length`), 200)
    assert.equal(await js(`(()=>{const count=document.querySelector('.sp-market-item-count'),results=document.querySelector('.sp-market-item-results'),top=count.getBoundingClientRect().top;results.scrollTop=200;return !results.contains(count)&&results.scrollTop>0&&Math.abs(count.getBoundingClientRect().top-top)<1&&count.textContent.includes('200 shown')})()`), true, 'item counts stay outside the scrolling candidate list')
    await js(`(()=>{const results=document.querySelector('.sp-market-item-results'),card=document.querySelector('.sp-market-item-option:nth-child(150)');results.scrollTop=card.offsetTop-results.offsetTop;card.focus({preventScroll:true});window.itemScroll=results.scrollTop;window.itemCard=card;window.itemResults=results;window.itemScrollChanges=[];window.itemScrollDeadline=performance.now()+800;const sample=()=>{window.itemScrollChanges.push(results.scrollTop);if(performance.now()<window.itemScrollDeadline)requestAnimationFrame(sample)};requestAnimationFrame(sample);card.click()})()`)
    await waitUntil(() => js(`document.querySelector('.sp-market-item-selected')?.textContent.includes('Item 149')`), 'item selection updates official value')
    await new Promise((resolve) => setTimeout(resolve, 900))
    assert.equal(await js(`document.querySelectorAll('.sp-market-item-option').length===200&&document.querySelector('.sp-market-item-results')===window.itemResults&&window.itemCard.isConnected&&window.itemScrollChanges.every(top=>Math.abs(top-window.itemScroll)<1)&&Math.abs(window.itemResults.scrollTop-window.itemScroll)<1&&document.activeElement===window.itemCard`), true, 'selection retains result nodes, pagination, focus and scroll through delayed official scans')
    await js(`(()=>{const vm=window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-items').component.proxy;vm.select(vm.options[151])})()`)
    await waitUntil(() => js(`document.querySelector('.sp-market-item-selected')?.textContent.includes('Item 151')`), 'external official selection reflected')
    assert.equal(await js(`window.itemCard.isConnected&&Math.abs(document.querySelector('.sp-market-item-results').scrollTop-window.itemScroll)<1`), true, 'selection changes from the official form do not reload candidates')
    await js(`(()=>{const input=document.querySelector('.sp-market-item-query');input.value='Item';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.sp-market-item-more').click();const results=document.querySelector('.sp-market-item-results');results.scrollTop=1800;window.itemScroll=results.scrollTop;window.replaceOfficialItems()})()`)
    await waitUntil(() => js(`document.querySelector('.sp-market-item-results')!==window.itemResults&&document.querySelectorAll('.sp-market-item-option').length===200`), 'search restored after official component replacement')
    await new Promise((resolve) => setTimeout(resolve, 650))
    assert.equal(await js(`document.querySelector('.sp-market-item-query').value==='Item'&&Math.abs(document.querySelector('.sp-market-item-results').scrollTop-window.itemScroll)<1&&window.testQuery.query.filters.items.option==='item151'`), true, 'replacing the official item control preserves query, loaded pages and scroll position')
    window.setSize(1180,1050)
    await waitUntil(() => js(`innerHeight>900`), 'taller dialog viewport')
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    const tallListHeight = await js(`document.querySelector('.sp-market-item-results').clientHeight`)
    window.setSize(1180,780)
    await waitUntil(() => js(`innerHeight<800`), 'shorter dialog viewport')
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    const shortListHeight = await js(`document.querySelector('.sp-market-item-results').clientHeight`)
    assert.ok(tallListHeight > shortListHeight + 70, 'item list grows and shrinks with dialog height')
    assert.equal(await js(`(()=>{const results=document.querySelector('.sp-market-item-results').getBoundingClientRect(),body=document.querySelector('.sp-market-unified > .sp-market-picker-body');const gap=body.getBoundingClientRect().bottom-results.bottom;return gap>=0&&gap<35&&body.scrollHeight<=body.clientHeight+1})()`), true, 'results fill the remaining dialog body without a second scrollbar')
    window.setSize(1180,850)
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    await js(`document.querySelector('.sp-market-item-query').value='Item 235';document.querySelector('.sp-market-item-query').dispatchEvent(new Event('input',{bubbles:true}))`)
    await click('.sp-market-item-option')
    await waitUntil(() => js(`document.querySelectorAll('dialog[open]').length===1 && window.testQuery.query.filters.items.option==='item235' && document.querySelector('.sp-market-item-selected')?.textContent.includes('Item 235') && !!document.querySelector('.sp-market-item-option:not(:disabled)')`), 'item search commits official value')
    assert.equal(await js(`document.querySelector('[data-filter-tab=items] #official-price').closest('.filter-property')===window.originalPrice && !!document.querySelector('.sp-market-unified .search-right #official-status')`), true)
    await click(`${managed('rarity')} [role=radio]:last-child`)
    await waitUntil(() => js(`window.testQuery.query.filters.rarity?.option==='rare' && document.querySelector('${managed('rarity')} [aria-checked=true]')?.textContent==='Rare'`), 'rarity committed')
    assert.equal(await js(`getComputedStyle(document.querySelector('#official-rarity')).display==='none'&&document.querySelector('#official-rarity').inert`), true, 'official selection redraw keeps the source isolated')
    assert.equal(await js(`document.querySelector('${managed('rarity')} [aria-checked=true]').textContent`), 'Rare')
    await click(`${managed('rarity')} [role=radio]:first-child`)
    await waitUntil(() => js(`window.testQuery.query.filters.rarity?.option===null && document.querySelector('${managed('rarity')} [aria-checked=true]')?.textContent==='Any'`), 'Any null committed')
    await click('#sp-market-tab-conditions')
    assert.equal(await js(`getComputedStyle(document.querySelector('[data-filter-tab=items]')).display`), 'none')
    assert.equal(await js(`getComputedStyle(document.querySelector('[data-filter-tab=conditions] .filter-group-body')).display`), 'block')
    await waitUntil(() => js(`(()=>{const groups=Array.from(document.querySelectorAll('[data-filter-tab=conditions] .filter-group')).filter(e=>e.querySelector('.filter-property')).map(e=>e.getBoundingClientRect());return Math.abs(groups[0].top-groups[1].top)<1&&groups[1].left>groups[0].right&&Math.abs(groups[2].top-groups[0].bottom-12)<1.1&&groups[2].top<groups[1].bottom&&Math.abs(groups[3].top-groups[1].bottom-12)<1.1})()`), 'uneven groups fill the shorter column without waiting for the taller card')
    await js(`(()=>{const row=document.createElement('div');row.id='dynamic-condition-row';row.className='filter-property';row.style.height='140px';document.querySelector('[data-filter-tab=conditions] .filter-group-body').append(row)})()`)
    await waitUntil(() => js(`(()=>{const groups=Array.from(document.querySelectorAll('[data-filter-tab=conditions] .filter-group')).filter(e=>e.querySelector('.filter-property')).map(e=>e.getBoundingClientRect());return groups.slice(2).every(r=>{const previous=groups.slice(0,groups.indexOf(r)).filter(p=>Math.abs(p.left-r.left)<1).at(-1);return !previous||Math.abs(r.top-previous.bottom-12)<1.1})})()`), 'card height changes reflow both columns without overlap')
    await js(`document.querySelector('#dynamic-condition-row').remove()`)
    await waitUntil(() => js(`(()=>{const first=document.querySelector('[data-filter-tab=conditions] .filter-group').getBoundingClientRect(),next=document.querySelector('#condition-group-1').getBoundingClientRect();return Math.abs(next.top-first.bottom-12)<1.1})()`), 'removing fields closes the space below the resized group')
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-condition-link').length===4`), 'navigation lists nonempty condition groups')
    assert.equal(await js(`Array.from(document.querySelectorAll('[id^=condition-group-] .filter-group-body')).every(e=>getComputedStyle(e).display==='block')`), true, 'initially collapsed condition groups are displayed fully')
    await js(`(()=>{const header=document.querySelector('#condition-group-0 .filter-group-header');header.querySelector('.filter-title').click();header.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));header.querySelector('.group-enabled').click()})()`)
    assert.equal(await js(`window.groupToggleCount===0&&document.querySelector('#condition-group-0 .group-enabled').checked&&document.querySelector('#condition-group-0 .filter-group-header').getAttribute('aria-expanded')==='true'`), true, 'mouse and keyboard cannot collapse groups while header checkboxes remain usable')
    await js(`(()=>{window.conditionNav=document.querySelector('.sp-market-condition-nav');window.conditionNavTop=window.conditionNav.getBoundingClientRect().top;window.conditionNav.children[2].click()})()`)
    assert.equal(await js(`(()=>{const body=document.querySelector('.sp-market-unified > .sp-market-picker-body'),group=document.querySelector('#condition-group-1'),nav=window.conditionNav;return body.scrollTop>0&&Math.abs(nav.getBoundingClientRect().top-window.conditionNavTop)<1&&group.getBoundingClientRect().top>=body.getBoundingClientRect().top&&group.getBoundingClientRect().top<body.getBoundingClientRect().bottom&&nav.children[2].getAttribute('aria-current')==='location'})()`), true, 'fixed navigation scrolls only the dialog body to the chosen group and highlights it')
    await click('.sp-market-condition-link:last-child')
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    assert.equal(await js(`document.querySelector('.sp-market-condition-link:last-child').getAttribute('aria-current')==='location'`), true, 'navigation can distinguish the right group in a shared row')
    await click('.sp-market-condition-link:first-child')
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    assert.equal(await js(`document.querySelector('.sp-market-condition-link:first-child').getAttribute('aria-current')==='location'`), true, 'navigation retains the chosen left group after scrolling')
    await js(`document.querySelector('.sp-market-unified > .sp-market-picker-body').scrollTop=0`)
    await click('#sp-market-tab-items')
    assert.equal(await js(`document.querySelector('.sp-market-condition-nav').hidden`), true, 'group navigation only appears in the conditions tab')
    await js(`for(const [bound,value] of [['min','2'],['max','9']]){const e=document.querySelector('#price-'+bound);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}))}`)
    await waitUntil(() => js(`document.querySelector('#sp-market-tab-conditions .sp-market-tab-count').textContent==='0'`), 'item-search price range excluded from conditions tab count')
    await click(`${managed('price')} .sp-market-filter-trigger`)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-picker-option').length===100`), '100 options')
    await click('.sp-market-picker-more')
    assert.equal(await js(`document.querySelectorAll('.sp-market-picker-option').length`), 200)
    await js(`document.querySelector('.sp-market-picker-search').value='Currency 233';document.querySelector('.sp-market-picker-search').dispatchEvent(new Event('input',{bubbles:true}))`)
    assert.equal(await js(`document.querySelectorAll('.sp-market-picker-option').length`), 1)
    await candidate('Currency 233')
    await waitUntil(() => js(`document.querySelectorAll('dialog[open]').length===1`), 'single select returns to unified dialog')
    assert.equal(await js(`window.testQuery.query.filters.items.option`), 'item235')
    await click(`${managed('price')} .sp-market-filter-trigger`)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-picker-option').length===100`), 'currency options')
    assert.equal(await js(`document.querySelectorAll('dialog .sp-market-filter-native').length`), 0)
    await candidate('Divine Orb')
    await waitUntil(() => js(`document.querySelectorAll('dialog[open]').length===1`), 'currency returns to unified dialog')
    await click('#sp-market-tab-stats')
    assert.deepEqual(await js(`window.captureStatStyles()`), await js(`window.originalStatStyles`), 'stat groups, titles, inputs and buttons retain their original computed styling')
    assert.equal(await js(`Array.from(document.querySelectorAll('[data-filter-tab=stats] .sp-market-filter-host')).length===1&&!document.querySelector('#official-stat-fixed').hasAttribute('data-superpoe-picker-token')&&document.querySelector('#official-stat-fixed').inert&&getComputedStyle(document.querySelector('#official-stat-fixed')).display==='none'&&!!document.querySelector('#official-stat-fixed+.sp-market-stat-locked-label')&&getComputedStyle(document.querySelector('#official-stats')).display==='none'&&document.querySelector('#official-stats').inert`), true, 'only adding a stat opens a picker; existing stat options become static labels')
    await click('#stat-collapse')
    assert.equal(await js(`getComputedStyle(document.querySelector('#stat-controls')).display`), 'none', 'official stat group collapse remains available')
    await click('#stat-collapse')
    assert.notEqual(await js(`getComputedStyle(document.querySelector('#stat-controls')).display`), 'none', 'official stat group expands again')
    await js(`(()=>{const control=document.querySelector('#official-stat-fixed').cloneNode(true);control.id='new-stat-fixed';control.inert=false;control.removeAttribute('data-superpoe-stat-readonly');document.querySelector('#stat-controls').append(control)})()`)
    assert.equal(await js(`new Promise(resolve=>requestAnimationFrame(()=>{const control=document.querySelector('#new-stat-fixed');resolve(control.inert&&!control.hasAttribute('data-superpoe-picker-pending')&&getComputedStyle(control).display==='none'&&control.nextElementSibling.classList.contains('sp-market-stat-locked-label'))}))`), true, 'redrawn stat options are locked before the next paint')
    await js(`document.querySelector('#new-stat-fixed').remove()`)
    await js(`(()=>{const host=document.createElement('div');host.id='readonly-stat-extra';host.innerHTML='<div id="inline-stat-editor" class="multiselect filter-select filter-select-title filter-select-mutate"><input placeholder="Existing stat"><span class="multiselect__single">Existing stat</span><div class="multiselect__content-wrapper">Official editor</div></div><input id="stat-weight" type="number" class="weight" value="1">';document.querySelector('#stat-controls').append(host);const control=host.firstElementChild;window.inlineStatComponent={component:{vnode:{el:control},proxy:{options:[{id:'explicit.fire',text:'Fire'}],value:{id:'explicit.fire',text:'Fire'},select(){window.statEditCount++},getOptionLabel(v){return v?.text||''}},subTree:{children:[]}}};window.app.$.subTree.children.push(window.inlineStatComponent);control.onclick=()=>window.statEditCount++;document.querySelector('#stat-weight').oninput=()=>window.statEditCount++})()`)
    assert.equal(await js(`new Promise(resolve=>requestAnimationFrame(()=>{const control=document.querySelector('#inline-stat-editor');resolve(control.inert&&getComputedStyle(control).display==='none'&&control.nextElementSibling.textContent==='Existing stat'&&document.querySelector('#stat-weight').inert)}))`),true,'an already open identity editor and non-range inputs become readonly')
    await js(`document.querySelector('#inline-stat-editor').click();document.querySelector('#stat-weight').dispatchEvent(new Event('input',{bubbles:true}))`)
    assert.equal(await js(`window.statEditCount`),0,'readonly controls cannot reach official editing handlers')
    await new Promise(resolve=>setTimeout(resolve,350))
    assert.equal(await js(`!document.querySelector('#inline-stat-editor').hasAttribute('data-superpoe-picker-token')&&!document.querySelector('#inline-stat-editor+.sp-market-filter-host')`),true,'an existing identity editor is never mistaken for the add-stat picker')
    await js(`(()=>{document.querySelector('#readonly-stat-extra').remove();window.app.$.subTree.children=window.app.$.subTree.children.filter(v=>v!==window.inlineStatComponent)})()`)
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-picker-option').length===3`), 'stat picker in stats tab')
    await js(`document.querySelectorAll('.sp-market-picker-option')[0].click()`)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-picker-option[aria-pressed=true]:disabled').length===1`), 'first stat added without closing')
    await js(`document.querySelectorAll('.sp-market-picker-option')[1].click()`)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-picker-option[aria-pressed=true]:disabled').length===2`), 'same-name stats with different IDs stay separate')
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    await waitUntil(() => js(`document.querySelector('#sp-market-tab-stats .sp-market-tab-count').textContent==='2'`), 'active stat count')
    await js(`(()=>{const title=document.querySelector('[data-stat-id="explicit.life"] .filter-title');title.click();title.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));title.querySelector('.edit-btn').click()})()`)
    assert.equal(await js(`window.statEditCount`),0,'clicking a selected stat name, edit button or pressing Enter never changes its identity')
    assert.equal(await js(`getComputedStyle(document.querySelector('[data-stat-id="explicit.life"] .edit-btn')).display`),'none','existing stat edit affordances are hidden')
    assert.equal(await js(`getComputedStyle(document.querySelector('[data-stat-id="explicit.life"]')).display==='grid'&&getComputedStyle(document.querySelector('[data-stat-id="explicit.life"] [data-bound=min]')).height==='26px'`), true, 'selected stats keep the official row layout and range inputs')
    await js(`const statMin=document.querySelector('[data-stat-id="explicit.life"] [data-bound=min]');statMin.value='120';statMin.dispatchEvent(new Event('input',{bubbles:true}));const op=document.querySelector('#stat-operator');op.value='count';op.dispatchEvent(new Event('change',{bubbles:true}))`)
    await click('[data-stat-id="implicit.life"] input[type=checkbox]')
    await waitUntil(() => js(`document.querySelector('#sp-market-tab-stats .sp-market-tab-count').textContent==='1'`), 'disabled stat excluded')
    await click('#stat-group-disabled')
    await waitUntil(() => js(`document.querySelector('#sp-market-tab-stats .sp-market-tab-count').textContent==='0'`), 'disabled group excluded')
    await click('#stat-group-disabled')
    await click('[data-stat-id="implicit.life"] input[type=checkbox]')
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-picker-option').length===3`), 'stat picker reopened')
    await js(`document.querySelectorAll('.sp-market-picker-option')[2].click()`)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-picker-option[aria-pressed=true]:disabled').length===3`), 'third stat added')
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    await click('[data-stat-id="explicit.fire"] .remove-btn')
    await waitUntil(() => js(`document.querySelector('#sp-market-tab-stats .sp-market-tab-count').textContent==='2'`), 'deleted stat excluded')
    await click('#sp-market-tab-items')
    assert.equal(await js(`document.querySelector('.sp-market-item-query').value`), 'Item 235')
    await click('#sp-market-tab-stats')
    assert.equal(await js(`document.querySelector('[data-stat-id="explicit.life"] [data-bound=min]').value`), '120')
    await js(`document.querySelector('#sp-market-tab-stats').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`)
    assert.equal(await js(`document.activeElement.id==='sp-market-tab-items' && document.querySelector('#sp-market-tab-items').getAttribute('aria-selected')==='true'`), true)
    await click('.sp-market-unified-done')

    const verifyStatColumns = async () => {
    // The enhanced stat picker translates by ID independently of the page toggle.
    window.webContents.send('market-enhancement:set-language', {schemaVersion:1,language:'zh-rCN',enabled:false,source:'disabled',uiPairs:[],gamePairs:[]})
    await waitUntil(()=>js(`!document.querySelector('dialog')&&document.querySelector('.sp-market-unified-open')?.textContent==='集市筛选'`),'Chinese picker language installed')
    await js(`(()=>{for(const field of ['items','category','rarity']){const vm=window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-'+field).component.proxy;vm.select(vm.options.find(o=>o.id===null)||null)}const vm=window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-stats').component.proxy;vm.options=[
      {id:'explicit.stat_3299347043',text:${JSON.stringify(globalRealm ? '+# to maximum Life' : '# 生命上限')},type:'explicit'},
      {id:'explicit.stat_3372524247',text:'+#% to Fire Resistance',type:'explicit'},
      {id:'explicit.stat_888',text:'Shared modifier',type:'explicit'},
      {id:'implicit.stat_3299347043',text:'+# to maximum Life',type:'implicit'}];window.testQuery.query.stats[0].filters=[];window.renderStats()})()`)
    await click('.sp-market-unified-open')
    await waitUntil(()=>js(`document.querySelector('.sp-market-unified').getAttribute('aria-busy')==='false'`),'Chinese dialog ready')
    await click('#sp-market-tab-stats')
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(()=>js(`document.querySelectorAll('.sp-market-picker-option').length===5`),'prefix, suffix, shared and other candidates')
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('[data-affix=prefix] .sp-market-picker-option strong')).map(e=>e.textContent)`),['# 生命上限','共用词缀'])
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('[data-affix=suffix] .sp-market-picker-option strong')).map(e=>e.textContent)`),['#% 火焰抗性','共用词缀'])
    assert.equal(await js(`document.querySelector('[data-affix=other] .sp-market-picker-option strong').textContent`),'# 生命上限','implicit stays outside prefix/suffix despite shared text and hash')
    assert.equal(await js(`(()=>{const p=document.querySelector('[data-affix=prefix]').getBoundingClientRect(),s=document.querySelector('[data-affix=suffix]').getBoundingClientRect();return innerWidth>540?s.left>p.left&&Math.abs(s.top-p.top)<2:s.top>p.bottom})()`),true,'left prefix/right suffix, stacked only on narrow windows')
    const statQuery=async value=>js(`(()=>{const input=document.querySelector('.sp-market-picker-search');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await statQuery('maximum life')
    assert.equal(await js(`document.querySelectorAll('.sp-market-picker-option').length`),2,'English aliases match both realms')
    await statQuery('火抗')
    assert.equal(await js(`document.querySelectorAll('.sp-market-picker-option').length`),1,'Chinese fuzzy search works')
    await statQuery('')
    await candidate('共用词缀')
    await waitUntil(()=>js(`document.querySelectorAll('.sp-market-picker-option[aria-pressed=true]:disabled').length===2`),'shared affix selected on both sides')
    assert.equal(await js(`window.testQuery.query.stats[0].filters.filter(e=>e.id==='explicit.stat_888').length`),1,'one official submission for a shared prefix/suffix condition')
    await fs.writeFile(path.join(root,'.cache',globalRealm?'market-stat-columns-narrow.png':'market-stat-columns.png'),(await window.webContents.capturePage()).toPNG())
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    await click('.sp-market-unified-done')
    window.webContents.send('market-enhancement:set-language', {schemaVersion:1,language:'zh-rCN',enabled:true,source:'test',uiPairs:[['Stat filters','属性筛选']],gamePairs:[['+# to maximum Life','# 生命上限']]})
    await waitUntil(()=>js(`document.querySelector('#stats-pane .filter-group-header>.filter-title').textContent==='属性筛选'`),'native translation language installed')
    await click('.sp-market-unified-open')
    await waitUntil(()=>js(`document.querySelector('.sp-market-unified').getAttribute('aria-busy')==='false'`),'translated official stat pane ready')
    await click('#sp-market-tab-stats')
    await js(`document.querySelector('#stats-pane .filter-group-header>.filter-title').textContent='Stat filters';const label=document.createElement('span');label.id='native-stat-translation';label.className='filter-title';label.textContent='+# to maximum Life';document.querySelector('#stat-rows').append(label)`)
    await waitUntil(()=>js(`document.querySelector('#native-stat-translation').textContent==='# 生命上限'&&document.querySelector('#stats-pane .filter-group-header>.filter-title').textContent==='属性筛选'`),'moved native stat labels still translate on redraw')
    await click('.sp-market-unified-done')
    }
    await assertOriginal()
    assert.deepEqual(await js(`window.testQuery.query.stats[0].filters.map(v=>v.id)`), ['explicit.life', 'implicit.life'])
    const beforeOfficialSearch = submitted.length
    await click('#search')
    await waitUntil(() => Promise.resolve(submitted.length === beforeOfficialSearch + 1), 'official search submitted')
    const query = submitted.at(-1).query
    assert.equal(query.filters.rarity.option, null)
    assert.equal(query.filters.items.option, 'item235')
    assert.equal(query.filters.price.option, 'divine')
    assert.equal(query.status.option, 'securable')
    assert.equal(query.filters.price_min, '2')
    assert.equal(query.filters.price_max, '9')
    assert.equal(await js(`document.querySelector('#filters #official-price').closest('.filter-property')===window.originalPrice && document.querySelector('#official-status').parentElement.classList.contains('search-right')`), true)
    assert.equal(query.stats[0].filters.length, 2)
    assert.equal(query.stats[0].filters[0].value.min, '120')
    assert.equal(query.stats[0].type, 'count')
    // Blur, hover changes and DOM mutations must preserve values and avoid duplicate enhancements.
    await js(`document.activeElement?.blur();document.body.appendChild(document.createElement('hr'))`)
    await new Promise((resolve) => setTimeout(resolve, 450))
    await assertOriginal()
    assert.equal(await js(`window.testQuery.query.filters.price.option`), 'divine')
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-unified-toolbar').length===1`), 'unified toolbar')
    assert.notEqual(await js(`getComputedStyle(document.querySelector('.search-advanced-pane.blue')).display`), 'none')
    await js(`window.originalLevel=document.querySelector('#official-level')`)
    await click('.sp-market-unified-open')
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-filter-host').length===6`), 'enhancements restored on reopen')
    assert.equal(await js(`document.querySelector('dialog.sp-market-unified')?.open`), true)
    assert.equal(await js(`document.querySelector('.sp-market-unified #official-level')===window.originalLevel && !!document.querySelector('[data-filter-tab=stats] #official-stats')`), true)
    await js(`for(const [id,value] of [['level','82'],['level-max','85'],['quality','20'],['quality-max','30'],['seller','Test Seller']]){const e=document.querySelector('#official-'+id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.blur()}`)
    await click(`${managed('category')} .sp-market-filter-trigger`)
    await waitUntil(() => js(`document.querySelectorAll('dialog[open]').length===2 && document.querySelectorAll('.sp-market-picker-option').length===3`), 'nested category picker')
    await candidate('Belt')
    await waitUntil(() => js(`document.querySelectorAll('dialog[open]').length===1 && document.querySelector('dialog.sp-market-unified')?.open`), 'return to unified dialog')
    await click('.sp-market-unified-done')
    await assertOriginal()
    assert.equal(await js(`document.querySelector('#filters #official-level')===window.originalLevel && document.querySelector('#official-level').value==='82'`), true)
    await click('.sp-market-unified-open')
    assert.equal(await js(`document.querySelector('#official-seller').value`), 'Test Seller')
    if(globalRealm)window.setSize(510,750)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-filter-host').length===6 && !!document.querySelector('[data-filter-tab=items] #official-price') && window.testQuery.query.status.option==='securable'`), 'simplified top section ready at current window size')
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`)
    assert.equal(await js(`(()=>{const e=document.querySelector('.sp-market-unified'),r=e.getBoundingClientRect(),b=e.querySelector('.sp-market-picker-body');return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&b.scrollWidth<=b.clientWidth+1})()`), true)
    await fs.mkdir(path.join(root,'.cache'),{recursive:true})
    await fs.writeFile(path.join(root,'.cache',globalRealm?'market-filter-dialog-narrow.png':'market-filter-dialog.png'),(await window.webContents.capturePage()).toPNG())
    await waitUntil(() => js(`document.querySelector('#sp-market-tab-conditions .sp-market-tab-count').textContent==='1'`), 'only seller counts in conditions tab; price stays with item search')
    assert.equal(await js(`(()=>{const price=document.querySelector('.sp-market-unified-price'),row=price.querySelector('.filter-property').getBoundingClientRect(),query=document.querySelector('.sp-market-item-query-field').getBoundingClientRect(),details=document.querySelector('.sp-market-unified-item-details').getBoundingClientRect();return !price.classList.contains('filter-group')&&!price.querySelector('.filter-group-header')&&row.height>0&&row.top>=details.bottom&&row.bottom<=query.top})()`), true, 'buyout row sits directly above item search without a price section heading')
    assert.equal(await js(`(()=>{const tabs=document.querySelector('.sp-market-unified-tabs'),r=tabs.getBoundingClientRect();return tabs.children.length===3&&Array.from(tabs.children).every(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.left>=r.left&&b.right<=r.right+1})})()`), true, 'all three tabs remain fully visible at narrow widths')
    assert.equal(await js(`(()=>{const host=document.querySelector('${managed('price')}').getBoundingClientRect(),min=document.querySelector('#price-min').getBoundingClientRect();return host.width<=201&&min.left-host.right<=7&&min.left>=host.right&&Math.abs(host.top-min.top)<5})()`), true, 'currency stays compact beside the amount range')
    await click('#sp-market-tab-conditions')
    assert.equal(await js(`(()=>{const groups=Array.from(document.querySelectorAll('[data-filter-tab=conditions] .filter-group')).filter(e=>e.querySelector('.filter-property')).map(e=>e.getBoundingClientRect()),body=document.querySelector('.sp-market-unified > .sp-market-picker-body');return body.scrollWidth<=body.clientWidth+1&&(innerWidth>960?Math.abs(groups[0].top-groups[1].top)<1:groups.every((r,i)=>Math.abs(r.left-groups[0].left)<1&&(!i||r.top>groups[i-1].top)))})()`), true, 'condition groups adapt to one column on narrow windows without horizontal overflow')
    await js(`(()=>{const body=document.querySelector('.sp-market-unified > .sp-market-picker-body');body.scrollTop=100;window.conditionsScroll=body.scrollTop})()`)
    await click('#sp-market-tab-items')
    await click('#sp-market-tab-conditions')
    assert.equal(await js(`document.querySelector('.sp-market-unified > .sp-market-picker-body').scrollTop===window.conditionsScroll`), true, 'tab restores its previous scroll position')
    await js(`document.querySelector('.sp-market-unified > .sp-market-picker-body').scrollTop=0;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    await fs.mkdir(path.join(root,'.cache'),{recursive:true})
    await fs.writeFile(path.join(root,'.cache',globalRealm?'market-filter-conditions-narrow.png':'market-filter-conditions.png'),(await window.webContents.capturePage()).toPNG())
    await click('#sp-market-tab-stats')
    assert.equal(await js(`(()=>{const body=document.querySelector('.sp-market-unified > .sp-market-picker-body');return body.scrollWidth<=body.clientWidth+1&&Array.from(document.querySelectorAll('[data-filter-tab=stats] input')).every(e=>e.getBoundingClientRect().right<=body.getBoundingClientRect().right+1)})()`), true, 'stat values stay inside the dialog at narrow widths')
    await fs.writeFile(path.join(root,'.cache',globalRealm?'market-filter-stats-narrow.png':'market-filter-stats.png'),(await window.webContents.capturePage()).toPNG())
    const beforeSearch=submitted.length
    await click('.sp-market-unified-search')
    await waitUntil(()=>Promise.resolve(submitted.length===beforeSearch+1),'unified search submitted')
    await assertOriginal()
    assert.equal(submitted.at(-1).query.filters.level,'82')
    assert.equal(submitted.at(-1).query.filters.level_max,'85')
    assert.equal(submitted.at(-1).query.filters.quality,'20')
    assert.equal(submitted.at(-1).query.filters.quality_max,'30')
    assert.equal(submitted.at(-1).query.filters.seller,'Test Seller')
    assert.equal(submitted.at(-1).query.filters.category.option,'accessory.belt')
    assert.equal(submitted.at(-1).query.stats[0].filters.length,2)
    assert.equal(await js(`document.querySelector('#filters #official-level')===window.originalLevel`),true)
    await click('.sp-market-unified-open')
    await js(`document.querySelector('.sp-market-unified').dispatchEvent(new Event('cancel',{cancelable:true}))`)
    assert.equal(await js(`document.querySelector('dialog')`),null)
    await assertOriginal()
    await assertOriginal()
    await click('.sp-market-unified-open')
    await js(`document.querySelector('.search-bar').appendChild(document.createElement('hr'))`)
    await new Promise((resolve)=>setTimeout(resolve,400))
    assert.equal(await js(`document.querySelectorAll('.sp-market-unified-toolbar').length`),1)
    assert.equal(await js(`window.redrawOfficialClasses();Array.from(document.querySelectorAll('.multiselect[data-superpoe-picker-managed]')).every(e=>getComputedStyle(e).display==='none'&&e.inert)`), true, 'redraw never exposes the native controls before the debounce rescan')
    await waitUntil(()=>js(`document.querySelectorAll('.sp-market-filter-managed').length===6`),'official class redraw keeps dialog fields enhanced')
    window.webContents.send('market-filter-picker:close')
    await waitUntil(()=>js(`!document.querySelector('dialog')`),'navigation closes and restores')
    await assertOriginal()
    assert.equal(await js(`document.querySelector('#filters #official-level')===window.originalLevel`),true)
    await click('.sp-market-unified-open')
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-filter-host').length===6`), 'enhancements available after navigation')
    assert.equal(await js(`document.querySelectorAll('dialog .sp-market-filter-native').length`), 0)
    await click(`${managed('category')} .sp-market-filter-trigger`)
    await waitUntil(() => js(`document.querySelectorAll('dialog[open]').length===2 && document.querySelectorAll('.sp-market-picker-option').length===3`), 'reopen category')
    if (globalRealm) {
      window.setSize(510, 750)
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.equal(await js(`(()=>{const e=document.querySelector('dialog:not(.sp-market-unified)'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>200 && r.height>200 && s.visibility==='visible' && Number(s.opacity)===1 && r.width<=innerWidth && r.left>=0 && r.top>=0 && r.bottom<=innerHeight+1})()`), true)
    }
    await fs.mkdir(path.join(root, '.cache'), { recursive: true })
    await fs.writeFile(path.join(root, '.cache', globalRealm ? 'market-filter-picker-narrow.png' : 'market-filter-picker.png'), (await window.webContents.capturePage()).toPNG())
    await js(`document.querySelector('dialog:not(.sp-market-unified)').dispatchEvent(new Event('cancel',{cancelable:true}))`)
    assert.equal(await js(`document.querySelectorAll('dialog[open]').length`), 1)
    // Changing official scope refreshes the embedded results without closing or reopening search.
    const chooseRarity = async (label) => {
      await js(`Array.from(document.querySelectorAll('${managed('rarity')} [role=radio]')).find(e=>e.textContent===${JSON.stringify(label)}).click()`)
      await waitUntil(() => js(`document.querySelector('${managed('rarity')} [aria-checked=true]')?.textContent===${JSON.stringify(label)}`), 'rarity scope refreshed')
    }
    const itemCount = async (count) => {
      await waitUntil(() => js(`document.querySelectorAll('.sp-market-item-option').length===${count} && document.querySelector('.sp-market-item-results').getAttribute('aria-busy')==='false'`), 'scoped item count')
      assert.equal(await js(`document.querySelectorAll('dialog[open]').length`), 1)
    }
    await itemCount(2)
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.sp-market-item-option strong')).map(e=>e.textContent)`), ['Utility Belt','Golden Girdle Utility Belt'])
    assert.equal(await js(`document.querySelector('.sp-market-picker-scope').textContent.includes('Belt')`), true)
    assert.equal(await js(`document.querySelector('[data-rarity=unique] small').textContent.includes('Unique')`), true)
    for (const [label, color] of [['Normal','rgb(232, 229, 222)'],['Magic','rgb(136, 136, 255)'],['Rare','rgb(255, 255, 119)']]) {
      await chooseRarity(label)
      await itemCount(1)
      await waitUntil(() => js(`(()=>{const item=document.querySelector('.sp-market-item-option strong');return !!item&&getComputedStyle(item).color===${JSON.stringify(color)}})()`), 'rarity color refreshed')
      assert.equal(await js(`document.querySelector('.sp-market-item-option strong').textContent`), 'Utility Belt')
    }
    await chooseRarity('Unique')
    await waitUntil(() => js(`document.querySelector('.sp-market-item-option strong')?.textContent==='Golden Girdle Utility Belt'`), 'unique scope refreshed')
    await itemCount(1)
    assert.equal(await js(`getComputedStyle(document.querySelector('.sp-market-item-option strong')).color`), 'rgb(217, 139, 69)')
    await js(`document.querySelector('.sp-market-unified > .sp-market-picker-body').scrollTop=0`)
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    await fs.writeFile(path.join(root,'.cache',globalRealm?'market-item-scope-narrow.png':'market-item-scope.png'),(await window.webContents.capturePage()).toPNG())
    await js(`document.querySelector('.sp-market-item-query').value='Longsword';document.querySelector('.sp-market-item-query').dispatchEvent(new Event('input',{bubbles:true}))`)
    assert.equal(await js(`document.querySelectorAll('.sp-market-item-option').length`), 0)
    // Keep the keyword while changing rarity; both conditions must still apply.
    await chooseRarity('Rare')
    await itemCount(0)
    assert.equal(await js(`document.querySelector('.sp-market-item-query').value`), 'Longsword')
    await chooseRarity('Unique')
    await waitUntil(() => js(`document.querySelector('.sp-market-picker-scope').textContent.includes('Unique')`), 'scope retained with keyword')
    await js(`document.querySelector('.sp-market-item-query').value='Golden';document.querySelector('.sp-market-item-query').dispatchEvent(new Event('input',{bubbles:true}))`)
    await itemCount(1)
    await click('.sp-market-item-option')
    await waitUntil(() => js(`window.testQuery.query.filters.items.option==='unique-belt' && document.querySelectorAll('dialog[open]').length===1`), 'scoped item commits through official select')
    await waitUntil(() => js(`document.querySelector('.sp-market-item-selected').textContent.includes('Golden Girdle') && document.querySelector('.sp-market-item-option')?.getAttribute('aria-pressed')==='true'`), 'selection remains visible in merged search')
    assert.equal(await js(`document.querySelector('.sp-market-item-query').value`), 'Golden')
    await click('.sp-market-unified-done')
    assert.equal(await js(`document.querySelector('dialog')`), null)
    await assertOriginal()
    await click('.sp-market-unified-open')
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-filter-host').length===6`), 'simplified fields retained on reopen')
    window.webContents.send('market-enhancement:set-language', { schemaVersion: 1, language: 'en', enabled: false, source: 'disabled', uiPairs: [], gamePairs: [] })
    await waitUntil(() => js(`!document.querySelector('dialog')`), 'reset restores original controls')
    await assertOriginal()
    // Category ID translations also work when the English wording has no text mapping.
    window.webContents.send('market-enhancement:set-language', { schemaVersion: 1, language: 'zh-rCN', enabled: true, source: 'test', uiPairs: [], gamePairs: [] })
    await waitUntil(() => js(`document.querySelector('.sp-market-unified-open')?.textContent==='集市筛选'`), 'Chinese interface applied')
    await click('.sp-market-unified-open')
    await waitUntil(() => js(`document.querySelector('${managed('category')} .sp-market-filter-trigger')?.textContent.includes('腰带')`), 'selected category translated by ID')
    await click(`${managed('category')} .sp-market-filter-trigger`)
    await waitUntil(() => js(`document.querySelectorAll('.sp-market-picker-option').length===3`), 'Chinese category choices loaded')
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.sp-market-picker-option strong')).map(e=>e.textContent)`), ['全部','任意武器','腰带'])
    await candidate('任意武器')
    await waitUntil(() => js(`document.querySelector('.sp-market-picker-scope')?.textContent.includes('任意武器') && window.testQuery.query.filters.category.option==='weapon'`), 'localized category keeps official value and updates scope')
    await click('.sp-market-unified-done')
    await assertOriginal()
    await verifyStatColumns()
    // Item changes only narrow new candidates; existing official rows, values,
    // operators and disabled states survive until explicitly cleaned up.
    window.webContents.send('market-enhancement:set-language', {schemaVersion:1,language:'en',enabled:false,source:'disabled',uiPairs:[],gamePairs:[]})
    await waitUntil(()=>js(`!document.querySelector('dialog')&&document.querySelector('.sp-market-unified-open')?.textContent==='Market filters'`),'English scope tests ready')
    await js(`(()=>{
      window.pickFixture=(field,id)=>{const vm=window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-'+field).component.proxy;vm.select(vm.options.find(o=>o.id===id))};
      window.pickFixture('category','accessory.belt');window.pickFixture('rarity','rare');window.pickFixture('items','belt');
      window.testQuery.query.stats[0].filters=[
        {id:'explicit.stat_3299347043',value:{min:120,max:200},disabled:false},
        {id:'explicit.stat_3372524247',value:{min:35,max:40},disabled:true}];window.renderStats()
    })()`)
    await click('.sp-market-unified-open')
    await waitUntil(()=>js(`document.querySelector('.sp-market-unified').getAttribute('aria-busy')==='false'&&document.querySelector('.sp-market-stat-context strong')?.textContent.includes('Utility Belt')`),'base context displayed')
    await click('#sp-market-tab-stats')
    assert.equal(await js(`document.querySelector('.sp-market-stat-context-warning')?.textContent.includes('1 selected')`),true)
    assert.equal(await js(`document.querySelector('[data-stat-id="explicit.stat_3372524247"]').classList.contains('sp-market-stat-outside')`),true,'incompatible stat is marked without changing values')
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(()=>js(`document.querySelectorAll('.sp-market-picker-option').length===2`),'base limits official stat candidates')
    assert.equal(await js(`document.activeElement===document.querySelector('.sp-market-picker-search')`),true,'search focuses automatically')
    await js(`(()=>{const input=document.querySelector('.sp-market-picker-search');input.value='maximum life';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`)
    await waitUntil(()=>js(`window.testQuery.query.stats[0].filters.length===3&&document.querySelectorAll('dialog[open]').length===2&&!document.querySelector('dialog:not(.sp-market-unified) .sp-market-stat-scope-toggle').disabled`),'Enter adds next available stat and keeps picker open')
    await click('dialog:not(.sp-market-unified) .sp-market-stat-scope-toggle')
    assert.equal(await js(`document.querySelector('.sp-market-picker-search').value`),'maximum life','scope switch keeps keyword')
    await js(`(()=>{const input=document.querySelector('.sp-market-picker-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    assert.equal(await js(`document.querySelectorAll('.sp-market-picker-option').length`),5,'all stats includes special/unrelated candidates without merging IDs')
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    await js(`window.pickFixture('category','weapon');window.pickFixture('items','sword')`)
    await waitUntil(()=>js(`document.querySelector('.sp-market-stat-context strong')?.textContent.includes('Longsword')&&document.querySelector('.sp-market-stat-context-warning')?.textContent.includes('2 selected')`),'new item updates scope and marks retained conditions')
    assert.deepEqual(await js(`window.testQuery.query.stats[0].filters.slice(0,2)`),[
      {id:'explicit.stat_3299347043',value:{min:120,max:200},disabled:false},
      {id:'explicit.stat_3372524247',value:{min:35,max:40},disabled:true},
    ],'switching item preserves original min/max and disabled state')
    await click('.sp-market-stat-cleanup')
    await waitUntil(()=>js(`window.testQuery.query.stats[0].filters.length===1&&!document.querySelector('.sp-market-stat-context-warning')`),'explicit cleanup removes only incompatible conditions')
    assert.deepEqual(await js(`window.testQuery.query.stats[0].filters[0]`),{id:'explicit.stat_3372524247',value:{min:35,max:40},disabled:true})
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(()=>js(`document.querySelectorAll('.sp-market-picker-option').length===1`),'changing item resets all-stats override')
    assert.equal(await js(`document.querySelector('.sp-market-picker-option').dataset.candidateKey.includes('3372524247')`),true)
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    await js(`window.pickFixture('category','accessory.belt');window.pickFixture('rarity','unique');window.pickFixture('items','unique-belt')`)
    await waitUntil(()=>js(`document.querySelector('.sp-market-stat-context strong')?.textContent.includes('Golden Girdle')`),'unique context displayed')
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(()=>js(`!!document.querySelector('[data-affix=unique]')&&!!document.querySelector('[data-affix=implicit]')`),'unique own stats and base implicits replace prefix/suffix columns')
    assert.equal(await js(`document.querySelectorAll('[data-affix=prefix],[data-affix=suffix]').length`),0)
    assert.equal(await js(`document.querySelectorAll('.sp-market-picker-option').length`),2)
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    await fs.writeFile(path.join(root,'.cache',globalRealm?'market-stat-scope-narrow.png':'market-stat-scope.png'),(await window.webContents.capturePage()).toPNG())
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    await js(`(()=>{const vm=window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-items').component.proxy;vm.options.push({id:'cn-base',type:'万用腰带',text:'万用腰带'});window.pickFixture('rarity','rare');window.pickFixture('items','cn-base')})()`)
    await waitUntil(()=>js(`document.querySelector('.sp-market-stat-context strong')?.textContent.includes('万用腰带')&&!document.querySelector('.sp-market-stat-context-hint')`),'localized base name resolves to canonical PoB identity')
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(()=>js(`document.querySelectorAll('.sp-market-picker-option').length===2`),'Chinese base identity uses the same stat scope')
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    await js(`(()=>{const vm=window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-items').component.proxy;vm.select(null)})()`)
    await waitUntil(()=>js(`document.querySelector('.sp-market-stat-context strong')?.textContent.includes('Current category')`),'category scope remains after clearing selected item')
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(()=>js(`document.querySelectorAll('.sp-market-picker-option').length===2`),'category unions filter the candidates')
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    await js(`window.pickFixture('items','item235')`)
    await waitUntil(()=>js(`document.querySelector('.sp-market-stat-context-hint')?.textContent.includes('Showing all stats')`),'unknown item preserves full-list fallback')
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(()=>js(`document.querySelectorAll('.sp-market-picker-option').length===5`),'unknown item never hides official options')
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    const scopedSearch=submitted.length
    await click('.sp-market-unified-search')
    await waitUntil(()=>Promise.resolve(submitted.length===scopedSearch+1),'scoped dialog submits final official query')
    assert.deepEqual(submitted.at(-1).query.stats[0].filters,[{id:'explicit.stat_3372524247',value:{min:35,max:40},disabled:true}])
    await assertOriginal()
    assert.equal(await js(`document.querySelectorAll('.sp-market-stat-context,.sp-market-stat-outside-note,.sp-market-stat-outside').length`),0,'original form restored without added scope UI')
    // Reproduce the reported real runic unique, including Chinese identity,
    // actual official stat IDs, granted skill, blur and the submitted query.
    runicFixture = true
    const runicItem = catalog.get(globalRealm?'en-US':'zh-CN').items.flatMap(g=>g.entries).find(i=>
      i.name===(globalRealm?'Twisted Empyrean':'扭曲天穹')&&i.type===(globalRealm?'Runemastered Aberrant Sledge':'符文师匠畸变巨锤'))
    assert.ok(runicItem,'reported runic unique exists in the current realm catalog')
    const runicScope = resolveMarketStatScope({item:runicItem,category:'',rarity:'unique'},realScopes)
    const officialRows = catalog.get(globalRealm?'en-US':'zh-CN').entries.filter(e=>runicScope.ids.includes(e.id))
    const coldConversion = 'explicit.stat_1683568809'
    assert.ok(officialRows.some(e=>e.id===coldConversion))
    assert.ok(officialRows.some(e=>e.id==='skill.starborn_onslaught'))
    window.webContents.send('market-enhancement:set-language', {schemaVersion:1,language:'zh-rCN',enabled:true,source:'runic-test',uiPairs:[],gamePairs:[]})
    await waitUntil(()=>js(`document.querySelector('.sp-market-unified-open')?.textContent==='集市筛选'`),'real runic scope catalog reset')
    await js(`(()=>{
      const component=field=>window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-'+field).component.proxy;
      component('items').options.push({...${JSON.stringify(runicItem)},id:'runic-unique'});
      component('stats').options=${JSON.stringify(officialRows.map(e=>({id:e.id,text:e.text,type:e.id.split('.')[0]})))};
      component('category').select(null);component('rarity').select(component('rarity').options.find(o=>o.id==='unique'));
      window.testQuery.query.stats[0].filters=[];window.renderStats();
    })()`)
    await click('.sp-market-unified-open')
    await waitUntil(()=>js(`document.querySelector('.sp-market-unified').getAttribute('aria-busy')==='false'`),'runic dialog prepared')
    await js(`(()=>{const input=document.querySelector('.sp-market-item-query');input.value=${JSON.stringify(runicItem.name)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await waitUntil(()=>js(`Array.from(document.querySelectorAll('.sp-market-item-option')).some(e=>e.textContent.includes(${JSON.stringify(runicItem.name)}))`),'runic unique appears in item search')
    await js(`Array.from(document.querySelectorAll('.sp-market-item-option')).find(e=>e.textContent.includes(${JSON.stringify(runicItem.name)})).click()`)
    await waitUntil(()=>js(`window.testQuery.query.filters.items.option==='runic-unique'`),'runic unique selected through item search')
    await click('#sp-market-tab-stats')
    await waitUntil(()=>js(`document.querySelector('${managed('stats')} .sp-market-filter-trigger')?.disabled===false&&document.querySelector('.sp-market-stat-context strong')?.textContent.includes(${JSON.stringify(runicItem.name)})`),'runic stat picker ready')
    await click(`${managed('stats')} .sp-market-filter-trigger`)
    await waitUntil(()=>js(`!!document.querySelector('[data-affix=unique]')&&!!document.querySelector('[data-affix=implicit]')`),'runic identity resolves to unique properties')
    const ids = await js(`Array.from(document.querySelectorAll('.sp-market-picker-option')).map(e=>JSON.parse(e.dataset.candidateKey)[0])`)
    assert.deepEqual(new Set(ids),new Set(officialRows.map(e=>e.id)),'runic picker shows only mapped official properties')
    assert.equal(ids.filter(id=>id.startsWith('explicit.')).length,7,'all seven own explicit properties, no ordinary random pool')
    await js(`Array.from(document.querySelectorAll('.sp-market-picker-option')).find(e=>e.dataset.candidateKey.includes('${coldConversion}')).click()`)
    await waitUntil(()=>js(`window.testQuery.query.stats[0].filters.some(e=>e.id==='${coldConversion}')`),'real runic property added through official select')
    await click('dialog:not(.sp-market-unified) .sp-market-picker-done')
    await js(`document.querySelector('.sp-market-unified-search').focus()`)
    const runicSearch = submitted.length
    await click('.sp-market-unified-search')
    await waitUntil(()=>Promise.resolve(submitted.length===runicSearch+1),'runic official search submitted')
    assert.equal(submitted.at(-1).query.filters.items.option,'runic-unique')
    assert.deepEqual(submitted.at(-1).query.stats[0].filters,[{id:coldConversion,value:{min:0},disabled:false}])
    await assertOriginal()
    console.log(`PASS ${globalRealm?'global':'CN'} real Twisted Empyrean runic unique: item search, scoped official stats, skill, selection, blur and submitted query`)
    }
    // Real ordinary-item tiers fill the existing official row through input
    // events, including duplicate IDs, disabled rows and subsequent manual edits.
    const strength = 'explicit.stat_4080418644'
    const localBase = name=>globalRealm?name:translations.toChinese(name)||name
    await js(`(()=>{const component=field=>window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-'+field).component.proxy;
      window.productionStatRows=true;
      component('items').options.push({id:'real-belt',type:${JSON.stringify(localBase('Heavy Belt'))},text:${JSON.stringify(localBase('Heavy Belt'))}},
        {id:'real-amulet',type:${JSON.stringify(localBase('Amber Amulet'))},text:${JSON.stringify(localBase('Amber Amulet'))}},
        {id:'real-ring',type:${JSON.stringify(localBase('Iron Ring'))},text:${JSON.stringify(localBase('Iron Ring'))}});
      component('rarity').select(component('rarity').options.find(o=>o.id==='rare'));window.pickFixture('items','real-belt');
      window.testQuery.query.stats[0].filters=[{id:'${strength}',value:{min:0,max:99},disabled:true},{id:'${strength}',value:{min:10,max:20},disabled:false}];window.renderStats();
    })()`)
    await click('.sp-market-unified-open')
    await waitUntil(()=>js(`document.querySelector('.sp-market-unified').getAttribute('aria-busy')==='false'&&document.querySelectorAll('.sp-market-stat-tier-trigger:not(:disabled)').length===2`),'real ordinary tier shortcuts ready')
    await click('#sp-market-tab-stats')
    const tierHost = `#stat-rows > .filter:first-child .sp-market-stat-tier`
    assert.equal(await js(`(()=>{const rows=Array.from(document.querySelectorAll('#stat-rows > .filter'));const positions=rows.map(row=>[row.querySelector('.sp-market-stat-tier-trigger'),...row.querySelectorAll('input.minmax')].map(e=>e.getBoundingClientRect()));return rows.every(row=>!row.classList.contains('filter-property')&&!row.dataset.statId)&&positions.every(([tier,min,max])=>tier.right<=min.left&&min.left-tier.right<=5&&min.right<=max.left&&Math.abs(tier.top+tier.height/2-min.top-min.height/2)<1&&tier.width>=90&&tier.height===30)&&positions.every(p=>p.every((r,i)=>Math.abs(r.left-positions[0][i].left)<1))})()`),true,'tier selectors precede minimum bounds and align with both range inputs across official rows')
    await click(`${tierHost} .sp-market-stat-tier-trigger`)
    await waitUntil(()=>js(`document.querySelector('${tierHost} [data-tier="1"]')?.textContent.includes('34—36')`),'belt T1 is 34-36')
    assert.ok((await js(`document.querySelector('${tierHost} [data-tier="1"]').textContent`)).includes('81'))
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    await fs.writeFile(path.join(root,'.cache',globalRealm?'market-stat-tiers-narrow.png':'market-stat-tiers.png'),(await window.webContents.capturePage()).toPNG())
    await click(`${tierHost} [data-tier="1"]`)
    await waitUntil(()=>js(`document.querySelector('${tierHost} .sp-market-stat-tier-trigger')?.textContent.includes('T1')&&document.querySelector('${tierHost} .sp-market-stat-tier-options').hidden`),'T1 applied and shortcut updated')
    assert.deepEqual(await js(`window.testQuery.query.stats[0].filters`),[
      {id:strength,value:{min:'34',max:'36'},disabled:true},{id:strength,value:{min:10,max:20},disabled:false},
    ],'only the chosen duplicate row changes; disabled state survives')
    const staleRow = await js(`document.querySelector('#stat-rows > .filter:first-child').dataset.superpoeTierRowToken`)
    assert.equal(await js(`(${runOfficialFilterCommand.toString()})(${JSON.stringify({action:'stat-range',rowToken:staleRow,statId:strength,range:{min:1,max:2},previous:['0','99']})})`),false,'stale previous values cannot overwrite a later edit')
    await click(`${tierHost} .sp-market-stat-tier-trigger`)
    await click(`${tierHost} [data-tier="2"]`)
    await waitUntil(()=>js(`document.querySelector('${tierHost} .sp-market-stat-tier-trigger')?.textContent.includes('T2')`),'second tier can replace bounds')
    await js(`(()=>{const input=document.querySelector('#stat-rows > .filter:first-child input.minmax');input.value='32';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await waitUntil(()=>js(`document.querySelector('${tierHost} .sp-market-stat-tier-trigger')?.textContent==='选择 T 级'`),'manual bounds clear exact tier highlight')
    assert.equal(await js(`window.testQuery.query.stats[0].filters[0].value.min`),'32')
    await js(`window.renderStats()`)
    await waitUntil(()=>js(`document.querySelectorAll('#stat-rows .sp-market-stat-tier').length===2&&document.querySelectorAll('#stat-rows .sp-market-stat-tier-trigger:not(:disabled)').length===2`),'official redraw rebinds once per row')
    await js(`window.pickFixture('items','real-amulet')`)
    await waitUntil(()=>js(`document.querySelector('.sp-market-stat-context strong')?.textContent.includes(${JSON.stringify(localBase('Amber Amulet'))})&&document.querySelector('${tierHost} .sp-market-stat-tier-trigger')?.disabled===false`),'amulet context replaces belt tiers')
    await click(`${tierHost} .sp-market-stat-tier-trigger`)
    await waitUntil(()=>js(`document.querySelector('${tierHost} [data-tier="1"]')?.textContent.includes('31—33')`),'amulet T1 differs from belt T1')
    await click(`${tierHost} [data-tier="1"]`)
    await waitUntil(()=>js(`document.querySelector('${tierHost} .sp-market-stat-tier-trigger')?.textContent.includes('T1')`),'amulet range applied')
    await js(`document.querySelector('${tierHost} .sp-market-stat-tier-trigger').focus()`)
    const tierSearch = submitted.length
    await click('.sp-market-unified-search')
    await waitUntil(()=>Promise.resolve(submitted.length===tierSearch+1),'tier range sent through official search')
    assert.deepEqual(submitted.at(-1).query.stats[0].filters,[{id:strength,value:{min:'31',max:'33'},disabled:true},{id:strength,value:{min:10,max:20},disabled:false}])
    await assertOriginal()
    // Two-number damage stats use the same average as PoB's trade generator.
    const damageId = 'explicit.stat_1754445556'
    const ringContext = {item:{type:'Iron Ring'},category:'',rarity:'rare'}
    const damageTier = resolveMarketStatTiers(ringContext,resolveMarketStatScope(ringContext,realScopes),realScopes,damageId)[0]
    assert.ok(damageTier?.average,'real ring added damage has a numeric average')
    assert.deepEqual(damageTier?.rolls,[{min:1,max:4},{min:60,max:71}],'ring keeps both raw lightning rolls')
    assert.deepEqual({min:damageTier?.min,max:damageTier?.max},{min:30.5,max:37.5},'ring trade-query projection averages both lightning rolls')
    assert.deepEqual({min:damageTier?.searchMin,max:damageTier?.searchMax},{min:31.01,max:37.5},'ring search bounds exclude the overlapping lower tier')
    await js(`window.pickFixture('items','real-ring');window.testQuery.query.stats[0].filters=[{id:'${damageId}',disabled:false}];window.renderStats()`)
    await click('.sp-market-unified-open')
    await waitUntil(()=>js(`document.querySelector('.sp-market-unified').getAttribute('aria-busy')==='false'&&document.querySelector('.sp-market-stat-tier-trigger')?.disabled===false`),'ring damage tier ready')
    await click('#sp-market-tab-stats')
    await click(`${tierHost} .sp-market-stat-tier-trigger`)
    const damageOptionText = await js(`document.querySelector('${tierHost} [data-mod-id="${damageTier.id}"]').textContent`)
    assert.ok(damageOptionText.includes('1—4 至 60—71'),'ring shows both raw lightning ranges')
    assert.ok(damageOptionText.includes('集市搜索范围 31.01—37.5'),'ring shows the conservative trade-search range')
    await click(`${tierHost} [data-mod-id="${damageTier.id}"]`)
    await waitUntil(()=>js(`Number(window.testQuery.query.stats[0].filters[0].value.min)===${damageTier.searchMin}&&Number(window.testQuery.query.stats[0].filters[0].value.max)===${damageTier.searchMax}&&document.querySelector('${tierHost} .sp-market-stat-tier-options').hidden`),'damage search range fills both bounds')
    await click('.sp-market-unified-done')
    await assertOriginal()
    const hybridContext = {item:{type:'Rusted Cuirass'},category:'',rarity:'rare'}
    const lifeId = 'explicit.stat_3299347043'
    const hybridTier = resolveMarketStatTiers(hybridContext,resolveMarketStatScope(hybridContext,realScopes),realScopes,lifeId).find(e=>e.text.includes('\n'))
    assert.ok(hybridTier,'real armour has a separate hybrid life sequence')
    await js(`(()=>{const vm=window.app.$.subTree.children.find(v=>v.component.vnode.el.id==='official-items').component.proxy;vm.options.push({id:'real-armour',type:${JSON.stringify(localBase('Rusted Cuirass'))},text:${JSON.stringify(localBase('Rusted Cuirass'))}});window.pickFixture('items','real-armour');window.testQuery.query.stats[0].filters=[{id:'${lifeId}',value:{},disabled:false}];window.renderStats()})()`)
    await click('.sp-market-unified-open')
    await waitUntil(()=>js(`document.querySelector('.sp-market-unified').getAttribute('aria-busy')==='false'&&document.querySelector('.sp-market-stat-tier-trigger')?.disabled===false`),'armour hybrid ranges ready')
    await click('#sp-market-tab-stats')
    await click(`${tierHost} .sp-market-stat-tier-trigger`)
    assert.ok(await js(`document.querySelectorAll('.sp-market-stat-tier-series').length>=2&&Array.from(document.querySelectorAll('.sp-market-stat-tier-series')).some(e=>e.textContent.includes('复合词缀'))`),'hybrid and pure properties have separate translated headings')
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    await fs.writeFile(path.join(root,'.cache',globalRealm?'market-stat-hybrid-tiers-narrow.png':'market-stat-hybrid-tiers.png'),(await window.webContents.capturePage()).toPNG())
    await js(`document.querySelector('${tierHost} .sp-market-stat-tier-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
    assert.equal(await js(`document.querySelectorAll('dialog[open]').length===1&&document.querySelector('${tierHost} .sp-market-stat-tier-options').hidden`),true,'Escape closes only the inline tier choices')
    await click(`${tierHost} .sp-market-stat-tier-trigger`)
    await click(`${tierHost} [data-mod-id="${hybridTier.id}"]`)
    await waitUntil(()=>js(`Number(window.testQuery.query.stats[0].filters[0].value.min)===${hybridTier.searchMin}&&Number(window.testQuery.query.stats[0].filters[0].value.max)===${hybridTier.searchMax}&&document.querySelector('${tierHost} .sp-market-stat-tier-options').hidden`),'hybrid choice fills only the selected stat range')
    assert.equal(await js(`window.testQuery.query.stats[0].filters.length`),1)
    await click('.sp-market-unified-done')
    await assertOriginal()
    console.log(`PASS ${globalRealm?'global':'CN'} ordinary tiers: real base-specific T1/T2, duplicate rows, disabled state, stale values, manual edits, redraw, numeric damage average and submitted bounds`)
    if (!process.argv.includes('--tiers-only')) console.log(`PASS ${globalRealm ? 'global' : 'CN'}: hidden instant purchase, original-style filter rows, translated stats, prefix/suffix columns, original form restored, dialog-only enhancements, pagination, values, search, redraw, navigation and reset`)
  }
  window.destroy()
  console.log('All Electron market filter integration checks passed.')
  app.exit(0)
} catch (error) {
  console.error(error)
  if (window&&!window.isDestroyed()) console.error('Fixture failure state:',await window.webContents.executeJavaScript(`JSON.stringify({dialogs:Array.from(document.querySelectorAll('dialog')).map(e=>e.textContent.slice(0,1600)),query:window.testQuery})`).catch(()=>''))
  window?.destroy()
  app.exit(1)
} finally {
  // The OS releases profile locks on process exit; the unique test profile is not shared with the app.
}
}

app.whenReady().then(runIntegration).catch((error) => { console.error(error); app.exit(1) })
