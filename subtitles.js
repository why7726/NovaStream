// ═══════════════════════════════════════════════════════════════════
//  Sous-titres externes — OpenSubtitles (API v1)
//
//  Utilisé quand un fichier n'a aucune piste française. On cherche par
//  identifiant IMDb (fiable) avec repli sur titre + année, on télécharge
//  le .srt, on le convertit en WebVTT (le seul format que <track> lit)
//  et on le garde en cache disque pour ne jamais le retélécharger.
//
//  Le palier gratuit limite les TÉLÉCHARGEMENTS par jour : la recherche
//  est libre, seule la récupération d'un fichier consomme le quota.
// ═══════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';

const API = 'https://api.opensubtitles.com/api/v1';
const UA = 'NovaStream v1.0';

export function createSubtitles({ cacheDir }) {
  // Lues à l'usage : l'administrateur peut les changer depuis les réglages.
  const KEY = () => process.env.OPENSUBTITLES_API_KEY || '';
  const USER = () => process.env.OPENSUBTITLES_USER || '';
  const PASS = () => process.env.OPENSUBTITLES_PASSWORD || '';

  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}

  const enabled = () => !!KEY();

  const baseHeaders = () => ({
    'Api-Key': KEY(),
    'User-Agent': UA,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  // Le jeton de connexion vit ~24 h ; on le garde en mémoire.
  let token = null;
  let tokenAt = 0;
  async function login() {
    if (token && Date.now() - tokenAt < 20 * 60 * 60 * 1000) return token;
    if (!USER() || !PASS()) throw new Error('Identifiants OpenSubtitles manquants');
    const r = await fetch(`${API}/login`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ username: USER(), password: PASS() }),
    });
    if (!r.ok) throw new Error(`Connexion OpenSubtitles refusée (${r.status})`);
    const d = await r.json();
    token = d.token;
    tokenAt = Date.now();
    return token;
  }

  /** Recherche : imdbId prioritaire, sinon titre + année. */
  async function search({ imdbId, title, year, languages = 'fr', type }) {
    if (!enabled()) throw new Error('OpenSubtitles non configuré');
    const qs = new URLSearchParams({ languages, order_by: 'download_count', order_direction: 'desc' });
    const numericImdb = imdbId ? String(imdbId).replace(/\D/g, '') : '';
    if (numericImdb) qs.set('imdb_id', numericImdb);
    else {
      if (!title) throw new Error('Titre manquant');
      qs.set('query', title);
      if (year) qs.set('year', String(year));
    }
    if (type === 'movie' || type === 'episode') qs.set('type', type === 'episode' ? 'episode' : 'movie');

    const r = await fetch(`${API}/subtitles?${qs}`, { headers: baseHeaders() });
    if (!r.ok) throw new Error(`Recherche impossible (${r.status})`);
    const d = await r.json();

    return (d.data || [])
      .map((s) => {
        const a = s.attributes || {};
        const f = (a.files || [])[0] || {};
        return {
          fileId: f.file_id,
          name: a.release || f.file_name || 'Sous-titre',
          language: a.language,
          downloads: a.download_count || 0,
          hearingImpaired: !!a.hearing_impaired,
          fromTrusted: !!a.from_trusted,
          fps: a.fps || null,
        };
      })
      .filter((s) => s.fileId)
      .slice(0, 12);
  }

  /* ── SRT → WebVTT ──────────────────────────────────────────────
     Deux différences seulement : l'en-tête WEBVTT et les millisecondes
     séparées par un point au lieu d'une virgule. */
  function srtToVtt(srt) {
    const body = srt
      .replace(/^﻿/, '')
      .replace(/\r\n|\r/g, '\n')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return `WEBVTT\n\n${body}`;
  }

  /** Télécharge (ou relit le cache) et renvoie le contenu WebVTT. */
  async function fetchVtt(fileId) {
    if (!enabled()) throw new Error('OpenSubtitles non configuré');
    const safe = String(fileId).replace(/\D/g, '');
    if (!safe) throw new Error('Identifiant invalide');
    const cached = path.join(cacheDir, `${safe}.vtt`);
    if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8');

    const tk = await login();
    const r = await fetch(`${API}/download`, {
      method: 'POST',
      headers: { ...baseHeaders(), Authorization: `Bearer ${tk}` },
      body: JSON.stringify({ file_id: Number(safe) }),
    });
    if (r.status === 406) throw new Error('Quota de téléchargements atteint pour aujourd’hui');
    if (!r.ok) throw new Error(`Téléchargement refusé (${r.status})`);
    const d = await r.json();
    if (!d.link) throw new Error('Lien de téléchargement absent');

    const file = await fetch(d.link, { headers: { 'User-Agent': UA } });
    if (!file.ok) throw new Error(`Fichier illisible (${file.status})`);
    const srt = await file.text();
    const vtt = srtToVtt(srt);
    try { fs.writeFileSync(cached, vtt, 'utf8'); } catch { /* le cache est un bonus */ }
    return vtt;
  }

  return { enabled, search, fetchVtt, srtToVtt };
}

export default createSubtitles;
