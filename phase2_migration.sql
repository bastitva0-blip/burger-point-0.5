-- ══════════════════════════════════════════════════════════
--  BURGER POINT — Phase 2 migration
--  Business Settings + Category enable/disable + Delivery fee
--  tracking on orders. Safe to re-run.
-- ══════════════════════════════════════════════════════════

-- ── 1. BUSINESS SETTINGS (single row, id = 1) ──────────────
create table if not exists business_settings (
  id                      integer primary key default 1 check (id = 1),
  restaurant_name         text default 'Burger Point',
  logo_url                text default '',
  phone                   text default '+919194008822',
  address                 text default 'Jankipuram, Lucknow',
  opening_time            text default '11:00',
  closing_time            text default '23:00',
  emergency_close         boolean default false,
  holiday_mode            boolean default false,

  -- Fixed restaurant location, used as the delivery-distance origin
  restaurant_lat          double precision default 26.8912,
  restaurant_lng          double precision default 80.9462,

  -- Delivery fee configuration
  delivery_radius_km      numeric default 8,
  base_delivery_charge    numeric default 25,
  base_distance_km        numeric default 2,
  per_km_charge           numeric default 8,
  free_delivery_above     numeric default 499,

  min_order_value         numeric default 99,
  packing_charge          numeric default 10,
  gst_percent             numeric default 5,
  avg_delivery_speed_kmph numeric default 25,

  -- If true, out-of-stock items are hidden entirely instead of shown
  -- greyed-out with a "Currently Unavailable" label
  hide_unavailable_items  boolean default false,

  version                 text default '1.0.0',
  updated_at              timestamptz default now()
);

insert into business_settings (id) values (1) on conflict (id) do nothing;

alter table business_settings enable row level security;
drop policy if exists "Anyone can read settings"   on business_settings;
drop policy if exists "Anyone can update settings" on business_settings;
create policy "Anyone can read settings"   on business_settings for select using (true);
create policy "Anyone can update settings" on business_settings for update using (true);
-- NOTE: update is intentionally open to the anon role for now because real
-- admin auth (Supabase Auth / Firebase) isn't wired into AdminApp yet — it's
-- just a client-side password check. Tighten this to `to authenticated`
-- once real auth is in place, same as the orders table.


-- ── 2. CATEGORIES (enable/disable whole menu sections) ─────
create table if not exists categories (
  id          text primary key,
  label       text not null,
  emoji       text default '🍽️',
  enabled     boolean default true,
  sort_order  integer default 0
);

alter table categories enable row level security;
drop policy if exists "Anyone can read categories"   on categories;
drop policy if exists "Anyone can update categories" on categories;
create policy "Anyone can read categories"   on categories for select using (true);
create policy "Anyone can update categories" on categories for update using (true);

insert into categories (id, label, emoji, sort_order) values
  ('burgers',    'Burgers',        '🍔', 0),
  ('grilled',    'Grilled Burgers','🌿', 1),
  ('pizza',      'Pizza',          '🍕', 2),
  ('pasta',      'Pasta',          '🍝', 3),
  ('sandwiches', 'Sandwiches',     '🥪', 4),
  ('wraps',      'Wraps',          '🌯', 5),
  ('chinese',    'Chinese',        '🥡', 6),
  ('noodles',    'Noodles',        '🍜', 7),
  ('rice',       'Rice & Combos',  '🍚', 8),
  ('momos',      'Momos',          '🥟', 9),
  ('quickbites', 'Quick Bites',    '🍟', 10),
  ('sizzlers',   'Sizzlers',       '🔥', 11),
  ('sides',      'On The Side',    '🍟', 12),
  ('maggi',      'Maggi',          '🍲', 13),
  ('soup',       'Soup',           '🥣', 14),
  ('corn',       'Corn & Café',    '🌽', 15),
  ('shakes',     'Shakes & Coffee','🥤', 16),
  ('mocktails',  'Mocktails',      '🍹', 17),
  ('tea',        'Tea & Coffee',   '☕', 18),
  ('sweets',     'Sweets',         '🧁', 19)
on conflict (id) do nothing;


-- ── 3. ORDERS — track delivery fee breakdown ────────────────
alter table orders add column if not exists delivery_fee          numeric default 0;
alter table orders add column if not exists packing_charge        numeric default 0;
alter table orders add column if not exists gst_amount            numeric default 0;
alter table orders add column if not exists delivery_distance_km  numeric;
alter table orders add column if not exists customer_lat          double precision;
alter table orders add column if not exists customer_lng          double precision;
