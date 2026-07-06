// Netlify serverless function — proxies JSONBin requests server-side
// so there are no CORS issues from the browser.
const JB_KEY = '$2a$10$KgdP6rVlXt9G4XPh80OEXeFSA82rHuoKKKhXnZ9MH0xnsd.68/t4.';
const JB_BIN = '6a4a685cf5f4af5e2962920a';
const JB_URL = `https://api.jsonbin.io/v3/b/${JB_BIN}`;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      // Read from JSONBin
      const r = await fetch(`${JB_URL}/latest`, {
        headers: { 'X-Master-Key': JB_KEY }
      });
      const j = await r.json();
      const d = j.record || j;
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ posts: d.posts||[], eng: d.eng||{}, users: d.users||[] })
      };

    } else if (event.httpMethod === 'PUT') {
      // Write to JSONBin
      const data = JSON.parse(event.body || '{}');
      const r = await fetch(JB_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': JB_KEY },
        body: JSON.stringify(data)
      });
      const j = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify(j) };
    }

    return { statusCode: 405, headers, body: 'Method not allowed' };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
