'use strict';
// v22.9: Main-thread rendering remains responsive while hex-grid A* runs here.
// The original 0-based world -> 1-based raw-layer (+1,+1) transformation is retained.
let W=0,H=0,terrain=null,seen=null,closed=null,gScore=null,parent=null;
let generation=1,active=null;
function passable(x,y,allowCityPerimeter=false){
  if(!terrain||x<0||y<0||x>=W||y>=H||x+1>=W||y+1>=H)return false;
  const raw=terrain[(y+1)*W+x+1];
  if(raw===2||raw===3)return false;
  if(!allowCityPerimeter&&(raw===8||raw===9))return false;
  return true;
}
function cubeDistance(ax,ay,bx,by){
  const az=ay-((ax-(ax&1))>>1), bz=by-((bx-(bx&1))>>1);
  return Math.max(Math.abs(ax-bx),Math.abs(az-bz),Math.abs((ax+az)-(bx+bz)));
}
function push(hi,hf,idx,f){
  let i=hi.length;hi.push(idx);hf.push(f);
  while(i>0){const p=(i-1)>>1;if(hf[p]<=f)break;hi[i]=hi[p];hf[i]=hf[p];i=p;}
  hi[i]=idx;hf[i]=f;
}
function pop(hi,hf){
  if(!hi.length)return -1;
  const root=hi[0],li=hi.pop(),lf=hf.pop();
  if(hi.length){let i=0;while(true){let c=i*2+1;if(c>=hi.length)break;
    if(c+1<hi.length&&hf[c+1]<hf[c])c++;
    if(hf[c]>=lf)break;
    hi[i]=hi[c];hf[i]=hf[c];i=c;
  }hi[i]=li;hf[i]=lf;}
  return root;
}
function pathFrom(startIdx,endIdx){
  const path=[];let cur=endIdx,guard=0;
  while(cur!==startIdx&&cur>=0&&guard<W*H){path.push({x:cur%W,y:(cur/W)|0});cur=parent[cur];guard++;}
  if(cur!==startIdx)return [];
  path.push({x:startIdx%W,y:(startIdx/W)|0});path.reverse();return path;
}
function find(token,start,end,allowCityPerimeter=false){
  if(!terrain||!passable(start.x,start.y,allowCityPerimeter)||!passable(end.x,end.y,allowCityPerimeter)){
    postMessage({type:'done',token,path:[],expanded:0});return;
  }
  generation=(generation+1)>>>0;
  if(!generation){seen.fill(0);closed.fill(0);generation=1;}
  const gen=generation,si=start.y*W+start.x,ei=end.y*W+end.x;
  const hi=[],hf=[];
  seen[si]=gen;gScore[si]=0;parent[si]=-1;
  push(hi,hf,si,cubeDistance(start.x,start.y,end.x,end.y));
  const job={token,gen,si,ei,hi,hf,expanded:0,lastProgress:performance.now()};
  active=job;
  function step(){
    if(active!==job)return;
    const deadline=performance.now()+14;
    while(hi.length&&performance.now()<deadline){
      const cur=pop(hi,hf);if(cur<0)break;
      if(closed[cur]===gen)continue;
      closed[cur]=gen;job.expanded++;
      if(cur===ei){active=null;postMessage({type:'done',token,path:pathFrom(si,ei),expanded:job.expanded});return;}
      const x=cur%W,y=(cur/W)|0,ng=gScore[cur]+1;
      // Exact same staggered-column neighbors/order as app.js.
      const n=[[x,y-1],[x,y+1]];
      if((x&1)===0)n.push([x-1,y-1],[x-1,y],[x+1,y-1],[x+1,y]);
      else n.push([x-1,y],[x-1,y+1],[x+1,y],[x+1,y+1]);
      for(let k=0;k<n.length;k++){
        const nx=n[k][0],ny=n[k][1];
        if(!passable(nx,ny,allowCityPerimeter))continue;
        const ni=ny*W+nx;
        if(closed[ni]===gen)continue;
        if(seen[ni]!==gen||ng<gScore[ni]){
          seen[ni]=gen;gScore[ni]=ng;parent[ni]=cur;
          push(hi,hf,ni,ng+cubeDistance(nx,ny,end.x,end.y));
        }
      }
    }
    if(active!==job)return;
    if(!hi.length){active=null;postMessage({type:'done',token,path:[],expanded:job.expanded});return;}
    if(performance.now()-job.lastProgress>110){job.lastProgress=performance.now();postMessage({type:'progress',token,expanded:job.expanded});}
    setTimeout(step,0);
  }
  setTimeout(step,0);
}
onmessage=e=>{
  const m=e.data||{};
  if(m.type==='init'){
    W=m.width;H=m.height;terrain=new Uint8Array(m.terrain);
    if(terrain.length!==W*H){postMessage({type:'error',token:0,error:'지형 데이터 길이 불일치'});return;}
    const size=W*H;
    seen=new Uint32Array(size);closed=new Uint32Array(size);gScore=new Uint32Array(size);parent=new Int32Array(size);
    postMessage({type:'ready'});
  }else if(m.type==='cancel')active=null;
  else if(m.type==='find'){
    active=null;
    try{find(m.token,m.start,m.end,!!m.allowCityPerimeter);}catch(err){postMessage({type:'error',token:m.token,error:String(err)});}
  }
};
