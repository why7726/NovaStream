import React, { useState, useEffect } from 'react';
import authService from '../../services/authService';

import { tr, locale } from '../../i18n';
const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

/* Épisodes annoncés mais pas encore diffusés.

   Plex ne connaît que ce qu'on possède ; TMDB connaît le calendrier. On
   affiche donc la suite de la saison en grisé, avec un décompte : J−9,
   J−2, J−1, puis — le jour même et si Sonarr nous a donné l'heure exacte —
   H−5, puis les minutes. */

const JOURS = 86400000;

function compte(airDate, airTime) {
  if (!airDate && !airTime) return null;

  /* Les jours se comptent en CALENDRIER, pas en durée écoulée — sinon
     « dans cinq jours » affichait J−4 dès 20 h. Le dernier jour, si Sonarr
     nous a donné l'heure exacte de diffusion, on bascule en heures. */
  const minuit = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const cible = airTime ? new Date(airTime) : new Date(`${airDate}T00:00:00`);

  /* Dès qu'on connaît l'heure exacte et qu'il reste moins de 24 h, on
     bascule en heures : à 21 h, un épisode diffusé à 2 h du matin doit
     afficher H−5, pas J−1 (même si le calendrier dit « demain »). */
  if (airTime) {
    const reste = cible.getTime() - Date.now();
    if (reste > 0 && reste < JOURS) {
      const heures = Math.floor(reste / 3600000);
      if (heures >= 1) return { texte: `H−${heures}`, proche: true, exact: true };
      return { texte: tr('{0} min', [Math.max(1, Math.round(reste / 60000))]), proche: true, exact: true };
    }
    if (reste <= 0) return { texte: tr("Aujourd'hui"), proche: true };
  }

  const jours = Math.round((minuit(cible) - minuit(new Date())) / JOURS);
  if (jours > 1) return { texte: `J−${jours}`, proche: jours <= 3 };
  if (jours === 1) return { texte: 'J−1', proche: true };
  return { texte: tr("Aujourd'hui"), proche: true };
}

/* La date se lit sur l'HEURE exacte quand Sonarr nous l'a donnee.
   TMDB stocke la date japonaise : un episode diffuse a 00h30 a Tokyo est
   date du vendredi, alors qu'il sort le jeudi 17h30 en France. Se fier a
   TMDB affichait donc systematiquement un jour de trop. */
function dateLisible(airDate, airTime) {
  const source = airTime ? new Date(airTime) : (airDate ? new Date(`${airDate}T00:00:00`) : null);
  if (!source || Number.isNaN(source.getTime())) return null;
  try {
    return source.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return airDate; }
}

/** Vrai si la diffusion est encore devant nous (fin de journée si on n'a pas l'heure). */
function aVenir(e) {
  if (e.airTime) return new Date(e.airTime).getTime() > Date.now();
  if (!e.airDate) return false;
  return new Date(`${e.airDate}T23:59:59`).getTime() > Date.now();
}

/* Répartition des épisodes manquants en VF, à partir d'UN seul calcul de
   dates — sinon les deux listes finissent par se contredire.

   Chaque épisode absent en français est daté par la sortie japonaise de
   l'épisode `N + retard` : l'ep 2 arrive en VF le jour où l'ep 4 sort en VO.
   Ensuite :
     · date à venir  → « Prochainement en VF », avec décompte ;
     · date passée   → c'est un TROU (un vieil épisode jamais doublé), pas
       une sortie à annoncer. Sans cette distinction, ils s'affichaient
       « Aujourd'hui », ce qui n'avait aucun sens.

   Exportée pour être vérifiable directement, sans passer par le rendu. */
export function repartirVf(eps, { offset = 0, have = null } = {}) {
  if (!Array.isArray(eps) || !eps.length || !have) return { attendus: [], trous: [] };

  const parNumero = new Map(eps.map((e) => [e.number, e]));
  const manquants = eps
    .filter((e) => !have.includes(e.number))
    .map((e) => {
      const source = parNumero.get(e.number + offset);
      return {
        ...e,
        airDate: source ? source.airDate : null,
        airTime: source ? source.airTime : null,
        connu: !!source,
      };
    });

  return {
    attendus: manquants.filter((e) => e.connu && aVenir(e)),
    trous: manquants.filter((e) => e.connu && !aVenir(e)).map((e) => e.number).sort((a, b) => a - b),
  };
}

/** Ce qu'on annonce : en VO les épisodes pas encore diffusés, en VF ce qui manque. */
export function episodesAAnnoncer(eps, { mode = 'vo', offset = 0, have = null } = {}) {
  if (!Array.isArray(eps) || !eps.length) return [];
  if (mode !== 'vf' || !have) return eps.filter((e) => !e.aired);
  return repartirVf(eps, { offset, have }).attendus;
}

/** Épisodes anciens qu'on ne possède pas en français : des trous. */
export function trousVf(eps, have, offset = 0) {
  return repartirVf(eps, { offset, have }).trous;
}

export default function UpcomingEpisodes({ ratingKey, season, fallbackImage, mode = 'vo', offset = 0, have = null }) {
  const [eps, setEps] = useState([]);
  const [, forceTick] = useState(0);

  useEffect(() => {
    let on = true;
    setEps([]);
    if (!ratingKey || !season) return;
    const t = authService.getToken();
    fetch(`${apiBase()}/api/upcoming/${ratingKey}?season=${season}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    })
      .then((r) => r.json())
      .then((d) => { if (on) setEps(d.episodes || []); })
      .catch(() => {});
    return () => { on = false; };
  }, [ratingKey, season]);

  /* Un décompte en jours ne bouge qu'à minuit ; un décompte en heures, lui,
     doit rester juste. On accélère donc le rafraîchissement le jour J. */
  useEffect(() => {
    if (!eps.length) return;
    const bientot = eps.some((e) => e.airTime && !e.aired && new Date(e.airTime).getTime() - Date.now() < JOURS);
    const iv = setInterval(() => forceTick((n) => n + 1), bientot ? 60000 : 3600000);
    return () => clearInterval(iv);
  }, [eps]);

  const vfInfo = mode === 'vf' && have ? repartirVf(eps, { offset, have }) : null;
  const attendus = vfInfo ? vfInfo.attendus : eps.filter((e) => !e.aired);
  const trous = vfInfo ? vfInfo.trous : [];
  if (!attendus.length && !trous.length) return null;

  return (
    <div className="mt-7">
      <p className="p-label mb-3">
        {mode === 'vf' ? (attendus.length ? tr('Prochainement en VF') : 'En VF') : tr('Prochainement')}
        {mode === 'vf' && offset > 0 && (
          <span className="ml-2 normal-case tracking-normal text-white/30">
            la VF a {offset} {tr('épisode')}{offset > 1 ? 's' : ''} {tr('de retard')}
          </span>
        )}
      </p>

      {trous.length > 0 && (
        <p className="text-[12px] p-faint pb-3 -mt-1">
          {trous.length === 1
            ? tr('L\'épisode {0} n\'est pas disponible en VF.', [trous[0]])
            : tr('Épisodes indisponibles en VF : {0}.', [trous.join(', ')])}
        </p>
      )}

      {attendus.map((e) => {
        const c = compte(e.airDate, e.airTime);
        return (
          <div key={e.number} className="w-full flex gap-3.5 md:gap-4 py-3.5 p-hair">
            <div className="p-card w-[122px] md:w-[158px] aspect-video shrink-0 opacity-40 grayscale">
              {(e.still || fallbackImage) && <img src={e.still || fallbackImage} alt="" loading="lazy" decoding="async" />}
            </div>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-start gap-2">
                <p className="text-[14px] font-medium text-white/55 truncate flex-1">
                  {e.number}. {e.title}
                </p>
                {c && (
                  <span className={`shrink-0 px-2 py-[3px] rounded-md text-[11px] font-semibold tabular-nums ${
                    c.proche ? 'bg-white text-black' : 'bg-white/[0.10] text-white/75'
                  }`}>
                    {c.texte}
                  </span>
                )}
              </div>

              {(e.airDate || e.airTime) && (
                <p className="text-[11.5px] p-faint mt-1 first-letter:uppercase">
                  {dateLisible(e.airDate, e.airTime)}
                  {e.airTime && ` · ${new Date(e.airTime).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              )}
              {e.overview && (
                <p className="text-[12.5px] text-white/30 leading-snug line-clamp-2 mt-1">{e.overview}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
