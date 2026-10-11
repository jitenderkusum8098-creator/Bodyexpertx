-- BodyExpertX partner/admin foundation for Supabase
-- Run in Supabase SQL Editor only after reviewing. Do not add secrets to this file.
-- This creates partner applications and a private profile/role table.
-- The first admin must be assigned manually after signing up in Supabase Auth.

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','partner')),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  area text,
  experience text,
  skills text,
  availability text,
  applicant_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;
alter table public.partner_applications enable row level security;

-- Helper function: only a user explicitly assigned the admin role is an admin.
create or replace function public.is_bodyexpertx_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid())
      and r.role = 'admin'
      and r.approved = true
  );
$$;

revoke all on function public.is_bodyexpertx_admin() from public;
grant execute on function public.is_bodyexpertx_admin() to authenticated;

-- No public read access to role records; users can only read their own role.
drop policy if exists "Read own role" on public.user_roles;
create policy "Read own role" on public.user_roles
for select to authenticated
using (user_id = (select auth.uid()) or public.is_bodyexpertx_admin());

drop policy if exists "Admins manage roles" on public.user_roles;
create policy "Admins manage roles" on public.user_roles
for all to authenticated
using (public.is_bodyexpertx_admin())
with check (public.is_bodyexpertx_admin());

-- Anyone may submit an application; public users cannot read, approve, or edit applications.
drop policy if exists "Submit partner application" on public.partner_applications;
create policy "Submit partner application" on public.partner_applications
for insert to anon, authenticated
with check (
  status = 'pending'
  and (applicant_user_id is null or applicant_user_id = (select auth.uid()))
);

drop policy if exists "Applicants read own application" on public.partner_applications;
create policy "Applicants read own application" on public.partner_applications
for select to authenticated
using (applicant_user_id = (select auth.uid()) or public.is_bodyexpertx_admin());

drop policy if exists "Admins manage applications" on public.partner_applications;
create policy "Admins manage applications" on public.partner_applications
for update to authenticated
using (public.is_bodyexpertx_admin())
with check (public.is_bodyexpertx_admin());

grant usage on schema public to anon, authenticated;
grant insert on public.partner_applications to anon, authenticated;
grant select, update on public.partner_applications to authenticated;
grant select on public.user_roles to authenticated;
grant insert, update, delete on public.user_roles to authenticated;

-- IMPORTANT: After creating your own Auth user, copy its UUID from Authentication > Users.
-- Then run this separately, replacing YOUR_AUTH_USER_UUID:
-- insert into public.user_roles (user_id, role, approved)
-- values ('YOUR_AUTH_USER_UUID', 'admin', true)
-- on conflict (user_id) do update set role='admin', approved=true;
