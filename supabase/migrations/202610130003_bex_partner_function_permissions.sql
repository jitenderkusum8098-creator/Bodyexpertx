-- Trigger-only functions must not be callable directly through PostgREST RPC.
revoke all on function public.bex_attach_partner_referral() from public, anon, authenticated;
revoke all on function public.bex_create_partner_commission() from public, anon, authenticated;
revoke all on function public.bex_track_partner_booking() from public, anon, authenticated;
-- Policy helper functions are needed by signed-in RLS checks, but not anonymous clients.
revoke all on function public.bex_is_admin() from public, anon;
grant execute on function public.bex_is_admin() to authenticated;
revoke all on function public.bex_current_partner_id() from public, anon;
grant execute on function public.bex_current_partner_id() to authenticated;