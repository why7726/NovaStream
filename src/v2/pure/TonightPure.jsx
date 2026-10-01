import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, RefreshCw, Play } from 'lucide-react';
import { getCatalog } from './catalog';
import useRetour from './useRetour';
import plexService from '../../services/plexService';
import progressService from '../../services/progressService';

import { tr } from '../../i18n';
/* "Ce soir" — on ne demande qu'une chose : combien de temps tu as.
   Puis on propose TROIS titres, pas trois cents. Le choix est pondéré par
   les genres que tu regardes le plus, et n'affiche que du non-vu. */

const SLOTS = [
  { id: 'short', label: tr('Une heure et demie'), hint: tr('moins de 1 h 35'), max: 95 },
  { id: 'mid', label: tr('Une soirée normale'), hint: '1 h 35 – 2 h 25', min: 95, max: 145 },
  { id: 'long', label: tr('Tout mon temps'), hint: tr('plus de 2 h 25'), min: 145 },
];

const num = (r) => {
  const m = String(r || '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
};

export default function TonightPure() {
  const navigate = useNavigate();
  const retour = useRetour('/');
  const [slot, setSlot] = useState(null);
  const [items, setItems] = useState([]);
  const [watched, setWatched] = useState(new Set());
  const [tasteGenres, setTasteGenres] = useState(new Map());
  const [seed, setSeed] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    window.scrollTo(0, 0);
    (async () => {
      try {
        const [all, watchedIds, history] = await Promise.all([
          getCatalog(),
          progressService.getWatchedIds().catch(() => []),
          progressService.getHistory().catch(() => []),
        ]);
        if (!on) return;
        setItems(all);
        const w = new Set(watchedIds);
        setWatched(w);

        // Goût = genres des titres déjà regardés, pondérés par leur fréquence.
        const byId = new Map(all.map((it) => [it.id, it]));
        const taste = new Map();
        [...history.map((h) => h.mediaId), ...watchedIds].forEach((id) => {
          const it = byId.get(String(id)) || byId.get(id);
          (it?.genres || []).forEach((g) => taste.set(g, (taste.get(g) || 0) + 1));
        });
        setTasteGenres(taste);
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, []);

  const picks = useMemo(() => {
    if (!slot) return [];
    const s = SLOTS.find((x) => x.id === slot);
    const maxTaste = Math.max(1, ...tasteGenres.values());

    const pool = items
      .filter((it) => it.type === 'movie')
      .filter((it) => !watched.has(it.id))
      .filter((it) => {
        const min = (it.rawDuration || 0) / 60000;
        if (!min) return false;
        if (s.min && min < s.min) return false;
        if (s.max && min >= s.max) return false;
        return true;
      })
      .map((it) => {
        const affinity = (it.genres || []).reduce((acc, g) => acc + (tasteGenres.get(g) || 0), 0) / maxTaste;
        // un peu de hasard, sinon on retomberait toujours sur les mêmes
        const luck = ((parseInt(it.id, 10) * 9301 + seed * 49297) % 233280) / 233280;
        return { it, score: num(it.rating) * 0.5 + affinity * 3 + luck * 2.5 };
      })
      .sort((a, b) => b.score - a.score);

    const out = [];
    const usedGenres = new Set();
    for (const { it } of pool) {
      // on évite trois fois le même genre : trois propositions différentes
      const g = (it.genres || [])[0];
      if (g && usedGenres.has(g) && out.length < 3 && pool.length > 12) continue;
      if (g) usedGenres.add(g);
      out.push(it);
      if (out.length === 3) break;
    }
    return out;
  }, [slot, items, watched, tasteGenres, seed]);

  const why = (it) => {
    const g = (it.genres || []).find((x) => tasteGenres.get(x));
    if (g) return tr('Parce que tu regardes du {0}', [g.toLowerCase()]);
    if (num(it.rating) >= 7.5) return tr('Très bien noté · {0}', [it.rating]);
    return it.year ? tr('Sorti en {0}', [it.year]) : tr('Jamais vu');
  };

  return (
    <div className="min-h-screen pt-16 md:pt-20 pb-16 max-w-[1000px] mx-auto px-5 md:px-8">
      <div className="flex items-center gap-3 mb-8">
        <button onClick={retour} aria-label={tr('Retour')}
          className="w-9 h-9 -ml-1.5 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h1 className="p-display text-[26px] md:text-[38px]">{tr('Ce soir')}</h1>
      </div>

      {loading ? (
        <div className="py-24 flex justify-center">
          <div className="w-6 h-6 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <p className="text-[15px] p-dim mb-5">{tr('Tu as combien de temps ?')}</p>
          <div className="flex flex-col sm:flex-row gap-2.5 mb-12">
            {SLOTS.map((s) => (
              <button key={s.id} onClick={() => { setSlot(s.id); setSeed((n) => n + 1); }}
                className={`flex-1 text-left px-5 py-4 rounded-2xl transition-colors ${
                  slot === s.id ? 'bg-white text-black' : 'bg-white/[0.06] hover:bg-white/[0.11]'
                }`}>
                <p className="text-[15px] font-semibold">{s.label}</p>
                <p className={`text-[12.5px] mt-0.5 ${slot === s.id ? 'text-black/55' : 'text-white/40'}`}>{s.hint}</p>
              </button>
            ))}
          </div>

          {slot && (
            <>
              {picks.length === 0 ? (
                <p className="text-[14px] p-faint py-12 text-center">{tr('Rien de non-vu dans cette durée.')}</p>
              ) : (
                <div className="space-y-3.5">
                  {picks.map((it) => (
                    <div key={it.id} className="flex items-center gap-4 p-3 rounded-2xl bg-white/[0.04]">
                      <button onClick={() => navigate(`/title/${it.id}`)} className="p-card w-[74px] md:w-[92px] aspect-[2/3] shrink-0">
                        {it.poster && <img src={it.poster} alt="" loading="lazy" decoding="async" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-semibold truncate">{it.title}</p>
                        <p className="text-[12.5px] p-dim mt-0.5">
                          {[it.year, it.duration, (it.genres || [])[0]].filter(Boolean).join('  ·  ')}
                        </p>
                        <p className="text-[12px] p-faint mt-1.5">{why(it)}</p>
                      </div>
                      <button onClick={() => navigate(`/play/${it.id}`)} aria-label={tr('Lecture')}
                        className="p-icon-btn shrink-0">
                        <Play size={17} fill="currentColor" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setSeed((n) => n + 1)}
                className="mt-7 mx-auto flex items-center gap-2 text-[13.5px] text-white/50 hover:text-white transition-colors">
                <RefreshCw size={14} /> {tr('Trois autres')}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
