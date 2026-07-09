/* ══════════════════════════════════════════════════════════════
   Shared auth helpers.

   Session tokens: a compact HMAC-SHA256-signed token, signed with
   ADMIN_KEY (a secret that lives only in Netlify env vars and is
   never sent to the browser). admin.js issues these tokens on
   successful login; save.js verifies them before accepting any
   post write. This is what "protect save.js with ADMIN_KEY" means
   in practice — the raw key itself never leaves the server.

   Passwords: hashed with scrypt + a random per-user salt (Node's
   built-in crypto — no extra dependency needed). Never compared
   with plain string equality (timing-safe compare only).
══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function base64urlDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function getSigningSecret() {
  const secret = process.env.ADMIN_KEY;
  if (!secret) throw new Error('Missing ADMIN_KEY environment variable');
  return secret;
}

/* payload should be a small plain object, e.g. { sub, role, name } */
function signToken(payload, ttlSeconds = 60 * 60 * 12) {
  const secret = getSigningSecret();
  const body = { ...payload, exp: Date.now() + ttlSeconds * 1000 };
  const payloadStr = base64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  return `${payloadStr}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const idx = token.indexOf('.');
  const payloadStr = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!payloadStr || !sig) return null;

  let secret;
  try {
    secret = getSigningSecret();
  } catch (e) {
    return null;
  }

  const expected = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadStr));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function getBearerToken(event) {
  const headers = event.headers || {};
  const raw = headers.authorization || headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : null;
}

/* ── Password hashing (scrypt) ── */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || stored.indexOf(':') === -1) return false;
  const [salt, hash] = stored.split(':');
  try {
    const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(check, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

module.exports = {
  signToken, verifyToken, getBearerToken,
  hashPassword, verifyPassword,
};
