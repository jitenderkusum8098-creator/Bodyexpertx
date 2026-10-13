import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function slugify(value: string) {
  return value.normalize("NFKD").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "Login required" }, 401);

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerData.user) return reply({ error: "Invalid session" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON" }, 400); }
  const action = String(body.action || "");

  if (action === "complete_first_login") {
    const user = callerData.user;
    const { data: partner, error } = await adminClient.from("partners").select("id,force_password_change").eq("user_id", user.id).maybeSingle();
    if (error || !partner) return reply({ error: "Partner account not found" }, 403);
    const { error: updateError } = await adminClient.from("partners").update({ force_password_change: false, updated_at: new Date().toISOString() }).eq("id", partner.id);
    if (updateError) return reply({ error: updateError.message }, 400);
    return reply({ ok: true });
  }

  // First check with the server-side client. If that lookup is unavailable due to service-role/RLS configuration, fall back to the caller-scoped query, which can read its own profile under profile_read_own.
  let profileRole: string | null = null;
  const { data: serverProfile, error: serverProfileError } = await adminClient.from("user_profiles").select("role").eq("user_id", callerData.user.id).maybeSingle();
  if (!serverProfileError) profileRole = serverProfile?.role || null;
  if (profileRole !== "admin") {
    const { data: callerProfile, error: callerProfileError } = await callerClient.from("user_profiles").select("role").eq("user_id", callerData.user.id).maybeSingle();
    if (!callerProfileError && callerProfile?.role === "admin") profileRole = "admin";
  }
  if (profileRole !== "admin" && !(["list_partner_self_data","mark_partner_notifications_read"].includes(action) && profileRole === "partner")) return reply({ error: "Admin access required. Your signed-in account could not be verified as an admin. Sign out and sign in with the authorized Admin account." }, 403);

  if (action === "list_admin_data") {
    const [partners, rules, referrals, commissions] = await Promise.all([
      adminClient.from("partners").select("id,business_name,owner_name,category,partner_code,login_id,phone,status,full_address,photo_url,created_at").order("created_at", { ascending: false }),
      adminClient.from("partner_commission_rules").select("*").order("category").order("service_tier"),
      adminClient.from("partner_referrals").select("id,partner_id,created_at,status"),
      adminClient.from("partner_commissions").select("id,partner_id,commission_amount,status,earned_at")
    ]);
    const error = partners.error || rules.error || referrals.error || commissions.error;
    if (error) return reply({ error: error.message }, 400);
    return reply({ ok: true, partners: partners.data || [], rules: rules.data || [], referrals: referrals.data || [], commissions: commissions.data || [] });
  }

  if (action === "create_partner") {
    const business_name = String(body.business_name || "").trim();
    const owner_name = String(body.owner_name || "").trim();
    const category = String(body.category || "");
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    const full_address = String(body.full_address || "").trim();
    const photo_url = body.photo_url ? String(body.photo_url) : null;
    let login_id = slugify(String(body.login_id || business_name));
    if (!business_name || !owner_name || !phone || phone.length !== 10 || !full_address || !["Salon","Gym","Kirana Store","Medical Store","Other"].includes(category) || login_id.length < 3) {
      return reply({ error: "Please complete all required fields with a valid 10-digit mobile number." }, 400);
    }
    const { data: duplicate } = await adminClient.from("partners").select("id").or(`login_id.eq.${login_id},phone.eq.${phone}`).limit(1);
    if (duplicate?.length) return reply({ error: "This login ID or mobile number is already registered." }, 409);

    const email = `${login_id}@bexpartner.local`;
    const { data: created, error: authError } = await adminClient.auth.admin.createUser({
      email, password: phone, email_confirm: true,
      user_metadata: { role: "partner", partner_login_id: login_id, business_name }
    });
    if (authError || !created.user) return reply({ error: authError?.message || "Could not create login." }, 400);

    const { error: profileError } = await adminClient.from("user_profiles").upsert({ user_id: created.user.id, role: "partner" }, { onConflict: "user_id" });
    if (profileError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return reply({ error: "Could not create partner profile: " + profileError.message }, 400);
    }
    const { data: partner, error: partnerError } = await adminClient.from("partners").insert({
      user_id: created.user.id, login_id, business_name, owner_name, category, phone, full_address, photo_url,
      created_by: callerData.user.id, force_password_change: true, status: "active"
    }).select("id,partner_code,login_id,business_name,owner_name,category,phone,full_address,photo_url,status,created_at").single();
    if (partnerError || !partner) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return reply({ error: "Could not save partner: " + (partnerError?.message || "Unknown error") }, 400);
    }
    return reply({ ok: true, partner, initial_password: phone });
  }

  if (action === "generate_partner_credentials") {
    const partnerId = String(body.partner_id || "");
    if (!partnerId) return reply({ error: "Partner ID is required." }, 400);
    const { data: partner, error: partnerLookupError } = await adminClient
      .from("partners").select("id,user_id,business_name,owner_name,category,phone,status").eq("id", partnerId).maybeSingle();
    if (partnerLookupError || !partner) return reply({ error: partnerLookupError?.message || "Partner not found." }, 404);
    if (partner.status !== "active") return reply({ error: "पहले पार्टनर को Activate करें, फिर credentials बनाएं।" }, 409);

    const categoryPrefix: Record<string, string> = {
      "Salon": "S", "Gym": "G", "Kirana Store": "K", "Medical Store": "M", "Other": "O"
    };
    const ownerInitial = (String(partner.owner_name || "").trim().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").match(/[A-Za-z0-9]/)?.[0] || "X").toUpperCase();
    const categoryInitial = categoryPrefix[String(partner.category)] || "O";
    const phoneDigits = String(partner.phone || "").replace(/\\D/g, "").slice(-10);
    if (phoneDigits.length !== 10) return reply({ error: "पहले पार्टनर का सही 10 अंकों का मोबाइल नंबर सेव करें।" }, 400);
    const lastTwo = phoneDigits.slice(-2);

    // Allocate the next shared serial from existing IDs, across all categories.
    const { data: existing, error: existingError } = await adminClient.from("partners").select("login_id").neq("id", partnerId);
    if (existingError) return reply({ error: "Existing Partner IDs पढ़ नहीं पाए: " + existingError.message }, 400);
    let maxSerial = 0;
    for (const row of existing || []) {
      const match = String(row.login_id || "").match(/^BEX[A-Z]([SGKMO])(\d{2})(\d{2})$/i);
      if (match) maxSerial = Math.max(maxSerial, Number(match[2]));
    }
    // Use the serial in the current credentials if this partner already has one, to avoid wasting a number on regeneration.
    const oldMatch = String(partner.login_id || "").match(/^BEX[A-Z]([SGKMO])(\d{2})(\d{2})$/i);
    let serial = oldMatch ? Number(oldMatch[2]) : maxSerial + 1;
    if (!oldMatch) {
      while (serial <= 9999) {
        const candidate = "BEX" + ownerInitial + categoryInitial + String(serial).padStart(2, "0") + lastTwo;
        const { data: clash, error: clashError } = await adminClient.from("partners").select("id").eq("login_id", candidate).neq("id", partnerId).limit(1);
        if (clashError) return reply({ error: "Unique ID check failed: " + clashError.message }, 400);
        if (!clash?.length) break;
        serial++;
      }
    }
    if (serial > 99) return reply({ error: "Serial number limit reached (99 partners in this ID format)." }, 409);
    const login_id = "BEX" + ownerInitial + categoryInitial + String(serial).padStart(2, "0") + lastTwo;
    const { data: duplicateId, error: duplicateError } = await adminClient.from("partners").select("id").eq("login_id", login_id).neq("id", partnerId).limit(1);
    if (duplicateError) return reply({ error: "Unique ID check failed: " + duplicateError.message }, 400);
    if (duplicateId?.length) return reply({ error: "यह Unique ID पहले से मौजूद है। फिर से Generate करें।" }, 409);

    const ownerFirstThree = String(partner.owner_name || "").trim().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3);
    if (ownerFirstThree.length < 3) return reply({ error: "Password बनाने के लिए मालिक के नाम में कम से कम 3 English अक्षर/अंक होने चाहिए।" }, 400);
    const password = ownerFirstThree[0].toUpperCase() + ownerFirstThree.slice(1).toLowerCase() + phoneDigits.slice(-4);
    const email = login_id.toLowerCase() + "@bexpartner.local";
    let userId = partner.user_id as string | null;
    let createdNewUser = false;
    let oldEmail: string | null = null;
    if (userId) {
      const { data: existingUser, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
      if (getUserError || !existingUser.user) return reply({ error: "Partner का login account नहीं मिला। कृपया Admin support से संपर्क करें।" }, 400);
      oldEmail = existingUser.user.email || null;
      const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(userId, { email, email_confirm: true, password, user_metadata: { ...(existingUser.user.user_metadata || {}), role: "partner", partner_login_id: login_id, business_name: partner.business_name } });
      if (updateAuthError) return reply({ error: "Login credentials update नहीं हुए: " + updateAuthError.message }, 400);
    } else {
      const { data: created, error: createAuthError } = await adminClient.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { role: "partner", partner_login_id: login_id, business_name: partner.business_name }
      });
      if (createAuthError || !created.user) return reply({ error: "Login account create नहीं हुआ: " + (createAuthError?.message || "Unknown error") }, 400);
      userId = created.user.id;
      createdNewUser = true;
    }
    const { error: profileError } = await adminClient.from("user_profiles").upsert({ user_id: userId, role: "partner" }, { onConflict: "user_id" });
    if (profileError) {
      if (createdNewUser && userId) await adminClient.auth.admin.deleteUser(userId);
      else if (userId && oldEmail) await adminClient.auth.admin.updateUserById(userId, { email: oldEmail, email_confirm: true });
      return reply({ error: "Partner profile role save नहीं हुआ: " + profileError.message }, 400);
    }
    const { error: saveError } = await adminClient.from("partners").update({
      user_id: userId, login_id, force_password_change: true, updated_at: new Date().toISOString()
    }).eq("id", partnerId);
    if (saveError) {
      if (createdNewUser && userId) await adminClient.auth.admin.deleteUser(userId);
      else if (userId && oldEmail) await adminClient.auth.admin.updateUserById(userId, { email: oldEmail, email_confirm: true });
      return reply({ error: "Credentials partner record में save नहीं हुए: " + saveError.message }, 400);
    }
    return reply({ ok: true, login_id, password, partner_id: partnerId, force_password_change: true, message: "Unique Partner ID और temporary password बन गए। पहली login पर नया password सेट करना होगा।" });
  }

  if (action === "update_partner") {
    const partnerId = String(body.partner_id || "");
    const business_name = String(body.business_name || "").trim();
    const owner_name = String(body.owner_name || "").trim();
    const category = String(body.category || "");
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    const full_address = String(body.full_address || "").trim();
    if (!partnerId || !business_name || !owner_name || phone.length !== 10 || !full_address || !["Salon","Gym","Kirana Store","Medical Store","Other"].includes(category)) {
      return reply({ error: "कृपया व्यवसाय, मालिक, सही 10 अंकों का मोबाइल, श्रेणी और पूरा पता भरें।" }, 400);
    }
    const { error } = await adminClient.from("partners").update({ business_name, owner_name, category, phone, full_address, updated_at: new Date().toISOString() }).eq("id", partnerId);
    if (error) return reply({ error: error.message }, 400);
    return reply({ ok: true });
  }

  if (action === "delete_partner") {
    const partnerId = String(body.partner_id || "");
    if (!partnerId) return reply({ error: "Partner ID is required." }, 400);
    const { data: partner, error: partnerLookupError } = await adminClient
      .from("partners").select("id,user_id,business_name").eq("id", partnerId).maybeSingle();
    if (partnerLookupError || !partner) return reply({ error: partnerLookupError?.message || "Partner not found." }, 404);

    const [referrals, commissions] = await Promise.all([
      adminClient.from("partner_referrals").select("id").eq("partner_id", partnerId).limit(1),
      adminClient.from("partner_commissions").select("id").eq("partner_id", partnerId).limit(1)
    ]);
    if (referrals.error || commissions.error) {
      return reply({ error: referrals.error?.message || commissions.error?.message || "Could not check partner history." }, 400);
    }
    if ((referrals.data || []).length || (commissions.data || []).length) {
      return reply({ error: "इस पार्टनर के referral/commission रिकॉर्ड मौजूद हैं। हिसाब सुरक्षित रखने के लिए इसे Delete नहीं किया जा सकता; इसके बजाय Suspend करें।" }, 409);
    }

    const { error: deleteRuleError } = await adminClient.from("partner_commission_rules").delete().eq("partner_id", partnerId);
    if (deleteRuleError) return reply({ error: deleteRuleError.message }, 400);
    const { error: deletePartnerError } = await adminClient.from("partners").delete().eq("id", partnerId);
    if (deletePartnerError) return reply({ error: deletePartnerError.message }, 400);
    if (partner.user_id) {
      await adminClient.from("user_profiles").delete().eq("user_id", partner.user_id);
      const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(partner.user_id);
      if (deleteUserError) return reply({ ok: true, warning: "Partner record deleted, but login cleanup needs attention: " + deleteUserError.message });
    }
    return reply({ ok: true });
  }

  if (action === "set_partner_status") {
    const partnerId = String(body.partner_id || "");
    const status = String(body.status || "");
    if (!partnerId || !["active","suspended"].includes(status)) return reply({ error: "Invalid status" }, 400);
    const { error } = await adminClient.from("partners").update({ status, updated_at: new Date().toISOString() }).eq("id", partnerId);
    if (error) return reply({ error: error.message }, 400);
    return reply({ ok: true });
  }

  if (action === "verify_booking_payment") {
    const bookingId = String(body.booking_id || "");
    if (!bookingId) return reply({ error: "Booking ID is required." }, 400);
    const { data: booking, error: bookingError } = await adminClient.from("booking_assignments")
      .select("id,reference_code,status,partner_id,partner_referral_id,payment_verified,booking_amount,service_type,tier,service_name,customer_name,customer_phone,customer_address,appointment_date,appointment_time")
      .eq("id", bookingId).maybeSingle();
    if (bookingError || !booking) return reply({ error: bookingError?.message || "Booking not found." }, 404);
    if (booking.status !== "completed") return reply({ error: "केवल पूरी हुई Job का Payment Verify किया जा सकता है।" }, 409);
    if (!booking.partner_id) return reply({ error: "इस Booking से Partner ID जुड़ी नहीं है। QR/Referral attribution जाँचें।" }, 409);
    if (booking.payment_verified) {
      const { data: prior } = await adminClient.from("partner_commissions").select("id").eq("booking_id", bookingId).limit(1);
      return reply({ ok: true, already_verified: true, commission_exists: !!prior?.length });
    }
    const { data: partner, error: partnerError } = await adminClient.from("partners").select("id,business_name,category,user_id").eq("id", booking.partner_id).maybeSingle();
    if (partnerError || !partner) return reply({ error: "Referral Partner नहीं मिला।" }, 404);
    let referral: any = null;
    if (booking.partner_referral_id) {
      const { data } = await adminClient.from("partner_referrals").select("id,created_at").eq("id", booking.partner_referral_id).maybeSingle();
      referral = data;
    } else {
      const phoneNormalized = String(booking.customer_phone || "").replace(/\\D/g, "").slice(-10);
      if (!booking.customer_name || phoneNormalized.length !== 10) return reply({ error: "इस QR Booking में Partner जुड़ा है, लेकिन ग्राहक का नाम/मोबाइल पूरा नहीं है। पहले Booking Details ठीक करें।" }, 409);
      const { data: existingReferral } = await adminClient.from("partner_referrals").select("id,created_at")
        .eq("partner_id", partner.id).eq("phone_normalized", phoneNormalized).maybeSingle();
      if (existingReferral) referral = existingReferral;
      else {
        const { data: createdReferral, error: referralCreateError } = await adminClient.from("partner_referrals").insert({
          partner_id: partner.id, customer_name: String(booking.customer_name).trim(),
          customer_phone: String(booking.customer_phone).trim(), phone_normalized: phoneNormalized,
          consent_confirmed: false, status: "active", created_by: callerData.user.id,
          notes: "QR/Referral booking se auto-linked"
        }).select("id,created_at").single();
        if (referralCreateError || !createdReferral) return reply({ error: "Referral Record नहीं बन पाया: " + (referralCreateError?.message || "Unknown error") }, 400);
        referral = createdReferral;
      }
      const { error: attachError } = await adminClient.from("booking_assignments").update({ partner_referral_id: referral.id }).eq("id", bookingId);
      if (attachError) return reply({ error: "Referral record बना, लेकिन Booking से attach नहीं हुआ: " + attachError.message }, 400);
      booking.partner_referral_id = referral.id;
    }
    const { data: duplicate, error: duplicateError } = await adminClient.from("partner_commissions").select("id,commission_amount,status").eq("booking_id", bookingId).limit(1);
    if (duplicateError) return reply({ error: "मौजूदा Commission रिकॉर्ड पढ़ नहीं पाए: " + duplicateError.message }, 400);
    if (duplicate?.length) {
      const { error: verifyExistingError } = await adminClient.from("booking_assignments").update({
        payment_verified: true, payment_verified_at: new Date().toISOString(), payment_verified_by: callerData.user.id
      }).eq("id", bookingId).eq("payment_verified", false);
      if (verifyExistingError) return reply({ error: "Commission पहले से जुड़ा है, लेकिन Payment Verification सेव नहीं हुई: " + verifyExistingError.message }, 400);
      return reply({ ok: true, already_earned: true, commission_exists: true, commission_amount: Number(duplicate[0].commission_amount || 0), message: "Referral Commission पहले ही Job Complete होने पर जुड़ चुका है। Payment Verification सेव हो गई; दोबारा Commission नहीं जोड़ा गया।" });
    }

    let ruleQuery = adminClient.from("partner_commission_rules").select("id,partner_id,commission_type,amount,rule_mode,validity_months,created_at")
      .eq("category", partner.category).eq("service_tier", booking.tier).eq("active", true);
    const { data: rules, error: ruleError } = await ruleQuery;
    if (ruleError) return reply({ error: "Commission Rule पढ़ नहीं पाए: " + ruleError.message }, 400);
    const rule = (rules || []).find((r:any)=>r.partner_id===partner.id) || (rules || []).find((r:any)=>!r.partner_id);
    if (!rule) return reply({ error: "इस Partner और Service के लिए Commission Rule सेट नहीं है।" }, 409);
    const { data: priorCommissions, error: priorError } = await adminClient.from("partner_commissions")
      .select("id,earned_at").eq("partner_id", partner.id).eq("referral_id", booking.partner_referral_id).neq("status","void");
    if (priorError) return reply({ error: "पुराने Commission Records पढ़ नहीं पाए: " + priorError.message }, 400);
    if (rule.rule_mode === "first" && (priorCommissions || []).length) return reply({ error: "इस Referral पर First Booking Commission पहले ही बन चुका है।" }, 409);
    if (rule.rule_mode === "period") {
      const months = Math.max(1, Number(rule.validity_months || 1));
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-months);
      if (referral?.created_at && new Date(referral.created_at) < cutoff) return reply({ error: "इस Referral की Commission अवधि समाप्त हो गई है।" }, 409);
    }
    const bookingAmount = Number(booking.booking_amount || 0);
    if (rule.commission_type === "percent" && (!Number.isFinite(bookingAmount) || bookingAmount <= 0)) {
      return reply({ error: "Percentage Commission जोड़ने के लिए Booking की सही राशि जरूरी है। पहले Booking Amount ठीक करें।" }, 409);
    }
    const rateValue = Number(rule.amount);
    if (!Number.isFinite(rateValue) || rateValue <= 0 || (rule.commission_type === "percent" && rateValue > 100)) {
      return reply({ error: "Commission Rule की राशि/प्रतिशत गलत है। Admin Panel में Rule ठीक करें।" }, 409);
    }
    const amount = rule.commission_type === "percent"
      ? Math.round(bookingAmount * rateValue) / 100
      : Math.round(rateValue * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return reply({ error: "Commission राशि शून्य या गलत है।" }, 409);

    const { error: verifyError } = await adminClient.from("booking_assignments").update({
      payment_verified: true, payment_verified_at: new Date().toISOString(), payment_verified_by: callerData.user.id
    }).eq("id", bookingId).eq("payment_verified", false);
    if (verifyError) return reply({ error: verifyError.message }, 400);
    const { data: commission, error: commissionError } = await adminClient.from("partner_commissions").insert({
      partner_id: partner.id, referral_id: booking.partner_referral_id, booking_id: booking.id,
      service_tier: booking.tier, booking_amount: Number(booking.booking_amount || 0),
      commission_type: rule.commission_type, rate_value: Number(rule.amount),
      commission_amount: amount, status: "earned", earned_at: new Date().toISOString()
    }).select("id,commission_amount").single();
    if (commissionError) {
      await adminClient.from("booking_assignments").update({payment_verified:false,payment_verified_at:null,payment_verified_by:null}).eq("id",bookingId);
      return reply({ error: "Payment verify hua, lekin Commission save nahi hua: " + commissionError.message }, 400);
    }
    await adminClient.from("partner_referrals").update({
      latest_booking_status: "completed", latest_service_tier: booking.tier, last_booking_at: new Date().toISOString()
    }).eq("id", booking.partner_referral_id);
    const { error: noticeError } = await adminClient.from("partner_notifications").insert({
      partner_id: partner.id, notification_type: "commission_earned",
      title: "बधाई हो! आपकी कमाई जुड़ गई",
      message: "आपके Referral से Booking " + (booking.reference_code || booking.id) + " पूरी हुई। आपकी कमाई ₹" + amount.toLocaleString("en-IN") + " आपकी Earnings में जोड़ दी गई है।",
      booking_id: booking.id, commission_id: commission.id
    });
    return reply({ ok: true, commission: {id:commission.id,amount}, notification_created: !noticeError, notification_warning: noticeError?.message || null });
  }

  if (action === "create_partner_payment") {
    const partnerId = String(body.partner_id || "");
    const amount = Number(body.amount);
    const transactionId = String(body.transaction_id || "").trim();
    const paymentMethod = String(body.payment_method || "UPI");
    const screenshotPath = body.screenshot_path ? String(body.screenshot_path) : null;
    const paymentDate = body.payment_date ? new Date(String(body.payment_date)).toISOString() : new Date().toISOString();
    const allocations = Array.isArray(body.allocations) ? body.allocations : [];
    if (!partnerId || !Number.isFinite(amount) || amount <= 0 || !transactionId) return reply({error:"Partner, सही Payment राशि और Transaction ID जरूरी हैं।"},400);
    if (!["UPI","Bank Transfer","Cash","Other"].includes(paymentMethod)) return reply({error:"Payment method सही नहीं है।"},400);
    const {data:partner,error:partnerError}=await adminClient.from("partners").select("id,business_name,user_id").eq("id",partnerId).maybeSingle();
    if(partnerError||!partner)return reply({error:"Partner नहीं मिला।"},404);
    const {data:payment,error:paymentError}=await adminClient.from("partner_payments").insert({
      partner_id:partnerId,amount,payment_date:paymentDate,payment_method:paymentMethod,
      transaction_id:transactionId,screenshot_path:screenshotPath,notes:body.notes?String(body.notes):null,
      status:"paid",created_by:callerData.user.id
    }).select("id,partner_id,amount,payment_date,payment_method,transaction_id,screenshot_path,status").single();
    if(paymentError)return reply({error:"Payment History सेव नहीं हुई: "+paymentError.message},400);
    for (const a of allocations) {
      const commissionId=String(a.commission_id||""); const allocAmount=Number(a.amount);
      if(!commissionId||!Number.isFinite(allocAmount)||allocAmount<=0) return reply({error:"Payment Allocation गलत है। Payment record बना है; कृपया Admin से verify करें।",payment_id:payment.id},400);
      const {data:commission,error:commissionLookupError}=await adminClient.from("partner_commissions").select("id,partner_id,commission_amount,status").eq("id",commissionId).eq("partner_id",partnerId).maybeSingle();
      if(commissionLookupError||!commission)return reply({error:"Commission record नहीं मिला। Payment record बना है; Admin जाँच करें।",payment_id:payment.id},400);
      const {data:used}=await adminClient.from("partner_payment_allocations").select("amount").eq("commission_id",commissionId);
      const already=(used||[]).reduce((sum:number,x:any)=>sum+Number(x.amount||0),0);
      if(allocAmount+already>Number(commission.commission_amount)+0.001)return reply({error:"Allocation उस Commission की बाकी राशि से अधिक है। Payment record बना है; Admin जाँच करें।",payment_id:payment.id},400);
      const {error:allocationError}=await adminClient.from("partner_payment_allocations").insert({payment_id:payment.id,commission_id:commissionId,amount:allocAmount});
      if(allocationError)return reply({error:"Payment बना, पर allocation सेव नहीं हुआ: "+allocationError.message,payment_id:payment.id},400);
      const {data:allAlloc}=await adminClient.from("partner_payment_allocations").select("amount").eq("commission_id",commissionId);
      const totalAllocated=(allAlloc||[]).reduce((sum:number,x:any)=>sum+Number(x.amount||0),0);
      if(totalAllocated+0.001>=Number(commission.commission_amount)) await adminClient.from("partner_commissions").update({status:"paid",paid_at:paymentDate,payment_reference:transactionId,paid_by:callerData.user.id}).eq("id",commissionId).eq("status","earned");
    }
    const {error:noticeError}=await adminClient.from("partner_notifications").insert({
      partner_id:partnerId,notification_type:"payment_recorded",title:"आपकी Payment दर्ज हो गई",
      message:"₹"+amount.toLocaleString("en-IN")+" की Payment दर्ज की गई है। Payment ID: "+transactionId,
      payment_id:payment.id
    });
    return reply({ok:true,payment,notification_created:!noticeError});
  }

  if (action === "list_partner_admin_detail") {
    const partnerId=String(body.partner_id||"");
    if(!partnerId)return reply({error:"Partner ID जरूरी है।"},400);
    const {data:partner,error:partnerError}=await adminClient.from("partners").select("*").eq("id",partnerId).maybeSingle();
    if(partnerError||!partner)return reply({error:"Partner नहीं मिला।"},404);
    const [referrals,commissions,payments,allocations,bookings,notifications]=await Promise.all([
      adminClient.from("partner_referrals").select("*").eq("partner_id",partnerId).order("created_at",{ascending:false}),
      adminClient.from("partner_commissions").select("*").eq("partner_id",partnerId).order("created_at",{ascending:false}),
      adminClient.from("partner_payments").select("*").eq("partner_id",partnerId).order("payment_date",{ascending:false}),
      adminClient.from("partner_payment_allocations").select("*,partner_commissions(booking_id,commission_amount,service_tier)").order("created_at",{ascending:false}),
      adminClient.from("booking_assignments").select("*").eq("partner_id",partnerId).order("created_at",{ascending:false}),
      adminClient.from("partner_notifications").select("*").eq("partner_id",partnerId).order("created_at",{ascending:false})
    ]);
    const err=referrals.error||commissions.error||payments.error||allocations.error||bookings.error||notifications.error;
    if(err)return reply({error:err.message},400);
    return reply({ok:true,partner,referrals:referrals.data||[],commissions:commissions.data||[],payments:payments.data||[],allocations:allocations.data||[],bookings:bookings.data||[],notifications:notifications.data||[]});
  }

  if (action === "mark_partner_notifications_read") {
    const {data:partner,error:partnerError}=await adminClient.from("partners").select("id").eq("user_id",callerData.user.id).maybeSingle();
    if(partnerError||!partner)return reply({error:"Partner account नहीं मिला।"},404);
    const {error:updateError}=await adminClient.from("partner_notifications").update({read_at:new Date().toISOString()}).eq("partner_id",partner.id).is("read_at",null);
    if(updateError)return reply({error:updateError.message},400);
    return reply({ok:true});
  }

  if (action === "list_partner_self_data") {
    const {data:partner,error}=await adminClient.from("partners").select("id,business_name,category,partner_code,login_id,photo_url,status").eq("user_id",callerData.user.id).maybeSingle();
    if(error||!partner)return reply({error:"Partner account नहीं मिला।"},404);
    const [referrals,commissions,payments,notifications]=await Promise.all([
      adminClient.from("partner_referrals").select("id,customer_name,status,created_at,latest_booking_status,latest_service_tier,last_booking_at").eq("partner_id",partner.id).order("created_at",{ascending:false}),
      adminClient.from("partner_commissions").select("id,referral_id,booking_id,service_tier,commission_amount,status,earned_at,paid_at,payment_reference,created_at").eq("partner_id",partner.id).order("created_at",{ascending:false}),
      adminClient.from("partner_payments").select("id,amount,payment_date,payment_method,transaction_id,screenshot_path,status").eq("partner_id",partner.id).order("payment_date",{ascending:false}),
      adminClient.from("partner_notifications").select("id,notification_type,title,message,read_at,created_at").eq("partner_id",partner.id).order("created_at",{ascending:false})
    ]);
    const err=referrals.error||commissions.error||payments.error||notifications.error;
    if(err)return reply({error:err.message},400);
    const bookingIds=(commissions.data||[]).map((c:any)=>c.booking_id).filter(Boolean);
    let bookingNames:Record<string,string>={};
    if(bookingIds.length){
      const {data:names}=await adminClient.from("booking_assignments").select("id,customer_name").in("id",bookingIds);
      for(const b of names||[])bookingNames[b.id]=b.customer_name||"ग्राहक";
    }
    return reply({ok:true,partner,referrals:referrals.data||[],commissions:(commissions.data||[]).map((c:any)=>({...c,customer_name:bookingNames[c.booking_id]||"ग्राहक"})),payments:payments.data||[],notifications:notifications.data||[]});
  }

  if (action === "save_commission_rule") {
    const category = String(body.category || "");
    const service_tier = String(body.service_tier || "");
    const partner_id = body.partner_id ? String(body.partner_id) : null;
    const commission_type = String(body.commission_type || "fixed");
    const amount = Number(body.amount);
    const rule_mode = String(body.rule_mode || "every");
    const validity_months = rule_mode === "period" ? Number(body.validity_months) : null;
    if (!["Salon","Gym","Kirana Store","Medical Store","Other"].includes(category) || !["Prime","Luxe","Other"].includes(service_tier) || !["fixed","percent"].includes(commission_type) || !Number.isFinite(amount) || amount <= 0 || (commission_type === "percent" && amount > 100) || !["first","every","period"].includes(rule_mode) || (rule_mode === "period" && (!Number.isInteger(validity_months) || validity_months < 1 || validity_months > 60))) {
      return reply({ error: "Invalid commission rule values." }, 400);
    }
    let lookup = adminClient.from("partner_commission_rules").select("id").eq("service_tier", service_tier);
    if (partner_id) lookup = lookup.eq("partner_id", partner_id);
    else lookup = lookup.is("partner_id", null).eq("category", category);
    const { data: existingRule, error: lookupError } = await lookup.maybeSingle();
    if (lookupError) return reply({ error: lookupError.message }, 400);
    const ruleValues = { category, service_tier, partner_id, commission_type, amount, rule_mode, validity_months,
      active: true, created_by: callerData.user.id, updated_at: new Date().toISOString() };
    const saved = existingRule
      ? await adminClient.from("partner_commission_rules").update(ruleValues).eq("id", existingRule.id).select().single()
      : await adminClient.from("partner_commission_rules").insert(ruleValues).select().single();
    if (saved.error) return reply({ error: saved.error.message }, 400);
    return reply({ ok: true, rule: saved.data });
  }

  return reply({ error: "Unknown action" }, 400);
});
