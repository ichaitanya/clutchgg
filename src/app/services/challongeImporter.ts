// Challonge Bracket Importer
// Maps Challonge v1 match structure into native BracketGenerated format
// Inverts prerequisite pointers to build winnerGoesTo/loserGoesTo routing

import type { BracketGenerated, BracketMatch, TeamInTournament } from '../components/TournamentCreation';
import * as ChallongeAPI from './challongeApiDirect';

interface ChallongeMatch {
  id: number;
  round: number;
  identifier: string;
  player1_id: number | null;
  player2_id: number | null;
  player1_prereq_match_id: number | null;
  player2_prereq_match_id: number | null;
  player1_is_prereq_match_loser: boolean;
  player2_is_prereq_match_loser: boolean;
  winner_id: number | null;
  loser_id: number | null;
  suggested_play_order: number;
  scores_csv: string;
}

interface ChallongeParticipant {
  id: number;
  name: string;
  seed: number;
}

function mapChallongeToNative(
  challongeMatches: any[],
  participants: any[],
  teams: TeamInTournament[]
): BracketGenerated {
  // Build lookup tables
  const participantMap = new Map<number, { name: string; seed: number }>();
  participants.forEach((p: any) => {
    const attrs = p.attributes || p;
    participantMap.set(Number(p.id), {
      name: attrs.name,
      seed: attrs.seed || 0,
    });
  });

  // Map team names to team objects for linking
  const teamByName = new Map<string, TeamInTournament>();
  teams.forEach((t) => {
    teamByName.set(t.name.toLowerCase(), t);
  });

  // Convert Challonge matches to native format
  const matchesById = new Map<number, BracketMatch>();
  const allMatches: BracketMatch[] = [];

  // First pass: create all match objects
  for (const cmatch of challongeMatches) {
    const id = Number(cmatch.id);
    const round = Number(cmatch.round);
    const section = round > 0 ? 'winners' : round < 0 ? 'losers' : 'grand-final';

    // Determine team slots from participant IDs or prerequisites
    const participant1 = cmatch.player1_id ? participantMap.get(cmatch.player1_id) : null;
    const participant2 = cmatch.player2_id ? participantMap.get(cmatch.player2_id) : null;

    const team1Name = participant1?.name || null;
    const team2Name = participant2?.name || null;

    const team1 = team1Name ? teamByName.get(team1Name.toLowerCase()) : null;
    const team2 = team2Name ? teamByName.get(team2Name.toLowerCase()) : null;

    const match: BracketMatch = {
      id: String(id),
      team1Name: team1Name || 'BYE',
      team1Id: team1?.id || null,
      team2Name: team2Name || 'BYE',
      team2Id: team2?.id || null,
      winnerGoesTo: null,
      loserGoesTo: null,
      section: section,
      round: Math.abs(round),
      order: cmatch.suggested_play_order || 0,
      winnerName: null,
      loserId: null,
      status: cmatch.winner_id ? 'completed' : 'pending',
      scores: cmatch.scores_csv ? cmatch.scores_csv.split('-').map((s: string) => parseInt(s.trim())) : null,
    };

    matchesById.set(id, match);
    allMatches.push(match);
  }

  // Second pass: build routing from inverted prerequisites
  for (const cmatch of challongeMatches) {
    const id = Number(cmatch.id);
    const match = matchesById.get(id)!;

    // Find what matches feed into this match
    const incomingMatches: Array<{
      sourceId: number;
      isLoser: boolean;
      slot: 'winner' | 'loser';
    }> = [];

    // Check which matches have this match as a prerequisite
    for (const other of challongeMatches) {
      const otherId = Number(other.id);

      // Does other's player1 slot come from this match?
      if (Number(other.player1_prereq_match_id) === id) {
        incomingMatches.push({
          sourceId: otherId,
          isLoser: other.player1_is_prereq_match_loser,
          slot: 'winner', // this determines if it's winner or loser who goes here
        });
      }

      // Does other's player2 slot come from this match?
      if (Number(other.player2_prereq_match_id) === id) {
        incomingMatches.push({
          sourceId: otherId,
          isLoser: other.player2_is_prereq_match_loser,
          slot: 'loser',
        });
      }
    }

    // Assign routing based on incoming links
    // winnerGoesTo = where the match winner advances
    // loserGoesTo = where the match loser advances
    for (const incoming of incomingMatches) {
      if (incoming.isLoser) {
        // Loser advances to the incoming match
        match.loserGoesTo = String(incoming.sourceId);
      } else {
        // Winner advances to the incoming match
        match.winnerGoesTo = String(incoming.sourceId);
      }
    }
  }

  // Organize by section
  const sections: { [key: string]: BracketMatch[] } = {
    winners: [],
    losers: [],
    'grand-final': [],
  };

  allMatches.forEach((m) => {
    sections[m.section].push(m);
  });

  // Sort within each section by round and order
  Object.values(sections).forEach((sectionMatches) => {
    sectionMatches.sort((a, b) => a.round - b.round || (a.order || 0) - (b.order || 0));
  });

  return {
    matches: allMatches,
    sections: sections as any,
  };
}

export async function importChallongeBracket(
  tournamentName: string,
  teams: TeamInTournament[],
  tournamentType: 'single' | 'double' = 'double'
): Promise<{ bracket: BracketGenerated; challongeId: string; challongeUrl: string }> {
  try {
    console.log(`[Importer] Creating Challonge tournament: ${tournamentName}`);

    // Create and start the tournament via API
    const result = await ChallongeAPI.createFullTournament(tournamentName, teams, tournamentType);
    const tournamentId = result.tournamentId;

    console.log(`[Importer] Tournament created: ${tournamentId}`);

    // Fetch the generated matches and participants
    console.log(`[Importer] Fetching bracket structure...`);

    // Get matches via v1 API (for full routing info)
    const matchesResponse = await fetch(
      `/api/challonge?path=${encodeURIComponent(`/tournaments/${tournamentId}/matches.json`)}`
    );
    if (!matchesResponse.ok) throw new Error('Failed to fetch matches');
    const matchesData = await matchesResponse.json();

    // Get participants
    const partsResponse = await fetch(
      `/api/challonge?path=${encodeURIComponent(`/tournaments/${tournamentId}/participants.json`)}`
    );
    if (!partsResponse.ok) throw new Error('Failed to fetch participants');
    const partsData = await partsResponse.json();

    // Extract v1 format from v2.1 response (v2.1 wraps in .data, v1 is raw array in .match field)
    const matches = matchesData.data
      ? matchesData.data.map((m: any) => m.attributes)
      : matchesData.map((item: any) => item.match);

    const participants = partsData.data
      ? partsData.data
      : partsData.map((item: any) => item.participant);

    // Map to native format
    const bracket = mapChallongeToNative(matches, participants, teams);

    console.log(`[Importer] Bracket imported successfully`);
    console.log(`[Importer] Total matches: ${bracket.matches.length}`);

    return {
      bracket,
      challongeId: tournamentId,
      challongeUrl: result.tournamentUrl,
    };
  } catch (error) {
    console.error('[Importer] Error importing bracket:', error);
    throw error;
  }
}
