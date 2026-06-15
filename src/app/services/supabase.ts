import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://atjongzdifyjnzkbqyoc.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0am9uZ3pkaWZ5am56a2JxeW9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTYzNzUsImV4cCI6MjA5NTg5MjM3NX0.wfoor7uOkbooSt01NJGrqTxWRjPSgPzN8K5tgFG5nzY';

// Wrap the native fetch with an AbortSignal timeout so every Supabase request
// (data, auth, storage) fails fast instead of hanging indefinitely when the
// project cold-starts or the connection stalls. The db.ts retry layer then
// re-attempts with backoff until data arrives.
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Two clients, by purpose ────────────────────────────────────────────────
// Login only ever happens on /admin. The public pages (home, matches, …) read
// data anonymously through RLS and must NEVER touch the auth session.
//
// Why this split matters: with a single persisted-session client, supabase-js
// resolves the access token on every PostgREST request — and if a stored
// session has expired, it awaits an auto-refresh first. When that refresh
// stalls (cold start / flaky connection), the *data read* is blocked behind it
// and the page stays blank. A fresh browser has no stored session, so it never
// hits this path — which is exactly why "new browser works, same browser
// doesn't, and clearing the HTTP cache doesn't help" (the bad token lives in
// localStorage, not the cache).
//
// `dbClient`  — anonymous, NO session persistence, NO token refresh. Used for
//               all public/data reads. Cannot be blocked by an auth refresh.
// `supabase`  — full auth client (persists session, auto-refreshes). Used by
//               the admin panel for login/session AND for authenticated writes
//               that must carry the JWT to satisfy is_staff() RLS.

export const dbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: fetchWithTimeout },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    // Distinct storageKey so this anonymous client never shares the auth
    // client's GoTrue lock or token storage — avoids the "Multiple
    // GoTrueClient instances" cross-talk when both live in one tab.
    storageKey: 'sb-clutchgg-anon',
  },
});

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: fetchWithTimeout },
  auth: {
    // Explicit (these are the supabase-js defaults, pinned for determinism):
    persistSession: true,       // keep the session in localStorage across loads
    autoRefreshToken: true,     // refresh the access token in the background
    // Parse the invite/recovery token from the URL hash on load and emit
    // SIGNED_IN — this is how the organizer set-password flow works.
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
});

// Build a one-off client whose every request carries an explicit bearer token.
// Storage uploads go through a different code path than PostgREST queries, and
// the shared auth client can fire a storage request WITHOUT the Authorization
// header if its in-memory auth state was reset (our lock-avoidance reads do
// this). Passing the JWT here guarantees `authenticated`-role RLS is satisfied.
export function bearerClient(accessToken: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      fetch: fetchWithTimeout,
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// The localStorage key supabase-js uses for the session, in the DEFAULT format
// `sb-<project-ref>-auth-token`. We don't override storageKey (that would log
// out every existing session on deploy), we just need to know where to read.
const AUTH_STORAGE_KEY = `sb-${SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token`;

// ─── Direct, lock-free session read ─────────────────────────────────────────
// supabase.auth.getSession() acquires GoTrue's Web Locks lock
// (`lock:sb-<ref>-auth-token`). If a background auto-refresh stalls (the classic
// "works on hard refresh, hangs on client-side re-mount" signature — a fresh
// page has no in-flight refresh holding the lock, an existing singleton does),
// getSession() blocks until the lock frees. The session JSON is already sitting
// in localStorage, so for the synchronous "are we logged in right now?" check
// on mount we read it straight from storage and skip the lock entirely.
interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number; // unix seconds — when the ACCESS token expires (~1h)
  // OAuth provider access token (e.g. Discord) — present only in the session
  // persisted right after an OAuth round-trip, gone after the next refresh.
  provider_token?: string | null;
  user: { id: string; email?: string };
}

// Read the persisted session from localStorage, no lock, no network. Returns
// the session AND whether its (short-lived, ~1h) access token has expired.
// Note: an expired access token does NOT mean logged out — the refresh token
// (valid for weeks) can mint a new one. The caller decides what to do.
export function getStoredSession(): (StoredSession & { accessTokenExpired: boolean }) | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    // supabase-js stores either the session object directly or wrapped in
    // { currentSession } depending on version — handle both shapes.
    const parsed = JSON.parse(raw);
    const session: StoredSession | null =
      parsed?.access_token ? parsed
      : parsed?.currentSession?.access_token ? parsed.currentSession
      : null;
    if (!session?.access_token || !session?.user?.id || !session?.refresh_token) return null;
    const accessTokenExpired = !!session.expires_at && Date.now() / 1000 > session.expires_at - 5;
    return { ...session, accessTokenExpired };
  } catch {
    return null;
  }
}

// Lock-free refresh: exchange the stored refresh token for a fresh access token
// via a direct REST call (NOT supabase.auth.refreshSession(), which takes the
// contended lock). Persists the new session back to the same storage key so the
// live client and future reads pick it up. Returns the new access token, or
// null on failure (→ the caller should treat the user as logged out).
export async function refreshAccessTokenDirect(refreshToken: string): Promise<StoredSession | null> {
  try {
    const res = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.access_token || !data?.user?.id) return null;
    const session: StoredSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
      user: data.user,
    };
    // Persist in the shape supabase-js reads back (it accepts the bare object).
    try { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session)); } catch { /* ignore */ }
    return session;
  } catch {
    return null;
  }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

// Local key recording WHEN the current login should stop being trusted, and
// whether "remember me" was chosen. This is an app-level session policy that
// sits ON TOP of Supabase's own token lifecycle — we never delete Supabase's
// token out from under the live client (doing so makes the auto-refresh worker
// emit a null session and log the user out within seconds). Instead we read
// this on load / on a timer and call a clean signOut() when the policy says so.
const SESSION_POLICY_KEY = 'clutchgg-session-policy';

// "Remember me" off → expire when the browser session ends. We approximate a
// browser-session lifetime with a generous absolute cap so a forgotten open tab
// still eventually logs out, while a genuine "I'm working" session isn't cut
// short. Remember-me on → a long absolute cap (refreshed on each login).
const SESSION_MAX_AGE_MS = {
  remember: 30 * 24 * 60 * 60 * 1000, // 30 days
  session: 12 * 60 * 60 * 1000,       // 12 hours
};

interface SessionPolicy { rememberMe: boolean; expiresAt: number; }

function writeSessionPolicy(rememberMe: boolean) {
  try {
    const ttl = rememberMe ? SESSION_MAX_AGE_MS.remember : SESSION_MAX_AGE_MS.session;
    const policy: SessionPolicy = { rememberMe, expiresAt: Date.now() + ttl };
    localStorage.setItem(SESSION_POLICY_KEY, JSON.stringify(policy));
  } catch { /* private mode — fall back to Supabase's own lifecycle */ }
}

export function readSessionPolicy(): SessionPolicy | null {
  try {
    const raw = localStorage.getItem(SESSION_POLICY_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SessionPolicy;
    if (typeof p.expiresAt !== 'number') return null;
    return p;
  } catch {
    return null;
  }
}

function clearSessionPolicy() {
  try { localStorage.removeItem(SESSION_POLICY_KEY); } catch { /* ignore */ }
}

// True when an app-level session policy exists AND has passed its expiry. A
// missing policy is NOT treated as expired — it means a pre-policy login or
// private mode; those fall back to Supabase's own token lifecycle.
export function isSessionExpired(): boolean {
  const p = readSessionPolicy();
  return !!p && Date.now() >= p.expiresAt;
}

export async function signIn(email: string, password: string, rememberMe = true) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  writeSessionPolicy(rememberMe);
  return data;
}

export async function signOut() {
  // Clear our app-level session policy first so a re-mount can never re-trust
  // an expired session.
  clearSessionPolicy();

  // Clear any in-flight claim intent (a stashed card ID from before a Discord
  // re-auth). If the user signs out before OAuth completes, the intent should
  // not leak to the next person who logs in on this browser.
  clearClaimIntent();

  // Synchronously purge the persisted auth token from localStorage. This is
  // what actually logs the user out for the NEXT load, makes no network call,
  // and cannot hang — so the caller can update the UI immediately after this
  // returns without waiting on any GoTrue lock or network round-trip. (The old
  // code awaited supabase.auth.signOut({ scope: 'local' }), which serializes
  // behind the GoTrue auth lock and could take long enough that the first
  // "Sign out" click appeared to do nothing and a second was needed.)
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('supabase.auth'))) {
        // Don't wipe the anonymous data client's storage — only auth sessions.
        if (key !== 'sb-clutchgg-anon') localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage unavailable (private mode / SSR) — nothing more to do.
  }

  // Tell the live client to drop its in-memory session too, and best-effort
  // revoke server-side sessions. Both are fire-and-forget with a short timeout:
  // the token is already gone from storage, so the user is logged out for the
  // next load regardless of whether these resolve. NOT awaited → no UI stall.
  Promise.race([
    supabase.auth.signOut({ scope: 'local' }),
    new Promise(resolve => setTimeout(resolve, 3_000)),
  ]).catch(() => {});
  Promise.race([
    supabase.auth.signOut({ scope: 'global' }),
    new Promise(resolve => setTimeout(resolve, 3_000)),
  ]).catch(() => {});
}

export async function getSession() {
  // Enforce our app-level session policy BEFORE trusting Supabase's token. If
  // the policy has expired (remember-me window elapsed), sign out cleanly and
  // report no session — the user must log in again.
  if (isSessionExpired()) {
    await signOut();
    return null;
  }

  // getSession can hang indefinitely when the stored token is expired and the
  // auto-refresh stalls (cold start / flaky connection). Race against a hard
  // timeout so callers never block forever — a null session is safe: it just
  // means the user needs to log in again.
  const result = await Promise.race([
    supabase.auth.getSession(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('session timeout')), 8_000)
    ),
  ]).catch(() => ({ data: { session: null } }));
  return result.data.session;
}

export type UserRole = 'admin' | 'superadmin' | 'organizer';

export interface Profile {
  id: string;
  display_name: string;
  role: UserRole;
  email?: string | null;
  // Legacy/primary pointer — the most recently assigned tournament. The full
  // multi-tournament scope is in `tournamentIds` (sourced from the
  // organizer_tournaments junction table). Kept for backward compatibility.
  tournament_id?: string | null;
  // For organizers: every tournament (tournaments_blob.id) they may edit. A
  // single organizer can be approved for multiple tournaments.
  tournamentIds?: string[];
  // Forces a password-change screen on next login (default-password path).
  must_change_password?: boolean;
}

// Load the signed-in user's profile.
//
// When `accessToken` is supplied (from getStoredSession on mount) we run the
// queries through `dbClient` — the anonymous client that NEVER touches GoTrue's
// auth lock — passing the JWT explicitly in the Authorization header. This
// sidesteps the same lock contention that made getSession() hang: a PostgREST
// query on the `supabase` client internally resolves the access token through
// the lock, so if a stalled background refresh is holding it, even the profile
// read would stall. With the token in hand we bypass all of that — RLS only
// needs the JWT in the header. Without a token we fall back to resolving the
// session via getSession() and querying through `supabase`.
export async function getCurrentProfile(userId?: string, accessToken?: string): Promise<Profile | null> {
  let uid = userId;
  let token = accessToken;
  if (!uid) {
    const session = await getSession();
    if (!session) return null;
    uid = session.user.id;
    token = session.access_token;
  }

  const client = token ? dbClient : supabase;
  const auth = token ? `Bearer ${token}` : '';

  const profileQ = client.from('profiles').select('*').eq('id', uid).single();
  const { data, error } = token ? await profileQ.setHeader('Authorization', auth) : await profileQ;
  if (error) return null;
  const profile = data as Profile;

  // For organizers, load the full set of tournaments they're scoped to from the
  // junction table (a single organizer may manage several). Union in the legacy
  // single column so a not-yet-migrated profile still works.
  if (profile.role === 'organizer') {
    const scopeQ = client.from('organizer_tournaments').select('tournament_id').eq('user_id', uid);
    const { data: rows } = token ? await scopeQ.setHeader('Authorization', auth) : await scopeQ;
    const ids = new Set<string>((rows ?? []).map((r: any) => r.tournament_id));
    if (profile.tournament_id) ids.add(profile.tournament_id);
    profile.tournamentIds = [...ids];
  }
  return profile;
}

export async function isAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile?.role === 'admin' || profile?.role === 'superadmin';
}

// ─── Player accounts (public users, OAuth) ──────────────────────────────────
// Players are NOT staff: they live in `player_accounts`, never in `profiles`
// (whose privileged-column trigger rejects non-organizer self-inserts). They
// share the same `supabase` auth client as the admin panel — one session per
// browser — but all player UI keys off player_accounts, all staff UI off
// profiles, so the two never collide.

export type OAuthProvider = 'google' | 'discord';

export interface PlayerAccount {
  id: string;
  display_name: string;
  avatar_url?: string | null;
  bio?: string | null;
  socials: Record<string, string>;
  discord_id?: string | null;
  discord_username?: string | null;
  google_linked: boolean;
  discord_linked: boolean;
  is_verified: boolean;
  riot_id?: string | null;
  riot_id_verified: boolean;
  // Captured Discord→Riot connection (set by capture-riot-id) — drives the
  // background profile-match suggestions. Distinct from riot_id_verified, which
  // means an admin-approved claim.
  riot_connection_id?: string | null;
  riot_connection_verified: boolean;
  referral_code?: string | null;
  referred_by?: string | null;
}

// Start an OAuth sign-in. Redirects the browser to the provider; on return,
// tokens arrive in the URL hash at /auth/callback and the auth client's
// detectSessionInUrl consumes them (same mechanism as organizer invites).
export async function signInWithProvider(provider: OAuthProvider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      // `connections` lets us read the user's verified Riot Games connection
      // from the returning one-shot provider_token (captured by capture-riot-id)
      // — that powers the background "this could be your profile" match.
      ...(provider === 'discord' ? { scopes: 'identify email connections' } : {}),
    },
  });
  if (error) throw error;
  writeSessionPolicy(true);
}

// Link a SECOND provider to the already-signed-in user (the "verify" action).
// Requires "Allow manual linking" enabled in the Supabase dashboard. Returns
// to /profile where the identity flags get re-synced.
export async function linkProvider(provider: OAuthProvider) {
  const { error } = await supabase.auth.linkIdentity({
    provider,
    options: {
      redirectTo: `${window.location.origin}/profile?linked=1`,
      // See signInWithProvider — request `connections` so the returning token
      // can be used to capture the user's verified Riot ID.
      ...(provider === 'discord' ? { scopes: 'identify email connections' } : {}),
    },
  });
  if (error) throw error;
}

// Re-run the Discord grant from the profile page purely to (re)capture the Riot
// connection — the "Connect your Riot account" nudge. Same user, returns to
// /profile; AuthContext's provider-token handler then calls capture-riot-id.
export async function verifyRiotConnection() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo: `${window.location.origin}/profile?riot=1`,
      scopes: 'identify email connections',
    },
  });
  if (error) throw error;
}

// Providers currently linked to the signed-in user, from auth identities.
// 'email' identities (admin/organizer logins) are reported too.
export async function getLinkedProviders(): Promise<string[]> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return [];
  return (data.user.identities ?? []).map(i => i.provider);
}

// Read the signed-in user's own player account. Token-first via dbClient (no
// GoTrue lock), same pattern as getCurrentProfile.
export async function getPlayerAccount(userId: string, accessToken?: string): Promise<PlayerAccount | null> {
  const client = accessToken ? dbClient : supabase;
  const q = client.from('player_accounts').select('*').eq('id', userId).maybeSingle();
  const { data, error } = accessToken ? await q.setHeader('Authorization', `Bearer ${accessToken}`) : await q;
  if (error) return null;
  return (data as PlayerAccount) ?? null;
}

// Public read of any player account (other visitors viewing a profile) —
// always through the anonymous client so it can never stall on auth.
export async function getPublicPlayerAccount(userId: string): Promise<PlayerAccount | null> {
  const { data, error } = await dbClient.from('player_accounts').select('*').eq('id', userId).maybeSingle();
  if (error) return null;
  return (data as PlayerAccount) ?? null;
}

// Create-or-update the signed-in user's player account. The identity-flag
// trigger overwrites google_linked/discord_linked/discord_* from
// auth.identities on every write, so calling this after a login or a link is
// what refreshes the verified badge.
export async function upsertPlayerAccount(
  patch: Partial<Pick<PlayerAccount, 'display_name' | 'avatar_url' | 'bio' | 'socials' | 'riot_id'>>
): Promise<PlayerAccount | null> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const meta = (session.user.user_metadata ?? {}) as Record<string, any>;
  const fallbackName =
    meta.full_name || meta.name || meta.preferred_username || session.user.email?.split('@')[0] || 'Player';
  const row = {
    id: session.user.id,
    display_name: patch.display_name ?? fallbackName,
    ...(patch.avatar_url !== undefined ? { avatar_url: patch.avatar_url } : {}),
    ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
    ...(patch.socials !== undefined ? { socials: patch.socials } : {}),
    ...(patch.riot_id !== undefined ? { riot_id: patch.riot_id } : {}),
  };
  const client = bearerClient(session.access_token);
  const { data, error } = await client
    .from('player_accounts')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data as PlayerAccount;
}

// Outcome of ensurePlayerAccount. `duplicate_email` means this OAuth sign-in
// minted a SECOND auth user for an email that already owns an account — the
// 007 guard blocked the competing profile. The UI must steer the user to sign
// in with their original provider and LINK this one, not create a rival
// account. `email` is the colliding address (for the recovery message).
export type EnsureAccountResult =
  | { status: 'ok'; account: PlayerAccount; created: boolean }
  | { status: 'duplicate_email'; email: string | null }
  | { status: 'error' };

// Ensure a player_accounts row exists after an OAuth sign-in, WITHOUT
// clobbering fields the user already edited: only inserts when missing,
// otherwise issues a no-op update so the trigger re-syncs identity flags.
export async function ensurePlayerAccount(): Promise<EnsureAccountResult> {
  const session = await getSession();
  if (!session) return { status: 'error' };
  const existing = await getPlayerAccount(session.user.id, session.access_token);
  if (existing) {
    // Touch the row so the trigger refreshes linked flags from auth.identities
    // (e.g. right after linkIdentity returned).
    const client = bearerClient(session.access_token);
    const { data, error } = await client
      .from('player_accounts')
      .update({ display_name: existing.display_name })
      .eq('id', session.user.id)
      .select()
      .single();
    return { status: 'ok', account: (error ? existing : (data as PlayerAccount)), created: false };
  }
  const meta = (session.user.user_metadata ?? {}) as Record<string, any>;
  const client = bearerClient(session.access_token);
  const { data, error } = await client
    .from('player_accounts')
    .insert({
      id: session.user.id,
      display_name:
        meta.full_name || meta.name || meta.preferred_username || session.user.email?.split('@')[0] || 'Player',
      avatar_url: meta.avatar_url || meta.picture || null,
    })
    .select()
    .single();
  if (error) {
    // The 007 guard raises with message 'duplicate_player_email'.
    if (error.message?.includes('duplicate_player_email')) {
      return { status: 'duplicate_email', email: session.user.email ?? null };
    }
    return { status: 'error' };
  }
  return { status: 'ok', account: data as PlayerAccount, created: true };
}

// ─── Profile claims (tournament player cards) ───────────────────────────────
// A verified player proves they own a tournament player card by re-authing
// Discord with the `connections` scope; the verify-riot-claim edge function
// checks the Riot Games connection server-side and records the claim. Clients
// can only READ claims — all writes happen in edge functions (service role).

export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export interface PlayerClaim {
  id: string;
  user_id: string;
  tournament_id: string;
  player_id: string;
  player_name?: string | null;
  riot_id: string;
  status: ClaimStatus;
  created_at: string;
  decided_at?: string | null;
}

export type ClaimSubmitStatus =
  | 'submitted'
  | 'no_riot_connection'
  | 'riot_unverified'
  | 'riot_mismatch'
  | 'claim_taken'
  | 'already_has_claim'
  | 'not_verified_account'
  | 'player_not_found'
  | 'card_has_no_riot_id'
  | 'bad_token'
  | 'error';

export interface ClaimSubmitResult {
  status: ClaimSubmitStatus;
  got?: string;       // riot_mismatch: the Riot ID on the user's Discord
  expected?: string;  // riot_mismatch: the Riot ID on the card
}

// Where we stash "which card was being claimed" across the Discord OAuth
// round-trip. The redirect lands back on the player page; this survives it.
const CLAIM_INTENT_KEY = 'clutchgg-claim-intent';

export interface ClaimIntent { tournamentId: string; playerId: string; ts: number; reauth: boolean; }

export function readClaimIntent(): ClaimIntent | null {
  try {
    const raw = localStorage.getItem(CLAIM_INTENT_KEY);
    if (!raw) return null;
    const intent = JSON.parse(raw) as ClaimIntent;
    // Stale intents (>10 min) are abandoned round-trips — ignore them.
    if (!intent.tournamentId || !intent.playerId || Date.now() - intent.ts > 10 * 60_000) return null;
    return intent;
  } catch {
    return null;
  }
}

export function clearClaimIntent() {
  try { localStorage.removeItem(CLAIM_INTENT_KEY); } catch { /* ignore */ }
}

// Kick off the Discord re-auth that carries the `connections` scope. The user
// is already linked to Discord, so this signs the SAME user back in and the
// returning session carries a one-shot provider_token the edge function can
// use against Discord's API. Lands back on the player page with ?claim=1.
export async function startClaimReauth(tournamentId: string, playerId: string) {
  try {
    // reauth:true marks this as a genuine claim re-auth we are about to start,
    // so the resume effect knows the returning provider_token was minted FOR
    // this claim (with the connections scope) — not a stale token left over
    // from an ordinary Discord login or a background TOKEN_REFRESHED event.
    localStorage.setItem(CLAIM_INTENT_KEY, JSON.stringify({ tournamentId, playerId, ts: Date.now(), reauth: true }));
  } catch { /* private mode — ?claim=1 still hints the resume */ }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo: `${window.location.origin}/player/${tournamentId}/${playerId}?claim=1`,
      scopes: 'identify email connections',
    },
  });
  if (error) throw error;
}

// The claim state other visitors see for a card: an approved claim is public;
// a pending claim is visible only to its claimant (RLS) — exactly what the UI
// needs to decide whether to show the button / chip / claimed profile.
export async function getClaimForCard(tournamentId: string, playerId: string): Promise<PlayerClaim | null> {
  // Token-first through dbClient when signed in, so the claimant also sees
  // their own pending claim; anonymous visitors still get approved ones.
  const stored = getStoredSession();
  const q = dbClient
    .from('player_claims')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .neq('status', 'rejected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = stored && !stored.accessTokenExpired
    ? await q.setHeader('Authorization', `Bearer ${stored.access_token}`)
    : await q;
  if (error) return null;
  return (data as PlayerClaim) ?? null;
}

// All of the signed-in user's claims (profile page list).
export async function getMyClaims(): Promise<PlayerClaim[]> {
  const stored = getStoredSession();
  if (!stored || stored.accessTokenExpired) return [];
  const { data, error } = await dbClient
    .from('player_claims')
    .select('*')
    .eq('user_id', stored.user.id)
    .order('created_at', { ascending: false })
    .setHeader('Authorization', `Bearer ${stored.access_token}`);
  if (error) return [];
  return (data ?? []) as PlayerClaim[];
}

// Pending claims for the superadmin approval queue (RLS lets superadmins read
// them through their authenticated session).
export async function getPendingClaims(): Promise<PlayerClaim[]> {
  const { data, error } = await supabase
    .from('player_claims')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data ?? []) as PlayerClaim[];
}

// A user whose verified Riot connection matches tournament player card(s) — the
// admin "auto-matched users" view (admin-riot-matches edge fn, superadmin only).
export interface RiotMatchUser {
  userId: string;
  displayName: string;
  discordUsername?: string | null;
  riotConnectionId?: string | null;
  hasClaim: boolean;
  matches: ProfileMatch[];
}

// Contact info for claimants (superadmin only) — so an admin can reach a user
// about their claim. Email comes from auth.users (not otherwise client-readable).
export interface ClaimContact {
  email?: string | null;
  displayName?: string | null;
  discordUsername?: string | null;
  discordId?: string | null;
  gameConnection?: string | null;
}

export async function getClaimContacts(userIds: string[]): Promise<Record<string, ClaimContact>> {
  if (userIds.length === 0) return {};
  try {
    const invoke = supabase.functions.invoke('admin-claim-contacts', { body: { userIds } });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('admin-claim-contacts timed out')), 20_000)
    );
    const { data, error } = await Promise.race([invoke, timeout]);
    if (error || !data || data.error) return {};
    return (data.contacts ?? {}) as Record<string, ClaimContact>;
  } catch {
    return {};
  }
}

// Superadmin: list everyone the background match found (who could claim a
// profile). Read-only; returns [] on any error.
export async function getAdminRiotMatches(): Promise<RiotMatchUser[]> {
  try {
    const invoke = supabase.functions.invoke('admin-riot-matches', { body: {} });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('admin-riot-matches timed out')), 20_000)
    );
    const { data, error } = await Promise.race([invoke, timeout]);
    if (error || !data || data.error) return [];
    return Array.isArray(data.users) ? data.users : [];
  } catch {
    return [];
  }
}

// Submit the claim: hand the one-shot Discord provider_token to the edge
// function, which does every check server-side. 20s timeout race, same shape
// as approveTournamentRequest in db.ts.
export async function submitClaim(
  providerToken: string,
  tournamentId: string,
  playerId: string
): Promise<ClaimSubmitResult> {
  try {
    const invoke = supabase.functions.invoke('verify-riot-claim', {
      body: { providerToken, tournamentId, playerId },
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Claim verification timed out')), 20_000)
    );
    const { data, error } = await Promise.race([invoke, timeout]);
    if (error) return { status: 'error' };
    if (!data || data.error) return { status: 'error' };
    return data as ClaimSubmitResult;
  } catch {
    return { status: 'error' };
  }
}

export type CaptureRiotStatus =
  | 'captured'          // verified Riot connection stored
  | 'no_riot_connection'
  | 'riot_unverified'
  | 'no_discord'
  | 'bad_token'
  | 'error';

// Module-level dedup: AuthContext (on the Discord auth event) AND the profile
// "Verify" button (on ?riot=1) can both fire for the SAME one-shot provider
// token. Without this, capture-riot-id gets called twice (or looped by repeated
// auth events) — which is what made the admin page crawl. We resolve the same
// token's in-flight promise for all callers and never re-send a settled token.
const captureCache = new Map<string, Promise<CaptureRiotStatus>>();

// Capture (or refresh) the caller's verified Riot connection from Discord, using
// the one-shot provider_token. Used both from AuthContext after a Discord login
// AND directly from the profile "Verify" button (which surfaces the returned
// status as a toast). Failures are non-fatal. Does NOT claim.
export async function captureRiotId(providerToken: string): Promise<CaptureRiotStatus> {
  if (!providerToken) return 'bad_token';
  const cached = captureCache.get(providerToken);
  if (cached) return cached;

  const run = (async (): Promise<CaptureRiotStatus> => {
    try {
      const invoke = supabase.functions.invoke('capture-riot-id', { body: { providerToken } });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('capture-riot-id timed out')), 15_000)
      );
      const { data, error } = await Promise.race([invoke, timeout]);
      if (error || !data || data.error) return 'error';
      return (data.status as CaptureRiotStatus) ?? 'error';
    } catch {
      return 'error';
    }
  })();

  captureCache.set(providerToken, run);
  // Cap the cache so it can't grow unbounded across a long session.
  if (captureCache.size > 20) {
    const first = captureCache.keys().next().value;
    if (first) captureCache.delete(first);
  }
  return run;
}

// One player card the signed-in user's verified Riot ID matches — the unit the
// "this could be your profile" suggestions are built from.
export interface ProfileMatch {
  tournamentId: string;
  tournamentName?: string;
  playerId: string;
  playerName?: string;
  teamName?: string;
  riotId: string;
}

export interface ProfileMatchResult {
  status: 'found' | 'no_match' | 'no_verified_riot' | 'error';
  matches: ProfileMatch[];
  hasActiveClaim: boolean;
}

// Background match: server-side, find player cards whose riotId equals the
// caller's verified Riot ID (find-my-player-profiles). Card Riot IDs never reach
// the client — only the caller's own matches come back.
export async function findMyPlayerProfiles(): Promise<ProfileMatchResult> {
  const empty: ProfileMatchResult = { status: 'error', matches: [], hasActiveClaim: false };
  try {
    const invoke = supabase.functions.invoke('find-my-player-profiles', { body: {} });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('find-my-player-profiles timed out')), 15_000)
    );
    const { data, error } = await Promise.race([invoke, timeout]);
    if (error || !data || data.error) return empty;
    return {
      status: data.status ?? 'error',
      matches: Array.isArray(data.matches) ? data.matches : [],
      hasActiveClaim: !!data.hasActiveClaim,
    };
  } catch {
    return empty;
  }
}

// Release a claim. The claimant can release their own; a superadmin can
// release anyone's. Frees the per-user and per-card slots and (for an approved
// claim) clears riot_id_verified on the account.
export async function unclaimProfile(claimId: string): Promise<void> {
  const invoke = supabase.functions.invoke('unclaim-profile', { body: { claimId } });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Unclaim timed out')), 20_000)
  );
  const { data, error } = await Promise.race([invoke, timeout]);
  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error || 'Unclaim failed');
}

// The signed-in user's current ACTIVE claim (pending or approved), if any.
// Used to gate the claim button: a user with an active claim can't make a new
// one until they unclaim.
export async function getMyActiveClaim(): Promise<PlayerClaim | null> {
  const stored = getStoredSession();
  if (!stored || stored.accessTokenExpired) return null;
  const { data, error } = await dbClient
    .from('player_claims')
    .select('*')
    .eq('user_id', stored.user.id)
    .neq('status', 'rejected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .setHeader('Authorization', `Bearer ${stored.access_token}`);
  if (error) return null;
  return (data as PlayerClaim) ?? null;
}

// Superadmin decision on a pending claim.
export async function decideClaim(claimId: string, decision: 'approved' | 'rejected'): Promise<void> {
  const invoke = supabase.functions.invoke('decide-claim', { body: { claimId, decision } });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Decision timed out')), 20_000)
  );
  const { data, error } = await Promise.race([invoke, timeout]);
  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error || 'Decision failed');
}

// Upload a profile photo to the avatars bucket (path prefix = uid, enforced by
// storage RLS) and return its public URL.
export async function uploadAvatar(file: File): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${session.user.id}/avatar-${Date.now()}.${ext}`;
  const client = bearerClient(session.access_token);
  const { error } = await client.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
  if (error) throw error;
  const { data } = client.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

// Change the signed-in user's password and clear the must_change_password flag.
export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  // Clear the flag best-effort — don't await it. If the profile update stalls
  // (e.g. RLS blocks self-update for an organizer session) we must not let it
  // hang the caller's 15s race and show a false "timed out" error when the
  // password itself was set successfully.
  getSession().then(session => {
    if (session) {
      supabase.from('profiles').update({ must_change_password: false }).eq('id', session.user.id).then(() => {});
    }
  });
}
