import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import plexService from '../../services/plexService';
import favoriteService from '../../services/favoriteService';
import progressService from '../../services/progressService';
import GridPure from './GridPure';

/* Favoris "Pure" — un titre, un compte, une grille. */
export default function FavoritesPure() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [watchedIds, setWatchedIds] = useState(new Set());
  const [camIds, setCamIds] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    window.scrollTo(0, 0);
    (async () => {
      try {
        const [ids, watched] = await Promise.all([
          favoriteService.getFavoriteIds(),
          progressService.getWatchedIds().catch(() => []),
        ]);
        if (on) setWatchedIds(new Set(watched));
        plexService.ensureCamIds().then((s) => on && setCamIds(s)).catch(() => {});
        // en parallèle plutôt qu'en série : la page s'affiche bien plus vite
        const metas = await Promise.all(ids.map((id) => plexService.getMetadata(id).catch(() => null)));
        if (on) setItems(metas.filter(Boolean));
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, []);

  return (
    <div className="min-h-screen px-5 md:px-8 pt-20 md:pt-24 pb-10 max-w-[1400px] mx-auto">
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="p-display text-[28px] md:text-[40px]">Favoris</h1>
        {!loading && <span className="text-[13px] p-faint">{items.length}</span>}
      </div>

      {loading ? (
        <div className="py-24 flex justify-center">
          <div className="w-6 h-6 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
        </div>
      ) : items.length ? (
        <GridPure items={items} watchedIds={watchedIds} camIds={camIds} />
      ) : (
        <div className="py-24 text-center">
          <p className="text-[15px] p-dim mb-1">Aucun favori.</p>
          <p className="text-[13px] p-faint mb-7">Touche le cœur sur une fiche pour l'ajouter ici.</p>
          <button onClick={() => navigate('/')} className="p-btn p-btn-ghost">Parcourir le catalogue</button>
        </div>
      )}
    </div>
  );
}
