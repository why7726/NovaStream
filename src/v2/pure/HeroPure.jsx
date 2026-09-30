import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Play } from 'lucide-react';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

/* Hero "Pure" — une image, un logo, une phrase, un bouton.
   Pas de parallaxe, pas de dégradé coloré : juste un fondu vers le noir
   et un crossfade lent entre les titres mis en avant. */
export default function HeroPure({ movies = [] }) {
  const navigate = useNavigate();
  const [i, setI] = useState(0);
  const [logos, setLogos] = useState({});

  useEffect(() => {
    if (movies.length <= 1) return;
    const t = setInterval(() => setI((p) => (p + 1) % movies.length), 9000);
    return () => clearInterval(t);
  }, [movies.length]);

  useEffect(() => {
    let on = true;
    movies.forEach(async (m) => {
      try {
        const type = m.type === 'movie' ? 'movie' : 'tv';
        const title = m.grandparentTitle || m.parentTitle || m.title;
        const r = await fetch(`${apiBase()}/api/tmdb-v2/assets/${type}/${encodeURIComponent(title)}`);
        if (!r.ok) return;
        const a = await r.json();
        if (a.logo && on) setLogos((p) => ({ ...p, [m.id]: a.logo }));
      } catch { /* le titre texte suffit */ }
    });
    return () => { on = false; };
  }, [movies]);

  if (!movies.length) return null;
  const m = movies[i];
  const meta = [m.year, m.duration, (m.genres || [])[0]].filter(Boolean).join('  ·  ');

  return (
    <section className="relative w-full h-[86vh] md:h-[92vh] overflow-hidden">
      <AnimatePresence>
        <motion.div key={m.id}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 1.6, ease: 'easeInOut' }}
          className="absolute inset-0">
          <picture>
            <source media="(max-width: 767px)" srcSet={m.poster || m.backdrop} />
            <img src={m.backdrop || m.poster} alt="" fetchpriority="high" decoding="async" className="w-full h-full object-cover object-top md:object-center" />
          </picture>
        </motion.div>
      </AnimatePresence>

      {/* fondu unique vers le noir — rien de plus */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #000 0%, rgba(0,0,0,0.86) 22%, rgba(0,0,0,0.15) 62%, rgba(0,0,0,0.35) 100%)' }} />

      <div className="absolute inset-x-0 bottom-0 pb-24 md:pb-28 px-6 flex flex-col items-center text-center">
        <AnimatePresence mode="wait">
          <motion.div key={`c-${m.id}`}
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
            className="flex flex-col items-center max-w-2xl">
            {logos[m.id]
              ? <img src={logos[m.id]} alt={m.title} className="max-h-[70px] md:max-h-[120px] max-w-[78vw] md:max-w-[440px] object-contain mb-5" />
              : <h1 className="p-display text-[34px] md:text-[64px] mb-5">{m.grandparentTitle || m.parentTitle || m.title}</h1>}

            {meta && <p className="text-[12.5px] md:text-[13px] font-medium tracking-[0.02em] p-dim mb-6">{meta}</p>}

            <div className="flex items-center gap-3">
              <button onClick={() => navigate(m.type === 'movie' ? `/play/${m.id}` : `/title/${m.id}`)} className="p-btn">
                <Play size={16} fill="currentColor" /> {m.type === 'movie' ? 'Lecture' : 'Voir'}
              </button>
              <button onClick={() => navigate(`/title/${m.id}`)} className="p-btn p-btn-ghost">Plus d'infos</button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {movies.length > 1 && (
        <div className="absolute bottom-[86px] md:bottom-10 inset-x-0 flex justify-center gap-1.5">
          {movies.map((_, k) => (
            <button key={k} onClick={() => setI(k)} aria-label={`Titre ${k + 1}`}
              className={`h-[3px] rounded-full transition-all duration-500 ${k === i ? 'w-6 bg-white' : 'w-[3px] bg-white/35 hover:bg-white/60'}`} />
          ))}
        </div>
      )}
    </section>
  );
}
