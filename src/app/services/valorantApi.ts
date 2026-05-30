// Valorant API Service using Henrikdev API
// API Key: HDEV-97d92e1f-2fc9-49c5-9e49-bd959e394385

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
// Note: Henrikdev's `mode` query does not surface custom games, so when
// mode === 'custom' we omit the filter and post-filter to custom games below.
export async function getPlayerMatchHistory(
  playerName: string,
  playerTag: string,
  region: string = 'na',
  mode: string = 'competitive'
): Promise<MatchHistory[]> {
  try {
    const isCustom = mode === 'custom';
    const query = isCustom ? '' : `?mode=${encodeURIComponent(mode)}`;
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
    return isCustom ? mapped.filter(m => m.metadata.mode_id === 'custom') : mapped;
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

// Does an API player match any roster entry? Roster entries may be "name#tag"
// (Riot ID) or a bare display name.
function apiPlayerMatchesRoster(player: PlayerMatchStats, roster: string[]): boolean {
  const riotId = `${player.name}#${player.tag}`.toLowerCase();
  const name = player.name.toLowerCase();
  return roster.some(r => {
    const v = r.toLowerCase();
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

  const blueMatches = blueTeam.filter(p =>
    tournamentTeam1Players.some(
      tp => tp.toLowerCase() === `${p.name.toLowerCase()}#${p.tag.toLowerCase()}`
        || tp.toLowerCase() === p.name.toLowerCase()
    )
  ).length;

  const redMatches = redTeam.filter(p =>
    tournamentTeam1Players.some(
      tp => tp.toLowerCase() === `${p.name.toLowerCase()}#${p.tag.toLowerCase()}`
        || tp.toLowerCase() === p.name.toLowerCase()
    )
  ).length;

  // Determine which API team maps to tournament team 1
  if (blueMatches >= redMatches) {
    return {
      team1Matches: blueMatches,
      team2Matches: redTeam.filter(p =>
        tournamentTeam2Players.some(
          tp => tp.toLowerCase() === `${p.name.toLowerCase()}#${p.tag.toLowerCase()}`
            || tp.toLowerCase() === p.name.toLowerCase()
        )
      ).length,
      team1Name: 'Blue',
      team2Name: 'Red',
    };
  } else {
    return {
      team1Matches: redMatches,
      team2Matches: blueTeam.filter(p =>
        tournamentTeam2Players.some(
          tp => tp.toLowerCase() === `${p.name.toLowerCase()}#${p.tag.toLowerCase()}`
            || tp.toLowerCase() === p.name.toLowerCase()
        )
      ).length,
      team1Name: 'Red',
      team2Name: 'Blue',
    };
  }
}

// Build player stats from API response.
// `displayNameByRiotId` maps a lowercased Riot ID (name#tag) to the tournament
// display name, so the scoreboard shows the player's name (no tag).
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
    const displayName = displayNameByRiotId[riotId.toLowerCase()] ?? player.name;

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
