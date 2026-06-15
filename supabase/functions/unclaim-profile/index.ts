import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// unclaim-profile — releases a profile claim so the user (or a superadmin) can
// free it up. The claimant may release their OWN claim; a superadmin may
// release anyone's. Deleting the row frees both the per-card and per-user
// unique indexes, letting the user claim a different card. If the released
// claim was approved, the account's riot_id_verified is cleared too (runs as
// service role — the only path the 006 trigger allows to change that flag).
//
// We DELETE rather than set status='rejected' so the user can cleanly re-claim
// the same card later if needed (a rejected row would block re-claim of that
// card via one_active_claim_per_card only excludes rejected — but keeping the
// row would clutter; delete is simplest and leaves no trace blocking them).

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

  // 1. Identify the caller.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const callerId = userData.user.id;

  // 2. Parse body.
  let body: { claimId?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { claimId } = body;
  if (!claimId) return json({ error: "claimId is required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Load the claim and authorize: owner OR superadmin.
  const { data: claim } = await admin
    .from("player_claims")
    .select("id, user_id, status")
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) return json({ status: "not_found" });

  let isSuperadmin = false;
  if (claim.user_id !== callerId) {
    const { data: prof } = await admin
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .maybeSingle();
    isSuperadmin = prof?.role === "superadmin";
    if (!isSuperadmin) return json({ error: "Forbidden: not your claim" }, 403);
  }

  // 4. If it was approved, clear the verified flag on the claimant's account
  //    BEFORE deleting, so an approved profile never lingers as "verified"
  //    without a backing claim.
  if (claim.status === "approved") {
    await admin
      .from("player_accounts")
      .update({ riot_id_verified: false })
      .eq("id", claim.user_id);
  }

  const { error: delErr } = await admin.from("player_claims").delete().eq("id", claimId);
  if (delErr) return json({ error: `Failed to unclaim: ${delErr.message}` }, 500);

  return json({ status: "unclaimed" });
});
