// Challonge API Service
// Uses backend API route to avoid CORS issues

const BACKEND_API = '/api/challonge';

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

/**
 * Test if API key is valid
 */
export async function testApiKey(): Promise<{ valid: boolean; message: string }> {
  try {
    const response = await fetch('/api/challonge?healthCheck=true');
    const data = await response.json();
    
    if (data.valid) {
      return { valid: true, message: '✓ API key is valid!' };
    } else {
      return { valid: false, message: `❌ API Error: ${data.reason}` };
    }
  } catch (error: any) {
    return { valid: false, message: `❌ Connection Error: ${error.message}` };
  }
}

/**
 * Make request through backend API
 */
async function proxyRequest(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'POST',
  body?: any
) {
  try {
    console.log(`[Challonge] ${method} ${path}`);
    
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    
    // Build the backend URL with path as query parameter
    const apiUrl = `/api/challonge?path=${encodeURIComponent(normalizedPath)}`;
    console.log(`[Challonge] Calling backend: ${apiUrl}`);

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/json',
      },
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      fetchOptions.body = JSON.stringify(body);
      console.log(`[Challonge] Request body:`, body);
    }

    const response = await fetch(apiUrl, fetchOptions);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessage = data?.error || data?.message || `API Error: ${response.status} ${response.statusText}`;
      console.error(`[Challonge] Error ${response.status}:`, data);
      throw new Error(errorMessage);
    }

    console.log(`[Challonge] Response:`, data);
    return data;
  } catch (error) {
    console.error('[Challonge] Request failed:', error);
    throw error;
  }
}

/**
 * Create a new tournament on Challonge
 */
export async function createChallongeTournament(
  tournamentName: string,
  tournamentType: 'single elimination' | 'double elimination' | 'round robin' | 'swiss' = 'single elimination'
): Promise<ChallongeTournament> {
  try {
    const uniqueUrl = `${tournamentName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    // Convert tournament type to Challonge format (spaces to underscores)
    const challongeType = tournamentType.replace(/\s+/g, '_');
    
    console.log(`[Challonge] Creating tournament with type: ${challongeType}`);

    const data = await proxyRequest('/tournaments', 'POST', {
      tournament: {
        name: tournamentName,
        url: uniqueUrl,
        tournament_type: challongeType,
        description: 'Tournament created from Clutchgg Admin Panel',
        open_signup: false,
        hold_third_place_match: false,
        pts_for_match_win: 1,
        pts_for_match_tie: 0,
        pts_for_game_win: 0,
        pts_for_game_tie: 0,
        pts_for_game_loss: 0,
      },
    });

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
    const data = await proxyRequest(
      `/tournaments/${tournamentId}/participants`,
      'POST',
      {
        participant: {
          name: teamName,
          email: `${teamName.replace(/\s+/g, '')}${Date.now()}@clutchgg.local`,
          seed: seedNumber,
        },
      }
    );

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

    const data = await proxyRequest(
      `/tournaments/${tournamentId}/participants/bulk`,
      'POST',
      { participants }
    );

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
    const data = await proxyRequest(
      `/tournaments/${tournamentId}/start`,
      'POST',
      {}
    );

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
    const data = await proxyRequest(
      `/tournaments/${tournamentId}/matches`,
      'GET'
    );

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
