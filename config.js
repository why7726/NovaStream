/* ══════════════════════════════════════════════════════════════════
   Configuration de NovaStream

   Tout ce qui est propre à UNE installation vit dans le dossier de
   données (`data/` par défaut, `NOVA_DATA_DIR` pour le déplacer) :
   base, secrets, caches, journaux, et `config.json` — les clés que
   l'administrateur saisit dans l'assistant de premier démarrage.
   Ce dossier n'est jamais versionné : le code peut être publié tel
   quel sans rien exposer.

   Ordre de priorité d'une valeur :
     1. config.json (réglée depuis l'interface)
     2. variable d'environnement (.env ou Docker)
     3. vide → la fonction correspondante est désactivée, proprement.

   ⚠️ Les modules ES sont évalués AVANT le corps de server.js : ce
   fichier est importé en premier, il charge donc .env et config.json
   avant que quiconque lise process.env.
   ══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { iaConfiguree } from './ia.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(process.env.NOVA_DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
export const dataPath = (...p) => path.join(DATA_DIR, ...p);

const CONFIG_FILE = dataPath('config.json');

/* ── Migration : les anciennes installations rangeaient tout à la racine ──
   On déplace une seule fois, avant que la base ne soit ouverte. */
(function migrerAnciensFichiers() {
  const aDeplacer = [
    'novastream.db', 'novastream.db-wal', 'novastream.db-shm', '.jwt_secret',
    'company_cache.json', 'movie_facts_cache.json', 'provider_cache.json',
    'wrapped_meta_cache.json', 'subs-cache', 'backups', 'logs',
  ];
  for (const nom of aDeplacer) {
    const avant = path.join(ROOT, nom);
    const apres = dataPath(nom);
    if (!fs.existsSync(avant) || fs.existsSync(apres)) continue;
    try { fs.renameSync(avant, apres); console.log(`[Config] ${nom} → data/`); }
    catch (e) { console.warn(`[Config] impossible de déplacer ${nom} :`, e.message); }
  }
})();

/* ── .env (facultatif) : utile en Docker ou pour une installation manuelle ── */
(function chargerEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) { console.warn('[Config] .env illisible :', e.message); }
})();

/* ── Le catalogue des réglages ─────────────────────────────────────────
   `secret` : jamais renvoyé au navigateur, seulement « défini / non défini ».
   `feature` : la fonction que ce réglage active (voir features()). */
export const REGLAGES = {
  PLEX_URL:               { groupe: 'serveur' },
  PLEX_TOKEN:             { groupe: 'serveur', secret: true },
  PLEX_NOVA_TOKEN:        { groupe: 'serveur', secret: true },
  TMDB_TOKEN:             { groupe: 'tmdb', secret: true },
  OPENSUBTITLES_API_KEY:  { groupe: 'soustitres', secret: true },
  OPENSUBTITLES_USER:     { groupe: 'soustitres' },
  OPENSUBTITLES_PASSWORD: { groupe: 'soustitres', secret: true },
  IA_FOURNISSEUR:         { groupe: 'assistant' },
  IA_MODELE:              { groupe: 'assistant' },
  GEMINI_API_KEY:         { groupe: 'assistant', secret: true },
  OPENAI_API_KEY:         { groupe: 'assistant', secret: true },
  XAI_API_KEY:            { groupe: 'assistant', secret: true },
  ANTHROPIC_API_KEY:      { groupe: 'assistant', secret: true },
  OLLAMA_URL:             { groupe: 'assistant' },
  LMSTUDIO_URL:           { groupe: 'assistant' },
  RADARR_URL:             { groupe: 'arr' },
  RADARR_API_KEY:         { groupe: 'arr', secret: true },
  SONARR_URL:             { groupe: 'arr' },
  SONARR_API_KEY:         { groupe: 'arr', secret: true },
  ARR_ROOT_MOVIE:         { groupe: 'arr' },
  ARR_ROOT_SERIES:        { groupe: 'arr' },
  ARR_ROOT_ANIME:         { groupe: 'arr' },
  QBIT_URL:               { groupe: 'qbit' },
  QBIT_USER:              { groupe: 'qbit' },
  QBIT_PASS:              { groupe: 'qbit', secret: true },
  PUBLIC_URL:             { groupe: 'acces' },
};

let fichier = {};   // contenu de config.json : { reglages: {...}, bibliotheques: {...} }

function lireFichier() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function ecrireFichier() {
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(fichier, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
}

/* Les valeurs de config.json sont recopiées dans process.env : les modules
   existants (arr, qbit, sous-titres, assistant) lisent l'environnement à
   l'usage, ils voient donc un changement sans redémarrage. */
const valeursEnv = {};   // ce que l'environnement disait AVANT config.json
function appliquer() {
  const r = fichier.reglages || {};
  for (const cle of Object.keys(REGLAGES)) {
    if (!(cle in valeursEnv)) valeursEnv[cle] = process.env[cle];
    const v = r[cle];
    if (typeof v === 'string' && v !== '') process.env[cle] = v;
    else if (valeursEnv[cle] !== undefined) process.env[cle] = valeursEnv[cle];
    else delete process.env[cle];
  }
}

fichier = lireFichier();
appliquer();

const abonnes = new Set();
/** Prévient server.js qu'un réglage a changé (il relit ses constantes). */
export function onChange(fn) { abonnes.add(fn); }

export const get = (cle) => process.env[cle] || '';

/** Enregistre des réglages. Une valeur vide ('' ou null) efface la clé. */
export function setReglages(patch) {
  const r = { ...(fichier.reglages || {}) };
  for (const [cle, v] of Object.entries(patch || {})) {
    if (!REGLAGES[cle]) continue;
    if (v === null || v === '') delete r[cle];
    else if (typeof v === 'string') r[cle] = v.trim();
  }
  fichier = { ...fichier, reglages: r };
  ecrireFichier();
  appliquer();
  for (const fn of abonnes) { try { fn(); } catch (e) { console.error('[Config]', e.message); } }
}

/** Vue sûre pour le navigateur : les secrets ne sortent jamais. */
export function reglagesPublics() {
  const out = {};
  for (const [cle, def] of Object.entries(REGLAGES)) {
    const v = get(cle);
    const depuisEnv = !(fichier.reglages || {})[cle] && !!v;
    out[cle] = def.secret
      ? { defini: !!v, apercu: v ? '••••' + v.slice(-4) : '', depuisEnv }
      : { defini: !!v, valeur: v, depuisEnv };
  }
  return out;
}

/* ── Bibliothèques ──────────────────────────────────────────────────────
   exclues  : décochées — privées, Nova fait comme si elles n'existaient pas
   masquees : partagées mais absentes du menu (on les trouve par la recherche)
   ordre    : ordre d'affichage dans le menu */
export function bibliotheques() {
  return { exclues: [], masquees: [], ordre: [], ...(fichier.bibliotheques || {}) };
}
export function setBibliotheques({ exclues, masquees, ordre }) {
  const avant = bibliotheques();
  const liste = (v, defaut) => (Array.isArray(v) ? v.map(String) : defaut);
  fichier = {
    ...fichier,
    bibliotheques: {
      exclues: liste(exclues, avant.exclues),
      masquees: liste(masquees, avant.masquees),
      ordre: liste(ordre, avant.ordre),
    },
  };
  ecrireFichier();
  for (const fn of abonnes) { try { fn(); } catch (e) { console.error('[Config]', e.message); } }
}

/* ── Les fonctions optionnelles et ce qui les active ── */
export function features() {
  return {
    serveur: !!(get('PLEX_URL') && get('PLEX_TOKEN')),
    tmdb: !!get('TMDB_TOKEN'),
    soustitres: !!get('OPENSUBTITLES_API_KEY'),
    soustitresTelechargement: !!(get('OPENSUBTITLES_API_KEY') && get('OPENSUBTITLES_USER') && get('OPENSUBTITLES_PASSWORD')),
    assistant: iaConfiguree(),
    arr: !!(get('RADARR_API_KEY') && get('SONARR_API_KEY')),
    qbit: !!get('QBIT_URL'),
  };
}

/** Adresse publique (https://mon-domaine.fr) → nom d'hôte, pour le CORS. */
export function hotePublic() {
  try { return new URL(get('PUBLIC_URL')).hostname; } catch { return ''; }
}
