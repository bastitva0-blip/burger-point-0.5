import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "https://esm.sh/web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUB    = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIV   = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_MAILTO = Deno.env.get("VAPID_SUBJECT") ?? Deno.env.get("VAPID_MAILTO") ?? "mailto:admin@burgerpoint.co.in";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

webpush.setVapidDetails(VAPID_MAILTO, VAPID_PUB, VAPID_PRIV);

async function sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    );
    return true;
  } catch (e: any) {
    if (e?.statusCode === 410 || e?.statusCode === 404) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    } else {
      console.error("sendOne failed:", e?.statusCode, e?.body);
    }
    return false;
  }
}

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
