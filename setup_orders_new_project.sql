-- ══════════════════════════════════════════════════════════
--  BURGER POINT — Orders table, from scratch, for the
--  "burger-point-menu" project (ozgknxeaadrrlvjftdyj)
-- ══════════════════════════════════════════════════════════

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz default now(),
  table_code        text,
  table_label       text,
  order_type        text,
  customer_name     text,
  customer_phone    text,
  delivery_address  text,
  payment_method    text,
  items             jsonb,
  total             numeric,
  note              text,
  status            text default 'pending',
  rider_name        text,
  rider_phone       text,
  discount          integer default 0,
  promo_code        text
);

-- Make the orders table live for the admin dashboard's realtime feed
alter publication supabase_realtime add table public.orders;

-- Remove any old policies (safe no-op if none exist)
drop policy if exists "anon_select_orders"         on public.orders;
drop policy if exists "anon_update_orders"          on public.orders;
drop policy if exists "anon_insert_orders"          on public.orders;
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
