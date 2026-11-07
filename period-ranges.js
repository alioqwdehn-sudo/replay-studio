'use strict';
// Calendar separators run vertically across the chart, with no price-level bands.
const PERIOD_RANGE_TYPES={day:{frame:1440,label:'يومي',short:'D',color:'#4e9cff'},week:{frame:10080,label:'أسبوعي',short:'W',color:'#ad85ed'},month:{frame:43200,label:'شهري',short:'M',color:'#e4b65b'}};
function periodRangePrefs(raw=chartPrefs.periodRanges){
  const p=raw&&typeof raw==='object'?raw:{};
  return {day:p.day===true,week:p.week===true,month:p.month===true,fill:p.fill!==false,labels:p.labels!==false,history:[1,3,5,10,20].includes(+p.history)?+p.history:5,width:[1,2,3].includes(+p.width)?+p.width:1,style:['solid','dashed','dotted'].includes(p.style)?p.style:'dashed',...Object.fromEntries(Object.entries(PERIOD_RANGE_TYPES).map(([key,info])=>[key+'Color',/^#[0-9a-f]{6}$/i.test(p[key+'Color']||'')?p[key+'Color']:info.color]))};
}
function rangeSourceLowerBound(data,time,limit=data.length){let low=0,high=Math.min(data.length,limit);while(low<high){const mid=(low+high)>>>1;if(data[mid].t<time)low=mid+1;else high=mid}return low}
function visiblePeriodBoundaries(data,limit,g,prefs){
  limit=Math.max(0,Math.min(data?.length||0,Math.floor(limit)));if(!limit||!g?.vis?.length)return [];
  const boundaries=[],lastTime=data[limit-1].t;
  for(const [kind,info] of Object.entries(PERIOD_RANGE_TYPES)){
    if(!prefs[kind]||g.frame>info.frame)continue;
    const periods=[...new Set(g.vis.map(bar=>frameStart(bar.t,info.frame)))].slice(-prefs.history);
    for(const start of periods){
      if(start>lastTime)continue;
      const end=shiftFrameTime(start,1,info.frame),first=rangeSourceLowerBound(data,start,limit);
      if(first>=limit||data[first].t>=end)continue;
      const x=g.tx(start)-g.dx/2,x2=g.tx(end)-g.dx/2;
      boundaries.push({kind,start,end,x,x2,color:prefs[kind+'Color'],short:info.short});
    }
  }
  return boundaries;
}
function paintPeriodFill(ctx,g,boundaries,prefs){
  if(!prefs.fill)return;ctx.save();ctx.globalAlpha=.03;
  for(const period of boundaries){const frame=PERIOD_RANGE_TYPES[period.kind].frame;if(Math.floor(framePosition(period.start,frame))%2)continue;const x=Math.max(0,period.x),end=Math.min(g.cw,period.x2);if(end>x){ctx.fillStyle=period.color;ctx.fillRect(x,g.top,end-x,g.bot-g.top)}}ctx.restore();
}
function paintPeriodSeparators(ctx,g,boundaries,prefs){
  ctx.save();ctx.font='10px Arial';ctx.textAlign='left';const labelEnds={day:-Infinity,week:-Infinity,month:-Infinity};
  for(const period of boundaries){
    if(period.x<0||period.x>g.cw)continue;
    ctx.strokeStyle=period.color;ctx.fillStyle=period.color;ctx.lineWidth=prefs.width+(period.kind==='month'?1:period.kind==='week'?.5:0);ctx.setLineDash(prefs.style==='dashed'?[6,4]:prefs.style==='dotted'?[2,4]:[]);
    ctx.beginPath();ctx.moveTo(period.x,g.top);ctx.lineTo(period.x,g.bot);ctx.stroke();
    if(prefs.labels){const text=period.short+' '+new Date(period.start).toISOString().slice(period.kind==='month'?0:5,period.kind==='month'?7:10),width=ctx.measureText?.(text).width||text.length*5.5,x=Math.min(Math.max(3,period.x+4),g.cw-width-3),y=g.top+12+Object.keys(PERIOD_RANGE_TYPES).indexOf(period.kind)*13;if(x>labelEnds[period.kind]+4){ctx.fillText(text,x,y);labelEnds[period.kind]=x+width}}
  }
  ctx.restore();
}
const pricesBeforePeriodRanges=paintPriceSeries;
paintPriceSeries=function(ctx,g){
  const prefs=periodRangePrefs();if(!prefs.day&&!prefs.week&&!prefs.month)return pricesBeforePeriodRanges(ctx,g);
  const boundaries=visiblePeriodBoundaries(bars,replayReady?count:bars.length,g,prefs);
  paintPeriodFill(ctx,g,boundaries,prefs);pricesBeforePeriodRanges(ctx,g);paintPeriodSeparators(ctx,g,boundaries,prefs);
};
function periodRangeControls(){const p=periodRangePrefs();return `<h3>تقسيم الفترات · خطوط عمودية</h3><p dir="rtl">فاصل عمودي عند بداية كل يوم أو أسبوع أو شهر، يمتد من أعلى الشارت إلى أسفله.</p>${Object.entries(PERIOD_RANGE_TYPES).map(([key,info])=>`<div class="period-range-row"><label class="check"><input id="range-${key}" type="checkbox" ${p[key]?'checked':''}>${info.label} · ${info.short}</label><input id="range-${key}-color" type="color" aria-label="${info.label} separator color" value="${p[key+'Color']}"></div>`).join('')}<div class="twocol"><label class="field"><span>الفترات الظاهرة</span><select id="range-history">${[1,3,5,10,20].map(n=>`<option value="${n}" ${n===p.history?'selected':''}>${n}</option>`).join('')}</select></label><label class="field"><span>شكل الخط</span><select id="range-style">${[['solid','متصل'],['dashed','متقطع'],['dotted','منقّط']].map(([key,label])=>`<option value="${key}" ${p.style===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><span>سُمك الخط</span><select id="range-width">${[1,2,3].map(n=>`<option ${p.width===n?'selected':''}>${n}</option>`).join('')}</select></label></div>${[['fill','تظليل الفترات بالتناوب'],['labels','إظهار تاريخ بداية الفترة']].map(([key,label])=>`<label class="check period-range-check"><input id="range-${key}" type="checkbox" ${p[key]?'checked':''}>${label}</label>`).join('')}<p class="small muted" dir="rtl">التوقيت UTC. الأسبوع يبدأ الاثنين، والشهر حسب التقويم. اليومي على فريم يومي أو أصغر؛ الأسبوعي على أسبوعي أو أصغر؛ الشهري على شهري أو أصغر. الإعدادات محفوظة لكل الشارتات.</p>`}
function readPeriodRangeControls(){return periodRangePrefs({...Object.fromEntries(['day','week','month','fill','labels'].map(key=>[key,$('#range-'+key).checked])),history:+$('#range-history').value,width:+$('#range-width').value,style:$('#range-style').value,...Object.fromEntries(['day','week','month'].map(key=>[key+'Color',$('#range-'+key+'-color').value]))})}
const settingsBeforePeriodRanges=settingsDialog;
settingsDialog=function(){
  settingsBeforePeriodRanges();$('.settings-nav').insertAdjacentHTML('beforeend','<button role="tab" data-settings-tab="period-ranges" aria-selected="false">تقسيم الفترات</button>');$('.settings-content').insertAdjacentHTML('afterbegin','<section data-settings-section="period-ranges" class="hide">'+periodRangeControls()+'</section>');
  const apply=$('#modal [data-action="applyworkspacesettings"]'),original=apply.onclick;
  apply.onclick=()=>{const prefs=readPeriodRangeControls();original();if(!$('#workspace-settings-error')){chartPrefs.periodRanges=prefs;state.chartPrefs=chartPrefs;save();updatePeriodRangeButton();requestDraw()}};
};
chartSettings=settingsDialog;actions.chartsettings=settingsDialog;
actions.periodranges=()=>{settingsDialog();$$('[data-settings-tab]').forEach(button=>{const selected=button.dataset.settingsTab==='period-ranges';button.classList.toggle('active',selected);button.setAttribute('aria-selected',selected)});$$('[data-settings-section]').forEach(section=>section.classList.toggle('hide',section.dataset.settingsSection!=='period-ranges'))};
function updatePeriodRangeButton(){const button=$('#period-ranges-button');if(!button)return;const p=periodRangePrefs(),enabled=['day','week','month'].filter(key=>p[key]);button.textContent='فواصل '+(enabled.length?enabled.map(key=>PERIOD_RANGE_TYPES[key].short).join(' / '):'الفترات');button.classList.toggle('chosen',enabled.length>0);button.setAttribute('aria-pressed',String(enabled.length>0))}
const renderBeforePeriodRanges=renderChart;
renderChart=function(){renderBeforePeriodRanges();if(!$('#period-ranges-button'))$('.charttop [data-action="indicators"]').insertAdjacentHTML('afterend','<button id="period-ranges-button" data-action="periodranges" title="Vertical daily, weekly and monthly separators">تقسيم الفترات</button>');updatePeriodRangeButton()};
