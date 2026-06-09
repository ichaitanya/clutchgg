// Valorant API Service using Henrikdev API
// API Key: HDEV-97d92e1f-2fc9-49c5-9e49-bd959e394385

import { normalizeRiotId } from '../utils/riotId';

const API_KEY = 'HDEV-97d92e1f-2fc9-49c5-9e49-bd959e394385';
const BASE_URL = 'https://api.henrikdev.xyz/valorant';

// Valorant competitive map pool
export const VALORANT_MAPS = [
  'Ascent', 'Bind', 'Breeze', 'Fracture', 'Haven',
  'Icebox', 'Lotus', 'Pearl', 'Split', 'Sunset', 'Abyss',
];

export interface ValorantPlayer {
  name: string;
  tag: string;
  team?: string;
}

export interface MatchHistory {
  uuid: string;
  metadata: {
    map: string;
    game_start_patched: string;
    rounds_played: number;
    mode_id: string;
  };
  teams: {
    blue: {
      has_won: boolean;
      rounds_won: number;
    };
    red: {
      has_won: boolean;
      rounds_won: number;
    };
  };
}

export interface MatchDetails {
  metadata: {
    map: string;
    game_start_patched: string;
    rounds_played: number;
  };
  teams: {
    blue: { has_won: boolean; rounds_won: number };
    red: { has_won: boolean; rounds_won: number };
  };
  players: PlayerMatchStats[];
}

export interface PlayerMatchStats {
  name: string;
  tag: string;
  team: 'Blue' | 'Red';
  character: string;
  stats: {
    score: number;
    kills: number;
    deaths: number;
    assists: number;
    headshots: number;
    bodyshots: number;
    legshots: number;
  };
}

// Get player's match history (most recent first), filtered by game mode.
// Henrikdev's v3 `mode=custom` query does surface custom games, so we pass it
// through directly. `size` caps how many matches the API returns.
export async function getPlayerMatchHistory(
  playerName: string,
  playerTag: string,
  region: string = 'na',
  mode: string = 'competitive',
  size: number = 15
): Promise<MatchHistory[]> {
  try {
    const params = new URLSearchParams();
    if (mode) params.set('mode', mode);
    if (size) params.set('size', String(size));
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(
      `${BASE_URL}/v3/matches/${region}/${encodeURIComponent(playerName)}/${encodeURIComponent(playerTag)}${query}`,
      {
        headers: {
          'Authorization': API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const mapped: MatchHistory[] = (data.data || []).map((m: { metadata?: { matchid?: string; map?: string; game_start_patched?: string; rounds_played?: number; mode_id?: string } }) => ({
      uuid: m.metadata?.matchid ?? '',
      metadata: {
        map: m.metadata?.map ?? '',
        game_start_patched: m.metadata?.game_start_patched ?? '',
        rounds_played: m.metadata?.rounds_played ?? 0,
        mode_id: m.metadata?.mode_id ?? '',
      },
    }));
    // Safety net: if mode=custom, keep only custom games (the API already filters,
    // but this guards against any non-custom leaking through).
    return mode === 'custom' ? mapped.filter(m => m.metadata.mode_id === 'custom') : mapped;
  } catch (error) {
    console.error('Failed to fetch player match history:', error);
    throw error;
  }
}

// Get detailed match stats
export async function getMatchDetails(matchId: string): Promise<MatchDetails> {
  try {
    const response = await fetch(`${BASE_URL}/v2/match/${matchId}`, {
      headers: {
        'Authorization': API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const d = data.data;
    return {
      metadata: {
        map: d.metadata?.map ?? '',
        game_start_patched: d.metadata?.game_start_patched ?? '',
        rounds_played: d.metadata?.rounds_played ?? 0,
      },
      teams: {
        blue: { has_won: !!d.teams?.blue?.has_won, rounds_won: d.teams?.blue?.rounds_won ?? 0 },
        red: { has_won: !!d.teams?.red?.has_won, rounds_won: d.teams?.red?.rounds_won ?? 0 },
      },
      players: (d.players?.all_players ?? []).map((p: {
        name?: string; tag?: string; team?: string; character?: string;
        stats?: { score?: number; kills?: number; deaths?: number; assists?: number; headshots?: number; bodyshots?: number; legshots?: number };
      }) => ({
        name: p.name ?? '',
        tag: p.tag ?? '',
        team: (p.team === 'Red' ? 'Red' : 'Blue') as 'Blue' | 'Red',
        character: p.character ?? '',
        stats: {
          score: p.stats?.score ?? 0,
          kills: p.stats?.kills ?? 0,
          deaths: p.stats?.deaths ?? 0,
          assists: p.stats?.assists ?? 0,
          headshots: p.stats?.headshots ?? 0,
          bodyshots: p.stats?.bodyshots ?? 0,
          legshots: p.stats?.legshots ?? 0,
        },
      })),
    };
  } catch (error) {
    console.error('Failed to fetch match details:', error);
    throw error;
  }
}

// Find the most recent match played on a given map name.
// History is newest-first, so the first match is the latest played.
export function findLatestMatchOnMap(
  history: MatchHistory[],
  mapName: string
): MatchHistory | null {
  return history.find(m => m.metadata.map.toLowerCase() === mapName.toLowerCase()) ?? null;
}

// Count how many of `playerRiotIds` (each "name#tag") match a roster entry.
// Canonical Riot ID / name normalization, shared with the matching layer so both
// sides collapse identically (NFKC, spaces around "#" removed, whitespace
// collapsed, trimmed, lowercased). See utils/riotId.ts for the rationale.
const normalizeId = normalizeRiotId;

// Roster entries may be "name#tag" or a bare display name (matched on name).
export function countRiotIdOverlap(playerRiotIds: string[], roster: string[]): number {
  const rosterN = roster.map(normalizeId);
  return playerRiotIds.filter(rid => {
    const n = normalizeId(rid);
    const name = n.split('#')[0];
    return rosterN.some(r => r === n || r === name);
  }).length;
}

// Does an API player match any roster entry? Roster entries may be "name#tag"
// (Riot ID) or a bare display name.
function apiPlayerMatchesRoster(player: PlayerMatchStats, roster: string[]): boolean {
  const riotId = normalizeId(`${player.name}#${player.tag}`);
  const name = normalizeId(player.name);
  return roster.some(r => {
    const v = normalizeId(r);
    return v === riotId || v === name;
  });
}

// Count how many of an API match's players belong to a given roster.
export function countRosterMatches(apiPlayers: PlayerMatchStats[], roster: string[]): number {
  return apiPlayers.filter(p => apiPlayerMatchesRoster(p, roster)).length;
}

// Walk a player's history (newest-first), fetching each match's details, and
// return the first match whose player list contains players from BOTH rosters.
// `minPerTeam` is how many roster players must appear on each side to count.
export async function findMatchWithBothRosters(
  history: MatchHistory[],
  team1Roster: string[],
  team2Roster: string[],
  fetchDetails: (matchId: string) => Promise<MatchDetails>,
  minPerTeam: number = 2,
  maxToScan: number = 10
): Promise<MatchDetails | null> {
  const scan = history.slice(0, maxToScan);
  for (const h of scan) {
    if (!h.uuid) continue;
    let details: MatchDetails;
    try {
      details = await fetchDetails(h.uuid);
    } catch {
      continue;
    }
    const t1 = countRosterMatches(details.players, team1Roster);
    const t2 = countRosterMatches(details.players, team2Roster);
    if (t1 >= minPerTeam && t2 >= minPerTeam) {
      return details;
    }
  }
  return null;
}

// Map API team players to tournament team rosters
export function mapPlayersToTeams(
  apiPlayers: PlayerMatchStats[],
  tournamentTeam1Players: string[],
  tournamentTeam2Players: string[]
): {
  team1Matches: number;
  team2Matches: number;
  team1Name: string; // 'Blue' or 'Red'
  team2Name: string;
} {
  const blueTeam = apiPlayers.filter(p => p.team === 'Blue');
  const redTeam = apiPlayers.filter(p => p.team === 'Red');

  const countIn = (players: PlayerMatchStats[], roster: string[]) =>
    players.filter(p => apiPlayerMatchesRoster(p, roster)).length;

  // Score BOTH possible orientations using BOTH rosters, then pick the better
  // global fit. Counting only team1's roster against each side (the old approach)
  // could mis-assign sides when team1's roster was sparse/dirty or tied — and
  // ignored team2's roster entirely. Cross-checking both sides is far more robust.
  //
  // Orientation A: Blue → team1, Red → team2
  // Orientation B: Red  → team1, Blue → team2
  const blueAsT1 = countIn(blueTeam, tournamentTeam1Players);
  const redAsT2  = countIn(redTeam, tournamentTeam2Players);
  const redAsT1  = countIn(redTeam, tournamentTeam1Players);
  const blueAsT2 = countIn(blueTeam, tournamentTeam2Players);

  const scoreA = blueAsT1 + redAsT2; // Blue=team1
  const scoreB = redAsT1 + blueAsT2; // Red=team1

  // Prefer the higher-scoring orientation. On a tie, keep the historical default
  // (Blue → team1), which preserves prior behaviour for unambiguous matches.
  if (scoreA >= scoreB) {
    return {
      team1Matches: blueAsT1,
      team2Matches: redAsT2,
      team1Name: 'Blue',
      team2Name: 'Red',
    };
  } else {
    return {
      team1Matches: redAsT1,
      team2Matches: blueAsT2,
      team1Name: 'Red',
      team2Name: 'Blue',
    };
  }
}

// Build player stats from API response.
// `displayNameByRiotId` maps a canonically-normalized Riot ID (name#tag, via
// normalizeId) to the tournament display name, so the scoreboard shows the
// player's name without the tag.
export function buildPlayerStatsFromAPI(
  apiPlayers: PlayerMatchStats[],
  team1Name: string, // 'Blue' or 'Red'
  _team2Name: string,
  team1Id: string,
  team2Id: string,
  roundsPlayed: number,
  displayNameByRiotId: Record<string, string> = {}
) {
  return apiPlayers.map(player => {
    const teamId = player.team === team1Name ? team1Id : team2Id;
    const totalShots = player.stats.headshots + player.stats.bodyshots + player.stats.legshots;
    const hsPercent = totalShots > 0 ? (player.stats.headshots / totalShots) * 100 : 0;
    const riotId = `${player.name}#${player.tag}`;
    // Keys are canonical (normalizeId), which already lowercases — one lookup.
    const displayName = displayNameByRiotId[normalizeId(riotId)] ?? player.name;

    return {
      playerId: riotId,
      playerName: displayName,
      teamId,
      agent: player.character,
      kills: player.stats.kills,
      deaths: player.stats.deaths,
      assists: player.stats.assists,
      kd: player.stats.deaths > 0 ? parseFloat((player.stats.kills / player.stats.deaths).toFixed(2)) : player.stats.kills,
      acs: roundsPlayed > 0 ? Math.floor(player.stats.score / roundsPlayed) : 0,
      hsPercent: Math.round(hsPercent),
    };
  });
}

// ── Manual match-finding flow ──────────────────────────────────────────────
// A candidate custom game shown to the admin so they can pick the right match
// ID. Carries the score and how many of the queried team's roster appeared, so
// the admin can spot the right match even if a few players differ between the
// website roster and the Valorant lobby.
export interface CustomGameCandidate {
  matchId: string;
  map: string;
  startedAt: string;      // game_start_patched
  blueScore: number;      // rounds won by Blue side
  redScore: number;       // rounds won by Red side
  rosterPlayersFound: number; // how many of the queried team's roster appeared
  rosterSize: number;
}

// Fetch a player's last N custom games and, for each, fetch full details so we
// can show the score and roster overlap against a single team's roster.
// `roster` is an array of "name#tag" Riot IDs and/or bare display names; it is
// only used for the informational overlap count — games are never filtered out.
export async function getCustomGameCandidates(
  playerName: string,
  playerTag: string,
  roster: string[],
  region: string = 'ap',
  count: number = 15
): Promise<CustomGameCandidate[]> {
  const history = await getPlayerMatchHistory(playerName, playerTag, region, 'custom', count);
  const scan = history.slice(0, count);
  const candidates: CustomGameCandidate[] = [];

  for (const h of scan) {
    if (!h.uuid) continue;
    let details: MatchDetails;
    try {
      details = await getMatchDetails(h.uuid);
    } catch {
      continue;
    }

    candidates.push({
      matchId: h.uuid,
      map: details.metadata.map || h.metadata.map,
      startedAt: details.metadata.game_start_patched || h.metadata.game_start_patched,
      blueScore: details.teams.blue.rounds_won,
      redScore: details.teams.red.rounds_won,
      rosterPlayersFound: countRosterMatches(details.players, roster),
      rosterSize: roster.length,
    });
  }

  return candidates;
}

// A custom game where BOTH of a match's teams appear (≥ minPerTeam each). Used
// by the per-match "Fetch Match Stats" flow so the admin only sees relevant
// games instead of the player's entire custom history.
export interface BothTeamsCandidate {
  matchId: string;
  map: string;
  startedAt: string;
  blueScore: number;
  redScore: number;
  team1PlayersFound: number;
  team2PlayersFound: number;
  team1RosterSize: number;
  team2RosterSize: number;
}

// Fetch a player's recent custom games and keep only those that look like the
// actual match between THESE two teams: a game qualifies when at least
// `minPerTeam` of each team's roster appears in it. This filters out unrelated
// scrims/customs the queried player happened to play. Rosters are "name#tag"
// Riot IDs and/or bare display names. `count` caps the scan to the last N games.
export async function getCustomGamesForBothTeams(
  playerName: string,
  playerTag: string,
  team1Roster: string[],
  team2Roster: string[],
  region: string = 'ap',
  count: number = 15,
  minPerTeam: number = 2,
): Promise<BothTeamsCandidate[]> {
  const history = await getPlayerMatchHistory(playerName, playerTag, region, 'custom', count);
  const scan = history.slice(0, count);
  const out: BothTeamsCandidate[] = [];

  for (const h of scan) {
    if (!h.uuid) continue;
    let details: MatchDetails;
    try {
      details = await getMatchDetails(h.uuid);
    } catch {
      continue;
    }

    const t1 = countRosterMatches(details.players, team1Roster);
    const t2 = countRosterMatches(details.players, team2Roster);

    // Only keep games where BOTH teams are present (≥ minPerTeam roster players
    // each), so the candidate list is the real head-to-head, not every custom
    // the queried player joined.
    if (t1 < minPerTeam || t2 < minPerTeam) continue;

    out.push({
      matchId: h.uuid,
      map: details.metadata.map || h.metadata.map,
      startedAt: details.metadata.game_start_patched || h.metadata.game_start_patched,
      blueScore: details.teams.blue.rounds_won,
      redScore: details.teams.red.rounds_won,
      team1PlayersFound: t1,
      team2PlayersFound: t2,
      team1RosterSize: team1Roster.length,
      team2RosterSize: team2Roster.length,
    });
  }

  return out;
}

// Given a specific match ID, fetch its details and build the map result + per
// player stats keyed to the tournament team IDs. Used by the Edit Match flow
// when an admin pastes a match ID retrieved from the candidate finder.
export async function buildMatchResultFromId(
  matchId: string,
  team1Roster: string[],
  team2Roster: string[],
  team1Id: string,
  team2Id: string,
  displayNameByRiotId: Record<string, string> = {}
): Promise<{
  mapName: string;
  team1Score: number;
  team2Score: number;
  playerStats: ReturnType<typeof buildPlayerStatsFromAPI>;
}> {
  const details = await getMatchDetails(matchId);
  const mapping = mapPlayersToTeams(details.players, team1Roster, team2Roster);
  const team1Rounds = mapping.team1Name === 'Blue' ? details.teams.blue.rounds_won : details.teams.red.rounds_won;
  const team2Rounds = mapping.team1Name === 'Blue' ? details.teams.red.rounds_won : details.teams.blue.rounds_won;
  const playerStats = buildPlayerStatsFromAPI(
    details.players,
    mapping.team1Name,
    mapping.team2Name,
    team1Id,
    team2Id,
    details.metadata.rounds_played,
    displayNameByRiotId
  );
  return {
    mapName: details.metadata.map,
    team1Score: team1Rounds,
    team2Score: team2Rounds,
    playerStats,
  };
}

// A raw per-side scoreboard for previewing a custom game (no tournament team
// mapping). Used by the Find Match ID "view scoreboard" UI.
export interface ScoreboardRow {
  riotId: string;       // name#tag
  name: string;
  agent: string;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  acs: number;
  hsPercent: number;
}

export interface MatchScoreboard {
  matchId: string;
  map: string;
  startedAt: string;
  blueScore: number;
  redScore: number;
  blue: ScoreboardRow[];
  red: ScoreboardRow[];
}

export async function getMatchScoreboard(matchId: string): Promise<MatchScoreboard> {
  const details = await getMatchDetails(matchId);
  const rounds = details.metadata.rounds_played;
  const toRow = (p: PlayerMatchStats): ScoreboardRow => {
    const totalShots = p.stats.headshots + p.stats.bodyshots + p.stats.legshots;
    const hsPercent = totalShots > 0 ? (p.stats.headshots / totalShots) * 100 : 0;
    return {
      riotId: `${p.name}#${p.tag}`,
      name: p.name,
      agent: p.character,
      kills: p.stats.kills,
      deaths: p.stats.deaths,
      assists: p.stats.assists,
      kd: p.stats.deaths > 0 ? parseFloat((p.stats.kills / p.stats.deaths).toFixed(2)) : p.stats.kills,
      acs: rounds > 0 ? Math.floor(p.stats.score / rounds) : 0,
      hsPercent: Math.round(hsPercent),
    };
  };
  return {
    matchId,
    map: details.metadata.map,
    startedAt: details.metadata.game_start_patched,
    blueScore: details.teams.blue.rounds_won,
    redScore: details.teams.red.rounds_won,
    blue: details.players.filter(p => p.team === 'Blue').map(toRow),
    red: details.players.filter(p => p.team === 'Red').map(toRow),
  };
}
