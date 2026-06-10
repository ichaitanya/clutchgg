const API_BASE = 'https://api.challonge.com/v2.1';
const API_KEY = process.env.CHALLONGE_API_KEY || '';

if (!API_KEY) {
  console.warn('[Challonge Proxy] CHALLONGE_API_KEY env variable is not set. API calls will fail.');
}

const headers = {
  'Content-Type': 'application/vnd.api+json',
  'Accept': 'application/json',
  'Authorization-Type': 'v1',
  'Authorization': API_KEY,
};

// Strip the Challonge api_key from any string before logging it, so the key
// never lands in Vercel's retained function logs (v1 auth puts it in the query
// string). Replaces `api_key=…` and any literal occurrence of the key itself.
function redact(s: string): string {
  let out = s.replace(/api_key=[^&\s]+/gi, 'api_key=***');
  if (API_KEY) out = out.split(API_KEY).join('***');
  return out;
}

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
  
  // Route to v1 API when the path is explicitly prefixed with /v1/.
  // v1 is the only version exposing match prerequisite/routing fields, and it
  // authenticates via an api_key query parameter rather than the v2.1 header.
  const isV1 = fullPath.startsWith('/v1/');
  const baseUrl = isV1 ? 'https://api.challonge.com/v1' : API_BASE;
  if (isV1) {
    fullPath = fullPath.substring('/v1'.length); // strip the /v1 prefix
  }

  let url = `${baseUrl}${fullPath}`;
  if (isV1) {
    const sep = url.includes('?') ? '&' : '?';
    url = `${url}${sep}api_key=${encodeURIComponent(API_KEY)}`;
  }
  const method = req.method || 'GET';

  // Vercel may deliver the body as a raw string (esp. with vnd.api+json content-type)
  // or not parse it at all. Normalize to a parsed object.
  let parsedBody: any = req.body;
  if (typeof parsedBody === 'string' && parsedBody.length > 0) {
    try {
      parsedBody = JSON.parse(parsedBody);
    } catch {
      // leave as-is if not JSON
    }
  }
  // If body still missing on a write, try reading the raw stream
  if (!parsedBody && (method === 'POST' || method === 'PUT')) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) parsedBody = JSON.parse(raw);
    } catch (e) {
      console.log('Could not read raw body stream:', e);
    }
  }

  console.log(`Path parameter: "${path}"`);
  console.log(`Full path: "${fullPath}"`);
  console.log(`Full URL: ${redact(url)}`);
  console.log(`Headers being sent:`, {
    'Content-Type': headers['Content-Type'],
    'Accept': headers['Accept'],
    'Authorization': API_KEY ? '***' : '(unset)',
  });

  if (parsedBody) {
    console.log(`Request body:`, JSON.stringify(parsedBody, null, 2));
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (parsedBody && (method === 'POST' || method === 'PUT')) {
      fetchOptions.body = JSON.stringify(parsedBody);
    }

    // Try with header-based authentication first
    console.log(`Making fetch request to: ${redact(url)}`);
    let response = await fetch(url, fetchOptions);
    
    // If 401/403, try with query parameter authentication
    if ((response.status === 401 || response.status === 403) && !url.includes('api_key=')) {
      console.log(`Got ${response.status}, trying with query parameter auth...`);
      const separator = url.includes('?') ? '&' : '?';
      const urlWithKey = `${url}${separator}api_key=${encodeURIComponent(API_KEY)}`;
      
      const optionsWithoutAuth = { ...fetchOptions };
      delete (optionsWithoutAuth.headers as any)['Authorization'];
      delete (optionsWithoutAuth.headers as any)['Authorization-Type'];
      
      console.log(`Retrying with query-param auth: ${redact(urlWithKey)}`);
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
