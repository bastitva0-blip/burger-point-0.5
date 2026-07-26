// ══════════════════════════════════════════════════════════
//  Burger Point — send-push Edge Function
//  Deploy: supabase functions deploy send-push --no-verify-jwt
//
//  Required env vars in Supabase Dashboard → Settings → Edge Functions:
//    VAPID_PUBLIC_KEY   — from: npx web-push generate-vapid-keys
//    VAPID_PRIVATE_KEY  — from: npx web-push generate-vapid-keys
//    VAPID_SUBJECT      — e.g. mailto:admin@burgerpoint.co.in
//    SUPABASE_URL       — auto-injected
//    SUPABASE_SERVICE_ROLE_KEY — auto-injected
// ══════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUB     = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIV    = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || Deno.env.get("VAPID_MAILTO") || "mailto:admin@burgerpoint.co.in";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── VAPID signing (Web Crypto API — available in Deno) ────
async function signVapid(audience: string): Promise<string> {
  const header = btoa(JSON.stringify({ typ: "JWT", alg: "ES256" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({ aud: audience, exp: now + 86400, sub: VAPID_SUBJECT })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const toSign = `${header}.${payload}`;

  const rawKey = Uint8Array.from(atob(VAPID_PRIV.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, new TextEncoder().encode(toSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return `${toSign}.${sigB64}`;
}

// ── Send a single push notification ───────────────────────
async function sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<boolean> {
  try {
    const url      = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt      = await signVapid(audience);

    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Authorization": `vapid t=${jwt},k=${VAPID_PUB}`,
        "TTL": "86400",
        "Content-Encoding": "aes128gcm",
      },
      body: new TextEncoder().encode(payload),
    });

    if (res.status === 410 || res.status === 404) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

// ── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const { title, message, audience = "all", url = "/" } = await req.json() as {
      title: string;
      message: string;
      audience?: string;
      url?: string;
    };

    if (!title || !message) {
      return new Response(JSON.stringify({ error: "title and message required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Fetch target subscriptions
    let query = supabase.from("push_subscriptions").select("endpoint, p256dh, auth");
    if (audience === "customers") query = query.eq("role", "customer");
    else if (audience === "riders")   query = query.eq("role", "rider");

    const { data: subs, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No subscribers" }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({ title, body: message, icon: "/icon-192.png", url });
    const results = await Promise.allSettled(subs.map(s => sendOne(s, payload)));
    const sent    = results.filter(r => r.status === "fulfilled" && r.value).length;

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
