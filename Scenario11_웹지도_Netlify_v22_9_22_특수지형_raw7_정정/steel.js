/* Scenario11 map-integrated steel/정철 calculator.
 * The original uploaded executable was NOT executed. This reproduces the
 * embedded offline calculator's cost table and time rules in the web map.
 * Only city and gate map data can provide name/level for a planned target.
 */
(()=>{
'use strict';
const COSTS=Object.freeze({4:500,6:750,8:1000,9:1000,10:1500,11:1500,13:2000,14:2500,15:2500,16:3000,18:4500,20:6000});
const KEY='s3_s11_steel_map_v1', HOUR=3600000, QUARTER=900000;
const $=id=>document.getElementById(id);
const panel=$('steelPanel'), toggle=$('steelToggleBtn');
const pad=n=>String(n).padStart(2,'0');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Math.floor(n).toLocaleString('ko-KR');
const dtLabel=d=>d instanceof Date && !Number.isNaN(d.getTime())?`${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`:'—';
const minuteLocal=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const finiteNonnegative=(v,def=0)=>{const n=Number(v);return Number.isFinite(n)&&n>=0?n:def;};
let entries=[], open=false, picking=false, noticeTimeout=0, recalcTimer=0, overlayFrame=0, calcDirty=true;
function nowInput(){const d=new Date();d.setSeconds(0,0);return minuteLocal(d);}
function setNotice(msg,kind='info'){
  const el=$('steelNotice');el.textContent=msg;el.dataset.kind=kind;
  if(noticeTimeout)clearTimeout(noticeTimeout);
  noticeTimeout=setTimeout(()=>{el.textContent='';el.removeAttribute('data-kind');},5000);
}
function updatePanelTop(){const head=$('topbar').getBoundingClientRect();const top=Math.ceil(head.bottom+8);panel.style.top=top+'px';panel.style.setProperty('--steel-panel-top',top+'px');}
function scheduleOverlay(){if(overlayFrame)return;overlayFrame=requestAnimationFrame(()=>{overlayFrame=0;window.dispatchEvent(new Event('s11-steel-redraw'));});}
function setOpen(next){
  open=!!next;panel.hidden=!open;document.body.classList.toggle('steelOpen',open);
  toggle.setAttribute('aria-expanded',String(open));toggle.classList.toggle('active',open);
  toggle.textContent=open?'정철 계산 ON':'정철 계산';
  setPicking(open);
  if(open){updatePanelTop();flushRecalc();scheduleOverlay();}
  else {if(recalcTimer){clearTimeout(recalcTimer);recalcTimer=0;}save();scheduleOverlay();toggle.focus({preventScroll:true});}
  window.dispatchEvent(new CustomEvent('s11-steel-panel-toggle',{detail:{open}}));
}
function setPicking(next){
  picking=open&&!!next;
  $('steelPickBtn').classList.toggle('active',picking);
  $('steelPickBtn').setAttribute('aria-pressed',String(picking));
  $('steelPickBtn').textContent=picking?'지도 선택 ON':'지도 선택 OFF';
  $('steelPickHelp').textContent=picking?'성지·관문 아이콘 클릭 시 공략 순서에 추가됩니다.':'지도 클릭은 평소처럼 위치를 선택합니다.';
  $('steelMobileSelectionStatus').textContent=entries.length?`${entries.length}곳 선택됨 · 지도에서 계속 추가하세요.`:'지도를 눌러 성지·관문을 추가하세요.';
  document.body.classList.toggle('steelPicking',picking);
}
function serialize(){
  return {defaultsVersion:2,stock:$('steelStock').value,rate:$('steelRate').value,base:$('steelBase').value,delay:$('steelDelay').value,
    entries:entries.map(({id,name,level,type,x,y,other,bonus,actual})=>({id,name,level,type,x,y,other,bonus,actual}))};
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(serialize()));}catch(_){} }
function load(){
  $('steelBase').value=nowInput();
  try{
    const v=JSON.parse(localStorage.getItem(KEY)||'null');if(!v||typeof v!=='object')return;
    $('steelStock').value=finiteNonnegative(v.stock,0);
    // v22.5 auto-saved its former default (100). Upgrade that default once, preserving newly edited values.
    const storedRate=finiteNonnegative(v.rate,160);
    $('steelRate').value=v.defaultsVersion===2||storedRate!==100?storedRate:160;
    $('steelDelay').value=finiteNonnegative(v.delay,3.5);
    if(typeof v.base==='string'&&!Number.isNaN(new Date(v.base).getTime()))$('steelBase').value=v.base;
    if(Array.isArray(v.entries)) entries=v.entries.slice(0,100).filter(e=>e&&/^(city|gate):\d+$/.test(e.id)&&typeof e.name==='string'&&Number.isFinite(Number(e.level)))
      .map(e=>({...e,level:Number(e.level),other:!!e.other,bonus:finiteNonnegative(e.bonus),actual:typeof e.actual==='string'?e.actual:''}));
  }catch(e){console.warn('[S11 정철] 저장값 로드 실패:',e);}
}
function addMarker(item){
  if(!item){setNotice('시설 아이콘을 눌러 주세요. 빈 지도나 일반 토지에는 추가되지 않습니다.','warn');return;}
  if(entries.some(e=>e.id===item.id)){setNotice(`${item.name}은(는) 이미 공략 순서에 있습니다.`, 'warn');return;}
  if(!Object.hasOwn(COSTS,item.level)){
    setNotice(`${item.name}의 ${item.level}레벨 소모량이 원본 계산표에 없습니다. 목록에 추가하지 않았습니다.`,'warn');return;
  }
  entries.push({id:item.id,name:item.name,level:item.level,type:item.type,x:item.x,y:item.y,other:false,bonus:0,actual:''});
  render(true);setNotice(`${item.name} · ${item.level}레벨을 ${entries.length}번째 공략 대상으로 추가했습니다.`,'ok');
  $('steelMobileSelectionStatus').textContent=`${entries.length}곳 선택됨 · ${item.name} 추가 완료`;
}
function simulate(input,includeForecast=true){
  const initial=finiteNonnegative(input.stock),initialRate=finiteNonnegative(input.rate);
  const baseDate=new Date(input.base),base=baseDate.getTime();
  if(!Number.isFinite(base))return {error:'기준 시각을 정확히 입력하세요.',out:[],forecast:[]};
  const delay=finiteNonnegative(input.delay,3.5);
  let stock=initial,rate=initialRate,time=base;
  const events=[],out=[];
  function advanceTo(t){
    while(events.length && events[0].time<=t){
      const e=events.shift();
      stock+=rate*((e.time-time)/HOUR);time=e.time;rate+=e.delta;
    }
    stock+=rate*((t-time)/HOUR);time=t;
  }
  for(let i=0;i<input.entries.length;i++){
    const r=input.entries[i],basic=COSTS[r.level];
    if(!Number.isFinite(basic))return {error:`${r.name}: ${r.level}레벨 소모표가 없습니다.`,out,forecast:[]};
    const cost=Math.round(basic*(r.other?1.5:1));
    const actual=r.actual?new Date(r.actual):null;
    if(actual && !Number.isFinite(actual.getTime()))return {error:`${r.name}: 실제 공성 시각을 확인하세요.`,out,forecast:[]};
    // Pending production changes may make a currently unaffordable build possible.
    while(stock+1e-7<cost){
      if(rate<=0){
        if(!events.length){out.push({i,cost,build:null,actual,left:stock,apply:null,impossible:true});return {out,forecast:includeForecast?forecast(input,base,initial,initialRate,out):[]};}
        advanceTo(events[0].time);continue;
      }
      const target=time+(cost-stock)/rate*HOUR;
      advanceTo(events.length&&events[0].time<=target?events[0].time:target);
    }
    const build=Math.ceil(time/QUARTER)*QUARTER;
    advanceTo(build);stock-=cost;
    // The original executable uses actual attack time + 1.5 hours, otherwise build time + configured delay.
    // Clamp invalid historical timestamps to the build time: production cannot begin before this stage.
    const apply=Math.max(build,(actual?actual.getTime()+1.5*HOUR:build+delay*HOUR));
    const bonus=finiteNonnegative(r.bonus);
    if(bonus>0){
      if(apply<=time)rate+=bonus;
      else {events.push({time:apply,delta:bonus});events.sort((a,b)=>a.time-b.time);}
    }
    out.push({i,cost,build:new Date(build),actual,left:stock,apply:new Date(apply),impossible:false,
      actualBeforeBuild:!!actual&&actual.getTime()<build});
  }
  return {out,forecast:includeForecast?forecast(input,base,initial,initialRate,out):[]};
}
function forecast(input,base,initial,initialRate,out){
  const events=[];
  out.forEach(r=>{
    if(r.impossible)return;
    const item=input.entries[r.i];
    events.push({time:r.build.getTime(),stock:-r.cost,rate:0,label:`${item.name} 건설 −${number(r.cost)}`});
    if(finiteNonnegative(item.bonus)>0)events.push({time:r.apply.getTime(),stock:0,rate:finiteNonnegative(item.bonus),label:`${item.name} 생산 +${item.bonus}`});
  });
  // For same-time production/build events both occur at the same instant.
  events.sort((a,b)=>a.time-b.time);
  let stock=initial,rate=initialRate,last=base;
  const result=[];
  for(let k=0;k<=72;k++){
    const t=base+k*HOUR,notes=[];
    while(events.length&&events[0].time<=t){
      const ev=events.shift();stock+=rate*((ev.time-last)/HOUR);last=ev.time;
      stock+=ev.stock;rate+=ev.rate;notes.push(ev.label);
    }
    stock+=rate*((t-last)/HOUR);last=t;
    result.push({time:new Date(t),stock:Math.max(0,stock),rate,notes});
  }
  return result;
}
function renderRows(){
  $('steelOrderCount').textContent=`${entries.length}곳`;
  if(!$('steelTargetsDetails').open){$('steelTargets').replaceChildren();return;}
  if(!entries.length){$('steelTargets').innerHTML='<p class="steelEmpty">지도에서 성지 또는 관문 아이콘을 클릭하세요.</p>';return;}
  $('steelTargets').innerHTML=entries.map((r,i)=>{
    const cost=COSTS[r.level];const adjusted=Math.round(cost*(r.other?1.5:1));
    return `<article class="steelTarget" data-steel-id="${esc(r.id)}"><div class="steelTargetTitle"><span class="steelOrder">${i+1}</span><div class="steelTargetName"><b>${esc(r.name)}</b><span>${esc(r.type)} · Lv.${r.level}</span></div><div class="steelTargetMove"><button type="button" data-act="up" data-i="${i}" aria-label="${esc(r.name)} 순서 올리기" ${i===0?'disabled':''}>↑</button><button type="button" data-act="down" data-i="${i}" aria-label="${esc(r.name)} 순서 내리기" ${i===entries.length-1?'disabled':''}>↓</button><button type="button" class="steelRemove" data-act="remove" data-i="${i}" aria-label="${esc(r.name)} 목록에서 삭제">×</button></div></div>
      <div class="steelTargetMeta"><span>기본 ${number(cost)}</span><label><input type="checkbox" data-field="other" data-i="${i}" ${r.other?'checked':''}>타 진영 +50%</label><strong>소모 ${number(adjusted)}</strong></div>
      <div class="steelTargetInputs"><label>점령 후 추가 생산/시간<input type="number" min="0" step="0.1" inputmode="decimal" data-field="bonus" data-i="${i}" value="${r.bonus}"></label><label>실제 공성 시각 (선택)<input type="datetime-local" step="900" data-field="actual" data-i="${i}" value="${esc(r.actual)}"></label></div></article>`;
  }).join('');
}
function renderCalculations(){
  if(!open){calcDirty=true;return;}
  const input=serialize(),forecastOpen=document.querySelector('.steelForecastDetails').open;
  const resultOpen=$('steelResultsDetails').open;
  const res=simulate(input,forecastOpen),dest=$('steelResults'),summary=$('steelSummary'),tb=$('steelForecast');
  calcDirty=false;
  if(res.error){summary.textContent=res.error;summary.classList.add('steelError');dest.replaceChildren();tb.replaceChildren();return;}
  summary.classList.remove('steelError');
  const stock=number(finiteNonnegative(input.stock));
  if(!entries.length){
    summary.innerHTML=`<div class="steelKeyMetric"><span>현재 정철</span><strong>${stock}</strong></div><div class="steelKeyMetric steelKeyTarget"><span>다음 공략</span><strong>성지·관문 선택</strong></div><div class="steelKeyMetric steelKeyTime"><span>건설 가능 시각</span><strong>—</strong></div>`;
    dest.replaceChildren();tb.replaceChildren();return;
  }
  const last=res.out.at(-1),next=res.out.find(x=>!x.impossible);
  const firstName=next?`${entries[next.i].name} · Lv.${entries[next.i].level}`:entries[0].name;
  summary.innerHTML=`<div class="steelKeyMetric"><span>현재 정철</span><strong>${stock}</strong></div><div class="steelKeyMetric steelKeyTarget"><span>다음 공략 · ${res.out.filter(x=>!x.impossible).length}/${entries.length}곳 계산</span><strong>${esc(firstName)}</strong></div><div class="steelKeyMetric steelKeyTime"><span>건설 가능 시각</span><strong>${next?esc(dtLabel(next.build)):'생산량 부족'}</strong>${last&&!last.impossible&&res.out.length>1?`<small>마지막 ${esc(dtLabel(last.build))}</small>`:''}</div>`;
  if(resultOpen){
    dest.innerHTML=res.out.map(x=>{
      const item=entries[x.i];
      return `<div class="steelResultItem"><span class="steelResultTitle">${x.i+1}. ${esc(item.name)} <span>Lv.${item.level} · 소모 ${number(x.cost)}</span></span>
        <strong class="${x.impossible?'steelError':''}">${x.impossible?'생산량 부족 — 도달 불가':esc(dtLabel(x.build))}</strong>
        <span>건설 직후 잔여 ${number(x.left)} · 생산 반영 ${esc(dtLabel(x.apply))}${x.actualBeforeBuild?' · 실제 공성 시각이 계산된 건설 가능 시각보다 빠릅니다.':''}</span></div>`;
    }).join('');
  }else if(dest.childElementCount)dest.replaceChildren();
  if(!forecastOpen){if(tb.childElementCount)tb.replaceChildren();return;}
  const fragment=document.createDocumentFragment();
  for(const v of res.forecast){
    const tr=document.createElement('tr');
    for(const value of [dtLabel(v.time),number(v.stock),v.rate.toLocaleString('ko-KR'),v.notes.join(' / ')||'—']){
      const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
    }
    fragment.appendChild(tr);
  }
  tb.replaceChildren(fragment);
}
function flushRecalc(){
  if(recalcTimer){clearTimeout(recalcTimer);recalcTimer=0;}
  save();if(open && calcDirty)renderCalculations();
}
function scheduleRecalc(){
  calcDirty=true;if(recalcTimer)clearTimeout(recalcTimer);
  recalcTimer=setTimeout(()=>{recalcTimer=0;flushRecalc();},240);
}
function recalc(){calcDirty=true;flushRecalc();}
function render(mapChanged=false){
  renderRows();calcDirty=true;flushRecalc();
  $('steelMobileSelectionStatus').textContent=entries.length?`${entries.length}곳 선택됨 · 지도에서 계속 추가하세요.`:'지도를 눌러 성지·관문을 추가하세요.';
  if(mapChanged && open)scheduleOverlay();
}
$('steelTargetsDetails').addEventListener('toggle',()=>{if($('steelTargetsDetails').open)renderRows();else $('steelTargets').replaceChildren();});
for(const selector of ['steelResultsDetails'])$(selector).addEventListener('toggle',()=>{if(open){calcDirty=true;flushRecalc();}});
document.querySelector('.steelForecastDetails').addEventListener('toggle',()=>{if(open){calcDirty=true;flushRecalc();}});
$('steelTargets').addEventListener('click',e=>{
  const btn=e.target.closest('button[data-act]');if(!btn)return;
  const i=Number(btn.dataset.i),act=btn.dataset.act;
  if(!Number.isInteger(i)||i<0||i>=entries.length)return;
  if(act==='remove')entries.splice(i,1);
  else if(act==='up'&&i>0)[entries[i-1],entries[i]]=[entries[i],entries[i-1]];
  else if(act==='down'&&i<entries.length-1)[entries[i],entries[i+1]]=[entries[i+1],entries[i]];
  else return;
  render(true);
});
$('steelTargets').addEventListener('change',e=>{
  const el=e.target,field=el?.dataset?.field,i=Number(el?.dataset?.i);
  if(!Number.isInteger(i)||!entries[i]||!['other','bonus','actual'].includes(field))return;
  entries[i][field]=field==='other'?el.checked:field==='bonus'?finiteNonnegative(el.value):el.value;
  if(field==='other'){renderRows();recalc();}else scheduleRecalc();
});
$('steelTargets').addEventListener('input',e=>{
  const el=e.target,field=el?.dataset?.field,i=Number(el?.dataset?.i);
  if(!Number.isInteger(i)||!entries[i]||field!=='bonus')return;
  entries[i].bonus=finiteNonnegative(el.value);scheduleRecalc();
});
for(const id of ['steelStock','steelRate','steelBase','steelDelay']){
  $(id).addEventListener('input',scheduleRecalc);
  $(id).addEventListener('change',()=>{calcDirty=true;flushRecalc();});
}
$('steelSetNowBtn').addEventListener('click',()=>{$('steelBase').value=nowInput();recalc();});
$('steelPickBtn').addEventListener('click',()=>setPicking(!picking));
$('steelShowListBtn').addEventListener('click',()=>{setPicking(false);$('steelPickBtn').focus({preventScroll:true});});
$('steelClearTargetsBtn').addEventListener('click',()=>{if(!entries.length)return;if(!confirm('공략 순서를 모두 지울까요?'))return;entries=[];render(true);setNotice('공략 목록을 비웠습니다.');});
$('steelResetBtn').addEventListener('click',()=>{if(!confirm('정철 입력값과 공략 목록을 모두 초기화할까요?'))return;
  entries=[];$('steelStock').value=0;$('steelRate').value=160;$('steelBase').value=nowInput();$('steelDelay').value=3.5;render(true);setNotice('정철 계산기를 초기화했습니다.');
});
toggle.addEventListener('click',()=>setOpen(!open));
$('steelCloseBtn').addEventListener('click',()=>setOpen(false));
window.addEventListener('resize',()=>{if(open)updatePanelTop();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopImmediatePropagation();setOpen(false);}},true);
load();renderRows();save();
window.S11SteelBridge={
 isPicking:()=>open&&picking,
 onMarkerClick:addMarker,
 drawMarkers(g,tileToScreen,w,h){
   if(!open||!entries.length)return;
   g.save();g.font='900 11px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';
   entries.forEach((r,i)=>{
     const [x,y]=tileToScreen(r.x,r.y),tx=x-14,ty=y-14;
     if(tx<-25||ty<-25||tx>w+25||ty>h+25)return;
     g.beginPath();g.arc(tx,ty,10.2,0,Math.PI*2);g.fillStyle='rgba(10,30,37,.94)';g.fill();
     g.lineWidth=2;g.strokeStyle='#a3e8e9';g.stroke();g.fillStyle='#fff';g.fillText(String(i+1),tx,ty+0.6);
   });g.restore();
 },
 _simulateForTests:simulate,
 _costsForTests:COSTS,
 _getEntriesForTests:()=>entries.map(x=>({...x}))
};
})();
