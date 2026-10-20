/* BodyExpertX customer funnel tracking. Does not alter booking submission or store address/location/payment data. */
(function(){
  'use strict';
  const URL='https://myjstwbpmbrhaiwytpnq.supabase.co';
  const KEY='sb_publishable_jHjVYTPlBLDgaNfiazRkvg_iVI_5-Xy';
  const TABLE=URL+'/rest/v1/customer_tracking_events';
  let sid='';
  try { sid=sessionStorage.getItem('bex_track_sid')||''; } catch(_){}
  if(!sid){sid=(crypto.randomUUID?crypto.randomUUID():('bex'+Date.now().toString(36)+Math.random().toString(36).slice(2)))+'-'+Math.random().toString(36).slice(2,10);try{sessionStorage.setItem('bex_track_sid',sid)}catch(_){}}
  let lastContact='', lastEvent='';
  const $=id=>document.getElementById(id);
  function contact(){
    const name=(($('name')||{}).value||'').trim().slice(0,120);
    const raw=(($('phone')||{}).value||'').trim();
    const phone=raw.replace(/\D/g,'');
    return {name,phone:phone.length>=10&&phone.length<=15?phone:null};
  }
  async function record(eventName,includeContact){
    if(lastEvent===eventName && eventName==='page_view') return;
    lastEvent=eventName;
    const c=includeContact?contact():{name:'',phone:null};
    const payload={session_id:sid,event_name:eventName,customer_name:c.name||null,customer_phone:c.phone,page_path:location.pathname.slice(0,200)};
    try{
      await fetch(TABLE,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(payload),keepalive:true});
    }catch(_){}
  }
  function addPrivacyNote(){
    const phone=$('phone');
    if(!phone||$('bexTrackingPrivacyNote'))return;
    const note=document.createElement('small');
    note.id='bexTrackingPrivacyNote';
    note.textContent='Aapke booking process ko samajhne aur adhuri booking par follow-up mein madad ke liye, aapke dwara diya gaya naam/mobile BodyExpertX Admin dekh sakta hai.';
    note.style.cssText='display:block;font-size:12px;line-height:1.4;color:#666;margin:4px 0 8px';
    phone.insertAdjacentElement('afterend',note);
  }
  function init(){
    addPrivacyNote();
    record('page_view',false);
    const phone=$('phone'), name=$('name');
    function saveContact(){
      const c=contact(), sig=(c.name+'|'+(c.phone||''));
      if(c.phone && sig!==lastContact){lastContact=sig;record('contact_entered',true);}
    }
    phone?.addEventListener('blur',saveContact);
    name?.addEventListener('blur',saveContact);
    phone?.addEventListener('change',saveContact);
    document.addEventListener('click',function(e){
      const el=e.target.closest('button,input[type="submit"],a');
      if(!el)return;
      const label=((el.innerText||el.value||el.getAttribute('aria-label')||'')+'').toLowerCase();
      if(/continue|book now|booking|whatsapp|confirm|next|आगे|बुक/.test(label)){
        if(contact().phone)record('booking_started',true);
      }
    },true);
    window.addEventListener('pagehide',function(){if(contact().phone)record('booking_abandoned',true);});
    document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'&&contact().phone)record('booking_abandoned',true);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();