import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Check, Link2, LogOut, Users, Share2, X } from 'lucide-react';
import WatchAvatar from '../components/WatchAvatar';
import authService from '../../services/authService';
import { getCurrent, connectSession, on, setReady, launch, endSession, leave } from '../lib/watchParty';

import { tr } from '../../i18n';
// The waiting room: shared participant list + ready-check. Host sees the launch
// button ("Lancer 3/4"); everyone is warped to the player when it fires.
export default function WatchRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const cur = getCurrent();
  const [session, setSession] = useState(null);
  const [ready, setReadyState] = useState(true);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!cur || cur.sessionId !== id) { navigate(`/watch/${id}`, { replace: true }); return; }
    connectSession(cur); // idempotent — re-announces presence if needed.
    const offP = on('participants', setSession);
    const offL = on('launch', ({ mediaId }) => navigate(`/play/${mediaId}`));
    const offE = on('ended', () => { handleEnded(); });
    const offErr = on('error', (e) => { setErr(e?.error || tr('Erreur de séance')); });
    return () => { offP(); offL(); offE(); offErr(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleEnded = () => {
    const guest = authService.getUser()?.guest;
    leave();
    if (guest) authService.logout();
    navigate('/', { replace: true });
  };

  const quit = () => {
    if (cur?.isHost) endSession();
    handleEnded();
  };

  const toggleReady = () => {
    const next = !ready;
    setReadyState(next);
    setReady(next);
  };

  const participants = session?.participants || [];
  const readyCount = participants.filter((p) => p.ready).length;
  const total = participants.length || 1;
  const media = session?.media || cur?.media;

  const shareUrl = `${window.location.origin}/watch/${id}`;

  const copyLink = async () => {
    try {
      // navigator.clipboard only exists in a secure context (HTTPS/localhost).
      // Over plain HTTP (LAN / Freebox) it's undefined → fall back to execCommand.
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = shareUrl;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };

  const shareText = tr('Rejoins-moi pour regarder « {0} » sur NovaStream', [media?.title || 'un film']);

  const shareLink = async () => {
    // The real OS share sheet (navigator.share) only exists over HTTPS. When it's
    // available we use it; otherwise (HTTP) we open our own share menu with direct
    // app links (WhatsApp/SMS/…) so sharing to contacts still works.
    if (navigator.share) {
      try {
        await navigator.share({ title: 'NovaStream', text: shareText, url: shareUrl });
        return;
      } catch { return; } // user cancelled — don't fall back
    }
    setShareOpen(true);
  };

  const shareTargets = [
    { label: 'WhatsApp', emoji: '🟢', href: `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}` },
    { label: 'SMS', emoji: '💬', href: `sms:?&body=${encodeURIComponent(shareText + ' ' + shareUrl)}` },
    { label: 'Telegram', emoji: '✈️', href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}` },
    { label: 'Email', emoji: '✉️', href: `mailto:?subject=${encodeURIComponent(tr('Séance NovaStream'))}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}` },
  ];

  return (
    <div className="min-h-screen relative flex flex-col items-center px-5 py-10 md:py-16 overflow-hidden">
      {media?.backdrop && (
        <div className="absolute inset-0 -z-10">
          <img src={media.backdrop} alt="" className="w-full h-full object-cover opacity-20 blur-2xl scale-110" />
          <div className="absolute inset-0 bg-black/70" />
        </div>
      )}

      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="p-label mb-2">{tr('Salle d\'attente')}</p>
          <h1 className="p-display text-[28px] md:text-[40px]">{media?.title || tr('Séance')}</h1>
          <p className="text-[13px] p-dim mt-2.5 flex items-center justify-center gap-2">
            <Users size={16} /> {participants.length} {tr('participant')}{participants.length > 1 ? 's' : ''}
          </p>
        </div>

        {err && (
          <div className="mb-5 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-400/30 text-red-200 text-sm font-semibold text-center">
            {err}
          </div>
        )}

        {session && session.hostPresent === false && !cur?.isHost && (
          <div className="mb-5 px-4 py-2.5 rounded-2xl bg-amber-500/15 border border-amber-400/30 text-amber-100 text-sm font-semibold text-center">
            {tr('L\'hôte prépare la séance… reste ici, ça va démarrer 👌')}
          </div>
        )}

        {/* Share link */}
        <div className="mb-6 space-y-2.5">
          <button onClick={copyLink}
            className="w-full flex items-center justify-between gap-3 glass-panel rounded-2xl px-4 py-3 hover:bg-white/[0.08] transition-colors">
            <span className="flex items-center gap-2 text-sm text-gray-300 truncate">
              <Link2 size={16} className="text-white/50 shrink-0" />
              <span className="truncate">{shareUrl}</span>
            </span>
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${copied ? 'bg-white/20 text-white' : 'bg-white/10 text-white/70'}`}>
              {copied ? tr('Copié ✓') : tr('Copier')}
            </span>
          </button>
          <button onClick={shareLink}
            className="w-full flex items-center justify-center gap-2 h-[46px] rounded-full bg-white/10 backdrop-blur-xl text-[15px] font-semibold hover:bg-white/[0.17] active:scale-[0.97] transition-all">
            <Share2 size={18} /> {tr('Partager le lien')}
          </button>
        </div>

        {/* Participants */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          <AnimatePresence>
            {participants.map((p) => (
              <motion.div key={p.pid} layout
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                className="glass-panel rounded-2xl p-4 flex flex-col items-center text-center relative">
                <WatchAvatar avatar={p.avatar} name={p.name} size={56} />
                <p className="mt-2 text-sm font-bold truncate max-w-full">{p.name}</p>
                {p.isHost ? (
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45">{tr('Hôte')}</span>
                ) : (
                  <span className={`mt-1 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${p.ready ? 'text-white/80' : 'text-white/35'}`}>
                    {p.ready && <Check size={11} />} {p.ready ? tr('Prêt') : tr('Pas prêt')}
                  </span>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {!cur?.isHost && (
            <button onClick={toggleReady}
              className={`w-full h-[50px] rounded-full text-[15px] font-semibold transition-all ${ready ? 'bg-white/[0.18] text-white' : 'bg-white/[0.07] text-white/60'}`}>
              {ready ? tr('Je suis prêt·e') : tr('Je ne suis pas prêt·e')}
            </button>
          )}

          {cur?.isHost && (
            <button onClick={launch}
              className="w-full flex items-center justify-center gap-2 h-[54px] rounded-full bg-white text-black text-[16px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all">
              <Play size={20} fill="currentColor" /> {tr('Lancer')} {readyCount}/{total}
            </button>
          )}

          <button onClick={quit}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-full text-[13px] font-medium text-white/40 hover:text-white/80 transition-colors">
            <LogOut size={16} /> {cur?.isHost ? tr('Terminer la séance') : tr('Quitter')}
          </button>
        </div>
      </div>

      {/* Share menu (HTTP fallback for the native OS sheet) */}
      <AnimatePresence>
        {shareOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShareOpen(false)} className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              className="fixed bottom-0 inset-x-0 z-[85] glass-panel rounded-t-3xl p-5 pb-8 max-w-md mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">{tr('Partager le lien')}</h3>
                <button onClick={() => setShareOpen(false)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-4 gap-3 mb-4">
                {shareTargets.map((t) => (
                  <a key={t.label} href={t.href} target="_blank" rel="noreferrer" onClick={() => setShareOpen(false)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] transition-colors">
                    <span className="text-2xl">{t.emoji}</span>
                    <span className="text-[11px] font-semibold text-gray-200">{t.label}</span>
                  </a>
                ))}
                <button onClick={() => { copyLink(); setShareOpen(false); }}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] transition-colors">
                  <Link2 size={22} className="text-white/70" />
                  <span className="text-[11px] font-semibold text-gray-200">{tr('Copier')}</span>
                </button>
              </div>
              <p className="text-[11px] text-gray-500 text-center">{tr('Astuce : en HTTPS, ce bouton ouvrira le vrai partage de ton téléphone.')}</p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
