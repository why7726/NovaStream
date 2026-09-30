import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, X } from 'lucide-react';

/* Barre de filtres "Pure" — des pastilles discrètes qui ouvrent un petit
   menu, façon barre de tri d'Apple TV. Rien ne s'affiche tant que rien
   n'est choisi : au repos, la barre est presque invisible. */

function Dropdown({ label, value, options, onPick, title }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [mobile, setMobile] = useState(false);
  const btn = useRef(null);
  const panel = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /* Le menu est rendu dans <body>, en position fixe. C'est indispensable :
     la barre de filtres défile horizontalement (overflow-x), et tout menu
     posé à l'intérieur s'y faisait DÉCOUPER — il s'ouvrait sans qu'on le
     voie jamais, d'où l'impression que les filtres ne marchaient pas. */
  const ouvrir = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const largeur = 210;
      setPos({
        top: r.bottom + 8,
        left: Math.min(Math.max(8, r.left), window.innerWidth - largeur - 8),
        largeur,
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const dehors = (e) => {
      if (btn.current?.contains(e.target)) return;
      if (panel.current?.contains(e.target)) return;
      setOpen(false);
    };
    const echap = (e) => { if (e.key === 'Escape') setOpen(false); };
    // pointerdown couvre la souris ET le tactile
    document.addEventListener('pointerdown', dehors);
    window.addEventListener('keydown', echap);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener('pointerdown', dehors);
      window.removeEventListener('keydown', echap);
    };
  }, [open]);

  const active = value != null && value !== '';
  const current = options.find((o) => o.value === value);
  const choisir = (v) => { setOpen(false); onPick(v === value ? null : v); };

  const lignes = options.map((o) => {
    const coche = o.value === value;
    return (
      <button key={String(o.value)} onClick={() => choisir(o.value)}
        className="w-full flex items-center gap-2.5 px-3.5 py-3 md:py-2.5 rounded-xl hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors text-left">
        <Check size={15} className={coche ? 'opacity-100' : 'opacity-0'} />
        <span className={`flex-1 text-[15px] md:text-[13.5px] ${coche ? 'font-semibold text-white' : 'text-white/80'}`}>{o.label}</span>
        {o.count != null && <span className="text-[11px] text-white/30">{o.count}</span>}
      </button>
    );
  });

  return (
    <>
      <button ref={btn} onClick={() => (open ? setOpen(false) : ouvrir())}
        className={`h-9 pl-3.5 pr-2.5 rounded-full text-[13px] font-medium flex items-center gap-1.5 shrink-0 transition-colors ${
          active ? 'bg-white text-black' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.14]'
        }`}>
        {active ? current?.label || label : label}
        <ChevronDown size={13} className={active ? 'opacity-60' : 'opacity-45'} />
      </button>

      {open && createPortal(
        <div className="nova-v2 nova-pure">
          {/* voile de fermeture, invisible sur desktop */}
          <div className="fixed inset-0 z-[130] md:bg-transparent bg-black/50 md:backdrop-blur-0 backdrop-blur-sm" />

          {mobile ? (
            <div ref={panel}
              className="fixed inset-x-0 bottom-0 z-[131] rounded-t-[22px] bg-[#1c1c1e]/96 backdrop-blur-2xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
              <div className="pt-2.5 pb-1 flex justify-center"><span className="w-9 h-1 rounded-full bg-white/25" /></div>
              <p className="px-5 pt-1.5 pb-2 text-[13px] font-medium text-white/45">{title || label}</p>
              <div className="px-1.5 pb-2 max-h-[58vh] overflow-y-auto no-scrollbar">{lignes}</div>
            </div>
          ) : (
            <div ref={panel} style={{ top: pos?.top, left: pos?.left, width: pos?.largeur }}
              className="fixed z-[131] max-h-[340px] overflow-y-auto no-scrollbar rounded-2xl bg-[#141416]/96 backdrop-blur-2xl border border-white/10 p-1.5">
              {lignes}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

export default function FilterBar({ genres = [], value, onChange, onReset, count }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  const dirty = !!(value.genre || value.decade || value.rating || value.length || value.unseen || (value.sort && value.sort !== 'default'));

  return (
    <div className="px-5 md:px-8 mb-6">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        <Dropdown label="Genre" title="Filtrer par genre" value={value.genre} onPick={set('genre')}
          options={genres.map((g) => ({ value: g.name, label: g.name, count: g.count }))} />

        <Dropdown label="Époque" title="Filtrer par époque" value={value.decade} onPick={set('decade')}
          options={[
            { value: '2020', label: 'Depuis 2020' },
            { value: '2010', label: 'Années 2010' },
            { value: '2000', label: 'Années 2000' },
            { value: '1990', label: 'Années 90' },
            { value: '1980', label: 'Années 80' },
            { value: 'old', label: 'Avant 1980' },
          ]} />

        <Dropdown label="Durée" title="Filtrer par durée" value={value.length} onPick={set('length')}
          options={[
            { value: 'short', label: 'Moins de 1 h 35' },
            { value: 'mid', label: '1 h 35 – 2 h 25' },
            { value: 'long', label: 'Plus de 2 h 25' },
          ]} />

        <Dropdown label="Note" title="Filtrer par note" value={value.rating} onPick={set('rating')}
          options={[
            { value: 8, label: '8 et plus' },
            { value: 7, label: '7 et plus' },
            { value: 6, label: '6 et plus' },
          ]} />

        <button onClick={() => set('unseen')(value.unseen ? null : true)}
          className={`h-9 px-3.5 rounded-full text-[13px] font-medium shrink-0 transition-colors ${
            value.unseen ? 'bg-white text-black' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.14]'
          }`}>
          Non vus
        </button>

        <Dropdown label="Trier" title="Trier par" value={value.sort} onPick={set('sort')}
          options={[
            { value: 'recent', label: 'Ajouts récents' },
            { value: 'rating', label: 'Mieux notés' },
            { value: 'year', label: 'Plus récents' },
            { value: 'az', label: 'A → Z' },
          ]} />

        {dirty && (
          <button onClick={onReset}
            className="h-9 px-3 rounded-full text-[13px] font-medium text-white/45 hover:text-white shrink-0 flex items-center gap-1.5 transition-colors">
            <X size={13} /> Effacer
          </button>
        )}
      </div>

      {dirty && count != null && (
        <p className="text-[12px] p-faint mt-2">{count} titre{count > 1 ? 's' : ''}</p>
      )}
    </div>
  );
}
