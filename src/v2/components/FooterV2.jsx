import React from 'react';
import { useNavigate } from 'react-router-dom';

import { tr } from '../../i18n';
// Catalog-style footer (NAKIOS-like): brand + navigation columns.
export default function FooterV2() {
  const navigate = useNavigate();
  const go = (path) => () => navigate(path);

  return (
    <footer className="mt-10 px-4 md:px-12 pt-10 pb-32 md:pb-12 border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center">
              <span className="text-white font-black">N</span>
            </div>
            <span className="font-bold text-lg">{'NovaStream'}</span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed max-w-[220px]">
            {tr('Ta plateforme de streaming personnelle. Films, séries et bien plus, par-dessus ton serveur Plex.')}
          </p>
        </div>

        <div>
          <p className="v2-eyebrow mb-3">{tr('Navigation')}</p>
          <ul className="space-y-2 text-sm text-gray-400">
            <li><button onClick={go('/')} className="hover:text-white transition-colors">{tr('Accueil')}</button></li>
            <li><button onClick={go('/movies')} className="hover:text-white transition-colors">{tr('Films')}</button></li>
            <li><button onClick={go('/shows')} className="hover:text-white transition-colors">{tr('Séries')}</button></li>
            <li><button onClick={go('/favorites')} className="hover:text-white transition-colors">{tr('Ma liste')}</button></li>
          </ul>
        </div>

        <div>
          <p className="v2-eyebrow mb-3">{tr('Mon espace')}</p>
          <ul className="space-y-2 text-sm text-gray-400">
            <li><button onClick={go('/history')} className="hover:text-white transition-colors">{tr('Historique')}</button></li>
            <li><button onClick={go('/favorites')} className="hover:text-white transition-colors">{tr('Favoris')}</button></li>
          </ul>
        </div>

        <div>
          <p className="v2-eyebrow mb-3">{tr('Version')}</p>
          <p className="text-sm text-gray-400">{tr('NovaStream V2 · Bêta')}</p>
          <p className="text-xs text-gray-600 mt-1">{tr('Interface Spatial Cinema')}</p>
        </div>
      </div>
    </footer>
  );
}
