'use strict';
// A dashboard session can hold two isolated instrument tracks. Existing single-asset records stay unchanged.

function sessionAssets(session,records=state.sessions){
  if(!session)return [];
  return session.assetGroupId?records.filter(s=>s.assetGroupId===session.assetGroupId):[session];
}
function sessionRoot(session,records=state.sessions){return records.find(s=>s.id===session?.assetGroupId)||session}
function dashboardSessions(deleted=false,records=state.sessions){return records.filter(s=>!!s.deleted===deleted&&(!s.assetGroupId||s.id===s.assetGroupId))}
function setSessionDeleted(id,deleted){const session=state.sessions.find(s=>s.id===id);if(!session)return;for(const asset of sessionAssets(session))asset.deleted=deleted;save()}
function sessionResumeId(session){return sessionRoot(session).id}
function validateAssetGroups(records){
  for(const record of records)if(record.panelAssetIds!==undefined&&(!Array.isArray(record.panelAssetIds)||record.panelAssetIds.length>4||record.panelAssetIds.some(id=>!sessionAssets(record,records).some(member=>member.id===id))))throw Error('Invalid chart symbol mapping.');
  for(const session of records){
    if(session.assetGroupId===undefined)continue;
    if(!safeRecordId(session.assetGroupId))throw Error('Invalid session asset group.');
    const root=records.find(s=>s.id===session.assetGroupId),members=records.filter(s=>s.assetGroupId===session.assetGroupId);
    if(!root||root.assetGroupId!==root.id||(members.length<2||members.length>Object.keys(symbols).length)||new Set(members.map(s=>s.symbol)).size!==members.length||members.some(s=>!!s.deleted!==!!root.deleted))throw Error('Invalid session asset links.');
    if(session.lastAssetId!==undefined&&!members.some(s=>s.id===session.lastAssetId))throw Error('Invalid saved session asset.');
  }
}
const validateBeforeAssets=validateBackup;
validateBackup=function(backup){validateBeforeAssets(backup);validateAssetGroups(backup.state.sessions);return backup};
function sessionAssetsTable(recent=false){
  const query=$('#search')?.value?.toLowerCase()||'';
  const list=dashboardSessions().filter(s=>(s.name+' '+sessionAssets(s).map(a=>a.symbol).join(' ')).toLowerCase().includes(query));
  if(!list.length)return `<div class="card empty"><h3>${query?'No matching sessions':'No sessions yet'}</h3><p>Create a session, then choose the currency in each chart.</p>${button('+ New session','new','primary')}</div>`;
  return `<div class="tablewrap"><table><thead><tr><th>SESSION NAME</th><th>ASSETS</th><th>DATA</th><th>BALANCE / ASSET</th><th>TRADES</th><th>PROGRESS / ASSET</th><th></th></tr></thead><tbody>${list.slice(0,recent?3:1000).map(s=>{const assets=sessionAssets(s);return `<tr><td><strong>${esc(s.name)}</strong><div class="muted small">${esc(s.type)} · ${esc(s.strategy||'No strategy')}${assets.length>1?' · '+assets.length+' assets':''}</div></td><td><div class="session-asset-pills">${assets.map(a=>`<span class="pill">${a.symbol}</span>`).join('')}</div></td><td><span class="${s.demo?'tagdemo':'pill'}">${s.demo?'LEGACY DEMO':'HISTORICAL'}</span></td><td>${assets.map(a=>`<div class="asset-detail"><span>${assets.length>1?a.symbol+' ':''}</span>${money(total(a))}</div>`).join('')}</td><td>${assets.reduce((sum,a)=>sum+sessionTradeRecords(a).length,0)}</td><td>${assets.map(a=>`<div class="asset-detail"><span>${assets.length>1?a.symbol+' ':''}</span>${sessionProgress(a)}</div>`).join('')}</td><td><button data-open="${esc(sessionResumeId(s))}" class="primary">Resume ↗</button> <button data-delete="${esc(s.id)}" title="Move entire session to trash" aria-label="Delete ${esc(s.name)}">⌫</button></td></tr>`}).join('')}</tbody></table></div>`;
}
sessionTable=sessionAssetsTable;
const statsBeforeAssets=statsHtml;statsHtml=function(){return statsBeforeAssets().replace(/(<span class="muted">Sessions<\/span><strong>)\d+/,(_,prefix)=>prefix+dashboardSessions().length)};
trash=function(){const list=dashboardSessions(true);showDialog('Session trash',`<div class="modcontent">${list.length?list.map(s=>`<div class="row between" style="margin-bottom:12px"><span>${esc(s.name)} <small class="muted">${sessionAssets(s).map(a=>a.symbol).join(' + ')}</small></span><button data-restore-session="${esc(s.id)}">Restore</button></div>`).join(''):'Trash is empty.'}</div>`)};
actions.trash=trash;

// Different instruments render simultaneously in the existing 1 / 2 / 4 panel layout.
let panelRoot=null,panelTracks=new Map(),panelAssetRequest=0,panelAssetLoading=false,panelContextDepth=0;
function makePanelTrack(session,data){return {session,data,ready:hasSavedReplay(session),cursor:replayCursor(data,session.cursor),undo:[],redo:[],selected:null,aggregateCache:new Map(),cacheCount:-1}}
function panelTrack(panel){const id=panelRoot?.panelAssetIds?.[panel]||panelRoot?.id;return panelTracks.get(id)||panelTracks.get(active?.id)}
function rememberFocusedTrack(){
  const track=panelTracks.get(active?.id);if(!track||panelContextDepth)return;
  track.ready=replayReady;track.cursor=count;track.session.drawings=chartObjects;track.undo=drawingUndo;track.redo=drawingRedo;track.selected=selectedDrawing;
}
function trackGlobals(){return {active,bars,count,replayReady,chartObjects,drawingUndo,drawingRedo,selectedDrawing,aggregateCache,cacheBars,cacheCount}}
function restoreTrackGlobals(g){({active,bars,count,replayReady,chartObjects,drawingUndo,drawingRedo,selectedDrawing,aggregateCache,cacheBars,cacheCount}=g)}
function activateTrackGlobals(track){
  active=track.session;bars=track.data;count=track.ready?replayCursor(bars,track.cursor):bars.length;replayReady=track.ready;
  chartObjects=active.drawings||[];drawingUndo=track.undo;drawingRedo=track.redo;selectedDrawing=track.selected;
  aggregateCache=track.aggregateCache;cacheBars=bars;cacheCount=track.cacheCount;
}
function withPanelTrack(panel,fn){
  const track=panelTrack(panel);if(!track||track.session===active)return fn();
  const previous=trackGlobals();panelContextDepth++;activateTrackGlobals(track);
  try{return fn()}finally{track.aggregateCache=aggregateCache;track.cacheCount=cacheCount;restoreTrackGlobals(previous);panelContextDepth--}
}
const saveBeforePanels=save;
save=function(){
  if(panelRoot&&active&&sessionRoot(active)===panelRoot){
    rememberFocusedTrack();panelRoot.layout=layout;panelRoot.frames=[...frames];
    // The base save persists the selected instrument, without changing another instrument's cursor.
    for(const s of sessionAssets(panelRoot)){s.layout=layout;s.frames=[...frames]}
    panelRoot.focusedPanel=activePanel;
  }
  return saveBeforePanels();
};
function panelSymbolOptions(panel){const track=panelTrack(panel),members=sessionAssets(panelRoot);return Object.entries(symbols).map(([symbol])=>`<option value="${symbol}" ${track?.session.symbol===symbol?'selected':''}>${symbol}${!members.some(s=>s.symbol===symbol)&&!['EURUSD','GBPUSD'].includes(symbol)?' · Import CSV':''}</option>`).join('')}
function decoratePanelSymbols(){
  if(!panelRoot)return;
  $$('.chartpanel').forEach((element,panel)=>{
    const track=panelTrack(panel);if(!track)return;
    element.dataset.instrumentId=track.session.id;
    const meta=element.querySelector('.chartmeta'),old=meta.querySelector('strong');
    if(old)old.outerHTML=`<select class="panel-symbol" data-panel-symbol="${panel}" aria-label="Symbol chart ${panel+1}" title="Choose currency for this chart">${panelSymbolOptions(panel)}</select>`;
    const name=meta.querySelector('.muted');if(name)name.textContent=symbols[track.session.symbol].name;
    element.querySelector('canvas').setAttribute('aria-label',track.session.symbol+' replay chart '+(panel+1));
    if(!element.querySelector('.tradequick'))element.insertAdjacentHTML('beforeend','<div class="tradequick row"><button class="sell" data-action="sell">SELL</button><button data-action="buy">BUY</button></div>');
    const source=track.session.sourceFrame||1;element.querySelectorAll('[data-frame] option').forEach(option=>option.disabled=+option.value<source);
  });
  $$('[data-panel-symbol]').forEach(select=>select.onchange=e=>changePanelSymbol(+select.dataset.panelSymbol,e.target.value));
  $$('[data-frame]').forEach(select=>{const previous=select.onchange;select.onchange=e=>{focusChartPanel(+select.dataset.frame);previous?.(e)}});
  $('#chartlayout').onchange=e=>changePanelLayout(+e.target.value);
  if(!$('#panel-focus-label'))$('.charttop .symbol-button').insertAdjacentHTML('afterend','<span id="panel-focus-label" class="panel-focus-label"></span>');
  updatePanelFocusUI();
}
function updatePanelFocusUI(){
  if(!active||!$('.chartapp'))return;
  const loading=panelAssetLoading||replayLoading;$$('[data-action="buy"],[data-action="sell"],[data-close],#order-calculator').forEach(button=>{if(loading)button.disabled=true});
  $('.chartapp').dataset.sessionId=active.id;
  const button=$('.symbol-button');if(button){button.innerHTML=active.symbol+' <span>⌄</span>';button.title='Change symbol of the selected chart'}
  if($('#panel-focus-label'))$('#panel-focus-label').textContent='Chart '+(activePanel+1)+' · '+active.symbol;
  const order=$('.orderside h3');if(order)order.textContent='Order · '+active.symbol;
  const label=$('.orderside>p');if(label)label.textContent=active.symbol+' · '+(active.sourceName||'Historical CSV');
  if($('.source-status'))$('.source-status').textContent=(active.sourceName||active.symbol)+' · Replay: chart '+(activePanel+1);
  $$('.chartpanel .tradequick button').forEach(button=>{const panel=+button.closest('.chartpanel').querySelector('canvas').dataset.chart,track=panelTrack(panel);button.disabled=!track?.ready||replayEntryPending||replayLoading||panelAssetLoading||tool==='start';button.title='Simulated '+button.textContent+' · '+(track?.session.symbol||'')});
  refreshViewControls();
}
function focusChartPanel(panel){
  const track=panelTrack(panel);if(!track||replayLoading||replayEntryPending||panelAssetLoading||modal.innerHTML)return false;
  if(activePanel===panel&&active===track.session)return true;
  stop();save();cancelDrawingGesture();pending=null;cross=null;
  activePanel=panel;activateTrackGlobals(track);newReplaySelection=null;
  active.orderInputs??={};for(const id of ['risk','sl','tp','speed'])if($('#'+id))$('#'+id).value=active.orderInputs[id]??({risk:.5,sl:10,tp:20,speed:1000}[id]);
  updateChartUI();updatePanelFocusUI();renderIndicatorLegends();refreshDrawingBar();syncToolButtons();refreshWorkspace();save();requestDraw();return true;
}
syncSourceIntervals=function(){if(!active)return;$$('[data-frame]').forEach(select=>{const source=panelTrack(+select.dataset.frame)?.session.sourceFrame||active.sourceFrame||1;select.querySelectorAll('option').forEach(option=>option.disabled=+option.value<source)});const minimum=active.sourceFrame||1;$$('[data-interval]').forEach(button=>button.disabled=+button.dataset.interval<minimum);$$('#replay-interval option').forEach(option=>option.disabled=!['chart','source'].includes(option.value)&&+option.value<minimum)};
const drawBeforePanels=draw;
draw=function(canvas,panel){return withPanelTrack(panel,()=>drawBeforePanels(canvas,panel))};
const legendsBeforePanels=renderIndicatorLegends;
renderIndicatorLegends=function(){
  if(!panelRoot)return legendsBeforePanels();
  $$('[data-legend]').forEach(element=>withPanelTrack(+element.dataset.legend,()=>{
    element.innerHTML=(active.indicatorConfigs||[]).map(c=>`<span class="indicator-chip ${c.enabled?'':'off'}" style="--indicator-color:${c.color}"><button data-indicator-settings="${c.id}">${c.type.toUpperCase()}${['sma','ema','rsi','bb'].includes(c.type)?' '+c.period:''}</button><button data-toggle-indicator="${c.id}" title="Show / hide indicator">${c.enabled?'◉':'○'}</button><button data-remove-indicator="${c.id}" title="Remove indicator">×</button></span>`).join('');
  }));
};
const attachBeforePanels=attachCanvas;
attachCanvas=function(){
  attachBeforePanels();$$('.chartcanvas').forEach((canvas,panel)=>{
    for(const name of ['onpointerdown','onpointermove','onpointerup','onpointercancel','onpointerleave','ondblclick','oncontextmenu','onwheel']){
      const handler=canvas[name];if(!handler)continue;
      canvas[name]=event=>{
        if(['onpointerdown','ondblclick','oncontextmenu','onwheel'].includes(name)&&!focusChartPanel(panel))return;
        return withPanelTrack(panel,()=>handler(event));
      };
    }
  });
};
const renderBeforePanels=renderChart;
renderChart=function(){
  renderBeforePanels();if(!panelRoot)return;
  rememberFocusedTrack();decoratePanelSymbols();renderIndicatorLegends();requestDraw();
};
const uiBeforePanels=updateChartUI;
updateChartUI=function(){uiBeforePanels();if(!panelContextDepth){rememberFocusedTrack();updatePanelFocusUI()}};
const controlsBeforePanels=updateReplayControls;
updateReplayControls=function(){controlsBeforePanels();if(!panelContextDepth)updatePanelFocusUI()};
function defaultPanelMapping(root){
  const members=sessionAssets(root),ids=root.panelAssetIds;
  root.panelAssetIds=Array.from({length:4},(_,i)=>members.some(s=>s.id===ids?.[i])?ids[i]:(members[i%members.length]?.id||root.id));
}
function historyYearsForPanel(root){return {from:Math.max(2012,Math.min(2026,new Date(root.start).getUTCFullYear()||2026)),to:Math.max(2012,Math.min(2026,new Date(root.end).getUTCFullYear()||2026))}}
async function preparePanelAsset(root,symbol,storedOverride,isCurrent=()=>true){
  let session=sessionAssets(root).find(s=>s.symbol===symbol),stored,data;
  if(session){data=panelTracks.get(session.id)?.data;if(!data){stored=await dbGet(session.id);data=decodeStoredPrices(stored)}if(!data?.length)throw Error('Historical data missing for '+symbol);return panelTracks.get(session.id)||makePanelTrack(session,data)}
  if(!Object.hasOwn(symbols,symbol))throw Error('Unsupported symbol.');
  if(!storedOverride)throw Error('Import a real historical CSV for '+symbol+'.');
  stored=storedOverride;
  if(!isCurrent())throw Error('Loading cancelled.');
  data=decodeStoredPrices(stored);if(!data?.length)throw Error('No historical prices.');
  session={id:uid(),assetGroupId:root.id,name:root.name,type:root.type,strategy:root.strategy,balance:root.balance,spread:root.spread||0,commission:root.commission||0,leverage:root.leverage||100,target:root.target||10,maxdd:root.maxdd||10,demo:false,sourceName:storedOverride?'Imported CSV':'HistData '+symbol+' · M1 · UTC',sourceFrame:storedOverride?inferSourceFrame(data):1,symbol,layout:root.layout,frames:[...(root.frames||[5,15,60,240])],length:data.length,start:data[0].t,end:data.at(-1).t,cursor:Math.min(500,data.length),trades:[],drawings:[],created:Date.now()};
  await dbPut(session.id,stored);if(!isCurrent())throw Error('Loading cancelled.');root.assetGroupId=root.id;state.sessions.push(session);save();return makePanelTrack(session,data);
}
async function ensureDifferentSecondPanel(root,isCurrent=()=>true){
  if(sessionAssets(root).length<2){const symbol=root.symbol==='GBPUSD'?'EURUSD':'GBPUSD',track=await preparePanelAsset(root,symbol,undefined,isCurrent);panelTracks.set(track.session.id,track)}
  const other=sessionAssets(root).find(s=>s.id!==root.id);root.panelAssetIds??=[];root.panelAssetIds[0]??=root.id;if(other)root.panelAssetIds[1]=other.id;defaultPanelMapping(root);
}
function showPanelLoading(){if(!$('#panel-load-status'))$('.charttop')?.insertAdjacentHTML('beforeend','<span id="panel-load-status" role="status">Loading historical prices…</span>');$('#chartlayout')?.setAttribute('disabled','');$$('[data-panel-symbol]').forEach(select=>select.disabled=true);updateReplayControls()}
function finishPanelLoading(){panelAssetLoading=false;$('#panel-load-status')?.remove();$('#chartlayout')?.removeAttribute('disabled');$$('[data-panel-symbol]').forEach(select=>select.disabled=false);updateReplayControls()}
async function changePanelLayout(next){
  if(![1,2,4].includes(next)||panelAssetLoading||!panelRoot||replayEntryPending)return;
  stop();save();const root=panelRoot,request=++panelAssetRequest;panelAssetLoading=true;showPanelLoading();
  try{
    if(next>1&&sessionAssets(root).length<2)await ensureDifferentSecondPanel(root,()=>request===panelAssetRequest&&panelRoot===root);else defaultPanelMapping(root);
    if(request!==panelAssetRequest||panelRoot!==root)return;
    cancelDrawingGesture();pending=null;newReplaySelection=null;tool='crosshair';layout=next;activePanel=Math.min(activePanel,next-1);if(panelTrack(activePanel)?.session!==active)activateTrackGlobals(panelTrack(activePanel));
    save();renderChart();
  }catch(error){if(request!==panelAssetRequest||panelRoot!==root)return;toast('Unable to change layout: '+error.message);if($('#chartlayout'))$('#chartlayout').value=String(layout)}
  finally{if(request===panelAssetRequest)finishPanelLoading()}
}
function rehomePanelDrawings(track,panel,mapping){for(const run of [track.session,...(track.session.replayRuns||[])])for(const drawing of run.drawings||[])if(mapping[drawing.panel]!==track.session.id)drawing.panel=panel}
async function changePanelSymbol(panel,symbol,storedOverride){
  if(!panelRoot||panelAssetLoading||replayEntryPending||!Object.hasOwn(symbols,symbol))return;
  const root=panelRoot;
  if(!storedOverride&&!sessionAssets(root).some(s=>s.symbol===symbol)&&!['EURUSD','GBPUSD'].includes(symbol))return importPanelSymbol(panel,symbol);
  stop();save();const request=++panelAssetRequest;panelAssetLoading=true;showPanelLoading();
  try{
    const track=await preparePanelAsset(root,symbol,storedOverride,()=>request===panelAssetRequest&&panelRoot===root);
    if(request!==panelAssetRequest||panelRoot!==root)return;
    panelTracks.set(track.session.id,track);root.panelAssetIds[panel]=track.session.id;rehomePanelDrawings(track,panel,root.panelAssetIds);delete panelViews[panel];
    cancelDrawingGesture();pending=null;selectedDrawing=null;activePanel=panel;activateTrackGlobals(track);tool='crosshair';newReplaySelection=null;
    save();renderChart();
  }catch(error){if(request!==panelAssetRequest||panelRoot!==root)return;toast('Unable to load '+symbol+': '+error.message);const select=$('[data-panel-symbol="'+panel+'"]');if(select)select.value=panelTrack(panel).session.symbol}
  finally{if(request===panelAssetRequest)finishPanelLoading()}
}
function importPanelSymbol(panel,symbol){
  const select=$('[data-panel-symbol="'+panel+'"]');if(select)select.value=panelTrack(panel).session.symbol;
  showDialog('Historical data · '+symbol,`<div class="modcontent"><p>Import real OHLC prices for ${symbol} in chart ${panel+1}.</p><input id="panel-csv" type="file" accept=".csv,.tsv,.txt"><p id="panel-csv-status" class="small muted">CSV / TSV · UTC timestamps · at least 30 bars</p></div>`);
  const root=panelRoot;$('#panel-csv').onchange=async event=>{const input=event.target;try{const file=input.files[0];if(!file)return;const data=parseCSV(await file.text());if(panelRoot!==root||$('#panel-csv')!==input)return;modal.innerHTML='';await changePanelSymbol(panel,symbol,data)}catch(error){if($('#panel-csv')===input&&$('#panel-csv-status'))$('#panel-csv-status').textContent=error.message}};
}
actions.sessionpicker=()=>{
  if(!panelRoot)return;
  showDialog('Chart '+(activePanel+1)+' · symbol',`<div class="modcontent"><p>Choose the currency for the selected chart. Other charts keep their own currencies.</p><div class="panel-symbol-list">${Object.entries(symbols).map(([symbol,s])=>`<button data-choose-panel-symbol="${symbol}"><b>${symbol}</b><small>${esc(s.name)}</small><span>${sessionAssets(panelRoot).some(a=>a.symbol===symbol)?'Loaded':['EURUSD','GBPUSD'].includes(symbol)?'M1 history':'Import CSV'}</span></button>`).join('')}</div><hr><h3>Other sessions</h3>${dashboardSessions().filter(s=>s.id!==panelRoot.id).map(s=>`<button class="other-session" data-switch-session="${s.id}">${esc(s.name)}</button>`).join('')}</div>`);
};
const openBeforePanels=openSession;
openSession=async function(id){
  const target=state.sessions.find(s=>s.id===id);if(!target||target.deleted)return;
  if(active){stop();save()}
  const root=sessionRoot(target),request=++panelAssetRequest,previousRoot=panelRoot,previousTracks=panelTracks,previousActive=active;panelAssetLoading=true;replayLoading=true;sessionLoadVersion++;replayLoadRequest++;panelRoot=root;panelTracks=new Map();clearHistoryCaches();updateReplayControls();
  try{
    for(const s of sessionAssets(root)){const data=decodeStoredPrices(await dbGet(s.id));if(request!==panelAssetRequest)return;if(!data?.length)throw Error('Historical data missing for '+s.symbol);panelTracks.set(s.id,makePanelTrack(s,data))}
    if((root.layout||1)>1&&sessionAssets(root).length<2)await ensureDifferentSecondPanel(root,()=>request===panelAssetRequest&&panelRoot===root);
    if(request!==panelAssetRequest)return;
    defaultPanelMapping(root);
    if(!root.panelSymbolsMigrated){for(const member of sessionAssets(root)){const panel=root.panelAssetIds.indexOf(member.id);if(member.id!==root.id&&panel>=0)for(const run of [member,...(member.replayRuns||[])])for(const drawing of run.drawings||[])if(drawing.panel===0)drawing.panel=panel}root.panelSymbolsMigrated=true}
    root.layout??=1;root.frames??=[5,15,60,240];
    // Always enter through the saved first panel, keeping the established replay resume choice.
    const first=panelTrack(0);first.session.layout=root.layout;first.session.frames=[...root.frames];
    panelAssetLoading=false;await openBeforePanels(first.session.id);
    if(request!==panelAssetRequest)return;
    if(active?.id!==first.session.id)throw Error('Session source could not be opened.');
    activePanel=0;rememberFocusedTrack();decoratePanelSymbols();renderIndicatorLegends();save();requestDraw();
  }catch(error){if(request===panelAssetRequest){if(active===previousActive){panelRoot=previousRoot;panelTracks=previousTracks}toast('Unable to open session: '+error.message)}}
  finally{if(request===panelAssetRequest){panelAssetLoading=false;replayLoading=false;updateReplayControls()}}
};
const backBeforePanels=actions.back;actions.back=()=>{panelAssetRequest++;panelAssetLoading=false;backBeforePanels();panelRoot=null;panelTracks.clear()};
document.addEventListener('pointerdown',event=>{
  const element=event.target.closest('.chartpanel');if(!element)return;
  const panel=+element.querySelector('canvas').dataset.chart;if(event.target.closest('[data-panel-symbol]'))return;
  if(panel!==activePanel||panelTrack(panel)?.session!==active)focusChartPanel(panel);
},true);
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.choosePanelSymbol){event.preventDefault();event.stopImmediatePropagation();const panel=activePanel;modal.innerHTML='';changePanelSymbol(panel,button.dataset.choosePanelSymbol)}
  if(button.dataset.delete||button.dataset.restoreSession){event.preventDefault();event.stopImmediatePropagation();const deleted=!!button.dataset.delete;setSessionDeleted(button.dataset.delete||button.dataset.restoreSession,deleted);modal.innerHTML='';render();if(deleted)toast('Session moved to trash, including its chart data.')}
},true);
render();
