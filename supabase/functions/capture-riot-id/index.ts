import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// capture-riot-id — reads the caller's VERIFIED Riot Games connection from
// Discord (using their one-shot OAuth provider_token) and stores it on their
// player_accounts row as riot_connection_id + riot_connection_verified. This
// powers the background "this could be your profile" match — it does NOT claim
// any card and does NOT touch riot_id_verified (that flag means "admin-approved
// claim" and is owned by decide-claim/unclaim-profile; overloading it here would
// silently invalidate an approved claimant's badge on a connection-less login).
// Mirrors steps 1–6 of verify-riot-claim, minus the tournament-card match.
//
// Called fire-and-forget from AuthContext right after a Discord login carries a
// provider_token. Safe to call repeatedly: it just refreshes the stored id.

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

const DISCORD_API = "https://discord.com/api/v10";

// MUST match src/app/utils/riotId.ts and verify-riot-claim.
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
  const DISCORD_CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID") ?? "";
  if (!DISCORD_CLIENT_ID) {
    console.warn(
      "[capture-riot-id] DISCORD_CLIENT_ID is not set — skipping the token audience check. " +
      "Set this edge secret in production.",
    );
  }

  // 1. Identify the caller.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const callerId = userData.user.id;

  // 2. Parse body.
  let body: { providerToken?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { providerToken } = body;
  if (!providerToken) return json({ status: "bad_token" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. The caller's Discord identity (source of truth for their discord user id).
  const { data: account } = await admin
    .from("player_accounts")
    .select("id, discord_id")
    .eq("id", callerId)
    .maybeSingle();
  const { data: fullUser } = await admin.auth.admin.getUserById(callerId);
  const discordIdentity = fullUser?.user?.identities?.find((i) => i.provider === "discord");
  const expectedDiscordId: string | undefined =
    (discordIdentity as any)?.provider_id ??
    (discordIdentity as any)?.identity_data?.provider_id ??
    (discordIdentity as any)?.identity_data?.sub ??
    account?.discord_id ?? undefined;
  if (!expectedDiscordId) return json({ status: "no_discord" });

  const discordHeaders = { Authorization: `Bearer ${providerToken}` };

  // 4. Token must belong to the CALLER's Discord account (and — when configured
  //    — to OUR application). Same guard as verify-riot-claim.
  const meRes = await fetch(`${DISCORD_API}/users/@me`, { headers: discordHeaders });
  if (!meRes.ok) return json({ status: "bad_token" });
  const me = await meRes.json();
  const meId = me?.id ? String(me.id) : "";
  if (!meId || meId !== String(expectedDiscordId)) return json({ status: "bad_token" });

  if (DISCORD_CLIENT_ID) {
    const oauthRes = await fetch(`${DISCORD_API}/oauth2/@me`, { headers: discordHeaders });
    if (!oauthRes.ok) return json({ status: "bad_token" });
    const oauth = await oauthRes.json();
    if (String(oauth?.application?.id) !== DISCORD_CLIENT_ID) return json({ status: "bad_token" });
  }

  // 5. Read the Riot Games connection. On any miss, clear the CONNECTION fields
  //    (not riot_id_verified — that's the admin-claim flag) so a removed/changed
  //    connection stops surfacing stale match suggestions.
  const clearConnection = () =>
    admin.from("player_accounts")
      .update({ riot_connection_id: null, riot_connection_verified: false })
      .eq("id", callerId);

  const connRes = await fetch(`${DISCORD_API}/users/@me/connections`, { headers: discordHeaders });
  if (!connRes.ok) {
    // 403/401 → the token genuinely lacks the connections scope: clear, since we
    // can't see a connection. 5xx/429 → transient Discord error: do NOT clear a
    // previously-good connection over a blip; just report and leave it intact.
    if (connRes.status === 401 || connRes.status === 403) {
      await clearConnection();
      return json({ status: "no_riot_connection", reason: "connections_scope_missing" });
    }
    return json({ status: "error", reason: `discord_connections_${connRes.status}` }, 502);
  }
  const connections: Array<{ type: string; name: string; verified: boolean }> = await connRes.json();
  const riot = (connections ?? []).find((c) => c.type === "riotgames");
  if (!riot) {
    await clearConnection();
    return json({ status: "no_riot_connection" });
  }
  if (!riot.verified || !hasTag(riot.name)) {
    await clearConnection();
    return json({ status: "riot_unverified" });
  }

  // 6. Store the verified connection (canonical name#tag). Does NOT set
  //    riot_id_verified — only an admin-approved claim does that.
  const { error: upErr } = await admin
    .from("player_accounts")
    .update({ riot_connection_id: riot.name, riot_connection_verified: true })
    .eq("id", callerId);
  if (upErr) return json({ error: `Failed to store Riot connection: ${upErr.message}` }, 500);

  return json({ status: "captured", riotId: riot.name, normalized: normalizeRiotId(riot.name) });
});
