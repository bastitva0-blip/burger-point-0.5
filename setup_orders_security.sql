-- ══════════════════════════════════════════════════════════
--  BURGER POINT — Orders table security setup
--  Run this in Supabase → SQL Editor. Safe to re-run.
-- ══════════════════════════════════════════════════════════

-- Make sure the new columns used by promo codes exist
alter table orders add column if not exists discount   integer default 0;
alter table orders add column if not exists promo_code text;

-- Remove any old, fully-open policies from earlier setup attempts
drop policy if exists "anon_select_orders"        on public.orders;
drop policy if exists "anon_update_orders"         on public.orders;
drop policy if exists "anon_insert_orders"         on public.orders;
drop policy if exists "authenticated_select_orders" on public.orders;
drop policy if exists "authenticated_update_orders" on public.orders;

-- Customers (anon) can only insert new orders, and only as "pending"
create policy "anon_insert_orders"
  on public.orders for insert to anon
  with check (status = 'pending');

-- Only a logged-in admin (real Supabase Auth user) can read or update orders
create policy "authenticated_select_orders"
  on public.orders for select to authenticated
  using (true);

create policy "authenticated_update_orders"
  on public.orders for update to authenticated
  using (true);

alter table public.orders enable row level security;

-- Narrow, PII-free function customers use to poll their own order status —
-- returns only status/rider info, never name/phone/address.
create or replace function public.get_order_status(p_order_id uuid)
returns table(status text, rider_name text, rider_phone text, order_type text)
language sql security definer set search_path = public
as $$
  select status, rider_name, rider_phone, order_type
  from public.orders where id = p_order_id;
$$;

grant execute on function public.get_order_status(uuid) to anon, authenticated;
