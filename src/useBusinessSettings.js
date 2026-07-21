import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";
import { SUPABASE_READY } from "./constants.js";

const DEFAULTS = {
  id: 1,
  restaurant_name: "Burger Point",
  logo_url: "",
  phone: "+919194008822",
  address: "60 Feet Road, Jankipuram, Lucknow - 226021",
  gst_number: "09ACOFA177BK1ZS",        // ← NEW: printed on every invoice
  opening_time: "11:00",
  closing_time: "23:00",
  emergency_close: false,
  holiday_mode: false,
  restaurant_lat: 26.8912,
  restaurant_lng: 80.9462,
  delivery_radius_km: 8,
  base_delivery_charge: 25,
  base_distance_km: 2,
  per_km_charge: 8,
  free_delivery_above: 499,
  min_order_value: 99,
  packing_charge: 10,
  gst_percent: 5,
  avg_delivery_speed_kmph: 25,
  hide_unavailable_items: false,
  version: "1.0.0",
};

// One fetch shared across every component that mounts this hook in the
// same page load, instead of a fresh Supabase call each time.
let cache = null;
let inflight = null;

async function loadSettings() {
  if (cache) return cache;
  if (inflight) return inflight;
  if (!SUPABASE_READY) { cache = DEFAULTS; return cache; }
  inflight = supabase.from("business_settings").select("*").eq("id", 1).single()
    .then(({ data }) => { cache = data ? { ...DEFAULTS, ...data } : DEFAULTS; return cache; })
    .catch(() => { cache = DEFAULTS; return cache; });
  return inflight;
}

export function useBusinessSettings() {
  const [settings, setSettings] = useState(cache || DEFAULTS);
  const [loading, setLoading]   = useState(!cache);

  useEffect(() => {
    let alive = true;
    loadSettings().then(s => { if (alive) { setSettings(s); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const refresh = useCallback(async () => {
    cache = null; inflight = null;
    const s = await loadSettings();
    setSettings(s);
    return s;
  }, []);

  const save = useCallback(async (patch) => {
    if (!SUPABASE_READY) return { error: "Supabase not configured" };
    const { data, error } = await supabase.from("business_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", 1).select().single();
    if (!error && data) { cache = { ...DEFAULTS, ...data }; setSettings(cache); }
    return { data, error };
  }, []);

  return { settings, loading, refresh, save };
}
