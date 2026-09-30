import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import './v2.css';
import './pure.css';
import NavPure from './pure/NavPure';
import HomePure from './pure/HomePure';
import InstallPure from './pure/InstallPure';
import { useLibraries } from './lib/libraries';

const DetailsPure = React.lazy(() => import('./pure/DetailsPure'));
const FavoritesPure = React.lazy(() => import('./pure/FavoritesPure'));
const HistoryPure = React.lazy(() => import('./pure/HistoryPure'));
const CollectionPure = React.lazy(() => import('./pure/CollectionPure'));
const TonightPure = React.lazy(() => import('./pure/TonightPure'));
const ConnectPure = React.lazy(() => import('./pure/ConnectPure'));
const DiscoverPure = React.lazy(() => import('./pure/DiscoverPure'));
const SettingsPure = React.lazy(() => import('./pure/setup/SettingsPure'));
const ActorPageV2 = React.lazy(() => import('./pages/ActorPageV2'));
const WrappedV2 = React.lazy(() => import('./pages/WrappedV2'));
const Player = React.lazy(() => import('./pages/PlayerV2'));
const WatchInvite = React.lazy(() => import('./pages/WatchInvite'));
const WatchRoom = React.lazy(() => import('./pages/WatchRoom'));
const RequestsV2 = React.lazy(() => import('./pages/RequestsV2'));
const Login = React.lazy(() => import('../pages/Login'));
const Register = React.lazy(() => import('../pages/Register'));
const Admin = React.lazy(() => import('../pages/Admin'));

function Protected({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminOnly({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isAdmin) return <Navigate to="/" replace />;
  return children;
}

/* Une page par bibliothèque du serveur, sous le nom qu'elle porte là-bas
   (« Films FR », « Animés »…). La clé vient de l'URL. */
function LibraryPage() {
  const { key } = useParams();
  // `toutes` : une bibliothèque masquée du menu reste consultable par son lien
  // (la flèche « sortir » d'une fiche Films Cam y mène, par exemple) — sauf si
  // elle est PRIVÉE : celle-là n'existe pas pour Nova.
  const { toutes, loading } = useLibraries();
  const section = toutes.find((l) => String(l.key) === String(key));
  if (loading && !section) return <Loader />;
  if (!section) return <Navigate to="/" replace />;
  return <HomePure key={section.key} section={section} />;
}

/* Anciennes adresses (/movies, /shows, /animes) : on renvoie vers la
   première bibliothèque du bon type, pour ne pas casser les favoris. */
function LegacyLibraryRedirect({ kind }) {
  const { libraries, loading } = useLibraries();
  if (loading) return <Loader />;
  const anime = (l) => /anim/i.test(l.title || '');
  const match = libraries.find((l) =>
    kind === 'anime' ? anime(l) : kind === 'show' ? l.type === 'show' && !anime(l) : l.type === kind);
  return <Navigate to={match ? `/bibliotheque/${match.key}` : '/'} replace />;
}

// Keyboard navigation between cards: arrows move inside/between rows,
// Enter/Space opens the focused card ([data-card] inside [data-row]).
function CardKeyNav() {
  React.useEffect(() => {
    const onKey = (e) => {
      const ae = document.activeElement;
      if (!ae || !ae.hasAttribute || !ae.hasAttribute('data-card')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ae.click(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const row = ae.closest('[data-row]');
      if (!row) return;
      e.preventDefault();
      const cards = Array.from(row.querySelectorAll('[data-card]'));
      const i = cards.indexOf(ae);
      if (e.key === 'ArrowRight') cards[Math.min(i + 1, cards.length - 1)]?.focus();
      else if (e.key === 'ArrowLeft') cards[Math.max(i - 1, 0)]?.focus();
      else {
        const rows = Array.from(document.querySelectorAll('[data-row]'));
        const ri = rows.indexOf(row);
        rows[ri + (e.key === 'ArrowDown' ? 1 : -1)]?.querySelector('[data-card]')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

const Loader = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="w-7 h-7 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
  </div>
);

export default function ShellV2({ user, handleAuth, serveurManquant }) {
  const { pathname } = useLocation();

  /* Aucun serveur multimédia relié : l'administrateur est conduit aux
     réglages, les autres attendent qu'il l'ait fait. */
  if (user && !user.guest && serveurManquant && pathname !== '/reglages' && pathname !== '/login') {
    if (user.isAdmin) return <Navigate to="/reglages" replace />;
    return (
      <div className="nova-v2 nova-pure min-h-screen flex flex-col items-center justify-center text-center px-8">
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] mb-2.5">Presque prêt</h1>
        <p className="text-[14px] text-white/50 max-w-sm">L'administrateur n'a pas encore relié de serveur multimédia. Reviens un peu plus tard.</p>
      </div>
    );
  }

  const hideNav = !user || pathname === '/login' || pathname === '/register'
    || pathname.startsWith('/play/') || pathname.startsWith('/watch/');

  return (
    <div className="nova-v2 nova-pure">
      <div className="spatial-bg" aria-hidden="true" />
      <div className="spatial-veil" aria-hidden="true" />
      {user && !hideNav && <InstallPure />}

      <div className="v2-content">
        <CardKeyNav />
        {!hideNav && <NavPure />}
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login onAuth={handleAuth} />} />
            <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register onAuth={handleAuth} />} />

            {/* Watch party — PUBLIC so account-less guests can join via a shared link. */}
            <Route path="/watch/:id" element={<WatchInvite handleAuth={handleAuth} />} />
            <Route path="/watch/:id/room" element={<WatchRoom />} />

            <Route path="/" element={<Protected user={user}><HomePure /></Protected>} />
            <Route path="/bibliotheque/:key" element={<Protected user={user}><LibraryPage /></Protected>} />
            <Route path="/movies" element={<Protected user={user}><LegacyLibraryRedirect kind="movie" /></Protected>} />
            <Route path="/shows" element={<Protected user={user}><LegacyLibraryRedirect kind="show" /></Protected>} />
            <Route path="/animes" element={<Protected user={user}><LegacyLibraryRedirect kind="anime" /></Protected>} />

            <Route path="/favorites" element={<Protected user={user}><FavoritesPure /></Protected>} />
            <Route path="/history" element={<Protected user={user}><HistoryPure /></Protected>} />
            <Route path="/title/:id" element={<Protected user={user}><DetailsPure /></Protected>} />
            <Route path="/actor/:name" element={<Protected user={user}><ActorPageV2 /></Protected>} />
            <Route path="/wrapped" element={<Protected user={user}><WrappedV2 /></Protected>} />
            <Route path="/requests" element={<Protected user={user}><RequestsV2 /></Protected>} />
            <Route path="/collection/:slug" element={<Protected user={user}><CollectionPure /></Protected>} />
            <Route path="/tonight" element={<Protected user={user}><TonightPure /></Protected>} />
            <Route path="/connect" element={<Protected user={user}><ConnectPure /></Protected>} />
            <Route path="/explorer" element={<Protected user={user}><DiscoverPure /></Protected>} />
            <Route path="/play/:id" element={<Protected user={user}><Player /></Protected>} />
            <Route path="/admin" element={<AdminOnly user={user}><Admin /></AdminOnly>} />
            <Route path="/reglages" element={<AdminOnly user={user}><SettingsPure /></AdminOnly>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
