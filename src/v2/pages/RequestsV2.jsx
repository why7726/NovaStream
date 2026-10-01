import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Check, Clock, X, Trash2, Loader2, Sparkles, Play } from 'lucide-react';
import authService from '../../services/authService';
import requestService from '../lib/requestService';
import RequestDetailModal from '../components/RequestDetailModal';
import { getCatalog } from '../pure/catalog';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

/* Barre de progression d'une demande approuvee : Nova interroge Radarr/Sonarr
   ou, si le torrent a ete ajoute a la main, qBittorrent. */
function Progression({ id }) {
  const [p, setP] = React.useState(null);
  React.useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const t = authService.getToken();
        const r = await fetch(`${apiBase()}/api/requests/${id}/progress`, {
          headers: t ? { Authorization: `Bearer ${t}` } : {},
        });
        const d = await r.json();
        if (on) setP(d);
      } catch { /* silencieux */ }
    };
    tick();
    const iv = setInterval(tick, 20000);
    return () => { on = false; clearInterval(iv); };
  }, [id]);

  if (!p || p.percent == null) return null;
  const eta = p.eta && p.eta > 0
    ? (p.eta > 3600 ? `${Math.round(p.eta / 3600)} h` : tr('{0} min', [Math.max(1, Math.round(p.eta / 60))]))
    : null;

  return (
    <div className="mt-1.5">
      <div className="h-[3px] rounded-full bg-white/15 overflow-hidden">
        <div className="h-full bg-white transition-all duration-700" style={{ width: `${p.percent}%` }} />
      </div>
      <p className="text-[10.5px] text-white/45 mt-1">
        {p.percent} {tr('% téléchargé')}{eta ? tr(' · {0} restantes', [eta]) : ''}{p.source === 'manuel' ? tr(' · ajout manuel') : ''}
      </p>
    </div>
  );
}
import { buildIndex, findLocal } from '../pure/available';
import PickerPure from '../pure/PickerPure';
import VibePure from '../pure/VibePure';

import { tr } from '../../i18n';
/* Vignette d'un résultat TMDB — la même pour la recherche et pour les thèmes.
   Trois états : déjà sur Nova (on y va), déjà demandé, ou à demander. */
function Vignette({ r, local, done, onOuvrir, onVoir }) {
  return (
    <button onClick={() => (local ? onVoir(local) : onOuvrir(r))} className="group text-left">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-[#101012] ring-1 ring-white/10 group-hover:ring-white/30 transition-all">
        {r.poster
          ? <img src={r.poster} alt={r.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="w-full h-full flex items-center justify-center p-2 text-center text-[11px] text-white/50">{r.title}</div>}
        {local ? (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5 px-1 text-center">
            <span className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center">
              <Play size={15} fill="white" className="ml-0.5" />
            </span>
            <span className="text-[10.5px] font-semibold text-white">{tr('Déjà sur Nova')}</span>
          </div>
        ) : done ? (
          <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-white"><Check size={13} /> {tr('Demandé')}</span>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center"><Plus size={18} /></div>
          </div>
        )}
      </div>
      <p className="text-[11px] font-bold text-gray-300 group-hover:text-white truncate mt-1.5">{r.title}</p>
      <p className="text-[10px] text-gray-500">{r.year || ''}</p>
    </button>
  );
}

const STATUS = {
  pending: { label: tr('En attente'), cls: 'bg-white/[0.08] text-white/70 border-white/15' },
  approved: { label: tr('Approuvée'), cls: 'bg-white/[0.14] text-white border-white/20' },
  added: { label: tr('Ajoutée'), cls: 'bg-white text-black border-white' },
  declined: { label: tr('Refusée'), cls: 'bg-white/[0.05] text-white/40 border-white/10' },
};

export default function RequestsV2() {
  const navigate = useNavigate();
  const user = authService.getUser();
  const isAdmin = !!user?.isAdmin;
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [requests, setRequests] = useState([]);
  const [adminView, setAdminView] = useState(false);
  const debounce = useRef(null);
  const [catalog, setCatalog] = useState([]);

  // ── Parcours par thème (quand on n'a pas de titre précis en tête) ──
  const [themeType, setThemeType] = useState('movie');   // 'movie' | 'tv'
  const [genres, setGenres] = useState([]);
  const [theme, setTheme] = useState(null);              // id de genre choisi
  const [themeItems, setThemeItems] = useState([]);
  const [themePage, setThemePage] = useState(1);
  const [themePages, setThemePages] = useState(1);
  const [themeLoading, setThemeLoading] = useState(false);

  useEffect(() => {
    const t = authService.getToken();
    fetch(`${apiBase()}/api/discover/genres?type=${themeType}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then((r) => r.json())
      .then((d) => setGenres(d.genres || []))
      .catch(() => setGenres([]));
    setTheme(null); setThemeItems([]);
  }, [themeType]);

  const ouvrirTheme = async (id, page = 1) => {
    setTheme(id);
    setThemeLoading(true);
    try {
      const d = await requestService.browse({ genre: id, type: themeType, page });
      setThemeItems((prev) => (page === 1 ? d.results : [...prev, ...d.results]));
      setThemePage(page);
      setThemePages(d.pages || 1);
    } finally {
      setThemeLoading(false);
    }
  };

  // Catalogue Plex, pour repérer ce qui est DÉJÀ disponible
  useEffect(() => { getCatalog().then(setCatalog).catch(() => {}); }, []);
  const localIndex = useMemo(() => buildIndex(catalog), [catalog]);

  const requestedIds = new Set(requests.filter((r) => r.userId === user?.id).map((r) => `${r.mediaType}:${r.tmdbId}`));

  const loadRequests = useCallback(() => {
    requestService.list(isAdmin && adminView).then((d) => setRequests(d.requests || []));
  }, [isAdmin, adminView]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const r = await requestService.search(q);
      setResults(r);
      setSearching(false);
    }, 400);
    return () => clearTimeout(debounce.current);
  }, [q]);

  const onRequested = () => { loadRequests(); };

  const updateStatus = async (id, status) => { await requestService.setStatus(id, status); loadRequests(); };
  const remove = async (id) => { await requestService.remove(id); loadRequests(); };

  return (
    <div className="min-h-screen px-4 md:px-12 pt-24 md:pt-28 pb-16 max-w-6xl mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <Sparkles size={22} className="text-white/60" />
        <h1 className="p-display text-[28px] md:text-[40px]">{tr('Demander un contenu')}</h1>
      </div>
      <p className="text-gray-400 text-sm mb-6">{tr('Cherche un film ou une série absent de Nova et demande-le à l\'admin.')}</p>

      {/* L'assistant d'humeur, avant la recherche : c'est le cas le plus
          fréquent — on ne sait pas quoi regarder, pas quoi chercher. */}
      <VibePure />

      {/* Search */}
      <div className="relative max-w-xl mb-8">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr('Rechercher un film, une série…')}
          autoFocus
          className="w-full bg-white/[0.06] border border-white/10 rounded-2xl pl-11 pr-11 py-3.5 text-sm md:text-base outline-none focus:border-white/30 transition-colors"
        />
        {q && (
          <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Search results */}
      {q.trim() && (
        <div className="mb-12">
          {searching ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> {tr('Recherche…')}</div>
          ) : results.length === 0 ? (
            <p className="text-gray-500 text-sm">{tr('Aucun résultat.')}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 md:gap-4">
              {results.map((r) => (
                <Vignette key={`${r.type}-${r.tmdbId}`} r={r}
                  local={findLocal(localIndex, r)}
                  done={requestedIds.has(`${r.type}:${r.tmdbId}`)}
                  onOuvrir={setSelected}
                  onVoir={(l) => navigate(`/title/${l.id}`)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Parcourir par thème ──
          Pour demander quand on n'a pas de titre en tête : on choisit une
          humeur et on pioche. Les titres déjà sur Nova restent marqués. */}
      {!q.trim() && (
        <div className="mb-12">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h2 className="text-lg md:text-xl font-bold">{tr('Parcourir par thème')}</h2>
            <div className="p-glass rounded-full p-1 flex items-center text-[12.5px] font-medium">
              {[['movie', tr('Films')], ['tv', tr('Séries')]].map(([v, label]) => (
                <button key={v} onClick={() => setThemeType(v)}
                  className={`px-3.5 h-8 rounded-full transition-colors ${themeType === v ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-5">
            {themeType === 'movie' && (
              <button onClick={() => ouvrirTheme('horreurplus')}
                title={tr('Les films de la sélection Horreur + qui ne sont pas encore sur Nova')}
                className={`h-9 px-4 rounded-full text-[13px] font-medium transition-colors ${
                  theme === 'horreurplus' ? 'bg-white text-black' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.14]'
                }`}>
                {tr('Horreur +')}
              </button>
            )}
            {genres.map((g) => (
              <button key={g.id} onClick={() => ouvrirTheme(g.id)}
                className={`h-9 px-4 rounded-full text-[13px] font-medium transition-colors ${
                  theme === g.id ? 'bg-white text-black' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.14]'
                }`}>
                {g.name}
              </button>
            ))}
          </div>

          {theme && (
            themeLoading && themeItems.length === 0 ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> {tr('Chargement…')}</div>
            ) : themeItems.length === 0 ? (
              <p className="text-gray-500 text-sm">{tr('Rien à proposer ici.')}</p>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 md:gap-4">
                  {themeItems.map((r) => (
                    <Vignette key={`${r.type}-${r.tmdbId}`} r={r}
                      local={findLocal(localIndex, r)}
                      done={requestedIds.has(`${r.type}:${r.tmdbId}`)}
                      onOuvrir={setSelected}
                      onVoir={(l) => navigate(`/title/${l.id}`)} />
                  ))}
                </div>
                {themePage < themePages && (
                  <div className="flex justify-center mt-5">
                    <button onClick={() => ouvrirTheme(theme, themePage + 1)} disabled={themeLoading}
                      className="h-10 px-6 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[13.5px] font-medium transition-colors disabled:opacity-50">
                      {themeLoading ? 'Chargement…' : tr('Voir plus')}
                    </button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      )}

      {/* Requests list */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg md:text-xl font-bold">{isAdmin && adminView ? tr('Toutes les demandes') : tr('Mes demandes')}</h2>
        {isAdmin && (
          <button onClick={() => setAdminView((v) => !v)}
            className="text-xs font-bold px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10 hover:bg-white/12 transition-colors">
            {adminView ? tr('→ Voir les miennes') : tr('→ Voir toutes (admin)')}
          </button>
        )}
      </div>

      {requests.length === 0 ? (
        <p className="text-gray-500 text-sm">{tr('Aucune demande pour l\'instant.')}</p>
      ) : (
        <div className="space-y-2.5">
          {requests.map((r) => {
            const st = STATUS[r.status] || STATUS.pending;
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 glass-panel rounded-2xl p-2.5 pr-3">
                {r.poster
                  ? <img src={r.poster} alt="" className="w-11 h-16 rounded-lg object-cover shrink-0" />
                  : <div className="w-11 h-16 rounded-lg bg-white/10 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{r.title || tr('Sans titre')} {r.year ? <span className="text-gray-500 font-normal">({r.year})</span> : null}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {findLocal(localIndex, { title: r.title, year: r.year, type: r.mediaType === 'tv' ? 'tv' : 'movie' })
                      ? <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-white text-black border-white">{tr('Disponible')}</span>
                      : <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>}
                    <span className="text-[10px] text-gray-500">{r.mediaType === 'movie' ? tr('Film') : tr('Série')}</span>
                    {isAdmin && adminView && r.username && <span className="text-[10px] text-white/50">{tr('par')} {r.username}</span>}
                  </div>
                </div>
                {r.status === 'approved' && <div className="w-full order-last basis-full"><Progression id={r.id} /></div>}
                {isAdmin && adminView ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <PickerPure
                      title={tr('Statut de la demande')}
                      label={tr('Statut')}
                      value={r.status}
                      options={[
                        { value: 'pending', label: tr('En attente') },
                        { value: 'approved', label: tr('Approuvée') },
                        { value: 'added', label: tr('Ajoutée') },
                        { value: 'declined', label: tr('Refusée') },
                      ]}
                      onPick={(v) => updateStatus(r.id, v)}
                    />
                    <button onClick={() => remove(r.id)} title={tr('Supprimer')} className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-red-500/20 hover:text-red-300 flex items-center justify-center transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => remove(r.id)} title={tr('Annuler ma demande')} className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-red-500/20 hover:text-red-300 flex items-center justify-center transition-colors shrink-0">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <RequestDetailModal
          item={selected}
          localItem={findLocal(localIndex, selected)}
          already={requestedIds.has(`${selected.type}:${selected.tmdbId}`)}
          onClose={() => setSelected(null)}
          onRequested={onRequested}
        />
      )}
    </div>
  );
}
