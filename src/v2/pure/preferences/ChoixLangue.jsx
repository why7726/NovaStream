import React from 'react';
import { Check } from 'lucide-react';
import { tr } from '../../../i18n';

/* Deux grandes cartes, pas une liste déroulante : on voit d'un coup
   d'œil les deux choix, chacun écrit dans SA langue. */
const CHOIX = [
  { id: 'fr', nom: 'Français', exemple: 'Reprendre · Ma liste · Ce soir' },
  { id: 'en', nom: 'English', exemple: 'Continue watching · My list · Tonight' },
];

export default function ChoixLangue({ valeur, onChange }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label={tr('Langue')}>
      {CHOIX.map((c) => {
        const on = c.id === valeur;
        return (
          <button key={c.id} role="radio" aria-checked={on} onClick={() => onChange(c.id)}
            className={`relative text-left p-5 rounded-[20px] border transition-all ${on
              ? 'bg-white text-black border-white'
              : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08] text-white'}`}>
            <span className="block text-[19px] font-semibold tracking-[-0.02em]" lang={c.id}>{c.nom}</span>
            <span className={`block text-[12.5px] mt-1 ${on ? 'text-black/50' : 'text-white/40'}`} lang={c.id}>{c.exemple}</span>
            {on && (
              <span className="absolute top-4 right-4 w-6 h-6 rounded-full bg-black text-white flex items-center justify-center">
                <Check size={13} strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
