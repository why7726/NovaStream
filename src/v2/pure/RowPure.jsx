import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import CardPure from './CardPure';
import { slugify } from './CollectionPure';

/* Rangée "Pure" — un titre, un rail. Le titre est cliquable : il déplie la
   catégorie en grille. Les flèches n'apparaissent qu'au survol sur desktop. */
export default function RowPure({
  title,
  items = [],
  variant = 'poster',
  watchedIds,
  progressMap,
  camIds,
  showTitles = true,
  seeAll = true,
  renderCard,
}) {
  const rail = useRef(null);
  const navigate = useNavigate();
  if (!items.length) return null;

  /* Les flèches tournent la « page » du rail et s'arrêtent TOUJOURS sur une
     carte, alignée sur la marge — jamais au milieu d'une affiche. */
  const by = (dir) => {
    const el = rail.current;
    if (!el) return;
    const marge = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
    const cartes = [...el.children];
    let carte;
    if (dir > 0) {
      // la première carte qui ne tient pas entièrement à l'écran devient la première
      const bordDroit = el.scrollLeft + el.clientWidth - marge;
      carte = cartes.find((c) => c.offsetLeft + c.offsetWidth > bordDroit + 1) || cartes[cartes.length - 1];
      if (carte.offsetLeft - marge <= el.scrollLeft + 1) carte = cartes[cartes.indexOf(carte) + 1] || carte;
    } else {
      const cible = el.scrollLeft - (el.clientWidth - 2 * marge);
      carte = cartes.find((c) => c.offsetLeft - marge >= cible - 1) || cartes[0];
    }
    el.scrollTo({ left: Math.max(0, carte.offsetLeft - marge), behavior: 'smooth' });
  };
  const openAll = () => navigate(`/collection/${slugify(title)}`, { state: { title, items } });

  return (
    <section data-row className="group/row relative mb-10 md:mb-14">
      <div className="px-5 md:px-8 mb-3.5 md:mb-4">
        {seeAll ? (
          <button onClick={openAll} className="group/h inline-flex items-baseline gap-1.5">
            <h2 className="p-title text-[17px] md:text-[22px]">{title}</h2>
            <span className="text-[13px] text-white/0 group-hover/h:text-white/50 transition-colors">Tout voir ›</span>
          </button>
        ) : (
          <h2 className="p-title text-[17px] md:text-[22px]">{title}</h2>
        )}
      </div>

      <div ref={rail} className="p-rail p-marge gap-3 md:gap-4 px-5 md:px-8 pb-1">
        {items.map((it, k) => (
          renderCard
            ? renderCard(it, k)
            : <CardPure key={it.id || k} item={it} variant={variant} showTitle={showTitles}
                watched={watchedIds?.has(it.id)} progress={progressMap?.[it.id] || 0} camIds={camIds} />
        ))}
      </div>

      <button onClick={() => by(-1)} aria-label="Précédent"
        className="hidden md:flex absolute left-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 backdrop-blur-md items-center justify-center text-white/85 opacity-0 group-hover/row:opacity-100 transition-opacity">
        <ChevronLeft size={18} />
      </button>
      <button onClick={() => by(1)} aria-label="Suivant"
        className="hidden md:flex absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 backdrop-blur-md items-center justify-center text-white/85 opacity-0 group-hover/row:opacity-100 transition-opacity">
        <ChevronRight size={18} />
      </button>
    </section>
  );
}
