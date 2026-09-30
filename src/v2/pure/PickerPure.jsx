import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';

/* Sélecteur "Pure" — remplace le <select> natif, dont l'apparence est
   imposée par le système (boîte grise, ronds bleus, « Effectué »).

   Mobile  : feuille qui monte du bas, façon iOS.
   Desktop : petit menu ancré sous le bouton.
   Dans les deux cas : verre sombre, coche blanche, aucune couleur. */
export default function PickerPure({ label, value, options, onPick, title }) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Menu desktop : fermeture au clic extérieur
  useEffect(() => {
    if (!open || isMobile) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, isMobile]);

  // Feuille mobile : on bloque le défilement de la page derrière
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const current = options.find((o) => String(o.value) === String(value));
  const choose = (v) => { setOpen(false); if (String(v) !== String(value)) onPick(v); };

  const Row = ({ o }) => {
    const active = String(o.value) === String(value);
    return (
      <button onClick={() => choose(o.value)}
        className="w-full flex items-center gap-3 px-4 py-3.5 md:py-2.5 rounded-xl text-left hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors">
        <span className={`flex-1 text-[16px] md:text-[13.5px] ${active ? 'font-semibold text-white' : 'font-normal text-white/80'}`}>
          {o.label}
        </span>
        {active && <Check size={17} strokeWidth={2.6} className="shrink-0" />}
      </button>
    );
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button onClick={() => setOpen((o) => !o)}
        className="h-9 pl-4 pr-3 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[13px] font-medium text-white flex items-center gap-1.5 transition-colors">
        {current?.label || label}
        <ChevronDown size={14} className="opacity-50" />
      </button>

      {/* ── Desktop : menu ancré ── */}
      {open && !isMobile && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
          className="absolute right-0 top-11 z-50 min-w-[200px] max-h-[340px] overflow-y-auto no-scrollbar rounded-2xl bg-[#141416]/95 backdrop-blur-2xl border border-white/10 p-1.5">
          {options.map((o) => <Row key={String(o.value)} o={o} />)}
        </motion.div>
      )}

      {/* ── Mobile : feuille qui monte du bas ── */}
      {isMobile && createPortal(
        // le portail sort du calque .nova-pure : on le réapplique ici
        <div className="nova-v2 nova-pure">
        <AnimatePresence>
          {open && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm" />

              <motion.div
                initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.4 }}
                onDragEnd={(e, info) => { if (info.offset.y > 90) setOpen(false); }}
                className="fixed inset-x-0 bottom-0 z-[131] rounded-t-[22px] bg-[#1c1c1e]/96 backdrop-blur-2xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
                {/* poignée */}
                <div className="pt-2.5 pb-1 flex justify-center">
                  <span className="w-9 h-1 rounded-full bg-white/25" />
                </div>
                {title && (
                  <p className="px-5 pt-1.5 pb-2 text-[13px] font-medium text-white/45">{title}</p>
                )}
                <div className="px-1.5 pb-2 max-h-[58vh] overflow-y-auto no-scrollbar">
                  {options.map((o) => <Row key={String(o.value)} o={o} />)}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
        </div>,
        document.body
      )}
    </div>
  );
}
