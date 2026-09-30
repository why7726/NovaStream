import React, { useState, useEffect, Suspense } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import authService from './services/authService';
import activityService from './services/activityService';

// V2 "Spatial Cinema" is now the one and only shell — shipped to everyone
// (the old V1 opt-in/preview toggle has been retired).
const ShellV2 = React.lazy(() => import('./v2/ShellV2'));
// Premier démarrage : création du compte administrateur.
const SetupAdmin = React.lazy(() => import('./v2/pure/setup/SetupAdmin'));

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

// Remonte une erreur au serveur : sur téléphone, la console n'existe pas,
// donc sans ça un crash ne laisse aucune trace exploitable.
export function reportClientError(error, componentStack = '') {
  try {
    const body = JSON.stringify({
      message: error?.message || String(error),
      stack: error?.stack || '',
      componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
    const token = localStorage.getItem('nova_token');
    const base = import.meta.env.DEV ? 'http://localhost:5174' : '';
    fetch(`${base}/api/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch { /* un rapport de crash ne doit jamais crasher */ }
}

// Erreurs hors rendu (promesses rejetées, gestionnaires d'événements)
if (typeof window !== 'undefined' && !window.__novaErrHooked) {
  window.__novaErrHooked = true;
  window.addEventListener('error', (e) => reportClientError(e.error || new Error(e.message)));
  window.addEventListener('unhandledrejection', (e) => {
    const err = e.reason || new Error('Promesse rejetée');
    reportClientError(err);
    if (isStaleChunkError(err)) recoverFromStaleChunk();
  });
}

/* Un « Failed to fetch dynamically imported module » ne veut pas dire que
   l'app est cassée : la page ouverte réclame un fichier d'une version qui
   vient d'être remplacée. Le bon réflexe est de recharger — une seule fois,
   sinon on boucle si le fichier est réellement absent. */
const RELOAD_FLAG = 'nova_reloaded_at';
export function isStaleChunkError(error) {
  const m = String(error?.message || error || '');
  return /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically imported/i.test(m);
}
export function recoverFromStaleChunk() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < 30000) return false;   // déjà tenté à l'instant
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch { /* mode privé : on tente quand même */ }
  window.location.reload();
  return true;
}

// Résumé lisible d'une erreur : message + 5 lignes de pile + arbre de composants.
function errorDetail(error, info) {
  const lines = [String(error?.message || error)];
  const stack = String(error?.stack || '').split('\n').slice(1, 6).map((l) => l.trim());
  if (stack.length) lines.push(...stack);
  const comp = String(info?.componentStack || '').split('\n').filter(Boolean).slice(0, 6).map((l) => l.trim());
  if (comp.length) lines.push('—', ...comp);
  return lines.join('\n');
}

// Catches render-time errors in any lazy route so a single bug doesn't blank the app.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null, info: null, open: false }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) {
    console.error('[NovaStream] Render error:', error, info);
    reportClientError(error, info?.componentStack);
    // Version périmée après un déploiement : on recharge au lieu de bloquer.
    if (isStaleChunkError(error) && recoverFromStaleChunk()) return;
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      const { error, info, open } = this.state;
      return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8 text-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] mb-2.5">Une erreur est survenue</h1>
          <p className="text-[14px] text-white/50 mb-8 max-w-md">
            Cette page n'a pas pu s'afficher. Le détail a été envoyé au serveur.
          </p>
          <div className="flex items-center gap-2.5">
            <button onClick={() => this.setState({ hasError: false, error: null, info: null })}
              className="inline-flex items-center justify-center h-[46px] px-7 rounded-full bg-white text-black text-[15px] font-semibold hover:opacity-90 transition-opacity">
              Réessayer
            </button>
            <button onClick={() => { window.location.href = '/'; }}
              className="inline-flex items-center justify-center h-[46px] px-6 rounded-full bg-white/10 text-white text-[15px] font-semibold hover:bg-white/[0.17] transition-colors">
              Accueil
            </button>
          </div>
          <button onClick={() => this.setState({ open: !open })}
            className="mt-7 text-[12.5px] text-white/35 hover:text-white/70 transition-colors">
            {open ? 'Masquer le détail' : 'Voir le détail'}
          </button>
          {open && (
            <pre className="mt-3 max-w-[92vw] md:max-w-2xl max-h-[38vh] overflow-auto text-left text-[11px] leading-relaxed text-white/45 bg-white/[0.04] rounded-2xl p-4 whitespace-pre-wrap">
              {errorDetail(error, info)}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// Global loading fallback for lazy loaded routes
const PageLoader = () => (
  <div className="min-h-screen bg-[#060606] flex items-center justify-center">
    <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
  </div>
);

function App() {
  const [user, setUser] = useState(authService.getUser());
  const [checking, setChecking] = useState(true);
  // { adminExiste, serveur, local } — null si le serveur ne répond pas
  const [setup, setSetup] = useState(null);

  useEffect(() => {
    const lire = () => fetch(`${apiBase()}/api/setup/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setSetup)
      .catch(() => setSetup(null));
    lire();
    // Les réglages préviennent quand un serveur vient d'être relié.
    window.addEventListener('nova-setup', lire);
    return () => window.removeEventListener('nova-setup', lire);
  }, []);

  useEffect(() => {
    authService.verify().then(u => {
      setUser(u);
      setChecking(false);
      if (u && !u.guest) authService.initMediaToken();
      if (u) {
        // Throttle visit logging to once per hour so the activity feed isn't
        // flooded by every page refresh.
        const last = parseInt(localStorage.getItem('nova_last_visit') || '0', 10);
        if (Date.now() - last > 3600000) {
          activityService.log('visit');
          localStorage.setItem('nova_last_visit', String(Date.now()));
        }
      }
    });
  }, []);

  if (checking) {
    return <PageLoader />;
  }

  // Aucun administrateur : tant qu'il n'est pas créé, le site ne montre que ça.
  if (setup && !setup.adminExiste) {
    return (
      <Suspense fallback={<PageLoader />}>
        <SetupAdmin local={setup.local} onDone={(u) => {
          setSetup({ ...setup, adminExiste: true });
          setUser(u);
          authService.initMediaToken();
          window.history.replaceState(null, '', '/reglages?bienvenue=1');
        }} />
      </Suspense>
    );
  }

  const handleAuth = (u) => { setUser(u); if (u && !u.guest) authService.initMediaToken(); };
  const handleLogout = () => { authService.logout(); setUser(null); };

  return (
    <Router>
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <ShellV2 user={user} handleAuth={handleAuth} handleLogout={handleLogout}
            serveurManquant={!!setup && !setup.serveur} />
        </Suspense>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
