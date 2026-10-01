import React, { useState } from 'react';
import authService from '../../../services/authService';
import { tr, langueActuelle, appliquerLangue } from '../../../i18n';
import ChoixLangue from './ChoixLangue';
import useRetour from '../useRetour';
import { ChevronLeft } from 'lucide-react';

/* Préférences du compte — pour tout le monde, administrateur compris.
   Pour l'instant : la langue. Chaque réglage s'applique dès qu'on le
   touche, sans bouton « Enregistrer » (comme sur Apple TV). */

export default function PreferencesPure() {
  const retour = useRetour('/');
  const [langue, setLangueChoisie] = useState(langueActuelle());
  const [erreur, setErreur] = useState('');

  const choisirLangue = async (l) => {
    if (l === langue) return;
    setLangueChoisie(l); setErreur('');
    try {
      await authService.savePreferences({ langue: l });
      appliquerLangue(l);   // la page se recharge dans la nouvelle langue
    } catch (e) {
      setErreur(e.message);
      setLangueChoisie(langueActuelle());
    }
  };

  return (
    <div className="max-w-[720px] mx-auto px-5 md:px-8 pt-20 md:pt-24 pb-32">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={retour} aria-label={tr('Retour')}
          className="w-9 h-9 -ml-1.5 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h1 className="p-display text-[26px] md:text-[38px]">{tr('Préférences')}</h1>
      </div>
      <p className="text-[13.5px] p-dim mb-10 leading-relaxed">
        {tr('Elles suivent ton compte : tu les retrouves sur tous tes appareils.')}
      </p>

      <section>
        <h2 className="text-[17px] font-semibold tracking-[-0.02em] mb-1">{tr('Langue')}</h2>
        <p className="text-[13px] text-white/45 mb-4">
          {tr('La langue de l\'interface. Les titres et résumés des films restent ceux de la bibliothèque.')}
        </p>
        <ChoixLangue valeur={langue} onChange={choisirLangue} />
        {erreur && <p className="text-[13px] text-red-300/90 mt-3">{erreur}</p>}
      </section>
    </div>
  );
}
