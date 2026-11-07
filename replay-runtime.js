'use strict';
// One cancellable playback clock and one execution path for timer and manual steps.
let replayRunToken=0,replayLoading=false,replayLoadRequest=0,replayViewAnchors=new Map();
function replayCursor(data,value){return Math.max(1,Math.min(data.length||1,Number.isFinite(value)?Math.floor(value):1))}
function nextReplayCursor(data,cursor,mode='source',chartFrame=1){
  const n=replayCursor(data,cursor);if(n>=data.length)return data.length;
  if(mode==='source')return n+1;
  const minutes=mode==='chart'?chartFrame:Number(mode);
  if(!Number.isFinite(minutes)||minutes<=0)return n+1;
  const duration=minutes*60000,bucket=Math.max(Math.floor(data[n-1].t/duration)+1,Math.floor(data[n].t/duration)),end=shiftFrameTime(Math.max(shiftFrameTime(frameStart(data[n-1].t,minutes),1,minutes),frameStart(data[n].t,minutes)),1,minutes);
  let low=n,high=data.length;
  while(low<high){const mid=(low+high)>>1;if(data[mid].t<end)low=mid+1;else high=mid;}
  return Math.max(n+1,low);
}
function replayIntervalMode(){return active?.replayInterval||'chart'}
function playbackDelay(){const value=Number($('#speed')?.value||active?.replaySpeed||1000);return [100,200,500,1000].includes(value)?value:1000}
const stopBeforeRuntime=stop;
stop=function(){replayRunToken++;clearTimeout(timer);stopBeforeRuntime()};
function canRunReplay(){return !!active&&replayReady&&!replayEntryPending&&!replayLoading&&(typeof panelAssetLoading==='undefined'||!panelAssetLoading)&&tool!=='start'&&!modal.innerHTML}
function advanceReplay(){
  if(!canRunReplay())return false;
  count=replayCursor(bars,count);if(count>=bars.length){stop();return false;}
  const target=nextReplayCursor(bars,count,replayIntervalMode(),frames[activePanel]||frames[0]||1);
  const positions=active.trades.filter(t=>t.exit===undefined);
  while(count<target){
    count++;const bar=bars[count-1];
    for(const trade of positions){
      if(trade.exit!==undefined)continue;
      const fill=resolveTradeBar(trade,bar);
      if(fill)closeTrade(trade,fill.price,fill.reason,false,fill.execution);
    }
  }
  if(follow)viewOffset=0;
  save();updateChartUI();requestDraw();
  if(count>=bars.length)stop();
  return true;
}
play=function(){
  if(!canRunReplay())return toast('Select a replay candle and close any open dialog before Play.');
  if(playing)return;
  count=replayCursor(bars,count);if(count>=bars.length){updateReplayControls();return toast('End of historical data.');}
  clearTimeout(timer);playing=true;const token=++replayRunToken,sessionId=active.id;
  const tick=()=>{
    if(token!==replayRunToken)return;
    timer=null;
    if(!playing||active?.id!==sessionId||!canRunReplay()){
      if(token===replayRunToken)stop();return;
    }
    try{advanceReplay();}catch(error){stop();toast('Replay paused: '+error.message);return;}
    if(playing&&token===replayRunToken&&count<bars.length)timer=setTimeout(tick,playbackDelay());
  };
  $('#play').textContent='Ⅱ';$('#play').setAttribute('aria-label','Pause replay');
  updateReplayControls();timer=setTimeout(tick,playbackDelay());
};
step=function(){
  if(!canRunReplay())return toast('Select a replay candle and close any open dialog before stepping.');
  stop();advanceReplay();
};
actions.step=step;actions.play=()=>playing?stop():play();
// Opening controls always freezes playback. Closing a dialog never silently restarts it.
const dialogBeforeRuntime=showDialog;
showDialog=function(...args){if(playing)stop();return dialogBeforeRuntime(...args)};
const seekBeforeRuntime=seek;
seek=function(n){if(!active||replayLoading||replayEntryPending)return;stop();seekBeforeRuntime(replayCursor(bars,n));if(replayReady){active.replayCanceled=false;active.replayStarted=true;replayViewAnchors.clear();save();updateReplayControls()}};
const selectBeforeRuntime=actions.selectreplay;
actions.selectreplay=()=>{
  if(!active||replayLoading||replayEntryPending)return;
  stop();
  if(tool==='start'){
    if(replayReady){tool='crosshair';pending=null;syncToolButtons();updateReplayControls();requestDraw();}
    else actions.cancelreplay();
    return;
  }
  selectBeforeRuntime();replayViewAnchors.clear();updateReplayControls();
};
// Follow off anchors the visible time range even while new replay bars are appended.
function replayLogicalStart(panel,data,slots,rightMargin,offset){
  const standard=Math.max(-slots,data.length-slots+rightMargin-offset);
  if(!replayReady||follow){replayViewAnchors.delete(panel);return standard;}
  const previous=replayViewAnchors.get(panel),frame=frames[panel];
  let start=standard;
  if(previous&&previous.frame===frame&&previous.slots===slots)start=previous.start-(offset-previous.offset);
  replayViewAnchors.set(panel,{start,offset,slots,frame});return start;
}
const replayControlsBeforeRuntime=updateReplayControls;
updateReplayControls=function(){
  replayControlsBeforeRuntime();if(!active||!$('#play'))return;
  const end=replayReady&&count>=bars.length,selecting=tool==='start';
  const blocked=selecting||replayEntryPending||replayLoading||(typeof panelAssetLoading!=='undefined'&&panelAssetLoading);$$('[data-action="buy"],[data-action="sell"],[data-close]').forEach(b=>b.disabled=!replayReady||blocked);if($('#order-calculator'))$('#order-calculator').disabled=!replayReady||blocked;$('#play').disabled=end||blocked;
  $('[data-action="step"]').disabled=end||blocked;
  if(replayReady&&$('#replaystatus')){$('#replaystatus').textContent=(replayLoading||(typeof panelAssetLoading!=='undefined'&&panelAssetLoading))?'Loading data · replay paused':end?'End of data':selecting?'Choose a new starting candle':playing?'Replay running':'Replay paused';}
  const interval=$('#replay-interval');if(interval)interval.value=replayIntervalMode();
  const mode=replayIntervalMode(),label=mode==='source'?'source bar':mode==='chart'?frameLabel(frames[activePanel]||1):frameLabel(Number(mode));
  if($('#replay-step-label'))$('#replay-step-label').textContent='Step: '+label;
  $('#play').title=end?'End of available data':playing?'Pause replay':'Play replay';
  const select=$('.replaybar [data-action="selectreplay"]');
  if(select){select.textContent=active.trades.length?'⌖ Saved point':'⌖ Select start';select.title=active.trades.length?'Resume saved point; start a new session to change time after trading':'Select a replay starting candle';}
};
const renderBeforeRuntime=renderChart;
renderChart=function(){
  activePanel=Math.max(0,Math.min(layout-1,activePanel));
  renderBeforeRuntime();$('.chartapp').dataset.sessionId=active.id;
  const speed=$('#speed');speed.value=String(active.replaySpeed||active.orderInputs?.speed||1000);
  if(![100,200,500,1000].includes(+speed.value))speed.value='1000';
  speed.onchange=()=>{const running=playing;stop();active.replaySpeed=+speed.value;active.orderInputs={...active.orderInputs,speed:speed.value};save();if(running)play()};
  if(!$('#replay-interval'))speed.insertAdjacentHTML('afterend',`<select id="replay-interval" aria-label="Replay step interval" title="Each step processes all source bars up to the next replay candle"><option value="chart">Chart candle</option><option value="source">Source bar</option>${CHART_FRAMES.map(m=>`<option value="${m}">${frameLabel(m)}</option>`).join('')}</select><span id="replay-step-label" class="small muted"></span>`);
  $('#replay-interval').onchange=e=>{const mode=e.target.value;stop();active.replayInterval=mode;save();updateReplayControls()};
  updateReplayControls();
};
const openBeforeRuntime=openSession;
openSession=async function(id){
  const request=++replayLoadRequest;if(active&&replayReady)save();stop();replayLoading=true;replayViewAnchors.clear();
  try{await openBeforeRuntime(id);}finally{if(request===replayLoadRequest){replayLoading=false;updateReplayControls();}}
};
const cancelBeforeRuntime=actions.cancelreplay;
actions.cancelreplay=()=>{stop();replayViewAnchors.clear();cancelBeforeRuntime()};
const backBeforeRuntime=actions.back;
actions.back=()=>{if(active&&replayReady)save();stop();replayLoadRequest++;sessionLoadVersion++;replayLoading=false;replayViewAnchors.clear();finishReplayEntry();backBeforeRuntime()};
// These capture handlers prevent key repeat toggles and buttons from advancing behind dialogs.
document.addEventListener('keydown',e=>{
  if(!active||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||e.target.isContentEditable)return;
  if(e.code==='Space'||e.code==='ArrowRight'){
    if(e.repeat||replayEntryPending||replayLoading||modal.innerHTML||tool==='start'){
      e.preventDefault();e.stopImmediatePropagation();return;
    }
  }
  if(e.key==='Escape'&&tool==='start'&&!modal.innerHTML){
    e.preventDefault();e.stopImmediatePropagation();
    if(replayReady){tool='crosshair';pending=null;syncToolButtons();updateReplayControls();requestDraw();}
    else actions.cancelreplay();
  }
},true);
document.addEventListener('click',e=>{if(!active||!e.target.closest('[data-interval]'))return;if(playing&&replayIntervalMode()==='chart'){stop();toast('Replay paused after changing timeframe. Press Play when ready.');}else updateReplayControls()});
document.addEventListener('change',e=>{if(!active||!e.target.matches('[data-frame]'))return;if(playing&&replayIntervalMode()==='chart')stop();else updateReplayControls()});
document.addEventListener('pointerdown',e=>{const panel=e.target.closest('.chartcanvas');if(panel&&Number(panel.dataset.chart)!==activePanel&&playing&&replayIntervalMode()==='chart')stop()},true);
document.addEventListener('pointerdown',e=>{if(active&&e.target.closest('.chartcanvas'))updateReplayControls()});
const drawBeforeRuntime=draw;
draw=function(canvas,panel){
  drawBeforeRuntime(canvas,panel);
  if(!replayReady||replayEntryPending||!geo[panel]||!bars[count-1])return;
  const g=geo[panel],time=frameStart(bars[count-1].t,g.frame),x=g.tx(time);
  if(x<0||x>g.cw)return;
  const ctx=canvas.getContext('2d');ctx.save();ctx.strokeStyle='#4e91ff';ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.beginPath();ctx.moveTo(x,g.top);ctx.lineTo(x,g.bot);ctx.stroke();ctx.setLineDash([]);ctx.font='10px Arial';ctx.textAlign='left';ctx.fillStyle='#244f91';const left=Math.min(Math.max(2,x-24),g.cw-54);ctx.fillRect(left,g.bot-19,52,18);ctx.fillStyle='#fff';ctx.fillText('REPLAY',left+6,g.bot-6);ctx.restore();
};

// Source OHLC is treated as midpoint for new orders; legacy positions retain their old model.
function resolveTradeBar(trade,source){
  const buy=trade.side==='Buy',bar=Object.fromEntries(['o','h','l','c'].map(key=>[key,marketExitPrice(trade,source[key])])),hitStop=buy?bar.l<=trade.sl:bar.h>=trade.sl,hitTarget=buy?bar.h>=trade.tp:bar.l<=trade.tp;
  const stopAtOpen=buy?bar.o<=trade.sl:bar.o>=trade.sl,targetAtOpen=buy?bar.o>=trade.tp:bar.o<=trade.tp;
  const execution={policy:'open-first-sl-first-v2',model:trade.executionModel||'legacy-entry-spread',sourceTime:source.t,ambiguous:false,gap:false};
  if(stopAtOpen)return {price:bar.o,reason:'Stop loss',execution:{...execution,gap:bar.o!==trade.sl}};
  if(targetAtOpen)return {price:trade.tp,reason:'Take profit',execution:{...execution,gap:bar.o!==trade.tp}};
  if(hitStop)return {price:trade.sl,reason:'Stop loss',execution:{...execution,ambiguous:hitTarget}};
  if(hitTarget)return {price:trade.tp,reason:'Take profit',execution};
  return null;
}
