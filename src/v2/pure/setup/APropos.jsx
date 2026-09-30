import React from 'react';
import { Github } from 'lucide-react';
import { CREDITS } from '../../../credits';
import { Carte } from './ui';

export default function APropos() {
  return (
    <Carte id="a-propos" titre="À propos"
      sousTitre={`NovaStream — créé par ${CREDITS.auteur}, co-créé avec ${CREDITS.coAuteur}.`}>
      <div className="flex flex-wrap gap-2">
        <a href={CREDITS.depot} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[13px] font-semibold transition-colors">
          <Github size={15} /> Le projet sur GitHub
        </a>
        <a href={CREDITS.github} target="_blank" rel="noreferrer"
          className="inline-flex items-center h-9 px-4 rounded-full text-[13px] text-white/55 hover:text-white transition-colors">
          @{CREDITS.auteur}
        </a>
      </div>
    </Carte>
  );
}
