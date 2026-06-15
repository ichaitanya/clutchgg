import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// verify-riot-claim — submits a tournament-profile claim after verifying,
// SERVER-SIDE, that the caller's Discord account has a verified Riot Games
// connection whose Riot ID matches the player card being claimed.
//
// Clients cannot INSERT into player_claims (no RLS policy) — this function is
// the only writer, so a claim row existing means the riot-match check really
// happened against Discord's API with the caller's own token.

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

// MUST match the app's canonical normalizer (src/app/utils/riotId.ts) so the
// two sides collapse to the same string. NFKC for width/encoding variants,
// strip spaces around the name#tag separator, collapse internal whitespace to
// a single space (NOT remove it — removal causes false collisions like
// "ab c#1" == "abc#1").
const normalizeRiotId = (s: string) =>
  s.normalize("NFKC").replace(/\s*#\s*/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

// A claimable Riot ID must be a full "name#tag" — a bare game-name (no tag) is
// NOT specific enough: many players share a game-name and differ only by tag,
// so matching on name alone would let the wrong person claim the card.
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
  // Audience check: when set, the provider token must have been minted for OUR
  // Discord application. Set via edge-function secret DISCORD_CLIENT_ID.
  //
  // SECURITY: without this, the only token binding is "belongs to the caller's
  // Discord user" (step 5) — ANY app the user authorized with the connections
  // scope yields a token that passes. Setting DISCORD_CLIENT_ID upgrades that to
  // "minted for OUR app". Strongly recommended in production; log loudly when
  // absent so a missing secret can't silently weaken the check.
  const DISCORD_CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID") ?? "";
  if (!DISCORD_CLIENT_ID) {
    console.warn(
      "[verify-riot-claim] DISCORD_CLIENT_ID is not set — skipping the token audience check. " +
      "Any Discord app token belonging to the caller will be accepted. Set this edge secret in production.",
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
  let body: { tournamentId?: string; playerId?: string; providerToken?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { tournamentId, playerId, providerToken } = body;
  if (!tournamentId || !playerId) return json({ error: "tournamentId and playerId are required" }, 400);
  if (!providerToken) return json({ status: "bad_token" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Caller must have a fully verified player account (Google + Discord).
  const { data: account } = await admin
    .from("player_accounts")
    .select("id, is_verified, discord_id")
    .eq("id", callerId)
    .maybeSingle();
  if (!account) return json({ status: "not_verified_account" });
  if (!account.is_verified) return json({ status: "not_verified_account" });

  // 4. The caller's Discord identity (source of truth for their discord user id).
  const { data: fullUser } = await admin.auth.admin.getUserById(callerId);
  const discordIdentity = fullUser?.user?.identities?.find((i) => i.provider === "discord");
  const expectedDiscordId: string | undefined =
    (discordIdentity as any)?.provider_id ??
    (discordIdentity as any)?.identity_data?.provider_id ??
    (discordIdentity as any)?.identity_data?.sub ??
    account.discord_id ?? undefined;
  if (!expectedDiscordId) return json({ status: "not_verified_account" });

  const discordHeaders = { Authorization: `Bearer ${providerToken}` };

  // 5. Token must belong to the CALLER's Discord account (not someone else's
  //    pasted token), and — when configured — to OUR application.
  const meRes = await fetch(`${DISCORD_API}/users/@me`, { headers: discordHeaders });
  if (!meRes.ok) return json({ status: "bad_token" });
  const me = await meRes.json();
  // Both must be present non-empty strings AND equal — never let two
  // empty/undefined values compare equal (String(undefined) === String(undefined)).
  const meId = me?.id ? String(me.id) : "";
  if (!meId || meId !== String(expectedDiscordId)) return json({ status: "bad_token" });

  if (DISCORD_CLIENT_ID) {
    const oauthRes = await fetch(`${DISCORD_API}/oauth2/@me`, { headers: discordHeaders });
    if (!oauthRes.ok) return json({ status: "bad_token" });
    const oauth = await oauthRes.json();
    if (String(oauth?.application?.id) !== DISCORD_CLIENT_ID) return json({ status: "bad_token" });
  }

  // 6. Read the Riot Games connection.
  const connRes = await fetch(`${DISCORD_API}/users/@me/connections`, { headers: discordHeaders });
  if (!connRes.ok) {
    // Token lacks the connections scope (user authorized an older grant).
    return json({ status: "no_riot_connection", reason: "connections_scope_missing" });
  }
  const connections: Array<{ type: string; name: string; verified: boolean }> = await connRes.json();
  const riot = (connections ?? []).find((c) => c.type === "riotgames");
  if (!riot) return json({ status: "no_riot_connection" });
  if (!riot.verified) return json({ status: "riot_unverified" });

  // 7. Find the player card in the tournament blob.
  const { data: blobRow } = await admin
    .from("tournaments_blob")
    .select("data")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!blobRow?.data) return json({ status: "player_not_found" });
  const tournament = blobRow.data as any;
  const allTeams = [...(tournament.teams ?? []), ...(tournament.qualifiedTeams ?? [])];
  // A player id can appear in more than one team copy (e.g. a qualified-teams
  // duplicate). Collect EVERY copy and require their Riot IDs to agree, so a
  // stale copy carrying a different riotId can't be used to slip a match.
  const cards: Array<{ id: string; name?: string; riotId?: string }> = [];
  for (const team of allTeams) {
    for (const pl of team.players ?? []) {
      if (pl.id === playerId) cards.push(pl);
    }
  }
  if (cards.length === 0) return json({ status: "player_not_found" });

  const cardRiotIds = [...new Set(
    cards.map((c) => (c.riotId ?? "").trim()).filter((r) => r),
  )];
  if (cardRiotIds.length === 0) return json({ status: "card_has_no_riot_id" });
  // Conflicting riotIds across copies → ambiguous, refuse rather than guess.
  const normedSet = new Set(cardRiotIds.map(normalizeRiotId));
  if (normedSet.size > 1) return json({ status: "card_has_no_riot_id", reason: "ambiguous" });

  const cardRiotId = cardRiotIds[0];
  const card = cards.find((c) => (c.riotId ?? "").trim() === cardRiotId) ?? cards[0];

  // 8. The actual ownership check. BOTH sides must be a full name#tag, and the
  //    full normalized strings (name AND tag) must be equal — never a bare-name
  //    fallback, which would match the wrong tag.
  if (!hasTag(riot.name)) return json({ status: "riot_unverified", reason: "connection_has_no_tag" });
  if (!hasTag(cardRiotId)) {
    return json({ status: "riot_mismatch", got: riot.name, expected: cardRiotId, reason: "card_no_tag" });
  }
  if (normalizeRiotId(riot.name) !== normalizeRiotId(cardRiotId)) {
    return json({ status: "riot_mismatch", got: riot.name, expected: cardRiotId });
  }

  // 9. Record the claim. Two unique indexes can trip here:
  //    - one_active_claim_per_card → someone already claims THIS card
  //    - one_active_claim_per_user → the CALLER already holds another claim
  //    Distinguish them so the UI can tell the user to unclaim first.
  const { error: insErr } = await admin.from("player_claims").insert({
    user_id: callerId,
    tournament_id: tournamentId,
    player_id: playerId,
    player_name: card.name ?? null,
    riot_id: riot.name,
  });
  if (insErr) {
    if ((insErr as any).code === "23505") {
      const detail = `${(insErr as any).message ?? ""} ${(insErr as any).details ?? ""}`;
      if (detail.includes("one_active_claim_per_user")) {
        return json({ status: "already_has_claim" });
      }
      return json({ status: "claim_taken" });
    }
    return json({ error: `Failed to record claim: ${insErr.message}` }, 500);
  }

  await admin.from("player_accounts").update({ riot_id: riot.name }).eq("id", callerId);

  return json({ status: "submitted", riotId: riot.name, playerName: card.name ?? null });
});
