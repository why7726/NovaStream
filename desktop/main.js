/* ══════════════════════════════════════════════════════════════════
   NovaStream pour Windows

   Une fenêtre qui affiche Nova (l'interface web du serveur choisi), et un
   lecteur natif (mpv) pour la vidéo. La page web détecte l'application
   grâce à `window.novaDesktop` (voir preload.js) et lui confie la lecture.

   Premier lancement : on demande l'adresse du serveur (accueil.html).
   ══════════════════════════════════════════════════════════════════ */
const { app, BrowserWindow, ipcMain, shell, Menu, screen, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const lecteur = require('./lecteur');

const RESSOURCES = app.isPackaged ? process.resourcesPath : __dirname;
const FICHIER_CONFIG = () => path.join(app.getPath('userData'), 'config.json');

function lireConfig() {
  try { return JSON.parse(fs.readFileSync(FICHIER_CONFIG(), 'utf8')); } catch { return {}; }
}
function ecrireConfig(patch) {
  const c = { ...lireConfig(), ...patch };
  fs.mkdirSync(path.dirname(FICHIER_CONFIG()), { recursive: true });
  fs.writeFileSync(FICHIER_CONFIG(), JSON.stringify(c, null, 2));
  return c;
}

/** « novastream.exemple.fr » → « https://novastream.exemple.fr » ; sans chemin ni barre finale. */
function normaliserAdresse(saisie) {
  let s = String(saisie || '').trim();
  if (!s) throw new Error('Adresse vide');
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|192\.168\.|10\.|\[)/.test(s) ? 'http://' : 'https://') + s;
  const u = new URL(s);
  return u.origin;
}

let fenetre = null;
const origineServeur = () => lireConfig().serveur || null;

function creerFenetre() {
  const c = lireConfig();
  const b = c.fenetre || {};
  fenetre = new BrowserWindow({
    width: b.width || 1440, height: b.height || 900, x: b.x, y: b.y,
    minWidth: 960, minHeight: 600,
    backgroundColor: '#060606',
    title: 'NovaStream',
    icon: path.join(__dirname, 'icone.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (b.maximise) fenetre.maximize();
  fenetre.once('ready-to-show', () => fenetre.show());

  // Taille et position retenues d'une fois sur l'autre
  const retenir = () => {
    if (!fenetre || fenetre.isDestroyed() || fenetre.isFullScreen()) return;
    ecrireConfig({ fenetre: { ...(fenetre.isMaximized() ? (lireConfig().fenetre || {}) : fenetre.getBounds()), maximise: fenetre.isMaximized() } });
  };
  fenetre.on('close', retenir);

  // Tout lien qui sort du serveur Nova s'ouvre dans le navigateur.
  const wc = fenetre.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    const srv = origineServeur();
    if (url.startsWith('file:')) return;
    if (!srv || new URL(url).origin !== srv) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  // Serveur injoignable : retour à l'écran d'accueil, avec le message.
  wc.on('did-fail-load', (e, code, description, url, principal) => {
    if (!principal || code === -3) return;   // -3 = navigation annulée
    ouvrirAccueil(`Le serveur ne répond pas (${description}).`);
  });

  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { fenetre.setFullScreen(!fenetre.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F5') { wc.reload(); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') { wc.toggleDevTools(); e.preventDefault(); }
  });

  if (origineServeur()) fenetre.loadURL(origineServeur() + '/');
  else ouvrirAccueil();
}

function ouvrirAccueil(message) {
  fenetre.loadFile(path.join(__dirname, 'accueil.html'), { query: { message: message || '', serveur: origineServeur() || '' } });
}

/* ── Menu (touche Alt) ── */
function construireMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'NovaStream',
      submenu: [
        { label: 'Accueil', click: () => origineServeur() && fenetre.loadURL(origineServeur() + '/') },
        { label: 'Changer de serveur…', click: () => ouvrirAccueil() },
        { type: 'separator' },
        { label: 'Recharger', accelerator: 'F5', click: () => fenetre.webContents.reload() },
        { label: 'Plein écran', accelerator: 'F11', click: () => fenetre.setFullScreen(!fenetre.isFullScreen()) },
        { label: 'Outils de développement', accelerator: 'Ctrl+Shift+I', click: () => fenetre.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: `Version ${app.getVersion()}`, enabled: false },
        { label: 'Quitter', role: 'quit' },
      ],
    },
  ]));
}

/* ── Passerelle avec la page ── */

// Seule la page du serveur choisi (ou l'écran d'accueil local) peut parler à l'application.
function depuisServeur(e) {
  const srv = origineServeur();
  try { return !!srv && new URL(e.senderFrame.url).origin === srv; } catch { return false; }
}
function depuisAccueil(e) {
  try { return new URL(e.senderFrame.url).protocol === 'file:'; } catch { return false; }
}

ipcMain.handle('nova:infos', () => ({ version: app.getVersion(), mpv: !!lecteur.cheminMpv(RESSOURCES), serveur: origineServeur() }));

ipcMain.handle('nova:definir-serveur', async (e, saisie) => {
  if (!depuisAccueil(e)) throw new Error('Refusé');
  const origine = normaliserAdresse(saisie);
  // Est-ce bien un serveur Nova ? Son manifeste porte le nom « NovaStream ».
  let ok = false;
  try {
    const r = await fetch(`${origine}/manifest.webmanifest`, { signal: AbortSignal.timeout(8000) });
    ok = r.ok && /novastream/i.test((await r.json()).name || '');
  } catch (err) {
    throw new Error(`Aucune réponse de ${origine} — vérifie l'adresse et que le serveur est allumé.`);
  }
  if (!ok) throw new Error(`${origine} répond, mais ce n'est pas un serveur NovaStream.`);
  ecrireConfig({ serveur: origine });
  fenetre.loadURL(origine + '/');
  return origine;
});

ipcMain.handle('nova:lire', async (e, o) => {
  if (!depuisServeur(e)) throw new Error('Refusé');
  const srv = origineServeur();
  // On ne lit que des fichiers du serveur Nova choisi.
  const surServeur = (u) => { try { return new URL(u).origin === srv; } catch { return false; } };
  if (!o || !surServeur(o.url) || typeof o.jeton !== 'string' || o.jeton.length > 4096) throw new Error('Lecture refusée');
  const sousTitres = (Array.isArray(o.sousTitres) ? o.sousTitres : []).filter(surServeur).slice(0, 20);
  const bornes = fenetre.getBounds();
  const pleinEcran = lireConfig().pleinEcran !== false;
  try {
    return await lecteur.lire({
      url: o.url, jeton: o.jeton, titre: String(o.titre || '').slice(0, 300),
      debut: Number(o.debut) || 0, aid: o.aid, sid: o.sid, sousTitres, pleinEcran,
      ecran: { x: bornes.x + 40, y: bornes.y + 40 },
    }, {
      dossierRessources: RESSOURCES,
      surEvenement: (nom, donnees) => { if (!e.sender.isDestroyed()) e.sender.send(`nova:${nom}`, donnees); },
    });
  } finally {
    if (fenetre && !fenetre.isDestroyed()) { fenetre.show(); fenetre.focus(); }
  }
});

ipcMain.handle('nova:arreter', (e) => { if (depuisServeur(e)) lecteur.arreter(); });

ipcMain.handle('nova:reglages', (e, patch) => {
  if (!depuisServeur(e) && !depuisAccueil(e)) throw new Error('Refusé');
  if (patch && typeof patch.pleinEcran === 'boolean') ecrireConfig({ pleinEcran: patch.pleinEcran });
  const c = lireConfig();
  return { pleinEcran: c.pleinEcran !== false };
});

ipcMain.handle('nova:changer-serveur', (e) => { if (depuisServeur(e)) ouvrirAccueil(); });

/* ── Démarrage ── */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); } });
  app.whenReady().then(() => {
    app.setAppUserModelId('io.github.why7726.novastream');
    construireMenu();
    creerFenetre();
    if (!lecteur.cheminMpv(RESSOURCES)) {
      dialog.showMessageBox({ type: 'warning', title: 'NovaStream', message: 'Le lecteur natif (mpv) est absent : la lecture se fera dans la fenêtre, comme sur le site.' });
    }
  });
  app.on('before-quit', () => lecteur.arreter());
  app.on('window-all-closed', () => app.quit());
}
