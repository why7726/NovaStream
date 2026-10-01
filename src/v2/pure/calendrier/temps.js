import { tr, locale } from '../../../i18n';
/* Dates du calendrier : le serveur stocke de l'UTC, l'admin lit et saisit
   en heure LOCALE (champ datetime-local du navigateur). */

const deux = (n) => String(n).padStart(2, '0');

/** ISO UTC → « AAAA-MM-JJTHH:MM » local, pour un <input type="datetime-local">. */
export function versChamp(iso, heureParDefaut = null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Date sans heure (TMDB donne minuit UTC) : on garde le JOUR et on pose une heure indicative.
  if (heureParDefaut && /T00:00:00(\.000)?Z$/.test(iso)) {
    return `${iso.slice(0, 10)}T${heureParDefaut}`;
  }
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}T${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** Valeur d'un champ datetime-local (heure locale) → ISO UTC. */
export function depuisChamp(valeur) {
  if (!valeur) return null;
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** « jeu. 02/10 à 17:00 » */
export function lisible(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const jour = d.toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit' });
  return tr('{0} à {1}', [jour, `${deux(d.getHours())}:${deux(d.getMinutes())}`]);
}

/** « dans 3 j », « dans 5 h », « il y a 2 h » */
export function relatif(iso) {
  const ms = Date.parse(iso) - Date.now();
  const abs = Math.abs(ms);
  const h = Math.round(abs / 3600000);
  const j = Math.round(abs / 86400000);
  const txt = abs < 3600000 ? tr('{0} min', [Math.max(1, Math.round(abs / 60000))]) : h < 48 ? tr('{0} h', [h]) : tr('{0} j', [j]);
  return ms >= 0 ? tr('dans {0}', [txt]) : tr('il y a {0}', [txt]);
}

const LANGUES = {
  fr: 'français', en: 'anglais', ja: 'japonais', ko: 'coréen', es: 'espagnol', de: 'allemand',
  it: 'italien', zh: 'chinois', pt: 'portugais', ru: 'russe', hi: 'hindi', th: 'thaï', tr: 'turc',
};

/** Nom d'une langue d'après son code ISO (« ja » → « japonais » / « Japanese »). */
export const nomLangue = (code) => (LANGUES[code] ? tr(LANGUES[code]) : code);
