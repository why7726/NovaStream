/* ══════════════════════════════════════════════════════════════════
   Bibliothèques locales — des dossiers que Nova lit lui-même

   Pour un contenu que le serveur multimédia ne doit PAS voir (contenu
   adulte, vidéos perso…) : l'administrateur indique un dossier, Nova le
   parcourt, reconnaît séries / saisons / épisodes d'après les noms de
   fichiers (« Titre.S01E02.Nom.de.l.episode… »), et le présente comme
   n'importe quelle bibliothèque.

   Comme pour Jellyfin, tout est servi au « format Plex » que l'interface
   connaît déjà, avec des identifiants à partir de 90 000 000.

   Accès : une bibliothèque marquée +18 n'existe que pour les comptes
   autorisés (administrateur, ou case cochée dans les réglages). Pour les
   autres : ni onglet, ni recherche, ni fiche, ni fichier — 404 partout.
   Elle n'entre jamais dans les recommandations ni dans l'assistant.

   Lecture : la vidéo n'est JAMAIS ré-encodée. Si le navigateur lit le
   fichier tel quel, il le reçoit tel quel ; sinon (Safari ne lit pas le
   MKV, autre piste audio que la première) le fichier est « remballé » en
   HLS : image copiée à l'identique, seul le son est converti en AAC.
   ══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { langue } from './i18n-serveur.js';

const DECALAGE = 90_000_000;
const EXT_VIDEO = /\.(mkv|mp4|m4v|webm|mov|avi|ts)$/i;
const BRUIT = /\b(\d{3,4}p|uncensored|censored|web-?dl|webrip|bluray|bdrip|hdtv|dual|multi|vostfr|vff|vf|ov|eng|jpn|flac\d?(\.\d)?|aac\d?(\.\d)?|ac3|eac3|ddp?\d?(\.\d)?|opus|h\.?26[45]|x26[45]|hevc|av1|10bits?|esub|hdr\d*|dv)\b.*$/i;

const propre = (s) => s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

/** « Ma.Serie.S01E02.Titre.De.L.Episode.1080p… » → { serie, saison, episode, titre } */
export function analyserNom(nomFichier) {
  const base = nomFichier.replace(EXT_VIDEO, '');
  const m = base.match(/^(.*?)[ ._-]+S(\d{1,2})[ ._-]?E(\d{1,3})(?:[ ._-]+(.*))?$/i);
  if (m) {
    const titre = m[4] ? propre(m[4].replace(BRUIT, '')).replace(/-[A-Za-z0-9]+$/, '').trim() : '';
    return { serie: propre(m[1]), saison: Number(m[2]), episode: Number(m[3]), titre };
  }
  return { film: propre(base.replace(BRUIT, '')).replace(/-[A-Za-z0-9]+$/, '').trim() || propre(base) };
}

/* ── Analyse d'un fichier (durée, pistes) avec ffmpeg, en cache ── */
function sonder(ffmpeg, fichier) {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-i', fichier], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      const duree = (() => {
        const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
        return m ? Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) : 0;
      })();
      const pistes = [];
      const lignes = err.split(/\r?\n/);
      for (let i = 0; i < lignes.length; i++) {
        const m = lignes[i].match(/Stream #0:(\d+)(?:\[[^\]]+\])?(?:\((\w+)\))?: (Video|Audio|Subtitle): (\w+)(.*)$/);
        if (!m) continue;
        let titre;
        for (let j = i + 1; j < lignes.length && !/Stream #0:/.test(lignes[j]); j++) {
          const t = lignes[j].match(/^\s+title\s*:\s*(.+)$/);
          if (t) { titre = t[1].trim(); break; }
        }
        const reste = m[5] || '';
        pistes.push({
          index: Number(m[1]),
          type: m[3],
          langue: m[2] && m[2] !== 'und' ? m[2] : null,
          codec: m[4].toLowerCase(),
          defaut: /\(default\)/.test(reste),
          canaux: /5\.1/.test(reste) ? 6 : /7\.1/.test(reste) ? 8 : /stereo/.test(reste) ? 2 : /mono/.test(reste) ? 1 : undefined,
          hauteur: (reste.match(/, \d+x(\d+)/) || [])[1] ? Number(reste.match(/, \d+x(\d+)/)[1]) : undefined,
          titre,
        });
      }
      resolve({ duree, pistes });
    });
    p.on('error', () => resolve({ duree: 0, pistes: [] }));
  });
}

function capture(ffmpeg, fichier, secondes, sortie, filtre) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    const p = spawn(ffmpeg, ['-v', 'error', '-ss', String(Math.max(0, secondes)), '-i', fichier, '-frames:v', '1', '-vf', filtre, '-q:v', '4', '-y', sortie], { windowsHide: true });
    const t = setTimeout(() => p.kill(), 30000);
    p.on('close', () => { clearTimeout(t); resolve(fs.existsSync(sortie)); });
    p.on('error', () => { clearTimeout(t); resolve(false); });
  });
}

const LANGUES = { jpn: 'Japonais', eng: 'English', fra: 'Français', fre: 'Français', spa: 'Español', ger: 'Deutsch', kor: '한국어', chi: '中文' };

/**
 * @param deps { db, dossierDonnees, ffmpeg, bibliotheques: () => [{id, nom, chemin, adulte}], acces: () => { adulte: bool },
 *               tmdb: (chemin, params) => Promise<json> — facultatif, pour les vraies affiches et résumés }
 */
export function creerLocales({ db, dossierDonnees, ffmpeg, bibliotheques, acces, tmdb }) {
  db.exec('CREATE TABLE IF NOT EXISTS local_ids (n INTEGER PRIMARY KEY AUTOINCREMENT, cle TEXT UNIQUE NOT NULL)');
  const lireNum = db.prepare('SELECT n FROM local_ids WHERE cle = ?');
  const lireCle = db.prepare('SELECT cle FROM local_ids WHERE n = ?');
  const ajouter = db.prepare('INSERT OR IGNORE INTO local_ids (cle) VALUES (?)');
  const num = (cle) => { ajouter.run(cle); return lireNum.get(cle).n + DECALAGE; };
  const cleDe = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= DECALAGE) return null;
    return lireCle.get(v - DECALAGE)?.cle || null;
  };
  const estLocal = (n) => Number(n) > DECALAGE && !!cleDe(n);

  const CACHE = path.join(dossierDonnees, 'local-cache');
  const FICHIER_SONDES = path.join(CACHE, 'sondes.json');
  fs.mkdirSync(CACHE, { recursive: true });
  let sondes = {};
  try { sondes = JSON.parse(fs.readFileSync(FICHIER_SONDES, 'utf8')); } catch { /* premier passage */ }
  let ecritureSondes = null;
  const sauverSondes = () => {
    clearTimeout(ecritureSondes);
    ecritureSondes = setTimeout(() => { try { fs.writeFileSync(FICHIER_SONDES, JSON.stringify(sondes)); } catch {} }, 2000);
  };

  /* ── Fiches TMDB : affiche, fond, résumé, genres, titres et images des
     épisodes. Cherchées en arrière-plan (FR + EN), gardées sur disque. Le
     contenu adulte n'apparaît dans TMDB qu'avec include_adult=true. Sans
     correspondance, on garde les captures de la vidéo. ── */
  const FICHIER_TMDB = path.join(CACHE, 'tmdb.json');
  let fiches = {};
  try { fiches = JSON.parse(fs.readFileSync(FICHIER_TMDB, 'utf8')); } catch { /* premier passage */ }
  const sauverFiches = () => { try { fs.writeFileSync(FICHIER_TMDB, JSON.stringify(fiches)); } catch {} };
  const normal = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  let enrichissement = null;

  async function chercherFiche(type, titre, adulte) {
    const r = await tmdb(`/search/${type}`, { query: titre, include_adult: String(!!adulte), language: 'fr-FR' });
    const res = r.results || [];
    const t = normal(titre);
    const choisi = res.find((x) => [x.name, x.title, x.original_name, x.original_title].some((n) => normal(n) === t)) || res[0];
    if (!choisi) return { aucune: Date.now() };
    const details = async (l) => tmdb(`/${type}/${choisi.id}`, { language: l });
    const [fr, en] = await Promise.all([details('fr-FR'), details('en-US')]);
    const fiche = {
      id: choisi.id, type, poster: fr.poster_path || en.poster_path, fond: fr.backdrop_path || en.backdrop_path,
      annee: Number(String(fr.first_air_date || fr.release_date || '').slice(0, 4)) || undefined,
      date: fr.first_air_date || fr.release_date || undefined,
      note: fr.vote_average ? Math.round(fr.vote_average * 10) / 10 : undefined,
      studio: (fr.production_companies || fr.networks || [])[0]?.name,
      fr: { titre: fr.name || fr.title, resume: fr.overview, genres: (fr.genres || []).map((g) => g.name) },
      en: { titre: en.name || en.title, resume: en.overview, genres: (en.genres || []).map((g) => g.name) },
      saisons: {},
    };
    if (type === 'tv') {
      for (const s of fr.seasons || []) {
        const [sfr, sen] = await Promise.all([
          tmdb(`/tv/${choisi.id}/season/${s.season_number}`, { language: 'fr-FR' }).catch(() => ({})),
          tmdb(`/tv/${choisi.id}/season/${s.season_number}`, { language: 'en-US' }).catch(() => ({})),
        ]);
        fiche.saisons[s.season_number] = {
          poster: s.poster_path,
          episodes: Object.fromEntries((sfr.episodes || []).map((e) => {
            const een = (sen.episodes || []).find((x) => x.episode_number === e.episode_number) || {};
            return [e.episode_number, { image: e.still_path, date: e.air_date, fr: { titre: e.name, resume: e.overview }, en: { titre: een.name, resume: een.overview } }];
          })),
        };
      }
    }
    return fiche;
  }

  /** Complète les fiches manquantes (une seule passe à la fois ; un échec réessaie après 12 h). */
  function enrichir(libs) {
    if (!tmdb || enrichissement) return;
    enrichissement = (async () => {
      for (const lib of libs) {
        const items = [...lib.series.map((s) => ['tv', s.titre]), ...lib.films.map((f) => ['movie', f.titre])];
        for (const [type, titre] of items) {
          const cle = `${type}:${normal(titre)}`;
          const f = fiches[cle];
          if (f && !(f.aucune || f.erreur)) continue;
          if (f && Date.now() - (f.aucune || f.erreur) < 12 * 3600000) continue;
          try { fiches[cle] = await chercherFiche(type, titre, lib.adulte); }
          catch { fiches[cle] = { erreur: Date.now() }; }
          sauverFiches();
        }
      }
    })().finally(() => { enrichissement = null; });
  }

  const ficheDe = (type, titre) => { const f = fiches[`${type}:${normal(titre)}`]; return f && f.id ? f : null; };
  const texte = (bloc) => (bloc ? (langue() === 'en' ? bloc.en : bloc.fr) || bloc.fr || {} : {});
  /** Champs Plex tirés de la fiche TMDB (résumé, année, genres, note). */
  function champsFiche(f) {
    if (!f) return {};
    const t = texte(f);
    return {
      summary: t.resume || undefined, year: f.annee, originallyAvailableAt: f.date, rating: f.note, studio: f.studio,
      Genre: (t.genres || []).map((g) => ({ tag: g })),
    };
  }

  /** Télécharge une image TMDB une fois, puis la sert depuis le cache. */
  async function imageTmdb(chemin, taille) {
    if (!chemin) return null;
    const sortie = path.join(CACHE, 'images', `tmdb-${taille}-${chemin.replace(/[^\w.]/g, '')}`);
    if (fs.existsSync(sortie)) return sortie;
    try {
      const r = await fetch(`https://image.tmdb.org/t/p/${taille}${chemin}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      fs.mkdirSync(path.dirname(sortie), { recursive: true });
      fs.writeFileSync(sortie, Buffer.from(await r.arrayBuffer()));
      return sortie;
    } catch { return null; }
  }

  /* ── Catalogue : une lecture du dossier par minute au plus ── */
  let catalogue = { at: 0, libs: [] };
  async function charger(force = false) {
    if (!force && Date.now() - catalogue.at < 60000) return catalogue.libs;
    const libs = [];
    for (const b of bibliotheques()) {
      if (!b.chemin || !fs.existsSync(b.chemin)) { libs.push({ ...b, key: String(num(`lib:${b.id}`)), series: [], films: [], absente: true }); continue; }
      const fichiers = [];
      (function parcourir(d, profondeur) {
        if (profondeur > 4) return;
        for (const n of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, n.name);
          if (n.isDirectory()) parcourir(p, profondeur + 1);
          else if (EXT_VIDEO.test(n.name)) fichiers.push(p);
        }
      })(b.chemin, 0);

      const series = new Map();
      const films = [];
      for (const f of fichiers) {
        const st = fs.statSync(f);
        const a = analyserNom(path.basename(f));
        const cleSonde = `${f}|${st.size}|${st.mtimeMs}`;
        if (!sondes[cleSonde]) { sondes[cleSonde] = await sonder(ffmpeg, f); sauverSondes(); }
        const s = sondes[cleSonde];
        const entree = { fichier: f, taille: st.size, ajoute: Math.floor(st.birthtimeMs / 1000) || Math.floor(st.mtimeMs / 1000), ...s };
        if (a.serie) {
          const cs = a.serie.toLowerCase();
          if (!series.has(cs)) series.set(cs, { titre: a.serie, saisons: new Map() });
          const sa = series.get(cs);
          if (!sa.saisons.has(a.saison)) sa.saisons.set(a.saison, []);
          sa.saisons.get(a.saison).push({ ...entree, numero: a.episode, titre: a.titre || `Épisode ${a.episode}` });
        } else films.push({ ...entree, titre: a.film });
      }
      // Identifiants stables (chemin de la série / du fichier) et tri
      const listeSeries = [...series.values()].map((s) => {
        const sid = num(`serie:${b.id}:${s.titre.toLowerCase()}`);
        const saisons = [...s.saisons.entries()].sort((x, y) => x[0] - y[0]).map(([n, eps]) => ({
          id: num(`saison:${b.id}:${s.titre.toLowerCase()}:${n}`), numero: n,
          episodes: eps.sort((x, y) => x.numero - y.numero).map((e) => ({ ...e, id: num(`fichier:${e.fichier}`), partId: num(`part:${e.fichier}`) })),
        }));
        const tous = saisons.flatMap((x) => x.episodes);
        return { id: sid, titre: s.titre, saisons, ajoute: Math.max(...tous.map((e) => e.ajoute)), premier: tous[0] };
      });
      libs.push({
        ...b, key: String(num(`lib:${b.id}`)),
        series: listeSeries,
        films: films.map((f) => ({ ...f, id: num(`fichier:${f.fichier}`), partId: num(`part:${f.fichier}`) })),
      });
    }
    catalogue = { at: Date.now(), libs };
    enrichir(libs);
    return libs;
  }

  /* L'accès : une bibliothèque +18 n'est visible que des comptes autorisés. */
  const visible = (lib) => !lib.adulte || acces().adulte;
  async function libsVisibles() { return (await charger()).filter(visible); }

  /** Retrouve un élément (série, saison, épisode, film) et sa bibliothèque. */
  async function trouver(n) {
    const v = Number(n);
    for (const lib of await charger()) {
      for (const s of lib.series) {
        if (s.id === v) return { lib, type: 'show', serie: s };
        for (const sa of s.saisons) {
          if (sa.id === v) return { lib, type: 'season', serie: s, saison: sa };
          for (const e of sa.episodes) if (e.id === v || e.partId === v) return { lib, type: 'episode', serie: s, saison: sa, episode: e };
        }
      }
      for (const f of lib.films) if (f.id === v || f.partId === v) return { lib, type: 'movie', film: f };
    }
    return null;
  }

  /* ── Mise au format Plex ── */
  // Le dernier segment change quand une fiche TMDB arrive : le navigateur ne ressert pas l'ancienne capture.
  const imagePath = (id, sorte, fiche) => `/library/metadata/${id}/${sorte}/${fiche?.id || 1}`;
  function pistesPlex(e) {
    return (e.pistes || []).map((p) => ({
      id: num(`piste:${e.fichier}:${p.index}`),
      index: p.index,
      streamType: p.type === 'Video' ? 1 : p.type === 'Audio' ? 2 : 3,
      // ASS / SSA : livrés en WebVTT à côté de la vidéo (extraction ffmpeg) —
      // jamais gravés dans l'image, puisqu'on ne ré-encode pas la vidéo.
      codec: p.type === 'Subtitle' && /^(ass|ssa|subrip|srt|webvtt|mov_text)$/.test(p.codec) ? 'srt' : p.codec,
      language: LANGUES[p.langue] || p.langue || undefined,
      languageCode: p.langue || undefined,
      displayTitle: [LANGUES[p.langue] || p.langue, p.titre, p.codec.toUpperCase()].filter(Boolean).join(' · '),
      selected: p.defaut || undefined,
      channels: p.canaux,
      height: p.hauteur,
    }));
  }
  function mediaPlex(e) {
    const video = (e.pistes || []).find((p) => p.type === 'Video');
    const audio = (e.pistes || []).find((p) => p.type === 'Audio');
    const conteneur = path.extname(e.fichier).slice(1).toLowerCase();
    return [{
      id: e.partId, duration: e.duree, container: conteneur,
      videoCodec: video?.codec, audioCodec: audio?.codec,
      videoResolution: video?.hauteur ? String(video.hauteur) : undefined,
      Part: [{ id: e.partId, key: `/library/parts/${e.partId}/0/file.${conteneur}`, file: e.fichier, size: e.taille, duration: e.duree, container: conteneur, Stream: pistesPlex(e) }],
    }];
  }
  const commun = (lib) => ({ librarySectionID: Number(lib.key), librarySectionTitle: lib.nom, contentRating: lib.adulte ? '18+' : undefined, adulte: lib.adulte || undefined });

  function plexSerie(lib, s) {
    const nb = s.saisons.reduce((n, x) => n + x.episodes.length, 0);
    const f = ficheDe('tv', s.titre);
    return {
      Genre: [], Guid: [], ...champsFiche(f),
      ratingKey: String(s.id), key: `/library/metadata/${s.id}/children`, type: 'show', title: texte(f).titre || s.titre,
      thumb: imagePath(s.id, 'thumb', f), art: imagePath(s.id, 'art', f), addedAt: s.ajoute,
      childCount: s.saisons.length, leafCount: nb, ...commun(lib),
    };
  }
  function plexSaison(lib, s, sa) {
    const f = ficheDe('tv', s.titre);
    return {
      ratingKey: String(sa.id), key: `/library/metadata/${sa.id}/children`, type: 'season', title: `${langue() === 'en' ? 'Season' : 'Saison'} ${sa.numero}`, index: sa.numero,
      parentRatingKey: String(s.id), parentTitle: texte(f).titre || s.titre, thumb: imagePath(sa.id, 'thumb', f), parentThumb: imagePath(s.id, 'thumb', f),
      art: imagePath(s.id, 'art', f), leafCount: sa.episodes.length, summary: texte(f).resume || undefined, ...commun(lib),
    };
  }
  function plexEpisode(lib, s, sa, e) {
    const f = ficheDe('tv', s.titre);
    const fe = f?.saisons?.[sa.numero]?.episodes?.[e.numero];
    const te = texte(fe);
    return {
      ratingKey: String(e.id), key: `/library/metadata/${e.id}`, type: 'episode', title: te.titre || e.titre, index: e.numero, parentIndex: sa.numero,
      summary: te.resume || undefined, originallyAvailableAt: fe?.date,
      parentRatingKey: String(sa.id), grandparentRatingKey: String(s.id), parentTitle: `${langue() === 'en' ? 'Season' : 'Saison'} ${sa.numero}`, grandparentTitle: texte(f).titre || s.titre,
      thumb: imagePath(e.id, 'thumb', f), parentThumb: imagePath(sa.id, 'thumb', f), grandparentThumb: imagePath(s.id, 'thumb', f), art: imagePath(s.id, 'art', f),
      duration: e.duree, addedAt: e.ajoute, Media: mediaPlex(e), ...commun(lib),
    };
  }
  function plexFilm(lib, fi) {
    const f = ficheDe('movie', fi.titre);
    return {
      Genre: [], Guid: [], ...champsFiche(f),
      ratingKey: String(fi.id), key: `/library/metadata/${fi.id}`, type: 'movie', title: texte(f).titre || fi.titre,
      thumb: imagePath(fi.id, 'thumb', f), art: imagePath(fi.id, 'art', f), duration: fi.duree, addedAt: fi.ajoute,
      Media: mediaPlex(fi), ...commun(lib),
    };
  }
  const conteneur = (Metadata, extra = {}) => ({ MediaContainer: { size: Metadata.length, Metadata, ...extra } });

  /** Les sections locales visibles par la personne connectée (format /library/sections). */
  async function sections() {
    return (await libsVisibles()).map((l) => ({ key: l.key, title: l.nom, type: l.series.length || !l.films.length ? 'show' : 'movie', adulte: !!l.adulte }));
  }

  /** Une requête « Plex » qui vise une bibliothèque locale → réponse, sinon null. */
  async function plexJson(cheminComplet) {
    const [chemin] = String(cheminComplet).split('?');
    let m;
    if ((m = chemin.match(/^\/library\/sections\/(\d+)\/all$/))) {
      const lib = (await charger()).find((l) => l.key === m[1]);
      if (!lib) return null;
      if (!visible(lib)) return conteneur([]);
      const items = [...lib.series.map((s) => plexSerie(lib, s)), ...lib.films.map((f) => plexFilm(lib, f))]
        .sort((a, b) => a.title.localeCompare(b.title));
      return conteneur(items, { librarySectionID: Number(lib.key), librarySectionTitle: lib.nom });
    }
    if ((m = chemin.match(/^\/library\/sections\/(\d+)\/(genre|audioLanguage|subtitleLanguage)$/))) {
      if (!(await charger()).some((l) => l.key === m[1])) return null;
      return { MediaContainer: { size: 0, Directory: [] } };
    }
    if ((m = chemin.match(/^\/library\/metadata\/(\d+)(\/children|\/allLeaves|\/related)?$/))) {
      if (!estLocal(m[1])) return null;
      const t = await trouver(m[1]);
      if (!t || !visible(t.lib)) return conteneur([]);
      const { lib } = t;
      if (m[2] === '/related') return { MediaContainer: { size: 0, Hub: [] } };
      if (m[2] === '/children') {
        if (t.type === 'show') return conteneur(t.serie.saisons.map((sa) => plexSaison(lib, t.serie, sa)), { librarySectionID: Number(lib.key) });
        if (t.type === 'season') return conteneur(t.saison.episodes.map((e) => plexEpisode(lib, t.serie, t.saison, e)), { librarySectionID: Number(lib.key) });
        return conteneur([]);
      }
      if (m[2] === '/allLeaves') {
        if (t.type !== 'show') return conteneur([]);
        return conteneur(t.serie.saisons.flatMap((sa) => sa.episodes.map((e) => plexEpisode(lib, t.serie, sa, e))));
      }
      const meta = t.type === 'show' ? plexSerie(lib, t.serie)
        : t.type === 'season' ? plexSaison(lib, t.serie, t.saison)
          : t.type === 'episode' ? plexEpisode(lib, t.serie, t.saison, t.episode)
            : plexFilm(lib, t.film);
      return conteneur([meta], { librarySectionID: Number(lib.key), librarySectionTitle: lib.nom });
    }
    return null;
  }

  /** Résultats de recherche locaux (pour /hubs/search), seulement si visibles. */
  async function rechercher(terme) {
    const q = String(terme || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    if (q.length < 2) return [];
    const out = [];
    for (const lib of await libsVisibles()) {
      const trouve = (type, titre) => [titre, ...['fr', 'en'].map((l) => ficheDe(type, titre)?.[l]?.titre)]
        .some((x) => x && x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
      for (const s of lib.series) if (trouve('tv', s.titre)) out.push(plexSerie(lib, s));
      for (const f of lib.films) if (trouve('movie', f.titre)) out.push(plexFilm(lib, f));
    }
    return out;
  }

  /** Ajoute les sections locales à /library/sections et les résultats locaux à /hubs/search. */
  async function fusionner(json, chemin, query) {
    const mc = json?.MediaContainer;
    if (!mc) return json;
    if (/^\/library\/sections\/?$/.test(chemin)) {
      mc.Directory = [...(mc.Directory || []), ...(await sections()).map(({ key, title, type }) => ({ key, title, type }))];
      mc.size = mc.Directory.length;
    } else if (chemin === '/hubs/search') {
      const res = await rechercher(new URLSearchParams(query || '').get('query'));
      if (res.length) {
        mc.Hub = mc.Hub || [];
        const shows = res.filter((x) => x.type === 'show');
        const films = res.filter((x) => x.type === 'movie');
        const hub = (type) => mc.Hub.find((h) => h.type === type);
        if (shows.length) { if (hub('show')) hub('show').Metadata = [...(hub('show').Metadata || []), ...shows]; else mc.Hub.push({ type: 'show', title: 'Séries', Metadata: shows }); }
        if (films.length) { if (hub('movie')) hub('movie').Metadata = [...(hub('movie').Metadata || []), ...films]; else mc.Hub.push({ type: 'movie', title: 'Films', Metadata: films }); }
      }
    }
    return json;
  }

  /** Ce chemin Plex concerne-t-il un élément local ? (fiche, image, fichier, suivi) */
  function concerne(cheminComplet) {
    const [chemin, qs = ''] = String(cheminComplet).split('?');
    const q = new URLSearchParams(qs);
    const ids = [
      ...[...chemin.matchAll(/\/library\/(?:metadata|parts|sections)\/(\d+)/g)].map((m) => m[1]),
      q.get('ratingKey'), q.get('key'), (q.get('url') || '').match(/\/library\/metadata\/(\d+)/)?.[1],
    ].filter(Boolean);
    return ids.some((n) => Number(n) > DECALAGE);
  }

  /* ── Images : une capture de la vidéo, gardée en cache ── */
  async function image(n, sorte) {
    const t = await trouver(n);
    if (!t || !visible(t.lib)) return null;
    // La fiche TMDB d'abord : vraie affiche, vrai fond, image propre à l'épisode.
    const f = t.serie ? ficheDe('tv', t.serie.titre) : ficheDe('movie', t.film.titre);
    if (f) {
      const sa = t.saison || (t.episode && t.serie.saisons.find((x) => x.episodes.includes(t.episode)));
      const fs_ = sa ? f.saisons?.[sa.numero] : null;
      const chemin = sorte === 'art' ? f.fond
        : t.type === 'episode' ? fs_?.episodes?.[t.episode.numero]?.image
          : t.type === 'season' ? (fs_?.poster || f.poster) : f.poster;
      const taille = sorte === 'art' ? 'w1280' : t.type === 'episode' ? 'w780' : 'w500';
      const telechargee = await imageTmdb(chemin, taille);
      if (telechargee) return telechargee;
    }
    // Une image fournie dans le dossier (poster.jpg, folder.jpg…) passe avant la capture.
    const dossierSerie = t.serie ? path.dirname((t.serie.premier || {}).fichier || '') : null;
    if (t.type !== 'episode' && dossierSerie && dossierSerie !== t.lib.chemin) {
      const fournie = ['poster.jpg', 'folder.jpg', 'cover.jpg', 'poster.png'].map((x) => path.join(dossierSerie, x)).find((x) => fs.existsSync(x));
      if (fournie && sorte === 'thumb') return fournie;
    }
    const e = t.type === 'episode' ? t.episode : t.type === 'movie' ? t.film : t.serie.premier;
    if (!e) return null;
    const portrait = sorte === 'thumb' && t.type !== 'episode';
    const sortie = path.join(CACHE, 'images', `${n}-${portrait ? 'affiche' : 'paysage'}.jpg`);
    if (fs.existsSync(sortie)) return sortie;
    const filtre = portrait ? 'scale=-2:720,crop=480:720' : 'scale=1280:-2';
    const ok = await capture(ffmpeg, e.fichier, (e.duree / 1000) * (portrait ? 0.35 : 0.25), sortie, filtre);
    return ok ? sortie : null;
  }

  /* ── Lecture remballée (HLS) : vidéo copiée, audio choisi converti en AAC ── */
  const DOSSIER_HLS = path.join(dossierDonnees, 'local-hls');
  const travaux = new Map();   // clé → { dossier, process, fini }
  try {   // ménage : remballages de plus de 2 jours
    for (const d of fs.readdirSync(DOSSIER_HLS)) {
      const p = path.join(DOSSIER_HLS, d);
      if (Date.now() - fs.statSync(p).mtimeMs > 2 * 86400000) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch { /* rien à nettoyer */ }

  async function remballer(n, indexAudio) {
    const t = await trouver(n);
    if (!t || !visible(t.lib) || !(t.episode || t.film)) return null;
    const e = t.episode || t.film;
    const audio = (e.pistes || []).find((p) => p.type === 'Audio' && (indexAudio == null || p.index === indexAudio))
      || (e.pistes || []).find((p) => p.type === 'Audio');
    const cle = crypto.createHash('sha1').update(`${e.fichier}|${audio?.index ?? 'x'}`).digest('hex').slice(0, 16);
    const dossier = path.join(DOSSIER_HLS, cle);
    const playlist = path.join(dossier, 'index.m3u8');
    if (!travaux.has(cle) && !(fs.existsSync(playlist) && fs.readFileSync(playlist, 'utf8').includes('#EXT-X-ENDLIST'))) {
      fs.rmSync(dossier, { recursive: true, force: true });
      fs.mkdirSync(dossier, { recursive: true });
      const args = ['-v', 'error', '-i', e.fichier, '-map', '0:v:0'];
      if (audio) args.push('-map', `0:${audio.index}`, '-c:a', audio.codec === 'aac' ? 'copy' : 'aac', '-b:a', '192k', '-ac', '2');
      args.push('-c:v', 'copy', '-f', 'hls', '-hls_time', '6', '-hls_list_size', '0', '-hls_playlist_type', 'event',
        '-hls_segment_filename', path.join(dossier, 'seg%d.ts'), playlist);
      const p = spawn(ffmpeg, args, { windowsHide: true });
      const travail = { process: p, fini: false };
      travaux.set(cle, travail);
      p.on('close', () => { travail.fini = true; travaux.delete(cle); });
      p.on('error', () => { travail.fini = true; travaux.delete(cle); });
    }
    // On rend la main dès que le premier segment existe.
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(playlist) && /seg\d+\.ts/.test(fs.readFileSync(playlist, 'utf8'))) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    return { cle, playlist: fs.existsSync(playlist) ? fs.readFileSync(playlist, 'utf8') : null };
  }

  function fichierHls(cle, nom) {
    if (!/^[0-9a-f]{16}$/.test(cle) || !/^(index\.m3u8|seg\d+\.ts)$/.test(nom)) return null;
    const p = path.join(DOSSIER_HLS, cle, nom);
    return fs.existsSync(p) ? p : null;
  }

  /** Identifiant de piste (choisie dans le lecteur) → index ffmpeg de la piste. */
  function indexPiste(id) {
    const c = id ? cleDe(id) : null;
    if (!c || !c.startsWith('piste:')) return null;
    const n = Number(c.slice(c.lastIndexOf(':') + 1));
    return Number.isFinite(n) ? n : null;
  }

  /** Pour les réglages : chaque bibliothèque, son état et son nombre de titres. */
  async function resume() {
    return (await charger(true)).map((l) => ({
      id: l.id, nom: l.nom, chemin: l.chemin, adulte: !!l.adulte, absente: !!l.absente,
      series: l.series.length, episodes: l.series.reduce((n, s) => n + s.saisons.reduce((m, x) => m + x.episodes.length, 0), 0), films: l.films.length,
    }));
  }

  return { charger, sections, plexJson, fusionner, concerne, trouver, image, remballer, fichierHls, visible, estLocal, indexPiste, resume, oublier: () => { catalogue.at = 0; } };
}
