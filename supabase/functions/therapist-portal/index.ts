import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const url=Deno.env.get("SUPABASE_URL")!,serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,anonKey=Deno.env.get("SUPABASE_ANON_KEY")??"";
const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
async function therapistUser(req:Request){
 const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"");if(!token||!anonKey)throw new Error("Please sign in first.");
 const auth=createClient(url,anonKey,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await auth.auth.getUser(token);if(error||!user)throw new Error("Session expired. Please sign in again.");
 const {data:t,error:tError}=await db.from("therapists").select("id,user_id,display_name,therapist_code,phone,photo_url,active,available,experience_years,service_types,tiers").eq("user_id",user.id).maybeSingle();
 if(tError||!t||!t.active)throw new Error("Active therapist profile not found. Ask Admin to connect your account to the therapist profile.");return t;
}
async function hashToken(token:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");}
function randomToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,"0")).join("");}
function coordsFromAddress(address: string | null) {
 const m = address?.match(/GPS:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
 return m ? { lat: Number(m[1]), lng: Number(m[2]) } : { lat: null as number | null, lng: null as number | null };
}
function landmarkFromAddress(address: string | null) {
 return address?.match(/Landmark:\s*([^·\n]+)/i)?.[1]?.trim().slice(0, 200) || null;
}
const today=()=>new Date().toISOString().slice(0,10);
async function addReferralCommissionOnCompletion(bookingId:string,therapistUserId:string,completedAt:string){
 const {data:booking,error:bookingError}=await db.from("booking_assignments")
  .select("id,reference_code,status,partner_id,partner_referral_id,booking_amount,tier,service_name,customer_name,customer_phone")
  .eq("id",bookingId).maybeSingle();
 if(bookingError)throw bookingError;
 if(!booking||booking.status!=="completed")return {earned:false,reason:"not_completed"};
 if(!booking.partner_id)return {earned:false,reason:"no_partner_referral"};
 const {data:partner,error:partnerError}=await db.from("partners").select("id,business_name,category,user_id,status").eq("id",booking.partner_id).maybeSingle();
 if(partnerError)throw partnerError;
 if(!partner||partner.status!=="active")return {earned:false,reason:"partner_inactive"};
 let referral:any=null;
 if(booking.partner_referral_id){
  const {data,error}=await db.from("partner_referrals").select("id,created_at,status").eq("id",booking.partner_referral_id).eq("partner_id",partner.id).maybeSingle();
  if(error)throw error;referral=data;
 }
 if(!referral){
  const phone=String(booking.customer_phone||"").replace(/\D/g,"").slice(-10);
  if(!booking.customer_name||phone.length!==10)return {earned:false,reason:"referral_details_missing"};
  const {data:existing,error:existingError}=await db.from("partner_referrals").select("id,created_at,status").eq("partner_id",partner.id).eq("phone_normalized",phone).eq("status","active").maybeSingle();
  if(existingError)throw existingError;
  referral=existing;
  if(!referral){
   const {data:created,error:createError}=await db.from("partner_referrals").insert({
    partner_id:partner.id,customer_name:String(booking.customer_name).trim(),customer_phone:String(booking.customer_phone).trim(),
    phone_normalized:phone,consent_confirmed:false,status:"active",created_by:therapistUserId,
    notes:"QR/Referral booking auto-linked when therapist completed job"
   }).select("id,created_at,status").single();
   if(createError)throw createError;referral=created;
  }
  const {error:attachError}=await db.from("booking_assignments").update({partner_referral_id:referral.id}).eq("id",bookingId).is("partner_referral_id",null);
  if(attachError)throw attachError;
 }
 const {data:prior,error:priorError}=await db.from("partner_commissions").select("id,commission_amount").eq("booking_id",bookingId).limit(1);
 if(priorError)throw priorError;
 if(prior?.length){
  const {data:notice}=await db.from("partner_notifications").select("id").eq("commission_id",prior[0].id).limit(1);
  if(!notice?.length){
   await db.from("partner_notifications").insert({partner_id:partner.id,notification_type:"commission_earned",title:"🎉 आपका रेफर सफल रहा!",message:"आपका रेफर सफल रहा! आपने आज ₹"+Number(prior[0].commission_amount).toLocaleString("en-IN",{maximumFractionDigits:2})+" की कमाई की है। आपकी Referral Earning BEX Partner Dashboard में जोड़ दी गई है।",booking_id:bookingId,commission_id:prior[0].id});
  }
  return {earned:false,reason:"already_earned",amount:Number(prior[0].commission_amount)};
 }
 const {data:rules,error:rulesError}=await db.from("partner_commission_rules").select("id,partner_id,category,service_tier,commission_type,amount,rule_mode,validity_months,active").eq("category",partner.category).eq("service_tier",booking.tier).eq("active",true);
 if(rulesError)throw rulesError;
 const rule=(rules||[]).find((x:any)=>x.partner_id===partner.id)||(rules||[]).find((x:any)=>!x.partner_id);
 if(!rule)return {earned:false,reason:"no_rule"};
 const {data:priorRefCommissions,error:priorRefError}=await db.from("partner_commissions").select("id,earned_at").eq("partner_id",partner.id).eq("referral_id",referral.id).neq("status","void");
 if(priorRefError)throw priorRefError;
 if(rule.rule_mode==="first"&&(priorRefCommissions||[]).length)return {earned:false,reason:"not_eligible"};
 if(rule.rule_mode==="period"){
  const months=Math.max(1,Number(rule.validity_months||1)),cutoff=new Date(completedAt);cutoff.setMonth(cutoff.getMonth()-months);
  if(referral.created_at&&new Date(referral.created_at)<cutoff)return {earned:false,reason:"not_eligible"};
 }
 const bookingAmount=Number(booking.booking_amount||0),rate=Number(rule.amount);
 if(!Number.isFinite(rate)||rate<=0||(rule.commission_type==="percent"&&(!Number.isFinite(bookingAmount)||bookingAmount<=0||rate>100)))return {earned:false,reason:"invalid_rule"};
 const amount=rule.commission_type==="percent"?Math.round(bookingAmount*rate)/100:Math.round(rate*100)/100;
 if(!Number.isFinite(amount)||amount<=0)return {earned:false,reason:"invalid_rule"};
 const {data:commission,error:commissionError}=await db.from("partner_commissions").insert({
  partner_id:partner.id,referral_id:referral.id,booking_id:booking.id,service_tier:booking.tier,
  booking_amount:bookingAmount,commission_type:rule.commission_type,rate_value:rate,commission_amount:amount,
  status:"earned",earned_at:completedAt
 }).select("id,commission_amount").single();
 if(commissionError){
  if(commissionError.code==="23505"){
   const {data:existing}=await db.from("partner_commissions").select("id,commission_amount").eq("booking_id",bookingId).maybeSingle();
   return {earned:false,reason:"already_earned",amount:Number(existing?.commission_amount||0)};
  }
  throw commissionError;
 }
 const {error:notificationError}=await db.from("partner_notifications").insert({
  partner_id:partner.id,notification_type:"commission_earned",title:"🎉 आपका रेफर सफल रहा!",
  message:"आपका रेफर सफल रहा! आपने आज ₹"+amount.toLocaleString("en-IN",{maximumFractionDigits:2})+" की कमाई की है। आपकी Referral Earning BEX Partner Dashboard में तुरंत जोड़ दी गई है।",
  booking_id:booking.id,commission_id:commission.id
 });
 if(notificationError)console.error("Partner commission notification could not be saved",notificationError);
 return {earned:true,amount,commission_id:commission.id,notification_created:!notificationError,partner_id:partner.id};
}
async function nextTherapist(job:any, excludeId:string){
 const {data:links,error:lError}=await db.from("therapist_zones").select("therapist_id").eq("zone_id",job.zone_id);if(lError)throw lError;
 const ids=(links??[]).map((x:any)=>x.therapist_id).filter((id:string)=>id!==excludeId);if(!ids.length)return null;
 const {data:candidates,error:cError}=await db.from("therapists").select("id,display_name,active,available,approval_status,service_types,tiers,experience_years,created_at").in("id",ids).eq("active",true).eq("available",true).eq("approval_status","approved");if(cError)throw cError;
 const eligible=(candidates??[]).filter((t:any)=>(t.service_types??[]).includes(job.service_type)&&(t.tiers??[]).includes(job.tier)&&(job.tier!=="Luxe"||Number(t.experience_years??0)>=2)&&(job.tier!=="Prime"||Number(t.experience_years??0)>=.5));
 if(!eligible.length)return null;const eids=eligible.map((x:any)=>x.id);const start=new Date();start.setHours(0,0,0,0);
 const [{data:ratings,error:rError},{data:jobs,error:jError}]=await Promise.all([
  db.from("therapist_ratings").select("therapist_id,rating").in("therapist_id",eids).eq("status","published"),
  db.from("booking_assignments").select("therapist_id,status,created_at").in("therapist_id",eids).gte("created_at",start.toISOString()).in("status",["awaiting_whatsapp","whatsapp_opened","confirmed","reached","completed"])
 ]);if(rError)throw rError;if(jError)throw jError;
 const score=eligible.map((t:any)=>{const rr=(ratings??[]).filter((r:any)=>r.therapist_id===t.id);const avg=rr.length?rr.reduce((s:number,r:any)=>s+Number(r.rating),0)/rr.length:0;const todays=(jobs??[]).filter((j:any)=>j.therapist_id===t.id).length;return {t,avg,todays}}).sort((a:any,b:any)=>(a.todays===0?0:1)-(b.todays===0?0:1)||b.avg-a.avg||a.todays-b.todays||String(a.t.created_at).localeCompare(String(b.t.created_at)));
 return score[0]?.t??null;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({error:"POST only"},405);
 try{const body=await req.json(),action=String(body.action??"");
  if(action==="register"){
   const name=String(body.name??"").trim(),phone=String(body.phone??"").replace(/\D/g,""),age=Number(body.age),gender=String(body.gender??""),email=String(body.email??"").trim(),experience_years=Number(body.experience_years??0),service_types=Array.isArray(body.service_types)?body.service_types.map((x:any)=>String(x)).filter((x:string)=>["Massage","Salon"].includes(x)):[];
   const details=body.registration_details&&typeof body.registration_details==="object"?body.registration_details:{};
   if(name.length<2||name.length>120||phone.length!==10||age<18||age>100||!["Male","Female","Other"].includes(gender)||experience_years<0||experience_years>60||!service_types.length||!String(details.full_address??"").trim()||!String(details.city??"").trim()||!Array.isArray(details.zone_ids)||!["commission","salary"].includes(details.work_model)||details.training_ready!==true||!["fresher","experienced"].includes(details.experience_type)||typeof details.has_certificate!=="boolean"||(details.experience_type==="experienced"&&(!String(details.experience_range??"").trim()||!String(details.previous_work??"").trim()))||(details.has_certificate&&(!String(details.course_name??"").trim()||!String(details.institute??"").trim())))return json({error:"Please complete all required registration details. Training acceptance is compulsory."},400);
   const {data:validZones,error:zoneError}=details.zone_ids.length?await db.from("zones").select("id,name,description").eq("active",true).in("id",details.zone_ids):{data:[],error:null};if(zoneError)throw zoneError;
   if(!validZones||validZones.length!==details.zone_ids.length)return json({error:"Selected zone is no longer active. Please reopen the form and select an available zone."},400);
   const cityNorm=String(details.city).toLowerCase();
   const cityMatches=(z:any)=>{const s=(String(z.name??"")+" "+String(z.description??"")).toLowerCase();if(/vasant kunj|delhi|new delhi/.test(s))return cityNorm==="delhi";if(/gurgaon|gurugram/.test(s))return cityNorm==="gurgaon";if(/noida/.test(s))return cityNorm==="noida";if(/faridabad/.test(s))return cityNorm==="faridabad";if(/rewari/.test(s))return cityNorm==="rewari";if(/narnaul/.test(s))return cityNorm==="narnaul";if(/mahendergarh|mahendragarh/.test(s))return cityNorm==="mahendergarh";if(/shighana/.test(s))return cityNorm==="shighana";return false};
   if(validZones.length&&!validZones.every(cityMatches))return json({error:"Selected zones city se match nahi karte. Please city aur zones dobara select karein."},400);
   const {data:duplicate,error:de}=await db.from("therapists").select("id").eq("phone",phone).limit(1);if(de)throw de;if(duplicate?.length)return json({error:"Is mobile number se therapist profile pehle se maujood hai. Admin se sampark karein."},409);
   const {data:pending,error:pe}=await db.from("therapists").insert({display_name:name,phone,age,gender,email:email||null,experience_years,service_types,registration_details:details,tiers:["Prime","Luxe"],active:false,available:false,approval_status:"pending"}).select("id,therapist_code,display_name").single();if(pe)throw pe;
   if(validZones.length){const zoneLinks=validZones.map((z:any)=>({therapist_id:pending.id,zone_id:z.id}));const {error:linkError}=await db.from("therapist_zones").insert(zoneLinks);if(linkError){await db.from("therapists").delete().eq("id",pending.id);throw linkError;}}
   const first=name.trim().split(/\s+/)[0]||name,initials=first.slice(0,2);const password=initials.charAt(0).toUpperCase()+initials.charAt(1).toLowerCase()+phone.slice(-4);
   return json({success:true,pending:true,therapist_code:pending.therapist_code,password_hint:password,message:"Registration submitted. Wait for Admin approval."});
  }
  if(action==="login"){
   const loginId=String(body.name??"").trim(),password=String(body.code??"").trim();
   if(!loginId||!password||loginId.length>120||password.length>80)return json({error:"Unique Therapist ID aur password bharein."},400);
   let t:any=null;
   const {data:byCode,error:codeError}=await db.from("therapists").select("id,user_id,display_name,phone,active,approval_status,therapist_code").ilike("therapist_code",loginId).maybeSingle();if(codeError)throw codeError;
   let newRule=false;
   if(byCode){t=byCode;newRule=true}
   else {const {data:legacy,error:legacyError}=await db.from("therapists").select("id,user_id,display_name,phone,active,approval_status,therapist_code").ilike("display_name",loginId).maybeSingle();if(legacyError)throw legacyError;t=legacy}
   if(!t||!t.active||(t.approval_status&&t.approval_status!=="approved"))return json({error:"Unique ID galat hai, ya Admin approval abhi pending hai."},401);
   const storedDigits=String(t.phone??"").replace(/\D/g,"");
   if(!storedDigits)return json({error:"Admin record mein registered mobile number nahi hai."},401);
   const first=String(t.display_name??"").trim().split(/\s+/)[0]||String(t.display_name??"");const initials=first.slice(0,2);const generated=initials.charAt(0).toUpperCase()+initials.charAt(1).toLowerCase()+storedDigits.slice(-4);
   const enteredDigits=password.replace(/\D/g,"");
   const passwordMatches=newRule?password===generated:(password===generated||enteredDigits===storedDigits||(enteredDigits.length===10&&storedDigits.endsWith(enteredDigits)));
   if(!passwordMatches)return json({error:"Unique ID ya password galat hai."},401);
   const authPassword=newRule?generated:(password===generated?generated:storedDigits);
   const email="therapist-"+t.id+"@therapist.bodyexpertx.invalid";
   let uid=t.user_id;
   if(!uid){
    const {data:created,error:ce}=await db.auth.admin.createUser({email,password:authPassword,email_confirm:true,user_metadata:{therapist_id:t.id,therapist_name:t.display_name}});
    if(ce)throw ce;uid=created.user.id;
    const {error:up}=await db.from("therapists").update({user_id:uid}).eq("id",t.id);if(up)throw up;
   } else {
    const {error:pw}=await db.auth.admin.updateUserById(uid,{password:authPassword,email,email_confirm:true});if(pw)throw pw;
   }
   const auth=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data:sessionData,error:se}=await auth.auth.signInWithPassword({email,password:authPassword});if(se)throw se;
   return json({success:true,session:sessionData.session,therapist_name:t.display_name});
  }
  const therapist=await therapistUser(req);
  if(action==="dashboard"){
   const {data:jobs,error}=await db.from("booking_assignments").select("id,reference_code,zone_id,therapist_id,service_type,tier,service_name,appointment_date,appointment_time,status,booking_amount,customer_name,customer_phone,customer_address,customer_landmark,customer_latitude,customer_longitude,customer_gps_accuracy_meters,customer_notes,service_details,visit_type,created_at,updated_at").eq("therapist_id",therapist.id).order("created_at",{ascending:false}).limit(500);if(error)throw error;
   const rows=jobs??[],zids=[...new Set(rows.map((j:any)=>j.zone_id).filter(Boolean))];
   const [{data:zones,error:zError},{data:ratings,error:rError}]=await Promise.all([zids.length?db.from("zones").select("id,name").in("id",zids):Promise.resolve({data:[],error:null}),db.from("therapist_ratings").select("rating,review,booking_reference,created_at,status").eq("therapist_id",therapist.id).eq("status","published").order("created_at",{ascending:false})]);if(zError)throw zError;if(rError)throw rError;
   const day=today(),month=day.slice(0,7),completed=rows.filter((j:any)=>j.status==="completed");
   return json({therapist:{id:therapist.id,name:therapist.display_name,code:therapist.therapist_code,available:therapist.available,phone:therapist.phone,photo_url:therapist.photo_url},jobs:rows.map((j:any)=>{const details=Array.isArray(j.service_details)?j.service_details:[];const parsed=coordsFromAddress(j.customer_address);const lat=j.customer_latitude??parsed.lat;const lng=j.customer_longitude??parsed.lng;const duration=details.reduce((sum:number,item:any)=>sum+Math.max(0,Number(item?.duration)||0),0);return {...j,zone_name:(zones??[]).find((z:any)=>z.id===j.zone_id)?.name??"Zone not set",service_duration_minutes:duration||null,customer_latitude:lat,customer_longitude:lng,customer_landmark:j.customer_landmark||landmarkFromAddress(j.customer_address),customer_gps_accuracy_meters:j.customer_gps_accuracy_meters??null,customer_map_url:lat!==null&&lng!==null&&lng!==undefined&&lat!==undefined?"https://www.google.com/maps/dir/?api=1&destination="+lat+","+lng:(j.customer_address?"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(j.customer_address):null)}}),ratings:ratings??[],stats:{earning_day:completed.filter((j:any)=>(j.updated_at??j.created_at??"").slice(0,10)===day).reduce((s:number,j:any)=>s+Number(j.booking_amount||0),0),earning_month:completed.filter((j:any)=>(j.updated_at??j.created_at??"").slice(0,7)===month).reduce((s:number,j:any)=>s+Number(j.booking_amount||0),0),jobs_day:rows.filter((j:any)=>(j.created_at??"").slice(0,10)===day).length,jobs_month:rows.filter((j:any)=>(j.created_at??"").slice(0,7)===month).length,rating_count:(ratings??[]).length,rating_average:(ratings??[]).length?Math.round((ratings??[]).reduce((s:number,r:any)=>s+Number(r.rating),0)/(ratings??[]).length*10)/10:null}});
  }
  if(action==="duty"){const available=body.available===true;const {data,error}=await db.from("therapists").update({available}).eq("id",therapist.id).select("id,available").single();if(error)throw error;return json({success:true,available:data.available})}
  if(action==="completion-rating-link"){
   const id=String(body.booking_id??"");if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:"Invalid booking."},400);
   const {data:job,error:jError}=await db.from("booking_assignments").select("id,therapist_id,status,reference_code,service_name,customer_name,customer_phone").eq("id",id).maybeSingle();if(jError)throw jError;
   if(!job||job.therapist_id!==therapist.id||job.status!=="completed")return json({error:"Only your completed jobs can create a rating link."},403);
   const token=randomToken();const {error}=await db.rpc("bex_create_rating_link_token",{p_token_hash:await hashToken(token),p_therapist_id:therapist.id,p_created_by:therapist.user_id});if(error)throw error;
   return json({success:true,token,therapist_name:therapist.display_name,customer_name:job.customer_name,customer_phone:job.customer_phone,service_name:job.service_name,reference_code:job.reference_code,rating_url:"https://jitenderkusum8098-creator.github.io/Bodyexpertx/therapist-rating.html?token="+token});
  }
  if(action==="job"){
   const id=String(body.booking_id??""),decision=String(body.decision??"");if(!/^[0-9a-f-]{36}$/i.test(id)||!["accept","reject","complete","cancel"].includes(decision))return json({error:"Invalid job action."},400);
   const {data:job,error:jError}=await db.from("booking_assignments").select("id,therapist_id,zone_id,service_type,tier,status,reference_code,service_name,customer_name,customer_phone,customer_address,booking_amount,partner_id,partner_referral_id").eq("id",id).maybeSingle();if(jError)throw jError;if(!job||job.therapist_id!==therapist.id)return json({error:"This job is not assigned to your account."},403);
   if(decision==="accept"){if(!["awaiting_whatsapp","whatsapp_opened"].includes(job.status))return json({error:"This job is no longer waiting for acceptance."},409);const {error}=await db.from("booking_assignments").update({status:"confirmed",updated_at:new Date().toISOString()}).eq("id",id).eq("therapist_id",therapist.id);if(error)throw error;return json({success:true,message:"Job accepted. Admin record updated."})}
   if(decision==="complete"){
    if(!["confirmed","reached"].includes(job.status))return json({error:"Only an accepted job can be marked complete."},409);
    const completedAt=new Date().toISOString();
    const {data:changed,error}=await db.from("booking_assignments").update({status:"completed",updated_at:completedAt}).eq("id",id).eq("therapist_id",therapist.id).in("status",["confirmed","reached"]).select("id").maybeSingle();
    if(error)throw error;
    if(!changed)return json({error:"Job status abhi badal chuka hai. Refresh karke dobara check karein."},409);
    let referralResult:any={earned:false,reason:"no_partner_referral"};
    try{referralResult=await addReferralCommissionOnCompletion(id,therapist.user_id,completedAt);}catch(e){console.error("Referral commission auto-add failed",id,e);referralResult={earned:false,reason:"commission_error",error:e instanceof Error?e.message:"Commission save nahi hua"};}
    const commissionMessage=referralResult.earned
      ? " Aapka refer safal raha! BEX Partner ki earning mein ₹"+Number(referralResult.amount).toLocaleString("en-IN",{maximumFractionDigits:2})+" turant add ho gaye."+(referralResult.notification_created===false?" Lekin Partner notification save nahi hui; Admin Panel mein check karein.":" Partner ko success notification bhej di gayi.")
      : referralResult.reason==="no_partner_referral" ? " Is booking par Partner referral link nahi mila, isliye referral commission nahi bana."
      : referralResult.reason==="already_earned" ? " Is booking ka referral commission pehle hi add ho chuka hai."
      : referralResult.reason==="no_rule" ? " Job complete ho gayi, lekin is Partner/Service ka commission rule set nahi hai. Admin Panel mein rule set karein."
      : referralResult.reason==="not_eligible" ? " Job complete ho gayi, lekin is referral ka commission rule eligible nahi tha."
      : " Job complete ho gayi. Referral commission auto-add nahi ho saka; Admin Panel mein is booking ko check karein.";
    return json({success:true,message:"Job marked completed. Admin record updated."+commissionMessage,referral_commission:referralResult});
   }
   if(decision==="cancel"&&!["confirmed","reached"].includes(job.status))return json({error:"Only an accepted job can be cancelled."},409);
   if(decision==="reject"&&!["awaiting_whatsapp","whatsapp_opened"].includes(job.status))return json({error:"Only a waiting job can be rejected."},409);
   if(decision==="reject"){
    const candidate=await nextTherapist(job,therapist.id);
    const {error}=await db.from("booking_assignments").update({therapist_id:candidate?.id??null,status:candidate?"awaiting_whatsapp":"awaiting_whatsapp",updated_at:new Date().toISOString()}).eq("id",id).eq("therapist_id",therapist.id);if(error)throw error;
    return json({success:true,message:candidate?"Job rejected. Next eligible therapist has been notified by the live panel queue.":"Job rejected and returned to Admin's unassigned queue; no eligible therapist was available."});
   }
   const {error}=await db.from("booking_assignments").update({therapist_id:null,status:"cancelled",cancelled_at:new Date().toISOString(),cancel_reason:"Cancelled by therapist",updated_at:new Date().toISOString()}).eq("id",id).eq("therapist_id",therapist.id);if(error)throw error;return json({success:true,message:"Job cancelled and recorded for Admin."});
  }
  return json({error:"Unknown action."},400);
 }catch(e){return json({error:e instanceof Error?e.message:"Unexpected server error"},400)}
});