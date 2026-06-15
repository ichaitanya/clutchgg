import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// claim-referral — called ONCE, right after a new player account is created, when
// the sign-up came through someone's referral link (?ref=CODE). Records the
// referral and stamps player_accounts.referred_by (write-once, service-role only).
// The referral starts 'pending' and is flipped to 'verified' automatically by the
// mark_referral_verified trigger when the referred user links both Google + Discord.
//
// Anti-abuse: a user can only ever be referred ONCE (unique referred_id + the
// write-once referred_by guard); self-referral is rejected; an unknown code is a
// no-op (not an error, so the sign-up flow never breaks).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const referredId = userData.user.id;

  let body: { code?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const code = (body.code ?? "").trim().toLowerCase();
  if (!code) return json({ ok: true, applied: false, reason: "no_code" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The referred account must exist and must NOT already have a referrer
  // (write-once). If it already has one, this is a no-op success.
  const { data: me } = await admin
    .from("player_accounts").select("id, referred_by").eq("id", referredId).maybeSingle();
  if (!me) return json({ error: "No player account yet" }, 409);
  if (me.referred_by) return json({ ok: true, applied: false, reason: "already_referred" });

  // Resolve the referrer by code.
  const { data: referrer } = await admin
    .from("player_accounts").select("id").eq("referral_code", code).maybeSingle();
  if (!referrer) return json({ ok: true, applied: false, reason: "unknown_code" });

  // No self-referral.
  if (referrer.id === referredId) return json({ ok: true, applied: false, reason: "self_referral" });

  // Stamp referred_by (service_role bypasses the write-once guard) …
  const { error: stampErr } = await admin
    .from("player_accounts").update({ referred_by: referrer.id }).eq("id", referredId);
  if (stampErr) return json({ error: `Could not record referrer: ${stampErr.message}` }, 500);

  // … and insert the referral row. The unique (referred_id) index makes a double
  // call a harmless 23505 we swallow as already-applied.
  const { error: insErr } = await admin.from("referrals").insert({
    referrer_id: referrer.id,
    referred_id: referredId,
    code,
    status: "pending",
  });
  if (insErr && !`${insErr.message}`.includes("duplicate")) {
    return json({ error: `Could not record referral: ${insErr.message}` }, 500);
  }

  return json({ ok: true, applied: true });
});
