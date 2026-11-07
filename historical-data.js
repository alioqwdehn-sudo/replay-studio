'use strict';
// M1 data stays in packed buffers; objects are created only when a candle is read.
function packedBars(stored,limit=Infinity){
  const views=stored.chunks.map(buffer=>new DataView(buffer)),ends=[];let length=0;
  for(const v of views){length+=v.byteLength/24;ends.push(length)}
  length=Math.max(0,Math.min(length,limit===Infinity?length:Number.isFinite(limit)?Math.floor(limit):0));const array=[];
  const read=index=>{if(index<0||index>=length)return undefined;let lo=0,hi=ends.length-1;while(lo<hi){const m=(lo+hi)>>1;if(ends[m]<=index)lo=m+1;else hi=m}const offset=(index-(lo?ends[lo-1]:0))*24,v=views[lo];return {index,t:v.getUint32(offset,true)*1000,o:v.getUint32(offset+4,true)/1e6,h:v.getUint32(offset+8,true)/1e6,l:v.getUint32(offset+12,true)/1e6,c:v.getUint32(offset+16,true)/1e6,v:v.getUint32(offset+20,true)}};
  return new Proxy(array,{get(target,key,receiver){if(key==='length'||key==='revision')return length;if(key==='indicatorSource')return stored;if(key==='packedRecord')return stored;if(typeof key==='string'&&/^(0|[1-9]\d*)$/.test(key))return read(+key);return Reflect.get(target,key,receiver)},has(target,key){return typeof key==='string'&&/^(0|[1-9]\d*)$/.test(key)?+key<length:Reflect.has(target,key)}});
}
function decodeStoredPrices(data){return data?.format==='histdata-m1-v1'?packedBars(data):data}
function serializeStoredPrices(data){if(data?.format!=='histdata-m1-v1')return data;return {...data,chunks:data.chunks.map(buffer=>{const bytes=new Uint8Array(buffer),pieces=[];for(let i=0;i<bytes.length;i+=32768)pieces.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(pieces.join(''))}),encoding:'base64'}}
function restoreStoredPrices(data){if(data?.format!=='histdata-m1-v1')return data;if(!Array.isArray(data.chunks)||!data.chunks.length)throw Error('Invalid packed history');return {...data,chunks:data.chunks.map(chunk=>{const bytes=typeof chunk==='string'?Uint8Array.from(atob(chunk),c=>c.charCodeAt(0)):new Uint8Array(chunk);if(!bytes.byteLength||bytes.byteLength%24)throw Error('Invalid packed history block');return bytes.buffer}),encoding:undefined}}
async function loadM1Archive(fromYear,toYear,onProgress,symbol='EURUSD'){
  if(!['EURUSD','GBPUSD'].includes(symbol))throw Error('Historical archive unavailable for this asset.');
  const archivePath='data/'+symbol.toLowerCase()+'-m1/';
  if(!Number.isInteger(fromYear)||!Number.isInteger(toYear)||fromYear<2012||toYear>2026||fromYear>toYear)throw Error('Choose a valid year range from 2012 to 2026.');
  const response=await fetch(archivePath+'manifest.json');if(!response.ok)throw Error('Archive manifest unavailable.');const manifest=await response.json();
  const files=manifest.files.filter(f=>+f.sourcePeriod.slice(0,4)>=fromYear&&+f.sourcePeriod.slice(0,4)<=toYear);if(!files.length)throw Error('No data for these years.');
  const chunks=new Array(files.length);let next=0,done=0;
  async function worker(){while(next<files.length){const index=next++,file=files[index],r=await fetch(archivePath+file.file);if(!r.ok)throw Error('Missing historical block: '+file.file);const compressed=await r.arrayBuffer();const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));const buffer=await new Response(stream).arrayBuffer();if(buffer.byteLength!==file.rows*24)throw Error('Invalid historical block length');if(crypto.subtle){const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==file.sha256)throw Error('Historical block checksum mismatch')}chunks[index]=buffer;onProgress?.(++done,files.length)}}
  await Promise.all([worker(),worker(),worker()]);return {format:'histdata-m1-v1',chunks,source:'HistData.com',symbol,fromYear,toYear};
}
let packedAggregateSource=null,packedAggregates=new Map(),packedAggregateSets=new WeakMap();const aggregateBeforePacked=aggregate;
aggregate=function(frame){
  if(!bars.packedRecord)return aggregateBeforePacked(frame);
  if(packedAggregateSource!==bars){packedAggregateSource=bars;let set=packedAggregateSets.get(bars);if(!set){set=new Map();packedAggregateSets.set(bars,set)}packedAggregates=set}
  if(frame===1){let cache=packedAggregates.get(1);if(!cache||cache.count!==count){cache={count,data:packedBars(bars.packedRecord,count)};packedAggregates.set(1,cache)}trimPackedAggregates(frame);return cache.data;}
  let cache=packedAggregates.get(frame);if(!cache||cache.count>count){cache={count:0,data:[]};packedAggregates.set(frame,cache)}
  for(let i=cache.count;i<count;i++){const b=bars[i],t=frameStart(b.t,frame),last=cache.data.at(-1);if(last&&last.t===t){last.h=Math.max(last.h,b.h);last.l=Math.min(last.l,b.l);last.c=b.c;last.v+=b.v;last.index=i}else cache.data.push({...b,t,index:i})}cache.count=count;cache.data.revision=count;trimPackedAggregates(frame);return cache.data;
};
function syncSourceIntervals(){if(!active)return;const minimum=active.sourceFrame||1;$$('[data-frame] option').forEach(option=>option.disabled=+option.value<minimum);$$('[data-interval]').forEach(button=>button.disabled=+button.dataset.interval<minimum);$$('#replay-interval option').forEach(option=>option.disabled=!['chart','source'].includes(option.value)&&+option.value<minimum)}
const renderBeforeHistorical=renderChart;renderChart=function(){const minimum=active.sourceFrame||1;frames=frames.map((frame,panel)=>{const source=typeof panelTrack==='function'?panelTrack(panel)?.session.sourceFrame||minimum:minimum;return frame<source?source:frame});renderBeforeHistorical();syncSourceIntervals()};
const controlsBeforeHistorical=updateReplayControls;updateReplayControls=function(){controlsBeforeHistorical();syncSourceIntervals()};

function trimPackedAggregates(currentFrame){for(const frame of packedAggregates.keys())if(packedAggregates.size>4&&frame!==currentFrame&&!frames.slice(0,layout).includes(frame))packedAggregates.delete(frame)}
function clearHistoryCaches(){packedAggregates.clear();packedAggregateSets=new WeakMap();packedAggregateSource=null;aggregateCache.clear();cacheBars=null;cacheCount=-1;indicatorCache=new WeakMap();geo=[]}
const backBeforeHistoryCache=actions.back;actions.back=()=>{backBeforeHistoryCache();clearHistoryCaches()};
