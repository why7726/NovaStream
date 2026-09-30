// En premier : charge .env + data/config.json avant tout autre module.
import * as config from './config.js';
import express from 'express';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import os from 'os';
import { spawn } from 'child_process';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import ffmpegStatic from 'ffmpeg-static';
import webpush from 'web-push';
import { setupWatchParty } from './watchParty.js';
import { createSubtitles } from './subtitles.js';
import * as arr from './arr.js';
import * as qbit from './qbit.js';
import { croiser as croiserHorreur } from './horrorPlus.js';
import * as plexLink from './plexLink.js';
import * as vibe from './vibe.js';
import * as setup from './setup.js';
import { creerFiltrePrive } from './prive.js';
import { creerJellyfin } from './jellyfin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ───────────────────────────────────────────
// Rien n'est écrit en dur : tout vient de data/config.json (assistant de
// premier démarrage) ou de l'environnement. Ces variables sont relues à
// chaque changement de réglage, sans redémarrer le serveur.
const PORT = process.env.PORT || 5174;
let PLEX_URL, PLEX_TOKEN, TMDB_TOKEN, PLEX_STREAM_TOKEN;
function lireConfig() {
  PLEX_URL = config.get('PLEX_URL').replace(/\/$/, '');
  PLEX_TOKEN = config.get('PLEX_TOKEN');
  TMDB_TOKEN = config.get('TMDB_TOKEN');
  /* Jeton d'un compte Plex géré dédié (facultatif). S'il est défini, tout ce
     que déclenchent les utilisateurs (lecture, transcodage, progression) passe
     par lui : côté Plex, les séances apparaissent au nom de ce compte et non à
     celui de l'administrateur. Les tâches internes gardent le jeton admin. */
  PLEX_STREAM_TOKEN = config.get('PLEX_NOVA_TOKEN') || PLEX_TOKEN;
}
lireConfig();
config.onChange(lireConfig);

/* Bibliothèques privées (décochées dans les réglages) : filtrées de toutes
   les réponses Plex et inaccessibles, même par lien direct. Voir prive.js. */
const prive = creerFiltrePrive({
  lister: async (chemin) => (await plexJsonBrut(chemin))?.MediaContainer?.Metadata || [],
  actif: () => config.features().serveur,
  exclues: () => config.bibliotheques().exclues,
});

/* Serveur Jellyfin : Nova parle « Plex », jellyfin.js traduit (voir ce fichier).
   Créé plus bas, une fois la base ouverte (il y range ses correspondances
   d'identifiants). */
let jelly = null;
const estJellyfin = () => !!jelly && config.serveurType() === 'jellyfin';
setTimeout(() => prive.rafraichir(), 5000);
setInterval(() => prive.rafraichir(), 10 * 60 * 1000);
config.onChange(() => {
  prive.rafraichir();
  try { apiCache.clear(); } catch { /* pas encore initialisé au démarrage */ }
  libraryCache = { at: 0, items: [] };
});
if (!config.serveurType()) {
  console.warn('[Config] Aucun serveur multimédia relié — ouvrez le site pour lancer l\'assistant de configuration.');
}

// Stable JWT secret: env > persisted file > generate-and-persist.
// (Previously regenerated on every boot, which logged everyone out at each restart.)
const SECRET_FILE = config.dataPath('.jwt_secret');
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  try { if (fs.existsSync(SECRET_FILE)) JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch {}
  if (!JWT_SECRET) {
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(SECRET_FILE, JWT_SECRET, { mode: 0o600 }); }
    catch (e) { console.warn('[JWT] could not persist secret:', e.message); }
  }
}

// Populated by setupWatchParty at boot; lets proxyAuth revoke a guest's
// streaming access the instant the host ends the séance.
const watchApi = {};

const app = express();
console.log('\n\n>>> NOVASTREAM SERVER STARTING - [' + new Date().toLocaleString() + '] <<<\n\n');
app.use(express.json());

/* ─── Compression ────────────────────────────────────────────────────
   Elle n'était PAS branchée (le paquet était installé mais jamais utilisé) :
   tout partait en clair, y compris le JS (200 ko + 525 ko) et les listings
   Plex de 1000 titres. Sur une connexion faible, c'était la cause principale
   des « le site charge méga long ». Le filtre par défaut de `compression`
   laisse tranquilles les contenus déjà compressés (JPEG, vidéo, segments .ts),
   donc le flux vidéo n'est pas touché. */
app.use(compression({ threshold: 1024 }));

// ─── CORS (reflect origin instead of blanket wildcard) ───────
// The app is served SAME-ORIGIN (dist + API on the same host:port), so browsers
// don't apply CORS to normal use. We only reflect an Origin for a small allowlist
// (dev server, private LAN, the public address set in the settings, or
// ALLOWED_ORIGINS from .env); unknown cross-origin sites get no ACAO header.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:5174')
  .split(',').map((s) => s.trim()).filter(Boolean);
function originAllowed(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const h = new URL(origin).hostname;
    if (/^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
    if (h && h === config.hotePublic()) return true;
  } catch {}
  return false;
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range, X-Plex-Client-Identifier, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Watch-party guest scope guard ───────────────────────────
// A guest JWT (by design) passes auth so the person can stream, but it must
// ONLY unlock playback + their own séance — never the rest of the /api surface
// (admin, users, other people's data, etc.).
const GUEST_API_ALLOW = [
  { m: ['GET'], re: /^\/api\/auth\/me$/ },
  { m: ['GET', 'POST'], re: /^\/api\/watch(\/|$)/ },
  { m: ['GET'], re: /^\/api\/tmdb-v2\// },
  { m: ['GET'], re: /^\/api\/ping$/ },
  { m: ['GET'], re: /^\/api\/subtitles\// },
];
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  let token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!token && req.query.nova) token = req.query.nova;
  if (!token) return next();
  let d;
  try { d = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); } catch { return next(); }
  if (!d) return next();
  if (d.guest) {
    const allowed = GUEST_API_ALLOW.some((r) => r.m.includes(req.method) && r.re.test(req.path));
    if (!allowed) return res.status(403).json({ error: 'Accès invité restreint à la séance' });
  } else if (d.mediaScope) {
    // Media tokens live only in ?nova= URLs — allow only live HLS segments here;
    // everything else on /api (and all writes) is off-limits if such a token leaks.
    const allowed = req.method === 'GET' && /^\/api\/live\/hls\//.test(req.path);
    if (!allowed) return res.status(403).json({ error: 'Jeton média restreint' });
  }
  next();
});

// ═══════════════════════════════════════════════════════════
//  JOURNALISATION SUR DISQUE
//  Le serveur démarre dans une fenêtre cachée : sans ça, tout
//  console.log/error part dans le vide et un crash nocturne est
//  indébuggable. Un fichier par jour, 14 jours gardés.
// ═══════════════════════════════════════════════════════════
const LOG_DIR = config.dataPath('logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

let logStream = null;
let logDay = '';
function writeLog(level, args) {
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (day !== logDay) {
      logDay = day;
      if (logStream) logStream.end();
      logStream = fs.createWriteStream(path.join(LOG_DIR, `nova-${day}.log`), { flags: 'a' });
      // purge des journaux de plus de 14 jours
      const limit = Date.now() - 14 * 86400000;
      for (const f of fs.readdirSync(LOG_DIR)) {
        const p = path.join(LOG_DIR, f);
        try { if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p); } catch {}
      }
    }
    const line = args
      .map((a) => (typeof a === 'string' ? a : (a?.stack || JSON.stringify(a))))
      .join(' ');
    logStream.write(`${now.toISOString()} ${level} ${line}\n`);
  } catch { /* ne jamais faire tomber le serveur pour un log */ }
}
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => { original(...args); writeLog(level.toUpperCase(), args); };
}
console.log(`[Boot] NovaStream démarre — données dans ${config.DATA_DIR}`);

// ═══════════════════════════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════════════════════════
const db = new Database(config.dataPath('novastream.db'));
db.pragma('journal_mode = WAL');

jelly = creerJellyfin({
  db,
  url: () => config.get('JELLYFIN_URL'),
  token: () => config.get('JELLYFIN_TOKEN'),
  userId: () => config.get('JELLYFIN_USER_ID'),
});
config.onChange(() => jelly.oublier());
db.pragma('wal_autocheckpoint = 1000'); // keep the -wal file from growing unbounded

// Flush WAL & close cleanly on shutdown (prevents a multi-MB stale -wal file)
function gracefulShutdown() {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ── Sauvegarde de la base ─────────────────────────────────────────────
// Comptes, progression, favoris, historique, demandes : la seule donnée
// irremplaçable du serveur. VACUUM INTO fait une copie cohérente même
// pendant les écritures. Une par jour, 7 gardées.
const BACKUP_DIR = config.dataPath('backups');
function backupDatabase() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(BACKUP_DIR, `novastream-${day}.db`);
    if (fs.existsSync(target)) return; // déjà faite aujourd'hui
    db.exec(`VACUUM INTO '${target.replace(/\\/g, '/').replace(/'/g, "''")}'`);
    const kept = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
    while (kept.length > 7) {
      const old = kept.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch {}
    }
    console.log(`[Backup] Base sauvegardée → ${path.basename(target)}`);
  } catch (e) {
    console.error('[Backup] Échec:', e.message);
  }
}
/* Les anciens fichiers de build sont conservés (voir vite.config.js) pour ne
   pas casser les onglets ouverts pendant un déploiement.

   ⚠️ On ne purge JAMAIS par la seule date. Le 2026-08-23, le site est tombé
   entièrement : le dernier build datait de 17 jours, donc TOUS les fichiers
   dépassaient la limite de 14 jours et ont été supprimés — `index.html`
   réclamait des chunks qui n'existaient plus, et plus rien ne se chargeait.

   On calcule donc d'abord ce qui est ENCORE UTILISÉ : les fichiers cités par
   `index.html`, puis, de proche en proche, ceux que ces fichiers importent
   (les chunks paresseux se référencent entre eux). Seul ce qui est à la fois
   vieux ET hors de cet ensemble est effacé. */
function assetsUtilises(dir) {
  const utilises = new Set();
  const aExplorer = [];

  const nomsDans = (texte) => {
    const out = [];
    const re = /[A-Za-z0-9_.-]+\.(?:js|css)/g;
    let m;
    while ((m = re.exec(texte)) !== null) out.push(m[0]);
    return out;
  };

  try {
    const html = fs.readFileSync(path.join(__dirname, 'dist', 'index.html'), 'utf8');
    for (const n of nomsDans(html)) if (!utilises.has(n)) { utilises.add(n); aExplorer.push(n); }
  } catch { return null; }          // pas d'index.html lisible : on ne purge rien

  // fermeture transitive : un chunk peut en importer d'autres
  while (aExplorer.length) {
    const nom = aExplorer.pop();
    const fp = path.join(dir, nom);
    if (!fs.existsSync(fp)) continue;
    try {
      for (const n of nomsDans(fs.readFileSync(fp, 'utf8'))) {
        if (!utilises.has(n)) { utilises.add(n); aExplorer.push(n); }
      }
    } catch { /* binaire ou illisible : on l'a déjà protégé */ }
  }
  return utilises;
}

function pruneOldAssets() {
  try {
    const dir = path.join(__dirname, 'dist', 'assets');
    if (!fs.existsSync(dir)) return;

    const utilises = assetsUtilises(dir);
    if (!utilises || !utilises.size) {
      console.warn('[Build] purge annulée : impossible de déterminer les fichiers utilisés');
      return;
    }

    const limit = Date.now() - 14 * 86400000;
    const fichiers = fs.readdirSync(dir);
    const aSupprimer = fichiers.filter((f) => {
      if (utilises.has(f)) return false;                       // encore servi
      try { return fs.statSync(path.join(dir, f)).mtimeMs < limit; } catch { return false; }
    });

    // Garde-fou : on ne vide jamais le dossier, quoi qu'il arrive.
    if (aSupprimer.length >= fichiers.length) {
      console.warn('[Build] purge annulée : elle viderait dist/assets');
      return;
    }

    let n = 0;
    for (const f of aSupprimer) { try { fs.unlinkSync(path.join(dir, f)); n++; } catch {} }
    if (n) console.log(`[Build] ${n} ancien(s) fichier(s) purgé(s), ${utilises.size} encore utilisé(s)`);
  } catch { /* sans importance */ }
}
setTimeout(pruneOldAssets, 60000);

setTimeout(backupDatabase, 30000);              // une au démarrage
setInterval(backupDatabase, 6 * 60 * 60 * 1000); // puis toutes les 6 h

// Safety net: a stray stream/async error must never take down the whole server
// (it's a personal always-on media server). Log it and keep serving.
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err?.stack || err?.message || err);
});
process.on('unhandledRejection', (err) => {
  console.error('[Unhandled Rejection]', err?.stack || err?.message || err);
});

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    isAdmin INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invitation_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    usedBy INTEGER REFERENCES users(id),
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS watch_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL REFERENCES users(id),
    mediaId TEXT NOT NULL,
    mediaTitle TEXT,
    mediaPoster TEXT,
    mediaType TEXT,
    currentTime REAL DEFAULT 0,
    duration REAL DEFAULT 0,
    completed INTEGER DEFAULT 0,
    updatedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, mediaId)
  );

  CREATE TABLE IF NOT EXISTS user_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL, -- 'login', 'logout', 'register', 'visit', 'play', 'stop'
    mediaId TEXT,
    mediaTitle TEXT,
    metadata TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL REFERENCES users(id),
    mediaId TEXT NOT NULL,
    mediaTitle TEXT,
    mediaPoster TEXT,
    mediaType TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, mediaId)
  );

  CREATE TABLE IF NOT EXISTS request_search (
    requestId INTEGER PRIMARY KEY,
    arrKind TEXT,
    arrId INTEGER,
    season INTEGER,
    addedByNova INTEGER DEFAULT 0,
    releases TEXT,
    chosen TEXT,
    state TEXT NOT NULL DEFAULT 'searching',
    error TEXT,
    notifiedAt TEXT,
    qbHash TEXT,
    qbName TEXT,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS content_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL REFERENCES users(id),
    tmdbId TEXT NOT NULL,
    mediaType TEXT NOT NULL,
    title TEXT,
    year TEXT,
    poster TEXT,
    status TEXT DEFAULT 'pending', -- pending | approved | added | declined
    note TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, tmdbId, mediaType)
  );
`);

// Migration: add avatar column to users if missing (guarded — throws if exists)
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch (e) { /* already exists */ }
// Migration: per-user token version for revocation ("log out everywhere").
try { db.exec('ALTER TABLE users ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* already exists */ }

// A real-user token stays valid only while its `tv` claim matches the user's
// current tokenVersion. Bumping tokenVersion instantly revokes every token
// that user holds (main + media), without touching anyone else. Guests and
// tokens without an id are handled by their own mechanisms.
function checkTokenVersion(decoded) {
  if (!decoded || decoded.guest || decoded.id == null) return true;
  const row = db.prepare('SELECT tokenVersion FROM users WHERE id = ?').get(decoded.id);
  if (!row) return false;
  return (decoded.tv || 0) === (row.tokenVersion || 0);
}

// Helper: log a user activity row (timestamp stored as ISO 8601)
function logActivity(userId, type, mediaId = null, mediaTitle = null, metadata = null) {
  try {
    db.prepare(`
      INSERT INTO user_activity (userId, type, mediaId, mediaTitle, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, type, mediaId, mediaTitle, metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
  } catch (e) { console.error('[Activity] log failed:', e.message); }
}

// ─── JWT Middleware ──────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Token requis' });
  const token = header.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!checkTokenVersion(decoded)) return res.status(401).json({ error: 'Session révoquée' });
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Accès admin requis' });
  next();
}

// ─── Proxy auth ──────────────────────────────────────────────
// Protects the Plex proxy so only logged-in NovaStream users can reach Plex.
// Accepts the JWT either via the Authorization header (used by hls.js / fetch)
// or via a `?nova=` query param (used by <img>/<video> src which can't set headers).
function proxyAuth(req, res, next) {
  const header = req.headers['authorization'];
  let token = header ? header.replace('Bearer ', '') : null;
  if (!token && req.query.nova) token = req.query.nova;
  if (!token) return res.status(401).json({ error: 'Token requis' });
  try {
    req.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
  if (!checkTokenVersion(req.user)) return res.status(401).json({ error: 'Session révoquée' });

  // Restricted tokens (leak-prone or account-less) may only READ:
  //  • watch-party guests — also require their séance to still be alive;
  //    they additionally get the audio-track PUT + transcode-stop for playback.
  //  • media tokens (short-lived, embedded in ?nova= URLs) — read-only.
  if (req.user.guest || req.user.mediaScope) {
    if (req.user.guest && (!watchApi.isSessionActive || !watchApi.isSessionActive(req.user.sessionId))) {
      return res.status(403).json({ error: 'Séance terminée' });
    }
    const m = (req.method || 'GET').toUpperCase();
    const url = req.url || '';
    const readOk = m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
    const partSelect = req.user.guest && m === 'PUT' && /\/library\/parts\//.test(url);
    const transcodeStop = req.user.guest && m === 'POST' && /transcode\/universal\/stop/.test(url);
    if (!readOk && !partSelect && !transcodeStop) {
      return res.status(403).json({ error: 'Action non autorisée' });
    }
  }
  next();
}

// ═══════════════════════════════════════════════════════════
//  API ROUTES (PRIORITY)
// ═══════════════════════════════════════════════════════════

app.get('/api/ping', (req, res) => res.json({ status: 'ok', time: new Date() }));

// Assistant de premier démarrage, réglages, bibliothèques, fonctions actives.
setup.installer(app, {
  db, bcrypt, authMiddleware, adminMiddleware, logActivity, prive, plexJsonBrut,
  signerJeton: (u) => jwt.sign({ id: u.id, username: u.username, email: u.email, isAdmin: u.isAdmin, tv: u.tokenVersion || 0 }, JWT_SECRET, { expiresIn: '30d' }),
});

// TMDB Assets Proxy (Poster, Backdrop, Logo)
app.get('/api/tmdb-v2/assets/:type/:idOrTitle', async (req, res) => {
  try {
    const { type, idOrTitle } = req.params;
    console.log(`[TMDB-V2] RECU: Type=${type}, Media=${idOrTitle}`);
    
    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    let tmdbId = idOrTitle;

    if (isNaN(idOrTitle) || !idOrTitle) {
      const query = idOrTitle || req.query.title;
      const searchUrl = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}&include_adult=false&language=fr-FR`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'Authorization': `Bearer ${TMDB_TOKEN}`, 'Accept': 'application/json' }
      });
      const searchData = await searchRes.json();
      const match = searchData.results?.find(r => r.media_type === tmdbType) || searchData.results?.[0];
      if (!match) return res.status(404).json({ error: 'Media not found on TMDB' });
      tmdbId = match.id;
    }

    const detailsUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?language=fr-FR`;
    const detailsRes = await fetch(detailsUrl, {
      headers: { 'Authorization': `Bearer ${TMDB_TOKEN}`, 'Accept': 'application/json' }
    });
    const detailsData = await detailsRes.json();

    const imagesUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}/images?include_image_language=fr,en,null`;
    const imagesRes = await fetch(imagesUrl, {
      headers: { 'Authorization': `Bearer ${TMDB_TOKEN}`, 'Accept': 'application/json' }
    });
    const imagesData = await imagesRes.json();
    const logos = imagesData.logos || [];
    const bestLogo = logos.find(l => l.iso_639_1 === 'fr') ||
                     logos.find(l => l.iso_639_1 === 'en') ||
                     logos.find(l => l.iso_639_1 === null) ||
                     logos[0];

    // Trailer (YouTube key) — prefer FR official trailer, fall back to EN / teaser.
    let trailerKey = null;
    try {
      const fetchVideos = async (lang) => {
        const r = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}/videos?language=${lang}`, {
          headers: { 'Authorization': `Bearer ${TMDB_TOKEN}`, 'Accept': 'application/json' }
        });
        return (await r.json()).results || [];
      };
      let vids = await fetchVideos('fr-FR');
      if (vids.length === 0) vids = await fetchVideos('en-US');
      const yt = vids.filter(v => v.site === 'YouTube');
      const best = yt.find(v => v.type === 'Trailer' && v.official)
                || yt.find(v => v.type === 'Trailer')
                || yt.find(v => v.type === 'Teaser')
                || yt[0];
      trailerKey = best?.key || null;
    } catch (e) { /* trailer optional */ }

    // These assets rarely change → let the browser cache them for a day.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.json({
      poster: detailsData.poster_path ? `https://image.tmdb.org/t/p/original${detailsData.poster_path}` : null,
      backdrop: detailsData.backdrop_path ? `https://image.tmdb.org/t/p/original${detailsData.backdrop_path}` : null,
      logo: bestLogo ? `https://image.tmdb.org/t/p/original${bestLogo.file_path}` : null,
      trailer: trailerKey,
      tmdbId: tmdbId
    });
  } catch (error) {
    console.error('[TMDB-V2 ERROR]', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Get metadata with external ID extraction
app.get('/plex/library/metadata/:id', proxyAuth, async (req, res) => {
  try {
    if (prive.cheminInterdit(`/library/metadata/${req.params.id}`)) return res.status(404).json({ error: 'Introuvable' });
    let brut;
    if (estJellyfin()) brut = await jelly.plexJson(`/library/metadata/${req.params.id}`);
    else {
      // Avec le jeton du compte relié, la fiche porte SA progression (viewOffset).
      const url = `${PLEX_URL}/library/metadata/${req.params.id}?includeMarkers=1&includeChapters=1&X-Plex-Token=${tokenPour(req)}`;
      brut = await (await fetch(url, { headers: { 'Accept': 'application/json' } })).json();
    }
    const data = prive.filtrerJson(brut);
    if (data?.MediaContainer?.Metadata?.[0]) {
      const item = data.MediaContainer.Metadata[0];
      const guids = item.Guid || [];
      item.tmdbId = guids.find(g => g.id?.startsWith('tmdb://'))?.id?.replace('tmdb://', '');
      item.imdbId = guids.find(g => g.id?.startsWith('imdb://'))?.id?.replace('imdb://', '');
      if (!item.tmdbId && item.guid?.includes('com.plexapp.agents.themoviedb')) {
         item.tmdbId = item.guid.split('://')[1].split('?')[0];
      }
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'NOVA-';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

// ═══════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════

// Register — rate-limited per IP (invite-gated, but stops code-guessing floods)
const registerAttempts = new Map();
function registerLimiter(ip) {
  const now = Date.now();
  const arr = (registerAttempts.get(ip) || []).filter((t) => now - t < 3600000);
  if (arr.length >= 10) { registerAttempts.set(ip, arr); return false; }
  arr.push(now); registerAttempts.set(ip, arr); return true;
}
app.post('/api/auth/register', (req, res) => {
  try {
    if (!registerLimiter(clientIp(req))) return res.status(429).json({ error: 'Trop de tentatives, réessaie plus tard' });
    const { username, email, password, inviteCode } = req.body;

    if (!username || !email || !password || !inviteCode) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    if (typeof username !== 'string' || username.length < 2 || username.length > 32) return res.status(400).json({ error: 'Pseudo invalide (2 à 32 caractères)' });
    if (typeof password !== 'string' || password.length < 6 || password.length > 200) return res.status(400).json({ error: 'Mot de passe trop court (min 6)' });
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });

    // Check invite code
    const code = db.prepare('SELECT * FROM invitation_codes WHERE code = ? AND usedBy IS NULL').get(inviteCode.toUpperCase());
    if (!code) return res.status(400).json({ error: "Code d'invitation invalide ou déjà utilisé" });

    // Check if email or username already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existingUser) return res.status(400).json({ error: 'Email ou pseudo déjà utilisé' });

    // Hash password & create user
    const hash = bcrypt.hashSync(password, 10);
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const isAdmin = userCount === 0 ? 1 : 0; // First user = admin

    const result = db.prepare('INSERT INTO users (username, email, password, isAdmin) VALUES (?, ?, ?, ?)').run(username, email, hash, isAdmin);

    // Mark code as used
    db.prepare('UPDATE invitation_codes SET usedBy = ? WHERE id = ?').run(result.lastInsertRowid, code.id);

    logActivity(result.lastInsertRowid, 'register');

    // Generate token
    const token = jwt.sign({ id: result.lastInsertRowid, username, email, isAdmin, tv: 0 }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user: { id: result.lastInsertRowid, username, email, isAdmin } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── Login rate limiting (anti brute-force, per IP) ──────────
const loginAttempts = new Map(); // ip -> { count, first }
const LOGIN_WINDOW = 15 * 60 * 1000; // 15 min
const LOGIN_MAX = 8;

// X-Forwarded-For n'est cru que venant d'un relais local (voir setup.js) :
// sinon n'importe qui pourrait contourner la limite de tentatives.
const clientIp = setup.ipReelle;

function loginRateLimit(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  if (loginAttempts.size > 5000) loginAttempts.clear(); // crude memory guard
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.first > LOGIN_WINDOW) { entry = { count: 0, first: now }; loginAttempts.set(ip, entry); }
  if (entry.count >= LOGIN_MAX) {
    const retryMin = Math.max(1, Math.ceil((LOGIN_WINDOW - (now - entry.first)) / 60000));
    return res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${retryMin} min.` });
  }
  next();
}

function noteLoginFailure(req) {
  const entry = loginAttempts.get(clientIp(req));
  if (entry) entry.count++;
}

// Login
app.post('/api/auth/login', loginRateLimit, (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) { noteLoginFailure(req); return res.status(401).json({ error: 'Email ou mot de passe incorrect' }); }

    if (!bcrypt.compareSync(password, user.password)) {
      noteLoginFailure(req);
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    loginAttempts.delete(clientIp(req)); // successful login clears the counter
    logActivity(user.id, 'login');

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, tv: user.tokenVersion || 0 }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user: { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, avatar: user.avatar || null } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Short-lived, read-only "media token" for URL params (?nova=) — so the 30-day
// session JWT is never exposed in <img>/<video> URLs, browser history or logs.
app.get('/api/media-token', authMiddleware, (req, res) => {
  if (req.user.guest || req.user.id == null) return res.status(403).json({ error: 'Indisponible' });
  const row = db.prepare('SELECT tokenVersion FROM users WHERE id = ?').get(req.user.id);
  const ttlMs = 3 * 60 * 60 * 1000;
  const token = jwt.sign({ id: req.user.id, mediaScope: true, tv: row?.tokenVersion || 0 }, JWT_SECRET, { expiresIn: '3h' });
  res.json({ token, ttlMs });
});

// "Log out everywhere": revoke ALL of the caller's tokens by bumping tokenVersion.
app.post('/api/auth/logout-all', authMiddleware, (req, res) => {
  try {
    if (req.user.id == null) return res.status(400).json({ error: 'Indisponible' });
    db.prepare('UPDATE users SET tokenVersion = tokenVersion + 1 WHERE id = ?').run(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('logout-all error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Verify token
app.get('/api/auth/me', authMiddleware, (req, res) => {
  // Watch-party guests have no DB account — return a synthetic profile so the
  // app treats them as (guest) logged-in for the duration of the session.
  if (req.user.guest) {
    return res.json({ user: { id: null, username: req.user.username || 'Invité', email: null, isAdmin: false, avatar: null, guest: true, sessionId: req.user.sessionId } });
  }
  const user = db.prepare('SELECT id, username, email, isAdmin, avatar FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
  res.json({ user });
});

// Update profile avatar (base64 data URL, resized client-side)
app.put('/api/profile/avatar', authMiddleware, (req, res) => {
  try {
    const { avatar } = req.body;
    if (avatar && (typeof avatar !== 'string' || avatar.length > 600000)) {
      return res.status(400).json({ error: 'Image invalide ou trop lourde' });
    }
    if (avatar && !/^data:image\/(png|jpe?g|webp|gif|avif);base64,/.test(avatar)) {
      return res.status(400).json({ error: 'Format d\'image non supporté' });
    }
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar || null, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Avatar update error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═══════════════════════════════════════════════════════════

// Create invitation code
app.post('/api/admin/codes', authMiddleware, adminMiddleware, (req, res) => {
  try {
    let code;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
    } while (db.prepare('SELECT id FROM invitation_codes WHERE code = ?').get(code) && attempts < 10);

    db.prepare('INSERT INTO invitation_codes (code) VALUES (?)').run(code);
    res.json({ code });
  } catch (err) {
    console.error('Code generation error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// List codes
app.get('/api/admin/codes', authMiddleware, adminMiddleware, (req, res) => {
  const codes = db.prepare(`
    SELECT ic.*, u.username as usedByName 
    FROM invitation_codes ic 
    LEFT JOIN users u ON ic.usedBy = u.id 
    ORDER BY ic.createdAt DESC
  `).all();
  res.json({ codes });
});

// List all users with last activity
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email, u.isAdmin, u.createdAt, u.avatar,
    (SELECT timestamp FROM user_activity WHERE userId = u.id ORDER BY timestamp DESC LIMIT 1) as lastActivity
    FROM users u
    ORDER BY lastActivity DESC, u.createdAt DESC
  `).all();
  res.json({ users });
});

// Get specific user history
app.get('/api/admin/user/:id/history', authMiddleware, adminMiddleware, (req, res) => {
  const history = db.prepare(`
    SELECT * FROM user_activity 
    WHERE userId = ? 
    ORDER BY timestamp DESC 
    LIMIT 100
  `).all(req.params.id);
  
  const watchHistory = db.prepare(`
    SELECT * FROM watch_progress 
    WHERE userId = ? 
    ORDER BY updatedAt DESC
  `).all(req.params.id);

  res.json({ history, watchHistory });
});

// Log user activity
app.post('/api/activity/log', authMiddleware, (req, res) => {
  try {
    const { type, mediaId, mediaTitle, metadata } = req.body;
    const now = new Date().toISOString();
    console.log(`[Activity] User ${req.user.username} - ${type} ${mediaTitle || ''}`);
    db.prepare(`
      INSERT INTO user_activity (userId, type, mediaId, mediaTitle, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, type, mediaId || null, mediaTitle || null, metadata ? JSON.stringify(metadata) : null, now);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Activity Error]', err);
    res.status(500).json({ error: 'Log error' });
  }
});

// Global stats for the admin dashboard
app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const totalPlays = db.prepare("SELECT COUNT(*) c FROM user_activity WHERE type = 'play'").get().c;
    const completed = db.prepare('SELECT COUNT(*) c FROM watch_progress WHERE completed = 1').get().c;
    const totalSeconds = db.prepare('SELECT COALESCE(SUM(currentTime), 0) s FROM watch_progress').get().s;
    const activeWeek = db.prepare("SELECT COUNT(DISTINCT userId) c FROM user_activity WHERE timestamp >= datetime('now', '-7 days')").get().c;
    const topTitles = db.prepare(`
      SELECT mediaTitle, COUNT(*) entries, COALESCE(SUM(currentTime), 0) seconds
      FROM watch_progress
      WHERE mediaTitle IS NOT NULL AND mediaTitle != ''
      GROUP BY mediaTitle
      ORDER BY seconds DESC
      LIMIT 8
    `).all();
    res.json({ totalUsers, totalPlays, completed, totalSeconds, activeWeek, topTitles });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// List all recent activity (Global)
app.get('/api/admin/activity', authMiddleware, adminMiddleware, (req, res) => {
  const activity = db.prepare(`
    SELECT ua.*, u.username 
    FROM user_activity ua
    JOIN users u ON ua.userId = u.id 
    ORDER BY ua.timestamp DESC 
    LIMIT 100
  `).all();
  res.json({ activity });
});

// ═══════════════════════════════════════════════════════════
//  WATCH PROGRESS ROUTES
// ═══════════════════════════════════════════════════════════

// Save progress
app.post('/api/progress', authMiddleware, (req, res) => {
  try {
    const { mediaId, mediaTitle, mediaPoster, mediaType, currentTime, duration } = req.body;
    const completed = duration > 0 && (currentTime / duration) > 0.9 ? 1 : 0;
    const dejaVu = !!db.prepare('SELECT completed FROM watch_progress WHERE userId = ? AND mediaId = ?')
      .get(req.user.id, mediaId)?.completed;

    db.prepare(`
      INSERT INTO watch_progress (userId, mediaId, mediaTitle, mediaPoster, mediaType, currentTime, duration, completed, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(userId, mediaId) DO UPDATE SET
        currentTime = excluded.currentTime,
        duration = excluded.duration,
        completed = excluded.completed,
        mediaTitle = excluded.mediaTitle,
        mediaPoster = excluded.mediaPoster,
        updatedAt = datetime('now')
    `).run(req.user.id, mediaId, mediaTitle || '', mediaPoster || '', mediaType || '', currentTime, duration, completed);

    /* Fin de lecture : on scrobble aussi côté Plex. Redondant quand la lecture
       passe par le compte relié (Plex l'a déjà noté), mais indispensable pour
       une lecture directe ou terminée hors ligne — et scrobbler deux fois est
       sans effet de bord. On ne le fait qu'au PASSAGE à « vu ». */
    if (completed && !dejaVu) marquerSurPlex(req.user.id, mediaId, true);
    // On le regarde de nouveau : il a sa place dans « Reprendre ».
    db.prepare('DELETE FROM continue_hidden WHERE userId = ? AND mediaId = ?').run(req.user.id, mediaId);
    // Un épisode de plus peut compléter une série : la coche doit suivre.
    seriesVuesCache.delete(req.user.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('Progress save error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Get progress for a specific media
app.get('/api/progress/:mediaId', authMiddleware, (req, res) => {
  const progress = db.prepare('SELECT * FROM watch_progress WHERE userId = ? AND mediaId = ?').get(req.user.id, req.params.mediaId);
  res.json({ progress: progress || null });
});

// Get all completed media IDs for a user
/* Titres marqués « vu », pour la petite coche sur les affiches.

   ⚠️ Une SÉRIE n'est jamais dans `watch_progress` : seuls ses épisodes y
   figurent. Résultat, une série entièrement regardée n'affichait aucune coche
   nulle part — 419 films marqués vus contre 0 série (constaté le 2026-08-23).
   On ajoute donc les séries dont TOUS les épisodes présents sur Nova sont vus.
   Pas celles à moitié entamées : une coche à moitié vraie est pire que pas de
   coche du tout. Résultat mis en cache 10 min, l'appel est fait à chaque page. */
const seriesVuesCache = new Map();   // userId → { at, ids }

async function seriesEntierementVues(userId) {
  const hit = seriesVuesCache.get(userId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.ids;

  const vus = new Set(db.prepare('SELECT mediaId FROM watch_progress WHERE userId = ? AND completed = 1')
    .all(userId).map((r) => String(r.mediaId)));

  // Séries candidates : celles dont au moins un épisode est vu.
  const candidates = db.prepare(`
    SELECT DISTINCT m.seriesId FROM watch_progress w
    JOIN media_index m ON m.mediaId = w.mediaId
    WHERE w.userId = ? AND w.completed = 1 AND m.type = 'episode' AND m.seriesId IS NOT NULL
  `).all(userId).map((r) => String(r.seriesId));

  const ids = [];
  for (const serie of candidates.slice(0, 60)) {
    try {
      const eps = await episodesDeSerie(serie);
      if (eps.length && eps.every((e) => vus.has(String(e.ratingKey)))) ids.push(serie);
    } catch { /* série illisible : on la laisse sans coche */ }
  }

  seriesVuesCache.set(userId, { at: Date.now(), ids });
  return ids;
}

app.get('/api/progress/all/completed', authMiddleware, async (req, res) => {
  const items = db.prepare('SELECT mediaId FROM watch_progress WHERE userId = ? AND completed = 1').all(req.user.id);
  let series = [];
  try { series = await seriesEntierementVues(req.user.id); } catch { /* on renvoie au moins les titres directs */ }
  res.json({ watchedIds: [...items.map((i) => i.mediaId), ...series] });
});

// Full watch history for the logged-in user
app.get('/api/history', authMiddleware, (req, res) => {
  const items = db.prepare(`
    SELECT * FROM watch_progress
    WHERE userId = ? AND currentTime > 0
    ORDER BY updatedAt DESC
    LIMIT 200
  `).all(req.user.id);
  res.json({ items });
});

/* ══ « Reprendre » ════════════════════════════════════════════════════
   Deux sources : ce qui est commencé (position > 30 s) ET, quand un
   épisode vient d'être terminé, LE SUIVANT de la série — sinon finir
   l'épisode 1 faisait disparaître la série de la rangée, alors que c'est
   précisément là qu'on veut retrouver l'épisode 2.
   Une croix permet d'écarter une entrée : elle est mémorisée ici. */
db.exec(`CREATE TABLE IF NOT EXISTS continue_hidden (
  userId INTEGER NOT NULL,
  mediaId TEXT NOT NULL,
  at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (userId, mediaId)
)`);

/* Un épisode ne change jamais de série ni de numéro : on retient la
   correspondance une fois pour toutes, ça évite de réinterroger Plex. */
db.exec(`CREATE TABLE IF NOT EXISTS media_index (
  mediaId TEXT PRIMARY KEY,
  type TEXT,
  seriesId TEXT,
  seasonIndex INTEGER,
  episodeIndex INTEGER,
  thumb TEXT,
  art TEXT,
  at TEXT
)`);
for (const col of ['thumb', 'art']) {
  try { db.exec(`ALTER TABLE media_index ADD COLUMN ${col} TEXT`); } catch { /* déjà là */ }
}

async function infoMedia(mediaId) {
  const cache = db.prepare('SELECT * FROM media_index WHERE mediaId = ?').get(String(mediaId));
  // Les images peuvent changer quand Plex rafraîchit ses métadonnées : on
  // revalide au bout d'une semaine. Le reste (série, numéro) ne bouge jamais.
  if (cache && cache.at && Date.now() - new Date(cache.at + 'Z').getTime() < 7 * 86400000) return cache;
  try {
    const d = await plexJson(`/library/metadata/${mediaId}`);
    const m = (d?.MediaContainer?.Metadata || [])[0];
    if (!m) return cache || null;
    const row = {
      mediaId: String(mediaId), type: m.type || '',
      seriesId: m.grandparentRatingKey ? String(m.grandparentRatingKey) : null,
      seasonIndex: m.parentIndex ?? null, episodeIndex: m.index ?? null,
      // épisode → sa vignette 16:9 ; film → son fond d'écran, sinon l'affiche
      thumb: m.thumb || null,
      art: m.art || m.grandparentArt || null,
    };
    db.prepare(`INSERT INTO media_index (mediaId, type, seriesId, seasonIndex, episodeIndex, thumb, art, at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(mediaId) DO UPDATE SET type = excluded.type, seriesId = excluded.seriesId,
                  seasonIndex = excluded.seasonIndex, episodeIndex = excluded.episodeIndex,
                  thumb = excluded.thumb, art = excluded.art, at = datetime('now')`)
      .run(row.mediaId, row.type, row.seriesId, row.seasonIndex, row.episodeIndex, row.thumb, row.art);
    return row;
  } catch { return cache || null; }
}

const epsCache = new Map();   // seriesId → { at, eps }
async function episodesDeSerie(seriesId) {
  const hit = epsCache.get(String(seriesId));
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.eps;
  try {
    // `allLeaves` = tous les épisodes de la série, saisons confondues, dans l'ordre
    const d = await plexJson(`/library/metadata/${seriesId}/allLeaves`);
    const eps = (d?.MediaContainer?.Metadata || []).map((m) => ({
      ratingKey: String(m.ratingKey), index: m.index, parentIndex: m.parentIndex,
      title: m.title, thumb: m.thumb, duration: m.duration,
      grandparentTitle: m.grandparentTitle, grandparentThumb: m.grandparentThumb,
    }));
    epsCache.set(String(seriesId), { at: Date.now(), eps });
    return eps;
  } catch { return []; }
}

app.get('/api/progress/list/continue', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const masques = new Set(db.prepare('SELECT mediaId FROM continue_hidden WHERE userId = ?').all(userId).map((r) => String(r.mediaId)));
    const vus = new Set(db.prepare('SELECT mediaId FROM watch_progress WHERE userId = ? AND completed = 1').all(userId).map((r) => String(r.mediaId)));

    const enCours = db.prepare(`
      SELECT * FROM watch_progress
      WHERE userId = ? AND completed = 0 AND currentTime > 30
      ORDER BY updatedAt DESC LIMIT 20
    `).all(userId).filter((r) => !masques.has(String(r.mediaId)));

    /* Chemin d'image FRAIS pour chaque carte. L'URL mémorisée dans
       `mediaPoster` contient un jeton court : passé quelques heures, l'image ne
       se charge plus (carte noire). On renvoie donc le chemin brut, que le
       client transforme en URL au bon format et avec un jeton valide. */
    const seriesVues = new Set();
    for (const r of enCours) {
      const info = await infoMedia(r.mediaId);
      if (info?.seriesId) seriesVues.add(info.seriesId);
      r.thumbPath = info ? (info.type === 'episode' ? (info.thumb || info.art) : (info.art || info.thumb)) : null;
      r.imageType = info?.type === 'episode' ? 'still' : 'backdrop';

      /* Un épisode commencé s'intitulait « Renaissance » — le titre de
         l'épisode, sans dire de quelle série il s'agit. On affiche la série,
         et le numéro d'épisode passe en sous-titre, comme pour les suites. */
      if (info?.type === 'episode' && info.seriesId) {
        const eps = await episodesDeSerie(info.seriesId);
        const ep = eps.find((e) => e.ratingKey === String(r.mediaId));
        if (ep) {
          r.mediaTitle = ep.grandparentTitle || r.mediaTitle;
          r.sousTitre = `S${ep.parentIndex ?? '?'} É${ep.index ?? '?'} · ${ep.title || ''}`.trim();
        }
      }
    }

    // Épisodes terminés récemment → proposer la suite.
    // 60 et non 15 : une synchro Plex peut horodater beaucoup de titres à la
    // même seconde, une fenêtre trop courte raterait l'épisode qu'on vient de
    // finir.
    const recents = db.prepare(`
      SELECT mediaId, updatedAt FROM watch_progress
      WHERE userId = ? AND completed = 1 ORDER BY updatedAt DESC LIMIT 60
    `).all(userId);

    const suites = [];
    const dejaFait = new Set();
    for (const r of recents) {
      if (suites.length >= 8) break;              // garde-fou : pas 60 appels Plex
      const info = await infoMedia(r.mediaId);
      if (!info || info.type !== 'episode' || !info.seriesId) continue;
      if (seriesVues.has(info.seriesId) || dejaFait.has(info.seriesId)) continue;
      dejaFait.add(info.seriesId);

      const eps = await episodesDeSerie(info.seriesId);
      const i = eps.findIndex((e) => e.ratingKey === String(r.mediaId));
      if (i < 0) continue;
      const suivant = eps.slice(i + 1).find((e) => !vus.has(e.ratingKey));
      if (!suivant || masques.has(suivant.ratingKey)) continue;

      suites.push({
        mediaId: suivant.ratingKey,
        mediaTitle: suivant.grandparentTitle || '',
        mediaType: 'episode',
        currentTime: 0,
        duration: (suivant.duration || 0) / 1000,
        completed: 0,
        updatedAt: r.updatedAt,
        // Le client fabriquera l'URL de l'image au bon format (16:9)
        thumbPath: suivant.thumb || suivant.grandparentThumb || null,
        imageType: 'still',
        sousTitre: `S${suivant.parentIndex ?? '?'} É${suivant.index ?? '?'} · ${suivant.title || ''}`.trim(),
        nextUp: true,
      });
    }

    const items = [...enCours, ...suites]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 20);
    res.json({ items });
  } catch (e) {
    console.error('[Reprendre]', e.message);
    res.json({ items: [] });
  }
});

// Croix sur une carte : on écarte l'entrée sans toucher à la progression.
app.delete('/api/continue/:mediaId', authMiddleware, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO continue_hidden (userId, mediaId) VALUES (?, ?)').run(req.user.id, String(req.params.mediaId));
  res.json({ ok: true });
});

/* ══ Connecteur « Mon compte Plex » ═══════════════════════════════════
   Relier son propre compte Plex (comme sur Overseerr) fait deux choses :
   la lecture est attribuée à CE compte — donc Plex enregistre la
   progression tout seul — et l'état de visionnage déjà présent sur Plex
   est recopié dans Nova. Voir plexLink.js pour le détail du protocole. */
db.exec(`CREATE TABLE IF NOT EXISTS plex_links (
  userId INTEGER PRIMARY KEY REFERENCES users(id),
  plexId TEXT,
  username TEXT,
  email TEXT,
  thumb TEXT,
  token TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  lastSyncAt TEXT,
  lastSyncInfo TEXT
)`);

let MACHINE_ID = null;
plexLink.setClientId(`novastream-${crypto.createHash('sha1').update(JWT_SECRET).digest('hex').slice(0, 16)}`);
// Relu quand l'administrateur change de serveur dans les réglages.
function lireMachineId() {
  MACHINE_ID = null;
  if (!PLEX_URL) return;
  fetch(`${PLEX_URL}/identity`, { headers: { Accept: 'application/json' } })
    .then((r) => r.json())
    .then((d) => { MACHINE_ID = d?.MediaContainer?.machineIdentifier || null; })
    .catch(() => {});
}
lireMachineId();
config.onChange(lireMachineId);

const lienDe = (userId) => db.prepare('SELECT * FROM plex_links WHERE userId = ?').get(userId);

/* Jeton Plex à utiliser pour CETTE requête.
   Compte relié → le sien (la séance s'affiche à son nom et Plex tient sa
   progression à jour) ; sinon le compte partagé « NovaStream ». */
function tokenPour(req) {
  try {
    if (req?.user?.id && !req.user.guest) {
      const l = lienDe(req.user.id);
      if (l?.token) return l.token;
    }
  } catch {}
  return PLEX_STREAM_TOKEN;
}

// PIN en attente, par utilisateur (rien à stocker en base : ça vit 15 min)
const pinsEnCours = new Map();

app.post('/api/connect/plex/start', authMiddleware, async (req, res) => {
  if (estJellyfin()) return res.status(400).json({ error: 'Ce serveur utilise Jellyfin : le connecteur Plex ne s\'applique pas.' });
  try {
    const pin = await plexLink.demarrerPin();
    pinsEnCours.set(req.user.id, { id: pin.id, at: Date.now() });
    res.json({ pinId: pin.id, url: pin.url });
  } catch (e) {
    console.error('[Connect] PIN:', e.message);
    res.status(502).json({ error: 'Plex indisponible' });
  }
});

app.post('/api/connect/plex/finish', authMiddleware, async (req, res) => {
  const attente = pinsEnCours.get(req.user.id);
  if (!attente) return res.status(400).json({ error: 'Aucune connexion en cours' });
  try {
    const token = await plexLink.jetonDuPin(attente.id);
    if (!token) return res.json({ pending: true });

    // Un compte sans accès au serveur ne pourrait ni lire ni écrire : on refuse
    // tout de suite plutôt que de créer une liaison qui casserait la lecture.
    if (!(await plexLink.aAccesAuServeur(token, MACHINE_ID))) {
      pinsEnCours.delete(req.user.id);
      return res.status(403).json({ error: "Ce compte Plex n'a pas accès au serveur. Demande à l'administrateur de te partager la bibliothèque, puis réessaie." });
    }

    const compte = await plexLink.compteDe(token);
    db.prepare(`INSERT INTO plex_links (userId, plexId, username, email, thumb, token, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(userId) DO UPDATE SET
                  plexId = excluded.plexId, username = excluded.username, email = excluded.email,
                  thumb = excluded.thumb, token = excluded.token, createdAt = datetime('now')`)
      .run(req.user.id, compte.plexId, compte.username, compte.email, compte.thumb, token);
    pinsEnCours.delete(req.user.id);

    const info = await synchroniserDepuisPlex(req.user.id);
    console.log(`[Connect] ${req.user.username} ↔ Plex ${compte.username} — ${info.vus} vus, ${info.enCours} en cours`);
    res.json({ connected: true, username: compte.username, sync: info });
  } catch (e) {
    console.error('[Connect] finish:', e.message);
    res.status(502).json({ error: 'Connexion impossible' });
  }
});

app.get('/api/connect', authMiddleware, (req, res) => {
  const l = lienDe(req.user.id);
  res.json({
    plex: l ? { username: l.username, email: l.email, thumb: l.thumb, since: l.createdAt, lastSyncAt: l.lastSyncAt, lastSyncInfo: l.lastSyncInfo } : null,
  });
});

app.delete('/api/connect/plex', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM plex_links WHERE userId = ?').run(req.user.id);
  res.json({ ok: true });
});

app.post('/api/connect/plex/sync', authMiddleware, async (req, res) => {
  if (!lienDe(req.user.id)) return res.status(400).json({ error: 'Aucun compte Plex relié' });
  try {
    res.json(await synchroniserDepuisPlex(req.user.id));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* NOVA → PLEX pour les gestes MANUELS.
   La lecture, elle, remonte toute seule (on diffuse avec le jeton du compte
   relié, donc Plex tient sa progression). Mais « marquer comme vu » est un
   geste propre à Nova : sans cet appel, il ne quittait jamais la base locale.
   `/:/scrobble` est l'API officielle de Plex pour ça — `identifier` est
   obligatoire, sinon Plex ignore silencieusement la demande. */
async function marquerSurPlex(userId, ratingKey, vu = true) {
  // Jellyfin : un seul compte partagé, on y recopie directement.
  if (estJellyfin()) return jelly.marquerVu(ratingKey, vu);
  const lien = lienDe(userId);
  if (!lien?.token) return false;
  const action = vu ? 'scrobble' : 'unscrobble';
  try {
    const r = await fetch(
      `${PLEX_URL}/:/${action}?key=${encodeURIComponent(ratingKey)}&identifier=com.plexapp.plugins.library&X-Plex-Token=${lien.token}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) { console.warn(`[Connect] ${action} ${ratingKey} → ${r.status}`); return false; }
    return true;
  } catch (e) {
    console.warn(`[Connect] ${action} ${ratingKey}:`, e.message);
    return false;
  }
}

/* Recopie l'état de visionnage Plex dans Nova.
   Les identifiants sont communs (le ratingKey Plex EST le mediaId de Nova),
   donc aucun rapprochement par titre n'est nécessaire.
   Règle de fusion : on ne RECULE jamais une progression locale plus avancée —
   sinon regarder sur Nova puis synchroniser ferait perdre du temps de lecture. */
async function synchroniserDepuisPlex(userId) {
  const lien = lienDe(userId);
  if (!lien) throw new Error('non relié');

  const etat = await plexLink.etatDeVisionnage(PLEX_URL, lien.token);
  // Rien d'une bibliothèque privée ne doit entrer dans l'historique de Nova.
  etat.vus = etat.vus.filter((x) => !prive.estTitrePrive(x.id));
  etat.enCours = etat.enCours.filter((x) => !prive.estTitrePrive(x.id));

  /* On horodate avec la DATE DE VISIONNAGE de Plex, pas avec l'heure de la
     synchro. Sinon les 1300 titres vus repartent tous à « maintenant » à chaque
     passage (toutes les 30 min), l'ordre chronologique est détruit et
     « Reprendre » comme l'historique deviennent aléatoires.
     `MAX(...)` protège aussi une progression locale plus récente. */
  const majVu = db.prepare(`
    INSERT INTO watch_progress (userId, mediaId, mediaType, currentTime, duration, completed, updatedAt)
    VALUES (?, ?, ?, 0, 0, 1, ?)
    ON CONFLICT(userId, mediaId) DO UPDATE SET
      completed = 1,
      mediaType = CASE WHEN watch_progress.mediaType = '' THEN excluded.mediaType ELSE watch_progress.mediaType END,
      updatedAt = MAX(watch_progress.updatedAt, excluded.updatedAt)`);

  const majCours = db.prepare(`
    INSERT INTO watch_progress (userId, mediaId, mediaTitle, mediaType, currentTime, duration, completed, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(userId, mediaId) DO UPDATE SET
      currentTime = MAX(watch_progress.currentTime, excluded.currentTime),
      duration = MAX(watch_progress.duration, excluded.duration),
      mediaType = CASE WHEN watch_progress.mediaType = '' THEN excluded.mediaType ELSE watch_progress.mediaType END,
      updatedAt = MAX(watch_progress.updatedAt, excluded.updatedAt)`);

  // Plex donne un horodatage Unix ; sans lui on retombe sur maintenant.
  const quand = (vuLe) => (vuLe > 0
    ? new Date(vuLe * 1000).toISOString().slice(0, 19).replace('T', ' ')
    : new Date().toISOString().slice(0, 19).replace('T', ' '));

  const tout = db.transaction(() => {
    for (const v of etat.vus) majVu.run(userId, String(v.id), v.type || '', quand(v.vuLe));
    for (const e of etat.enCours) majCours.run(userId, e.id, e.titre || '', e.type || '', e.position, e.duree, quand(e.vuLe));
  });
  tout();

  const info = { vus: etat.vus.length, enCours: etat.enCours.length, at: new Date().toISOString() };
  db.prepare('UPDATE plex_links SET lastSyncAt = datetime(\'now\'), lastSyncInfo = ? WHERE userId = ?')
    .run(`${info.vus} vus · ${info.enCours} en cours`, userId);
  return info;
}

// Rafraîchissement régulier : ce qui est regardé sur l'appli Plex (télé,
// téléphone) remonte dans Nova sans que personne n'ait à cliquer.
setInterval(() => {
  const liens = db.prepare('SELECT userId FROM plex_links').all();
  for (const l of liens) {
    synchroniserDepuisPlex(l.userId).catch((e) => console.warn('[Connect] sync', l.userId, e.message));
  }
}, 30 * 60 * 1000);

// Mark as watched (Remove from continue watching but keep progress)
app.delete('/api/progress/:mediaId', authMiddleware, (req, res) => {
  try {
    /* UPSERT et non UPDATE : marquer « vu » un titre jamais commencé ne créait
       aucune ligne, donc ne marquait rien du tout côté Nova. */
    db.prepare(`
      INSERT INTO watch_progress (userId, mediaId, mediaType, currentTime, duration, completed, updatedAt)
      VALUES (?, ?, '', 0, 0, 1, datetime('now'))
      ON CONFLICT(userId, mediaId) DO UPDATE SET completed = 1, updatedAt = datetime('now')
    `).run(req.user.id, req.params.mediaId);
    // Compte Plex relié : le titre doit aussi passer en « vu » là-bas.
    marquerSurPlex(req.user.id, req.params.mediaId, true);
    res.json({ ok: true });
  } catch (err) {
    console.error('Progress update error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════
//  FAVORITES ROUTES (per-user, server-side)
// ═══════════════════════════════════════════════════════════

app.get('/api/favorites', authMiddleware, (req, res) => {
  const favorites = db.prepare('SELECT * FROM favorites WHERE userId = ? ORDER BY createdAt DESC').all(req.user.id);
  res.json({ favorites });
});

app.get('/api/favorites/ids', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT mediaId FROM favorites WHERE userId = ?').all(req.user.id);
  res.json({ ids: rows.map(r => r.mediaId) });
});

app.post('/api/favorites', authMiddleware, (req, res) => {
  try {
    const { mediaId, mediaTitle, mediaPoster, mediaType } = req.body;
    if (!mediaId) return res.status(400).json({ error: 'mediaId requis' });
    db.prepare(`
      INSERT INTO favorites (userId, mediaId, mediaTitle, mediaPoster, mediaType)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId, mediaId) DO NOTHING
    `).run(req.user.id, mediaId, mediaTitle || '', mediaPoster || '', mediaType || '');
    res.json({ ok: true });
  } catch (err) {
    console.error('Favorite add error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/favorites/:mediaId', authMiddleware, (req, res) => {
  try {
    db.prepare('DELETE FROM favorites WHERE userId = ? AND mediaId = ?').run(req.user.id, req.params.mediaId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Favorite delete error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════
//  CONTENT REQUESTS — "Demander un film" (TMDB search → request)
// ═══════════════════════════════════════════════════════════
const IMG = (p, size = 'w342') => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);
// getter : le jeton peut changer depuis les réglages sans redémarrage
const tmdbHeaders = { get Authorization() { return `Bearer ${TMDB_TOKEN}`; }, Accept: 'application/json' };
const yearOf = (r) => (r.release_date || r.first_air_date || '').slice(0, 4) || null;

// Search TMDB (movies + shows) for the request picker.
app.get('/api/requests/search', authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json({ results: [] });
    const url = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(q)}&include_adult=false&language=fr-FR&page=1`;
    const r = await fetch(url, { headers: tmdbHeaders });
    const data = await r.json();
    const results = (data.results || [])
      .filter((x) => (x.media_type === 'movie' || x.media_type === 'tv') && (x.poster_path || x.backdrop_path))
      .slice(0, 40)
      .map((x) => ({
        tmdbId: String(x.id),
        type: x.media_type,
        title: x.title || x.name,
        year: yearOf(x),
        poster: IMG(x.poster_path),
        backdrop: IMG(x.backdrop_path, 'w780'),
        overview: x.overview || '',
        rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : null,
      }));
    res.json({ results });
  } catch (e) {
    console.error('[Requests] search error:', e.message);
    res.status(502).json({ error: 'Recherche indisponible' });
  }
});

/* La SAGA complète d'un film TMDB (« tous les Evil Dead »), pour la montrer
   dans la fenêtre de demande : on voit d'un coup ce qu'on a déjà et ce qui
   manque, au lieu de rechercher les épisodes un par un.
   Différent de /api/saga/:ratingKey, qui part d'un titre DÉJÀ sur Nova. */
const collectionCache = new Map();   // idCollection → { at, films }
app.get('/api/requests/collection/:id', authMiddleware, async (req, res) => {
  const id = String(req.params.id).replace(/\D/g, '');
  if (!id) return res.json({ films: [] });
  const hit = collectionCache.get(id);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return res.json({ films: hit.films });
  try {
    const d = await tmdbGet(`/collection/${id}`);
    const films = (d?.parts || [])
      .filter((p) => p.release_date)                       // on écarte les films annoncés sans date
      .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''))
      .map((p) => ({
        tmdbId: String(p.id),
        type: 'movie',
        title: p.title || p.name,
        year: (p.release_date || '').slice(0, 4),
        poster: IMG(p.poster_path),
        overview: p.overview || '',
        rating: p.vote_average ? Math.round(p.vote_average * 10) / 10 : null,
      }));
    collectionCache.set(id, { at: Date.now(), films });
    res.json({ films, name: d?.name || '' });
  } catch (e) {
    console.error('[Requests] collection:', e.message);
    res.json({ films: [] });
  }
});

/* Parcours par THÈME, pour demander sans avoir de titre en tête.
   TMDB `discover` trié par popularité, avec un plancher de votes : sans lui on
   remonte des films inconnus à 10/10 notés trois fois. */
app.get('/api/requests/browse', authMiddleware, async (req, res) => {
  try {
    const type = req.query.type === 'tv' ? 'tv' : 'movie';
    const page = Math.min(5, Math.max(1, parseInt(req.query.page, 10) || 1));

    /* Thème maison : les films de la sélection « Horreur + » qui NE SONT PAS
       encore sur Nova (voir horrorPlus.js). Les identifiants TMDB sont déjà
       connus, il ne reste qu'à récupérer titre et affiche. */
    if (req.query.genre === 'horreurplus') {
      if (Date.now() - horrorCache.at > HORROR_TTL) await startHorrorBuild();
      const manquants = horrorCache.manquants || [];
      const results = [];
      for (const f of manquants) {
        const fiche = await tmdbGet(`/movie/${f.tmdb}`).catch(() => null);
        if (!fiche) continue;
        results.push({
          tmdbId: String(f.tmdb), type: 'movie',
          title: fiche.title || f.title,
          year: (fiche.release_date || '').slice(0, 4) || f.year,
          poster: IMG(fiche.poster_path),
          backdrop: IMG(fiche.backdrop_path, 'w780'),
          overview: fiche.overview || '',
          rating: fiche.vote_average ? Math.round(fiche.vote_average * 10) / 10 : null,
        });
      }
      return res.json({ results, page: 1, pages: 1 });
    }

    const genre = String(req.query.genre || '').replace(/[^\d,]/g, '');
    if (!genre) return res.json({ results: [] });

    const qs = new URLSearchParams({
      language: 'fr-FR',
      include_adult: 'false',
      sort_by: 'popularity.desc',
      with_genres: genre,
      'vote_count.gte': '150',
      page: String(page),
    });
    const r = await fetch(`https://api.themoviedb.org/3/discover/${type}?${qs}`, { headers: tmdbHeaders });
    if (!r.ok) throw new Error(`TMDB ${r.status}`);
    const data = await r.json();

    const results = (data.results || [])
      .filter((x) => x.poster_path || x.backdrop_path)
      .map((x) => ({
        tmdbId: String(x.id),
        type,
        title: x.title || x.name,
        year: yearOf(x),
        poster: IMG(x.poster_path),
        backdrop: IMG(x.backdrop_path, 'w780'),
        overview: x.overview || '',
        rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : null,
      }));
    res.json({ results, page, pages: Math.min(5, data.total_pages || 1) });
  } catch (e) {
    console.error('[Requests] browse error:', e.message);
    res.status(502).json({ error: 'Thèmes indisponibles' });
  }
});

// Full TMDB details for the request detail view.
app.get('/api/requests/details/:type/:tmdbId', authMiddleware, async (req, res) => {
  try {
    const type = req.params.type === 'movie' ? 'movie' : 'tv';
    const r = await fetch(`https://api.themoviedb.org/3/${type}/${req.params.tmdbId}?language=fr-FR&append_to_response=credits`, { headers: tmdbHeaders });
    if (!r.ok) return res.status(404).json({ error: 'Introuvable sur TMDB' });
    const d = await r.json();
    res.json({
      tmdbId: String(d.id),
      type,
      title: d.title || d.name,
      year: yearOf(d),
      poster: IMG(d.poster_path, 'w500'),
      backdrop: IMG(d.backdrop_path, 'w1280'),
      overview: d.overview || '',
      rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
      runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null,
      genres: (d.genres || []).map((g) => g.name),
      cast: (d.credits?.cast || []).slice(0, 8).map((c) => ({ name: c.name, character: c.character, photo: IMG(c.profile_path, 'w185') })),
      collection: d.belongs_to_collection
        ? { id: String(d.belongs_to_collection.id), name: d.belongs_to_collection.name }
        : null,
    });
  } catch (e) {
    console.error('[Requests] details error:', e.message);
    res.status(502).json({ error: 'Détails indisponibles' });
  }
});

// Create a request.
app.post('/api/requests', authMiddleware, (req, res) => {
  try {
    if (req.user.guest) return res.status(403).json({ error: 'Non autorisé' });
    const { tmdbId, mediaType, title, year, poster } = req.body || {};
    if (!tmdbId || !['movie', 'tv'].includes(mediaType)) return res.status(400).json({ error: 'Requête invalide' });
    db.prepare(`
      INSERT INTO content_requests (userId, tmdbId, mediaType, title, year, poster)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId, tmdbId, mediaType) DO NOTHING
    `).run(req.user.id, String(tmdbId), mediaType, (title || '').slice(0, 200), (year || '') + '', (poster || '').slice(0, 500));
    logActivity(req.user.id, 'request', String(tmdbId), title || '');
    // Recherche immediate des sources (sans telechargement) - en tache de fond.
    try {
      const created = db.prepare('SELECT * FROM content_requests WHERE userId = ? AND tmdbId = ? AND mediaType = ?')
        .get(req.user.id, String(tmdbId), mediaType);
      if (created) setTimeout(() => runSearchForRequest(created), 100);
    } catch { /* la demande existe, c'est l'essentiel */ }
    // Prévenir les admins qu'il y a une demande à traiter.
    try {
      const admins = db.prepare('SELECT id FROM users WHERE isAdmin = 1 AND id != ?').all(req.user.id);
      for (const a of admins) {
        pushToUser(a.id, {
          title: 'Nouvelle demande',
          body: `${req.user.username || 'Quelqu’un'} demande « ${title || 'un titre'} ».`,
          url: '/requests',
          tag: 'new-request',
        });
      }
    } catch { /* la notification est un bonus, jamais bloquante */ }
    res.json({ ok: true });
  } catch (e) {
    console.error('[Requests] create error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// List requests: own by default; admins get everyone's (with usernames).
app.get('/api/requests', authMiddleware, (req, res) => {
  try {
    if (req.user.isAdmin && req.query.all === '1') {
      const rows = db.prepare(`
        SELECT cr.*, u.username FROM content_requests cr
        JOIN users u ON cr.userId = u.id
        ORDER BY (cr.status = 'pending') DESC, cr.createdAt DESC
      `).all();
      return res.json({ requests: rows, admin: true });
    }
    const rows = db.prepare('SELECT * FROM content_requests WHERE userId = ? ORDER BY createdAt DESC').all(req.user.id);
    res.json({ requests: rows, admin: false });
  } catch (e) {
    console.error('[Requests] list error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Admin: update a request's status.
/* ══ VF ou VO, episode par episode ═══════════════════════════════════
   Pour un anime, la VO sort chaque semaine et la VF suit avec du retard :
   quand l'episode 4 sort en japonais, l'episode 2 arrive en francais.

   On mesure ce retard au lieu de le supposer : « dernier episode dispo en
   VO » moins « dernier episode dispo en VF » donne un DECALAGE en episodes,
   qui se convertit en date via le calendrier de diffusion. */
const versionsCache = new Map();   // ratingKey -> { at, data }

app.get('/api/versions/:ratingKey', authMiddleware, async (req, res) => {
  try {
    const key = String(req.params.ratingKey);
    const season = Number(req.query.season || 1);
    const cacheKey = `${key}:${season}`;
    const hit = versionsCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 600 * 1000) return res.json(hit.data);

    // Section de la serie (pour interroger les bons filtres Plex)
    const meta = await plexJson(`/library/metadata/${encodeURIComponent(key)}`);
    const show = meta?.MediaContainer?.Metadata?.[0];
    if (!show) return res.json({ supported: false });
    const sectionId = show.librarySectionID;

    const mine = (m) => String(m.grandparentRatingKey) === key && Number(m.parentIndex) === season;
    const all = ((await plexJson(`/library/sections/${sectionId}/all?type=4&${EXCLUDE}`))?.MediaContainer?.Metadata || []).filter(mine);
    if (!all.length) return res.json({ supported: false });

    /* On interroge TOUTES les langues declarees de la bibliotheque, pas
       seulement « fr » : le francais s'y trouve aussi sous fr-FR ou fr-CA.
       Et surtout, beaucoup de fichiers sont mal etiquetes (« Avestique »,
       « undetermined »…) : une langue absurde ne veut pas dire « pas de
       francais », elle veut dire « on ne sait pas ». On la traite donc
       comme du francais, comme pour les etiquettes d'affiche. */
    const langs = await plexJson(`/library/sections/${sectionId}/audioLanguage`)
      .then((d) => (d?.MediaContainer?.Directory || []).map((x) => x.key).filter(Boolean))
      .catch(() => ['fr']);
    const estFr = (k) => /^fr(-|$)/i.test(k);
    const estAbsurde = (k) => /^(ave|ae|und|mis|mul|zxx|xx|qaa|zz)$/i.test(k);

    const frKeys = new Set();
    const autresKeys = new Set();
    for (const k of langs.slice(0, 30)) {
      if (estAbsurde(k)) continue;
      const cible = estFr(k) ? frKeys : autresKeys;
      try {
        const d = await plexJson(`/library/sections/${sectionId}/all?type=4&audioLanguage=${encodeURIComponent(k)}&${EXCLUDE}`);
        (d?.MediaContainer?.Metadata || []).filter(mine).forEach((e) => cible.add(String(e.ratingKey)));
      } catch { /* une langue muette n'empeche pas les autres */ }
    }

    const enFrancais = (e) => {
      const id = String(e.ratingKey);
      if (frKeys.has(id)) return true;
      // aucune langue identifiee : indetermine, donc considere francais
      return !autresKeys.has(id);
    };

    const vf = all.filter(enFrancais).map((e) => Number(e.index)).sort((a, b) => a - b);
    const vo = all.map((e) => Number(e.index)).sort((a, b) => a - b);

    // Decalage en episodes : 0 si la VF suit le rythme, null si pas de VF du tout
    let offset = null;
    if (vf.length && vo.length) offset = Math.max(0, Math.max(...vo) - Math.max(...vf));

    const data = {
      supported: true,
      vf,                                  // episodes disponibles en francais
      vo,                                  // episodes disponibles (toutes versions)
      offset,                              // retard de la VF, en episodes
      partial: !!vf.length && vf.length < vo.length,
      none: vf.length === 0,
    };
    versionsCache.set(cacheKey, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    console.warn('[Versions]', e.message);
    res.json({ supported: false });
  }
});

/* ══ Episodes a venir ════════════════════════════════════════════════
   Plex ne connait que ce qu'on possede. TMDB, lui, connait le calendrier
   complet d'une saison : on peut donc afficher les episodes pas encore
   sortis, avec leur date. Le decompte lui-meme est calcule cote client
   pour rester juste a la minute pres. */
const upcomingCache = new Map();   // "ratingKey:saison" -> { at, data }

app.get('/api/upcoming/:ratingKey', authMiddleware, async (req, res) => {
  try {
    const key = String(req.params.ratingKey);
    const season = Number(req.query.season || 1);
    const cacheKey = `${key}:${season}`;
    const hit = upcomingCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 3600 * 1000) return res.json(hit.data);

    const items = await loadAllLibraryItems();
    const me = items.find((x) => String(x.item.ratingKey) === key);
    if (!me || me.type !== 'tv') return res.json({ episodes: [] });

    const d = await tmdbGet(`/tv/${me.tmdbId}/season/${season}`).catch(() => null);
    if (!d || !Array.isArray(d.episodes)) return res.json({ episodes: [] });

    const today = new Date().toISOString().slice(0, 10);
    let episodes = d.episodes.map((e) => ({
      number: e.episode_number,
      title: e.name || `Épisode ${e.episode_number}`,
      overview: e.overview || '',
      still: e.still_path ? IMG(e.still_path, 'w300') : null,
      airDate: e.air_date || null,
      airTime: null,
      // « sorti » au sens diffusion : la date est passee (ou inconnue)
      aired: !e.air_date || e.air_date <= today,
    }));

    /* Sonarr connait l'HEURE de diffusion, pas seulement le jour. On ne le
       derange que s'il reste vraiment des episodes a venir, et la serie y
       est ajoutee non surveillee : elle sert de calendrier, rien de plus. */
    if (arr.arrConfigured() && episodes.some((e) => !e.aired)) {
      try {
        let tvdbId = null;
        const ext = await fetch(`https://api.themoviedb.org/3/tv/${me.tmdbId}/external_ids`, { headers: tmdbHeaders });
        if (ext.ok) tvdbId = (await ext.json()).tvdb_id || null;

        const isAnime = String(me.item.librarySectionTitle || '').toLowerCase().includes('anim');
        const seriesId = await arr.ensureSeriesForSchedule({
          tvdbId, title: me.item.title, year: me.item.year, isAnime,
        });
        if (seriesId) {
          const times = await arr.airTimes(seriesId, season);
          const now = Date.now();
          episodes = episodes.map((e) => {
            const iso = times[String(e.number)];
            if (!iso) return e;
            return { ...e, airTime: iso, aired: new Date(iso).getTime() <= now };
          });
        }
      } catch (e) {
        console.warn('[Upcoming] horaires Sonarr :', e.message);
      }
    }

    const data = { episodes, seasonName: d.name || null };
    /* Si Sonarr n'avait pas encore les horaires, on ne fige pas le resultat
       une heure : un cache court laisse la prochaine visite les recuperer. */
    const complet = episodes.filter((e) => !e.aired).every((e) => e.airTime);
    upcomingCache.set(cacheKey, { at: complet ? Date.now() : Date.now() - 3300 * 1000, data });
    res.json(data);
  } catch (e) {
    console.warn('[Upcoming]', e.message);
    res.json({ episodes: [] });
  }
});

/* ══ Sagas : les autres films de la meme collection ══════════════════
   TMDB sait que Saw 1 a 10 forment une collection. On la recupere, et on
   marque ce qui est deja sur Nova (index tmdbId -> ratingKey). Les
   manquants restent affiches, en grise, et sont demandables. */
const sagaCache = new Map();   // ratingKey -> { at, data }

app.get('/api/saga/:ratingKey', authMiddleware, async (req, res) => {
  try {
    const key = String(req.params.ratingKey);
    const hit = sagaCache.get(key);
    if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return res.json(hit.data);

    // Identifiant TMDB du titre courant, via les guids de la bibliotheque
    const items = await loadAllLibraryItems();
    const me = items.find((x) => String(x.item.ratingKey) === key);
    if (!me || me.type !== 'movie') return res.json({ saga: null });

    const movie = await tmdbGet(`/movie/${me.tmdbId}`);
    const col = movie.belongs_to_collection;
    if (!col) {
      const data = { saga: null };
      sagaCache.set(key, { at: Date.now(), data });
      return res.json(data);
    }

    const full = await tmdbGet(`/collection/${col.id}`);
    const index = await getTmdbIndex();
    const parts = (full.parts || [])
      .filter((x) => x.poster_path)
      .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'))
      .map((x) => {
        const local = index.get(`movie:${x.id}`) || null;
        return {
          tmdbId: String(x.id),
          type: 'movie',
          title: x.title,
          year: (x.release_date || '').slice(0, 4) || null,
          poster: IMG(x.poster_path),
          backdrop: IMG(x.backdrop_path, 'w780'),
          overview: x.overview || '',
          rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : null,
          ratingKey: local ? local.ratingKey : null,
          inNova: !!local,
          isCurrent: String(x.id) === String(me.tmdbId),
        };
      });

    const data = {
      saga: {
        name: (full.name || col.name || '').replace(/\s*[-–]?\s*(Collection|Saga|Trilogie|Anthologie)\s*$/i, '').trim(),
        total: parts.length,
        onNova: parts.filter((x) => x.inNova).length,
        parts,
      },
    };
    sagaCache.set(key, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    console.warn('[Saga]', e.message);
    res.json({ saga: null });
  }
});

/* == Radarr / Sonarr : recherche a la demande =========================
   Quand quelqu'un demande un titre, on cherche AUSSITOT les sources
   disponibles - sans rien telecharger. Le bot Discord presente la liste,
   la decision (telecharger telle source / refuser) revient ici, et le
   statut de la demande suit. */

/* La table request_search existait deja sans ces colonnes : CREATE TABLE
   IF NOT EXISTS ne les ajoute pas, il faut une migration explicite. */
for (const col of ['qbHash TEXT', 'qbName TEXT']) {
  try { db.exec(`ALTER TABLE request_search ADD COLUMN ${col}`); } catch { /* deja presente */ }
}

const setSearch = db.prepare(`INSERT INTO request_search (requestId, arrKind, arrId, season, addedByNova, releases, state, error, updatedAt)
  VALUES (@requestId, @arrKind, @arrId, @season, @addedByNova, @releases, @state, @error, datetime('now'))
  ON CONFLICT(requestId) DO UPDATE SET arrKind=excluded.arrKind, arrId=excluded.arrId, season=excluded.season,
    addedByNova=excluded.addedByNova, releases=excluded.releases, state=excluded.state, error=excluded.error,
    updatedAt=datetime('now')`);

// Un anime = animation + origine japonaise. Nova connait deja les deux.
async function looksLikeAnime({ tmdbId, mediaType }) {
  try {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const r = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}`, { headers: tmdbHeaders });
    if (!r.ok) return false;
    const d = await r.json();
    const animation = (d.genres || []).some((g) => g.id === 16);
    return animation && ['ja', 'ko', 'zh'].includes(d.original_language);
  } catch {
    return false;
  }
}

async function runSearchForRequest(reqRow) {
  if (!arr.arrConfigured()) return;
  const base = { requestId: reqRow.id, arrKind: null, arrId: null, season: null, addedByNova: 0, releases: null, state: 'searching', error: null };
  setSearch.run(base);
  try {
    const isAnime = await looksLikeAnime({ tmdbId: reqRow.tmdbId, mediaType: reqRow.mediaType });
    let out;
    if (reqRow.mediaType === 'tv') {
      // Sonarr travaille avec TVDB : on convertit l'identifiant TMDB.
      let tvdbId = null;
      try {
        const r = await fetch(`https://api.themoviedb.org/3/tv/${reqRow.tmdbId}/external_ids`, { headers: tmdbHeaders });
        if (r.ok) tvdbId = (await r.json()).tvdb_id || null;
      } catch { /* on retombera sur le titre */ }
      out = await arr.searchSeries({ tvdbId, title: reqRow.title, year: reqRow.year, isAnime });
    } else {
      out = await arr.searchMovie({ tmdbId: reqRow.tmdbId, title: reqRow.title, year: reqRow.year });
    }
    setSearch.run({
      requestId: reqRow.id,
      arrKind: out.arrKind,
      arrId: out.arrId,
      season: out.season === undefined ? null : out.season,
      addedByNova: out.addedByNova ? 1 : 0,
      releases: JSON.stringify(out.releases || []),
      state: (out.releases || []).length ? 'found' : 'none',
      error: null,
    });
    console.log(`[Arr] « ${reqRow.title} » -> ${(out.releases || []).length} source(s)${isAnime ? ' (anime)' : ''}`);
  } catch (e) {
    setSearch.run({ ...base, state: 'error', error: String(e.message).slice(0, 300) });
    console.error(`[Arr] recherche « ${reqRow.title} » :`, e.message);
  }
}

// -- API reservee au bot Discord (secret partage) --
const BOT_SECRET = process.env.NOVA_BOT_SECRET || '';
function botAuth(req, res, next) {
  if (!BOT_SECRET) return res.status(503).json({ error: 'Pont bot non configure' });
  if ((req.headers['x-nova-bot'] || '') !== BOT_SECRET) return res.status(401).json({ error: 'Non autorise' });
  next();
}

app.get('/api/bot/pending', botAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.title, r.year, r.mediaType, r.poster, r.status, u.username,
           s.state, s.releases, s.arrKind, s.season, s.error, s.notifiedAt
    FROM content_requests r
    LEFT JOIN users u ON u.id = r.userId
    LEFT JOIN request_search s ON s.requestId = r.id
    WHERE r.status = 'pending'
    ORDER BY r.id DESC LIMIT 20`).all();
  res.json({
    requests: rows.map((r) => ({
      ...r,
      releases: r.releases ? JSON.parse(r.releases) : [],
      alreadyNotified: !!r.notifiedAt,
    })),
  });
});

/* Demande passee directement en MP au bot Discord : on cherche le titre
   sur TMDB, on cree la demande au nom de l'admin, et la mecanique habituelle
   (recherche des sources puis message avec boutons) prend le relais. */
app.post('/api/bot/request', botAuth, async (req, res) => {
  try {
    const query = String((req.body && req.body.query) || '').trim().slice(0, 120);
    if (!query) return res.status(400).json({ error: 'Titre manquant' });

    const r = await fetch(
      `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}&include_adult=false&language=fr-FR`,
      { headers: tmdbHeaders }
    );
    const data = await r.json();
    const best = (data.results || []).find((x) => (x.media_type === 'movie' || x.media_type === 'tv') && x.poster_path);
    if (!best) return res.json({ ok: false, reason: 'introuvable' });

    const admin = db.prepare('SELECT id FROM users WHERE isAdmin = 1 ORDER BY id LIMIT 1').get();
    if (!admin) return res.status(500).json({ error: 'Aucun administrateur' });

    const mediaType = best.media_type;
    const title = best.title || best.name || query;
    const year = ((best.release_date || best.first_air_date || '').slice(0, 4)) || '';
    const poster = IMG(best.poster_path);

    // Deja disponible ? Inutile de relancer une recherche.
    const index = await getTmdbIndex();
    const local = index.get(`${mediaType}:${best.id}`);
    if (local) return res.json({ ok: false, reason: 'deja', title, year, ratingKey: local.ratingKey });

    db.prepare(`INSERT INTO content_requests (userId, tmdbId, mediaType, title, year, poster)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(userId, tmdbId, mediaType) DO NOTHING`)
      .run(admin.id, String(best.id), mediaType, title, year, poster || '');

    const created = db.prepare('SELECT * FROM content_requests WHERE userId = ? AND tmdbId = ? AND mediaType = ?')
      .get(admin.id, String(best.id), mediaType);
    if (created) setTimeout(() => runSearchForRequest(created), 100);

    res.json({ ok: true, id: created ? created.id : null, title, year, mediaType });
  } catch (e) {
    console.error('[Bot] demande :', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bot/notified/:id', botAuth, (req, res) => {
  db.prepare(`UPDATE request_search SET notifiedAt = datetime('now') WHERE requestId = ?`).run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/bot/decide/:id', botAuth, async (req, res) => {
  try {
    const { action, index } = req.body || {};
    const reqRow = db.prepare('SELECT * FROM content_requests WHERE id = ?').get(req.params.id);
    const search = db.prepare('SELECT * FROM request_search WHERE requestId = ?').get(req.params.id);
    if (!reqRow) return res.status(404).json({ error: 'Demande introuvable' });

    if (action === 'reject') {
      db.prepare("UPDATE content_requests SET status = 'declined' WHERE id = ?").run(reqRow.id);
      if (search && search.arrId) await arr.removeIfAdded({ arrKind: search.arrKind, arrId: search.arrId, addedByNova: !!search.addedByNova });
      db.prepare("UPDATE request_search SET state = 'rejected', updatedAt = datetime('now') WHERE requestId = ?").run(reqRow.id);
      pushToUser(reqRow.userId, { title: 'Demande refusee', body: `« ${reqRow.title} » n'a pas ete retenu.`, url: '/requests', tag: `req-${reqRow.id}` });
      return res.json({ ok: true, status: 'declined' });
    }

    if (action === 'grab') {
      const releases = search && search.releases ? JSON.parse(search.releases) : [];
      const pick = releases[Number(index) || 0];
      if (!pick) return res.status(400).json({ error: 'Source inconnue' });
      await arr.grab({ arrKind: search.arrKind, guid: pick.guid, indexerId: pick.indexerId });
      await arr.monitorAfterGrab({ arrKind: search.arrKind, arrId: search.arrId });
      db.prepare("UPDATE content_requests SET status = 'approved' WHERE id = ?").run(reqRow.id);
      db.prepare("UPDATE request_search SET state = 'grabbed', chosen = ?, updatedAt = datetime('now') WHERE requestId = ?")
        .run(JSON.stringify(pick), reqRow.id);
      pushToUser(reqRow.userId, { title: 'Demande approuvee', body: `« ${reqRow.title} » est en cours de recuperation.`, url: '/requests', tag: `req-${reqRow.id}` });
      return res.json({ ok: true, status: 'approved', chosen: pick });
    }

    if (action === 'manual') {
      /* « Aucune ne me va, je le prends moi-meme ». Nova arrete de proposer
         et se met a surveiller qBittorrent : des qu'un telechargement dont
         le nom correspond apparait, il est rattache a la demande. */
      db.prepare("UPDATE content_requests SET status = 'approved' WHERE id = ?").run(reqRow.id);
      db.prepare("UPDATE request_search SET state = 'manual', updatedAt = datetime('now') WHERE requestId = ?").run(reqRow.id);
      return res.json({ ok: true, status: 'manual' });
    }

    res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error('[Bot] decision :', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/requests/:id/search', authMiddleware, adminMiddleware, async (req, res) => {
  const row = db.prepare('SELECT * FROM content_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Demande introuvable' });
  runSearchForRequest(row);
  res.json({ ok: true });
});

app.get('/api/requests/:id/search', authMiddleware, (req, res) => {
  const s = db.prepare('SELECT * FROM request_search WHERE requestId = ?').get(req.params.id);
  if (!s) return res.json({ state: 'idle', releases: [] });
  res.json({ ...s, releases: s.releases ? JSON.parse(s.releases) : [], chosen: s.chosen ? JSON.parse(s.chosen) : null });
});

// Ou en est le telechargement d'une demande approuvee ?
app.get('/api/requests/:id/progress', authMiddleware, async (req, res) => {
  try {
    const row = db.prepare(`SELECT r.id, r.title, r.year, r.status, s.state, s.arrKind, s.arrId, s.qbHash
      FROM content_requests r LEFT JOIN request_search s ON s.requestId = r.id WHERE r.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Demande introuvable' });

    // Telechargement repere dans qBittorrent (ajout manuel)
    if (row.qbHash) {
      const st = await qbit.statusOf(row.qbHash).catch(() => null);
      if (st) return res.json({ source: 'manuel', percent: st.progress, state: st.state, eta: st.etaSeconds, name: st.name });
    }
    // Sinon, la file de Radarr/Sonarr
    if (row.arrId) {
      const pr = await arr.progressOf({ arrKind: row.arrKind, arrId: row.arrId });
      if (pr.downloading) return res.json({ source: 'arr', percent: pr.percent, state: pr.status, eta: pr.eta });
    }
    res.json({ source: null, percent: null, state: row.state });
  } catch (e) {
    res.json({ source: null, percent: null, error: e.message });
  }
});

/* Ajouts manuels : on cherche dans qBittorrent le telechargement qui
   correspond a chaque demande en attente, par comparaison des noms. */
async function pollManualDownloads() {
  if (!qbit.qbitConfigured()) return;
  const rows = db.prepare(`SELECT r.id, r.title, r.year, s.qbHash FROM content_requests r
    JOIN request_search s ON s.requestId = r.id
    WHERE s.state = 'manual' AND s.qbHash IS NULL`).all();
  for (const row of rows) {
    try {
      const hit = await qbit.findForRequest({ title: row.title, year: row.year });
      if (hit) {
        db.prepare("UPDATE request_search SET qbHash = ?, qbName = ?, updatedAt = datetime('now') WHERE requestId = ?")
          .run(hit.hash, hit.name, row.id);
        console.log(`[qBit] « ${row.title} » reconnu : ${hit.name} (score ${hit.score})`);
      }
    } catch (e) {
      console.warn('[qBit]', e.message);
    }
  }
}
setInterval(pollManualDownloads, 60 * 1000);

// Suivi : une fois le fichier importe, la demande passe en « Ajoutee ».
async function pollImports() {
  if (!arr.arrConfigured()) return;
  const rows = db.prepare(`SELECT r.id, r.title, r.userId, s.arrKind, s.arrId, s.state, s.qbHash FROM content_requests r
    JOIN request_search s ON s.requestId = r.id
    WHERE r.status = 'approved' AND s.state IN ('grabbed', 'manual')`).all();
  for (const row of rows) {
    // Telechargement manuel : on attend qu'il soit fini cote qBittorrent.
    if (row.state === 'manual') {
      if (!row.qbHash) continue;
      const st = await qbit.statusOf(row.qbHash).catch(() => null);
      if (!st || !st.done) continue;
      db.prepare("UPDATE content_requests SET status = 'added' WHERE id = ?").run(row.id);
      db.prepare("UPDATE request_search SET state = 'imported', updatedAt = datetime('now') WHERE requestId = ?").run(row.id);
      console.log(`[qBit] « ${row.title} » telecharge manuellement -> demande marquee ajoutee`);
      pushToUser(row.userId, { title: 'Ton film est la', body: `« ${row.title} » est disponible.`, url: '/', tag: `req-${row.id}` });
      continue;
    }
    if (row.arrId && await arr.isImported({ arrKind: row.arrKind, arrId: row.arrId })) {
      db.prepare("UPDATE content_requests SET status = 'added' WHERE id = ?").run(row.id);
      db.prepare("UPDATE request_search SET state = 'imported', updatedAt = datetime('now') WHERE requestId = ?").run(row.id);
      console.log(`[Arr] « ${row.title} » importe -> demande marquee ajoutee`);
      pushToUser(row.userId, { title: 'Ton film est la', body: `« ${row.title} » est disponible sur Nova.`, url: '/', tag: `req-${row.id}` });
    }
  }
}
setInterval(pollImports, 5 * 60 * 1000);

/* ══ Exploration : « trouve-moi des films comme ceux-là » ════════════
   L'utilisateur coche des titres qu'il aime (présents sur Nova ou non) et
   éventuellement des thèmes ; on agrège les recommandations TMDB de chaque
   référence, puis on marque ce qui est déjà dans la bibliothèque. */

// Index TMDB → Plex, pour savoir instantanément ce qui est déjà sur Nova.
let tmdbIndexCache = { at: 0, map: new Map() };
async function getTmdbIndex() {
  if (Date.now() - tmdbIndexCache.at < 600000 && tmdbIndexCache.map.size) return tmdbIndexCache.map;
  const items = await loadAllLibraryItems();
  const map = new Map();
  for (const x of items) {
    map.set(`${x.type}:${x.tmdbId}`, {
      ratingKey: String(x.item.ratingKey),
      title: x.item.title,
      year: x.item.year || null,
    });
  }
  tmdbIndexCache = { at: Date.now(), map };
  return map;
}

async function tmdbGet(pathname, params = {}) {
  const qs = new URLSearchParams({ language: 'fr-FR', ...params });
  const r = await fetch(`https://api.themoviedb.org/3${pathname}?${qs}`, { headers: tmdbHeaders });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

app.get('/api/discover/genres', authMiddleware, async (req, res) => {
  try {
    // `?type=movie|tv` → la liste exacte de ce type. Sans paramètre, on garde
    // la fusion des deux (c'est ce dont l'écran Explorer a besoin).
    if (req.query.type === 'movie' || req.query.type === 'tv') {
      const d = await tmdbGet(`/genre/${req.query.type}/list`).catch(() => ({ genres: [] }));
      return res.json({ genres: d.genres || [] });
    }
    const [mv, tv] = await Promise.all([
      tmdbGet('/genre/movie/list').catch(() => ({ genres: [] })),
      tmdbGet('/genre/tv/list').catch(() => ({ genres: [] })),
    ]);
    const seen = new Map();
    [...(mv.genres || []), ...(tv.genres || [])].forEach((g) => { if (!seen.has(g.name)) seen.set(g.name, g); });
    res.json({ genres: [...seen.values()] });
  } catch {
    res.json({ genres: [] });
  }
});

/* ══ « Pour toi » ══════════════════════════════════════════════════════
   Même principe qu'Explorer, mais SANS rien cocher : les références sont
   les derniers titres réellement terminés. Avec 1300 titres vus dans
   l'historique, la machine a de quoi dire quelque chose de juste.
   Volontairement court : 8 références, `recommendations` seulement (pas
   `similar`), pour que l'accueil n'attende jamais. */
const pourToiCache = new Map();   // userId → { at, items }

app.get('/api/foryou', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const hit = pourToiCache.get(userId);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return res.json({ results: hit.items });

  try {
    const index = await getTmdbIndex();
    // index : "type:tmdbId" → { ratingKey } ; on a besoin de l'inverse
    const parRatingKey = new Map();
    for (const [cle, v] of index) {
      const [type, tmdbId] = cle.split(':');
      parRatingKey.set(String(v.ratingKey), { type, tmdbId });
    }

    const recents = db.prepare(`
      SELECT mediaId FROM watch_progress
      WHERE userId = ? AND completed = 1 ORDER BY updatedAt DESC LIMIT 60
    `).all(userId);

    /* Un épisode ne dit rien à TMDB : on remonte à sa SÉRIE. Et on ne garde
       qu'une référence par œuvre, sinon six épisodes d'une même série
       écraseraient tout le reste. */
    const refs = [];
    const vues = new Set();
    for (const r of recents) {
      if (refs.length >= 8) break;
      let cle = parRatingKey.get(String(r.mediaId));
      if (!cle) {
        const info = await infoMedia(r.mediaId);
        if (info?.seriesId) cle = parRatingKey.get(String(info.seriesId));
      }
      if (!cle || vues.has(cle.tmdbId)) continue;
      vues.add(cle.tmdbId);
      refs.push(cle);
    }
    if (!refs.length) return res.json({ results: [] });

    const scores = new Map();
    await mapLimit(refs, 6, async (ref) => {
      try {
        const d = await tmdbGet(`/${ref.type}/${ref.tmdbId}/recommendations`, { page: '1' });
        (d.results || []).forEach((raw, i) => {
          if (!raw?.id) return;
          const cle = `${ref.type}:${raw.id}`;
          const cur = scores.get(cle) || { raw, kind: ref.type, score: 0, from: new Set() };
          cur.score += Math.max(24 - Math.min(i, 18) * 0.6, 3);
          cur.from.add(ref.tmdbId);
          scores.set(cle, cur);
        });
      } catch { /* une référence muette n'empêche pas les autres */ }
    });

    const dejaVu = new Set(db.prepare('SELECT mediaId FROM watch_progress WHERE userId = ? AND completed = 1').all(userId).map((x) => String(x.mediaId)));

    const items = [...scores.entries()]
      .map(([cle, v]) => {
        const local = index.get(cle) || null;
        return {
          tmdbId: String(v.raw.id), type: v.kind,
          title: v.raw.title || v.raw.name || '',
          year: (v.raw.release_date || v.raw.first_air_date || '').slice(0, 4) || null,
          poster: IMG(v.raw.poster_path), backdrop: IMG(v.raw.backdrop_path, 'w780'),
          rating: v.raw.vote_average ? Math.round(v.raw.vote_average * 10) / 10 : null,
          ratingKey: local?.ratingKey || null,
          inNova: !!local,
          score: v.score + v.from.size * 30,
        };
      })
      .filter((x) => x.title && x.poster)
      .filter((x) => x.inNova && !dejaVu.has(String(x.ratingKey)))   // sur Nova et pas encore vu
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);

    pourToiCache.set(userId, { at: Date.now(), items });
    res.json({ results: items });
  } catch (e) {
    console.error('[Pour toi]', e.message);
    res.json({ results: [] });
  }
});

app.post('/api/discover', authMiddleware, async (req, res) => {
  try {
    if (req.user.guest) return res.status(403).json({ error: 'Non autorisé' });
    const { refs = [], genres = [], minRating = 0, yearFrom = 0, novaOnly = false } = req.body || {};
    const cleanRefs = (Array.isArray(refs) ? refs : []).slice(0, 8)
      .map((r) => ({ tmdbId: String(r.tmdbId || '').replace(/\D/g, ''), type: r.type === 'tv' ? 'tv' : 'movie' }))
      .filter((r) => r.tmdbId);

    const scores = new Map();  // clé "type:id" → { item, score, from:Set }
    const add = (raw, kind, weight, fromId) => {
      if (!raw?.id) return;
      const key = `${kind}:${raw.id}`;
      const cur = scores.get(key) || { raw, kind, score: 0, from: new Set() };
      cur.score += weight;
      if (fromId) cur.from.add(fromId);
      scores.set(key, cur);
    };

    if (cleanRefs.length) {
      // Les recommandations de TMDB sont ordonnées : les premières pèsent plus.
      await mapLimit(cleanRefs, 6, async (ref) => {
        for (const endpoint of ['recommendations', 'similar']) {
          try {
            const d = await tmdbGet(`/${ref.type}/${ref.tmdbId}/${endpoint}`, { page: '1' });
            (d.results || []).forEach((raw, i) => {
              const w = (endpoint === 'recommendations' ? 24 : 14) - Math.min(i, 18) * 0.6;
              add(raw, ref.type, Math.max(w, 3), ref.tmdbId);
            });
          } catch { /* une référence muette n'empêche pas les autres */ }
        }
      });
    } else if (genres.length) {
      // Sans référence, on part des thèmes seuls.
      const ids = genres.map((g) => String(g).replace(/\D/g, '')).filter(Boolean).join(',');
      for (const kind of ['movie', 'tv']) {
        try {
          const d = await tmdbGet(`/discover/${kind}`, {
            with_genres: ids, sort_by: 'vote_average.desc', 'vote_count.gte': '300', page: '1',
          });
          (d.results || []).forEach((raw, i) => add(raw, kind, 20 - Math.min(i, 18) * 0.5));
        } catch { /* ignore */ }
      }
    } else {
      return res.json({ results: [] });
    }

    const index = await getTmdbIndex();
    const refKeys = new Set(cleanRefs.map((r) => `${r.type}:${r.tmdbId}`));
    const wantedGenres = new Set(genres.map((g) => Number(g)).filter(Boolean));

    let out = [...scores.entries()]
      .filter(([key]) => !refKeys.has(key))
      .map(([key, v]) => {
        const local = index.get(key) || null;
        const raw = v.raw;
        return {
          tmdbId: String(raw.id),
          type: v.kind,
          title: raw.title || raw.name || '',
          year: (raw.release_date || raw.first_air_date || '').slice(0, 4) || null,
          poster: IMG(raw.poster_path),
          backdrop: IMG(raw.backdrop_path, 'w780'),
          overview: raw.overview || '',
          rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : null,
          genreIds: raw.genre_ids || [],
          // combien de mes coches l'ont fait ressortir : c'est ça, la pertinence
          matches: v.from.size,
          score: v.score + v.from.size * 30,
          ratingKey: local?.ratingKey || null,
          inNova: !!local,
        };
      })
      .filter((x) => x.title && x.poster)
      .filter((x) => (minRating ? (x.rating || 0) >= minRating : true))
      .filter((x) => (yearFrom ? Number(x.year || 0) >= yearFrom : true))
      .filter((x) => (wantedGenres.size ? (x.genreIds || []).some((g) => wantedGenres.has(g)) : true))
      .filter((x) => (novaOnly ? x.inNova : true));

    // À pertinence égale, ce qui est déjà disponible passe devant.
    out.sort((a, b) => (b.score + (b.inNova ? 12 : 0)) - (a.score + (a.inNova ? 12 : 0)));
    res.json({ results: out.slice(0, 60), refs: cleanRefs.length });
  } catch (e) {
    console.error('[Discover]', e.message);
    res.status(502).json({ error: 'Exploration indisponible' });
  }
});

/* ══ Étiquettes de langue (VOSTFR / VO / VA) ═════════════════════════
   Les listings Plex ne contiennent pas les pistes audio : interroger les
   1 000 fiches serait absurde. On utilise plutôt les FILTRES de Plex
   (audioLanguage / subtitleLanguage), qui renvoient directement les
   identifiants concernés — une dizaine de requêtes pour tout le catalogue.

   Règles (demandées) :
     · piste française  → aucune étiquette
     · sinon + sous-titres FR → VOSTFR
     · sinon + une langue autre que l'anglais → VO   (VO gagne sur VA)
     · sinon anglais seul → VA
     · langue inconnue → considérée française, donc rien */
const LANG_TTL = 30 * 60 * 1000;
let langCache = { at: 0, map: {} };
let langBuilding = null;

const EXCLUDE = 'excludeElements=Media,Genre,Country,Director,Writer,Role,Producer,Collection,Similar,Guid,Rating,Image,Chapter,Marker,Extras&excludeFields=summary,tagline,art,thumb';
// Le listing principal garde les Guid : ils portent l'identifiant TMDB, qui
// nous donne la langue d'ORIGINE du film — sans elle, impossible de dire si
// une piste anglaise est la version originale (VO) ou un doublage (VA).
const EXCLUDE_KEEP_GUID = EXCLUDE.replace(',Guid', '') + '&includeGuids=1';

db.exec(`CREATE TABLE IF NOT EXISTS title_orig_lang (
  ratingKey TEXT PRIMARY KEY,
  lang TEXT,
  at INTEGER NOT NULL
)`);

// La langue d'origine ne change jamais : 90 jours de cache, et on mémorise
// aussi les échecs (lang = '') pour ne pas re-interroger TMDB en boucle.
function cachedOrigLang(ratingKey) {
  const row = db.prepare('SELECT lang, at FROM title_orig_lang WHERE ratingKey = ?').get(String(ratingKey));
  if (!row) return undefined;
  if (Date.now() - row.at > 90 * 86400000) return undefined;
  return row.lang || null;
}

function rememberOrigLang(ratingKey, lang) {
  db.prepare('INSERT INTO title_orig_lang (ratingKey, lang, at) VALUES (?, ?, ?) ON CONFLICT(ratingKey) DO UPDATE SET lang = excluded.lang, at = excluded.at')
    .run(String(ratingKey), lang || '', Date.now());
}

async function fetchOrigLang({ ratingKey, tmdbId, isShow, title, year }) {
  const hit = cachedOrigLang(ratingKey);
  if (hit !== undefined) return hit;
  let lang = null;
  try {
    const kind = isShow ? 'tv' : 'movie';
    if (tmdbId) {
      const r = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}`, { headers: tmdbHeaders });
      if (r.ok) lang = (await r.json()).original_language || null;
    }
    if (!lang && title) {
      // pas d'identifiant TMDB : on retombe sur une recherche titre + année
      const qs = new URLSearchParams({ query: title, include_adult: 'false' });
      if (year) qs.set(isShow ? 'first_air_date_year' : 'year', String(year));
      const r = await fetch(`https://api.themoviedb.org/3/search/${kind}?${qs}`, { headers: tmdbHeaders });
      if (r.ok) lang = ((await r.json()).results || [])[0]?.original_language || null;
    }
  } catch { /* TMDB indisponible : on retombera sur VA */ }
  rememberOrigLang(ratingKey, lang);
  return lang;
}

// (mapLimit — le pool de concurrence — est défini plus bas dans ce fichier.)

/* Lecture brute du serveur multimédia, au format Plex — y compris quand c'est
   un Jellyfin (traduit). Sans filtre : réservé à prive.js et à plexJson. */
async function plexJsonBrut(pathname) {
  if (estJellyfin()) return jelly.plexJson(pathname);
  const sep = pathname.includes('?') ? '&' : '?';
  const r = await fetch(`${PLEX_URL}${pathname}${sep}X-Plex-Token=${PLEX_TOKEN}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Plex ${r.status}`);
  return r.json();
}

async function plexJson(pathname) {
  if (prive.cheminInterdit(pathname)) throw new Error('Plex 404');
  // Tout ce que le serveur lit du serveur multimédia passe par ici : on y retire le privé.
  return prive.filtrerJson(await plexJsonBrut(pathname), pathname);
}

// Sur une bibliothèque de séries, les filtres de flux ne s'appliquent qu'aux
// ÉPISODES (type=4) : on remonte ensuite à la série parente.
async function keysFor(sectionKey, filter, value, isShow) {
  const t = isShow ? 'type=4&' : '';
  const d = await plexJson(`/library/sections/${sectionKey}/all?${t}${filter}=${encodeURIComponent(value)}&${EXCLUDE}`);
  return (d?.MediaContainer?.Metadata || []).map((m) => String(m.grandparentRatingKey || m.ratingKey));
}

async function buildLanguageMap() {
  const map = {};
  const secs = await plexJson('/library/sections');
  const sections = (secs?.MediaContainer?.Directory || []).filter((l) => ['movie', 'show'].includes(l.type));

  for (const sec of sections) {
    try {
      const all = await plexJson(`/library/sections/${sec.key}/all?${EXCLUDE_KEEP_GUID}`);
      const meta = all?.MediaContainer?.Metadata || [];
      const items = meta.map((m) => String(m.ratingKey));
      if (!items.length) continue;
      const info = new Map(meta.map((m) => {
        const tmdb = (m.Guid || []).map((g) => g.id).find((g) => /^tmdb:\/\//.test(g || ''));
        return [String(m.ratingKey), { tmdbId: tmdb ? tmdb.replace('tmdb://', '') : null, title: m.title, year: m.year }];
      }));

      const langs = await plexJson(`/library/sections/${sec.key}/audioLanguage`)
        .then((d) => (d?.MediaContainer?.Directory || []).map((x) => x.key).filter(Boolean))
        .catch(() => []);

      const isFr = (k) => /^fr(-|$)/i.test(k);
      const isEn = (k) => /^en(-|$)/i.test(k);
      // Étiquettes de langue absurdes rencontrées dans les fichiers mal tagués
      // (« Avestique », « undetermined »…) : à traiter comme inconnues, pas
      // comme une version originale exotique.
      const isJunk = (k) => /^(ae|und|mis|mul|zxx|xx|qaa|zz)$/i.test(k);
      const isShow = sec.type === 'show';

      const fr = new Set(), en = new Set(), other = new Set();
      for (const k of langs.slice(0, 30)) {
        if (isJunk(k)) continue;
        const target = isFr(k) ? fr : isEn(k) ? en : other;
        try { (await keysFor(sec.key, 'audioLanguage', k, isShow)).forEach((id) => target.add(id)); } catch {}
      }

      const subsFr = new Set();
      const subLangs = await plexJson(`/library/sections/${sec.key}/subtitleLanguage`)
        .then((d) => (d?.MediaContainer?.Directory || []).map((x) => x.key).filter((k) => isFr(k)))
        .catch(() => ['fr']);
      for (const k of subLangs.slice(0, 6)) {
        try { (await keysFor(sec.key, 'subtitleLanguage', k, isShow)).forEach((id) => subsFr.add(id)); } catch {}
      }

      // Une piste audio de langue inconnue ou absurde (« Avestique »…) ne dit
      // RIEN : ces fichiers sont français en pratique. Il faut donc écarter ce
      // cas AVANT de regarder les sous-titres, sinon un film VF sous-titré
      // ressortait en VOSTFR.
      const known = new Set([...fr, ...en, ...other]);
      const needCheck = [];
      for (const id of items) {
        if (fr.has(id)) continue;        // on l'entend en français → aucune marque
        if (!known.has(id)) continue;    // langue indéterminée → considérée française
        needCheck.push(id);
      }

      /* Reste les titres sans piste française. Un dernier filtre : les fichiers
         mal étiquetés (Taxi 5 tagué « English », Squid Game sans langue). Si
         TMDB dit que le film est français, c'est un mauvais tag, pas une VO. */
      await mapLimit(needCheck, 8, async (id) => {
        const meta2 = info.get(id) || {};
        const lang = await fetchOrigLang({ ratingKey: id, isShow, ...meta2 });
        if (lang === 'fr') return;                            // français mal tagué → rien
        map[id] = subsFr.has(id) ? 'VOSTFR' : 'VO';
      });
    } catch (e) {
      console.warn(`[Langues] section ${sec.title}:`, e.message);
    }
  }
  return map;
}

function startLanguageBuild() {
  if (langBuilding) return langBuilding;
  langBuilding = buildLanguageMap()
    .then((map) => {
      langCache = { at: Date.now(), map };
      console.log(`[Langues] ${Object.keys(map).length} titres étiquetés`);
      return map;
    })
    .catch((e) => { console.error('[Langues]', e.message); return langCache.map; })
    .finally(() => { langBuilding = null; });
  return langBuilding;
}

app.get('/api/language-badges', authMiddleware, (req, res) => {
  const fresh = Date.now() - langCache.at < LANG_TTL;
  if (!fresh) startLanguageBuild();   // reconstruction en fond, sans faire attendre
  res.json({ map: langCache.map, building: !fresh && !!langBuilding });
});

// Première construction au démarrage : la boucle TMDB peut durer une minute,
// mais les langues d'origine sont ensuite en base pour 90 jours.
setTimeout(startLanguageBuild, 15000);

/* ══ « Horreur + » ════════════════════════════════════════════════════
   Le genre « Horreur » de Plex met Conjuring et Martyrs dans le même sac.
   Cette rangée-là est une sélection tenue à la main (voir horrorPlus.js),
   croisée avec la bibliothèque sur l'identifiant TMDB. On ne renvoie que
   des identifiants Plex : le client a déjà les affiches et les titres. */
const HORROR_TTL = 60 * 60 * 1000;
let horrorCache = { at: 0, ids: [], manquants: [] };

async function buildHorrorPlus() {
  const secs = await plexJson('/library/sections');
  const sections = (secs?.MediaContainer?.Directory || []).filter((l) => l.type === 'movie');
  const biblio = [];
  for (const sec of sections) {
    try {
      const all = await plexJson(`/library/sections/${sec.key}/all?${EXCLUDE_KEEP_GUID}`);
      for (const m of (all?.MediaContainer?.Metadata || [])) {
        const tmdb = (m.Guid || []).map((g) => g.id).find((g) => /^tmdb:\/\//.test(g || ''));
        biblio.push({
          ratingKey: m.ratingKey,
          title: m.title,
          originalTitle: m.originalTitle,
          year: m.year,
          tmdbId: tmdb ? tmdb.replace('tmdb://', '') : null,
        });
      }
    } catch (e) {
      console.warn(`[Horreur+] section ${sec.title}:`, e.message);
    }
  }
  return croiserHorreur(biblio);
}

function startHorrorBuild() {
  return buildHorrorPlus()
    .then((r) => {
      horrorCache = { at: Date.now(), ids: r.ids, manquants: r.manquants };
      console.log(`[Horreur+] ${r.ids.length} titres trouvés, ${r.manquants.length} absents`);
      return horrorCache;
    })
    .catch((e) => { console.error('[Horreur+]', e.message); return horrorCache; });
}

app.get('/api/horror-plus', authMiddleware, async (req, res) => {
  if (Date.now() - horrorCache.at > HORROR_TTL) await startHorrorBuild();
  res.json({ ids: horrorCache.ids, missing: horrorCache.manquants.length });
});

/* ══ Rapport de crash côté navigateur ════════════════════════════════
   Sans ça, une erreur de rendu sur un téléphone n'existe nulle part :
   la console est invisible. On l'écrit dans le journal du jour. */
const crashHits = new Map();
app.post('/api/client-error', (req, res) => {
  try {
    // garde-fou : 20 rapports par IP et par heure
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const h = crashHits.get(ip) || { n: 0, at: now };
    if (now - h.at > 3600000) { h.n = 0; h.at = now; }
    h.n += 1;
    crashHits.set(ip, h);
    if (h.n > 20) return res.status(429).json({ ok: false });

    const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
    const { message, stack, componentStack, url, userAgent } = req.body || {};
    let who = 'anonyme';
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    if (token) {
      try { const d = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); who = d.username || `user#${d.id}`; } catch { /* jeton mort */ }
    }
    console.error(
      `[Client] ${who} — ${clip(message, 300)}
  page: ${clip(url, 200)}
  ua: ${clip(userAgent, 160)}
  stack: ${clip(stack, 1500)}
  composants: ${clip(componentStack, 1200)}`
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

/* ══ Sous-titres externes (OpenSubtitles) ════════════════════════════
   Recherche libre, téléchargement mis en cache sur disque. Les fichiers
   sont servis en WebVTT, directement consommables par <track>. */
const subtitles = createSubtitles({ cacheDir: config.dataPath('subs-cache') });

// Cherche des sous-titres pour un titre Plex (par ratingKey).
app.get('/api/subtitles/search/:ratingKey', authMiddleware, async (req, res) => {
  try {
    if (!subtitles.enabled()) return res.status(503).json({ error: 'Sous-titres en ligne non configurés', feature: 'soustitres' });
    const lang = (req.query.lang || 'fr').toString().slice(0, 5);

    // On récupère titre / année / IMDb depuis Plex pour une recherche précise.
    let meta = {};
    try {
      const d = await plexJson(`/library/metadata/${encodeURIComponent(req.params.ratingKey)}`);
      const m = d?.MediaContainer?.Metadata?.[0] || {};
      const guids = [m.guid, ...((m.Guid || []).map((g) => g.id))].filter(Boolean).join(' ');
      const imdb = (guids.match(/tt(\d+)/) || [])[0];
      meta = {
        imdbId: imdb,
        title: m.type === 'episode' ? (m.grandparentTitle || m.title) : m.title,
        year: m.year,
        type: m.type === 'episode' ? 'episode' : 'movie',
      };
    } catch { /* on tentera avec ce qu'on a */ }

    if (req.query.q) meta.title = req.query.q.toString().slice(0, 120);
    const results = await subtitles.search({ ...meta, languages: lang });
    res.json({ results, matched: { title: meta.title, year: meta.year, imdbId: meta.imdbId || null } });
  } catch (e) {
    console.error('[Subtitles] search:', e.message);
    res.status(502).json({ error: e.message || 'Recherche impossible' });
  }
});

// Sert le fichier converti. Le <track> d'une vidéo ne peut pas porter
// d'en-tête : on accepte donc aussi le jeton en ?nova= (déjà géré en amont).
app.get('/api/subtitles/vtt/:fileId', authMiddleware, async (req, res) => {
  try {
    if (!subtitles.enabled()) return res.status(503).send('');
    const vtt = await subtitles.fetchVtt(req.params.fileId);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(vtt);
  } catch (e) {
    console.error('[Subtitles] vtt:', e.message);
    res.status(502).send('');
  }
});

/* ══ « Dis-moi ta soirée » ═════════════════════════════════════════════
   Voir vibe.js pour le principe. Ici on assemble : catalogue → modèle →
   VÉRIFICATION → réponse. Le modèle ne décide jamais de ce qui existe. */
const vibeQuota = new Map();   // userId → { n, depuis }

app.post('/api/vibe', authMiddleware, async (req, res) => {
  if (!vibe.vibeConfigured()) return res.status(503).json({ error: "L'assistant n'est pas activé : il faut choisir une IA dans les réglages.", feature: 'assistant' });
  const humeur = String(req.body?.humeur || '').trim().slice(0, 300);
  if (humeur.length < 2) return res.status(400).json({ error: 'Dis-m\'en un peu plus' });

  // 20 demandes par heure et par personne : large à l'usage, borné en cas de boucle
  const q = vibeQuota.get(req.user.id) || { n: 0, depuis: Date.now() };
  if (Date.now() - q.depuis > 3600000) { q.n = 0; q.depuis = Date.now(); }
  if (q.n >= 20) return res.status(429).json({ error: 'Doucement — réessaie dans un moment.' });
  q.n++; vibeQuota.set(req.user.id, q);

  try {
    const catalogue = await loadAllLibraryItems();
    // loadAllLibraryItems renvoie { type, tmdbId, item } → on aplatit
    const plat = catalogue.map((x) => ({
      id: x.item.ratingKey, title: x.item.title, year: x.item.year || null,
      genres: (x.item.Genre || []).map((g) => g.tag), type: x.item.type,
      thumb: x.item.thumb || null,
      note: Number(x.item.rating || x.item.audienceRating || 0),
    }));

    /* On n'envoie PAS les 1500 titres : d'abord parce que ça consomme le
       quota gratuit à toute vitesse, ensuite parce que moins on expédie de
       données, mieux c'est. On priorise ce qui n'a pas encore été vu, puis
       les mieux notés — c'est là que sont les bonnes propositions. */
    const vus = new Set(db.prepare('SELECT mediaId FROM watch_progress WHERE userId = ? AND completed = 1').all(req.user.id).map((x) => String(x.mediaId)));
    const choisis = [...plat].sort((a, b) => {
      const av = vus.has(String(a.id)) ? 1 : 0, bv = vus.has(String(b.id)) ? 1 : 0;
      if (av !== bv) return av - bv;                 // les non-vus d'abord
      return b.note - a.note;                        // puis les mieux notés
    }).slice(0, 600);

    const brut = await vibe.demanderAuModele(humeur, vibe.listePourModele(choisis, 600));
    const valides = vibe.verifierSurNova(brut.surNova, plat);

    /* Découvertes : chaque titre est confronté à TMDB. Ce qui n'existe pas
       disparaît ; ce qui est en fait DÉJÀ sur Nova est reversé dans l'autre
       panier plutôt que proposé à la demande. */
    const dejaLa = new Set(valides.map((v) => String(v.item.id)));
    const aDemander = [];
    for (const p of (brut.aDecouvrir || []).slice(0, 4)) {
      try {
        const qs = new URLSearchParams({ query: p.titre, include_adult: 'false', language: 'fr-FR' });
        const r = await fetch(`https://api.themoviedb.org/3/search/multi?${qs}`, { headers: tmdbHeaders });
        const t = (await r.json()).results || [];
        const top = t.find((x) => (x.media_type === 'movie' || x.media_type === 'tv') && x.poster_path);
        if (!top) continue;                                   // titre inventé → écarté

        const local = vibe.verifierSurNova([{ titre: top.title || top.name, annee: (top.release_date || top.first_air_date || '').slice(0, 4) }], plat)[0];
        if (local) {
          if (!dejaLa.has(String(local.item.id))) { dejaLa.add(String(local.item.id)); valides.push({ ...local, pourquoi: p.pourquoi }); }
          continue;
        }
        aDemander.push({
          tmdbId: String(top.id), type: top.media_type,
          title: top.title || top.name,
          year: (top.release_date || top.first_air_date || '').slice(0, 4) || null,
          poster: IMG(top.poster_path), backdrop: IMG(top.backdrop_path, 'w780'),
          overview: top.overview || '',
          rating: top.vote_average ? Math.round(top.vote_average * 10) / 10 : null,
          pourquoi: (p.pourquoi || '').trim(),
        });
      } catch { /* une suggestion muette n'empêche pas les autres */ }
    }

    console.log(`[Soirée] « ${humeur.slice(0, 40)} » → ${valides.length} sur Nova, ${aDemander.length} à demander`);
    res.json({
      ambiance: (brut.ambiance || '').trim(),
      surNova: valides.map((v) => ({
        id: String(v.item.id), title: v.item.title, year: v.item.year,
        type: v.item.type, thumbPath: v.item.thumb, pourquoi: v.pourquoi,
      })),
      aDemander,
    });
  } catch (e) {
    console.error('[Soirée]', e.message);
    res.status(502).json({ error: "L'assistant n'a pas répondu. Réessaie." });
  }
});

/* ══ Suivre une série ══════════════════════════════════════════════════
   « Suivre » = être prévenu quand un NOUVEL ÉPISODE arrive SUR NOVA — pas
   quand il est diffusé au Japon. C'est la seule notification qui compte :
   celle qui dit « tu peux le regarder maintenant ».
   On mémorise le dernier épisode connu de chaque série suivie ; dès qu'un
   plus récent apparaît, on prévient ceux qui suivent. */
db.exec(`CREATE TABLE IF NOT EXISTS series_follows (
  userId INTEGER NOT NULL,
  ratingKey TEXT NOT NULL,
  title TEXT,
  addedAt TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (userId, ratingKey)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS series_seen (
  ratingKey TEXT PRIMARY KEY,
  dernierEp TEXT,
  vuLe INTEGER
)`);

app.get('/api/follow/:ratingKey', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT 1 FROM series_follows WHERE userId = ? AND ratingKey = ?').get(req.user.id, String(req.params.ratingKey));
  res.json({ suivi: !!row });
});

app.post('/api/follow/:ratingKey', authMiddleware, async (req, res) => {
  const rk = String(req.params.ratingKey);
  db.prepare('INSERT OR IGNORE INTO series_follows (userId, ratingKey, title) VALUES (?, ?, ?)')
    .run(req.user.id, rk, String(req.body?.title || ''));
  // On note l'état actuel : sinon la première vérification annoncerait comme
  // « nouveaux » tous les épisodes déjà là.
  if (!db.prepare('SELECT 1 FROM series_seen WHERE ratingKey = ?').get(rk)) {
    try {
      const eps = await episodesDeSerie(rk);
      const dernier = eps[eps.length - 1];
      db.prepare('INSERT OR REPLACE INTO series_seen (ratingKey, dernierEp, vuLe) VALUES (?, ?, ?)')
        .run(rk, dernier ? dernier.ratingKey : '', Date.now());
    } catch {}
  }
  res.json({ suivi: true });
});

app.delete('/api/follow/:ratingKey', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM series_follows WHERE userId = ? AND ratingKey = ?').run(req.user.id, String(req.params.ratingKey));
  res.json({ suivi: false });
});

async function verifierSeriesSuivies() {
  const series = db.prepare('SELECT DISTINCT ratingKey FROM series_follows').all();
  for (const s of series) {
    try {
      epsCache.delete(String(s.ratingKey));      // on veut l'état frais
      const eps = await episodesDeSerie(s.ratingKey);
      if (!eps.length) continue;
      const dernier = eps[eps.length - 1];
      const connu = db.prepare('SELECT dernierEp FROM series_seen WHERE ratingKey = ?').get(String(s.ratingKey));

      if (connu && connu.dernierEp && connu.dernierEp !== dernier.ratingKey) {
        const abonnes = db.prepare('SELECT userId FROM series_follows WHERE ratingKey = ?').all(String(s.ratingKey));
        const titre = dernier.grandparentTitle || '';
        for (const a of abonnes) {
          pushToUser(a.userId, {
            title: `Nouvel épisode — ${titre}`,
            body: `S${dernier.parentIndex ?? '?'} É${dernier.index ?? '?'} · ${dernier.title || ''}`,
            url: `/title/${s.ratingKey}`,
            tag: `ep-${dernier.ratingKey}`,
          });
        }
        console.log(`[Suivi] ${titre} : nouvel épisode ${dernier.ratingKey} → ${abonnes.length} abonné(s)`);
      }
      db.prepare('INSERT OR REPLACE INTO series_seen (ratingKey, dernierEp, vuLe) VALUES (?, ?, ?)')
        .run(String(s.ratingKey), dernier.ratingKey, Date.now());
    } catch (e) {
      console.warn('[Suivi]', s.ratingKey, e.message);
    }
  }
}
setTimeout(verifierSeriesSuivies, 120000);
setInterval(verifierSeriesSuivies, 30 * 60 * 1000);

/* ══ Marquer une saison entière comme vue ══════════════════════════════ */
app.post('/api/progress/season/:ratingKey', authMiddleware, async (req, res) => {
  try {
    const d = await plexJson(`/library/metadata/${req.params.ratingKey}/children`);
    const eps = (d?.MediaContainer?.Metadata || []).filter((m) => m.type === 'episode');
    if (!eps.length) return res.status(404).json({ error: 'Aucun épisode' });

    const maj = db.prepare(`
      INSERT INTO watch_progress (userId, mediaId, mediaTitle, mediaType, currentTime, duration, completed, updatedAt)
      VALUES (?, ?, ?, 'episode', 0, 0, 1, datetime('now'))
      ON CONFLICT(userId, mediaId) DO UPDATE SET completed = 1, updatedAt = datetime('now')`);
    db.transaction(() => {
      for (const e of eps) maj.run(req.user.id, String(e.ratingKey), e.grandparentTitle || '');
    })();

    seriesVuesCache.delete(req.user.id);   // la saison entière peut compléter la série
    // Et sur Plex, si le compte est relié — en fond, pour ne pas faire attendre.
    (async () => { for (const e of eps) await marquerSurPlex(req.user.id, e.ratingKey, true); })();

    res.json({ ok: true, episodes: eps.length });
  } catch (e) {
    console.error('[Saison vue]', e.message);
    res.status(502).json({ error: 'Impossible' });
  }
});

/* ══ Tableau de bord admin ═════════════════════════════════════════════
   Sans ça, impossible de savoir si le travail sur les codecs et les
   sous-titres sert à quelque chose. Le lecteur déclare sa méthode de
   lecture au démarrage, et on compte. */
db.exec(`CREATE TABLE IF NOT EXISTS playback_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  mediaId TEXT,
  method TEXT,
  at TEXT DEFAULT (datetime('now'))
)`);

app.post('/api/playback-method', authMiddleware, (req, res) => {
  const m = req.body?.method === 'direct' ? 'direct' : 'transcode';
  try {
    db.prepare('INSERT INTO playback_stats (userId, mediaId, method) VALUES (?, ?, ?)')
      .run(req.user.id, String(req.body?.mediaId || ''), m);
    db.prepare("DELETE FROM playback_stats WHERE at < datetime('now','-60 days')").run();
  } catch {}
  res.json({ ok: true });
});

app.get('/api/admin/overview', authMiddleware, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Non autorisé' });

  const disques = [];
  for (const d of DISQUES) {
    try {
      const s = fs.statfsSync(d);
      const libre = (s.bavail * s.bsize) / 1e9, total = (s.blocks * s.bsize) / 1e9;
      disques.push({ disque: d.replace('\\', ''), libreGo: Math.round(libre), totalGo: Math.round(total), pct: Math.round((libre / total) * 100) });
    } catch {}
  }

  const lectures = db.prepare(`
    SELECT method, COUNT(*) n FROM playback_stats
    WHERE at > datetime('now','-30 days') GROUP BY method
  `).all();
  const direct = lectures.find((x) => x.method === 'direct')?.n || 0;
  const transcode = lectures.find((x) => x.method === 'transcode')?.n || 0;

  let sessions = [];
  try {
    const s = await plexJsonBrut('/status/sessions');
    sessions = (s?.MediaContainer?.Metadata || []).map((x) => ({
      titre: x.grandparentTitle ? `${x.grandparentTitle} — ${x.title}` : x.title,
      utilisateur: x.User?.title || '',
      etat: x.Player?.state || '',
      methode: x.TranscodeSession ? 'transcodage' : 'direct',
    }));
  } catch {}

  const suivis = db.prepare('SELECT COUNT(DISTINCT ratingKey) n FROM series_follows').get().n;
  const demandes = db.prepare("SELECT COUNT(*) n FROM content_requests WHERE status = 'pending'").get().n;

  res.json({ disques, lectures: { direct, transcode }, sessions, suivis, demandes });
});

/* ══ Surveillance des disques ══════════════════════════════════════════
   Un disque plein ne se voit pas venir : Plex arrête de transcoder, les
   téléchargements échouent, et le site tombe sans message clair. On prévient
   AVANT. Un seul rappel par disque et par jour — une alerte qu'on voit dix
   fois par jour n'est plus une alerte. */
/* Disques surveillés : NOVA_DISQUES (séparés par des virgules, ex. « C:\\,D:\\ »
   ou « /,/mnt/films »). Sans réglage : celui qui porte les données de Nova. */
const DISQUES = (process.env.NOVA_DISQUES || '').split(',').map((d) => d.trim()).filter(Boolean);
if (!DISQUES.length) DISQUES.push(path.parse(config.DATA_DIR).root || '/');
const SEUIL_GO = 20;          // en dessous : on alerte
const SEUIL_PCT = 5;
const derniereAlerte = new Map();

function verifierDisques() {
  for (const d of DISQUES) {
    let libre, total;
    try {
      const s = fs.statfsSync(d);
      libre = (s.bavail * s.bsize) / 1e9;
      total = (s.blocks * s.bsize) / 1e9;
    } catch { continue; }          // disque absent ou non monté
    if (!total) continue;

    const pct = (libre / total) * 100;
    if (libre > SEUIL_GO && pct > SEUIL_PCT) continue;

    const hier = derniereAlerte.get(d) || 0;
    if (Date.now() - hier < 24 * 3600 * 1000) continue;
    derniereAlerte.set(d, Date.now());

    const msg = `${d.replace('\\', '')} : ${Math.round(libre)} Go libres (${Math.round(pct)} %)`;
    console.warn(`[Disques] ALERTE ${msg}`);
    for (const a of db.prepare('SELECT id FROM users WHERE isAdmin = 1').all()) {
      pushToUser(a.id, { title: 'Espace disque faible', body: msg, url: '/admin', tag: `disk-${d}` });
    }
  }
}
setTimeout(verifierDisques, 60000);
setInterval(verifierDisques, 6 * 3600 * 1000);

// État des disques, pour l'écran d'administration
app.get('/api/admin/disks', authMiddleware, (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Non autorisé' });
  const out = [];
  for (const d of DISQUES) {
    try {
      const s = fs.statfsSync(d);
      const libre = (s.bavail * s.bsize) / 1e9;
      const total = (s.blocks * s.bsize) / 1e9;
      out.push({ disque: d.replace('\\', ''), libreGo: Math.round(libre), totalGo: Math.round(total), pct: Math.round((libre / total) * 100) });
    } catch { /* disque absent */ }
  }
  res.json({ disques: out });
});

/* ══ Sous-titres INTÉGRÉS au fichier, sans transcoder ═══════════════════
   Jusqu'ici, demander un sous-titre imposait un transcodage complet : un
   .mkv servi tel quel ne montre pas ses pistes de sous-titres dans un
   navigateur. Ton PC ré-encodait donc un film entier juste pour incruster
   du texte.

   Plex ne sait pas livrer une piste INTERNE en direct (`/library/streams`
   répond 501 : seuls les fichiers .srt posés à côté du film ont une clé).
   On extrait donc la piste nous-mêmes avec ffmpeg, directement du fichier
   — Nova tourne sur la même machine que Plex et lit les mêmes disques.

   Le scan d'un film de 2 h prend ~13 s : bien trop pour retarder la
   lecture, mais on ne le fait QU'UNE FOIS — ensuite c'est du cache. */
const SUBS_EMBED_DIR = config.dataPath('subs-cache');
try { fs.mkdirSync(SUBS_EMBED_DIR, { recursive: true }); } catch {}
const extractionsEnCours = new Map();   // clé → Promise

function extraireSousTitre(fichier, indexFlux, sortie) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-i', fichier, '-map', `0:${indexFlux}`, '-f', 'webvtt', '-'];
    const p = spawn(process.env.FFMPEG_PATH || ffmpegStatic, args, { windowsHide: true });
    let out = '', err = '';
    const minuteur = setTimeout(() => { p.kill(); reject(new Error('extraction trop longue')); }, 120000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(minuteur); reject(e); });
    p.on('close', (code) => {
      clearTimeout(minuteur);
      if (code !== 0 || !out.trim()) return reject(new Error(err.slice(0, 200) || `ffmpeg ${code}`));
      try { fs.writeFileSync(sortie, out, 'utf8'); } catch {}
      resolve(out);
    });
  });
}

app.get('/api/subtitles/embedded/:ratingKey/:streamId', authMiddleware, async (req, res) => {
  const { ratingKey, streamId } = req.params;
  const cache = path.join(SUBS_EMBED_DIR, `embed-${ratingKey}-${streamId}.vtt`);
  const envoyer = (vtt) => {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(vtt);
  };
  try {
    if (fs.existsSync(cache)) return envoyer(fs.readFileSync(cache, 'utf8'));

    // Jellyfin convertit lui-même la piste en WebVTT : pas besoin de ffmpeg.
    if (estJellyfin()) {
      if (prive.cheminInterdit(`/library/metadata/${ratingKey}`)) return res.status(404).send('');
      const vtt = await jelly.sousTitreVtt(streamId);
      if (!vtt) return res.status(404).send('');
      try { fs.writeFileSync(cache, vtt, 'utf8'); } catch {}
      return envoyer(vtt);
    }

    const d = await plexJson(`/library/metadata/${ratingKey}`);
    const part = d?.MediaContainer?.Metadata?.[0]?.Media?.[0]?.Part?.[0];
    const flux = (part?.Stream || []).find((s) => String(s.id) === String(streamId));
    if (!part?.file || !flux) return res.status(404).send('');
    if (!fs.existsSync(part.file)) return res.status(404).send('');

    // Une seule extraction à la fois pour un même fichier, même si le lecteur
    // redemande pendant les 13 secondes de scan.
    const cle = `${ratingKey}-${streamId}`;
    if (!extractionsEnCours.has(cle)) {
      extractionsEnCours.set(cle, extraireSousTitre(part.file, flux.index, cache)
        .finally(() => extractionsEnCours.delete(cle)));
    }
    const vtt = await extractionsEnCours.get(cle);
    console.log(`[Sous-titres] piste ${flux.codec}/${flux.language} extraite de « ${d.MediaContainer.Metadata[0].title} »`);
    envoyer(vtt);
  } catch (e) {
    console.warn('[Sous-titres] extraction:', e.message);
    res.status(502).send('');
  }
});

/* ══ Notifications push (Web Push / VAPID) ═══════════════════════════
   Les clés VAPID sont générées au premier démarrage et rangées dans la
   base : rien à configurer à la main. Sans HTTPS le navigateur refusera
   de s'abonner — c'est déjà en place via Caddy. */
let vapid = null;
try {
  db.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('vapid');
  if (row) vapid = JSON.parse(row.value);
  else {
    const keys = webpush.generateVAPIDKeys();
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('vapid', JSON.stringify(keys));
    vapid = keys;
    console.log('[Push] Clés VAPID générées.');
  }
  webpush.setVapidDetails('mailto:admin@novastream.local', vapid.publicKey, vapid.privateKey);
} catch (e) {
  console.error('[Push] Initialisation impossible:', e.message);
}

// Envoi à tous les appareils d'un utilisateur ; on nettoie les abonnements morts.
function pushToUser(userId, payload) {
  if (!vapid) return;
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE userId = ?').all(userId);
  for (const s of subs) {
    webpush
      .sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      )
      .catch((err) => {
        // 404/410 = abonnement expiré (app désinstallée, cache vidé)
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        }
      });
  }
}

app.get('/api/push/key', authMiddleware, (req, res) => {
  if (!vapid) return res.status(503).json({ error: 'Push indisponible' });
  const count = db.prepare('SELECT COUNT(*) c FROM push_subscriptions WHERE userId = ?').get(req.user.id).c;
  res.json({ publicKey: vapid.publicKey, subscribed: count > 0 });
});

app.post('/api/push/subscribe', authMiddleware, (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Abonnement invalide' });
    if (typeof endpoint !== 'string' || endpoint.length > 600) return res.status(400).json({ error: 'Abonnement invalide' });
    db.prepare(`INSERT INTO push_subscriptions (userId, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
                ON CONFLICT(endpoint) DO UPDATE SET userId = excluded.userId, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(req.user.id, endpoint, keys.p256dh, keys.auth);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Push] subscribe:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/push/unsubscribe', authMiddleware, (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    else db.prepare('DELETE FROM push_subscriptions WHERE userId = ?').run(req.user.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Test manuel depuis le compte (bouton "Envoyer un test")
app.post('/api/push/test', authMiddleware, (req, res) => {
  pushToUser(req.user.id, { title: 'NovaStream', body: 'Les notifications fonctionnent 👌', url: '/' });
  res.json({ ok: true });
});

app.put('/api/requests/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['pending', 'approved', 'added', 'declined'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
    const before = db.prepare('SELECT * FROM content_requests WHERE id = ?').get(req.params.id);
    db.prepare('UPDATE content_requests SET status = ? WHERE id = ?').run(status, req.params.id);
    // On prévient le demandeur — sauf s'il est lui-même l'admin qui vient de cliquer.
    if (before && before.userId !== req.user.id && before.status !== status) {
      const label = status === 'added' ? 'est disponible' : status === 'approved' ? 'a été approuvée' : status === 'declined' ? 'a été refusée' : 'a changé de statut';
      pushToUser(before.userId, {
        title: status === 'added' ? 'Ton film est là' : 'Demande mise à jour',
        body: `« ${before.title} » ${label}.`,
        url: status === 'added' ? '/' : '/requests',
        tag: `req-${before.id}`,
      });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[Requests] update error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Delete: own request, or any if admin.
app.delete('/api/requests/:id', authMiddleware, (req, res) => {
  try {
    if (req.user.isAdmin) db.prepare('DELETE FROM content_requests WHERE id = ?').run(req.params.id);
    else db.prepare('DELETE FROM content_requests WHERE id = ? AND userId = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Requests] delete error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════
//  PLEX PROXY — with HLS Transcoding Support
// ═══════════════════════════════════════════════════════════

const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500; // hard cap to prevent unbounded memory growth

function getCached(key) {
  const entry = apiCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) { apiCache.delete(key); return null; }
  return entry;
}

function setCached(key, value) {
  // Simple FIFO eviction once the cap is reached.
  if (apiCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = apiCache.keys().next().value;
    if (oldest !== undefined) apiCache.delete(oldest);
  }
  apiCache.set(key, value);
}

// Rewrite URLs inside HLS playlists so they route through our proxy.
// Use a ROOT-RELATIVE URL (no scheme/host): an absolute http:// URL breaks when
// the app is served over HTTPS (e.g. behind the Caddy reverse proxy) because the
// browser blocks it as mixed content → black screen on every transcoded title.
// Relative works for both http and https, direct or proxied.
/* Ajout du jeton Nova à une URL de playlist.
   INDISPENSABLE pour la lecture NATIVE (iPhone / Safari) : là, c'est le lecteur
   du système qui va chercher le m3u8 et les segments, et une balise <video> ne
   peut PAS envoyer d'en-tête `Authorization`. Sans jeton dans l'URL, le proxy
   répond 401, `loadedmetadata` n'arrive jamais et l'écran de chargement tourne
   dans le vide — c'est exactement ce qui bloquait la lecture sur iPhone. */
function avecJeton(url, nova) {
  if (!nova) return url;
  return url + (url.includes('?') ? '&' : '?') + 'nova=' + encodeURIComponent(nova);
}

function rewriteHLSPlaylist(body, host, nova) {
  const proxyBase = `/plex/video/:/transcode/universal`;
  return body.replace(/(session\/\S*\.m3u8)/g, (m) => avecJeton(`${proxyBase}/${m}`, nova));
}

/* Les URI d'une playlist média sont RELATIVES (« 00000.ts ») : le navigateur les
   résout sur l'URL de la playlist, ce qui perd sa chaîne de requête — donc son
   jeton. On le réinjecte ligne par ligne. */
function jetonSurSegments(body, nova) {
  if (!nova) return body;
  return body
    .split('\n')
    .map((ligne) => {
      const l = ligne.trim();
      if (!l || l.startsWith('#')) return ligne;
      return avecJeton(l, nova);
    })
    .join('\n');
}

// ─── Dedicated Transcode endpoint ────────────────────────────
// This handles the 2-step Plex transcode flow:
// 1. Call /decision to prepare the transcode session
// 2. Return the /start.m3u8 playlist to the client
app.get('/plex-transcode/start', proxyAuth, async (req, res) => {
  try {
    // Build the query params from the client request
    const clientParams = new URLSearchParams(req.query);
    if (prive.cheminInterdit(clientParams.get('path') || '')) return res.status(404).json({ error: 'Introuvable' });

    // Jellyfin : même demande, transcodeur HLS de Jellyfin (via /jfhls).
    if (estJellyfin()) {
      const playlist = await jelly.demarrerTranscodage(req.query, (u) => avecJeton(u, req.query.nova));
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      return res.send(playlist);
    }

    clientParams.delete('nova'); // our auth param — never forward to Plex
    // Always add the Plex token server-side
    clientParams.set('X-Plex-Token', tokenPour(req));   // compte relié, sinon compte partagé

    const queryString = clientParams.toString();

    // Step 1: Call decision to prepare the transcode session
    console.log('[Transcode] Calling decision...');
    const decisionUrl = `${PLEX_URL}/video/:/transcode/universal/decision?${queryString}`;
    const decisionRes = await fetch(decisionUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (!decisionRes.ok) {
      console.error('[Transcode] Decision failed:', decisionRes.status);
      return res.status(decisionRes.status).json({ error: 'Plex decision failed' });
    }

    const decisionData = await decisionRes.json();
    console.log('[Transcode] Decision:', decisionData.MediaContainer?.generalDecisionText);

    // Step 2: Now fetch start.m3u8 with the same session
    console.log('[Transcode] Fetching start.m3u8...');
    const m3u8Url = `${PLEX_URL}/video/:/transcode/universal/start.m3u8?${queryString}`;
    const m3u8Res = await fetch(m3u8Url, { signal: AbortSignal.timeout(15000) });

    if (!m3u8Res.ok) {
      console.error('[Transcode] start.m3u8 failed:', m3u8Res.status);
      return res.status(m3u8Res.status).json({ error: 'Plex transcode start failed' });
    }

    const body = await m3u8Res.text();
    const host = req.get('host');
    // On propage le jeton reçu en ?nova= : indispensable au lecteur natif iOS.
    const rewritten = rewriteHLSPlaylist(body, host, req.query.nova);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(rewritten);
  } catch (err) {
    console.error('[Transcode] Error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Erreur de transcodage' });
  }
});

// --- MOVED API ROUTES TO TOP ---

// --- MOVED PLEX METADATA TO TOP ---

// ═══════════════════════════════════════════════════════════
//  STREAMING PLATFORMS — filter the Plex library by "available
//  on platform X" using TMDB Watch Providers (region FR).
//  Provider lookups are cached on disk (the library rarely changes),
//  so only the first scan is slow.
// ═══════════════════════════════════════════════════════════
const PROVIDER_CACHE_FILE = config.dataPath('provider_cache.json');
let providerCache = {};
try { if (fs.existsSync(PROVIDER_CACHE_FILE)) providerCache = JSON.parse(fs.readFileSync(PROVIDER_CACHE_FILE, 'utf8')); } catch {}
let providerSaveTimer = null;
function saveProviderCacheSoon() {
  if (providerSaveTimer) return;
  providerSaveTimer = setTimeout(() => {
    providerSaveTimer = null;
    try { fs.writeFileSync(PROVIDER_CACHE_FILE, JSON.stringify(providerCache)); } catch (e) { console.warn('[Providers] save failed:', e.message); }
  }, 4000);
}

// Return the set of TMDB provider IDs (FR) a title is available on, cached.
async function getTmdbProviders(type, tmdbId) {
  const key = `${type}:${tmdbId}`;
  if (providerCache[key]) return providerCache[key];
  try {
    const url = `https://api.themoviedb.org/3/${type}/${tmdbId}/watch/providers`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { providerCache[key] = []; saveProviderCacheSoon(); return []; }
    const data = await r.json();
    const fr = data.results?.FR || {};
    const ids = new Set();
    for (const bucket of ['flatrate', 'free', 'ads', 'rent', 'buy']) {
      (fr[bucket] || []).forEach((p) => ids.add(p.provider_id));
    }
    const arr = [...ids];
    providerCache[key] = arr;
    saveProviderCacheSoon();
    return arr;
  } catch { return []; }
}

// Run an async mapper over items with limited concurrency.
async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  });
  await Promise.all(workers);
}

// Cache of the Plex library (raw items + their TMDB ids), refreshed every 10 min.
let libraryCache = { at: 0, items: [] };
async function loadAllLibraryItems() {
  if (Date.now() - libraryCache.at < 600000 && libraryCache.items.length) return libraryCache.items;
  const secData = await plexJson('/library/sections');
  const sections = (secData.MediaContainer?.Directory || []).filter((d) => ['movie', 'show'].includes(d.type));
  let all = [];
  for (const s of sections) {
    const d = await plexJson(`/library/sections/${s.key}/all?includeGuids=1`);
    all = all.concat(d.MediaContainer?.Metadata || []);
  }
  const withTmdb = all.map((item) => {
    const g = (item.Guid || []).find((x) => x.id?.startsWith('tmdb://'));
    return { item, tmdbId: g ? g.id.replace('tmdb://', '') : null, type: item.type === 'movie' ? 'movie' : 'tv' };
  }).filter((x) => x.tmdbId);
  libraryCache = { at: Date.now(), items: withTmdb };
  return withTmdb;
}

// Background warmer: resolve providers for the whole library once, with progress.
let warm = { warming: false, done: 0, total: 0 };
async function warmProviders() {
  if (warm.warming) return;
  warm.warming = true;
  try {
    const items = await loadAllLibraryItems();
    const todo = items.filter((x) => !providerCache[`${x.type}:${x.tmdbId}`]);
    warm.total = items.length;
    warm.done = items.length - todo.length;
    if (todo.length) console.log(`[Providers] Warming ${todo.length}/${items.length} titles...`);
    await mapLimit(todo, 16, async (x) => { await getTmdbProviders(x.type, x.tmdbId); warm.done++; });
    if (todo.length) console.log('[Providers] Warm-up complete.');
  } catch (e) {
    console.warn('[Providers] warm error:', e.message);
  } finally {
    warm.warming = false;
  }
}

// Official platform logos (TMDB watch-provider logos, FR). Cached 24h.
let providersMetaCache = { at: 0, map: null };
app.get('/api/providers', authMiddleware, async (req, res) => {
  try {
    if (providersMetaCache.map && Date.now() - providersMetaCache.at < 86400000) return res.json(providersMetaCache.map);
    const r = await fetch('https://api.themoviedb.org/3/watch/providers/movie?language=fr-FR&watch_region=FR', {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    const data = await r.json();
    const map = {};
    for (const p of data.results || []) {
      map[p.provider_id] = { name: p.provider_name, logo: p.logo_path ? `https://image.tmdb.org/t/p/original${p.logo_path}` : null };
    }
    providersMetaCache = { at: Date.now(), map };
    res.json(map);
  } catch (e) {
    console.error('[Providers meta] error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Fast endpoint: reads from the (warming) cache and returns matches immediately,
// plus a progress flag so the client can poll until the scan finishes.
app.get('/api/platform/:providerId', authMiddleware, async (req, res) => {
  try {
    const providerId = parseInt(req.params.providerId, 10);
    if (!providerId) return res.status(400).json({ error: 'providerId invalide' });

    const items = await loadAllLibraryItems();
    const missing = items.some((x) => !providerCache[`${x.type}:${x.tmdbId}`]);
    if (missing && !warm.warming) warmProviders(); // fire-and-forget

    const result = items
      .filter((x) => (providerCache[`${x.type}:${x.tmdbId}`] || []).includes(providerId))
      .map((x) => x.item);

    res.json({
      items: result,
      total: result.length,
      scanned: items.length,
      warming: warm.warming || missing,
      done: warm.done,
      totalToScan: warm.total || items.length,
    });
  } catch (e) {
    console.error('[Platform] error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════
//  LIVE TV — Threadfin (IPTV) integration. Parses the M3U channel
//  list + XMLTV EPG, exposes them to the V2 "Direct" section, and
//  proxies the MPEG-TS streams (JWT-gated) so the client never sees
//  Threadfin directly. Streams are H.264/AAC TS → played by mpegts.js.
// ═══════════════════════════════════════════════════════════
const THREADFIN_URL = (process.env.THREADFIN_URL || '').replace(/\/$/, '');
const THREADFIN_M3U = process.env.THREADFIN_M3U || '/m3u/threadfin.m3u';
const THREADFIN_XMLTV = process.env.THREADFIN_XMLTV || '/xmltv/threadfin.xml';
const LIVE_TTL = 30 * 60 * 1000; // 30 min

// In-memory cache of the parsed channel list + EPG.
let liveCache = { at: 0, channels: [], byId: new Map(), groups: [], epg: {}, loading: null };

function decodeXmlEntities(s) {
  return (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&').trim();
}

// XMLTV date: "20260613000000 +0200" → epoch ms.
function parseXmltvDate(s) {
  const m = (s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return 0;
  const [, Y, Mo, D, H, Mi, S, tz] = m;
  const off = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : 'Z';
  return Date.parse(`${Y}-${Mo}-${D}T${H}:${Mi}:${S}${off}`);
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXTINF')) continue;
    const attrs = {};
    for (const m of lines[i].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
    // The display name (after the last comma) is more reliable than tvg-name:
    // this M3U mis-escapes apostrophes as double-quotes (tvg-name="L"ÉQUIPE TV"),
    // which truncates the parsed attribute. Sanitize stray quotes → apostrophes.
    const name = (lines[i].split(',').slice(1).join(',').trim() || attrs['tvg-name'] || '').replace(/"/g, "'") || 'Chaîne';
    // the stream URL is the next non-comment, non-empty line
    let url = '';
    for (let j = i + 1; j < lines.length; j++) {
      const v = lines[j].trim();
      if (!v) continue;
      if (v.startsWith('#')) continue;
      url = v; i = j; break;
    }
    if (!url) continue;
    // store path only — we re-attach it to THREADFIN_URL at proxy time so the
    // container-internal host (172.31.x) never leaks and is always reachable.
    let streamPath = url;
    try { const u = new URL(url); streamPath = u.pathname + u.search; } catch {}
    // routing id: prefer the clean tvg-id (also the EPG key), fall back to the
    // unique channelID, then an index. Guarantee uniqueness for stream lookups.
    let id = attrs['tvg-id'] || attrs['channelID'] || String(channels.length + 1);
    if (seen.has(id)) id = `${id}_${channels.length}`;
    seen.add(id);
    channels.push({
      id,
      epgId: attrs['tvg-id'] || null,
      name,
      num: attrs['tvg-chno'] ? parseInt(attrs['tvg-chno'], 10) : null,
      logo: attrs['tvg-logo'] || null,
      group: attrs['group-title'] || 'Autres',
      _stream: streamPath,
    });
  }
  return channels;
}

function parseXmltv(text) {
  const byCh = {};
  const cutoff = Date.now() - 3 * 3600 * 1000; // drop programmes that ended >3h ago
  const re = /<programme\s+channel="([^"]*)"\s+start="([^"]*)"\s+stop="([^"]*)"[^>]*>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = re.exec(text))) {
    const stop = parseXmltvDate(m[3]);
    if (stop && stop < cutoff) continue;
    const inner = m[4];
    const t = inner.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const d = inner.match(/<desc[^>]*>([\s\S]*?)<\/desc>/);
    const c = inner.match(/<category[^>]*>([\s\S]*?)<\/category>/);
    (byCh[m[1]] = byCh[m[1]] || []).push({
      start: parseXmltvDate(m[2]),
      stop,
      title: decodeXmlEntities(t ? t[1] : ''),
      desc: decodeXmlEntities(d ? d[1] : ''),
      category: decodeXmlEntities(c ? c[1] : ''),
    });
  }
  for (const k in byCh) byCh[k].sort((a, b) => a.start - b.start);
  return byCh;
}

// now / next programme for a channel from its sorted EPG slice.
function nowNext(epgId, epg) {
  const list = (epgId && epg[epgId]) || [];
  const now = Date.now();
  let cur = null, nxt = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].start <= now && now < list[i].stop) {
      cur = list[i];
      // next = first programme that starts at/after the current one ends
      // (skips duplicate/overlapping EPG entries some channels emit)
      for (let j = i + 1; j < list.length; j++) { if (list[j].start >= cur.stop) { nxt = list[j]; break; } }
      break;
    }
    if (list[i].start > now) { nxt = list[i]; break; }
  }
  const fmt = (p) => p && {
    title: p.title, start: p.start, stop: p.stop,
    progress: p.stop > p.start ? Math.max(0, Math.min(1, (now - p.start) / (p.stop - p.start))) : 0,
  };
  return { now: fmt(cur), next: nxt && { title: nxt.title, start: nxt.start, stop: nxt.stop } };
}

async function loadLiveData(force = false) {
  if (!THREADFIN_URL) return liveCache;   // TV en direct non configurée : rien à charger
  if (!force && liveCache.channels.length && Date.now() - liveCache.at < LIVE_TTL) return liveCache;
  if (liveCache.loading) return liveCache.loading;
  liveCache.loading = (async () => {
    try {
      const [m3uRes, xmlRes] = await Promise.all([
        fetch(`${THREADFIN_URL}${THREADFIN_M3U}`, { signal: AbortSignal.timeout(20000) }),
        fetch(`${THREADFIN_URL}${THREADFIN_XMLTV}`, { signal: AbortSignal.timeout(30000) }).catch(() => null),
      ]);
      if (!m3uRes.ok) throw new Error(`M3U HTTP ${m3uRes.status}`);
      const channels = parseM3U(await m3uRes.text());
      let epg = {};
      try { if (xmlRes && xmlRes.ok) epg = parseXmltv(await xmlRes.text()); } catch (e) { console.warn('[Live] EPG parse failed:', e.message); }
      const byId = new Map(channels.map((c) => [c.id, c]));
      const groups = [...new Set(channels.map((c) => c.group))];
      liveCache = { at: Date.now(), channels, byId, groups, epg, loading: null };
      console.log(`[Live] Loaded ${channels.length} channels, ${Object.keys(epg).length} EPG channels.`);
    } catch (e) {
      console.warn('[Live] load error:', e.message);
      liveCache.loading = null;
      if (!liveCache.channels.length) throw e;
    }
    return liveCache;
  })();
  return liveCache.loading;
}

// Channel list with now/next EPG (no stream URLs exposed).
app.get('/api/live/channels', authMiddleware, async (req, res) => {
  try {
    const c = await loadLiveData();
    const channels = c.channels.map((ch) => ({
      id: ch.id, name: ch.name, num: ch.num, logo: ch.logo, group: ch.group,
      ...nowNext(ch.epgId, c.epg),
    }));
    res.json({ channels, groups: c.groups, at: c.at });
  } catch (e) {
    res.status(502).json({ error: 'Threadfin injoignable' });
  }
});

// Full schedule for one channel (for the future EPG guide).
app.get('/api/live/epg/:id', authMiddleware, async (req, res) => {
  try {
    const c = await loadLiveData();
    const ch = c.byId.get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Chaîne inconnue' });
    res.json({ id: ch.id, name: ch.name, programmes: (ch.epgId && c.epg[ch.epgId]) || [] });
  } catch (e) {
    res.status(502).json({ error: 'Service injoignable' });
  }
});

// MPEG-TS stream proxy (JWT via header or ?nova=). Pipes Threadfin → client,
// re-attaching the path to the reachable THREADFIN_URL host. Built to be reused
// by the upcoming multi-channel "Mosaïque" mode (several concurrent instances).
app.get('/api/live/stream/:id', proxyAuth, async (req, res) => {
  try {
    const c = await loadLiveData();
    const ch = c.byId.get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Chaîne inconnue' });
    const targetUrl = `${THREADFIN_URL}${ch._stream}`;

    const controller = new AbortController();
    // guard only the initial connection (some channels buffer for a few seconds)
    const connectTimer = setTimeout(() => controller.abort(), 25000);
    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', 'Accept': '*/*' },
        signal: controller.signal,
      });
    } finally { clearTimeout(connectTimer); }

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: `Flux indisponible (HTTP ${upstream.status})` });
    }

    res.status(200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp2t');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const reader = upstream.body.getReader();
    const stream = new Readable({
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) this.push(null);
          else this.push(Buffer.from(value));
        } catch (err) { this.destroy(err); }
      },
    });
    stream.on('error', (err) => {
      console.warn('[Live Proxy] flux interrompu:', err.message);
      try { reader.cancel(); } catch {}
      if (!res.headersSent) { try { res.status(502).end(); } catch {} } else { res.destroy(); }
    });
    res.on('close', () => { try { reader.cancel(); } catch {} stream.destroy(); });
    stream.pipe(res);
  } catch (e) {
    console.error('[Live Proxy ERROR]', e.message);
    if (!res.headersSent) res.status(502).json({ error: 'Flux injoignable' });
  }
});

// ─── HLS on-demand (ffmpeg remux) ─────────────────────────────
// mpegts.js is unreliable across the channel mix (video-only / AC-3 / mobile /
// iOS has no MSE). So we remux each requested channel's MPEG-TS into rolling
// HLS with ffmpeg (video copy, audio→AAC = cheap) and play it via hls.js, which
// is already battle-tested in PlayerV2 and works everywhere.
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic;
const HLS_ROOT = path.join(os.tmpdir(), 'nova-live');
const HLS_IDLE_MS = 60000; // kill ffmpeg if no segment/playlist request for 60s
const hlsSessions = new Map(); // channelId -> { dir, proc, lastAccess }
try { fs.mkdirSync(HLS_ROOT, { recursive: true }); } catch {}

function startHlsSession(channel) {
  const dir = path.join(HLS_ROOT, channel.id.replace(/[^\w.-]/g, '_'));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(dir, { recursive: true });
  const url = `${THREADFIN_URL}${channel._stream}`;
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-fflags', '+genpts+discardcorrupt',
    // auto-reconnect to Threadfin if the upstream drops (fixes random freezes)
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-user_agent', 'VLC/3.0.20 LibVLC/3.0.20',
    '-i', url,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    // 20s rolling DVR window — more margin so hls.js doesn't fall off the edge
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
    '-hls_segment_filename', path.join(dir, 'seg%d.ts'),
    path.join(dir, 'index.m3u8'),
  ];
  const proc = spawn(FFMPEG, args, { windowsHide: true });
  proc.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) console.warn(`[Live HLS ${channel.name}] ${s.slice(0, 200)}`); });
  proc.on('exit', (code) => {
    const s = hlsSessions.get(channel.id);
    if (s && s.proc === proc) hlsSessions.delete(channel.id);
    if (code) console.warn(`[Live HLS] ffmpeg exited (${code}) for ${channel.name}`);
  });
  const session = { dir, proc, lastAccess: Date.now() };
  hlsSessions.set(channel.id, session);
  console.log(`[Live HLS] started ffmpeg for ${channel.name}`);
  return session;
}

async function ensureHls(channel) {
  let s = hlsSessions.get(channel.id);
  if (!s || s.proc.killed || s.proc.exitCode != null) s = startHlsSession(channel);
  s.lastAccess = Date.now();
  const idx = path.join(s.dir, 'index.m3u8');
  // wait (≤12s) for ffmpeg to produce the first playlist + segment
  for (let i = 0; i < 60 && !fs.existsSync(idx); i++) await new Promise((r) => setTimeout(r, 200));
  return s;
}

// HLS playlist — must be declared before the segment route so it wins.
app.get('/api/live/hls/:id/index.m3u8', proxyAuth, async (req, res) => {
  try {
    const c = await loadLiveData();
    const ch = c.byId.get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Chaîne inconnue' });
    const s = await ensureHls(ch);
    const idx = path.join(s.dir, 'index.m3u8');
    if (!fs.existsSync(idx)) return res.status(503).json({ error: 'Flux en préparation' });
    // append our auth token to each segment line (hls.js can't set headers)
    const tok = encodeURIComponent(req.query.nova || (req.headers.authorization || '').replace('Bearer ', ''));
    const pl = fs.readFileSync(idx, 'utf8').replace(/^(seg\d+\.ts)\s*$/gm, (m, f) => `${f}?nova=${tok}`);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(pl);
  } catch (e) {
    console.error('[Live HLS playlist]', e.message);
    if (!res.headersSent) res.status(502).json({ error: 'Service injoignable' });
  }
});

// HLS segment
app.get('/api/live/hls/:id/:seg', proxyAuth, (req, res) => {
  const s = hlsSessions.get(req.params.id);
  if (!s) return res.status(404).end();
  s.lastAccess = Date.now();
  const seg = path.basename(req.params.seg).replace(/[^\w.-]/g, '');
  const f = path.join(s.dir, seg);
  if (!f.startsWith(s.dir) || !fs.existsSync(f)) return res.status(404).end();
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  fs.createReadStream(f).pipe(res);
});

// reap idle ffmpeg sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of hlsSessions) {
    if (now - s.lastAccess > HLS_IDLE_MS) {
      try { s.proc.kill('SIGKILL'); } catch {}
      hlsSessions.delete(id);
      try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch {}
      console.log(`[Live HLS] reaped idle session ${id}`);
    }
  }
}, 10000);

// kill all ffmpeg on shutdown
function killAllHls() { for (const [, s] of hlsSessions) { try { s.proc.kill('SIGKILL'); } catch {} } }
process.on('SIGINT', () => { killAllHls(); process.exit(0); });
process.on('SIGTERM', () => { killAllHls(); process.exit(0); });
process.on('exit', killAllHls);

// Warm the channel list / EPG shortly after boot so the first user is instant.
setTimeout(() => { loadLiveData().catch(() => {}); }, 4000);

// ═══════════════════════════════════════════════════════════
//  DISNEY+ BRAND HUBS — classify Disney+ titles into the iconic
//  hubs (Marvel / Pixar / Star Wars / Nat Geo / Disney) using TMDB
//  production companies + networks. Cached on disk like providers.
// ═══════════════════════════════════════════════════════════
const COMPANY_CACHE_FILE = config.dataPath('company_cache.json');
let companyCache = {};
try { if (fs.existsSync(COMPANY_CACHE_FILE)) companyCache = JSON.parse(fs.readFileSync(COMPANY_CACHE_FILE, 'utf8')); } catch {}
let companySaveTimer = null;
function saveCompanyCacheSoon() {
  if (companySaveTimer) return;
  companySaveTimer = setTimeout(() => {
    companySaveTimer = null;
    try { fs.writeFileSync(COMPANY_CACHE_FILE, JSON.stringify(companyCache)); } catch (e) { console.warn('[Brands] save failed:', e.message); }
  }, 4000);
}

// Lower-cased production company + network names for a title, cached.
async function getTmdbCompanies(type, tmdbId) {
  const key = `${type}:${tmdbId}`;
  if (companyCache[key]) return companyCache[key];
  try {
    const r = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) { companyCache[key] = []; saveCompanyCacheSoon(); return []; }
    const d = await r.json();
    const names = [
      ...(d.production_companies || []).map((c) => c.name),
      ...(d.networks || []).map((n) => n.name),
    ].map((n) => n.toLowerCase());
    companyCache[key] = names;
    saveCompanyCacheSoon();
    return names;
  } catch { return []; }
}

const DISNEY_PROVIDER_ID = 337;
// Order matters: first match wins, `disney` is the catch-all Disney-branded hub.
const BRAND_TESTS = [
  ['marvel',   (names, title) => names.some((n) => n.includes('marvel'))],
  ['starwars', (names, title) => names.some((n) => n.includes('lucasfilm')) || /star wars/i.test(title)],
  ['pixar',    (names, title) => names.some((n) => n.includes('pixar'))],
  ['natgeo',   (names, title) => names.some((n) => n.includes('national geographic'))],
  ['disney',   (names, title) => names.some((n) => n.includes('disney'))],
];

let brandWarm = { warming: false, done: 0, total: 0 };
async function warmCompanies(items) {
  if (brandWarm.warming) return;
  brandWarm.warming = true;
  try {
    const todo = items.filter((x) => !companyCache[`${x.type}:${x.tmdbId}`]);
    brandWarm.total = items.length;
    brandWarm.done = items.length - todo.length;
    if (todo.length) console.log(`[Brands] Resolving companies for ${todo.length} Disney+ titles...`);
    await mapLimit(todo, 12, async (x) => { await getTmdbCompanies(x.type, x.tmdbId); brandWarm.done++; });
    if (todo.length) console.log('[Brands] Done.');
  } catch (e) {
    console.warn('[Brands] warm error:', e.message);
  } finally {
    brandWarm.warming = false;
  }
}

app.get('/api/brands/disney', authMiddleware, async (req, res) => {
  try {
    const items = await loadAllLibraryItems();
    const disneyItems = items.filter((x) => (providerCache[`${x.type}:${x.tmdbId}`] || []).includes(DISNEY_PROVIDER_ID));
    const missing = disneyItems.some((x) => !companyCache[`${x.type}:${x.tmdbId}`]);
    if (missing && !brandWarm.warming) warmCompanies(disneyItems); // fire-and-forget

    const brands = { marvel: [], starwars: [], pixar: [], natgeo: [], disney: [] };
    for (const x of disneyItems) {
      const names = companyCache[`${x.type}:${x.tmdbId}`];
      if (!names) continue;
      for (const [brand, test] of BRAND_TESTS) {
        if (test(names, x.item.title || '')) { brands[brand].push(x.item); break; }
      }
    }

    res.json({
      brands,
      warming: brandWarm.warming || missing,
      done: brandWarm.done,
      totalToScan: brandWarm.total || disneyItems.length,
    });
  } catch (e) {
    console.error('[Brands] error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════
//  ACTOR PAGES — TMDB person search + combined credits, cross-
//  referenced with the Plex library (by tmdbId). Budget / box-
//  office / countries are resolved (and disk-cached) for the
//  titles actually available on Nova.
// ═══════════════════════════════════════════════════════════
const MOVIE_FACTS_FILE = config.dataPath('movie_facts_cache.json');
let movieFactsCache = {};
try { if (fs.existsSync(MOVIE_FACTS_FILE)) movieFactsCache = JSON.parse(fs.readFileSync(MOVIE_FACTS_FILE, 'utf8')); } catch {}
let movieFactsSaveTimer = null;
function saveMovieFactsSoon() {
  if (movieFactsSaveTimer) return;
  movieFactsSaveTimer = setTimeout(() => {
    movieFactsSaveTimer = null;
    try { fs.writeFileSync(MOVIE_FACTS_FILE, JSON.stringify(movieFactsCache)); } catch (e) { console.warn('[Facts] save failed:', e.message); }
  }, 4000);
}

const TMDB_HEADERS = { get headers() { return { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' }; } };

// budget / revenue (movies) + production countries, cached on disk
async function getMovieFacts(type, tmdbId) {
  const key = `${type}:${tmdbId}`;
  if (movieFactsCache[key]) return movieFactsCache[key];
  try {
    const r = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?language=fr-FR`, { ...TMDB_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { movieFactsCache[key] = {}; saveMovieFactsSoon(); return {}; }
    const d = await r.json();
    const facts = {
      budget: d.budget || null,
      revenue: d.revenue || null,
      countries: (d.production_countries || []).map((c) => c.name).slice(0, 3),
    };
    movieFactsCache[key] = facts;
    saveMovieFactsSoon();
    return facts;
  } catch { return {}; }
}

const actorCache = new Map(); // name -> { at, data }, in-memory 24h
app.get('/api/actor/:name', authMiddleware, async (req, res) => {
  try {
    const name = (req.params.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    const ck = name.toLowerCase();
    const hit = actorCache.get(ck);
    if (hit && Date.now() - hit.at < 86400000) return res.json(hit.data);

    const sr = await (await fetch(`https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(name)}&language=fr-FR`, { ...TMDB_HEADERS, signal: AbortSignal.timeout(8000) })).json();
    const person = sr.results?.[0];
    if (!person) return res.status(404).json({ error: 'Personne introuvable sur TMDB' });

    const [details, credits] = await Promise.all([
      (await fetch(`https://api.themoviedb.org/3/person/${person.id}?language=fr-FR`, { ...TMDB_HEADERS, signal: AbortSignal.timeout(8000) })).json(),
      (await fetch(`https://api.themoviedb.org/3/person/${person.id}/combined_credits?language=fr-FR`, { ...TMDB_HEADERS, signal: AbortSignal.timeout(8000) })).json(),
    ]);

    const items = await loadAllLibraryItems();
    const libMap = new Map(items.map((x) => [`${x.type}:${x.tmdbId}`, x.item]));

    const seen = new Set();
    const credList = (credits.cast || [])
      .filter((c) => (c.media_type === 'movie' || c.media_type === 'tv') && (c.poster_path || (c.popularity || 0) > 1))
      .filter((c) => { const k = `${c.media_type}:${c.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((c) => {
        const lib = libMap.get(`${c.media_type === 'movie' ? 'movie' : 'tv'}:${c.id}`);
        return {
          tmdbId: c.id,
          type: c.media_type,
          title: c.title || c.name,
          year: parseInt((c.release_date || c.first_air_date || '').slice(0, 4), 10) || null,
          poster: c.poster_path ? `https://image.tmdb.org/t/p/w342${c.poster_path}` : null,
          character: c.character || null,
          popularity: c.popularity || 0,
          ratingKey: lib ? lib.ratingKey : null,
        };
      })
      .sort((a, b) => b.popularity - a.popularity);

    // facts only for the titles available on Nova (small, cached set)
    await mapLimit(credList.filter((c) => c.ratingKey), 8, async (c) => {
      const facts = await getMovieFacts(c.type === 'movie' ? 'movie' : 'tv', c.tmdbId);
      c.budget = facts.budget || null;
      c.revenue = facts.revenue || null;
      c.countries = facts.countries || [];
    });

    const data = {
      id: person.id,
      name: details.name || person.name,
      photo: details.profile_path ? `https://image.tmdb.org/t/p/h632${details.profile_path}` : null,
      biography: details.biography || null,
      birthday: details.birthday || null,
      deathday: details.deathday || null,
      birthPlace: details.place_of_birth || null,
      department: details.known_for_department || null,
      credits: credList.slice(0, 80),
    };
    actorCache.set(ck, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    console.error('[Actor] error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════
//  WRAPPED — per-user viewing stats (Spotify-Wrapped style).
//  watch_progress = how much of what; user_activity = when.
//  Genres / shows / actors come from Plex metadata, disk-cached.
// ═══════════════════════════════════════════════════════════
const WRAPPED_META_FILE = config.dataPath('wrapped_meta_cache.json');
let wrappedMetaCache = {};
try { if (fs.existsSync(WRAPPED_META_FILE)) wrappedMetaCache = JSON.parse(fs.readFileSync(WRAPPED_META_FILE, 'utf8')); } catch {}
let wrappedSaveTimer = null;
function saveWrappedMetaSoon() {
  if (wrappedSaveTimer) return;
  wrappedSaveTimer = setTimeout(() => {
    wrappedSaveTimer = null;
    try { fs.writeFileSync(WRAPPED_META_FILE, JSON.stringify(wrappedMetaCache)); } catch (e) { console.warn('[Wrapped] save failed:', e.message); }
  }, 4000);
}

// Resolve a watched mediaId to { type, title, showTitle, showId, genres, actors }.
// Episodes inherit genres/actors from their show (fetched once, cached too).
async function getWatchMeta(mediaId) {
  if (mediaId in wrappedMetaCache) return wrappedMetaCache[mediaId];
  try {
    let d;
    try { d = await plexJson(`/library/metadata/${mediaId}`); }
    catch { wrappedMetaCache[mediaId] = null; saveWrappedMetaSoon(); return null; }
    const item = d?.MediaContainer?.Metadata?.[0];
    if (!item) { wrappedMetaCache[mediaId] = null; saveWrappedMetaSoon(); return null; }
    let meta;
    if (item.type === 'episode') {
      const showId = item.grandparentRatingKey || null;
      const show = showId ? await getWatchMeta(showId) : null;
      meta = {
        type: 'episode', title: item.title, showId,
        showTitle: item.grandparentTitle || (show ? show.title : null),
        genres: (show && show.genres) || [], actors: (show && show.actors) || [],
      };
    } else {
      meta = {
        type: item.type, title: item.title,
        genres: (item.Genre || []).map((g) => g.tag).slice(0, 5),
        actors: (item.Role || []).map((x) => x.tag).slice(0, 5),
      };
    }
    wrappedMetaCache[mediaId] = meta;
    saveWrappedMetaSoon();
    return meta;
  } catch { return null; }
}

const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

app.get('/api/me/wrapped', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = db.prepare('SELECT * FROM watch_progress WHERE userId = ?').all(userId);
    const plays = db.prepare("SELECT timestamp FROM user_activity WHERE userId = ? AND type = 'play'").all(userId);

    // total watch time: completed → full duration, else farthest position
    let totalSeconds = 0;
    let moviesCompleted = 0;
    let episodesWatched = 0;
    for (const row of rows) {
      totalSeconds += row.completed ? (row.duration || row.currentTime || 0) : (row.currentTime || 0);
      if (row.mediaType === 'movie' && row.completed) moviesCompleted++;
      if (row.mediaType === 'episode' && (row.completed || (row.duration > 0 && row.currentTime / row.duration > 0.7))) episodesWatched++;
    }

    // resolve metadata for everything watched (cached after first run)
    await mapLimit(rows, 8, async (row) => { row._meta = await getWatchMeta(row.mediaId); });

    const genreSec = {};
    const showAgg = {}; // showTitle -> { seconds, episodes, poster }
    const actorAgg = {};
    for (const row of rows) {
      const m = row._meta;
      if (!m) continue;
      const sec = row.completed ? (row.duration || 0) : (row.currentTime || 0);
      for (const g of m.genres || []) genreSec[g] = (genreSec[g] || 0) + sec;
      for (const a of m.actors || []) actorAgg[a] = (actorAgg[a] || 0) + sec;
      if (m.type === 'episode' && m.showTitle) {
        const s = (showAgg[m.showTitle] ||= { seconds: 0, episodes: 0, poster: null, showId: m.showId });
        s.seconds += sec;
        s.episodes += 1;
        if (!s.poster && row.mediaPoster) s.poster = row.mediaPoster;
      }
    }

    const topGenres = Object.entries(genreSec).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, seconds]) => ({ name, seconds: Math.round(seconds) }));
    const topShows = Object.entries(showAgg).sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 5)
      .map(([title, s]) => ({ title, episodes: s.episodes, seconds: Math.round(s.seconds), poster: s.poster, showId: s.showId }));
    const topActors = Object.entries(actorAgg).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, seconds]) => ({ name, seconds: Math.round(seconds) }));

    // when do they watch? (server local time = Paris)
    const dayCount = [0, 0, 0, 0, 0, 0, 0];
    let night = 0;
    let firstPlay = null;
    for (const p of plays) {
      const d = new Date(p.timestamp);
      if (isNaN(d)) continue;
      dayCount[d.getDay()]++;
      const h = d.getHours();
      if (h >= 22 || h < 4) night++;
      if (!firstPlay || d < firstPlay) firstPlay = d;
    }
    const busiestDayIdx = dayCount.indexOf(Math.max(...dayCount));

    res.json({
      username: req.user.username,
      totalSeconds: Math.round(totalSeconds),
      moviesCompleted,
      episodesWatched,
      distinctTitles: rows.length,
      distinctShows: Object.keys(showAgg).length,
      sessions: plays.length,
      topGenres,
      topShows,
      topActors,
      busiestDay: plays.length ? DAYS_FR[busiestDayIdx] : null,
      nightOwlPct: plays.length ? Math.round((night / plays.length) * 100) : 0,
      firstPlay: firstPlay ? firstPlay.toISOString() : null,
    });
  } catch (e) {
    console.error('[Wrapped] error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════
//  PERSONAL MATCH SCORES — "97% pour toi", computed from the
//  user's own watch profile (genres + actors actually watched).
//  Strictly per-user: keyed by the JWT userId, cached 1h.
// ═══════════════════════════════════════════════════════════
const matchScoreCache = new Map(); // userId -> { at, data }

app.get('/api/me/match-scores', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const hit = matchScoreCache.get(userId);
    if (hit && Date.now() - hit.at < 3600000) return res.json(hit.data);

    const rows = db.prepare('SELECT * FROM watch_progress WHERE userId = ?').all(userId);
    await mapLimit(rows, 8, async (row) => { row._meta = await getWatchMeta(row.mediaId); });

    // taste profile: seconds watched per genre / per actor (≥5 min only)
    const genreW = {};
    const actorW = {};
    let totalSec = 0;
    for (const row of rows) {
      const m = row._meta;
      if (!m) continue;
      const sec = row.completed ? (row.duration || 0) : (row.currentTime || 0);
      if (sec < 300) continue;
      for (const g of m.genres || []) genreW[g] = (genreW[g] || 0) + sec;
      for (const a of (m.actors || []).slice(0, 3)) actorW[a] = (actorW[a] || 0) + sec;
      totalSec += sec;
    }

    if (totalSec === 0) {
      const empty = { scores: {}, hasProfile: false };
      matchScoreCache.set(userId, { at: Date.now(), data: empty });
      return res.json(empty);
    }

    const maxG = Math.max(...Object.values(genreW), 1);
    const items = await loadAllLibraryItems();
    const scores = {};
    for (const x of items) {
      const genres = (x.item.Genre || []).map((g) => g.tag);
      if (!genres.length) continue;
      let affinity = 0;
      for (const g of genres) affinity += (genreW[g] || 0) / maxG;
      affinity /= genres.length; // 0..1
      let actorBonus = 0;
      for (const ro of (x.item.Role || []).slice(0, 3)) {
        if (actorW[ro.tag]) actorBonus += 0.05;
      }
      const pct = Math.round(58 + affinity * 38 + Math.min(actorBonus, 0.1) * 100);
      scores[x.item.ratingKey] = Math.max(55, Math.min(99, pct));
    }

    const data = { scores, hasProfile: true };
    matchScoreCache.set(userId, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    console.error('[Match] error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/* Vidéo HLS de Jellyfin : playlists et segments, jeton Jellyfin ajouté ici —
   le navigateur ne le voit jamais. Voir jellyfin.js (servirHls). */
app.use('/jfhls', proxyAuth, async (req, res) => {
  try {
    if (!estJellyfin()) return res.status(404).end();
    const [chemin, qs = ''] = req.url.split('?');
    await jelly.servirHls(req, res, chemin, qs, (u) => avecJeton(u, req.query.nova), (n) => prive.estTitrePrive(n));
  } catch (e) {
    console.warn('[Jellyfin HLS]', e.message);
    if (!res.headersSent) res.status(502).end();
  }
});

app.use('/plex', proxyAuth, async (req, res) => {
  try {
    // Strip our own `nova` auth param so it is never forwarded to Plex.
    let plexPath = req.url.replace(/([?&])nova=[^&]*(&|$)/, (m, p1, p2) => (p1 === '?' && p2 === '&') ? '?' : (p2 === '&' ? p1 : ''));

    // Method/path allowlist. The app only ever READS from Plex (+ selects an
    // audio/subtitle track via PUT /library/parts). Block everything else so a
    // stolen/rogue Nova token can't drive destructive Plex admin APIs with the
    // owner token (delete libraries, edit settings, etc.).
    const method = (req.method || 'GET').toUpperCase();
    const allowedWrite = method === 'PUT' && /\/library\/parts\//.test(plexPath);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !allowedWrite) {
      return res.status(403).json({ error: 'Méthode non autorisée' });
    }
    // Contenu d'une bibliothèque privée : il n'existe pas (fiche, image, fichier).
    if (prive.cheminInterdit(plexPath)) return res.status(404).json({ error: 'Introuvable' });

    // Serveur Jellyfin : la requête « Plex » est traduite (voir jellyfin.js).
    if (estJellyfin()) return await jelly.servirProxy(req, res, plexPath, (j, c) => prive.filtrerJson(j, c));

    const separator = plexPath.includes('?') ? '&' : '?';
    // Compte Plex relié → on parle à Plex EN SON NOM : la séance s'affiche à son
    // nom et c'est Plex lui-même qui tient sa progression à jour.
    const targetUrl = `${PLEX_URL}${plexPath}${separator}X-Plex-Token=${tokenPour(req)}`;
    
    // Debug logging for HLS/transcode requests
    if (plexPath.includes('/library/metadata/')) {
       console.log(`[Plex Metadata] Requesting: ${plexPath}`);
    }
    if (plexPath.includes('/transcode/') || plexPath.includes('/session/') || plexPath.endsWith('.ts') || plexPath.endsWith('.m3u8')) {
      console.log(`[Proxy HLS] ${req.method} ${plexPath.substring(0, 120)}`);
    }
    const isRangeRequest = !!req.headers['range'];
    const isTranscode = plexPath.includes('/transcode/') || plexPath.includes('.m3u8') || plexPath.includes('.ts') || plexPath.includes('/session/');

    // Never cache transcode/HLS requests
    if (!isRangeRequest && !isTranscode) {
      const cached = getCached(plexPath);
      if (cached) {
        res.status(cached.status);
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('X-Cache', 'HIT');
        return res.send(cached.body);
      }
    }

    const headers = { 
      'Accept': req.headers['accept'] || '*/*',
      'User-Agent': req.headers['user-agent'],
      'X-Plex-Client-Identifier': req.headers['x-plex-client-identifier'] || 'novastream-web',
      'X-Plex-Product': 'Plex Web',
      'X-Plex-Platform': 'Chrome',
      'X-Plex-Device': 'Windows'
    };
    if (isRangeRequest) headers['Range'] = req.headers['range'];

    // Guard only the initial connection (until headers arrive). We must NOT abort
    // during body streaming, otherwise long direct-play videos get cut off after
    // the timeout — which previously crashed the server via an unhandled stream error.
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), isTranscode ? 30000 : 15000);
    let response;
    try {
      response = await fetch(targetUrl, { method: req.method, headers, signal: controller.signal });
    } finally {
      clearTimeout(connectTimer);
    }
    const contentType = response.headers.get('content-type') || '';
    
    // Detailed logging for troubleshooting
    if (!response.ok) {
      console.warn(`[Plex Proxy WARN] Plex returned ${response.status} for ${plexPath}`);
      if (response.status === 401) console.error('[Plex Proxy ERROR] AUTHENTICATION FAILED - Check PLEX_TOKEN');
    } else {
      console.log(`[Plex Proxy OK] ${response.status} (${contentType}) for ${plexPath.substring(0, 50)}`);
    }

    // ─── HLS Playlists (.m3u8) — rewrite URLs ────────────────
    if (contentType.includes('mpegurl') || plexPath.endsWith('.m3u8') || plexPath.includes('index.m3u8')) {
      const body = await response.text();
      const host = req.get('host');
      /* Playlist maîtresse : on réécrit les sous-playlists vers le proxy.
         Playlist média : on ne touche qu'aux URI de segments, pour y remettre le
         jeton que la résolution d'URL relative aurait perdu (lecture native). */
      const nova = req.query.nova;
      const rewritten = plexPath.includes('start.m3u8')
        ? rewriteHLSPlaylist(body, host, nova)
        : jetonSurSegments(body, nova);
      
      res.status(response.status);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      return res.send(rewritten);
    }

    // ─── HLS Segments (.ts) & Streaming media ────────────────
    if (contentType.startsWith('video/') || contentType.startsWith('audio/') ||
        contentType === 'application/octet-stream' || contentType.includes('mp2t') ||
        isRangeRequest || isTranscode) {
      res.status(response.status);
      for (const h of ['content-type','content-length','content-range','accept-ranges','cache-control']) {
        const val = response.headers.get(h);
        if (val) res.setHeader(h, val);
      }
      if (!response.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (response.body) {
        const reader = response.body.getReader();
        const stream = new Readable({
          async read() {
            try {
              const { done, value } = await reader.read();
              if (done) this.push(null);
              else this.push(Buffer.from(value));
            } catch (err) { this.destroy(err); }
          }
        });
        // Must handle 'error' or Node crashes the whole process on a stream error
        // (e.g. client disconnects / Plex drops the connection mid-stream).
        stream.on('error', (err) => {
          console.warn('[Plex Proxy] Flux interrompu:', err.message);
          try { reader.cancel(); } catch {}
          if (!res.headersSent) { try { res.status(502).end(); } catch {} }
          else { res.destroy(); }
        });
        // When the client closes the connection (seek / navigate away), stop reading
        // from Plex so we don't leak the upstream connection.
        res.on('close', () => { try { reader.cancel(); } catch {} stream.destroy(); });
        stream.pipe(res);
      } else { res.end(); }
      return;
    }

    // ─── JSON / Images / Other responses ─────────────────────
    let buffer = Buffer.from(await response.arrayBuffer());
    // Réponses JSON : on retire les titres des bibliothèques privées AVANT la
    // mise en cache (listes, recherche, hubs, « récemment ajoutés »…).
    if (contentType.includes('json') && response.ok) {
      try { buffer = Buffer.from(JSON.stringify(prive.filtrerJson(JSON.parse(buffer.toString('utf8')), plexPath.split('?')[0]))); }
      catch { /* JSON illisible : on le laisse tel quel */ }
    }
    if (buffer.length < 5 * 1024 * 1024 && !isTranscode) {
      setCached(plexPath, { time: Date.now(), status: response.status, contentType, body: buffer });
    }
    res.status(response.status);
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('X-Cache', 'MISS');
    if (contentType.startsWith('image/')) res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    // Chemin que la traduction Jellyfin ne connaît pas, ou titre introuvable.
    if (err.statut === 404) { if (!res.headersSent) res.status(404).json({ error: 'Introuvable' }); return; }
    console.error(`[Proxy média] ${req.url} - Error: ${err.message}`);
    // Don't leak internal infra (Plex URL/IP) or raw exception text to clients.
    if (!res.headersSent) res.status(502).json({ error: 'Serveur média injoignable' });
  }
});

// ═══════════════════════════════════════════════════════════
//  WATCH PARTY (Regarder ensemble — Bêta 2.5)
//  Wrap the app in an HTTP server so Socket.io can share the port.
//  Registered BEFORE the SPA fallback so /api/watch/* wins.
// ═══════════════════════════════════════════════════════════
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: true, methods: ['GET', 'POST'] } });
setupWatchParty({ app, io, JWT_SECRET, authMiddleware, watchApi });

// ═══════════════════════════════════════════════════════════
//  FRONTEND
// ═══════════════════════════════════════════════════════════
const distPath = path.join(__dirname, 'dist');

// Hashed build assets (filename changes on every build) → cache aggressively.
app.use('/assets', express.static(path.join(distPath, 'assets'), {
  maxAge: '1y',
  immutable: true,
  etag: true
}));

// Other static files; index.html must never be cached so reloads always pick
// up the latest build (which then points to the latest hashed assets).
app.use(express.static(distPath, {
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// SPA fallback — always serve a fresh, uncached index.html.
app.use((req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(distPath, 'index.html'));
});

// ─── Create first invite code if none exist ─────────────────
const codeCount = db.prepare('SELECT COUNT(*) as count FROM invitation_codes').get().count;
if (codeCount === 0) {
  const firstCode = generateCode();
  db.prepare('INSERT INTO invitation_codes (code) VALUES (?)').run(firstCode);
  console.log(`\n  🎟️  Premier code d'invitation: ${firstCode}\n`);
}

server.listen(PORT, '0.0.0.0', () => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║           🎬  NovaStream Server  🎬             ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  Local:   http://localhost:${PORT}               ║`);
  console.log(`  ║  Plex:    ${PLEX_URL || 'non relié — ouvrez le site pour le configurer'}`);
  console.log(`  ║  Users:   ${userCount} registered                       ║`);
  console.log('  ║  Auth:    JWT 30 days ✓                         ║');
  console.log('  ║  DB:      SQLite ✓                              ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
  
  // Pre-warm the streaming-provider cache in the background so platform pages
  // are fast. Runs once a few seconds after boot (and is a no-op if cached).
  setTimeout(() => { warmProviders().catch(() => {}); }, 8000);

  // Plex Heartbeat Monitor — gentle: 5 min interval, 60s startup delay, 10s timeout
  setTimeout(() => {
    setInterval(async () => {
      try {
        if (!config.serveurType()) return;
        await plexJsonBrut('/identity');
      } catch (e) {
        console.error(`[Heartbeat] Serveur multimédia injoignable : ${e.message}`);
      }
    }, 300000); // Check every 5 minutes
  }, 60000); // Wait 60s before first check
});
