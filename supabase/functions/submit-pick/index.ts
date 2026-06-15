import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// submit-pick — a verified player submits or changes their answer to a pickem
// question. This is the security core of the pickems feature. Clients have NO
// INSERT/UPDATE policy on pickem_picks, so this function is the only write path,
// and it enforces, server-side and atomically:
//   1. the caller is a fully VERIFIED player (Google + Discord linked)
//   2. the question is still OPEN — lock is re-derived LIVE from the match's
//      date/time in tournaments_blob, never trusted from a client or a snapshot
//   3. the chosen option is one of the question's real options
//   4. the player is within their pick QUOTA (counted server-side)
// is_correct / points are NEVER accepted from the client — only grade-pickems
// sets them.

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

// Find a match by id across every bracket a tournament can carry (single-stage
// generatedBracket, or two-stage stage1/stage2). Mirrors getStageOptions in
// src/app/components/StatsPage.tsx + the matches derivation in TournamentPage.
function findMatch(tournament: any, matchId: string): any | null {
  const brackets = [
    tournament?.generatedBracket,
    tournament?.stage1Bracket,
    tournament?.stage2Bracket,
    tournament?.knockoutBracket,
  ].filter(Boolean);
  for (const b of brackets) {
    for (const round of b.rounds ?? []) {
      for (const m of round ?? []) {
        if (m?.id === matchId) return m;
      }
    }
  }
  return null;
}

// Effective lock time for a match, in ms since epoch, or null if the match has
// no scheduled date (then it never AUTO-locks; only an explicit organizer lock
// or a non-'open' status closes it). Parsed as UTC for a deterministic,
// non-spoofable server-side decision.
function matchLockMs(match: any): number | null {
  const date: string | undefined = match?.date;
  if (!date) return null;
  const time: string = match?.time || "00:00";
  const ms = Date.parse(`${date}T${time}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1. Authenticate the caller.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  // 2. Parse + validate body.
  let body: { questionId?: string; optionId?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { questionId, optionId } = body;
  if (!questionId || !optionId) {
    return json({ error: "questionId and optionId are required" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Participation gate: must be a fully verified player.
  const { data: acct } = await admin
    .from("player_accounts")
    .select("is_verified")
    .eq("id", userId)
    .maybeSingle();
  if (!acct) return json({ error: "No player account", reason: "no_account" }, 403);
  if (!acct.is_verified) {
    return json({
      error: "Verify your account (Google + Discord) to play pickems.",
      reason: "not_verified",
    }, 403);
  }

  // 4. Load the question.
  const { data: q } = await admin
    .from("pickem_questions")
    .select("id, tournament_id, match_id, options, status, locks_at")
    .eq("id", questionId)
    .maybeSingle();
  if (!q) return json({ error: "Question not found" }, 404);

  // 5. Whitelist the option.
  const optionIds = new Set((q.options as any[]).map((o) => String(o.id)));
  if (!optionIds.has(String(optionId))) {
    return json({ error: "Invalid option for this question", reason: "bad_option" }, 400);
  }

  // 6. Lock check — re-derived LIVE so neither a stale snapshot nor a client
  //    clock can be used to pick after a match has started. The question's own
  //    status (locked/graded/void, set by the organizer or grader) also closes it.
  if (q.status !== "open") {
    return json({ error: "Picks are locked for this question.", reason: "locked" }, 409);
  }
  const { data: blobRow } = await admin
    .from("tournaments_blob")
    .select("data")
    .eq("id", q.tournament_id)
    .maybeSingle();
  const tournament = (blobRow?.data ?? null) as any;
  const match = tournament ? findMatch(tournament, q.match_id) : null;
  // Dangling guard (exploit 8): if the tournament/match no longer exists in the
  // blob (deleted/rebuilt bracket), refuse rather than fall back to a stale
  // snapshot that could leave the question pickable forever.
  if (!match) {
    return json({ error: "This match is no longer available.", reason: "locked" }, 409);
  }
  const lockMs = matchLockMs(match);
  if (lockMs !== null && Date.now() >= lockMs) {
    return json({ error: "Picks are locked — the match has started.", reason: "locked" }, 409);
  }
  // If the match already has a recorded winner, treat it as locked regardless of
  // the schedule (covers matches played early / rescheduled).
  if (match.winner) {
    return json({ error: "Picks are locked — the match is decided.", reason: "locked" }, 409);
  }

  // 7. Quota — only a NEW question consumes allowance; changing an existing pick
  //    is free. Counted server-side via pickem_quota (cannot be inflated).
  const { data: existingPick } = await admin
    .from("pickem_picks")
    .select("id")
    .eq("user_id", userId)
    .eq("question_id", questionId)
    .maybeSingle();

  if (!existingPick) {
    const { data: quotaRows } = await admin.rpc("pickem_quota", { uid: userId });
    const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;
    if (quota && !quota.unlimited && quota.used >= quota.allowance) {
      return json({
        error: "You've used all your free picks. Invite friends to unlock more.",
        reason: "quota_exceeded",
        used: quota.used,
        allowance: quota.allowance,
      }, 402);
    }
  }

  // 8. Upsert the pick. is_correct/points_awarded are left to their defaults /
  //    prior values — grading is the only thing that sets them.
  const { error: upErr } = await admin
    .from("pickem_picks")
    .upsert(
      {
        user_id: userId,
        question_id: questionId,
        tournament_id: q.tournament_id,
        option_id: String(optionId),
      },
      { onConflict: "user_id,question_id" },
    );
  if (upErr) {
    // The enforce_pickem_quota trigger is the atomic source of truth for the cap
    // (the step-7 check above is a fast pre-check that can lose a concurrency
    // race). Surface its rejection as the same quota_exceeded reason.
    if (`${upErr.message}`.includes("pickem quota exceeded")) {
      const { data: qx } = await admin.rpc("pickem_quota", { uid: userId });
      const quota = Array.isArray(qx) ? qx[0] : qx;
      return json({ error: "You've used all your free picks. Invite friends to unlock more.", reason: "quota_exceeded", quota: quota ?? null }, 402);
    }
    return json({ error: `Could not save pick: ${upErr.message}` }, 500);
  }

  // Return fresh quota so the UI can update the "picks left" counter.
  const { data: q2Rows } = await admin.rpc("pickem_quota", { uid: userId });
  const quota2 = Array.isArray(q2Rows) ? q2Rows[0] : q2Rows;
  return json({
    ok: true,
    optionId: String(optionId),
    quota: quota2 ?? null,
  });
});
