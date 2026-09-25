/* Mobile-only navigation: forward actions to the original v22.9.47 controls.
   No changes to map drawing, pointer capture, route logic, or saved settings. */
(()=>{
 const body=document.body;
 const menuBtn=document.getElementById('mobileToolsToggleBtn');
 const dockMenuBtn=document.getElementById('mobileMenuBtn');
 const infoBtn=document.getElementById('mobileInfoBtn');
 const resourceBtn=document.getElementById('mobileResourceBtn');
 const routeBtn=document.getElementById('mobileRouteBtn');
 const topbar=document.getElementById('topbar');
 const small=()=>window.matchMedia('(max-width:900px)').matches;
 const menuOpen=()=>body.classList.contains('mobileToolsOpen');
 function setMenu(open){
   body.classList.toggle('mobileToolsOpen',!!open&&small());
   const expanded=menuOpen();
   menuBtn?.setAttribute('aria-expanded',String(expanded));
   dockMenuBtn?.setAttribute('aria-expanded',String(expanded));
   if(menuBtn) menuBtn.textContent=expanded?'닫기 ×':'도구 ☰';
   dockMenuBtn?.classList.toggle('active',expanded);
 }
 function sync(){
   const isPanel=body.classList.contains('showPanel');
   const resourceOpen=!!document.getElementById('resourceLegend')?.open;
   const isRoute=document.getElementById('routeToggleBtn')?.getAttribute('aria-pressed')==='true';
   infoBtn?.setAttribute('aria-expanded',String(isPanel));
   infoBtn?.classList.toggle('active',isPanel);
   resourceBtn?.setAttribute('aria-expanded',String(resourceOpen));
   resourceBtn?.classList.toggle('active',resourceOpen);
   routeBtn?.setAttribute('aria-pressed',String(isRoute));
   routeBtn?.classList.toggle('active',isRoute);
 }
 menuBtn?.addEventListener('click',()=>{setMenu(!menuOpen());sync();});
 dockMenuBtn?.addEventListener('click',()=>{setMenu(!menuOpen());sync();});
 infoBtn?.addEventListener('click',()=>{
   if(!small())return;setMenu(false);
   document.getElementById('collapse')?.click();sync();
 });
 resourceBtn?.addEventListener('click',()=>{
   if(!small())return;setMenu(false);
   document.getElementById('resourceFilterToggleBtn')?.click();sync();
 });
 routeBtn?.addEventListener('click',()=>{
   if(!small())return;setMenu(false);
   document.getElementById('routeToggleBtn')?.click();sync();
 });
 // Other top-level actions stay fully functional; close the menu only AFTER
 // their existing handler runs. The popover positions are mobile CSS-anchored.
 topbar?.querySelector('.top-actions')?.addEventListener('click',e=>{
   const btn=e.target.closest('button');
   if(!btn||btn===menuBtn)return;
   if(menuOpen()){setMenu(false);}
   requestAnimationFrame(sync);
 });
 document.getElementById('collapse')?.addEventListener('click',()=>requestAnimationFrame(sync));
 document.getElementById('resourceLegend')?.addEventListener('toggle',sync);
 document.getElementById('routeToggleBtn')?.addEventListener('click',()=>requestAnimationFrame(sync));
 document.getElementById('routeCloseBtn')?.addEventListener('click',()=>requestAnimationFrame(sync));
 document.addEventListener('pointerdown',e=>{
   if(menuOpen()&&!topbar?.contains(e.target)&&!dockMenuBtn?.contains(e.target))setMenu(false);
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menuOpen()){setMenu(false);e.preventDefault();e.stopImmediatePropagation();}});
 window.addEventListener('resize',()=>{if(!small())setMenu(false);sync();},{passive:true});
 sync();
})();
