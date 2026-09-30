import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import authService from '../../services/authService';
import { createSession, connectSession } from '../lib/watchParty';

// Entry point: a Nova user opens a synchronized "watch together" session for
// this title, then lands in the waiting room to invite people.
export default function WatchTogetherButton({ media, className = '' }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const start = async () => {
    if (loading || !media) return;
    setLoading(true);
    try {
      const user = authService.getUser();
      const r = await createSession({
        mediaId: media.id,
        mediaType: media.type,
        mediaTitle: media.title || media.grandparentTitle,
        mediaPoster: media.poster,
        mediaBackdrop: media.backdrop,
      });
      const avatar = user?.avatar
        ? { type: 'photo', url: user.avatar }
        : { type: 'emoji', animal: '🎬', accessory: 'crown', color: '#2c2c2e' };
      connectSession({ sessionId: r.sessionId, pid: r.hostPid, isHost: true, name: user?.username || 'Hôte', avatar });
      navigate(`/watch/${r.sessionId}/room`);
    } catch (e) {
      setLoading(false);
      alert(e.message || 'Impossible de créer la séance');
    }
  };

  return (
    <button onClick={start} disabled={loading} title="Regarder ensemble (synchronisé)"
      className={`inline-flex items-center justify-center gap-2 h-[46px] px-6 rounded-full bg-white/10 backdrop-blur-xl text-white text-[15px] font-semibold hover:bg-white/[0.17] active:scale-[0.97] transition-all disabled:opacity-60 ${className}`}>
      <Users size={17} />
      {loading ? 'Création…' : 'Regarder ensemble'}
    </button>
  );
}
