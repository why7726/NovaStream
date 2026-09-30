// Wires the existing PlayerV2 <video> into a watch-party session WITHOUT
// touching the player's own controls. It observes the video's native
// play/pause/seeked events (host → broadcast) and applies remote state
// (guest → follow), using a suppress flag to avoid feedback loops.
//
// Audio / subtitles / quality stay 100% independent per person — only the
// playback position + play/pause are synchronized.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrent, on, sendControl, sendSync, sendBuffering, connectSession, isConnected, leave } from './watchParty';
import authService from '../../services/authService';

export default function useWatchSync(videoRef) {
  const navigate = useNavigate();

  useEffect(() => {
    const cur = getCurrent();
    if (!cur) return; // normal (solo) playback — do nothing.

    // Make sure the socket is live (survives SPA nav; reconnects after a reload).
    if (!isConnected()) connectSession(cur);

    const isHost = !!cur.isHost;
    let suppress = false;
    const offs = [];

    const video = () => videoRef.current;

    // Buffering awareness (everyone) → powers "en attente que X charge".
    // Debounced: transcoded streams fire brief `waiting` events constantly, so we
    // only report buffering if it lasts >1.4s, and clear it the instant it resumes.
    let bufTimer = null;
    let lastBuf = false;
    const setBuf = (b) => { if (b === lastBuf) return; lastBuf = b; sendBuffering(b); };
    const clearBuf = () => { if (bufTimer) { clearTimeout(bufTimer); bufTimer = null; } };
    const onWaiting = () => { clearBuf(); bufTimer = setTimeout(() => { bufTimer = null; setBuf(true); }, 1400); };
    const onResume = () => { clearBuf(); setBuf(false); };
    const attachBuffer = () => {
      const v = video(); if (!v) return false;
      v.addEventListener('waiting', onWaiting);
      v.addEventListener('playing', onResume);
      v.addEventListener('canplay', onResume);
      v.addEventListener('timeupdate', onResume);
      offs.push(() => { v.removeEventListener('waiting', onWaiting); v.removeEventListener('playing', onResume); v.removeEventListener('canplay', onResume); v.removeEventListener('timeupdate', onResume); clearBuf(); });
      return true;
    };
    if (!attachBuffer()) {
      const bt = setInterval(() => { if (attachBuffer()) clearInterval(bt); }, 200);
      offs.push(() => clearInterval(bt));
    }

    // Session ended by the host → clean up and go home.
    offs.push(on('ended', () => {
      const guest = authService.getUser()?.guest;
      leave();
      if (guest) {
        // Guests have no real account — log out and hard-reload to a clean state
        // (avoids the app briefly hitting authed endpoints as a dead guest).
        authService.logout();
        window.location.replace('/login');
      } else {
        navigate('/', { replace: true });
      }
    }));

    if (isHost) {
      const emit = () => {
        const v = video(); if (!v || suppress) return;
        sendControl({ playing: !v.paused, position: v.currentTime });
      };
      const attach = () => {
        const v = video(); if (!v) return false;
        v.addEventListener('play', emit);
        v.addEventListener('pause', emit);
        v.addEventListener('seeked', emit);
        offs.push(() => { v.removeEventListener('play', emit); v.removeEventListener('pause', emit); v.removeEventListener('seeked', emit); });
        return true;
      };
      // The ref may not be populated on the very first tick.
      if (!attach()) {
        const t = setInterval(() => { if (attach()) clearInterval(t); }, 200);
        offs.push(() => clearInterval(t));
      }
      // Drift-correction heartbeat.
      const hb = setInterval(() => {
        const v = video(); if (v) sendSync({ playing: !v.paused, position: v.currentTime });
      }, 2000);
      offs.push(() => clearInterval(hb));
    } else {
      const apply = (st) => {
        const v = video(); if (!v || !st) return;
        suppress = true;
        if (Math.abs(v.currentTime - st.position) > 1.3) {
          try { v.currentTime = st.position; } catch {}
        }
        if (st.playing && v.paused) v.play().catch(() => {});
        if (!st.playing && !v.paused) v.pause();
        setTimeout(() => { suppress = false; }, 350);
      };
      offs.push(on('control', apply));
      offs.push(on('sync', apply));
    }

    return () => offs.forEach((fn) => fn && fn());
  }, [videoRef, navigate]);
}
