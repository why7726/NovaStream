import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Languages, Volume2, VolumeX, Subtitles, Check, Wifi, WifiOff, SkipForward, SkipBack, Play, Pause, FastForward, Rewind, Maximize, Minimize, Gauge, X, MonitorSmartphone, PictureInPicture2, Cast } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import plexService from '../../services/plexService';
import progressService from '../../services/progressService';
import activityService from '../../services/activityService';
import authService from '../../services/authService';
import { useFeatures } from '../lib/features';
import Indisponible from '../pure/Indisponible';
import useWatchSync from '../lib/useWatchSync';
import { getAudioPref, setAudioPref, classifyAudio, audioLabel, versionOptions, pickAudioStream } from '../lib/audioPref';
import { castSupported, initCast, getCastState, onCastStateChange, castMedia, stopCast } from '../lib/castService';
import WatchPartyOverlay from '../components/WatchPartyOverlay';

// hls.js (≈520 kB) n'est chargé que si le flux en a besoin. Le téléchargement
// est lancé dès le montage, en parallèle de la requête de métadonnées : quand on
// sait que le flux est HLS, le module est déjà là — aucun délai ajouté.
let HlsMod = null;
let hlsLoading = null;
function loadHlsModule() {
  if (HlsMod) return Promise.resolve(HlsMod);
  if (!hlsLoading) hlsLoading = import('hls.js').then((m) => { HlsMod = m.default; return HlsMod; });
  return hlsLoading;
}

const QUALITY_OPTIONS = [
  { id: 'original', label: 'Qualité Originale', bitrate: '200000', res: '3840x2160', quality: '100' },
  { id: 'high', label: 'FHD (1080p) • 10 Mbps', bitrate: '10000', res: '1920x1080', quality: '90' },
  { id: 'medium', label: 'HD (720p) • 4 Mbps', bitrate: '4000', res: '1280x720', quality: '60' },
  { id: 'low', label: 'SD (480p) • 1.5 Mbps', bitrate: '1500', res: '720x480', quality: '40' }
];

/* Qualité de DÉPART choisie d'après la connexion RÉELLE.

   On se fie au débit mesuré (`downlink`) et à la latence (`rtt`), PAS au nom de
   la technologie : une 5G à une barre, dans un train ou en partage de
   connexion, est plus lente qu'une 3G correcte — le navigateur annonce pourtant
   « 4g ». Demander du 1080p à 10 Mbps sur un lien à 2 Mbps ne démarre jamais :
   le lecteur attend un segment qui n'arrivera pas. On peut toujours remonter à
   la main dans les paramètres, et le lecteur redescend tout seul s'il cale. */
function qualiteSelonReseau() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return QUALITY_OPTIONS[0];
  const debit = typeof c.downlink === 'number' && c.downlink > 0 ? c.downlink : null; // Mbps mesurés
  const latence = typeof c.rtt === 'number' && c.rtt > 0 ? c.rtt : null;              // ms
  const type = c.effectiveType || '';

  if (c.saveData) return QUALITY_OPTIONS[3];                                   // 480p — économie de données
  if (debit !== null) {
    if (debit < 1.5) return QUALITY_OPTIONS[3];                                // 480p
    if (debit < 4) return QUALITY_OPTIONS[2];                                  // 720p
    if (debit < 9) return QUALITY_OPTIONS[1];                                  // 1080p
    // Débit correct mais latence catastrophique : le transcodage n'aura jamais
    // d'avance, on reste prudent.
    if (latence !== null && latence > 500) return QUALITY_OPTIONS[1];
    return QUALITY_OPTIONS[0];
  }
  // Aucun chiffre : l'étiquette, en dernier recours.
  if (/^(slow-2g|2g)$/.test(type)) return QUALITY_OPTIONS[3];
  if (type === '3g') return QUALITY_OPTIONS[2];
  return QUALITY_OPTIONS[0];
}

// Délais de l'écran d'attente (ms) : message rassurant, puis proposition d'agir.
const ATTENTE_LENTE = 9000;
const ATTENTE_ECHEC = 28000;

function PlayerV2() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [media, setMedia] = useState(null);
  const [siblings, setSiblings] = useState({ prev: null, next: null });
  const [loading, setLoading] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const [error, setError] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('audio');
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedSubtitle, setSelectedSubtitle] = useState(null);
  const [selectedQuality, setSelectedQuality] = useState(qualiteSelonReseau);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeMarker, setActiveMarker] = useState(null);
  const [playbackMethod, setPlaybackMethod] = useState(null); 
  const [hlsReady, setHlsReady] = useState(false);
  // 'ok' → ça charge normalement · 'lent' → ça traîne · 'bloque' → on propose d'agir
  const [attente, setAttente] = useState('ok');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [autoSkipIntro, setAutoSkipIntro] = useState(() => localStorage.getItem('nova_autoskip_intro') === '1');
  // Confort de lecture des sous-titres, retenu d'une fois sur l'autre
  const [subSize, setSubSize] = useState(() => Number(localStorage.getItem('nova_sub_size') || 100));
  const [subRaised, setSubRaised] = useState(() => localStorage.getItem('nova_sub_raised') === '1');
  const [autoNextArmed, setAutoNextArmed] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState(null); // 'fwd' | 'back'
  const autoNextCancelledRef = useRef(false);
  const autoSkippedRef = useRef(new Set());
  const lastTapRef = useRef(0);
  const seekFeedbackTimerRef = useRef(null);
  const touchStateRef = useRef(null);
  const playerContainerRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const hideTimerRef = useRef(null);
  const saveIntervalRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const resumeTimeRef = useRef(0);
  const isChangingTrackRef = useRef(false);
  const mediaRef = useRef(null);
  const lastShownTimeRef = useRef(0);
  const loadGenRef = useRef(0);
  // Sous-titres externes (OpenSubtitles)
  const [extSubs, setExtSubs] = useState(null);        // null = pas encore cherché
  const [extSub, setExtSub] = useState(null);          // { fileId, name, url }
  const [extBusy, setExtBusy] = useState(false);
  const [extError, setExtError] = useState(null);
  const [extAuto, setExtAuto] = useState(false);       // vrai si ajouté automatiquement
  const extUrlRef = useRef(null);
  // Clé OpenSubtitles renseignée ? Sinon : message, et pas de recherche automatique.
  const features = useFeatures();
  const soustitresEnLigne = !features || features.soustitres !== false;
  // Sous-titre INTÉGRÉ au fichier, extrait par le serveur pour éviter un transcodage
  const [sousTitreIntegre, setSousTitreIntegre] = useState(null);  // { url, langue }
  const [sousTitreEnCours, setSousTitreEnCours] = useState(false);
  const stIntegreUrlRef = useRef(null);
  const vttBrutRef = useRef(null);                    // le VTT d'origine, non décalé
  // Décalage retenu d'une fois sur l'autre : un même encodeur décale souvent pareil
  const [subOffset, setSubOffset] = useState(() => Number(localStorage.getItem('nova_sub_offset') || 0));

  // Diffusion vers la tele (AirPlay, Safari/iOS) et image dans l'image
  const [airplayReady, setAirplayReady] = useState(false);
  const [inPip, setInPip] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || typeof window.WebKitPlaybackTargetAvailabilityEvent === 'undefined') return;
    const onAvail = (e) => setAirplayReady(e.availability === 'available');
    v.addEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
    return () => v.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
  }, [media]);

  // Chromecast : le bouton n'apparait que si une tele est detectee
  const [castState, setCastState] = useState('no_devices');
  useEffect(() => {
    if (!castSupported()) return;
    let off = () => {};
    initCast().then((ok) => {
      if (!ok) return;
      setCastState(getCastState());
      off = onCastStateChange(setCastState);
    });
    return () => off();
  }, []);

  const sendToTv = async () => {
    const v = videoRef.current;
    const playback = plexService.getPlaybackUrl(id, mediaRef.current, {
      audioStreamID: selectedAudio, subtitleStreamID: selectedSubtitle, quality: selectedQuality,
    });
    try {
      await castMedia({
        url: playback.url,
        isHLS: playback.isHLS,
        title: media.type === 'episode' && media.grandparentTitle ? media.grandparentTitle : media.title,
        subtitle: media.type === 'episode' ? media.title : (media.year ? String(media.year) : ''),
        poster: media.poster,
        currentTime: v ? v.currentTime : 0,
      });
      v?.pause();   // la tele prend le relais
    } catch (e) {
      console.warn('[Cast]', e?.message || e);
    }
  };

  const openAirplay = () => {
    try { videoRef.current?.webkitShowPlaybackTargetPicker?.(); } catch { /* pas de cible */ }
  };

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); setInPip(false); }
      else { await v.requestPictureInPicture(); setInPip(true); }
    } catch { /* refuse par le navigateur */ }
  };

  // Watch-party sync (no-op when not in a session).
  useWatchSync(videoRef);

  // Démarre le téléchargement de hls.js tout de suite : il arrivera pendant
  // que Plex renvoie les métadonnées, donc sans coûter une seule ms au lancement.
  useEffect(() => { loadHlsModule(); }, []);

  const destroyHLS = useCallback(() => {
    const currentMedia = mediaRef.current;
    if (videoRef.current && currentMedia) {
      activityService.log('stop', id, currentMedia.title, { 
        time: videoRef.current.currentTime,
        duration: videoRef.current.duration 
      });
    }
    
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setHlsReady(false);
  }, [id]);

  /* Reconstruction d'une session de transcodage perdue.
     Plex peut tuer une session en cours de route (inactivité mal détectée,
     transcodeur qui s'arrête, place disque…). On repart alors d'une session
     NEUVE à la seconde où on en était — l'utilisateur voit une petite pause,
     pas un épisode figé. Limité à 3 tentatives pour ne pas boucler. */
  const relancesRef = useRef(0);
  const relanceEnCoursRef = useRef(false);

  const sessionPerdue = useCallback(() => {
    if (relanceEnCoursRef.current) return;
    const media = mediaRef.current;
    if (!media) return;
    if (relancesRef.current >= 3) { destroyHLS(); setAttente('bloque'); return; }

    relanceEnCoursRef.current = true;
    relancesRef.current += 1;
    const video = videoRef.current;
    resumeTimeRef.current = video?.currentTime || resumeTimeRef.current || 0;
    console.warn(`[Player] session de transcodage perdue → relance ${relancesRef.current}/3 à ${Math.round(resumeTimeRef.current)}s`);
    setHlsReady(false);
    destroyHLS();
    plexService.stopTranscodeSession().finally(() => {
      loadPlaybackRef.current?.();
      relanceEnCoursRef.current = false;
    });
  }, [destroyHLS]);

  // `loadPlayback` est défini plus bas ; on y accède par une référence pour
  // éviter une dépendance circulaire entre les deux fonctions.
  const loadPlaybackRef = useRef(null);

  const loadHLSStream = useCallback(async (url) => {
    const video = videoRef.current;
    if (!video) return;

    // Jeton de génération : si un autre chargement (changement de piste, de
    // qualité, d'épisode) démarre pendant l'attente du module, celui-ci abandonne
    // au lieu de créer une 2e instance hls.js sur la même vidéo.
    const gen = ++loadGenRef.current;
    destroyHLS();
    setAttente('ok');   // nouvelle tentative : on repart d'un écran d'attente neutre
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    /* ── Lecture NATIVE (iPhone, Safari) ──
       Le lecteur du système va chercher le m3u8 lui-même. Il faut donc que
       l'URL porte le jeton (voir plexService.getTranscodeUrl) ET qu'on écoute
       l'échec : sans le gestionnaire `error` ci-dessous, un manifeste refusé
       laissait « Préparation du flux… » tourner indéfiniment, sans message et
       sans rien à cliquer. C'est ce qui bloquait la lecture sur iPhone. */
    if (isSafari && video.canPlayType('application/vnd.apple.mpegurl')) {
      const surErreur = () => {
        if (gen !== loadGenRef.current) return;
        console.warn('[Player] flux natif refusé', video.error?.code, video.error?.message);
        setAttente('bloque');
      };
      video.addEventListener('error', surErreur, { once: true });
      video.addEventListener('loadedmetadata', () => {
        if (gen !== loadGenRef.current) return;
        video.removeEventListener('error', surErreur);
        setHlsReady(true);
        video.play().catch((e) => console.warn('[Player] Native play failed:', e));
      }, { once: true });
      video.src = url;
      video.load();   // Safari ne recharge pas toujours de lui-même après un échec
      return;
    }

    const Hls = await loadHlsModule();
    if (!videoRef.current || gen !== loadGenRef.current) return; // chargement obsolète
    if (!Hls.isSupported()) {
      setError(true);
      return;
    }

    try {
      const token = authService.getToken();
      const resumeAt = resumeTimeRef.current;
      const hls = new Hls({
        debug: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 180, // was 600 — too aggressive, caused append/memory stalls
        enableWorker: true,
        startFragPrefetch: true,
        capLevelToPlayerSize: true,
        backBufferLength: 90,
        appendErrorMaxRetry: 3,
        manifestLoadingTimeOut: 10000,
        levelLoadingTimeOut: 10000,
        fragLoadingTimeOut: 20000,
        startPosition: resumeAt > 0 ? resumeAt : -1,
        // The Plex proxy now requires auth — attach the JWT to every HLS request
        // (manifests + .ts segments all flow through hls.js).
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setHlsReady(true);
        video.play().catch(e => console.warn('[Player] HLS.js play failed:', e));
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        /* Session de transcodage disparue → Plex répond 404 sur CHAQUE segment.
           Relancer le chargement ne sert alors à rien : hls.js redemande
           éternellement le même segment mort (constaté : 41 échecs d'affilée sur
           00725.ts). Il faut RECONSTRUIRE une session, à la position courante. */
        const perdue = data.response?.code === 404 &&
          (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
           data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
           data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR);
        if (perdue) { sessionPerdue(); return; }

        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else { destroyHLS(); setError(true); }
        } else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          // Non-fatal stall (Plex transcoder fell behind / buffer ran dry) — kick
          // the loader so it resumes instead of freezing. The watchdog below is
          // the safety net if this isn't enough.
          try { hls.startLoad(); } catch {}
        }
      });

      hls.loadSource(url);
      hls.attachMedia(video);
      hlsRef.current = hls;
      // Resume is handled by startPosition above; clear so onLoadedData won't double-seek.
      resumeTimeRef.current = 0;
    } catch (err) {
      setError(true);
    }
  }, [destroyHLS, sessionPerdue]);

  const loadPlayback = useCallback((mediaData, audioId, subId, quality) => {
    if (!mediaData) return;
    const playback = plexService.getPlaybackUrl(mediaData.id, mediaData, {
      audioStreamID: audioId,
      subtitleStreamID: subId,
      quality: quality || selectedQuality
    });
    setPlaybackMethod(playback.isHLS ? 'hls' : 'direct');
    /* On dit au serveur COMMENT on lit : c'est la seule façon de savoir si le
       travail sur les codecs et les sous-titres évite vraiment des
       transcodages (tableau de bord admin). */
    fetch(`${apiBase}/api/playback-method`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ mediaId: mediaData.id, method: playback.isHLS ? 'transcode' : 'direct' }),
    }).catch(() => {});
    if (playback.isHLS) loadHLSStream(playback.url);
    else {
      destroyHLS();
      if (videoRef.current) videoRef.current.src = playback.url;
      /* Lecture directe AVEC un sous-titre texte : la vidéo part tout de suite
         et le sous-titre arrive dès qu'il est extrait (~13 s la première fois,
         instantané ensuite). Bien mieux que de ré-encoder le film. */
      setSousTitreIntegre(null);
      if (playback.sousTitreALivrer) chargerSousTitreIntegre(playback.sousTitreALivrer);
    }
  }, [loadHLSStream, destroyHLS, selectedQuality]);

  /* Relire la lecture courante à l'identique — c'est ce qu'appelle la
     reconstruction de session, qui n'a pas les paramètres sous la main. */
  useEffect(() => {
    loadPlaybackRef.current = () => {
      const m = mediaRef.current;
      if (m) loadPlayback(m, selectedAudio, selectedSubtitle, selectedQuality);
    };
  }, [loadPlayback, selectedAudio, selectedSubtitle, selectedQuality]);

  // Nouvelle vidéo → on repart avec un compteur de relances neuf.
  useEffect(() => { relancesRef.current = 0; }, [id]);

  const needsInitialPlayRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    
    const fetchMedia = async () => {
      setLoading(true);
      setError(false);
      setMedia(null);
      setSiblings({ prev: null, next: null });
      // Reset auto-features for the new media.
      autoNextCancelledRef.current = false;
      autoSkippedRef.current = new Set();
      setAutoNextArmed(false);
      destroyHLS();
      
      try {
        const data = await plexService.getMetadata(id);
        if (!isMounted) return;
        
        // Saison / série ouverte par erreur : pas de fichier à lire, mais une
        // fiche existe. On y redirige au lieu d'afficher « Lecture impossible ».
        if (data && !data.mediaUrl && !data.partKey && (data.type === 'season' || data.type === 'show' || data.grandparentRatingKey || data.parentRatingKey)) {
          const target = data.type === 'show' ? data.id : (data.grandparentRatingKey || data.parentRatingKey || data.id);
          navigate(`/title/${target}`, { replace: true });
          return;
        }

        if (data && (data.mediaUrl || data.partKey)) {
          setMedia(data);
          mediaRef.current = data;
          
          activityService.log('play', id, data.title);
          
          if (data.parentRatingKey) {
            plexService.getSiblingEpisodes(data.parentRatingKey, id).then(sibs => {
              if (isMounted) setSiblings(sibs);
            });
          }

          if (data.audioStreams?.length) {
            // On respecte la version choisie (VF par défaut, VO si demandé) ;
            // les fichiers d'animés étant souvent mal étiquetés, la détection
            // s'appuie d'abord sur le titre de la piste.
            const sel = pickAudioStream(data.audioStreams, getAudioPref());
            setSelectedAudio(sel?.id || null);
          }
          if (data.subtitleStreams?.length) {
            const sel = data.subtitleStreams.find(s => s.selected);
            setSelectedSubtitle(sel?.id || null);
          }
          const progress = await progressService.getProgress(id);
          if (isMounted && progress && progress.currentTime > 10 && !progress.completed) {
            resumeTimeRef.current = progress.currentTime;
          }
          needsInitialPlayRef.current = true;
        } else {
          setError(true);
        }
      } catch (err) {
        if (isMounted) setError(true);
      } finally {
        if (isMounted) {
          setLoading(false);
          setIsNavigating(false);
        }
      }
    };
    fetchMedia();

    return () => {
      isMounted = false;
      destroyHLS();
      plexService.stopTranscodeSession();
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [id, destroyHLS]);

  useEffect(() => {
    if (loading || !media || !needsInitialPlayRef.current || !videoRef.current) return;
    needsInitialPlayRef.current = false;
    /* On impose la piste à Plex DÈS QU'IL Y A UN CHOIX possible.
       Avant, on ne le faisait que si la piste voulue n'était pas la première du
       fichier — mais Plex mémorise une sélection côté serveur : un film lancé
       une fois en japonais repartait en japonais malgré la bascule sur VF.
       Une requête de plus (locale, instantanée) garantit que la lecture démarre
       bien dans la version cochée. */
    const needsSelect = media.partId && (
      (media.audioStreams?.length || 0) > 1 || selectedSubtitle != null
    );
    if (needsSelect) {
      plexService.setStreams(media.partId, { audioStreamID: selectedAudio, subtitleStreamID: selectedSubtitle ?? 0 })
        .finally(() => loadPlayback(media, selectedAudio, selectedSubtitle, selectedQuality));
    } else {
      loadPlayback(media, selectedAudio, selectedSubtitle, selectedQuality);
    }
  }, [loading, media, loadPlayback, selectedAudio, selectedSubtitle, selectedQuality]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    // timeupdate tire ~4×/s : on ne repeint que quand la seconde affichée change
    // (et le buffer quand il bouge vraiment). Divise les rendus par ~4.
    const t = video.currentTime;
    if (Math.floor(t) !== Math.floor(lastShownTimeRef.current)) {
      lastShownTimeRef.current = t;
      setCurrentTime(t);
    }
    const exactDuration = mediaRef.current?.rawDuration ? mediaRef.current.rawDuration / 1000 : video.duration;
    setDuration((d) => (Math.abs((d || 0) - (exactDuration || 0)) > 0.5 ? exactDuration : d));

    if (video.buffered.length > 0) {
      const end = video.buffered.end(video.buffered.length - 1);
      setBuffered((b) => (Math.abs(b - end) > 1 ? end : b));
    }

    // Detect whether we're inside an intro/credits marker (for the skip button).
    const markers = mediaRef.current?.markers || [];
    // Stop offering the skip ~1.5s before the marker ends to avoid a flash.
    const active = markers.find(m => t >= m.start && t < m.end - 1.5);

    // Auto-skip the intro once, if the option is enabled.
    if (active && active.type === 'intro' && autoSkipIntro && !autoSkippedRef.current.has(active.start)) {
      autoSkippedRef.current.add(active.start);
      video.currentTime = active.end;
      setActiveMarker(null);
    } else {
      setActiveMarker(prev => (prev?.start === active?.start && prev?.type === active?.type) ? prev : (active || null));
    }

    // Netflix-style auto-next: arm at the credits marker, else in the last 30s.
    // Use the ACTUAL video duration (not Plex metadata) so the end window is reliable.
    const realDur = video.duration && isFinite(video.duration) ? video.duration : (exactDuration || 0);
    const credits = markers.find(m => m.type === 'credits');
    const inEndZone = credits ? (t >= credits.start) : (realDur > 0 && (realDur - t) <= 30 && (realDur - t) > 0);
    if (siblings.next && inEndZone && !autoNextArmed && !autoNextCancelledRef.current && !isNavigating) {
      setAutoNextArmed(true);
    }
  };

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) return v.pause();
    /* `play()` renvoie une promesse qui PEUT être rejetée (source non chargée,
       geste utilisateur exigé…). Sans ce `catch`, le rejet remontait au
       rapporteur de crash : les journaux se remplissaient de « The operation is
       not supported » alors que le vrai problème était le flux qui n'avait pas
       démarré. On le signale dans l'écran d'attente à la place. */
    const p = v.play();
    if (p && typeof p.catch === 'function') {
      p.catch((e) => {
        console.warn('[Player] play() refusé :', e?.name, e?.message);
        if (!v.currentSrc || v.readyState === 0) setAttente('bloque');
      });
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = playerContainerRef.current;
    const v = videoRef.current;
    const inFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!inFs) {
      if (el?.requestFullscreen) el.requestFullscreen().catch(console.warn);
      else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS Safari: video-only fullscreen
      else if (v?.requestFullscreen) v.requestFullscreen().catch(console.warn);
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(console.warn);
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      videoRef.current.muted = newMuted;
      if (!newMuted && volume === 0) {
        setVolume(1);
        videoRef.current.volume = 1;
      }
    }
  };

  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleTimelineChange = (e) => {
    const val = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
      lastShownTimeRef.current = val;
      setCurrentTime(val);
    }
  };

  const skipMarker = () => {
    if (activeMarker && videoRef.current) {
      videoRef.current.currentTime = activeMarker.end;
      setActiveMarker(null);
    }
  };

  const handleNextEpisode = () => {
    if (siblings.next && !isNavigating) {
      setIsNavigating(true);
      plexService.stopTranscodeSession();
      navigate(`/play/${siblings.next.id}`);
    }
  };

  const handlePrevEpisode = () => {
    if (siblings.prev && !isNavigating) {
      setIsNavigating(true);
      plexService.stopTranscodeSession();
      navigate(`/play/${siblings.prev.id}`);
    }
  };

  const cancelAutoNext = () => {
    autoNextCancelledRef.current = true;
    setAutoNextArmed(false);
  };

  // Netflix-style auto-next: once armed (at the credits), the button fills for 5s
  // then advances to the next episode.
  useEffect(() => {
    if (!autoNextArmed) return;
    const t = setTimeout(() => handleNextEpisode(), 5000);
    return () => clearTimeout(t);
  }, [autoNextArmed]);

  const toggleAutoSkipIntro = () => {
    setAutoSkipIntro(prev => {
      const next = !prev;
      localStorage.setItem('nova_autoskip_intro', next ? '1' : '0');
      return next;
    });
  };

  /* Un seul geste conserve : le double-appui pour reculer ou avancer de 10 s.
     Les glissements verticaux (luminosite a gauche, volume a droite) ont ete
     retires : c'etait invisible, on les declenchait sans le vouloir, et ni
     Apple TV ni Netflix ne font ca. */
  const handleVideoTouchEnd = (e) => {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const isRight = touch.clientX > rect.left + rect.width / 2;
    if (now - lastTapRef.current < 320) {
      const v = videoRef.current;
      if (v) v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + (isRight ? 10 : -10)));
      setSeekFeedback(isRight ? 'fwd' : 'back');
      if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
      seekFeedbackTimerRef.current = setTimeout(() => setSeekFeedback(null), 500);
      lastTapRef.current = 0;
      e.preventDefault();
    } else {
      lastTapRef.current = now;
    }
  };

  useEffect(() => {
    if (!media) return;
    saveIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (video && video.currentTime > 0 && video.duration > 0) {
        progressService.saveProgress(id, video.currentTime, video.duration, {
          mediaTitle: media.title, mediaPoster: media.poster, mediaType: media.type
        });
      }
    }, 10000);
    return () => { if (saveIntervalRef.current) clearInterval(saveIntervalRef.current); };
  }, [media, id]);

  useEffect(() => {
    if (!media || playbackMethod !== 'hls') return;
    /* Toutes les 10 s, comme Plex Web. À 30 s on jouait avec le feu : le
       compteur d'inactivité de Plex tourne pendant ce temps-là. */
    const battement = () => {
      const video = videoRef.current;
      if (!video) return;
      plexService.pingTranscodeSession(id, video.currentTime, video.duration, video.paused ? 'paused' : 'playing');
    };
    battement();
    pingIntervalRef.current = setInterval(battement, 10000);
    return () => { if (pingIntervalRef.current) clearInterval(pingIntervalRef.current); };
  }, [media, id, playbackMethod]);

  /* ── Préchauffage de l'épisode suivant ──
     Dans les 90 dernières secondes, on va chercher la fiche du prochain
     épisode : elle est alors déjà en cache quand on appuie sur « suivant »,
     et la page s'ouvre sans temps mort.
     On s'arrête là VOLONTAIREMENT : lancer aussi son transcodage ferait
     tourner deux encodages en parallèle sur le PC, pour un gain incertain. */
  const prechauffeRef = useRef(null);
  useEffect(() => {
    const suivant = siblings.next?.id;
    if (!suivant || !duration || prechauffeRef.current === suivant) return;
    const reste = duration - currentTime;
    if (reste > 0 && reste < 90) {
      prechauffeRef.current = suivant;
      plexService.getMetadata(suivant).catch(() => {});
    }
  }, [currentTime, duration, siblings.next]);

  // Stall watchdog: if playback freezes (e.g. Plex transcoder stalls after a
  // while), recover automatically — nudge the loader, then recoverMediaError,
  // then a full reload at the same position — instead of staying frozen.
  useEffect(() => {
    if (!media || playbackMethod !== 'hls') return;
    let lastT = -1, frozen = 0;
    const watch = setInterval(() => {
      const v = videoRef.current;
      // Skip while the transcode is still warming up (no frame yet, currentTime≈0):
      // otherwise a slow first start looked "frozen" and the watchdog kept HARD-
      // RELOADING it → endless restart loop (~1 min to finally play). Only recover
      // real mid-playback stalls (currentTime already advanced).
      if (!v || v.paused || v.seeking || v.ended || isChangingTrackRef.current || v.currentTime < 0.1) { lastT = v ? v.currentTime : -1; frozen = 0; return; }
      if (Math.abs(v.currentTime - lastT) < 0.05) frozen += 2; else frozen = 0;
      lastT = v.currentTime;
      const hls = hlsRef.current;
      if (frozen === 6) { try { hls?.startLoad(); } catch {} v.play().catch(() => {}); }
      else if (frozen === 12) { try { hls?.recoverMediaError(); } catch {} v.play().catch(() => {}); }
      else if (frozen >= 20) {
        frozen = 0;
        resumeTimeRef.current = v.currentTime; // reload from where we froze
        plexService.stopTranscodeSession().then(() => {
          loadPlayback(mediaRef.current || media, selectedAudio, selectedSubtitle, selectedQuality);
        });
      }
    }, 2000);
    return () => clearInterval(watch);
  }, [media, playbackMethod, selectedAudio, selectedSubtitle, selectedQuality, loadPlayback]);

  const handleVideoLoaded = () => {
    if (resumeTimeRef.current > 0 && videoRef.current) {
      videoRef.current.currentTime = resumeTimeRef.current;
      resumeTimeRef.current = 0;
    }
  };

  const handleBeforeUnload = useCallback(() => {
    const video = videoRef.current;
    if (video && media && video.currentTime > 0) {
      progressService.saveProgress(id, video.currentTime, video.duration, {
        mediaTitle: media.title, mediaPoster: media.poster, mediaType: media.type
      });
    }
  }, [media, id]);

  useEffect(() => {
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [handleBeforeUnload]);

  const handleBack = () => {
    handleBeforeUnload();
    plexService.stopTranscodeSession();
    destroyHLS();
    if (media && media.type === 'episode' && media.grandparentRatingKey) {
      navigate(`/title/${media.grandparentRatingKey}`);
    } else if (typeof window.history.state?.idx === 'number' && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      // Lecteur ouvert directement (lien partagé, app installée) : rien derrière,
      // donc `navigate(-1)` ne ferait rien. On remonte à la fiche du titre.
      navigate(media?.id ? `/title/${media.id}` : '/', { replace: true });
    }
  };

  const handleAudioChange = (audioId) => {
    if (audioId === selectedAudio) return;
    const video = videoRef.current;
    resumeTimeRef.current = video?.currentTime || 0;
    isChangingTrackRef.current = true;
    setSelectedAudio(audioId);
    plexService.stopTranscodeSession().then(async () => {
      // Tell Plex to actually select this audio track (param alone isn't enough)
      await plexService.setStreams(media.partId, { audioStreamID: audioId, subtitleStreamID: selectedSubtitle ?? 0 });
      loadPlayback(media, audioId, selectedSubtitle, selectedQuality);
    });
  };

  const handleSubtitleChange = (subId) => {
    if (subId === selectedSubtitle) return;
    const video = videoRef.current;
    resumeTimeRef.current = video?.currentTime || 0;
    isChangingTrackRef.current = true;
    setSelectedSubtitle(subId);
    plexService.stopTranscodeSession().then(async () => {
      await plexService.setStreams(media.partId, { audioStreamID: selectedAudio, subtitleStreamID: subId ?? 0 });
      loadPlayback(media, selectedAudio, subId, selectedQuality);
    });
  };

  const handleQualityChange = (quality) => {
    if (quality.id === selectedQuality.id) return;
    const video = videoRef.current;
    resumeTimeRef.current = video?.currentTime || 0;
    isChangingTrackRef.current = true;
    setSelectedQuality(quality);
    plexService.stopTranscodeSession().then(() => {
      loadPlayback(media, selectedAudio, selectedSubtitle, quality);
    });
  };

  /* ── Écran d'attente : on ne laisse JAMAIS tourner un rond dans le vide ──
     Au bout de 9 s on prévient que c'est lent, au bout de 28 s on propose de
     réessayer ou de basculer en qualité réduite. Sans ça, une connexion faible
     (ou un manifeste refusé) donnait un écran noir définitif. */
  useEffect(() => {
    if (playbackMethod !== 'hls' || hlsReady) { setAttente('ok'); return; }
    const t1 = setTimeout(() => setAttente((a) => (a === 'ok' ? 'lent' : a)), ATTENTE_LENTE);
    const t2 = setTimeout(() => setAttente('bloque'), ATTENTE_ECHEC);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [playbackMethod, hlsReady, id, selectedQuality, selectedAudio, selectedSubtitle]);

  // Relance le même flux à zéro (nouvelle session de transcodage côté Plex).
  const reessayer = () => {
    if (!media) return;
    const video = videoRef.current;
    resumeTimeRef.current = video?.currentTime || resumeTimeRef.current || 0;
    setAttente('ok');
    setHlsReady(false);
    plexService.stopTranscodeSession().then(() => {
      loadPlayback(media, selectedAudio, selectedSubtitle, selectedQuality);
    });
  };

  // Descend d'un cran de qualité — le geste utile quand ça ne démarre pas.
  const qualiteInferieure = QUALITY_OPTIONS.find(
    (q, i) => i > QUALITY_OPTIONS.findIndex((x) => x.id === selectedQuality.id)
  );
  const alleger = () => {
    if (!qualiteInferieure) return reessayer();
    setAttente('ok');
    setHlsReady(false);
    handleQualityChange(qualiteInferieure);
  };

  /* ── Filet de sécurité : ça coupe en boucle → on allège tout seul ──
     Le débit annoncé au départ peut être faux (5G qui s'effondre, wifi partagé,
     quelqu'un qui lance un téléchargement). L'événement `waiting` de la balise
     vidéo dit la vérité : le lecteur attend des données. Sur un lien sain il ne
     se produit quasiment jamais ; au 4e, on descend d'un cran — UNE seule fois,
     pour ne pas dégringoler jusqu'au 480p au premier hoquet. */
  const coupuresRef = useRef(0);
  const dejaAllegeRef = useRef(false);
  const [coupures, setCoupures] = useState(0);

  useEffect(() => { coupuresRef.current = 0; dejaAllegeRef.current = false; setCoupures(0); }, [id]);

  const surAttenteDonnees = () => {
    coupuresRef.current += 1;
    setCoupures(coupuresRef.current);
  };

  useEffect(() => {
    if (coupures < 4 || dejaAllegeRef.current || !qualiteInferieure || !media) return;
    dejaAllegeRef.current = true;
    console.warn('[Player] trop de coupures → passage en', qualiteInferieure.label);
    alleger();
  }, [coupures]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sous-titres en ligne ──────────────────────────────────────────
     Le fichier est récupéré en JS (avec le jeton) puis passé au <track>
     via une URL blob : un <track> ne peut pas porter d'en-tête d'auth. */
  const apiBase = import.meta.env.DEV ? 'http://localhost:5174' : '';
  const authHeaders = () => {
    const t = authService.getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const searchExternalSubs = useCallback(async () => {
    setExtBusy(true); setExtError(null);
    try {
      const r = await fetch(`${apiBase}/api/subtitles/search/${id}`, { headers: authHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Recherche impossible');
      const d = await r.json();
      setExtSubs(d.results || []);
      return d.results || [];
    } catch (e) {
      setExtError(e.message);
      setExtSubs([]);
      return [];
    } finally {
      setExtBusy(false);
    }
  }, [id]);

  const applyExternalSub = useCallback(async (sub, auto = false) => {
    setExtBusy(true); setExtError(null);
    try {
      const r = await fetch(`${apiBase}/api/subtitles/vtt/${sub.fileId}`, { headers: authHeaders() });
      if (!r.ok) throw new Error('Téléchargement impossible');
      const vtt = await r.text();
      if (extUrlRef.current) URL.revokeObjectURL(extUrlRef.current);
      const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      extUrlRef.current = url;
      setExtSub({ ...sub, url });
      setExtAuto(auto);
      // une piste externe et une piste Plex en même temps = doublon à l'écran
      if (selectedSubtitle != null) handleSubtitleChange(null);
    } catch (e) {
      setExtError(e.message);
    } finally {
      setExtBusy(false);
    }
  }, [selectedSubtitle]);

  /* Récupère la piste de sous-titres extraite du fichier par le serveur.
     La première fois, ffmpeg doit parcourir tout le film (~13 s) : on laisse
     donc la vidéo démarrer sans attendre, le texte s'ajoute ensuite. */
  /* Décalage des sous-titres.
     On ne touche pas aux cues déjà chargées (leur modification n'est pas
     fiable d'un navigateur à l'autre) : on RÉÉCRIT les horodatages du VTT et
     on refabrique la piste. C'est instantané et ça marche partout. */
  const decalerVtt = (texte, secondes) => {
    if (!secondes) return texte;
    const enSec = (h, m, s, ms) => (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000;
    const enTexte = (t) => {
      const v = Math.max(0, t);
      const h = String(Math.floor(v / 3600)).padStart(2, '0');
      const m = String(Math.floor((v % 3600) / 60)).padStart(2, '0');
      const s = String(Math.floor(v % 60)).padStart(2, '0');
      const ms = String(Math.round((v % 1) * 1000)).padStart(3, '0');
      return `${h}:${m}:${s}.${ms}`;
    };
    return texte.replace(
      /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})/g,
      (_, h1, m1, s1, ms1, h2, m2, s2, ms2) =>
        `${enTexte(enSec(h1, m1, s1, ms1) + secondes)} --> ${enTexte(enSec(h2, m2, s2, ms2) + secondes)}`
    );
  };

  const chargerSousTitreIntegre = useCallback(async ({ ratingKey, streamId, langue }) => {
    setSousTitreEnCours(true);
    try {
      const r = await fetch(`${apiBase}/api/subtitles/embedded/${ratingKey}/${streamId}`, { headers: authHeaders() });
      if (!r.ok) throw new Error('extraction impossible');
      const vtt = await r.text();
      if (!vtt.trim()) throw new Error('piste vide');
      vttBrutRef.current = vtt;                       // gardé pour le décalage
      if (stIntegreUrlRef.current) URL.revokeObjectURL(stIntegreUrlRef.current);
      const url = URL.createObjectURL(new Blob([decalerVtt(vtt, subOffset)], { type: 'text/vtt' }));
      stIntegreUrlRef.current = url;
      setSousTitreIntegre({ url, langue: langue || 'Français' });
    } catch (e) {
      console.warn('[Sous-titres] intégré :', e.message);
      setSousTitreIntegre(null);
    } finally {
      setSousTitreEnCours(false);
    }
  }, []);

  useEffect(() => () => { if (stIntegreUrlRef.current) URL.revokeObjectURL(stIntegreUrlRef.current); }, []);

  // Changement de décalage → on refabrique la piste à partir du VTT d'origine
  useEffect(() => {
    try { localStorage.setItem('nova_sub_offset', String(subOffset)); } catch {}
    if (!vttBrutRef.current || !sousTitreIntegre) return;
    if (stIntegreUrlRef.current) URL.revokeObjectURL(stIntegreUrlRef.current);
    const url = URL.createObjectURL(new Blob([decalerVtt(vttBrutRef.current, subOffset)], { type: 'text/vtt' }));
    stIntegreUrlRef.current = url;
    setSousTitreIntegre((s) => (s ? { ...s, url } : s));
  }, [subOffset]);   // eslint-disable-line react-hooks/exhaustive-deps

  const clearExternalSub = useCallback(() => {
    if (extUrlRef.current) { URL.revokeObjectURL(extUrlRef.current); extUrlRef.current = null; }
    setExtSub(null); setExtAuto(false);
  }, []);

  // Activation de la piste dès que le <track> est monté
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const t = setTimeout(() => {
      // Une piste externe OU la piste extraite du fichier : dans les deux cas
      // il faut l'activer à la main, un <track default> ne suffit pas.
      const afficher = !!extSub || !!sousTitreIntegre;
      for (const tr of v.textTracks || []) tr.mode = afficher ? 'showing' : 'disabled';
    }, 120);
    return () => clearTimeout(t);
  }, [extSub, sousTitreIntegre]);

  // Nettoyage de l'URL blob en quittant
  useEffect(() => () => { if (extUrlRef.current) URL.revokeObjectURL(extUrlRef.current); }, []);

  // Automatique : aucun son français ET aucun sous-titre français dans le
  // fichier → on cherche et on applique le meilleur résultat, sans rien demander.
  useEffect(() => {
    if (!media || extSub || extSubs !== null || !soustitresEnLigne) return;
    const isFr = (x) => /^fr(e|a|c)?$/i.test(x.languageCode || '')
      || /fran[çc]ais|french|vff|vfq|truefrench/i.test(`${x.language || ''} ${x.displayTitle || ''}`);
    const hasFrAudio = (media.audioStreams || []).some(isFr);
    const hasFrSubs = (media.subtitleStreams || []).some(isFr);
    if (hasFrAudio || hasFrSubs) return;
    let on = true;
    (async () => {
      const found = await searchExternalSubs();
      if (on && found.length) applyExternalSub(found[0], true);
    })();
    return () => { on = false; };
  }, [media, extSub, extSubs, searchExternalSubs, applyExternalSub, soustitresEnLigne]);

  /* Les sous-titres natifs ne se stylent que par ::cue, et seulement via
     une feuille de style : d'ou cette regle injectee, mise a jour au besoin. */
  useEffect(() => {
    const id = 'nova-cue-style';
    let tag = document.getElementById(id);
    if (!tag) {
      tag = document.createElement('style');
      tag.id = id;
      document.head.appendChild(tag);
    }
    tag.textContent = `video::cue {
      font-size: ${subSize}%;
      background: rgba(0,0,0,.55);
      color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,.9);
      font-family: -apple-system, 'SF Pro Text', Inter, sans-serif;
    }`;
    try { localStorage.setItem('nova_sub_size', String(subSize)); } catch {}
  }, [subSize]);

  // Remonter les sous-titres : utile quand les commandes les masquent.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const apply = () => {
      for (const track of v.textTracks || []) {
        for (const cue of track.cues || []) {
          cue.line = subRaised ? -4 : 'auto';
          cue.snapToLines = true;
        }
      }
    };
    apply();
    const t = setTimeout(apply, 400);
    try { localStorage.setItem('nova_sub_raised', subRaised ? '1' : '0'); } catch {}
    return () => clearTimeout(t);
  }, [subRaised, selectedSubtitle, extSub]);

  /* État des commandes suivi AUSSI dans une référence : l'appui déclenche
     plusieurs évènements à la suite (touchstart, puis click) et l'état React
     n'est pas encore à jour au moment du second — la bascule se tromperait de
     sens une fois sur deux. La référence, elle, est juste tout de suite. */
  const controlsRef = useRef(true);
  const ignorerMouvementRef = useRef(0);

  const showControls = useCallback(() => {
    controlsRef.current = true;
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!showSettings && videoRef.current && !videoRef.current.paused) {
        controlsRef.current = false;
        setControlsVisible(false);
      }
    }, 3000);
  }, [showSettings]);

  const hideControls = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    controlsRef.current = false;
    setControlsVisible(false);
    /* Sur ordinateur, le moindre frémissement de souris réaffiche les
       commandes. Sans ce court délai de grâce, elles reviendraient dans la
       foulée du clic qui vient de les masquer. */
    ignorerMouvementRef.current = Date.now() + 700;
  }, []);

  // Un appui sur l'image fait apparaître OU disparaître les commandes.
  const toggleControls = useCallback(() => {
    if (controlsRef.current) hideControls();
    else showControls();
  }, [hideControls, showControls]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
      switch(e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          if (videoRef.current) videoRef.current.currentTime += 10;
          break;
        case 'ArrowLeft':
          if (videoRef.current) videoRef.current.currentTime -= 10;
          break;
        case 'KeyF':
          toggleFullscreen();
          break;
        case 'KeyM':
          toggleMute();
          break;
      }
      showControls();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleFullscreen, toggleMute, showControls]);

  useEffect(() => {
    // Souris : on réveille les commandes, sauf juste après un masquage voulu.
    const handleGlobalMouseMove = () => {
      if (Date.now() < ignorerMouvementRef.current) return;
      showControls();
    };
    window.addEventListener('mousemove', handleGlobalMouseMove);
    /* Plus d'écouteur `touchstart` global : sur téléphone, il rallumait les
       commandes AVANT que l'appui n'arrive à la bascule, qui masquait alors
       aussitôt — l'appui semblait ne rien faire une fois sur deux. C'est la
       bascule sur l'image qui décide, elle seule. */
    showControls();
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showControls]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-7 h-7 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
          <p className="text-[13px] text-white/45">Chargement…</p>
        </div>
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8 text-center">
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] mb-3">Lecture impossible</h1>
        <p className="text-[14px] text-white/50 mb-8 max-w-md">Le fichier n'est pas disponible ou son format n'est pas compatible.</p>
        <button onClick={() => navigate(-1)} className="inline-flex items-center justify-center h-[46px] px-7 rounded-full bg-white text-black text-[15px] font-semibold hover:opacity-90 transition-opacity">Retour</button>
      </div>
    );
  }

  const audioStreams = media.audioStreams || [];
  const subtitleStreams = media.subtitleStreams || [];
  const hasSettings = true;
  const currentAudioTrack = audioStreams.find(s => s.id === selectedAudio);
  const isTranscoding = playbackMethod === 'hls';

  return (
    <div ref={playerContainerRef} className="h-screen w-full bg-black relative overflow-hidden group">
      <div className={`absolute top-0 inset-x-0 z-20 px-4 md:px-7 pt-4 md:pt-5 pb-14 bg-gradient-to-b from-black/75 to-transparent flex items-start justify-between gap-4 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-start gap-2.5 min-w-0">
          <button onClick={handleBack} aria-label="Retour"
            className="w-10 h-10 -ml-1.5 shrink-0 rounded-full flex items-center justify-center text-white/85 hover:text-white hover:bg-white/10 transition-colors">
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 pt-1.5">
            <h2 className="text-[15px] md:text-[17px] font-semibold tracking-[-0.02em] truncate">
              {media.type === 'episode' && media.grandparentTitle ? media.grandparentTitle : media.title}
            </h2>
            <p className="text-[12px] text-white/45 truncate mt-0.5">
              {[
                media.type === 'episode'
                  ? [media.parentTitle, media.index ? `Épisode ${media.index}` : null, media.title].filter(Boolean).join(' · ')
                  : null,
                versionOptions(audioStreams)
                  ? (classifyAudio(currentAudioTrack) === 'vao' ? 'VO' : versionOptions(audioStreams)[0].label)
                  : null,
                isTranscoding ? 'Transcodage' : 'Lecture directe',
              ].filter(Boolean).join('  ·  ')}
            </p>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="absolute top-0 right-0 h-full w-[320px] md:w-[380px] bg-black/40 backdrop-blur-3xl z-50 flex flex-col border-l border-white/10 shadow-[-30px_0_50px_rgba(0,0,0,0.5)]">
          <div className="p-6 md:p-8 border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl text-white font-bold tracking-tight">Paramètres</h3>
              <button onClick={() => setShowSettings(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-white/[0.06] border border-white/10 text-white/80 hover:bg-white/[0.15] hover:text-white transition-all active:scale-90"
                aria-label="Fermer les paramètres">
                <X size={18} />
              </button>
            </div>
            <div className="flex gap-1.5 p-1 bg-black/40 rounded-full border border-white/5 shadow-inner">
              <button onClick={() => setSettingsTab('audio')}
                className={`flex-1 flex justify-center items-center gap-1.5 py-2.5 rounded-full text-[13px] font-semibold transition-all ${settingsTab === 'audio' ? 'bg-white text-black shadow-md' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                <Volume2 size={15} /> Audio
              </button>
              <button onClick={() => setSettingsTab('subtitles')}
                className={`flex-1 flex justify-center items-center gap-1.5 py-2.5 rounded-full text-[13px] font-semibold transition-all ${settingsTab === 'subtitles' ? 'bg-white text-black shadow-md' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                <Subtitles size={15} /> Sous-titres
              </button>
              <button onClick={() => setSettingsTab('quality')}
                className={`flex-1 flex justify-center items-center gap-1.5 py-2.5 rounded-full text-[13px] font-semibold transition-all ${settingsTab === 'quality' ? 'bg-white text-black shadow-md' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                <Gauge size={15} /> Qualité
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2 custom-scrollbar">
            {settingsTab === 'audio' && (
              <div className="flex flex-col gap-2">
                {versionOptions(audioStreams) && (
                  <div className="flex p-1 rounded-full bg-white/[0.06] mb-2">
                    {versionOptions(audioStreams).map((v) => {
                      const on = classifyAudio(currentAudioTrack) === v.id;
                      return (
                        <button key={v.id}
                          onClick={() => {
                            setAudioPref(v.id);
                            const t = pickAudioStream(audioStreams, v.id);
                            if (t && t.id !== selectedAudio) handleAudioChange(t.id);
                          }}
                          className={`flex-1 h-9 rounded-full text-[13.5px] font-semibold transition-colors ${
                            on ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                          }`}>
                          {v.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {audioStreams.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-gray-500 gap-3">
                    <Volume2 size={32} className="opacity-20" />
                    <p className="text-sm font-medium">Aucune piste audio</p>
                  </div>
                ) : audioStreams.map(stream => {
                  const needsTranscode = plexService.needsTranscode(stream.codec);
                  return (
                    <button key={stream.id} onClick={() => handleAudioChange(stream.id)}
                      className={`flex items-center justify-between p-4 rounded-2xl text-left transition-all border ${selectedAudio === stream.id ? 'bg-white/[0.15] border-white/30 shadow-lg' : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.08] hover:border-white/15'}`}>
                      <div>
                        <p className={`text-[15px] font-bold ${selectedAudio === stream.id ? 'text-white' : 'text-gray-300'}`}>{audioLabel(stream)}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[11px] font-medium text-gray-400 bg-black/40 px-2 py-0.5 rounded-md border border-white/5">
                            {stream.codec?.toUpperCase()} • {stream.channels}ch
                          </span>
                          {needsTranscode && (
                            <span className="text-[10px] font-medium text-white/35">transcodé</span>
                          )}
                        </div>
                      </div>
                      {selectedAudio === stream.id && (
                        <div className="w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-md">
                          <Check size={14} strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            
            {settingsTab === 'subtitles' && (
              <div className="flex flex-col gap-2">
                <button onClick={() => handleSubtitleChange(null)}
                  className={`flex items-center justify-between p-4 rounded-2xl text-left transition-all border ${selectedSubtitle === null ? 'bg-white/[0.15] border-white/30 shadow-lg' : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.08] hover:border-white/15'}`}>
                  <div>
                    <p className={`text-[15px] font-bold ${selectedSubtitle === null ? 'text-white' : 'text-gray-300'}`}>Désactivés</p>
                    <p className="text-[11px] font-medium text-gray-500 mt-1">Pas de sous-titres</p>
                  </div>
                  {selectedSubtitle === null && (
                    <div className="w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-md">
                      <Check size={14} strokeWidth={3} />
                    </div>
                  )}
                </button>
                {subtitleStreams.map(stream => (
                  <button key={stream.id} onClick={() => handleSubtitleChange(stream.id)}
                    className={`flex items-center justify-between p-4 rounded-2xl text-left transition-all border ${selectedSubtitle === stream.id ? 'bg-white/[0.15] border-white/30 shadow-lg' : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.08] hover:border-white/15'}`}>
                    <div>
                      <p className={`text-[15px] font-bold ${selectedSubtitle === stream.id ? 'text-white' : 'text-gray-300'}`}>{stream.displayTitle}</p>
                      <p className="text-[11px] font-medium text-gray-400 bg-black/40 px-2 py-0.5 rounded-md border border-white/5 w-fit mt-1.5">
                        {stream.codec?.toUpperCase()}
                      </p>
                    </div>
                    {selectedSubtitle === stream.id && (
                      <div className="w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-md">
                        <Check size={14} strokeWidth={3} />
                      </div>
                    )}
                  </button>
                ))}
                {subtitleStreams.length === 0 && (
                  <p className="text-[13px] text-white/35 py-4">Aucun sous-titre dans le fichier.</p>
                )}

                {/* ── Confort de lecture ──────────────────────────────── */}
                <div className="mt-5 pt-5 border-t border-white/10">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35 mb-3">Affichage</p>

                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[13.5px] text-white/80">Taille</span>
                    <span className="text-[12px] text-white/40">{subSize} %</span>
                  </div>
                  <div className="flex gap-1.5 mb-4">
                    {[75, 100, 125, 150, 200].map((v) => (
                      <button key={v} onClick={() => setSubSize(v)}
                        className={`flex-1 h-9 rounded-xl text-[12.5px] font-medium transition-colors ${
                          subSize === v ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12]'
                        }`}>
                        {v === 75 ? 'Petit' : v === 100 ? 'Normal' : v === 125 ? 'Grand' : v === 150 ? 'Très grand' : 'Énorme'}
                      </button>
                    ))}
                  </div>

                  <button onClick={() => setSubRaised((r) => !r)}
                    className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-left transition-colors">
                    <span>
                      <span className="block text-[13.5px] text-white/85">Remonter les sous-titres</span>
                      <span className="block text-[11.5px] text-white/40 mt-0.5">Pour qu'ils ne passent pas sous les commandes</span>
                    </span>
                    <span className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${subRaised ? 'bg-white' : 'bg-white/15'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${subRaised ? 'left-[22px] bg-black' : 'left-0.5 bg-white'}`} />
                    </span>
                  </button>

                  {/* Synchro : utile quand la piste extraite décale d'une demi-seconde */}
                  {(sousTitreIntegre || extSub) && (
                    <div className="mt-2.5 p-4 rounded-2xl bg-white/[0.04]">
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-[13.5px] text-white/85">Synchronisation</span>
                        <span className="text-[12.5px] tabular-nums text-white/55">
                          {subOffset > 0 ? '+' : ''}{subOffset.toFixed(2).replace(/\.?0+$/, '')} s
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSubOffset((o) => Math.max(-5, Math.round((o - 0.25) * 100) / 100))}
                          className="flex-1 h-9 rounded-full bg-white/[0.08] hover:bg-white/[0.16] text-[13px] font-medium transition-colors">
                          − 0,25 s
                        </button>
                        <button onClick={() => setSubOffset(0)}
                          className="h-9 px-4 rounded-full bg-white/[0.08] hover:bg-white/[0.16] text-[12.5px] text-white/60 transition-colors">
                          0
                        </button>
                        <button onClick={() => setSubOffset((o) => Math.min(5, Math.round((o + 0.25) * 100) / 100))}
                          className="flex-1 h-9 rounded-full bg-white/[0.08] hover:bg-white/[0.16] text-[13px] font-medium transition-colors">
                          + 0,25 s
                        </button>
                      </div>
                      <p className="text-[11.5px] text-white/40 mt-2">
                        Négatif : le texte arrive plus tôt. Réglage conservé pour les prochains films.
                      </p>
                    </div>
                  )}
                </div>

                {/* ── En ligne (OpenSubtitles) ────────────────────────── */}
                <div className="mt-5 pt-5 border-t border-white/10">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35">En ligne</p>
                    {extSubs !== null && !extBusy && (
                      <button onClick={searchExternalSubs} className="text-[12px] text-white/40 hover:text-white transition-colors">
                        Actualiser
                      </button>
                    )}
                  </div>

                  {extSub && (
                    <button onClick={clearExternalSub}
                      className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/[0.14] text-left mb-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium truncate">{extSub.name}</p>
                        <p className="text-[11px] text-white/45 mt-0.5">
                          {extAuto ? 'Ajouté automatiquement · toucher pour retirer' : 'Actif · toucher pour retirer'}
                        </p>
                      </div>
                      <Check size={16} strokeWidth={3} className="shrink-0 ml-3" />
                    </button>
                  )}

                  {extBusy && (
                    <div className="flex items-center gap-2.5 py-3 text-[13px] text-white/45">
                      <span className="w-4 h-4 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
                      Recherche…
                    </div>
                  )}

                  {!soustitresEnLigne && <Indisponible feature="soustitres" compact />}

                  {soustitresEnLigne && !extBusy && extSubs === null && (
                    <button onClick={searchExternalSubs}
                      className="w-full py-3 rounded-2xl bg-white/[0.06] hover:bg-white/[0.11] text-[14px] font-medium transition-colors">
                      Chercher des sous-titres français
                    </button>
                  )}

                  {!extBusy && Array.isArray(extSubs) && extSubs.length === 0 && (
                    <p className="text-[13px] text-white/35 py-2">Rien trouvé pour ce film.</p>
                  )}

                  {!extBusy && Array.isArray(extSubs) && extSubs.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {extSubs.filter((x) => x.fileId !== extSub?.fileId).map((x) => (
                        <button key={x.fileId} onClick={() => applyExternalSub(x)}
                          className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] text-left transition-colors">
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-medium text-white/85 truncate">{x.name}</p>
                            <p className="text-[11px] text-white/35 mt-0.5">
                              {x.downloads.toLocaleString('fr-FR')} téléchargements{x.hearingImpaired ? ' · malentendants' : ''}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {extError && <p className="text-[12px] text-white/45 mt-2">{extError}</p>}
                </div>
              </div>
            )}

            {settingsTab === 'quality' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2.5">
                  {QUALITY_OPTIONS.map((opt, i) => {
                    const isActive = selectedQuality.id === opt.id;
                    const forcesTranscode = opt.id !== 'original';
                    // Visual "signal strength" bars: original = 4 bars, low = 1.
                    const bars = QUALITY_OPTIONS.length - i;
                    return (
                      <button key={opt.id} onClick={() => handleQualityChange(opt)}
                        className={`group relative overflow-hidden flex items-center justify-between p-4 rounded-2xl text-left transition-all ${isActive
                          ? 'bg-white/[0.14]'
                          : 'bg-white/[0.04] hover:bg-white/[0.08]'}`}>
                        <div className="relative z-10 flex items-center gap-3.5">
                          {/* Signal-strength glass bars */}
                          <div className="flex items-end gap-0.5 h-6">
                            {[0,1,2,3].map(b => (
                              <div key={b}
                                className={`w-1 rounded-full transition-all duration-300 ${b < bars ? (isActive ? 'bg-white' : 'bg-white/50') : 'bg-white/10'}`}
                                style={{ height: `${6 + b * 5}px` }} />
                            ))}
                          </div>
                          <div>
                            <p className={`text-[15px] font-bold ${isActive ? 'text-white' : 'text-gray-300'}`}>{opt.label}</p>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[11px] font-medium text-gray-400 bg-black/40 px-2 py-0.5 rounded-md border border-white/5">
                                {opt.id === 'original' ? 'Source • débit max' : opt.res}
                              </span>
                              {forcesTranscode && (
                                <span className="text-[10px] font-medium text-white/35">transcodé</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {isActive && (
                          <div className="relative z-10 w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-md shrink-0">
                            <Check size={14} strokeWidth={3} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Auto-skip intro toggle */}
                <button onClick={toggleAutoSkipIntro}
                  className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5 backdrop-blur-xl text-left transition-all hover:bg-white/[0.06]">
                  <div>
                    <p className="text-sm font-bold text-gray-200">Passer l'intro automatiquement</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Saute le générique dès qu'il est détecté</p>
                  </div>
                  <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${autoSkipIntro ? 'bg-white' : 'bg-white/15'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all ${autoSkipIntro ? 'left-[22px]' : 'left-0.5'}`} />
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Close button at the bottom for easy reach on mobile */}
          <div className="p-4 md:p-6 bg-gradient-to-t from-black/60 to-transparent">
            <button onClick={() => setShowSettings(false)}
              className="w-full py-3.5 bg-white text-black hover:bg-gray-200 rounded-2xl font-bold text-sm transition-all shadow-lg active:scale-95">
              Fermer les paramètres
            </button>
          </div>
        </div>
      )}

      {/* ── Écran d'attente ── sobre, mais il dit toujours où on en est et il
             offre une porte de sortie dès que ça traîne vraiment. */}
      {(!hlsReady && playbackMethod === 'hls') && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/85 backdrop-blur-xl px-8 text-center">
          {attente !== 'bloque' ? (
            <>
              <div className="w-8 h-8 border-2 border-white/15 border-t-white/80 rounded-full animate-spin mb-4" />
              <p className="text-[13.5px] text-white/60">
                {attente === 'lent' ? 'Connexion lente — on continue' : 'Préparation du flux…'}
              </p>
              {attente === 'lent' && (
                <button onClick={alleger}
                  className="mt-5 text-[13px] font-medium text-white/45 hover:text-white transition-colors">
                  Passer en qualité réduite
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-[17px] font-semibold tracking-[-0.02em] mb-2">La lecture ne démarre pas</p>
              <p className="text-[13.5px] text-white/50 max-w-sm mb-7 leading-relaxed">
                Le flux n'arrive pas. C'est souvent une connexion trop faible : une qualité
                plus légère démarre presque toujours.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                {qualiteInferieure && (
                  <button onClick={alleger}
                    className="inline-flex items-center justify-center h-[44px] px-6 rounded-full bg-white text-black text-[14.5px] font-semibold hover:opacity-90 transition-opacity">
                    Qualité réduite
                  </button>
                )}
                <button onClick={reessayer}
                  className="inline-flex items-center justify-center h-[44px] px-6 rounded-full bg-white/10 text-white text-[14.5px] font-semibold hover:bg-white/[0.17] transition-colors">
                  Réessayer
                </button>
                <button onClick={handleBack}
                  className="inline-flex items-center justify-center h-[44px] px-5 rounded-full text-white/50 text-[14px] font-medium hover:text-white transition-colors">
                  Retour
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Video */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        onLoadedData={handleVideoLoaded}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={surAttenteDonnees}
        onEnded={() => { if (siblings.next && !autoNextCancelledRef.current && !isNavigating) handleNextEpisode(); }}
        /* Un appui sur l'image ne met PLUS en pause : il fait apparaître ou
           disparaître les commandes. Mettre en pause d'un simple clic est trop
           facile à déclencher par erreur — la pause se fait au bouton central.
           Le double-appui ±10 s, lui, reste. */
        onClick={toggleControls}
        onTouchEnd={handleVideoTouchEnd}
        onEnterPictureInPicture={() => setInPip(true)}
        onLeavePictureInPicture={() => setInPip(false)}
        x-webkit-airplay="allow"
        className="w-full h-full bg-black object-contain"
      >
        {sousTitreIntegre && !extSub && (
          <track kind="subtitles" src={sousTitreIntegre.url} srcLang="fr" label={sousTitreIntegre.langue} default />
        )}
        {extSub && (
          <track kind="subtitles" src={extSub.url} srcLang="fr" label={`Français — ${extSub.name}`} default />
        )}
      </video>

      {/* Retour visuel du double-appui, discret */}
      <AnimatePresence>
        {seekFeedback && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.18 }}
            className={`absolute top-1/2 -translate-y-1/2 ${seekFeedback === 'fwd' ? 'right-[14%]' : 'left-[14%]'} z-30 pointer-events-none`}
          >
            <span className="flex flex-col items-center gap-1">
              <span className="w-14 h-14 rounded-full bg-white/12 backdrop-blur-xl flex items-center justify-center">
                {seekFeedback === 'fwd' ? <FastForward size={22} /> : <Rewind size={22} />}
              </span>
              <span className="text-[11px] font-medium text-white/70">{seekFeedback === 'fwd' ? '+10 s' : '−10 s'}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Commandes ═══
          Transport au centre (recul 10 s / lecture / avance 10 s), barre de
          progression en bas, options a droite. Aucun bouton superflu. */}
      {/* ⚠️ `pointer-events-none` sur CE calque, obligatoire : il couvre tout
          l'écran en z-40, donc au-dessus de l'en-tête (z-20). Sans ça il avalait
          chaque clic sur la flèche de sortie — elle ne « marchait pas du tout »,
          alors que le bouton était parfaitement sain. Les blocs interactifs
          qu'il contient remettent `pointer-events-auto` chacun de leur côté. */}
      <div className={`absolute inset-0 z-40 pointer-events-none transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>

        {/* transport central */}
        <div className="absolute inset-0 flex items-center justify-center gap-9 md:gap-14 pointer-events-none">
          <button onClick={(e) => { e.stopPropagation(); if (videoRef.current) videoRef.current.currentTime -= 10; }}
            aria-label="Reculer de 10 secondes"
            className="pointer-events-auto w-12 h-12 rounded-full flex items-center justify-center text-white/85 hover:text-white hover:bg-white/10 active:scale-90 transition-all">
            <Rewind size={26} />
          </button>

          <button onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            aria-label={isPlaying ? 'Pause' : 'Lecture'}
            className="pointer-events-auto w-[72px] h-[72px] rounded-full bg-white/12 backdrop-blur-2xl flex items-center justify-center text-white hover:bg-white/20 active:scale-95 transition-all">
            {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="ml-1" />}
          </button>

          <button onClick={(e) => { e.stopPropagation(); if (videoRef.current) videoRef.current.currentTime += 10; }}
            aria-label="Avancer de 10 secondes"
            className="pointer-events-auto w-12 h-12 rounded-full flex items-center justify-center text-white/85 hover:text-white hover:bg-white/10 active:scale-90 transition-all">
            <FastForward size={26} />
          </button>
        </div>

        {/* bas : progression + options — `pointer-events-auto`, car le calque
            parent ne capte plus rien (voir ci-dessus) */}
        {/* `showControls()` ici relance le compte à rebours : sans l'écouteur
            tactile global, toucher la barre ne le remettait plus à zéro et les
            commandes s'effaçaient au milieu d'un réglage. */}
        <div className="absolute bottom-0 inset-x-0 px-5 md:px-8 pb-6 md:pb-7 pt-20 pointer-events-auto bg-gradient-to-t from-black/85 via-black/35 to-transparent"
          onClick={(e) => { e.stopPropagation(); showControls(); }}
          onTouchStart={() => showControls()}>

          <div className="flex items-center gap-3">
            <span className="text-[11.5px] font-medium tabular-nums text-white/60 w-[52px] text-right">{formatTime(currentTime)}</span>

            <div className="flex-1 relative h-5 flex items-center group/bar">
              <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/25 overflow-hidden group-hover/bar:h-[5px] transition-[height]">
                <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${(buffered / duration) * 100 || 0}%` }} />
                <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${(currentTime / duration) * 100 || 0}%` }} />
              </div>
              <div className="absolute w-3 h-3 -ml-1.5 rounded-full bg-white opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none"
                style={{ left: `${(currentTime / duration) * 100 || 0}%` }} />
              <input type="range" min="0" max={duration || 100} step="0.1" value={currentTime || 0}
                onChange={handleTimelineChange} aria-label="Progression"
                className="absolute inset-x-0 w-full h-5 opacity-0 cursor-pointer" />
            </div>

            <span className="text-[11.5px] font-medium tabular-nums text-white/60 w-[52px]">−{formatTime(Math.max(0, (duration || 0) - currentTime))}</span>
          </div>

          <div className="flex items-center justify-between mt-3.5">
            <div className="flex items-center gap-1">
              {siblings.prev && (
                <button onClick={handlePrevEpisode} disabled={isNavigating} aria-label="Episode precedent"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                  <SkipBack size={18} />
                </button>
              )}
              {siblings.next && (
                <button onClick={handleNextEpisode} disabled={isNavigating} aria-label="Episode suivant"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                  <SkipForward size={18} />
                </button>
              )}
              <button onClick={toggleMute} aria-label={isMuted ? 'Retablir le son' : 'Couper le son'}
                className="hidden sm:flex w-10 h-10 rounded-full items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <div className="hidden sm:flex items-center w-0 group-hover:w-24 overflow-hidden transition-[width] duration-300">
                <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={handleVolumeChange}
                  aria-label="Volume" className="w-24 h-1 rounded-full appearance-none bg-white/25" style={{ accentColor: 'white' }} />
              </div>
            </div>

            <div className="flex items-center gap-1">
              {castSupported() && castState !== 'no_devices' && (
                <button onClick={castState === 'connected' ? stopCast : sendToTv}
                  aria-label="Diffuser sur la tele (Chromecast)"
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    castState === 'connected' ? 'text-white bg-white/15' : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}>
                  <Cast size={18} />
                </button>
              )}
              {airplayReady && (
                <button onClick={openAirplay} aria-label="Diffuser sur la tele"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                  <MonitorSmartphone size={18} />
                </button>
              )}
              {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
                <button onClick={togglePip} aria-label="Image dans l'image"
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${inPip ? 'text-white bg-white/15' : 'text-white/70 hover:text-white hover:bg-white/10'}`}>
                  <PictureInPicture2 size={18} />
                </button>
              )}
              <button onClick={() => setShowSettings(true)} aria-label="Audio et sous-titres"
                className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                <Subtitles size={18} />
              </button>
              <button onClick={toggleFullscreen} aria-label="Plein ecran"
                className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ « Passer l'intro » et « Épisode suivant » ═══
          Ces deux-là vivent leur propre vie : ils NE dépendent PAS de
          `controlsVisible` et restent affichés même quand les commandes se
          sont effacées — c'est tout l'intérêt, on veut pouvoir passer l'intro
          sans d'abord réveiller l'interface. `z-50` les met au-dessus du calque
          des commandes (z-40) et de l'en-tête (z-20), et `pointer-events-auto`
          garantit qu'ils restent cliquables quoi qu'il arrive au-dessus. */}
      <AnimatePresence>
        {(activeMarker || (siblings.next && autoNextArmed)) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-24 md:bottom-32 right-4 md:right-8 z-50 pointer-events-auto flex flex-col gap-3 items-end"
          >
            {/* Skip Intro / Credits Button (credits skip hidden while auto-next is armed) */}
            {activeMarker && !(activeMarker.type === 'credits' && autoNextArmed) && (
              <motion.button
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={skipMarker}
                className="group relative flex items-center gap-3 px-6 py-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white shadow-2xl overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/5 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                <FastForward size={18} className="text-white/80" />
                <span className="text-[14px] font-semibold">
                  {activeMarker.type === 'intro' ? "Passer l'intro" : 'Passer les crédits'}
                </span>
              </motion.button>
            )}

            {/* Next Episode Button — Netflix-style: shown only when armed (credits / end),
                fills over 5s then advances. The single "next" affordance at the end. */}
            {siblings.next && autoNextArmed && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="flex flex-col items-end gap-1.5"
              >
                <button
                  onClick={handleNextEpisode}
                  disabled={isNavigating}
                  className="group relative flex items-center gap-3 pl-4 pr-1.5 py-2 bg-white/10 backdrop-blur-2xl border border-white/20 rounded-full text-white shadow-2xl overflow-hidden active:scale-[0.98] transition-transform"
                >
                  {/* Liquid fill that completes in 5s, synced with the auto-advance */}
                  <motion.span
                    key="fill"
                    className="absolute left-0 top-0 bottom-0 bg-white/25 z-0"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 5, ease: 'linear' }}
                  />
                  <span className="relative z-10 text-[11px] font-bold tracking-widest uppercase opacity-70">
                    Épisode suivant
                  </span>
                  <span className="relative z-10 text-xs font-medium max-w-[120px] truncate">{siblings.next.title}</span>
                  <div className="relative z-10 w-7 h-7 bg-white text-black rounded-full flex items-center justify-center shadow-md ml-1">
                    <SkipForward size={14} fill="currentColor" />
                  </div>
                </button>
                <button onClick={cancelAutoNext}
                  className="text-[11px] font-semibold text-white/50 hover:text-white transition-colors pr-2">
                  Annuler
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Bar Extension (Navigation Arrows) */}
      {/* Les boutons « épisode précédent / suivant » qui vivaient ici, en haut
          à gauche, faisaient doublon : les mêmes existent déjà de part et
          d'autre du bouton Lecture, à leur vraie place. Supprimés le
          2026-08-23. */}

      {/* Watch-party layer (presence, chat, reactions) — renders nothing when solo */}
      <WatchPartyOverlay videoRef={videoRef} />
    </div>
  );
}

export default PlayerV2;
