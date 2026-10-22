/* ══════════════════════════════════════════════════════════════════
   Lecteur natif — mpv piloté par son interface JSON (tube nommé)

   Nova (la page web) demande une lecture ; on lance mpv sur le FICHIER
   d'origine, servi tel quel par le serveur Nova : aucun transcodage. mpv
   décode tout lui-même (AV1, HEVC, HDR, DTS, TrueHD, sous-titres ASS),
   avec la carte graphique.

   Pendant la lecture, mpv nous envoie la position ; on la relaie à la page,
   qui l'enregistre comme le lecteur web (reprise, historique, « Reprendre »).
   ══════════════════════════════════════════════════════════════════ */
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

let compteur = 0;
let enCours = null;   // { process, tube } — une seule lecture à la fois

function cheminMpv(dossierRessources) {
  const candidats = [
    path.join(dossierRessources, 'mpv', 'mpv.exe'),                // application installée
    path.join(__dirname, 'vendor', 'mpv', 'mpv.exe'),              // développement
  ];
  return candidats.find((c) => fs.existsSync(c)) || null;
}

function dossierConfig(dossierRessources) {
  const candidats = [path.join(dossierRessources, 'mpv-config'), path.join(__dirname, 'mpv-config')];
  return candidats.find((c) => fs.existsSync(c));
}

/** Une option de piste mpv : numéro (1, 2…), 'no' ou 'auto'. */
const piste = (v) => (v === 'no' || v === 'auto' ? v : Number.isInteger(v) && v > 0 && v < 100 ? String(v) : 'auto');

/**
 * @param o { url, jeton, titre, debut, aid, sid, sousTitres: [url], pleinEcran, ecran: {x,y} }
 * @param surEvenement (nom, donnees) — 'progression' { position, duree, pause }
 * @returns Promise<{ position, duree, fini, suivant }>
 */
function lire(o, { dossierRessources, surEvenement }) {
  const mpv = cheminMpv(dossierRessources);
  if (!mpv) return Promise.reject(new Error('mpv est introuvable dans l\'application'));
  arreter();

  const tube = `\\\\.\\pipe\\novastream-mpv-${process.pid}-${++compteur}`;
  const args = [
    `--config-dir=${dossierConfig(dossierRessources)}`,
    `--input-ipc-server=${tube}`,
    // mpv démarre SANS fichier : le jeton de session lui est donné par le
    // tube (jamais en ligne de commande, que tout programme du PC peut lire,
    // ni dans l'adresse), puis on charge le fichier. Il quitte à la fin.
    '--idle=once',
    '--force-window=yes',
    `--force-media-title=${o.titre || 'NovaStream'}`,
    `--title=${o.titre ? `${o.titre} — NovaStream` : 'NovaStream'}`,
    `--aid=${piste(o.aid)}`,
    `--sid=${piste(o.sid)}`,
  ];
  if (o.debut > 0) args.push(`--start=${Math.floor(o.debut)}`);
  // Tests automatiques : fenêtre réduite et muette, jamais par-dessus l'écran de quelqu'un.
  const test = !!process.env.NOVA_MPV_TEST;
  if (test) args.push('--window-minimized=yes', '--mute=yes');
  else if (o.pleinEcran !== false) args.push('--fs');
  // S'ouvrir sur le même écran que la fenêtre Nova
  if (o.ecran && Number.isFinite(o.ecran.x) && Number.isFinite(o.ecran.y)) args.push(`--geometry=+${Math.round(o.ecran.x)}+${Math.round(o.ecran.y)}`);
  for (const s of o.sousTitres || []) args.push(`--sub-file=${s}`);

  const p = spawn(mpv, args, { windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] });
  let erreurs = '';
  p.stderr.on('data', (d) => { erreurs = (erreurs + d).slice(-4000); });

  const etat = { position: o.debut || 0, duree: 0, pause: false, fini: false, suivant: false, charge: false };
  enCours = { process: p, tube };

  // Connexion au tube : mpv le crée quelques instants après son démarrage.
  let client = null;
  let tampon = '';
  const envoyer = (commande) => { try { client?.write(JSON.stringify({ command: commande }) + '\n'); } catch { /* mpv fermé */ } };
  const connecter = (essai = 0) => {
    if (p.exitCode !== null) return;
    const c = net.connect(tube);
    c.on('connect', () => {
      client = c;
      envoyer(['set_property', 'http-header-fields', [`Authorization: Bearer ${o.jeton}`]]);
      envoyer(['loadfile', o.url, 'replace']);
      if (test && process.env.NOVA_MPV_TEST_CAPTURE) {
        setTimeout(() => envoyer(['screenshot-to-file', process.env.NOVA_MPV_TEST_CAPTURE, 'video']), 9000);
      }
      envoyer(['observe_property', 1, 'time-pos']);
      envoyer(['observe_property', 2, 'duration']);
      envoyer(['observe_property', 3, 'pause']);
      envoyer(['observe_property', 4, 'eof-reached']);
    });
    c.on('data', (d) => {
      tampon += d;
      let i;
      while ((i = tampon.indexOf('\n')) >= 0) {
        const ligne = tampon.slice(0, i); tampon = tampon.slice(i + 1);
        let m; try { m = JSON.parse(ligne); } catch { continue; }
        if (m.event === 'property-change') {
          if (m.name === 'time-pos' && typeof m.data === 'number') etat.position = m.data;
          else if (m.name === 'duration' && typeof m.data === 'number') etat.duree = m.data;
          else if (m.name === 'pause') etat.pause = !!m.data;
          else if (m.name === 'eof-reached' && m.data === true) etat.fini = true;
        } else if (m.event === 'file-loaded') etat.charge = true;
        else if (m.event === 'end-file' && m.reason === 'eof') etat.fini = true;
        else if (m.event === 'end-file' && m.reason === 'error') erreurs += `\nFailed to open: ${m.file_error || 'erreur'}`;
        else if (m.event === 'client-message' && Array.isArray(m.args) && m.args[0] === 'nova-suivant') {
          etat.suivant = true;
          envoyer(['quit']);
        }
      }
    });
    c.on('error', () => { if (!client && essai < 50) setTimeout(() => connecter(essai + 1), 100); });
  };
  setTimeout(connecter, 100);
  // Sans tube au bout de 8 s, mpv ne recevra jamais le fichier : on abandonne.
  const garde = setTimeout(() => { if (!client) { erreurs += '\nPilotage de mpv impossible'; try { p.kill(); } catch {} } }, 8000);

  // La page reçoit la position toutes les 5 s (elle l'enregistre toutes les 10 s).
  const minuteur = setInterval(() => {
    if (etat.duree > 0) surEvenement('progression', { position: etat.position, duree: etat.duree, pause: etat.pause });
  }, 5000);

  return new Promise((resolve, reject) => {
    p.on('error', (e) => { clearInterval(minuteur); clearTimeout(garde); enCours = null; reject(e); });
    p.on('exit', (code) => {
      clearTimeout(garde);
      clearInterval(minuteur);
      try { client?.destroy(); } catch {}
      if (enCours?.process === p) enCours = null;
      // Fin « naturelle » : mpv ne signale pas toujours eof-reached avant de quitter.
      if (!etat.fini && etat.duree > 0 && etat.position >= etat.duree - 3) etat.fini = true;
      // Fichier jamais ouvert (adresse refusée, réseau…) : c'est une erreur,
      // pas « l'utilisateur a fermé ».
      if (!etat.charge && !arretDemande(p)) {
        const raison = (erreurs.match(/(HTTP error \d+|Failed to open[^\n]*|No such file[^\n]*|Pilotage de mpv impossible)/) || [])[1];
        return reject(new Error(raison ? `Lecture impossible : ${raison}` : 'Lecture impossible'));
      }
      resolve({ position: etat.position, duree: etat.duree, fini: etat.fini, suivant: etat.suivant });
    });
  });
}

// Processus arrêtés exprès (bouton « Arrêter », nouvelle lecture) : pas une erreur.
const arretes = new WeakSet();
const arretDemande = (p) => arretes.has(p);

function arreter() {
  if (!enCours) return;
  arretes.add(enCours.process);
  try { enCours.process.kill(); } catch {}
  enCours = null;
}

module.exports = { lire, arreter, cheminMpv };
