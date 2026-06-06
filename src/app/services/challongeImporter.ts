// Challonge Bracket Importer
// Maps Challonge v1 match structure into the native BracketGenerated shape
// (rounds: BracketMatch[][]), inverting prerequisite pointers to build the
// { matchId, slot } winnerGoesTo / loserGoesTo routing the renderer expects.

import type { BracketGenerated, BracketMatch, TeamInTournament } from '../components/TournamentCreation';
import * as ChallongeAPI from './challongeApiDirect';

// Raw v1 match fields we rely on
interface V1Match {
  id: number;
  round: number; // >0 winners, <0 losers, GF is highest positive
  identifier: string;
  player1_id: number | null;
  player2_id: number | null;
  player1_prereq_match_id: number | null;
  player2_prereq_match_id: number | null;
  player1_is_prereq_match_loser: boolean;
  player2_is_prereq_match_loser: boolean;
  winner_id: number | null;
  suggested_play_order: number | null;
}

interface ParsedMatch extends V1Match {
  idStr: string;
}

function mapChallongeToNative(
  rawMatches: any[],
  rawParticipants: any[],
  teams: TeamInTournament[],
  isDouble: boolean,
): BracketGenerated {
  // ── Lookups ──────────────────────────────────────────────────────
  const participantName = new Map<number, string>();
  rawParticipants.forEach((p: any) => {
    const id = Number(p.id);
    const name = p.attributes?.name ?? p.name;
    if (!Number.isNaN(id)) participantName.set(id, name);
  });

  const teamByName = new Map<string, TeamInTournament>();
  teams.forEach((t) => teamByName.set(t.name.trim().toLowerCase(), t));

  const matches: ParsedMatch[] = rawMatches.map((m: any) => ({ ...m, idStr: String(m.id) }));
  const byId = new Map<number, ParsedMatch>();
  matches.forEach((m) => byId.set(Number(m.id), m));

  const isLosersMatch = (id: number | null) =>
    id != null && byId.has(id) && Number(byId.get(id)!.round) < 0;

  // ── Identify Grand Final + Reset (double elim only) ──────────────
  // GF = positive-round match fed by a losers-bracket match.
  // Reset ("if necessary") = positive match fed by the GF itself.
  let grandFinalId: number | null = null;
  let resetId: number | null = null;

  if (isDouble) {
    for (const m of matches) {
      if (Number(m.round) <= 0) continue;
      const fedByLosers =
        isLosersMatch(m.player1_prereq_match_id) || isLosersMatch(m.player2_prereq_match_id);
      if (fedByLosers) grandFinalId = Number(m.id);
    }
    if (grandFinalId != null) {
      for (const m of matches) {
        if (Number(m.round) <= 0) continue;
        if (
          Number(m.player1_prereq_match_id) === grandFinalId ||
          Number(m.player2_prereq_match_id) === grandFinalId
        ) {
          resetId = Number(m.id);
        }
      }
    }
  }

  // Matches we keep (drop the conditional reset — the data model can't represent it)
  const keptMatches = matches.filter((m) => Number(m.id) !== resetId);
  const keptIds = new Set(keptMatches.map((m) => Number(m.id)));

  // ── Classify each kept match into a section + section-round ───────
  type Col = { section: 'winners' | 'losers' | 'grand-final'; sectionRound: number; match: ParsedMatch };
  const cols: Col[] = keptMatches.map((m) => {
    const r = Number(m.round);
    if (isDouble && Number(m.id) === grandFinalId) {
      return { section: 'grand-final', sectionRound: 1, match: m };
    }
    if (r < 0) return { section: 'losers', sectionRound: Math.abs(r), match: m };
    return { section: 'winners', sectionRound: r, match: m };
  });

  // ── Build ordered columns: winners → losers → grand-final ─────────
  const winnersRounds = [...new Set(cols.filter((c) => c.section === 'winners').map((c) => c.sectionRound))].sort((a, b) => a - b);
  const losersRounds = [...new Set(cols.filter((c) => c.section === 'losers').map((c) => c.sectionRound))].sort((a, b) => a - b);
  const hasGF = cols.some((c) => c.section === 'grand-final');

  const orderedColumns: Col[][] = [];
  winnersRounds.forEach((sr) => orderedColumns.push(cols.filter((c) => c.section === 'winners' && c.sectionRound === sr)));
  losersRounds.forEach((sr) => orderedColumns.push(cols.filter((c) => c.section === 'losers' && c.sectionRound === sr)));
  if (hasGF) orderedColumns.push(cols.filter((c) => c.section === 'grand-final'));

  // ── Resolve a slot's team ────────────────────────────────────────
  const resolveTeam = (
    matchId: string,
    slot: 1 | 2,
    playerId: number | null,
    section: Col['section'],
  ): { teamId: string; teamName: string } => {
    if (playerId != null) {
      const name = participantName.get(playerId) ?? `Player ${playerId}`;
      const team = teamByName.get(name.trim().toLowerCase());
      return { teamId: team?.id ?? `challonge_${playerId}`, teamName: name };
    }
    // Unfilled slot — fed by routing, shown as a placeholder until decided
    const tbd =
      section === 'grand-final'
        ? slot === 1
          ? 'WB Champion'
          : 'LB Champion'
        : section === 'losers'
          ? 'LB TBD'
          : 'Winner TBD';
    return { teamId: `slot_${matchId}_${slot}`, teamName: tbd };
  };

  // ── Build BracketMatch objects column by column ──────────────────
  const rounds: BracketMatch[][] = [];

  orderedColumns.forEach((column, columnIndex) => {
    const sorted = [...column].sort(
      (a, b) => (a.match.suggested_play_order ?? 0) - (b.match.suggested_play_order ?? 0),
    );

    const roundMatches: BracketMatch[] = sorted.map((c, position) => {
      const m = c.match;
      const s1 = resolveTeam(m.idStr, 1, m.player1_id, c.section);
      const s2 = resolveTeam(m.idStr, 2, m.player2_id, c.section);

      const winnerTeamId =
        m.winner_id != null
          ? m.winner_id === m.player1_id
            ? s1.teamId
            : m.winner_id === m.player2_id
              ? s2.teamId
              : undefined
          : undefined;

      const bm: BracketMatch = {
        id: m.idStr,
        team1Id: s1.teamId,
        team2Id: s2.teamId,
        team1Name: s1.teamName,
        team2Name: s2.teamName,
        round: columnIndex,
        position,
        autoPopulated: m.player1_id == null || m.player2_id == null,
        needsAssignment: false,
      };
      if (isDouble) bm.bracketSection = c.section;
      if (winnerTeamId) bm.winner = winnerTeamId;
      return bm;
    });

    rounds.push(roundMatches);
  });

  // ── Wire routing by inverting prerequisite pointers ───────────────
  const bmById = new Map<string, BracketMatch>();
  rounds.flat().forEach((bm) => bmById.set(bm.id, bm));

  for (const m of keptMatches) {
    const sourceId = Number(m.id);
    for (const other of keptMatches) {
      if (!keptIds.has(Number(other.id))) continue;
      // other.player1 fed by this match?
      if (Number(other.player1_prereq_match_id) === sourceId) {
        const target = { matchId: other.idStr, slot: 1 as const };
        if (other.player1_is_prereq_match_loser) bmById.get(m.idStr)!.loserGoesTo = target;
        else bmById.get(m.idStr)!.winnerGoesTo = target;
      }
      // other.player2 fed by this match?
      if (Number(other.player2_prereq_match_id) === sourceId) {
        const target = { matchId: other.idStr, slot: 2 as const };
        if (other.player2_is_prereq_match_loser) bmById.get(m.idStr)!.loserGoesTo = target;
        else bmById.get(m.idStr)!.winnerGoesTo = target;
      }
    }
  }

  return {
    rounds,
    bracketType: isDouble ? 'double' : 'single',
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Imported ${isDouble ? 'double' : 'single'} elimination bracket from Challonge (${teams.length} teams)`,
      },
    ],
  };
}

async function fetchV1(path: string): Promise<any> {
  const res = await fetch(`/api/challonge?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch ${path} (HTTP ${res.status})`);
  }
  return res.json();
}

export async function importChallongeBracket(
  tournamentName: string,
  teams: TeamInTournament[],
  tournamentType: 'single' | 'double' = 'double',
): Promise<{ bracket: BracketGenerated; challongeId: string; challongeUrl: string }> {
  const isDouble = tournamentType === 'double';
  const challongeType = isDouble ? 'double elimination' : 'single elimination';

  console.log(`[Importer] Creating Challonge tournament: ${tournamentName}`);
  const result = await ChallongeAPI.createFullTournament(tournamentName, teams, challongeType);
  const tournamentId = result.tournamentId;
  console.log(`[Importer] Tournament created + started: ${tournamentId}`);

  // Fetch via v1 — only v1 exposes prereq routing fields.
  const matchesData = await fetchV1(`/v1/tournaments/${tournamentId}/matches.json`);
  const partsData = await fetchV1(`/v1/tournaments/${tournamentId}/participants.json`);

  // v1 returns raw arrays: [{ match: {...} }] and [{ participant: {...} }]
  const rawMatches = Array.isArray(matchesData)
    ? matchesData.map((x: any) => x.match)
    : matchesData.data?.map((m: any) => m.attributes) ?? [];
  const rawParticipants = Array.isArray(partsData)
    ? partsData.map((x: any) => x.participant)
    : partsData.data ?? [];

  console.log(`[Importer] Fetched ${rawMatches.length} matches, ${rawParticipants.length} participants`);

  const bracket = mapChallongeToNative(rawMatches, rawParticipants, teams, isDouble);
  console.log(`[Importer] Mapped to ${bracket.rounds.length} columns, ${bracket.rounds.flat().length} matches`);

  return {
    bracket,
    challongeId: tournamentId,
    challongeUrl: result.tournamentUrl,
  };
}
