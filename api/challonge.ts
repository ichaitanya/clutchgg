const API_BASE = 'https://api.challonge.com/v2.1';
const API_KEY = '7eb30334967856353356f5bef299f68176c9432a0ddf45f3';

const headers = {
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/json',
  'Authorization-Type': 'v1',
  'Authorization': API_KEY,
};

export default async function handler(req: any, res: any) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action, tournamentId, ...bodyData } = req.body || {};
  const method = req.method || 'GET';

  try {
    let url = API_BASE;
    let fetchOptions: RequestInit = {
      method,
      headers,
    };

    // Route to appropriate endpoint
    if (action === 'create_tournament') {
      url = `${API_BASE}/tournaments`;
      fetchOptions.body = JSON.stringify({ tournament: bodyData });
    } else if (action === 'add_participant') {
      url = `${API_BASE}/tournaments/${tournamentId}/participants`;
      fetchOptions.body = JSON.stringify({ participant: bodyData });
    } else if (action === 'bulk_add_participants') {
      url = `${API_BASE}/tournaments/${tournamentId}/participants/bulk`;
      fetchOptions.body = JSON.stringify({ participants: bodyData.participants });
    } else if (action === 'start_tournament') {
      url = `${API_BASE}/tournaments/${tournamentId}/start`;
      fetchOptions.body = JSON.stringify({});
    } else if (action === 'get_matches') {
      url = `${API_BASE}/tournaments/${tournamentId}/matches`;
      fetchOptions.method = 'GET';
    } else if (action === 'get_tournament') {
      url = `${API_BASE}/tournaments/${tournamentId}`;
      fetchOptions.method = 'GET';
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    console.log(`Proxying ${method} request to Challonge: ${url}`);

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      console.error('Challonge API error:', data);
      return res.status(response.status).json({
        error: data.errors?.[0]?.detail || 'Challonge API error',
        details: data,
      });
    }

    res.status(200).json(data);
  } catch (error: any) {
    console.error('Proxy error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
