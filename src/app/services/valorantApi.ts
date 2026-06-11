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
  rounds: RoundResult[];
}

// One round's outcome, oriented from the API's Blue/Red sides. `endType` is the
// raw HenrikDev end_type string (e.g. "Elimination", "Bomb detonated",
// "Bomb defused", "Round timer expired"); we normalize it for icon selection.
export interface RoundResult {
  winningTeam: 'Blue' | 'Red';
  endType: string;
  bombPlanted: boolean;
  bombDefused: boolean;
}

// Raw per-side accumulation (attack rounds or defense rounds) used while
// folding the rounds array. Carries enough to derive split ACS/ADR/KAST later.
export interface SideSplitRaw {
  rounds: number;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  kast: number;
  fk: number;
  fd: number;
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
  // Advanced, derived from per-round data when available (else 0).
  damageMade: number;       // total damage dealt across the match → ADR base
  kastRounds: number;       // rounds with a kill, assist, survival, or trade
  firstKills: number;       // rounds where this player got the first kill
  firstDeaths: number;      // rounds where this player was the first to die
  atk: SideSplitRaw;        // accumulation over rounds played on attack
  def: SideSplitRaw;        // accumulation over rounds played on defense
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

    // ── Advanced per-player aggregates derived from the rounds array ──────────
    // The v2 endpoint carries a `rounds[]` array; each round has a
    // `player_stats[]` list (damage, kills, kill events with timestamps). We fold
    // these into per-player totals keyed by Riot ID so the scoreboard can show
    // ADR / KAST / FK / FD without a second request. When `rounds` is absent
    // (older/limited responses) every aggregate stays 0 and the UI hides them.
    type RoundPlayer = {
      player_puuid?: string; player_display_name?: string;
      player_team?: string;
      damage?: number; damage_events?: { damage?: number }[];
      kills?: number; score?: number;
      assists?: number;
      kill_events?: {
        kill_time_in_round?: number; killer_puuid?: string; victim_puuid?: string;
        // HenrikDev returns assistants as objects ({ assistant_puuid }); some
        // payloads use bare puuid strings. Handle both below.
        assistants?: ({ assistant_puuid?: string } | string)[];
      }[];
      stayed?: boolean; was_afk?: boolean;
    };
    type RawRound = {
      winning_team?: string; end_type?: string;
      bomb_planted?: boolean; bomb_defused?: boolean;
      player_stats?: RoundPlayer[];
    };
    const rawRounds: RawRound[] = Array.isArray(d.rounds) ? d.rounds : [];

    // A per-side accumulator (attack rounds vs defense rounds).
    const emptySide = (): SideSplitRaw => ({
      rounds: 0, score: 0, kills: 0, deaths: 0, assists: 0, damage: 0, kast: 0, fk: 0, fd: 0,
    });
    // puuid → running aggregate, with attack/defense breakdowns.
    type Agg = { damage: number; kast: number; fk: number; fd: number; atk: SideSplitRaw; def: SideSplitRaw };
    const agg: Record<string, Agg> = {};
    const bump = (puuid?: string) => {
      if (!puuid) return null;
      return (agg[puuid] ??= { damage: 0, kast: 0, fk: 0, fd: 0, atk: emptySide(), def: emptySide() });
    };

    // Side rule (per the Valorant match architecture): Red attacks the first half
    // (rounds 1–12) while Blue defends; sides swap each half. So in half-block H
    // (0-based, 12 rounds each), Red attacks when H is even. Overtime continues
    // the alternation. Returns the attacking side for a 0-based round index.
    const attackingSide = (roundIndex: number): 'Red' | 'Blue' => {
      const halfBlock = Math.floor(roundIndex / 12);
      return halfBlock % 2 === 0 ? 'Red' : 'Blue';
    };

    rawRounds.forEach((r, roundIdx) => {
      const atkSide = attackingSide(roundIdx);
      const ps = r.player_stats ?? [];

      // Per-round side lookup for every player present. The per-round `stayed`
      // and `assists` fields are unreliable in this payload, so deaths and KAST
      // are derived from kill_events instead (every kill names killer + victim).
      const sideOf = (puuid?: string): 'atk' | 'def' => {
        const e = ps.find(x => x.player_puuid === puuid);
        const onAttack = (e?.player_team === 'Red' ? 'Red' : e?.player_team === 'Blue' ? 'Blue' : undefined) === atkSide;
        return onAttack ? 'atk' : 'def';
      };

      // Collect this round's kill events to derive first-kill/first-death,
      // per-player kills, deaths (victims), and assists.
      let earliest = Number.POSITIVE_INFINITY;
      let fkKiller: string | undefined;
      let fkVictim: string | undefined;
      const killsThisRound: Record<string, number> = {};
      const diedThisRound = new Set<string>();   // victims → a death
      const assistedThisRound = new Set<string>();

      for (const p of ps) {
        for (const ke of (p.kill_events ?? [])) {
          const killer = ke.killer_puuid ?? p.player_puuid;
          if (killer) killsThisRound[killer] = (killsThisRound[killer] ?? 0) + 1;
          if (ke.victim_puuid) diedThisRound.add(ke.victim_puuid);
          for (const as of (ke.assistants ?? [])) {
            const aPuuid = typeof as === 'string' ? as : as?.assistant_puuid;
            if (aPuuid) assistedThisRound.add(aPuuid);
          }
          const t = ke.kill_time_in_round ?? Number.POSITIVE_INFINITY;
          if (t < earliest) {
            earliest = t;
            fkKiller = killer;
            fkVictim = ke.victim_puuid;
          }
        }
      }

      // Per-player round accumulation: rounds-played, kills, deaths, assists,
      // score, damage — each attributed to the player's side this round.
      for (const p of ps) {
        const puuid = p.player_puuid;
        const a = bump(puuid);
        if (!a || !puuid) continue;

        const dmg = typeof p.damage === 'number'
          ? p.damage
          : (p.damage_events ?? []).reduce((s, e) => s + (e.damage ?? 0), 0);
        a.damage += dmg;

        const bucket = sideOf(puuid) === 'atk' ? a.atk : a.def;
        bucket.rounds += 1;
        // Prefer the kill_events count; fall back to the round `kills` field.
        bucket.kills += killsThisRound[puuid] ?? p.kills ?? 0;
        bucket.deaths += diedThisRound.has(puuid) ? 1 : 0;
        bucket.assists += assistedThisRound.has(puuid) ? 1 : 0;
        bucket.score += p.score ?? 0;
        bucket.damage += dmg;
      }

      // KAST credit: kill, assist, or survived (didn't die) this round.
      for (const p of ps) {
        const puuid = p.player_puuid;
        if (!puuid) continue;
        const credited = (killsThisRound[puuid] ?? 0) > 0 || assistedThisRound.has(puuid) || !diedThisRound.has(puuid);
        if (!credited) continue;
        const a = bump(puuid);
        if (!a) continue;
        a.kast += 1;
        (sideOf(puuid) === 'atk' ? a.atk : a.def).kast += 1;
      }

      const fkA = bump(fkKiller);
      if (fkA) {
        fkA.fk += 1;
        (sideOf(fkKiller) === 'atk' ? fkA.atk : fkA.def).fk += 1;
      }
      const fdA = bump(fkVictim);
      if (fdA) {
        fdA.fd += 1;
        (sideOf(fkVictim) === 'atk' ? fdA.atk : fdA.def).fd += 1;
      }
    });

    const players: PlayerMatchStats[] = (d.players?.all_players ?? []).map((p: {
      puuid?: string; name?: string; tag?: string; team?: string; character?: string;
      damage_made?: number;
      stats?: { score?: number; kills?: number; deaths?: number; assists?: number; headshots?: number; bodyshots?: number; legshots?: number };
    }) => {
      const a = p.puuid ? agg[p.puuid] : undefined;
      return {
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
        // Prefer round-summed damage; fall back to the player-level damage_made.
        damageMade: a?.damage ?? p.damage_made ?? 0,
        kastRounds: a?.kast ?? 0,
        firstKills: a?.fk ?? 0,
        firstDeaths: a?.fd ?? 0,
        atk: a?.atk ?? emptySide(),
        def: a?.def ?? emptySide(),
      };
    });

    const rounds: RoundResult[] = rawRounds.map(r => ({
      winningTeam: (r.winning_team === 'Red' ? 'Red' : 'Blue') as 'Blue' | 'Red',
      endType: r.end_type ?? '',
      bombPlanted: !!r.bomb_planted,
      bombDefused: !!r.bomb_defused,
    }));

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
      players,
      rounds,
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
      // Advanced stats (0 when the API didn't carry round data).
      adr: roundsPlayed > 0 ? Math.round(player.damageMade / roundsPlayed) : 0,
      kast: roundsPlayed > 0 ? Math.round((player.kastRounds / roundsPlayed) * 100) : 0,
      fk: player.firstKills,
      fd: player.firstDeaths,
      // Per-side splits (omitted when no round data was captured).
      atk: sideSplitToStat(player.atk),
      def: sideSplitToStat(player.def),
    };
  });
}

// Compute a side's display stats from its raw accumulation. Returns undefined
// when the side has no rounds (so the UI can fall back / hide the toggle).
function sideSplitToStat(raw: SideSplitRaw): SideStat | undefined {
  if (!raw || raw.rounds === 0) return undefined;
  return {
    rounds: raw.rounds,
    kills: raw.kills,
    deaths: raw.deaths,
    assists: raw.assists,
    kd: raw.deaths > 0 ? parseFloat((raw.kills / raw.deaths).toFixed(2)) : raw.kills,
    acs: Math.floor(raw.score / raw.rounds),
    adr: Math.round(raw.damage / raw.rounds),
    kast: Math.round((raw.kast / raw.rounds) * 100),
    fk: raw.fk,
    fd: raw.fd,
  };
}

// One side's display-ready split (attack or defense) stored on a MatchPlayerStat.
export interface SideStat {
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  acs: number;
  adr: number;
  kast: number;
  fk: number;
  fd: number;
}

// Orient the API's Blue/Red round list to team1/team2 perspective, so the
// scoreboard can render a round-flow strip with each team's win/loss per round.
export function buildRoundFlow(
  rounds: RoundResult[],
  team1Name: string, // 'Blue' or 'Red'
): MapRoundFlow[] {
  return rounds.map(r => ({
    winner: r.winningTeam === team1Name ? 1 : 2,
    endType: normalizeEndType(r.endType, r.bombDefused),
  }));
}

// Compact, UI-facing record of one round on a stored map result.
export interface MapRoundFlow {
  winner: 1 | 2;             // which tournament team won the round
  endType: RoundEndType;     // how it ended, for icon selection
}
export type RoundEndType = 'elim' | 'detonate' | 'defuse' | 'time';

// Collapse HenrikDev's verbose end_type strings into our four icon buckets.
function normalizeEndType(raw: string, bombDefused: boolean): RoundEndType {
  const s = raw.toLowerCase();
  if (s.includes('defus') || bombDefused) return 'defuse';
  if (s.includes('detonat') || s.includes('bomb')) return 'detonate';
  if (s.includes('time') || s.includes('expir')) return 'time';
  return 'elim';
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
  roundFlow: MapRoundFlow[];
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
    roundFlow: buildRoundFlow(details.rounds, mapping.team1Name),
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
