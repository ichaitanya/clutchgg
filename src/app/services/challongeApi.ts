// Challonge API Service
// Documentation: https://api.challonge.com/v2.1

const API_BASE = 'https://api.challonge.com/v2.1';

// These credentials should be moved to environment variables in production
const API_KEY = '7eb30334967856353356f5bef299f68176c9432a0ddf45f3';

interface ChallongeTournament {
  id: string;
  name: string;
  url: string;
  tournament_type: string;
  state: string;
}

interface ChallongeParticipant {
  id: string;
  name: string;
  email: string;
  seed?: number;
}

const headers = {
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/json',
  'Authorization-Type': 'v1',
  'Authorization': API_KEY,
};

/**
 * Create a new tournament on Challonge
 */
export async function createChallongeTournament(
  tournamentName: string,
  tournamentType: 'single elimination' | 'double elimination' | 'round robin' | 'swiss' = 'single elimination'
): Promise<ChallongeTournament> {
  try {
    const uniqueUrl = `${tournamentName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    const response = await fetch(`${API_BASE}/tournaments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tournament: {
          name: tournamentName,
          url: uniqueUrl,
          tournament_type: tournamentType,
          description: 'Tournament created from Clutchgg Admin Panel',
          open_signup: false,
          hold_third_place_match: false,
          pts_for_match_win: 1,
          pts_for_match_tie: 0,
          pts_for_game_win: 0,
          pts_for_game_tie: 0,
          pts_for_game_loss: 0,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create tournament: ${error.errors?.[0]?.detail || response.statusText}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error creating Challonge tournament:', error);
    throw error;
  }
}

/**
 * Add a single participant to a tournament
 */
export async function addParticipant(
  tournamentId: string,
  teamName: string,
  seedNumber?: number
): Promise<ChallongeParticipant> {
  try {
    const response = await fetch(
      `${API_BASE}/tournaments/${tournamentId}/participants`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          participant: {
            name: teamName,
            email: `${teamName.replace(/\s+/g, '')}${Date.now()}@clutchgg.local`,
            seed: seedNumber,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to add participant: ${error.errors?.[0]?.detail || response.statusText}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error adding participant:', error);
    throw error;
  }
}

/**
 * Add multiple participants in bulk
 */
export async function bulkAddParticipants(
  tournamentId: string,
  teams: string[]
): Promise<ChallongeParticipant[]> {
  try {
    const participants = teams.map((team, index) => ({
      name: team,
      email: `${team.replace(/\s+/g, '')}${Date.now()}_${index}@clutchgg.local`,
    }));

    const response = await fetch(
      `${API_BASE}/tournaments/${tournamentId}/participants/bulk`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          participants,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to add participants: ${error.errors?.[0]?.detail || response.statusText}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error bulk adding participants:', error);
    throw error;
  }
}

/**
 * Start a tournament (move it to underway state)
 */
export async function startTournament(tournamentId: string): Promise<ChallongeTournament> {
  try {
    const response = await fetch(
      `${API_BASE}/tournaments/${tournamentId}/start`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to start tournament: ${error.errors?.[0]?.detail || response.statusText}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error starting tournament:', error);
    throw error;
  }
}

/**
 * Get tournament bracket URL
 */
export function getBracketUrl(tournamentUrl: string): string {
  return `https://challonge.com/${tournamentUrl}`;
}

/**
 * Get tournament matches
 */
export async function getTournamentMatches(tournamentId: string) {
  try {
    const response = await fetch(
      `${API_BASE}/tournaments/${tournamentId}/matches`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch matches: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error fetching matches:', error);
    throw error;
  }
}

/**
 * Create a full tournament with teams and start it
 */
export async function createFullTournament(
  tournamentName: string,
  teams: string[],
  tournamentType: 'single elimination' | 'double elimination' | 'round robin' | 'swiss' = 'single elimination'
) {
  try {
    // Step 1: Create tournament
    console.log('Creating Challonge tournament...');
    const tournament = await createChallongeTournament(tournamentName, tournamentType);
    console.log('Tournament created:', tournament);

    // Step 2: Add teams as participants
    console.log('Adding participants...');
    await bulkAddParticipants(tournament.id, teams);
    console.log('Participants added');

    // Step 3: Start tournament
    console.log('Starting tournament...');
    const startedTournament = await startTournament(tournament.id);
    console.log('Tournament started:', startedTournament);

    // Return bracket info
    return {
      tournamentId: tournament.id,
      tournamentUrl: tournament.url,
      bracketUrl: getBracketUrl(tournament.url),
      name: tournament.name,
      state: startedTournament.state,
    };
  } catch (error) {
    console.error('Error creating full tournament:', error);
    throw error;
  }
}
