/* Les bibliothèques du serveur, telles que l'administrateur les a rangées.
   Le menu, les pages de bibliothèque et la flèche « sortir » d'une fiche
   lisent tous cette même liste (une requête partagée, via plexService). */
import { useEffect, useState, useSyncExternalStore } from 'react';
import plexService from '../../services/plexService';

const EVT = 'nova-libraries';
let version = 0;

/** À appeler après un changement dans les réglages : tout le site se met à jour. */
export function refreshLibraries() {
  plexService.invalidateLibraries();
  version += 1;
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb) {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

const anime = (l) => /anim/i.test(l?.title || '');

/** Type d'affichage d'une bibliothèque : film, série ou animé. */
export function libraryKind(l) {
  if (!l) return null;
  if (l.type === 'movie') return 'movie';
  return anime(l) ? 'anime' : 'show';
}

/**
 * @returns {{ libraries: Array, toutes: Array, loading: boolean }}
 *  libraries — visibles dans le menu ; toutes — y compris masquées.
 */
export function useLibraries() {
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  const [etat, setEtat] = useState({ toutes: [], loading: true });

  useEffect(() => {
    let on = true;
    plexService.getLibraries()
      .then((libs) => { if (on) setEtat({ toutes: libs, loading: false }); })
      .catch(() => { if (on) setEtat({ toutes: [], loading: false }); });
    return () => { on = false; };
  }, [v]);

  return {
    libraries: etat.toutes.filter((l) => !l.masquee),
    toutes: etat.toutes,
    loading: etat.loading,
  };
}
