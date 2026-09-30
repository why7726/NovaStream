import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, X } from 'lucide-react';
import HeroPure from './HeroPure';
import RowPure from './RowPure';
import CardPure from './CardPure';
import buildCategories from './categories';
import FilterBar from './FilterBar';
import GridPure from './GridPure';
import VibePure from './VibePure';
import { applyFilters, genresOf, isFiltered, EMPTY } from './filters';
import { useHorrorPlus, marquerHorreur } from './horrorPlus';
import plexService from '../../services/plexService';
import progressService from '../../services/progressService';
import authService from '../../services/authService';
import { CREDITS } from '../../credits';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

/* Accueil "Pure" — Steve Jobs edition : un hero, ce qu'on reprend,
   le top 10, puis des sous-catégories à l'infini (genres, décennies,
   durées, notes) calculées à partir du catalogue déjà chargé. */

const cache = {};
const FIRST_ROWS = 5;   // rangées affichées d'emblée
const STEP = 3;         // rangées ajoutées à chaque fin de page atteinte

/* section : la bibliothèque affichée (page « Films FR », « Animés »…) ;
   absente → l'accueil, qui mélange films et séries. */
export default function HomePure({ section }) {
  const filter = section ? String(section.key) : null;
  const navigate = useNavigate();
  const [data, setData] = useState({ featured: [], rows: [], top10: [], cw: [], pool: [] });
  const [watchedIds, setWatchedIds] = useState(new Set());
  const [camIds, setCamIds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(FIRST_ROWS);
  const [filters, setFilters] = useState(EMPTY);
  const [pourToi, setPourToi] = useState([]);
  const sentinel = useRef(null);

  useEffect(() => {
    const key = filter || 'home';
    let on = true;
    window.scrollTo(0, 0);
    setShown(FIRST_ROWS);
    setFilters(EMPTY);

    if (cache[key]) { setData(cache[key].data); setWatchedIds(new Set(cache[key].watched)); setLoading(false); }
    else setLoading(true);

    (async () => {
      try {
        const watched = await progressService.getWatchedIds();
        if (on) setWatchedIds(new Set(watched));

        const featuredP = (async () => {
          const f = await plexService.getFeatured(section);
          return Array.isArray(f) ? f : [f];
        })();

        const cwP = progressService.getContinueWatching()
          .then((items) => items.map((it) => ({
            id: it.mediaId, title: it.mediaTitle, type: it.mediaType,
            currentTime: it.currentTime, duration: it.duration,
            /* Le serveur donne le CHEMIN de l'image, jamais une URL toute faite :
               celle mémorisée en base porte un jeton qui expire, d'où les cartes
               noires au bout de quelques heures. On la fabrique donc ici, au bon
               format — la carte est en 16:9. */
            poster: it.thumbPath
              ? plexService.getImageUrl(it.thumbPath, it.imageType || 'still')
              : it.mediaPoster,
            sousTitre: it.sousTitre || null,
            nextUp: !!it.nextUp,
          })))
          .catch(() => []);

        plexService.ensureCamIds().then((s) => { if (on) setCamIds(s); }).catch(() => {});

        /* « Pour toi » : recommandations bâties sur ce qu'on a réellement
           terminé, limitées à ce qui est SUR Nova et pas encore vu — une
           rangée où tout est cliquable, jamais une liste d'envies. */
        if (!filter) {
          const tok = authService.getToken();
          fetch(`${apiBase()}/api/foryou`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
            .then((r) => r.json())
            .then((d) => { if (on) setPourToi(d.results || []); })
            .catch(() => {});
        }

        // L'accueil puise dans les bibliothèques VISIBLES ; une page, dans la sienne.
        const libs = (await plexService.getLibraries()).filter((l) => !l.masquee);
        const useLibs = section ? [section] : libs;

        const rows = [];
        let top10 = [];
        let pool = [];

        if (!filter) {
          const movieLib = libs.find((l) => l.type === 'movie');
          const showLib = libs.find((l) => l.type === 'show' && !/anim/i.test(l.title));
          const [released, recent, movieItems, showItems] = await Promise.all([
            plexService.getRecentlyReleased().catch(() => []),
            plexService.getRecentlyAdded().catch(() => []),
            movieLib ? plexService.getLibraryItems(movieLib.key).catch(() => []) : [],
            showLib ? plexService.getLibraryItems(showLib.key).catch(() => []) : [],
          ]);
          top10 = (released.length ? released : recent).slice(0, 10);
          if (recent.length) rows.push({ title: 'Nouveautés', items: recent.slice(0, 25) });
          pool = [...movieItems, ...showItems];
        } else {
          for (const lib of useLibs) {
            const items = await plexService.getLibraryItems(lib.key).catch(() => []);
            pool = [...pool, ...items];
          }
          top10 = [...pool].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 10);
        }

        let [featured, cw] = await Promise.all([featuredP, cwP]);
        // Rien de récent dans cette bibliothèque : on met en avant ses derniers ajouts.
        if (section && !featured.length) {
          featured = [...pool].filter((it) => it.backdrop).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 5);
        }
        const next = { featured, rows, top10, cw, pool };
        if (on) setData(next);
        cache[key] = { data: next, watched };
      } catch (e) {
        console.error('[HomePure]', e);
      } finally {
        if (on) setLoading(false);
      }
    })();

    return () => { on = false; };
  }, [filter]);

  // Sous-catégories : recalculées seulement quand le catalogue (ou la liste
  // des versions CAM) change — jamais à chaque render.
  const kind = !section ? 'mixed' : section.type === 'movie' ? 'movie' : 'show';

  /* Le genre maison « Horreur + » est posé sur le catalogue avant tout
     calcul : la rangée ET le filtre Genre en découlent tous les deux. */
  const horreurPlus = useHorrorPlus();
  const pool = useMemo(() => marquerHorreur(data.pool, horreurPlus), [data.pool, horreurPlus]);

  /* Les titres de « Pour toi » sont sur Nova : on récupère leur fiche complète
     dans le catalogue déjà chargé (affiche, genres, durée) plutôt que de
     réafficher des données TMDB — la rangée est ainsi identique aux autres. */
  const rangeePourToi = useMemo(() => {
    if (!pourToi.length || !pool.length) return null;
    const parId = new Map(pool.map((it) => [String(it.id), it]));
    const items = pourToi.map((x) => parId.get(String(x.ratingKey))).filter(Boolean);
    return items.length >= 4 ? { title: 'Pour toi', items: items.slice(0, 24) } : null;
  }, [pourToi, pool]);

  const allRows = useMemo(() => {
    const cats = buildCategories(pool, { camIds, kind });
    const tail = pool.length
      ? [{ title: 'Tout le catalogue', items: [...pool].sort((a, b) => (a.title || '').localeCompare(b.title || '')).slice(0, 60) }]
      : [];
    // « Pour toi » juste après les nouveautés : c'est la rangée qu'on regarde.
    return [...data.rows, ...(rangeePourToi ? [rangeePourToi] : []), ...cats, ...tail];
  }, [pool, data.rows, camIds, kind, rangeePourToi]);

  // On dévoile les rangées au fil du scroll : la page reste légère au départ.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= allRows.length) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setShown((n) => Math.min(n + STEP, allRows.length));
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, allRows.length]);

  // Pages catalogue : dès qu'un filtre est posé, les rangées laissent place
  // à une grille unique — on cherche quelque chose de précis, pas à flâner.
  const genres = useMemo(() => genresOf(pool), [pool]);
  const filtering = !!filter && isFiltered(filters);
  const filtered = useMemo(
    () => (filtering ? applyFilters(pool, filters, watchedIds) : []),
    [filtering, pool, filters, watchedIds]
  );

  const retirer = (e, id) => {
    e.stopPropagation();
    progressService.hideFromContinue(id);
    setData((d) => {
      const next = { ...d, cw: d.cw.filter((x) => x.id !== id) };
      const k = filter || 'home';
      if (cache[k]) cache[k].data = next;
      return next;
    });
    // Surtout PAS de setWatchedIds ici : écarter une carte ne veut pas dire
    // qu'on a vu le titre — sinon il partirait aussi des « non vus ».
  };

  if (loading && !data.rows.length) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="pb-4 md:pb-16">
      <HeroPure movies={data.featured} />

      <div className="relative -mt-4 md:-mt-6">
        {/* Filtres — uniquement sur les pages de bibliothèque */}
        {filter && (
          <div className="pt-2">
            <FilterBar genres={genres} value={filters} onChange={setFilters}
              onReset={() => setFilters(EMPTY)} count={filtering ? filtered.length : null} />
          </div>
        )}

        {filtering ? (
          <div className="px-5 md:px-8">
            {filtered.length
              ? <GridPure items={filtered} watchedIds={watchedIds} camIds={camIds} />
              : <p className="text-[14px] p-faint py-16 text-center">Aucun titre avec ces filtres.</p>}
          </div>
        ) : (
        <>
        {/* « Dis-moi ta soirée » — sur l'accueil seulement : c'est ici qu'on
            arrive quand on ne sait pas quoi regarder. */}
        {!filter && (
          <div className="px-5 md:px-8">
            <VibePure />
          </div>
        )}

        {/* Reprendre */}
        {data.cw.length > 0 && (
          <section data-row className="mb-10 md:mb-14">
            <h2 className="p-title text-[17px] md:text-[22px] px-5 md:px-8 mb-3.5 md:mb-4">Reprendre</h2>
            <div className="p-rail p-marge gap-3 md:gap-4 px-5 md:px-8 pb-1">
              {data.cw.map((it) => {
                const pct = it.duration > 0 ? Math.min(100, (it.currentTime / it.duration) * 100) : 0;
                const left = it.duration > 0 ? Math.max(0, Math.round((it.duration - it.currentTime) / 60)) : null;
                const isCam = camIds && camIds.has(String(it.id));
                return (
                  <div key={it.id} className="p-card-hit shrink-0 w-[248px] md:w-[320px] cursor-pointer group/cw"
                    onClick={() => navigate(`/play/${it.id}`)}>
                    <div className="p-card aspect-video">
                      {it.poster
                        ? <img src={it.poster} alt="" loading="lazy" decoding="async" />
                        : <span className="absolute inset-0 flex items-center justify-center text-[11px] text-white/40 p-2 text-center">{it.title}</span>}

                      {isCam && (
                        <span className="absolute top-2 left-2 px-1.5 py-[3px] rounded-md bg-black/55 backdrop-blur-md text-[9px] font-semibold tracking-[0.08em] text-white/85">CAM</span>
                      )}

                      {/* Croix = retirer de la rangée. On ne marque PAS le
                          titre comme vu : proposer l'épisode 2 puis le déclarer
                          regardé parce qu'on l'a écarté n'aurait aucun sens. */}
                      <button onClick={(e) => retirer(e, it.id)} title="Retirer de Reprendre"
                        aria-label="Retirer de Reprendre"
                        className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center text-white/75 hover:text-white hover:bg-black/75 transition-colors active:scale-90">
                        <X size={14} strokeWidth={2.6} />
                      </button>

                      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cw:opacity-100 transition-opacity">
                        <span className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center">
                          <Play size={15} fill="white" className="ml-0.5" />
                        </span>
                      </span>

                      {pct > 0 && (
                        <span className="absolute bottom-0 inset-x-0 h-[3px] bg-white/20">
                          <span className="block h-full bg-white" style={{ width: `${pct}%` }} />
                        </span>
                      )}
                    </div>
                    <div className="mt-2 px-0.5">
                      <p className="text-[12.5px] font-medium text-white/80 truncate">{it.title}</p>
                      {it.nextUp ? (
                        <p className="text-[11px] p-faint mt-0.5 truncate">{it.sousTitre || 'Épisode suivant'}</p>
                      ) : (
                        <p className="text-[11px] p-faint mt-0.5 truncate">
                          {[it.sousTitre, left != null ? (left > 0 ? `${left} min restantes` : 'Presque terminé') : null]
                            .filter(Boolean).join('  ·  ')}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Top 10 — chiffres en contour, rien d'autre */}
        {data.top10.length > 0 && (
          <section data-row className="mb-10 md:mb-14">
            <h2 className="p-title text-[17px] md:text-[22px] px-5 md:px-8 mb-3.5 md:mb-4">Les 10 du moment</h2>
            <div className="p-rail p-marge gap-4 md:gap-7 px-5 md:px-8 pt-5 pb-14 items-end">
              {data.top10.map((it, k) => (
                <div key={it.id} className="flex items-end shrink-0">
                  <span className="top10-num-glass select-none pr-1 md:pr-2 -mb-3">{k + 1}</span>
                  <CardPure item={it} width="w-[110px] md:w-[150px]" showTitle={false}
                    watched={watchedIds.has(it.id)} camIds={camIds} />
                </div>
              ))}
            </div>
          </section>
        )}

        {allRows.slice(0, shown).map((r, k) => (
          <RowPure key={`${filter}-${r.title}-${k}`} title={r.title} items={r.items}
            variant={r.variant} watchedIds={watchedIds} camIds={camIds} />
        ))}

        {/* déclencheur du dévoilement progressif */}
        <div ref={sentinel} className="h-px" />

        {shown < allRows.length && (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-white/15 border-t-white/60 rounded-full animate-spin" />
          </div>
        )}
        </>
        )}

        <footer className="px-5 md:px-8 pt-6 pb-4 text-[11.5px] p-faint">
          NovaStream · {allRows.length} catégories · créé par{' '}
          <a href={CREDITS.github} target="_blank" rel="noreferrer" className="hover:text-white/70 transition-colors">{CREDITS.auteur}</a>
          {' '}avec {CREDITS.coAuteur}
        </footer>
      </div>
    </div>
  );
}
