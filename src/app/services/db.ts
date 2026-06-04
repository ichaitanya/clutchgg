import { supabase, dbClient } from './supabase';
import type { Tournament } from '../components/TournamentCreation';
import type { AdminData, NewsItem, TopPlayer, StandingTeam } from '../components/AdminPanel';

// Reads go through `dbClient` (anonymous, no session) so a stalled auth-token
// refresh can never block a public page from loading. Writes and Edge Function
// invokes go through `supabase` (the auth client) so they carry the signed-in
// JWT required by the is_staff()/my_tournament_id() RLS policies.

// ─── Read cache ─────────────────────────────────────────────────────────────────
// Every public page (home, matches, teams, stats, tournament, player, …) fetches
// the same data on mount. Without caching, each navigation re-downloads and
// re-parses it. This in-memory cache (per browser session) dedupes concurrent
// requests and serves repeat reads for a short TTL, so moving between pages is
// instant. Any write invalidates the affected key so the next read is fresh.
//
// Design: a short fresh-TTL plus per-page polling (see usePolledData / the live
// pages) is what keeps an open tab current — NOT a background-revalidate cache.
// An earlier stale-while-revalidate variant refreshed the cache in the
// background but never re-rendered the page that already read it, so the
// "revalidate" half did nothing visible. We dropped it: reads are either fresh
// (served from cache) or re-fetched, and freshness on an open page comes from
// the page re-calling the fetcher on an interval. The TTL is deliberately
// shorter than the poll interval so a poll actually reaches the network.

const CACHE_TTL_MS = 30_000; // serve cached reads for up to 30s (< poll interval)

type CacheEntry<T> = { value: T; at: number };
const cacheStore = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
// Monotonically-increasing version per key. Bumped by invalidate() so an
// in-flight fetch started before the invalidation knows its result is stale and
// must not be written back into the cache (prevents a slow read from clobbering
// a just-written value).
const cacheVersion = new Map<string, number>();

const FETCH_TIMEOUT_MS = 9_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

function getVersion(key: string): number {
  return cacheVersion.get(key) ?? 0;
}

// Read-through cache with in-flight dedup:
// - Fresh (< TTL): return the cached value immediately, no network.
// - Otherwise: fetch (sharing one in-flight promise across concurrent callers),
//   cache the result, and resolve. A failed/timed-out fetch is never cached, so
//   the caller's retry layer (loadWithRetry) re-attempts cleanly.
function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cacheStore.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const ver = getVersion(key);
  const p = withTimeout(fetcher(), FETCH_TIMEOUT_MS)
    .then(value => {
      // Only write back if invalidate() hasn't bumped the version since we
      // started — a concurrent write must win over an older read.
      if (getVersion(key) === ver) {
        cacheStore.set(key, { value, at: Date.now() });
      }
      inflight.delete(key);
      return value;
    })
    .catch(err => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, p);
  return p;
}

// Drop one or more cache keys so the next read re-fetches. Called after writes.
// Bumps the version so any orphaned background fetch can't overwrite the cache.
function invalidate(...keys: string[]) {
  for (const k of keys) {
    cacheStore.delete(k);
    inflight.delete(k);
    cacheVersion.set(k, (cacheVersion.get(k) ?? 0) + 1);
  }
}

// Clear everything (used by the admin panel to force a full refresh).
export function clearDbCache() {
  cacheStore.clear();
  inflight.clear();
  cacheVersion.clear();
}

// Note: we no longer globally clear `inflight` on tab refocus. A fetch that the
// browser stalls while hidden is bounded by the 10s AbortSignal in
// fetchWithTimeout (supabase.ts) → it rejects, `cached()` drops it from inflight,
// and the caller's retry re-attempts. Freshness on refocus is handled per-page
// by loadWithRetryPolled, which fires an immediate refresh when the tab becomes
// visible again.

// Retry a read with capped exponential backoff (500ms → 1s → 2s → 4s → 8s, then
// 8s forever) until it succeeds or `shouldStop()` returns true. Pages use this
// so a transient stall/timeout never leaves them permanently blank or showing a
// false "not found" — they keep retrying quietly in the background until data
// arrives. Returns a stop function; call it on unmount to cancel the chain.
export function loadWithRetry<T>(
  fetcher: () => Promise<T>,
  onSuccess: (value: T) => void,
  onError?: () => void,
): () => void {
  let stopped = false;
  const attempt = (n: number) => {
    fetcher()
      .then(value => { if (!stopped) onSuccess(value); })
      .catch(() => {
        if (stopped) return;
        onError?.();
        const delay = Math.min(500 * 2 ** (n - 1), 8000);
        setTimeout(() => { if (!stopped) attempt(n + 1); }, delay);
      });
  };
  attempt(1);
  return () => { stopped = true; };
}

// Like loadWithRetry, but ALSO re-fetches every `intervalMs` so an open page
// (live match scores, brackets, the home spotlight) stays current without a
// manual reload — a quiet background refresh that swaps data in on success and
// never shows a loading state or blanks the page. Polls are skipped while the
// tab is hidden (the browser throttles background timers anyway) and one fires
// immediately on refocus so the user always sees fresh data when they return.
// The cache TTL is shorter than `intervalMs`, so each poll actually reaches the
// network rather than returning a still-fresh cache entry.
const POLL_INTERVAL_MS = 90_000;

export function loadWithRetryPolled<T>(
  fetcher: () => Promise<T>,
  onSuccess: (value: T) => void,
  intervalMs: number = POLL_INTERVAL_MS,
): () => void {
  let stopped = false;
  // Monotonic request counter. Every fetch (initial or poll) claims a sequence
  // number; only a result whose sequence is the newest started is allowed to
  // call onSuccess. Without this, a slow earlier request can resolve AFTER a
  // faster later one (e.g. an interval tick overlapping a refocus tick) and
  // overwrite fresh data with stale — the screen would flicker back in time.
  let latestSeq = 0;
  const apply = (seq: number, value: T) => {
    if (stopped || seq < latestSeq) return;
    onSuccess(value);
  };

  // Initial load with full retry/backoff so a cold start never blanks. It
  // claims seq 1; a poll that starts and resolves before the initial finishes
  // will correctly supersede it.
  const initialSeq = ++latestSeq;
  const stopInitial = loadWithRetry(fetcher, v => apply(initialSeq, v));

  // Background refresh: single attempt per tick (no backoff loop — the next
  // tick is the retry), and only when the tab is visible.
  const tick = () => {
    if (stopped || document.visibilityState !== 'visible') return;
    const seq = ++latestSeq;
    fetcher().then(v => apply(seq, v)).catch(() => { /* next tick retries */ });
  };
  const timer = setInterval(tick, intervalMs);

  // Refresh immediately when the user returns to a previously-hidden tab.
  const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    stopInitial();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

const KEY = {
  tournaments: 'tournaments',
  news: 'news',
  topPlayers: 'topPlayers',
  standings: 'standings',
  config: (k: string) => `config:${k}`,
} as const;

// ─── Tournaments ──────────────────────────────────────────────────────────────

export async function getTournaments(): Promise<Tournament[]> {
  return cached(KEY.tournaments, async () => {
    const { data, error } = await dbClient
      .from('tournaments_blob')
      .select('data')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any) => row.data as Tournament);
  });
}

export async function upsertTournament(tournament: Tournament): Promise<void> {
  const { error } = await supabase
    .from('tournaments_blob')
    .upsert({ id: tournament.id, data: tournament, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
  invalidate(KEY.tournaments);
}

export async function deleteTournament(id: string): Promise<void> {
  const { error } = await supabase.from('tournaments_blob').delete().eq('id', id);
  if (error) throw error;
  invalidate(KEY.tournaments);
}

// ─── Tournament Registration Requests ──────────────────────────────────────────
// Submitted from the public contact form; reviewed by superadmins in the admin
// panel. Approval is handled by the `approve-organizer` Edge Function (which needs
// the service_role key to create the auth user), so the client only reads/denies here.

export interface TournamentRequest {
  id: string;
  organizerName: string;
  email: string;
  phone: string;
  tournamentName: string;
  tournamentDetails: string;
  status: 'pending' | 'approved' | 'denied';
  createdTournamentId?: string;
  createdAt: string;
}

function mapRequestRow(row: any): TournamentRequest {
  return {
    id: row.id,
    organizerName: row.organizer_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    tournamentName: row.tournament_name ?? '',
    tournamentDetails: row.tournament_details ?? '',
    status: row.status ?? 'pending',
    createdTournamentId: row.created_tournament_id ?? undefined,
    createdAt: row.created_at ?? '',
  };
}

// Public contact form submission. Uses the anon key — allowed by the
// "Anyone can submit a tournament request" RLS policy.
export async function createTournamentRequest(input: {
  organizerName: string;
  email: string;
  phone?: string;
  tournamentName: string;
  tournamentDetails?: string;
}): Promise<void> {
  // Public, unauthenticated submission — use the anonymous client. Allowed by
  // the "Anyone can submit a tournament request" RLS INSERT policy.
  const { error } = await dbClient.from('tournament_requests').insert({
    organizer_name: input.organizerName,
    email: input.email,
    phone: input.phone ?? null,
    tournament_name: input.tournamentName,
    tournament_details: input.tournamentDetails ?? null,
  });
  if (error) throw error;
}

// Superadmin: list all requests (newest first).
export async function getTournamentRequests(): Promise<TournamentRequest[]> {
  const { data, error } = await supabase
    .from('tournament_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRequestRow);
}

// Superadmin: resend the invite (or a recovery link if they already confirmed)
// to an organizer who never finished setting their password. Returns the mode
// used so the UI can phrase the confirmation correctly.
export async function resendInvite(email: string): Promise<{ mode: 'invite' | 'recovery' }> {
  const { data, error } = await supabase.functions.invoke('resend-invite', {
    body: { email },
  });
  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error || 'Resend failed');
  return data;
}

// Superadmin: mark a request denied (no account/tournament created).
export async function denyTournamentRequest(id: string): Promise<void> {
  const { error } = await supabase
    .from('tournament_requests')
    .update({ status: 'denied', reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// Superadmin: approve a request. Delegates to the `approve-organizer` Edge
// Function which (server-side, with the service_role key) invites the organizer,
// creates the empty tournament, and assigns role + scope. Returns the new
// tournament id. The caller (admin UI) is responsible for sending the EmailJS
// "your tournament is ready" email after this resolves.
export async function approveTournamentRequest(requestId: string): Promise<{
  tournamentId: string;
  email: string;
  organizerName: string;
  tournamentName: string;
}> {
  const { data, error } = await supabase.functions.invoke('approve-organizer', {
    body: { requestId },
  });
  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error || 'Approval failed');
  invalidate(KEY.tournaments);
  return data;
}

// ─── News ─────────────────────────────────────────────────────────────────────

function mapNewsRow(row: any): NewsItem {
  return {
    id: row.id,
    title: row.title,
    category: row.category ?? '',
    timeAgo: row.published_at ? formatTimeAgo(new Date(row.published_at)) : '',
    imageUrl: row.image_url ?? '',
    link: row.link ?? '',
    visible: row.visible,
    author: row.author ?? undefined,
    body: Array.isArray(row.body) ? row.body : [],
    tournamentId: row.tournament_id ?? undefined,
  };
}

// Public read (anon client, cached). The anon RLS policy on news_items filters
// to visible = true, so hidden/draft articles are never exposed to the site.
export async function getNews(): Promise<NewsItem[]> {
  return cached(KEY.news, async () => {
    const { data, error } = await dbClient
      .from('news_items')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapNewsRow);
  });
}

// Admin read (auth client, uncached). Uses the signed-in JWT so the
// is_staff()/organizer RLS policies apply and HIDDEN articles are included —
// the admin News editor must see drafts to re-edit or publish them. The anon
// getNews() would silently drop them (visible = true filter).
export async function getNewsAuthed(): Promise<NewsItem[]> {
  const { data, error } = await supabase
    .from('news_items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapNewsRow);
}

export async function upsertNews(item: NewsItem): Promise<NewsItem> {
  const payload = {
    id: item.id,
    title: item.title,
    category: item.category,
    image_url: item.imageUrl,
    link: item.link,
    visible: item.visible,
    author: item.author ?? null,
    body: item.body ?? [],
    tournament_id: item.tournamentId ?? null,
    published_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('news_items')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  invalidate(KEY.news);
  return {
    id: data.id,
    title: data.title,
    category: data.category ?? '',
    timeAgo: formatTimeAgo(new Date(data.published_at)),
    imageUrl: data.image_url ?? '',
    link: data.link ?? '',
    visible: data.visible,
    author: data.author ?? undefined,
    body: Array.isArray(data.body) ? data.body : [],
    tournamentId: data.tournament_id ?? undefined,
  };
}

export async function deleteNews(id: string): Promise<void> {
  const { error } = await supabase.from('news_items').delete().eq('id', id);
  if (error) throw error;
  invalidate(KEY.news);
}

// ─── Top Players ──────────────────────────────────────────────────────────────

export async function getTopPlayers(): Promise<TopPlayer[]> {
  return cached(KEY.topPlayers, async () => {
    const { data, error } = await dbClient
      .from('top_players')
      .select('*')
      .order('rank', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any): TopPlayer => ({
      id: row.id,
      rank: row.rank,
      name: row.name,
      team: row.team ?? '',
      rating: Number(row.rating ?? 0),
      kills: row.kills ?? 0,
      deaths: row.deaths ?? 0,
    }));
  });
}

export async function upsertTopPlayer(player: TopPlayer): Promise<void> {
  const { error } = await supabase
    .from('top_players')
    .upsert({
      id: player.id,
      rank: player.rank,
      name: player.name,
      team: player.team,
      rating: player.rating,
      kills: player.kills,
      deaths: player.deaths,
    }, { onConflict: 'id' });
  if (error) throw error;
  invalidate(KEY.topPlayers);
}

export async function deleteTopPlayer(id: string): Promise<void> {
  const { error } = await supabase.from('top_players').delete().eq('id', id);
  if (error) throw error;
  invalidate(KEY.topPlayers);
}

export async function replaceTopPlayers(players: TopPlayer[]): Promise<void> {
  invalidate(KEY.topPlayers);
  await supabase.from('top_players').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (players.length === 0) return;
  const { error } = await supabase.from('top_players').insert(
    players.map(p => ({
      id: p.id,
      rank: p.rank,
      name: p.name,
      team: p.team,
      rating: p.rating,
      kills: p.kills,
      deaths: p.deaths,
    }))
  );
  if (error) throw error;
}

// ─── Standings ────────────────────────────────────────────────────────────────

export async function getStandings(): Promise<StandingTeam[]> {
  return cached(KEY.standings, async () => {
    const { data, error } = await dbClient
      .from('standings')
      .select('*')
      .order('rank', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any): StandingTeam => ({
      id: row.id,
      rank: row.rank,
      name: row.name,
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
    }));
  });
}

export async function replaceStandings(teams: StandingTeam[]): Promise<void> {
  invalidate(KEY.standings);
  await supabase.from('standings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (teams.length === 0) return;
  const { error } = await supabase.from('standings').insert(
    teams.map(t => ({ id: t.id, rank: t.rank, name: t.name, wins: t.wins, losses: t.losses }))
  );
  if (error) throw error;
}

// ─── Site Config ──────────────────────────────────────────────────────────────

export async function getSiteConfig(key: string): Promise<string> {
  return cached(KEY.config(key), async () => {
    const { data } = await dbClient.from('site_config').select('value').eq('key', key).single();
    return data?.value ?? '';
  });
}

// Fetch multiple config keys in a single round-trip and populate each key's
// cache entry individually. This means loadAdminData only makes one network
// request for all config values instead of three, reducing the number of
// concurrent fetches that can each independently stall for 9s.
async function getSiteConfigs(keys: string[]): Promise<Record<string, string>> {
  const cacheKey = `configs:${keys.slice().sort().join(',')}`;
  return cached(cacheKey, async () => {
    const { data } = await dbClient.from('site_config').select('key,value').in('key', keys);
    const result: Record<string, string> = {};
    for (const k of keys) result[k] = '';
    for (const row of data ?? []) result[row.key] = row.value ?? '';
    return result;
  });
}

export async function setSiteConfig(key: string, value: string): Promise<void> {
  const { error } = await supabase
    .from('site_config')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
  // Collect batched config cache keys before invalidating to avoid mutating
  // the Map while iterating it.
  const batchedKeys = [...cacheStore.keys()].filter(k => k.startsWith('configs:'));
  invalidate(KEY.config(key), ...batchedKeys);
}

// ─── Hero video upload (Supabase Storage) ──────────────────────────────────────

const HERO_VIDEO_BUCKET = 'hero-videos';

// Upload a video file to the hero-videos bucket and return its public URL.
// Overwrites any file with the same name (upsert) so re-uploads are clean.
export async function uploadHeroVideo(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
  const path = `hero-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(HERO_VIDEO_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
  if (error) throw error;
  const { data } = supabase.storage.from(HERO_VIDEO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ─── Image upload (Supabase Storage) ────────────────────────────────────────────
// Tournament covers, team logos and player photos are stored as files in their
// public buckets (NOT as base64 inside the tournament JSON, which bloated the
// blob to ~1.8 MB and made every page fetch megabytes). We persist only the
// returned public URL in the data model — display code already accepts a URL.
export type ImageBucket = 'team-logos' | 'player-photos' | 'news-images' | 'tournament-covers';

export async function uploadImage(file: File, bucket: ImageBucket): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${Date.now()}-${rand}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '31536000' });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// ─── Load all admin data ──────────────────────────────────────────────────────

// Public load (home, matches, …). News comes from the anon getNews(), which only
// returns visible articles — correct for the public site.
export async function loadAdminData(): Promise<AdminData> {
  const [tournaments, news, players, standings, configs] = await Promise.all([
    getTournaments(),
    getNews(),
    getTopPlayers().catch(() => [] as TopPlayer[]),
    getStandings().catch(() => [] as StandingTeam[]),
    getSiteConfigs(['hero_link', 'spotlight_tournament_id', 'hero_video']).catch(() => ({} as Record<string, string>)),
  ]);
  return {
    matches: [],
    standings,
    news,
    players,
    tournaments,
    heroLink: configs['hero_link'] ?? '',
    spotlightTournamentId: configs['spotlight_tournament_id'] ?? '',
    heroVideo: configs['hero_video'] ?? '',
  };
}

// Admin-panel load. Identical to loadAdminData EXCEPT news is read with the auth
// client so HIDDEN articles are included (the editor must see drafts to manage
// them). Tournaments/players/standings/config have anon-readable RLS (qual=true)
// so they're the same either way and reuse the cached public readers.
export async function loadAdminDataAuthed(): Promise<AdminData> {
  const [tournaments, news, players, standings, configs] = await Promise.all([
    getTournaments(),
    getNewsAuthed(),
    getTopPlayers().catch(() => [] as TopPlayer[]),
    getStandings().catch(() => [] as StandingTeam[]),
    getSiteConfigs(['hero_link', 'spotlight_tournament_id', 'hero_video']).catch(() => ({} as Record<string, string>)),
  ]);
  return {
    matches: [],
    standings,
    news,
    players,
    tournaments,
    heroLink: configs['hero_link'] ?? '',
    spotlightTournamentId: configs['spotlight_tournament_id'] ?? '',
    heroVideo: configs['hero_video'] ?? '',
  };
}

// ─── Migrate from localStorage ────────────────────────────────────────────────
// Call once from the admin panel to push existing localStorage data to Supabase.

export async function migrateFromLocalStorage(data: AdminData): Promise<void> {
  await Promise.all([
    ...data.tournaments.map(upsertTournament),
    ...data.news.map(upsertNews),
    setSiteConfig('hero_link', data.heroLink ?? ''),
  ]);
  if (data.players.length > 0) await replaceTopPlayers(data.players);
  if (data.standings.length > 0) await replaceStandings(data.standings);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}
