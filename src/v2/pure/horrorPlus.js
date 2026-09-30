/* « Horreur + » — la sélection tenue à la main côté serveur (horrorPlus.js
   à la racine), chargée UNE fois par session. On ne récupère que des
   identifiants Plex : le catalogue fournit déjà affiches et titres. */

import { useSyncExternalStore } from 'react';
import authService from '../../services/authService';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

export const HORROR_PLUS = 'Horreur +';

let ids = null;              // Map<string, rang> | null tant que rien n'est chargé
let loading = null;
const listeners = new Set();

export function ensureHorrorPlus() {
  if (ids) return Promise.resolve(ids);
  if (loading) return loading;
  const token = authService.getToken();
  loading = fetch(`${apiBase()}/api/horror-plus`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((r) => (r.ok ? r.json() : { ids: [] }))
    .then((d) => {
      // Le serveur renvoie les identifiants DANS L'ORDRE de la sélection :
      // on garde ce rang, c'est lui qui ordonne la rangée.
      ids = new Map((d.ids || []).map((id, i) => [String(id), i]));
      listeners.forEach((l) => l());
      return ids;
    })
    .catch(() => { ids = new Map(); listeners.forEach((l) => l()); return ids; })
    .finally(() => { loading = null; });
  return loading;
}

function subscribe(cb) {
  listeners.add(cb);
  ensureHorrorPlus();
  return () => listeners.delete(cb);
}

export function useHorrorPlus() {
  return useSyncExternalStore(subscribe, () => ids, () => null);
}

export function isHorrorPlus(id) {
  return !!ids && ids.has(String(id));
}

/* Le genre est AJOUTÉ aux items concernés, il ne remplace pas « Horreur » :
   la rangée de sous-catégorie et le filtre Genre se construisent tous les
   deux à partir de `item.genres`, donc ce simple marquage suffit à faire
   apparaître « Horreur + » aux deux endroits.

   On pose aussi `hpRank` : la rangée est coupée à 30 titres, et sans cet
   ordre elle montrerait 30 films au hasard de la bibliothèque plutôt que
   le haut de la sélection. */
export function marquerHorreur(items, rangs) {
  if (!rangs || !rangs.size || !Array.isArray(items)) return items;
  return items.map((it) => {
    if (!it) return it;
    const rang = rangs.get(String(it.id));
    return rang === undefined
      ? it
      : { ...it, hpRank: rang, genres: [...(it.genres || []), HORROR_PLUS] };
  });
}

export default { ensureHorrorPlus, useHorrorPlus, isHorrorPlus, marquerHorreur, HORROR_PLUS };
