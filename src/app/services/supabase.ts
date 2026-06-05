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
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string, rememberMe = true) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  // When "remember me" is off, clear the persisted token immediately after
  // sign-in so the session only lives in memory and is gone on tab/browser close.
  if (!rememberMe) {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key !== 'sb-clutchgg-anon' && (key.startsWith('sb-') || key.includes('supabase.auth'))) {
          localStorage.removeItem(key);
        }
      }
    } catch { /* private mode */ }
  }
  return data;
}

export async function signOut() {
  // The ONLY thing that reliably logs the user out is clearing the locally
  // stored session token — `scope: 'local'` does exactly that and makes NO
  // network call, so it can never hang and always removes the token from
  // storage synchronously. Do this FIRST and unconditionally; if it's skipped
  // (e.g. because a global revoke stalled), the next getSession() rehydrates
  // the old user and "sign out" appears to do nothing.
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // ignore — we still hard-purge storage below
  }

  // Best-effort server-side revocation of other sessions. Fire-and-forget with
  // a short timeout so a stalled network call never blocks the UI; the local
  // token is already gone, so the user is logged out regardless of this result.
  Promise.race([
    supabase.auth.signOut({ scope: 'global' }),
    new Promise(resolve => setTimeout(resolve, 3_000)),
  ]).catch(() => {});

  // Belt-and-suspenders: explicitly purge any Supabase auth keys left in
  // localStorage. Some supabase-js versions leave a stale key behind on a
  // partial signout, which would silently restore the session on next load.
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
}

export async function getSession() {
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

export async function getCurrentProfile(): Promise<Profile | null> {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
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
      .eq('user_id', session.user.id);
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
