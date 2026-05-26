// Comprehensive test endpoint to diagnose Challonge API issues

const API_BASE = 'https://api.challonge.com/v2.1';
const API_KEY = '7eb30334967856353356f5bef299f68176c9432a0ddf45f3';

export default async function handler(req: any, res: any) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const results = {
    timestamp: new Date().toISOString(),
    apiKey: {
      provided: !!API_KEY,
      length: API_KEY?.length || 0,
      preview: API_KEY?.substring(0, 10) + '...' || 'NOT SET',
    },
    tests: [] as any[],
  };

  // Test 1: Simple GET to list tournaments
  try {
    console.log('\n[Test 1] GET /tournaments');
    const url1 = `${API_BASE}/tournaments`;
    const response1 = await fetch(url1, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/json',
        'Authorization-Type': 'v1',
        'Authorization': API_KEY,
      },
    });

    const data1 = await response1.json().catch(() => null);
    
    results.tests.push({
      name: 'GET /tournaments',
      url: url1,
      status: response1.status,
      ok: response1.ok,
      data: data1,
      headers: {
        'content-type': response1.headers.get('content-type'),
      },
    });

    console.log(`Status: ${response1.status}, OK: ${response1.ok}`);
    if (data1) console.log(`Data:`, data1);
  } catch (error: any) {
    console.error('Test 1 error:', error.message);
    results.tests.push({
      name: 'GET /tournaments',
      error: error.message,
    });
  }

  // Test 2: Create a test tournament
  try {
    console.log('\n[Test 2] POST /tournaments (create)');
    const url2 = `${API_BASE}/tournaments`;
    const testName = `test-${Date.now()}`;
    const testUrl = `test-url-${Date.now()}`;

    const response2 = await fetch(url2, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/json',
        'Authorization-Type': 'v1',
        'Authorization': API_KEY,
      },
      body: JSON.stringify({
        tournament: {
          name: testName,
          url: testUrl,
          tournament_type: 'single_elimination',
          description: 'Test tournament',
        },
      }),
    });

    const data2 = await response2.json().catch(() => null);

    results.tests.push({
      name: 'POST /tournaments',
      url: url2,
      status: response2.status,
      ok: response2.ok,
      request: { name: testName, url: testUrl },
      response: data2,
    });

    console.log(`Status: ${response2.status}, OK: ${response2.ok}`);
    if (data2) console.log(`Response:`, data2);
  } catch (error: any) {
    console.error('Test 2 error:', error.message);
    results.tests.push({
      name: 'POST /tournaments',
      error: error.message,
    });
  }

  // Test 3: Check if v1 API works instead
  try {
    console.log('\n[Test 3] GET /tournaments (v1 API)');
    const url3 = 'https://api.challonge.com/v1/tournaments.json';
    const response3 = await fetch(url3, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const data3 = await response3.json().catch(() => null);

    results.tests.push({
      name: 'GET /tournaments (v1 API test)',
      url: url3,
      status: response3.status,
      ok: response3.ok,
      note: 'v1 API might require different auth',
      data: data3?.slice ? data3.slice(0, 2) : data3, // Limit response
    });

    console.log(`Status: ${response3.status}`);
  } catch (error: any) {
    console.error('Test 3 error:', error.message);
    results.tests.push({
      name: 'GET /tournaments (v1 API test)',
      error: error.message,
    });
  }

  res.status(200).json(results);
}

