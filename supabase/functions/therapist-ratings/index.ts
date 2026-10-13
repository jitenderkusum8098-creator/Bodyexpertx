import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function validCoordinate(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function coordsFromAddress(address: string | null) {
  if (!address) return { lat: null as number | null, lng: null as number | null };
  const m = address.match(/GPS:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  return m ? { lat: validCoordinate(m[1], -90, 90), lng: validCoordinate(m[2], -180, 180) } : { lat: null, lng: null };
}
function landmarkFromAddress(address: string | null) {
  return address?.match(/Landmark:\s*([^·\n]+)/i)?.[1]?.trim().slice(0, 200) || null;
}
async function requireRole(req: Request, roles: string[] = ["admin"]) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || !anonKey) throw new Error("Sign in is required.");
  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) throw new Error("Your session is invalid. Please sign in again.");
  // Read the caller's role using both the service-role client and the caller-scoped client.
  // The second lookup supports projects where service-role table access is restricted by configuration.
  let role: string | null = null;
  const { data: profile, error: profileError } = await admin.from("user_profiles").select("role").eq("user_id", user.id).maybeSingle();
  if (!profileError && profile?.role) role = String(profile.role).trim().toLowerCase();
  if (!role) {
    const { data: ownProfile, error: ownProfileError } = await authClient.from("user_profiles").select("role").eq("user_id", user.id).maybeSingle();
    if (!ownProfileError && ownProfile?.role) role = String(ownProfile.role).trim().toLowerCase();
  }
  if (!role || !roles.map((r) => r.toLowerCase()).includes(role)) {
    console.error("Role authorization failed", { userId: user.id, role, adminLookupError: profileError?.message });
    throw new Error("Admin permission check failed. Please sign out and sign in again; if it continues, contact support.");
  }
  return user;
}
async function findAuthUserByEmail(email: string) {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json();
    const action = String(body.action ?? "");
    if (action === "public-create-booking-request") {
      const customer_name = String(body.customer_name ?? "").trim().replace(/\\s+/g, " ").slice(0, 100);
      const customer_phone = String(body.customer_phone ?? "").replace(/[^+0-9]/g, "").slice(0, 16);
      const customer_age = body.customer_age === null || body.customer_age === undefined || body.customer_age === "" ? null : Number(body.customer_age);
      const recipient_gender = String(body.recipient_gender ?? "").slice(0, 30) || null;
      const visit_type = String(body.visit_type ?? "").slice(0, 40) || null;
      const customer_address = String(body.customer_address ?? "").trim().slice(0, 800) || null;
      const parsedCoords = coordsFromAddress(customer_address);
      const customer_latitude = validCoordinate(body.customer_latitude, -90, 90) ?? parsedCoords.lat;
      const customer_longitude = validCoordinate(body.customer_longitude, -180, 180) ?? parsedCoords.lng;
      const customer_landmark = String(body.customer_landmark ?? landmarkFromAddress(customer_address) ?? "").trim().slice(0, 200) || null;
      const customer_gps_accuracy_meters = body.customer_gps_accuracy_meters === null || body.customer_gps_accuracy_meters === undefined || body.customer_gps_accuracy_meters === "" ? null : Math.max(0, Math.min(100000, Math.round(Number(body.customer_gps_accuracy_meters) || 0)));
      const appointment_date = String(body.appointment_date ?? "").slice(0, 10) || null;
      const appointment_time = String(body.appointment_time ?? "").slice(0, 30) || null;
      const service_type = String(body.service_type ?? "");
      const tier = String(body.tier ?? "");
      const service_name = String(body.service_name ?? "").trim().slice(0, 500);
      const booking_amount = Number(body.booking_amount);
      const discount_amount = Number(body.discount_amount ?? 0);
      const coupon_code = String(body.coupon_code ?? "").trim().slice(0, 40) || null;
      const customer_notes = String(body.customer_notes ?? "").trim().slice(0, 1000) || null;
      const customer_type = String(body.customer_type ?? "").slice(0, 50) || null;
      const preferred_pressure = String(body.preferred_pressure ?? "").slice(0, 80) || null;
      const main_concern = String(body.main_concern ?? "").slice(0, 120) || null;
      const service_details = Array.isArray(body.service_details) ? body.service_details.slice(0, 30).map((item: any) => ({
        name: String(item?.name ?? "").slice(0, 150),
        duration: Math.max(0, Math.min(600, Number(item?.duration ?? 0) || 0)),
        price: Math.max(0, Math.min(10000000, Number(item?.price ?? 0) || 0)),
        category: String(item?.category ?? "").slice(0, 80),
        type: String(item?.type ?? "").slice(0, 30)
      })) : [];
      if (customer_name.length < 2 || customer_phone.replace(/\\D/g, "").length < 10) return json({ error: "Valid customer name and mobile number are required." }, 400);
      if (customer_age !== null && (!Number.isInteger(customer_age) || customer_age < 18 || customer_age > 120)) return json({ error: "Customer age must be between 18 and 120." }, 400);
      if (![ "Massage", "Salon" ].includes(service_type) || ![ "Prime", "Luxe" ].includes(tier) || !service_name) return json({ error: "Choose a valid service and category." }, 400);
      if (!Number.isFinite(booking_amount) || booking_amount < 0 || booking_amount > 10000000 || !Number.isFinite(discount_amount) || discount_amount < 0 || discount_amount > booking_amount) return json({ error: "Booking amount or discount is invalid." }, 400);
      if (appointment_date && !/^\\d{4}-\\d{2}-\\d{2}$/.test(appointment_date)) return json({ error: "Appointment date is invalid." }, 400);
      const reference_code = "BEX-BOOK-" + Date.now().toString(36).toUpperCase() + "-" + randomToken().slice(0, 4).toUpperCase();
      const { data, error } = await admin.from("booking_assignments").insert({
        reference_code, zone_id: null, therapist_id: null, service_type, tier, service_name,
        appointment_date, appointment_time, status: "awaiting_whatsapp", booking_amount,
        customer_name, customer_phone, customer_age, recipient_gender, visit_type, customer_address,
        customer_latitude, customer_longitude, customer_landmark, customer_gps_accuracy_meters,
        service_details, discount_amount, coupon_code, customer_notes, customer_type, preferred_pressure, main_concern, source: "website_whatsapp_form"
      }).select("id,reference_code").single();
      if (error) throw error;
      return json({ booking_id: data.id, reference_code: data.reference_code, message: "Booking request recorded; WhatsApp confirmation is still required." });
    }
    if (action === "public-zones") {
      const { data, error } = await admin.from("zones").select("id,name,description,boundary_geojson,center_lat,center_lng").eq("active", true).order("name");
      if (error) throw error;
      return json({ zones: data ?? [] });
    }
    if (action === "public-assign-therapist") {
      const zone_id = String(body.zone_id ?? "");
      const service_type = String(body.service_type ?? "");
      const tier = String(body.tier ?? "");
      const recipient_gender = String(body.recipient_gender ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(zone_id) || !["Massage", "Salon"].includes(service_type) || !["Prime", "Luxe"].includes(tier) || !["Male","Female"].includes(recipient_gender)) {
        return json({ error: "Please choose a valid zone, service, and category." }, 400);
      }
      const { data: zone, error: zError } = await admin.from("zones").select("id,name").eq("id", zone_id).eq("active", true).maybeSingle();
      if (zError) throw zError;
      if (!zone) return json({ error: "This service zone is not available. Please choose another zone." }, 404);
      const { data: links, error: linkError } = await admin.from("therapist_zones").select("therapist_id").eq("zone_id", zone_id);
      if (linkError) throw linkError;
      const ids = (links ?? []).map((x: { therapist_id: string }) => x.therapist_id);
      if (!ids.length) return json({ error: "अभी इस zone में therapist assign नहीं है। कृपया Admin से संपर्क करें।" }, 404);
      const { data: candidates, error: cError } = await admin.from("therapists").select("id,display_name,therapist_code,photo_url,experience_years,service_types,tiers,created_at,approval_status,gender,age").in("id", ids).eq("active", true).eq("available", true).eq("approval_status", "approved");
      if (cError) throw cError;
      const eligible = (candidates ?? []).filter((t: { service_types?: string[]; tiers?: string[]; experience_years?: number; gender?: string | null }) =>
        t.gender === recipient_gender && (t.service_types ?? []).includes(service_type) && (t.tiers ?? []).includes(tier) &&
        (tier !== "Luxe" || Number(t.experience_years ?? 0) >= 2) &&
        (tier !== "Prime" || Number(t.experience_years ?? 0) >= 0.5)
      );
      if (!eligible.length) return json({ error: "इस zone में "+recipient_gender+" customer के लिए matching gender का available therapist नहीं है। Admin को सही gender वाले therapist की availability और zone assignment check करनी होगी। दूसरे gender का therapist assign नहीं किया जाएगा।" }, 404);
      const therapistIds = eligible.map((t: { id: string }) => t.id);
      const [{ data: ratings, error: rError }, { data: jobs, error: jError }] = await Promise.all([
        admin.from("therapist_ratings").select("therapist_id,rating,review,created_at").in("therapist_id", therapistIds).eq("status", "published").order("created_at", { ascending: false }),
        admin.from("booking_assignments").select("therapist_id,status").in("therapist_id", therapistIds).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).in("status", ["awaiting_whatsapp","whatsapp_opened","confirmed"])
      ]);
      if (rError) throw rError;
      if (jError) throw jError;
      const scored = eligible.map((t: { id: string; experience_years?: number; created_at?: string }) => {
        const own = (ratings ?? []).filter((r: { therapist_id: string }) => r.therapist_id === t.id);
        const avg = own.length ? own.reduce((sum: number, r: { rating: number }) => sum + Number(r.rating), 0) / own.length : 0;
        const load = (jobs ?? []).filter((j: { therapist_id: string }) => j.therapist_id === t.id).length;
        return { t, own, avg, load };
      }).sort((a, b) => a.load - b.load || b.avg - a.avg || Number(b.t.experience_years ?? 0) - Number(a.t.experience_years ?? 0) || String(a.t.created_at).localeCompare(String(b.t.created_at)));
      const chosen = scored[0];
      return json({ zone: { id: zone.id, name: zone.name }, therapist: {
        id: chosen.t.id, display_name: chosen.t.display_name, therapist_code: chosen.t.therapist_code,
        photo_url: chosen.t.photo_url, age: chosen.t.age ?? null, gender: chosen.t.gender ?? null,
        service_types: chosen.t.service_types ?? [], tiers: chosen.t.tiers ?? [],
        experience_years: Number(chosen.t.experience_years ?? 0),
        average_rating: chosen.own.length ? Math.round(chosen.avg * 10) / 10 : null,
        rating_count: chosen.own.length,
        reviews: chosen.own.filter((r: { review?: string | null }) => !!r.review).slice(0, 3).map((r: { rating: number; review: string; created_at: string }) => ({ rating: r.rating, review: r.review, created_at: r.created_at }))
      }});
    }
    if (action === "public-confirm-assignment") {
      const zone_id = String(body.zone_id ?? "");
      const therapist_id = String(body.therapist_id ?? "");
      const service_type = String(body.service_type ?? "");
      const tier = String(body.tier ?? "");
      const recipient_gender = String(body.recipient_gender ?? "").trim();
      const service_name = String(body.service_name ?? "").trim().slice(0, 500);
      const appointment_date = String(body.appointment_date ?? "").slice(0, 10) || null;
      const appointment_time = String(body.appointment_time ?? "").slice(0, 30) || null;
      if (!/^[0-9a-f-]{36}$/i.test(zone_id) || !/^[0-9a-f-]{36}$/i.test(therapist_id) || !["Massage", "Salon"].includes(service_type) || !["Prime", "Luxe"].includes(tier) || !["Male","Female"].includes(recipient_gender) || !service_name) return json({ error: "Booking assignment details are incomplete or customer gender is missing." }, 400);
      const { data: zone, error: zError } = await admin.from("zones").select("id").eq("id", zone_id).eq("active", true).maybeSingle();
      if (zError) throw zError;
      const { data: link, error: lError } = await admin.from("therapist_zones").select("therapist_id").eq("zone_id", zone_id).eq("therapist_id", therapist_id).maybeSingle();
      if (lError) throw lError;
      const { data: t, error: tError } = await admin.from("therapists").select("id,active,available,service_types,tiers,experience_years,gender").eq("id", therapist_id).maybeSingle();
      if (tError) throw tError;
      if (!zone || !link || !t || !t.active || !t.available || t.gender !== recipient_gender || !(t.service_types ?? []).includes(service_type) || !(t.tiers ?? []).includes(tier) || (tier === "Luxe" && Number(t.experience_years ?? 0) < 2) || (tier === "Prime" && Number(t.experience_years ?? 0) < 0.5)) {
        return json({ error: "Therapist availability changed. Please select the zone and check availability again." }, 409);
      }
      const booking_amount = Number(body.booking_amount);
      const discount_amount = Number(body.discount_amount ?? 0);
      const customer_name = String(body.customer_name ?? "").trim().slice(0, 100) || null;
      const customer_phone = String(body.customer_phone ?? "").replace(/[^+0-9]/g, "").slice(0, 16) || null;
      const customer_age = body.customer_age === null || body.customer_age === undefined || body.customer_age === "" ? null : Number(body.customer_age);
      const visit_type = String(body.visit_type ?? "").slice(0, 40) || null;
      const customer_address = String(body.customer_address ?? "").trim().slice(0, 800) || null;
      const parsedCoords = coordsFromAddress(customer_address);
      const customer_latitude = validCoordinate(body.customer_latitude, -90, 90) ?? parsedCoords.lat;
      const customer_longitude = validCoordinate(body.customer_longitude, -180, 180) ?? parsedCoords.lng;
      const customer_landmark = String(body.customer_landmark ?? landmarkFromAddress(customer_address) ?? "").trim().slice(0, 200) || null;
      const customer_gps_accuracy_meters = body.customer_gps_accuracy_meters === null || body.customer_gps_accuracy_meters === undefined || body.customer_gps_accuracy_meters === "" ? null : Math.max(0, Math.min(100000, Math.round(Number(body.customer_gps_accuracy_meters) || 0)));
      const customer_notes = String(body.customer_notes ?? "").trim().slice(0, 1000) || null;
      const customer_type = String(body.customer_type ?? "").slice(0, 50) || null;
      const preferred_pressure = String(body.preferred_pressure ?? "").slice(0, 80) || null;
      const main_concern = String(body.main_concern ?? "").slice(0, 120) || null;
      const coupon_code = String(body.coupon_code ?? "").trim().slice(0, 40) || null;
      const service_details = Array.isArray(body.service_details) ? body.service_details.slice(0, 30).map((item: any) => ({
        name: String(item?.name ?? "").slice(0, 150),
        duration: Math.max(0, Math.min(600, Number(item?.duration ?? 0) || 0)),
        price: Math.max(0, Math.min(10000000, Number(item?.price ?? 0) || 0)),
        category: String(item?.category ?? "").slice(0, 80),
        type: String(item?.type ?? "").slice(0, 30)
      })) : [];
      if (!Number.isFinite(booking_amount) || booking_amount < 0 || booking_amount > 10000000 ||
          !Number.isFinite(discount_amount) || discount_amount < 0 || discount_amount > 10000000) {
        return json({ error: "Booking amount or discount is invalid." }, 400);
      }
      if (customer_age !== null && (!Number.isInteger(customer_age) || customer_age < 18 || customer_age > 120)) {
        return json({ error: "Customer age must be between 18 and 120." }, 400);
      }
      if (customer_phone && customer_phone.replace(/\D/g, "").length < 10) {
        return json({ error: "Customer mobile number is invalid." }, 400);
      }
      const partnerCode = String(body.partner_code ?? "").trim();
      let referralPartnerId: string | null = null;
      if (partnerCode) {
        const { data: referralPartner, error: partnerError } = await admin.from("partners")
          .select("id,status").eq("partner_code", partnerCode).maybeSingle();
        if (partnerError) throw partnerError;
        if (!referralPartner || referralPartner.status !== "active") {
          return json({ error: "यह BEX Partner Referral Link अमान्य या निष्क्रिय है। Partner का सही QR/Referral Link खोलकर Booking करें।" }, 400);
        }
        referralPartnerId = referralPartner.id;
      }
      const reference_code = "BEX-JOB-" + Date.now().toString(36).toUpperCase() + "-" + randomToken().slice(0, 4).toUpperCase();
      const { error } = await admin.from("booking_assignments").insert({
        reference_code, zone_id, therapist_id, service_type, tier, service_name, appointment_date, appointment_time,
        status: "awaiting_whatsapp", booking_amount, discount_amount, coupon_code, service_details,
        customer_name, customer_phone, customer_age, recipient_gender, visit_type, customer_address,
        customer_latitude, customer_longitude, customer_landmark, customer_gps_accuracy_meters,
        customer_notes, customer_type, preferred_pressure, main_concern, partner_id: referralPartnerId,
        source: "website_assigned_booking"
      });
      if (error) throw error;
      return json({ reference_code, partner_referral_attached: !!referralPartnerId });
    }
    if (action === "public-profile") {
      const token = String(body.token ?? "");
      if (!/^[a-f0-9]{64}$/i.test(token)) return json({ error: "This rating link is invalid." }, 400);
      const { data: tokenRows, error } = await admin.rpc("bex_get_rating_link_token", { p_token_hash: await hashToken(token) });
      const link = tokenRows?.[0];
      if (error || !link || link.used_at || new Date(link.expires_at) < new Date()) return json({ error: "This rating link is invalid, expired, or already used." }, 404);
      const { data: therapist, error: tError } = await admin.from("therapists").select("display_name,therapist_code,photo_url,experience_years,active").eq("id", link.therapist_id).maybeSingle();
      if (tError || !therapist || !therapist.active) return json({ error: "This therapist profile is unavailable." }, 404);
      const { data: publishedRatings, error: ratingsError } = await admin.from("therapist_ratings").select("rating,review,created_at").eq("therapist_id", link.therapist_id).eq("status", "published").order("created_at", { ascending: false });
      if (ratingsError) throw ratingsError;
      const rows = publishedRatings ?? [];
      const average_rating = rows.length ? Math.round(rows.reduce((sum: number, r: { rating: number }) => sum + Number(r.rating), 0) / rows.length * 10) / 10 : null;
      return json({ therapist: { display_name: therapist.display_name, therapist_code: therapist.therapist_code, photo_url: therapist.photo_url, experience_years: Number(therapist.experience_years ?? 0), average_rating, rating_count: rows.length, reviews: rows.filter((r: { review?: string | null }) => !!r.review).slice(0, 3).map((r: { rating: number; review: string; created_at: string }) => ({ rating: r.rating, review: r.review, created_at: r.created_at })) } });
    }
    if (action === "submit-rating") {
      const token = String(body.token ?? "");
      const rating = Number(body.rating);
      const review = String(body.review ?? "").trim().slice(0, 1000);
      if (!/^[a-f0-9]{64}$/i.test(token)) return json({ error: "This rating link is invalid." }, 400);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: "Choose a rating from 1 to 5 stars." }, 400);
      const { data: links, error: claimError } = await admin.rpc("bex_claim_rating_link_token", { p_token_hash: await hashToken(token), p_used_at: new Date().toISOString() });
      if (claimError) throw claimError;
      const link = links?.[0];
      if (!link) return json({ error: "This rating link has expired or has already been used." }, 409);
      const { error: insertError } = await admin.from("therapist_ratings").insert({ therapist_id: link.therapist_id, rating, review: review || null, status: "pending" });
      if (insertError) throw insertError;
      return json({ success: true, message: "Thank you. Your feedback has been submitted for review." });
    }
    if (action === "admin-list") {
      await requireRole(req, ["admin"]);
      const [{ data: therapists, error: tError }, { data: ratings, error: rError }, { data: zones, error: zError }, { data: therapistZones, error: tzError }] = await Promise.all([
        admin.from("therapists").select("id,user_id,display_name,phone,email,photo_url,therapist_code,active,available,age,experience_years,service_types,tiers,approval_status,gender,created_at").order("created_at", { ascending: false }),
        admin.from("therapist_ratings").select("id,therapist_id,rating,review,status,created_at").order("created_at", { ascending: false }),
        admin.from("zones").select("id,name,description,active,created_at,boundary_geojson,center_lat,center_lng").order("name"),
        admin.from("therapist_zones").select("therapist_id,zone_id")
      ]);
      if (tError) throw tError;
      if (rError) throw rError;
      if (zError) throw zError;
      if (tzError) throw tzError;
      const assignments: unknown[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: page, error: pageError } = await admin.from("booking_assignments")
          .select("id,reference_code,zone_id,therapist_id,service_type,tier,service_name,appointment_date,appointment_time,status,booking_amount,customer_name,customer_phone,customer_age,recipient_gender,visit_type,customer_address,service_details,discount_amount,coupon_code,customer_notes,customer_type,preferred_pressure,main_concern,source,cancelled_at,cancel_reason,created_at,updated_at")
          .order("created_at", { ascending: false }).range(offset, offset + 999);
        if (pageError) throw pageError;
        assignments.push(...(page ?? []));
        if (!page || page.length < 1000) break;
      }
      return json({ therapists: therapists ?? [], ratings: ratings ?? [], zones: zones ?? [], therapist_zones: therapistZones ?? [], assignments });
    }
    if (action === "admin-create-zone") {
      await requireRole(req, ["admin"]);
      const name = String(body.name ?? "").trim().replace(/\\s+/g, " ").slice(0, 80);
      const description = String(body.description ?? "").trim().slice(0, 240) || null;
      const boundary_geojson = body.boundary_geojson && typeof body.boundary_geojson === "object" ? body.boundary_geojson : null;
      if (name.length < 2) return json({ error: "Zone name कम से कम 2 characters का होना चाहिए।" }, 400);
      if (!boundary_geojson || boundary_geojson.type !== "Polygon" || !Array.isArray(boundary_geojson.coordinates?.[0]) || boundary_geojson.coordinates[0].length < 4) return json({ error: "Map पर area की Polygon boundary draw करें।" }, 400);
      const ring = boundary_geojson.coordinates[0];
      if (ring.length > 1000 || ring.some((p: unknown) => !Array.isArray(p) || p.length < 2 || !Number.isFinite(Number(p[0])) || !Number.isFinite(Number(p[1])) || Math.abs(Number(p[0])) > 180 || Math.abs(Number(p[1])) > 90)) return json({ error: "Map boundary coordinates invalid हैं।" }, 400);
      const center = ring.slice(0, -1).reduce((a: {x:number;y:number;n:number}, p: number[]) => ({x:a.x+Number(p[0]),y:a.y+Number(p[1]),n:a.n+1}), {x:0,y:0,n:0});
      const center_lng = center.n ? center.x / center.n : null, center_lat = center.n ? center.y / center.n : null;
      const { data, error } = await admin.from("zones").insert({ name, description, boundary_geojson, center_lat, center_lng, active: true }).select("id,name,description,active,created_at,boundary_geojson,center_lat,center_lng").single();
      if (error) { if (error.code === "23505") return json({ error: "यह zone पहले से मौजूद है।" }, 409); throw error; }
      return json({ zone: data });
    }
    if (action === "admin-configure-therapist") {
      await requireRole(req, ["admin"]);
      const therapist_id = String(body.therapist_id ?? "");
      const zone_ids = Array.isArray(body.zone_ids) ? [...new Set(body.zone_ids.map((x: unknown) => String(x)))] : (body.zone_id ? [String(body.zone_id)] : []);
      const experience_years = Number(body.experience_years);
      const gender = String(body.gender ?? "").trim();
      const available = body.available !== false;
      const service_types = Array.isArray(body.service_types) ? body.service_types.filter((x: unknown) => ["Massage","Salon"].includes(String(x))) : [];
      const tiers = Array.isArray(body.tiers) ? body.tiers.filter((x: unknown) => ["Prime","Luxe"].includes(String(x))) : [];
      if (!/^[0-9a-f-]{36}$/i.test(therapist_id) || !zone_ids.length || zone_ids.some((id: string) => !/^[0-9a-f-]{36}$/i.test(id))) return json({ error: "Therapist और कम से कम एक zone चुनें।" }, 400);
      if (!Number.isFinite(experience_years) || experience_years < 0 || experience_years > 60) return json({ error: "Experience 0 से 60 साल के बीच रखें।" }, 400);
      if (!["Male","Female"].includes(gender)) return json({ error: "Therapist gender Male या Female चुनें।" }, 400);
      if (!service_types.length || !tiers.length) return json({ error: "कम से कम एक service और एक category चुनें।" }, 400);
      const { data: zones, error: zError } = await admin.from("zones").select("id").in("id", zone_ids).eq("active", true);
      if (zError) throw zError;
      if ((zones ?? []).length !== zone_ids.length) return json({ error: "सभी चुने हुए zones active होने चाहिए।" }, 400);
      const { error: updateError } = await admin.from("therapists").update({ experience_years, available, service_types, tiers, gender }).eq("id", therapist_id);
      if (updateError) throw updateError;
      const { error: clearZonesError } = await admin.from("therapist_zones").delete().eq("therapist_id", therapist_id);
      if (clearZonesError) throw clearZonesError;
      const { error: zoneError } = await admin.from("therapist_zones").insert(zone_ids.map((zone_id: string) => ({ therapist_id, zone_id })));
      if (zoneError) throw zoneError;
      return json({ success: true, message: "Therapist zone, experience और availability सेव हो गए।" });
    }
    if (action === "admin-set-zone-boundary") {
      await requireRole(req, ["admin"]);
      const zone_id = String(body.zone_id ?? "");
      const boundary_geojson = body.boundary_geojson && typeof body.boundary_geojson === "object" ? body.boundary_geojson : null;
      if (!/^[0-9a-f-]{36}$/i.test(zone_id) || !boundary_geojson || boundary_geojson.type !== "Polygon" || !Array.isArray(boundary_geojson.coordinates?.[0]) || boundary_geojson.coordinates[0].length < 4) return json({ error: "Valid zone और map polygon चुनें।" }, 400);
      const ring = boundary_geojson.coordinates[0];
      if (ring.length > 1000 || ring.some((p: unknown) => !Array.isArray(p) || p.length < 2 || !Number.isFinite(Number(p[0])) || !Number.isFinite(Number(p[1])) || Math.abs(Number(p[0])) > 180 || Math.abs(Number(p[1])) > 90)) return json({ error: "Map boundary coordinates invalid हैं।" }, 400);
      const center = ring.slice(0, -1).reduce((a: {x:number;y:number;n:number}, p: number[]) => ({x:a.x+Number(p[0]),y:a.y+Number(p[1]),n:a.n+1}), {x:0,y:0,n:0});
      const center_lng = center.n ? center.x / center.n : null, center_lat = center.n ? center.y / center.n : null;
      const { data, error } = await admin.from("zones").update({ boundary_geojson, center_lat, center_lng }).eq("id", zone_id).select("id,name,active,boundary_geojson,center_lat,center_lng").single();
      if (error) throw error;
      return json({ zone: data, message: "Zone map boundary saved." });
    }
    if (action === "admin-set-zone-active") {
      await requireRole(req, ["admin"]);
      const zone_id = String(body.zone_id ?? "");
      const active = body.active === true;
      const { data, error } = await admin.from("zones").update({ active }).eq("id", zone_id).select("id,name,active").single();
      if (error) throw error;
      return json({ zone: data });
    }
    if (action === "admin-create-therapist") {
      const user = await requireRole(req, ["admin"]);
      const display_name = String(body.display_name ?? "").trim().slice(0, 100);
      const phone = String(body.phone ?? "").replace(/[^+0-9]/g, "").slice(0, 16);
      const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254) || null;
      const photo_url = String(body.photo_url ?? "").trim().slice(0, 1000) || null;
      const therapist_code = String(body.therapist_code ?? "").trim().toUpperCase().slice(0, 20) || undefined;
      const experience_years = Number(body.experience_years ?? 0);
      const age = body.age === null || body.age === undefined || body.age === "" ? null : Number(body.age);
      const gender = String(body.gender ?? "").trim();
      const service_types = Array.isArray(body.service_types) ? [...new Set(body.service_types.filter((x: unknown) => ["Massage","Salon"].includes(String(x))))] : ["Massage"];
      const tiers = Array.isArray(body.tiers) ? [...new Set(body.tiers.filter((x: unknown) => ["Prime","Luxe"].includes(String(x))))] : ["Prime","Luxe"];
      const zone_ids = Array.isArray(body.zone_ids) ? [...new Set(body.zone_ids.map((x: unknown) => String(x)))] : [];
      if (!["Male", "Female"].includes(gender)) return json({ error: "Therapist gender Male या Female चुनें।" }, 400);
      if (age !== null && (!Number.isInteger(age) || age < 18 || age > 100)) return json({ error: "Age 18 से 100 साल के बीच रखें।" }, 400);
      if (!Number.isFinite(experience_years) || experience_years < 0 || experience_years > 60) return json({ error: "Experience 0 से 60 साल के बीच भरें।" }, 400);
      if (!display_name) return json({ error: "Enter the therapist name." }, 400);
      if (!phone || phone.replace(/\D/g, "").length < 10) return json({ error: "Valid therapist mobile number is required." }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Valid email address भरें।" }, 400);
      if (!service_types.length || !tiers.length) return json({ error: "कम से कम एक service और एक category चुनें।" }, 400);
      if (zone_ids.some((id: string) => !/^[0-9a-f-]{36}$/i.test(id))) return json({ error: "Invalid zone selected." }, 400);
      if (zone_ids.length) {
        const { data: activeZones, error: zoneError } = await admin.from("zones").select("id").in("id", zone_ids).eq("active", true);
        if (zoneError) throw zoneError;
        if ((activeZones ?? []).length !== zone_ids.length) return json({ error: "सभी चुने हुए zones active होने चाहिए।" }, 400);
      }
      const { data, error } = await admin.from("therapists").insert({ display_name, phone, email, age, photo_url, experience_years, gender, service_types, tiers, ...(therapist_code ? { therapist_code } : {}), user_id: null, approval_status: "pending" }).select("id,user_id,display_name,phone,email,age,photo_url,therapist_code,active,experience_years,gender,service_types,tiers,approval_status,created_at").single();
      if (error) {
        if (error.code === "23505") return json({ error: "This mobile number or email is already registered." }, 409);
        throw error;
      }
      if (zone_ids.length) {
        const { error: zoneLinkError } = await admin.from("therapist_zones").insert(zone_ids.map((zone_id: string) => ({ therapist_id: data.id, zone_id })));
        if (zoneLinkError) {
          await admin.from("therapists").delete().eq("id", data.id);
          throw zoneLinkError;
        }
      }
      return json({ therapist: data, message: "Therapist profile created and is pending admin approval." });
    }
    if (action === "admin-edit-therapist") {
      await requireRole(req, ["admin"]);
      const therapist_id = String(body.therapist_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(therapist_id)) return json({ error: "Valid therapist ID required." }, 400);
      const display_name = String(body.display_name ?? "").trim().slice(0, 100);
      const phone = String(body.phone ?? "").replace(/[^+0-9]/g, "").slice(0, 16);
      const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254) || null;
      const { data: currentProfile, error: currentProfileError } = await admin.from("therapists").select("user_id,email").eq("id", therapist_id).single();
      if (currentProfileError) throw currentProfileError;
      if (currentProfile.user_id && String(currentProfile.email ?? "").toLowerCase() !== String(email ?? "").toLowerCase()) return json({ error: "इस Therapist का login account जुड़ चुका है। Login email बदलने के लिए पहले account email update करना होगा।" }, 409);
      const age = body.age === null || body.age === undefined || body.age === "" ? null : Number(body.age);
      const experience_years = Number(body.experience_years ?? 0);
      const gender = String(body.gender ?? "").trim();
      const photo_url = String(body.photo_url ?? "").trim().slice(0, 1000) || null;
      const service_types = Array.isArray(body.service_types) ? [...new Set(body.service_types.filter((x: unknown) => ["Massage","Salon"].includes(String(x))))] : [];
      const tiers = Array.isArray(body.tiers) ? [...new Set(body.tiers.filter((x: unknown) => ["Prime","Luxe"].includes(String(x))))] : [];
      const zone_ids = Array.isArray(body.zone_ids) ? [...new Set(body.zone_ids.map((x: unknown) => String(x)))] : [];
      if (!display_name || !phone || phone.replace(/\D/g, "").length < 10) return json({ error: "नाम और सही mobile number भरें।" }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Valid email address भरें।" }, 400);
      if (!["Male","Female"].includes(gender)) return json({ error: "Therapist gender Male या Female चुनें।" }, 400);
      if (age !== null && (!Number.isInteger(age) || age < 18 || age > 100)) return json({ error: "Age 18 से 100 साल के बीच रखें।" }, 400);
      if (!Number.isFinite(experience_years) || experience_years < 0 || experience_years > 60) return json({ error: "Experience 0 से 60 साल के बीच रखें।" }, 400);
      if (!service_types.length || !tiers.length) return json({ error: "कम से कम एक service और category चुनें।" }, 400);
      if (zone_ids.some((id: string) => !/^[0-9a-f-]{36}$/i.test(id))) return json({ error: "Invalid zone selected." }, 400);
      if (zone_ids.length) {
        const { data: activeZones, error: zoneError } = await admin.from("zones").select("id").in("id", zone_ids).eq("active", true);
        if (zoneError) throw zoneError;
        if ((activeZones ?? []).length !== zone_ids.length) return json({ error: "सभी चुने हुए zones active होने चाहिए।" }, 400);
      }
      const { data: updated, error } = await admin.from("therapists").update({ display_name, phone, email, age, experience_years, gender, photo_url, service_types, tiers }).eq("id", therapist_id).select("id,user_id,display_name,phone,email,age,photo_url,therapist_code,active,available,experience_years,gender,service_types,tiers,approval_status,created_at").single();
      if (error) {
        if (error.code === "23505") return json({ error: "This mobile number or email is already registered." }, 409);
        throw error;
      }
      const { error: clearError } = await admin.from("therapist_zones").delete().eq("therapist_id", therapist_id);
      if (clearError) throw clearError;
      if (zone_ids.length) {
        const { error: linkError } = await admin.from("therapist_zones").insert(zone_ids.map((zone_id: string) => ({ therapist_id, zone_id })));
        if (linkError) throw linkError;
      }
      return json({ therapist: updated, message: "Therapist profile और zones अपडेट हो गए।" });
    }
    if (action === "admin-invite-therapist") {
      await requireRole(req, ["admin"]);
      const therapist_id = String(body.therapist_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(therapist_id)) return json({ error: "Valid therapist ID required." }, 400);
      const { data: therapist, error: tError } = await admin.from("therapists").select("id,user_id,display_name,email,therapist_code").eq("id", therapist_id).single();
      if (tError) throw tError;
      const email = String(therapist.email ?? "").trim().toLowerCase();
      if (!email) return json({ error: "पहले Edit Profile में therapist का email भरकर Save करें।" }, 400);
      let userId = therapist.user_id as string | null;
      let actionLink: string | null = null;
      let inviteSent = false;
      if (!userId) {
        const existingUser = await findAuthUserByEmail(email);
        if (existingUser) {
          const { data: existingProfile, error: roleError } = await admin.from("user_profiles").select("role").eq("user_id", existingUser.id).maybeSingle();
          if (roleError) throw roleError;
          if (String(existingProfile?.role ?? "").toLowerCase() !== "therapist") return json({ error: "यह email पहले से दूसरे account role में है। Therapist के लिए अलग email इस्तेमाल करें।" }, 409);
          userId = existingUser.id;
          const { error: linkError } = await admin.from("therapists").update({ user_id: userId }).eq("id", therapist_id);
          if (linkError) throw linkError;
          const { data: linkData, error: resetError } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: "https://jitenderkusum8098-creator.github.io/Bodyexpertx/rating-dashboard.html" } });
          if (resetError) return json({ error: "Login reset link नहीं बन पाया: " + resetError.message }, 400);
          actionLink = linkData.properties?.action_link ?? null;
        } else {
          const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: "https://jitenderkusum8098-creator.github.io/Bodyexpertx/rating-dashboard.html" });
          if (inviteError) return json({ error: "Account invite नहीं भेजा गया: " + inviteError.message }, 400);
          userId = invite.user.id;
          inviteSent = true;
          const { error: profileError } = await admin.from("user_profiles").upsert({ user_id: userId, role: "therapist" }, { onConflict: "user_id" });
          if (profileError) throw profileError;
          const { error: linkError } = await admin.from("therapists").update({ user_id: userId }).eq("id", therapist_id);
          if (linkError) throw linkError;
        }
      } else {
        const { data: linkData, error: resetError } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: "https://jitenderkusum8098-creator.github.io/Bodyexpertx/rating-dashboard.html" } });
        if (resetError) return json({ error: "Login reset link नहीं बन पाया: " + resetError.message }, 400);
        actionLink = linkData.properties?.action_link ?? null;
      }
      return json({ success: true, email, invite_sent: inviteSent, action_link: actionLink, portal_url: "https://jitenderkusum8098-creator.github.io/Bodyexpertx/rating-dashboard.html", message: inviteSent ? "Account setup email भेज दिया गया। WhatsApp पर portal link भी भेज सकते हैं।" : "Therapist के लिए password setup/reset link तैयार है। इसे WhatsApp से भेजें।" });
    }
    if (action === "admin-create-service-code") {
      const user = await requireRole(req, ["admin"]);
      const service_type = String(body.service_type ?? "");
      const tier = String(body.tier ?? "");
      if (!["Massage", "Salon"].includes(service_type) || !["Prime", "Luxe"].includes(tier)) {
        return json({ error: "Choose Massage or Salon and Prime or Luxe." }, 400);
      }
      const serviceLetter = service_type === "Massage" ? "M" : "S";
      const tierLetter = tier === "Prime" ? "P" : "L";
      const prefix = `BEX-${serviceLetter}-${tierLetter}`;
      const { data: existing, error: listError } = await admin.rpc("bex_list_service_codes", { p_prefix: prefix });
      if (listError) throw listError;
      const used = new Set((existing ?? []).map((row: { service_code: string }) => row.service_code));
      let service_code: string | null = null;
      for (let n = 1; n <= 999; n++) {
        const candidate = `${prefix}${String(n).padStart(2, "0")}`;
        if (!used.has(candidate)) { service_code = candidate; break; }
      }
      if (!service_code) return json({ error: "This category has reached its 999 ID limit." }, 409);
      const { data, error } = await admin.rpc("bex_create_service_code", { p_service_type: service_type, p_tier: tier, p_service_code: service_code, p_created_by: user.id });
      if (error) {
        if (error.code === "23505") return json({ error: "ID conflict; please click Generate again." }, 409);
        throw error;
      }
      return json(data?.[0] ?? data);
    }
    if (action === "admin-create-link") {
      const user = await requireRole(req, ["admin"]);
      const therapistId = String(body.therapist_id ?? "");
      const { data: therapist, error: tError } = await admin.from("therapists").select("id,display_name,therapist_code,photo_url,experience_years,active").eq("id", therapistId).maybeSingle();
      if (tError || !therapist || !therapist.active) return json({ error: "Choose an active therapist." }, 404);
      const { data: publishedRatings, error: ratingsError } = await admin.from("therapist_ratings").select("rating").eq("therapist_id", therapistId).eq("status", "published");
      if (ratingsError) throw ratingsError;
      const rows = publishedRatings ?? [];
      const average_rating = rows.length ? Math.round(rows.reduce((sum: number, r: { rating: number }) => sum + Number(r.rating), 0) / rows.length * 10) / 10 : null;
      const token = randomToken();
      const { error } = await admin.rpc("bex_create_rating_link_token", { p_token_hash: await hashToken(token), p_therapist_id: therapistId, p_created_by: user.id });
      if (error) throw error;
      return json({ token, therapist: { id: therapist.id, display_name: therapist.display_name, therapist_code: therapist.therapist_code, photo_url: therapist.photo_url, experience_years: Number(therapist.experience_years ?? 0), average_rating, rating_count: rows.length }, expires_in_days: 30 });
    }
    if (action === "admin-update-booking") {
      await requireRole(req, ["admin"]);
      const id = String(body.booking_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Valid booking ID required." }, 400);
      const { data: existing, error: existingError } = await admin.from("booking_assignments").select("id,status,therapist_id,zone_id,service_type,tier,recipient_gender,cancelled_at").eq("id", id).maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return json({ error: "Booking नहीं मिली।" }, 404);
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(body, "status")) {
        const status = String(body.status ?? "");
        if (!["awaiting_whatsapp","whatsapp_opened","confirmed","reached","completed","cancelled","unavailable"].includes(status)) return json({ error: "Invalid booking status." }, 400);
        if (existing.status === "cancelled" && status !== "cancelled") return json({ error: "Cancelled booking history सुरक्षित रखने के लिए इसे दोबारा active नहीं किया जा सकता। नई booking बनाएं।" }, 409);
        updates.status = status;
        if (status === "cancelled") {
          updates.cancelled_at = existing.cancelled_at ?? new Date().toISOString();
          updates.cancel_reason = String(body.cancel_reason ?? "").trim().slice(0, 300) || null;
        }
      }
      const targetZoneId = Object.prototype.hasOwnProperty.call(body, "zone_id") ? String(body.zone_id ?? "").trim() : String(existing.zone_id ?? "");
      if (Object.prototype.hasOwnProperty.call(body, "zone_id")) {
        if (!targetZoneId) {
          if (Object.prototype.hasOwnProperty.call(body, "therapist_id") && String(body.therapist_id ?? "").trim()) return json({ error: "Therapist assign करने से पहले zone चुनें।" }, 400);
          updates.zone_id = null;
        } else {
          if (!/^[0-9a-f-]{36}$/i.test(targetZoneId)) return json({ error: "Valid zone ID required." }, 400);
          const { data: zone, error: zoneError } = await admin.from("zones").select("id").eq("id", targetZoneId).eq("active", true).maybeSingle();
          if (zoneError) throw zoneError;
          if (!zone) return json({ error: "Selected zone inactive है या मौजूद नहीं है।" }, 409);
          updates.zone_id = targetZoneId;
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, "therapist_id")) {
        const therapist_id = String(body.therapist_id ?? "").trim();
        if (!therapist_id) {
          if (existing.status === "cancelled") return json({ error: "Cancelled booking का historical therapist record नहीं बदला जा सकता।" }, 409);
          updates.therapist_id = null;
        } else {
          if (!/^[0-9a-f-]{36}$/i.test(therapist_id)) return json({ error: "Valid therapist ID required." }, 400);
          if (existing.status === "cancelled") return json({ error: "Cancelled booking का historical therapist record नहीं बदला जा सकता।" }, 409);
          const { data: therapist, error: tError } = await admin.from("therapists").select("id,active,available,service_types,tiers,experience_years,gender").eq("id", therapist_id).maybeSingle();
          if (tError) throw tError;
          if (!therapist || !therapist.active || !therapist.available) return json({ error: "Therapist profile inactive है या नई job के लिए unavailable है。" }, 409);
          if (existing.recipient_gender && therapist.gender !== existing.recipient_gender) return json({ error: "Gender mismatch: customer ne "+existing.recipient_gender+" therapist request kiya hai. Sirf matching gender therapist assign karein." }, 409);
          if (!(therapist.service_types ?? []).includes(existing.service_type) || !(therapist.tiers ?? []).includes(existing.tier) ||
              (existing.tier === "Luxe" && Number(therapist.experience_years ?? 0) < 2) ||
              (existing.tier === "Prime" && Number(therapist.experience_years ?? 0) < 0.5)) return json({ error: "यह therapist इस service/category के लिए eligible नहीं है।" }, 409);
          const { data: zoneLink, error: zlError } = await admin.from("therapist_zones").select("therapist_id").eq("therapist_id", therapist_id).eq("zone_id", targetZoneId).maybeSingle();
          if (zlError) throw zlError;
          if (!targetZoneId || !zoneLink) return json({ error: "पहले zone चुनें और therapist को उसी zone में assign करें।" }, 409);
          updates.therapist_id = therapist_id;
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, "booking_amount")) {
        const amount = Number(body.booking_amount);
        if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return json({ error: "Booking amount ₹0 से ₹1,00,00,000 के बीच रखें।" }, 400);
        updates.booking_amount = Math.round(amount * 100) / 100;
      }
      if (Object.keys(updates).length === 1) return json({ error: "कोई बदलाव नहीं चुना गया।" }, 400);
      const { data, error } = await admin.from("booking_assignments").update(updates).eq("id", id)
        .select("id,reference_code,zone_id,therapist_id,service_type,tier,service_name,appointment_date,appointment_time,status,booking_amount,customer_name,customer_phone,cancelled_at,cancel_reason,created_at,updated_at").single();
      if (error) throw error;
      return json({ booking: data, message: data.status === "cancelled" ? "Booking cancel हुई; history में सुरक्षित है और active jobs में नहीं गिनी जाएगी।" : "Booking update हो गई।" });
    }
    if (action === "admin-set-therapist-active") {
      await requireRole(req, ["admin"]);
      const therapist_id = String(body.therapist_id ?? "");
      const active = body.active === true;
      if (!/^[0-9a-f-]{36}$/i.test(therapist_id)) return json({ error: "Valid therapist ID required." }, 400);
      const updates = active ? { active: true, available: true } : { active: false, available: false };
      const { data, error } = await admin.from("therapists").update(updates).eq("id", therapist_id)
        .select("id,display_name,therapist_code,active,available").single();
      if (error) throw error;
      return json({ therapist: data, message: active ? "Therapist ID/profile Active कर दी गई।" : "Therapist ID/profile Off कर दी गई; existing job history सुरक्षित है।" });
    }
    if (action === "admin-set-therapist-approval") {
      await requireRole(req, ["admin"]);
      const therapist_id = String(body.therapist_id ?? "");
      const approval_status = String(body.approval_status ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(therapist_id)) return json({ error: "Valid therapist ID required." }, 400);
      if (!["approved", "rejected", "pending"].includes(approval_status)) return json({ error: "Invalid approval status." }, 400);
      const updates = approval_status === "approved"
        ? { approval_status, active: true, available: true }
        : { approval_status, active: false, available: false };
      const { data, error } = await admin.from("therapists").update(updates).eq("id", therapist_id)
        .select("id,display_name,therapist_code,approval_status,active,available").single();
      if (error) throw error;
      return json({ therapist: data, message: approval_status === "approved" ? "Therapist approved and activated." : approval_status === "rejected" ? "Therapist application rejected." : "Therapist approval set to pending." });
    }
    if (action === "admin-moderate") {
      await requireRole(req, ["admin"]);
      const id = String(body.rating_id ?? "");
      const status = String(body.status ?? "");
      if (!["published", "rejected", "pending"].includes(status)) return json({ error: "Invalid review status." }, 400);
      const { error } = await admin.from("therapist_ratings").update({ status }).eq("id", id);
      if (error) throw error;
      return json({ success: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("therapist-ratings:", error);
    const e = error as { message?: string; details?: string; hint?: string; code?: string }; const message = error instanceof Error ? error.message : [e?.message, e?.details, e?.hint].filter(Boolean).join(" — ") || "Unexpected server error. Check the Edge Function logs."; return json({ error: message, code: e?.code ?? null }, 400);
  }
});