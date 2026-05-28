// ── Bracket Generation Utilities ─────────────────────────────────────────────

import type { BracketMatch, BracketGenerated, TeamInTournament, RRTeamEntry } from '../components/TournamentCreation';

/** Returns the smallest power of 2 >= n (minimum 2). */
export function nextPowerOfTwo(n: number): number {
  if (n <= 2) return 2;
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/** Pad a team list with bye slots up to the next power of 2. */
function padWithByes(teams: TeamInTournament[], forcedSize?: number): TeamInTournament[] {
  const size = forcedSize ?? nextPowerOfTwo(teams.length);
  const byes = size - teams.length;
  const byeTeams: TeamInTournament[] = Array.from({ length: byes }, (_, i) => ({
    id: `bye_${i}`,
    name: 'BYE',
    players: [],
  }));
  return [...teams, ...byeTeams];
}

/**
 * Generate a simplified single elimination bracket from actual teams.
 * Round 1 slots are left unassigned (needsAssignment=true) so the admin
 * can manually pick which team fills each slot.
 */
export function generateSimplifiedSingleEliminationBracket(
  teams: TeamInTournament[],
  forcedSize?: number,
): BracketGenerated {
  const size = forcedSize ? nextPowerOfTwo(forcedSize) : nextPowerOfTwo(teams.length);
  const slotCount = size;
  const rounds: BracketMatch[][] = [];

  // Round 0: empty slots — admin assigns teams
  const r0: BracketMatch[] = [];
  for (let i = 0; i < slotCount / 2; i++) {
    r0.push({
      id: `match_0_${i}`,
      team1Id: `slot_0_${i}_1`,
      team2Id: `slot_0_${i}_2`,
      team1Name: 'Select Team',
      team2Name: 'Select Team',
      round: 0,
      position: i,
      needsAssignment: true,
    });
  }
  rounds.push(r0);

  // Subsequent rounds: TBD winners propagate
  let prevCount = slotCount / 2;
  let currentRound = 1;
  while (prevCount > 1) {
    const roundMatches: BracketMatch[] = [];
    for (let i = 0; i < prevCount / 2; i++) {
      roundMatches.push({
        id: `match_${currentRound}_${i}`,
        team1Id: `winner_${currentRound - 1}_${i * 2}`,
        team2Id: `winner_${currentRound - 1}_${i * 2 + 1}`,
        team1Name: 'Winner TBD',
        team2Name: 'Winner TBD',
        round: currentRound,
        position: i,
        autoPopulated: true,
      });
    }
    rounds.push(roundMatches);
    prevCount = prevCount / 2;
    currentRound++;
  }

  return {
    rounds,
    bracketType: 'single',
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated single elimination bracket with ${teams.length} teams (${slotCount} slots)`,
      },
    ],
  };
}

/**
 * Generate a double elimination bracket with explicit winner/loser routing.
 *
 * Structure for N teams (N must be power of 2):
 *   Winners Bracket: WR1..WRk (k = log2(N) rounds)
 *   Losers Bracket:  LR1..LRm (m = 2*(k-1) rounds)
 *   Grand Final:     1 match
 *
 * Routing (winnerGoesTo / loserGoesTo) is stored on every match so that
 * BracketDisplay can propagate results without guessing array indices.
 *
 * LB round pattern (standard double-elimination):
 *   LR1: losers from WR1 play each other  (Phase A)
 *   LR2: LR1 winners vs losers from WR2   (Phase B — drop-in round)
 *   LR3: LR2 winners play each other      (Phase A)
 *   LR4: LR3 winners vs losers from WR3   (Phase B)
 *   ... until 1 LB survivor remains.
 */
export function generateSimplifiedDoubleEliminationBracket(
  teams: TeamInTournament[],
  forcedSize?: number,
): BracketGenerated {
  const padded = padWithByes(teams, forcedSize ? nextPowerOfTwo(forcedSize) : undefined);
  const teamCount = padded.length;

  // Build a flat match map first; wire routing afterwards.
  const matchMap: Record<string, BracketMatch> = {};

  const makeId = (section: string, r: number, i: number) => `${section}_${r}_${i}`;

  const addMatch = (m: BracketMatch) => { matchMap[m.id] = m; };

  const wRoundCount = Math.log2(teamCount); // e.g. 4 teams → 2, 8 teams → 3

  // ── Winners bracket ──────────────────────────────────────────────
  for (let wr = 0; wr < wRoundCount; wr++) {
    const count = teamCount / Math.pow(2, wr + 1);
    for (let i = 0; i < count; i++) {
      const id = makeId('w', wr, i);
      // Round 0: leave slots unassigned for manual team assignment
      const isR0 = wr === 0;
      addMatch({
        id,
        team1Id: isR0 ? `slot_${id}_1` : `slot_${id}_1`,
        team2Id: isR0 ? `slot_${id}_2` : `slot_${id}_2`,
        team1Name: isR0 ? 'Select Team' : 'Winner TBD',
        team2Name: isR0 ? 'Select Team' : 'Winner TBD',
        round: wr,
        position: i,
        bracketSection: 'winners',
        autoPopulated: wr > 0,
        needsAssignment: isR0,
      });
    }
  }

  // ── Losers bracket ───────────────────────────────────────────────
  // LB has 2*(wRoundCount - 1) rounds.
  // Phase A rounds: LB teams vs LB teams.
  // Phase B rounds: LB survivors vs new WB drop-ins.
  const lbRoundCount = 2 * (wRoundCount - 1);
  for (let lr = 0; lr < lbRoundCount; lr++) {
    const isPhaseA = lr % 2 === 0;
    // After phase A(lr=0): count = teamCount/4
    // Each phase A halves LB teams; phase B keeps the same count.
    const phaseAIndex = Math.floor(lr / 2);
    const count = teamCount / Math.pow(2, phaseAIndex + 2);
    for (let i = 0; i < count; i++) {
      const id = makeId('l', lr, i);
      addMatch({
        id,
        team1Id: `slot_${id}_1`,
        team2Id: `slot_${id}_2`,
        team1Name: 'LB TBD',
        team2Name: isPhaseA && lr === 0 ? 'LB TBD' : 'LB TBD',
        round: wRoundCount + lr,
        position: i,
        bracketSection: 'losers',
        autoPopulated: true,
      });
    }
  }

  // ── Grand Final ───────────────────────────────────────────────────
  addMatch({
    id: 'grand_final',
    team1Id: 'slot_gf_1',
    team2Id: 'slot_gf_2',
    team1Name: 'WB Champion',
    team2Name: 'LB Champion',
    round: wRoundCount + lbRoundCount,
    position: 0,
    bracketSection: 'grand-final',
    autoPopulated: true,
  });

  // ── Wire routing ─────────────────────────────────────────────────
  // Winners bracket: winner advances to next WB round, loser drops to LB.
  // The loser from WR(wr) match(i) feeds into LB based on standard DE seeding:
  //   WR1 losers → LR1 (Phase A)   — WR1 match i feeds LR1 matches in pairs
  //   WR2 losers → LR2 (Phase B)   — WR2 match i feeds LR2 match i (slot 2)
  //   WR3 losers → LR4 (Phase B)   — WR3 match i feeds LR4 match i (slot 2)
  //   WRk losers → LR(2k-2) (Phase B)

  for (let wr = 0; wr < wRoundCount; wr++) {
    const count = teamCount / Math.pow(2, wr + 1);
    for (let i = 0; i < count; i++) {
      const id = makeId('w', wr, i);
      const match = matchMap[id];

      // Winner goes to next WB round (or Grand Final if last WB round)
      if (wr < wRoundCount - 1) {
        const nextWBId = makeId('w', wr + 1, Math.floor(i / 2));
        match.winnerGoesTo = { matchId: nextWBId, slot: (i % 2 === 0 ? 1 : 2) };
      } else {
        // Last WB round winner → Grand Final slot 1
        match.winnerGoesTo = { matchId: 'grand_final', slot: 1 };
      }

      // Loser drops to LB:
      if (wr === 0) {
        // WR1 losers → LR1 (Phase A). Pairs: matches 0&1 → LR1 match 0, matches 2&3 → LR1 match 1, etc.
        const lbMatchIdx = Math.floor(i / 2);
        const lbSlot: 1 | 2 = (i % 2 === 0) ? 1 : 2;
        match.loserGoesTo = { matchId: makeId('l', 0, lbMatchIdx), slot: lbSlot };
      } else {
        // WR(wr) losers → LR(2*wr - 1) (Phase B), slot 2
        const lbRound = 2 * wr - 1;
        match.loserGoesTo = { matchId: makeId('l', lbRound, i), slot: 2 };
      }
    }
  }

  // Losers bracket: winner advances to next LB round (or Grand Final), loser is eliminated.
  for (let lr = 0; lr < lbRoundCount; lr++) {
    const phaseAIndex = Math.floor(lr / 2);
    const count = teamCount / Math.pow(2, phaseAIndex + 2);
    for (let i = 0; i < count; i++) {
      const id = makeId('l', lr, i);
      const match = matchMap[id];

      if (lr < lbRoundCount - 1) {
        if (lr % 2 === 0) {
          // Phase A: winner goes to next LB round (Phase B), same match index
          match.winnerGoesTo = { matchId: makeId('l', lr + 1, i), slot: 1 };
        } else {
          // Phase B: winner goes to next Phase A, pairing up
          const nextPhaseAIdx = Math.floor(i / 2);
          match.winnerGoesTo = { matchId: makeId('l', lr + 1, nextPhaseAIdx), slot: (i % 2 === 0 ? 1 : 2) };
        }
      } else {
        // Last LB round winner → Grand Final slot 2
        match.winnerGoesTo = { matchId: 'grand_final', slot: 2 };
      }
    }
  }

  // ── Assemble rounds array ─────────────────────────────────────────
  // Group matches by their `round` value.
  const maxRound = wRoundCount + lbRoundCount; // grand final round
  const rounds: BracketMatch[][] = [];
  for (let r = 0; r <= maxRound; r++) {
    const roundMatches = Object.values(matchMap)
      .filter(m => m.round === r)
      .sort((a, b) => a.position - b.position);
    if (roundMatches.length > 0) rounds.push(roundMatches);
  }

  return {
    rounds,
    bracketType: 'double',
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated double elimination bracket with ${teams.length} teams (${teamCount} slots)`,
      },
    ],
  };
}

/**
 * Generate a round robin bracket using the circle (polygon) scheduling algorithm.
 * Every team plays every other team exactly once.
 * Teams are auto-populated from the provided list — no manual slot assignment needed.
 *
 * For N teams: N-1 rounds (N even) or N rounds (N odd, one team gets a bye each round).
 * Each round has floor(N/2) matches.
 *
 * Standings are computed live in BracketDisplay from match results using:
 *   Primary sort:  W - L (match wins minus match losses)
 *   Tiebreaker:    round difference (total rounds won - total rounds lost across all matches)
 */
export function generateSimplifiedRoundRobinBracket(teams: TeamInTournament[]): BracketGenerated {
  const n = teams.length;
  // For odd count, add a dummy bye team
  const list = n % 2 === 0 ? [...teams] : [...teams, { id: 'bye', name: 'BYE', players: [] }];
  const total = list.length; // always even
  const numRounds = total - 1;
  const rounds: BracketMatch[][] = [];
  const rrTeams: RRTeamEntry[] = teams.map(t => ({ id: t.id, name: t.name }));

  // Circle algorithm: fix list[0], rotate the rest
  for (let round = 0; round < numRounds; round++) {
    const roundMatches: BracketMatch[] = [];
    for (let i = 0; i < total / 2; i++) {
      const home = list[i];
      const away = list[total - 1 - i];
      // Skip matches involving the bye team
      if (home.id === 'bye' || away.id === 'bye') continue;
      roundMatches.push({
        id: `rr_${round}_${i}`,
        team1Id: home.id,
        team2Id: away.id,
        team1Name: home.name,
        team2Name: away.name,
        round,
        position: i,
        bracketSection: undefined,
        autoPopulated: true,
      });
    }
    if (roundMatches.length > 0) rounds.push(roundMatches);

    // Rotate: keep list[0] fixed, rotate list[1..total-1]
    const last = list[total - 1];
    for (let j = total - 1; j > 1; j--) list[j] = list[j - 1];
    list[1] = last;
  }

  return {
    rounds,
    bracketType: 'roundrobin',
    rrTeams,
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated round robin bracket with ${n} teams`,
      },
    ],
  };
}

/**
 * Generate a single elimination bracket by randomly pairing teams (legacy)
 */
export function generateSingleEliminationBracket(teams: TeamInTournament[]): BracketGenerated {
  const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
  const rounds: BracketMatch[][] = [];
  let currentRound = 0;
  let roundTeams = [...shuffledTeams];

  while (roundTeams.length > 1) {
    const roundMatches: BracketMatch[] = [];

    for (let i = 0; i < roundTeams.length; i += 2) {
      if (i + 1 < roundTeams.length) {
        roundMatches.push({
          id: `match_${currentRound}_${i / 2}`,
          team1Id: roundTeams[i].id,
          team2Id: roundTeams[i + 1].id,
          team1Name: roundTeams[i].name,
          team2Name: roundTeams[i + 1].name,
          round: currentRound,
          position: i / 2,
        });
      }
    }

    rounds.push(roundMatches);
    roundTeams = Array(Math.ceil(roundTeams.length / 2))
      .fill(null)
      .map((_, i) => ({
        id: `winner_${currentRound}_${i}`,
        name: `Winner ${currentRound}-${i}`,
        players: [],
      }));

    currentRound++;
  }

  return {
    rounds,
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated single elimination bracket with ${teams.length} teams`,
      },
    ],
  };
}

/**
 * Generate a double elimination bracket
 */
export function generateDoubleEliminationBracket(
  teams: TeamInTournament[]
): BracketGenerated {
  const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
  const rounds: BracketMatch[][] = [];

  // Winners bracket (single elimination)
  let winnersRound = 0;
  let roundTeams = [...shuffledTeams];

  // Generate winners bracket
  while (roundTeams.length > 1) {
    const roundMatches: BracketMatch[] = [];

    for (let i = 0; i < roundTeams.length; i += 2) {
      if (i + 1 < roundTeams.length) {
        roundMatches.push({
          id: `winners_${winnersRound}_${i / 2}`,
          team1Id: roundTeams[i].id,
          team2Id: roundTeams[i + 1].id,
          team1Name: roundTeams[i].name,
          team2Name: roundTeams[i + 1].name,
          round: winnersRound,
          position: i / 2,
        });
      }
    }

    rounds.push(roundMatches);
    roundTeams = Array(Math.ceil(roundTeams.length / 2))
      .fill(null)
      .map((_, i) => ({
        id: `winners_${winnersRound}_${i}`,
        name: `Winners ${winnersRound}-${i}`,
        players: [],
      }));

    winnersRound++;
  }

  return {
    rounds,
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated double elimination bracket with ${teams.length} teams`,
      },
    ],
  };
}

/**
 * Generate round robin brackets (every team plays every other team once)
 */
export function generateRoundRobinBracket(
  teams: TeamInTournament[]
): BracketGenerated {
  const rounds: BracketMatch[][] = [];
  const n = teams.length;
  const isEven = n % 2 === 0;
  const numTeams = isEven ? n : n + 1;
  const numRounds = numTeams - 1;

  for (let round = 0; round < numRounds; round++) {
    const roundMatches: BracketMatch[] = [];
    const matchesInRound = isEven ? numTeams / 2 : (numTeams - 1) / 2;

    for (let i = 0; i < matchesInRound; i++) {
      const team1Index = (round + i) % (numTeams - 1);
      const team2Index = (numTeams - 1 - i + round) % (numTeams - 1);

      if (
        team1Index < teams.length &&
        team2Index < teams.length &&
        team1Index !== team2Index
      ) {
        roundMatches.push({
          id: `rr_${round}_${i}`,
          team1Id: teams[team1Index].id,
          team2Id: teams[team2Index].id,
          team1Name: teams[team1Index].name,
          team2Name: teams[team2Index].name,
          round,
          position: i,
        });
      }
    }

    if (roundMatches.length > 0) {
      rounds.push(roundMatches);
    }
  }

  return {
    rounds,
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated round robin bracket with ${teams.length} teams`,
      },
    ],
  };
}

/**
 * Swap two teams in a match
 */
export function swapTeamsInMatch(
  bracket: BracketGenerated,
  roundIndex: number,
  matchIndex: number,
  newTeam1Id: string,
  newTeam2Id: string,
  newTeam1Name: string,
  newTeam2Name: string
): BracketGenerated {
  const newBracket = JSON.parse(JSON.stringify(bracket));
  const match = newBracket.rounds[roundIndex]?.[matchIndex];

  if (!match) return bracket;

  const oldTeam1 = match.team1Name;
  const oldTeam2 = match.team2Name;

  match.team1Id = newTeam1Id;
  match.team2Id = newTeam2Id;
  match.team1Name = newTeam1Name;
  match.team2Name = newTeam2Name;

  newBracket.customizationHistory.push({
    timestamp: new Date().toISOString(),
    changes: `Swapped teams in round ${roundIndex + 1}, match ${matchIndex + 1}: ${oldTeam1} vs ${oldTeam2} → ${newTeam1Name} vs ${newTeam2Name}`,
  });

  return newBracket;
}

/**
 * Swap opponent for a single team in a match
 */
export function changeTeamOpponent(
  bracket: BracketGenerated,
  roundIndex: number,
  matchIndex: number,
  isTeam1: boolean,
  newTeamId: string,
  newTeamName: string
): BracketGenerated {
  const newBracket = JSON.parse(JSON.stringify(bracket));
  const match = newBracket.rounds[roundIndex]?.[matchIndex];

  if (!match) return bracket;

  const oldTeamName = isTeam1 ? match.team1Name : match.team2Name;

  if (isTeam1) {
    match.team1Id = newTeamId;
    match.team1Name = newTeamName;
  } else {
    match.team2Id = newTeamId;
    match.team2Name = newTeamName;
  }

  newBracket.customizationHistory.push({
    timestamp: new Date().toISOString(),
    changes: `Changed ${isTeam1 ? 'first' : 'second'} team in round ${roundIndex + 1}, match ${matchIndex + 1}: ${oldTeamName} → ${newTeamName}`,
  });

  return newBracket;
}

/**
 * Get bracket statistics
 */
export function getBracketStats(bracket: BracketGenerated) {
  let totalMatches = 0;
  let completedMatches = 0;

  bracket.rounds.forEach((round) => {
    round.forEach((match) => {
      totalMatches++;
      if (match.winner) completedMatches++;
    });
  });

  return {
    totalMatches,
    completedMatches,
    progress: Math.round((completedMatches / totalMatches) * 100),
    totalRounds: bracket.rounds.length,
  };
}
