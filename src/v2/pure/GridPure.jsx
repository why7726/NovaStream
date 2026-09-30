import React from 'react';
import CardPure from './CardPure';

/* Grille "Pure" — le même dessin de carte que les rails, en grille fluide.
   Sert aux pages Favoris / Acteur / résultats. */
export default function GridPure({ items = [], watchedIds, camIds, variant = 'poster', onPick }) {
  if (!items.length) return null;
  return (
    <div data-row className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-3 md:gap-4">
      {items.map((it) => (
        <CardPure key={it.id} item={it} variant={variant} width="w-full"
          watched={watchedIds?.has(it.id)} camIds={camIds}
          onClick={onPick ? () => onPick(it) : undefined} />
      ))}
    </div>
  );
}
