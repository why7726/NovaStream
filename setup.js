/* ══════════════════════════════════════════════════════════════════
   Assistant de premier démarrage + réglages de l'administrateur

   1. Aucun compte admin → la page d'accueil propose d'en créer un.
      Uniquement depuis le réseau local : tant que personne n'a revendiqué
      le serveur, un inconnu venu d'Internet ne doit pas pouvoir le faire.
   2. Connexion du serveur multimédia (Plex par code PIN, comme Overseerr).
   3. Clés API — toutes facultatives. Sans elles, la fonction concernée
      est éteinte et le site le dit (voir /api/features).
   4. Bibliothèques : lesquelles apparaissent dans le menu, sous le nom
      qu'elles portent sur le serveur.
   ══════════════════════════════════════════════════════════════════ */
import http from 'node:http';
import * as config from './config.js';
import * as plexLink from './plexLink.js';
import * as ia from './ia.js';

/* ── Adresse réelle du visiteur ──────────────────────────────────────
   X-Forwarded-For n'est cru que s'il a été posé par un relais du réseau
   local (Caddy, Docker) : envoyé directement depuis Internet, n'importe
   qui pourrait l'écrire. On garde la DERNIÈRE valeur — celle ajoutée par
   le relais le plus proche, la seule qu'on puisse vérifier. */
const PRIVEE = /^(::1$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|fe80:)/i;
const sansPrefixe = (ip) => String(ip || '').replace(/^::ffff:/, '');

export function ipReelle(req) {
  const socket = sansPrefixe(req.socket?.remoteAddress);
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => sansPrefixe(s.trim())).filter(Boolean);
  if (xff.length && PRIVEE.test(socket)) return xff[xff.length - 1];
  return socket || 'inconnue';
}
export const estLocale = (req) => PRIVEE.test(ipReelle(req));

/* ── Tests de connexion, un par service ──────────────────────────────
   Chacun reçoit les valeurs à tester (celles du formulaire, sinon celles
   déjà enregistrées) et renvoie un message lisible. */
const attente = (ms) => AbortSignal.timeout(ms);

function httpGet(url, headers = {}, method = 'GET', body = null) {
  // node:http plutôt que fetch pour les services locaux : pas de limite de
  // 300 s, et les erreurs de connexion sont plus parlantes.
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, timeout: 8000 }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const TESTS = {
  async serveur(v) {
    if (!v.PLEX_URL || !v.PLEX_TOKEN) throw new Error('Adresse ou jeton manquant');
    const r = await fetch(`${v.PLEX_URL.replace(/\/$/, '')}/identity?X-Plex-Token=${v.PLEX_TOKEN}`, { headers: { Accept: 'application/json' }, signal: attente(8000) });
    if (!r.ok) throw new Error(`Le serveur répond ${r.status}`);
    const d = await r.json();
    return `Plex ${d?.MediaContainer?.version || ''} joignable`.trim();
  },
  async tmdb(v) {
    if (!v.TMDB_TOKEN) throw new Error('Jeton manquant');
    const r = await fetch('https://api.themoviedb.org/3/configuration', { headers: { Authorization: `Bearer ${v.TMDB_TOKEN}`, Accept: 'application/json' }, signal: attente(8000) });
    if (r.status === 401) throw new Error('Jeton refusé — utilise le « jeton d\'accès en lecture » (API Read Access Token), pas la clé courte');
    if (!r.ok) throw new Error(`TMDB répond ${r.status}`);
    return 'TMDB répond';
  },
  async soustitres(v) {
    if (!v.OPENSUBTITLES_API_KEY) throw new Error('Clé manquante');
    const h = { 'Api-Key': v.OPENSUBTITLES_API_KEY, 'User-Agent': 'NovaStream v1.0', 'Content-Type': 'application/json', Accept: 'application/json' };
    if (v.OPENSUBTITLES_USER && v.OPENSUBTITLES_PASSWORD) {
      const r = await fetch('https://api.opensubtitles.com/api/v1/login', { method: 'POST', headers: h, body: JSON.stringify({ username: v.OPENSUBTITLES_USER, password: v.OPENSUBTITLES_PASSWORD }), signal: attente(10000) });
      if (r.status === 401) throw new Error('Identifiant ou mot de passe refusé');
      if (r.status === 403) throw new Error('Clé API refusée');
      if (!r.ok) throw new Error(`OpenSubtitles répond ${r.status}`);
      return 'Clé et compte valides — recherche et téléchargement actifs';
    }
    const r = await fetch('https://api.opensubtitles.com/api/v1/infos/formats', { headers: h, signal: attente(10000) });
    if (r.status === 403 || r.status === 401) throw new Error('Clé API refusée');
    if (!r.ok) throw new Error(`OpenSubtitles répond ${r.status}`);
    return 'Clé valide — ajoute un compte pour pouvoir télécharger';
  },
  // Renvoie aussi la liste des modèles : les réglages la proposent au choix.
  assistant: (v) => ia.tester(v),
  async arr(v) {
    const essai = async (nom, url, cle) => {
      if (!url || !cle) throw new Error(`${nom} : adresse ou clé manquante`);
      const r = await httpGet(`${url.replace(/\/$/, '')}/api/v3/system/status`, { 'X-Api-Key': cle });
      if (r.status === 401) throw new Error(`${nom} : clé refusée`);
      if (r.status !== 200) throw new Error(`${nom} répond ${r.status}`);
      return `${nom} ${JSON.parse(r.body).version || ''}`.trim();
    };
    const a = await essai('Radarr', v.RADARR_URL || 'http://localhost:7878', v.RADARR_API_KEY);
    const b = await essai('Sonarr', v.SONARR_URL || 'http://localhost:8989', v.SONARR_API_KEY);
    return `${a} et ${b} joignables`;
  },
  async qbit(v) {
    if (!v.QBIT_URL) throw new Error('Adresse manquante');
    const body = new URLSearchParams({ username: v.QBIT_USER || '', password: v.QBIT_PASS || '' }).toString();
    const r = await httpGet(`${v.QBIT_URL.replace(/\/$/, '')}/api/v2/auth/login`, { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), Referer: v.QBIT_URL }, 'POST', body);
    if (r.status !== 200 || !/ok/i.test(r.body)) throw new Error('Identifiants refusés');
    return 'qBittorrent joignable (lecture seule)';
  },
};

/**
 * @param {import('express').Express} app
 * @param {{ db, bcrypt, signerJeton: (user) => string, authMiddleware, adminMiddleware, logActivity }} deps
 */
export function installer(app, { db, bcrypt, signerJeton, authMiddleware, adminMiddleware, logActivity, prive }) {
  const adminExiste = () => !!db.prepare('SELECT 1 FROM users WHERE isAdmin = 1 LIMIT 1').get();

  // Ce que la page d'accueil doit savoir AVANT toute connexion.
  app.get('/api/setup/status', (req, res) => {
    res.json({
      adminExiste: adminExiste(),
      serveur: config.features().serveur,
      local: estLocale(req),
    });
  });

  // Création du tout premier compte (administrateur).
  app.post('/api/setup/admin', (req, res) => {
    try {
      if (adminExiste()) return res.status(409).json({ error: 'Un administrateur existe déjà' });
      if (!estLocale(req)) {
        return res.status(403).json({ error: 'Pour des raisons de sécurité, le compte administrateur se crée depuis le réseau local (http://localhost:5174 sur la machine du serveur).' });
      }
      const { username, email, password } = req.body || {};
      if (typeof username !== 'string' || username.trim().length < 2 || username.length > 32) return res.status(400).json({ error: 'Pseudo invalide (2 à 32 caractères)' });
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });
      if (typeof password !== 'string' || password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });

      const hash = bcrypt.hashSync(password, 10);
      const r = db.prepare('INSERT INTO users (username, email, password, isAdmin) VALUES (?, ?, ?, 1)').run(username.trim(), email.trim(), hash);
      const user = { id: r.lastInsertRowid, username: username.trim(), email: email.trim(), isAdmin: 1 };
      logActivity(user.id, 'register');
      console.log(`[Setup] Compte administrateur créé : ${user.username}`);
      res.json({ token: signerJeton({ ...user, tokenVersion: 0 }), user });
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return res.status(400).json({ error: 'Email ou pseudo déjà utilisé' });
      console.error('[Setup] admin:', e.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // Fonctions actives — lu par tout le site pour afficher « indisponible ».
  app.get('/api/features', authMiddleware, (req, res) => res.json(config.features()));

  /* ── Réglages (administrateur) ── */
  app.get('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
    res.json({ reglages: config.reglagesPublics(), features: config.features(), bibliotheques: config.bibliotheques() });
  });

  app.put('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
    try {
      config.setReglages(req.body?.reglages || {});
      ia.oublierModeles();   // un autre fournisseur ou une autre clé : on re-choisit le modèle
      res.json({ reglages: config.reglagesPublics(), features: config.features() });
    } catch (e) {
      console.error('[Setup] enregistrement:', e.message);
      res.status(500).json({ error: 'Enregistrement impossible' });
    }
  });

  // Tester un groupe : valeurs du formulaire, complétées par celles enregistrées
  // (un secret déjà enregistré n'est jamais renvoyé au navigateur).
  app.post('/api/settings/test/:groupe', authMiddleware, adminMiddleware, async (req, res) => {
    const test = TESTS[req.params.groupe];
    if (!test) return res.status(404).json({ error: 'Test inconnu' });
    const v = {};
    for (const cle of Object.keys(config.REGLAGES)) {
      const saisi = req.body?.reglages?.[cle];
      v[cle] = typeof saisi === 'string' && saisi !== '' ? saisi.trim() : config.get(cle);
    }
    try {
      const r = await test(v);
      res.json({ ok: true, ...(typeof r === 'string' ? { message: r } : r) });
    } catch (e) {
      const msg = e.cause?.code === 'ECONNREFUSED' || e.code === 'ECONNREFUSED' ? 'Connexion refusée — le service est-il démarré ?' : e.message;
      res.json({ ok: false, message: msg });
    }
  });

  /* ── Connexion du serveur Plex par code PIN ── */
  let pinAdmin = null;   // { id, at } — un seul administrateur, un seul PIN à la fois
  app.post('/api/setup/plex/start', authMiddleware, adminMiddleware, async (req, res) => {
    try {
      const pin = await plexLink.demarrerPin();
      pinAdmin = { id: pin.id, at: Date.now() };
      res.json({ url: pin.url });
    } catch (e) {
      res.status(502).json({ error: 'plex.tv ne répond pas' });
    }
  });

  let serveursTrouves = [];   // gardés côté serveur : les jetons ne vont pas au navigateur
  app.post('/api/setup/plex/finish', authMiddleware, adminMiddleware, async (req, res) => {
    if (!pinAdmin || Date.now() - pinAdmin.at > 15 * 60000) return res.status(400).json({ error: 'Connexion expirée, recommence' });
    try {
      const token = await plexLink.jetonDuPin(pinAdmin.id);
      if (!token) return res.json({ pending: true });
      pinAdmin = null;
      serveursTrouves = await plexLink.serveursDuCompte(token);
      if (!serveursTrouves.length) return res.status(404).json({ error: 'Aucun serveur Plex ne t\'appartient sur ce compte' });
      res.json({ serveurs: serveursTrouves.map((s) => ({ id: s.id, nom: s.nom, adresses: s.adresses })) });
    } catch (e) {
      res.status(502).json({ error: 'plex.tv ne répond pas' });
    }
  });

  // Choix du serveur : on essaie ses adresses dans l'ordre, la première qui
  // répond est enregistrée.
  app.post('/api/setup/plex/choose', authMiddleware, adminMiddleware, async (req, res) => {
    const s = serveursTrouves.find((x) => x.id === req.body?.id);
    if (!s) return res.status(400).json({ error: 'Serveur inconnu, recommence la connexion' });
    const adresses = req.body?.uri ? [{ uri: String(req.body.uri) }, ...s.adresses] : s.adresses;
    for (const a of adresses) {
      try {
        await TESTS.serveur({ PLEX_URL: a.uri, PLEX_TOKEN: s.jeton });
        config.setReglages({ PLEX_URL: a.uri, PLEX_TOKEN: s.jeton });
        console.log(`[Setup] Serveur Plex relié : ${s.nom} (${a.uri})`);
        return res.json({ ok: true, nom: s.nom, uri: a.uri });
      } catch { /* adresse suivante */ }
    }
    res.status(502).json({ error: `${s.nom} ne répond sur aucune de ses adresses depuis cette machine. Saisis l'adresse à la main (ex. http://192.168.1.10:32400).` });
  });

  /* ── Bibliothèques ── */
  async function sectionsPlex() {
    const url = config.get('PLEX_URL').replace(/\/$/, '');
    const token = config.get('PLEX_TOKEN');
    if (!url || !token) return [];
    const r = await fetch(`${url}/library/sections?X-Plex-Token=${token}`, { headers: { Accept: 'application/json' }, signal: attente(10000) });
    if (!r.ok) throw new Error(`Plex ${r.status}`);
    const d = await r.json();
    return (d?.MediaContainer?.Directory || [])
      .filter((x) => x.type === 'movie' || x.type === 'show')
      .map((x) => ({ key: String(x.key), title: x.title, type: x.type }));
  }

  function ordonner(liste) {
    const { ordre } = config.bibliotheques();
    const rang = (k) => { const i = ordre.indexOf(k); return i === -1 ? 1e6 : i; };
    return [...liste].sort((a, b) => rang(a.key) - rang(b.key));
  }

  /* Les bibliothèques PARTAGÉES avec Nova, dans l'ordre choisi, chacune
     marquée `masquee` (hors du menu) ou non. Le menu n'affiche que les
     visibles ; la recherche et les badges ont besoin de toutes. Les
     bibliothèques privées (décochées) n'apparaissent jamais ici. */
  app.get('/api/libraries', authMiddleware, async (req, res) => {
    try {
      const { masquees, exclues } = config.bibliotheques();
      const toutes = ordonner(await sectionsPlex()).filter((l) => !exclues.includes(l.key));
      res.json({ libraries: toutes.map((l) => ({ ...l, masquee: masquees.includes(l.key) })) });
    } catch (e) {
      res.status(502).json({ error: 'Serveur multimédia injoignable', libraries: [] });
    }
  });

  // Réglages : toutes les bibliothèques du serveur, avec leurs deux cases.
  app.get('/api/settings/libraries', authMiddleware, adminMiddleware, async (req, res) => {
    try {
      const { masquees, exclues } = config.bibliotheques();
      const toutes = ordonner(await sectionsPlex());
      res.json({ libraries: toutes.map((l) => ({ ...l, partagee: !exclues.includes(l.key), menu: !masquees.includes(l.key) })) });
    } catch (e) {
      res.status(502).json({ error: 'Serveur multimédia injoignable', libraries: [] });
    }
  });

  app.put('/api/settings/libraries', authMiddleware, adminMiddleware, async (req, res) => {
    config.setBibliotheques({ exclues: req.body?.exclues, masquees: req.body?.masquees, ordre: req.body?.ordre });
    // Le filtre privé doit être à jour AVANT que l'admin recharge la page.
    try { await prive?.rafraichir(); } catch { /* il se refera dans 10 min */ }
    res.json({ ok: true, bibliotheques: config.bibliotheques() });
  });
}
