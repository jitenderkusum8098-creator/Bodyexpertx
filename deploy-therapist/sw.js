self.addEventListener("push",event=>{
 let data={};
 try{data=event.data?event.data.json():{body:event.data?event.data.text():"Nayi job aayi hai."}}catch(_){data={body:event.data?event.data.text():"Nayi job aayi hai."}}
 const title=data.title||"BodyExpertX — Nayi Job 🔔";
 const options={
  body:data.body||"Therapist Panel kholkar job details dekhein.",
  icon:"/bex-app-icon.svg",
  badge:"/bex-app-icon.svg",
  tag:data.tag||("bodyexpertx-new-job-"+Date.now()),
  renotify:true,
  requireInteraction:true,
  silent:false,
  timestamp:Date.now(),
  vibrate:[500,180,500,180,900,250,500,180,900,250,500,180,1200,300,500,180,1200],
  data:{url:data.url||"https://bodyexpertx-therapist.onrender.com/"},
  actions:[{action:"open",title:"Open Duty"},{action:"dismiss",title:"Dismiss"}]
 };
 event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 if(event.action==="dismiss")return;
 const target=event.notification.data&&event.notification.data.url?event.notification.data.url:"https://bodyexpertx-therapist.onrender.com/";
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of windows){if("focus"in client){await client.focus();if("navigate"in client)await client.navigate(target);return;}}
  if(self.clients.openWindow)await self.clients.openWindow(target);
 })());
});
