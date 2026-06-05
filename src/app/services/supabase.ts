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

// Load the signed-in user's profile. Pass `userId` when the caller already has
// it (e.g. from an onAuthStateChange session) to skip a redundant getSession()
// round-trip — that extra call was a meaningful chunk of the post-login delay.
export async function getCurrentProfile(userId?: string): Promise<Profile | null> {
  let uid = userId;
  if (!uid) {
    const session = await getSession();
    if (!session) return null;
    uid = session.user.id;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .single();
  if (error) return null;
  const profile = data as Profile;

  // For organizers, load the full set of tournaments they're scoped to from the
  // junction table (a single organizer may manage several). Union in the legacy
  // single column so a not-yet-migrated profile still works.
  if (profile.role === 'organizer') {
    const { data: rows } = await supabase
      .from('organizer_tournaments')
      .select('tournament_id')
      .eq('user_id', uid);
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
