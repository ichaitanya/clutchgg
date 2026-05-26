// Direct Challonge API Service - Works in both development and production
// Uses Challonge API directly from frontend

const API_BASE = 'https://api.challonge.com/v2.1';

// ⚠️ WARNING: This API key is exposed in frontend code
// For production, move this to backend environment variables
const API_KEY = 'd716a14287e44fcb38ef819c2fae046dd2225fc1a410abad';

const headers = {
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/json',
  'Authorization-Type': 'v1',
  'Authorization': API_KEY,
};

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
    console.log('Testing Challonge API key...');
    const response = await fetch(`${API_BASE}/tournaments?state=all&limit=1`, {
      method: 'GET',
      headers,
    });

    console.log(`API test response: ${response.status}`);

    if (response.status === 401 || response.status === 403) {
      return { 
        valid: false, 
        message: 'Invalid API key (401). Please update API_KEY in challongeApiDirect.ts' 
      };
    }

    if (response.ok) {
      return { valid: true, message: '✓ API key is valid!' };
    }

    const data = await response.json().catch(() => ({}));
    return { 
      valid: false, 
      message: `API returned ${response.status}: ${data?.errors?.[0]?.detail || 'Unknown error'}` 
    };
  } catch (error: any) {
    return { 
      valid: false, 
      message: `Connection error: ${error.message}` 
    };
  }
}

/**
 * Make request to Challonge API
 */
async function makeRequest(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: any
) {
  try {
    console.log(`[Challonge] ${method} ${path}`);

    const fullUrl = `${API_BASE}${path}`;
    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
      console.log(`[Challonge] Body:`, body);
    }

    const response = await fetch(fullUrl, options);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = data?.errors?.[0]?.detail || data?.error || `HTTP ${response.status}`;
      console.error(`[Challonge] Error: ${error}`, data);
      throw new Error(error);
    }

    console.log(`[Challonge] Success:`, data);
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
  const uniqueUrl = `${tournamentName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
  const challongeType = tournamentType.replace(/\s+/g, '_');

  console.log(`Creating tournament: ${tournamentName} (${challongeType})`);

  const data = await makeRequest('/tournaments', 'POST', {
    tournament: {
      name: tournamentName,
      url: uniqueUrl,
      tournament_type: challongeType,
      description: 'Tournament created from Clutchgg',
      open_signup: false,
      hold_third_place_match: false,
    },
  });

  return data.data;
}

/**
 * Add a single participant to a tournament
 */
export async function addParticipant(
  tournamentId: string,
  teamName: string,
  seedNumber?: number
): Promise<ChallongeParticipant> {
  const data = await makeRequest(
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
}

/**
 * Add multiple participants in bulk
 */
export async function bulkAddParticipants(
  tournamentId: string,
  teams: string[]
): Promise<ChallongeParticipant[]> {
  const participants = teams.map((team, index) => ({
    name: team,
    email: `${team.replace(/\s+/g, '')}${Date.now()}_${index}@clutchgg.local`,
  }));

  const data = await makeRequest(
    `/tournaments/${tournamentId}/participants/bulk`,
    'POST',
    { participants }
  );

  return data.data;
}

/**
 * Start a tournament
 */
export async function startTournament(tournamentId: string): Promise<ChallongeTournament> {
  const data = await makeRequest(
    `/tournaments/${tournamentId}/start`,
    'POST',
    {}
  );

  return data.data;
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
  const data = await makeRequest(
    `/tournaments/${tournamentId}/matches`,
    'GET'
  );

  return data.data;
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
    console.log('Step 1: Creating Challonge tournament...');
    const tournament = await createChallongeTournament(tournamentName, tournamentType);
    console.log('Tournament created:', tournament);

    // Step 2: Add teams as participants
    console.log('Step 2: Adding participants...');
    await bulkAddParticipants(tournament.id, teams);
    console.log('Participants added');

    // Step 3: Start tournament
    console.log('Step 3: Starting tournament...');
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
