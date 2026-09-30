import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

/* Résumé au premier plan, façon Apple TV : un panneau sombre centré, du texte
   confortable à lire, rien d'autre.

   Le rendu passe OBLIGATOIREMENT par un portail vers <body> : les rangées
   portent `content-visibility: auto`, qui crée un contexte de confinement où
   un `position: fixed` se retrouve piégé dans la page. */
export default function SynopsisPure({ title, text, meta, onClose }) {
  useEffect(() => {
    const echap = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', echap);
    // on bloque le défilement du fond pendant la lecture
    const avant = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', echap);
      document.body.style.overflow = avant;
    };
  }, [onClose]);

  return createPortal(
    <div className="nova-v2 nova-pure">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }} onClick={onClose}
        className="fixed inset-0 z-[140] bg-black/70 backdrop-blur-sm" />

      <div className="fixed inset-0 z-[141] flex items-end md:items-center justify-center p-0 md:p-6 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.985 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          className="pointer-events-auto w-full md:max-w-[620px] max-h-[86vh] md:max-h-[76vh] flex flex-col
                     rounded-t-[22px] md:rounded-[22px] bg-[#141416]/95 backdrop-blur-2xl border border-white/10
                     pb-[env(safe-area-inset-bottom)]">
          {/* poignée, seulement sur téléphone */}
          <div className="md:hidden pt-2.5 pb-0.5 flex justify-center shrink-0">
            <span className="w-9 h-1 rounded-full bg-white/25" />
          </div>

          <div className="flex items-start gap-3 px-5 md:px-7 pt-4 md:pt-6 pb-3 shrink-0">
            <div className="flex-1 min-w-0">
              <h2 className="p-title text-[19px] md:text-[22px] truncate">{title}</h2>
              {meta && <p className="text-[12px] p-faint mt-1 truncate">{meta}</p>}
            </div>
            <button onClick={onClose} aria-label="Fermer"
              className="shrink-0 w-8 h-8 -mr-1 rounded-full flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] transition-colors">
              <X size={17} />
            </button>
          </div>

          <div className="px-5 md:px-7 pb-6 md:pb-7 overflow-y-auto no-scrollbar">
            <p className="text-[14.5px] md:text-[15.5px] text-white/80 leading-[1.62] whitespace-pre-line">{text}</p>
          </div>
        </motion.div>
      </div>
    </div>,
    document.body
  );
}
