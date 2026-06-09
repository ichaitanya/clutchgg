import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BracketGenerated, BracketMatch, TeamInTournament, RRTeamEntry } from './TournamentCreation';

interface BracketDisplayProps {
  bracket: BracketGenerated;
  teams: TeamInTournament[];
  onBracketChange: (bracket: BracketGenerated) => void;
  editable?: boolean;
  accentColor?: string; // 'red' | 'purple'
  // Two-stage: when all Stage 1 matches are done, call this with the top N qualified teams
  qualifiersCount?: number;
  onQualify?: (qualifiedTeams: TeamInTournament[]) => void;
  alreadyQualified?: boolean; // suppress qualify button once done
}

/**
 * Derive the top N teams from a completed Stage 1 bracket.
 * For single/double elim: winner of final, then runner-up, then semi-finalists, etc.
 * For round robin: order by standings (W-L, then round diff).
 */
function deriveQualifiedTeams(
  bracket: BracketGenerated,
  allTeams: TeamInTournament[],
  n: number
): TeamInTournament[] {
  const findTeam = (id: string) => allTeams.find(t => t.id === id);

  if (bracket.bracketType === 'roundrobin') {
    // Use standings order
    const standings = computeRRStandings(bracket.rounds, bracket.rrTeams || []);
    return standings
      .slice(0, n)
      .map(row => findTeam(row.teamId))
      .filter((t): t is TeamInTournament => !!t);
  }

  // Single / Double: collect winners round-by-round from the last round backwards
  // Flatten all rounds, sort by round descending
  const allMatches = bracket.rounds.flat().filter(m => m.winner);
  allMatches.sort((a, b) => b.round - a.round);

  const seen = new Set<string>();
  const result: TeamInTournament[] = [];

  for (const match of allMatches) {
    if (result.length >= n) break;
    // Add winner first, then loser
    for (const id of [match.winner!, match.winner === match.team1Id ? match.team2Id : match.team1Id]) {
      if (!seen.has(id) && result.length < n) {
        const team = findTeam(id);
        if (team) { seen.add(id); result.push(team); }
      }
    }
  }

  return result;
}

/** Has a match been decided by map results (a team reached ceil(maxMaps/2) wins)? */
function matchDecidedByMaps(m: BracketMatch): boolean {
  const maps = m.maps ?? [];
  if (maps.length === 0) return false;
  const maxMaps = m.format === 'bo1' ? 1 : m.format === 'bo5' ? 5 : 3;
  let w1 = 0, w2 = 0;
  for (const mp of maps) {
    if (mp.team1Score > mp.team2Score) w1++;
    else if (mp.team2Score > mp.team1Score) w2++;
  }
  const needed = Math.ceil(maxMaps / 2);
  if (w1 >= needed || w2 >= needed) return true;
  if (maps.length >= maxMaps && w1 !== w2) return true;
  return false;
}

/** Check whether all matches in a bracket are decided (stage complete). A match
 *  counts as done when it has an explicit winner OR is decided by map results. */
function isBracketComplete(bracket: BracketGenerated): boolean {
  return bracket.rounds.every(round => round.every(m => !!m.winner || matchDecidedByMaps(m)));
}

// Propagate a winner through the bracket using winnerGoesTo / loserGoesTo routing fields.
function propagateResult(
  rounds: BracketMatch[][],
  matchId: string,
  winnerId: string,
  winnerName: string,
  loserId: string,
  loserName: string
): BracketMatch[][] {
  // Build flat map for quick lookup
  const flat: Record<string, { r: number; i: number }> = {};
  rounds.forEach((round, r) => round.forEach((m, i) => { flat[m.id] = { r, i }; }));

  const srcPos = flat[matchId];
  if (!srcPos) return rounds;
  const srcMatch = rounds[srcPos.r][srcPos.i];

  let newRounds = rounds.map(r => r.map(m => ({ ...m })));

  const applyTo = (destMatchId: string, slot: 1 | 2, teamId: string, teamName: string) => {
    const pos = flat[destMatchId];
    if (!pos) return;
    const dest = newRounds[pos.r][pos.i];
    if (slot === 1) {
      dest.team1Id = teamId;
      dest.team1Name = teamName;
      dest.autoPopulated = true;
    } else {
      dest.team2Id = teamId;
      dest.team2Name = teamName;
      dest.autoPopulated = true;
    }
    // Clear any existing winner in destination since teams changed
    dest.winner = undefined;
  };

  // Route winner
  if (srcMatch.winnerGoesTo) {
    applyTo(srcMatch.winnerGoesTo.matchId, srcMatch.winnerGoesTo.slot, winnerId, winnerName);
  }

  // Route loser (only relevant for double elimination winners bracket matches)
  if (srcMatch.loserGoesTo) {
    applyTo(srcMatch.loserGoesTo.matchId, srcMatch.loserGoesTo.slot, loserId, loserName);
  }

  return newRounds;
}

// Legacy propagation for single elimination (no routing fields)
function propagateSingleElim(
  rounds: BracketMatch[][],
  roundIdx: number,
  matchIdx: number,
  winnerId: string,
  winnerName: string
): BracketMatch[][] {
  const next = rounds[roundIdx + 1];
  if (!next) return rounds;

  const nextMatchIdx = Math.floor(matchIdx / 2);
  const isTeam1Slot = matchIdx % 2 === 0;
  const nextMatch = next[nextMatchIdx];
  if (!nextMatch) return rounds;

  return rounds.map((r, i) => {
    if (i !== roundIdx + 1) return r;
    return r.map((m, j) => {
      if (j !== nextMatchIdx) return m;
      return isTeam1Slot
        ? { ...m, team1Id: winnerId, team1Name: winnerName, winner: undefined, autoPopulated: true }
        : { ...m, team2Id: winnerId, team2Name: winnerName, winner: undefined, autoPopulated: true };
    });
  });
}

function getRoundLabel(roundIdx: number, totalRounds: number): string {
  const remaining = totalRounds - roundIdx;
  if (remaining === 1) return 'Final';
  if (remaining === 2) return 'Semi Finals';
  if (remaining === 3) return 'Quarter Finals';
  return `Round ${roundIdx + 1}`;
}

function TeamSlotSelect({
  value,
  onChange,
  teams,
  usedIds,
  accent,
}: {
  value: string;
  onChange: (id: string, name: string) => void;
  teams: TeamInTournament[];
  usedIds: Set<string>;
  accent: string;
}) {
  const accentBorder = accent === 'purple' ? 'border-purple-500/60' : 'border-[#ff4655]/60';
  const isAssigned = teams.some(t => t.id === value);
  return (
    <select
      className={`w-full bg-[#0d0f16] border-b ${isAssigned ? accentBorder : 'border-[#2a2d3a]'} text-xs px-3 py-2.5 focus:outline-none cursor-pointer ${isAssigned ? 'text-white' : 'text-gray-500'}`}
      value={isAssigned ? value : ''}
      onChange={e => {
        const team = teams.find(t => t.id === e.target.value);
        if (team) onChange(team.id, team.name);
      }}
    >
      <option value="">— Select Team —</option>
      {teams.filter(t => !usedIds.has(t.id) || t.id === value).map(t => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function MatchCard({
  match,
  editable,
  accent,
  teams,
  usedTeamIds,
  onSetWinner,
  onAssignTeam,
}: {
  match: BracketMatch;
  editable: boolean;
  accent: string;
  teams: TeamInTournament[];
  usedTeamIds: Set<string>;
  onSetWinner: (teamId: string, teamName: string) => void;
  onAssignTeam: (slot: 1 | 2, teamId: string, teamName: string) => void;
}) {
  const isPlaceholder = (name: string) =>
    name.startsWith('Team Slot') || name.startsWith('Winner') || name.startsWith('Loser') ||
    name === 'TBD' || name === 'LB TBD' || name === 'WB Champion' || name === 'LB Champion' ||
    name === 'Select Team';

  const isSlot1 = isPlaceholder(match.team1Name);
  const isSlot2 = isPlaceholder(match.team2Name);
  // Derive winner from explicit field or from map tally when maps are decisive
  let winner1 = match.winner === match.team1Id;
  let winner2 = match.winner === match.team2Id;
  if (!winner1 && !winner2 && matchDecidedByMaps(match)) {
    const maps = match.maps ?? [];
    let w1 = 0, w2 = 0;
    for (const mp of maps) {
      if (mp.team1Score > mp.team2Score) w1++;
      else if (mp.team2Score > mp.team1Score) w2++;
    }
    if (w1 > w2) winner1 = true;
    else if (w2 > w1) winner2 = true;
  }

  const accentBorder = accent === 'purple' ? 'border-purple-500' : 'border-[#ff4655]';
  const accentBg = accent === 'purple' ? 'bg-purple-500/20' : 'bg-[#ff4655]/20';
  const accentText = accent === 'purple' ? 'text-purple-400' : 'text-[#ff4655]';
  const accentHover = accent === 'purple' ? 'hover:border-purple-500/40' : 'hover:border-[#ff4655]/40';

  // If this match needs team assignment, show dropdowns
  if (match.needsAssignment && editable) {
    return (
      <div className="w-44 bg-[#151821] border border-[#2a2d3a] rounded-lg overflow-hidden shadow-lg">
        <TeamSlotSelect
          value={match.team1Id}
          onChange={(id, name) => onAssignTeam(1, id, name)}
          teams={teams}
          usedIds={usedTeamIds}
          accent={accent}
        />
        <TeamSlotSelect
          value={match.team2Id}
          onChange={(id, name) => onAssignTeam(2, id, name)}
          teams={teams}
          usedIds={usedTeamIds}
          accent={accent}
        />
      </div>
    );
  }

  return (
    <div className="w-44 bg-[#151821] border border-[#2a2d3a] rounded-lg overflow-hidden shadow-lg">
      <div
        className={`w-full flex items-center gap-2 px-3 py-2.5 border-b border-[#2a2d3a]
          ${winner1 ? `${accentBg} ${accentBorder} border-l-2` : ''}
          ${winner2 ? 'opacity-40' : ''}
        `}
      >
        <span className={`text-xs font-semibold truncate flex-1 ${winner1 ? accentText : isSlot1 ? 'text-gray-600' : 'text-white'}`}>
          {match.team1Name}
        </span>
        {winner1 && <span className={`text-[10px] font-bold ${accentText}`}>W</span>}
      </div>

      <div
        className={`w-full flex items-center gap-2 px-3 py-2.5
          ${winner2 ? `${accentBg} ${accentBorder} border-l-2` : ''}
          ${winner1 ? 'opacity-40' : ''}
        `}
      >
        <span className={`text-xs font-semibold truncate flex-1 ${winner2 ? accentText : isSlot2 ? 'text-gray-600' : 'text-white'}`}>
          {match.team2Name}
        </span>
        {winner2 && <span className={`text-[10px] font-bold ${accentText}`}>W</span>}
      </div>
    </div>
  );
}

// Renders a set of rounds as a horizontal bracket tree
function BracketTree({
  rounds,
  globalRoundOffset,
  totalRoundsInTree,
  editable,
  accent,
  teams,
  usedTeamIds,
  onSetWinner,
  onResetMatch,
  onAssignTeam,
}: {
  rounds: BracketMatch[][];
  globalRoundOffset: number;
  totalRoundsInTree: number;
  editable: boolean;
  accent: string;
  teams: TeamInTournament[];
  usedTeamIds: Set<string>;
  onSetWinner: (globalRoundIdx: number, matchIdx: number, teamId: string, teamName: string) => void;
  onResetMatch: (globalRoundIdx: number, matchIdx: number) => void;
  onAssignTeam: (globalRoundIdx: number, matchIdx: number, slot: 1 | 2, teamId: string, teamName: string) => void;
}) {
  // ── Routing-graph-driven vertical layout ─────────────────────────
  // Position each match by the matches that actually feed it (winnerGoesTo),
  // not by assuming every round halves the previous. This correctly lays out
  // bye-compressed brackets (e.g. Challonge imports where round 1 has fewer
  // matches than round 2) AND standard power-of-two brackets, which fall out as
  // the special case where the first column is the widest.
  const ROW = 76;            // 64px card + 12px gap
  const CARD_HEIGHT = 64;
  const HEADER_OFFSET = 24;
  const FIRST_CENTER = CARD_HEIGHT / 2 + 6; // 38 — matches the prior tight stack

  const centers = (() => {
    const map = new Map<string, number>();
    if (rounds.length === 0) return map;

    const inSet = new Set(rounds.flat().map(m => m.id));
    const feedersOf = new Map<string, string[]>();   // match -> in-set matches feeding it
    const matchById = new Map<string, BracketMatch>();
    rounds.flat().forEach(m => {
      matchById.set(m.id, m);
      const dest = m.winnerGoesTo?.matchId;
      if (dest && inSet.has(dest)) {
        const arr = feedersOf.get(dest) ?? [];
        arr.push(m.id);
        feedersOf.set(dest, arr);
      }
    });
    // Keep feeders in column order so pairs read top-to-bottom consistently.
    const colIndexOf = new Map<string, number>();
    rounds.forEach((r, ci) => r.forEach(m => colIndexOf.set(m.id, ci)));
    feedersOf.forEach(arr => arr.sort((a, b) => {
      const ca = colIndexOf.get(a)!, cb = colIndexOf.get(b)!;
      return ca !== cb ? ca - cb : 0;
    }));

    // Challonge-style layout: a match is centered exactly between the matches
    // that feed it; "leaf" matches (no in-tree feeders — first round / bye
    // entries) get evenly spaced slots. Computed via post-order so feeders are
    // always positioned before the match they feed.
    let nextLeafSlot = 0;
    const place = (id: string): number => {
      if (map.has(id)) return map.get(id)!;
      const feeders = feedersOf.get(id) ?? [];
      let center: number;
      if (feeders.length === 0) {
        center = nextLeafSlot * ROW + FIRST_CENTER;
        nextLeafSlot += 1;
      } else {
        const fc = feeders.map(place);
        center = (Math.min(...fc) + Math.max(...fc)) / 2;
      }
      map.set(id, center);
      return center;
    };

    // Roots = matches whose winner doesn't feed anything in this tree (the
    // final, plus any stray). Placing each root lays out its whole subtree.
    rounds.flat().forEach(m => {
      const dest = m.winnerGoesTo?.matchId;
      if (!dest || !inSet.has(dest)) place(m.id);
    });
    // Safety: place anything not yet reached (shouldn't happen in a connected tree).
    rounds.flat().forEach(m => { if (!map.has(m.id)) place(m.id); });

    return map;
  })();

  const centerOf = (id: string) => centers.get(id) ?? FIRST_CENTER;

  const allCenters = [...centers.values()];
  const maxHeight = (allCenters.length ? Math.max(...allCenters) : FIRST_CENTER)
    + CARD_HEIGHT / 2 + HEADER_OFFSET + CARD_HEIGHT;

  return (
    <div className="overflow-x-auto overflow-y-hidden pb-4">
      <div
        className="flex gap-0 relative"
        style={{ minWidth: `${rounds.length * 220}px`, height: `${maxHeight}px` }}
      >
        {rounds.map((round, roundIdx) => {
          return (
            <div key={roundIdx} className="flex flex-col" style={{ width: 220 }}>
              <div className="px-4 mb-3 h-6 flex items-center">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  {getRoundLabel(roundIdx, totalRoundsInTree)}
                </span>
              </div>

              <div className="relative flex-1">
                {round.map((match, matchIdx) => {
                  const thisMatchCenter = centerOf(match.id);
                  const top = thisMatchCenter - 32;
                  // Connector follows the real routing: draw to the match this
                  // one's winner feeds, when that destination is in this tree.
                  const destId = match.winnerGoesTo && centers.has(match.winnerGoesTo.matchId)
                    ? match.winnerGoesTo.matchId
                    : null;
                  const nextMatchCenter = destId ? centerOf(destId) : thisMatchCenter;

                  const minCenter = Math.min(thisMatchCenter, nextMatchCenter);
                  const svgHeight = Math.abs(nextMatchCenter - thisMatchCenter) + 2;
                  const svgTop = thisMatchCenter > nextMatchCenter
                    ? nextMatchCenter - thisMatchCenter
                    : 0;
                  const y1 = thisMatchCenter - minCenter;
                  const y2 = nextMatchCenter - minCenter;

                  return (
                    <div key={match.id} className="absolute" style={{ top: top + 24, left: 8 }}>
                      {match.displayNumber != null && (
                        <span
                          className="absolute -left-1.5 top-1/2 -translate-y-1/2 z-10 min-w-[16px] h-4 px-1 flex items-center justify-center rounded bg-[#0d0f16] border border-[#2a2d3a] text-[9px] font-bold text-gray-400"
                          title={`Match ${match.displayNumber}`}
                        >
                          {match.displayNumber}
                        </span>
                      )}
                      <MatchCard
                        match={match}
                        editable={editable}
                        accent={accent}
                        teams={teams}
                        usedTeamIds={usedTeamIds}
                        onSetWinner={(id, name) => onSetWinner(globalRoundOffset + roundIdx, matchIdx, id, name)}
                        onAssignTeam={(slot, id, name) => onAssignTeam(globalRoundOffset + roundIdx, matchIdx, slot, id, name)}
                      />

                      {destId && (
                        <svg
                          className="absolute pointer-events-none"
                          style={{ left: '176px', top: svgTop, width: 44, height: svgHeight }}
                          overflow="visible"
                        >
                          <line x1={0} y1={y1} x2={22} y2={y1} stroke="#2a2d3a" strokeWidth={1.5} />
                          <line x1={22} y1={y1} x2={22} y2={y2} stroke="#2a2d3a" strokeWidth={1.5} />
                          <line x1={22} y1={y2} x2={44} y2={y2} stroke="#2a2d3a" strokeWidth={1.5} />
                        </svg>
                      )}

                      {editable && match.winner && (
                        <button
                          onClick={() => onResetMatch(globalRoundOffset + roundIdx, matchIdx)}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-[#1e2130] border border-[#2a2d3a] rounded-full flex items-center justify-center text-gray-500 hover:text-[#ff4655] hover:border-[#ff4655]/50 transition-colors text-[10px]"
                          title="Reset match result"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface RRStandingsRow {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  wl: number;       // wins - losses
  roundsWon: number;
  roundsLost: number;
  roundDiff: number; // roundsWon - roundsLost (tiebreaker)
  played: number;
}

/**
 * Compute round robin standings from match results.
 * Primary sort: W-L (wins minus losses).
 * Tiebreaker: round difference (rounds won - rounds lost across all matches).
 * "Rounds" here means individual match instances treated as a single unit per match
 * since each match has one winner — so roundDiff equals wl for match-based scoring.
 * We expose it separately so it can be extended to best-of-N series later.
 */
export function computeRRStandings(rounds: BracketMatch[][], rrTeams: RRTeamEntry[]): RRStandingsRow[] {
  const map: Record<string, RRStandingsRow> = {};

  for (const team of rrTeams) {
    map[team.id] = {
      teamId: team.id,
      teamName: team.name,
      wins: 0,
      losses: 0,
      wl: 0,
      roundsWon: 0,
      roundsLost: 0,
      roundDiff: 0,
      played: 0,
    };
  }

  for (const round of rounds) {
    for (const match of round) {
      if (!match.winner) continue;
      const winnerId = match.winner;
      const loserId = winnerId === match.team1Id ? match.team2Id : match.team1Id;

      if (map[winnerId]) {
        map[winnerId].wins++;
        map[winnerId].roundsWon++;
        map[winnerId].played++;
      }
      if (map[loserId]) {
        map[loserId].losses++;
        map[loserId].roundsLost++;
        map[loserId].played++;
      }
    }
  }

  return Object.values(map)
    .map(r => ({ ...r, wl: r.wins - r.losses, roundDiff: r.roundsWon - r.roundsLost }))
    .sort((a, b) => {
      if (b.wl !== a.wl) return b.wl - a.wl;
      return b.roundDiff - a.roundDiff;
    });
}

export function BracketDisplay({
  bracket,
  teams,
  onBracketChange,
  editable = false,
  accentColor = 'red',
  qualifiersCount,
  onQualify,
  alreadyQualified = false,
}: BracketDisplayProps) {
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  void confirmReset;

  // Collect all team IDs currently assigned to Round 0 slots (for dropdown deduplication)
  const usedTeamIds = new Set<string>(
    bracket.rounds[0]?.flatMap(m =>
      [m.team1Id, m.team2Id].filter(id => teams.some(t => t.id === id))
    ) ?? []
  );

  const handleAssignTeam = (roundIdx: number, matchIdx: number, slot: 1 | 2, teamId: string, teamName: string) => {
    const newRounds = bracket.rounds.map((round, rIdx) =>
      round.map((m, mIdx) => {
        if (rIdx !== roundIdx || mIdx !== matchIdx) return m;
        const updated = slot === 1
          ? { ...m, team1Id: teamId, team1Name: teamName }
          : { ...m, team2Id: teamId, team2Name: teamName };
        // Clear needsAssignment once both slots have real teams assigned
        const t1 = slot === 1 ? teamId : updated.team1Id;
        const t2 = slot === 2 ? teamId : updated.team2Id;
        const bothAssigned = teams.some(t => t.id === t1) && teams.some(t => t.id === t2);
        return { ...updated, needsAssignment: !bothAssigned };
      })
    );
    onBracketChange({ ...bracket, rounds: newRounds });
  };

  const complete = isBracketComplete(bracket);
  const showQualifyButton = editable && !!onQualify && !!qualifiersCount && complete && !alreadyQualified;

  const isDouble = bracket.bracketType === 'double';

  // Split rounds by section for double elimination
  const winnersRounds = isDouble
    ? bracket.rounds.filter(r => r[0]?.bracketSection === 'winners')
    : bracket.rounds;
  const losersRounds = isDouble
    ? bracket.rounds.filter(r => r[0]?.bracketSection === 'losers')
    : [];
  const grandFinalRound = isDouble
    ? bracket.rounds.filter(r => r[0]?.bracketSection === 'grand-final')
    : [];

  const handleSetWinner = (roundIdx: number, matchIdx: number, teamId: string, teamName: string) => {
    const match = bracket.rounds[roundIdx]?.[matchIdx];
    if (!match) return;

    // Determine loser
    const loserId = teamId === match.team1Id ? match.team2Id : match.team1Id;
    const loserName = teamId === match.team1Id ? match.team2Name : match.team1Name;

    // Set winner on this match
    let newRounds = bracket.rounds.map((round, rIdx) =>
      round.map((m, mIdx) => {
        if (rIdx === roundIdx && mIdx === matchIdx) {
          return { ...m, winner: teamId };
        }
        return m;
      })
    );

    if (isDouble && match.winnerGoesTo) {
      newRounds = propagateResult(newRounds, match.id, teamId, teamName, loserId, loserName);
    } else if (bracket.bracketType !== 'roundrobin') {
      // Single elim: propagate winner to next round slot
      newRounds = propagateSingleElim(newRounds, roundIdx, matchIdx, teamId, teamName);
    }
    // Round robin: no propagation — standings computed live from results

    onBracketChange({
      ...bracket,
      rounds: newRounds,
      customizationHistory: [
        ...bracket.customizationHistory,
        {
          timestamp: new Date().toISOString(),
          changes: `${teamName} won Round ${roundIdx + 1} Match ${matchIdx + 1}`,
        },
      ],
    });
  };

  const handleResetMatch = (roundIdx: number, matchIdx: number) => {
    setConfirmReset(null);

    const currentMatch = bracket.rounds[roundIdx]?.[matchIdx];
    if (!currentMatch?.winner) return;

    let newRounds = bracket.rounds.map((round, rIdx) =>
      round.map((m, mIdx) => {
        if (rIdx === roundIdx && mIdx === matchIdx) {
          return { ...m, winner: undefined };
        }
        return m;
      })
    );

    // Clear the winner's propagated slot in the destination match
    if (isDouble && currentMatch.winnerGoesTo) {
      const { matchId, slot } = currentMatch.winnerGoesTo;
      newRounds = newRounds.map(round =>
        round.map(m => {
          if (m.id !== matchId) return m;
          return slot === 1
            ? { ...m, team1Id: `slot_reset`, team1Name: 'WB/LB TBD', winner: undefined }
            : { ...m, team2Id: `slot_reset`, team2Name: 'WB/LB TBD', winner: undefined };
        })
      );
    } else {
      // Single elim: clear next round slot
      const nextRound = newRounds[roundIdx + 1];
      if (nextRound) {
        const nextMatchIdx = Math.floor(matchIdx / 2);
        const isTeam1 = matchIdx % 2 === 0;
        newRounds = newRounds.map((r, i) => {
          if (i !== roundIdx + 1) return r;
          return r.map((m, j) => {
            if (j !== nextMatchIdx) return m;
            return isTeam1
              ? { ...m, team1Id: `slot_reset_${matchIdx}`, team1Name: 'TBD', winner: undefined }
              : { ...m, team2Id: `slot_reset_${matchIdx}`, team2Name: 'TBD', winner: undefined };
          });
        });
      }
    }

    // Also clear the loser's propagated slot if it exists
    if (isDouble && currentMatch.loserGoesTo) {
      const { matchId, slot } = currentMatch.loserGoesTo;
      newRounds = newRounds.map(round =>
        round.map(m => {
          if (m.id !== matchId) return m;
          return slot === 1
            ? { ...m, team1Id: `slot_reset`, team1Name: 'LB TBD', winner: undefined }
            : { ...m, team2Id: `slot_reset`, team2Name: 'LB TBD', winner: undefined };
        })
      );
    }

    onBracketChange({
      ...bracket,
      rounds: newRounds,
      customizationHistory: [
        ...bracket.customizationHistory,
        {
          timestamp: new Date().toISOString(),
          changes: `Reset Round ${roundIdx + 1} Match ${matchIdx + 1}`,
        },
      ],
    });
  };

  // Compute global round offsets for each section
  const winnersOffset = 0;
  const losersOffset = winnersRounds.length;
  const grandFinalOffset = losersOffset + losersRounds.length;

  // Qualify banner — shown when all matches are done and onQualify is wired
  const QualifyBanner = showQualifyButton ? (
    <div className="mt-4 bg-green-900/20 border border-green-700/40 rounded-xl p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-green-300 font-semibold text-sm">Stage 1 Complete!</p>
        <p className="text-green-400/70 text-xs mt-0.5">
          Top {qualifiersCount} teams ready to advance to Stage 2.
        </p>
      </div>
      <button
        onClick={() => {
          const qualified = deriveQualifiedTeams(bracket, teams, qualifiersCount!);
          onQualify!(qualified);
        }}
        className="shrink-0 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-colors"
      >
        Advance to Stage 2 →
      </button>
    </div>
  ) : null;

  if (isDouble) {
    return (
      <div className="space-y-6">
        {editable && (
          <p className="text-xs text-gray-500">
            {bracket.rounds[0]?.some(m => m.needsAssignment)
              ? 'Assign teams to each slot in Round 1, then edit each match to enter map results.'
              : 'Edit each match to enter map results. Winner is determined by most maps won.'}
          </p>
        )}

        {/* Winners Bracket */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-[#2a2d3a]" />
            <span className="text-xs font-bold text-green-400 uppercase tracking-widest px-2">Winners Bracket</span>
            <div className="h-px flex-1 bg-[#2a2d3a]" />
          </div>
          <BracketTree
            rounds={winnersRounds}
            globalRoundOffset={winnersOffset}
            totalRoundsInTree={winnersRounds.length}
            editable={editable}
            accent={accentColor}
            teams={teams}
            usedTeamIds={usedTeamIds}
            onSetWinner={handleSetWinner}
            onResetMatch={handleResetMatch}
            onAssignTeam={handleAssignTeam}
          />
        </div>

        {/* Losers Bracket */}
        {losersRounds.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-[#2a2d3a]" />
              <span className="text-xs font-bold text-orange-400 uppercase tracking-widest px-2">Losers Bracket</span>
              <div className="h-px flex-1 bg-[#2a2d3a]" />
            </div>
            <BracketTree
              rounds={losersRounds}
              globalRoundOffset={losersOffset}
              totalRoundsInTree={losersRounds.length}
              editable={editable}
              accent="purple"
              teams={teams}
              usedTeamIds={usedTeamIds}
              onSetWinner={handleSetWinner}
              onResetMatch={handleResetMatch}
              onAssignTeam={handleAssignTeam}
            />
          </div>
        )}

        {/* Grand Final */}
        {grandFinalRound.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-[#2a2d3a]" />
              <span className="text-xs font-bold text-yellow-400 uppercase tracking-widest px-2">Grand Final</span>
              <div className="h-px flex-1 bg-[#2a2d3a]" />
            </div>
            <BracketTree
              rounds={grandFinalRound}
              globalRoundOffset={grandFinalOffset}
              totalRoundsInTree={1}
              editable={editable}
              accent={accentColor}
              teams={teams}
              usedTeamIds={usedTeamIds}
              onSetWinner={handleSetWinner}
              onResetMatch={handleResetMatch}
              onAssignTeam={handleAssignTeam}
            />
          </div>
        )}
        {QualifyBanner}
      </div>
    );
  }

  // Round Robin: show match schedule + live standings
  if (bracket.bracketType === 'roundrobin') {
    const standings = computeRRStandings(bracket.rounds, bracket.rrTeams || []);
    return (
      <div className="space-y-6">
        {/* Standings table */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-[#2a2d3a]" />
            <span className="text-xs font-bold text-yellow-400 uppercase tracking-widest px-2">Standings</span>
            <div className="h-px flex-1 bg-[#2a2d3a]" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase border-b border-[#2a2d3a]">
                  <th className="px-3 py-2 text-left w-8">#</th>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-center">W</th>
                  <th className="px-3 py-2 text-center">L</th>
                  <th className="px-3 py-2 text-center">W-L</th>
                  <th className="px-3 py-2 text-center">Rd Diff</th>
                  <th className="px-3 py-2 text-center">MP</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, idx) => (
                  <tr key={row.teamId} className="border-b border-[#1e2130] hover:bg-[#1e2130] transition-colors">
                    <td className="px-3 py-2.5">
                      <div className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${idx === 0 ? 'bg-yellow-500 text-black' : idx === 1 ? 'bg-gray-400 text-black' : idx === 2 ? 'bg-amber-700 text-white' : 'bg-[#2a2d3a] text-gray-400'}`}>
                        {idx + 1}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium">
                      <Link to={`/teams/${row.teamId}`} className="text-white hover:text-[#ff4655] transition-colors">{row.teamName}</Link>
                    </td>
                    <td className="px-3 py-2.5 text-center text-green-400 font-semibold">{row.wins}</td>
                    <td className="px-3 py-2.5 text-center text-red-400 font-semibold">{row.losses}</td>
                    <td className="px-3 py-2.5 text-center font-bold">
                      <span className={row.wl > 0 ? 'text-green-400' : row.wl < 0 ? 'text-red-400' : 'text-gray-400'}>
                        {row.wl > 0 ? `+${row.wl}` : row.wl}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-300">
                      {row.roundDiff > 0 ? `+${row.roundDiff}` : row.roundDiff}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-500">{row.played}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Match schedule by round */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-[#2a2d3a]" />
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest px-2">Match Schedule</span>
            <div className="h-px flex-1 bg-[#2a2d3a]" />
          </div>
          <div className="space-y-4">
            {bracket.rounds.map((round, roundIdx) => (
              <div key={roundIdx}>
                <p className="text-xs font-bold text-gray-500 uppercase mb-2">Round {roundIdx + 1}</p>
                <div className="space-y-2">
                  {round.map((match) => {
                    const isWinner1 = match.winner === match.team1Id;
                    const isWinner2 = match.winner === match.team2Id;
                    return (
                      <div key={match.id} className="flex items-center gap-2 bg-[#151821] border border-[#2a2d3a] rounded-lg px-3 py-2.5">
                        <span className={`flex-1 text-sm font-semibold text-right truncate ${isWinner1 ? 'text-green-400' : isWinner2 ? 'text-gray-500' : 'text-white'}`}>
                          {match.team1Name}
                        </span>
                        {editable && !match.winner ? (
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => handleSetWinner(roundIdx, round.indexOf(match), match.team1Id, match.team1Name)}
                              className="px-2 py-0.5 text-[10px] bg-green-600/20 hover:bg-green-600/40 text-green-400 rounded transition-colors"
                            >W1</button>
                            <span className="text-gray-600 text-xs self-center">vs</span>
                            <button
                              onClick={() => handleSetWinner(roundIdx, round.indexOf(match), match.team2Id, match.team2Name)}
                              className="px-2 py-0.5 text-[10px] bg-green-600/20 hover:bg-green-600/40 text-green-400 rounded transition-colors"
                            >W2</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 shrink-0">
                            {match.winner ? (
                              <span className="text-[10px] text-gray-500 px-1">vs</span>
                            ) : (
                              <span className="text-[10px] text-gray-600 px-1">vs</span>
                            )}
                            {editable && match.winner && (
                              <button
                                onClick={() => handleResetMatch(roundIdx, round.indexOf(match))}
                                className="w-4 h-4 bg-[#1e2130] border border-[#2a2d3a] rounded-full flex items-center justify-center text-gray-500 hover:text-[#ff4655] text-[9px] transition-colors"
                                title="Reset result"
                              >×</button>
                            )}
                          </div>
                        )}
                        <span className={`flex-1 text-sm font-semibold truncate ${isWinner2 ? 'text-green-400' : isWinner1 ? 'text-gray-500' : 'text-white'}`}>
                          {match.team2Name}
                        </span>
                        {(match.date || match.time) && (
                          <span className="text-gray-600 text-xs ml-1 shrink-0">
                            {match.date}{match.date && match.time ? ' ' : ''}{match.time}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        {QualifyBanner}
      </div>
    );
  }

  // Single elimination: flat bracket tree
  return (
    <div className="space-y-4">
      {editable && (
        <p className="text-xs text-gray-500">
          {bracket.rounds[0]?.some(m => m.needsAssignment)
            ? 'Assign teams to each slot in Round 1, then edit each match to enter map results.'
            : 'Edit each match to enter map results. Winner is determined by most maps won.'}
        </p>
      )}
      <BracketTree
        rounds={bracket.rounds}
        globalRoundOffset={0}
        totalRoundsInTree={bracket.rounds.length}
        editable={editable}
        accent={accentColor}
        teams={teams}
        usedTeamIds={usedTeamIds}
        onSetWinner={handleSetWinner}
        onResetMatch={handleResetMatch}
        onAssignTeam={handleAssignTeam}
      />
      {QualifyBanner}
    </div>
  );
}
