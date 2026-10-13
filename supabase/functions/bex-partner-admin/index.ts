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

  const { data: profile } = await adminClient.from("user_profiles").select("role").eq("user_id", callerData.user.id).maybeSingle();
  if (profile?.role !== "admin") return reply({ error: "Admin access required" }, 403);

  if (action === "create_partner") {
    const business_name = String(body.business_name || "").trim();
    const owner_name = String(body.owner_name || "").trim();
    const category = String(body.category || "");
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    const full_address = String(body.full_address || "").trim();
    const photo_url = body.photo_url ? String(body.photo_url) : null;
    let login_id = slugify(String(body.login_id || business_name));
    if (!business_name || !owner_name || !phone || phone.length !== 10 || !full_address || !["Salon","Gym","Medical Store","Other"].includes(category) || login_id.length < 3) {
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

  if (action === "set_partner_status") {
    const partnerId = String(body.partner_id || "");
    const status = String(body.status || "");
    if (!partnerId || !["active","suspended"].includes(status)) return reply({ error: "Invalid status" }, 400);
    const { error } = await adminClient.from("partners").update({ status, updated_at: new Date().toISOString() }).eq("id", partnerId);
    if (error) return reply({ error: error.message }, 400);
    return reply({ ok: true });
  }

  if (action === "mark_commission_paid") {
    const commissionId = String(body.commission_id || "");
    const payment_reference = String(body.payment_reference || "").trim();
    if (!commissionId || !payment_reference) return reply({ error: "Commission and payment reference are required." }, 400);
    const { error } = await adminClient.from("partner_commissions").update({
      status: "paid", paid_at: new Date().toISOString(), payment_reference, paid_by: callerData.user.id
    }).eq("id", commissionId).eq("status", "earned");
    if (error) return reply({ error: error.message }, 400);
    return reply({ ok: true });
  }

  if (action === "save_commission_rule") {
    const category = String(body.category || "");
    const service_tier = String(body.service_tier || "");
    const partner_id = body.partner_id ? String(body.partner_id) : null;
    const commission_type = String(body.commission_type || "fixed");
    const amount = Number(body.amount);
    const rule_mode = String(body.rule_mode || "every");
    const validity_months = rule_mode === "period" ? Number(body.validity_months) : null;
    if (!["Salon","Gym","Medical Store","Other"].includes(category) || !["Prime","Luxe","Other"].includes(service_tier) || !["fixed","percent"].includes(commission_type) || !Number.isFinite(amount) || amount < 0 || !["first","every","period"].includes(rule_mode) || (rule_mode === "period" && (!Number.isInteger(validity_months) || validity_months < 1 || validity_months > 60))) {
      return reply({ error: "Invalid commission rule values." }, 400);
    }
    const { data, error } = await adminClient.from("partner_commission_rules").upsert({
      category, service_tier, partner_id, commission_type, amount, rule_mode, validity_months,
      active: true, created_by: callerData.user.id, updated_at: new Date().toISOString()
    }, { onConflict: partner_id ? "partner_id,service_tier" : "category,service_tier" }).select().single();
    if (error) return reply({ error: error.message }, 400);
    return reply({ ok: true, rule: data });
  }

  return reply({ error: "Unknown action" }, 400);
});
