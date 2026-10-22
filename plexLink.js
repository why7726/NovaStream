/* ══════════════════════════════════════════════════════════════════
   Connecteur « Mon compte Plex »

   Chaque utilisateur de Nova peut relier SON compte Plex, exactement
   comme le fait Overseerr : Plex donne un code à quatre caractères, on
   ouvre plex.tv, l'utilisateur valide, et on récupère son jeton.

   Une fois relié, deux choses se produisent :

   1. NOVA → PLEX. La lecture passe par le jeton de la personne au lieu
      du compte partagé « NovaStream ». Plex enregistre donc lui-même la
      progression sur SON compte — rien à resynchroniser, c'est natif.
   2. PLEX → NOVA. On relit son état de visionnage (vus + en cours) et on
      le recopie dans `watch_progress`. Les identifiants sont les mêmes
      des deux côtés (le ratingKey Plex EST le mediaId de Nova), donc la
      correspondance est directe, sans rapprochement par titre.

   ⚠️ Le compte doit avoir accès au serveur. Un compte Plex quelconque ne
   peut ni lire ni écrire quoi que ce soit ici : on le vérifie à la
   connexion et on refuse clairement plutôt que de laisser une liaison
   inerte qui casserait la lecture.
   ══════════════════════════════════════════════════════════════════ */

const PLEX_TV = 'https://plex.tv';
const PRODUIT = 'NovaStream';

// Identifiant d'appareil stable : Plex lie le PIN à ce client.
let clientId = null;
export function setClientId(id) { clientId = id; }
function entetes() {
  return {
    accept: 'application/json',
    'X-Plex-Product': PRODUIT,
    'X-Plex-Version': '1.0',
    'X-Plex-Client-Identifier': clientId || 'novastream-server',
    'X-Plex-Device': 'NovaStream',
    'X-Plex-Platform': 'Web',
  };
}

async function json(url, options = {}) {
  const r = await fetch(url, { ...options, headers: { ...entetes(), ...(options.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`plex.tv ${r.status}`);
  return r.json();
}

/** Crée un code d'association. → { id, code, url } */
export async function demarrerPin() {
  const d = await json(`${PLEX_TV}/api/v2/pins?strong=true`, { method: 'POST' });
  const params = new URLSearchParams({
    clientID: clientId || 'novastream-server',
    code: d.code,
    'context[device][product]': PRODUIT,
  });
  return { id: d.id, code: d.code, url: `https://app.plex.tv/auth#?${params.toString()}` };
}

/** Le code a-t-il été validé ? → jeton, ou null tant que l'utilisateur n'a pas fini. */
export async function jetonDuPin(pinId) {
  const d = await json(`${PLEX_TV}/api/v2/pins/${pinId}`);
  return d.authToken || null;
}

/** Qui est-ce ? → { plexId, username, email, thumb } */
export async function compteDe(token) {
  const d = await json(`${PLEX_TV}/api/v2/user`, { headers: { 'X-Plex-Token': token } });
  return { plexId: String(d.id), username: d.username || d.title || '', email: d.email || '', thumb: d.thumb || '' };
}

/** Ce compte a-t-il accès à NOTRE serveur ? (propriétaire ou invité) */
export async function aAccesAuServeur(token, machineId) {
  if (!machineId) return false;
  const list = await json(`${PLEX_TV}/api/v2/resources?includeHttps=1&includeRelay=1`, { headers: { 'X-Plex-Token': token } });
  return (Array.isArray(list) ? list : []).some(
    (r) => r.clientIdentifier === machineId && (r.provides || '').includes('server')
  );
}

/**
 * Serveurs Plex dont ce compte est PROPRIÉTAIRE — pour l'assistant de
 * premier démarrage. Chaque serveur porte son propre jeton d'accès et
 * la liste de ses adresses (réseau local d'abord, puis distantes).
 * @returns {Array<{id, nom, jeton, adresses: Array<{uri, locale}>}>}
 */
export async function serveursDuCompte(token) {
  const list = await json(`${PLEX_TV}/api/v2/resources?includeHttps=1`, { headers: { 'X-Plex-Token': token } });
  return (Array.isArray(list) ? list : [])
    .filter((r) => (r.provides || '').includes('server') && r.owned)
    .map((r) => ({
      id: r.clientIdentifier,
      nom: r.name,
      jeton: r.accessToken || token,
      adresses: (r.connections || [])
        .filter((c) => !c.relay)
        .sort((a, b) => Number(b.local) - Number(a.local))
        // l'adresse IP brute d'abord : elle marche sans résolution DNS plex.direct
        .map((c) => ({ uri: c.local ? `${c.protocol === 'https' ? 'http' : c.protocol}://${c.address}:${c.port}` : c.uri, locale: !!c.local })),
    }));
}

/* ── Compte partagé « NovaStream » : un compte GÉRÉ du Plex Home ──
   Un compte géré n'a pas de mot de passe : impossible de s'y connecter
   pour lire son jeton. Le compte administrateur, lui, peut « passer » sur
   ce compte (comme le sélecteur d'utilisateur de Plex) et en obtenir un.
   ⚠️ L'API v2 répond 404 pour ce changement : c'est l'adresse v1. */

/** Comptes gérés du Plex Home de l'administrateur → [{ id, nom, protege }] */
export async function comptesGeres(tokenAdmin) {
  const d = await json(`${PLEX_TV}/api/v2/home/users`, { headers: { 'X-Plex-Token': tokenAdmin } });
  return (d.users || [])
    .filter((u) => !u.admin && (u.restricted || u.restrictionProfile))
    .map((u) => ({ id: String(u.id), nom: u.title || u.username || '', protege: !!u.protected }));
}

/** Nouveau jeton, propre au serveur `machineId`, pour le compte géré `id`. */
export async function jetonCompteGere(tokenAdmin, id, machineId, pin) {
  const qs = pin ? `?pin=${encodeURIComponent(pin)}` : '';
  const r = await fetch(`${PLEX_TV}/api/home/users/${encodeURIComponent(id)}/switch${qs}`, {
    method: 'POST', headers: { ...entetes(), 'X-Plex-Token': tokenAdmin }, signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401 || r.status === 403) throw new Error(pin ? 'Code PIN refusé par Plex' : 'Ce compte est protégé par un code PIN');
  if (!r.ok) throw new Error(`plex.tv ${r.status}`);
  const txt = await r.text();
  let jetonCompte;
  try { const j = JSON.parse(txt); jetonCompte = j.authToken || j.authenticationToken || j.user?.authToken || j.user?.authenticationToken; }
  catch { jetonCompte = (txt.match(/authenticationToken="([^"]+)"/) || [])[1]; }
  if (!jetonCompte) throw new Error('Plex n\'a pas renvoyé de jeton');
  // Le serveur attend le jeton d'accès propre à ce serveur, pas celui du compte.
  const list = await json(`${PLEX_TV}/api/v2/resources?includeHttps=1`, { headers: { 'X-Plex-Token': jetonCompte } });
  const serveur = (Array.isArray(list) ? list : []).find((x) => (x.provides || '').includes('server') && (!machineId || x.clientIdentifier === machineId));
  return serveur?.accessToken || jetonCompte;
}

/* ── Lecture de l'état de visionnage sur le serveur, avec SON jeton ──
   `unwatched=0` liste ce qui est vu ; `viewOffset` porte la reprise. Sur une
   bibliothèque de séries, il faut interroger les ÉPISODES (type=4) : c'est
   à ce niveau que Plex range la progression. */
async function plexServeur(plexUrl, chemin, token) {
  const sep = chemin.includes('?') ? '&' : '?';
  const r = await fetch(`${plexUrl}${chemin}${sep}X-Plex-Token=${token}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Plex ${r.status}`);
  return r.json();
}

/**
 * État de visionnage d'un compte.
 *
 * ⚠️ On remonte `lastViewedAt` (date de visionnage côté Plex) : sans elle, la
 * recopie horodaterait les 1300 titres vus à l'instant de la synchro, ce qui
 * écrase tout ordre chronologique dans Nova — l'historique et la rangée
 * « Reprendre » deviennent alors du hasard.
 *
 * @returns {{vus: Array<{id, type, vuLe}>, enCours: Array<{id, position, duree, titre, type, vuLe}>}}
 */
export async function etatDeVisionnage(plexUrl, token) {
  const secs = await plexServeur(plexUrl, '/library/sections', token);
  const sections = (secs?.MediaContainer?.Directory || []).filter((s) => ['movie', 'show'].includes(s.type));

  const vus = new Map();
  const enCours = new Map();

  for (const sec of sections) {
    const type = sec.type === 'show' ? 4 : 1;   // épisodes pour les séries
    try {
      const d = await plexServeur(plexUrl, `/library/sections/${sec.key}/all?type=${type}&unwatched=0`, token);
      for (const m of (d?.MediaContainer?.Metadata || [])) {
        if ((m.viewCount || 0) > 0) {
          vus.set(String(m.ratingKey), {
            id: String(m.ratingKey),
            type: m.type || (type === 4 ? 'episode' : 'movie'),
            vuLe: Number(m.lastViewedAt || 0),
          });
        }
      }
    } catch { /* section illisible pour ce compte : on continue */ }

    try {
      // Les titres commencés portent un viewOffset ; on les relève au même endroit.
      const d = await plexServeur(plexUrl, `/library/sections/${sec.key}/all?type=${type}`, token);
      for (const m of (d?.MediaContainer?.Metadata || [])) {
        const pos = Number(m.viewOffset || 0);
        if (pos > 0) {
          enCours.set(String(m.ratingKey), {
            id: String(m.ratingKey),
            position: pos / 1000,
            duree: Number(m.duration || 0) / 1000,
            titre: m.type === 'episode' ? (m.grandparentTitle || m.title) : m.title,
            type: m.type,
            vuLe: Number(m.lastViewedAt || 0),
          });
        }
      }
    } catch { /* idem */ }
  }

  return { vus: [...vus.values()], enCours: [...enCours.values()] };
}

export default { setClientId, demarrerPin, jetonDuPin, compteDe, aAccesAuServeur, serveursDuCompte, comptesGeres, jetonCompteGere, etatDeVisionnage };
