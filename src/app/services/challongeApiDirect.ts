// Challonge API Service - proxied through backend for security
// All requests go through /api/challonge (never exposes API key to frontend)

const PROXY_BASE = '/api/challonge';

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
  seed?: number;
}

async function proxyRequest(path: string, method: string = 'GET', body?: any) {
  const url = new URL(PROXY_BASE, window.location.origin);
  url.searchParams.set('path', path);

  const options: RequestInit = {
    method,
    headers: {
      'Accept': 'application/json',
    },
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    // Use application/json so Vercel auto-parses req.body on the proxy.
    // The proxy re-sends to Challonge with the correct vnd.api+json content-type.
    options.headers = { ...options.headers, 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `API error: ${response.status}`);
  }

  return response.json();
}

export async function createChallongeTournament(
  tournamentName: string,
  tournamentType: string = 'double elimination'
): Promise<ChallongeTournament> {
  const body = {
    data: {
      type: 'tournament',
      attributes: {
        name: tournamentName,
        tournament_type: tournamentType,
        private: false,
      },
    },
  };

  const result = await proxyRequest('/tournaments.json', 'POST', body);
  return {
    id: result.data.id,
    name: result.data.attributes.name,
    url: result.data.attributes.url,
    tournament_type: result.data.attributes.tournament_type,
    state: result.data.attributes.state,
  };
}

export async function bulkAddParticipants(
  tournamentId: string,
  teams: Array<{ id: string; name: string }>
): Promise<ChallongeParticipant[]> {
  const participants = teams.map((team, index) => ({
    name: team.name,
    seed: index + 1,
  }));

  const body = {
    data: {
      type: 'Participants',
      attributes: {
        participants,
      },
    },
  };

  const result = await proxyRequest(`/tournaments/${tournamentId}/participants/bulk_add.json`, 'POST', body);

  return result.data.map((p: any) => ({
    id: p.id,
    name: p.attributes.name,
    seed: p.attributes.seed,
  }));
}

export async function startTournament(tournamentId: string): Promise<void> {
  const body = {
    data: {
      type: 'TournamentState',
      attributes: {
        state: 'start',
      },
    },
  };

  await proxyRequest(`/tournaments/${tournamentId}/change_state.json`, 'PUT', body);
}

export async function getTournamentMatches(tournamentId: string): Promise<any[]> {
  // Use v1 API for detailed match routing info (prereq fields)
  const response = await fetch(
    `/api/challonge?path=${encodeURIComponent(`/v1/tournaments/${tournamentId}/matches.json`)}`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch matches');
  }

  const data = await response.json();
  // v1 returns a raw array of { match: {...} }
  return Array.isArray(data) ? data.map((x: any) => x.match) : data.data || [];
}

export async function createFullTournament(
  tournamentName: string,
  teams: Array<{ id: string; name: string }>,
  tournamentType: string = 'double elimination'
): Promise<{ tournamentId: string; tournamentUrl: string; bracketUrl: string; name: string; state: string }> {
  try {
    const tournament = await createChallongeTournament(tournamentName, tournamentType);
    console.log('[Challonge] Created tournament:', tournament.id);

    await bulkAddParticipants(tournament.id, teams);
    console.log('[Challonge] Added participants');

    await startTournament(tournament.id);
    console.log('[Challonge] Started tournament');

    return {
      tournamentId: tournament.id,
      tournamentUrl: `https://challonge.com/${tournament.url}`,
      bracketUrl: `https://challonge.com/${tournament.url}`,
      name: tournament.name,
      state: tournament.state,
    };
  } catch (error) {
    console.error('[Challonge] Error creating tournament:', error);
    throw error;
  }
}
