import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// decide-claim — superadmin approves or rejects a pending profile claim.
// Runs with the service role so it can atomically (a) flip the claim status
// and (b) set player_accounts.riot_id_verified, which the identity-flag
// trigger freezes for every non-service-role writer. Clients have no UPDATE
// policy on player_claims, so this function is the only decision path.

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

// MUST match verify-riot-claim and src/app/utils/riotId.ts so both sides
// collapse to the same string when we re-check the card at approval time.
const normalizeRiotId = (s: string) =>
  s.normalize("NFKC").replace(/\s*#\s*/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1. Caller must be a superadmin (and NOT the claimant — to prevent self-approval).
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const callerId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", callerId)
    .single();
  if (callerProfile?.role !== "superadmin") {
    return json({ error: "Forbidden: superadmin only" }, 403);
  }

  // 2. Parse body.
  let body: { claimId?: string; decision?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { claimId, decision } = body;
  if (!claimId || (decision !== "approved" && decision !== "rejected")) {
    return json({ error: "claimId and decision ('approved'|'rejected') are required" }, 400);
  }

  // 3a. For an approval, prevent self-approval (separation of duties): a
  //     superadmin cannot approve their own claim. Even if they could edit the
  //     tournament blob (thus cheat), the claim flow exists to verify ownership
  //     independent of admin control.
  if (decision === "approved") {
    const { data: claimRow } = await admin
      .from("player_claims")
      .select("user_id, status, tournament_id, player_id, riot_id")
      .eq("id", claimId)
      .maybeSingle();
    if (!claimRow) return json({ error: "Claim not found" }, 404);
    if (claimRow.status !== "pending") return json({ status: claimRow.status, alreadyDecided: true });
    if (claimRow.user_id === callerId) {
      return json({ error: "Forbidden: cannot approve your own claim. Ask another superadmin." }, 403);
    }
    const { data: acct } = await admin
      .from("player_accounts")
      .select("is_verified")
      .eq("id", claimRow.user_id)
      .maybeSingle();
    if (!acct?.is_verified) {
      return json({ error: "Claimant is no longer verified (Google + Discord). Ask them to re-link before approving." }, 409);
    }

    // Re-check the card's CURRENT Riot ID against the claim's snapshot. The
    // claim verified the match at submit time, but tournaments_blob is mutable:
    // an organizer may have edited the card's riotId between submission and
    // approval. Approving anyway would stamp a verified badge against a card
    // that no longer matches the claimant's Discord-verified Riot ID. Refuse,
    // so the admin asks the claimant to re-claim against the current card.
    const { data: blobRow } = await admin
      .from("tournaments_blob")
      .select("data")
      .eq("id", claimRow.tournament_id)
      .maybeSingle();
    const tournament = (blobRow?.data ?? null) as any;
    const allTeams = tournament
      ? [...(tournament.teams ?? []), ...(tournament.qualifiedTeams ?? [])]
      : [];
    const cardRiotIds = new Set<string>();
    for (const team of allTeams) {
      for (const pl of team.players ?? []) {
        if (pl.id === claimRow.player_id && (pl.riotId ?? "").trim()) {
          cardRiotIds.add(normalizeRiotId(pl.riotId));
        }
      }
    }
    const claimedRiot = normalizeRiotId(claimRow.riot_id ?? "");
    // The card must still carry exactly the Riot ID this claim was verified
    // against — no copy, no edit that changed or removed it.
    if (cardRiotIds.size !== 1 || !cardRiotIds.has(claimedRiot)) {
      return json({
        error:
          "The player card's Riot ID has changed since this claim was submitted (or was removed). Ask the claimant to re-claim against the current card.",
        reason: "card_riot_id_changed",
      }, 409);
    }
  }

  // 3b. Decide — only a pending claim can be decided (idempotency guard: a
  //    double-click or retry finds no pending row and reports the prior state).
  const { data: updated, error: updErr } = await admin
    .from("player_claims")
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: userData.user.id,
    })
    .eq("id", claimId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (updErr) return json({ error: `Failed to update claim: ${updErr.message}` }, 500);

  if (!updated) {
    const { data: existing } = await admin
      .from("player_claims")
      .select("status")
      .eq("id", claimId)
      .maybeSingle();
    if (!existing) return json({ error: "Claim not found" }, 404);
    return json({ status: existing.status, alreadyDecided: true });
  }

  // 4. Approval marks the claimant's Riot ID as verified (trigger permits this
  //    only for service_role — exactly this path).
  if (decision === "approved") {
    const { error: accErr } = await admin
      .from("player_accounts")
      .update({ riot_id: updated.riot_id, riot_id_verified: true })
      .eq("id", updated.user_id);
    if (accErr) {
      // Roll the claim back to pending so a retry can complete the pair —
      // never leave an approved claim without the verified flag.
      await admin.from("player_claims")
        .update({ status: "pending", decided_at: null, decided_by: null })
        .eq("id", claimId);
      return json({ error: `Failed to verify account: ${accErr.message}` }, 500);
    }
  }

  return json({ status: decision, claim: updated });
});
