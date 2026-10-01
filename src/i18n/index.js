/* ══════════════════════════════════════════════════════════════════
   Langue de l'interface — français (langue du code) ou anglais

   Le texte FRANÇAIS sert de clé : tr('Reprendre') renvoie « Reprendre »
   en français, et la traduction de en.js en anglais. Une traduction
   manquante n'est jamais un trou : on affiche le français.

   Variables : tr('{0} min restantes', [12]) ou tr('Bonjour {nom}', { nom }).
   (Nommée « tr » et pas « t » : beaucoup de fichiers appellent déjà 
   « t » le jeton de connexion.)

   La langue :
   · d'un compte = sa préférence (enregistrée sur le serveur, elle suit
     la personne sur tous ses appareils) ;
   · avant connexion = celle du navigateur.
   Elle est aussi posée dans un cookie pour que le serveur traduise ses
   propres messages (erreurs, tests de réglages…).

   Changer de langue remonte toute l'interface (voir App.jsx) : un simple
   appel à tr() suffit donc partout, même hors composant React.
   ══════════════════════════════════════════════════════════════════ */
import { useSyncExternalStore } from 'react';
import en from './en';

export const LANGUES = ['fr', 'en'];
const CLE = 'nova_langue';
const EVT = 'nova-langue';

function deviner() {
  try {
    const l = localStorage.getItem(CLE);
    if (LANGUES.includes(l)) return l;
  } catch { /* mode privé */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'fr';
  return /^fr/i.test(nav) ? 'fr' : 'en';
}

let langue = deviner();
poserCookie(langue);

function poserCookie(l) {
  try { document.cookie = `${CLE}=${l}; path=/; max-age=31536000; SameSite=Lax`; } catch { /* hors navigateur */ }
}

export const langueActuelle = () => langue;
/** Locale pour Intl / toLocaleDateString. */
export const locale = () => (langue === 'en' ? 'en-US' : 'fr-FR');

/** Change la langue de l'interface (sans l'enregistrer sur le compte). */
export function setLangue(l) {
  if (!LANGUES.includes(l) || l === langue) return;
  langue = l;
  try { localStorage.setItem(CLE, l); } catch { /* mode privé */ }
  poserCookie(l);
  document.documentElement.lang = l;
  window.dispatchEvent(new Event(EVT));
}

export function tr(texte, vars) {
  if (texte == null) return texte;
  let s = langue === 'en' ? (en[texte] ?? texte) : texte;
  if (vars != null) {
    s = s.replace(/\{(\w+)\}/g, (m, k) => {
      const v = Array.isArray(vars) ? vars[Number(k)] : vars[k];
      return v === undefined || v === null ? m : String(v);
    });
  }
  return s;
}

function abonner(cb) {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

/** La langue courante, en déclenchant un nouveau rendu quand elle change. */
export function useLangue() {
  return useSyncExternalStore(abonner, langueActuelle, () => 'fr');
}

if (typeof document !== 'undefined') document.documentElement.lang = langue;

/* La langue « au chargement de la page » : certains textes sont calculés une
   seule fois, à l'import d'un module. Quand la langue choisie diffère de
   celle-ci, on recharge la page pour que TOUT soit dans la bonne langue. */
const langueAuChargement = langue;

/** Applique une langue (préférence du compte, choix dans les réglages). */
export function appliquerLangue(l) {
  if (!LANGUES.includes(l)) return;
  setLangue(l);
  if (l !== langueAuChargement) window.location.reload();
}
