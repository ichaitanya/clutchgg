import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// seed-pickems — an organizer (or superadmin) generates the default question set
// for a match from the tournament blob's teams/rosters. Guarantees the ≥5-question
// minimum and is idempotent: re-running only inserts questions that don't yet exist
// (it never clobbers an organizer's edits). Authoring goes through this function so
// the blob/match must really exist and correct_option_id/status stay server-owned.

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

function findMatchWithStage(tournament: any, matchId: string): { match: any; stage: string } | null {
  const sources: { stage: string; bracket: any }[] = [
    { stage: "single", bracket: tournament?.generatedBracket },
    { stage: "stage1", bracket: tournament?.stage1Bracket },
    { stage: "stage2", bracket: tournament?.stage2Bracket },
    { stage: "single", bracket: tournament?.knockoutBracket },
  ];
  for (const { stage, bracket } of sources) {
    if (!bracket) continue;
    for (const round of bracket.rounds ?? []) {
      for (const m of round ?? []) {
        if (m?.id === matchId) return { match: m, stage };
      }
    }
  }
  return null;
}

function matchLockMsIso(match: any): string | null {
  if (!match?.date) return null;
  const ms = Date.parse(`${match.date}T${match.time || "00:00"}:00Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// How many maps a format can run (used for "total maps" / score questions).
function mapsForFormat(format?: string): number {
  if (format === "bo5") return 5;
  if (format === "bo3") return 3;
  return 1; // bo1 / unknown
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

  let body: { tournamentId?: string; matchId?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { tournamentId, matchId } = body;
  if (!tournamentId || !matchId) return json({ error: "tournamentId and matchId are required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Authorize: superadmin, or an organizer scoped to THIS tournament.
  const authorized = await isOrganizerOf(admin, callerId, tournamentId);
  if (!authorized) return json({ error: "Forbidden: not an organizer of this tournament" }, 403);

  // Load the match from the blob.
  const { data: blobRow } = await admin
    .from("tournaments_blob").select("data").eq("id", tournamentId).maybeSingle();
  const tournament = (blobRow?.data ?? null) as any;
  if (!tournament) return json({ error: "Tournament not found" }, 404);
  const found = findMatchWithStage(tournament, matchId);
  if (!found) return json({ error: "Match not found in this tournament" }, 404);
  const { match, stage } = found;

  // Both teams must be real (not "Winner of N" placeholders) to seed.
  if (!match.team1Id || !match.team2Id) {
    return json({ error: "Both teams must be assigned before seeding pickems." }, 409);
  }

  const teams: any[] = [...(tournament.teams ?? []), ...(tournament.qualifiedTeams ?? [])];
  const teamById = (id: string) => teams.find((t) => t.id === id);
  const t1 = teamById(match.team1Id);
  const t2 = teamById(match.team2Id);
  const t1Name = match.team1Name || t1?.name || "Team 1";
  const t2Name = match.team2Name || t2?.name || "Team 2";

  // Player option list (both rosters) for Top ACS / MVP.
  const rosterOptions: { id: string; label: string; meta: any }[] = [];
  for (const team of [t1, t2]) {
    for (const p of team?.players ?? []) {
      rosterOptions.push({
        id: `pl_${p.id}`,
        label: `${p.name}${team?.name ? ` (${team.name})` : ""}`,
        meta: { playerId: p.id, teamId: team.id },
      });
    }
  }

  const lockIso = matchLockMsIso(match);
  const numMaps = mapsForFormat(match.format);
  const hasRosters = rosterOptions.length >= 2; // need players to grade ACS/MVP
  const teamOpts = [
    { id: `team_${match.team1Id}`, label: t1Name, meta: { teamId: match.team1Id } },
    { id: `team_${match.team2Id}`, label: t2Name, meta: { teamId: match.team2Id } },
  ];

  type Seed = {
    kind: string; prompt: string; map_index: number | null; auto_grade: boolean;
    options: { id: string; label: string; meta?: any }[]; sort: number;
  };
  const seeds: Seed[] = [];
  let sort = 0;

  // 1. Match winner (always gradeable).
  seeds.push({ kind: "match_winner", prompt: `Who wins ${t1Name} vs ${t2Name}?`, map_index: null, auto_grade: true, sort: sort++, options: teamOpts });
  // 2. Map 1 winner.
  seeds.push({ kind: "map_winner", prompt: "Who wins Map 1?", map_index: 0, auto_grade: true, sort: sort++, options: teamOpts });

  // 3 & 4. ACS / MVP — only when rosters exist (otherwise they could never grade
  // by player id and would always void). With no rosters we substitute extra
  // team-gradeable questions so the ≥5 minimum still holds with real, auto-
  // gradeable content.
  if (hasRosters) {
    seeds.push({ kind: "top_acs", prompt: "Who has the highest ACS in the match?", map_index: null, auto_grade: true, sort: sort++, options: rosterOptions });
    seeds.push({ kind: "mvp", prompt: "Who is the match MVP?", map_index: null, auto_grade: true, sort: sort++, options: rosterOptions });
  } else if (numMaps >= 3) {
    seeds.push({ kind: "map_winner", prompt: "Who wins Map 2?", map_index: 1, auto_grade: true, sort: sort++, options: teamOpts });
    seeds.push({ kind: "map_winner", prompt: "Who wins Map 3?", map_index: 2, auto_grade: true, sort: sort++, options: teamOpts });
  } else {
    // bo1 + no rosters: a first-blood-by-team and a coin-flip style team question.
    seeds.push({ kind: "custom", prompt: "Will the map reach overtime (12-12)?", map_index: 0, auto_grade: false, sort: sort++, options: [ { id: "ot_yes", label: "Yes — overtime" }, { id: "ot_no", label: "No — decided in regulation" } ] });
    seeds.push({ kind: "custom", prompt: `Will ${t1Name} win at least 5 rounds?`, map_index: 0, auto_grade: false, sort: sort++, options: [ { id: "yes", label: "Yes" }, { id: "no", label: "No" } ] });
  }

  // 5. Series score (bo3/bo5) OR an overtime question for bo1 so we always clear ≥5.
  if (numMaps >= 3) {
    const winNeeded = Math.ceil(numMaps / 2);
    const scoreOpts: { id: string; label: string; meta?: any }[] = [];
    for (let a = 0; a <= winNeeded; a++) {
      for (let b = 0; b <= winNeeded; b++) {
        if (a !== winNeeded && b !== winNeeded) continue;
        if (a === winNeeded && b === winNeeded) continue;
        scoreOpts.push({ id: `score_${a}_${b}`, label: `${t1Name} ${a} – ${b} ${t2Name}`, meta: { team1Maps: a, team2Maps: b } });
      }
    }
    seeds.push({ kind: "map_score", prompt: "What is the correct series score?", map_index: null, auto_grade: true, sort: sort++, options: scoreOpts });
  } else if (hasRosters) {
    // bo1 WITH rosters already has winner/map1/acs/mvp (4) — add OT to reach 5.
    seeds.push({ kind: "custom", prompt: "Will the map reach overtime (12-12)?", map_index: 0, auto_grade: false, sort: sort++, options: [ { id: "ot_yes", label: "Yes — overtime" }, { id: "ot_no", label: "No — decided in regulation" } ] });
  }

  // Read existing questions for this match so we can (a) insert the ones that are
  // missing and (b) RE-SYNC the auto, still-open ones whose underlying match data
  // may have changed (team swapped, roster edited, schedule/format changed). We
  // never touch a graded/locked/void question, never overwrite an organizer's
  // edited prompt, and never re-sync custom questions.
  const { data: existing } = await admin
    .from("pickem_questions")
    .select("id, kind, map_index, status, auto_grade")
    .eq("tournament_id", tournamentId)
    .eq("match_id", matchId);
  const existingByKey = new Map(
    (existing ?? []).map((e: any) => [`${e.kind}:${e.map_index ?? -1}`, e]),
  );
  // Custom questions aren't covered by the natural-key unique index, so guard
  // their re-insert: if this match already has ANY custom question, a re-seed
  // must not duplicate the default custom ones.
  const hasCustomAlready = (existing ?? []).some((e: any) => e.kind === "custom");

  const toInsert = seeds
    .filter((s) =>
      s.kind === "custom"
        ? !hasCustomAlready
        : !existingByKey.has(`${s.kind}:${s.map_index ?? -1}`),
    )
    .map((s) => ({
      tournament_id: tournamentId,
      match_id: matchId,
      stage,
      kind: s.kind,
      prompt: s.prompt,
      options: s.options,
      auto_grade: s.auto_grade,
      map_index: s.map_index,
      points: 2,
      sort_order: s.sort,
      status: "open",
      locks_at: lockIso,
      created_by: callerId,
    }));

  if (toInsert.length > 0) {
    const { error: insErr } = await admin.from("pickem_questions").insert(toInsert);
    if (insErr) return json({ error: `Could not seed questions: ${insErr.message}` }, 500);
  }

  // Re-sync options + lock time for existing auto questions that are still OPEN.
  // This keeps seeded match_winner/map/ACS/MVP options correct after a bracket
  // edit, so a swapped-in team's pick doesn't silently void. Prompt is left as-is.
  let resynced = 0;
  for (const s of seeds) {
    if (s.kind === "custom") continue;
    const ex: any = existingByKey.get(`${s.kind}:${s.map_index ?? -1}`);
    if (!ex || !ex.auto_grade || ex.status !== "open") continue;
    const { error: upErr } = await admin
      .from("pickem_questions")
      .update({ options: s.options, locks_at: lockIso })
      .eq("id", ex.id);
    if (!upErr) resynced++;
  }

  return json({
    ok: true,
    created: toInsert.length,
    resynced,
    total: (existing?.length ?? 0) + toInsert.length,
  });
});

// superadmin OR organizer scoped to this tournament (via organizer_tournaments).
async function isOrganizerOf(admin: any, callerId: string, tournamentId: string): Promise<boolean> {
  const { data: profile } = await admin
    .from("profiles").select("role").eq("id", callerId).maybeSingle();
  if (profile?.role === "superadmin") return true;
  const { data: scope } = await admin
    .from("organizer_tournaments")
    .select("tournament_id")
    .eq("user_id", callerId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();
  return !!scope;
}
