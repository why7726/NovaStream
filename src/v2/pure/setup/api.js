import authService from '../../../services/authService';

import { tr } from '../../../i18n';
const base = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

/** Appel JSON authentifié ; lève une Error avec le message du serveur. */
export async function api(chemin, { method = 'GET', body } = {}) {
  const t = authService.getToken();
  const r = await fetch(`${base()}${chemin}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || tr('Erreur {0}', [r.status]));
  return d;
}

/** Prévient App qu'il doit relire l'état d'installation (serveur relié…). */
export function signalerInstallation() {
  window.dispatchEvent(new Event('nova-setup'));
}
