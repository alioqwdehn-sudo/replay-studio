'use strict';
// Runs share source data, but never execute trades from a different replay timeline.
let newReplaySelection=null;
function replayRunSnapshot(session,drawings=session.drawings||[]){
  session.currentRunId??=uid();session.currentRunNumber??=1;
  return {id:session.currentRunId,number:session.currentRunNumber,savedAt:Date.now(),balance:session.balance,cursor:session.cursor,trades:clone(session.trades||[]),drawings:clone(drawings),replayStarted:!!session.replayStarted,replayCanceled:!!session.replayCanceled,orderInputs:clone(session.orderInputs||{}),orderSizing:clone(session.orderSizing||{}),replaySpeed:session.replaySpeed||1000,replayInterval:session.replayInterval||'chart'};
}
function archiveCurrentReplayRun(){
  if(!active.replayStarted&&!active.trades.length)return;
  const snapshot=replayRunSnapshot(active,chartObjects);active.replayRuns??=[];
  active.replayRuns=active.replayRuns.filter(r=>r.id!==snapshot.id);active.replayRuns.push(snapshot);
}
function enterNewReplaySelection(){
  if(!active)return;stop();if(replayReady)save();modal.innerHTML='';
  newReplaySelection={sessionId:active.id};
  finishReplayEntry();replayReady=false;count=bars.length;viewOffset=0;follow=true;panelViews={};replayViewAnchors.clear();
  tool='start';pending=null;cross=null;syncToolButtons();updateReplayControls();requestDraw();
  toast('Choose a candle for the NEW replay. Previous trades stay saved until you choose.');
}
function commitNewReplayRun(cursor){
  if(!active||newReplaySelection?.sessionId!==active.id)return;
  stop();const chosen=replayCursor(bars,cursor);
  archiveCurrentReplayRun();
  const next=Math.max(active.currentRunNumber||1,...(active.replayRuns||[]).map(r=>r.number||1))+1;
  active.currentRunId=uid();active.currentRunNumber=next;active.trades=[];drawingUndo=[];drawingRedo=[];selectedDrawing=null;
  active.cursor=chosen;active.replayStarted=true;active.replayCanceled=false;
  count=chosen;replayReady=true;newReplaySelection=null;tool='crosshair';pending=null;cross=null;
  viewOffset=0;follow=true;panelViews={};replayViewAnchors.clear();
  save();renderChart();updateChartUI();syncToolButtons();requestDraw();
  toast('New replay started and paused. Previous runs are available in Replay runs and Trades.');
}
function resumeCurrentRun(){
  if(!active)return;stop();modal.innerHTML='';newReplaySelection=null;finishReplayEntry();
  replayReady=true;count=replayCursor(bars,active.cursor);active.replayStarted=true;active.replayCanceled=false;
  tool='crosshair';pending=null;viewOffset=0;follow=true;panelViews={};replayViewAnchors.clear();save();renderChart();updateChartUI();requestDraw();
}
function chooseReplayRun(){
  stop();showDialog('اختيار الريبلي',`<div class="modcontent" dir="rtl" style="line-height:1.9"><h3>تريد ريبلي جديد لو تكمل القديم؟</h3><p><b>ريبلي جديد:</b> تختار شمعة جديدة بنفس السشن، ويبدأ الحساب برأس مال السشن ${money(active.balance)}.</p><p>المحاولة الحالية تنحفظ بصفقاتها والجورنال والرسومات. الصفقات القديمة المفتوحة تتوقف ضمن المحاولة المحفوظة، وما تتنفّذ على الزمن الجديد.</p><p class="muted small">ما يتغيّر شيء لحد ما تختار شمعة البداية. تكدر ترجع للمحاولة القديمة من Replay runs.</p></div>`,button('إلغاء الريبلي بالكامل وإظهار كل الشموع','cancel-full-replay','ghost')+button('نكمل الريبلي الحالي','resume-current-run','ghost')+button('اختيار بداية ريبلي جديد','choose-new-run','primary'));
  $('#modal .dialog').style.width='550px';
}
const selectBeforeRuns=actions.selectreplay;
actions.selectreplay=()=>{
  if(!active||replayLoading||replayEntryPending)return;
  if(tool==='start'){actions.cancelreplay();return;}
  if(active.replayStarted||active.trades.length){chooseReplayRun();return;}
  selectBeforeRuns();
};
const seekBeforeRuns=seek;
seek=function(cursor){
  if(!active||replayLoading||replayEntryPending)return;
  if(newReplaySelection?.sessionId===active.id){commitNewReplayRun(cursor);return;}
  if(active.trades.length){
    stop();const target=replayCursor(bars,cursor);
    showDialog('ريبلي جديد من هذا الوقت؟',`<div class="modcontent" dir="rtl"><p>السشن بيه صفقات قديمة. حتى نغيّر وقت البداية إلى <b dir="ltr">${date(bars[target-1].t)} UTC</b>، نحفظ المحاولة الحالية ونبدأ ريبلي جديد بنفس السشن.</p></div>`,button('بدء ريبلي جديد','confirm-new-run-date','primary'));
    $('#modal [data-action="confirm-new-run-date"]').onclick=()=>{modal.innerHTML='';newReplaySelection={sessionId:active.id};commitNewReplayRun(target)};return;
  }
  seekBeforeRuns(cursor);
};
function restoreReplayRun(id){
  const run=active?.replayRuns?.find(r=>r.id===id);if(!run)return;
  stop();if(replayReady)save();const restored=clone(run);archiveCurrentReplayRun();
  active.replayRuns=active.replayRuns.filter(r=>r.id!==id);
  for(const key of ['balance','cursor','trades','drawings','orderInputs','orderSizing','replaySpeed','replayInterval'])active[key]=clone(restored[key]??(key==='trades'||key==='drawings'?[]:{}));
  active.currentRunId=restored.id;active.currentRunNumber=restored.number;
  chartObjects=clone(restored.drawings||[]);drawingUndo=[];drawingRedo=[];selectedDrawing=null;
  active.replayStarted=true;active.replayCanceled=false;newReplaySelection=null;finishReplayEntry();modal.innerHTML='';
  replayReady=true;count=replayCursor(bars,active.cursor);tool='crosshair';pending=null;viewOffset=0;follow=true;panelViews={};replayViewAnchors.clear();
  save();renderChart();updateChartUI();requestDraw();toast('Saved replay run restored and paused.');
}
function replayRunsDialog(){
  if(!active)return;stop();showDialog('Replay runs',`<div class="modcontent replay-runs-list"><p>Current: Run ${active.currentRunNumber||1} · ${active.trades.length} trades</p><p class="muted small">Each run has its own balance, replay point and trades. Journal notes are also available from the Trades dashboard.</p>${(active.replayRuns||[]).slice().reverse().map(r=>`<div class="run-row"><span><b>Run ${r.number}</b><small>${r.trades.length} trades · ${date(bars[replayCursor(bars,r.cursor)-1].t)} UTC</small></span><button data-restore-run="${r.id}">Restore run ${r.number}</button></div>`).join('')||'<p>No previous runs yet.</p>'}</div>`);
}
actions['choose-new-run']=enterNewReplaySelection;actions['resume-current-run']=resumeCurrentRun;actions.replayruns=replayRunsDialog;
const cancelBeforeRuns=actions.cancelreplay;actions.cancelreplay=()=>{newReplaySelection=null;cancelBeforeRuns()};
actions['cancel-full-replay']=()=>{modal.innerHTML='';actions.cancelreplay()};
const backBeforeRuns=actions.back;actions.back=()=>{newReplaySelection=null;backBeforeRuns()};
const openBeforeRuns=openSession;openSession=async function(id){newReplaySelection=null;await openBeforeRuns(id)};
const renderBeforeRuns=renderChart;renderChart=function(){renderBeforeRuns();if(!$('#replay-runs-button'))$('.charttop [data-action="selectreplay"]').insertAdjacentHTML('afterend','<button id="replay-runs-button" data-action="replayruns" title="Restore a previous replay run">Replay runs</button>')};
const controlsBeforeRuns=updateReplayControls;updateReplayControls=function(){controlsBeforeRuns();if(!active)return;const button=$('.replaybar [data-action="selectreplay"]');if(button){button.textContent='⌖ New start';button.title='Choose a new replay start in this session'}if(newReplaySelection&&$('#replaystatus'))$('#replaystatus').textContent='Select NEW replay start · previous run preserved'};
document.addEventListener('click',e=>{const button=e.target.closest('[data-restore-run]');if(button)restoreReplayRun(button.dataset.restoreRun)});

const savedChoiceBeforeRuns=showSavedReplayChoice;showSavedReplayChoice=function(){savedChoiceBeforeRuns();if(replayEntryPending)$('#modal .dialogfoot')?.insertAdjacentHTML('beforeend',button('ريبلي جديد','choose-new-run','primary'))};
