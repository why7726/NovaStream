// ═══════════════════════════════════════════════════════════════════
//  Lecture de qBittorrent (jamais d'écriture)
//
//  Sert au cas « aucune source ne me convient, je l'ajoute moi-même » :
//  Nova surveille alors qBittorrent et retrouve TOUT SEUL le bon
//  téléchargement parmi les autres, en comparant les noms.
//
//  On ne touche à rien : pas d'ajout, pas de suppression, pas de pause.
// ═══════════════════════════════════════════════════════════════════
import http from 'node:http';

const env = (k, d = '') => process.env[k] || d;
// Pas d'adresse par défaut : sans réglage, la fonction reste simplement éteinte.
const QB_URL = () => env('QBIT_URL').replace(/\/$/, '');
const QB_USER = () => env('QBIT_USER');
const QB_PASS = () => env('QBIT_PASS');

export const qbitConfigured = () => !!QB_URL();

let cookie = null;
let cookieAt = 0;

function request(pathname, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(QB_URL() + pathname);
    const payload = body || null;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(payload ? {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payload),
          } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        timeout: 15000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('qBittorrent injoignable')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* Après un refus, on attend 15 min avant de réessayer : qBittorrent bannit
   l'adresse IP après quelques échecs, et une tentative par minute avec un
   mauvais mot de passe suffisait à rester banni indéfiniment. */
let refusA = 0;
const PAUSE_APRES_REFUS = 15 * 60 * 1000;

async function login() {
  if (cookie && Date.now() - cookieAt < 30 * 60 * 1000) return cookie;
  if (Date.now() - refusA < PAUSE_APRES_REFUS) throw new Error('Connexion qBittorrent refusée (nouvel essai dans quelques minutes)');
  const body = `username=${encodeURIComponent(QB_USER())}&password=${encodeURIComponent(QB_PASS())}`;
  const r = await request('/api/v2/auth/login', { method: 'POST', body, headers: { Referer: QB_URL() } });
  if (!/Ok/i.test(r.body)) { refusA = Date.now(); throw new Error('Connexion qBittorrent refusée'); }
  refusA = 0;
  const set = r.headers['set-cookie'];
  cookie = set ? String(set[0]).split(';')[0] : null;
  cookieAt = Date.now();
  return cookie;
}

/** Tous les téléchargements en cours ou terminés. */
export async function listTorrents() {
  await login();
  const r = await request('/api/v2/torrents/info');
  if (r.status === 403) { cookie = null; await login(); return listTorrents(); }
  try { return JSON.parse(r.body); } catch { return []; }
}

/* ── Reconnaissance du bon téléchargement ───────────────────────────
   Les noms de torrents sont bruités (points, tags, résolution…) : on
   compare des mots normalisés, et l'année départage les homonymes. */
function words(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 2 && !/^(the|les|des|une|est|and|for|with|from|multi|vff|vostfr|1080p|2160p|720p|bluray|webrip|web|dl|x264|x265|hevc|av1|aac|dts)$/.test(w));
}

export function matchScore(torrentName, { title, year }) {
  const a = words(title);
  const b = words(torrentName);
  if (!a.length || !b.length) return 0;
  const hits = a.filter((w) => b.includes(w)).length;
  let score = hits / a.length;                       // proportion du titre retrouvée
  if (year && new RegExp(`\\b${year}\\b`).test(torrentName)) score += 0.25;
  else if (year && /\b(19|20)\d{2}\b/.test(torrentName)) score -= 0.15;  // autre année = autre film
  return score;
}

/**
 * Retrouve le téléchargement correspondant à une demande.
 * @returns {null | { hash, name, progress, state, etaSeconds, savePath, score }}
 */
export async function findForRequest({ title, year }, minScore = 0.6) {
  const torrents = await listTorrents();
  let best = null;
  for (const t of torrents) {
    const score = matchScore(t.name, { title, year });
    if (score >= minScore && (!best || score > best.score)) {
      best = {
        hash: t.hash,
        name: t.name,
        progress: Math.round((t.progress || 0) * 100),
        state: t.state,
        etaSeconds: t.eta && t.eta < 8640000 ? t.eta : null,
        savePath: t.content_path || t.save_path,
        score: Math.round(score * 100) / 100,
      };
    }
  }
  return best;
}

/** État d'un téléchargement déjà identifié. */
export async function statusOf(hash) {
  const torrents = await listTorrents();
  const t = torrents.find((x) => x.hash === hash);
  if (!t) return null;
  return {
    hash: t.hash,
    name: t.name,
    progress: Math.round((t.progress || 0) * 100),
    state: t.state,
    done: t.progress >= 1,
    etaSeconds: t.eta && t.eta < 8640000 ? t.eta : null,
    savePath: t.content_path || t.save_path,
  };
}

export default { qbitConfigured, listTorrents, findForRequest, statusOf, matchScore };
