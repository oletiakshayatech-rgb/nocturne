/* ══════════════════════════════════════════════════════════════
   Shared validation / sanitization helpers.
══════════════════════════════════════════════════════════════ */

function isValidEmail(email) {
  return typeof email === 'string' &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* Strips angle brackets from plain-text fields (names, tags, titles, etc.)
   and trims to a max length. Not for HTML content — see sanitizeHtml(). */
function sanitizeText(s, maxLen = 300) {
  return String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, maxLen);
}

/* Strips script tags, inline event handlers, and javascript: URIs from
   rich-text post bodies produced by the editor, while leaving normal
   formatting/images/links intact. */
function sanitizeHtml(html) {
  return String(html == null ? '' : html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

module.exports = { isValidEmail, sanitizeText, sanitizeHtml, isPlainObject };
