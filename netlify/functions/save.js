/* ══════════════════════════════════════════════════════════════
   Post writes (protected) + engagement writes (public).

   POST { type: 'posts', posts: [...] }
        Authorization: Bearer <token>   (role must be 'admin' or 'approved')
        Full authoritative replace of the posts array. Every post is
        re-validated and re-sanitized server-side; duplicate ids are
        rewritten so two posts can never collide.

   POST { type: 'engagement', eng: {...} }
        Public — guests like, view, comment, and share without an
        account, same as before. Only touches db.eng, never db.posts
        or db.users, and is shape-checked so it can't be used to
        smuggle arbitrary data into the store.

   Nothing here ever reads or returns db.users.
══════════════════════════════════════════════════════════════ */
const { getDbStore, readDb, writeDb } = require('./_store');
const { verifyToken, getBearerToken } = require('./_auth');
const { sanitizeText, sanitizeHtml, isPlainObject } = require('./_validate');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const MAX_POSTS = 5000;
const MAX_COMMENTS_PER_POST = 2000;

function json(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

function requireWriter(event) {
  const token = getBearerToken(event);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return null;
  if (payload.role !== 'admin' && payload.role !== 'approved') return null;
  return payload;
}

/* Re-validates and re-sanitizes a single post object coming from the
   client. Returns null if the post is unusable (missing title/body). */
function cleanPost(raw, fallbackAuthor) {
  if (!isPlainObject(raw)) return null;

  const title = sanitizeText(raw.title, 300);
  const body = sanitizeHtml(raw.body);
  if (!title || !body) return null;

  return {
    id: raw.id != null ? raw.id : Date.now(),
    title,
    tag: sanitizeText(raw.tag, 60) || 'Essay',
    author: sanitizeText(raw.author, 100) || fallbackAuthor || 'Anonymous',
    subtitle: sanitizeText(raw.subtitle, 400),
    body,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : null,
    date: sanitizeText(raw.date, 40),
    ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
    updated: sanitizeText(raw.updated, 40),
    updatedTs: typeof raw.updatedTs === 'number' ? raw.updatedTs : undefined,
    featured: !!raw.featured,
    pick: !!raw.pick,
    gallery: !!raw.gallery,
    galleryTs: typeof raw.galleryTs === 'number' ? raw.galleryTs : undefined,
  };
}

/* Duplicate-ID protection: walk the incoming list and reassign any id
   that has already been used earlier in the same batch. */
function dedupeIds(posts) {
  const seen = new Set();
  return posts.map(p => {
    let id = p.id;
    while (seen.has(String(id))) {
      id = Date.now() + Math.floor(Math.random() * 1000);
    }
    seen.add(String(id));
    return { ...p, id };
  });
}

function cleanEngEntry(raw) {
  if (!isPlainObject(raw)) return { likes: 0, views: 0, shares: 0, likedBy: [], comments: [] };
  const likedBy = Array.isArray(raw.likedBy) ? raw.likedBy.slice(0, 50000).map(v => sanitizeText(v, 64)) : [];
  const comments = Array.isArray(raw.comments)
    ? raw.comments.slice(0, MAX_COMMENTS_PER_POST).map(c => ({
        id: sanitizeText(c && c.id, 64) || (Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
        author: sanitizeText(c && c.author, 100) || 'Anonymous',
        text: sanitizeText(c && c.text, 2000),
        ts: typeof (c && c.ts) === 'number' ? c.ts : Date.now(),
      })).filter(c => c.text)
    : [];
  return {
    likes: Number.isFinite(raw.likes) ? Math.max(0, Math.floor(raw.likes)) : 0,
    views: Number.isFinite(raw.views) ? Math.max(0, Math.floor(raw.views)) : 0,
    shares: Number.isFinite(raw.shares) ? Math.max(0, Math.floor(raw.shares)) : 0,
    likedBy,
    comments,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let store;
  try {
    store = getDbStore();
  } catch (e) {
    console.error('save function config error:', e.message);
    return json(500, { error: 'Server misconfigured' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON' });
  }
  if (!isPlainObject(body)) {
    return json(400, { error: 'Invalid request body' });
  }

  const type = body.type;

  try {
    /* ── ENGAGEMENT (public) ── */
    if (type === 'engagement') {
      if (!isPlainObject(body.eng)) {
        return json(400, { error: 'Missing or invalid eng payload' });
      }

      const db = await readDb(store);
      const validIds = new Set(db.posts.map(p => String(p.id)));

      const cleanedEng = {};
      for (const key of Object.keys(body.eng)) {
        if (!validIds.has(String(key))) continue; // ignore engagement for posts that don't exist
        cleanedEng[key] = cleanEngEntry(body.eng[key]);
      }
      // Preserve engagement for any post the client didn't send (keeps
      // concurrent writes from other visitors from being clobbered).
      for (const key of Object.keys(db.eng)) {
        if (!(key in cleanedEng) && validIds.has(key)) cleanedEng[key] = db.eng[key];
      }

      db.eng = cleanedEng;
      await writeDb(store, db);
      return json(200, { ok: true });
    }

    /* ── POSTS (admin or approved writer only) ── */
    if (type === 'posts') {
      const writer = requireWriter(event);
      if (!writer) return json(401, { error: 'Unauthorized' });

      if (!Array.isArray(body.posts)) {
        return json(400, { error: 'posts must be an array' });
      }
      if (body.posts.length > MAX_POSTS) {
        return json(400, { error: `Too many posts (max ${MAX_POSTS})` });
      }

      const cleaned = body.posts
        .map(p => cleanPost(p, writer.name))
        .filter(Boolean);

      if (cleaned.length !== body.posts.length) {
        return json(400, { error: 'One or more posts were missing a title or body' });
      }

      const deduped = dedupeIds(cleaned);

      const db = await readDb(store);
      db.posts = deduped;

      // Keep engagement rows only for posts that still exist; add a
      // fresh row for any brand-new post.
      const keepIds = new Set(deduped.map(p => String(p.id)));
      const nextEng = {};
      for (const key of Object.keys(db.eng)) {
        if (keepIds.has(key)) nextEng[key] = db.eng[key];
      }
      for (const id of keepIds) {
        if (!nextEng[id]) nextEng[id] = { likes: 0, views: 0, shares: 0, likedBy: [], comments: [] };
      }
      db.eng = nextEng;

      await writeDb(store, db);
      return json(200, { ok: true, posts: db.posts.length });
    }

    return json(400, { error: 'Unknown type' });
  } catch (e) {
    console.error('save function error:', e.message);
    return json(500, { error: 'Internal server error' });
  }
};
