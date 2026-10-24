/* ══════════════════════════════════════════════════════════════════
   Téléchargements (mode hors ligne des applications)

   L'application demande un titre dans une qualité :
   · « original » : le fichier tel quel — rien à préparer, l'application le
     télécharge directement (le serveur ne fait que vérifier l'accès) ;
   · une qualité réduite (1080p, 720p, 480p) : ffmpeg prépare un MP4 H.264 +
     AAC stéréo, lisible par n'importe quel téléphone, avec la carte
     graphique (NVENC). Un film HDR est converti en couleurs normales (SDR),
     sinon il paraîtrait délavé sur un écran ordinaire. Le MP4 est
     « faststart » : il se lit même pendant qu'il se télécharge encore.

   Un fichier préparé sert à tout le monde (même source + même qualité +
   même piste audio → même fichier), dans data/telechargements/. Les plus
   anciens partent quand la place réservée est pleine.
   ══════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const QUALITES = {
  '1080p': { hauteur: 1080, debit: 8000, libelle: '1080p · 8 Mbps' },
  '720p-4': { hauteur: 720, debit: 4000, libelle: '720p · 4 Mbps' },
  '720p-2': { hauteur: 720, debit: 2000, libelle: '720p · 2 Mbps' },
  '480p': { hauteur: 480, debit: 1500, libelle: '480p · 1,5 Mbps' },
};
const AUDIO_KBPS = 160;
// Titres en attente ou en préparation par compte (une saison entière doit passer ;
// la file reste traitée un par un, c'est seulement un garde-fou).
const MAX_PAR_UTILISATEUR = 40;

/**
 * @param deps { ffmpeg, dossier, maxGo }
 */
export function creerTelechargements({ ffmpeg, dossier, maxGo = 80 }) {
  fs.mkdirSync(dossier, { recursive: true });
  // Fichiers incomplets d'un précédent démarrage : à refaire
  for (const f of fs.readdirSync(dossier)) if (f.endsWith('.part')) { try { fs.rmSync(path.join(dossier, f)); } catch {} }

  const travaux = new Map();   // cle → { cle, etat, progression, erreur, utilisateurs:Set, args, duree }
  // Qui a le droit de récupérer quel fichier : ceux qui l'ont DEMANDÉ (et donc
  // passé les contrôles d'accès : bibliothèques privées, +18…).
  const droits = new Map();    // cle → Set(userId)
  const donnerDroit = (cle, userId) => { if (!droits.has(cle)) droits.set(cle, new Set()); droits.get(cle).add(userId); };
  const file = [];             // clés en attente
  let enCours = null;

  const chemin = (cle) => path.join(dossier, `${cle}.mp4`);
  const pret = (cle) => fs.existsSync(chemin(cle));

  function cleDe({ fichier, indexAudio, qualite }) {
    let stat = '';
    try { const s = fs.statSync(fichier); stat = `${s.size}|${s.mtimeMs}`; } catch {}
    return crypto.createHash('sha1').update(`${fichier}|${stat}|${indexAudio}|${qualite}`).digest('hex').slice(0, 24);
  }

  /** Demande la préparation (ou rend l'état si elle est déjà faite / en cours). */
  function demander({ fichier, indexAudio, qualite, hdr, dureeS, hauteurSource, userId }) {
    const q = QUALITES[qualite];
    if (!q) throw new Error('Qualité inconnue');
    const cle = cleDe({ fichier, indexAudio, qualite });
    donnerDroit(cle, userId);
    if (pret(cle)) {
      try { const t = new Date(); fs.utimesSync(chemin(cle), t, t); } catch {}   // récemment demandé → gardé
      return etat(cle);
    }
    let t = travaux.get(cle);
    if (t && t.etat === 'erreur') { travaux.delete(cle); t = null; }   // redemandé après un échec : on réessaie
    if (!t) {
      const miens = [...travaux.values()].filter((x) => x.utilisateurs.has(userId) && ['attente', 'preparation'].includes(x.etat));
      if (miens.length >= MAX_PAR_UTILISATEUR) throw new Error('Trop de téléchargements en préparation — attends que les premiers soient prêts');
      // Jamais d'agrandissement : une source 720p demandée en 1080p reste en 720p (hauteur paire).
      const hauteur = Math.min(q.hauteur, Number(hauteurSource) > 0 ? Math.floor(Number(hauteurSource) / 2) * 2 : q.hauteur);
      t = { cle, etat: 'attente', progression: 0, erreur: null, utilisateurs: new Set(), fichier, indexAudio, q, hauteur, hdr, dureeS };
      travaux.set(cle, t);
      file.push(cle);
      suivant();
    }
    t.utilisateurs.add(userId);
    return etat(cle);
  }

  function etat(cle) {
    if (pret(cle)) {
      const taille = fs.statSync(chemin(cle)).size;
      return { cle, etat: 'pret', progression: 100, taille };
    }
    const t = travaux.get(cle);
    if (!t) return null;
    return { cle, etat: t.etat, progression: Math.round(t.progression), erreur: t.erreur, position: t.etat === 'attente' ? file.indexOf(cle) + 1 : 0 };
  }

  function suivant() {
    if (enCours || !file.length) return;
    const cle = file.shift();
    const t = travaux.get(cle);
    if (!t) return suivant();
    enCours = cle;
    t.etat = 'preparation';
    const sortie = `${chemin(cle)}.part`;
    /* Trois chaînes, de la plus rapide à la plus sûre (mesuré sur un AV1 1080p) :
       · tout sur la carte graphique (décodage CUDA, mise à l'échelle CUDA, NVENC) : ~26× le temps réel ;
       · HDR : décodage CUDA, conversion des couleurs sur le processeur (pas de filtre GPU pour ça), NVENC ;
       · secours : tout sur le processeur (lent — le ffmpeg fourni n'a que libaom pour l'AV1 : ~1,5×). */
    const h = t.hauteur;
    let entree, filtre;
    if (t.logiciel) {
      entree = [];
      filtre = [
        ...(t.hdr ? ['zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv'] : []),
        `scale=-2:${h}:flags=lanczos`, 'format=yuv420p',
      ].join(',');
    } else if (t.hdr) {
      entree = ['-hwaccel', 'cuda'];
      filtre = ['zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0',
        'zscale=t=bt709:m=bt709:r=tv', `scale=-2:${h}:flags=lanczos`, 'format=yuv420p'].join(',');
    } else {
      entree = ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'];
      filtre = `scale_cuda=-2:${h}:format=yuv420p`;
    }
    const args = ['-v', 'error', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats',
      ...entree, '-i', t.fichier, '-map', '0:v:0', '-map', `0:${t.indexAudio}`,
      '-vf', filtre,
      // Carte graphique d'abord ; en cas d'échec (pilote, carte occupée) on refait sur le processeur.
      ...(t.logiciel ? ['-c:v', 'libx264', '-preset', 'veryfast'] : ['-c:v', 'h264_nvenc', '-preset', 'p5']), '-profile:v', 'high',
      '-b:v', `${t.q.debit}k`, '-maxrate', `${Math.round(t.q.debit * 1.5)}k`, '-bufsize', `${t.q.debit * 2}k`,
      '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2',
      '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      '-movflags', '+faststart', '-f', 'mp4', sortie];
    const p = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', (d) => {
      const m = String(d).match(/out_time_us=(\d+)/g);
      if (m && t.dureeS > 0) t.progression = Math.min(99, (Number(m[m.length - 1].split('=')[1]) / 1e6 / t.dureeS) * 100);
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
    p.on('close', (code) => {
      enCours = null;
      if (code === 0 && fs.existsSync(sortie)) {
        fs.renameSync(sortie, chemin(cle));
        travaux.delete(cle);
        menage();
        console.log(`[Téléchargements] prêt : ${path.basename(t.fichier)} (${t.q.libelle})`);
      } else if (!t.logiciel) {
        try { fs.rmSync(sortie, { force: true }); } catch {}
        console.warn(`[Téléchargements] carte graphique en échec (${err.trim().split('\n').pop()}) → processeur`);
        t.logiciel = true;
        t.progression = 0;
        t.etat = 'attente';
        file.unshift(cle);
      } else {
        try { fs.rmSync(sortie, { force: true }); } catch {}
        t.etat = 'erreur';
        t.erreur = 'Préparation impossible';
        console.warn(`[Téléchargements] échec ${code} : ${err.trim().split('\n').pop()}`);
      }
      suivant();
    });
  }

  /** Place réservée dépassée → on retire les fichiers demandés il y a le plus longtemps. */
  function menage() {
    const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith('.mp4'))
      .map((f) => { const s = fs.statSync(path.join(dossier, f)); return { f, t: s.mtimeMs, taille: s.size }; })
      .sort((a, b) => a.t - b.t);
    let total = fichiers.reduce((n, x) => n + x.taille, 0);
    while (total > maxGo * 1e9 && fichiers.length > 1) {
      const x = fichiers.shift();
      try { fs.rmSync(path.join(dossier, x.f)); total -= x.taille; } catch {}
    }
  }
  menage();

  /** Le fichier préparé, pour quelqu'un qui l'a demandé. */
  function fichier(cle, userId) {
    if (!autorise(cle, userId) || !pret(cle)) return null;
    return chemin(cle);
  }

  const autorise = (cle, userId) => /^[0-9a-f]{24}$/.test(String(cle)) && !!droits.get(cle)?.has(userId);

  return { demander, etat, fichier, autorise, cleDe };
}
