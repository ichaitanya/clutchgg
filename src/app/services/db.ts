import { supabase } from './supabase';
import type { Tournament } from '../components/TournamentCreation';
import type { AdminData, NewsItem, TopPlayer, StandingTeam } from '../components/AdminPanel';

// ─── Tournaments ──────────────────────────────────────────────────────────────

export async function getTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase
    .from('tournaments_blob')
    .select('data')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => row.data as Tournament);
}

export async function upsertTournament(tournament: Tournament): Promise<void> {
  const { error } = await supabase
    .from('tournaments_blob')
    .upsert({ id: tournament.id, data: tournament, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteTournament(id: string): Promise<void> {
  const { error } = await supabase.from('tournaments_blob').delete().eq('id', id);
  if (error) throw error;
}

// ─── News ─────────────────────────────────────────────────────────────────────

export async function getNews(): Promise<NewsItem[]> {
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
}

// ─── Top Players ──────────────────────────────────────────────────────────────

export async function getTopPlayers(): Promise<TopPlayer[]> {
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
}

export async function deleteTopPlayer(id: string): Promise<void> {
  const { error } = await supabase.from('top_players').delete().eq('id', id);
  if (error) throw error;
}

export async function replaceTopPlayers(players: TopPlayer[]): Promise<void> {
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
}

export async function replaceStandings(teams: StandingTeam[]): Promise<void> {
  await supabase.from('standings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (teams.length === 0) return;
  const { error } = await supabase.from('standings').insert(
    teams.map(t => ({ id: t.id, rank: t.rank, name: t.name, wins: t.wins, losses: t.losses }))
  );
  if (error) throw error;
}

// ─── Site Config ──────────────────────────────────────────────────────────────

export async function getSiteConfig(key: string): Promise<string> {
  const { data } = await supabase.from('site_config').select('value').eq('key', key).single();
  return data?.value ?? '';
}

export async function setSiteConfig(key: string, value: string): Promise<void> {
  const { error } = await supabase
    .from('site_config')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
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

// ─── Load all admin data ──────────────────────────────────────────────────────

export async function loadAdminData(): Promise<AdminData> {
  const [tournaments, news, players, standings, heroLink, standingsTournamentId, heroVideo] = await Promise.all([
    getTournaments().catch(() => [] as Tournament[]),
    getNews().catch(() => [] as NewsItem[]),
    getTopPlayers().catch(() => [] as TopPlayer[]),
    getStandings().catch(() => [] as StandingTeam[]),
    getSiteConfig('hero_link').catch(() => ''),
    getSiteConfig('standings_tournament_id').catch(() => ''),
    getSiteConfig('hero_video').catch(() => ''),
  ]);
  return { matches: [], standings, news, players, tournaments, heroLink, standingsTournamentId, heroVideo };
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
