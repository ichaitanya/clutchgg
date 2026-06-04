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

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  // Always clear local session state regardless of whether the server call
  // succeeds — a network error on signout must never leave the user stuck on
  // the admin panel. supabase.auth.signOut() with 'local' scope clears the
  // stored session without making a network request.
  try {
    await Promise.race([
      supabase.auth.signOut(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000)),
    ]);
  } catch {
    // Server-side revocation failed or timed out — force local signout anyway.
    await supabase.auth.signOut({ scope: 'local' });
  }
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export type UserRole = 'admin' | 'superadmin' | 'organizer';

export interface Profile {
  id: string;
  display_name: string;
  role: UserRole;
  email?: string | null;
  // For organizers: the single tournament (tournaments_blob.id) they may edit.
  tournament_id?: string | null;
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
  return data as Profile;
}

export async function isAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile?.role === 'admin' || profile?.role === 'superadmin';
}

// Change the signed-in user's password and clear the must_change_password flag.
export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  const session = await getSession();
  if (session) {
    await supabase.from('profiles').update({ must_change_password: false }).eq('id', session.user.id);
  }
}
