import React, { useState } from 'react';
import { motion } from 'framer-motion';
import authService from '../../../services/authService';
import { tr, setLangue, appliquerLangue, useLangue } from '../../../i18n';
import ChoixLangue from './ChoixLangue';

/* Premier passage d'un compte tout neuf (utilisateur comme administrateur) :
   un mot d'accueil et les préférences de départ — pour l'instant la langue.
   Les textes changent EN DIRECT quand on choisit une langue ; on n'écrit sur
   le compte qu'au moment de continuer. */

export default function Bienvenue({ user, onTermine }) {
  const langue = useLangue();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');

  const continuer = async () => {
    setEnvoi(true); setErreur('');
    try {
      const u = await authService.savePreferences({ langue, bienvenueVue: 1 });
      onTermine(u);
      appliquerLangue(langue);   // recharge si la langue a changé depuis l'ouverture
    } catch (e) {
      setErreur(e.message);
      setEnvoi(false);
    }
  };

  return (
    <div className="nova-v2 nova-pure min-h-screen bg-[#060606] text-white flex items-center justify-center p-5">
      <motion.div className="w-full max-w-[520px]"
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}>
        <div className="flex items-baseline gap-1.5 mb-12">
          <span className="text-[20px] font-semibold tracking-[-0.03em]">Nova</span>
          <span className="text-[20px] font-light tracking-[-0.03em] text-white/60">Stream</span>
        </div>

        <h1 className="text-[34px] md:text-[42px] font-semibold tracking-[-0.04em] leading-[1.05]">
          {tr('Bienvenue sur NovaStream')}{user?.username ? <span className="text-white/40">, {user.username}</span> : null}
        </h1>
        <p className="text-[15px] text-white/50 mt-4 mb-10 leading-relaxed max-w-md">
          {user?.isAdmin
            ? tr('Avant de configurer ton serveur, une seule question : dans quelle langue veux-tu NovaStream ?')
            : tr('Avant de commencer, une seule question : dans quelle langue veux-tu NovaStream ?')}
        </p>

        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/35 mb-3">{tr('Langue')}</p>
        <ChoixLangue valeur={langue} onChange={setLangue} />
        <p className="text-[12px] text-white/35 mt-3">{tr('Tu pourras la changer à tout moment dans tes préférences.')}</p>

        {erreur && <p className="text-[13px] text-red-300/90 mt-6">{erreur}</p>}

        <button onClick={continuer} disabled={envoi}
          className="mt-10 w-full sm:w-auto h-[50px] px-10 rounded-full bg-white text-black text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
          {envoi ? tr('Un instant…') : tr('Continuer')}
        </button>
      </motion.div>
    </div>
  );
}
