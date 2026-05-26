const API_BASE = 'https://api.challonge.com/v2.1';
const API_KEY = 'c43776f9eee466bc9b150a16075beb0f5cd32ad4c0b05260';

const headers = {
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/json',
  'Authorization-Type': 'v1',
  'Authorization': API_KEY,
};

// Health check endpoint to verify API key
async function checkApiHealth() {
  try {
    console.log(`\n[API Health Check] Testing Challonge API key...`);
    const response = await fetch(`${API_BASE}/tournaments?state=all`, {
      method: 'GET',
      headers,
    });
    
    console.log(`[API Health Check] Response status: ${response.status}`);
    
    if (response.status === 401 || response.status === 403) {
      console.error(`[API Health Check] ❌ Authentication failed! API key is invalid.`);
      return { valid: false, reason: 'Invalid API key (401/403)' };
    }
    
    if (response.ok) {
      console.log(`[API Health Check] ✓ API key is valid!`);
      return { valid: true };
    }
    
    const data = await response.json().catch(() => ({}));
    console.error(`[API Health Check] ❌ API returned ${response.status}:`, data);
    return { valid: false, reason: `API returned ${response.status}`, details: data };
  } catch (error: any) {
    console.error(`[API Health Check] ❌ Exception:`, error.message);
    return { valid: false, reason: error.message };
  }
}

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

  // Handle health check
  if (req.query.healthCheck === 'true' || req.path?.includes('health')) {
    console.log(`\n========== HEALTH CHECK ==========`);
    const health = await checkApiHealth();
    return res.status(health.valid ? 200 : 401).json(health);
  }

  console.log(`\n========== CHALLONGE PROXY REQUEST ==========`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Method: ${req.method}`);
  console.log(`Query params:`, req.query);

  // Extract the path from query
  let { path = '/' } = req.query;
  
  // Handle array if multiple values passed
  if (Array.isArray(path)) {
    path = path[0];
  }
  
  // Ensure path starts with /
  let fullPath = path as string;
  if (!fullPath.startsWith('/')) {
    fullPath = '/' + fullPath;
  }
  
  const url = `${API_BASE}${fullPath}`;
  const method = req.method || 'GET';

  console.log(`Path parameter: "${path}"`);
  console.log(`Full path: "${fullPath}"`);
  console.log(`Full URL: ${url}`);
  console.log(`Headers being sent:`, {
    'Content-Type': headers['Content-Type'],
    'Accept': headers['Accept'],
    'Authorization': headers['Authorization'].substring(0, 20) + '...',
  });

  if (req.body) {
    console.log(`Request body:`, JSON.stringify(req.body, null, 2));
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (req.body && (method === 'POST' || method === 'PUT')) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    // Try with header-based authentication first
    console.log(`Making fetch request to: ${url}`);
    let response = await fetch(url, fetchOptions);
    
    // If 401/403, try with query parameter authentication
    if ((response.status === 401 || response.status === 403) && !url.includes('api_key=')) {
      console.log(`Got ${response.status}, trying with query parameter auth...`);
      const separator = url.includes('?') ? '&' : '?';
      const urlWithKey = `${url}${separator}api_key=${encodeURIComponent(API_KEY)}`;
      
      const optionsWithoutAuth = { ...fetchOptions };
      delete (optionsWithoutAuth.headers as any)['Authorization'];
      delete (optionsWithoutAuth.headers as any)['Authorization-Type'];
      
      console.log(`Retrying with URL: ${urlWithKey.substring(0, 100)}...`);
      response = await fetch(urlWithKey, optionsWithoutAuth);
    }
    
    console.log(`Response status: ${response.status}`);
    console.log(`Response headers:`, {
      'content-type': response.headers.get('content-type'),
      'x-total': response.headers.get('x-total'),
    });

    let data;
    try {
      data = await response.json();
      console.log(`Response body:`, JSON.stringify(data, null, 2));
    } catch (e) {
      console.log(`Failed to parse response as JSON:`, e);
      data = { error: 'Could not parse response' };
    }

    if (!response.ok) {
      console.error(`[Challonge Proxy] API Error: ${response.status}`);
      console.error(`Error details:`, data);
      
      // Extract detailed error message from Challonge response
      let errorDetail = 'Challonge API error';
      if (data?.errors?.[0]?.detail) {
        errorDetail = data.errors[0].detail;
      } else if (data?.error) {
        errorDetail = data.error;
      } else if (data?.message) {
        errorDetail = data.message;
      }
      
      return res.status(response.status).json({
        error: errorDetail,
        status: response.status,
        debugInfo: {
          requestUrl: url,
          requestMethod: method,
          apiKeyValid: API_KEY ? 'Set (possibly invalid)' : 'Not set',
          rawResponse: data,
        },
      });
    }

    console.log(`========== SUCCESS ==========\n`);
    res.status(200).json(data);
  } catch (error: any) {
    console.error('[Challonge Proxy] Exception:', error);
    console.error(`========== ERROR ==========\n`);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
