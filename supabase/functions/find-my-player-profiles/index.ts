import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// find-my-player-profiles — the background "this could be your profile" match.
// For the authenticated caller, reads their captured Riot CONNECTION
// (riot_connection_id/_verified, set by capture-riot-id — NOT riot_id_verified,
// which is the admin-claim flag) and scans tournaments_blob for player cards
// whose riotId equals it (normalized). Returns the matches so the UI can suggest
// a claim. Runs server-side so card Riot IDs are never exposed to the client.

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

// MUST match src/app/utils/riotId.ts and verify-riot-claim.
const normalizeRiotId = (s: string) =>
  s.normalize("NFKC").replace(/\s*#\s*/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
const hasTag = (s: string) => {
  const i = s.indexOf("#");
  return i > 0 && i < s.length - 1;
};

const MAX_MATCHES = 12;

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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 2. The caller's captured Riot connection. No verified connection → nothing
  //    to match on.
  const { data: account } = await admin
    .from("player_accounts")
    .select("riot_connection_id, riot_connection_verified")
    .eq("id", callerId)
    .maybeSingle();
  const riotId = (account?.riot_connection_id ?? "").trim();
  if (!account?.riot_connection_verified || !riotId || !hasTag(riotId)) {
    return json({ status: "no_verified_riot", matches: [], hasActiveClaim: false });
  }
  const target = normalizeRiotId(riotId);

  // 3. Does the caller already hold an active (pending/approved) claim? If so the
  //    UI suppresses the suggestion (one profile per user).
  const { data: claims } = await admin
    .from("player_claims")
    .select("id, status, tournament_id, player_id")
    .eq("user_id", callerId)
    .neq("status", "rejected");
  const hasActiveClaim = (claims ?? []).length > 0;

  // 4. Scan every tournament blob for cards whose riotId matches.
  const { data: rows } = await admin
    .from("tournaments_blob")
    .select("id, data");

  type Match = {
    tournamentId: string;
    tournamentName?: string;
    playerId: string;
    playerName?: string;
    teamName?: string;
    riotId: string;
  };
  const matches: Match[] = [];
  const seen = new Set<string>(); // dedup by tournament+player

  for (const row of rows ?? []) {
    const t = (row as any).data;
    if (!t) continue;
    const allTeams = [...(t.teams ?? []), ...(t.qualifiedTeams ?? [])];
    for (const team of allTeams) {
      for (const pl of team.players ?? []) {
        const cardRiot = (pl?.riotId ?? "").trim();
        if (!cardRiot || !hasTag(cardRiot)) continue;
        if (normalizeRiotId(cardRiot) !== target) continue;
        const key = `${t.id}|${pl.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({
          tournamentId: t.id,
          tournamentName: t.name,
          playerId: pl.id,
          playerName: pl.name,
          teamName: team.name,
          riotId: cardRiot,
        });
        if (matches.length >= MAX_MATCHES) break;
      }
      if (matches.length >= MAX_MATCHES) break;
    }
    if (matches.length >= MAX_MATCHES) break;
  }

  return json({ status: matches.length ? "found" : "no_match", matches, hasActiveClaim });
});
