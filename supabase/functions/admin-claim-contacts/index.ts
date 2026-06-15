import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// admin-claim-contacts — superadmin-only. Given a set of user ids (claimants),
// returns contact info an admin can use to reach them about a claim: email
// (from auth.users, not otherwise client-readable), Discord username + id, and
// the verified game connection. Read-only.

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

  // 1. Superadmin only.
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

  // 2. Parse ids.
  let body: { userIds?: string[] };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const ids = [...new Set((body.userIds ?? []).filter((s) => typeof s === "string"))].slice(0, 200);
  if (ids.length === 0) return json({ contacts: {} });

  // 3. Account fields (discord + connection) for these users.
  const { data: accounts } = await admin
    .from("player_accounts")
    .select("id, display_name, discord_username, discord_id, riot_connection_id, riot_connection_verified")
    .in("id", ids);

  // 4. Emails from auth.users (per-id; admin API has no batch get).
  const contacts: Record<string, {
    email?: string | null;
    displayName?: string | null;
    discordUsername?: string | null;
    discordId?: string | null;
    gameConnection?: string | null;
  }> = {};

  // Look up every email in parallel — a sequential loop here was the main source
  // of latency when several claims were pending.
  await Promise.all((accounts ?? []).map(async (a) => {
    let email: string | null = null;
    try {
      const { data: u } = await admin.auth.admin.getUserById(a.id);
      email = u?.user?.email ?? null;
    } catch { /* leave null */ }
    contacts[a.id] = {
      email,
      displayName: a.display_name,
      discordUsername: a.discord_username,
      discordId: a.discord_id,
      gameConnection: a.riot_connection_verified ? a.riot_connection_id : null,
    };
  }));

  return json({ contacts });
});
