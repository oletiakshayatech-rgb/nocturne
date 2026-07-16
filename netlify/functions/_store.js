/* ══════════════════════════════════════════════════════════════
   Shared Netlify Blobs accessor.
   Every function calls getDbStore() from here instead of declaring
   its own getStore(...) — this is the single source of truth for
   how the blob store is opened, and the only place site ID / token
   are read from the environment.
══════════════════════════════════════════════════════════════ */
const { getStore } = require('@netlify/blobs');

const DB_KEY = 'db';

// Default homepage configuration used the very first time the site loads
// (before an admin has ever touched Homepage Management) — matches the
// site's original always-on behavior exactly, so upgrading is invisible
// to existing visitors until an admin actually changes something.
const DEFAULT_HOMEPAGE = {
  sections: { heroSpotlight: false, featured: true, trending: true, recent: true, gallery: true },
  hero: { mode: 'latest', postId: null },       // mode: latest | mostViewed | random | featured | manual
  featured: { postIds: [] },                     // admin-curated, ordered
  trending: { mode: 'auto', postIds: [], range: 'week' }, // mode: auto | manual ; range: today|week|month|all
};

const EMPTY_DB = { posts: [], eng: {}, users: [], homepage: DEFAULT_HOMEPAGE };

function getDbStore() {
  const siteID = process.env.NCT_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  if (!siteID || !token) {
    // Fail loudly server-side; never fall back to a hardcoded siteID/token.
    throw new Error('Missing NCT_SITE_ID or NETLIFY_BLOBS_TOKEN environment variables');
  }

  return getStore({ name: 'nocturne', consistency: 'strong', siteID, token });
}

function normalizeHomepage(hp) {
  const d = DEFAULT_HOMEPAGE;
  if (!hp || typeof hp !== 'object') return JSON.parse(JSON.stringify(d));
  return {
    sections: {
      heroSpotlight: typeof hp.sections?.heroSpotlight === 'boolean' ? hp.sections.heroSpotlight : d.sections.heroSpotlight,
      featured: typeof hp.sections?.featured === 'boolean' ? hp.sections.featured : d.sections.featured,
      trending: typeof hp.sections?.trending === 'boolean' ? hp.sections.trending : d.sections.trending,
      recent: typeof hp.sections?.recent === 'boolean' ? hp.sections.recent : d.sections.recent,
      gallery: typeof hp.sections?.gallery === 'boolean' ? hp.sections.gallery : d.sections.gallery,
    },
    hero: {
      mode: ['latest','mostViewed','random','featured','manual'].includes(hp.hero?.mode) ? hp.hero.mode : d.hero.mode,
      postId: hp.hero?.postId != null ? hp.hero.postId : null,
    },
    featured: {
      postIds: Array.isArray(hp.featured?.postIds) ? hp.featured.postIds.slice(0, 30) : [],
    },
    trending: {
      mode: ['auto','manual'].includes(hp.trending?.mode) ? hp.trending.mode : d.trending.mode,
      postIds: Array.isArray(hp.trending?.postIds) ? hp.trending.postIds.slice(0, 30) : [],
      range: ['today','week','month','all'].includes(hp.trending?.range) ? hp.trending.range : d.trending.range,
    },
  };
}

/* Reads the DB blob and normalizes its shape so callers never have to
   guard against a missing/legacy/corrupt record. */
async function readDb(store) {
  let raw;
  try {
    raw = await store.get(DB_KEY);
  } catch (e) {
    throw new Error('Failed to read database: ' + e.message);
  }

  if (!raw) return { posts: [], eng: {}, users: [], homepage: normalizeHomepage(null) };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Corrupt record — fail safe with an empty (but valid) shape rather
    // than crashing every function that depends on this store.
    return { posts: [], eng: {}, users: [], homepage: normalizeHomepage(null) };
  }

  return {
    posts: Array.isArray(parsed.posts) ? parsed.posts : [],
    eng: parsed.eng && typeof parsed.eng === 'object' && !Array.isArray(parsed.eng) ? parsed.eng : {},
    users: Array.isArray(parsed.users) ? parsed.users : [],
    homepage: normalizeHomepage(parsed.homepage),
  };
}

async function writeDb(store, db) {
  const safe = {
    posts: Array.isArray(db.posts) ? db.posts : [],
    eng: db.eng && typeof db.eng === 'object' ? db.eng : {},
    users: Array.isArray(db.users) ? db.users : [],
    homepage: normalizeHomepage(db.homepage),
  };
  await store.set(DB_KEY, JSON.stringify(safe));
  return safe;
}

module.exports = { getDbStore, readDb, writeDb, EMPTY_DB, DB_KEY, normalizeHomepage, DEFAULT_HOMEPAGE };
