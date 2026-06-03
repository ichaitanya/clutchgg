import { supabase } from './supabase';
import type { Tournament } from '../components/TournamentCreation';
import type { AdminData, NewsItem, TopPlayer, StandingTeam } from '../components/AdminPanel';

// ─── Read cache ─────────────────────────────────────────────────────────────────
// Every public page (home, matches, teams, stats, tournament, player, …) fetches
// the same data on mount. Without caching, each navigation re-downloads and
// re-parses it. This in-memory cache (per browser session) dedupes concurrent
// requests and serves repeat reads for a short TTL, so moving between pages is
// instant. Any write invalidates the affected key so the next read is fresh.

const CACHE_TTL_MS = 60_000; // serve cached reads for up to 1 minute

type CacheEntry<T> = { value: T; at: number };
const cacheStore = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

// Run `fetcher` through the cache under `key`. Concurrent callers share one
// in-flight promise; fresh values are reused until the TTL expires. A failed
// fetch is never cached.
function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cacheStore.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = fetcher()
    .then(value => {
      cacheStore.set(key, { value, at: Date.now() });
      return value;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

// Drop one or more cache keys so the next read re-fetches. Called after writes.
function invalidate(...keys: string[]) {
  for (const k of keys) { cacheStore.delete(k); inflight.delete(k); }
}

// Clear everything (used by the admin panel to force a full refresh).
export function clearDbCache() {
  cacheStore.clear();
  inflight.clear();
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
    const { data, error } = await supabase
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

// ─── News ─────────────────────────────────────────────────────────────────────

export async function getNews(): Promise<NewsItem[]> {
  return cached(KEY.news, async () => {
    const { data, error } = await supabase
      .from('news_items')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any): NewsItem => ({
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
    }));
  });
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
    const { data, error } = await supabase
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
    const { data, error } = await supabase
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
    const { data } = await supabase.from('site_config').select('value').eq('key', key).single();
    return data?.value ?? '';
  });
}

export async function setSiteConfig(key: string, value: string): Promise<void> {
  const { error } = await supabase
    .from('site_config')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
  invalidate(KEY.config(key));
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

export async function loadAdminData(): Promise<AdminData> {
  const [tournaments, news, players, standings, heroLink, spotlightTournamentId, heroVideo] = await Promise.all([
    getTournaments().catch(() => [] as Tournament[]),
    getNews().catch(() => [] as NewsItem[]),
    getTopPlayers().catch(() => [] as TopPlayer[]),
    getStandings().catch(() => [] as StandingTeam[]),
    getSiteConfig('hero_link').catch(() => ''),
    getSiteConfig('spotlight_tournament_id').catch(() => ''),
    getSiteConfig('hero_video').catch(() => ''),
  ]);
  return { matches: [], standings, news, players, tournaments, heroLink, spotlightTournamentId, heroVideo };
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
