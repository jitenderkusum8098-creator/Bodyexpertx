alter table public.partner_referrals
  add column if not exists latest_booking_status text,
  add column if not exists latest_service_tier text,
  add column if not exists last_booking_at timestamptz;

create unique index if not exists partner_referrals_partner_phone_active_uq
  on public.partner_referrals(partner_id, phone_normalized) where status = 'active';

create or replace function public.bex_track_partner_booking()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.partner_referral_id is not null then
    update public.partner_referrals
      set latest_booking_status = new.status,
          latest_service_tier = new.tier,
          last_booking_at = coalesce(new.updated_at, new.created_at, now())
      where id = new.partner_referral_id;
  end if;
  return new;
end;
$$;
drop trigger if exists bex_track_partner_booking on public.booking_assignments;
create trigger bex_track_partner_booking
after insert or update of status, tier on public.booking_assignments
for each row execute function public.bex_track_partner_booking();

update public.partner_referrals r
set latest_booking_status = b.status,
    latest_service_tier = b.tier,
    last_booking_at = coalesce(b.updated_at, b.created_at)
from public.booking_assignments b
where b.partner_referral_id = r.id;