import React from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Lock } from 'lucide-react';
import authService from '../../services/authService';

/* Une fonction optionnelle dont la clé API n'est pas renseignée.
   L'administrateur voit quoi faire (et un lien direct vers le bon réglage) ;
   les autres savent simplement que la fonction n'est pas activée. */

const NOMS = {
  soustitres: { service: 'OpenSubtitles', quoi: 'la recherche de sous-titres en ligne' },
  assistant: { service: 'Gemini', quoi: "l'assistant « Dis-moi ta soirée »" },
  tmdb: { service: 'TMDB', quoi: 'les affiches HD, bandes-annonces et demandes de films' },
  arr: { service: 'Radarr / Sonarr', quoi: 'la recherche automatique des demandes' },
  qbit: { service: 'qBittorrent', quoi: 'le suivi des téléchargements' },
};

export default function Indisponible({ feature, compact = false, className = '' }) {
  const navigate = useNavigate();
  const admin = !!authService.getUser()?.isAdmin;
  const n = NOMS[feature] || { service: 'ce service', quoi: 'cette fonction' };

  if (admin) {
    return (
      <div className={`rounded-2xl bg-white/[0.05] ${compact ? 'p-3.5' : 'p-5'} ${className}`}>
        <div className="flex items-start gap-3">
          <KeyRound size={17} className="shrink-0 mt-0.5 text-white/50" />
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-white/85">Configure la clé API {n.service}</p>
            <p className="text-[12px] text-white/45 mt-1 leading-relaxed">
              Elle active {n.quoi}. Tant qu'elle manque, les utilisateurs voient que la fonction n'est pas activée.
            </p>
            <button onClick={() => navigate(`/reglages#${feature}`)}
              className="mt-3 h-8 px-4 rounded-full bg-white text-black text-[12.5px] font-semibold hover:opacity-90 transition-opacity">
              Ouvrir les réglages
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 rounded-2xl bg-white/[0.04] ${compact ? 'p-3' : 'p-4'} ${className}`}>
      <Lock size={15} className="shrink-0 text-white/40" />
      <p className="text-[13px] text-white/50">L'administrateur n'a pas activé cette fonction.</p>
    </div>
  );
}
