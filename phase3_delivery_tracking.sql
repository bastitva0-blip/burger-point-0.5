-- ══════════════════════════════════════════════════════════
--  BURGER POINT — Phase 3: Delivery Tracking Migration
--  Safe to re-run.
-- ══════════════════════════════════════════════════════════

-- Route data stored once when admin dispatches order
ALTER TABLE orders ADD COLUMN IF NOT EXISTS route_geometry      jsonb;         -- [[lat,lng], ...] road coordinates
ALTER TABLE orders ADD COLUMN IF NOT EXISTS route_distance_km   numeric;       -- actual road distance
ALTER TABLE orders ADD COLUMN IF NOT EXISTS route_eta_minutes   integer;       -- estimated minutes
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz;   -- when rider left restaurant

-- Bestseller support (from Phase 2 upgrade)
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_bestseller_manual boolean DEFAULT null;

-- Razorpay payment ID storage
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id text;

-- Riders JSON stored in busy_mode
ALTER TABLE busy_mode ADD COLUMN IF NOT EXISTS riders_json text;

-- RLS: allow anon to read/write orders (needed since we removed Supabase Auth)
DROP POLICY IF EXISTS "anon_select_orders"      ON public.orders;
DROP POLICY IF EXISTS "anon_update_orders"      ON public.orders;
DROP POLICY IF EXISTS "anon_insert_orders"      ON public.orders;
CREATE POLICY "anon_select_orders" ON public.orders FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_orders" ON public.orders FOR UPDATE TO anon USING (true);
CREATE POLICY "anon_insert_orders" ON public.orders FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_menu_items"     ON menu_items;
DROP POLICY IF EXISTS "anon_all_coupons"        ON coupons;
DROP POLICY IF EXISTS "anon_all_reservations"   ON reservations;
DROP POLICY IF EXISTS "anon_all_busy_mode"      ON busy_mode;
CREATE POLICY "anon_all_menu_items"   ON menu_items   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_coupons"      ON coupons      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_reservations" ON reservations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_busy_mode"    ON busy_mode    FOR ALL TO anon USING (true) WITH CHECK (true);
