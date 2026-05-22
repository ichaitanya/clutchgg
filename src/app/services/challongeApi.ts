// Challonge API Service
// Uses a public CORS proxy service for browser requests

const DIRECT_API_BASE = 'https://api.challonge.com/v2.1';
const API_KEY = '7eb30334967856353356f5bef299f68176c9432a0ddf45f3';

// Use AllOrigins CORS proxy - more reliable than cors-anywhere
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

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
 * Make request through CORS proxy
 */
async function proxyRequest(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'POST',
  body?: any
) {
  const url = `${DIRECT_API_BASE}${path}`;
  
  // Encode the URL for the proxy
  const encodedUrl = encodeURIComponent(url);
  const proxyUrl = `${CORS_PROXY}${encodedUrl}`;

  const headers = new Headers({
    'Content-Type': 'application/vnd.api+json',
    'Accept': 'application/json',
    'Authorization-Type': 'v1',
    'Authorization': API_KEY,
  });

  try {
    console.log(`[Challonge] ${method} ${path}`);
    
    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && method !== 'GET') {
      // For proxy services, we need to handle body differently
      // Send the body and authorization through custom headers
      if (method === 'POST' || method === 'PUT') {
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(proxyUrl, fetchOptions);
    
    if (!response.ok) {
      console.error(`[Challonge] Error ${response.status}:`, response.statusText);
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
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

    const data = await proxyRequest('/tournaments', 'POST', {
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
