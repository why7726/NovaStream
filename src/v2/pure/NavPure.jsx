import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, User, Home, Film, Tv, Heart, Clock, Sparkles, ShieldCheck, PlusCircle, LogOut, Check, Popcorn, Compass, Link2, Settings, Library } from 'lucide-react';
import authService from '../../services/authService';
import SearchPure from './SearchPure';
import { useLibraries, libraryKind } from '../lib/libraries';
import { useFeatures } from '../lib/features';

import { pushStatus, subscribePush, unsubscribePush } from '../lib/pushService';

/* Navigation "Pure" — une ligne de texte, rien d'autre.
   Desktop : liens texte centrés, fond qui se voile au scroll.
   Mobile  : barre d'onglets translucide en bas (icône + micro-label). */

/* Accueil, puis une entrée par bibliothèque du serveur — sous le nom qu'elle y
   porte (« Films FR », « Animés »…), dans l'ordre choisi dans les réglages —,
   puis Favoris. */
const HOME = { id: 'home', label: 'Accueil', path: '/', icon: Home };
const FAVS = { id: 'favorites', label: 'Favoris', path: '/favorites', icon: Heart };
const ICONES = { movie: Film, show: Tv, anime: Sparkles };
// La barre du téléphone n'a de place que pour trois bibliothèques ; les
// suivantes passent dans le menu du compte.
const MAX_MOBILE = 3;

function MenuRow({ icon: Icon, children, onClick, tone = '' }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] font-medium hover:bg-white/[0.08] transition-colors ${tone || 'text-white/90'}`}>
      <Icon size={17} className="opacity-60" /> <span className="flex-1 text-left">{children}</span>
    </button>
  );
}

export default function NavPure() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const user = authService.getUser();

  const [push, setPush] = useState({ supported: false, subscribed: false });
  const [pushBusy, setPushBusy] = useState(false);

  // État des notifications, relu à chaque ouverture du menu
  useEffect(() => {
    if (!menu) return;
    pushStatus().then(setPush).catch(() => {});
  }, [menu]);

  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (push.subscribed) await unsubscribePush();
      else await subscribePush();
      setPush(await pushStatus());
    } catch (e) {
      alert(e.message || 'Notifications indisponibles');
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const { libraries } = useLibraries();
  // Le connecteur « Mon compte Plex » n'a de sens qu'avec un serveur Plex.
  const features = useFeatures();
  const connecteurs = features?.serveurType !== 'jellyfin';
  const libItems = libraries.map((l) => ({
    id: `lib-${l.key}`, label: l.title, path: `/bibliotheque/${l.key}`, icon: ICONES[libraryKind(l)] || Film,
  }));
  const items = [HOME, ...libItems, FAVS];
  const mobileItems = [HOME, ...libItems.slice(0, MAX_MOBILE), FAVS];
  const horsBarre = libItems.slice(MAX_MOBILE);
  const active = items.find((i) => i.path === pathname)?.id || (pathname === '/' ? 'home' : null);
  const initial = user?.username?.charAt(0).toUpperCase();

  const avatar = (
    <span className="w-8 h-8 rounded-full overflow-hidden bg-white/12 text-[13px] font-semibold flex items-center justify-center">
      {user?.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : (initial || <User size={15} />)}
    </span>
  );

  return (
    <>
      {/* ── Barre haute ──
          AUCUN floutage, aucune bande : seul un dégradé très léger garde le
          logo lisible sur une affiche claire. Les éléments flottent
          directement sur l'image — la bulle de verre se suffit à elle-même. */}
      <header className={`fixed top-0 inset-x-0 z-50 pointer-events-none transition-opacity duration-300 ${
        scrolled ? 'bg-gradient-to-b from-black/55 via-black/20 to-transparent' : 'bg-gradient-to-b from-black/30 to-transparent'
      }`}>
        {/* le dégradé ne capte pas les clics, seuls les éléments le font */}
        <div className="max-w-[1400px] mx-auto h-14 md:h-[58px] px-4 md:px-8 flex items-center justify-between [&>*]:pointer-events-auto">
          <button onClick={() => navigate('/')} className="flex items-baseline gap-1.5 shrink-0">
            <span className="text-[17px] font-semibold tracking-[-0.03em]">Nova</span>
            <span className="text-[17px] font-light tracking-[-0.03em] text-white/60">Stream</span>
          </button>

          {/* bulle de verre, centrée, comme en bas sur téléphone */}
          <nav className="hidden md:block absolute left-1/2 -translate-x-1/2">
            <div className="p-glass rounded-full p-1 flex items-center">
              {items.map((i) => {
                const Icon = i.icon;
                const on = active === i.id;
                return (
                  <button key={i.id} onClick={() => navigate(i.path)}
                    className={`relative px-4 h-9 rounded-full flex items-center gap-2 text-[13px] font-medium transition-colors ${
                      on ? 'text-white' : 'text-white/55 hover:text-white/85'
                    }`}>
                    {on && (
                      <motion.span layoutId="pure-tab-desk" className="absolute inset-0 rounded-full p-lens"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      <Icon size={15} strokeWidth={on ? 2.2 : 1.7} />
                      {i.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="flex items-center gap-1">
            <button onClick={() => setSearch(true)} aria-label="Rechercher"
              className="w-9 h-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors">
              <Search size={17} />
            </button>
            <button onClick={() => setMenu(true)} aria-label="Compte" className="p-0.5">{avatar}</button>
          </div>
        </div>
      </header>

      {/* ── Bulle mobile (liquid glass) ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pointer-events-none">
        <div className="p-glass pointer-events-auto rounded-full p-1 flex items-center mx-auto max-w-[420px]">
          {mobileItems.map((i) => {
            const Icon = i.icon;
            const on = active === i.id;
            return (
              <button key={i.id} onClick={() => navigate(i.path)}
                className={`relative flex-1 flex flex-col items-center gap-[3px] py-2 rounded-full transition-colors ${on ? 'text-white' : 'text-white/55'}`}>
                {on && (
                  <motion.span layoutId="pure-tab" className="absolute inset-0 rounded-full p-lens"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
                )}
                <span className="relative z-10 flex flex-col items-center gap-[3px]">
                  <Icon size={19} strokeWidth={on ? 2.2 : 1.7} />
                  <span className="text-[9.5px] font-medium tracking-[-0.01em] max-w-[64px] truncate">{i.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {search && <SearchPure onClose={() => setSearch(false)} />}

      {/* ── Menu compte ── */}
      <AnimatePresence>
        {menu && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMenu(false)} className="fixed inset-0 z-[90] bg-black/40" />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className="fixed top-14 right-3 md:right-8 z-[95] w-[278px] rounded-2xl overflow-hidden bg-[#141416]/92 backdrop-blur-2xl border border-white/10">
              <div className="px-4 py-3.5 border-b border-white/[0.08]">
                <p className="text-[14px] font-semibold truncate">{user?.username}</p>
                <p className="text-[12px] text-white/45 truncate">{user?.email}</p>
              </div>
              <div className="p-1.5">
                {/* Bibliothèques sans place dans la barre du téléphone */}
                {horsBarre.length > 0 && (
                  <div className="md:hidden">
                    {horsBarre.map((i) => (
                      <MenuRow key={i.id} icon={i.icon || Library} onClick={() => { setMenu(false); navigate(i.path); }}>{i.label}</MenuRow>
                    ))}
                    <div className="my-1.5 mx-3.5 border-t border-white/[0.08]" />
                  </div>
                )}
                <MenuRow icon={Compass} onClick={() => { setMenu(false); navigate('/explorer'); }}>Explorer</MenuRow>
                <MenuRow icon={Popcorn} onClick={() => { setMenu(false); navigate('/tonight'); }}>Ce soir</MenuRow>
                <MenuRow icon={Clock} onClick={() => { setMenu(false); navigate('/history'); }}>Historique</MenuRow>
                <MenuRow icon={Heart} onClick={() => { setMenu(false); navigate('/favorites'); }}>Favoris</MenuRow>
                <MenuRow icon={Sparkles} onClick={() => { setMenu(false); navigate('/wrapped'); }}>Mon Wrapped</MenuRow>
                <MenuRow icon={PlusCircle} onClick={() => { setMenu(false); navigate('/requests'); }}>Demander un film</MenuRow>
                {connecteurs && (
                  <MenuRow icon={Link2} onClick={() => { setMenu(false); navigate('/connect'); }}>Connecteurs</MenuRow>
                )}
                {user?.isAdmin && (
                  <>
                    <MenuRow icon={ShieldCheck} onClick={() => { setMenu(false); navigate('/admin'); }}>Espace admin</MenuRow>
                    <MenuRow icon={Settings} onClick={() => { setMenu(false); navigate('/reglages'); }}>Réglages du serveur</MenuRow>
                  </>
                )}

                <div className="my-1.5 mx-3.5 border-t border-white/[0.08]" />

                {push.supported && (
                  <>
                    <button onClick={togglePush} disabled={pushBusy}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] font-medium text-white/90 hover:bg-white/[0.08] transition-colors disabled:opacity-50">
                      <Check size={17} className={push.subscribed ? 'opacity-100' : 'opacity-0'} />
                      <span className="flex-1 text-left">Notifications</span>
                      <span className="text-[11px] text-white/40">{push.subscribed ? 'Activées' : 'Désactivées'}</span>
                    </button>
                    <div className="my-1.5 mx-3.5 border-t border-white/[0.08]" />
                  </>
                )}

                <MenuRow icon={LogOut} tone="text-white/70" onClick={() => { authService.logout(); window.location.href = '/login'; }}>
                  Déconnexion
                </MenuRow>
                <button onClick={async () => { await authService.logoutAll(); window.location.href = '/login'; }}
                  className="w-full text-left px-3.5 pb-2.5 pt-0.5 text-[11.5px] text-white/35 hover:text-white/60 transition-colors">
                  Déconnecter tous les appareils
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
