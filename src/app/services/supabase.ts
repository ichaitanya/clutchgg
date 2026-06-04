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
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
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
