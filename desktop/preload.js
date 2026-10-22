/* Passerelle entre la page Nova et l'application (contextIsolation) :
   la page ne voit que ces quelques fonctions, jamais Node ni Electron. */
const { contextBridge, ipcRenderer } = require('electron');

const abonnes = new Set();
ipcRenderer.on('nova:progression', (e, d) => { for (const f of abonnes) { try { f(d); } catch {} } });

contextBridge.exposeInMainWorld('novaDesktop', {
  plateforme: 'windows',
  infos: () => ipcRenderer.invoke('nova:infos'),
  /** Lit un fichier du serveur dans mpv → { position, duree, fini, suivant } à la fermeture. */
  lire: (o) => ipcRenderer.invoke('nova:lire', o),
  arreter: () => ipcRenderer.invoke('nova:arreter'),
  /** Position pendant la lecture (toutes les 5 s) → fonction de désabonnement. */
  surProgression: (f) => { abonnes.add(f); return () => abonnes.delete(f); },
  reglages: (patch) => ipcRenderer.invoke('nova:reglages', patch || null),
  changerServeur: () => ipcRenderer.invoke('nova:changer-serveur'),
  definirServeur: (adresse) => ipcRenderer.invoke('nova:definir-serveur', adresse),
});
