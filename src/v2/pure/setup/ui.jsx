import React, { useState } from 'react';
import { Check, AlertCircle, Eye, EyeOff, ExternalLink } from 'lucide-react';

/* Briques communes de la page Réglages — même langage que le reste de Pure :
   surfaces à peine teintées, un seul bouton blanc par action principale. */

export function Carte({ id, titre, sousTitre, badge, children }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-[22px] bg-white/[0.035] border border-white/[0.06] p-5 md:p-7">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h2 className="text-[17px] md:text-[19px] font-semibold tracking-[-0.02em]">{titre}</h2>
          {sousTitre && <p className="text-[13px] text-white/45 mt-1 leading-relaxed">{sousTitre}</p>}
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function Pastille({ actif, texteActif = 'Actif', texteInactif = 'Non configuré' }) {
  return actif ? (
    <span className="shrink-0 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-emerald-400/12 text-emerald-300 text-[11.5px] font-medium">
      <Check size={11} strokeWidth={3} /> {texteActif}
    </span>
  ) : (
    <span className="shrink-0 inline-flex items-center h-6 px-2.5 rounded-full bg-white/[0.07] text-white/45 text-[11.5px] font-medium">
      {texteInactif}
    </span>
  );
}

export function Champ({ label, valeur, onChange, placeholder, secret = false, aide, note }) {
  const [voir, setVoir] = useState(false);
  return (
    <label className="block">
      <span className="flex items-end justify-between gap-3 text-[12px] font-medium text-white/55 mb-1.5">
        <span className="min-w-0">{label}</span>
        {aide && (
          <a href={aide} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
            className="shrink-0 whitespace-nowrap inline-flex items-center gap-1 text-white/35 hover:text-white/70 transition-colors font-normal">
            Où la trouver <ExternalLink size={11} />
          </a>
        )}
      </span>
      <span className="relative block">
        <input value={valeur} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          type={secret && !voir ? 'password' : 'text'} autoComplete="off" spellCheck={false}
          className="w-full h-11 bg-black/25 border border-white/[0.08] rounded-xl px-3.5 pr-10 text-[13.5px] text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 transition-colors" />
        {secret && (
          <button type="button" onClick={() => setVoir(!voir)} aria-label={voir ? 'Masquer' : 'Afficher'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70">
            {voir ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </span>
      {note && <span className="block text-[11.5px] text-white/35 mt-1.5">{note}</span>}
    </label>
  );
}

export function Bouton({ children, onClick, disabled, variante = 'plein', type = 'button' }) {
  const styles = {
    plein: 'bg-white text-black hover:opacity-90',
    doux: 'bg-white/[0.08] text-white hover:bg-white/[0.14]',
    discret: 'text-white/50 hover:text-white',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`h-9 px-4 rounded-full text-[13px] font-semibold transition disabled:opacity-35 ${styles[variante]}`}>
      {children}
    </button>
  );
}

export function Message({ ok, children, className = '' }) {
  return (
    <p className={`flex items-start gap-2 text-[12.5px] leading-relaxed ${ok ? 'text-emerald-300/90' : 'text-red-300/90'} ${className}`}>
      {ok ? <Check size={14} className="shrink-0 mt-[2px]" /> : <AlertCircle size={14} className="shrink-0 mt-[2px]" />}
      <span>{children}</span>
    </p>
  );
}
