import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// admin-riot-matches — superadmin-only visibility into the background match:
// every user who has a captured, verified Riot CONNECTION that matches one or
// more tournament player cards, with whether they already hold a claim. Lets an
// admin see who *could* claim a profile but hasn't yet (e.g. to nudge them).
// Read-only; makes no writes.

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

const normalizeRiotId = (s: string) =>
  s.normalize("NFKC").replace(/\s*#\s*/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
const hasTag = (s: string) => {
  const i = s.indexOf("#");
  return i > 0 && i < s.length - 1;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1. Caller must be a superadmin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: prof } = await admin
    .from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (prof?.role !== "superadmin") return json({ error: "Forbidden: superadmin only" }, 403);

  // 2. All users with a verified captured Riot connection.
  const { data: accounts } = await admin
    .from("player_accounts")
    .select("id, display_name, discord_username, riot_connection_id")
    .eq("riot_connection_verified", true);
  const connected = (accounts ?? []).filter(
    (a) => (a.riot_connection_id ?? "").trim() && hasTag(a.riot_connection_id ?? ""),
  );
  if (connected.length === 0) return json({ users: [] });

  // Map normalized connection id → list of accounts holding it.
  const byRiot = new Map<string, typeof connected>();
  for (const a of connected) {
    const key = normalizeRiotId(a.riot_connection_id!);
    const arr = byRiot.get(key) ?? [];
    arr.push(a);
    byRiot.set(key, arr);
  }

  // 3. Active claims per user (to flag "already claimed").
  const { data: claims } = await admin
    .from("player_claims")
    .select("user_id, status")
    .neq("status", "rejected");
  const claimedUsers = new Set((claims ?? []).map((c) => c.user_id));

  // 4. Scan blobs for cards matching any connected user's Riot ID.
  const { data: rows } = await admin.from("tournaments_blob").select("id, data");

  type CardMatch = { tournamentId: string; tournamentName?: string; playerId: string; playerName?: string; teamName?: string };
  const matchesByUser = new Map<string, CardMatch[]>();
  const seen = new Set<string>(); // user|tournament|player

  for (const row of rows ?? []) {
    const t = (row as any).data;
    if (!t) continue;
    const allTeams = [...(t.teams ?? []), ...(t.qualifiedTeams ?? [])];
    for (const team of allTeams) {
      for (const pl of team.players ?? []) {
        const cardRiot = (pl?.riotId ?? "").trim();
        if (!cardRiot || !hasTag(cardRiot)) continue;
        const owners = byRiot.get(normalizeRiotId(cardRiot));
        if (!owners) continue;
        for (const owner of owners) {
          const key = `${owner.id}|${t.id}|${pl.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const arr = matchesByUser.get(owner.id) ?? [];
          arr.push({ tournamentId: t.id, tournamentName: t.name, playerId: pl.id, playerName: pl.name, teamName: team.name });
          matchesByUser.set(owner.id, arr);
        }
      }
    }
  }

  // 5. Assemble — only users who actually matched at least one card.
  const users = connected
    .filter((a) => matchesByUser.has(a.id))
    .map((a) => ({
      userId: a.id,
      displayName: a.display_name,
      discordUsername: a.discord_username,
      riotConnectionId: a.riot_connection_id,
      hasClaim: claimedUsers.has(a.id),
      matches: matchesByUser.get(a.id) ?? [],
    }))
    // Unclaimed first (the actionable ones), then by name.
    .sort((x, y) => Number(x.hasClaim) - Number(y.hasClaim) || (x.displayName ?? "").localeCompare(y.displayName ?? ""));

  return json({ users });
});
