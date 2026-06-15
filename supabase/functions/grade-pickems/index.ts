import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// grade-pickems — an organizer (or superadmin) grades a match's questions. Two modes:
//   • auto:     re-reads tournaments_blob and grades every auto_grade question whose
//               required stat is now available (winner, map scores, top ACS, MVP).
//   • override: body { questionId, correctOptionId } sets a single question's answer
//               (for subjective/custom questions) and regrades just it.
// After setting correct answers it grades the affected picks (is_correct / points)
// and recomputes pickem_scores for every affected user. Idempotent: re-running
// yields identical results. Clients can never write is_correct / points / scores —
// this service-role path is the only grader, so the leaderboard can't be forged.

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

function findMatch(tournament: any, matchId: string): any | null {
  const brackets = [
    tournament?.generatedBracket, tournament?.stage1Bracket,
    tournament?.stage2Bracket, tournament?.knockoutBracket,
  ].filter(Boolean);
  for (const b of brackets) {
    for (const round of b.rounds ?? []) {
      for (const m of round ?? []) if (m?.id === matchId) return m;
    }
  }
  return null;
}

// All player stat rows for a match: the match-level array plus every map's array.
function allMatchStats(match: any): any[] {
  const out: any[] = [];
  if (Array.isArray(match?.playerStats)) out.push(...match.playerStats);
  for (const map of match?.maps ?? []) {
    if (Array.isArray(map?.playerStats)) out.push(...map.playerStats);
  }
  return out;
}

// Series score (maps won by each team) from the stored maps, oriented team1/team2.
function seriesScore(match: any): { t1: number; t2: number } | null {
  const maps = match?.maps ?? [];
  if (maps.length === 0) return null;
  let t1 = 0, t2 = 0;
  for (const m of maps) {
    if (typeof m.team1Score !== "number" || typeof m.team2Score !== "number") continue;
    if (m.team1Score > m.team2Score) t1++;
    else if (m.team2Score > m.team1Score) t2++;
  }
  return { t1, t2 };
}

// Decide the correct option id for one auto-gradeable question, or:
//   null  → cannot grade yet (stat missing) — leave the question untouched
//   ""    → void (ambiguous/tie or referenced entity gone) — no points to anyone
function resolveCorrect(q: any, match: any): string | null | "" {
  const options: any[] = q.options ?? [];
  const optByTeam = (teamId: string) => options.find((o) => o?.meta?.teamId === teamId)?.id ?? null;
  const optByPlayer = (playerId: string) => options.find((o) => o?.meta?.playerId === playerId)?.id ?? null;

  switch (q.kind) {
    case "match_winner": {
      if (!match?.winner) return null;
      return optByTeam(match.winner) ?? ""; // winner not among options → void
    }
    case "map_winner": {
      const mi = q.map_index ?? 0;
      const map = (match?.maps ?? [])[mi];
      if (!map || typeof map.team1Score !== "number" || typeof map.team2Score !== "number") return null;
      if (map.team1Score === map.team2Score) return ""; // unfinished / tie → void
      const winnerTeamId = map.team1Score > map.team2Score ? match.team1Id : match.team2Id;
      return optByTeam(winnerTeamId) ?? "";
    }
    case "map_score": {
      // Series score is only meaningful once the match is decided. Until a winner
      // is recorded we wait (null) — a partial 1-0 mid-series must not grade.
      if (!match?.winner) return null;
      const s = seriesScore(match);
      if (!s) return ""; // decided but no map scores stored → can't resolve → void
      const opt = options.find((o) => o?.meta?.team1Maps === s.t1 && o?.meta?.team2Maps === s.t2);
      return opt ? opt.id : ""; // tally matched no offered option → void
    }
    case "top_acs": {
      const stats = allMatchStats(match);
      if (stats.length === 0) return null;
      // "Top ACS" = the single highest ACS value recorded in the match. When a
      // match has per-map rows for the same player we take their BEST map (max),
      // not an average — a player can't be the match's top ACS on the strength of
      // a number they never actually posted. Ties at the very top → void.
      const bestByPlayer = new Map<string, number>();
      for (const s of stats) {
        if (!s?.playerId || typeof s.acs !== "number") continue;
        const cur = bestByPlayer.get(s.playerId);
        if (cur === undefined || s.acs > cur) bestByPlayer.set(s.playerId, s.acs);
      }
      if (bestByPlayer.size === 0) return null;
      let best: { id: string; acs: number } | null = null;
      let tie = false;
      for (const [pid, acs] of bestByPlayer) {
        if (!best || acs > best.acs) { best = { id: pid, acs }; tie = false; }
        else if (acs === best.acs) tie = true;
      }
      if (!best || tie) return ""; // tie at the top → void
      return optByPlayer(best.id) ?? "";
    }
    case "mvp": {
      // Default heuristic: the match's ACS leader is the MVP. Organizers can
      // override via the override mode for a different call.
      return resolveCorrect({ ...q, kind: "top_acs" }, match);
    }
    default:
      return null; // custom → override only
  }
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
  const callerId = userData.user.id;

  let body: { tournamentId?: string; matchId?: string; questionId?: string; correctOptionId?: string; regrade?: boolean };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { tournamentId, matchId, questionId, correctOptionId, regrade } = body;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Override mode: set one question's correct answer explicitly. ──
  if (questionId && correctOptionId !== undefined) {
    const { data: q } = await admin
      .from("pickem_questions")
      .select("id, tournament_id, match_id, options, points")
      .eq("id", questionId).maybeSingle();
    if (!q) return json({ error: "Question not found" }, 404);
    if (!(await isOrganizerOf(admin, callerId, q.tournament_id))) {
      return json({ error: "Forbidden: not an organizer of this tournament" }, 403);
    }
    const valid = (q.options as any[]).some((o) => String(o.id) === String(correctOptionId));
    if (!valid && correctOptionId !== "") {
      return json({ error: "correctOptionId is not an option of this question" }, 400);
    }
    await admin.from("pickem_questions").update({
      correct_option_id: correctOptionId === "" ? null : String(correctOptionId),
      status: correctOptionId === "" ? "void" : "graded",
    }).eq("id", questionId);
    await gradePicksForQuestion(admin, q.id, correctOptionId === "" ? null : String(correctOptionId), q.points);
    await recomputeScoresForTournament(admin, q.tournament_id);
    return json({ ok: true, graded: 1, mode: "override" });
  }

  // ── Auto mode: grade all auto questions of a match. ──
  if (!tournamentId || !matchId) {
    return json({ error: "tournamentId and matchId (or questionId+correctOptionId) are required" }, 400);
  }
  if (!(await isOrganizerOf(admin, callerId, tournamentId))) {
    return json({ error: "Forbidden: not an organizer of this tournament" }, 403);
  }

  // Cooldown: blunt loop-abuse of this heavy recompute. Returns false if another
  // grade ran for this tournament within the last few seconds.
  const { data: slotOk } = await admin.rpc("claim_grade_slot", { tid: tournamentId });
  if (slotOk === false) {
    return json({ ok: false, reason: "cooldown", error: "Grading ran moments ago — try again shortly." }, 429);
  }

  const { data: blobRow } = await admin
    .from("tournaments_blob").select("data").eq("id", tournamentId).maybeSingle();
  const tournament = (blobRow?.data ?? null) as any;
  if (!tournament) return json({ error: "Tournament not found" }, 404);
  const match = findMatch(tournament, matchId);
  if (!match) return json({ error: "Match not found" }, 404);

  const { data: questions } = await admin
    .from("pickem_questions")
    .select("id, kind, options, map_index, points, status, auto_grade")
    .eq("tournament_id", tournamentId).eq("match_id", matchId);

  let graded = 0, voided = 0, skipped = 0;
  for (const q of questions ?? []) {
    // By default a graded/void question is final. `regrade:true` re-evaluates it
    // from the CURRENT blob — for when corrected stats were pulled after grading.
    if (!regrade && (q.status === "graded" || q.status === "void")) { continue; }
    if (!q.auto_grade) { skipped++; continue; }                     // needs override
    const correct = resolveCorrect(q, match);
    if (correct === null) { skipped++; continue; }                  // stat not ready
    if (correct === "") {
      await admin.from("pickem_questions").update({ status: "void", correct_option_id: null }).eq("id", q.id);
      await gradePicksForQuestion(admin, q.id, null, q.points);
      voided++;
      continue;
    }
    await admin.from("pickem_questions").update({ status: "graded", correct_option_id: correct }).eq("id", q.id);
    await gradePicksForQuestion(admin, q.id, correct, q.points);
    graded++;
  }

  await recomputeScoresForTournament(admin, tournamentId);
  return json({ ok: true, graded, voided, skipped, mode: "auto" });
});

// Mark every pick on a question correct/incorrect and award points. A void
// question (correctOptionId null) sets everyone to is_correct=false, 0 points.
async function gradePicksForQuestion(admin: any, questionId: string, correctOptionId: string | null, points: number) {
  const { data: picks } = await admin
    .from("pickem_picks").select("id, option_id").eq("question_id", questionId);
  for (const p of picks ?? []) {
    const isCorrect = correctOptionId !== null && p.option_id === correctOptionId;
    await admin.from("pickem_picks").update({
      is_correct: correctOptionId === null ? false : isCorrect,
      points_awarded: isCorrect ? points : 0,
    }).eq("id", p.id);
  }
}

// Recompute the leaderboard rows for a tournament from the graded picks. Full
// recompute keeps it idempotent and self-healing. Two gates:
//   • Only picks on matches whose RESULTS ARE PUBLISHED count — grading stages
//     the per-pick result, but points stay off the public leaderboard until the
//     organizer reviews and publishes results for that match.
//   • Organizers/superadmins of THIS tournament are excluded (they set the
//     answers, so they must not score on their own event).
// Stale rows for excluded/zero-pick users are deleted so the leaderboard is exact.
async function recomputeScoresForTournament(admin: any, tournamentId: string) {
  // Which matches have published results?
  const { data: states } = await admin
    .from("pickem_match_state")
    .select("match_id")
    .eq("tournament_id", tournamentId)
    .eq("results_published", true);
  const liveMatches = new Set((states ?? []).map((s: any) => s.match_id));

  // Picks joined to their question's match_id so we can gate by results-published.
  const { data: picks } = await admin
    .from("pickem_picks")
    .select("user_id, is_correct, points_awarded, pickem_questions!inner(match_id)")
    .eq("tournament_id", tournamentId);

  const agg = new Map<string, { points: number; correct: number; total: number }>();
  for (const p of picks ?? []) {
    const matchId = (p as any).pickem_questions?.match_id;
    if (!matchId || !liveMatches.has(matchId)) continue; // results not public yet
    const cur = agg.get(p.user_id) ?? { points: 0, correct: 0, total: 0 };
    cur.total += 1;
    cur.points += p.points_awarded ?? 0;
    if (p.is_correct) cur.correct += 1;
    agg.set(p.user_id, cur);
  }

  // Determine which of the participants manage this tournament (exclude them).
  const userIds = [...agg.keys()];
  const excluded = new Set<string>();
  if (userIds.length > 0) {
    const { data: mgr } = await admin.rpc("excluded_from_pickem_scores", { uids: userIds, tid: tournamentId });
    for (const r of mgr ?? []) excluded.add(r.user_id ?? r);
  }

  const rows = [...agg.entries()]
    .filter(([uid]) => !excluded.has(uid))
    .map(([user_id, v]) => ({
      user_id, tournament_id: tournamentId,
      points: v.points, correct_count: v.correct, total_picks: v.total,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length > 0) {
    await admin.from("pickem_scores").upsert(rows, { onConflict: "user_id,tournament_id" });
  }
  // Purge any score rows that should no longer exist (excluded users, or users
  // whose every pick was on a now-deleted question).
  const keep = new Set(rows.map((r) => r.user_id));
  const { data: existing } = await admin
    .from("pickem_scores").select("user_id").eq("tournament_id", tournamentId);
  const toDelete = (existing ?? []).map((e: any) => e.user_id).filter((u: string) => !keep.has(u));
  if (toDelete.length > 0) {
    await admin.from("pickem_scores").delete().eq("tournament_id", tournamentId).in("user_id", toDelete);
  }
}

async function isOrganizerOf(admin: any, callerId: string, tournamentId: string): Promise<boolean> {
  const { data: profile } = await admin
    .from("profiles").select("role").eq("id", callerId).maybeSingle();
  if (profile?.role === "superadmin") return true;
  const { data: scope } = await admin
    .from("organizer_tournaments")
    .select("tournament_id").eq("user_id", callerId).eq("tournament_id", tournamentId).maybeSingle();
  return !!scope;
}
