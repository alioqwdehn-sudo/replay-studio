'use strict';
// Opening a saved replay requires a choice; cancelled sessions remain in browse mode.
let replayEntryPending=false,replayEntrySession=null,replayOpenRequest=0;
function hasSavedReplay(session){
  return !!session&&session.replayCanceled!==true&&Number.isFinite(session.cursor)&&session.cursor>0&&!!(session.replayStarted||session.trades?.length);
}
function finishReplayEntry(){
  replayEntryPending=false;replayEntrySession=null;
  $('.chartapp')?.classList.remove('replay-entry-pending');
}
function continueSavedReplay(){
  if(!active||active.id!==replayEntrySession)return;
  const saved=Math.max(1,Math.min(bars.length,active.cursor));
  finishReplayEntry();modal.innerHTML='';stop();
  replayReady=true;active.replayStarted=true;active.replayCanceled=false;
  count=saved;tool='crosshair';pending=null;cross=null;viewOffset=0;follow=true;panelViews={};
  save();renderChart();updateChartUI();syncToolButtons();requestDraw();
  toast('Replay restored at the saved candle. Press Play to continue.');
}
function cancelSavedReplay(){
  if(!active)return;
  finishReplayEntry();modal.innerHTML='';actions.cancelreplay();requestDraw();
}
function showSavedReplayChoice(){
  if(!active||!replayEntryPending)return;
  replayEntrySession=active.id;
  $('.chartapp')?.classList.add('replay-entry-pending');
  const time=bars[Math.max(0,Math.min(bars.length-1,active.cursor-1))]?.t;
  showDialog('نكمل الريبلي؟',`<div class="modcontent replay-resume-choice" dir="rtl"><p class="replay-choice-name">${esc(active.name)}</p><h3>تريد نكمل من وين تركنا؟</h3><p>آخر نقطة محفوظة: <b dir="ltr">${time===undefined?'—':date(time)+' UTC'}</b></p><p>إذا تكمل، يرجع الشارت لنفس الشمعة ويبقى متوقف لحد ما تضغط Play.</p><p class="muted small">إلغاء الريبلي يفتح كامل الشارت ويخفي تحكّمه. الصفقات والجورنال والرسومات تبقى محفوظة، والريبلي يبقى مطفي بالمرات الجاية لحد ما تشغّله إنت.</p></div>`,button('إلغاء الريبلي بالكامل','cancel-saved-replay','ghost')+button('نكمل من وين تركنا','continue-saved-replay','primary'));
  $('#modal .dialog').style.width='520px';
  // This dialog has two explicit choices. Closing it safely takes the cancel path.
  $('#modal .dialogfoot [data-action="dismiss"]').remove();
}
const openBeforeReplayChoice=openSession;
openSession=async function(id){
  const request=++replayOpenRequest;
  const session=state.sessions.find(s=>s.id===id);
  replayEntryPending=hasSavedReplay(session);replayEntrySession=null;
  await openBeforeReplayChoice(id);
  if(request!==replayOpenRequest)return;
  if(active?.id!==id){finishReplayEntry();return;}
  if(replayEntryPending)showSavedReplayChoice();
};
const renderBeforeReplayChoice=renderChart;
renderChart=function(){renderBeforeReplayChoice();$('.chartapp')?.classList.toggle('replay-entry-pending',replayEntryPending)};
actions['continue-saved-replay']=continueSavedReplay;
actions['cancel-saved-replay']=cancelSavedReplay;
const dismissBeforeReplayChoice=actions.dismiss;
actions.dismiss=()=>{if(replayEntryPending)return cancelSavedReplay();dismissBeforeReplayChoice()};
const cancelBeforeReplayChoice=actions.cancelreplay;
actions.cancelreplay=()=>{finishReplayEntry();cancelBeforeReplayChoice()};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&replayEntryPending){e.preventDefault();e.stopImmediatePropagation();cancelSavedReplay();}
},true);
