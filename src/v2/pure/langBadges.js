/* Étiquettes de langue (VOSTFR / VO / VA) affichées sur les affiches.
   La carte complète est calculée par le serveur (filtres Plex) et chargée
   UNE fois par session : chaque carte la lit ensuite sans réseau. */

import { useSyncExternalStore } from 'react';
import authService from '../../services/authService';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

let map = null;
let loading = null;
const listeners = new Set();

function emit() { listeners.forEach((l) => l()); }

export function ensureLangBadges() {
  if (map) return Promise.resolve(map);
  if (loading) return loading;
  const token = authService.getToken();
  loading = fetch(`${apiBase()}/api/language-badges`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((r) => (r.ok ? r.json() : { map: {} }))
    .then((d) => {
      map = d.map || {};
      emit();
      // Le serveur reconstruit la carte en fond (premier démarrage) :
      // on repasse une fois quand elle est prête.
      if (d.building) setTimeout(() => { map = null; ensureLangBadges(); }, 12000);
      return map;
    })
    .catch(() => { map = {}; emit(); return map; })
    .finally(() => { loading = null; });
  return loading;
}

function subscribe(cb) {
  listeners.add(cb);
  ensureLangBadges();
  return () => listeners.delete(cb);
}

const snapshot = () => map;

export function useLangBadges() {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** 'VOSTFR' | 'VO' | 'VA' | null pour un identifiant Plex. */
export function langBadgeFor(id) {
  return (map && map[String(id)]) || null;
}

export default { ensureLangBadges, useLangBadges, langBadgeFor };
