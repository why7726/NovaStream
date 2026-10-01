import { tr } from '../../i18n';
// ═══════════════════════════════════════════════════════════════════
//  Chromecast (Google Cast)
//
//  Le SDK n'existe que sur Chrome/Edge de bureau et Android : on le charge
//  donc à la demande, et si rien ne répond, aucun bouton n'apparaît.
//  Le Chromecast va chercher la vidéo lui-même : il faut donc lui donner
//  une URL absolue en HTTPS, pas un chemin relatif.
// ═══════════════════════════════════════════════════════════════════

const SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

let ready = null;
const listeners = new Set();

export function castSupported() {
  return typeof window !== 'undefined' && /Chrome|CriOS|Edg/.test(navigator.userAgent) && !/OPR/.test(navigator.userAgent);
}

/** Charge le SDK une seule fois et initialise le contexte. */
export function initCast() {
  if (ready) return ready;
  if (!castSupported()) return Promise.resolve(false);

  ready = new Promise((resolve) => {
    window.__onGCastApiAvailable = (available) => {
      if (!available) return resolve(false);
      try {
        const ctx = window.cast.framework.CastContext.getInstance();
        ctx.setOptions({
          receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        ctx.addEventListener(
          window.cast.framework.CastContextEventType.CAST_STATE_CHANGED,
          () => listeners.forEach((l) => l(getCastState()))
        );
        resolve(true);
      } catch {
        resolve(false);
      }
    };

    const tag = document.createElement('script');
    tag.src = SDK;
    tag.async = true;
    tag.onerror = () => resolve(false);
    document.head.appendChild(tag);

    // Pas de réponse au bout de 6 s : on considère qu'il n'y a rien à caster.
    setTimeout(() => resolve(!!window.cast?.framework), 6000);
  });
  return ready;
}

/** 'no_devices' | 'not_connected' | 'connecting' | 'connected' */
export function getCastState() {
  try {
    return window.cast.framework.CastContext.getInstance().getCastState().toLowerCase();
  } catch {
    return 'no_devices';
  }
}

export function onCastStateChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Envoie une vidéo sur la télé.
 * @param {{url:string, title:string, subtitle?:string, poster?:string, currentTime?:number, isHLS?:boolean}} media
 */
export async function castMedia(media) {
  const ctx = window.cast.framework.CastContext.getInstance();
  await ctx.requestSession();
  const session = ctx.getCurrentSession();
  if (!session) throw new Error(tr('Aucune session'));

  // URL absolue : c'est la télé qui télécharge, pas le navigateur.
  const absolute = new URL(media.url, window.location.origin).href;
  const contentType = media.isHLS ? 'application/x-mpegurl' : 'video/mp4';

  const info = new window.chrome.cast.media.MediaInfo(absolute, contentType);
  info.streamType = window.chrome.cast.media.StreamType.BUFFERED;
  info.metadata = new window.chrome.cast.media.GenericMediaMetadata();
  info.metadata.title = media.title || 'NovaStream';
  if (media.subtitle) info.metadata.subtitle = media.subtitle;
  if (media.poster) info.metadata.images = [new window.chrome.cast.Image(media.poster)];

  const request = new window.chrome.cast.media.LoadRequest(info);
  if (media.currentTime) request.currentTime = media.currentTime;

  await session.loadMedia(request);
  return true;
}

export function stopCast() {
  try { window.cast.framework.CastContext.getInstance().endCurrentSession(true); } catch { /* deja fini */ }
}

export default { castSupported, initCast, getCastState, onCastStateChange, castMedia, stopCast };
