
(()=>{ 
const D=window.S3MAP_DATA, X=window.S3MAP_EXTRAS||{};
const W=D.width, H=D.height, R=D.regions;
// Only Scenario11: runtime cityEdges + npcCityEdges, independently tagged; display is off until requested.
const S11_CONNECTIONS=window.S3MAP_CONNECTIONS?.scenario==='Scenario11'?window.S3MAP_CONNECTIONS:null;
const S11_CONN_NODES=S11_CONNECTIONS?.nodes||{};
const S11_CONN_EDGES=S11_CONNECTIONS?.edges||[];
const S11_CONN_ADJ=new Map();
for(const [a,b,mask] of S11_CONN_EDGES){
  if(!S11_CONN_NODES[a]||!S11_CONN_NODES[b]||![1,2,3].includes(mask))continue;
  if(!S11_CONN_ADJ.has(a))S11_CONN_ADJ.set(a,[]);
  if(!S11_CONN_ADJ.has(b))S11_CONN_ADJ.set(b,[]);
  S11_CONN_ADJ.get(a).push([b,mask]); S11_CONN_ADJ.get(b).push([a,mask]);
}
let showS11Connections=false, selectedS11ConnectionId=0;

// 성지 주민 수 상한과 패업 점수는 사용자가 제공한 레벨별 기준표를 기본값으로 사용한다.
// 현재 주민 수는 실시간 데이터가 아니므로 확인되지 않은 경우 비워 두며, 수동 입력은 이 브라우저에만 저장한다.
const CITY_STATS_KEY='s11_city_stats_manual_v1';
const CITY_STATS_REFERENCE=window.S3MAP_CITY_STATS||{};
const CITY_BY_ID=new Map(Object.values(R).filter(r=>r.city).map(r=>[String(r.city.id),r.city]));
// Locate the exact region code for each score city. Do not approximate city borders with squares.
const SCORE_REGION_BY_CITY=new Map(Object.entries(R).filter(([,r])=>r.city).map(([code,r])=>[String(r.city.id),{code,region:r}]));
// 패업 점수 계산기: 지도에 실제 존재하는 217개 성지만 지정할 수 있다.
// 하나의 성지는 하나의 연맹에만 배정되며 사용자가 직접 선택한 상태를 브라우저에 저장한다.
const SCORE_STORAGE_KEY='s11_alliance_city_occupation_v1';
const SCORE_ALLIANCE_COLORS={1:'#ffda73',2:'#80d9ff',3:'#b9f49f'};
let scorePanelOpen=false, scoreActiveAlliance=1;
const SCORE_SHADE_PREF_KEY='s11_score_city_boundary_shading_v1';
let scoreAreaShadingEnabled=true;
try{scoreAreaShadingEnabled=localStorage.getItem(SCORE_SHADE_PREF_KEY)!=='off';}catch(_){/* nonpersistent fallback */}
let scoreShadeRevision=0,scoreShadeCache=null;
const scoreRegionFillPaths=new Map();
function invalidateScoreShade(){
  scoreShadeRevision++;
  if(scoreShadeCache){scoreShadeCache.canvas.width=0;scoreShadeCache.canvas.height=0;scoreShadeCache=null;}
}
function setScoreAreaShading(enabled){
  scoreAreaShadingEnabled=!!enabled;
  try{localStorage.setItem(SCORE_SHADE_PREF_KEY,scoreAreaShadingEnabled?'on':'off');}catch(_){}
  const control=document.getElementById('scoreAreaShadeToggle');
  if(control)control.checked=scoreAreaShadingEnabled;
  invalidateScoreShade();drawScoreAreaShading();
}
const scoreOwners=new Map(); // city ID -> alliance 1, 2, 3
try{
  const saved=JSON.parse(localStorage.getItem(SCORE_STORAGE_KEY)||'{}');
  if(saved && typeof saved==='object' && !Array.isArray(saved)){
    for(const [id,owner] of Object.entries(saved)){
      if(CITY_BY_ID.has(id) && [1,2,3].includes(Number(owner)))scoreOwners.set(id,Number(owner));
    }
  }
}catch(_){/* 저장 데이터 손상 시 빈 상태에서 시작 */}
function persistScoreOwners(){
  invalidateScoreShade();
  try{localStorage.setItem(SCORE_STORAGE_KEY,JSON.stringify(Object.fromEntries(scoreOwners)));}
  catch(_){setScoreInstruction('브라우저에 저장할 수 없습니다. 현재 화면에서는 선택이 유지됩니다.');}
  drawScoreAreaShading();
}
function scoreForCity(city){
  const manual=manualCityStats[String(city.id)];
  const base=CITY_STATS_REFERENCE[String(city.id)]||{};
  const values=manual&&typeof manual==='object'?manual:base;
  return cityStatsValue(values.score);
}
function escapeScoreHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setScoreInstruction(message){const el=document.getElementById('scoreInstruction');if(el)el.textContent=message;}
function scoreTotals(){
  const out={1:{count:0,score:0,unknown:0},2:{count:0,score:0,unknown:0},3:{count:0,score:0,unknown:0}};
  for(const [id,alliance] of scoreOwners){
    const city=CITY_BY_ID.get(id);if(!city)continue;
    const bucket=out[alliance];bucket.count++;
    const pts=scoreForCity(city);if(pts===null)bucket.unknown++;else bucket.score+=pts;
  }
  return out;
}
function renderScorePanel(){
  const panel=document.getElementById('scorePanel');
  if(!panel)return;
  panel.hidden=!scorePanelOpen;
  const toggle=document.getElementById('scoreToggleBtn');
  toggle?.classList.toggle('active',scorePanelOpen);toggle?.setAttribute('aria-pressed',String(scorePanelOpen));
  if(!scorePanelOpen)return;
  const shadeToggle=document.getElementById('scoreAreaShadeToggle');
  if(shadeToggle)shadeToggle.checked=scoreAreaShadingEnabled;
  const totals=scoreTotals();
  for(const button of panel.querySelectorAll('[data-score-alliance]')){
    const alliance=Number(button.dataset.scoreAlliance);
    button.classList.toggle('active',alliance===scoreActiveAlliance);
    button.setAttribute('aria-pressed',String(alliance===scoreActiveAlliance));
    const t=totals[alliance];button.textContent=`연맹 ${alliance} · ${t.count}곳`;
  }
  const sum=document.getElementById('scoreAllSummary');
  if(sum)sum.innerHTML=[1,2,3].map(alliance=>{
    const t=totals[alliance];
    return `<div class="scoreTotal scoreTotal${alliance}"><span>연맹 ${alliance} <small>${t.count}곳</small></span><strong>${t.score.toLocaleString('ko-KR')}점${t.unknown?` <small>미확인 ${t.unknown}</small>`:''}</strong></div>`;
  }).join('');
  document.getElementById('scoreActiveTitle').textContent=`연맹 ${scoreActiveAlliance} 점령 성지`;
  const chosen=[...scoreOwners].filter(([,owner])=>owner===scoreActiveAlliance)
    .map(([id])=>CITY_BY_ID.get(id)).filter(Boolean).sort((a,b)=>Number(b.level)-Number(a.level)||String(a.name).localeCompare(String(b.name),'ko'));
  const list=document.getElementById('scoreCityList');
  if(list)list.innerHTML=chosen.length?chosen.map(city=>{
    const pts=scoreForCity(city),id=String(city.id);
    return `<div class="scoreCityRow"><button type="button" class="scoreCityJump" data-score-jump="${id}" title="지도에서 ${escapeScoreHtml(city.name)} 보기"><span>Lv.${escapeScoreHtml(city.level)} ${escapeScoreHtml(city.name)}</span><strong>${pts===null?'미확인':pts.toLocaleString('ko-KR')+'점'}</strong></button><button type="button" class="scoreCityRemove" data-score-remove="${id}" aria-label="${escapeScoreHtml(city.name)} 연맹 ${scoreActiveAlliance} 점령 해제">×</button></div>`;
  }).join(''):'<p class="scoreEmpty">선택한 연맹에 지정된 성지가 없습니다. 지도에서 성지 아이콘을 클릭하세요.</p>';
}
function setScorePanelOpen(open){
  scorePanelOpen=!!open;
  if(scorePanelOpen){
    if(routeMode){routeMode=false;updateRouteUI();}
    if(moveCalcMode){moveCalcMode=false;updateMoveCalcUI();}
    setScoreInstruction(`연맹 ${scoreActiveAlliance} 선택 중 · 지도에서 성지 아이콘을 클릭하세요.`);
  }
  renderScorePanel();drawSelection();
}
function assignScoreCity(city){
  const id=String(city.id),previous=scoreOwners.get(id)||0;
  if(previous===scoreActiveAlliance){
    scoreOwners.delete(id);setScoreInstruction(`${city.name} · 연맹 ${scoreActiveAlliance} 점령 해제`);
  }else{
    scoreOwners.set(id,scoreActiveAlliance);
    setScoreInstruction(previous?`${city.name} · 연맹 ${previous} → 연맹 ${scoreActiveAlliance}로 변경`:`${city.name} · 연맹 ${scoreActiveAlliance}에 추가`);
  }
  persistScoreOwners();renderScorePanel();drawSelection();
}
// A city is a union of the exact staggered tiles tagged with its region code.
// Build just the regions the user selects, and merge vertical runs into rectangles.
// This avoids painting other cities' tiles and avoids scanning the full grid per frame.
function scoreRegionFillPath(id){
  if(scoreRegionFillPaths.has(id))return scoreRegionFillPaths.get(id);
  const record=SCORE_REGION_BY_CITY.get(id);
  if(!record)return null;
  const b=record.region.b||[0,0,W,H],code=Number.parseInt(record.code,16);
  const x0=Math.max(0,Math.floor(Math.min(b[0],b[2]))-2),x1=Math.min(W-1,Math.ceil(Math.max(b[0],b[2]))+1);
  const y0=Math.max(0,Math.floor(Math.min(b[1],b[3]))-2),y1=Math.min(H-1,Math.ceil(Math.max(b[1],b[3]))+1);
  const path=new Path2D();
  for(let x=x0;x<=x1;x++){
    let run=-1;
    for(let y=y0;y<=y1+1;y++){
      const match=y<=y1&&codes[y*W+x]===code;
      if(match&&run<0)run=y;
      else if(!match&&run>=0){path.rect(x,run+oddXHalfShift(x),1,y-run);run=-1;}
    }
  }
  scoreRegionFillPaths.set(id,path);
  return path;
}
function scoreShadeCacheKey(){
  return [scoreShadeRevision,map.width,map.height,renderDpr,scale].join('|');
}
function drawScoreAreaShading(){
  if(!scoreShadeCanvas)return;
  const w=map.clientWidth,h=map.clientHeight;
  scoreShadeCtx.setTransform(1,0,0,1,0,0);
  scoreShadeCtx.clearRect(0,0,scoreShadeCanvas.width,scoreShadeCanvas.height);
  if(!scoreAreaShadingEnabled||!scoreOwners.size)return;
  const key=scoreShadeCacheKey();
  let entry=scoreShadeCache;
  let sx=entry?(entry.margin+entry.ox-ox):0,sy=entry?(entry.margin+entry.oy-oy):0;
  if(!entry||entry.key!==key||sx<0||sy<0||sx+w>entry.cssWidth||sy+h>entry.cssHeight){
    const margin=baseMargin();
    const canvas=document.createElement('canvas');
    canvas.width=map.width+2*Math.ceil(margin*renderDpr);
    canvas.height=map.height+2*Math.ceil(margin*renderDpr);
    const g=canvas.getContext('2d');
    const originalOx=ox,originalOy=oy;
    const view=activeWorldView;
    try{
      activeWorldView=viewportWorldBounds(8,margin);
      ox+=margin;oy+=margin;
      g.setTransform(renderDpr,0,0,renderDpr,0,0);
      g.translate(ox,oy);g.translate(CX*scale,CY*scale);g.rotate(ROT);
      g.scale(FLIP_X*scale,scale);g.translate(-CX,-CY);
      g.globalAlpha=.15; // subtle shading: original resource colors and city labels stay legible.
      for(const [id,alliance] of scoreOwners){
        const record=SCORE_REGION_BY_CITY.get(id);
        if(!record||!intersectsWorldView({minX:record.region.b[0],minY:record.region.b[1],maxX:record.region.b[2],maxY:record.region.b[3]}))continue;
        const path=scoreRegionFillPath(id);
        if(path){g.fillStyle=SCORE_ALLIANCE_COLORS[alliance];g.fill(path);}
      }
    }finally{ox=originalOx;oy=originalOy;activeWorldView=view;}
    if(scoreShadeCache){scoreShadeCache.canvas.width=0;scoreShadeCache.canvas.height=0;}
    entry={key,canvas,margin,ox,oy,cssWidth:canvas.width/renderDpr,cssHeight:canvas.height/renderDpr};
    scoreShadeCache=entry;sx=margin;sy=margin;
  }
  scoreShadeCtx.setTransform(renderDpr,0,0,renderDpr,0,0);
  scoreShadeCtx.drawImage(entry.canvas,Math.round(sx*renderDpr),Math.round(sy*renderDpr),map.width,map.height,0,0,w,h);
}
function drawScoreCityMarkers(g){
  if(!scorePanelOpen&&!scoreOwners.size)return;
  const w=map.clientWidth,h=map.clientHeight;
  g.save();
  for(const [id,alliance] of scoreOwners){
    const city=CITY_BY_ID.get(id);if(!city)continue;
    const [x,y]=tileCenterToScreen(city.x-1,city.y-1);
    if(x<-25||x>w+25||y<-25||y>h+25)continue;
    const col=SCORE_ALLIANCE_COLORS[alliance];
    g.beginPath();g.arc(x,y,17,0,Math.PI*2);g.lineWidth=5;g.strokeStyle='rgba(15,13,12,.96)';g.stroke();
    g.beginPath();g.arc(x,y,17,0,Math.PI*2);g.lineWidth=3;g.strokeStyle=col;g.stroke();
    g.beginPath();g.arc(x+13,y-14,9,0,Math.PI*2);g.fillStyle='#19140f';g.fill();g.lineWidth=2;g.strokeStyle=col;g.stroke();
    g.font='800 11px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillStyle='#ffffff';g.fillText(String(alliance),x+13,y-14);
  }
  g.restore();
}

let manualCityStats={};
try {
  const v=JSON.parse(localStorage.getItem(CITY_STATS_KEY)||'{}');
  if(v&&typeof v==='object'&&!Array.isArray(v))manualCityStats=v;
}catch(_){manualCityStats={};}
function cityStatsValue(v){
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);
  return Number.isSafeInteger(n)&&n>=0&&n<=1000000?n:null;
}
function currentCityStats(city){
  const id=String(city.id), manual=manualCityStats[id];
  const base=CITY_STATS_REFERENCE[id]||{};
  const values=manual&&typeof manual==='object'?manual:base;
  return {residents:cityStatsValue(values.residents),capacity:cityStatsValue(values.capacity),score:cityStatsValue(values.score),source:manual?'manual':base.source||null};
}
function cityStatsMarkup(city){
  const v=currentCityStats(city);
  const residents=v.capacity===null?'미확인':v.capacity.toLocaleString('ko-KR');
  const score=v.score===null?'미확인':v.score.toLocaleString('ko-KR');
  return `<div class="cityStats" data-city-id="${city.id}"><div class="cityStatsRows"><div class="k">주민 수</div><div class="v">${residents}</div><div class="k">패업 점수</div><div class="v">${score}</div></div><button type="button" class="cityStatsEdit" data-city-stats-edit>수치 입력/수정</button></div>`;
}
function cityStatsForm(city){
  const v=currentCityStats(city);
  const num=n=>n===null?'':String(n);
  return `<form class="cityStatsForm" data-city-stats-form><div class="cityStatsFormGrid"><label>현재 주민 수<input name="residents" type="number" inputmode="numeric" min="0" max="1000000" step="1" placeholder="미확인" value="${num(v.residents)}"></label><label>주민 상한<input name="capacity" type="number" inputmode="numeric" min="0" max="1000000" step="1" placeholder="미확인" value="${num(v.capacity)}"></label><label>패업 점수<input name="score" type="number" inputmode="numeric" min="0" max="1000000" step="1" placeholder="미확인" value="${num(v.score)}"></label></div><p class="cityStatsError" role="alert" hidden></p><div class="cityStatsFormActions"><button type="submit">저장</button><button type="button" data-city-stats-cancel>취소</button><button type="button" data-city-stats-reset title="직접 입력한 값을 지우고 확인된 기본 자료로 복원">입력값 지우기</button></div></form>`;
}
const CITY_BY_COORD=new Map(Object.entries(R).filter(([,r])=>r.city?.x!=null&&r.city?.y!=null).map(([code,r])=>[`${r.city.x-1},${r.city.y-1}`,code]));

// 토지 추출: 선택한 성지의 실제 지역 경계 범위 안에서 자원 토지를 추출한다.
let landExportOpen=false;
const landExportCities=new Map(); // city id -> {code, region, city}
const landExportCountCache=new Map(); // immutable original layer, city -> 13 level totals
function setLandExportOpen(open){
  landExportOpen=!!open;
  const panel=document.getElementById('landExportPanel'),btn=document.getElementById('landExportToggleBtn');
  if(panel)panel.hidden=!landExportOpen;
  if(btn){btn.classList.toggle('active',landExportOpen);btn.setAttribute('aria-expanded',String(landExportOpen));}
  if(landExportOpen)renderLandExportPanel();
}
function landExportSelectedLevels(){
  return new Set([...document.querySelectorAll('[data-land-level]:checked')].map(el=>Number(el.dataset.landLevel)).filter(v=>v>=1&&v<=12));
}
function landExportToggleCity(code,rgn){
  const city=rgn?.city;if(!city)return;
  const id=String(city.id);
  if(landExportCities.has(id)){landExportCities.delete(id);setLandExportStatus(`${city.name} 선택 해제`);}
  else {landExportCities.set(id,{code,region:rgn,city});setLandExportStatus(`${city.name} 선택 · ${landExportCities.size}곳`,'done');}
  renderLandExportPanel();drawSelection();
}
function setLandExportStatus(text,kind=''){
  const el=document.getElementById('landExportStatus');if(!el)return;el.textContent=text||'';el.className='landExportStatus'+(kind?' '+kind:'');
}
function renderLandExportPanel(){
  const count=document.getElementById('landExportCityCount'),list=document.getElementById('landExportCityList');
  if(count)count.textContent=`${landExportCities.size}곳`;
  if(list){
    if(!landExportCities.size)list.innerHTML='<span class="landExportEmpty">선택된 성지가 없습니다.</span>';
    else list.innerHTML=[...landExportCities.values()].sort((a,b)=>a.city.name.localeCompare(b.city.name,'ko')).map(({region,city})=>`<div class="landExportCityItem"><button type="button" data-land-export-jump="${city.id}" title="지도에서 보기"><b>${city.name}</b><span>Lv.${city.level} · ${region.s} · ${region.m}</span></button><button type="button" class="landExportRemove" data-land-export-remove="${city.id}" aria-label="${city.name} 제거">×</button></div>`).join('');
  }
  updateLandExportResult();
}
function landExportLevelCounts(code,region){
  if(!exactTerrainReady||!resourceRaw)return null;
  let totals=landExportCountCache.get(code);
  if(totals)return totals;
  totals=new Uint32Array(13);
  const b=region?.b||[0,0,W-1,H-1];
  const minX=Math.max(0,Math.floor(b[0])),minY=Math.max(0,Math.floor(b[1]));
  const maxX=Math.min(W-1,Math.floor(b[2])),maxY=Math.min(H-1,Math.floor(b[3]));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    if(codeHex(codes[y*W+x])!==code)continue;
    const i=exactLayerIndexForWorldTile(x,y);if(i<0)continue;
    const rr=resourceRaw[i],lv=rr>>4,kind=rr&15;
    if(kind>=1&&kind<=4&&lv>=1&&lv<=12)totals[lv]++;
  }
  landExportCountCache.set(code,totals);
  return totals;
}
function updateLandExportResult(){
  const el=document.getElementById('landExportResult');if(!el)return;
  const levels=landExportSelectedLevels();
  if(!landExportCities.size){el.textContent='성지를 1곳 이상 선택하세요.';return;}
  if(!levels.size){el.textContent='추출할 토지 레벨을 선택하세요.';return;}
  let count=0;
  for(const {code,region} of landExportCities.values()){
    const totals=landExportLevelCounts(code,region);
    if(!totals)continue;
    for(const lv of levels)count+=totals[lv];
  }
  el.textContent=`${landExportCities.size}개 성지 · 선택 레벨 ${[...levels].sort((a,b)=>a-b).join(', ')} · ${count.toLocaleString()}개 토지`;
}
function landExportRows(){
  const levels=landExportSelectedLevels(),rows=[];
  for(const {code,region,city} of landExportCities.values()){
    const b=region?.b||[0,0,W-1,H-1];
    const minX=Math.max(0,Math.floor(b[0])),minY=Math.max(0,Math.floor(b[1]));
    const maxX=Math.min(W-1,Math.floor(b[2])),maxY=Math.min(H-1,Math.floor(b[3]));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      if(regionAt(x,y)!==code)continue;
      const i=exactLayerIndexForWorldTile(x,y);if(i<0)continue;
      const rr=resourceRaw?.[i]||0,lv=rr>>4,kind=rr&15;
      if(kind<1||kind>4||!levels.has(lv))continue;
      rows.push([region.s,region.m,city.name,lv,RESOURCE_NAMES[kind]||`자원 ${kind}`,`${x+1}.${y+1}`]);
    }
  }
  rows.sort((a,b)=>a[0].localeCompare(b[0],'ko')||a[1].localeCompare(b[1],'ko')||a[2].localeCompare(b[2],'ko')||a[3]-b[3]||a[5].localeCompare(b[5]));
  return rows;
}
function xmlEsc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function downloadLandExportExcel(){
  if(!landExportCities.size){setLandExportStatus('성지를 1곳 이상 선택하세요.','error');return;}
  const levels=landExportSelectedLevels();if(!levels.size){setLandExportStatus('추출할 토지 레벨을 선택하세요.','error');return;}
  const rows=landExportRows();if(!rows.length){setLandExportStatus('조건에 맞는 자원 토지가 없습니다.','error');return;}
  const headers=['주','군','성지 이름','레벨','자원 종류','좌표'];
  const rowXml=(row,head=false)=>'<Row>'+row.map((v,i)=>`<Cell${head?' ss:StyleID="Header"':''}><Data ss:Type="${(!head&&i===3)?'Number':'String'}">${xmlEsc(v)}</Data></Cell>`).join('')+'</Row>';
  const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="맑은 고딕" ss:Size="10"/></Style><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#E8DFC7" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style></Styles><Worksheet ss:Name="토지 추출"><Table><Column ss:Width="70"/><Column ss:Width="80"/><Column ss:Width="95"/><Column ss:Width="45"/><Column ss:Width="70"/><Column ss:Width="75"/>${rowXml(headers,true)}${rows.map(r=>rowXml(r,false)).join('')}</Table><AutoFilter x:Range="R1C1:R${rows.length+1}C6" xmlns="urn:schemas-microsoft-com:office:excel"/></Worksheet></Workbook>`;
  const blob=new Blob(['\ufeff',xml],{type:'application/vnd.ms-excel;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  const d=new Date(),stamp=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
  a.href=url;a.download=`Scenario11_토지추출_${stamp}.xls`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  setLandExportStatus(`${rows.length.toLocaleString()}개 토지를 엑셀로 추출했습니다.`,'done');
}

const regionEntries=Object.entries(R);
const regionsWithCity=regionEntries.filter(([,r])=>r.city && r.city.x!=null && r.city.y!=null);
const regionsWithoutCity=regionEntries.filter(([,r])=>!(r.city && r.city.x!=null && r.city.y!=null));
const map=document.getElementById('map'), ctx=map.getContext('2d');
const fx=document.getElementById('fx'), fctx=fx.getContext('2d');
const scoreShadeCanvas=document.getElementById('scoreShade'),scoreShadeCtx=scoreShadeCanvas.getContext('2d');
// Overscanned LRU base buffers: reuse *exact* terrain, resource colors and boundaries
// while panning. Only the small uncovered margin needs a new render.
let cachedBaseKey='',cachedBaseRevision=0;
const baseCacheEntries=[];
const mapPerf={draws:0,baseCacheHits:0,baseCacheMisses:0,previewFrames:0,lastDrawMs:0,maxDrawMs:0};
Object.defineProperty(window,'__S11MapPerf',{value:mapPerf,configurable:false});
function invalidateBaseCache(){
  cachedBaseRevision++;cachedBaseKey='';
  for(const entry of baseCacheEntries){entry.canvas.width=0;entry.canvas.height=0;}
  baseCacheEntries.length=0;
}
function baseMargin(){return Math.max(96,Math.min(300,Math.round(Math.min(map.clientWidth,map.clientHeight)*0.32)));}
function baseCacheConfigKey(){return [cachedBaseRevision,map.width,map.height,renderDpr,scale,showTerrain,exactTerrainReady,borderMode].join('|');}
function findBaseCache(allowEdge=false){
  const key=baseCacheConfigKey();
  for(let i=baseCacheEntries.length-1;i>=0;i--){
    const entry=baseCacheEntries[i];
    if(entry.key!==key)continue;
    const sx=entry.margin+entry.ox-ox,sy=entry.margin+entry.oy-oy;
    const slack=allowEdge?0:2;
    if(sx < slack||sy < slack||sx+map.clientWidth>entry.cssWidth-slack||sy+map.clientHeight>entry.cssHeight-slack)continue;
    // Move a recently used scale / region to the end of the LRU.
    if(i!==baseCacheEntries.length-1){baseCacheEntries.splice(i,1);baseCacheEntries.push(entry);}
    return entry;
  }
  return null;
}
function paintCachedBase(g,entry){
  const sx=Math.round((entry.margin+entry.ox-ox)*renderDpr),sy=Math.round((entry.margin+entry.oy-oy)*renderDpr);
  g.drawImage(entry.canvas,sx,sy,map.width,map.height,0,0,map.clientWidth,map.clientHeight);
}
function buildBaseCache(){
  const w=map.clientWidth,h=map.clientHeight,margin=baseMargin();
  const canvas=document.createElement('canvas');
  canvas.width=map.width+2*Math.ceil(margin*renderDpr);
  canvas.height=map.height+2*Math.ceil(margin*renderDpr);
  const g=canvas.getContext('2d',{alpha:false});
  const entry={canvas,key:baseCacheConfigKey(),margin,ox,oy,cssWidth:canvas.width/renderDpr,cssHeight:canvas.height/renderDpr};
  const beforeView=activeWorldView,beforeOx=ox,beforeOy=oy;
  try{
    // Culling must include the additional border before shifting the render origin.
    activeWorldView=viewportWorldBounds(8,margin);
    ox+=margin;oy+=margin;
    const bw=entry.cssWidth,bh=entry.cssHeight;
    g.setTransform(renderDpr,0,0,renderDpr,0,0);
    g.fillStyle='#0e0a06';g.fillRect(0,0,bw,bh);
    drawWorldLayer(g,off);
    if(showTerrain&&exactTerrainReady)drawOffsetTileTerrain(g,true);
    g.fillStyle='rgba(0,0,0,.13)';g.fillRect(0,0,bw,bh);
    drawTerritoryRanges(g);
    drawHolySitePrevRanges(g);
    drawSpecialTerrainOutline(g);
  }finally{
    ox=beforeOx;oy=beforeOy;activeWorldView=beforeView;
  }
  baseCacheEntries.push(entry);
  // Two bounded buffers retain frequently revisited scale/position without leaks.
  while(baseCacheEntries.length>2){const old=baseCacheEntries.shift();old.canvas.width=0;old.canvas.height=0;}
  return entry;
}

// 성능 우선: 화면이 매우 큰 경우 내부 캔버스 해상도를 자동으로 조금 낮춰 드래그/확대 시 렉을 줄인다.
function computeRenderDpr(){
  const nativeDpr=window.devicePixelRatio||1;
  const area=(window.innerWidth||0)*(window.innerHeight||0);
  let cap=1.5;
  if(area>2600000) cap=1.2;
  else if(area>1800000) cap=1.35;
  return Math.min(nativeDpr,cap);
}
let renderDpr=computeRenderDpr();
const textWidthCache=new Map();
// 대천명/격문 표시: Scenario11 실측 지점명으로만 결합하며 원본 448개 보급로를 건드리지 않는다.
const DAECHEONMYEONG_CITY_NAMES=new Set(['칠문언','둔류','북굴','남향','엽현','거야','형양','의양','초현','소현','괴리','하규']);
const GYEOKMUN_GATE_NAMES=new Set(['목란새','무현','협석','하구','환구','호림','몽음','축아','서평창','정형','운중','이석','무강구','고성','무관','피씨','단씨']);
// 별도 사용자 지정 직선: 게이트 → 대천명 성지. 곤양은 연결선만 있고 배지 대상은 아니다.
const GYEOKMUN_LINK_NAMES=[
  ['목란새','남향'],['무현','남향'],['협석','엽현'],['하구','엽현'],
  ['환구','칠문언'],['호림','칠문언'],['몽음','거야'],['축아','거야'],
  ['서평창','둔류'],['정형','둔류'],['운중','북굴'],['이석','북굴'],
  ['무강구','초현'],['고성','소현'],['무관','괴리'],['피씨','하규'],
  ['단씨','형양'],['곤양','의양']
];
const GYEOKMUN_GATE_BY_NAME=new Map((X.gates||[]).map(g=>[g.name,g]));
const DAECHEONMYEONG_CITY_BY_NAME=new Map(
  Object.values(R).filter(r=>r.city?.name).map(r=>[r.city.name,r.city])
);
const GYEOKMUN_LINES=GYEOKMUN_LINK_NAMES.map(([from,to])=>({from,to,gate:GYEOKMUN_GATE_BY_NAME.get(from),city:DAECHEONMYEONG_CITY_BY_NAME.get(to)}));
let showGyeokmunLines=false;
for(const ln of GYEOKMUN_LINES) if(!ln.gate||!ln.city) console.warn('[Scenario11] 격문 연결 대상 미확인:',ln.from,ln.to);

const mini=null, mctx=null;
const bgImg=new Image(); bgImg.src='background.png';
const statePalette=['#8EA8B7','#A89BB0','#A8B68A','#C59B8D','#8FAFA4','#C5AE78','#A69AC4','#87A9C0','#A7B291','#C9A078','#B2AEC6'];
const stateColors={}; D.states.forEach((s,i)=>stateColors[s]=statePalette[i%statePalette.length]);
const codeHex=v=>v.toString(16).toUpperCase().padStart(4,'0');
const codeInt=s=>parseInt(s,16);
const ROT=5*Math.PI/4, COS=Math.cos(ROT), SIN=Math.sin(ROT), CX=W/2, CY=H/2, FLIP_X=-1;
const codes=new Uint16Array(W*H); let pp=0;
const gridRLE=D.gridRLE;
const gridRLELength=Array.isArray(gridRLE) ? gridRLE.length : Object.keys(gridRLE).length;
for(let i=0;i<gridRLELength;i+=2){
  const len=Number(gridRLE[i]), val=Number(gridRLE[i+1]);
  codes.fill(val,pp,pp+len);
  pp+=len;
}
if(pp!==W*H){
  console.error('[S3 map] GRID DECODE ERROR:',pp,'/',W*H);
}else{
  console.log('[S3 map] GRID DECODE OK:',pp,'cells');
}

const stateIndex={}; D.states.forEach((s,i)=>stateIndex[s]=i);
const stateByCode={}, stateCenters={}, commanderyByCode={};
for(const s of D.states){
  let sx=0, sy=0, sw=0;
  for(const [code,r] of regionEntries){
    if(r.s!==s) continue;
    const w=Math.max(1,r.k||1);
    sx+=r.c[0]*w; sy+=r.c[1]*w; sw+=w;
    stateByCode[parseInt(code,16)] = stateIndex[r.s];
    // 군 경계는 이름이 아니라 실제 군 고유 그룹 ID를 사용한다.
    // 같은 이름의 군이 서로 다른 그룹으로 중복 존재함(예: 형초 남군 401/404).
    commanderyByCode[parseInt(code,16)] = Math.floor(Number(r.city?.map_region_id||0)/100) || (r.m||'');
  }
  stateCenters[s]=sw?[sx/sw,sy/sw]:[W/2,H/2];
}

const MAX_SCALE=30;
let scale=.65, ox=0, oy=0, dragging=false, moved=false, lastX=0, lastY=0;
let selected=null, hover=null, hoverTile=null, selectedTile=null, searchTargetTile=null;
const TILE_COUNTER_STORAGE_KEY='s3_s11_tile_counter_v1';
let tileCounterMarks=[];
let tileCounterMode=false; // 기본 OFF: 단순 위치 선택으로 카운터가 변하지 않도록 분리
let tileClickTimer=0;

// v17: 실제 이동 가능한 타일을 이용한 최단 경로 탐색
let routeMode=false, routeStart=null, routeEnd=null, routePath=[];
let routeSearchToken=0, routeSearching=false, routeOverlayVisible=true;
let routePanelCollapsed=false;
// 완료된 경로를 최대 4개 보관하고 현재 편집 중 경로 1개를 더해 총 5개까지 동시에 표시한다.
let savedRoutes=[];
const ROUTE_MAX_TOTAL=5;
// 별도 이동 시간 계산기: 강/산은 피하되 성지 외곽(raw 8/9)은 통과 가능하다.
let moveCalcMode=false, moveCalcStart=null, moveCalcEnd=null, moveCalcPath=[], moveCalcSearching=false;
let moveCalcToken=0;
const routeCache=new Map();
const ROUTE_CACHE_MAX=24;
// 폴백용 4개 대형 배열은 Worker가 지원되지 않을 때만 생성해 모바일 메모리 절약.
let routeSeen=null, routeClosed=null, routeG=null, routeParent=null;
let routeGeneration=1;


function loadTileCounterMarks(){
  try{
    const raw=localStorage.getItem(TILE_COUNTER_STORAGE_KEY);
    const arr=raw?JSON.parse(raw):[];
    if(Array.isArray(arr)){
      tileCounterMarks=arr
        .filter(v=>Number.isInteger(v?.x)&&Number.isInteger(v?.y)&&v.x>=0&&v.y>=0&&v.x<W&&v.y<H)
        .map(v=>({x:v.x,y:v.y}));
    }
  }catch(e){
    tileCounterMarks=[];
  }
  updateTileCounterUI();
}
function saveTileCounterMarks(){
  try{
    localStorage.setItem(TILE_COUNTER_STORAGE_KEY,JSON.stringify(tileCounterMarks));
  }catch(e){}
  updateTileCounterUI();
}
function updateTileCounterUI(){
  const el=document.getElementById('tileCounterCount');
  if(el) el.textContent=tileCounterMarks.length;
}
function tileCounterIndex(x,y){
  return tileCounterMarks.findIndex(v=>v.x===x&&v.y===y);
}
function addTileCounterMark(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(x<0||y<0||x>=W||y>=H) return;
  if(tileCounterIndex(x,y)>=0) return;
  tileCounterMarks.push({x,y});
  saveTileCounterMarks();
  scheduleFullDraw();
}
function removeTileCounterMark(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const idx=tileCounterIndex(x,y);
  if(idx<0) return;
  tileCounterMarks.splice(idx,1); // 뒤 번호도 자동으로 1..N 재정렬
  saveTileCounterMarks();
  scheduleFullDraw();
}
function toggleTileCounterMark(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(tileCounterIndex(x,y)>=0) removeTileCounterMark(x,y);
  else addTileCounterMark(x,y);
}
function clearTileCounterMarks(){
  tileCounterMarks=[];
  saveTileCounterMarks();
  scheduleFullDraw();
}

const hoverTileInfoEl=document.getElementById('hoverTileInfo');
const hoverTileCoordEl=document.getElementById('hoverTileCoord');
const hoverTileTerrainEl=document.getElementById('hoverTileTerrain');

function updateHoverTileInfo(mx,my){
  if(!hoverTileInfoEl) return;
  if(mx<0||my<0||mx>=W||my>=H){
    hoverTileCoordEl.textContent='-';
    hoverTileTerrainEl.textContent='-';
    return;
  }
  const t=exactTileInfo(mx,my);
  hoverTileCoordEl.textContent=`(${Math.floor(mx)+1}, ${Math.floor(my)+1})`;
  hoverTileTerrainEl.textContent=t.label||'-';
}
function hideHoverTileInfo(){
  if(hoverTileInfoEl){hoverTileCoordEl.textContent='-';hoverTileTerrainEl.textContent='-';}
  lastInfoTileKey='';
  lastHoverSignature='';
  if(!dragging){hover=null;hoverTile=null;drawSelection();}
}

let labelMode=true, cityMode=true, borderMode=true, shadeMode=true, showMini=false;
let showGates=true, showTransports=true, showTerrain=true, showGrid=true;
// 자원 표시: 1~8레벨은 기존색, 9레벨은 종류 공통 강조색, 10~12레벨은 종류별 강조색.
// 오른쪽 '자원 토지 색상' 범례와 동일한 규칙을 사용한다.
const RESOURCE_LEVEL_COLORS={
  1:{high:[87,245,125]},    // 목재: 밝은 연두색
  2:{high:[84,205,255]},   // 철광: 하늘색
  3:{high:[255,213,85]},   // 석재: 금색
  4:{high:[255,125,75]}    // 식량: 밝은 주황색
};
const RESOURCE_LEVEL9_COLOR=[215,124,255]; // 9레벨 공통 보라색
let resourceLowVisible=false, resourceMidVisible=false, resourceHighVisible=false; // 첫 방문: 지도 중심으로 시작. 저장된 기존 설정은 유지.
let resourceSoftDots=true; // v21: 원본 종류/레벨은 유지, 화면에 그리는 자원 점만 기본 연하게
let resourceColorMode='level'; // level: 기존 레벨별 / uniform: 선택한 한 색으로 1~12 전체 통일
let uniformResourceColor=null;
const visibleResourceKinds={1:true,2:true,3:true,4:true};
const allStructures=[
  ...(X.gates||[]).map(v=>({...v,_type:'gate'})),
  ...(X.docks||[]).map(v=>({...v,_type:'dock'})),
  ...(X.bridges||[]).map(v=>({...v,_type:'bridge'})),
  ...(X.chokepoints||[]).map(v=>({...v,_type:'chokepoint'})),
  ...(X.mountainPaths||[]).map(v=>({...v,_type:'mountain_path'})),
  ...(X.fortresses||[]).map(v=>({...v,_type:'fortress'}))
];
// 원본 배열의 첫 번째 시설 우선순위를 보존한 직접 조회 인덱스.
const STRUCTURES_BY_TILE=new Map(), STRUCTURES_BY_ID=new Map();
for(const st of allStructures){
  const offset=(st._type==='bridge'||st._type==='chokepoint'||st._type==='mountain_path')?2:1;
  const tileKey=`${Math.floor(st.x-offset)},${Math.floor(st.y-offset)}`;
  if(!STRUCTURES_BY_TILE.has(tileKey)) STRUCTURES_BY_TILE.set(tileKey,st);
  const idKey=String(st.id);
  if(!STRUCTURES_BY_ID.has(idKey)) STRUCTURES_BY_ID.set(idKey,st);
}


const off=document.createElement('canvas'); off.width=W; off.height=H; const octx=off.getContext('2d');
const terrainCanvas=document.createElement('canvas'); terrainCanvas.width=W; terrainCanvas.height=H;
const terrainCtx=terrainCanvas.getContext('2d');
// 고배율용 지형은 홀수 게임 X 열(+0.5Y)과 나머지 열을 미리 분리해 둔다.
const terrainShiftCanvas=document.createElement('canvas'); terrainShiftCanvas.width=W; terrainShiftCanvas.height=H;
const terrainShiftCtx=terrainShiftCanvas.getContext('2d');
const terrainNoShiftCanvas=document.createElement('canvas'); terrainNoShiftCanvas.width=W; terrainNoShiftCanvas.height=H;
const terrainNoShiftCtx=terrainNoShiftCanvas.getContext('2d');
// 특수지형 외곽을 데이터 로딩 시 청크별 경로로 한 번 생성한다.
// 축소/중간에서도 화면 밖 도형을 제외하여 큰 투명 래스터 두 장의 합성을 피한다.
let terrainRaw=null, resourceRaw=null, exactTerrainReady=false;

let cityFootprints={};
let regionBoundaryPath=null;
let commanderyBoundaryPath=null;
let stateBoundaryPath=null;
// Per-tile edges are disconnected subpaths. Join them into long chains before
// using Canvas dashes; otherwise the dash pattern restarts at every half tile.
let stateBoundaryDashedPath=null;
let regionPathByCode={};
let regionBoundaryCount=0;
let commanderyBoundaryCount=0;
let stateBoundaryCount=0;
const BOUNDARY_CHUNK_SIZE=96;
let regionBoundaryChunks=new Map(), commanderyBoundaryChunks=new Map();
function boundaryChunkAdd(chunks,x1,y1,x2,y2){
  const mx=(x1+x2)*.5,my=(y1+y2)*.5;
  const cx=Math.floor(mx/BOUNDARY_CHUNK_SIZE),cy=Math.floor(my/BOUNDARY_CHUNK_SIZE);
  const key=cx+','+cy;
  let item=chunks.get(key);
  if(!item){
    item={path:new Path2D(),bounds:{minX:cx*BOUNDARY_CHUNK_SIZE-2,
      minY:cy*BOUNDARY_CHUNK_SIZE-2,maxX:(cx+1)*BOUNDARY_CHUNK_SIZE+2,
      maxY:(cy+1)*BOUNDARY_CHUNK_SIZE+2}};
    chunks.set(key,item);
  }
  item.path.moveTo(x1,y1);item.path.lineTo(x2,y2);
}
function strokeBoundary(g,whole,chunks){
  if(scale<1.4 || !chunks.size){g.stroke(whole);return;}
  for(const item of chunks.values()) if(intersectsWorldView(item.bounds)) g.stroke(item.path);
}

function buildTerritoryBoundarySegments(){
  // IMPORTANT: the world grid is staggered. Odd 0-based X columns (= even in-game X)
  // are shifted down by 0.5 tile. Region/state boundaries must use the same geometry
  // as tile rendering, otherwise vertical boundaries lose half of their segments.
  regionBoundaryPath=new Path2D();
  commanderyBoundaryPath=new Path2D();
  stateBoundaryPath=new Path2D();
  stateBoundaryDashedPath=null;
  regionBoundaryChunks=new Map();commanderyBoundaryChunks=new Map();
  const stateSegments=[];
  regionPathByCode={};
  regionBoundaryCount=0;
  commanderyBoundaryCount=0;
  stateBoundaryCount=0;

  const getRegionPath=(c)=>{
    const k=codeHex(c);
    if(!regionPathByCode[k]) regionPathByCode[k]=new Path2D();
    return regionPathByCode[k];
  };
  const addEdge=(path,x1,y1,x2,y2)=>{
    path.moveTo(x1,y1); path.lineTo(x2,y2);
  };
  const codeAt=(x,y)=>(x>=0&&y>=0&&x<W&&y<H)?codes[y*W+x]:null;
  const edgeKind=(c0,c1)=>{
    if(c1===null) return 'state';
    if(c1===c0) return null;
    if(stateByCode[c1]!==stateByCode[c0]) return 'state';
    if(commanderyByCode[c1]!==commanderyByCode[c0]) return 'commandery';
    return 'region';
  };
  const addHierEdge=(c0,c1,x1,y1,x2,y2)=>{
    const kind=edgeKind(c0,c1);
    if(kind==='state'){
      addEdge(stateBoundaryPath,x1,y1,x2,y2); stateSegments.push([x1,y1,x2,y2]); stateBoundaryCount++;
    }else if(kind==='commandery'){
      addEdge(commanderyBoundaryPath,x1,y1,x2,y2);boundaryChunkAdd(commanderyBoundaryChunks,x1,y1,x2,y2); commanderyBoundaryCount++;
    }else if(kind==='region'){
      addEdge(regionBoundaryPath,x1,y1,x2,y2);boundaryChunkAdd(regionBoundaryChunks,x1,y1,x2,y2); regionBoundaryCount++;
    }
  };

  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const c=codes[y*W+x];
      const own=getRegionPath(c);
      const sy=oddXHalfShift(x); // 0 or +0.5; SAME rule as tile renderer
      const top=y+sy, mid=y+sy+0.5, bottom=y+sy+1;

      const topCode=codeAt(x,y-1), bottomCode=codeAt(x,y+1);
      // In a staggered grid a left/right edge is shared by TWO neighbor tiles.
      // Even 0-based X: upper half touches y-1, lower half touches y.
      // Odd  0-based X: upper half touches y,   lower half touches y+1.
      const sideTopY=(x&1)?y:y-1;
      const sideBottomY=(x&1)?y+1:y;
      const leftTopCode=codeAt(x-1,sideTopY), leftBottomCode=codeAt(x-1,sideBottomY);
      const rightTopCode=codeAt(x+1,sideTopY), rightBottomCode=codeAt(x+1,sideBottomY);

      // Per-region outline, used by selection highlighting. Every exposed edge uses
      // the exact staggered tile geometry, including half vertical edges.
      if(topCode!==c) addEdge(own,x,top,x+1,top);
      if(bottomCode!==c) addEdge(own,x,bottom,x+1,bottom);
      if(leftTopCode!==c) addEdge(own,x,top,x,mid);
      if(leftBottomCode!==c) addEdge(own,x,mid,x,bottom);
      if(rightTopCode!==c) addEdge(own,x+1,top,x+1,mid);
      if(rightBottomCode!==c) addEdge(own,x+1,mid,x+1,bottom);

      // Global hierarchy boundaries. Process each shared edge exactly once:
      // top only at map edge, bottom for every tile, left only at map edge,
      // and both right half-edges for every tile.
      if(y===0) addHierEdge(c,null,x,top,x+1,top);
      addHierEdge(c,bottomCode,x,bottom,x+1,bottom);

      if(x===0){
        addHierEdge(c,null,x,top,x,mid);
        addHierEdge(c,null,x,mid,x,bottom);
      }
      addHierEdge(c,rightTopCode,x+1,top,x+1,mid);
      addHierEdge(c,rightBottomCode,x+1,mid,x+1,bottom);
    }
  }

  stateBoundaryDashedPath=joinBoundarySegmentsForDashes(stateSegments);

  console.log('[S3 map] stagger-aware cached boundaries:',regionBoundaryCount,'holy-site internal /',commanderyBoundaryCount,'commandery /',stateBoundaryCount,'state /',Object.keys(regionPathByCode).length,'region paths');
}

// Link real staggered-grid edges without shifting any coordinate or changing
// topology. A degree!=2 node ends a chain; remaining cycles are traced once.
function joinBoundarySegmentsForDashes(edges){
  const adjacency=new Map(), seen=new Uint8Array(edges.length), path=new Path2D();
  const key=(x,y)=>`${Math.round(x*2)},${Math.round(y*2)}`;
  for(let i=0;i<edges.length;i++){
    const e=edges[i],a=key(e[0],e[1]),b=key(e[2],e[3]);
    let ai=adjacency.get(a);if(!ai){ai=[];adjacency.set(a,ai);}ai.push(i);
    let bi=adjacency.get(b);if(!bi){bi=[];adjacency.set(b,bi);}bi.push(i);
  }
  function trace(start,edgeId){
    let at=start, idx=edgeId, first=true;
    while(idx!==undefined && !seen[idx]){
      const e=edges[idx], a=key(e[0],e[1]), b=key(e[2],e[3]);
      const fromA=at===a;
      const sx=fromA?e[0]:e[2], sy=fromA?e[1]:e[3];
      const tx=fromA?e[2]:e[0], ty=fromA?e[3]:e[1];
      if(first){path.moveTo(sx,sy);first=false;}
      path.lineTo(tx,ty);seen[idx]=1;
      at=fromA?b:a;
      const neighbors=adjacency.get(at)||[];
      // Split at intersections so each map edge is used once without jumping.
      if(neighbors.length!==2)break;
      idx=neighbors.find(id=>!seen[id]);
    }
  }
  for(const [vertex,ids] of adjacency){
    if(ids.length===2)continue;
    for(const id of ids)if(!seen[id])trace(vertex,id);
  }
  for(let i=0;i<edges.length;i++)if(!seen[i])trace(key(edges[i][0],edges[i][1]),i);
  return path;
}


// 배율별 *시각적 우선순위*만 변경한다. 아이콘/선택/검색/추출/자원 필터는 배율에 관계없이 작동한다.
function visualLod(){
  const smooth=(a,b)=>{const t=Math.max(0,Math.min(1,(scale-a)/(b-a)));return t*t*(3-2*t);};
  return {strategy:1-smooth(.56,1.18), mid:smooth(.72,1.75)*(1-smooth(2.6,4.1)), detail:smooth(2.9,6.1)};
}
function mixLod(a,b,t){return a+(b-a)*t;}

function drawTerritoryRanges(g){
  if(!borderMode || !regionBoundaryPath || !commanderyBoundaryPath) return;

  g.save();
  g.translate(ox,oy);
  g.translate(CX*scale,CY*scale);
  g.rotate(ROT);
  g.scale(FLIP_X*scale,scale);
  g.translate(-CX,-CY);
  g.lineJoin='round';g.lineCap='round';
  const inv=Math.max(0.0001,1/scale);
  const lod=visualLod();

  // 1. 성지(소지역) 경계: 지형 뒤로 물러나는 가느다란 점선.
  g.setLineDash([2.3*inv,5.8*inv]);
  g.lineWidth=mixLod(.48,1.05,lod.detail)*inv;
  g.strokeStyle=`rgba(213,219,211,${mixLod(.06,.46,1-lod.strategy)})`;
  strokeBoundary(g,regionBoundaryPath,regionBoundaryChunks);

  // 2. 군 경계: 주 경계와 구분되는 차분한 호박색. 지형 위에서 읽히는 얇은 그림자 선.
  g.setLineDash([]);
  g.lineWidth=mixLod(1.8,3.2,1-lod.strategy)*inv;
  g.strokeStyle=`rgba(32,24,20,${mixLod(.20,.50,1-lod.strategy)})`;
  strokeBoundary(g,commanderyBoundaryPath,commanderyBoundaryChunks);
  g.lineWidth=mixLod(.9,1.85,1-lod.strategy)*inv;
  g.strokeStyle=`rgba(201,145,96,${mixLod(.24,.80,1-lod.strategy)})`;
  strokeBoundary(g,commanderyBoundaryPath,commanderyBoundaryChunks);

  // 3. 주 경계: 강과 달리 끊어지는 청회백색 파선. 배경 암색 외곽도
  // 같은 dash pattern을 써서 물길처럼 보이는 연속된 검은 띠가 남지 않게 한다.
  if(stateBoundaryDashedPath||stateBoundaryPath){
    const statePath=stateBoundaryDashedPath||stateBoundaryPath;
    g.setLineDash([11*inv,7*inv]);
    g.lineWidth=mixLod(4.8,7.4,lod.strategy)*inv;
    g.strokeStyle='rgba(9,17,23,.96)';
    g.stroke(statePath);
    g.lineWidth=mixLod(2.45,3.45,lod.strategy)*inv;
    g.strokeStyle='rgba(239,246,247,.99)';
    g.stroke(statePath);
    g.setLineDash([]);
  }
  g.restore();
}

let holySitePrevRangePath=null;
let holySitePrevRangeCityPaths=null;
function buildHolySitePrevRangePath(){
  const edges=[];
  holySitePrevRangeCityPaths=[];
  let cityEdges=[];
  const add=(x1,y1,x2,y2)=>{const e=[x1,y1,x2,y2];edges.push(e);cityEdges.push(e);};
  for(const [,rgn] of regionsWithCity){
    const city=rgn.city;
    const lv=Number(city?.level||0);
    if(!city||!Number.isFinite(lv)||lv>=20) continue;
    const cx=Math.floor(city.x)-1, cy=Math.floor(city.y)-1;
    cityEdges=[];
    const minX=Math.max(0,cx-20), maxX=Math.min(W-1,cx+20);
    const minY=Math.max(0,cy-20), maxY=Math.min(H-1,cy+20);
    for(let x=minX;x<=maxX;x++){
      const sy=oddXHalfShift(x);
      add(x,minY+sy,x+1,minY+sy);
      add(x,maxY+1+sy,x+1,maxY+1+sy);
    }
    const leftShift=oddXHalfShift(minX), rightShift=oddXHalfShift(maxX);
    for(let y=minY;y<=maxY;y++){
      add(minX,y+leftShift,minX,y+0.5+leftShift);
      add(minX,y+0.5+leftShift,minX,y+1+leftShift);
      add(maxX+1,y+rightShift,maxX+1,y+0.5+rightShift);
      add(maxX+1,y+0.5+rightShift,maxX+1,y+1+rightShift);
    }
    holySitePrevRangeCityPaths.push({id:String(city.id),
      bounds:{minX,minY,maxX:maxX+1,maxY:maxY+1},
      path:joinBoundarySegmentsForDashes(cityEdges)});
  }
  return edges.length?joinBoundarySegmentsForDashes(edges):null;
}
function getHolySitePrevRangePath(){
  if(holySitePrevRangePath===null) holySitePrevRangePath=buildHolySitePrevRangePath();
  return holySitePrevRangePath;
}
function drawHolySitePrevRanges(g){
  const path=getHolySitePrevRangePath();
  if(!path) return;
  g.save();
  g.translate(ox,oy);
  g.translate(CX*scale,CY*scale);
  g.rotate(ROT);
  g.scale(FLIP_X*scale,scale);
  g.translate(-CX,-CY);
  g.lineJoin='round';g.lineCap='round';
  const inv=Math.max(0.0001,1/scale);
  g.setLineDash([6.2*inv,4.4*inv]);
  g.lineWidth=4.0*inv;
  const lod=visualLod();
  g.strokeStyle=`rgba(40,31,8,${mixLod(.30,.72,1-lod.strategy)})`;
  const ranges=scale>=.65?holySitePrevRangeCityPaths.filter(v=>intersectsWorldView(v.bounds)):null;
  if(ranges){for(const city of ranges)g.stroke(city.path);}
  else g.stroke(path);
  g.lineWidth=2.15*inv;
  g.strokeStyle=`rgba(255,226,74,${mixLod(.34,.98,1-lod.strategy)})`;
  if(ranges){for(const city of ranges)g.stroke(city.path);}
  else g.stroke(path);
  g.setLineDash([]);
  g.restore();
}

// 원본 terrain/resource 배열은 인게임 좌표를 그대로 인덱스로 사용한다.
// 화면 내부 world 좌표는 0-based, 인게임 좌표는 +1이므로 원본 layer는 (+1,+1)에서 읽는다.
const EXACT_LAYER_SHIFT_X=1, EXACT_LAYER_SHIFT_Y=1;
function exactLayerIndexForWorldTile(tx,ty){
  const ix=Math.floor(tx)+EXACT_LAYER_SHIFT_X;
  const iy=Math.floor(ty)+EXACT_LAYER_SHIFT_Y;
  if(ix<0||iy<0||ix>=W||iy>=H) return -1;
  return iy*W+ix;
}
function rawTerrainAtWorldTile(tx,ty){
  const i=exactLayerIndexForWorldTile(tx,ty);
  return (i>=0&&terrainRaw)?terrainRaw[i]:null;
}
function rawResourceAtWorldTile(tx,ty){
  const i=exactLayerIndexForWorldTile(tx,ty);
  return (i>=0&&resourceRaw)?resourceRaw[i]:null;
}
function isSingletonRaw11AtWorldTile(tx,ty){
  if(rawTerrainAtWorldTile(tx,ty)!==11) return false;
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
    if(dx===0&&dy===0) continue;
    if(rawTerrainAtWorldTile(tx+dx,ty+dy)===11) return false;
  }
  return true;
}
// 선교/요충지/산길 목록은 raw layer 추출 당시 좌표에 +1되어 저장되어 있어 한 칸 더 보정한다.
function isRawDerivedStructure(s){ return !!s && (s._type==='bridge'||s._type==='chokepoint'||s._type==='mountain_path'||s.kind==='bridge'||s.kind==='chokepoint'||s.kind==='mountain_path'); }
function structureWorldTile(s){ const d=isRawDerivedStructure(s)?2:1; return [s.x-d,s.y-d]; }
function structureGameCoord(s){ const d=isRawDerivedStructure(s)?1:0; return [s.x-d,s.y-d]; }

function isCitySpecialRaw(v){ return v>=8 && v<=13; }
function inBounds(x,y){ return x>=0 && y>=0 && x<W && y<H; }
function buildCityFootprints(){
  cityFootprints={};
  if(!exactTerrainReady) return;
  for(const [code,rgn] of regionEntries){
    const city=rgn.city;
    if(!city || city.x==null || city.y==null) continue;
    const regCode=codeInt(code);
    let sx=city.x-1, sy=city.y-1;
    let seed=null;
    const tryCell=(x,y)=>{
      if(!inBounds(x,y)) return false;
      const idx=y*W+x;
      if(codes[idx]!==regCode) return false;
      if(!isCitySpecialRaw(rawTerrainAtWorldTile(x,y))) return false;
      seed=[x,y];
      return true;
    };
    if(!tryCell(sx,sy)){
      outer:
      for(let rad=1; rad<=6; rad++){
        for(let dy=-rad; dy<=rad; dy++){
          for(let dx=-rad; dx<=rad; dx++){
            if(Math.max(Math.abs(dx),Math.abs(dy))!==rad) continue;
            if(tryCell(sx+dx, sy+dy)) break outer;
          }
        }
      }
    }
    if(!seed) continue;

    const q=[seed], seen=new Set([seed[1]*W+seed[0]]), cells=[];
    while(q.length){
      const [x,y]=q.pop();
      cells.push([x,y]);
      for(let dy=-1; dy<=1; dy++){
        for(let dx=-1; dx<=1; dx++){
          if(dx===0 && dy===0) continue;
          const nx=x+dx, ny=y+dy;
          if(!inBounds(nx,ny)) continue;
          const ni=ny*W+nx;
          if(seen.has(ni)) continue;
          if(codes[ni]!==regCode) continue;
          if(!isCitySpecialRaw(rawTerrainAtWorldTile(nx,ny))) continue;
          seen.add(ni);
          q.push([nx,ny]);
        }
      }
    }

    const edges=[];
    const has=(x,y)=>seen.has(y*W+x);
    for(const [x,y] of cells){
      if(!has(x,y-1)) edges.push([[x,y],[x+1,y]]);
      if(!has(x+1,y)) edges.push([[x+1,y],[x+1,y+1]]);
      if(!has(x,y+1)) edges.push([[x,y+1],[x+1,y+1]]);
      if(!has(x-1,y)) edges.push([[x,y],[x,y+1]]);
    }
    cityFootprints[code]={cells,edges};
  }
}
function drawCityBoundary(g, fp){
  if(!fp || !fp.edges || !fp.edges.length || scale<4.0) return;
  g.save();
  g.setLineDash([3,3]);
  g.lineWidth=1.2;
  g.strokeStyle='rgba(255,245,190,.72)';
  g.beginPath();
  for(const seg of fp.edges){
    const a=worldToScreen(seg[0][0],seg[0][1]), b=worldToScreen(seg[1][0],seg[1][1]);
    g.moveTo(a[0],a[1]); g.lineTo(b[0],b[1]);
  }
  g.stroke();
  g.restore();
}

const RAW_BLOCK_NAMES={
  2:'강',3:'산',
  14:'공성 부지 중심',15:'공성 부지',17:'비밀통로 출구 부지',18:'요지',
  22:'선교 연결부',23:'선교 부지',24:'선교 중심',26:'요충지 중심',27:'요충지 부지',
  28:'산길 중심',29:'산길 부지',30:'산길 부지',34:'복도'
};
const RESOURCE_NAMES={1:'목재',2:'철광',3:'석재',4:'군량'};
// 인게임에서 실제 확인된 성지 내부 타일. 원본 raw 8~13만으로는 성문/성벽을
// 확정할 수 없으므로 검증된 게임 좌표에만 표시명을 적용한다.
// 키는 화면 내부 world 좌표가 아닌 인게임 좌표(+1,+1)이다.
const VERIFIED_CITY_TILE_LABELS=new Map([
  ['565,627',{raw:8,label:'성문'}], // 임진 성지 외곽 성문
  ['565,632',{raw:9,label:'성벽'}]  // 임진 성지 외곽 성벽
]);


async function gunzipBase64ToU8(s){
  const raw=Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  if(typeof DecompressionStream==='undefined') throw new Error('이 브라우저는 DecompressionStream을 지원하지 않습니다.');
  const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function routeCoordText(t){ return t?`(${t.x+1}, ${t.y+1})`:'-'; }
function routeInputText(t){ return t?`${t.x+1}.${t.y+1}`:''; }
// Live ownership is not available: every raw 8/9 city perimeter tile is ALWAYS
// non-traversable for routing, even where an in-game gate/wall was verified.
function isRoutePassable(x,y,allowCityPerimeter=false){
  if(!exactTerrainReady || x<0||y<0||x>=W||y>=H) return false;
  const raw=rawTerrainAtWorldTile(x,y);
  if(raw==null || raw===2 || raw===3) return false;
  if(!allowCityPerimeter && (raw===8 || raw===9)) return false;
  return true;
}
function nearestRoutePassable(x,y,maxRad=10){
  x=Math.floor(x); y=Math.floor(y);
  if(isRoutePassable(x,y)) return {x,y};
  for(let r=1;r<=maxRad;r++){
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const nx=x+dx,ny=y+dy; if(isRoutePassable(nx,ny)) return {x:nx,y:ny};
    }
  }
  return null;
}
function routeNeighbors(x,y,out){
  out.length=0;
  out.push([x,y-1],[x,y+1]);
  if((x&1)===0) out.push([x-1,y-1],[x-1,y],[x+1,y-1],[x+1,y]);
  else out.push([x-1,y],[x-1,y+1],[x+1,y],[x+1,y+1]);
  return out;
}
function routeCube(x,y){
  const cx=x, cz=y-((x-(x&1))>>1), cy=-cx-cz;
  return [cx,cy,cz];
}
function routeHeuristic(ax,ay,bx,by){
  const a=routeCube(ax,ay), b=routeCube(bx,by);
  return Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]));
}
function routeHeapPush(hIdx,hF,idx,f){
  let i=hIdx.length; hIdx.push(idx); hF.push(f);
  while(i>0){ const p=(i-1)>>1; if(hF[p]<=f) break; hIdx[i]=hIdx[p];hF[i]=hF[p];i=p; }
  hIdx[i]=idx; hF[i]=f;
}
function routeHeapPop(hIdx,hF){
  if(!hIdx.length) return -1;
  const root=hIdx[0], li=hIdx.pop(), lf=hF.pop();
  if(hIdx.length){
    let i=0;
    while(true){
      let c=i*2+1; if(c>=hIdx.length) break;
      if(c+1<hIdx.length && hF[c+1]<hF[c]) c++;
      if(hF[c]>=lf) break;
      hIdx[i]=hIdx[c]; hF[i]=hF[c]; i=c;
    }
    hIdx[i]=li; hF[i]=lf;
  }
  return root;
}
function reconstructRoute(endIdx,startIdx){
  const out=[]; let cur=endIdx, guard=0;
  while(cur!==startIdx && cur>=0 && guard<W*H){ out.push({x:cur%W,y:(cur/W)|0}); cur=routeParent[cur]; guard++; }
  if(cur!==startIdx) return [];
  out.push({x:startIdx%W,y:(startIdx/W)|0}); out.reverse(); return out;
}
// Every perimeter raw 8/9 remains blocked; no coordinate overrides are accepted.
// City interiors are not verified against live occupation restrictions.
function routeCityUnverifiedCount(path){
  let n=0;for(const t of path){const raw=rawTerrainAtWorldTile(t.x,t.y);if(raw>=8&&raw<=13)n++;}
  return n;
}
function routeResultCaution(path){
  const n=routeCityUnverifiedCount(path);
  return n?` · 성지 구역 ${n}칸 포함(내부 이동 및 현재 점령 상태는 별도 확인 필요)`:' · 실시간 점령 상태는 자동 조회하지 않음';
}
function routeCacheKey(start,end,allowCityPerimeter=false){return `${start.x},${start.y}>${end.x},${end.y}|perimeter-${allowCityPerimeter?'allowed':'blocked'}-v1`;}
function cachedRoute(key){const hit=routeCache.get(key);if(hit){routeCache.delete(key);routeCache.set(key,hit);}return hit;}
function cacheRoute(key,res){
  routeCache.delete(key); routeCache.set(key,{path:res.path.map(p=>({x:p.x,y:p.y})),expanded:res.expanded});
  if(routeCache.size>ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value);
}
// v22.9: Web Worker로 A*를 메인 스레드에서 분리. 사용할 수 없을 때 기존 분할 계산으로 복구.
let routeWorker=null,routeWorkerReady=false,routeWorkerInit=null,activeWorkerRoute=null;
function cancelActiveRouteWorker(){
  if(activeWorkerRoute){
    activeWorkerRoute.resolve(null);activeWorkerRoute=null;
  }
  try{routeWorker?.postMessage({type:'cancel'});}catch(e){}
}
function initRouteWorker(){
  if(routeWorkerInit)return routeWorkerInit;
  routeWorkerInit=new Promise(resolve=>{
    if(typeof Worker==='undefined'||!terrainRaw){resolve(false);return;}
    try{
      const worker=new Worker('route-worker.js');routeWorker=worker;
      worker.onmessage=e=>{
        const msg=e.data||{};
        if(msg.type==='ready'){routeWorkerReady=true;resolve(true);return;}
        if(!activeWorkerRoute||activeWorkerRoute.token!==msg.token)return;
        if(msg.type==='progress')activeWorkerRoute.onProgress?.(msg.expanded);
        else if(msg.type==='done'||msg.type==='error'){
          const job=activeWorkerRoute;activeWorkerRoute=null;
          job.resolve(msg.type==='error'?{error:msg.error||'작업 스레드 오류'}:{path:msg.path||[],expanded:msg.expanded||0});
        }
      };
      worker.onerror=()=>{
        routeWorkerReady=false;routeWorker=null;worker.terminate();
        if(activeWorkerRoute){activeWorkerRoute.resolve({error:'경로 작업 스레드가 중단되었습니다. 다시 계산해 주세요.'});activeWorkerRoute=null;}
        resolve(false);
      };
      // 원본 배열은 그대로 두고 경로 전용 2.25MB 복사본만 전달한다.
      const copy=terrainRaw.slice();
      worker.postMessage({type:'init',width:W,height:H,terrain:copy.buffer},[copy.buffer]);
    }catch(e){console.warn('[route] Worker 미지원, 기존 분할 계산 사용',e);routeWorkerReady=false;routeWorker=null;resolve(false);}
  });
  return routeWorkerInit;
}
async function findShortestRouteAsync(start,end,onProgress,options={}){
  const token=++routeSearchToken;
  const ready=await initRouteWorker();
  if(token!==routeSearchToken)return null;
  if(!ready||!routeWorkerReady)return findShortestRouteOnMainThread(start,end,onProgress,options);
  cancelActiveRouteWorker();
  return new Promise(resolve=>{
    activeWorkerRoute={token,resolve,onProgress};
    try{routeWorker.postMessage({type:'find',token,start,end,allowCityPerimeter:!!options.allowCityPerimeter});}
    catch(e){activeWorkerRoute=null;resolve({error:'경로 작업을 시작할 수 없습니다. 다시 시도하세요.'});}
  });
}
function findShortestRouteOnMainThread(start,end,onProgress,options={}){
  if(!routeSeen){
    routeSeen=new Uint32Array(W*H);routeClosed=new Uint32Array(W*H);
    routeG=new Uint32Array(W*H);routeParent=new Int32Array(W*H);
  }
  return new Promise(resolve=>{
    const token=++routeSearchToken;
    routeGeneration=(routeGeneration+1)>>>0; if(routeGeneration===0){ routeSeen.fill(0);routeClosed.fill(0);routeGeneration=1; }
    const gen=routeGeneration, sIdx=start.y*W+start.x, eIdx=end.y*W+end.x;
    const hIdx=[], hF=[], nb=[];
    routeSeen[sIdx]=gen; routeG[sIdx]=0; routeParent[sIdx]=-1;
    routeHeapPush(hIdx,hF,sIdx,routeHeuristic(start.x,start.y,end.x,end.y));
    let expanded=0,lastProgress=0;
    const step=()=>{
      if(token!==routeSearchToken){ resolve(null); return; }
      const deadline=performance.now()+9;
      while(hIdx.length && performance.now()<deadline){
        const cur=routeHeapPop(hIdx,hF); if(cur<0) break;
        if(routeClosed[cur]===gen) continue;
        routeClosed[cur]=gen; expanded++;
        if(cur===eIdx){ resolve({path:reconstructRoute(eIdx,sIdx),expanded}); return; }
        const x=cur%W, y=(cur/W)|0, base=routeG[cur];
        routeNeighbors(x,y,nb);
        for(let k=0;k<nb.length;k++){
          const nx=nb[k][0], ny=nb[k][1];
          if(nx<0||ny<0||nx>=W||ny>=H||!isRoutePassable(nx,ny,!!options.allowCityPerimeter)) continue;
          const ni=ny*W+nx; if(routeClosed[ni]===gen) continue;
          const ng=base+1;
          if(routeSeen[ni]!==gen || ng<routeG[ni]){
            routeSeen[ni]=gen; routeG[ni]=ng; routeParent[ni]=cur;
            routeHeapPush(hIdx,hF,ni,ng+routeHeuristic(nx,ny,end.x,end.y));
          }
        }
      }
      if(expanded-lastProgress>=5000){lastProgress=expanded;onProgress?.(expanded);}
      if(!hIdx.length){ resolve({path:[],expanded}); return; }
      setTimeout(step,0);
    };
    setTimeout(step,0);
  });
}
// Route ETA: each step is one tile. Night lasts from 02:00 inclusive to 09:00 exclusive.
// Progress is continuous; when a tile crosses 02:00/09:00, the rate changes at that instant.
const DAY_TILE_SECONDS=190, NIGHT_TILE_SECONDS=550;
const ROUTE_SECONDS_PER_DAY=86400;
function routeDepartureSeconds(text){
  const m=String(text||'').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m?Number(m[1])*3600+Number(m[2])*60:null;
}
function routeTimeText(totalSeconds){
  const seconds=((totalSeconds%ROUTE_SECONDS_PER_DAY)+ROUTE_SECONDS_PER_DAY)%ROUTE_SECONDS_PER_DAY;
  const hh=Math.floor(seconds/3600),mm=Math.floor(seconds%3600/60),ss=seconds%60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}
function routeDurationText(seconds){
  const days=Math.floor(seconds/ROUTE_SECONDS_PER_DAY);
  const hours=Math.floor(seconds%ROUTE_SECONDS_PER_DAY/3600);
  const mins=Math.floor(seconds%3600/60),sec=seconds%60;
  return `${days?days+'일 ':''}${hours?hours+'시간 ':''}${mins?mins+'분 ':''}${sec||!seconds?sec+'초':''}`.trim();
}
function routeTravelEstimate(steps,departSeconds){
  if(!Number.isSafeInteger(steps)||steps<0||departSeconds===null)return null;
  let work=steps*DAY_TILE_SECONDS*NIGHT_TILE_SECONDS;
  let time=departSeconds;
  let iterations=0;
  while(work>0){
    const at=time%ROUTE_SECONDS_PER_DAY;
    const night=at>=7200 && at<32400;
    const until=(at<7200?7200:(at<32400?32400:ROUTE_SECONDS_PER_DAY))-at;
    const speed=night?DAY_TILE_SECONDS:NIGHT_TILE_SECONDS;
    const capacity=until*speed;
    if(work<=capacity){time+=Math.ceil(work/speed);work=0;break;}
    work-=capacity;time+=until;
    if(++iterations>2000000) throw new Error('이동시간 계산 반복 제한을 초과했습니다.');
  }
  return {arrivalSeconds:time,durationSeconds:time-departSeconds,daysLater:Math.floor(time/ROUTE_SECONDS_PER_DAY)};
}
function localDateValue(d=new Date()){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function routeDepartureDateTime(){
  const date=document.getElementById('routeDepartureDate')?.value;
  const hour=document.getElementById('routeDepartureHour')?.value;
  const minute=document.getElementById('routeDepartureMinute')?.value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{2}$/.test(hour||'')||!/^\d{2}$/.test(minute||''))return null;
  const d=new Date(`${date}T${hour}:${minute}:00`);
  return Number.isNaN(d.getTime())?null:d;
}
function routeDateTimeText(d,alwaysDate=true){
  if(!(d instanceof Date)||Number.isNaN(d.getTime()))return '-';
  const md=`${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  const tm=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  return alwaysDate?`${md} ${tm}`:tm;
}
function routeTimingSnapshot(path=routePath){
  const depart=routeDepartureDateTime();
  if(!depart||!path?.length)return null;
  const sec=depart.getHours()*3600+depart.getMinutes()*60+depart.getSeconds();
  const travel=routeTravelEstimate(Math.max(0,path.length-1),sec);
  const arrival=new Date(depart.getTime()+travel.durationSeconds*1000);
  return {depart,arrival,durationSeconds:travel.durationSeconds};
}
function updateRouteTiming(){
  const arrival=document.getElementById('routeArrival');
  const duration=document.getElementById('routeTravelDuration');
  if(!arrival||!duration)return;
  const depart=routeDepartureDateTime();
  if(!depart){arrival.textContent='출발 날짜와 시간을 입력하세요';duration.textContent='';return;}
  if(!routePath.length || routeSearching){arrival.textContent='최단 경로를 계산하면 도착 날짜·시간이 표시됩니다.';duration.textContent='';return;}
  const timing=routeTimingSnapshot(routePath);
  const sameDay=localDateValue(timing.depart)===localDateValue(timing.arrival);
  arrival.textContent=`도착 ${sameDay?routeDateTimeText(timing.arrival,false):routeDateTimeText(timing.arrival,true)}`;
  duration.textContent=`총 이동 ${routeDurationText(timing.durationSeconds)} · 일반 3분 10초/칸 · 야간 02:00~09:00 9분 10초/칸`;
}
function syncRouteInputs(){
  const si=document.getElementById('routeStartInput'),ei=document.getElementById('routeEndInput');
  if(si && document.activeElement!==si) si.value=routeInputText(routeStart);
  if(ei && document.activeElement!==ei) ei.value=routeInputText(routeEnd);
}
function updateRouteUI(message='',kind=''){
  const panel=document.getElementById('routePanel'), btn=document.getElementById('routeToggleBtn');
  panel?.classList.toggle('show',routeMode||routePath.length>0||routeStart||routeEnd);
  panel?.classList.toggle('routeFinished',!!routePath.length && !routeSearching);
  panel?.classList.toggle('routeCollapsed',routePanelCollapsed);
  const collapseBtn=document.getElementById('routeCollapseBtn');
  if(collapseBtn){ collapseBtn.textContent=routePanelCollapsed?'펼치기':'접기'; collapseBtn.setAttribute('aria-expanded',routePanelCollapsed?'false':'true'); collapseBtn.title=routePanelCollapsed?'길작 탐색창 펼치기':'길작 탐색창 최소화'; }
  const editBtn=document.getElementById('routeEditBtn');
  if(editBtn){editBtn.hidden=!routePath.length;editBtn.setAttribute('aria-expanded',panel?.classList.contains('routeEditOpen')?'true':'false');}
  btn?.classList.toggle('active',routeMode); btn?.setAttribute('aria-pressed',routeMode?'true':'false');
  document.body.classList.toggle('routeMode',routeMode);
  document.body.classList.toggle('routeOverlayHidden',!routeOverlayVisible);
  const s=document.getElementById('routeStartCoord'), e=document.getElementById('routeEndCoord'), status=document.getElementById('routeStatus'), result=document.getElementById('routeResult');
  if(s)s.textContent=routeCoordText(routeStart); if(e)e.textContent=routeCoordText(routeEnd);
  syncRouteInputs();
  if(status){ status.textContent=message || (routeMode?(routeStart?'목적지 타일을 클릭하거나 입력하세요.':'시작 타일을 클릭하거나 입력하세요.'):'길작 탐색이 종료되었습니다.'); status.className='routeStatus'+(kind?' '+kind:''); }
  if(result){ result.textContent=routePath.length?`경로 타일 수 ${routePath.length.toLocaleString()}개 · 이동 ${(routePath.length-1).toLocaleString()}칸`:'경로 타일 수 - · 이동 -'; }
  updateRouteTiming();
  const cancel=document.getElementById('routeCancelBtn'); if(cancel) cancel.hidden=!routeSearching;
  const calc=document.getElementById('routeCalculateBtn'); if(calc) calc.disabled=routeSearching;
  const fit=document.getElementById('routeFitBtn'); if(fit) fit.disabled=!routePath.length;
  const vis=document.getElementById('routeVisibilityBtn'); if(vis){vis.disabled=!(routePath.length||savedRoutes.length);vis.textContent=routeOverlayVisible?'경로 숨기기':'경로 표시';}
  const add=document.getElementById('routeAddBtn'); if(add){const total=savedRoutes.length+(routePath.length?1:0);add.disabled=!routePath.length||total>=ROUTE_MAX_TOTAL;add.textContent=total>=ROUTE_MAX_TOTAL?'최대 5개':'경로 추가';}
  renderSavedRouteList();
}
function snapshotCurrentRoute(){
  if(!routePath.length)return null;
  const timing=routeTimingSnapshot(routePath);
  return {start:{...routeStart},end:{...routeEnd},path:routePath.map(v=>({...v})),depart:timing?.depart?.getTime()||null,arrival:timing?.arrival?.getTime()||null};
}
function addAnotherRoute(){
  if(!routePath.length)return;
  const currentCount=savedRoutes.length+1;
  if(currentCount>=ROUTE_MAX_TOTAL){updateRouteUI('경로는 최대 5개까지 표시할 수 있습니다.','error');return;}
  const snap=snapshotCurrentRoute(); if(snap)savedRoutes.push(snap);
  routeStart=null;routeEnd=null;routePath=[];routeMode=true;routeOverlayVisible=true;
  updateRouteUI(`경로 ${savedRoutes.length}개를 유지합니다. 새 시작 타일을 선택하세요.`);drawSelection();
}
function renderSavedRouteList(){
  const host=document.getElementById('routeSavedList'); if(!host)return;
  const all=[...savedRoutes];
  if(!all.length){host.innerHTML='';host.hidden=true;return;}
  host.hidden=false;
  host.innerHTML=all.map((r,i)=>`<div class="routeSavedItem"><b>경로 ${i+1}</b><span>${routeCoordText(r.start)} → ${routeCoordText(r.end)}</span><button type="button" data-route-delete="${i}" title="이 경로 삭제">삭제</button></div>`).join('');
}
function deleteSavedRoute(i){
  if(i<0||i>=savedRoutes.length)return;savedRoutes.splice(i,1);renderSavedRouteList();drawSelection();updateRouteUI('저장된 경로를 삭제했습니다.');
}
function cancelRouteSearch(message='경로 계산을 취소했습니다.'){
  if(!routeSearching) return;
  routeSearchToken++; cancelActiveRouteWorker(); routeSearching=false; updateRouteUI(message,'error'); drawSelection();
}
function clearRoute(keepMode=true){
  routeSearchToken++; cancelActiveRouteWorker(); routeSearching=false; routeStart=null; routeEnd=null; routePath=[]; savedRoutes=[]; routeOverlayVisible=true;
  if(!keepMode) routeMode=false;
  updateRouteUI(); drawSelection();
}
function setRouteMode(on){
  routeMode=!!on;
  if(routeMode){ if(!exactTerrainReady){ updateRouteUI('원본 지형 데이터를 불러오는 중입니다. 잠시 후 다시 시도하세요.','busy'); return; } updateRouteUI(); }
  else updateRouteUI();
}
function setRouteEndpoint(which,tile,{calculate=false,message=true}={}){
  if(!tile) return false;
  const p=nearestRoutePassable(tile.x,tile.y,10);
  if(!p){updateRouteUI(`(${tile.x+1}, ${tile.y+1}) 주변에서 이동 가능한 타일을 찾지 못했습니다.`,'error');return false;}
  if(routeSearching) cancelRouteSearch('새 좌표를 적용하기 위해 이전 계산을 취소했습니다.');
  routePath=[]; routeOverlayVisible=true;
  if(which==='start') routeStart=p; else routeEnd=p;
  routeMode=true;
  updateRouteUI(message?(routeStart&&routeEnd?'경로 계산 준비 완료.':'다른 한쪽 위치를 지정하세요.'):'');
  drawSelection();
  if(calculate && routeStart&&routeEnd) calculateCurrentRoute();
  return true;
}
async function calculateCurrentRoute(){
  if(!exactTerrainReady){updateRouteUI('원본 지형 데이터를 아직 불러오지 못했습니다.','error');return;}
  if(!routeStart||!routeEnd){updateRouteUI('시작지와 목적지를 모두 지정하세요.','error');return;}
  if(!isRoutePassable(routeStart.x,routeStart.y)||!isRoutePassable(routeEnd.x,routeEnd.y)){updateRouteUI('시작지 또는 목적지가 강·산 또는 통행 불가 성문·성벽(성지 외곽)에 있습니다. 다른 좌표를 선택하세요.','error');return;}
  if(routeStart.x===routeEnd.x&&routeStart.y===routeEnd.y){routePath=[{...routeStart}];routeOverlayVisible=true;updateRouteUI('시작지와 목적지가 같은 타일입니다.','done');drawSelection();return;}
  const key=routeCacheKey(routeStart,routeEnd),cached=cachedRoute(key);
  if(cached){routePath=cached.path.map(p=>({...p}));routeOverlayVisible=true;updateRouteUI(`저장된 계산 결과 · ${cached.expanded.toLocaleString()}개 타일 탐색${routeResultCaution(routePath)}`,'done');drawSelection();return;}
  routePath=[];routeOverlayVisible=true;routeSearching=true;updateRouteUI('강·산 및 모든 성지 외곽 차단 기준 계산 중…','busy');drawSelection();
  const res=await findShortestRouteAsync(routeStart,routeEnd,n=>{if(routeSearching)updateRouteUI(`최단 경로 계산 중… ${n.toLocaleString()}개 타일 탐색`,'busy');});
  if(!res){return;}
  routeSearching=false;
  if(res.error){updateRouteUI(res.error,'error');drawSelection();return;}
  if(!res.path.length){routePath=[];updateRouteUI('강·산 및 성문·성벽(성지 외곽)을 모두 차단한 조건에서 경로를 찾지 못했습니다.','error');drawSelection();return;}
  routePath=res.path;cacheRoute(key,res);updateRouteUI(`성문·성벽 전체 차단 기준 경로 · ${res.expanded.toLocaleString()}개 타일 탐색${routeResultCaution(routePath)}`,'done');drawSelection();
}
async function routePickTile(tx,ty){
  tx=Math.floor(tx); ty=Math.floor(ty);
  if(!exactTerrainReady){ updateRouteUI('원본 지형 데이터를 아직 불러오지 못했습니다.','error'); return; }
  if(!isRoutePassable(tx,ty)){ updateRouteUI(`(${tx+1}, ${ty+1})은 강·산 또는 통행 불가 성문·성벽(성지 외곽)입니다. 다른 좌표를 선택하세요.`,'error'); return; }
  if(routeSearching) cancelRouteSearch('새 타일을 선택해 이전 계산을 취소했습니다.');
  if(!routeStart || routeEnd){ routeStart={x:tx,y:ty}; routeEnd=null; routePath=[]; routeOverlayVisible=true; updateRouteUI('목적지 타일을 클릭하거나 입력하세요.'); drawSelection(); return; }
  routeEnd={x:tx,y:ty}; routePath=[]; routeOverlayVisible=true; updateRouteUI('목적지를 선택했습니다. 경로를 계산합니다.'); drawSelection();
  await calculateCurrentRoute();
}
function routePointUnscaled(t){
  const wx=t.x+0.5,wy=t.y+0.5+oddXHalfShift(t.x),dx=(wx-CX)*FLIP_X,dy=wy-CY;
  return [CX+dx*COS-dy*SIN,CY+dx*SIN+dy*COS];
}
function fitRouteToView(){
  const pts=routePath.length?routePath:[routeStart,routeEnd].filter(Boolean); if(!pts.length)return;
  let minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity;
  for(const t of pts){const p=routePointUnscaled(t);minx=Math.min(minx,p[0]);maxx=Math.max(maxx,p[0]);miny=Math.min(miny,p[1]);maxy=Math.max(maxy,p[1]);}
  const w=map.clientWidth,h=map.clientHeight,desktop=window.innerWidth>900;
  const leftInset=desktop&&!document.body.classList.contains('panelCollapsed')?315:24;
  const resource=document.getElementById('resourceLegend');
  const rightInset=desktop&&resource?.open?280:24;
  const topInset=70,bottomInset=70;
  const aw=Math.max(220,w-leftInset-rightInset),ah=Math.max(180,h-topInset-bottomInset);
  const sx=aw/Math.max(1,maxx-minx+2),sy=ah/Math.max(1,maxy-miny+2);
  scale=Math.max(.12,Math.min(MAX_SCALE,Math.min(sx,sy)*.90));
  const cx=(minx+maxx)/2,cy=(miny+maxy)/2;
  ox=leftInset+aw/2-scale*cx;oy=topInset+ah/2-scale*cy;draw();
}
function applyRouteInputs(){
  const si=parseGameCoord(document.getElementById('routeStartInput')?.value),ei=parseGameCoord(document.getElementById('routeEndInput')?.value);
  if(!si||!ei){updateRouteUI('좌표 형식을 확인하세요. 예: 837.333','error');return;}
  const s={x:si.x-1,y:si.y-1},e={x:ei.x-1,y:ei.y-1};
  if(!isRoutePassable(s.x,s.y)||!isRoutePassable(e.x,e.y)){updateRouteUI('입력 좌표가 강·산 또는 통행 불가 성문·성벽(성지 외곽)입니다. 좌표를 자동으로 변경하지 않았습니다.','error');return;}
  if(routeSearching) cancelRouteSearch();
  routeStart=s;routeEnd=e;routePath=[];routeOverlayVisible=true;routeMode=true;updateRouteUI('입력 좌표를 적용했습니다. 경로를 계산합니다.');drawSelection();calculateCurrentRoute();
}
function routeTargetFromSearch(kind,key){
  if(kind==='region'){
    const r=R[key];if(!r)return null;
    if(r.city?.x!=null&&r.city?.y!=null)return nearestRoutePassable(r.city.x-1,r.city.y-1,10);
    return nearestRoutePassable(Math.floor(r.c[0]),Math.floor(r.c[1]),10);
  }
  const st=STRUCTURES_BY_ID.get(String(key));if(!st)return null;
  const p=structureWorldTile(st);return nearestRoutePassable(p[0],p[1],10);
}
function setSearchAsRoute(kind,key,which){
  const t=routeTargetFromSearch(kind,key); if(!t){updateRouteUI('이 위치 주변에서 이동 가능한 타일을 찾지 못했습니다.','error');return;}
  setRouteEndpoint(which,t,{calculate:true}); closeSearchResults(); searchInput.blur();
}
// 경로 점 좌표변환 + Path2D 구성은 화면 좌표가 바뀔 때에만 수행한다.
// WeakMap은 사용자가 기존 경로를 삭제하면 해당 경로 캐시도 GC 가능하도록 한다.
const ROUTE_SCREEN_PATHS=new WeakMap();
function routeScreenPath(path){
  const key=`${scale}|${ox}|${oy}|${map.clientWidth}|${map.clientHeight}`;
  const hit=ROUTE_SCREEN_PATHS.get(path);
  if(hit?.key===key&&hit.length===path.length)return hit.result;
  const result=new Path2D(),w=map.clientWidth,h=map.clientHeight,margin=40;
  let prior=null,wasVisible=false;
  for(let i=0;i<path.length;i++){
    const t=path[i],p=tileCenterToScreen(t.x,t.y);
    if(prior&&Math.max(prior[0],p[0])>=-margin&&Math.min(prior[0],p[0])<=w+margin &&
      Math.max(prior[1],p[1])>=-margin&&Math.min(prior[1],p[1])<=h+margin){
      if(!wasVisible)result.moveTo(prior[0],prior[1]);
      result.lineTo(p[0],p[1]);wasVisible=true;
    }else wasVisible=false;
    prior=p;
  }
  ROUTE_SCREEN_PATHS.set(path,{key,length:path.length,result});
  return result;
}
function drawPathLine(path,color='#ff91c7',alpha=1){
  if(!path?.length)return;
  fctx.save(); fctx.globalAlpha=alpha;
  if(path.length>1){
    const screenPath=routeScreenPath(path);
    fctx.lineJoin='round';fctx.lineCap='round';fctx.strokeStyle='rgba(9,17,27,.97)';fctx.lineWidth=8;fctx.stroke(screenPath);
    fctx.strokeStyle=color;fctx.lineWidth=4;fctx.stroke(screenPath);
  }
  fctx.restore();
}
function drawTimeLabel(t,text,fill='#fff4d5'){
  if(!t||!text)return;const p=tileCenterToScreen(t.x,t.y),x=p[0]+17,y=p[1];
  fctx.font='800 11px "Noto Sans KR",sans-serif';fctx.textAlign='left';fctx.textBaseline='middle';
  const w=fctx.measureText(text).width+12,h=22;
  fctx.fillStyle='rgba(16,20,25,.94)';fctx.strokeStyle='rgba(255,234,185,.75)';fctx.lineWidth=1;
  fctx.beginPath();fctx.roundRect?.(x,y-h/2,w,h,6);if(!fctx.roundRect){fctx.rect(x,y-h/2,w,h);}fctx.fill();fctx.stroke();
  fctx.fillStyle=fill;fctx.fillText(text,x+6,y+.5);
}
function drawRouteMarkers(start,end,departMs,arrivalMs,index=null){
  const marker=(t,fill,label)=>{if(!t)return;const p=tileCenterToScreen(t.x,t.y);fctx.beginPath();fctx.arc(p[0],p[1],13,0,Math.PI*2);fctx.fillStyle='rgba(5,18,31,.95)';fctx.fill();fctx.beginPath();fctx.arc(p[0],p[1],10,0,Math.PI*2);fctx.fillStyle=fill;fctx.fill();fctx.strokeStyle='#fff8e9';fctx.lineWidth=2;fctx.stroke();fctx.font='900 11px "Noto Sans KR",sans-serif';fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillStyle='#16202c';fctx.fillText(label,p[0],p[1]+.5);};
  const tag=index?String(index):'';marker(start,'#7ee27b',tag?`S${tag}`:'S');marker(end,'#ff806e',tag?`E${tag}`:'E');
  if(departMs)drawTimeLabel(start,`출발 ${routeDateTimeText(new Date(departMs),true)}`,'#d9ffd6');
  if(arrivalMs)drawTimeLabel(end,`도착 ${routeDateTimeText(new Date(arrivalMs),true)}`,'#ffe0d7');
}
function drawRouteOverlay(){
  if(!routeOverlayVisible)return;
  const hasAny=savedRoutes.length||routeStart||routePath.length;if(!hasAny)return;
  fctx.save();fctx.setTransform(renderDpr,0,0,renderDpr,0,0);
  const palette=['#73d7ff','#f6ca62','#b9a4ff','#72e0a8'];
  savedRoutes.forEach((r,i)=>{drawPathLine(r.path,palette[i%palette.length],.86);drawRouteMarkers(r.start,r.end,r.depart,r.arrival,i+1);});
  if(routePath.length>1){
    drawPathLine(routePath,'#ff91c7',1);
    if(routePath.length>10){
      const vr=map.getBoundingClientRect(),vw=vr.width,vh=vr.height;
      for(let step=10;step<routePath.length;step+=10){const t=routePath[step],p=tileCenterToScreen(t.x,t.y);if(p[0]<-24||p[1]<-24||p[0]>vw+24||p[1]>vh+24)continue;const label=String(step),radius=label.length>=3?11:10;fctx.beginPath();fctx.arc(p[0],p[1],radius+3,0,Math.PI*2);fctx.fillStyle='rgba(5,18,31,.93)';fctx.fill();fctx.beginPath();fctx.arc(p[0],p[1],radius,0,Math.PI*2);fctx.fillStyle='#f8d46d';fctx.fill();fctx.strokeStyle='#fff3bd';fctx.lineWidth=1.5;fctx.stroke();fctx.font=`900 ${label.length>=3?9:10}px "Noto Sans KR",sans-serif`;fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillStyle='#2b1b08';fctx.fillText(label,p[0],p[1]+.4);}
    }
  }
  const timing=routePath.length?routeTimingSnapshot(routePath):null;
  drawRouteMarkers(routeStart,routeEnd,timing?.depart?.getTime()||null,timing?.arrival?.getTime()||null,savedRoutes.length+1);
  fctx.restore();
}
function drawMoveCalcOverlay(){
  if(!moveCalcMode&&!moveCalcPath.length)return;
  fctx.save();fctx.setTransform(renderDpr,0,0,renderDpr,0,0);
  if(moveCalcPath.length>1){const screenPath=routeScreenPath(moveCalcPath);fctx.setLineDash([7,6]);fctx.strokeStyle='rgba(0,0,0,.86)';fctx.lineWidth=8;fctx.stroke(screenPath);fctx.strokeStyle='#73f3e8';fctx.lineWidth=4;fctx.stroke(screenPath);fctx.setLineDash([]);}
  const m=(t,fill,label)=>{if(!t)return;const p=tileCenterToScreen(t.x,t.y);fctx.beginPath();fctx.arc(p[0],p[1],10,0,Math.PI*2);fctx.fillStyle=fill;fctx.fill();fctx.strokeStyle='#fff';fctx.lineWidth=2;fctx.stroke();fctx.font='900 10px sans-serif';fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillStyle='#123';fctx.fillText(label,p[0],p[1]);};m(moveCalcStart,'#8ff5db','A');m(moveCalcEnd,'#ffd283','B');
  fctx.restore();
}

function updateMoveCalcUI(message='',kind=''){
  const panel=document.getElementById('moveCalcPanel'),btn=document.getElementById('moveCalcToggleBtn');
  panel?.classList.toggle('show',moveCalcMode||moveCalcPath.length||moveCalcStart||moveCalcEnd);btn?.classList.toggle('active',moveCalcMode);btn?.setAttribute('aria-pressed',moveCalcMode?'true':'false');
  const s=document.getElementById('moveCalcStartCoord'),e=document.getElementById('moveCalcEndCoord'),st=document.getElementById('moveCalcStatus');
  if(s)s.textContent=routeCoordText(moveCalcStart);if(e)e.textContent=routeCoordText(moveCalcEnd);if(st){st.textContent=message||(moveCalcMode?(moveCalcStart?'목적지 타일을 클릭하세요.':'출발지 타일을 클릭하세요.'):'이동 시간 계산기가 종료되었습니다.');st.className='moveCalcStatus'+(kind?' '+kind:'');}
  const result=document.getElementById('moveCalcResult');
  if(result){if(!moveCalcPath.length)result.innerHTML='이동 -';else{const steps=Math.max(0,moveCalcPath.length-1);const fmt=s=>routeDurationText(steps*s);result.innerHTML=`<b>${steps.toLocaleString()}칸</b><div>일반 부대 <strong>${fmt(9)}</strong></div><div>충차 <strong>${fmt(18)}</strong></div><div>투석기 <strong>${fmt(45)}</strong></div>`;}}
}
function clearMoveCalc(close=false){moveCalcToken++;moveCalcSearching=false;moveCalcStart=null;moveCalcEnd=null;moveCalcPath=[];if(close)moveCalcMode=false;updateMoveCalcUI();drawSelection();}
async function calculateMoveTimePath(){
  if(!moveCalcStart||!moveCalcEnd)return;
  const key=routeCacheKey(moveCalcStart,moveCalcEnd,true),cached=cachedRoute(key);
  if(cached){moveCalcSearching=false;moveCalcPath=cached.path;updateMoveCalcUI('저장된 계산 결과 · 성지 외곽 통과 허용','done');drawSelection();return;}
  moveCalcSearching=true;updateMoveCalcUI('성지 외곽 통과 허용 기준 최단 이동칸 계산 중…','busy');
  const my=++moveCalcToken;
  const res=await findShortestRouteAsync(moveCalcStart,moveCalcEnd,n=>{if(moveCalcSearching&&my===moveCalcToken)updateMoveCalcUI(`계산 중… ${n.toLocaleString()}개 타일 탐색`,'busy');},{allowCityPerimeter:true});
  if(my!==moveCalcToken||!res)return;moveCalcSearching=false;
  if(res.error||!res.path?.length){moveCalcPath=[];updateMoveCalcUI(res.error||'강·산을 피하는 경로를 찾지 못했습니다.','error');drawSelection();return;}
  moveCalcPath=res.path;cacheRoute(key,res);updateMoveCalcUI('계산 완료 · 성지 외곽은 통과 가능으로 계산했습니다.','done');drawSelection();
}
function moveCalcPickTile(x,y){
  x=Math.floor(x);y=Math.floor(y);if(!isRoutePassable(x,y,true)){updateMoveCalcUI('강·산 타일은 출발지/목적지로 선택할 수 없습니다.','error');return;}
  if(!moveCalcStart||moveCalcEnd){moveCalcStart={x,y};moveCalcEnd=null;moveCalcPath=[];updateMoveCalcUI('목적지 타일을 클릭하세요.');drawSelection();return;}
  moveCalcEnd={x,y};moveCalcPath=[];updateMoveCalcUI('목적지를 선택했습니다. 이동 시간을 계산합니다.');drawSelection();calculateMoveTimePath();
}
function exactTileInfo(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(x<0||y<0||x>=W||y>=H) return {label:'-',raw:null,resourceRaw:null,detail:''};
  if(!exactTerrainReady) return {label:'원본 지형 로딩 중',raw:null,resourceRaw:null,detail:''};
  const i=exactLayerIndexForWorldTile(x,y);
  if(i<0) return {label:'-',raw:null,resourceRaw:null,detail:'원본 layer 범위 밖'};
  const raw=terrainRaw[i], rr=resourceRaw[i];
  if(raw===2) return {label:'강',raw,resourceRaw:rr,detail:'blockType 2 · 인게임 좌표 보정 적용'};
  if(raw===3) return {label:'산',raw,resourceRaw:rr,detail:'blockType 3 · 인게임 좌표 보정 적용'};
  if(raw===0){
    if(rr===0) return {label:'공터',raw,resourceRaw:rr,detail:'일반 육지(raw 0) + 자원 없음 · 인게임 좌표 보정 적용'};
    const lv=rr>>4, rt=rr&15, rn=RESOURCE_NAMES[rt]||('자원 '+rt);
    if(lv===0) return {label:`${rn} · 원본 등급 0`,raw,resourceRaw:rr,detail:`일반 육지(raw 0) · 자원 byte ${rr} · 희귀 원본 등급 0 코드`};
    return {label:`${rn} Lv.${lv}`,raw,resourceRaw:rr,detail:`일반 육지(raw 0) · 자원 byte ${rr} · 인게임 좌표 보정 적용`};
  }
  // 클릭/좌표 이동/마우스 오버는 모두 exactTileInfo()를 사용하므로,
  // 원본 타일 데이터나 경로 탐색 규칙을 바꾸지 않고 표시명만 정정한다.
  const verifiedCityTile=VERIFIED_CITY_TILE_LABELS.get(`${x+1},${y+1}`);
  if(verifiedCityTile && raw===verifiedCityTile.raw){
    return {label:verifiedCityTile.label,raw,resourceRaw:rr,detail:`인게임 실측 확인 · 원본 blockType ${raw}`};
  }
  if(raw===11 && isSingletonRaw11AtWorldTile(x,y)) return {label:'성채',raw,resourceRaw:rr,detail:'단독 raw 11 · 성채 중심 패턴'};
  // raw 9 appears at city perimeter corners (e.g. measured wall 565,632).
  // raw 8 also surrounds the perimeter, but measured gate 565,627 is raw 8:
  // raw 8 alone does not distinguish a gate from a wall. Do not fabricate gate positions.
  if(raw===9) return {label:'성지 외곽(성벽 추정)',raw,resourceRaw:rr,detail:'원본 blockType 9 · 성지 외곽 모서리형 · 565,632만 인게임 성벽 실측 확인'};
  if(raw===8) return {label:'성지 외곽(성문/성벽 미확정)',raw,resourceRaw:rr,detail:'원본 blockType 8 · 성문/성벽 공통 코드 · 성문 실측 565,627 · 다른 좌표는 게임 자료 검증 필요'};
  if(raw>=10&&raw<=13) return {label:'성지 내부 부지',raw,resourceRaw:rr,detail:`원본 blockType ${raw} · 내부 부지 유형 세부 명칭 미확정`};
  const n=RAW_BLOCK_NAMES[raw];
  if(n) return {label:n,raw,resourceRaw:rr,detail:`원본 blockType ${raw}`};
  return {label:`특수 지형`,raw,resourceRaw:rr,detail:`원본 raw ${raw} · 명칭 미확정`};
}
function tileRecord(x,y){
  const t=exactTileInfo(x,y);
  return {x:Math.floor(x),y:Math.floor(y),terrain:t.label,raw:t.raw,resourceRaw:t.resourceRaw,detail:t.detail};
}
// Original blockType 14 is the center of a siege plot (e.g. game 369.579).
// Cache its positions once; never modify original terrain bytes or route passability.
const siegeCenterTiles=[];
function indexSiegeCenterTiles(){
  siegeCenterTiles.length=0;
  if(!exactTerrainReady)return;
  for(let iy=1;iy<H;iy++)for(let ix=1;ix<W;ix++){
    if(terrainRaw[iy*W+ix]===14) siegeCenterTiles.push({x:ix-1,y:iy-1});
  }
}
let inferredFortresses=[];
let fortressStructures=[];
function buildInferredFortresses(){
  inferredFortresses=[];
  if(!exactTerrainReady) return;
  const known=new Set((X.fortresses||[]).map(v=>`${v.x},${v.y}`));
  for(let gy=1;gy<H;gy++) for(let gx=1;gx<W;gx++){
    if(terrainRaw[gy*W+gx]!==11) continue;
    let linked=false;
    for(let dy=-1;dy<=1&&!linked;dy++) for(let dx=-1;dx<=1;dx++){
      if(dx===0&&dy===0) continue;
      const nx=gx+dx, ny=gy+dy;
      if(nx>=0&&ny>=0&&nx<W&&ny<H&&terrainRaw[ny*W+nx]===11){ linked=true; break; }
    }
    if(linked || known.has(`${gx},${gy}`)) continue;
    inferredFortresses.push({id:`raw11_${gx}_${gy}`,name:'성채',x:gx,y:gy,kind:'fortress',_type:'fortress',_inferred:true});
  }
  if(inferredFortresses.length){
    allStructures.push(...inferredFortresses);
    // 보강된 원본 raw11 성채도 기존 시설 조회/검색의 결과에서 누락하지 않는다.
    for(const st of inferredFortresses){
      const tileKey=`${Math.floor(st.x-1)},${Math.floor(st.y-1)}`;
      if(!STRUCTURES_BY_TILE.has(tileKey))STRUCTURES_BY_TILE.set(tileKey,st);
      if(!STRUCTURES_BY_ID.has(String(st.id)))STRUCTURES_BY_ID.set(String(st.id),st);
      STRUCTURE_SEARCH_ROWS.push({st,key:(st.name+' '+st.id).toLowerCase()});
    }
    previousSearchQuery='';previousSearchMatches=null;
  }
  fortressStructures=allStructures.filter(v=>v._type==='fortress');
  console.log('[S3 map] raw11 성채 보강:',inferredFortresses.length,'개 / 총',(X.fortresses||[]).length+inferredFortresses.length);
}

// v22.9: 원본 배열은 불변. 처음에는 전체 지형을 구성하고, 이후에는
// 자원 종류 × 레벨 그룹별 인덱스만 부분 갱신한다(지형·경계·시설 재계산 없음).
let terrainOverlayBuildId=0, overlayImageBuffers=null, overlayBucketIndices=null;
let overlayAppliedPrefs=null, overlayBusy=false, overlayUpdateQueued=false;
// 원본 타일 raw 7 = 사용자가 지정한 특수지형 (예: 751.932, 620.855).
// raw 3은 산지이므로 강조 대상으로 착각하지 않는다.
// 원본 바이트/통행 조건/자원 색/주·군 경계는 변경하지 않는다.
const SPECIAL_TERRAIN_RAW=7;
const SPECIAL_OUTLINE_CHUNK=80;
let specialOutlineChunkPaths=new Map();
function isSpecialTerrainWorld(x,y){
  const ix=x+1,iy=y+1;
  return ix>=0&&iy>=0&&ix<W&&iy<H&&terrainRaw[iy*W+ix]===SPECIAL_TERRAIN_RAW;
}
function buildSpecialOutlineRasters(){
  // 픽셀 경계용 별도 캔버스 대신 동일한 원본 경계의 청크 Path2D만 저장한다.
  specialOutlineChunkPaths=new Map();
  const addEdge=(p,x1,y1,x2,y2)=>{p.moveTo(x1,y1);p.lineTo(x2,y2);};
  for(let y=0;y<H-1;y++)for(let x=0;x<W-1;x++){
    if(!isSpecialTerrainWorld(x,y))continue;
    const top=y-1,bottom=y+1,left=x-1,right=x+1;
    const upper=(x&1)?y:y-1,lower=(x&1)?y+1:y;
    const boundary=!isSpecialTerrainWorld(x,top)||!isSpecialTerrainWorld(x,bottom)
      ||!isSpecialTerrainWorld(left,upper)||!isSpecialTerrainWorld(left,lower)
      ||!isSpecialTerrainWorld(right,upper)||!isSpecialTerrainWorld(right,lower);
    if(!boundary)continue;
    const chunkX=Math.floor(x/SPECIAL_OUTLINE_CHUNK),chunkY=Math.floor(y/SPECIAL_OUTLINE_CHUNK);
    const key=chunkX+','+chunkY;
    let item=specialOutlineChunkPaths.get(key);
    if(!item){item={path:new Path2D(),bounds:{minX:chunkX*SPECIAL_OUTLINE_CHUNK,minY:chunkY*SPECIAL_OUTLINE_CHUNK,
      maxX:(chunkX+1)*SPECIAL_OUTLINE_CHUNK+2,maxY:(chunkY+1)*SPECIAL_OUTLINE_CHUNK+2}};
      specialOutlineChunkPaths.set(key,item);}
    const path=item.path,sy=oddXHalfShift(x),y0=y+sy,ym=y0+.5,y1=y0+1;
    if(!isSpecialTerrainWorld(x,top))addEdge(path,x,y0,x+1,y0);
    if(!isSpecialTerrainWorld(x,bottom))addEdge(path,x,y1,x+1,y1);
    if(!isSpecialTerrainWorld(left,upper))addEdge(path,x,y0,x,ym);
    if(!isSpecialTerrainWorld(left,lower))addEdge(path,x,ym,x,y1);
    if(!isSpecialTerrainWorld(right,upper))addEdge(path,x+1,y0,x+1,ym);
    if(!isSpecialTerrainWorld(right,lower))addEdge(path,x+1,ym,x+1,y1);
  }
}
function drawSpecialTerrainOutline(g){
  if(!showTerrain||!exactTerrainReady)return;
  // 사용자 지정 특수지형(raw 7)의 실제 연결된 타일 외곽만 강조한다.
  // 화면 밖 청크는 그리지 않아 드래그/확대 성능을 유지한다.
  const paths=[...specialOutlineChunkPaths.values()].filter(v=>intersectsWorldView(v.bounds));
  if(!paths.length)return;
  g.save();g.translate(ox,oy);g.translate(CX*scale,CY*scale);g.rotate(ROT);
  g.scale(FLIP_X*scale,scale);g.translate(-CX,-CY);
  g.lineJoin='round';g.lineCap='round';g.setLineDash([]);
  const inv=1/Math.max(scale,.0001);
  // 특수지형의 외곽을 '밝은 실선'으로 표시하되 이전 범위의 노란 점선과
  // 구별되도록 연한 크림색을 사용하고 선이 타일 내부로 과도하게 번지지 않게 한다.
  g.strokeStyle='rgba(255,230,172,.23)';g.lineWidth=5.0*inv;
  for(const item of paths)g.stroke(item.path);
  g.strokeStyle='rgba(21,17,13,.90)';g.lineWidth=3.2*inv;
  for(const item of paths)g.stroke(item.path);
  g.strokeStyle='rgba(255,241,190,.98)';g.lineWidth=1.65*inv;
  for(const item of paths)g.stroke(item.path);
  g.restore();
}


function resourcePrefsSnapshot(){
  return {low:resourceLowVisible,mid:resourceMidVisible,high:resourceHighVisible,soft:resourceSoftDots,
    mode:resourceColorMode,color:uniformResourceColor?.slice()||null,
    kinds:{1:visibleResourceKinds[1],2:visibleResourceKinds[2],3:visibleResourceKinds[3],4:visibleResourceKinds[4]}};
}
function bucketIndex(kind,lv){
  if(kind<1||kind>4)return -1;
  const group=lv>=1&&lv<=8?0:(lv===9?1:(lv>=10&&lv<=12?2:-1));
  return group<0?-1:group*4+kind-1;
}
function bucketAppearance(pref,bucket){
  const group=(bucket/4)|0, kind=bucket%4+1;
  if(!pref.kinds[kind]||!(group===0?pref.low:group===1?pref.mid:pref.high))return 'hidden';
  return JSON.stringify([group,kind,pref.soft,pref.mode,pref.mode==='uniform'?pref.color:null]);
}
function paintOverlayPixel(i,p,ps,pn,pref){
  const t=terrainRaw[i],rr=resourceRaw[i],j=i*4;
  const lv=rr>>4,kind=rr&15;
  const palette=t===0&&rr!==0?RESOURCE_LEVEL_COLORS[kind]:null;
  const group=lv>=1&&lv<=8?0:(lv===9?1:(lv>=10&&lv<=12?2:-1));
  const groupVisible=group===0?pref.low:(group===1?pref.mid:pref.high);
  const showResource=!!(palette&&group>=0&&pref.kinds[kind]&&groupVisible);
  let r,g,b,aLow,aHi;
  if(t===14){r=20;g=222;b=227;aLow=202;aHi=251;} // 공성 부지 중심: 주변 raw 15와 시각적으로 분리
  else if(t===2){r=46;g=84;b=154;aLow=174;aHi=200;} // 참조 팔레트: 하천은 차분한 깊은 청색
  else if(t===3){r=38;g=40;b=47;aLow=250;aHi=255;} // 산: 한 단계 더 짙은 암석회색. 1~8레벨 자원 색상은 유지하며 저·고배율 모두 동일하게 적용
  else if(t===7){r=101;g=70;b=48;aLow=228;aHi=246;} // 실제 특수지형(raw 7): 따뜻한 짙은 갈색, 낮은 내부 무늬 대비
  else if(t===0&&rr===0){r=73;g=105;b=71;aLow=190;aHi=221;} // 자원 없는 공터만 자연스러운 저채도 녹색. 자원 픽셀 로직은 그대로.
  else if(t===0&&palette&&group>=0&&!showResource){r=210;g=197;b=139;aLow=22;aHi=61;}
  else if(showResource&&pref.mode==='uniform'&&pref.color){[r,g,b]=pref.color;aLow=200;aHi=238;}
  else if(showResource&&group===2){[r,g,b]=palette.high;aLow=216;aHi=247;}
  else if(showResource&&group===1){[r,g,b]=RESOURCE_LEVEL9_COLOR;aLow=190;aHi=238;}
  // 저레벨 토지는 산(#26282F)과 분리되는 밝은 황록색을 사용한다.
  // 원본 자원 종류·레벨·토지 좌표/통행 판정은 변경하지 않는다.
  else if(showResource&&group===0){r=187;g=213;b=112;aLow=142;aHi=216;}
  else if(t===0){r=115;g=140;b=82;aLow=13;aHi=69;}
  else{r=174;g=116;b=59;aLow=68;aHi=107;}
  if(showResource&&pref.soft){
    const strength=group===2?0.43:(group===1?0.48:0.68);
    aLow=Math.max(4,Math.round(aLow*strength));aHi=Math.max(9,Math.round(aHi*strength));
  }
  p[j]=r;p[j+1]=g;p[j+2]=b;p[j+3]=aLow;
  // 원본 짝수 X 반칸 보정 유지. 두 고배율 캔버스는 서로 다른 열만 가진다.
  const dst=((i%W)&1)===0?ps:pn;
  if(t===0&&showResource&&group===0&&pref.mode==='level'){dst[j]=187;dst[j+1]=213;dst[j+2]=112;}
  else if(t===0&&rr!==0&&group<0){dst[j]=92;dst[j+1]=128;dst[j+2]=75;}
  else{dst[j]=r;dst[j+1]=g;dst[j+2]=b;}
  dst[j+3]=aHi;
}
function commitOverlayBuffers(){
  const [img,imgShift,imgNoShift]=overlayImageBuffers;
  terrainCtx.putImageData(img,0,0);
  terrainShiftCtx.putImageData(imgShift,0,0);
  terrainNoShiftCtx.putImageData(imgNoShift,0,0);
  invalidateBaseCache();
  document.getElementById('resourceRenderStatus')?.replaceChildren();
  if(!dragging&&!zoomPreviewActive)scheduleFullDraw();
}
function buildExactTerrainOverlay(){
  if(!exactTerrainReady)return;
  if(overlayBusy){overlayUpdateQueued=true;return;}
  overlayBusy=true;overlayUpdateQueued=false;
  const pref=resourcePrefsSnapshot();
  const status=document.getElementById('resourceRenderStatus');
  const initial=!overlayImageBuffers;
  let targets=[];
  if(initial){
    overlayImageBuffers=[terrainCtx.createImageData(W,H),terrainShiftCtx.createImageData(W,H),terrainNoShiftCtx.createImageData(W,H)];
    overlayBucketIndices=Array.from({length:12},()=>[]);
  }else{
    for(let b=0;b<12;b++)if(bucketAppearance(overlayAppliedPrefs,b)!==bucketAppearance(pref,b))targets.push(overlayBucketIndices[b]);
    if(!targets.length){overlayBusy=false;if(status)status.textContent='';return;}
  }
  if(status)status.textContent=initial?'지형 데이터 첫 화면 구성 중…':'변경된 자원만 갱신 중…';
  const [img,imgShift,imgNoShift]=overlayImageBuffers;
  const p=img.data,ps=imgShift.data,pn=imgNoShift.data;
  let i=0, group=0, offset=0;
  function step(){
    const deadline=performance.now()+7;
    if(initial){
      const stop=Math.min(W*H,i+Math.min(W*12,18000));
      for(;i<stop;i++){
        const t=terrainRaw[i],rr=resourceRaw[i],bucket=t===0?bucketIndex(rr&15,rr>>4):-1;
        if(bucket>=0)overlayBucketIndices[bucket].push(i);
        paintOverlayPixel(i,p,ps,pn,pref);
      }
      if(i<W*H){requestAnimationFrame(step);return;}
      overlayBucketIndices=overlayBucketIndices.map(v=>Uint32Array.from(v));
    }else{
      while(group<targets.length&&performance.now()<deadline){
        const arr=targets[group], end=Math.min(arr.length,offset+14000);
        for(;offset<end;offset++)paintOverlayPixel(arr[offset],p,ps,pn,pref);
        if(offset>=arr.length){group++;offset=0;}
      }
      if(group<targets.length){requestAnimationFrame(step);return;}
    }
    overlayAppliedPrefs=pref;commitOverlayBuffers();overlayBusy=false;
    if(overlayUpdateQueued){overlayUpdateQueued=false;buildExactTerrainOverlay();}
  }
  requestAnimationFrame(step);
}
async function loadExactTileLayers(){
  const st=document.getElementById('terrainExactStatus');
  try{
    const T=window.S3_EXACT_TILE_DATA;
    [terrainRaw,resourceRaw]=await Promise.all([
      gunzipBase64ToU8(T.terrainGzipBase64),
      gunzipBase64ToU8(T.resourceGzipBase64)
    ]);
    if(terrainRaw.length!==W*H || resourceRaw.length!==W*H) throw new Error('타일 데이터 크기가 맞지 않습니다.');
    exactTerrainReady=true;
    buildSpecialOutlineRasters();
    if(landExportOpen)updateLandExportResult();
    indexSiegeCenterTiles();
    initRouteWorker(); // 메인 스레드 렌더링과 독립적으로 경로 계산 스레드 준비
    buildInferredFortresses();
    buildExactTerrainOverlay();
    const selfCheckOk=runTileLayoutSelfCheck();
    if(st) st.textContent=`원본 타일 적용 완료 · 좌표보정(+1,+1) · 짝수 X 반칸 보정 · 자체검증 ${selfCheckOk?'통과':'실패'} · 공터 ${T.counts.empty_ground.toLocaleString()} · 강 ${T.counts.river.toLocaleString()} · 산 ${T.counts.mountain.toLocaleString()}`;
    draw();
  }catch(err){
    console.error(err);
    if(st){ st.textContent='원본 타일 로딩 실패: '+err.message; st.style.color='#e79a82'; }
  }
}

function hexRgb(hex){ return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]}
function colorForRegion(r){ return hexRgb(stateColors[r.s]||'#8899aa'); }
function worldToScreen(x,y){ const dx=(x-CX)*scale*FLIP_X, dy=(y-CY)*scale; return [ox + CX*scale + dx*COS - dy*SIN, oy + CY*scale + dx*SIN + dy*COS]; }
function screenToWorld(sx,sy){ const vx=sx - (ox + CX*scale), vy=sy - (oy + CY*scale); const rx= vx*COS + vy*SIN, ry=-vx*SIN + vy*COS; return [(rx/(scale*FLIP_X)) + CX, (ry/scale) + CY]; }
let activeWorldView=null;
function viewportWorldBounds(padding=8,extra=0){
  const w=map.clientWidth,h=map.clientHeight;
  const corners=[screenToWorld(-extra,-extra),screenToWorld(w+extra,-extra),screenToWorld(w+extra,h+extra),screenToWorld(-extra,h+extra)];
  const pad=padding/Math.max(scale,.001)+3;
  return {minX:Math.max(-2,Math.min(...corners.map(p=>p[0]))-pad),maxX:Math.min(W+2,Math.max(...corners.map(p=>p[0]))+pad),
    minY:Math.max(-2,Math.min(...corners.map(p=>p[1]))-pad),maxY:Math.min(H+2,Math.max(...corners.map(p=>p[1]))+pad)};
}
function intersectsWorldView(bounds){
  const v=activeWorldView||viewportWorldBounds(24);
  return bounds.maxX>=v.minX&&bounds.minX<=v.maxX&&bounds.maxY>=v.minY&&bounds.minY<=v.maxY;
}
function drawWorldLayer(g,layer){drawWorldLayerOffset(g,layer,0,0);}
function drawWorldLayerOffset(g,layer,dx=0,dy=0){
  const v=activeWorldView||viewportWorldBounds();
  const sx=Math.max(0,Math.floor(v.minX-dx)),sy=Math.max(0,Math.floor(v.minY-dy));
  const ex=Math.min(layer.width,Math.ceil(v.maxX-dx)),ey=Math.min(layer.height,Math.ceil(v.maxY-dy));
  if(ex<=sx||ey<=sy)return;
  g.save();g.translate(ox,oy);g.translate(CX*scale,CY*scale);g.rotate(ROT);
  g.scale(FLIP_X*scale,scale);g.translate(-CX,-CY);g.imageSmoothingEnabled=false;
  g.drawImage(layer,sx,sy,ex-sx,ey-sy,sx+dx,sy+dy,ex-sx,ey-sy);
  g.imageSmoothingEnabled=true;g.restore();
}

// 실제 게임의 엇갈림(staggered-column) 타일 배치:
// 화면 내부 tx는 0-based이고 인게임 X = tx + 1 이다.
// 인게임에서 '짝수 X열'이 홀수 X열보다 Y 방향으로 +0.5칸 내려간다.
// 예: (839,837) -> (840,837)은 화면에서 '오른쪽 + 반칸 아래'가 되어야 한다.
// 따라서 내부 tx가 홀수일 때 +0.5를 적용해야 한다.
function oddXHalfShift(tx){
  return ((Math.floor(tx)&1)===1) ? 0.5 : 0.0;
}
function tileCenterToScreen(tx,ty){
  return worldToScreen(tx+0.5, ty+0.5+oddXHalfShift(tx));
}
function tilePolygonScreen(tx,ty,inset=0){
  const sy=oddXHalfShift(tx);
  let pts=[
    worldToScreen(tx,   ty+sy),
    worldToScreen(tx+1, ty+sy),
    worldToScreen(tx+1, ty+1+sy),
    worldToScreen(tx,   ty+1+sy)
  ];
  if(inset>0){
    const c=tileCenterToScreen(tx,ty);
    pts=pts.map(p=>[
      p[0]+(c[0]-p[0])*inset,
      p[1]+(c[1]-p[1])*inset
    ]);
  }
  return pts;
}
function screenToTilePoint(sx,sy){
  const p=screenToWorld(sx,sy);
  const tx=Math.floor(p[0]);
  return [p[0], p[1]-oddXHalfShift(tx)];
}
function centerOnTile(tx,ty,newScale){
  const sy=oddXHalfShift(tx);
  centerOn(tx+0.5,ty+0.5+sy,newScale);
}

function regionAt(x,y){ x=Math.floor(x); y=Math.floor(y); if(x<0||y<0||x>=W||y>=H) return null; return codeHex(codes[y*W+x]); }
function toMap(clientX,clientY){
  // Keep pointer-to-world coordinates stable while the map canvas is CSS-transformed.
  const r=map.parentElement.getBoundingClientRect();
  return screenToTilePoint(clientX-r.left, clientY-r.top);
}
function nearList(arr,x,y,rad){ return (arr||[]).some(p=>((p.x-1-x)*(p.x-1-x)+(p.y-1-y)*(p.y-1-y))<=rad*rad); }
function tileTerrain(x,y){ return exactTileInfo(x,y).label; }
function cityStyle(city){ const lv=Number(city?.level||0); if(lv>=20) return {r:8,fill:'#E8C86D',stroke:'#5A421C',inner:'#FFF4C7',banner:'#B74E35',crown:true}; if(lv>=17) return {r:6.5,fill:'#D5D3D0',stroke:'#514B45',inner:'#FFFDF6',banner:'#557DB6',crown:false}; return {r:5.2,fill:'#B98A4D',stroke:'#573B21',inner:'#FFE6A5',banner:'#6B9367',crown:false}; }
function drawTextHalo(g,text,x,y,font,fill,stroke='rgba(42,30,18,.78)',lw=4,align='center'){ g.font=font; g.textAlign=align; g.textBaseline='middle'; g.lineWidth=lw; g.strokeStyle=stroke; g.fillStyle=fill; g.strokeText(text,x,y); g.fillText(text,x,y); }
function drawTextBadge(g,text,x,y,font,fill='#FFF4D5',opts={}){
  const align=opts.align||'left';
  const bg=opts.bg||'rgba(24,18,12,.86)';
  const stroke=opts.stroke||'rgba(238,196,109,.44)';
  const padX=opts.padX??6, padY=opts.padY??3, radius=opts.radius??6;
  g.save();
  g.font=font; g.textBaseline='middle';
  const cacheKey=font+'\n'+text;
  let tw=textWidthCache.get(cacheKey);
  if(tw==null){ tw=g.measureText(text).width; if(textWidthCache.size>4096)textWidthCache.clear(); textWidthCache.set(cacheKey,tw); }
  const size=parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1]||12);
  const bh=size+padY*2, bw=tw+padX*2;
  let bx=x;
  if(align==='center') bx=x-bw/2;
  else if(align==='right') bx=x-bw;
  const by=y-bh/2;
  g.beginPath();
  if(g.roundRect) g.roundRect(bx,by,bw,bh,radius); else g.rect(bx,by,bw,bh);
  g.fillStyle=bg; g.fill();
  g.lineWidth=1; g.strokeStyle=stroke; g.stroke();
  g.fillStyle=fill;
  g.textAlign=align==='center'?'center':(align==='right'?'right':'left');
  const tx=align==='center'?x:(align==='right'?x-padX:bx+padX);
  g.fillText(text,tx,y+0.5);
  g.restore();
}

// 사용자 제공 참고 지도에서 추출한 아이콘. 이미지 로딩 전/실패 시 기존 벡터 마커로 즉시 대체한다.
const REFERENCE_MAP_ICONS={};
for(const [kind,url] of Object.entries({city:'icon-city.png',gate:'icon-gate.png',boat:'icon-boat.png'})){
  const img=new Image();
  img.onload=()=>{REFERENCE_MAP_ICONS[kind]=img; scheduleFullDraw();};
  img.onerror=()=>{ /* 배포 누락 시 기존 아이콘을 그대로 사용 */ };
  img.src=url;
}
function drawReferenceMapIcon(g,kind,x,y,size){
  const img=REFERENCE_MAP_ICONS[kind];
  if(!img)return false;
  g.save();
  g.imageSmoothingEnabled=true;
  g.drawImage(img,x-size/2,y-size/2,size,size);
  g.restore();
  return true;
}

function drawCityIconScreen(g,x,y,city,iconScale=1){
  // 실제 게임풍 지붕형 거점 아이콘. Lv.20은 기존 고유 왕관 표시를 유지한다.
  const iconSize=(Number(city?.level||0)>=20?38:Number(city?.level||0)>=13?34:31)*iconScale;
  if(drawReferenceMapIcon(g,'city',x,y,iconSize)){
    if(Number(city?.level||0)>=20){
      g.save();g.beginPath();g.arc(x,y,iconSize*.45,0,Math.PI*2);
      g.lineWidth=2.2;g.strokeStyle='#ffdf82';g.stroke();g.restore();
    }
    return;
  }

  const lv=Number(city?.level||0);
  const r=lv>=20?11.5:(lv>=13?9.5:8.3);
  const fill=lv>=20?'#FFD86B':(lv>=13?'#E7BC5E':'#D39A48');
  const stroke='#2E1B09';
  g.save(); g.translate(x,y);g.scale(iconScale,iconScale);
  g.beginPath(); g.arc(0,0,r+5.5,0,Math.PI*2); g.fillStyle='rgba(8,5,3,.52)'; g.fill();
  g.beginPath(); g.arc(0,0,r+3,0,Math.PI*2); g.fillStyle='rgba(255,218,112,.22)'; g.fill();
  g.beginPath(); g.moveTo(0,-r); g.lineTo(r,0); g.lineTo(0,r); g.lineTo(-r,0); g.closePath();
  g.fillStyle=fill; g.fill(); g.strokeStyle=stroke; g.lineWidth=2.4; g.stroke();
  g.beginPath(); g.arc(0,0,2.7,0,Math.PI*2); g.fillStyle='#FFF5C9'; g.fill();
  g.strokeStyle='rgba(74,43,14,.75)'; g.lineWidth=1; g.stroke();
  if(lv>=20){
    g.beginPath(); g.moveTo(-7,-r-3); g.lineTo(-4,-r-10); g.lineTo(0,-r-6); g.lineTo(4,-r-11); g.lineTo(7,-r-3); g.closePath();
    g.fillStyle='#FFE37D'; g.fill(); g.strokeStyle=stroke; g.lineWidth=1.2; g.stroke();
  }
  g.restore();
}
function drawGateIcon(g,x,y,kind,iconScale=1){
  // 관문은 청록색 아치형으로 성지의 주홍색 지붕과 형태/색상을 구분한다.
  if(drawReferenceMapIcon(g,'gate',x,y,36*iconScale))return;

  g.save(); g.translate(x,y);g.scale(iconScale,iconScale);
  g.beginPath(); g.arc(0,0,12,0,Math.PI*2); g.fillStyle='rgba(12,9,6,.64)'; g.fill();
  g.fillStyle=(kind==='special_gate'?'#6C9AB0':'#A87538');
  g.strokeStyle='#26180B'; g.lineWidth=1.8;
  g.fillRect(-8,-6,16,12); g.strokeRect(-8,-6,16,12);
  g.fillStyle=(kind==='special_gate'?'#A8C7D4':'#D6A75C');
  g.fillRect(-10,-9,20,4); g.strokeRect(-10,-9,20,4);
  g.fillStyle='#F3E1B2'; g.fillRect(-1.5,-2,3,8);
  g.restore();
}
function drawTransportIcon(g,x,y,type){
  if(type==='dock'&&drawReferenceMapIcon(g,'boat',x,y,30))return;

  g.save(); g.translate(x,y);
  g.beginPath(); g.arc(0,0,11,0,Math.PI*2); g.fillStyle='rgba(10,8,6,.60)'; g.fill();
  if(type==='dock'){
    g.strokeStyle='#E9D3A0'; g.lineWidth=2.1;
    g.beginPath(); g.moveTo(-8,3); g.lineTo(8,3);
    g.moveTo(-5,3); g.lineTo(-5,-6);
    g.moveTo(0,3); g.lineTo(0,-6);
    g.moveTo(5,3); g.lineTo(5,-6); g.stroke();
    g.strokeStyle='#69B2D6'; g.lineWidth=1.8;
    g.beginPath(); g.moveTo(-9,7); g.quadraticCurveTo(0,10,9,7); g.stroke();
  }
  g.restore();
}

function drawStrategicIcon(g,x,y,type){
  g.save(); g.translate(x,y);
  g.beginPath(); g.arc(0,0,11,0,Math.PI*2); g.fillStyle='rgba(10,8,6,.64)'; g.fill();
  if(type==='bridge'){
    g.strokeStyle='#F1FAFF'; g.lineWidth=2.4;
    g.beginPath(); g.moveTo(-8,0); g.lineTo(8,0); g.stroke();
    g.strokeStyle='#68B5D7'; g.lineWidth=1.8;
    g.beginPath(); g.moveTo(-9,5); g.quadraticCurveTo(-4,1,0,5); g.quadraticCurveTo(4,9,9,5); g.stroke();
    g.fillStyle='#E0C27C'; for(const px of [-5,0,5]) g.fillRect(px-1,-5,2,7);
  }else if(type==='chokepoint'){
    g.fillStyle='#E9A53F'; g.strokeStyle='#FFF0B8'; g.lineWidth=1.5;
    g.beginPath();
    for(let i=0;i<6;i++){
      const a=Math.PI/3*i-Math.PI/2, px=Math.cos(a)*7.5, py=Math.sin(a)*7.5;
      if(i===0) g.moveTo(px,py); else g.lineTo(px,py);
    }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle='#FFF6D3'; g.beginPath(); g.arc(0,0,2.2,0,Math.PI*2); g.fill();
  }else if(type==='mountain_path'){
    g.fillStyle='#92A77B'; g.strokeStyle='#EDE4C5'; g.lineWidth=1.35;
    g.beginPath(); g.moveTo(-8,6); g.lineTo(-2,-5); g.lineTo(1,0); g.lineTo(5,-7); g.lineTo(9,6); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle='#FFE7A9'; g.lineWidth=1.7;
    g.beginPath(); g.moveTo(-3,7); g.quadraticCurveTo(0,2,3,0); g.quadraticCurveTo(5,-2,6,-5); g.stroke();
  }else if(type==='fortress'){
    g.fillStyle='#A58A66'; g.strokeStyle='#F1D9A7'; g.lineWidth=1.4;
    g.fillRect(-6,-5,12,10); g.strokeRect(-6,-5,12,10);
    g.fillRect(-8,-8,4,5); g.fillRect(4,-8,4,5);
    g.strokeRect(-8,-8,4,5); g.strokeRect(4,-8,4,5);
    g.fillStyle='#FFF1C5'; g.fillRect(-1,0,2,5);
  }
  g.restore();
}

function levelLabel(g,x,y,lv){ drawTextHalo(g, 'Lv.'+lv, x+11, y+11, `700 11px "Noto Sans KR",sans-serif`, '#FFF2CC', 'rgba(45,30,16,.86)', 3, 'left'); }


// 화면상 라벨 겹침 완화: 표지/좌표 자체는 숨기지 않고 글자 배지만 빈자리에 배치.
const labelRects=[];
const labelBuckets=new Map();
const LABEL_BUCKET_SIZE=96;
function claimLabel(g,text,font,x,y,padX=6,padY=3,priority=false){
  const key=font+'\n'+text;
  let tw=textWidthCache.get(key);
  if(tw==null){g.save();g.font=font;tw=g.measureText(text).width;g.restore();textWidthCache.set(key,tw);}
  const size=parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1]||12), width=tw+padX*2, height=size+padY*2;
  const w=map.clientWidth, h=map.clientHeight;
  const tries=priority?[0,-26,26,-47,47]:[0,-23,23];
  for(const dy of tries){
    const by=y+dy-height/2, bx=x;
    if(bx<0||by<0||bx+width>w||by+height>h)continue;
    const x0=Math.floor((bx-3)/LABEL_BUCKET_SIZE),x1=Math.floor((bx+width+3)/LABEL_BUCKET_SIZE);
    const y0=Math.floor((by-2)/LABEL_BUCKET_SIZE),y1=Math.floor((by+height+2)/LABEL_BUCKET_SIZE);
    let blocked=false;
    for(let gy=y0;gy<=y1&&!blocked;gy++)for(let gx=x0;gx<=x1&&!blocked;gx++){
      const bucket=labelBuckets.get(gx+','+gy);
      if(bucket?.some(v=>bx<v.x2+3&&bx+width>v.x1-3&&by<v.y2+2&&by+height>v.y1-2))blocked=true;
    }
    if(blocked)continue;
    const rect={x1:bx,y1:by,x2:bx+width,y2:by+height};
    labelRects.push(rect);
    for(let gy=y0;gy<=y1;gy++)for(let gx=x0;gx<=x1;gx++){
      const key=gx+','+gy;let bucket=labelBuckets.get(key);
      if(!bucket){bucket=[];labelBuckets.set(key,bucket);}bucket.push(rect);
    }
    return y+dy;
  }
  return null;
}
function drawAnnotations(){
  const r=map.getBoundingClientRect(), w=r.width, h=r.height;
  labelRects.length=0;labelBuckets.clear();
  const lod=visualLod();
  // 현재 선택 거점과 1단계 보급로 이웃은 축소 배율에서도 이름을 유지한다.
  const connectedIds=showS11Connections&&selectedS11ConnectionId
    ?new Set((S11_CONN_ADJ.get(selectedS11ConnectionId)||[]).map(([id])=>Number(id)))
    :null;
  ctx.save();

  for(const s of D.states){
    const c=stateCenters[s], p=worldToScreen(c[0],c[1]), sx=p[0], sy=p[1];
    if(sx<-120||sy<-80||sx>w+120||sy>h+80) continue;
    const fs=Math.round(mixLod(17,Math.max(26,Math.min(39,31*scale/.52)),lod.strategy));
    const stateFont=`900 ${fs}px "Noto Sans KR",sans-serif`;
    if(lod.strategy>.35){
      ctx.font=stateFont;const bw=ctx.measureText(s).width+22;
      ctx.fillStyle=`rgba(12,19,22,${.08+.25*lod.strategy})`;
      ctx.fillRect(sx-bw/2,sy-fs*.71,bw,fs*1.48);
    }
    drawTextHalo(ctx,s,sx,sy,stateFont,
      `rgba(255,244,211,${.72+.26*lod.strategy})`,'rgba(20,23,22,.94)',Math.max(4,fs*.2));
  }

  // 성지가 없는 지역에만 일반 지역명 표시.
  if(labelMode && scale>0.48){
    for(const [code,rgn] of regionsWithoutCity){
      const p=worldToScreen(rgn.c[0],rgn.c[1]), sx=p[0], sy=p[1];
      if(sx<-80||sy<-40||sx>w+80||sy>h+40) continue;
      const fs=Math.max(10,Math.min(16,10.5+scale*2.2));
      drawTextHalo(ctx,rgn.n,sx,sy,`700 ${fs}px "Noto Sans KR",sans-serif`,
        'rgba(250,245,231,.90)','rgba(55,36,18,.72)',3);
    }
  }

  if(showGates){
    for(const g of (X.gates||[])){
      const p=tileCenterToScreen(g.x-1,g.y-1), sx=p[0], sy=p[1];
      if(sx<-100||sy<-70||sx>w+150||sy>h+70) continue;
      ctx.save();ctx.globalAlpha=lod.mid>.18?1:mixLod(1,.48,lod.strategy);
      drawGateIcon(ctx,sx,sy,g.kind,lod.mid>.18?1.06:mixLod(1,.68,lod.strategy));ctx.restore();
      if(Number(g.id)===selectedS11ConnectionId)continue;
      if(scale>.68 || (showS11Connections&&connectedIds?.has(Number(g.id)))){
        const glabel=g.level?`${g.level} ${g.name}`:g.name;
        const gateY=claimLabel(ctx,glabel,'800 11px "Noto Sans KR",sans-serif',sx+13,sy-2,6,3);
        if(gateY!==null){
          drawTextBadge(ctx,glabel,sx+13,gateY,`800 11px "Noto Sans KR",sans-serif`,
            g.kind==='special_gate'?'#D8EFF8':'#FFE9B8',{
              bg:'rgba(25,18,11,.90)',
              stroke:g.kind==='special_gate'?'rgba(105,181,214,.52)':'rgba(235,171,73,.52)',
              padX:6,padY:3,radius:6,align:'left'
            });
          if(GYEOKMUN_GATE_NAMES.has(g.name)){
            const gateTag='<격문 관문>';
            const tagY=claimLabel(ctx,gateTag,'800 10px "Noto Sans KR",sans-serif',sx+13,gateY+20,5,2);
            if(tagY!==null)drawTextBadge(ctx,gateTag,sx+13,tagY,'800 10px "Noto Sans KR",sans-serif','#CEEAFF',{
              bg:'rgba(17,31,47,.96)',stroke:'rgba(106,190,248,.90)',padX:5,padY:2,radius:5,align:'left'
            });
          }
        }
      }
    }
  }

  // 성지: 원본 center_pos 좌표에 마커 + 이름/Lv 한 번만 표시.
  if(cityMode){
    for(const [code,rgn] of regionsWithCity){
      const city=rgn.city;
      const p=tileCenterToScreen(city.x-1,city.y-1), sx=p[0], sy=p[1];
      if(sx<-140||sy<-100||sx>w+180||sy>h+120) continue;

      const lv=Number(city.level||0);
      const near=!!connectedIds?.has(Number(city.id));
      const cityPinned=Number(city.id)===selectedS11ConnectionId || near || scoreOwners.has(String(city.id)) || landExportCities.has(String(city.id));
      const majorCity=lv>=18 || cityPinned;
      const iconAlpha=lod.mid>.12?1:(lod.strategy>.02?(majorCity?mixLod(1,.94,lod.strategy):mixLod(1,.42,lod.strategy)):1);
      const iconScale=lod.mid>.12?(majorCity?1.08:1.0):(lod.strategy>.02?(majorCity?mixLod(1,.86,lod.strategy):mixLod(1,.62,lod.strategy)):1);
      ctx.save();ctx.globalAlpha=iconAlpha;drawCityIconScreen(ctx,sx,sy,city,iconScale);ctx.restore();
      // 전국 축소에서는 주 이름을 우선한다. 20레벨·선택/보급로 인접 거점은 항상 표시.
      if(lod.strategy>.81 && lv<20 && !cityPinned)continue;
      if(lod.strategy>.65 && lv<13 && !cityPinned)continue;
      const label=lv?`${lv} ${city.name||rgn.n}`:(city.name||rgn.n);
      const fs=lv>=20?15:(lv>=13?13:12);
      const focused=Number(city.id)===selectedS11ConnectionId;
      // The selected facility gets its own top-most badge after all other
      // labels; reserve regular labels for non-selected facilities only.
      if(focused)continue;
      const font=`${focused?900:800} ${focused?fs+1:fs}px "Noto Sans KR",sans-serif`;
      const nameY=claimLabel(ctx,label,font,sx+14,sy-3,7,3,true);
      if(nameY!==null){
        drawTextBadge(ctx,label,sx+14,nameY,font,focused?'#fff4a7':(near?'#d5fbff':'#FFF4D5'),{
          bg:focused?'rgba(68,43,11,.97)':(near?'rgba(16,38,47,.94)':'rgba(27,18,10,.94)'),
          stroke:focused?'rgba(255,219,103,.99)':(near?'rgba(145,225,246,.90)':'rgba(255,207,105,.68)'),
          padX:7,padY:3,radius:6,align:'left'
        });
        if(DAECHEONMYEONG_CITY_NAMES.has(city.name||rgn.n)){
          const specialText='<대천명 성지>';
          const specialY=claimLabel(ctx,specialText,'800 11px "Noto Sans KR",sans-serif',sx+14,nameY+21,6,3);
          if(specialY!==null)drawTextBadge(ctx,specialText,sx+14,specialY,'800 11px "Noto Sans KR",sans-serif','#FFDB8D',{
            bg:'rgba(57,27,18,.94)',stroke:'rgba(255,197,91,.80)',padX:6,padY:3,radius:5,align:'left'
          });
        }
      }
    }
  }

  if(showTransports){
    for(const p0 of (X.docks||[])){
      const p=tileCenterToScreen(p0.x-1,p0.y-1), sx=p[0], sy=p[1];
      if(sx<-80||sy<-60||sx>w+120||sy>h+60) continue;
      ctx.save();ctx.globalAlpha=mixLod(1,.25,lod.strategy);drawTransportIcon(ctx,sx,sy,'dock');ctx.restore();
      if(scale>1.5){
        const dockY=claimLabel(ctx,p0.name||'부두','800 10px "Noto Sans KR",sans-serif',sx+12,sy-2,5,2);
        if(dockY!==null)drawTextBadge(ctx,p0.name||'부두',sx+12,dockY,`800 10px "Noto Sans KR",sans-serif`,'#EAF8FF',{
          bg:'rgba(18,31,39,.88)',stroke:'rgba(92,170,207,.50)',padX:5,padY:2,radius:5,align:'left'
        });
      }
    }
  }

  // 선교 / 요충지 / 산길
  if(scale>0.48){
    const groups=[
      ['bridge',X.bridges||[],'선교','#E7F1F5'],
      ['chokepoint',X.chokepoints||[],'요충지','#FFE0A0'],
      ['mountain_path',X.mountainPaths||[],'산길','#ECE4C7']
    ];
    for(const [kind,arr,label,color] of groups){
      for(const s0 of arr){
        const q=structureWorldTile({...s0,_type:kind});
        const p=tileCenterToScreen(q[0],q[1]), sx=p[0], sy=p[1];
        if(sx<-45||sy<-45||sx>w+90||sy>h+70) continue;
        ctx.save();ctx.globalAlpha=mixLod(1,.50,lod.strategy);drawStrategicIcon(ctx,sx,sy,kind);ctx.restore();
        if(scale>1.3){
          const bg=kind==='bridge'?'rgba(18,34,42,.90)':(kind==='chokepoint'?'rgba(58,36,13,.90)':'rgba(31,40,24,.90)');
          const bd=kind==='bridge'?'rgba(95,180,218,.55)':(kind==='chokepoint'?'rgba(236,167,65,.58)':'rgba(163,186,126,.55)');
          const specialY=claimLabel(ctx,label,'800 10px "Noto Sans KR",sans-serif',sx+12,sy-2,5,2);
          if(specialY!==null)drawTextBadge(ctx,label,sx+12,specialY,`800 10px "Noto Sans KR",sans-serif`,color,{
            bg,stroke:bd,padX:5,padY:2,radius:5,align:'left'
          });
        }
      }
    }
  }

  // 성채: runtime 목록 + 단독 raw11 보강 좌표를 확대 시 표시.
  if(scale>1.85){
    for(const s0 of fortressStructures){
      const q=structureWorldTile(s0);
      const p=tileCenterToScreen(q[0],q[1]), sx=p[0], sy=p[1];
      if(sx<-30||sy<-30||sx>w+55||sy>h+45) continue;
      drawStrategicIcon(ctx,sx,sy,'fortress');
      if(scale>5.5){
        const fortY=claimLabel(ctx,'성채','800 10px "Noto Sans KR",sans-serif',sx+11,sy-2,5,2);
        if(fortY!==null)drawTextBadge(ctx,'성채',sx+11,fortY,`800 10px "Noto Sans KR",sans-serif`,'#F1DFC0',{
          bg:'rgba(36,28,20,.90)',stroke:'rgba(205,178,130,.48)',padX:5,padY:2,radius:5,align:'left'
        });
      }
    }
  }

  // The selected city/gate label renders last, above every ordinary badge.
  // It is intentionally visible at all zoom levels and independent of the
  // connection-network toggle; the facility icon artwork is unchanged.
  if(selectedS11ConnectionId){
    let facility=null;
    for(const [,region] of regionsWithCity){
      if(Number(region.city.id)===selectedS11ConnectionId){
        facility={name:region.city.name||region.n,level:region.city.level,x:region.city.x,y:region.city.y};break;
      }
    }
    if(!facility){
      const gate=(X.gates||[]).find(g=>Number(g.id)===selectedS11ConnectionId);
      if(gate)facility=gate;
    }
    if(facility){
      const [px,py]=tileCenterToScreen(facility.x-1,facility.y-1);
      if(px>-90&&py>-45&&px<w+90&&py<h+45){
        const text=facility.level?`${facility.level} ${facility.name}`:facility.name;
        const font='900 15px "Noto Sans KR",sans-serif';
        ctx.font=font;
        const bw=ctx.measureText(text).width+20;
        const right=px+17+bw<=w-5;
        const bx=right?Math.max(5,px+17):Math.max(bw+5,Math.min(w-5,px-17));
        const by=Math.max(17,Math.min(h-17,py-5));
        // Dark halo + bright solid border: unlike the white dashed state line.
        drawTextBadge(ctx,text,bx,by,font,'#ffffff',{
          bg:'rgba(24,34,41,.98)',stroke:'rgba(4,11,16,.99)',padX:10,padY:6,radius:7,align:right?'left':'right'
        });
        const w2=ctx.measureText(text).width+20;
        ctx.save();ctx.lineWidth=1.8;ctx.strokeStyle='#f5fafc';
        ctx.beginPath();
        const xx=right?bx:bx-w2, yy=by-13.5;
        if(ctx.roundRect)ctx.roundRect(xx,yy,w2,27,7);else ctx.rect(xx,yy,w2,27);
        ctx.stroke();ctx.restore();
      }
    }
  }
  ctx.restore();
}
function buildBase(){
  // 안 B: 11개 권역 모두 동일한 저채도 회청색을 아주 연하게 적용한다.
  // 권역별 개별 색상은 사용하지 않고 경계·권역명·성지·자원·보급로 표현은 유지한다.
  const img=octx.createImageData(W,H), a=img.data;
  const neutralBase=[181,194,194]; // 동일한 저채도 회청색
  const overlayAlpha=38;          // 안 A(28)보다 약간 선명하되 배경으로만 표시
  for(let i=0;i<codes.length;i++){
    const c=codeHex(codes[i]), r=R[c];
    let rgb=neutralBase;
    if(!r) rgb=[168,160,148];

    const x=i%W, y=(i/W)|0;
    let shade=1;
    if(shadeMode){
      shade=0.985 + 0.015*Math.sin(x*0.020+y*0.009) + 0.010*Math.cos(y*0.028) + 0.008*Math.sin((x+y)*0.013);
      shade=Math.max(0.96,Math.min(1.04,shade));
    }

    const j=i*4;
    a[j]=Math.max(0,Math.min(255,rgb[0]*shade));
    a[j+1]=Math.max(0,Math.min(255,rgb[1]*shade));
    a[j+2]=Math.max(0,Math.min(255,rgb[2]*shade));
    a[j+3]=overlayAlpha;
  }

  octx.clearRect(0,0,W,H);
  if(bgImg.complete) octx.drawImage(bgImg,0,0,W,H);
  octx.putImageData(img,0,0);
  invalidateBaseCache();

  // 경계는 Path2D 오버레이로 그리므로 여기서 225만 픽셀 경계 계산을 반복하지 않음.
}
function resize(){
  const r=map.parentElement.getBoundingClientRect();
  renderDpr=computeRenderDpr();
  const pw=Math.floor(r.width*renderDpr), ph=Math.floor(r.height*renderDpr);
  for(const c of [map,fx,scoreShadeCanvas]){
    if(c.width!==pw || c.height!==ph){ c.width=pw; c.height=ph; }
    c.style.width=r.width+'px';
    c.style.height=r.height+'px';
  }
  if(!resize.fitted){
    const fit=Math.min(r.width/(Math.sqrt(2)*W), r.height/(Math.sqrt(2)*H))*0.92;
    scale=fit;
    ox=r.width/2-(CX*scale);
    oy=r.height/2-(CY*scale);
    resize.fitted=true;
  }
  if(!resize.baseBuilt){ buildBase(); resize.baseBuilt=true; }
  draw();
}
let resizeRAF=0;
window.addEventListener('resize',()=>{
  if(resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF=requestAnimationFrame(()=>{resizeRAF=0; resize();});
});

function visibleTileBounds(){
  const r=map.getBoundingClientRect(), w=r.width, h=r.height;
  const pts=[
    screenToTilePoint(0,0),
    screenToTilePoint(w,0),
    screenToTilePoint(w,h),
    screenToTilePoint(0,h)
  ];
  let minx=W,maxx=0,miny=H,maxy=0;
  for(const p of pts){
    minx=Math.min(minx,p[0]); maxx=Math.max(maxx,p[0]);
    miny=Math.min(miny,p[1]); maxy=Math.max(maxy,p[1]);
  }
  return {
    minx:Math.max(0,Math.floor(minx)-3),
    maxx:Math.min(W-1,Math.ceil(maxx)+3),
    miny:Math.max(0,Math.floor(miny)-3),
    maxy:Math.min(H-1,Math.ceil(maxy)+3)
  };
}

function addPolyToPath(path,pts){
  path.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++) path.lineTo(pts[i][0],pts[i][1]);
  path.closePath();
}

// 원본 타일 지형을 실제 짝수-게임-X 반칸 위치에 다시 칠한다.
// 기존 저배율 지도 모양은 건드리지 않는다.
function drawOffsetTileTerrain(g,allScales=false){
  if(!(exactTerrainReady && showTerrain && (allScales || scale>6))) return;
  // no-shift: 인게임 홀수 X열 / shift: 인게임 짝수 X열(+0.5 Y)
  drawWorldLayerOffset(g,terrainNoShiftCanvas,-1,-1);
  drawWorldLayerOffset(g,terrainShiftCanvas,-1,-0.5);
}

function drawHighLevelResourceNumbers(){
  if(!exactTerrainReady||!showTerrain||scale<16)return;
  const b=visibleTileBounds(),area=(b.maxx-b.minx+1)*(b.maxy-b.miny+1);
  if(area>18000)return;
  const rw=map.clientWidth,rh=map.clientHeight;
  ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 11px "Noto Sans KR",sans-serif';
  for(let y=b.miny;y<=b.maxy;y++)for(let x=b.minx;x<=b.maxx;x++){
    const idx=exactLayerIndexForWorldTile(x,y);
    if(idx<0||terrainRaw[idx]!==0)continue;
    const rr=resourceRaw[idx],lv=rr>>4,kind=rr&15;
    // 1~8레벨 자원은 색상/정보를 유지하되 지도 위 숫자만 생략한다.
    // 9~12레벨 숫자는 해당 레벨/자원 표시가 켜진 경우 기존처럼 표시한다.
    if(lv<9||lv>12||!visibleResourceKinds[kind]||!(lv===9?resourceMidVisible:resourceHighVisible))continue;
    const p=tileCenterToScreen(x,y);
    if(p[0]<0||p[1]<0||p[0]>rw||p[1]>rh)continue;
    const t=String(lv);ctx.lineWidth=3.5;ctx.strokeStyle='rgba(9,15,15,.95)';ctx.strokeText(t,p[0],p[1]);
    ctx.fillStyle='#ffffff';ctx.fillText(t,p[0],p[1]);
  }
  ctx.restore();
}
function drawSiegeCenters(g){
  if(!exactTerrainReady||!showTerrain||scale<5||!siegeCenterTiles.length)return;
  const b=visibleTileBounds();
  const rw=map.clientWidth, rh=map.clientHeight;
  const radius=Math.max(2.7,Math.min(7,scale*.24));
  g.save();g.setTransform(renderDpr,0,0,renderDpr,0,0);
  for(const tile of siegeCenterTiles){
    if(tile.x<b.minx||tile.x>b.maxx||tile.y<b.miny||tile.y>b.maxy)continue;
    const [px,py]=tileCenterToScreen(tile.x,tile.y);
    if(px< -12||px>rw+12||py< -12||py>rh+12)continue;
    g.beginPath();g.arc(px,py,radius+1.6,0,Math.PI*2);
    g.fillStyle='rgba(5,24,29,.92)';g.fill();
    g.lineWidth=1.5;g.strokeStyle='#f9fbff';g.stroke();
    g.beginPath();g.moveTo(px,py-radius);g.lineTo(px+radius*.7,py);
    g.lineTo(px,py+radius);g.lineTo(px-radius*.7,py);g.closePath();
    g.fillStyle='#32f2ed';g.fill();
  }
  g.restore();
}
function drawTileGridStatic(g){
  if(!(showGrid && scale>6)) return;
  const b=visibleTileBounds();
  g.save();
  g.setTransform(renderDpr,0,0,renderDpr,0,0);
  g.translate(ox,oy);
  g.translate(CX*scale,CY*scale);
  g.rotate(ROT);
  g.scale(FLIP_X*scale,scale);
  g.translate(-CX,-CY);
  g.strokeStyle='rgba(255,255,255,.20)';
  g.lineWidth=1/Math.max(scale,0.0001);
  g.lineCap='butt';
  g.beginPath();

  // 세로 경계는 열마다 하나의 연속선으로 합친다.
  // 타일 4변을 매번 좌표변환하던 방식보다 JS 연산/Path 세그먼트 수가 크게 줄어든다.
  for(let x=b.minx;x<=b.maxx+1;x++){
    g.moveTo(x,b.miny-0.6);
    g.lineTo(x,b.maxy+1.6);
  }

  // 가로 경계만 X열의 +0.5칸 보정을 반영한다.
  for(let x=b.minx;x<=b.maxx;x++){
    const sy=oddXHalfShift(x);
    for(let y=b.miny;y<=b.maxy+1;y++){
      g.moveTo(x,y+sy);
      g.lineTo(x+1,y+sy);
    }
  }
  g.stroke();
  g.restore();
}
function drawTileHighlight(){
  if(!(showGrid && scale>6)) return;
  const t=hoverTile || selectedTile;
  if(!t) return;
  const pts=tilePolygonScreen(t.x,t.y,0.025);
  fctx.save();
  fctx.setTransform(renderDpr,0,0,renderDpr,0,0);
  fctx.beginPath();
  fctx.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++) fctx.lineTo(pts[i][0],pts[i][1]);
  fctx.closePath();
  fctx.fillStyle='rgba(255,235,150,.24)';
  fctx.fill();
  fctx.strokeStyle='rgba(255,235,150,.99)';
  fctx.lineWidth=2;
  fctx.stroke();
  fctx.restore();
}
function drawSearchTarget(){
  if(!searchTargetTile) return;
  if(scale<=6){
    const p=tileCenterToScreen(searchTargetTile.x,searchTargetTile.y);
    if(p[0]<-40||p[1]<-40||p[0]>map.clientWidth+40||p[1]>map.clientHeight+40)return;
    fctx.save();fctx.setTransform(renderDpr,0,0,renderDpr,0,0);
    fctx.beginPath();fctx.arc(p[0],p[1],16,0,Math.PI*2);
    fctx.fillStyle='rgba(255,216,101,.20)';fctx.fill();
    fctx.lineWidth=6;fctx.strokeStyle='rgba(24,14,4,.93)';fctx.stroke();
    fctx.lineWidth=3;fctx.strokeStyle='#fff19a';fctx.stroke();
    fctx.beginPath();fctx.arc(p[0],p[1],3,0,Math.PI*2);fctx.fillStyle='#fff';fctx.fill();
    fctx.restore();return;
  }
  const pts=tilePolygonScreen(searchTargetTile.x,searchTargetTile.y,0.035);
  const c=tileCenterToScreen(searchTargetTile.x,searchTargetTile.y);
  fctx.save();
  fctx.setTransform(renderDpr,0,0,renderDpr,0,0);
  fctx.beginPath();
  fctx.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++) fctx.lineTo(pts[i][0],pts[i][1]);
  fctx.closePath();
  fctx.fillStyle='rgba(255,205,72,.28)';
  fctx.fill();
  fctx.lineJoin='round';
  fctx.lineWidth=5;
  fctx.strokeStyle='rgba(20,12,4,.94)';
  fctx.stroke();
  fctx.lineWidth=3;
  fctx.strokeStyle='#FFD75A';
  fctx.stroke();
  fctx.beginPath();
  fctx.arc(c[0],c[1],5,0,Math.PI*2);
  fctx.fillStyle='#FFF3A8';
  fctx.fill();
  fctx.lineWidth=2;
  fctx.strokeStyle='#5A3600';
  fctx.stroke();
  fctx.restore();
}

function drawTileCounters(g){
  if(!tileCounterMarks.length) return;
  const r=map.getBoundingClientRect(), w=r.width, h=r.height;
  g.save();
  g.setTransform(renderDpr,0,0,renderDpr,0,0);
  g.textAlign='center';
  g.textBaseline='middle';
  for(let i=0;i<tileCounterMarks.length;i++){
    const m=tileCounterMarks[i];
    const p=tileCenterToScreen(m.x,m.y);
    const sx=p[0], sy=p[1];
    if(sx<-30||sy<-30||sx>w+30||sy>h+30) continue;
    const rad=scale>6?13:(scale>3?10:7);
    if(scale<1.35) continue;
    g.beginPath(); g.arc(sx,sy,rad+3,0,Math.PI*2); g.fillStyle='rgba(12,8,4,.78)'; g.fill();
    g.beginPath(); g.arc(sx,sy,rad,0,Math.PI*2); g.fillStyle='#F4C34F'; g.fill();
    g.lineWidth=2; g.strokeStyle='#FFF1B5'; g.stroke();
    g.font=`800 ${scale>6?13:(scale>3?11:9)}px "Noto Sans KR",sans-serif`;
    g.lineWidth=3; g.strokeStyle='rgba(61,35,8,.88)'; g.fillStyle='#281707';
    const n=String(i+1); g.strokeText(n,sx,sy+0.5); g.fillText(n,sx,sy+0.5);
  }
  g.restore();
}
function paintRegionOutline(code, color, width, withFill){
  const path=regionPathByCode[code];
  if(!path) return;

  fctx.save();
  fctx.translate(ox,oy);
  fctx.translate(CX*scale,CY*scale);
  fctx.rotate(ROT);
  fctx.scale(FLIP_X*scale,scale);
  fctx.translate(-CX,-CY);

  fctx.setLineDash([]);
  fctx.lineJoin='round';
  fctx.lineCap='round';
  fctx.strokeStyle=color;
  fctx.lineWidth=width/Math.max(scale,0.0001);
  fctx.stroke(path);
  fctx.restore();
}
// Additional user-defined Gyeokmun occupation links, separate from original Scenario11 cityEdges.
function drawGyeokmunOccupationLinks(g){
  if(!showGyeokmunLines)return;
  const w=map.clientWidth,h=map.clientHeight;
  g.save();g.lineCap='round';g.lineJoin='round';
  g.beginPath();
  for(const link of GYEOKMUN_LINES){
    if(!link.gate||!link.city)continue;
    const p=tileCenterToScreen(link.gate.x-1,link.gate.y-1);
    const q=tileCenterToScreen(link.city.x-1,link.city.y-1);
    if(Math.max(p[0],q[0])<-25||Math.min(p[0],q[0])>w+25||
       Math.max(p[1],q[1])<-25||Math.min(p[1],q[1])>h+25)continue;
    g.moveTo(p[0],p[1]);g.lineTo(q[0],q[1]);
  }
  g.setLineDash([]);
  g.lineWidth=5.4;g.strokeStyle='rgba(16,20,27,.92)';g.stroke();
  g.lineWidth=2.6;g.strokeStyle='rgba(117,231,255,.99)';g.stroke();
  g.lineWidth=.65;g.strokeStyle='rgba(239,253,255,.92)';g.stroke();
  g.restore();
}
function updateGyeokmunToggle(){
  const b=document.getElementById('gyeokmunToggleBtn');
  if(!b)return;
  b.textContent='격문 점령';
  b.classList.toggle('active',showGyeokmunLines);
  b.setAttribute('aria-pressed',showGyeokmunLines?'true':'false');
}
// Draw the 448 edge network only during a full render, not per mousemove or preview frame.
function drawS11ConnectionNetwork(g){
  if(!showS11Connections||!S11_CONN_EDGES.length)return;
  const width=map.clientWidth,height=map.clientHeight;
  const pixels=Object.create(null);
  for(const [id,node] of Object.entries(S11_CONN_NODES))pixels[id]=tileCenterToScreen(node[1]-1,node[2]-1);
  const focusActive=!!(selectedS11ConnectionId && S11_CONN_NODES[selectedS11ConnectionId]);
  const lod=visualLod();
  g.save();g.lineCap='round';g.lineJoin='round';
  // 전체망: 선택선보다 낮은 대비를 유지하되, 축소·중간에서도 길을 읽을 수 있게 한다.
  // 선택 연결선(금색)은 별도 전경 레이어이므로 분명하게 구별된다.
  for(const mask of [3,1,2]){
    g.beginPath();let count=0;
    for(const [a,b,m] of S11_CONN_EDGES){
      if(m!==mask)continue;
      const pa=pixels[a],pb=pixels[b];if(!pa||!pb)continue;
      if(Math.max(pa[0],pb[0]) < -35 || Math.min(pa[0],pb[0]) > width+35 ||
         Math.max(pa[1],pb[1]) < -35 || Math.min(pa[1],pb[1]) > height+35)continue;
      g.moveTo(pa[0],pa[1]);g.lineTo(pb[0],pb[1]);count++;
    }
    if(!count)continue;
    g.setLineDash(mask===2?[4.5,5.5]:[]);
    const density=lod.mid>.12?0.92:mixLod(1,.34,lod.strategy); // 축소는 주 경계 우선, 중간은 전체망 가독성 확보
    const outer=(focusActive?.42:.54)*density;
    const inner=(focusActive?.66:.82)*density;
    g.lineWidth=mask===3?2.75:2.50;
    g.strokeStyle=`rgba(13,21,29,${outer})`;
    g.stroke();
    g.lineWidth=mask===3?1.52:1.4;
    g.strokeStyle=`rgba(205,225,230,${inner})`;
    g.stroke();
  }
  g.restore();
}
function drawS11ConnectionFocus(g){
  if(!showS11Connections||!selectedS11ConnectionId||!S11_CONN_NODES[selectedS11ConnectionId])return;
  const src=S11_CONN_NODES[selectedS11ConnectionId],p=tileCenterToScreen(src[1]-1,src[2]-1);
  const neighbors=S11_CONN_ADJ.get(selectedS11ConnectionId)||[];
  const screenW=map.clientWidth,screenH=map.clientHeight;
  g.save();g.lineCap='round';g.lineJoin='round';
  // 선택한 성지에서 연결된 1단계 이웃만 진한 윤곽선 + 밝은 속선으로 표시.
  const paths=[];
  g.beginPath();
  for(const [to] of neighbors){
    const n=S11_CONN_NODES[to];if(!n)continue;
    const q=tileCenterToScreen(n[1]-1,n[2]-1);
    if(Math.max(p[0],q[0]) < -35 || Math.min(p[0],q[0]) > screenW+35 ||
       Math.max(p[1],q[1]) < -35 || Math.min(p[1],q[1]) > screenH+35)continue;
    paths.push(q);g.moveTo(p[0],p[1]);g.lineTo(q[0],q[1]);
  }
  g.setLineDash([]);
  g.lineWidth=6.8;g.strokeStyle='rgba(12,21,33,.93)';g.stroke();
  g.lineWidth=3.45;g.strokeStyle='rgba(255,239,163,.99)';g.stroke();
  g.lineWidth=1.0;g.strokeStyle='rgba(255,255,240,.95)';g.stroke();

  // 직접 연결 대상은 차가운 푸른색의 고리, 선택 출발점은 금색의 이중 고리.
  for(const q of paths){
    if(q[0]<-30||q[1]<-30||q[0]>screenW+30||q[1]>screenH+30)continue;
    const radius=scale<.95?11:12.5;
    g.beginPath();g.arc(q[0],q[1],radius,0,Math.PI*2);
    g.lineWidth=5;g.strokeStyle='rgba(13,24,35,.94)';g.stroke();
    g.lineWidth=2.35;g.strokeStyle='#9aeafa';g.stroke();
    g.beginPath();g.arc(q[0],q[1],radius+3.8,0,Math.PI*2);
    g.lineWidth=1;g.strokeStyle='rgba(154,234,250,.58)';g.stroke();
  }
  if(p[0]>=-35&&p[1]>=-35&&p[0]<=screenW+35&&p[1]<=screenH+35){
    const radius=scale<.95?13:15;
    g.beginPath();g.arc(p[0],p[1],radius,0,Math.PI*2);
    g.lineWidth=6;g.strokeStyle='rgba(12,19,29,.97)';g.stroke();
    g.lineWidth=3.5;g.strokeStyle='#ffe069';g.stroke();
    g.beginPath();g.arc(p[0],p[1],radius+4.3,0,Math.PI*2);
    g.lineWidth=1.6;g.strokeStyle='rgba(255,246,188,.96)';g.stroke();
  }
  g.restore();
}
function drawSelection(){
  const r=map.getBoundingClientRect(), w=r.width, h=r.height;
  fctx.setTransform(renderDpr,0,0,renderDpr,0,0); fctx.clearRect(0,0,w,h);
  if(scale<=6){
    // Selected region: white with dark outline, separate from golden city links.
    if(selected){
      paintRegionOutline(selected, 'rgba(5,12,20,.98)', 6.2, false);
      paintRegionOutline(selected, '#ffffff', 3.0, false);
    }
    // Hover: muted silver, weaker than a fixed selection and unlike golden links.
    if(hover && hover!==selected){
      paintRegionOutline(hover, 'rgba(14,20,29,.82)', 3.3, false);
      paintRegionOutline(hover, '#b6c6d0', 1.6, false);
    }
  }
  window.S11SteelBridge?.drawMarkers(fctx,tileCenterToScreen,map.clientWidth,map.clientHeight);
  // Keep navigation visible when crossing region boundaries.
  drawRouteOverlay();
  drawMoveCalcOverlay();
  drawScoreCityMarkers(fctx);
  if(landExportCities.size){
    fctx.save();fctx.setTransform(renderDpr,0,0,renderDpr,0,0);
    for(const {city} of landExportCities.values()){
      const p=tileCenterToScreen(city.x-1,city.y-1);fctx.beginPath();fctx.arc(p[0],p[1],15,0,Math.PI*2);fctx.strokeStyle='#7ff7c7';fctx.lineWidth=3;fctx.stroke();
    }
    fctx.restore();
  }
  drawTileHighlight();
  drawSearchTarget();
  drawS11ConnectionFocus(fctx);
}
window.addEventListener('s11-steel-redraw',()=>drawSelection());
function drawMini(){}

function draw(){
  const started=performance.now();mapPerf.draws++;
  activeWorldView=viewportWorldBounds();
  const w=map.clientWidth,h=map.clientHeight;
  for(const c of [ctx,fctx]){
    c.setTransform(renderDpr,0,0,renderDpr,0,0);
    c.clearRect(0,0,w,h);
  }
  let entry=findBaseCache();
  if(entry)mapPerf.baseCacheHits++;
  else{mapPerf.baseCacheMisses++;entry=buildBaseCache();}
  paintCachedBase(ctx,entry);
  cachedBaseKey=entry.key+'|'+entry.ox+'|'+entry.oy;
  drawS11ConnectionNetwork(ctx);
  drawGyeokmunOccupationLinks(ctx);
  drawAnnotations();
  drawHighLevelResourceNumbers();
  drawTileGridStatic(ctx);
  drawSiegeCenters(ctx);
  drawTileCounters(ctx);
  drawScoreAreaShading();
  drawSelection();
  const elapsed=performance.now()-started;
  mapPerf.lastDrawMs=elapsed;mapPerf.maxDrawMs=Math.max(mapPerf.maxDrawMs,elapsed);
}
function centerOn(x,y,newScale){ if(newScale) scale=newScale; const w=map.clientWidth, h=map.clientHeight; const dx=(x-CX)*scale*FLIP_X, dy=(y-CY)*scale; ox = w/2 - (CX*scale + dx*COS - dy*SIN); oy = h/2 - (CY*scale + dx*SIN + dy*COS); draw(); }

function nearestStructure(x,y,rad=8){
  let best=null, bd=1e9;
  for(const s of allStructures){
    const q=structureWorldTile(s);
    const dx=(q[0]+0.5)-x, dy=(q[1]+0.5)-y, d=dx*dx+dy*dy;
    if(d<bd && d<=rad*rad){ best=s; bd=d; }
  }
  return best;
}

// 고배율의 "타일 클릭"에서는 주변 구조물을 끌어오지 않는다.
// 클릭한 타일의 중심 좌표와 정확히 같은 구조물만 현재 타일 정보로 취급한다.
function structureAtTile(tx,ty){
  tx=Math.floor(tx); ty=Math.floor(ty);
  return STRUCTURES_BY_TILE.get(`${tx},${ty}`)||null;
}

// 정철 계산기용 시설 픽커: 지도 좌표가 아니라 실제로 그려진 성지/관문 아이콘 중심의
// 화면상 거리로 판정한다. 빈 타일 클릭이나 성지 소속 지역 클릭을 시설로 오인하지 않는다.
const STEEL_PICKABLES=[
  ...regionsWithCity.map(([code,r])=>({id:`city:${r.city.id}`,name:r.city.name||r.n,level:Number(r.city.level),type:'성지',x:r.city.x-1,y:r.city.y-1})),
  ...(X.gates||[]).map(g=>{const q=structureWorldTile({...g,_type:'gate'});return {id:`gate:${g.id}`,name:g.name,level:Number(g.level),type:'관문',x:q[0],y:q[1]};})
];
function findSteelMarkerClick(clientX,clientY){
  const rect=map.getBoundingClientRect(),sx=clientX-rect.left,sy=clientY-rect.top;
  let candidate=null,distSq=21*21;
  for(const item of STEEL_PICKABLES){
    const [px,py]=tileCenterToScreen(item.x,item.y);
    const d=(px-sx)**2+(py-sy)**2;
    if(d<distSq){candidate=item;distSq=d;}
  }
  return candidate;
}
function findCityMarkerAtPointer(clientX,clientY){
  const rect=map.getBoundingClientRect();
  const x=clientX-rect.left,y=clientY-rect.top;
  let best=null, distance=22*22;
  for(const item of regionsWithCity){
    const c=item[1].city;
    const [px,py]=tileCenterToScreen(c.x-1,c.y-1);
    const d=(px-x)**2+(py-y)**2;
    if(d<distance){distance=d;best=item;}
  }
  return best;
}
function updateInfo(regionCode, tile, structure){
  const structureId=Number(structure?.id||0);
  const regionCityId=(!tile && regionCode && R[regionCode]?.city)?Number(R[regionCode].city.id):0;
  selectedS11ConnectionId=S11_CONN_NODES[structureId]?structureId:(S11_CONN_NODES[regionCityId]?regionCityId:0);
  const box=document.getElementById('selectionContent');
  updateRecenterButton();
  let html='<div class="infoCard">';

  // 타일을 직접 클릭했거나 좌표로 이동한 경우에는 "그 타일 하나"의 정보만 표시한다.
  // 소속 지역/성지/주변 구조물 정보는 섞지 않는다.
  if(tile){
    const tileName=(structure && structure.name)?structure.name:tile.terrain;
    const tileLevel=(structure && structure.level)?`${structure.level} `:'';
    html += `<div class="title">${tileLevel}${tileName}</div>`;
    html += `<div class="kv"><div class="k">좌표</div><div class="v">(${tile.x+1}, ${tile.y+1}) <button class="copyCoordBtn" data-copy-coord="${tile.x+1}.${tile.y+1}">복사</button></div>`;
    if(tileName!==tile.terrain){
      html += `<div class="k">지형</div><div class="v">${tile.terrain}</div>`;
    }
    const regionCodeAtTile=regionAt(tile.x,tile.y);
    if(regionCodeAtTile && R[regionCodeAtTile]){
      const r=R[regionCodeAtTile];
      html += `<div class="k">지역</div><div class="v">${r.s} · ${r.m} · ${r.n}</div>`;
    }
    html += `</div>`;
    html += '</div>'; box.innerHTML=html; return;
  }

  if(regionCode && R[regionCode]){
    const r=R[regionCode], city=r.city;
    html += `<div class="title">${r.n}</div><div class="sub">${r.s} · ${r.m}</div><div class="row"><b>${r.f}</b></div><div class="kv"><div class="k">중심점</div><div class="v">(${Math.round(r.c[0])}, ${Math.round(r.c[1])})</div></div>`;
    if(city){ html += `<div class="city"><div><b>${city.level?`${city.level} `:''}${city.name || r.n}</b></div><div class="kv"><div class="k">좌표</div><div class="v">${city.x!=null?`(${city.x}, ${city.y}) <button class=\"copyCoordBtn\" data-copy-coord=\"${city.x}.${city.y}\">복사</button>`:'-'}</div></div>${structure?'':cityStatsMarkup(city)}</div>`; }
  } else {
    html += '';
  }
  if(structure){
    const sg=structureGameCoord(structure);
    html += `<div class="city"><div><b>${structure.level?`${structure.level} `:''}${structure.name}</b></div><div class="kv"><div class="k">좌표</div><div class="v">(${sg[0]}, ${sg[1]}) <button class=\"copyCoordBtn\" data-copy-coord=\"${sg[0]}.${sg[1]}\">복사</button></div></div></div>`;
  }
  html += '</div>'; box.innerHTML=html;
}
document.getElementById('landExportToggleBtn')?.addEventListener('click',()=>setLandExportOpen(!landExportOpen));
document.getElementById('landExportCloseBtn')?.addEventListener('click',()=>setLandExportOpen(false));
document.getElementById('landExportClearCitiesBtn')?.addEventListener('click',()=>{landExportCities.clear();renderLandExportPanel();drawSelection();setLandExportStatus('성지 선택을 초기화했습니다.');});
document.getElementById('landExportDownloadBtn')?.addEventListener('click',downloadLandExportExcel);
document.getElementById('landExportLevels')?.addEventListener('change',updateLandExportResult);
document.getElementById('landExportPanel')?.addEventListener('click',e=>{
  const preset=e.target.closest?.('[data-land-level-preset]');
  if(preset){const mode=preset.dataset.landLevelPreset;for(const cb of document.querySelectorAll('[data-land-level]'))cb.checked=mode==='all'||(mode==='high'&&Number(cb.dataset.landLevel)>=9);updateLandExportResult();return;}
  const rem=e.target.closest?.('[data-land-export-remove]');if(rem){landExportCities.delete(String(rem.dataset.landExportRemove));renderLandExportPanel();drawSelection();return;}
  const jump=e.target.closest?.('[data-land-export-jump]');if(jump){const item=landExportCities.get(String(jump.dataset.landExportJump));if(item){selected=item.code;selectedTile=null;updateInfo(item.code,null,null);centerOnTile(item.city.x-1,item.city.y-1,Math.max(scale,1.3));}return;}
});
document.getElementById('scoreToggleBtn')?.addEventListener('click',()=>setScorePanelOpen(!scorePanelOpen));
document.getElementById('scoreCloseBtn')?.addEventListener('click',()=>setScorePanelOpen(false));
document.getElementById('scoreAreaShadeToggle')?.addEventListener('change',e=>setScoreAreaShading(e.target.checked));
document.getElementById('scorePanel')?.addEventListener('click',e=>{
  const allianceBtn=e.target.closest?.('[data-score-alliance]');
  if(allianceBtn){
    scoreActiveAlliance=Number(allianceBtn.dataset.scoreAlliance);
    setScoreInstruction(`연맹 ${scoreActiveAlliance} 선택 중 · 지도에서 성지 아이콘을 클릭하세요.`);
    renderScorePanel();return;
  }
  const removeBtn=e.target.closest?.('[data-score-remove]');
  if(removeBtn){const id=removeBtn.dataset.scoreRemove;const city=CITY_BY_ID.get(id);if(city&&scoreOwners.get(id)===scoreActiveAlliance){scoreOwners.delete(id);persistScoreOwners();renderScorePanel();drawSelection();setScoreInstruction(`${city.name} · 점령 해제`);}return;}
  const jumpBtn=e.target.closest?.('[data-score-jump]');
  if(jumpBtn){const city=CITY_BY_ID.get(jumpBtn.dataset.scoreJump);if(city){const code=Object.keys(R).find(k=>R[k].city?.id===city.id);if(code){selected=code;selectedTile=null;updateInfo(code,null,null);}centerOnTile(city.x-1,city.y-1,Math.max(scale,1.3));}return;}
  if(e.target.closest?.('#scoreClearAllianceBtn')){
    const num=[...scoreOwners].filter(([,owner])=>owner===scoreActiveAlliance).length;
    if(num&&confirm(`연맹 ${scoreActiveAlliance}에 지정한 ${num}개 성지를 모두 해제할까요?`)){
      for(const [id,owner] of scoreOwners)if(owner===scoreActiveAlliance)scoreOwners.delete(id);
      persistScoreOwners();renderScorePanel();drawSelection();setScoreInstruction(`연맹 ${scoreActiveAlliance}의 점령 정보가 초기화되었습니다.`);
    }return;
  }
  if(e.target.closest?.('#scoreClearAllBtn')){
    if(scoreOwners.size&&confirm('연맹 1·2·3의 모든 점령 표시를 삭제할까요?')){
      scoreOwners.clear();persistScoreOwners();renderScorePanel();drawSelection();setScoreInstruction('전체 점령 정보가 초기화되었습니다.');
    }
  }
});
document.getElementById('info')?.addEventListener('click',e=>{
  const host=e.target.closest?.('.cityStats[data-city-id]');
  if(!host)return;
  const city=CITY_BY_ID.get(host.dataset.cityId);
  if(!city)return;
  if(e.target.closest('[data-city-stats-edit]'))host.innerHTML=cityStatsForm(city);
  else if(e.target.closest('[data-city-stats-cancel]'))host.outerHTML=cityStatsMarkup(city);
  else if(e.target.closest('[data-city-stats-reset]')){
    delete manualCityStats[String(city.id)];
    try{localStorage.setItem(CITY_STATS_KEY,JSON.stringify(manualCityStats));}catch(_){}
    host.outerHTML=cityStatsMarkup(city);
  }
});
document.getElementById('info')?.addEventListener('submit',e=>{
  const form=e.target.closest?.('[data-city-stats-form]');
  if(!form)return;
  e.preventDefault();
  const host=form.closest('.cityStats[data-city-id]'), city=CITY_BY_ID.get(host?.dataset.cityId);
  if(!city)return;
  const parse=input=>{
    const raw=String(form.elements.namedItem(input)?.value||'').trim();
    return raw===''?null:cityStatsValue(raw);
  };
  const fields=['residents','capacity','score'];
  const invalid=fields.some(k=>{const raw=String(form.elements.namedItem(k)?.value||'').trim();return raw!==''&&cityStatsValue(raw)===null;});
  const data={residents:parse('residents'),capacity:parse('capacity'),score:parse('score')};
  const err=form.querySelector('.cityStatsError');
  if(invalid||(data.residents!==null&&data.capacity!==null&&data.residents>data.capacity)){
    err.textContent=invalid?'0~1,000,000 사이의 정수를 입력해 주세요.':'현재 주민 수가 주민 상한보다 클 수 없습니다.';
    err.hidden=false;return;
  }
  manualCityStats[String(city.id)]=data;
  try{localStorage.setItem(CITY_STATS_KEY,JSON.stringify(manualCityStats));}catch(_){
    err.textContent='브라우저에 저장할 수 없습니다. 저장공간/개인정보 설정을 확인해 주세요.';err.hidden=false;return;
  }
  host.outerHTML=cityStatsMarkup(city);
  if(scorePanelOpen)renderScorePanel();
});
document.getElementById('info')?.addEventListener('click',async e=>{
  const b=e.target.closest?.('[data-copy-coord]');
  if(!b) return;
  const v=b.dataset.copyCoord||'';
  try{ await navigator.clipboard.writeText(v); }
  catch(_){
    const ta=document.createElement('textarea'); ta.value=v; document.body.appendChild(ta); ta.select();
    try{document.execCommand('copy');}catch(__){} ta.remove();
  }
  const old=b.textContent; b.textContent='완료'; b.classList.add('copied');
  setTimeout(()=>{b.textContent=old;b.classList.remove('copied');},800);
});

// 색상/자원 데이터와 독립적인 검색 인덱스: 사용자가 입력할 때 문자열 재생성을 방지.
const REGION_SEARCH_ROWS=regionEntries.map(entry=>({entry,
  key:(entry[0]+' '+entry[1].f+' '+entry[1].n+' '+entry[1].s+' '+entry[1].m+' '+(entry[1].city?.name||'')).toLowerCase()
})).sort((a,b)=>a.entry[1].f.localeCompare(b.entry[1].f,'ko'));
const STRUCTURE_SEARCH_ROWS=allStructures.map(st=>({st,key:(st.name+' '+st.id).toLowerCase()}));
let previousSearchQuery='',previousSearchMatches=null;
function getSearchMatches(q){
  q=(q||'').trim().toLowerCase();
  if(!q) return {regions:[],structs:[]};
  if(q===previousSearchQuery&&previousSearchMatches)return previousSearchMatches;
  const regions=[],structs=[];
  for(const row of REGION_SEARCH_ROWS)if(row.key.includes(q))regions.push(row.entry);
  for(const row of STRUCTURE_SEARCH_ROWS)if(row.key.includes(q))structs.push(row.st);
  previousSearchQuery=q;
  previousSearchMatches={regions,structs};
  return previousSearchMatches;
}
let searchActiveIndex=-1;
function closeSearchResults(){
  const out=document.getElementById('results');
  if(out){out.classList.remove('show');out.innerHTML='';}
  searchActiveIndex=-1;
}
function searchResultAction(kind,key){
  const m=getSearchMatches(searchInput.value);
  if(kind==='region'){
    const hit=m.regions.find(([code])=>code===key); if(!hit) return;
    const [code,r]=hit; searchTargetTile=r.city?.x!=null&&r.city?.y!=null?{x:r.city.x-1,y:r.city.y-1}:{x:Math.floor(r.c[0]),y:Math.floor(r.c[1])}; selected=code; selectedTile=null; updateInfo(code,null,null);
    if(r.city?.x!=null&&r.city?.y!=null) centerOnTile(r.city.x-1,r.city.y-1,Math.max(scale,1.25));
    else centerOn(r.c[0],r.c[1],Math.max(scale,1.25));
    updateRecenterButton();
  }else{
    const s=STRUCTURES_BY_ID.get(String(key)); if(!s) return;
    const sw=structureWorldTile(s), code=regionAt(sw[0],sw[1]); searchTargetTile={x:sw[0],y:sw[1]}; selected=code; selectedTile=null;
    updateInfo(code,null,s); centerOnTile(sw[0],sw[1],Math.max(scale,1.8)); updateRecenterButton();
  }
  closeSearchResults(); searchInput.blur();
}
function search(){
  const input=document.getElementById('search'), out=document.getElementById('results');
  if(!out) return;
  const q=input.value.trim(); out.innerHTML=''; searchActiveIndex=-1;
  if(!q){out.classList.remove('show');return;}
  const {regions:list,structs}=getSearchMatches(q);
  const frag=document.createDocumentFragment();
  const buildResult=(kind,key,title,meta)=>{
    const el=document.createElement('div');el.className='result';el.dataset.kind=kind;el.dataset.key=key;el.tabIndex=-1;el.setAttribute('role','button');
    el.innerHTML=`<div class="t">${title}</div><div class="m">${meta}</div><div class="searchRouteActions"><button type="button" class="start">출발지</button><button type="button" class="end">목적지</button></div>`;
    el.addEventListener('click',e=>{if(e.target.closest('.searchRouteActions'))return;searchResultAction(kind,key);});
    el.querySelector('.start').onclick=e=>{e.stopPropagation();setSearchAsRoute(kind,key,'start');};
    el.querySelector('.end').onclick=e=>{e.stopPropagation();setSearchAsRoute(kind,key,'end');};
    return el;
  };
  for(const [code,r] of list.slice(0,12)){
    frag.appendChild(buildResult('region',code,`${r.n}${r.city?.name&&r.city.name!==r.n?` · ${r.city.name}`:''}`,`${r.s} · ${r.m} · ${r.f}`));
  }
  for(const st of structs.slice(0,8)){
    const type=st._type==='dock'?'부두':st._type==='bridge'?'선교':st._type==='chokepoint'?'요충지':st._type==='mountain_path'?'산길':st._type==='fortress'?'성채':(st.kind==='special_gate'?'별도 관문':'육상 관문');
    const sg=structureGameCoord(st);
    frag.appendChild(buildResult('struct',String(st.id),st.name,`${type}${st.level?` · Lv.${st.level}`:''} · (${sg[0]}, ${sg[1]})`));
  }
  if(!frag.childNodes.length){ const e=document.createElement('div');e.className='searchEmpty';e.textContent='검색 결과가 없습니다.';frag.appendChild(e); }
  out.appendChild(frag); out.classList.add('show');
}
const searchInput=document.getElementById('search');
searchInput.addEventListener('input',search);
searchInput.addEventListener('focus',()=>{if(searchInput.value.trim())search();});
searchInput.addEventListener('keydown',e=>{
  const out=document.getElementById('results');
  const items=[...out.querySelectorAll('.result')];
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    if(!items.length)return; e.preventDefault();
    searchActiveIndex=(searchActiveIndex+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
    items.forEach((v,i)=>v.classList.toggle('active',i===searchActiveIndex));items[searchActiveIndex].scrollIntoView({block:'nearest'});return;
  }
  if(e.key==='Escape'){closeSearchResults();searchInput.blur();return;}
  if(e.key!=='Enter') return; e.preventDefault();
  if(searchActiveIndex>=0&&items[searchActiveIndex]){items[searchActiveIndex].click();return;}
  const m=getSearchMatches(searchInput.value);
  if(m.regions.length) searchResultAction('region',m.regions[0][0]);
  else if(m.structs.length) searchResultAction('struct',String(m.structs[0].id));
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest?.('.searchWrap')) closeSearchResults();});
function recenterTarget(){
  if(searchTargetTile)return searchTargetTile;
  if(selectedTile)return selectedTile;
  if(selected&&R[selected]){
    const r=R[selected];return r.city?.x!=null&&r.city?.y!=null?{x:r.city.x-1,y:r.city.y-1}:{x:Math.floor(r.c[0]),y:Math.floor(r.c[1])};
  }
  return null;
}
function updateRecenterButton(){const btn=document.getElementById('recenterBtn');if(btn)btn.disabled=!recenterTarget();}
document.getElementById('recenterBtn')?.addEventListener('click',()=>{const p=recenterTarget();if(p)centerOnTile(p.x,p.y,Math.max(scale,1.3));});
document.getElementById('fitBtn').onclick=()=>{ searchTargetTile=null; updateRecenterButton(); resize.fitted=false; resize(); };
function zoomAroundCenter(mult){
  const px=map.clientWidth/2, py=map.clientHeight/2, world=screenToWorld(px,py);
  scale=Math.max(.12,Math.min(MAX_SCALE,scale*mult));
  const dx=(world[0]-CX)*scale*FLIP_X, dy=(world[1]-CY)*scale;
  ox=px-(CX*scale+dx*COS-dy*SIN); oy=py-(CY*scale+dx*SIN+dy*COS); draw();
}
document.getElementById('zoomInBtn')?.addEventListener('click',()=>zoomAroundCenter(1.45));
document.getElementById('zoomOutBtn')?.addEventListener('click',()=>zoomAroundCenter(1/1.45));

const tileCounterResetBtn=document.getElementById('tileCounterReset');
if(tileCounterResetBtn) tileCounterResetBtn.onclick=clearTileCounterMarks;
const tileCounterModeToggle=document.getElementById('tileCounterModeToggle');
tileCounterModeToggle?.addEventListener('change',e=>{
  tileCounterMode=e.target.checked;
  if(tileClickTimer){clearTimeout(tileClickTimer);tileClickTimer=0;}
  const label=document.getElementById('tileCounterModeState');
  if(label)label.textContent=tileCounterMode?'ON':'OFF';
});
let routeDepartureManuallySet=false;
function setRouteDepartureCurrentTime(){
  const now=new Date(); // 브라우저 로컬 날짜/시간 기준.
  const date=document.getElementById('routeDepartureDate'),hour=document.getElementById('routeDepartureHour'),minute=document.getElementById('routeDepartureMinute');
  if(date)date.value=localDateValue(now);
  if(hour)hour.value=String(now.getHours()).padStart(2,'0');
  if(minute)minute.value=String(now.getMinutes()).padStart(2,'0');
  updateRouteTiming();
}
setRouteDepartureCurrentTime();
for(const id of ['routeDepartureDate','routeDepartureHour','routeDepartureMinute']){
  document.getElementById(id)?.addEventListener('change',()=>{routeDepartureManuallySet=true;updateRouteTiming();drawSelection();});
}
document.getElementById('routeSetNowBtn')?.addEventListener('click',()=>{routeDepartureManuallySet=true;setRouteDepartureCurrentTime();drawSelection();});
const routeToggleBtn=document.getElementById('routeToggleBtn');
routeToggleBtn?.addEventListener('click',()=>{
  if(!routeMode&&!routeDepartureManuallySet)setRouteDepartureCurrentTime();
  if(!routeMode&&moveCalcMode){moveCalcMode=false;updateMoveCalcUI();}
  setRouteMode(!routeMode);
});
const gyeokmunToggleBtn=document.getElementById('gyeokmunToggleBtn');
gyeokmunToggleBtn?.addEventListener('click',()=>{showGyeokmunLines=!showGyeokmunLines;updateGyeokmunToggle();scheduleFullDraw();});
updateGyeokmunToggle();
document.getElementById('routeCloseBtn')?.addEventListener('click',()=>clearRoute(false));
document.getElementById('routeResetBtn')?.addEventListener('click',()=>clearRoute(true));
document.getElementById('routeClearBtn')?.addEventListener('click',()=>{ routeSearchToken++; cancelActiveRouteWorker(); routeSearching=false; routeStart=null;routeEnd=null;routePath=[];routeOverlayVisible=true;updateRouteUI(routeMode?'시작 타일을 클릭하거나 입력하세요.':'경로가 지워졌습니다.');drawSelection(); });
document.getElementById('routeCalculateBtn')?.addEventListener('click',applyRouteInputs);
document.getElementById('routeAddBtn')?.addEventListener('click',addAnotherRoute);
document.getElementById('routeSavedList')?.addEventListener('click',e=>{const b=e.target.closest?.('[data-route-delete]');if(b)deleteSavedRoute(Number(b.dataset.routeDelete));});
document.getElementById('moveCalcToggleBtn')?.addEventListener('click',()=>{moveCalcMode=!moveCalcMode;if(moveCalcMode){if(routeSearching)cancelRouteSearch('이동 시간 계산기로 전환했습니다.');routeMode=false;updateRouteUI();}updateMoveCalcUI();drawSelection();});
document.getElementById('moveCalcResetBtn')?.addEventListener('click',()=>clearMoveCalc(false));
document.getElementById('moveCalcCloseBtn')?.addEventListener('click',()=>clearMoveCalc(true));
document.getElementById('routeFitBtn')?.addEventListener('click',fitRouteToView);
document.getElementById('routeEditBtn')?.addEventListener('click',()=>{ const panel=document.getElementById('routePanel'); if(!panel)return; const open=panel.classList.toggle('routeEditOpen'); document.getElementById('routeEditBtn').setAttribute('aria-expanded',String(open)); if(open)document.getElementById('routeStartInput')?.focus(); });
document.getElementById('routeCollapseBtn')?.addEventListener('click',()=>{ routePanelCollapsed=!routePanelCollapsed; updateRouteUI(); });
document.getElementById('routeVisibilityBtn')?.addEventListener('click',()=>{routeOverlayVisible=!routeOverlayVisible;updateRouteUI(routeOverlayVisible?'경로를 다시 표시했습니다.':'경로를 숨겼습니다.');drawSelection();});
document.getElementById('routeCancelBtn')?.addEventListener('click',()=>cancelRouteSearch());
for(const id of ['routeStartInput','routeEndInput']) document.getElementById(id)?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyRouteInputs();}});

const counterPanelEl=document.querySelector('.counterPanel');
if(counterPanelEl) counterPanelEl.open=true;
const usageDetailsEl=document.querySelector('.coordPanel .auxDetails');
if(usageDetailsEl) usageDetailsEl.open=true;
function parseGameCoord(value){
  const m=String(value||'').trim().match(/^\(?\s*(\d{1,4})\s*[\.,]\s*(\d{1,4})\s*\)?$/);
  if(!m) return null;
  const x=Number(m[1]), y=Number(m[2]);
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<1||x>W||y<1||y>H) return null;
  return {x,y};
}
function setCoordMessage(message,isError=false){
  const el=document.getElementById('coordError');
  if(!el) return;
  el.textContent=message||'';
  el.classList.toggle('show',!!message);
  el.classList.toggle('ok',!!message&&!isError);
}
function goToCoordinate(){
  const input=document.getElementById('coordInput');
  const parsed=parseGameCoord(input?.value);
  if(!parsed){
    setCoordMessage('좌표를 837.333 형식으로 입력해 주세요.',true);
    input?.focus();
    return;
  }
  setCoordMessage('');
  const tx=parsed.x-1, ty=parsed.y-1;
  const code=regionAt(tx,ty);
  selected=code;
  hoverTile=null;
  searchTargetTile={x:tx,y:ty};
  // 성지의 정확한 중심 좌표로 이동할 때는 타일이 아닌 성지 정보 카드를 표시한다.
  // 주변 성벽/성문/일반 타일은 기존대로 해당 타일 하나만 표시한다.
  const selectedCityCode=CITY_BY_COORD.get(`${tx},${ty}`);
  if(selectedCityCode){
    selected=selectedCityCode;
    selectedTile=null;
    updateInfo(selectedCityCode,null,null);
  }else{
    selectedTile=tileRecord(tx,ty);
    updateInfo(null,selectedTile,structureAtTile(tx,ty));
  }
  centerOnTile(tx,ty,MAX_SCALE);
}
const coordInput=document.getElementById('coordInput');
document.getElementById('coordBtn').onclick=goToCoordinate;
if(coordInput){
  coordInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); goToCoordinate(); } });
  coordInput.addEventListener('input',()=>setCoordMessage(''));
}
const PANEL_PREF_KEY='s3map_panel_collapsed_v1';
function setPanelCollapsed(collapsed){
  document.body.classList.toggle('panelCollapsed',collapsed);
  const btn=document.getElementById('panelToggleBtn');
  if(btn){btn.textContent=collapsed?'정보 펼치기':'정보 접기';btn.setAttribute('aria-expanded',String(!collapsed));}
  try{ localStorage.setItem(PANEL_PREF_KEY, collapsed?'1':'0'); }catch(e){}
}
function togglePanel(){ setPanelCollapsed(!document.body.classList.contains('panelCollapsed')); }
try{ if(localStorage.getItem(PANEL_PREF_KEY)==='1') setPanelCollapsed(true); }catch(e){}
document.getElementById('collapse').onclick=()=>{
  document.body.classList.toggle('showPanel');
  document.getElementById('collapse').setAttribute('aria-expanded',String(document.body.classList.contains('showPanel')));
};
document.getElementById('panelToggleBtn')?.addEventListener('click',togglePanel);
const quickCitiesEl=document.getElementById('quickCities');
if(quickCitiesEl){
  for(const [name,code] of D.important.slice(0,12)){
    const b=document.createElement('button');
    b.className='pill';
    b.textContent=name;
    b.onclick=()=>{ selected=code; selectedTile=null; updateInfo(code,null,null); centerOn(R[code].c[0],R[code].c[1],Math.max(scale,1.0)); };
    quickCitiesEl.appendChild(b);
  }
}
const statsEl=document.getElementById('stats');
if(statsEl){
  statsEl.innerHTML=`<div class="stat"><b>11</b><span>주</span></div><div class="stat"><b>81</b><span>군·국·윤</span></div><div class="stat"><b>217</b><span>지역</span></div>`;
}
for(const s of D.states){ const item=document.createElement('div'); item.className='li'; item.innerHTML=`<span class="sw" style="background:${stateColors[s]}"></span>${s}`; document.getElementById('legendItems').appendChild(item); }

// 체크박스 동작 시 225만 픽셀 자원 색상 캐시를 한 번만 갱신한다.
// 마우스 드래그/줌 중에는 데이터 배열을 재탐색하지 않는다.
const resourceLegend=document.getElementById('resourceLegend');
const resourceFilterToggleBtn=document.getElementById('resourceFilterToggleBtn');
function positionResourcePopover(){
  if(!resourceLegend?.open||!resourceFilterToggleBtn)return;
  const rect=resourceFilterToggleBtn.getBoundingClientRect();
  const availableWidth=Math.max(240,Math.min(280,window.innerWidth-16));
  const desiredLeft=Math.min(Math.max(8,rect.right-availableWidth),Math.max(8,window.innerWidth-availableWidth-8));
  const desiredTop=Math.min(rect.bottom+8,Math.max(8,window.innerHeight-170));
  resourceLegend.style.setProperty('--resource-popover-left',`${desiredLeft}px`);
  resourceLegend.style.setProperty('--resource-popover-top',`${desiredTop}px`);
}
function setResourcePopoverOpen(open){
  if(!resourceLegend||!resourceFilterToggleBtn)return;
  resourceLegend.open=!!open;
  resourceFilterToggleBtn.classList.toggle('active',!!open);
  resourceFilterToggleBtn.setAttribute('aria-expanded',String(!!open));
  resourceFilterToggleBtn.title=open?'자원 필터 닫기':'자원 필터 열기';
  if(open)positionResourcePopover();
}
resourceFilterToggleBtn?.addEventListener('click',()=>{
  const willOpen=!resourceLegend?.open;
  if(willOpen&&document.body.classList.contains('steelOpen'))document.getElementById('steelCloseBtn')?.click();
  setResourcePopoverOpen(willOpen);
});
resourceLegend?.addEventListener('toggle',()=>{
  if(!resourceFilterToggleBtn)return;
  resourceFilterToggleBtn.classList.toggle('active',resourceLegend.open);
  resourceFilterToggleBtn.setAttribute('aria-expanded',String(resourceLegend.open));
  if(resourceLegend.open)positionResourcePopover();
});
document.addEventListener('pointerdown',e=>{
  if(resourceLegend?.open && !resourceLegend.contains(e.target) && !resourceFilterToggleBtn?.contains(e.target))setResourcePopoverOpen(false);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&resourceLegend?.open){setResourcePopoverOpen(false);resourceFilterToggleBtn?.focus();}});
window.addEventListener('resize',positionResourcePopover,{passive:true});
document.getElementById('topbar')?.addEventListener('scroll',positionResourcePopover,{passive:true});

const lowToggle=document.getElementById('resourceLowToggle');
const midToggle=document.getElementById('resourceMidToggle');
const highToggle=document.getElementById('resourceHighToggle');
const softDotsToggle=document.getElementById('resourceSoftDotsToggle');
const resourceKindToggles=[...document.querySelectorAll('[data-resource-kind]')];
const resourceLevelColorModeBtn=document.getElementById('resourceLevelColorMode');
const resourceColorPickBtns=[...document.querySelectorAll('.resourceColorPick')];
function updateResourceLegend(){
  if(!resourceLegend) return;
  lowToggle.checked=resourceLowVisible;
  midToggle.checked=resourceMidVisible;
  highToggle.checked=resourceHighVisible;
  if(softDotsToggle) softDotsToggle.checked=resourceSoftDots;
  for(const el of resourceKindToggles) el.checked=visibleResourceKinds[Number(el.dataset.resourceKind)];
  resourceLevelColorModeBtn?.classList.toggle('active',resourceColorMode==='level');
  const colorStatus=document.getElementById('currentResourceColor');
  if(colorStatus) colorStatus.textContent=resourceColorMode==='level'?'레벨별 기본색':'전체 통일색';
  for(const b of resourceColorPickBtns){
    const hex=(b.dataset.resourceColor||'').toLowerCase();
    const activeHex=uniformResourceColor?'#'+uniformResourceColor.map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join(''):'';
    b.classList.toggle('active',resourceColorMode==='uniform'&&hex===activeHex);
  }
}

let resourceRefreshTimer=0;
function refreshResourceColors(){
  if(resourceRefreshTimer)clearTimeout(resourceRefreshTimer);
  resourceRefreshTimer=setTimeout(()=>{
    resourceRefreshTimer=0;
    if(exactTerrainReady)buildExactTerrainOverlay();
    else scheduleFullDraw();
  },70);
}
lowToggle?.addEventListener('change',e=>{ resourceLowVisible=e.target.checked; saveResourcePrefs(); refreshResourceColors(); });
midToggle?.addEventListener('change',e=>{ resourceMidVisible=e.target.checked; saveResourcePrefs(); refreshResourceColors(); });
highToggle?.addEventListener('change',e=>{ resourceHighVisible=e.target.checked; saveResourcePrefs(); refreshResourceColors(); });
softDotsToggle?.addEventListener('change',e=>{ resourceSoftDots=e.target.checked; saveResourcePrefs(); refreshResourceColors(); });
for(const el of resourceKindToggles){
  el.addEventListener('change',e=>{
    visibleResourceKinds[Number(e.target.dataset.resourceKind)]=e.target.checked;
    saveResourcePrefs(); refreshResourceColors();
  });
}
resourceLevelColorModeBtn?.addEventListener('click',()=>{
  resourceColorMode='level';
  uniformResourceColor=null;
  updateResourceLegend(); saveResourcePrefs(); refreshResourceColors();
});
for(const b of resourceColorPickBtns){
  b.addEventListener('click',()=>{
    const hex=b.dataset.resourceColor;
    if(!/^#[0-9a-f]{6}$/i.test(hex||'')) return;
    uniformResourceColor=[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
    resourceColorMode='uniform';
    updateResourceLegend(); saveResourcePrefs(); refreshResourceColors();
  });
}
// 작은 화면에서는 지도 가시성을 위해 범례를 접은 채 시작한다.
if(resourceLegend && window.matchMedia('(max-width:900px)').matches) resourceLegend.open=false;
const RESOURCE_PREF_KEY='s3map_resource_prefs_v4';
const RESOURCE_PREF_KEY_V3='s3map_resource_prefs_v3';
const RESOURCE_PREF_KEY_V2='s3map_resource_prefs_v2';
const RESOURCE_PREF_KEY_OLD='s3map_resource_prefs_v1';
function saveResourcePrefs(){
  try{localStorage.setItem(RESOURCE_PREF_KEY,JSON.stringify({low:resourceLowVisible,mid:resourceMidVisible,high:resourceHighVisible,softDots:resourceSoftDots,kinds:visibleResourceKinds,colorMode:resourceColorMode,uniformColor:uniformResourceColor}));}catch(e){}
}
function loadResourcePrefs(){
  try{
    const p=JSON.parse(localStorage.getItem(RESOURCE_PREF_KEY)||localStorage.getItem(RESOURCE_PREF_KEY_V3)||localStorage.getItem(RESOURCE_PREF_KEY_V2)||localStorage.getItem(RESOURCE_PREF_KEY_OLD)||'null'); if(!p)return;
    if(typeof p.low==='boolean')resourceLowVisible=p.low;
    if(typeof p.mid==='boolean')resourceMidVisible=p.mid;
    if(typeof p.high==='boolean')resourceHighVisible=p.high;
    if(typeof p.softDots==='boolean')resourceSoftDots=p.softDots;
    if(p.colorMode==='level'||p.colorMode==='uniform')resourceColorMode=p.colorMode;
    if(Array.isArray(p.uniformColor)&&p.uniformColor.length===3)uniformResourceColor=p.uniformColor.map(Number);
    if(resourceColorMode==='uniform'&&!uniformResourceColor)resourceColorMode='level';
    for(const k of [1,2,3,4]) if(typeof p.kinds?.[k]==='boolean')visibleResourceKinds[k]=p.kinds[k];
  }catch(e){}
}
loadResourcePrefs();
for(const b of document.querySelectorAll('[data-resource-preset]')) b.addEventListener('click',()=>{
  const p=b.dataset.resourcePreset;
  if(p==='high'){resourceLowVisible=false;resourceMidVisible=false;resourceHighVisible=true;for(const k of [1,2,3,4])visibleResourceKinds[k]=true;}
  if(p==='all'){resourceLowVisible=true;resourceMidVisible=true;resourceHighVisible=true;for(const k of [1,2,3,4])visibleResourceKinds[k]=true;}
  if(p==='none'){resourceLowVisible=false;resourceMidVisible=false;resourceHighVisible=false;}
  updateResourceLegend();saveResourcePrefs();refreshResourceColors();
});
updateResourceLegend();

let fullDrawRAF=0, selectionRAF=0, previewRAF=0;
const previewMap=document.createElement('canvas'), previewFx=document.createElement('canvas'), previewScoreShade=document.createElement('canvas');
const previewMapCtx=previewMap.getContext('2d'), previewFxCtx=previewFx.getContext('2d'), previewScoreShadeCtx=previewScoreShade.getContext('2d');
let previewBaseScale=scale, previewBaseOx=ox, previewBaseOy=oy;
let dragStartX=0, dragStartY=0, dragBaseOx=0, dragBaseOy=0;
let dragPreviewCaptured=false,pendingDragRefresh=false;
let zoomPreviewActive=false, zoomCommitTimer=0;
// Wheel-only fast path: transform existing raster layers on the compositor.
// Do not copy or repaint three full-size canvases for every wheel event.
let wheelBaseScale=scale,wheelBaseOx=ox,wheelBaseOy=oy;
const wheelLayers=[map,scoreShadeCanvas,fx];
function setWheelLayerTransform(){
  const ratio=scale/Math.max(wheelBaseScale,0.000001);
  const oldAx=wheelBaseOx+CX*wheelBaseScale,oldAy=wheelBaseOy+CY*wheelBaseScale;
  const dx=(ox+CX*scale)-ratio*oldAx,dy=(oy+CY*scale)-ratio*oldAy;
  const transform=`translate3d(${dx}px,${dy}px,0) scale(${ratio})`;
  for(const canvas of wheelLayers)canvas.style.transform=transform;
}
function clearWheelLayerTransform(){
  for(const canvas of wheelLayers){canvas.style.transform='';canvas.style.willChange='';}
}
let pendingWheelRAF=0,pendingWheelDelta=0,pendingWheelX=0,pendingWheelY=0;
let pendingHoverClientX=0, pendingHoverClientY=0;
let lastHoverSignature='';
let lastInfoTileKey='';
let lastHudText='';
function capturePreview(){
  previewMap.width=map.width; previewMap.height=map.height;
  previewFx.width=fx.width; previewFx.height=fx.height;
  previewScoreShade.width=scoreShadeCanvas.width;previewScoreShade.height=scoreShadeCanvas.height;
  previewMapCtx.setTransform(1,0,0,1,0,0); previewMapCtx.clearRect(0,0,previewMap.width,previewMap.height); previewMapCtx.drawImage(map,0,0);
  previewFxCtx.setTransform(1,0,0,1,0,0); previewFxCtx.clearRect(0,0,previewFx.width,previewFx.height); previewFxCtx.drawImage(fx,0,0);
  previewScoreShadeCtx.setTransform(1,0,0,1,0,0);previewScoreShadeCtx.clearRect(0,0,previewScoreShade.width,previewScoreShade.height);previewScoreShadeCtx.drawImage(scoreShadeCanvas,0,0);
  previewBaseScale=scale; previewBaseOx=ox; previewBaseOy=oy;
}
function drawPreview(){
  previewRAF=0;
  if(!previewMap.width) return;
  const w=map.clientWidth, h=map.clientHeight;
  const ratio=scale/Math.max(previewBaseScale,0.000001);
  const oldAx=previewBaseOx + CX*previewBaseScale, oldAy=previewBaseOy + CY*previewBaseScale;
  const newAx=ox + CX*scale, newAy=oy + CY*scale;
  const dx=newAx-ratio*oldAx, dy=newAy-ratio*oldAy;
  ctx.setTransform(renderDpr,0,0,renderDpr,0,0);
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#0e0a06';ctx.fillRect(0,0,w,h);
  if(scale===previewBaseScale){
    const underlay=findBaseCache(true);
    if(underlay)paintCachedBase(ctx,underlay);
  }
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(previewMap,0,0,previewMap.width,previewMap.height,dx,dy,w*ratio,h*ratio);
  mapPerf.previewFrames++;
  scoreShadeCtx.setTransform(renderDpr,0,0,renderDpr,0,0);
  scoreShadeCtx.clearRect(0,0,w,h);
  if(scoreAreaShadingEnabled&&scoreOwners.size){
    if(scale===previewBaseScale&&scoreShadeCache){
      const entry=scoreShadeCache,sx=entry.margin+entry.ox-ox,sy=entry.margin+entry.oy-oy;
      if(entry.key===scoreShadeCacheKey()&&sx>=0&&sy>=0&&sx+w<=entry.cssWidth&&sy+h<=entry.cssHeight){
        scoreShadeCtx.drawImage(entry.canvas,Math.round(sx*renderDpr),Math.round(sy*renderDpr),map.width,map.height,0,0,w,h);
      }else scoreShadeCtx.drawImage(previewScoreShade,0,0,previewScoreShade.width,previewScoreShade.height,dx,dy,w*ratio,h*ratio);
    }else scoreShadeCtx.drawImage(previewScoreShade,0,0,previewScoreShade.width,previewScoreShade.height,dx,dy,w*ratio,h*ratio);
  }
  fctx.setTransform(renderDpr,0,0,renderDpr,0,0);
  fctx.clearRect(0,0,w,h);
  fctx.drawImage(previewFx,0,0,previewFx.width,previewFx.height,dx,dy,w*ratio,h*ratio);
}
function schedulePreview(){ if(!previewRAF) previewRAF=requestAnimationFrame(drawPreview); }
function cancelPreviewFrame(){ if(previewRAF){ cancelAnimationFrame(previewRAF); previewRAF=0; } }
function commitPreview(){
  cancelPreviewFrame();
  if(pendingWheelRAF){cancelAnimationFrame(pendingWheelRAF);pendingWheelRAF=0;flushWheelZoom();}
  zoomPreviewActive=false;
  if(zoomCommitTimer){clearTimeout(zoomCommitTimer);zoomCommitTimer=0;}
  clearWheelLayerTransform();
  draw();
}
function scheduleFullDraw(){
  if(dragging||zoomPreviewActive) return;
  if(fullDrawRAF) return;
  fullDrawRAF=requestAnimationFrame(()=>{
    fullDrawRAF=0;
    draw();
  });
}
function scheduleSelectionDraw(clientX,clientY){
  if(Number.isFinite(clientX)){ pendingHoverClientX=clientX; pendingHoverClientY=clientY; }
  if(selectionRAF) return;
  selectionRAF=requestAnimationFrame(()=>{
    selectionRAF=0;
    const [mx,my]=toMap(pendingHoverClientX,pendingHoverClientY);
    const nextHover=regionAt(mx,my);
    const tx=Math.floor(mx), ty=Math.floor(my);
    const nextTile=scale>6?{x:tx,y:ty}:null;
    const sig=nextHover+'|'+(nextTile?nextTile.x+','+nextTile.y:'-')+'|'+(scale>6?1:0);
    const hudText=`X ${Math.floor(mx)+1}, Y ${Math.floor(my)+1}${nextHover&&R[nextHover]?` · ${R[nextHover].f}`:''}`;
    if(hudText!==lastHudText){
      document.getElementById('hud').textContent=hudText;
      lastHudText=hudText;
    }
    const tileKey=tx+','+ty;
    if(tileKey!==lastInfoTileKey){lastInfoTileKey=tileKey;updateHoverTileInfo(mx,my);}
    if(sig===lastHoverSignature) return;
    lastHoverSignature=sig;
    hover=nextHover;
    hoverTile=nextTile?tileRecord(nextTile.x,nextTile.y):null;
    drawSelection();
  });
}

map.addEventListener('pointerdown',e=>{
  if(zoomPreviewActive) commitPreview();
  dragging=true; moved=false;
  lastX=e.clientX; lastY=e.clientY;
  dragStartX=e.clientX; dragStartY=e.clientY;
  dragBaseOx=ox; dragBaseOy=oy;
  dragPreviewCaptured=false; // 클릭 시에는 대형 캔버스를 복사하지 않는다.
  map.setPointerCapture(e.pointerId);
});
map.addEventListener('pointermove',e=>{
  if(dragging){
    const dx=e.clientX-dragStartX, dy=e.clientY-dragStartY;
    if(Math.abs(dx)+Math.abs(dy)>2) moved=true;
    if(!moved)return;
    if(!dragPreviewCaptured){capturePreview();dragPreviewCaptured=true;}
    ox=dragBaseOx+dx; oy=dragBaseOy+dy;
    lastX=e.clientX; lastY=e.clientY;
    schedulePreview();
    // A full refresh in pointermove blocked input; schedule it after the fast preview.
    // The base overscan makes normal pans a cheap crop instead of a redraw.
    const refreshAt=Math.max(260,Math.min(map.clientWidth,map.clientHeight)*0.32);
    if(Math.max(Math.abs(dx),Math.abs(dy))>refreshAt){
      const refreshX=e.clientX,refreshY=e.clientY;
      if(!pendingDragRefresh){
        pendingDragRefresh=true;
        requestAnimationFrame(()=>{
          pendingDragRefresh=false;
          if(!dragging||zoomPreviewActive)return;
          cancelPreviewFrame();draw();capturePreview();
          dragStartX=lastX;dragStartY=lastY;
          dragBaseOx=ox;dragBaseOy=oy;
        });
      }
    }
    return;
  }
  if(zoomPreviewActive) return;
  // 고주사율 마우스의 수백~수천 Hz pointermove를 1프레임 1회로 합친다.
  scheduleSelectionDraw(e.clientX,e.clientY);
});
map.addEventListener('pointerup',e=>{
  if(dragging && !moved){
    const [mx,my]=toMap(e.clientX,e.clientY), code=regionAt(mx,my);
    // 정철 계산기가 열려 있으면 경로 탐색 모드가 이전부터 켜져 있었더라도
    // 성지/관문 아이콘을 정철 공략 목록에 우선 추가한다. 기존 경로는 유지된다.
    // 토지 추출 패널이 열려 있을 때는 성지 아이콘 클릭으로 복수 선택/해제한다.
    if(landExportOpen){
      const picked=findCityMarkerAtPointer(e.clientX,e.clientY);
      if(picked){const [cityCode,cityRegion]=picked;landExportToggleCity(cityCode,cityRegion);selected=cityCode;selectedTile=null;updateInfo(cityCode,null,null);}
      else setLandExportStatus('성지 아이콘을 클릭해 주세요.','error');
      cancelPreviewFrame();dragging=false;return;
    }
    // 패업 점수 계산기를 열었을 때는 다른 지도 선택 도구보다 성지 점령 지정이 우선한다.
    if(scorePanelOpen){
      const picked=findCityMarkerAtPointer(e.clientX,e.clientY);
      if(picked){
        const [cityCode,cityRegion]=picked;
        assignScoreCity(cityRegion.city);
        selected=cityCode;selectedTile=null;updateInfo(cityCode,null,null);
      }else setScoreInstruction('성지 아이콘을 클릭해 주세요. 빈 타일과 관문은 점수 계산 대상이 아닙니다.');
      cancelPreviewFrame();dragging=false;return;
    }
    if(window.S11SteelBridge?.isPicking()){
      const picked=findSteelMarkerClick(e.clientX,e.clientY);
      window.S11SteelBridge.onMarkerClick(picked);
      cancelPreviewFrame(); dragging=false;
      return;
    }
    if(moveCalcMode){
      cancelPreviewFrame();dragging=false;moveCalcPickTile(Math.floor(mx),Math.floor(my));return;
    }
    if(routeMode){
      cancelPreviewFrame(); dragging=false;
      routePickTile(Math.floor(mx),Math.floor(my));
      return;
    }
    searchTargetTile=null;
    selected=code;
    // 성지의 실제 아이콘/중심 타일을 선택한 경우에는 성지 정보를 표시한다.
    // 토지 카운팅 모드에서는 기존 타일 선택/카운팅을 그대로 유지한다.
    const cityMarker=!tileCounterMode?findCityMarkerAtPointer(e.clientX,e.clientY):null;
    if(cityMarker){
      const [cityCode]=cityMarker;
      selected=cityCode;selectedTile=null;
      updateInfo(cityCode,null,null);
    }else if(scale>6){
      const tx=Math.floor(mx), ty=Math.floor(my);
      const st=structureAtTile(tx,ty);
      selectedTile=tileRecord(tx,ty);
      updateInfo(null,selectedTile,st);
      if(tileCounterMode){
        if(tileClickTimer) clearTimeout(tileClickTimer);
        tileClickTimer=setTimeout(()=>{ tileClickTimer=0; if(tileCounterMode)toggleTileCounterMark(tx,ty); },220);
      }
    }else{
      const st=nearestStructure(mx,my,Math.max(5,12/Math.max(scale,0.5)));
      selectedTile=null; updateInfo(code,null,st);
      if(!st && code) centerOn(R[code].c[0],R[code].c[1],Math.max(scale,1.05));
    }
    cancelPreviewFrame();
    draw();
  }else if(dragging){
    cancelPreviewFrame();
    draw();
  }
  dragging=false;
});
map.addEventListener('pointercancel',()=>{ if(dragging){ cancelPreviewFrame(); draw(); } dragging=false; });
map.addEventListener('pointerleave',hideHoverTileInfo);
map.addEventListener('dblclick',e=>{
  e.preventDefault();
  if(tileClickTimer){ clearTimeout(tileClickTimer); tileClickTimer=0; }
  const [mx,my]=toMap(e.clientX,e.clientY);
  if(tileCounterMode && scale>6) removeTileCounterMark(Math.floor(mx),Math.floor(my));
});
function flushWheelZoom(){
  pendingWheelRAF=0;
  const delta=pendingWheelDelta;pendingWheelDelta=0;
  if(!delta)return;
  const px=pendingWheelX,py=pendingWheelY;
  const world=screenToWorld(px,py);
  const nextScale=Math.max(.12,Math.min(MAX_SCALE,scale*Math.exp(-delta*0.00145)));
  scale=nextScale;
  const dx=(world[0]-CX)*scale*FLIP_X,dy=(world[1]-CY)*scale;
  ox=px-(CX*scale+dx*COS-dy*SIN);
  oy=py-(CY*scale+dx*SIN+dy*COS);
  // A compositor transform is far cheaper than three full-canvas drawImage calls.
  // Only one precise canvas render is performed after the wheel burst settles.
  setWheelLayerTransform();
  if(zoomCommitTimer)clearTimeout(zoomCommitTimer);
  zoomCommitTimer=setTimeout(commitPreview,165);
}
map.parentElement.addEventListener('wheel',e=>{
  // Do not hijack scrolling in floating menus or input panels.
  if(e.target!==map && e.target!==map.parentElement)return;
  e.preventDefault();
  // map.getBoundingClientRect() is transformed during the compositor preview;
  // mapwrap has the stable, untransformed viewport coordinates.
  const r=map.parentElement.getBoundingClientRect();
  pendingWheelX=e.clientX-r.left;pendingWheelY=e.clientY-r.top;
  if(!zoomPreviewActive){
    cancelPreviewFrame();
    wheelBaseScale=scale;wheelBaseOx=ox;wheelBaseOy=oy;
    for(const canvas of wheelLayers){canvas.style.transformOrigin='0 0';canvas.style.willChange='transform';}
    zoomPreviewActive=true;
  }
  const delta=e.deltaY*(e.deltaMode===1?16:(e.deltaMode===2?map.clientHeight:1));
  pendingWheelDelta+=delta;
  if(!pendingWheelRAF)pendingWheelRAF=requestAnimationFrame(flushWheelZoom);
},{passive:false});
function runTileLayoutSelfCheck(){
  // 사용자 실측 기준: 839.837 -> 840.837 = 오른쪽 + 반칸 아래.
  // 내부 좌표는 각각 (838,836), (839,836).
  const a=tileCenterToScreen(838,836), b=tileCenterToScreen(839,836);
  const dx=b[0]-a[0], dy=b[1]-a[1];
  const p1=screenToTilePoint(a[0],a[1]), p2=screenToTilePoint(b[0],b[1]);
  const roundTripOk=Math.floor(p1[0])===838 && Math.floor(p1[1])===836 && Math.floor(p2[0])===839 && Math.floor(p2[1])===836;
  const directionOk=dx>0 && dy>0 && dx>dy;
  const checks=[];
  if(exactTerrainReady){
    checks.push(exactTileInfo(838,836).label==='석재 Lv.12');   // game 839,837
    checks.push(exactTileInfo(839,836).label==='철광 Lv.7');    // game 840,837
    checks.push(exactTileInfo(407,841).label==='성채');          // game 408,842
    checks.push(exactTileInfo(411,856).label==='공터');          // game 412,857
    checks.push(exactTileInfo(564,626).label==='성문');          // game 565,627: in-game verified gate
    checks.push(exactTileInfo(564,631).label==='성벽');          // game 565,632: in-game verified wall
  }
  const dataOk=!checks.length || checks.every(Boolean);
  if(!(directionOk && roundTripOk && dataOk)){
    console.error('[S3 map] TILE LAYOUT SELF-CHECK FAILED',{dx,dy,roundTripOk,dataOk,checks});
    return false;
  }
  console.log('[S3 map] TILE LAYOUT SELF-CHECK OK',{dx,dy,roundTripOk,dataOk,checks});
  return true;
}

document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
  if(e.key==='/'){e.preventDefault();searchInput.focus();searchInput.select();}
  else if(e.key==='f'||e.key==='F'){e.preventDefault();document.getElementById('fitBtn').click();}
  else if(e.key==='Escape'){ if(routeMode||routePath.length){clearRoute(false);} searchTargetTile=null;selected=null;selectedTile=null;updateInfo(null,null,null);draw(); }
  else if(e.key==='r'||e.key==='R'){e.preventDefault();setRouteMode(!routeMode);}
  else if(e.key==='p'||e.key==='P'){e.preventDefault(); togglePanel();}
});
bgImg.onload=()=>{ buildBase(); draw(); runTileLayoutSelfCheck(); };
fortressStructures=allStructures.filter(v=>v._type==='fortress');
console.log('[S3 map] 성지 원본좌표 연결:',Object.values(R).filter(r=>r.city&&r.city.x!=null&&r.city.y!=null).length,'/ 217');
buildTerritoryBoundarySegments();
console.log('[S3 map] region boundaries=',regionBoundaryCount,'state boundaries=',stateBoundaryCount);
loadTileCounterMarks();
document.getElementById('connectionToggleBtn')?.addEventListener('click',e=>{
  showS11Connections=!showS11Connections;
  e.currentTarget.classList.toggle('active',showS11Connections);
  e.currentTarget.setAttribute('aria-pressed',String(showS11Connections));
  e.currentTarget.textContent='보급로';
  scheduleFullDraw();
});
resize(); updateInfo(null,null,null); renderScorePanel(); loadExactTileLayers();
})();
