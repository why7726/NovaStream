// ═══════════════════════════════════════════════════════════════════
//  Pont vers Radarr / Sonarr
//
//  Principe : on n'automatise PAS le téléchargement. Pour chaque demande,
//  on ajoute le titre en « non surveillé » (donc rien ne part), on lance
//  une recherche interactive, et on renvoie la liste des sources trouvées.
//  Le téléchargement n'est déclenché que sur une décision explicite.
//
//  Nova sait déjà si c'est un film, une série ou un animé : c'est lui qui
//  choisit le bon dossier (/data/Film, /data/Series, /data/Animés).
// ═══════════════════════════════════════════════════════════════════

import http from 'node:http';

/* Les imports ES sont évalués AVANT le corps de server.js, donc avant que
   .env soit chargé : on lit donc l'environnement à l'usage, jamais au
   chargement du module. (Bug constaté : sans ça, arrConfigured() est faux
   au démarrage et aucune recherche ne part.) */
const env = (k, d = '') => process.env[k] || d;
const RADARR_URL = () => env('RADARR_URL', 'http://localhost:7878').replace(/\/$/, '');
const SONARR_URL = () => env('SONARR_URL', 'http://localhost:8989').replace(/\/$/, '');
const RADARR_KEY = () => env('RADARR_API_KEY');
const SONARR_KEY = () => env('SONARR_API_KEY');

// Dossiers de destination (créés dans Radarr/Sonarr)
const ROOT_MOVIE = () => env('ARR_ROOT_MOVIE', '/data/Film');
const ROOT_SERIES = () => env('ARR_ROOT_SERIES', '/data/Series');
const ROOT_ANIME = () => env('ARR_ROOT_ANIME', '/data/Animés');

const QUALITY_MOVIE = () => Number(env('ARR_QUALITY_MOVIE', '1'));   // « Any »
const QUALITY_SERIES = () => Number(env('ARR_QUALITY_SERIES', '1'));

export const arrConfigured = () => !!(RADARR_KEY() && SONARR_KEY());

/* On n'utilise PAS fetch() ici : sa limite interne de 300 s sur l'attente
   des en-tetes ne peut pas etre relevee, et une recherche de serie chez
   Sonarr peut depasser ce delai. node:http, lui, obeit au delai qu'on lui
   donne. Tout est en local, donc pas de TLS a gerer. */
function call(base, key, pathname, { method = 'GET', body, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${base}/api/v3${pathname}`);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'X-Api-Key': key,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
          if (res.statusCode >= 400) {
            const msg = Array.isArray(data)
              ? (data[0]?.errorMessage || JSON.stringify(data[0]))
              : (data?.message || res.statusCode);
            return reject(new Error(`${pathname} -> ${msg}`));
          }
          resolve(data);
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error(`${pathname} -> delai depasse (${Math.round(timeout / 1000)} s)`)); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const radarr = (p, o) => call(RADARR_URL(), RADARR_KEY(), p, o);
const sonarr = (p, o) => call(SONARR_URL(), SONARR_KEY(), p, o);

/* Priorité au français. Nyaa est massivement en japonais brut : sans ce
   classement, les premières propositions seraient inregardables ici.
     · MULTI / VFF / VFQ / TRUEFRENCH → piste française incluse  → priorité haute
     · VOSTFR / SUBFRENCH             → sous-titres français     → priorité moyenne
     · le reste (VO, VOSTA, raw)                                 → en dernier */
/* Ecrites via RegExp(string) : en litteral, les bornes de mot \b se font
   transformer en vrais caracteres « retour arriere » par certains outils
   d'edition, ce qui casse silencieusement toute correspondance. */
const RE_MULTI = new RegExp('\\b(multi|multi3|multi4|dual[- .]?audio)\\b', 'i');
const RE_VF = new RegExp('\\b(vff|vfq|vfi|vf2?|truefrench|french)\\b', 'i');
const RE_VOSTFR = new RegExp('\\b(vostfr|vost|subfrench|subfr)\\b', 'i');

function frenchTag(r) {
  const t = r.title || '';
  const langs = (r.languages || []).map((l) => l && l.name).filter(Boolean).join(' ');
  if (RE_MULTI.test(t)) return 'MULTI';
  if (/french|français/i.test(langs) || RE_VF.test(t)) return 'VF';
  if (RE_VOSTFR.test(t)) return 'VOSTFR';
  return null;
}

const frenchScore = (tag) => (tag === 'MULTI' ? 3 : tag === 'VF' ? 2 : tag === 'VOSTFR' ? 1 : 0);

/** Met en forme une release pour l'affichage (Nova comme Discord). */
function shape(r, kind) {
  return {
    guid: r.guid,
    indexerId: r.indexerId,
    indexer: r.indexer,
    title: r.title,
    quality: r.quality?.quality?.name || '?',
    sizeGb: Math.round(((r.size || 0) / 1e9) * 10) / 10,
    seeders: r.seeders ?? null,
    leechers: r.leechers ?? null,
    languages: (r.languages || []).map((l) => l.name).filter(Boolean),
    rejected: !!r.rejected,
    rejections: r.rejections || [],
    lang: frenchTag(r),           // MULTI | VF | VOSTFR | null
    kind,
  };
}

/* Les meilleures d'abord. On GARDE les sources marquées « rejetées » :
   comme le titre est volontairement non surveillé, Radarr/Sonarr rejettent
   parfois tout en bloc — or un téléchargement demandé explicitement passe
   quand même. On les range simplement après les autres. */
function rank(list) {
  return list.sort((a, b) =>
    (a.rejected ? 1 : 0) - (b.rejected ? 1 : 0)
    || frenchScore(b.lang) - frenchScore(a.lang)   // français d'abord
    || (b.seeders || 0) - (a.seeders || 0)
    || (b.sizeGb || 0) - (a.sizeGb || 0));
}

/* Sonarr charge les épisodes APRÈS l'ajout de la série. Chercher tout de
   suite ne renvoie rien : on attend qu'il les connaisse (constaté sur
   « Solo Leveling » : 0 source à l'instant T, 13 épisodes 20 s plus tard). */
async function waitForEpisodes(seriesId, maxMs = 30000) {
  const t0 = Date.now();
  let eps = [];
  while (Date.now() - t0 < maxMs) {
    eps = (await sonarr(`/episode?seriesId=${seriesId}`)) || [];
    if (eps.length) return eps;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return eps;
}

/* ── Films ──────────────────────────────────────────────────────── */

export async function searchMovie({ tmdbId, title, year }) {
  const existing = (await radarr('/movie')).find((m) => String(m.tmdbId) === String(tmdbId));
  let movie = existing;

  if (!movie) {
    const found = (await radarr(`/movie/lookup?term=tmdb:${encodeURIComponent(tmdbId)}`))[0];
    if (!found) throw new Error('Film introuvable côté Radarr');
    movie = await radarr('/movie', {
      method: 'POST',
      body: {
        ...found,
        qualityProfileId: QUALITY_MOVIE(),
        rootFolderPath: ROOT_MOVIE(),
        monitored: false,                          // rien ne se lance tout seul
        minimumAvailability: 'released',
        addOptions: { searchForMovie: false },
      },
    });
  }

  const releases = await radarr(`/release?movieId=${movie.id}`, { timeout: 300000 });
  return {
    arrKind: 'movie',
    arrId: movie.id,
    addedByNova: !existing,
    releases: rank(releases.map((r) => shape(r, 'movie'))).slice(0, 12),
  };
}

/* ── Séries et animés ───────────────────────────────────────────── */

export async function searchSeries({ tvdbId, title, year, isAnime }) {
  const all = await sonarr('/series');
  let series = tvdbId ? all.find((s) => String(s.tvdbId) === String(tvdbId)) : null;
  if (!series && title) {
    series = all.find((s) => (s.title || '').toLowerCase() === title.toLowerCase());
  }

  if (!series) {
    const term = tvdbId ? `tvdb:${tvdbId}` : title;
    const candidates = await sonarr(`/series/lookup?term=${encodeURIComponent(term)}`);
    // Sonarr peut renvoyer 20 homonymes : on privilégie l'année quand on l'a.
    const found = (year && candidates.find((c) => String(c.year) === String(year))) || candidates[0];
    if (!found) throw new Error('Série introuvable côté Sonarr');
    series = await sonarr('/series', {
      method: 'POST',
      body: {
        ...found,
        qualityProfileId: QUALITY_SERIES(),
        rootFolderPath: isAnime ? ROOT_ANIME() : ROOT_SERIES(),
        seriesType: isAnime ? 'anime' : 'standard',
        monitored: false,
        seasonFolder: true,
        addOptions: { searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false, monitor: 'none' },
      },
    });
  }

  const episodes = await waitForEpisodes(series.id);
  const withEps = [...new Set(episodes.map((e) => e.seasonNumber))].filter((n) => n > 0).sort((a, b) => a - b);
  let season = withEps.length ? withEps[withEps.length - 1] : 1;

  /* Ordre volontaire : on interroge D'ABORD un seul episode.
     Une recherche de saison fait interroger les indexeurs episode par
     episode : avec Nyaa + TR4KER derriere FlareSolverr, ca depassait les
     5 minutes et finissait en timeout. Une recherche d'episode remonte
     aussi les packs de saison, en ~30 s. La saison complete ne sert que
     de repli. */
  const tryEpisode = async (n) => {
    const ep = episodes.find((e) => e.seasonNumber === n);
    if (!ep) return [];
    try {
      return await sonarr(`/release?episodeId=${ep.id}`, { timeout: 600000 });
    } catch (e) {
      console.warn(`[Arr] episode S${n} : ${e.message}`);
      return [];
    }
  };

  const trySeason = async (n) => {
    try {
      return await sonarr(`/release?seriesId=${series.id}&seasonNumber=${n}`, { timeout: 600000 });
    } catch (e) {
      console.warn(`[Arr] saison ${n} : ${e.message}`);
      return [];
    }
  };

  let releases = await tryEpisode(season);

  // Saison trop recente ou muette : on retente sur la premiere saison.
  if (!releases.length && withEps.length > 1) {
    season = withEps[0];
    releases = await tryEpisode(season);
  }

  // Dernier recours : la recherche de saison complete (lente).
  if (!releases.length) releases = await trySeason(season);

  return {
    arrKind: 'series',
    arrId: series.id,
    season,
    addedByNova: !all.find((s) => s.id === series.id),
    releases: rank(releases.map((r) => shape(r, 'series'))).slice(0, 12),
  };
}

/** Envoie UNE source précise au client de téléchargement. */
export async function grab({ arrKind, guid, indexerId }) {
  const body = { guid, indexerId };
  if (arrKind === 'series') await sonarr('/release', { method: 'POST', body });
  else await radarr('/release', { method: 'POST', body });
  return true;
}

/** Remet le titre sous surveillance une fois la source acceptée, pour que
 *  Radarr/Sonarr importe le fichier dans la bibliothèque à la fin. */
export async function monitorAfterGrab({ arrKind, arrId }) {
  try {
    if (arrKind === 'series') {
      const s = await sonarr(`/series/${arrId}`);
      await sonarr(`/series/${arrId}`, { method: 'PUT', body: { ...s, monitored: true } });
    } else {
      const m = await radarr(`/movie/${arrId}`);
      await radarr(`/movie/${arrId}`, { method: 'PUT', body: { ...m, monitored: true } });
    }
  } catch (e) {
    console.warn('[Arr] surveillance:', e.message);
  }
}

/** Retire un titre ajouté par Nova quand la demande est refusée. */
export async function removeIfAdded({ arrKind, arrId, addedByNova }) {
  if (!addedByNova) return;
  try {
    if (arrKind === 'series') await sonarr(`/series/${arrId}?deleteFiles=false`, { method: 'DELETE' });
    else await radarr(`/movie/${arrId}?deleteFiles=false`, { method: 'DELETE' });
  } catch (e) {
    console.warn('[Arr] retrait:', e.message);
  }
}

/** Où en est le téléchargement ? (pour passer la demande en « Ajoutée ») */
export async function progressOf({ arrKind, arrId }) {
  try {
    const q = arrKind === 'series'
      ? await sonarr('/queue?pageSize=200&includeSeries=true')
      : await radarr('/queue?pageSize=200&includeMovie=true');
    const rows = (q.records || []).filter((r) =>
      arrKind === 'series' ? r.seriesId === arrId : r.movieId === arrId);
    if (!rows.length) return { downloading: false };
    const r = rows[0];
    const pct = r.size ? Math.round(((r.size - (r.sizeleft || 0)) / r.size) * 100) : 0;
    return { downloading: true, percent: pct, status: r.status, eta: r.timeleft || null };
  } catch {
    return { downloading: false };
  }
}

/** Le fichier est-il arrivé dans la bibliothèque ? */
export async function isImported({ arrKind, arrId }) {
  try {
    if (arrKind === 'series') {
      const s = await sonarr(`/series/${arrId}`);
      return (s.statistics?.episodeFileCount || 0) > 0;
    }
    const m = await radarr(`/movie/${arrId}`);
    return !!m.hasFile;
  } catch {
    return false;
  }
}

export default { arrConfigured, searchMovie, searchSeries, grab, monitorAfterGrab, removeIfAdded, progressOf, isImported, ensureSeriesForSchedule, airTimes };

/* ── Calendrier de diffusion ────────────────────────────────────────
   TMDB ne donne que la date ; Sonarr, lui, connait l'HEURE exacte
   (airDateUtc). Pour en profiter il faut que la serie existe dans
   Sonarr : on l'ajoute donc en NON SURVEILLEE, sans recherche et sans
   suivi d'episode. Rien ne se telecharge, rien n'est renomme — la serie
   sert uniquement de source de calendrier. */
export async function ensureSeriesForSchedule({ tvdbId, title, year, isAnime }) {
  const all = await sonarr('/series');
  let series = tvdbId ? all.find((x) => String(x.tvdbId) === String(tvdbId)) : null;
  if (!series && title) series = all.find((x) => (x.title || '').toLowerCase() === title.toLowerCase());
  if (series) return series.id;

  const term = tvdbId ? `tvdb:${tvdbId}` : title;
  if (!term) return null;
  const candidates = await sonarr(`/series/lookup?term=${encodeURIComponent(term)}`);
  const found = (year && candidates.find((c) => String(c.year) === String(year))) || candidates[0];
  if (!found) return null;

  const created = await sonarr('/series', {
    method: 'POST',
    body: {
      ...found,
      qualityProfileId: QUALITY_SERIES(),
      rootFolderPath: isAnime ? ROOT_ANIME() : ROOT_SERIES(),
      seriesType: isAnime ? 'anime' : 'standard',
      monitored: false,
      seasonFolder: true,
      addOptions: { searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false, monitor: 'none' },
    },
  });
  return created.id;
}

/** Horaires precis d'une saison : { "3": "2026-07-31T15:00:00Z", ... }
    Sonarr ne charge les episodes que quelques secondes APRES l'ajout d'une
    serie : on patiente un peu, sinon on repart les mains vides. */
export async function airTimes(seriesId, season, maxMs = 12000) {
  const t0 = Date.now();
  do {
    try {
      const eps = await sonarr(`/episode?seriesId=${seriesId}`);
      const map = {};
      for (const e of eps || []) {
        if (Number(e.seasonNumber) !== Number(season)) continue;
        if (e.airDateUtc) map[String(e.episodeNumber)] = e.airDateUtc;
      }
      if (Object.keys(map).length) return map;
    } catch { /* on retente */ }
    await new Promise((r) => setTimeout(r, 2000));
  } while (Date.now() - t0 < maxMs);
  return {};
}

