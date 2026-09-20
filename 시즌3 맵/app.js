
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

const regionEntries=Object.entries(R);
const regionsWithCity=regionEntries.filter(([,r])=>r.city && r.city.x!=null && r.city.y!=null);
const regionsWithoutCity=regionEntries.filter(([,r])=>!(r.city && r.city.x!=null && r.city.y!=null));
const map=document.getElementById('map'), ctx=map.getContext('2d');
const fx=document.getElementById('fx'), fctx=fx.getContext('2d');
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
let tileClickTimer=0;

// v17: 실제 이동 가능한 타일을 이용한 최단 경로 탐색
let routeMode=false, routeStart=null, routeEnd=null, routePath=[];
let routeSearchToken=0, routeSearching=false, routeOverlayVisible=true;
let routePanelCollapsed=false;
const routeCache=new Map();
const ROUTE_CACHE_MAX=24;
const routeSeen=new Uint32Array(W*H), routeClosed=new Uint32Array(W*H), routeG=new Uint32Array(W*H), routeParent=new Int32Array(W*H);
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
    hoverTileInfoEl.classList.remove('show');
    return;
  }
  const t=exactTileInfo(mx,my);
  hoverTileCoordEl.textContent=`(${Math.floor(mx)+1}, ${Math.floor(my)+1})`;
  hoverTileTerrainEl.textContent=t.label||'-';
  hoverTileInfoEl.classList.add('show');
}
function hideHoverTileInfo(){
  if(hoverTileInfoEl) hoverTileInfoEl.classList.remove('show');
  lastInfoTileKey='';
  lastHoverSignature='';
  if(!dragging){hover=null;hoverTile=null;drawSelection();}
}

let colorMode='state', labelMode=true, cityMode=true, borderMode=true, shadeMode=true, showMini=false;
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
let resourceLowVisible=true, resourceMidVisible=true, resourceHighVisible=true;
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

const off=document.createElement('canvas'); off.width=W; off.height=H; const octx=off.getContext('2d');
const terrainCanvas=document.createElement('canvas'); terrainCanvas.width=W; terrainCanvas.height=H;
const terrainCtx=terrainCanvas.getContext('2d');
// 고배율용 지형은 홀수 게임 X 열(+0.5Y)과 나머지 열을 미리 분리해 둔다.
const terrainShiftCanvas=document.createElement('canvas'); terrainShiftCanvas.width=W; terrainShiftCanvas.height=H;
const terrainShiftCtx=terrainShiftCanvas.getContext('2d');
const terrainNoShiftCanvas=document.createElement('canvas'); terrainNoShiftCanvas.width=W; terrainNoShiftCanvas.height=H;
const terrainNoShiftCtx=terrainNoShiftCanvas.getContext('2d');
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

function buildTerritoryBoundarySegments(){
  // IMPORTANT: the world grid is staggered. Odd 0-based X columns (= even in-game X)
  // are shifted down by 0.5 tile. Region/state boundaries must use the same geometry
  // as tile rendering, otherwise vertical boundaries lose half of their segments.
  regionBoundaryPath=new Path2D();
  commanderyBoundaryPath=new Path2D();
  stateBoundaryPath=new Path2D();
  stateBoundaryDashedPath=null;
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
      addEdge(commanderyBoundaryPath,x1,y1,x2,y2); commanderyBoundaryCount++;
    }else if(kind==='region'){
      addEdge(regionBoundaryPath,x1,y1,x2,y2); regionBoundaryCount++;
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

  // 1. 성지(소지역) 경계: 지형 뒤로 물러나는 가느다란 점선.
  g.setLineDash([3.5*inv,5.0*inv]);
  g.lineWidth=1.05*inv;
  g.strokeStyle='rgba(251,238,206,.43)';
  g.stroke(regionBoundaryPath);

  // 2. 군 경계: 주 경계와 구분되는 차분한 호박색. 지형 위에서 읽히는 얇은 그림자 선.
  g.setLineDash([]);
  g.lineWidth=3.8*inv;
  g.strokeStyle='rgba(36,25,19,.55)';
  g.stroke(commanderyBoundaryPath);
  g.lineWidth=2.05*inv;
  g.strokeStyle='rgba(255,176,98,.87)';
  g.stroke(commanderyBoundaryPath);

  // 3. 주 경계: 강과 달리 끊어지는 청회백색 파선. 배경 암색 외곽도
  // 같은 dash pattern을 써서 물길처럼 보이는 연속된 검은 띠가 남지 않게 한다.
  if(stateBoundaryDashedPath||stateBoundaryPath){
    const statePath=stateBoundaryDashedPath||stateBoundaryPath;
    g.setLineDash([10*inv,7*inv]);
    g.lineWidth=5.0*inv;
    g.strokeStyle='rgba(15,23,34,.91)';
    g.stroke(statePath);
    g.lineWidth=2.75*inv;
    g.strokeStyle='rgba(241,245,246,.96)';
    g.stroke(statePath);
    g.setLineDash([]);
  }
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

async function gunzipBase64ToU8(s){
  const raw=Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  if(typeof DecompressionStream==='undefined') throw new Error('이 브라우저는 DecompressionStream을 지원하지 않습니다.');
  const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function routeCoordText(t){ return t?`(${t.x+1}, ${t.y+1})`:'-'; }
function routeInputText(t){ return t?`${t.x+1}.${t.y+1}`:''; }
function isRoutePassable(x,y){
  if(!exactTerrainReady || x<0||y<0||x>=W||y>=H) return false;
  const raw=rawTerrainAtWorldTile(x,y);
  return raw!=null && raw!==2 && raw!==3;
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
function routeCacheKey(start,end){return `${start.x},${start.y}>${end.x},${end.y}`;}
function cacheRoute(key,res){
  routeCache.delete(key); routeCache.set(key,{path:res.path.map(p=>({x:p.x,y:p.y})),expanded:res.expanded});
  if(routeCache.size>ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value);
}
function findShortestRouteAsync(start,end,onProgress){
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
          if(nx<0||ny<0||nx>=W||ny>=H||!isRoutePassable(nx,ny)) continue;
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
  // Integer progress units avoid floating-point drift for large maps and boundary crossings.
  // One tile = 190*550 units; each normal second adds 550, night second adds 190.
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
function updateRouteTiming(){
  const hour=document.getElementById('routeDepartureHour');
  const minute=document.getElementById('routeDepartureMinute');
  const arrival=document.getElementById('routeArrival');
  const duration=document.getElementById('routeTravelDuration');
  const depart=routeDepartureSeconds(hour&&minute?`${hour.value}:${minute.value}`:'');
  if(!arrival||!duration)return;
  if(depart===null){arrival.textContent='출발 시간을 HH:MM으로 입력하세요'; duration.textContent='';return;}
  if(!routePath.length || routeSearching){arrival.textContent='최단 경로를 계산하면 도착시간이 표시됩니다.';duration.textContent='';return;}
  const travel=routeTravelEstimate(Math.max(0,routePath.length-1),depart);
  const daySuffix=travel.daysLater?` (+${travel.daysLater}일)`:' (당일)';
  arrival.textContent=`도착 ${routeTimeText(travel.arrivalSeconds)}${daySuffix}`;
  duration.textContent=`총 이동 ${routeDurationText(travel.durationSeconds)} · 일반 3분 10초/칸 · 야간 02:00~09:00 9분 10초/칸`;
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
  if(collapseBtn){ collapseBtn.textContent=routePanelCollapsed?'펼치기':'접기'; collapseBtn.setAttribute('aria-expanded',routePanelCollapsed?'false':'true'); collapseBtn.title=routePanelCollapsed?'경로 탐색창 펼치기':'경로 탐색창 최소화'; }
  const editBtn=document.getElementById('routeEditBtn');
  if(editBtn){editBtn.hidden=!routePath.length;editBtn.setAttribute('aria-expanded',panel?.classList.contains('routeEditOpen')?'true':'false');}
  btn?.classList.toggle('active',routeMode); btn?.setAttribute('aria-pressed',routeMode?'true':'false');
  document.body.classList.toggle('routeMode',routeMode);
  document.body.classList.toggle('routeOverlayHidden',!routeOverlayVisible);
  const s=document.getElementById('routeStartCoord'), e=document.getElementById('routeEndCoord'), status=document.getElementById('routeStatus'), result=document.getElementById('routeResult');
  if(s)s.textContent=routeCoordText(routeStart); if(e)e.textContent=routeCoordText(routeEnd);
  syncRouteInputs();
  if(status){ status.textContent=message || (routeMode?(routeStart?'목적지 타일을 클릭하거나 입력하세요.':'시작 타일을 클릭하거나 입력하세요.'):'경로 탐색이 종료되었습니다.'); status.className='routeStatus'+(kind?' '+kind:''); }
  if(result){ result.textContent=routePath.length?`경로 타일 수 ${routePath.length.toLocaleString()}개 · 이동 ${(routePath.length-1).toLocaleString()}칸`:'경로 타일 수 - · 이동 -'; }
  updateRouteTiming();
  const cancel=document.getElementById('routeCancelBtn'); if(cancel) cancel.hidden=!routeSearching;
  const calc=document.getElementById('routeCalculateBtn'); if(calc) calc.disabled=routeSearching;
  const fit=document.getElementById('routeFitBtn'); if(fit) fit.disabled=!routePath.length;
  const vis=document.getElementById('routeVisibilityBtn'); if(vis){vis.disabled=!routePath.length;vis.textContent=routeOverlayVisible?'경로 숨기기':'경로 표시';}
}
function cancelRouteSearch(message='경로 계산을 취소했습니다.'){
  if(!routeSearching) return;
  routeSearchToken++; routeSearching=false; updateRouteUI(message,'error'); drawSelection();
}
function clearRoute(keepMode=true){
  routeSearchToken++; routeSearching=false; routeStart=null; routeEnd=null; routePath=[]; routeOverlayVisible=true;
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
  if(routeStart.x===routeEnd.x&&routeStart.y===routeEnd.y){routePath=[{...routeStart}];routeOverlayVisible=true;updateRouteUI('시작지와 목적지가 같은 타일입니다.','done');drawSelection();return;}
  const key=routeCacheKey(routeStart,routeEnd),cached=routeCache.get(key);
  if(cached){routePath=cached.path.map(p=>({...p}));routeOverlayVisible=true;updateRouteUI(`저장된 계산 결과를 즉시 불러왔습니다 · ${cached.expanded.toLocaleString()}개 타일 탐색`,'done');drawSelection();return;}
  routePath=[];routeOverlayVisible=true;routeSearching=true;updateRouteUI('실제 이동 가능한 최단 경로를 계산 중입니다…','busy');drawSelection();
  const res=await findShortestRouteAsync(routeStart,routeEnd,n=>{if(routeSearching)updateRouteUI(`최단 경로 계산 중… ${n.toLocaleString()}개 타일 탐색`,'busy');});
  if(!res){return;}
  routeSearching=false;
  if(!res.path.length){routePath=[];updateRouteUI('이동 가능한 경로를 찾지 못했습니다. 강·산으로 완전히 막힌 구간인지 확인하세요.','error');drawSelection();return;}
  routePath=res.path;cacheRoute(key,res);updateRouteUI(`최단 경로 계산 완료 · ${res.expanded.toLocaleString()}개 타일 탐색`,'done');drawSelection();
}
async function routePickTile(tx,ty){
  tx=Math.floor(tx); ty=Math.floor(ty);
  if(!exactTerrainReady){ updateRouteUI('원본 지형 데이터를 아직 불러오지 못했습니다.','error'); return; }
  if(!isRoutePassable(tx,ty)){ updateRouteUI(`(${tx+1}, ${ty+1})은 강 또는 산이라 시작/목적지로 선택할 수 없습니다.`,'error'); return; }
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
  const s=nearestRoutePassable(si.x-1,si.y-1,10),e=nearestRoutePassable(ei.x-1,ei.y-1,10);
  if(!s||!e){updateRouteUI('입력 좌표 주변에서 이동 가능한 타일을 찾지 못했습니다.','error');return;}
  if(routeSearching) cancelRouteSearch();
  routeStart=s;routeEnd=e;routePath=[];routeOverlayVisible=true;routeMode=true;updateRouteUI('입력 좌표를 적용했습니다. 경로를 계산합니다.');drawSelection();calculateCurrentRoute();
}
function routeTargetFromSearch(kind,key){
  if(kind==='region'){
    const r=R[key];if(!r)return null;
    if(r.city?.x!=null&&r.city?.y!=null)return nearestRoutePassable(r.city.x-1,r.city.y-1,10);
    return nearestRoutePassable(Math.floor(r.c[0]),Math.floor(r.c[1]),10);
  }
  const st=allStructures.find(v=>String(v.id)===String(key));if(!st)return null;
  const p=structureWorldTile(st);return nearestRoutePassable(p[0],p[1],10);
}
function setSearchAsRoute(kind,key,which){
  const t=routeTargetFromSearch(kind,key); if(!t){updateRouteUI('이 위치 주변에서 이동 가능한 타일을 찾지 못했습니다.','error');return;}
  setRouteEndpoint(which,t,{calculate:true}); closeSearchResults(); searchInput.blur();
}
function drawRouteOverlay(){
  if(!routeOverlayVisible) return;
  if(!routeStart && !routePath.length) return;
  fctx.save(); fctx.setTransform(renderDpr,0,0,renderDpr,0,0);
  if(routePath.length>1){
    fctx.beginPath();
    for(let i=0;i<routePath.length;i++){
      const p=tileCenterToScreen(routePath[i].x,routePath[i].y);
      if(i===0) fctx.moveTo(p[0],p[1]); else fctx.lineTo(p[0],p[1]);
    }
    fctx.lineJoin='round'; fctx.lineCap='round';
    // 강은 파란색 연속선, 이동 경로는 자홍빛 선 + 진행방향 화살표.
    fctx.strokeStyle='rgba(9,17,27,.97)'; fctx.lineWidth=9; fctx.stroke();
    fctx.strokeStyle='#ff91c7'; fctx.lineWidth=4.5; fctx.stroke();
    // Screen-space arrows; avoid one marker per tile at high zoom or on long routes.
    let nextArrow=45, travelled=0, arrowCount=0;
    const viewportW=map.clientWidth,viewportH=map.clientHeight;
    for(let i=1;i<routePath.length && arrowCount<240;i++){
      const a=tileCenterToScreen(routePath[i-1].x,routePath[i-1].y);
      const b=tileCenterToScreen(routePath[i].x,routePath[i].y);
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      if(len<.01)continue;
      while(travelled+len>=nextArrow && arrowCount<240){
        const t=(nextArrow-travelled)/len;
        const px=a[0]+dx*t,py=a[1]+dy*t;
        if(px>=-12&&py>=-12&&px<=viewportW+12&&py<=viewportH+12){
          arrowCount++;
          const ux=dx/len,uy=dy/len;
          fctx.beginPath();
          fctx.moveTo(px-ux*5+uy*4.5,py-uy*5-ux*4.5);
          fctx.lineTo(px,py);
          fctx.lineTo(px-ux*5-uy*4.5,py-uy*5+ux*4.5);
          fctx.strokeStyle='rgba(9,17,27,.96)';fctx.lineWidth=4;fctx.stroke();
          fctx.strokeStyle='#fff9fe';fctx.lineWidth=1.9;fctx.stroke();
        }
        nextArrow+=78;
      }
      travelled+=len;
    }
    if(scale>6 && routePath.length<500){
      for(const t of routePath){
        const pts=tilePolygonScreen(t.x,t.y,0.08); fctx.beginPath(); fctx.moveTo(pts[0][0],pts[0][1]);
        for(let j=1;j<pts.length;j++) fctx.lineTo(pts[j][0],pts[j][1]); fctx.closePath();
        fctx.fillStyle='rgba(255,145,199,.13)'; fctx.fill();
      }
    }
  }
  // 시작점에서 실제 이동 10칸마다 경유 번호 표시 (10, 20, 30 ...).
  if(routePath.length>10){
    const vr=map.getBoundingClientRect(), vw=vr.width, vh=vr.height;
    for(let step=10;step<routePath.length;step+=10){
      const t=routePath[step], p=tileCenterToScreen(t.x,t.y);
      if(p[0]<-24||p[1]<-24||p[0]>vw+24||p[1]>vh+24) continue;
      const label=String(step), radius=label.length>=3?11:10;
      fctx.beginPath(); fctx.arc(p[0],p[1],radius+3,0,Math.PI*2);
      fctx.fillStyle='rgba(5,18,31,.93)'; fctx.fill();
      fctx.beginPath(); fctx.arc(p[0],p[1],radius,0,Math.PI*2);
      fctx.fillStyle='#f8d46d'; fctx.fill();
      fctx.strokeStyle='#fff3bd'; fctx.lineWidth=1.5; fctx.stroke();
      fctx.font=`900 ${label.length>=3?9:10}px "Noto Sans KR",sans-serif`;
      fctx.textAlign='center'; fctx.textBaseline='middle'; fctx.fillStyle='#2b1b08';
      fctx.fillText(label,p[0],p[1]+.4);
    }
  }
  const marker=(t,fill,label)=>{ if(!t)return; const p=tileCenterToScreen(t.x,t.y); fctx.beginPath();fctx.arc(p[0],p[1],13,0,Math.PI*2);fctx.fillStyle='rgba(5,18,31,.95)';fctx.fill();fctx.beginPath();fctx.arc(p[0],p[1],10,0,Math.PI*2);fctx.fillStyle=fill;fctx.fill();fctx.strokeStyle='#fff8e9';fctx.lineWidth=2;fctx.stroke();fctx.font='900 12px "Noto Sans KR",sans-serif';fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillStyle='#16202c';fctx.fillText(label,p[0],p[1]+.5); };
  marker(routeStart,'#7ee27b','S'); marker(routeEnd,'#ff806e','E');
  fctx.restore();
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
  if(raw===11 && isSingletonRaw11AtWorldTile(x,y)) return {label:'성채',raw,resourceRaw:rr,detail:'단독 raw 11 · 성채 중심 패턴'};
  if(raw>=8&&raw<=13) return {label:'성지/성채 부지',raw,resourceRaw:rr,detail:`원본 blockType ${raw} · 시설 부지 계열`};
  const n=RAW_BLOCK_NAMES[raw];
  if(n) return {label:n,raw,resourceRaw:rr,detail:`원본 blockType ${raw}`};
  return {label:`특수 지형`,raw,resourceRaw:rr,detail:`원본 raw ${raw} · 명칭 미확정`};
}
function tileRecord(x,y){
  const t=exactTileInfo(x,y);
  return {x:Math.floor(x),y:Math.floor(y),terrain:t.label,raw:t.raw,resourceRaw:t.resourceRaw,detail:t.detail};
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
  if(inferredFortresses.length) allStructures.push(...inferredFortresses);
  fortressStructures=allStructures.filter(v=>v._type==='fortress');
  console.log('[S3 map] raw11 성채 보강:',inferredFortresses.length,'개 / 총',(X.fortresses||[]).length+inferredFortresses.length);
}

let terrainOverlayBuildId=0;
function buildExactTerrainOverlay(){
  if(!exactTerrainReady) return;
  // 브라우저가 한 번에 225만 타일을 처리하며 잠기지 않도록 여러 프레임으로 분할.
  // 이전 설정이 완성되기 전에 새 설정을 누르면 이전 작업을 즉시 취소한다.
  const buildId=++terrainOverlayBuildId;
  const img=terrainCtx.createImageData(W,H), p=img.data;
  const imgShift=terrainShiftCtx.createImageData(W,H), ps=imgShift.data;
  const imgNoShift=terrainNoShiftCtx.createImageData(W,H), pn=imgNoShift.data;
  const status=document.getElementById('resourceRenderStatus');
  if(status) status.textContent='자원 표시 적용 중…';
  let start=0;
  function buildChunk(){
    if(buildId!==terrainOverlayBuildId) return;
    const stop=Math.min(terrainRaw.length,start+W*100);
    for(let i=start;i<stop;i++){
    const t=terrainRaw[i], rr=resourceRaw[i], j=i*4;
    let r,g,b,aLow,aHi;
    const lv=rr>>4, kind=rr&15;
    const palette=(t===0 && rr!==0)?RESOURCE_LEVEL_COLORS[kind]:null;
    const levelGroup=(lv>=1 && lv<=8)?'low':(lv===9?'mid':(lv>=10 && lv<=12?'high':null));
    const groupVisible=levelGroup==='low'?resourceLowVisible:(levelGroup==='mid'?resourceMidVisible:resourceHighVisible);
    const showResource=!!(palette && levelGroup && visibleResourceKinds[kind] && groupVisible);
    if(t===2){ r=46;g=122;b=165;aLow=138;aHi=148; }
    else if(t===3){ r=78;g=69;b=58;aLow=125;aHi=140; }
    else if(t===0 && (rr===0 || (palette && levelGroup && !showResource))){
      // 자원 숨김 시 타일을 삭제하지 않고 해당 위치의 기본 땅 색만 남긴다.
      r=210;g=197;b=139;aLow=22;aHi=61;
    }
    else if(showResource && resourceColorMode==='uniform' && uniformResourceColor){
      // 사용자가 범례의 색상 버튼을 누르면 자원 종류/레벨과 관계없이 1~12 전체를 같은 색으로 표시한다.
      [r,g,b]=uniformResourceColor;
      aLow=200; aHi=238;
    }
    else if(showResource && levelGroup==='high'){
      [r,g,b]=palette.high; aLow=216; aHi=247;
    }
    else if(showResource && levelGroup==='mid'){
      [r,g,b]=RESOURCE_LEVEL9_COLOR; aLow=190; aHi=238;
    }
    else if(showResource && levelGroup==='low'){
      // 1~8레벨은 원본 자원 색상 및 투명도를 그대로 사용한다.
      r=115;g=140;b=82;aLow=13;aHi=69;
    }
    else if(t===0){ r=115;g=140;b=82;aLow=13;aHi=69; }
    else { r=174;g=116;b=59;aLow=68;aHi=107; }
    // v21: 종류/레벨/위치는 그대로, 보이는 자원 타일의 색점 불투명도만 낮춘다.
    // 강·산·성지·빈 타일의 알파는 절대로 바꾸지 않는다.
    if(showResource && resourceSoftDots){
      const strength=levelGroup==='high'?0.43:(levelGroup==='mid'?0.48:0.68);
      aLow=Math.max(4,Math.round(aLow*strength));
      aHi=Math.max(9,Math.round(aHi*strength));
    }
    p[j]=r; p[j+1]=g; p[j+2]=b; p[j+3]=aLow;
    // 원본의 인게임 짝수 X열 반 칸 보정과 낮은 레벨 자원 전용 색상을 유지한다.
    const x=i%W;
    const dst=((x&1)===0)?ps:pn;
    if(t===0 && showResource && levelGroup==='low' && resourceColorMode==='level'){
      dst[j]=92; dst[j+1]=128; dst[j+2]=75;
    }else if(t===0 && rr!==0 && !levelGroup){
      // 분류되지 않은 원본 자원값 역시 기존 표시를 유지한다.
      dst[j]=92; dst[j+1]=128; dst[j+2]=75;
    }else{ dst[j]=r; dst[j+1]=g; dst[j+2]=b; }
    dst[j+3]=aHi;
    }
    start=stop;
    if(start<terrainRaw.length){ requestAnimationFrame(buildChunk); return; }
    if(buildId!==terrainOverlayBuildId) return;
    terrainCtx.putImageData(img,0,0);
    terrainShiftCtx.putImageData(imgShift,0,0);
    terrainNoShiftCtx.putImageData(imgNoShift,0,0);
    if(status) status.textContent='';
    // 제자리에서 갱신하여 좌표/선택/카운터 및 지도 위치 유지.
    if(dragging || zoomPreviewActive){
      // 이동/확대 중에는 새 자원 레이어만 저장하고 조작 종료 시 최종 화면을 갱신.
      return;
    }
    scheduleFullDraw();
  }
  requestAnimationFrame(buildChunk);
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
function hslToRgb(h,s,l){ s/=100;l/=100; const k=n=>(n+h/30)%12, a=s*Math.min(l,1-l), f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1)); return [Math.round(255*f(0)),Math.round(255*f(8)),Math.round(255*f(4))]; }
function hash(s){ let h=0; for(let i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i)|0; return Math.abs(h); }
function colorForRegion(r){ if(colorMode==='state') return hexRgb(stateColors[r.s]||'#8899aa'); return hslToRgb(hash(r.m)%360,36,56); }
function worldToScreen(x,y){ const dx=(x-CX)*scale*FLIP_X, dy=(y-CY)*scale; return [ox + CX*scale + dx*COS - dy*SIN, oy + CY*scale + dx*SIN + dy*COS]; }
function screenToWorld(sx,sy){ const vx=sx - (ox + CX*scale), vy=sy - (oy + CY*scale); const rx= vx*COS + vy*SIN, ry=-vx*SIN + vy*COS; return [(rx/(scale*FLIP_X)) + CX, (ry/scale) + CY]; }
function drawWorldLayer(g, layer){ g.save(); g.translate(ox,oy); g.translate(CX*scale, CY*scale); g.rotate(ROT); g.scale(FLIP_X*scale,scale); g.translate(-CX,-CY); g.imageSmoothingEnabled=false; g.drawImage(layer,0,0); g.imageSmoothingEnabled=true; g.restore(); }
function drawWorldLayerOffset(g, layer, dx=0, dy=0){ g.save(); g.translate(ox,oy); g.translate(CX*scale, CY*scale); g.rotate(ROT); g.scale(FLIP_X*scale,scale); g.translate(-CX,-CY); g.imageSmoothingEnabled=false; g.drawImage(layer,dx,dy); g.imageSmoothingEnabled=true; g.restore(); }

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
  const r=map.getBoundingClientRect();
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
  if(tw==null){ tw=g.measureText(text).width; textWidthCache.set(cacheKey,tw); }
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

function drawCityIconScreen(g,x,y,city){
  const lv=Number(city?.level||0);
  const r=lv>=20?11.5:(lv>=13?9.5:8.3);
  const fill=lv>=20?'#FFD86B':(lv>=13?'#E7BC5E':'#D39A48');
  const stroke='#2E1B09';
  g.save(); g.translate(x,y);
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
function drawGateIcon(g,x,y,kind){
  g.save(); g.translate(x,y);
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
    if(labelRects.some(v=>bx<v.x2+3&&bx+width>v.x1-3&&by<v.y2+2&&by+height>v.y1-2))continue;
    labelRects.push({x1:bx,y1:by,x2:bx+width,y2:by+height});
    return y+dy;
  }
  return null;
}
function drawAnnotations(){
  const r=map.getBoundingClientRect(), w=r.width, h=r.height;
  labelRects.length=0;
  ctx.save();

  for(const s of D.states){
    const c=stateCenters[s], p=worldToScreen(c[0],c[1]), sx=p[0], sy=p[1];
    if(sx<-120||sy<-80||sx>w+120||sy>h+80) continue;
    const fs=Math.max(24,Math.min(44,30*scale/0.52));
    drawTextHalo(ctx,s,sx,sy,`800 ${fs}px "Noto Sans KR",sans-serif`,
      'rgba(255,244,211,.98)','rgba(32,20,8,.96)',Math.max(6,fs*.22));
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

  // 성지: 원본 center_pos 좌표에 마커 + 이름/Lv 한 번만 표시.
  if(cityMode){
    for(const [code,rgn] of regionsWithCity){
      const city=rgn.city;
      const p=tileCenterToScreen(city.x-1,city.y-1), sx=p[0], sy=p[1];
      if(sx<-140||sy<-100||sx>w+180||sy>h+120) continue;

      drawCityIconScreen(ctx,sx,sy,city);

      const lv=Number(city.level||0);
      const label=lv?`${lv} ${city.name||rgn.n}`:(city.name||rgn.n);
      const fs=lv>=20?15:(lv>=13?13:12);
      const focused=Number(city.id)===selectedS11ConnectionId;
      // The selected facility gets its own top-most badge after all other
      // labels; reserve regular labels for non-selected facilities only.
      if(focused)continue;
      const near=showS11Connections && !!(S11_CONN_ADJ.get(selectedS11ConnectionId)||[]).some(([id])=>id===Number(city.id));
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

  if(showGates){
    for(const g of (X.gates||[])){
      const p=tileCenterToScreen(g.x-1,g.y-1), sx=p[0], sy=p[1];
      if(sx<-100||sy<-70||sx>w+150||sy>h+70) continue;
      drawGateIcon(ctx,sx,sy,g.kind);
      if(Number(g.id)===selectedS11ConnectionId)continue;
      if(scale>1.0){
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

  if(showTransports){
    for(const p0 of (X.docks||[])){
      const p=tileCenterToScreen(p0.x-1,p0.y-1), sx=p[0], sy=p[1];
      if(sx<-80||sy<-60||sx>w+120||sy>h+60) continue;
      drawTransportIcon(ctx,sx,sy,'dock');
      if(scale>1.5){
        const dockY=claimLabel(ctx,p0.name||'부두','800 10px "Noto Sans KR",sans-serif',sx+12,sy-2,5,2);
        if(dockY!==null)drawTextBadge(ctx,p0.name||'부두',sx+12,dockY,`800 10px "Noto Sans KR",sans-serif`,'#EAF8FF',{
          bg:'rgba(18,31,39,.88)',stroke:'rgba(92,170,207,.50)',padX:5,padY:2,radius:5,align:'left'
        });
      }
    }
  }

  // 선교 / 요충지 / 산길
  if(scale>0.55){
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
        drawStrategicIcon(ctx,sx,sy,kind);
        if(scale>2){
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
  const img=octx.createImageData(W,H), a=img.data;
  for(let i=0;i<codes.length;i++){
    const c=codeHex(codes[i]), r=R[c];
    let rgb=[100,100,100];
    if(r) rgb=colorForRegion(r);

    const x=i%W, y=(i/W)|0;
    let shade=1;
    if(shadeMode){
      shade=0.92 + 0.08*Math.sin(x*0.020+y*0.009) + 0.06*Math.cos(y*0.028) + 0.04*Math.sin((x+y)*0.013);
      shade=Math.max(0.82,Math.min(1.15,shade));
    }

    const j=i*4;
    a[j]=Math.max(0,Math.min(255,rgb[0]*shade));
    a[j+1]=Math.max(0,Math.min(255,rgb[1]*shade));
    a[j+2]=Math.max(0,Math.min(255,rgb[2]*shade));
    a[j+3]=170;
  }

  octx.clearRect(0,0,W,H);
  if(bgImg.complete) octx.drawImage(bgImg,0,0,W,H);
  octx.putImageData(img,0,0);

  // 경계는 Path2D 오버레이로 그리므로 여기서 225만 픽셀 경계 계산을 반복하지 않음.
}
function resize(){
  const r=map.parentElement.getBoundingClientRect();
  renderDpr=computeRenderDpr();
  const pw=Math.floor(r.width*renderDpr), ph=Math.floor(r.height*renderDpr);
  for(const c of [map,fx]){
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
    if(lv<9||lv>12||!visibleResourceKinds[kind]||!(lv===9?resourceMidVisible:resourceHighVisible))continue;
    const p=tileCenterToScreen(x,y);
    if(p[0]<0||p[1]<0||p[0]>rw||p[1]>rh)continue;
    const t=String(lv);ctx.lineWidth=3.5;ctx.strokeStyle='rgba(9,15,15,.95)';ctx.strokeText(t,p[0],p[1]);
    ctx.fillStyle='#ffffff';ctx.fillText(t,p[0],p[1]);
  }
  ctx.restore();
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
  b.textContent=showGyeokmunLines?'격문 점령 ON':'격문 점령 OFF';
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
  g.save();g.lineCap='round';g.lineJoin='round';
  // 연결선은 행정 경계가 아니다. 전체망은 가늘고 옅은 회보라색 계열로,
  // 선택 성지의 직접 연결만 별도 최상단 레이어에서 강조한다.
  for(const mask of [3,1,2]){
    g.beginPath();
    for(const [a,b,m] of S11_CONN_EDGES){
      if(m!==mask)continue;
      const pa=pixels[a],pb=pixels[b];if(!pa||!pb)continue;
      if(Math.max(pa[0],pb[0]) < -35 || Math.min(pa[0],pb[0]) > width+35 ||
         Math.max(pa[1],pb[1]) < -35 || Math.min(pa[1],pb[1]) > height+35)continue;
      g.moveTo(pa[0],pa[1]);g.lineTo(pb[0],pb[1]);
    }
    g.setLineDash(mask===2?[4,5]:[]);
    // 연결망의 배경선: 선택 연결(아래 별도 강조 레이어)과 구분되면서도
    // 주변 성지 연결 관계를 따라갈 수 있도록 중간 밝기 / 가는 두께 유지.
    g.lineWidth=mask===3?1.2:(mask===1?1.18:1.12);
    // All non-selected edges share one muted blue-gray hue. The original edge
    // category remains readable from the solid / dashed line pattern.
    const a=focusActive?0.40:0.48;
    g.strokeStyle=`rgba(163,194,209,${a})`;
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
  drawTileHighlight();
  drawSearchTarget();
  drawS11ConnectionFocus(fctx);
}
window.addEventListener('s11-steel-redraw',()=>drawSelection());
function drawMini(){}

function draw(){
  const r=map.getBoundingClientRect(), w=r.width, h=r.height;
  for(const c of [ctx,fctx]){
    c.setTransform(renderDpr,0,0,renderDpr,0,0);
    c.clearRect(0,0,w,h);
  }
  ctx.fillStyle='#0e0a06';
  ctx.fillRect(0,0,w,h);
  drawWorldLayer(ctx,off);
  if(showTerrain && exactTerrainReady){
    // 배율과 무관하게 동일한 엇갈림 규칙을 사용한다.
    // 저배율에서만 정사각 raster를 사용하면 확대 경계(6배)에서 타일이 반 칸 튀는 현상이 생긴다.
    drawOffsetTileTerrain(ctx,true);
  }
  ctx.fillStyle='rgba(0,0,0,.13)'; ctx.fillRect(0,0,w,h);
  drawTerritoryRanges(ctx);
  drawS11ConnectionNetwork(ctx);
  drawGyeokmunOccupationLinks(ctx);
  drawAnnotations();
  drawHighLevelResourceNumbers();
  drawTileGridStatic(ctx);
  drawTileCounters(ctx);
  drawSelection();
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
  for(const s of allStructures){
    const q=structureWorldTile(s);
    if(Math.floor(q[0])===tx && Math.floor(q[1])===ty) return s;
  }
  return null;
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
    if(city){ html += `<div class="city"><div><b>${city.level?`${city.level} `:''}${city.name || r.n}</b></div><div class="kv"><div class="k">좌표</div><div class="v">${city.x!=null?`(${city.x}, ${city.y}) <button class=\"copyCoordBtn\" data-copy-coord=\"${city.x}.${city.y}\">복사</button>`:'-'}</div></div></div>`; }
  } else {
    html += `<div class="small">지도를 클릭하거나 검색 결과를 선택하면 정보가 표시됩니다.</div>`;
  }
  if(structure){
    const sg=structureGameCoord(structure);
    html += `<div class="city"><div><b>${structure.level?`${structure.level} `:''}${structure.name}</b></div><div class="kv"><div class="k">좌표</div><div class="v">(${sg[0]}, ${sg[1]}) <button class=\"copyCoordBtn\" data-copy-coord=\"${sg[0]}.${sg[1]}\">복사</button></div></div></div>`;
  }
  html += '</div>'; box.innerHTML=html;
}
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

function getSearchMatches(q){
  q=(q||'').trim().toLowerCase();
  if(!q) return {regions:[],structs:[]};
  const regions=regionEntries
    .filter(([code,r])=>{ const city=r.city?.name||''; return (code+' '+r.f+' '+r.n+' '+r.s+' '+r.m+' '+city).toLowerCase().includes(q); })
    .sort((a,b)=>a[1].f.localeCompare(b[1].f,'ko'));
  const structs=allStructures.filter(s=>(s.name+' '+s.id).toLowerCase().includes(q));
  return {regions,structs};
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
    const s=allStructures.find(v=>String(v.id)===key); if(!s) return;
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
let routeDepartureManuallySet=false;
function setRouteDepartureCurrentTime(){
  const now=new Date(); // Browser local time, not the server or a fixed 16:40.
  const hour=document.getElementById('routeDepartureHour'),minute=document.getElementById('routeDepartureMinute');
  if(hour)hour.value=String(now.getHours()).padStart(2,'0');
  if(minute)minute.value=String(now.getMinutes()).padStart(2,'0');
  updateRouteTiming();
}
setRouteDepartureCurrentTime();
for(const id of ['routeDepartureHour','routeDepartureMinute']){
  document.getElementById(id)?.addEventListener('change',()=>{routeDepartureManuallySet=true;updateRouteTiming();});
}
const routeToggleBtn=document.getElementById('routeToggleBtn');
routeToggleBtn?.addEventListener('click',()=>{
  if(!routeMode&&!routeDepartureManuallySet)setRouteDepartureCurrentTime();
  setRouteMode(!routeMode);
});
const gyeokmunToggleBtn=document.getElementById('gyeokmunToggleBtn');
gyeokmunToggleBtn?.addEventListener('click',()=>{showGyeokmunLines=!showGyeokmunLines;updateGyeokmunToggle();scheduleFullDraw();});
updateGyeokmunToggle();
document.getElementById('routeCloseBtn')?.addEventListener('click',()=>clearRoute(false));
document.getElementById('routeResetBtn')?.addEventListener('click',()=>clearRoute(true));
document.getElementById('routeClearBtn')?.addEventListener('click',()=>{ routeSearchToken++; routeSearching=false; routeStart=null;routeEnd=null;routePath=[];routeOverlayVisible=true;updateRouteUI(routeMode?'시작 타일을 클릭하거나 입력하세요.':'경로가 지워졌습니다.');drawSelection(); });
document.getElementById('routeCalculateBtn')?.addEventListener('click',applyRouteInputs);
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
  selectedTile=tileRecord(tx,ty);
  searchTargetTile={x:tx,y:ty};
  updateInfo(null,selectedTile,structureAtTile(tx,ty));
  centerOnTile(tx,ty,MAX_SCALE);
}
const coordInput=document.getElementById('coordInput');
document.getElementById('coordBtn').onclick=goToCoordinate;
if(coordInput){
  coordInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); goToCoordinate(); } });
  coordInput.addEventListener('input',()=>setCoordMessage(''));
}
document.getElementById('colorMode').onchange=e=>{ colorMode=e.target.value; buildBase(); draw(); };
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

function refreshResourceColors(){
  if(exactTerrainReady) buildExactTerrainOverlay();
  else scheduleFullDraw();
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
const previewMap=document.createElement('canvas'), previewFx=document.createElement('canvas');
const previewMapCtx=previewMap.getContext('2d'), previewFxCtx=previewFx.getContext('2d');
let previewBaseScale=scale, previewBaseOx=ox, previewBaseOy=oy;
let dragStartX=0, dragStartY=0, dragBaseOx=0, dragBaseOy=0;
let zoomPreviewActive=false, zoomCommitTimer=0;
let pendingHoverClientX=0, pendingHoverClientY=0;
let lastHoverSignature='';
let lastInfoTileKey='';
let lastHudText='';
function capturePreview(){
  previewMap.width=map.width; previewMap.height=map.height;
  previewFx.width=fx.width; previewFx.height=fx.height;
  previewMapCtx.setTransform(1,0,0,1,0,0); previewMapCtx.clearRect(0,0,previewMap.width,previewMap.height); previewMapCtx.drawImage(map,0,0);
  previewFxCtx.setTransform(1,0,0,1,0,0); previewFxCtx.clearRect(0,0,previewFx.width,previewFx.height); previewFxCtx.drawImage(fx,0,0);
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
  ctx.clearRect(0,0,w,h); ctx.fillStyle='#0e0a06'; ctx.fillRect(0,0,w,h);
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(previewMap,0,0,previewMap.width,previewMap.height,dx,dy,w*ratio,h*ratio);
  fctx.setTransform(renderDpr,0,0,renderDpr,0,0);
  fctx.clearRect(0,0,w,h);
  fctx.drawImage(previewFx,0,0,previewFx.width,previewFx.height,dx,dy,w*ratio,h*ratio);
}
function schedulePreview(){ if(!previewRAF) previewRAF=requestAnimationFrame(drawPreview); }
function cancelPreviewFrame(){ if(previewRAF){ cancelAnimationFrame(previewRAF); previewRAF=0; } }
function commitPreview(){
  cancelPreviewFrame();
  zoomPreviewActive=false;
  if(zoomCommitTimer){ clearTimeout(zoomCommitTimer); zoomCommitTimer=0; }
  draw();
}
function scheduleFullDraw(){
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
  capturePreview();
  map.setPointerCapture(e.pointerId);
});
map.addEventListener('pointermove',e=>{
  if(dragging){
    const dx=e.clientX-dragStartX, dy=e.clientY-dragStartY;
    if(Math.abs(dx)+Math.abs(dy)>2) moved=true;
    ox=dragBaseOx+dx; oy=dragBaseOy+dy;
    lastX=e.clientX; lastY=e.clientY;
    schedulePreview();
    const refreshAt=Math.max(260,Math.min(map.clientWidth,map.clientHeight)*0.32);
    if(Math.max(Math.abs(dx),Math.abs(dy))>refreshAt){
      cancelPreviewFrame();
      draw(); capturePreview();
      dragStartX=e.clientX; dragStartY=e.clientY;
      dragBaseOx=ox; dragBaseOy=oy;
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
    if(window.S11SteelBridge?.isPicking()){
      const picked=findSteelMarkerClick(e.clientX,e.clientY);
      window.S11SteelBridge.onMarkerClick(picked);
      cancelPreviewFrame(); dragging=false;
      return;
    }
    if(routeMode){
      cancelPreviewFrame(); dragging=false;
      routePickTile(Math.floor(mx),Math.floor(my));
      return;
    }
    searchTargetTile=null;
    selected=code;
    if(scale>6){
      const tx=Math.floor(mx), ty=Math.floor(my);
      const st=structureAtTile(tx,ty);
      selectedTile=tileRecord(tx,ty);
      updateInfo(null,selectedTile,st);
      if(tileClickTimer) clearTimeout(tileClickTimer);
      tileClickTimer=setTimeout(()=>{ tileClickTimer=0; toggleTileCounterMark(tx,ty); },220);
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
  if(scale>6) removeTileCounterMark(Math.floor(mx),Math.floor(my));
});
map.addEventListener('wheel',e=>{
  e.preventDefault();
  const r=map.getBoundingClientRect();
  const px=e.clientX-r.left, py=e.clientY-r.top;
  if(!zoomPreviewActive){ capturePreview(); zoomPreviewActive=true; }
  const world=screenToWorld(px,py);
  const ns=Math.max(.12, Math.min(MAX_SCALE, scale*Math.exp(-e.deltaY*0.00145)));
  scale=ns;
  const dx=(world[0]-CX)*scale*FLIP_X, dy=(world[1]-CY)*scale;
  ox = px - (CX*scale + dx*COS - dy*SIN);
  oy = py - (CY*scale + dx*SIN + dy*COS);
  schedulePreview();
  if(zoomCommitTimer) clearTimeout(zoomCommitTimer);
  zoomCommitTimer=setTimeout(commitPreview,90);
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
  e.currentTarget.textContent=showS11Connections?'성지 연결 ON · 448':'성지 연결 OFF';
  scheduleFullDraw();
});
resize(); updateInfo(null,null,null); loadExactTileLayers();
})();
