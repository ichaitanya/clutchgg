const API_BASE = 'https://api.challonge.com/v2.1';
const API_KEY = '7eb30334967856353356f5bef299f68176c9432a0ddf45f3';

const headers = {
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/json',
  'Authorization-Type': 'v1',
  'Authorization': API_KEY,
};

export default async function handler(req: any, res: any) {
  // Enable CORS for all origins
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT,HEAD');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Extract the path from query
  const { path = '/' } = req.query;
  const fullPath = Array.isArray(path) ? '/' + path.join('/') : path;
  const url = `${API_BASE}${fullPath}`;
  
  const method = req.method || 'GET';

  try {
    console.log(`[Challonge Proxy] ${method} ${url}`);

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (req.body && (method === 'POST' || method === 'PUT')) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      console.error(`[Challonge Proxy] Error: ${response.status}`, data);
      return res.status(response.status).json({
        error: data.errors?.[0]?.detail || 'Challonge API error',
        status: response.status,
      });
    }

    res.status(200).json(data);
  } catch (error: any) {
    console.error('[Challonge Proxy] Exception:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
