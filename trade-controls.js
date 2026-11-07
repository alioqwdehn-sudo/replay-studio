'use strict';
// Trading lines edit the actual replay order, independently of analysis drawings.
function validTradeLevel(t,key,price,market){
  if(!['sl','tp'].includes(key)||!Number.isFinite(price)||price<=0)return false;
  const sign=t.side==='Buy'?1:-1;
  return key==='sl'?(market-price)*sign>0:(price-market)*sign>0;
}
function tradeLineHit(g,x,y){
  if(!replayReady||tool!=='crosshair'||x<0||x>g.cw||y<g.top||y>g.bot)return null;
  let nearest=null,distance=9;
  for(const t of active.trades.filter(t=>t.exit===undefined))for(const key of ['sl','tp']){
    const d=Math.abs(y-g.py(t[key]));if(d<distance){nearest={t,key};distance=d;}
  }
  return nearest;
}
const drawBeforeTradeControls=draw;
draw=function(canvas,panel){
  drawBeforeTradeControls(canvas,panel);const g=geo[panel];if(!g||!active||!replayReady)return;
  const ctx=canvas.getContext('2d');ctx.save();ctx.font='11px Arial';
  active.trades.filter(t=>t.exit===undefined).forEach((t,index)=>{
    const x=8+(index%3)*180;
    for(const [key,label,color] of [['entry',t.side+' '+t.qty,'#477fd6'],['sl','SL · drag','#d54e67'],['tp','TP · drag','#159c81']]){
      const y=g.py(t[key]);if(y<g.top||y>g.bot)continue;
      const text=label+'  '+t[key].toFixed(spec().dec),width=ctx.measureText(text).width+18;
      ctx.fillStyle=color;ctx.fillRect(x,y-11,width,22);ctx.fillStyle='#fff';ctx.fillText(text,x+9,y+4);
      ctx.fillStyle=color;ctx.fillRect(g.cw,y-10,74,20);ctx.fillStyle='#fff';ctx.fillText(t[key].toFixed(spec().dec),g.cw+5,y+4);
    }
  });ctx.restore();
};
const attachBeforeTradeControls=attachCanvas;
attachCanvas=function(){
  attachBeforeTradeControls();$$('.chartcanvas').forEach((canvas,panel)=>{
    const down=canvas.onpointerdown,move=canvas.onpointermove,up=canvas.onpointerup,cancel=canvas.onpointercancel;
    let edit=null;
    const coords=e=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}};
    canvas.onpointerdown=e=>{
      const g=geo[panel],p=coords(e),hit=e.button===0&&g&&tradeLineHit(g,p.x,p.y);
      if(!hit)return down?.(e);
      stop();edit={...hit,g,original:hit.t[hit.key]};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='ns-resize';e.preventDefault();requestDraw();
    };
    canvas.onpointermove=e=>{
      const g=geo[panel],p=coords(e);
      if(!edit){move?.(e);if(g&&tradeLineHit(g,p.x,p.y))canvas.style.cursor='ns-resize';return;}
      const price=Number(edit.g.priceAt(Math.max(edit.g.top,Math.min(edit.g.bot,p.y))).toFixed(spec().dec));
      if(validTradeLevel(edit.t,edit.key,price,marketExitPrice(edit.t,current().c)))edit.t[edit.key]=price;
      canvas.style.cursor='ns-resize';requestDraw();
    };
    canvas.onpointerup=e=>{
      if(!edit)return up?.(e);
      const changed=edit.t[edit.key]!==edit.original;edit=null;
      if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      if(changed){save();updateChartUI();toast('Order SL / TP updated. Quantity stays fixed; replay is paused.');}requestDraw();
    };
    canvas.onpointercancel=e=>{if(!edit)return cancel?.(e);edit.t[edit.key]=edit.original;edit=null;requestDraw();};
    canvas.addEventListener('keydown',e=>{if(e.key==='Escape'&&edit){edit.t[edit.key]=edit.original;edit=null;requestDraw();}});
  });
};
const placeBeforeTradeControls=place;
place=function(side){
  const before=active?.trades.length||0;placeBeforeTradeControls(side);
  if(active?.trades.length>before){
    for(let panel=0;panel<layout;panel++){
      const g=geo[panel];if(!g||(typeof panelTrack==='function'&&panelTrack(panel)?.session.symbol!==active.symbol))continue;
      const levels=active.trades.filter(t=>t.exit===undefined).flatMap(t=>[t.entry,t.sl,t.tp]);
      const lo=Math.min(g.lo,...levels),hi=Math.max(g.hi,...levels),pad=(hi-lo)*.08;
      panelViews[panel]={manual:true,lo:lo-pad,hi:hi+pad};
    }
    refreshViewControls();requestDraw();toast('Order opened. Drag SL / TP lines to adjust; replay stays paused.');
  }
};
actions.buy=()=>place('Buy');actions.sell=()=>place('Sell');
