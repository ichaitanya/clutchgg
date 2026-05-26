// ── Bracket Generation Utilities ─────────────────────────────────────────────

import type { BracketMatch, BracketGenerated, TeamInTournament } from '../components/TournamentCreation';

/**
 * Generate a simplified single elimination bracket with empty team slots
 */
export function generateSimplifiedSingleEliminationBracket(teamCount: number): BracketGenerated {
  const rounds: BracketMatch[][] = [];
  let currentRound = 0;
  let teamsInRound = teamCount;

  while (teamsInRound > 1) {
    const roundMatches: BracketMatch[] = [];
    const matchesInRound = teamsInRound / 2;

    for (let i = 0; i < matchesInRound; i++) {
      roundMatches.push({
        id: `match_${currentRound}_${i}`,
        team1Id: `slot_${currentRound}_${i}_1`,
        team2Id: `slot_${currentRound}_${i}_2`,
        team1Name: `Team Slot ${currentRound * matchesInRound + i + 1}`,
        team2Name: `Team Slot ${currentRound * matchesInRound + i + 2}`,
        round: currentRound,
        position: i,
      });
    }

    rounds.push(roundMatches);
    teamsInRound = matchesInRound;
    currentRound++;
  }

  return {
    rounds,
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated single elimination bracket with ${teamCount} team slots`,
      },
    ],
  };
}

/**
 * Generate a simplified double elimination bracket with empty team slots
 */
export function generateSimplifiedDoubleEliminationBracket(teamCount: number): BracketGenerated {
  const rounds: BracketMatch[][] = [];

  // Winners bracket
  let winnersRound = 0;
  let teamsInRound = teamCount;

  while (teamsInRound > 1) {
    const roundMatches: BracketMatch[] = [];
    const matchesInRound = teamsInRound / 2;

    for (let i = 0; i < matchesInRound; i++) {
      roundMatches.push({
        id: `winners_${winnersRound}_${i}`,
        team1Id: `slot_winners_${winnersRound}_${i}_1`,
        team2Id: `slot_winners_${winnersRound}_${i}_2`,
        team1Name: `Team Slot ${winnersRound * matchesInRound + i + 1}`,
        team2Name: `Team Slot ${winnersRound * matchesInRound + i + 2}`,
        round: winnersRound,
        position: i,
      });
    }

    rounds.push(roundMatches);
    teamsInRound = matchesInRound;
    winnersRound++;
  }

  return {
    rounds,
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated double elimination bracket with ${teamCount} team slots`,
      },
    ],
  };
}

/**
 * Generate a simplified round robin bracket with empty team slots
 */
export function generateSimplifiedRoundRobinBracket(teamCount: number): BracketGenerated {
  const rounds: BracketMatch[][] = [];
  const matches: Array<[number, number]> = [];

  // Generate all possible matchups
  for (let i = 0; i < teamCount; i++) {
    for (let j = i + 1; j < teamCount; j++) {
      matches.push([i, j]);
    }
  }

  // Distribute matches across rounds (approximately equal per round)
  const matchesPerRound = Math.ceil(matches.length / (teamCount - 1));
  let matchIndex = 0;

  for (let roundNum = 0; roundNum < teamCount - 1 && matchIndex < matches.length; roundNum++) {
    const roundMatches: BracketMatch[] = [];

    for (let i = 0; i < matchesPerRound && matchIndex < matches.length; i++) {
      const [team1Idx, team2Idx] = matches[matchIndex];
      roundMatches.push({
        id: `rr_${roundNum}_${i}`,
        team1Id: `slot_team_${team1Idx}`,
        team2Id: `slot_team_${team2Idx}`,
        team1Name: `Team Slot ${team1Idx + 1}`,
        team2Name: `Team Slot ${team2Idx + 1}`,
        round: roundNum,
        position: i,
      });
      matchIndex++;
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
        changes: `Generated round robin bracket with ${teamCount} team slots`,
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
