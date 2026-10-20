-- BodyExpertX customer booking funnel tracking.
-- Stores only customer-entered contact details and coarse funnel events; never addresses/GPS/payment data.
create table if not exists public.customer_tracking_events (
  id bigint generated always as identity primary key,
  session_id text not null check (length(session_id) between 16 and 80),
  event_name text not null check (event_name in ('page_view','contact_entered','booking_started','booking_saved','booking_abandoned')),
  customer_name text,
  customer_phone text,
  page_path text not null default '/massage.html',
  created_at timestamptz not null default now()
);
alter table public.customer_tracking_events enable row level security;
revoke all on public.customer_tracking_events from anon, authenticated;
grant insert on public.customer_tracking_events to anon, authenticated;
grant usage, select on sequence public.customer_tracking_events_id_seq to anon, authenticated;
grant select on public.customer_tracking_events to authenticated;
drop policy if exists "Public can record limited booking funnel events" on public.customer_tracking_events;
create policy "Public can record limited booking funnel events"
on public.customer_tracking_events for insert to anon, authenticated
with check (
  length(session_id) between 16 and 80
  and event_name in ('page_view','contact_entered','booking_started','booking_saved','booking_abandoned')
  and length(coalesce(customer_name,'')) <= 120
  and (customer_phone is null or customer_phone ~ '^[0-9 +()-]{8,20}$')
  and length(page_path) <= 200
);
drop policy if exists "Admins can view booking funnel events" on public.customer_tracking_events;
create policy "Admins can view booking funnel events"
on public.customer_tracking_events for select to authenticated
using (exists (
  select 1 from public.user_profiles up
  where up.user_id = auth.uid() and up.role = 'admin'
));
