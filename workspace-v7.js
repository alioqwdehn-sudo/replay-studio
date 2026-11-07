'use strict';
// Explicit replay lifecycle. Cancelling never removes trades, journals or drawings.
function syncReplayVisibility(){
  if(!active||!$('.chartapp'))return;
  const on=replayReady||tool==='start';
  $('.replaybar')?.classList.toggle('replay-closed',!on);
  const trigger=$('.charttop [data-action="selectreplay"]');
  if(trigger&&!$('#cancel-replay'))trigger.insertAdjacentHTML('afterend','<button id="cancel-replay" data-action="cancelreplay" aria-label="إلغاء الريبلي بالكامل وإظهار كل الشموع" title="إلغاء الريبلي بالكامل وإعادة الجلسة وكل الشموع">✕ إلغاء الريبلي بالكامل</button>');
  $('#cancel-replay')?.classList.toggle('hide',!on);
  if($('.replaybar')&&!$('#cancel-replay-bar'))$('.replaybar').insertAdjacentHTML('beforeend','<button id="cancel-replay-bar" data-action="cancelreplay" title="إظهار كامل الشارت">✕ إلغاء الريبلي وإظهار كل الشموع</button>');
  trigger?.classList.toggle('chosen',on);$$('[data-close]').forEach(b=>{b.disabled=!replayReady;b.title=replayReady?'Close at replay price':'Resume replay to close this position'});if($('#order-calculator'))$('#order-calculator').disabled=!replayReady;
}
const replayControlsV6=updateReplayControls;
updateReplayControls=function(){replayControlsV6();syncReplayVisibility()};
function cancelReplay(){
  if(!active)return;
  stop();if(replayReady)save();
  replayReady=false;active.replayStarted=false;active.replayCanceled=true;
  tool='crosshair';pending=null;cross=null;cancelDrawingGesture();
  count=bars.length;viewOffset=0;panelViews={};follow=true;
  if($('#follow'))$('#follow').textContent='Follow: On';
  save();updateChartUI();syncToolButtons();refreshViewControls();updateReplayControls();requestDraw();
  toast('تم إلغاء الريبلي بالكامل وإعادة كل الشموع. الصفقات والجورنال والرسومات محفوظة.');
}
actions.cancelreplay=cancelReplay;
const selectReplayV6=actions.selectreplay;
actions.selectreplay=()=>{if(active)active.replayCanceled=false;selectReplayV6();syncReplayVisibility()};
const uiBeforeV7=updateChartUI;
updateChartUI=function(){const browse=active&&!replayReady&&active.trades.length,visibleCount=count;if(browse)count=active.cursor;try{uiBeforeV7()}finally{count=visibleCount;syncReplayVisibility()}};
const renderBeforeV7=renderChart;
renderChart=function(){renderBeforeV7();if($('.orderside')&&!$('#order-calculator'))$('.orderside h3').insertAdjacentHTML('afterend','<button id="order-calculator" data-action="lotcalculator">▣ Risk / Lot calculator</button>');syncReplayVisibility()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active&&tool==='start'&&!modal.innerHTML)cancelReplay()});

// The same quantity calculation drives the preview and the executed simulated order.
function calculateRiskOrder(input){
  const {capital,risk,mode,entry,stop,target,side,mult,pip,commission=0,step=.01,leverage=100}=input;
  if(![capital,risk,entry,stop,target,mult,pip,step,leverage,commission].every(Number.isFinite)||capital<=0||risk<=0||entry<=0||stop<=0||target<=0||mult<=0||pip<=0||step<=0||leverage<1||commission<0||(mode!=='cash'&&risk>100))throw Error('Enter valid positive capital, risk, stop and target values.');
  const sign=side==='Buy'?1:side==='Sell'?-1:0;
  if(!sign||(entry-stop)*sign<=0||(target-entry)*sign<=0)throw Error('Stop and target must be on the correct sides of entry.');
  const budget=mode==='cash'?risk:capital*risk/100,lossPerUnit=(input.symbol==='USDJPY'?Math.abs(priceMoveValue('USDJPY',entry,stop)):Math.abs(entry-stop)*mult)+commission;
  const raw=budget/lossPerUnit,precision=Math.min(8,Math.max(0,(String(step).split('.')[1]||'').length));
  const qty=orderQuantity(raw,step);
  const actualRisk=qty*lossPerUnit,reward=qty*((input.symbol==='USDJPY'?Math.abs(priceMoveValue('USDJPY',entry,target)):Math.abs(target-entry)*mult)-commission),margin=input.symbol?positionMargin(input.symbol,entry,qty,leverage):entry*qty*mult/leverage;
  return {budget,qty,actualRisk,reward,margin,rr:actualRisk?reward/actualRisk:0,stopTicks:Math.abs(entry-stop)/pip,precision};
}
function openRiskTicket(side='Buy'){
  if(!active||!replayReady||replayLoading||(typeof panelAssetLoading!=='undefined'&&panelAssetLoading))return toast('Wait for loading to finish and select replay before opening a trade.');
  stop();const s=spec(),sign=side==='Buy'?1:-1,entry=Number((current().c+sign*(active.spread||0)*s.pip/2).toFixed(s.dec)),options=active.orderSizing||{},contracts=['NQ','ES'].includes(active.symbol),stepSize=contracts?1:active.symbol==='BTCUSD'?.0001:.01;
  const sl=+$('#sl').value||10,tp=+$('#tp').value||20;
  showDialog(`${side} ${active.symbol} · Risk / Lot calculator`,`<form id="risk-ticket" class="modcontent risk-ticket"><div class="ticket-heading"><span>Market entry</span><strong>${entry.toFixed(s.dec)}</strong><small>USD account · ${contracts?'contracts':'lots'}</small></div><div class="twocol"><label class="field"><span>Capital for sizing ($)</span><input id="ticket-capital" type="number" min="1" step="any" value="${total(active)}"></label><label class="field"><span>Risk unit</span><select id="ticket-mode"><option value="percent" ${options.mode!=='cash'?'selected':''}>% of capital</option><option value="cash" ${options.mode==='cash'?'selected':''}>Cash ($)</option></select></label><label class="field"><span>Risk</span><input id="ticket-risk" type="number" min="0.01" step="any" value="${options.risk||+$('#risk').value||.5}"></label><label class="field"><span>Stop / target input</span><select id="ticket-distance-mode"><option value="ticks">Distance (pips / ticks)</option><option value="price">Exact prices</option></select></label><label class="field"><span id="ticket-stop-label">Stop distance (pips / ticks)</span><input id="ticket-stop" type="number" min="0.000001" step="any" value="${sl}"></label><label class="field"><span id="ticket-target-label">Target distance (pips / ticks)</span><input id="ticket-target" type="number" min="0.000001" step="any" value="${tp}"></label></div><div class="ticket-presets">Risk: ${[.25,.5,1,2].map(n=>`<button type="button" data-ticket-risk="${n}">${n}%</button>`).join('')}</div><div id="ticket-preview" aria-live="polite"></div><p class="small muted">Quantity rounds down to ${stepSize} ${contracts?'contract':'lot'} steps. Includes commission. Capital above is a sizing basis; free margin uses the session balance. Fixed spread: half on entry, half on exit, with source OHLC treated as midpoint. Commission is charged once per complete trade. Opening gaps execute first; an ambiguous intrabar touch uses SL first. You can drag SL / TP after opening.</p><div id="ticket-error" class="error" role="alert"></div></form>`,button('Open '+side+' trade','confirm-risk-order','primary'),true);
  $('#modal .dialog').style.width='560px';
  const read=()=>{
    const byPrice=$('#ticket-distance-mode').value==='price';
    const stop=byPrice?+$('#ticket-stop').value:entry-sign*+$('#ticket-stop').value*s.pip,target=byPrice?+$('#ticket-target').value:entry+sign*+$('#ticket-target').value*s.pip;
    const input={capital:+$('#ticket-capital').value,risk:+$('#ticket-risk').value,mode:$('#ticket-mode').value,entry,stop,target,side,symbol:active.symbol,mult:s.mult,pip:s.pip,commission:active.commission||0,step:stepSize,leverage:active.leverage||100};
    return {...input,...calculateRiskOrder(input)};
  };
  const update=()=>{try{
    const r=read(),unit=contracts?'contracts':'lots';
    const used=active.trades.filter(t=>t.exit===undefined).reduce((sum,t)=>sum+positionMargin(active.symbol,t.entry,t.qty,active.leverage||100),0);
    const error=r.qty<=0?'Risk is below the minimum position size.':r.margin+used>total(active)?'Insufficient free margin for this position.':'';
    $('#ticket-error').textContent=error;$('#modal [data-action="confirm-risk-order"]').disabled=!!error;
    $('#ticket-preview').innerHTML=`<div class="ticket-size"><span>Calculated size</span><strong>${r.qty.toFixed(r.precision)} <small>${unit}</small></strong></div><div class="ticket-summary"><span>Risk budget <b>${money(r.budget)}</b></span><span>Actual stop risk <b>${money(r.actualRisk)}</b></span><span>Potential net reward <b>${money(r.reward)}</b></span><span>Risk / Reward <b>1 : ${r.rr.toFixed(2)}</b></span><span>Required margin <b>${money(r.margin)}</b></span><span>Free margin <b>${money(Math.max(0,total(active)-used))}</b></span><span>SL <b>${r.stop.toFixed(s.dec)}</b></span><span>TP <b>${r.target.toFixed(s.dec)}</b></span></div>`;
  }catch(err){$('#ticket-preview').innerHTML='';$('#ticket-error').textContent=err.message;$('#modal [data-action="confirm-risk-order"]').disabled=true;}};
  $('#risk-ticket').oninput=update;
  $('#risk-ticket').onsubmit=e=>{e.preventDefault();$('#modal [data-action="confirm-risk-order"]').click()};
  $('#ticket-distance-mode').onchange=e=>{const price=e.target.value==='price';for(const [id,label] of [['stop','Stop'],['target','Target']]){const el=$('#ticket-'+id),v=+el.value;el.value=price?(entry+(id==='stop'?-sign:sign)*v*s.pip).toFixed(s.dec):Number((Math.abs(v-entry)/s.pip).toFixed(4));$('#ticket-'+id+'-label').textContent=price?label+' price':label+' distance (pips / ticks)'}update()};
  $('#risk-ticket').onchange=update;
  $$('[data-ticket-risk]').forEach(b=>b.onclick=()=>{$('#ticket-mode').value='percent';$('#ticket-risk').value=b.dataset.ticketRisk;update()});
  $('#modal [data-action="confirm-risk-order"]').onclick=()=>{try{
    if(!replayReady||replayLoading||(typeof panelAssetLoading!=='undefined'&&panelAssetLoading))throw Error('Replay is loading or no longer active.');const r=read();
    const used=active.trades.filter(t=>t.exit===undefined).reduce((sum,t)=>sum+positionMargin(active.symbol,t.entry,t.qty,active.leverage||100),0);
    if(r.qty<=0)throw Error('Risk is below the minimum position size.');if(r.margin+used>total(active))throw Error('Insufficient free margin.');
    if(active.type==='Prop Firm'&&total(active)<active.balance*(1-active.maxdd/100))throw Error('Maximum drawdown limit reached.');
    active.trades.push({id:uid(),side,entry:r.entry,qty:r.qty,sl:r.stop,tp:r.target,t:current().t,bar:count,commission:r.qty*(active.commission||0),executionModel:'mid-spread-v2',spreadPrice:(active.spread||0)*s.pip,notes:'',sizing:{capital:r.capital,risk:r.risk,mode:r.mode,budget:r.budget,actualRisk:r.actualRisk}});
    active.orderSizing={risk:r.risk,mode:r.mode};$('#risk').value=r.budget/total(active)*100;$('#sl').value=Number((Math.abs(r.entry-r.stop)/s.pip).toFixed(4));$('#tp').value=Number((Math.abs(r.target-r.entry)/s.pip).toFixed(4));
    active.orderInputs={...active.orderInputs,risk:$('#risk').value,sl:$('#sl').value,tp:$('#tp').value};
    save();modal.innerHTML='';updateChartUI();fitOpenOrders();requestDraw();toast(`${side} ${r.qty} ${contracts?'contracts':'lots'} opened. Drag SL / TP to adjust.`);
  }catch(err){$('#ticket-error').textContent=err.message}};
  update();
}
function fitOpenOrders(){for(let i=0;i<layout;i++){const g=geo[i];if(!g||(typeof panelTrack==='function'&&panelTrack(i)?.session.symbol!==active.symbol))continue;const prices=active.trades.filter(t=>t.exit===undefined).flatMap(t=>[t.entry,t.sl,t.tp]),lo=Math.min(g.lo,...prices),hi=Math.max(g.hi,...prices),pad=Math.max((hi-lo)*.08,spec().pip*2);panelViews[i]={manual:true,lo:lo-pad,hi:hi+pad}}refreshViewControls()}
place=function(side){openRiskTicket(side)};
actions.buy=()=>openRiskTicket('Buy');actions.sell=()=>openRiskTicket('Sell');actions.lotcalculator=()=>openRiskTicket('Buy');
const closeTradeBeforeV7=closeTrade;
closeTrade=function(...args){if(!replayReady)return toast('Resume replay before closing a simulated position.');return closeTradeBeforeV7(...args)};

// Shared drawing palette, exact HEX values and reusable recent colors.
const DRAWING_PALETTE=[
'#ffffff','#d1d4dc','#b2b5be','#9598a1','#787b86','#5d606b','#434651','#2a2e39','#131722','#000000',
'#f23645','#ff9800','#ffeb3b','#4caf50','#089981','#00bcd4','#2962ff','#673ab7','#9c27b0','#e91e63',
'#f8bbd0','#ffe0b2','#fff9c4','#c8e6c9','#b2dfdb','#b2ebf2','#bbdefb','#d1c4e9','#e1bee7','#f48fb1',
'#ef9a9a','#ffcc80','#fff59d','#a5d6a7','#80cbc4','#80deea','#90caf9','#b39ddb','#ce93d8','#f06292',
'#e57373','#ffb74d','#fff176','#81c784','#4db6ac','#4dd0e1','#64b5f6','#9575cd','#ba68c8','#ec407a',
'#d32f2f','#f57c00','#fbc02d','#388e3c','#00796b','#0097a7','#1976d2','#512da8','#7b1fa2','#c2185b',
'#b71c1c','#e65100','#f57f17','#1b5e20','#004d40','#006064','#0d47a1','#311b92','#4a148c','#880e4f'];
let paletteTarget=null;
function closeDrawingPalette(){$('#drawing-palette')?.remove();paletteTarget=null}
function openDrawingPalette(input){
  closeDrawingPalette();paletteTarget=input;const r=input.getBoundingClientRect(),panel=document.createElement('div');
  panel.id='drawing-palette';panel.className='drawing-palette';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Drawing color palette');
  panel.style.left=Math.max(8,Math.min(r.left,innerWidth-285))+'px';panel.style.top=Math.max(8,Math.min(r.bottom+6,innerHeight-365))+'px';
  panel.innerHTML=`<div class="palette-title">Color <button type="button" data-close-palette aria-label="Close color palette">×</button></div><div class="palette-grid">${DRAWING_PALETTE.map(c=>`<button type="button" style="background:${c}" data-palette-color="${c}" aria-label="Color ${c}" title="${c}"></button>`).join('')}</div><p class="small muted">Recent</p><div class="palette-recent">${(state.recentDrawingColors||[]).slice(0,10).map(c=>`<button type="button" style="background:${c}" data-palette-color="${c}" aria-label="Recent ${c}"></button>`).join('')}</div><label class="field"><span>Custom HEX</span><input id="palette-hex" value="${input.value}" maxlength="7" pattern="#[0-9a-fA-F]{6}" aria-label="Custom HEX"></label><button type="button" id="palette-use-hex">Use color</button><span id="palette-error" role="alert" class="error"></span>`;
  document.body.append(panel);
  const apply=color=>{if(!/^#[0-9a-f]{6}$/i.test(color)){$('#palette-error').textContent='Use #RRGGBB.';return}input.value=color;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));state.recentDrawingColors=[color,...(state.recentDrawingColors||[]).filter(c=>c!==color)].slice(0,10);save();closeDrawingPalette()};
  panel.querySelectorAll('[data-palette-color]').forEach(b=>b.onclick=()=>apply(b.dataset.paletteColor));
  $('#palette-use-hex').onclick=()=>apply($('#palette-hex').value.trim());
  $('#palette-hex').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();apply(e.target.value.trim())}};
  panel.querySelector('[data-close-palette]').onclick=closeDrawingPalette;
}
function attachDrawingPalettes(root){
  root?.querySelectorAll('input[type="color"]').forEach(input=>{
    if(input.dataset.paletteReady)return;input.dataset.paletteReady='1';if(!input.getAttribute('aria-label')){const label=input.closest('label')?.querySelector('span')?.textContent;if(label)input.setAttribute('aria-label',label)}
    input.classList.add('square-color');input.title='Color palette';
    input.onclick=e=>{e.preventDefault();e.stopPropagation();openDrawingPalette(input)};
    input.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDrawingPalette(input)}};
  });
}
function paintLineEnding(ctx,point,other,kind,s){
  if(kind==='none'||!kind)return;ctx.save();ctx.setLineDash([]);ctx.strokeStyle=s.color;ctx.fillStyle=s.color;const a=Math.atan2(point.y-other.y,point.x-other.x),r=5+(+s.width||2);
  if(kind==='circle'){ctx.beginPath();ctx.arc(point.x,point.y,r/1.5,0,Math.PI*2);ctx.fill()}
  else if(kind==='arrow'){strokeSegment(ctx,[point,{x:point.x-r*2*Math.cos(a-.45),y:point.y-r*2*Math.sin(a-.45)}]);strokeSegment(ctx,[point,{x:point.x-r*2*Math.cos(a+.45),y:point.y-r*2*Math.sin(a+.45)}])}
  else if(kind==='bar')strokeSegment(ctx,[{x:point.x+r*Math.cos(a+Math.PI/2),y:point.y+r*Math.sin(a+Math.PI/2)},{x:point.x-r*Math.cos(a+Math.PI/2),y:point.y-r*Math.sin(a+Math.PI/2)}]);
  ctx.restore();
}
function enhanceDrawingSettings(draft){
  const section=$('[data-ds-section="style"]'),s=drawingStyle(draft);
  if(!section)return;
  const extra=document.createElement('div');extra.className='drawing-extra-controls';
  extra.innerHTML=`<label class="field"><span>Opacity (%)</span><input id="dsopacity" type="range" min="0" max="100" step="1" value="${Math.round((s.opacity??1)*100)}"></label>${['rect','ellipse','channel'].includes(draft.type)?`<label class="field"><span>Fill color</span><input id="dsfillcolor" type="color" value="${s.fillColor||s.color}"></label>${draft.type!=='channel'?checkControl('dsborder','Border',s.border!==false):''}`:''}${['trend','ray','extended','arrow'].includes(draft.type)?`<div class="twocol">${selectControl('dsstartending','Start point',s.startEnding||'none',['none','arrow','circle','bar'])}${selectControl('dsendending','End point',s.endEnding??(draft.type==='arrow'?'arrow':'none'),['none','arrow','circle','bar'])}</div>`:''}${isFib(draft)?`${selectControl('dsfibvertical','Label vertical alignment',draft.fib?.labelVertical||'top',['top','middle','bottom'])}<div class="row fib-preset-controls"><button type="button" data-fib-level-preset="standard">Standard levels</button><button type="button" data-fib-level-preset="extensions">Extension levels</button></div>`:''}`;
  section.append(extra);enhanceFibAndRectangleSettings(draft,section);enhanceFibCoordinatesAndVisibility(draft);attachDrawingPalettes($('#dsform'));
  if(isFib(draft))$$('[data-fib-level-preset]').forEach(b=>b.onclick=()=>{
    const ratios=b.dataset.fibLevelPreset==='standard'?[0,.236,.382,.5,.618,.786,1]:[0,.618,1,1.272,1.618,2,2.618,3.618,4.236];
    $('#dslevels').innerHTML=levelEditorRows(ratios.map((value,i)=>({enabled:true,value,color:fibPalette[i%fibPalette.length],width:2,dash:'solid'})));attachDrawingPalettes($('#dslevels'));$('#dsform').dispatchEvent(new Event('input',{bubbles:true}));
  });
}
const barBeforeV7=refreshDrawingBar;
refreshDrawingBar=function(){barBeforeV7();attachDrawingPalettes($('#drawingbar'))};
document.addEventListener('click',e=>{if(!e.target.closest('#drawing-palette')&&!e.target.closest('.palette-open,.square-color'))closeDrawingPalette();if(e.target.closest('[data-ds-add-level],[data-ds-remove-level]'))attachDrawingPalettes($('#dslevels'))});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawingPalette()});
function enhanceFibAndRectangleSettings(draft,section){
  const s=drawingStyle(draft),cfg=draft.fib||{};
  if(draft.type==='rect'){
    const field=document.createElement('fieldset');field.className='ds-point';field.innerHTML=`<legend>Middle line</legend>${checkControl('dsmidline','Middle line',!!s.middleLine)}<div class="ds-row"><label class="field"><span>Middle line color</span><input id="dsmidcolor" type="color" value="${s.middleColor||s.color}"></label>${selectControl('dsmidwidth','Width',s.middleWidth||1,[1,2,3,4,5,6])}${selectControl('dsmiddash','Line style',s.middleDash||'dashed',['solid','dashed','dotted'])}</div>`;section.append(field);
  }
  if(!isFib(draft))return;
  const field=document.createElement('fieldset');field.className='ds-point fib-advanced';field.innerHTML=`<legend>Trend line & labels</legend><div class="ds-row"><label class="field"><span>Trend line color</span><input id="dsfibtrendcolor" type="color" value="${cfg.trendColor||s.color}"></label>${selectControl('dsfibtrendwidth','Trend line width',cfg.trendWidth||1,[1,2,3,4,5,6])}${selectControl('dsfibtrenddash','Trend line style',cfg.trendDash||'dashed',['solid','dashed','dotted'])}</div><div class="twocol"><label class="field"><span>Use one color for all levels</span><input type="color" id="dsfibonecolor" value="${cfg.levels?.[0]?.color||s.color}"></label><button type="button" id="dsfibapplycolor">Apply to all levels</button></div><div class="ds-checks">${checkControl('dsfibtext','Text',cfg.showText!==false)}${checkControl('dsfiblog','Fib levels based on log scale',!!cfg.logScale)}</div><div class="twocol">${selectControl('dsfibtextside','Text horizontal alignment',cfg.textSide||'center',['left','center','right'])}${selectControl('dsfibtextvertical','Text vertical alignment',cfg.textVertical||'middle',['top','middle','bottom'])}</div><p class="small muted">Logarithmic Fibonacci calculations apply when the chart price scale is set to Log. Open “Text & opacity” on a level to add its own text.</p><button type="button" id="dsfibobserved">TradingView inspected preset</button>`;section.append(field);
  for(const [id,prop] of [['dswidth','width'],['dsdash','dash']])$('#'+id).addEventListener('change',()=>{$$('[data-level-prop="'+prop+'"]').forEach(el=>el.value=$('#'+id).value);$('#dsform').dispatchEvent(new Event('input',{bubbles:true}))});
  $('#dsfiblog').disabled=chartPrefs.scale!=='log';
  $('#dsfibapplycolor').onclick=()=>{$$('[data-level-prop="color"]').forEach(el=>el.value=$('#dsfibonecolor').value);$('#dsform').dispatchEvent(new Event('input',{bubbles:true}))};
  $('#dsfibobserved').onclick=()=>{const ratios=draft.type==='fibext'?[0,.236,1,.5,2,.786,1.809,1.618,2.618,3.618,1.618,1.272,.618,2.272,.786,2,3,3.272,3.414,4,4.272,4.414,4.618,4.764]:[0,0,.5,.3,.7,.786,1,1,2.618,3.618,4.236,1.272,1.414,2.272,2.414,2,3,3.272,3.414,4,4.272,4.414,4.618,4.764],enabled=draft.type==='fibext'?[0,2,4,6,8,10,12,14]:[1,2,3,4,7];$('#dslevels').innerHTML=levelEditorRows(ratios.map((value,i)=>({value,enabled:enabled.includes(i),color:'#0f0f0f',width:1,dash:'solid'})));for(const [id,value] of Object.entries({dsfiblabels:true,dsfibprices:false,dsfibpercent:false,dsfibreverse:false,dsfibbackground:false,dsfibtrend:draft.type==='fibext',dsextleft:false,dsextright:false,dsfibtext:true,dsfiblog:false}))$('#'+id).checked=value;$('#dswidth').value='1';$('#dsdash').value='solid';$('#dscolor').value='#0f0f0f';$('#dsfibtextside').value='center';$('#dsfibtextvertical').value='middle';$('#dsfibtrendwidth').value='1';$('#dsfibtrenddash').value='dashed';$('#dsfibalign').value='right';$('#dsfibvertical').value='middle';$('#dslabelfont').value='10';$('#dsfibtrendcolor').value='#0f0f0f';attachDrawingPalettes($('#dslevels'));$('#dsform').dispatchEvent(new Event('input',{bubbles:true}))};
}

function enhanceFibCoordinatesAndVisibility(draft){
  const g=geo[draft.panel??activePanel];
  if(!isFib(draft))return;
  if(settingsTarget&&g)for(const input of $$('[data-anchor-time]')){
    const key=input.dataset.anchorTime,label=document.createElement('label');label.className='field';label.innerHTML=`<span>Bar ${key.toUpperCase()} (current chart interval)</span><input type="number" step="any" data-anchor-bar="${key}" aria-label="Bar ${key.toUpperCase()}" value="${Number(indexAtTime(g.data,draft[key].t,g.frame).toFixed(6))}">`;input.closest('.twocol').append(label);const bar=label.querySelector('input');bar.oninput=()=>{const n=Number(bar.value);if(Number.isFinite(n)&&Math.abs(n)<1e8)input.value=coordinateDate(timeAtIndex(g.data,n,g.frame))};input.addEventListener('input',()=>{const t=Date.parse(input.value+'Z');if(Number.isFinite(t))bar.value=Number(indexAtTime(g.data,t,g.frame).toFixed(6))});
  }
  const section=$('[data-ds-section="visibility"]'),ranges=document.createElement('div');ranges.className='fib-visibility-ranges';
  const groups=[['Minutes',1,59,f=>f<60,f=>f],['Hours',1,24,f=>f>=60&&f<1440,f=>f/60],['Days',1,366,f=>f===1440,f=>f/1440],['Weeks',1,52,f=>f===10080,f=>f/10080],['Months',1,12,f=>f===43200,f=>f/43200],['Years',1,100,f=>f===525600,f=>f/525600]];
  for(const [name,min,max,belongs,units] of groups){const frames=DRAWING_FRAMES.filter(belongs),enabled=frames.filter(f=>draft.visibility.includes(f)),row=document.createElement('div');row.className='fib-visibility-row';row.innerHTML=`<label class="check"><input type="checkbox" aria-label="${name} visibility" ${enabled.length?'checked':''}>${name}</label><input type="number" aria-label="${name} from" min="${min}" max="${max}" value="${enabled.length?Math.min(...enabled.map(units)):min}"><span>—</span><input type="number" aria-label="${name} to" min="${min}" max="${max}" value="${enabled.length?Math.max(...enabled.map(units)):max}">`;const [toggle,from,to]=row.querySelectorAll('input');row.addEventListener('input',()=>{for(const frame of frames)$('#dsframe'+frame).checked=toggle.checked&&units(frame)>=Number(from.value)&&units(frame)<=Number(to.value);$('#dsform').dispatchEvent(new Event('input',{bubbles:true}))});ranges.append(row)}
  section.insertBefore(ranges,section.querySelector('.ds-frames'));
}
