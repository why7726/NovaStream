import React, { useEffect, useRef, useState } from 'react';
import { Search, Plus, X, Loader2 } from 'lucide-react';
import authService from '../../services/authService';
import plexService from '../../services/plexService';
import { tr } from '../../i18n';

/* Espace admin → +18 : ranger un film ou une série du serveur multimédia
   (Plex ou Jellyfin) dans l'onglet +18. Le titre sort alors de l'accueil, des
   bibliothèques et de la recherche ; seuls les comptes avec l'accès +18 le
   voient, dans l'onglet +18. Le filtrage est fait par le serveur (prive.js). */
const api = async (chemin, options = {}) => {
  const r = await fetch(chemin, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authService.getToken()}`, ...(options.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || tr('Impossible'));
  return j;
};
// Les listes déjà chargées dans cet onglet ne doivent pas resservir l'ancien état.
const viderCaches = () => { try { Object.keys(sessionStorage).filter((k) => k.startsWith('nova_lib_')).forEach((k) => sessionStorage.removeItem(k)); } catch { /* rien */ } };
const formater = (liste) => (liste || []).map((m) => plexService.formatPlexItem(m));

export default function Plus18Admin() {
  const [titres, setTitres] = useState(null);
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [cherche, setCherche] = useState(false);
  const [occupe, setOccupe] = useState(null);
  const [err, setErr] = useState(null);
  const minuterie = useRef(null);

  useEffect(() => { api('/api/admin/plus18').then((j) => setTitres(formater(j.titres))).catch((e) => { setErr(e.message); setTitres([]); }); }, []);

  // Recherche dans le serveur (les titres déjà classés +18 n'y apparaissent plus).
  useEffect(() => {
    clearTimeout(minuterie.current);
    if (q.trim().length < 2) { setResultats([]); return undefined; }
    minuterie.current = setTimeout(async () => {
      setCherche(true);
      try { setResultats((await plexService.search(q.trim())).filter((x) => x.type === 'movie' || x.type === 'show').slice(0, 12)); }
      catch { setResultats([]); }
      setCherche(false);
    }, 350);
    return () => clearTimeout(minuterie.current);
  }, [q]);

  const ajouter = async (it) => {
    setOccupe(it.id); setErr(null);
    try {
      const j = await api('/api/admin/plus18', { method: 'POST', body: JSON.stringify({ id: String(it.id) }) });
      setTitres(formater(j.titres));
      setResultats((r) => r.filter((x) => x.id !== it.id));
      viderCaches();
    } catch (e) { setErr(e.message); }
    setOccupe(null);
  };
  const retirer = async (it) => {
    setOccupe(it.id); setErr(null);
    try {
      const j = await api(`/api/admin/plus18/${encodeURIComponent(it.id)}`, { method: 'DELETE' });
      setTitres(formater(j.titres));
      viderCaches();
    } catch (e) { setErr(e.message); }
    setOccupe(null);
  };

  const Ligne = ({ it, action }) => (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-black/30">
      {it.poster ? <img src={it.poster} alt="" className="w-9 h-[54px] rounded-md object-cover shrink-0" /> : <div className="w-9 h-[54px] rounded-md bg-white/10 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold truncate">{it.title}</p>
        <p className="text-[12px] text-white/45">{it.type === 'show' ? tr('Série') : tr('Film')}{it.year ? ` · ${it.year}` : ''}</p>
      </div>
      {action}
    </div>
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-xl font-bold mb-2">{tr('Contenu +18')}</h2>
      <p className="text-gray-500 text-sm mb-6">{tr("Range un film ou une série de ton serveur dans l'onglet +18. Il disparaît de l'accueil, des bibliothèques et de la recherche, et seuls les comptes avec l'accès +18 peuvent l'ouvrir.")}</p>

      {err && <div className="mb-4 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-400/30 text-red-200 text-sm font-semibold">{err}</div>}

      <div className="relative mb-3">
        <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Chercher un film ou une série…')}
          className="w-full h-12 pl-11 pr-4 rounded-full bg-white/[0.06] border border-white/10 outline-none focus:border-white/30 text-[15px]" />
        {cherche && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-white/50" />}
      </div>
      {resultats.length > 0 && (
        <div className="space-y-2 mb-8">
          {resultats.map((it) => (
            <Ligne key={it.id} it={it} action={
              <button onClick={() => ajouter(it)} disabled={occupe === it.id}
                className="shrink-0 h-9 px-4 rounded-full bg-white text-black text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-50">
                {occupe === it.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {tr('Classer +18')}
              </button>
            } />
          ))}
        </div>
      )}

      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-white/45 mt-8 mb-3">{tr('Classés +18')}</h3>
      {titres === null && <Loader2 size={18} className="animate-spin text-white/50" />}
      {titres?.length === 0 && <p className="text-sm text-white/40">{tr('Aucun titre du serveur classé +18 pour le moment.')}</p>}
      <div className="space-y-2">
        {(titres || []).map((it) => (
          <Ligne key={it.id} it={it} action={
            <button onClick={() => retirer(it)} disabled={occupe === it.id} title={tr('Retirer du +18')}
              className="shrink-0 h-9 px-4 rounded-full bg-white/10 hover:bg-white/20 text-white text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {occupe === it.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} {tr('Retirer')}
            </button>
          } />
        ))}
      </div>
    </div>
  );
}
