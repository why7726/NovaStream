import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Play } from 'lucide-react';
import plexService from '../../services/plexService';
import { isNew } from './catalog';
import { useLangBadges } from './langBadges';

import { tr } from '../../i18n';
/* Carte "Pure" — l'affiche, un coin arrondi, un titre discret.
   Pas de tilt, pas de halo : un simple grossissement de 3,5 % au survol. */
export default function CardPure({
  item,
  variant = 'poster',      // 'poster' (2:3) | 'wide' (16:9)
  width,                   // classes tailwind de largeur
  watched = false,
  progress = 0,            // 0-100
  camIds = null,
  showTitle = true,
  onClick,
}) {
  const navigate = useNavigate();
  const langMap = useLangBadges();
  if (!item) return null;

  const isCam = camIds ? camIds.has(String(item.id)) : plexService.isCamItem?.(item);
  // VOSTFR / VO / VA — rien quand le titre est en français (ou indéterminé)
  const lang = langMap ? langMap[String(item.id)] : null;
  const art = variant === 'wide' ? (item.backdrop || item.poster) : (item.poster || item.backdrop);
  // Une saison s'appelle « Season 1 » chez Plex : on affiche le nom de la série.
  const label = item.grandparentTitle || item.parentTitle || item.title;
  /* Toujours vers la fiche, jamais vers le lecteur : « Nouveautés » renvoie des
     SAISONS (sans fichier vidéo), et les envoyer au lecteur donnait « Lecture
     impossible ». La fiche, elle, redirige proprement vers la série. */
  const go = onClick || (() => navigate(`/title/${item.id}`));

  const w = width || (variant === 'wide' ? 'w-[248px] md:w-[320px]' : 'w-[124px] md:w-[168px]');

  return (
    <button data-card onClick={go} title={label}
      className={`p-card-hit shrink-0 ${w} text-left`}>
      <div className={`p-card ${variant === 'wide' ? 'aspect-video' : 'aspect-[2/3]'}`}>
        {art
          ? <img src={art} alt="" loading="lazy" decoding="async" />
          : <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-white/40">{label}</span>}

        {/* Faits sur le contenu, en haut à gauche : CAM puis la version.
            « Nouveau » ne s'affiche que s'il n'y a rien d'autre à dire. */}
        {(isCam || lang) ? (
          <span className="absolute top-2 left-2 flex flex-col items-start gap-1">
            {isCam && (
              <span className="px-1.5 py-[3px] rounded-md bg-black/55 backdrop-blur-md text-[9px] font-semibold tracking-[0.08em] text-white/85">
                {tr('CAM')}
              </span>
            )}
            {lang && (
              <span className="px-1.5 py-[3px] rounded-md bg-black/55 backdrop-blur-md text-[9px] font-semibold tracking-[0.08em] text-white/85">
                {lang}
              </span>
            )}
          </span>
        ) : isNew(item) && (
          // Ajouté il y a moins de 7 jours — un simple point, pas une pastille criarde
          <span className="absolute top-2 left-2 flex items-center gap-1 text-[9.5px] font-semibold tracking-[0.06em] text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            <span className="w-1.5 h-1.5 rounded-full bg-white" /> {tr('NOUVEAU')}
          </span>
        )}
        {watched && (
          <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center text-white/90">
            <Check size={11} strokeWidth={3} />
          </span>
        )}
        {progress > 0 && progress < 99 && (
          <span className="absolute bottom-0 inset-x-0 h-[3px] bg-white/20">
            <span className="block h-full bg-white" style={{ width: `${progress}%` }} />
          </span>
        )}
        {variant === 'wide' && (
          <span className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            <span className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center">
              <Play size={15} fill="white" className="ml-0.5" />
            </span>
          </span>
        )}
      </div>

      {showTitle && (
        <p className="mt-2 text-[12px] md:text-[12.5px] font-medium text-white/75 truncate px-0.5">{label}</p>
      )}
    </button>
  );
}
