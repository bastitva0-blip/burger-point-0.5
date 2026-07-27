import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUB     = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIV    = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? Deno.env.get("VAPID_MAILTO") ?? "mailto:admin@burgerpoint.co.in";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Import VAPID private key using JWK (the correct format for EC private keys) ──
async function getSigningKey(): Promise<CryptoKey> {
  // VAPID_PUB is an uncompressed EC point: 0x04 || 32-byte X || 32-byte Y
  const pubRaw = Uint8Array.from(
    atob(VAPID_PUB.replace(/-/g, "+").replace(/_/g, "/")),
    c => c.charCodeAt(0),
  );
  const toB64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const x = toB64url(pubRaw.slice(1, 33));
  const y = toB64url(pubRaw.slice(33, 65));

  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: VAPID_PRIV, x, y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// ── Build VAPID JWT ──
async function signVapid(audience: string): Promise<string> {
  const b64url = (s: string) =>
    btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const header  = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const now     = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ aud: audience, exp: now + 86400, sub: VAPID_SUBJECT }));
  const toSign  = `${header}.${payload}`;

  const key = await getSigningKey();
  const sig  = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(toSign),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  return `${toSign}.${sigB64}`;
}

// ── Send one push notification ──
async function sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<boolean> {
  try {
    const url      = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt      = await signVapid(audience);

    const authSecret  = Uint8Array.from(atob(sub.auth.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
    const receiverPub = Uint8Array.from(atob(sub.p256dh.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));

    const senderKeys   = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", senderKeys.publicKey));
    const receiverKey  = await crypto.subtle.importKey("raw", receiverPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const sharedBits   = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, senderKeys.privateKey, 256));
    const salt         = crypto.getRandomValues(new Uint8Array(16));

    const concat = (...arrays: Uint8Array[]) => { const out = new Uint8Array(arrays.reduce((n,a)=>n+a.length,0)); let i=0; for(const a of arrays){out.set(a,i);i+=a.length;} return out; };
    const enc    = (s: string) => new TextEncoder().encode(s);
    const lenBuf = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, false); return b; };

    const ikmKey = await crypto.subtle.importKey("raw", concat(authSecret, sharedBits), "HKDF", false, ["deriveBits"]);
    const prk    = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: authSecret, info: concat(enc("WebPush: info\0"), receiverPub, senderPubRaw) },
      ikmKey, 256
    ));

    const hkdf = async (info: Uint8Array, len: number) => {
      const k = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
      return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info }, k, len * 8));
    };

    const keyInfo   = concat(enc("Content-Encoding: aes128gcm\0"), salt, lenBuf(senderPubRaw.length), senderPubRaw, enc("Content-Encoding: aes128gcm\0"), new Uint8Array(1));
    const nonceInfo = concat(enc("Content-Encoding: aes128gcm\0"), salt, lenBuf(senderPubRaw.length), senderPubRaw, enc("Content-Encoding: nonce\0"),       new Uint8Array(1));
    const cek   = await hkdf(keyInfo,   16);
    const nonce = await hkdf(nonceInfo, 12);

    const aesKey     = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
    const plaintext  = concat(enc(payload), new Uint8Array([2]));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

    const rs   = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false);
    const body = concat(salt, rs, new Uint8Array([senderPubRaw.length]), senderPubRaw, ciphertext);

    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type":     "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "Authorization":    `vapid t=${jwt},k=${VAPID_PUB}`,
        "TTL":              "86400",
      },
      body,
    });

    if (res.status === 410 || res.status === 404) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      return false;
    }
    return res.ok;
  } catch (e) {
    console.error("sendOne failed:", e);
    return false;
  }
}

// ── Main handler ──
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { title, message, audience = "all", url = "/" } =
      await req.json() as { title: string; message: string; audience?: string; url?: string };

    if (!title || !message) {
      return new Response(JSON.stringify({ error: "title and message required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    let query = supabase.from("push_subscriptions").select("endpoint, p256dh, auth");
    if (audience === "customers") query = query.eq("role", "customer");
    else if (audience === "riders") query = query.eq("role", "rider");

    const { data: subs, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    if (!subs?.length) {
      return new Response(JSON.stringify({ sent: 0, message: "No subscribers" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const notifPayload = JSON.stringify({ title, body: message, icon: "/icon-192.png", url });
    const results = await Promise.allSettled(subs.map(s => sendOne(s, notifPayload)));
    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
