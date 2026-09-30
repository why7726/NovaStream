/* Fonctions optionnelles actives sur ce serveur (clés API renseignées ou non).
   Une seule requête pour tout le site ; `refreshFeatures()` après un
   enregistrement dans les réglages. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import authService from '../../services/authService';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');
const EVT = 'nova-features';
let promesse = null;
let version = 0;

export function fetchFeatures() {
  if (promesse) return promesse;
  const t = authService.getToken();
  promesse = fetch(`${apiBase()}/api/features`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  promesse.then((f) => { if (!f || !Object.keys(f).length) promesse = null; });
  return promesse;
}

export function refreshFeatures() {
  promesse = null;
  version += 1;
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb) {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

/** null tant que la réponse n'est pas arrivée, puis { tmdb, soustitres, assistant, … } */
export function useFeatures() {
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  const [f, setF] = useState(null);
  useEffect(() => {
    let on = true;
    fetchFeatures().then((x) => { if (on) setF(x); });
    return () => { on = false; };
  }, [v]);
  return f;
}
