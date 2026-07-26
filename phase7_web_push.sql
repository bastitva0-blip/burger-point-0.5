-- ══════════════════════════════════════════════════════════
--  BURGER POINT — Phase 7: Web Push Infrastructure
--  Run in Supabase SQL Editor before deploying the Edge Function.
-- ══════════════════════════════════════════════════════════

-- 1. push_subscriptions table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint       text        NOT NULL UNIQUE,
  p256dh         text        NOT NULL,
  auth           text        NOT NULL,
  user_type      text        NOT NULL DEFAULT 'customer', -- 'customer' | 'rider'
  phone          text,
  rider_id       uuid        REFERENCES public.riders(rider_id) ON DELETE SET NULL,
  subscribed_at  timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- 2. RLS: anon can insert/upsert their own subscription
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon insert push sub"  ON public.push_subscriptions;
DROP POLICY IF EXISTS "anon select push sub"  ON public.push_subscriptions;
DROP POLICY IF EXISTS "anon update push sub"  ON public.push_subscriptions;

CREATE POLICY "anon insert push sub" ON public.push_subscriptions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon update push sub" ON public.push_subscriptions FOR UPDATE TO anon USING (true);
CREATE POLICY "anon select push sub" ON public.push_subscriptions FOR SELECT TO anon USING (true);

-- 3. Add VAPID public key + earning_per_km to business_settings
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS vapid_public_key  text;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS earning_per_km    numeric DEFAULT 10;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS wait_dine         integer DEFAULT 15;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS wait_takeaway     integer DEFAULT 20;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS wait_delivery     integer DEFAULT 40;

-- 4. Confirm
SELECT 'push_subscriptions created' AS status, COUNT(*) AS rows FROM public.push_subscriptions
UNION ALL
SELECT 'business_settings vapid_public_key' AS status, COUNT(*) AS rows
  FROM information_schema.columns
  WHERE table_name = 'business_settings' AND column_name = 'vapid_public_key';
