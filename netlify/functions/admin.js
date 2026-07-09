/* ══════════════════════════════════════════════════════════════
   PRIVATE endpoint — login, signup, and user management.

   GET  (Authorization: Bearer <admin token>)
        -> { users: [...] }   (never includes password hashes)

   POST { action: 'login',   email, password }
   POST { action: 'signup',  name, email, password }
   POST { action: 'approve', email }              [admin token required]
   POST { action: 'deny',    email }              [admin token required]
   POST { action: 'toggle',  email, grant }       [admin token required]

   Users (with password hashes) are stored server-side only and are
   never returned to any client, admin included — publicUser() strips
   the hash before anything goes out over the wire.
══════════════════════════════════════════════════════════════ */
const { getDbStore, readDb, writeDb } = require('./_store');
const { signToken, verifyToken, getBearerToken, hashPassword, verifyPassword } = require('./_auth');
const { isValidEmail, sanitizeText } = require('./_validate');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const ADMIN_EMAIL = 'oletiakshayablog@gmail.com';

function publicUser(u) {
  return {
    email: u.email,
    name: u.name,
    status: u.status,
    createdAt: u.createdAt || null,
  };
}

function requireAdmin(event) {
  const token = getBearerToken(event);
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.role !== 'admin') return null;
  return payload;
}

function json(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  let store;
  try {
    store = getDbStore();
  } catch (e) {
    console.error('admin function config error:', e.message);
    return json(500, { error: 'Server misconfigured' });
  }

  try {
    /* ── GET: list users (admin only) ── */
    if (event.httpMethod === 'GET') {
      const admin = requireAdmin(event);
      if (!admin) return json(401, { error: 'Unauthorized' });

      const db = await readDb(store);
      return json(200, { users: db.users.map(publicUser) });
    }

    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return json(400, { error: 'Invalid JSON' });
    }
    if (typeof body !== 'object' || body === null) {
      return json(400, { error: 'Invalid request body' });
    }

    const action = body.action;

    /* ── LOGIN ── */
    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!isValidEmail(email) || !password) {
        return json(400, { error: 'Email and password are required.' });
      }

      const db = await readDb(store);

      if (email === ADMIN_EMAIL) {
        const adminUser = db.users.find(u => u.email === ADMIN_EMAIL && u.role === 'admin');

        if (!adminUser) {
          // First-ever admin sign-in bootstraps the admin password
          // server-side (replaces the old per-browser localStorage
          // "claim" — this now works consistently from any device).
          if (password.length < 8) {
            return json(400, { error: 'First sign-in: choose an admin password (8+ characters).' });
          }
          const created = {
            email: ADMIN_EMAIL,
            name: 'Akshaya',
            role: 'admin',
            status: 'approved',
            hash: hashPassword(password),
            createdAt: new Date().toISOString(),
          };
          db.users.push(created);
          await writeDb(store, db);
          const token = signToken({ sub: ADMIN_EMAIL, role: 'admin', name: created.name });
          return json(200, { ok: true, token, role: 'admin', name: created.name, email: ADMIN_EMAIL, bootstrapped: true });
        }

        if (!verifyPassword(password, adminUser.hash)) {
          return json(401, { error: 'Incorrect email or password.' });
        }
        const token = signToken({ sub: ADMIN_EMAIL, role: 'admin', name: adminUser.name });
        return json(200, { ok: true, token, role: 'admin', name: adminUser.name, email: ADMIN_EMAIL });
      }

      const user = db.users.find(u => u.email === email);
      if (!user || !verifyPassword(password, user.hash)) {
        return json(401, { error: 'Incorrect email or password.' });
      }
      if (user.status === 'pending') {
        return json(403, { error: 'Your account is awaiting admin approval.' });
      }
      if (user.status === 'denied') {
        return json(403, { error: 'Sign in not available.' });
      }

      const role = user.status === 'approved' ? 'approved' : 'reader';
      const token = signToken({ sub: user.email, role, name: user.name });
      return json(200, { ok: true, token, role, name: user.name, email: user.email });
    }

    /* ── SIGNUP ── */
    if (action === 'signup') {
      const name = sanitizeText(body.name, 100);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!name) return json(400, { error: 'Enter your name.' });
      if (!isValidEmail(email)) return json(400, { error: 'Enter a valid email.' });
      if (password.length < 6) return json(400, { error: 'Password must be at least 6 characters.' });
      if (email === ADMIN_EMAIL) return json(400, { error: 'That email is reserved.' });

      const db = await readDb(store);
      if (db.users.find(u => u.email === email)) {
        return json(409, { error: 'An account with that email already exists.' });
      }

      db.users.push({
        email,
        name,
        hash: hashPassword(password),
        status: 'pending',
        role: 'writer',
        createdAt: new Date().toISOString(),
      });
      await writeDb(store, db);

      return json(201, { ok: true });
    }

    /* ── APPROVE / DENY / TOGGLE (admin only) ── */
    if (action === 'approve' || action === 'deny' || action === 'toggle') {
      const admin = requireAdmin(event);
      if (!admin) return json(401, { error: 'Unauthorized' });

      const email = String(body.email || '').trim().toLowerCase();
      if (!isValidEmail(email)) return json(400, { error: 'Invalid email' });

      const db = await readDb(store);
      const user = db.users.find(u => u.email === email);
      if (!user) return json(404, { error: 'User not found' });

      if (action === 'approve') user.status = 'approved';
      else if (action === 'deny') user.status = 'denied';
      else if (action === 'toggle') user.status = body.grant ? 'approved' : 'denied';

      await writeDb(store, db);
      return json(200, { ok: true, status: user.status });
    }

    return json(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('admin function error:', e.message);
    return json(500, { error: 'Internal server error' });
  }
};
