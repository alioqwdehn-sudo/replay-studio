'use strict';
let backupRestoring=false;
function planSessionRestore(incoming,existing=state.sessions){
  const existingIds=new Set(existing.map(session=>session.id)),visited=new Set(),planned=[];
  for(const session of incoming){
    const group=session.assetGroupId||session.id;if(visited.has(group))continue;visited.add(group);
    const members=session.assetGroupId?incoming.filter(member=>member.assetGroupId===group):[session],matches=members.filter(member=>existingIds.has(member.id));
    if(matches.length&&matches.length!==members.length)throw Error('Only part of this multi-asset session already exists. Restore the complete session into an empty workspace or keep its current records. No records were changed.');
    if(!matches.length)planned.push(...members);
  }
  if(typeof validateAssetGroups==='function')validateAssetGroups([...existing,...planned]);
  return planned;
}
function restoredChartPreferences(input){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const result={};
  for(const key of ['bull','bear','bullWick','bearWick','bullBorder','bearBorder','background','lineColor'])if(/^#[0-9a-f]{6}$/i.test(input[key]||''))result[key]=input[key];
  for(const key of ['grid','crosshair','bodies','borders','wicks','showOHLC','showLegends','quickTrade'])if(typeof input[key]==='boolean')result[key]=input[key];
  if(['linear','log','percent'].includes(input.scale))result.scale=input.scale;
  if(['candles','bars','line','area'].includes(input.chartType))result.chartType=input.chartType;
  if(Number.isFinite(input.rightMargin)&&input.rightMargin>=5&&input.rightMargin<=50)result.rightMargin=input.rightMargin;
  if(input.periodRanges&&typeof periodRangePrefs==='function')result.periodRanges=periodRangePrefs(input.periodRanges);
  return result;
}
function restoredDrawingPreferences(saved){
  const result={},validate=(type,options)=>{if(!options||typeof options!=='object'||Array.isArray(options))throw Error('Invalid drawing preferences.');validateDrawingBackup({id:'template-validation',type,panel:0,a:{t:0,p:1},b:{t:60000,p:2},c:{t:120000,p:1.5},...options});if(options.fib?.levels&&(!Array.isArray(options.fib.levels)||options.fib.levels.length>30||options.fib.levels.some(l=>!l||!Number.isFinite(l.value))))throw Error('Invalid Fibonacci preferences.');return JSON.parse(JSON.stringify(options))};
  if(saved.drawingDefaults)result.drawingDefaults=validate('trend',{style:saved.drawingDefaults}).style;
  if(saved.fibDefaults){result.fibDefaults={};for(const type of ['fib','fibext'])if(saved.fibDefaults[type])result.fibDefaults[type]=validate(type,{fib:saved.fibDefaults[type]}).fib}
  if(saved.toolDefaults){result.toolDefaults={};for(const [type,options] of Object.entries(saved.toolDefaults))if(Object.hasOwn(DRAWING_TOOLS,type))result.toolDefaults[type]=validate(type,options)}
  if(saved.drawingTemplates!==undefined){if(!Array.isArray(saved.drawingTemplates))throw Error('Invalid drawing templates.');result.drawingTemplates=saved.drawingTemplates.map(t=>{if(!t||!safeRecordId(t.id)||!Object.hasOwn(DRAWING_TOOLS,t.type)||typeof t.name!=='string')throw Error('Invalid drawing template.');return {id:t.id,type:t.type,name:t.name,options:validate(t.type,t.options)}})}
  if(Array.isArray(saved.recentDrawingColors))result.recentDrawingColors=saved.recentDrawingColors.filter(c=>/^#[0-9a-f]{6}$/i.test(c)).slice(0,10);
  for(const key of ['keepDrawing','allLocked','hideDrawings'])if(typeof saved[key]==='boolean')result[key]=saved[key];
  return result;
}
function applyRestoredAppearance(saved,drawing=restoredDrawingPreferences(saved)){
  const appearance=restoredChartPreferences(saved.chartPrefs);
  if(appearance){Object.assign(chartPrefs,appearance);state.chartPrefs=chartPrefs}
  for(const key of ['drawingDefaults','fibDefaults','toolDefaults','recentDrawingColors','keepDrawing','allLocked','hideDrawings'])if(drawing[key]!==undefined)state[key]=drawing[key];
  if(drawing.drawingDefaults)drawingDefaults={...drawingDefaults,...drawing.drawingDefaults};if(drawing.fibDefaults)fibDefaults={...fibDefaults,...drawing.fibDefaults};if(drawing.toolDefaults)toolDefaults=drawing.toolDefaults;
  if(drawing.drawingTemplates){state.drawingTemplates??=[];for(const template of drawing.drawingTemplates)if(!state.drawingTemplates.some(t=>t.id===template.id))state.drawingTemplates.push(template)}
  if(drawing.keepDrawing!==undefined)keepDrawing=drawing.keepDrawing;if(drawing.allLocked!==undefined)allLocked=drawing.allLocked;
  if(['dark','light'].includes(saved.theme))state.theme=saved.theme;
  if(Array.isArray(saved.favoriteTools))state.favoriteTools=saved.favoriteTools.filter(tool=>typeof DRAWING_TOOLS!=='undefined'&&Object.hasOwn(DRAWING_TOOLS,tool));
}
async function restoreBackupFile(file){
  if(backupRestoring)return false;backupRestoring=true;
  const trigger=$('[data-action="restore"]');if(trigger)trigger.disabled=true;
  try{
    const backup=await readBackupFile(file);validateBackup(backup);
    const drawing=restoredDrawingPreferences(backup.state),sessions=planSessionRestore(backup.state.sessions),strategies=backup.state.strategies||[],seen=new Set();
    for(const strategy of strategies){if(!strategy||!safeRecordId(strategy.id)||seen.has(strategy.id)||typeof strategy.name!=='string'||(strategy.rules!==undefined&&typeof strategy.rules!=='string'))throw Error('Invalid strategy data.');seen.add(strategy.id)}
    for(const session of sessions){const data=decodeStoredPrices(restoreStoredPrices(backup.prices[session.id]));session.length=data.length;session.start=data[0].t;session.end=data.at(-1).t;session.cursor=Math.max(1,Math.min(data.length,Number.isFinite(session.cursor)?Math.floor(session.cursor):1))}
    if(workspaceReadBlocked&&unreadWorkspace)localStorage.setItem('replay-studio-recovery-'+Date.now(),unreadWorkspace);
    // One transaction commits every instrument source, or none of them.
    if(sessions.length)await dbPutMany(sessions.map(session=>[session.id,restoreStoredPrices(backup.prices[session.id])]));
    for(const session of sessions){session.name??=session.symbol+' session';state.sessions.push(session)}
    for(const strategy of strategies)if(!state.strategies.some(existing=>existing.id===strategy.id))state.strategies.push(strategy);
    applyRestoredAppearance(backup.state,drawing);workspaceReadBlocked=false;
    const persisted=save();render();updateStorageStatus();
    toast(persisted===false?'Backup loaded in memory, but browser storage could not save it. Keep this page open and export a backup.':'Backup restored. Existing sessions were preserved.');return persisted!==false;
  }catch(error){toast('Restore failed: '+error.message);return false}
  finally{backupRestoring=false;if(trigger)trigger.disabled=false}
}
