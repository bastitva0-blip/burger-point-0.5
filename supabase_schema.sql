-- ══════════════════════════════════════════════════════════
--  BURGER POINT — New Supabase Tables
--  Run these in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════

-- 1. MENU ITEMS (dynamic menu management from admin)
create table if not exists menu_items (
  id            text primary key,
  name          text          not null,
  category      text          not null,
  price         integer       not null,
  img           text,
  description   text          default '',
  is_available  boolean       default true,
  variants      jsonb,        -- e.g. [{"label":"Half","price":139},{"label":"Full","price":269}]
  addons        jsonb         default '[]'::jsonb,
  --   addons format examples:
  --   {"id":"cheese","label":"Extra Cheese","type":"toggle","price":20}
  --   {"id":"spice","label":"Spice Level","type":"select","options":["Mild","Medium","Extra Hot"],"price":0}
  sort_order    integer       default 0,
  created_at    timestamptz   default now()
);

-- RLS: admins can do everything; customers can only read available items
alter table menu_items enable row level security;

create policy "Anyone can read available menu items"
  on menu_items for select using (is_available = true);

create policy "Admins can manage menu items"
  on menu_items for all using (auth.role() = 'authenticated');

-- 2. COUPONS / PROMO CODES
create table if not exists coupons (
  id             uuid          primary key default gen_random_uuid(),
  code           text          unique not null,
  discount_type  text          not null check (discount_type in ('flat','percent')),
  discount_value integer       not null,
  min_order      integer       default 0,
  max_discount   integer,      -- cap for percent type (null = no cap)
  expiry         date,         -- null = never expires
  is_active      boolean       default true,
  created_at     timestamptz   default now()
);

alter table coupons enable row level security;

-- Customers can read active, non-expired coupons (to validate at checkout)
create policy "Anyone can read active coupons"
  on coupons for select using (is_active = true);

create policy "Admins can manage coupons"
  on coupons for all using (auth.role() = 'authenticated');

-- 3. TABLE RESERVATIONS
create table if not exists reservations (
  id          uuid          primary key default gen_random_uuid(),
  name        text          not null,
  phone       text          not null,
  date        date          not null,
  time        text          not null,
  guests      integer       not null default 2,
  note        text          default '',
  status      text          default 'pending' check (status in ('pending','confirmed','cancelled')),
  created_at  timestamptz   default now()
);

alter table reservations enable row level security;

create policy "Anyone can insert reservations"
  on reservations for insert with check (true);

create policy "Admins can manage reservations"
  on reservations for all using (auth.role() = 'authenticated');

-- 4. BUSY MODE (single-row table — id is always 1)
create table if not exists busy_mode (
  id         integer       primary key default 1 check (id = 1),
  is_busy    boolean       default false,
  message    text          default 'We are currently closed. Please check back later.',
  opens_at   text          default ''   -- e.g. "11:00 AM"
);

-- Insert the one allowed row if it doesn't exist yet
insert into busy_mode (id, is_busy) values (1, false)
  on conflict (id) do nothing;

alter table busy_mode enable row level security;

create policy "Anyone can read busy mode"
  on busy_mode for select using (true);

create policy "Admins can update busy mode"
  on busy_mode for all using (auth.role() = 'authenticated');

-- 5. ORDER RATINGS / REVIEWS
create table if not exists reviews (
  id          uuid          primary key default gen_random_uuid(),
  order_id    uuid          references orders(id) on delete set null,
  rating      text          check (rating in ('up','down')),
  created_at  timestamptz   default now()
);

alter table reviews enable row level security;

create policy "Anyone can insert a review"
  on reviews for insert with check (true);

create policy "Admins can read reviews"
  on reviews for select using (auth.role() = 'authenticated');

-- ══════════════════════════════════════════════════════════
--  OPTIONAL: add columns to existing orders table
--  (only run if these columns don't already exist)
-- ══════════════════════════════════════════════════════════

alter table orders add column if not exists discount   integer default 0;
alter table orders add column if not exists promo_code text;
