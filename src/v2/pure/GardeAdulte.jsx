import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import plexService from '../../services/plexService';
import { tr } from '../../i18n';

/* Avertissement « contenu +18 » avant une bibliothèque, une fiche ou une
   lecture marquée adulte. Le serveur ne montre ce contenu qu'aux comptes
   autorisés : ceci n'est pas une protection, c'est une confirmation — on ne
   tombe pas dessus par erreur. Accepté une fois par session de navigation. */

const CLE = 'nova_18_ok';
const accepte = () => { try { return sessionStorage.getItem(CLE) === '1'; } catch { return false; } };

export function useAdulte(id) {
  const [adulte, setAdulte] = useState(null);   // null = on ne sait pas encore
  useEffect(() => {
    let on = true;
    if (!id) { setAdulte(false); return undefined; }
    plexService.getMetadata(id)
      .then((m) => { if (on) setAdulte(!!m?.adulte); })
      .catch(() => { if (on) setAdulte(false); });
    return () => { on = false; };
  }, [id]);
  return adulte;
}

export function Avertissement({ onAccepte }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-6 py-24">
      <div className="max-w-[440px] text-center">
        <span className="mx-auto mb-6 w-16 h-16 rounded-full bg-red-500/12 text-red-300 flex items-center justify-center">
          <ShieldAlert size={30} strokeWidth={1.8} />
        </span>
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-red-300/80 mb-2">{tr('Contenu +18')}</p>
        <h1 className="text-[26px] md:text-[30px] font-semibold tracking-[-0.03em] leading-tight">{tr('Réservé aux adultes')}</h1>
        <p className="text-[14px] text-white/55 mt-3 leading-relaxed">
          {tr('Ce contenu contient des scènes explicites réservées à un public majeur. Continue uniquement si tu as 18 ans ou plus.')}
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5 justify-center mt-8">
          <button onClick={() => { try { sessionStorage.setItem(CLE, '1'); } catch {} onAccepte(); }}
            className="h-[46px] px-7 rounded-full bg-white text-black text-[14.5px] font-semibold hover:opacity-90 transition-opacity">
            {tr('J\'ai 18 ans ou plus — continuer')}
          </button>
          <button onClick={() => navigate('/')}
            className="h-[46px] px-7 rounded-full bg-white/[0.08] text-white text-[14.5px] font-semibold hover:bg-white/[0.14] transition-colors">
            {tr('Retour à l\'accueil')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Enveloppe une page : `adulte` connu (bibliothèque) ou déduit de l'élément `id`. */
export default function GardeAdulte({ id, adulte: connu, children }) {
  const deduit = useAdulte(connu === undefined ? id : null);
  const adulte = connu !== undefined ? connu : deduit;
  const [ok, setOk] = useState(accepte());
  if (adulte === null) return null;              // un instant : on vérifie
  if (adulte && !ok) return <Avertissement onAccepte={() => setOk(true)} />;
  return children;
}
