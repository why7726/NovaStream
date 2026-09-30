import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Cake, MapPin, Clapperboard, TrendingUp, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import plexService from '../../services/plexService';
import TiltCard from '../components/TiltCard';
import FooterV2 from '../components/FooterV2';

/* ── Actor page (Spatial Cinema) ──────────────────────────────────────
   TMDB person + filmography, split into "available on Nova" (clickable,
   with production budget & box-office) and the rest (dimmed). */

const fmtMoney = (n) => {
  if (!n) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',').replace(',0', '')} Md $`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} M$`;
  return `${Math.round(n / 1e3)} k$`;
};

const fmtDate = (iso) => {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return iso; }
};

const age = (birth, death) => {
  if (!birth) return null;
  const end = death ? new Date(death) : new Date();
  const b = new Date(birth);
  let a = end.getFullYear() - b.getFullYear();
  if (end < new Date(end.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
};

function CreditCard({ credit, onClick }) {
  const available = !!credit.ratingKey;
  const inner = (
    <div className={`relative aspect-[2/3] rounded-xl overflow-hidden bg-[#101012] ring-1 ring-white/10 group ${available ? 'hover:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.85)] transition-shadow' : ''}`}>
      {credit.poster
        ? <img src={credit.poster} alt={credit.title} loading="lazy"
            className={`w-full h-full object-cover ${available ? 'transition-transform duration-500 group-hover:scale-[1.06]' : 'opacity-50 grayscale-[35%]'}`} />
        : <div className="w-full h-full flex items-center justify-center p-3 text-center text-[11px] text-white/40">{credit.title}</div>}
      {available && (
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md text-[9px] font-semibold uppercase tracking-wider text-white/90">
          Sur Nova
        </span>
      )}
      {(credit.budget || credit.revenue) && (
        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex flex-col gap-0.5">
          {credit.budget && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-white/85"><Wallet size={10} /> Budget {fmtMoney(credit.budget)}</span>
          )}
          {credit.revenue && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-white/70"><TrendingUp size={10} /> Box-office {fmtMoney(credit.revenue)}</span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={available ? 'cursor-pointer' : 'cursor-default'}>
      {available
        ? <TiltCard className="w-full" onClick={onClick}>{inner}</TiltCard>
        : inner}
      <p className={`mt-2 text-[12px] font-bold truncate ${available ? 'text-gray-200' : 'text-gray-500'}`}>{credit.title}</p>
      <p className="text-[11px] text-gray-600 truncate">
        {[credit.year, credit.character && `${credit.character}`].filter(Boolean).join(' · ')}
      </p>
      {credit.countries?.length > 0 && (
        <p className="text-[10px] text-gray-700 truncate">{credit.countries.join(', ')}</p>
      )}
    </div>
  );
}

export default function ActorPageV2() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [actor, setActor] = useState(null);
  const [error, setError] = useState(false);
  const [fullBio, setFullBio] = useState(false);

  useEffect(() => {
    let on = true;
    window.scrollTo(0, 0);
    setActor(null); setError(false); setFullBio(false);
    plexService.getActor(name)
      .then((a) => on && setActor(a))
      .catch(() => on && setError(true));
    return () => { on = false; };
  }, [name]);

  if (error) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Acteur introuvable</h1>
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-white transition-colors">Retour</button>
      </div>
    );
  }
  if (!actor) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-indigo-400/30 border-t-indigo-300 rounded-full animate-spin" />
      </div>
    );
  }

  const onNova = actor.credits.filter((c) => c.ratingKey);
  const others = actor.credits.filter((c) => !c.ratingKey);
  const a = age(actor.birthday, actor.deathday);

  return (
    <div className="pt-24 md:pt-28">
      <div className="px-5 md:px-12 max-w-7xl mx-auto">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-sm font-semibold text-white/85 hover:text-white transition-colors mb-8">
          <ArrowLeft size={15} /> Retour
        </button>

        {/* ── identity panel ── */}
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel rounded-3xl p-6 md:p-10 flex flex-col md:flex-row gap-7 md:gap-10 mb-12">
          <div className="shrink-0 mx-auto md:mx-0">
            <div className="w-44 md:w-56 aspect-[2/3] rounded-2xl overflow-hidden ring-1 ring-white/15 shadow-[0_30px_70px_-25px_rgba(0,0,0,0.9)] bg-[#101012]">
              {actor.photo
                ? <img src={actor.photo} alt={actor.name} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-5xl font-black text-white/15">{actor.name?.charAt(0)}</div>}
            </div>
          </div>
          <div className="min-w-0 flex-1 text-center md:text-left">
            <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-3 text-glow">{actor.name}</h1>
            <div className="flex flex-wrap justify-center md:justify-start items-center gap-2 mb-5">
              {actor.department && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold glass-soft text-indigo-200">
                  <Clapperboard size={12} /> {actor.department === 'Acting' ? 'Acteur·rice' : actor.department}
                </span>
              )}
              {actor.birthday && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold glass-soft text-gray-200">
                  <Cake size={12} /> {fmtDate(actor.birthday)}{a != null && !actor.deathday ? ` (${a} ans)` : ''}
                </span>
              )}
              {actor.deathday && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold glass-soft text-gray-400">
                  † {fmtDate(actor.deathday)}{a != null ? ` (à ${a} ans)` : ''}
                </span>
              )}
              {actor.birthPlace && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold glass-soft text-gray-200">
                  <MapPin size={12} /> {actor.birthPlace}
                </span>
              )}
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold glass-soft text-emerald-300">
                {onNova.length} titre{onNova.length > 1 ? 's' : ''} sur Nova
              </span>
            </div>
            {actor.biography ? (
              <>
                <p className={`text-[13px] md:text-[15px] text-white/70 leading-relaxed ${fullBio ? '' : 'line-clamp-4 md:line-clamp-5'}`}>
                  {actor.biography}
                </p>
                {actor.biography.length > 320 && (
                  <button onClick={() => setFullBio(!fullBio)}
                    className="mt-2 text-xs font-bold text-indigo-300 hover:text-indigo-200 transition-colors">
                    {fullBio ? 'Réduire' : 'Lire la suite'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-white/40">Aucune biographie disponible en français.</p>
            )}
          </div>
        </motion.div>

        {/* ── available on Nova ── */}
        {onNova.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mb-12">
            <p className="v2-eyebrow mb-1.5">Disponible maintenant</p>
            <h2 className="text-xl md:text-2xl font-bold mb-6">Sa filmographie sur NovaStream</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 md:gap-5">
              {onNova.map((c) => (
                <CreditCard key={`${c.type}:${c.tmdbId}`} credit={c} onClick={() => navigate(`/title/${c.ratingKey}`)} />
              ))}
            </div>
          </motion.section>
        )}

        {/* ── rest of the filmography ── */}
        {others.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mb-12">
            <h2 className="text-xl md:text-2xl font-bold mb-1.5">Filmographie complète</h2>
            <p className="text-sm text-white/40 mb-6">Titres pas encore disponibles sur Nova.</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
              {others.map((c) => (
                <CreditCard key={`${c.type}:${c.tmdbId}`} credit={c} />
              ))}
            </div>
          </motion.section>
        )}
      </div>
      <FooterV2 />
    </div>
  );
}
