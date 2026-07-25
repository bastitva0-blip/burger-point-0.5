-- ══════════════════════════════════════════════════════════
--  BURGER POINT — Phase 6: Missing Columns Migration
--  Run this in Supabase → SQL Editor.
--  Safe to re-run (all statements are idempotent).
-- ══════════════════════════════════════════════════════════

-- ── 1. orders — 5 columns written by code but never defined ─

-- Written when admin cancels an order
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_reason   text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_at    timestamptz;

-- Written at order placement for delivery orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_lat         double precision;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_lng         double precision;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_distance_km numeric;


-- ── 2. business_settings — 3 wait-time columns written by  ─
--       the admin "Wait Times" panel and read by the customer
--       ETA countdown, but never defined in any phase SQL.

ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS wait_dine     integer DEFAULT 15;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS wait_takeaway integer DEFAULT 20;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS wait_delivery integer DEFAULT 40;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS gst_number    text    DEFAULT '09ACOFA177BK1ZS';

-- Persist defaults into the existing row (no-op if already set)
UPDATE public.business_settings
SET
  wait_dine     = COALESCE(wait_dine,     15),
  wait_takeaway = COALESCE(wait_takeaway, 20),
  wait_delivery = COALESCE(wait_delivery, 40),
  gst_number    = COALESCE(gst_number,    '09ACOFA177BK1ZS')
WHERE id = 1;


-- ── 3. RLS: ensure anon can UPDATE business_settings ────────
--       (AdminApp uses anon key — no Supabase Auth session)
DROP POLICY IF EXISTS "Anyone can update settings" ON public.business_settings;
CREATE POLICY "Anyone can update settings"
  ON public.business_settings FOR UPDATE USING (true);


-- ── 4. Confirm — shows every column now in each table ───────
SELECT 'orders' AS tbl, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders'

UNION ALL

SELECT 'business_settings', column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'business_settings'

ORDER BY tbl, column_name;
