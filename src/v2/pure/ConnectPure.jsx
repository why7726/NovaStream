import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Check, Loader2, ExternalLink, RefreshCw, Unlink } from 'lucide-react';
import authService from '../../services/authService';
import useRetour from './useRetour';

/* Connecteurs — relier un compte extérieur à Nova.

   Pour l'instant : Plex. On ouvre plex.tv dans une fenêtre, l'utilisateur
   valide, et le serveur récupère le jeton (même mécanique qu'Overseerr).
   Une fois relié, ce qu'on regarde sur Nova est enregistré sur SON compte
   Plex, et ce qu'il a vu sur Plex remonte dans Nova. */

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

function api(chemin, options = {}) {
  const token = authService.getToken();
  return fetch(`${apiBase()}${chemin}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

function LogoPlex() {
  return (
    <span className="w-11 h-11 rounded-[12px] bg-[#1f1f22] border border-white/10 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
        <path fill="#e5a00d" d="M4 2h5.2l6.6 10-6.6 10H4l6.6-10L4 2z" />
      </svg>
    </span>
  );
}

export default function ConnectPure() {
  const retour = useRetour('/');
  const [etat, setEtat] = useState(null);        // { plex: {...} | null }
  const [phase, setPhase] = useState('idle');    // idle | attente | sync
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const sondage = useRef(null);
  const fenetre = useRef(null);

  const charger = () => api('/api/connect').then((r) => r.json()).then(setEtat).catch(() => setEtat({ plex: null }));
  useEffect(() => { charger(); return () => clearInterval(sondage.current); }, []);

  const connecter = async () => {
    setErreur(''); setMessage('');
    try {
      const r = await api('/api/connect/plex/start', { method: 'POST' });
      if (!r.ok) throw new Error('Plex indisponible');
      const { url } = await r.json();

      /* La fenêtre DOIT être ouverte dans le geste de clic, sinon Safari la
         bloque. On la garde en référence pour la refermer à la fin. */
      fenetre.current = window.open(url, 'plex-auth', 'width=620,height=760');
      setPhase('attente');

      // On demande au serveur, toutes les 2 s, si le code a été validé.
      clearInterval(sondage.current);
      const debut = Date.now();
      sondage.current = setInterval(async () => {
        if (Date.now() - debut > 5 * 60 * 1000) {   // 5 min, puis on abandonne
          clearInterval(sondage.current);
          setPhase('idle');
          setErreur('Délai dépassé. Réessaie quand tu veux.');
          return;
        }
        try {
          const rep = await api('/api/connect/plex/finish', { method: 'POST' });
          const d = await rep.json();
          if (rep.status === 403) { clearInterval(sondage.current); setPhase('idle'); setErreur(d.error); return; }
          if (d.pending) return;
          if (d.connected) {
            clearInterval(sondage.current);
            try { fenetre.current?.close(); } catch {}
            setPhase('idle');
            setMessage(`Compte ${d.username} relié — ${d.sync?.vus ?? 0} titres vus et ${d.sync?.enCours ?? 0} en cours récupérés.`);
            charger();
          }
        } catch { /* réseau : on retentera au prochain tour */ }
      }, 2000);
    } catch (e) {
      setPhase('idle');
      setErreur(e.message || 'Connexion impossible');
    }
  };

  const synchroniser = async () => {
    setPhase('sync'); setErreur(''); setMessage('');
    try {
      const r = await api('/api/connect/plex/sync', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Échec');
      setMessage(`${d.vus} titres vus et ${d.enCours} en cours récupérés.`);
      charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setPhase('idle');
    }
  };

  const deconnecter = async () => {
    await api('/api/connect/plex', { method: 'DELETE' });
    setMessage(''); setErreur('');
    charger();
  };

  const plex = etat?.plex;

  return (
    <div className="min-h-screen pt-16 md:pt-20 pb-16 max-w-[720px] mx-auto">
      <div className="px-5 md:px-8 mb-2 flex items-center gap-3">
        <button onClick={retour} aria-label="Retour"
          className="w-9 h-9 -ml-1.5 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h1 className="p-display text-[26px] md:text-[38px]">Connecteurs</h1>
      </div>
      <p className="px-5 md:px-8 text-[13.5px] p-dim mb-8 md:mb-10 leading-relaxed">
        Relie un compte extérieur pour que ta progression suive partout.
      </p>

      <div className="px-5 md:px-8">
        <div className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-5">
          <div className="flex items-start gap-4">
            <LogoPlex />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="p-title text-[16px]">Plex</h2>
                {plex && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300/90">
                    <Check size={12} /> Relié
                  </span>
                )}
              </div>
              {plex ? (
                <p className="text-[13px] p-dim mt-1 truncate">
                  {plex.username}{plex.email ? ` · ${plex.email}` : ''}
                </p>
              ) : (
                <p className="text-[13px] p-dim mt-1 leading-relaxed">
                  Ce que tu regardes sur Nova sera enregistré sur ton compte Plex,
                  et ce que tu as déjà vu sur Plex apparaîtra ici.
                </p>
              )}

              {plex?.lastSyncInfo && (
                <p className="text-[12px] p-faint mt-2">Dernière synchro : {plex.lastSyncInfo}</p>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-4">
                {!plex ? (
                  <button onClick={connecter} disabled={phase === 'attente'}
                    className="p-btn h-[38px] px-5 text-[13.5px] disabled:opacity-60">
                    {phase === 'attente'
                      ? <><Loader2 size={14} className="animate-spin" /> En attente de Plex…</>
                      : <><ExternalLink size={14} /> Connecter mon compte</>}
                  </button>
                ) : (
                  <>
                    <button onClick={synchroniser} disabled={phase === 'sync'}
                      className="p-btn p-btn-ghost h-[38px] px-5 text-[13.5px] disabled:opacity-60">
                      <RefreshCw size={14} className={phase === 'sync' ? 'animate-spin' : ''} /> Synchroniser
                    </button>
                    <button onClick={deconnecter}
                      className="h-[38px] px-4 rounded-full text-[13.5px] font-medium text-white/45 hover:text-white transition-colors inline-flex items-center gap-1.5">
                      <Unlink size={14} /> Délier
                    </button>
                  </>
                )}
              </div>

              {phase === 'attente' && (
                <p className="text-[12.5px] p-faint mt-3 leading-relaxed">
                  Valide la demande dans la fenêtre Plex. Si elle ne s'est pas ouverte,
                  autorise les fenêtres surgissantes puis réessaie.
                </p>
              )}
              {message && <p className="text-[12.5px] text-emerald-300/90 mt-3">{message}</p>}
              {erreur && <p className="text-[12.5px] text-red-300/90 mt-3 leading-relaxed">{erreur}</p>}
            </div>
          </div>
        </div>

        <p className="text-[12px] p-faint mt-4 leading-relaxed px-1">
          La synchronisation se fait aussi toute seule toutes les 30 minutes : ce que tu
          regardes depuis l'application Plex (télé, téléphone) remonte dans Nova.
        </p>
      </div>
    </div>
  );
}
