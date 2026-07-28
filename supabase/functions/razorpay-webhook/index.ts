/**
 * BURGER POINT — Razorpay Webhook Handler
 * Supabase Edge Function: supabase/functions/razorpay-webhook/index.ts
 *
 * Razorpay calls this URL directly — no frontend dependency.
 * Verifies HMAC-SHA256 signature, then marks the order as payment_verified.
 *
 * Deploy:
 *   supabase functions deploy razorpay-webhook --no-verify-jwt
 *
 * Env vars to set in Supabase Dashboard → Edge Functions → razorpay-webhook:
 *   RAZORPAY_WEBHOOK_SECRET  → from Razorpay Dashboard → Webhooks
 *   SUPABASE_URL             → auto-injected by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY → auto-injected by Supabase
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.177.0/encoding/hex.ts";

// ── Env ────────────────────────────────────────────────────────────────────
const WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service-role client — bypasses RLS so we can update any order
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── HMAC-SHA256 signature verification ────────────────────────────────────
async function verifySignature(body: string, header: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const computed = new TextDecoder().decode(hexEncode(new Uint8Array(sig)));
    return computed === header;
  } catch {
    return false;
  }
}

// ── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Razorpay only sends POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody    = await req.text();
  const sigHeader  = req.headers.get("x-razorpay-signature") ?? "";

  // 1. Verify signature — reject anything that doesn't match
  const valid = await verifySignature(rawBody, sigHeader);
  if (!valid) {
    console.error("Webhook signature mismatch");
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const event = payload.event as string;
  console.log("Razorpay webhook event:", event);

  // ── Event: payment.captured ──────────────────────────────────────────────
  // Fires when money actually lands — this is the authoritative success signal.
  if (event === "payment.captured") {
    const payment      = payload.entity ?? payload.payload?.payment?.entity;
    const paymentId    = payment?.id as string;          // e.g. pay_XXXXX
    const amountPaise  = payment?.amount as number;      // in paise
    const notes        = payment?.notes ?? {};           // optional notes from order creation

    if (!paymentId) {
      return new Response("Missing payment id", { status: 400 });
    }

    // Option A: order_id stored in payment notes (if you pass it during order creation)
    // Option B: match by razorpay_payment_id column (works with current frontend flow)
    const orderId = notes?.burger_point_order_id as string | undefined;

    let updateResult;

    if (orderId) {
      // Direct match by Burger Point order UUID — most reliable
      updateResult = await supabase
        .from("orders")
        .update({
          payment_verified:    true,
          payment_verified_at: new Date().toISOString(),
          razorpay_payment_id: paymentId,
          payment_amount_paise: amountPaise,
        })
        .eq("id", orderId);
    } else {
      // Fallback: match by payment ID (set by frontend after checkout.js success)
      updateResult = await supabase
        .from("orders")
        .update({
          payment_verified:    true,
          payment_verified_at: new Date().toISOString(),
          payment_amount_paise: amountPaise,
        })
        .eq("razorpay_payment_id", paymentId);
    }

    if (updateResult.error) {
      console.error("DB update failed:", updateResult.error.message);
      // Return 200 anyway — Razorpay retries on non-2xx, causing duplicate events
      return new Response(JSON.stringify({ ok: false, error: updateResult.error.message }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Log to razorpay_events for audit trail
    await supabase.from("razorpay_events").insert({
      event:              "webhook.payment.captured",
      amount:             Math.round(amountPaise / 100),
      razorpay_payment_id: paymentId,
      created_at:         new Date().toISOString(),
    }).throwOnError().catch(e => console.warn("Event log failed:", e));

    console.log("✅ payment.captured processed:", paymentId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Event: payment.failed ────────────────────────────────────────────────
  if (event === "payment.failed") {
    const payment   = payload.entity ?? payload.payload?.payment?.entity;
    const paymentId = payment?.id as string;

    await supabase.from("razorpay_events").insert({
      event:              "webhook.payment.failed",
      amount:             Math.round((payment?.amount ?? 0) / 100),
      razorpay_payment_id: paymentId ?? null,
      error_description:  payment?.error_description ?? null,
      error_code:         payment?.error_code ?? null,
      created_at:         new Date().toISOString(),
    }).throwOnError().catch(e => console.warn("Event log failed:", e));

    console.log("❌ payment.failed logged:", paymentId);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // ── All other events: acknowledge and ignore ─────────────────────────────
  return new Response(JSON.stringify({ ok: true, note: "event ignored" }), { status: 200 });
});
