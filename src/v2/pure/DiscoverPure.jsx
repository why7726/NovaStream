import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Search, X, Plus, Check, Loader2, Play } from 'lucide-react';
import authService from '../../services/authService';
import requestService from '../lib/requestService';
import RequestDetailModal from '../components/RequestDetailModal';
import useRetour from './useRetour';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');
const headers = () => {
  const t = authService.getToken();
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

/* Explorer — « trouve-moi des films comme ceux-là ».
   On coche des titres qu'on aime (présents sur Nova ou non), éventuellement
   des thèmes, et Nova croise les recommandations de chacun. Ce qui est déjà
   dans la bibliothèque apparaît normalement ; le reste en grisé, demandable. */
export default function DiscoverPure() {
  const navigate = useNavigate();
  const retour = useRetour('/');
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState([]);
  const [searching, setSearching] = useState(false);
  const [refs, setRefs] = useState([]);
  const [genres, setGenres] = useState([]);
  const [pickedGenres, setPickedGenres] = useState([]);
  const [novaOnly, setNovaOnly] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [modal, setModal] = useState(null);
  const debounce = useRef(null);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    fetch(`${apiBase()}/api/discover/genres`, { headers: headers() })
      .then((r) => r.json())
      .then((d) => setGenres((d.genres || []).slice(0, 18)))
      .catch(() => {});
  }, []);

  // Recherche des titres à cocher (TMDB : il contient tout, sur Nova ou pas)
  useEffect(() => {
    clearTimeout(debounce.current);
    if (!q.trim()) { setPicker([]); setSearching(false); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const r = await requestService.search(q).catch(() => []);
      setPicker(r.slice(0, 8));
      setSearching(false);
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [q]);

  const run = useCallback(async (nextRefs, nextGenres, only) => {
    if (!nextRefs.length && !nextGenres.length) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`${apiBase()}/api/discover`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          refs: nextRefs.map((x) => ({ tmdbId: x.tmdbId, type: x.type })),
          genres: nextGenres,
          novaOnly: only,
        }),
      });
      const d = await r.json();
      setResults(d.results || []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  // Toute modification relance la recherche : pas de bouton « Valider »
  useEffect(() => {
    if (!touched) return;
    run(refs, pickedGenres, novaOnly);
  }, [refs, pickedGenres, novaOnly, touched, run]);

  const addRef = (item) => {
    setTouched(true);
    setRefs((r) => (r.find((x) => x.tmdbId === item.tmdbId) ? r : [...r, item].slice(0, 8)));
    setQ(''); setPicker([]);
  };
  const dropRef = (id) => { setTouched(true); setRefs((r) => r.filter((x) => x.tmdbId !== id)); };
  const toggleGenre = (id) => {
    setTouched(true);
    setPickedGenres((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  };

  const empty = !refs.length && !pickedGenres.length;

  return (
    <div className="min-h-screen pt-16 md:pt-20 pb-10 max-w-[1400px] mx-auto">
      <div className="px-5 md:px-8 flex items-center gap-3 mb-2">
        <button onClick={retour} aria-label="Retour"
          className="w-9 h-9 -ml-1.5 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h1 className="p-display text-[26px] md:text-[38px]">Explorer</h1>
      </div>
      <p className="px-5 md:px-8 text-[14px] p-dim mb-6">
        Coche des films que tu aimes — même absents de Nova — et découvre ce qui leur ressemble.
      </p>

      {/* ── Titres cochés ── */}
      {refs.length > 0 && (
        <div className="px-5 md:px-8 mb-4 flex flex-wrap gap-2">
          {refs.map((r) => (
            <span key={r.tmdbId} className="flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-full bg-white text-black">
              {r.poster && <img src={r.poster} alt="" className="w-6 h-6 rounded-full object-cover" />}
              <span className="text-[13px] font-semibold max-w-[160px] truncate">{r.title}</span>
              <button onClick={() => dropRef(r.tmdbId)} aria-label="Retirer" className="opacity-50 hover:opacity-100">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Ajout d'un titre ── */}
      <div className="px-5 md:px-8 mb-5 relative">
        <div className="flex items-center gap-2.5 h-11 px-4 rounded-xl bg-white/[0.08] max-w-xl">
          <Search size={17} className="text-white/40 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={refs.length ? 'Ajouter un autre titre…' : 'Terrifier, Saw, Interstellar…'}
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-white/35" />
          {searching && <Loader2 size={15} className="animate-spin text-white/40" />}
        </div>

        {picker.length > 0 && (
          <div className="absolute z-30 mt-2 w-[calc(100%-2.5rem)] md:w-[36rem] max-w-xl rounded-2xl bg-[#141416]/96 backdrop-blur-2xl border border-white/10 p-1.5">
            {picker.map((p) => (
              <button key={`${p.type}-${p.tmdbId}`} onClick={() => addRef(p)}
                className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/[0.08] transition-colors text-left">
                {p.poster
                  ? <img src={p.poster} alt="" className="w-8 h-12 rounded object-cover shrink-0" />
                  : <span className="w-8 h-12 rounded bg-white/10 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium truncate">{p.title}</span>
                  <span className="block text-[11.5px] p-faint">{[p.year, p.type === 'tv' ? 'Série' : 'Film'].filter(Boolean).join(' · ')}</span>
                </span>
                <Plus size={16} className="text-white/40 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Thèmes ── */}
      {genres.length > 0 && (
        <div className="px-5 md:px-8 mb-5">
          <p className="p-label mb-2.5">Thèmes</p>
          <div className="flex flex-wrap gap-2">
            {genres.map((g) => {
              const on = pickedGenres.includes(g.id);
              return (
                <button key={g.id} onClick={() => toggleGenre(g.id)}
                  className={`h-9 px-3.5 rounded-full text-[13px] font-medium transition-colors ${
                    on ? 'bg-white text-black' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.14]'
                  }`}>
                  {g.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filtre Nova ── */}
      {!empty && (
        <div className="px-5 md:px-8 mb-6 flex items-center gap-2">
          <button onClick={() => { setTouched(true); setNovaOnly((v) => !v); }}
            className={`h-9 px-3.5 rounded-full text-[13px] font-medium transition-colors ${
              novaOnly ? 'bg-white text-black' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.14]'
            }`}>
            Disponibles sur Nova uniquement
          </button>
          {!loading && results.length > 0 && (
            <span className="text-[12px] p-faint">
              {results.filter((r) => r.inNova).length} sur Nova · {results.filter((r) => !r.inNova).length} à demander
            </span>
          )}
        </div>
      )}

      {/* ── Résultats ── */}
      <div className="px-5 md:px-8">
        {loading ? (
          <div className="py-20 flex justify-center">
            <div className="w-6 h-6 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
          </div>
        ) : empty ? (
          <p className="text-[14px] p-faint py-16 text-center">Coche au moins un titre ou un thème.</p>
        ) : results.length === 0 ? (
          <p className="text-[14px] p-faint py-16 text-center">Rien trouvé avec ces critères.</p>
        ) : (
          <div data-row className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-3 md:gap-4">
            {results.map((r) => (
              <button key={`${r.type}-${r.tmdbId}`}
                onClick={() => (r.inNova ? navigate(`/title/${r.ratingKey}`) : setModal(r))}
                className="p-card-hit text-left group/d">
                <div className={`p-card aspect-[2/3] ${r.inNova ? '' : 'opacity-45 grayscale'}`}>
                  <img src={r.poster} alt="" loading="lazy" decoding="async" />
                  {r.inNova ? (
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/d:opacity-100 transition-opacity">
                      <span className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center">
                        <Play size={15} fill="white" className="ml-0.5" />
                      </span>
                    </span>
                  ) : (
                    <span className="absolute inset-0 flex items-end justify-center pb-2">
                      <span className="px-2 py-[3px] rounded-md bg-black/70 backdrop-blur-md text-[9.5px] font-semibold text-white/85">
                        À demander
                      </span>
                    </span>
                  )}
                  {r.matches > 1 && (
                    <span className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-[3px] rounded-md bg-black/60 backdrop-blur-md text-[9px] font-semibold text-white/90">
                      <Check size={9} strokeWidth={3} /> {r.matches}
                    </span>
                  )}
                </div>
                <p className={`mt-2 text-[12px] font-medium truncate px-0.5 ${r.inNova ? 'text-white/80' : 'text-white/35'}`}>
                  {r.title}
                </p>
                <p className="text-[11px] p-faint px-0.5">{[r.year, r.rating ? `★ ${r.rating}` : null].filter(Boolean).join(' · ')}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <RequestDetailModal
          item={{ tmdbId: modal.tmdbId, type: modal.type, title: modal.title, year: modal.year, poster: modal.poster, backdrop: modal.backdrop, overview: modal.overview, rating: modal.rating }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
