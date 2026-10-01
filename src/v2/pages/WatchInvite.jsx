import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clapperboard, PartyPopper } from 'lucide-react';
import KahootOnboard from '../components/KahootOnboard';
import { getSessionInfo, joinSession, connectSession } from '../lib/watchParty';

import { tr } from '../../i18n';
// Public landing for a shared watch-party link. Works for people WITHOUT a
// Nova account: they set an identity, get a guest token, and join the room.
export default function WatchInvite({ handleAuth }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState('welcome'); // welcome | onboard | joining

  useEffect(() => {
    let ok = true;
    getSessionInfo(id).then((i) => ok && setInfo(i)).catch((e) => ok && setError(e.message));
    return () => { ok = false; };
  }, [id]);

  const handleDone = async ({ name, avatar }) => {
    setStep('joining');
    try {
      const r = await joinSession(id, { name, avatar });
      // Become a (guest) logged-in user so the Plex proxy + player work.
      localStorage.setItem('nova_token', r.token);
      localStorage.setItem('nova_user', JSON.stringify(r.user));
      handleAuth?.(r.user);
      connectSession({ sessionId: id, pid: r.pid, isHost: false, name, avatar });
      navigate(`/watch/${id}/room`);
    } catch (e) {
      setError(e.message);
      setStep('welcome');
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <div className="glass-panel rounded-3xl p-8 max-w-sm">
          <h1 className="text-xl font-bold mb-2">{tr('Oups…')}</h1>
          <p className="text-gray-400 mb-6">{error}</p>
          <button onClick={() => navigate('/')} className="px-6 py-3 bg-white text-black rounded-full font-bold">{tr('Accueil')}</button>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
      </div>
    );
  }

  const bg = info.media?.backdrop || info.media?.poster;

  return (
    <div className="min-h-screen relative flex items-center justify-center p-5 overflow-hidden">
      {bg && (
        <div className="absolute inset-0 -z-10">
          <img src={bg} alt="" className="w-full h-full object-cover opacity-25 blur-xl scale-110" />
          <div className="absolute inset-0 bg-black/60" />
        </div>
      )}

      {step === 'welcome' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md glass-panel rounded-3xl p-7 md:p-9 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white/10 flex items-center justify-center mb-4">
            <PartyPopper className="text-white" size={26} />
          </div>
          <p className="p-label mb-2">{tr('Bienvenue sur NovaStream')}</p>
          <h1 className="p-title text-[24px] md:text-[30px] mb-3">
            {tr('Tu es invité·e à regarder')}<br />
            <span className="text-white">« {info.media?.title} »</span>
          </h1>
          <p className="text-gray-400 mb-1">{tr('par')} <span className="font-bold text-white">{info.hostName}</span></p>
          {info.started && <p className="text-[12px] text-white/50 mb-4">{tr('La séance a déjà commencé — tu rejoins en direct.')}</p>}

          {info.media?.poster && (
            <img src={info.media.poster} alt="" className="w-28 mx-auto rounded-xl my-5 shadow-2xl ring-1 ring-white/10" />
          )}

          <button onClick={() => setStep('onboard')}
            className="w-full flex items-center justify-center gap-2 h-[50px] rounded-full bg-white text-black text-[15px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all">
            <Clapperboard size={18} /> {tr('Rejoindre la séance')}
          </button>
        </motion.div>
      )}

      {step === 'onboard' && <KahootOnboard onDone={handleDone} />}

      {step === 'joining' && (
        <div className="w-10 h-10 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
      )}
    </div>
  );
}
