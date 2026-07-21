-- ══════════════════════════════════════════════════════════
--  BURGER POINT — Phase 5: Printing Support Migration
--  Adds GST number field to business_settings so it can be
--  printed on customer invoices via the ESC/POS printer.
--  Safe to re-run (all statements are idempotent).
-- ══════════════════════════════════════════════════════════

-- ── 1. Add gst_number column to business_settings ─────────
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS gst_number text DEFAULT '09ACOFA177BK1ZS';

-- ── 2. Persist the default value into the existing row ────
UPDATE business_settings
SET gst_number = '09ACOFA177BK1ZS'
WHERE id = 1 AND gst_number IS NULL;

-- ── 3. Ensure the orders table has all columns the invoice
--       builder reads (safe no-ops if columns exist already) ─
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packing_charge  numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gst_amount      numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee    numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount        integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code      text;

-- ── 4. RLS — business_settings must stay readable by anon
--       (the admin app uses the anon key, no Supabase Auth) ─
DROP POLICY IF EXISTS "Anyone can read settings"   ON business_settings;
DROP POLICY IF EXISTS "Anyone can update settings" ON business_settings;

CREATE POLICY "Anyone can read settings"
  ON business_settings FOR SELECT USING (true);

-- Update is intentionally open to anon because AdminApp uses
-- a client-side password check, not Supabase Auth.
-- Tighten to `TO authenticated` once real auth is added.
CREATE POLICY "Anyone can update settings"
  ON business_settings FOR UPDATE USING (true);

-- ── 5. Confirm ────────────────────────────────────────────
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'business_settings'
  AND table_schema = 'public'
ORDER BY ordinal_position;
