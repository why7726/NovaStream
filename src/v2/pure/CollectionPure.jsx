import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import GridPure from './GridPure';
import FilterBar from './FilterBar';
import { applyFilters, genresOf, EMPTY } from './filters';
import buildCategories from './categories';
import { getCatalog } from './catalog';
import { ensureHorrorPlus, marquerHorreur } from './horrorPlus';
import useRetour from './useRetour';
import plexService from '../../services/plexService';
import progressService from '../../services/progressService';

import { tr } from '../../i18n';
export const slugify = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/* Page "Voir tout" — la rangée dépliée en grille, avec les mêmes filtres
   que les pages catalogue. Les titres arrivent par l'état de navigation
   quand on vient d'une rangée ; sinon la catégorie est reconstruite. */
export default function CollectionPure() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const retour = useRetour('/');
  const { state } = useLocation();

  const [items, setItems] = useState(() => state?.items || null);
  const [title, setTitle] = useState(state?.title || '');
  const [watchedIds, setWatchedIds] = useState(new Set());
  const [camIds, setCamIds] = useState(null);
  const [filters, setFilters] = useState(EMPTY);

  useEffect(() => {
    let on = true;
    window.scrollTo(0, 0);
    progressService.getWatchedIds().then((w) => on && setWatchedIds(new Set(w))).catch(() => {});
    plexService.ensureCamIds().then((s) => on && setCamIds(s)).catch(() => {});

    // Rechargement direct de l'URL (ou retour arrière) : on refabrique la catégorie.
    if (!state?.items) {
      (async () => {
        // Le genre maison doit être reposé ici : sans lui, un rechargement
        // direct de /collection/horreur-… ne retrouverait pas la rangée.
        const [brut, horreur] = await Promise.all([getCatalog(), ensureHorrorPlus()]);
        const all = marquerHorreur(brut, horreur);
        if (!on) return;
        if (slug === 'tout') {
          setTitle(tr('Tout le catalogue'));
          setItems([...all].sort((a, b) => (a.title || '').localeCompare(b.title || '')));
          return;
        }
        const cats = buildCategories(all, { kind: 'mixed' });
        const match = cats.find((c) => slugify(c.title) === slug);
        setTitle(match?.title || tr('Sélection'));
        setItems(match?.items || all);
      })();
    }
    return () => { on = false; };
  }, [slug]);

  const genres = useMemo(() => genresOf(items || []), [items]);
  const shown = useMemo(() => applyFilters(items || [], filters, watchedIds), [items, filters, watchedIds]);

  return (
    <div className="min-h-screen pt-16 md:pt-20 pb-10 max-w-[1400px] mx-auto">
      <div className="px-5 md:px-8 mb-5 flex items-center gap-3">
        <button onClick={retour} aria-label={tr('Retour')}
          className="w-9 h-9 -ml-1.5 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h1 className="p-display text-[26px] md:text-[38px]">{title}</h1>
      </div>

      {items === null ? (
        <div className="py-24 flex justify-center">
          <div className="w-6 h-6 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <FilterBar genres={genres} value={filters} onChange={setFilters}
            onReset={() => setFilters(EMPTY)} count={shown.length} />
          <div className="px-5 md:px-8">
            {shown.length
              ? <GridPure items={shown} watchedIds={watchedIds} camIds={camIds} />
              : <p className="text-[14px] p-faint py-16 text-center">{tr('Aucun titre avec ces filtres.')}</p>}
          </div>
        </>
      )}
    </div>
  );
}
