/* ══════════════════════════════════════════════════════════════════
   Remballage Nova — l'image telle quelle, seul le son converti

   Un tiers des lectures dans le navigateur partaient en transcodage Plex
   (mesuré sur un échantillon de la bibliothèque) ALORS QUE l'image était
   lisible : la seule raison était le son (EAC3 / AC3 / DTS, que Chrome ne
   lit pas) ou une VF rangée en deuxième piste. Plex ré-encodait donc toute
   la vidéo (AV1 4K → H.264 1080p) : ~4,5 s d'attente au démarrage, et une
   image dégradée.

   Ici, ffmpeg lit le fichier directement sur le disque, COPIE la vidéo et
   ne convertit que la piste audio choisie (AAC stéréo), en HLS fMP4. Le
   premier segment est prêt en une fraction de seconde, la qualité est celle
   d'origine (4K, HDR, AV1…), et le processeur ne fait presque rien.

   Timeline : on démarre ffmpeg au point de reprise (-ss) avec des horodatages
   décalés d'autant (-output_ts_offset), et la playlist commence par un
   segment « trou » (#EXT-X-GAP) de cette durée : pour le lecteur, la
   position reste celle du film (32:10 reste 32:10), sans rien changer à la
   reprise, aux marqueurs ni à l'enregistrement de la progression.

   La playlist est de type EVENT : elle grandit pendant que ffmpeg avance
   (bien plus vite que le temps réel), puis se ferme (#EXT-X-ENDLIST).
   ══════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_PAR_UTILISATEUR = 2;
const MAX_TOTAL = 8;
const INACTIVITE_MS = 4 * 60 * 1000;   // plus aucune demande du lecteur (pause longue, onglet fermé) → on arrête

/**
 * @param deps { ffmpeg, dossier }
 */
export function creerRemux({ ffmpeg, dossier }) {
  fs.mkdirSync(dossier, { recursive: true });
  // Restes d'un précédent démarrage
  for (const d of fs.readdirSync(dossier)) { try { fs.rmSync(path.join(dossier, d), { recursive: true, force: true }); } catch {} }

  const sessions = new Map();   // id → { id, userId, cle, process, rep, offset, fini, vu }

  const sur = (id) => /^[A-Za-z0-9_-]{6,80}$/.test(String(id || ''));

  function arreter(id) {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    try { s.process.kill('SIGKILL'); } catch {}
    setTimeout(() => { try { fs.rmSync(s.rep, { recursive: true, force: true }); } catch {} }, 1500);
  }

  // Ménage : sessions abandonnées (onglet fermé, lecteur parti sans prévenir)
  setInterval(() => {
    for (const s of sessions.values()) if (Date.now() - s.vu > INACTIVITE_MS) arreter(s.id);
  }, 20000).unref();
  process.on('exit', () => { for (const s of sessions.values()) { try { s.process.kill('SIGKILL'); } catch {} } });

  /**
   * Démarre (ou reprend) une session. Mêmes paramètres → même session.
   * @param o { id, userId, fichier, indexAudio, codecAudio, codecVideo, offset }
   * @returns Promise<boolean> — vrai quand le premier segment est prêt
   */
  async function demarrer(o) {
    if (!sur(o.id)) throw new Error('Session invalide');
    const cle = `${o.fichier}|${o.indexAudio}|${Math.floor(o.offset || 0)}`;
    const existante = sessions.get(o.id);
    if (existante && existante.cle === cle) { existante.vu = Date.now(); return attendrePremier(existante); }
    if (existante) arreter(o.id);

    // Limites : on libère d'abord les plus anciennes sessions de cette personne.
    const miennes = [...sessions.values()].filter((s) => s.userId === o.userId).sort((a, b) => a.vu - b.vu);
    while (miennes.length >= MAX_PAR_UTILISATEUR) arreter(miennes.shift().id);
    if (sessions.size >= MAX_TOTAL) throw new Error('Trop de lectures en cours');

    const rep = path.join(dossier, o.id);
    fs.rmSync(rep, { recursive: true, force: true });
    fs.mkdirSync(rep, { recursive: true });
    const offset = Math.max(0, Math.floor(o.offset || 0));
    // Vitesse : 2 min d'avance tout de suite (démarrage instantané), puis 3× le
    // temps réel. Sans frein, ffmpeg recopierait un film 4K entier (20 Go) sur
    // le disque en une minute, même si on n'en regarde que le début.
    const args = ['-v', 'error', '-nostdin', '-readrate', '3', '-readrate_initial_burst', '120'];
    if (offset > 0) args.push('-ss', String(offset));
    args.push('-i', o.fichier, '-map', '0:v:0', '-map', `0:${o.indexAudio}`, '-c:v', 'copy');
    if (o.codecVideo === 'hevc') args.push('-tag:v', 'hvc1');   // l'étiquette qu'attendent les navigateurs
    // AAC déjà là (VF simplement rangée en 2e piste) : copiée. Sinon → AAC stéréo.
    if (o.codecAudio === 'aac') args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-b:a', '224k', '-ac', '2');
    if (offset > 0) args.push('-output_ts_offset', String(offset));
    args.push('-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_playlist_type', 'event',
      '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_flags', 'independent_segments+temp_file',
      '-hls_segment_filename', 'seg%d.m4s', 'index.m3u8');

    // Lancé DANS le dossier de la session : ffmpeg 6 écrit init.mp4 dans son dossier
    // courant, pas à côté des segments (deux lectures se l'écraseraient).
    const p = spawn(ffmpeg, args, { cwd: rep, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const s = { id: o.id, userId: o.userId, cle, requete: o.requete, process: p, rep, offset, fini: false, erreur: '', vu: Date.now() };
    p.stderr.on('data', (d) => { s.erreur = (s.erreur + d).slice(-2000); });
    p.on('exit', (code) => { s.fini = true; if (code && sessions.get(o.id) === s) console.warn(`[Remux] ffmpeg ${code} : ${s.erreur.trim().split('\n').pop()}`); });
    p.on('error', (e) => { s.fini = true; s.erreur = e.message; });
    sessions.set(o.id, s);
    return attendrePremier(s);
  }

  /* hls.js traite une playlist qui grandit comme du direct : il lui faut
     quelques segments pour démarrer. Trois suffisent (≈ 1 s en 4K). */
  async function attendrePremier(s) {
    const liste = path.join(s.rep, 'index.m3u8');
    for (let i = 0; i < 150; i++) {   // 15 s au plus
      if (fs.existsSync(liste)) {
        const t = fs.readFileSync(liste, 'utf8');
        if ((t.match(/seg\d+\.m4s/g) || []).length >= 3 || (s.fini && /seg\d+\.m4s/.test(t))) return true;
      }
      if (s.fini) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  /** Playlist à servir : segment « trou » jusqu'au point de départ, puis ffmpeg. */
  function playlist(id, adresse) {
    const s = sessions.get(id);
    if (!s) return null;
    s.vu = Date.now();
    let texte;
    try { texte = fs.readFileSync(path.join(s.rep, 'index.m3u8'), 'utf8'); } catch { return null; }
    const lignes = texte.split(/\r?\n/);
    const cible = Number((texte.match(/#EXT-X-TARGETDURATION:(\d+)/) || [])[1]) || 4;
    const sortie = [];
    let trouPose = s.offset <= 0;
    for (const l of lignes) {
      if (!l) continue;
      if (l.startsWith('#EXT-X-MAP:')) { sortie.push(`#EXT-X-MAP:URI="${adresse('init.mp4')}"`); continue; }
      if (!trouPose && l.startsWith('#EXTINF:')) {
        // Le trou en tronçons pas plus longs que la durée cible : hls.js règle
        // le rechargement de la playlist sur cette durée.
        for (let reste = s.offset; reste > 0.0005; reste -= cible) {
          sortie.push(`#EXTINF:${Math.min(cible, reste).toFixed(3)},`, '#EXT-X-GAP', adresse('trou.m4s'));
        }
        trouPose = true;
      }
      if (!l.startsWith('#')) { sortie.push(adresse(l.trim())); continue; }
      sortie.push(l);
    }
    return sortie.join('\n') + '\n';
  }

  function fichier(id, nom) {
    const s = sessions.get(id);
    if (!s || !/^(init\.mp4|seg\d+\.m4s)$/.test(nom)) return null;
    s.vu = Date.now();
    const p = path.join(s.rep, nom);
    return fs.existsSync(p) ? p : null;
  }

  const appartient = (id, userId) => sessions.get(id)?.userId === userId;
  /** La même demande (rechargement de la playlist par le lecteur) ? → pas besoin de relire les métadonnées. */
  const meme = (id, userId, requete) => { const s = sessions.get(id); return !!s && s.userId === userId && s.requete === requete; };

  return { demarrer, playlist, fichier, arreter, appartient, meme, sur };
}
