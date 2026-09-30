import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Info } from 'lucide-react';
import authService from '../../services/authService';
import RequestDetailModal from '../components/RequestDetailModal';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

/* La saga d'un film : tous les épisodes de la collection, dans l'ordre.
   Ceux qu'on a s'ouvrent normalement ; les manquants restent visibles,
   grisés, et mènent à leur fiche avec le bouton Demander. */
export default function SagaRow({ ratingKey }) {
  const navigate = useNavigate();
  const [saga, setSaga] = useState(null);
  const [modal, setModal] = useState(null);

  useEffect(() => {
    let on = true;
    setSaga(null);
    const t = authService.getToken();
    fetch(`${apiBase()}/api/saga/${ratingKey}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then((r) => r.json())
      .then((d) => { if (on) setSaga(d.saga); })
      .catch(() => {});
    return () => { on = false; };
  }, [ratingKey]);

  if (!saga || saga.parts.length < 2) return null;

  return (
    <section data-row className="pt-10 md:pt-14">
      <div className="px-5 md:px-8 mb-3.5 md:mb-4 flex items-baseline gap-2.5">
        <h2 className="p-title text-[19px] md:text-[24px]">La saga {saga.name}</h2>
        <span className="text-[12.5px] p-faint">{saga.onNova} sur {saga.total}</span>
      </div>

      <div className="p-rail p-marge gap-3 md:gap-4 px-5 md:px-8 pb-1">
        {saga.parts.map((x) => (
          <button key={x.tmdbId}
            onClick={() => (x.inNova ? navigate(`/title/${x.ratingKey}`) : setModal(x))}
            className={`p-card-hit shrink-0 w-[124px] md:w-[168px] text-left group/s ${x.isCurrent ? 'opacity-100' : ''}`}>
            <div className={`p-card aspect-[2/3] ${x.inNova ? '' : 'opacity-45 grayscale'} ${x.isCurrent ? 'ring-1 ring-white/50' : ''}`}>
              <img src={x.poster} alt="" loading="lazy" decoding="async" />
              {x.inNova ? (
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/s:opacity-100 transition-opacity">
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
              {x.isCurrent && (
                <span className="absolute top-2 left-2 px-1.5 py-[3px] rounded-md bg-white text-black text-[9px] font-bold tracking-[0.06em]">
                  EN COURS
                </span>
              )}
            </div>
            <p className={`mt-2 text-[12px] font-medium truncate px-0.5 ${x.inNova ? 'text-white/80' : 'text-white/35'}`}>
              {x.title}
            </p>
            <p className="text-[11px] p-faint px-0.5">{x.year}</p>
          </button>
        ))}
      </div>

      {modal && (
        <RequestDetailModal item={modal} onClose={() => setModal(null)} />
      )}
    </section>
  );
}
