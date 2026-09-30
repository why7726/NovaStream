import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/* Retour arrière FIABLE.

   `navigate(-1)` ne fait rien quand il n'y a rien derrière : c'est le cas dès
   qu'on ouvre Nova directement sur une fiche — application installée sur
   l'écran d'accueil, lien partagé, onglet rechargé, ou reprise après le
   rechargement automatique des chunks périmés. La flèche semblait alors
   « ne pas marcher du tout », sans que le bouton soit en cause.

   React Router numérote ses entrées dans `history.state.idx` : à 0, on est sur
   la première page de la session, donc il n'y a pas de retour possible et on
   va vers une destination de repli.

   @param {string} secours où aller quand il n'y a pas d'historique
*/
export default function useRetour(secours = '/') {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = window.history.state?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate(secours, { replace: true });
  }, [navigate, secours]);
}
