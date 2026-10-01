import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { X, Plus, Check, Star, Calendar, Clock, Loader2, Play } from 'lucide-react';
import requestService from '../lib/requestService';
import { getCatalog } from '../pure/catalog';
import { buildIndex, findLocal } from '../pure/available';

import { tr } from '../../i18n';
// Fiche d'un résultat TMDB — même dessin qu'une fiche film, mais le bouton
// Lecture devient « Demander ». `already` = déjà demandé par cet utilisateur ;
// `localItem` = le titre existe DÉJÀ sur Nova, on propose de le regarder.
export default function RequestDetailModal({ item, already = false, localItem = null, onClose, onRequested }) {
  const navigate = useNavigate();
  /* `cible` : le titre affiché. Il change quand on clique un autre film de la
     saga — on reste dans la même fenêtre au lieu d'en rouvrir une. */
  const [cible, setCible] = useState(item);
  const [details, setDetails] = useState(null);
  const [state, setState] = useState(already ? 'done' : 'idle'); // idle | sending | done | error
  const [err, setErr] = useState(null);
  const [saga, setSaga] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const corps = useRef(null);

  useEffect(() => { setCible(item); setState(already ? 'done' : 'idle'); }, [item, already]);

  // Catalogue Plex : sert à marquer, dans la saga, ce qu'on possède déjà.
  useEffect(() => { getCatalog().then(setCatalogue).catch(() => {}); }, []);
  const indexLocal = useMemo(() => buildIndex(catalogue), [catalogue]);

  /* Et les demandes en cours : sans elles, un film déjà demandé s'affichait
     comme s'il restait à demander — on pouvait le redemander sans le savoir. */
  const [demandes, setDemandes] = useState(new Set());
  useEffect(() => {
    requestService.list(false)
      .then((d) => setDemandes(new Set((d.requests || []).map((r) => `${r.mediaType}:${r.tmdbId}`))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let ok = true;
    setDetails(null); setSaga([]);
    requestService.details(cible.type, cible.tmdbId)
      .then((d) => {
        if (!ok) return;
        setDetails(d);
        if (d.collection?.id) {
          requestService.collection(d.collection.id)
            .then((films) => ok && setSaga(films))
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => { ok = false; };
  }, [cible.tmdbId, cible.type]);

  const d = details || cible;
  const surNova = localItem && cible.tmdbId === item.tmdbId
    ? localItem
    : findLocal(indexLocal, { title: d.title, year: d.year, type: d.type });

  const request = async () => {
    setState('sending');
    try {
      await requestService.create({ tmdbId: cible.tmdbId, mediaType: cible.type, title: d.title, year: d.year, poster: d.poster });
      setState('done');
      onRequested?.(cible);
    } catch (e) { setErr(e.message); setState('error'); }
  };

  // Changer de film à l'intérieur de la saga
  const ouvrirDeLaSaga = (f) => {
    setCible({ tmdbId: f.tmdbId, type: 'movie', title: f.title, year: f.year, poster: f.poster });
    setState('idle'); setErr(null);
    corps.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* Rendu dans <body> via un portail. Sans ça, la fiche s'incruste dans la
     page : les rangées portent `content-visibility: auto` (pour la fluidité),
     qui crée un contexte de confinement — un élément « fixe » s'y retrouve
     piégé au lieu de flotter par-dessus. Constaté sur la rangée des sagas. */
  return createPortal(
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="nova-v2 nova-pure fixed inset-0 z-[125] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
        <motion.div
          ref={corps}
          initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.97 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-hide rounded-3xl bg-[#0e0e14] ring-1 ring-white/10 shadow-2xl">
          {/* backdrop */}
          <div className="relative h-44 md:h-64">
            {d.backdrop
              ? <img src={d.backdrop} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-gradient-to-br from-indigo-900/40 to-black" />}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e14] via-[#0e0e14]/40 to-transparent" />
            <button onClick={onClose} className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center hover:bg-black/70 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="px-5 md:px-8 pb-7 -mt-16 relative">
            <div className="flex gap-4">
              {d.poster && <img src={d.poster} alt={d.title} className="w-24 md:w-32 rounded-xl ring-1 ring-white/15 shadow-xl shrink-0" />}
              <div className="pt-16 min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">{item.type === 'movie' ? tr('Film') : tr('Série')}</span>
                <h2 className="text-xl md:text-2xl font-black leading-tight">{d.title}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-400">
                  {d.rating ? <span className="flex items-center gap-1"><Star size={12} className="text-white/70" fill="currentColor" />{d.rating}</span> : null}
                  {d.year && <span className="flex items-center gap-1"><Calendar size={12} />{d.year}</span>}
                  {details?.runtime ? <span className="flex items-center gap-1"><Clock size={12} />{details.runtime} {tr('min')}</span> : null}
                </div>
                {details?.genres?.length ? <p className="text-[11px] text-white/50 mt-1.5">{details.genres.slice(0, 3).join(' · ')}</p> : null}
              </div>
            </div>

            {d.overview && <p className="text-[13px] md:text-sm text-white/75 leading-relaxed mt-5">{d.overview}</p>}

            {/* Request button (replaces "Lecture") */}
            {/* ── La saga, juste avant le bouton ──
                On voit d'un coup toute la série de films : ceux qu'on possède
                sont marqués, les autres se demandent sans quitter la fenêtre.
                (Chercher « Evil Dead » ne montrait que le film cliqué.) */}
            {saga.length > 1 && (
              <div className="mt-6">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2.5">
                  {details?.collection?.name || tr('La saga')}
                </p>
                <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1">
                  {saga.map((f) => {
                    const dispo = findLocal(indexLocal, { title: f.title, year: f.year, type: 'movie' });
                    const demande = !dispo && demandes.has(`movie:${f.tmdbId}`);
                    const actuel = String(f.tmdbId) === String(cible.tmdbId);
                    return (
                      <button key={f.tmdbId}
                        onClick={() => (dispo ? (onClose(), navigate(`/title/${dispo.id}`)) : ouvrirDeLaSaga(f))}
                        title={dispo ? tr('Déjà sur Nova — le regarder') : demande ? tr('Déjà demandé') : tr('Le demander')}
                        className="flex-shrink-0 w-[86px] text-left group/s">
                        <div className={`relative aspect-[2/3] rounded-lg overflow-hidden bg-[#101012] ring-1 transition-all ${
                          actuel ? 'ring-white/70' : 'ring-white/10 group-hover/s:ring-white/35'
                        }`}>
                          {f.poster
                            ? <img src={f.poster} alt="" loading="lazy" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center p-1 text-center text-[9px] text-white/50">{f.title}</div>}

                          {/* Trois états, lisibles d'un seul coup d'œil : ce qu'on
                              possède est ASSOMBRI avec le triangle de lecture,
                              exactement comme dans les résultats de recherche. */}
                          {dispo ? (
                            <span className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center gap-1">
                              <span className="w-7 h-7 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
                                <Play size={11} fill="white" className="ml-0.5" />
                              </span>
                              <span className="text-[9px] font-semibold text-white">{tr('Sur Nova')}</span>
                            </span>
                          ) : demande ? (
                            <span className="absolute inset-0 bg-black/55 flex items-center justify-center">
                              <span className="flex items-center gap-1 text-[9px] font-semibold text-white"><Check size={10} /> {tr('Demandé')}</span>
                            </span>
                          ) : (
                            <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/s:opacity-100 transition-opacity">
                              <Plus size={11} />
                            </span>
                          )}
                        </div>
                        <p className={`text-[10px] truncate mt-1 ${dispo ? 'text-white/45' : 'text-gray-300'}`}>{f.title}</p>
                        <p className="text-[9.5px] text-gray-500">{f.year}</p>
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const possedes = saga.filter((f) => findLocal(indexLocal, { title: f.title, year: f.year, type: 'movie' })).length;
                  return (
                    <p className="text-[11px] text-white/40 mt-2">
                      {possedes} {tr('sur')} {saga.length} {tr('déjà sur Nova')}
                      {possedes < saga.length ? tr(' · {0} à demander', [saga.length - possedes]) : ''}
                    </p>
                  );
                })()}
              </div>
            )}

            <div className="mt-6">
              {surNova ? (
                <>
                  <button onClick={() => { onClose(); navigate(`/title/${surNova.id}`); }}
                    className="w-full flex items-center justify-center gap-2 h-[50px] rounded-full bg-white text-black text-[15px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all">
                    <Play size={17} fill="currentColor" /> {tr('Regarder maintenant')}
                  </button>
                  <p className="text-center text-[12.5px] text-white/45 mt-2.5">
                    {tr('Déjà dans la bibliothèque')}{surNova.year ? ` (${surNova.year})` : ''} {tr('— inutile de le demander.')}
                  </p>
                </>
              ) : state === 'done' ? (
                <div className="flex items-center justify-center gap-2 py-3.5 rounded-full bg-white/10 text-white font-semibold">
                  <Check size={18} /> {tr('Demande envoyée à l\'admin')}
                </div>
              ) : (
                <button onClick={request} disabled={state === 'sending'}
                  className="w-full flex items-center justify-center gap-2 h-[50px] rounded-full bg-white text-black text-[15px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60">
                  {state === 'sending' ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                  {state === 'sending' ? 'Envoi…' : tr('Demander ce titre')}
                </button>
              )}
              {state === 'error' && <p className="text-center text-xs text-white/50 mt-2">{err}</p>}
            </div>

            {/* cast */}
            {details?.cast?.length ? (
              <div className="mt-6">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2.5">{tr('Distribution')}</p>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                  {details.cast.map((c, i) => (
                    <div key={i} className="flex-shrink-0 w-16 text-center">
                      {c.photo
                        ? <img src={c.photo} alt={c.name} className="w-16 h-16 rounded-full object-cover ring-1 ring-white/10" />
                        : <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-lg">{c.name.charAt(0)}</div>}
                      <p className="text-[10px] text-gray-300 mt-1 truncate">{c.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
