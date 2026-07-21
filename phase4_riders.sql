-- ══════════════════════════════════════════════════════════
--  BURGER POINT — Phase 4: Rider Management
--  Safe to re-run.
-- ══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS riders (
  id            serial primary key,
  rider_id      text unique not null,
  full_name     text not null,
  phone_number  text not null,
  password_hash text not null,
  active        boolean default true,
  availability  text default 'Available'
                check (availability in ('Available','Busy','Offline')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

ALTER TABLE riders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_riders" ON riders;
CREATE POLICY "anon_all_riders" ON riders FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_id     text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_status text default null;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- ── Verify rider login ────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_rider_login(p_rider_id text, p_password text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v riders%rowtype;
BEGIN
  SELECT * INTO v FROM riders WHERE rider_id = p_rider_id AND active = true;
  IF NOT FOUND THEN RETURN '{"success":false,"error":"Rider ID not found"}'; END IF;
  IF v.password_hash = crypt(p_password, v.password_hash) THEN
    RETURN json_build_object('success', true, 'rider',
      json_build_object('id',v.id,'rider_id',v.rider_id,'full_name',v.full_name,
        'phone_number',v.phone_number,'active',v.active,'availability',v.availability,
        'created_at',v.created_at));
  END IF;
  RETURN '{"success":false,"error":"Incorrect password"}';
END;$$;

-- ── Create rider with hashed password ────────────────────
CREATE OR REPLACE FUNCTION create_rider_with_password(
  p_rider_id text, p_full_name text, p_phone text, p_password text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v riders%rowtype;
BEGIN
  INSERT INTO riders (rider_id,full_name,phone_number,password_hash)
  VALUES (p_rider_id, p_full_name, p_phone, crypt(p_password, gen_salt('bf',10)))
  RETURNING * INTO v;
  RETURN json_build_object('success',true,'rider',
    json_build_object('id',v.id,'rider_id',v.rider_id,'full_name',v.full_name,
      'phone_number',v.phone_number,'active',v.active,'availability',v.availability));
EXCEPTION WHEN unique_violation THEN
  RETURN '{"success":false,"error":"Rider ID already exists"}';
END;$$;

-- ── Reset rider password ──────────────────────────────────
CREATE OR REPLACE FUNCTION reset_rider_password(p_rider_id text, p_new_password text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE riders SET password_hash=crypt(p_new_password,gen_salt('bf',10)), updated_at=now()
  WHERE rider_id=p_rider_id;
  RETURN FOUND;
END;$$;
