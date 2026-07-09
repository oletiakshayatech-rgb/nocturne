/* ══════════════════════════════════════════════════════════════
   PUBLIC endpoint — readable by any guest, anywhere.

   GET  -> { posts, eng }   (no users, no password hashes, no admin data)

   Nothing else is exposed here. Writes to posts/engagement happen in
   save.js; writes to users happen in admin.js. This file never writes
   anything.
══════════════════════════════════════════════════════════════ */
const { getDbStore, readDb } = require('./_store');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const store = getDbStore();
    const db = await readDb(store);

    // Explicitly whitelist the public fields — never spread the raw db
    // object here, so a future field added to the store can't leak by
    // accident.
    const publicPayload = {
      posts: db.posts,
      eng: db.eng,
    };

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(publicPayload) };
  } catch (e) {
    console.error('db function error:', e.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
