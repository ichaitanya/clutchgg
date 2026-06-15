// Pickems data layer. Reads go through the lock-free dbClient (token-first where a
// signed-in view is needed); all writes go through Edge Functions via the auth
// client. Mirrors the claim flow in supabase.ts. See [[two-supabase-clients]].

import { dbClient, supabase, getStoredSession } from './supabase';

// ── Types (match migration 010) ─────────────────────────────────────────────
export type PickemKind = 'match_winner' | 'map_winner' | 'map_score' | 'top_acs' | 'mvp' | 'custom';
export type PickemStatus = 'open' | 'locked' | 'graded' | 'void';

export interface PickemOption {
  id: string;
  label: string;
  meta?: { teamId?: string; playerId?: string; team1Maps?: number; team2Maps?: number };
}

export interface PickemQuestion {
  id: string;
  tournament_id: string;
  match_id: string;
  stage: string | null;
  kind: PickemKind;
  prompt: string;
  options: PickemOption[];
  auto_grade: boolean;
  map_index: number | null;
  points: number;
  sort_order: number;
  status: PickemStatus;
  correct_option_id: string | null;
  locks_at: string | null;
}

export interface PickemPick {
  question_id: string;
  option_id: string;
  is_correct: boolean | null;
  points_awarded: number;
}

export interface PickemQuota {
  used: number;
  allowance: number;
  unlimited: boolean;
  verified_referrals: number;
}

export interface PickemScoreRow {
  user_id: string;
  tournament_id: string;
  points: number;
  correct_count: number;
  total_picks: number;
  // joined display fields
  display_name?: string;
  avatar_url?: string | null;
  is_verified?: boolean;
}

export interface ReferralStats {
  code: string;
  total: number;
  verified: number;
}

export interface PickemMatchState {
  match_id: string;
  published: boolean;
  results_published: boolean;
}

// ── Reads ───────────────────────────────────────────────────────────────────

// All questions for a tournament. Reads as anon by default (public), but can
// accept an authenticated client for organizer/staff views where draft questions
// should be visible (RLS policy allows staff/organizers to see drafts).
export async function getTournamentQuestions(tournamentId: string, authClient?: typeof supabase): Promise<PickemQuestion[]> {
  const client = authClient || dbClient;
  const { data, error } = await client
    .from('pickem_questions')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('match_id', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) return [];
  return (data ?? []) as PickemQuestion[];
}

// Per-match publish state for a tournament (public). Drives draft/published and
// results-revealed gating in both the play view and the organizer panel.
export async function getMatchStates(tournamentId: string): Promise<Record<string, PickemMatchState>> {
  const { data, error } = await dbClient
    .from('pickem_match_state')
    .select('match_id, published, results_published')
    .eq('tournament_id', tournamentId);
  if (error) return {};
  const out: Record<string, PickemMatchState> = {};
  for (const r of (data ?? []) as PickemMatchState[]) out[r.match_id] = r;
  return out;
}

// The signed-in user's picks for a tournament (own-only by RLS). Empty when signed out.
export async function getMyPicks(tournamentId: string): Promise<PickemPick[]> {
  const stored = getStoredSession();
  if (!stored || stored.accessTokenExpired) return [];
  const { data, error } = await dbClient
    .from('pickem_picks')
    .select('question_id, option_id, is_correct, points_awarded')
    .eq('tournament_id', tournamentId)
    .eq('user_id', stored.user.id)
    .setHeader('Authorization', `Bearer ${stored.access_token}`);
  if (error) return [];
  return (data ?? []) as PickemPick[];
}

// Per-option vote counts for already-locked questions (public, post-lock only),
// scoped to the tournament so we don't pull site-wide distribution.
export async function getPickDistribution(tournamentId: string): Promise<Record<string, Record<string, number>>> {
  const { data, error } = await dbClient
    .from('pickem_pick_distribution')
    .select('question_id, option_id, votes')
    .eq('tournament_id', tournamentId);
  if (error) return {};
  const out: Record<string, Record<string, number>> = {};
  for (const row of (data ?? []) as any[]) {
    (out[row.question_id] ??= {})[row.option_id] = row.votes;
  }
  return out;
}

// Quota for the signed-in user (server-authoritative). Null when signed out.
export async function getMyQuota(): Promise<PickemQuota | null> {
  const stored = getStoredSession();
  if (!stored || stored.accessTokenExpired) return null;
  const { data, error } = await dbClient
    .rpc('pickem_quota', { uid: stored.user.id })
    .setHeader('Authorization', `Bearer ${stored.access_token}`);
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as PickemQuota) ?? null;
}

// The signed-in user's referral code + progress.
export async function getMyReferralStats(): Promise<ReferralStats | null> {
  const stored = getStoredSession();
  if (!stored || stored.accessTokenExpired) return null;
  const auth = `Bearer ${stored.access_token}`;
  const [{ data: acct }, { data: refs }] = await Promise.all([
    dbClient.from('player_accounts').select('referral_code').eq('id', stored.user.id).maybeSingle()
      .setHeader('Authorization', auth),
    dbClient.from('referrals').select('status').eq('referrer_id', stored.user.id)
      .setHeader('Authorization', auth),
  ]);
  if (!acct?.referral_code) return null;
  const list = (refs ?? []) as { status: string }[];
  return {
    code: acct.referral_code,
    total: list.length,
    verified: list.filter(r => r.status === 'verified').length,
  };
}

// Strip characters a user could abuse in a public display name: bidi/RTL
// overrides, zero-width joiners/spaces, and other control chars that let a name
// impersonate or visually scramble the leaderboard. Collapse whitespace + trim.
// (React already escapes HTML, so this is about visual spoofing, not XSS.)
export function sanitizeDisplayName(name: string | undefined | null): string {
  if (!name) return 'Player';
  // Remove C0/C1 controls, bidi overrides (RLO/LRO/RLI/...), zero-width chars and
  // BOM that let a name impersonate or scramble the leaderboard. Escapes only —
  // no literal invisible characters live in this source.
  // eslint-disable-next-line no-control-regex
  const BAD = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
  const cleaned = name.replace(BAD, '').replace(/\s+/g, ' ').trim();
  return cleaned || 'Player';
}

// Public leaderboard for a tournament, joined with player display fields.
export async function getPickemLeaderboard(tournamentId: string): Promise<PickemScoreRow[]> {
  const { data, error } = await dbClient
    .from('pickem_scores')
    .select('user_id, tournament_id, points, correct_count, total_picks, player_accounts(display_name, avatar_url, is_verified)')
    .eq('tournament_id', tournamentId)
    .order('points', { ascending: false })
    .order('correct_count', { ascending: false })
    .limit(200);
  if (error) return [];
  return ((data ?? []) as any[]).map(r => ({
    user_id: r.user_id,
    tournament_id: r.tournament_id,
    points: r.points,
    correct_count: r.correct_count,
    total_picks: r.total_picks,
    display_name: sanitizeDisplayName(r.player_accounts?.display_name),
    avatar_url: r.player_accounts?.avatar_url ?? null,
    is_verified: r.player_accounts?.is_verified ?? false,
  }));
}

// ── Writes (edge functions) ─────────────────────────────────────────────────

function invokeWithTimeout<T = any>(name: string, body: unknown, ms = 20_000): Promise<{ data: T | null; error: any }> {
  const invoke = supabase.functions.invoke(name, { body });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${name} timed out`)), ms)
  );
  return Promise.race([invoke, timeout]) as any;
}

export interface SubmitPickResult {
  ok?: boolean;
  optionId?: string;
  quota?: PickemQuota | null;
  reason?: 'not_verified' | 'locked' | 'quota_exceeded' | 'bad_option' | 'no_account';
  error?: string;
}

// Player submits/changes an answer. Surfaces the server's reason codes so the UI
// can show the right message (verify / locked / out of picks).
export async function submitPick(questionId: string, optionId: string): Promise<SubmitPickResult> {
  const { data, error } = await invokeWithTimeout<SubmitPickResult>('submit-pick', { questionId, optionId });
  if (error) {
    // functions.invoke returns the JSON body in error.context for non-2xx; try to surface reason.
    const ctxBody = await safeBody(error);
    return ctxBody ?? { error: 'Could not save your pick. Please try again.' };
  }
  return data ?? { error: 'Could not save your pick. Please try again.' };
}

// Try to read the JSON body of a FunctionsHttpError so reason codes (402/403/409)
// reach the UI instead of a generic "non-2xx" message.
async function safeBody(error: any): Promise<any | null> {
  try {
    const res = error?.context;
    if (res && typeof res.json === 'function') return await res.json();
  } catch { /* ignore */ }
  return null;
}

// ── Organizer writes ────────────────────────────────────────────────────────

export async function seedPickems(tournamentId: string, matchId: string) {
  const { data, error } = await invokeWithTimeout('seed-pickems', { tournamentId, matchId });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not seed questions');
  return data;
}

export async function gradeMatchPickems(tournamentId: string, matchId: string, regrade = false) {
  const { data, error } = await invokeWithTimeout('grade-pickems', { tournamentId, matchId, regrade });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not grade');
  return data;
}

export async function overridePickemAnswer(questionId: string, correctOptionId: string) {
  const { data, error } = await invokeWithTimeout('grade-pickems', { questionId, correctOptionId });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not set answer');
  return data;
}

export async function createCustomQuestion(args: {
  tournamentId: string; matchId: string; stage?: string | null; prompt: string;
  options: { id: string; label: string }[]; points?: number;
}) {
  const { error } = await invokeWithTimeout('manage-pickem-question', { action: 'create', ...args });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not create question');
}

export async function updateQuestion(args: {
  questionId: string; prompt?: string; options?: { id: string; label: string }[];
  points?: number; sortOrder?: number;
}) {
  const { error } = await invokeWithTimeout('manage-pickem-question', { action: 'update', ...args });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not update question');
}

export async function deleteQuestion(questionId: string) {
  const { error } = await invokeWithTimeout('manage-pickem-question', { action: 'delete', questionId });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not delete question');
}

export async function lockMatchPickems(tournamentId: string, matchId: string) {
  const { error } = await invokeWithTimeout('manage-pickem-question', { action: 'lock', tournamentId, matchId });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not lock');
}

export async function unlockMatchPickems(tournamentId: string, matchId: string) {
  const { error } = await invokeWithTimeout('manage-pickem-question', { action: 'unlock', tournamentId, matchId });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not unlock');
}

// Publish a draft match's questions to players (requires >=5 questions).
export async function publishMatch(tournamentId: string, matchId: string) {
  const { error } = await invokeWithTimeout('manage-pickem-question', { action: 'publish', tournamentId, matchId });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not publish');
}

// Pull a draft match back (only while no picks exist).
export async function unpublishMatch(tournamentId: string, matchId: string) {
  const { error } = await invokeWithTimeout('manage-pickem-question', { action: 'unpublish', tournamentId, matchId });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not unpublish');
}

// Reveal graded results + award points to players (after the organizer reviews).
export async function publishResults(tournamentId: string, matchId: string) {
  const { error } = await invokeWithTimeout('manage-pickem-question', { action: 'publish-results', tournamentId, matchId });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not publish results');
}

// Superadmin-only: opt the caller IN/OUT of this tournament's pickem leaderboard.
// Superadmins are excluded from scoring by default (they can set answers); this
// lets one explicitly choose to play a specific event anyway.
export async function setMyPickemScoreOptIn(tournamentId: string, optIn: boolean) {
  const { error } = await invokeWithTimeout('manage-pickem-question', { action: 'set-score-opt-in', tournamentId, optIn });
  if (error) throw new Error((await safeBody(error))?.error || 'Could not update leaderboard opt-in');
}

// Whether the signed-in user has opted in to this tournament's pickem leaderboard
// (relevant for superadmins, who are excluded by default). False if signed out.
export async function getMyPickemScoreOptIn(tournamentId: string): Promise<boolean> {
  const stored = getStoredSession();
  if (!stored || stored.accessTokenExpired) return false;
  const { data, error } = await dbClient
    .from('pickem_score_overrides')
    .select('user_id')
    .eq('tournament_id', tournamentId)
    .eq('user_id', stored.user.id)
    .maybeSingle()
    .setHeader('Authorization', `Bearer ${stored.access_token}`);
  if (error) return false;
  return !!data;
}

// Record a referral after account creation (no-op server-side if no/invalid code).
export async function claimReferral(code: string): Promise<{ applied: boolean }> {
  const { data, error } = await invokeWithTimeout('claim-referral', { code });
  if (error) return { applied: false };
  return { applied: !!data?.applied };
}

// ── Client-side helpers ──────────────────────────────────────────────────────

// Effective lock for a question without a round-trip: only an explicit
// non-open status (locked/graded/void) shows as locked. The server independently
// enforces the live locks_at cutoff on submit-pick, so a stale/past locks_at
// snapshot (e.g. before the organizer updates the match schedule) doesn't make a
// freshly-published question appear locked.
export function isQuestionLocked(q: PickemQuestion): boolean {
  return q.status !== 'open';
}
