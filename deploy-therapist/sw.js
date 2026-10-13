self.addEventListener("push",event=>{
 let data={};
 try{data=event.data?event.data.json():{}}catch(_){data={body:event.data?event.data.text():"Nayi job aayi hai."}}
 const title=data.title||"BodyExpertX — Nayi Job 🔔";
 const options={
  body:data.body||"Therapist Panel kholkar job details dekhein.",
  tag:data.tag||"bodyexpertx-new-job",
  renotify:true,
  requireInteraction:true,
  vibrate:[500,150,500,150,1000,250,500,150,1000,250,500,150,1000],
  data:{url:data.url||"https://bodyexpertx-therapist.onrender.com/"}
 };
 event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const target=event.notification.data&&event.notification.data.url?event.notification.data.url:"https://bodyexpertx-therapist.onrender.com/";
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of windows){if("focus"in client){await client.focus();if("navigate"in client)await client.navigate(target);return;}}
  if(self.clients.openWindow)await self.clients.openWindow(target);
 })());
});
