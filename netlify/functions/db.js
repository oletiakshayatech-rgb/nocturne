const { getStore } = require('@netlify/blobs');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const EMPTY = { posts: [], eng: {}, users: [] };

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    // Get siteID and token from Netlify's built-in environment
    const siteID = process.env.NCT_SITE_ID || process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_BLOBS_TOKEN || context?.clientContext?.custom?.netlify;

    const store = getStore({
      name: 'nocturne',
      consistency: 'strong',
      ...(siteID ? { siteID } : {}),
      ...(token  ? { token  } : {}),
    });

    if (event.httpMethod === 'GET') {
      const raw = await store.get('db');
      const data = raw ? JSON.parse(raw) : EMPTY;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'PUT') {
      const incoming = JSON.parse(event.body || '{}');
      if (!incoming.posts || !Array.isArray(incoming.posts)) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid data' }) };
      }

      const raw = await store.get('db');
      const current = raw ? JSON.parse(raw) : EMPTY;
      const incomingIds = new Set(incoming.posts.map(p => String(p.id)));
      const preserved = current.posts.filter(p => !incomingIds.has(String(p.id)));
      const merged = {
        posts: [...incoming.posts, ...preserved],
        eng:   { ...current.eng, ...incoming.eng },
        users: incoming.users?.length ? incoming.users : current.users,
      };

      await store.set('db', JSON.stringify(merged));
      console.log(`Saved ${merged.posts.length} posts`);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, posts: merged.posts.length }) };
    }

    return { statusCode: 405, headers: HEADERS, body: 'Method not allowed' };

  } catch (e) {
    console.error('db function error:', e.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
