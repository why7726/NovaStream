import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import CardPure from './CardPure';
import { getCatalog, getCatalogSync, searchCatalog, norm } from './catalog';
import plexService from '../../services/plexService';

const RECENT_KEY = 'nova_recent_search';

/* Recherche "Pure" — locale, instantanée, tolérante aux fautes.
   On cherche dans le catalogue déjà en cache : aucune requête réseau pendant
   la frappe. Plex n'est interrogé qu'en dernier recours (0 résultat local). */
export default function SearchPure({ onClose }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [q, setQ] = useState('');
  const [items, setItems] = useState(() => getCatalogSync() || []);
  const [remote, setRemote] = useState([]);
  const [recent, setRecent] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  });

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { getCatalog().then(setItems).catch(() => {}); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Résultats locaux : recalculés à la frappe, sans réseau ni délai.
  const results = useMemo(() => searchCatalog(items, q), [items, q]);

  // Filet de sécurité : si le local ne trouve rien, on demande à Plex.
  useEffect(() => {
    setRemote([]);
    if (!q.trim() || results.length) return;
    const t = setTimeout(async () => {
      try { setRemote(await plexService.search(q)); } catch { /* tant pis */ }
    }, 450);
    return () => clearTimeout(t);
  }, [q, results.length]);

  const shown = results.length ? results : remote;

  // Suggestions quand le champ est vide : genres les plus représentés.
  const genres = useMemo(() => {
    const count = new Map();
    items.forEach((it) => (it.genres || []).forEach((g) => count.set(g, (count.get(g) || 0) + 1)));
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g);
  }, [items]);

  const open = (item) => {
    const next = [item.title, ...recent.filter((r) => norm(r) !== norm(item.title))].slice(0, 6);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
    onClose();
    navigate(`/title/${item.id}`);
  };

  return createPortal(
    <div className="nova-v2 nova-pure fixed inset-0 z-[125] flex flex-col bg-black/92 backdrop-blur-2xl">
      {/* champ */}
      <div className="shrink-0 px-4 md:px-8 pt-4 md:pt-6">
        <div className="max-w-[900px] mx-auto flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2.5 h-11 px-4 rounded-xl bg-white/[0.08]">
            <Search size={17} className="text-white/40 shrink-0" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Films, séries, acteurs, genres…"
              className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-white/35" />
            {q && (
              <button onClick={() => setQ('')} aria-label="Effacer" className="text-white/40 hover:text-white transition-colors">
                <X size={16} />
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-[15px] text-white/70 hover:text-white transition-colors">Annuler</button>
        </div>
      </div>

      {/* résultats */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 md:px-8 py-6">
        <div className="max-w-[900px] mx-auto">
          {!q.trim() ? (
            <>
              {recent.length > 0 && (
                <section className="mb-8">
                  <p className="p-label mb-3">Recherches récentes</p>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((r) => (
                      <button key={r} onClick={() => setQ(r)}
                        className="h-9 px-3.5 rounded-full bg-white/[0.08] text-[13px] font-medium text-white/80 hover:bg-white/[0.14] transition-colors">
                        {r}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <section className="mb-8">
                <button onClick={() => { onClose(); navigate('/explorer'); }}
                  className="w-full flex items-center justify-between px-4 h-12 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] transition-colors">
                  <span className="text-[14px] font-medium">Recherche avancée — par films aimés et thèmes</span>
                  <span className="text-white/40">›</span>
                </button>
              </section>

              <section>
                <p className="p-label mb-3">Parcourir</p>
                <div className="flex flex-wrap gap-2">
                  {genres.map((g) => (
                    <button key={g} onClick={() => setQ(g)}
                      className="h-9 px-3.5 rounded-full bg-white/[0.08] text-[13px] font-medium text-white/80 hover:bg-white/[0.14] transition-colors">
                      {g}
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : shown.length === 0 ? (
            <p className="text-center text-[14px] p-faint mt-16">Aucun résultat pour « {q} ».</p>
          ) : (
            <>
              <p className="p-label mb-3">{shown.length} résultat{shown.length > 1 ? 's' : ''}</p>
              <div data-row className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 md:gap-4">
                {shown.map((it) => (
                  <CardPure key={it.id} item={it} width="w-full" onClick={() => open(it)} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
