import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Send, Smile, X, Users, Hourglass, Timer } from 'lucide-react';
import WatchAvatar from './WatchAvatar';
import { getCurrent, on, connectSession, isConnected, sendChat, sendReaction } from '../lib/watchParty';

const EMOJIS = ['😂', '❤️', '🔥', '😮', '😢', '👏', '🎉', '💀'];

// In-player watch-party layer: presence, live chat, floating emoji reactions,
// buffering awareness ("en attente que X charge"), and host auto-wait.
// Renders nothing when not in a session. Positioned absolutely inside the
// player container so it also shows in fullscreen.
export default function WatchPartyOverlay({ videoRef }) {
  const cur = getCurrent();
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [unread, setUnread] = useState(0);
  const [autoWait, setAutoWait] = useState(true);
  const wePausedRef = useRef(false);
  const listRef = useRef(null);
  const rid = useRef(0);

  const isHost = !!cur?.isHost;
  // Our own participant id. Fall back to the host participant when we're the host
  // (older sessions / safety) so we never count ourselves as "buffering".
  const selfPid = cur?.pid || (isHost ? participants.find((p) => p.isHost)?.pid : undefined);

  // Hide the whole watch-party layer in fullscreen (user: emoji bubbles + chat
  // must not sit on top of the film in fullscreen).
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement || !!document.webkitFullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); };
  }, []);

  useEffect(() => {
    if (!cur) return;
    if (!isConnected()) connectSession(cur);
    const offP = on('participants', (s) => setParticipants(s?.participants || []));
    const offC = on('chat', (m) => {
      setMessages((prev) => [...prev.slice(-80), m]);
      setUnread((u) => (chatOpenRef.current ? 0 : u + 1));
    });
    const offR = on('reaction', ({ emoji }) => {
      const id = ++rid.current;
      setReactions((prev) => [...prev, { id, emoji, x: 8 + Math.random() * 84 }]);
      setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 3200);
    });
    return () => { offP(); offC(); offR(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep a ref of chatOpen for the chat listener closure
  const chatOpenRef = useRef(false);
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) setUnread(0); }, [chatOpen]);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, chatOpen]);

  // Host "attendre tout le monde": pause the film while any guest buffers.
  const bufferers = participants.filter((p) => p.buffering && p.pid !== selfPid);
  useEffect(() => {
    if (!isHost || !autoWait) return;
    const v = videoRef?.current; if (!v) return;
    const anyBuffering = bufferers.length > 0;
    if (anyBuffering && !v.paused) { wePausedRef.current = true; v.pause(); }
    else if (!anyBuffering && wePausedRef.current) { wePausedRef.current = false; v.play().catch(() => {}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferers.length, isHost, autoWait]);

  const send = useCallback(() => {
    const t = draft.trim(); if (!t) return;
    sendChat(t); setDraft('');
  }, [draft]);

  if (!cur) return null;
  if (isFullscreen) return null; // clean film in fullscreen — no overlay chrome

  return (
    <>
      {/* ── Presence (top center) ── */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[55] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 shadow-lg pointer-events-none">
        <Users size={13} className="text-white/60 mr-0.5" />
        {participants.slice(0, 6).map((p) => (
          <div key={p.pid} className={`relative rounded-full ${p.buffering ? 'ring-2 ring-white/70 animate-pulse' : ''}`}>
            <WatchAvatar avatar={p.avatar} name={p.name} size={24} />
          </div>
        ))}
        {participants.length > 6 && <span className="text-[11px] text-white/60 font-bold ml-0.5">+{participants.length - 6}</span>}
      </div>

      {/* ── Buffering banner ── */}
      <AnimatePresence>
        {bufferers.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-[55] flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/55 backdrop-blur-xl border border-white/15 text-white/85 text-[12px] font-medium pointer-events-none">
            <Hourglass size={13} className="animate-pulse" />
            En attente de {bufferers.map((b) => b.name).join(', ')}…
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Guest hint ── */}
      {!isHost && (
        <div className="absolute top-3 right-3 z-[55] px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 text-[10px] font-bold text-white/60 pointer-events-none hidden md:block">
          🎬 L'hôte contrôle la lecture
        </div>
      )}

      {/* ── Floating emoji reactions ── */}
      <div className="absolute inset-0 z-[54] pointer-events-none overflow-hidden">
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.div key={r.id}
              initial={{ opacity: 0, y: 0, scale: 0.5 }}
              animate={{ opacity: [0, 1, 1, 0], y: -220, scale: [0.5, 1.3, 1, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 3, ease: 'easeOut' }}
              style={{ left: `${r.x}%` }}
              className="absolute bottom-28 text-4xl drop-shadow-lg">
              {r.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Reaction + chat bar (bottom center, above controls) ── */}
      <div className="absolute bottom-24 md:bottom-28 left-1/2 -translate-x-1/2 z-[56] flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}>
        <AnimatePresence>
          {emojiOpen && (
            <motion.div initial={{ opacity: 0, scale: 0.9, x: 10 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.9, x: 10 }}
              className="flex items-center gap-1 px-2 py-1.5 rounded-full bg-black/60 backdrop-blur-xl border border-white/15 shadow-2xl">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => { sendReaction(e); }}
                  className="text-xl w-9 h-9 rounded-full hover:bg-white/15 active:scale-90 transition-all">
                  {e}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <button onClick={() => { setEmojiOpen((o) => !o); setChatOpen(false); }}
          className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xl border shadow-lg transition-all active:scale-90 ${emojiOpen ? 'bg-white text-black border-white' : 'bg-black/50 text-white border-white/15 hover:bg-black/70'}`}>
          <Smile size={20} />
        </button>

        <button onClick={() => { setChatOpen((o) => !o); setEmojiOpen(false); }}
          className={`relative w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xl border shadow-lg transition-all active:scale-90 ${chatOpen ? 'bg-white text-black border-white' : 'bg-black/50 text-white border-white/15 hover:bg-black/70'}`}>
          <MessageCircle size={20} />
          {unread > 0 && !chatOpen && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-black text-[10px] font-bold flex items-center justify-center">{unread > 9 ? '9+' : unread}</span>
          )}
        </button>

        {isHost && (
          <button onClick={() => setAutoWait((w) => !w)} title="Attendre que tout le monde ait chargé"
            className={`h-11 px-3 rounded-full flex items-center gap-1.5 backdrop-blur-xl border shadow-lg transition-all active:scale-95 text-[11px] font-bold ${autoWait ? 'bg-white text-black border-white' : 'bg-black/50 text-white/60 border-white/15'}`}>
            <Timer size={15} /> <span className="hidden sm:inline">Attendre tous</span>
          </button>
        )}
      </div>

      {/* ── Chat drawer (left) ── */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-0 left-0 h-full w-[86%] max-w-[360px] z-[60] bg-black/50 backdrop-blur-2xl border-r border-white/10 flex flex-col shadow-2xl">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold flex items-center gap-2"><MessageCircle size={17} /> Discussion</h3>
              <button onClick={() => setChatOpen(false)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"><X size={16} /></button>
            </div>
            <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide">
              {messages.length === 0 && <p className="text-center text-white/40 text-sm mt-6">Dis quelque chose 👋</p>}
              {messages.map((m, i) => {
                const mine = m.pid === selfPid;
                return (
                  <div key={i} className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                    <WatchAvatar avatar={m.avatar} name={m.name} size={28} />
                    <div className={`max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                      {!mine && <span className="text-[10px] text-white/50 font-bold px-1 mb-0.5">{m.name}</span>}
                      <span className={`px-3 py-2 rounded-2xl text-sm break-words ${mine ? 'bg-white text-black rounded-br-sm' : 'bg-white/10 text-white rounded-bl-sm'}`}>{m.text}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-3 border-t border-white/10 flex items-center gap-2">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Message…" maxLength={300}
                className="flex-1 bg-white/[0.06] border border-white/10 rounded-full px-4 py-2.5 text-sm outline-none focus:border-white/30 transition-colors" />
              <button onClick={send} className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shrink-0 active:scale-90 transition-transform">
                <Send size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
