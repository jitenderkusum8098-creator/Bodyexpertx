-- BEX Partner: additive schema for partner registration, referral tracking and commission ledger
-- Existing production tables are extended only with nullable/defaulted partner fields.

alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role = any (array['admin'::text, 'therapist'::text, 'partner'::text]));

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  partner_code text not null unique default ('BXP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  login_id text not null unique,
  business_name text not null,
  owner_name text not null,
  category text not null check (category in ('Salon','Gym','Medical Store','Other')),
  phone text not null,
  full_address text not null,
  photo_url text,
  status text not null default 'active' check (status in ('active','suspended')),
  force_password_change boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  customer_name text not null,
  customer_phone text not null,
  phone_normalized text not null,
  consent_confirmed boolean not null default false,
  status text not null default 'active' check (status in ('active','disabled','needs_review')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  notes text
);
create index if not exists partner_referrals_phone_idx on public.partner_referrals(phone_normalized, created_at);
create index if not exists partner_referrals_partner_idx on public.partner_referrals(partner_id, created_at desc);

create table if not exists public.partner_commission_rules (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('Salon','Gym','Medical Store','Other')),
  service_tier text not null check (service_tier in ('Prime','Luxe','Other')),
  partner_id uuid references public.partners(id) on delete cascade,
  commission_type text not null default 'fixed' check (commission_type in ('fixed','percent')),
  amount numeric(12,2) not null check (amount >= 0),
  rule_mode text not null default 'every' check (rule_mode in ('first','every','period')),
  validity_months integer check (validity_months is null or validity_months between 1 and 60),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((rule_mode = 'period' and validity_months is not null) or (rule_mode <> 'period'))
);
create unique index if not exists partner_commission_rules_category_tier_uq
  on public.partner_commission_rules(category, service_tier) where partner_id is null;
create unique index if not exists partner_commission_rules_partner_tier_uq
  on public.partner_commission_rules(partner_id, service_tier) where partner_id is not null;

create table if not exists public.partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete restrict,
  referral_id uuid not null references public.partner_referrals(id) on delete restrict,
  booking_id uuid not null unique references public.booking_assignments(id) on delete restrict,
  service_tier text not null,
  booking_amount numeric(12,2) not null default 0,
  commission_type text not null check (commission_type in ('fixed','percent')),
  rate_value numeric(12,2) not null,
  commission_amount numeric(12,2) not null check (commission_amount >= 0),
  status text not null default 'earned' check (status in ('earned','paid','void')),
  earned_at timestamptz not null default now(),
  paid_at timestamptz,
  payment_reference text,
  paid_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists partner_commissions_partner_idx on public.partner_commissions(partner_id, created_at desc);
create index if not exists partner_commissions_status_idx on public.partner_commissions(status, created_at desc);

alter table public.booking_assignments
  add column if not exists partner_id uuid references public.partners(id) on delete set null,
  add column if not exists partner_referral_id uuid references public.partner_referrals(id) on delete set null,
  add column if not exists payment_verified boolean not null default false,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by uuid references auth.users(id) on delete set null;

create or replace function public.bex_is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin');
$$;

create or replace function public.bex_current_partner_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select p.id from public.partners p where p.user_id = auth.uid() and p.status = 'active' limit 1;
$$;

alter table public.partners enable row level security;
alter table public.partner_referrals enable row level security;
alter table public.partner_commission_rules enable row level security;
alter table public.partner_commissions enable row level security;

drop policy if exists "BEX partners read own or admin" on public.partners;
create policy "BEX partners read own or admin" on public.partners for select to authenticated
  using (public.bex_is_admin() or user_id = auth.uid());
drop policy if exists "BEX admins manage partners" on public.partners;
create policy "BEX admins manage partners" on public.partners for all to authenticated
  using (public.bex_is_admin()) with check (public.bex_is_admin());

drop policy if exists "BEX partners read own referrals" on public.partner_referrals;
create policy "BEX partners read own referrals" on public.partner_referrals for select to authenticated
  using (public.bex_is_admin() or partner_id = public.bex_current_partner_id());
drop policy if exists "BEX partners create own referrals" on public.partner_referrals;
create policy "BEX partners create own referrals" on public.partner_referrals for insert to authenticated
  with check (partner_id = public.bex_current_partner_id() and created_by = auth.uid() and consent_confirmed = true);
drop policy if exists "BEX admins manage referrals" on public.partner_referrals;
create policy "BEX admins manage referrals" on public.partner_referrals for all to authenticated
  using (public.bex_is_admin()) with check (public.bex_is_admin());

drop policy if exists "BEX rules read authenticated" on public.partner_commission_rules;
create policy "BEX rules read authenticated" on public.partner_commission_rules for select to authenticated
  using (public.bex_is_admin() or partner_id = public.bex_current_partner_id() or partner_id is null);
drop policy if exists "BEX admins manage commission rules" on public.partner_commission_rules;
create policy "BEX admins manage commission rules" on public.partner_commission_rules for all to authenticated
  using (public.bex_is_admin()) with check (public.bex_is_admin());

drop policy if exists "BEX partners read own commissions" on public.partner_commissions;
create policy "BEX partners read own commissions" on public.partner_commissions for select to authenticated
  using (public.bex_is_admin() or partner_id = public.bex_current_partner_id());
drop policy if exists "BEX admins manage commissions" on public.partner_commissions;
create policy "BEX admins manage commissions" on public.partner_commissions for all to authenticated
  using (public.bex_is_admin()) with check (public.bex_is_admin());

-- Only authenticated admins may verify booking payment.
drop policy if exists "BEX admins verify booking payment" on public.booking_assignments;
create policy "BEX admins verify booking payment" on public.booking_assignments for update to authenticated
  using (public.bex_is_admin()) with check (public.bex_is_admin());

create or replace function public.bex_attach_partner_referral()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  normalized text;
  referral_count integer;
  matched_referral public.partner_referrals%rowtype;
begin
  if new.customer_phone is null or btrim(new.customer_phone) = '' then
    return new;
  end if;
  normalized := regexp_replace(new.customer_phone, '\D', '', 'g');
  if length(normalized) < 10 then return new; end if;

  select count(*) into referral_count
  from public.partner_referrals r
  join public.partners p on p.id = r.partner_id and p.status = 'active'
  where r.phone_normalized = right(normalized, 10)
    and r.status = 'active'
    and r.consent_confirmed = true
    and r.created_at <= coalesce(new.created_at, now());

  if referral_count = 1 then
    select r.* into matched_referral
    from public.partner_referrals r
    join public.partners p on p.id = r.partner_id and p.status = 'active'
    where r.phone_normalized = right(normalized, 10)
      and r.status = 'active'
      and r.consent_confirmed = true
      and r.created_at <= coalesce(new.created_at, now())
    order by r.created_at asc limit 1;
    new.partner_id := matched_referral.partner_id;
    new.partner_referral_id := matched_referral.id;
  elsif referral_count > 1 then
    -- Ambiguous referrals are deliberately not credited automatically.
    new.partner_id := null;
    new.partner_referral_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists bex_attach_partner_referral on public.booking_assignments;
create trigger bex_attach_partner_referral
before insert or update of customer_phone on public.booking_assignments
for each row execute function public.bex_attach_partner_referral();

create or replace function public.bex_create_partner_commission()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  ref public.partner_referrals%rowtype;
  part public.partners%rowtype;
  rule public.partner_commission_rules%rowtype;
  booking_value numeric(12,2);
  tier_value text;
  existing_count integer;
  commission_value numeric(12,2);
begin
  if new.status <> 'completed' or new.payment_verified is not true or new.partner_id is null or new.partner_referral_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and old.payment_verified is true then
    return new;
  end if;
  if exists (select 1 from public.partner_commissions c where c.booking_id = new.id) then
    return new;
  end if;

  select * into ref from public.partner_referrals where id = new.partner_referral_id and status = 'active' and consent_confirmed = true;
  select * into part from public.partners where id = new.partner_id and status = 'active';
  if ref.id is null or part.id is null then return new; end if;

  tier_value := coalesce(new.tier, 'Other');
  booking_value := greatest(coalesce(new.booking_amount, 0) - coalesce(new.discount_amount, 0), 0);

  select * into rule from public.partner_commission_rules
    where partner_id = part.id and service_tier = tier_value and active = true
    order by updated_at desc limit 1;
  if rule.id is null then
    select * into rule from public.partner_commission_rules
      where partner_id is null and category = part.category and service_tier = tier_value and active = true
      order by updated_at desc limit 1;
  end if;
  if rule.id is null then return new; end if;

  select count(*) into existing_count from public.partner_commissions
    where referral_id = ref.id and status <> 'void';

  if rule.rule_mode = 'first' and existing_count > 0 then return new; end if;
  if rule.rule_mode = 'period' and now() > ref.created_at + make_interval(months => rule.validity_months) then return new; end if;

  if rule.commission_type = 'percent' then
    commission_value := round(booking_value * rule.amount / 100, 2);
  else
    commission_value := rule.amount;
  end if;

  insert into public.partner_commissions
    (partner_id, referral_id, booking_id, service_tier, booking_amount, commission_type, rate_value, commission_amount, status)
  values
    (part.id, ref.id, new.id, tier_value, booking_value, rule.commission_type, rule.amount, commission_value, 'earned')
  on conflict (booking_id) do nothing;

  return new;
end;
$$;

drop trigger if exists bex_create_partner_commission on public.booking_assignments;
create trigger bex_create_partner_commission
after insert or update of status, payment_verified on public.booking_assignments
for each row execute function public.bex_create_partner_commission();

-- Public business logos/photos; only authenticated admins can upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-profiles', 'partner-profiles', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "BEX public read partner photos" on storage.objects;
create policy "BEX public read partner photos" on storage.objects for select to public
  using (bucket_id = 'partner-profiles');
drop policy if exists "BEX admins upload partner photos" on storage.objects;
create policy "BEX admins upload partner photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-profiles' and public.bex_is_admin());
drop policy if exists "BEX admins update partner photos" on storage.objects;
create policy "BEX admins update partner photos" on storage.objects for update to authenticated
  using (bucket_id = 'partner-profiles' and public.bex_is_admin())
  with check (bucket_id = 'partner-profiles' and public.bex_is_admin());
