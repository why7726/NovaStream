import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Check } from 'lucide-react';
import progressService from '../../services/progressService';

import { tr, locale } from '../../i18n';
/* Historique "Pure" — une liste verticale, façon iOS : vignette, titre,
   progression en une ligne. Plus lisible qu'une grille d'affiches. */
export default function HistoryPure() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.scrollTo(0, 0);
    progressService.getHistory().then(setItems).finally(() => setLoading(false));
  }, []);

  const day = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
  };

  return (
    <div className="min-h-screen px-5 md:px-8 pt-20 md:pt-24 pb-10 max-w-[900px] mx-auto">
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="p-display text-[28px] md:text-[40px]">{tr('Historique')}</h1>
        {!loading && <span className="text-[13px] p-faint">{items.length}</span>}
      </div>

      {loading ? (
        <div className="py-24 flex justify-center">
          <div className="w-6 h-6 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
        </div>
      ) : items.length ? (
        <div>
          {items.map((it) => {
            const pct = it.duration > 0 ? Math.min((it.currentTime / it.duration) * 100, 100) : 0;
            return (
              <button key={it.mediaId} onClick={() => navigate(`/play/${it.mediaId}`)}
                className="w-full flex items-center gap-3.5 py-3 p-hair text-left group/h">
                <div className="p-card w-[54px] md:w-[64px] aspect-[2/3] shrink-0">
                  {it.mediaPoster
                    ? <img src={it.mediaPoster} alt="" loading="lazy" decoding="async" />
                    : <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/40 p-1 text-center">{it.mediaTitle}</span>}
                  <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/h:opacity-100 transition-opacity bg-black/25">
                    <Play size={15} fill="white" />
                  </span>
                  {!it.completed && pct > 0 && (
                    <span className="absolute bottom-0 inset-x-0 h-[3px] bg-white/20">
                      <span className="block h-full bg-white" style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium truncate">{it.mediaTitle}</p>
                  <p className="text-[12px] p-faint mt-0.5 flex items-center gap-1.5">
                    {it.completed
                      ? <><Check size={12} strokeWidth={3} /> {tr('Terminé')}</>
                      : tr('Vu à {0} %', [Math.round(pct)])}
                    <span className="opacity-50">·</span> {day(it.updatedAt)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="py-24 text-center">
          <p className="text-[15px] p-dim mb-1">{tr('Rien pour l\'instant.')}</p>
          <p className="text-[13px] p-faint mb-7">{tr('Lance un film : il apparaîtra ici avec sa progression.')}</p>
          <button onClick={() => navigate('/')} className="p-btn p-btn-ghost">{tr('Parcourir le catalogue')}</button>
        </div>
      )}
    </div>
  );
}
