(()=>{
  'use strict';
  // Note: this is a client-side entry screen, NOT server-side authorization.
  // Public static hosting still exposes the source and map data files.
  const PIN='0806';
  const dependencies=['data.js','terrain_data.js','extras_data.js','connections_data.js','steel.js','city_stats.js','app.js'];
  const form=document.getElementById('accessForm');
  const pin=document.getElementById('accessPassword');
  const error=document.getElementById('accessError');
  const button=document.getElementById('accessSubmit');
  const loading=document.getElementById('accessLoading');
  const gate=document.getElementById('accessGate');
  let opening=false;
  function injectScript(filename){
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=filename;
      script.onload=()=>resolve();
      script.onerror=()=>reject(new Error(filename+' 파일을 불러오지 못했습니다.'));
      document.body.appendChild(script);
    });
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(opening)return;
    if(pin.value!==PIN){
      error.textContent='비밀번호가 올바르지 않습니다.';
      pin.value='';
      pin.focus();
      return;
    }
    opening=true;
    error.textContent='';
    button.disabled=true;
    pin.disabled=true;
    loading.hidden=false;
    // The canvas must be measurable before the map initialization runs.
    document.body.classList.remove('access-locked');
    try{
      for(const filename of dependencies) await injectScript(filename);
      gate.hidden=true;
      window.dispatchEvent(new Event('resize'));
    }catch(err){
      error.textContent='지도를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.';
      console.error('[Scenario11 access]',err);
      document.body.classList.add('access-locked');
      button.disabled=false;
      pin.disabled=false;
      loading.hidden=true;
      opening=false;
    }
  });
  pin.focus();
})();
