// The proxy server handles Plex communication.
// All requests go to /plex/* on the same origin, the server proxies to local Plex.

import authService from './authService';

const getProxyBase = () => {
  // In dev mode (vite), use the proxy server URL
  if (import.meta.env.DEV) {
    return 'http://localhost:5174';
  }
  // In production, same origin (served by the Express server)
  return '';
};

// Audio codecs that browsers (Chrome) can natively decode
const BROWSER_COMPATIBLE_AUDIO = new Set([
  'aac', 'mp3', 'mp2', 'flac', 'vorbis', 'opus', 'pcm',
  'alac' // Safari only, but won't hurt
]);

// Audio codecs that NEED transcoding for browser playback
const TRANSCODE_REQUIRED_AUDIO = new Set([
  'ac3',                  // Dolby Digital (AC-3) — NOT supported in Chrome
  'eac3',                 // Dolby Digital Plus (E-AC3)
  'dca', 'dts',           // DTS
  'dts-hd', 'dts-hd ma',  // DTS-HD Master Audio
  'truehd',               // Dolby TrueHD / Atmos
  'mlp',                  // Meridian Lossless (TrueHD container)
  'wmav2', 'wmapro', 'wma', // Windows Media Audio
  'cook',                 // RealAudio
  'atmos',                // Dolby Atmos
]);

// Generate a unique client identifier for Plex sessions
const CLIENT_ID = 'novastream-' + Math.random().toString(36).substring(2, 15);

const plexService = {
  // Simple cache for home data to avoid re-fetching when switching tabs
  _homeCache: {},
  _currentSessionId: null,

  isConfigured() {
    return true; // Always configured when using proxy
  },

  // The Plex proxy now requires a valid NovaStream JWT. <img>/<video> tags cannot
  // set headers, so we pass the token as a `nova` query param for those URLs.
  _withToken(url) {
    // Use the short-lived media token (not the 30-day session JWT) in URLs.
    const token = authService.getMediaToken();
    if (!token) return url;
    return url + (url.includes('?') ? '&' : '?') + 'nova=' + encodeURIComponent(token);
  },

  async fetchFromPlex(endpoint) {
    try {
      const base = getProxyBase();
      const token = authService.getToken();
      const response = await fetch(`${base}/plex${endpoint}`, {
        headers: {
          'Accept': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      if (!response.ok) throw new Error(`Plex API Error: ${response.status}`);
      const data = await response.json();
      return data.MediaContainer;
    } catch (error) {
      console.error("Plex Fetch Error:", error);
      return null;
    }
  },

  // Build image/media URLs through the proxy (token embedded for <img>/<video>)
  /* ── Connexion faible : on MESURE, on ne se fie pas à l'étiquette ──
     « 4G » ou « 5G » ne veut rien dire : une 5G à une barre est plus lente
     qu'une 3G correcte. `downlink` et `rtt` du navigateur sont des estimations
     mesurées sur le trafic réel — c'est ça qu'on regarde. L'étiquette ne sert
     que de dernier recours quand on n'a aucun chiffre. */
  _reseauFaible() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    if (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < 3) return true;
    if (typeof c.rtt === 'number' && c.rtt > 400) return true;
    return /^(slow-2g|2g|3g)$/.test(c.effectiveType || '');
  },

  /**
   * URL d'image, redimensionnée par Plex.
   *
   * ⚠️ Le point le plus lourd du site : une affiche servie telle quelle par
   * Plex pèse 150 ko à 900 ko (c'est le fichier d'origine). Une page d'accueil
   * en téléchargeait plusieurs mégaoctets, d'où « ça charge méga long en
   * mauvaise connexion ». Passées par le transcodeur photo, les mêmes affiches
   * tombent à ~25 ko : mesuré 3 258 ko → 169 ko sur six affiches (19×).
   *
   * ⚠️ Le FORMAT du cadre demandé doit coller à celui de l'image, sinon Plex
   * recadre pour remplir : une vignette d'épisode (16:9) réclamée en 2:3 ressort
   * zoomée sur un bout de l'image. D'où un usage `still` distinct de `poster`.
   *
   * @param {string} path chemin Plex ou URL absolue
   * @param {'poster'|'still'|'backdrop'|'logo'|'raw'} usage
   *        `poster` 2:3 (affiches) · `still` 16:9 (vignettes d'épisode) ·
   *        `backdrop` 16:9 large · `logo` NON redimensionné (le transcodeur sort
   *        du JPEG, ce qui remplacerait la transparence par du noir) · `raw`
   *        pour les fichiers vidéo, qui n'ont rien à faire dans un transcodeur
   *        d'image.
   */
  getImageUrl(path, usage = 'poster') {
    if (!path) return null;
    const base = getProxyBase();
    const faible = this._reseauFaible();

    let taille = null;
    if (usage === 'poster') taille = faible ? [200, 300] : [320, 480];
    else if (usage === 'still') taille = faible ? [320, 180] : [480, 270];
    else if (usage === 'backdrop') taille = faible ? [780, 440] : [1280, 720];

    if (taille) {
      const [width, height] = taille;
      return this._withToken(
        `${base}/plex/photo/:/transcode?width=${width}&height=${height}&minSize=1&upscale=1&url=${encodeURIComponent(path)}`
      );
    }

    // Logos et fichiers : servis tels quels.
    if (path.startsWith('http')) {
      return this._withToken(`${base}/plex/photo/:/transcode?width=300&height=300&minSize=1&upscale=1&url=${encodeURIComponent(path)}`);
    }
    return this._withToken(`${base}/plex${path}`);
  },

  // ═══════════════════════════════════════════════════════════
  //  TRANSCODING — Audio transcode via Plex Universal Transcoder
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if an audio codec needs transcoding for browser playback
   */
  /* ── Le NAVIGATEUR peut-il lire cette vidéo telle quelle ? ──────────
     Jusqu'ici la décision « lecture directe ou transcodage » ne regardait que
     l'AUDIO. Un film en AV1 ou HEVC avec une piste AAC partait donc en lecture
     directe et s'affichait « Lecture directe » — alors que ça ne marche que si
     l'appareil sait décoder ce codec. Sur un Samsung récent, oui ; sur un
     iPhone d'avant le 15 Pro, l'AV1 n'existe pas, et Safari ne lit de toute
     façon aucun fichier .mkv. Résultat : écran noir, sans explication.

     Fonction PURE (aucun accès au DOM) pour être testable directement.
     @param canPlay  (mime) => 'probably' | 'maybe' | '' — le test du navigateur
  */
  videoLisible({ codec, container, canPlay, safari }) {
    const c = (codec || '').toLowerCase();
    const cont = (container || '').toLowerCase();

    // Safari ne sait pas ouvrir Matroska, quel que soit le codec à l'intérieur.
    if (safari && (cont === 'mkv' || cont === 'matroska' || cont === 'avi')) return false;

    const essais = {
      av1: 'video/mp4; codecs="av01.0.05M.08"',
      hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
      h265: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
      vp9: 'video/mp4; codecs="vp09.00.10.08"',
      h264: 'video/mp4; codecs="avc1.42E01E"',
      vp8: 'video/webm; codecs="vp8"',
    };
    const mime = essais[c];
    if (!mime) return true;             // codec inconnu : on n'invente pas, on laisse passer
    return canPlay(mime) !== '';        // 'probably' ou 'maybe' → jouable
  },

  _videoLisibleIci(codec, container) {
    try {
      const v = document.createElement('video');
      const safari = /^((?!chrome|android|crios|edg).)*safari/i.test(navigator.userAgent);
      return this.videoLisible({ codec, container, safari, canPlay: (m) => v.canPlayType(m) });
    } catch {
      return true;   // pas de DOM (rendu serveur, test) : on ne bloque rien
    }
  },

  needsTranscode(audioCodec) {
    if (!audioCodec) return true; // Unknown codec → transcode to be safe
    const codec = audioCodec.toLowerCase().trim();
    if (TRANSCODE_REQUIRED_AUDIO.has(codec)) return true;
    if (BROWSER_COMPATIBLE_AUDIO.has(codec)) return false;
    // Unknown codec → transcode to be safe
    return true;
  },

  /**
   * Build a transcode URL for HLS playback
   */
  getTranscodeUrl(ratingKey, { audioStreamID, subtitleStreamID, quality } = {}) {
    const base = getProxyBase();
    
    // Default quality: 1080p High
    const q = quality || { bitrate: '10000', res: '1920x1080', quality: '90' };
    let [width, height] = q.res.split('x').map(Number);
    let bitrate = parseInt(q.bitrate, 10) || 10000;
    // CAP the transcode at 1080p / 20 Mbps. Transcoding to 4K for a browser is
    // pointless and MUCH slower to start (re-encoding 4K HEVC→H.264). This is the
    // single biggest launch-speed win: 4K→1080p is several times faster to start.
    // (Direct Play of 4K originals is unaffected — this only touches transcoding.)
    if (height > 1080 || width > 1920) { width = 1920; height = 1080; }
    if (bitrate > 8000) bitrate = 8000; // 1080p @ 8 Mbps cap — visually identical on a phone, fastest start
    const vQuality = Math.min(parseInt(q.quality, 10) || 90, 90); // 100 (original) → 90 for transcode

    // Safety: use the same session ID for the same ratingKey to let Plex manage overrides,
    // or generate a single one if none exists.
    const sessionId = this._currentSessionId || this._generateSessionId();
    
    const params = new URLSearchParams({
      path: `http://127.0.0.1:32400/library/metadata/${ratingKey}`,
      mediaIndex: '0',
      partIndex: '0',
      protocol: 'hls',
      fastSeek: '1',
      directPlay: '0',
      directStream: '1',
      directStreamAudio: '0',
      videoQuality: String(vQuality),
      maxVideoBitrate: String(bitrate),
      videoResolution: `${width}x${height}`,
      audioBoost: '100',
      autoAdjustQuality: '0',
      mediaBufferSize: '102400',
      session: sessionId,
      'X-Plex-Client-Identifier': CLIENT_ID,
      'X-Plex-Product': 'Plex Web',
      'X-Plex-Device': 'Windows',
      'X-Plex-Platform': 'Chrome',
      'X-Plex-Platform-Version': '120.0',
      'X-Plex-Session-Identifier': sessionId,
      'X-Plex-Client-Profile-Extra': `append-transcode-target-audio-codec(type=audioProfile&context=universal&protocol=hls&audioCodec=aac);add-limitation(scope=videoTranscode&type=upperBound&name=video.bitrate&value=${bitrate});add-limitation(scope=videoTranscode&type=upperBound&name=video.width&value=${width});add-limitation(scope=videoTranscode&type=upperBound&name=video.height&value=${height});`
    });

    if (audioStreamID) params.set('audioStreamID', audioStreamID);
    if (subtitleStreamID) params.set('subtitleStreamID', subtitleStreamID);
    else params.set('subtitleStreamID', '0');

    /* Jeton DANS l'URL : sur iPhone/Safari c'est le lecteur natif qui charge le
       m3u8, et une balise <video> ne peut pas poser d'en-tête d'authentification.
       hls.js, lui, envoie les deux — inoffensif. */
    return this._withToken(`${base}/plex-transcode/start?${params.toString()}`);
  },

  /**
   * Build a direct play URL (raw file from Plex)
   * Used when audio codec is browser-compatible
   */
  getDirectPlayUrl(partKey) {
    if (!partKey) return null;
    const base = getProxyBase();
    return this._withToken(`${base}/plex${partKey}`);
  },

  /**
   * Build the best playback URL based on audio codec compatibility
   * - If the selected audio track is browser-compatible → Direct Play (no CPU load)
   * - If the selected audio needs transcoding → HLS via Plex Universal Transcoder
   */
  getPlaybackUrl(ratingKey, mediaInfo, { audioStreamID, subtitleStreamID, quality } = {}) {
    // Find the selected audio stream to check its codec
    const audioStreams = mediaInfo?.audioStreams || [];
    let selectedStream = null;
    if (audioStreamID) {
      selectedStream = audioStreams.find(s => s.id === audioStreamID);
    }
    if (!selectedStream) {
      selectedStream = audioStreams.find(s => s.selected) || audioStreams[0];
    }

    const audioCodec = selectedStream?.codec || null;
    const audioNeedsTranscode = this.needsTranscode(audioCodec);

    console.log(`[Plex] Audio codec: ${audioCodec}, needs transcode: ${audioNeedsTranscode}`);

    // If a non-default quality is selected, we MUST transcode (to lower the bitrate)
    // even if the audio is compatible.
    const isOriginalQuality = !quality || quality.id === 'original';

    // Direct play serves the RAW file, so the browser plays the file's FIRST
    // audio track (NOT Plex's "selected"/preferred one) and shows no subtitles.
    // So direct play is only correct when the chosen track IS the first track in
    // the container. Otherwise (e.g. FR is the 3rd track) we MUST transcode so
    // Plex muxes the right language. (Fix for "VF plays the original German".)
    const firstAudio = audioStreams[0];
    const chosenAudioId = audioStreamID != null
      ? audioStreamID
      : (audioStreams.find(s => s.selected)?.id ?? firstAudio?.id);
    const audioIsFirstTrack = audioStreams.length === 0
      || (firstAudio && String(chosenAudioId) === String(firstAudio.id));
    /* Sous-titres : seuls ceux qu'on ne peut pas livrer à côté imposent un
       transcodage (Plex doit alors les GRAVER dans l'image).
       · SRT / texte  → extraits par Nova et passés au lecteur en piste
         séparée : la vidéo peut rester en lecture directe. C'est le gain le
         plus important du site — un film entier n'est plus ré-encodé juste
         pour afficher du texte.
       · ASS/SSA      → transcodage conservé : la conversion en WebVTT perdrait
         le placement et les styles (karaoké des animés).
       · PGS / VobSub → ce sont des IMAGES, rien d'autre que la gravure. */
    const subChoisi = subtitleStreamID != null && subtitleStreamID !== '' && subtitleStreamID !== 0
      ? (mediaInfo?.subtitleStreams || []).find((s) => String(s.id) === String(subtitleStreamID))
      : null;
    const codecSub = (subChoisi?.codec || '').toLowerCase();
    const sousTitreLivrable = !!subChoisi && ['srt', 'subrip', 'webvtt', 'vtt', 'mov_text'].includes(codecSub);
    const wantsSubtitles = !!subChoisi && !sousTitreLivrable;

    // La VIDÉO aussi doit être lisible par cet appareil : un AV1 ou un HEVC
    // servi tel quel à un navigateur qui ne le décode pas donne un écran noir.
    const videoNeedsTranscode = !this._videoLisibleIci(mediaInfo?.videoCodec, mediaInfo?.container);
    if (videoNeedsTranscode) {
      console.log(`[Plex] Video ${mediaInfo?.videoCodec}/${mediaInfo?.container} non lisible ici → transcodage`);
    }

    if (audioNeedsTranscode || videoNeedsTranscode || !isOriginalQuality || !audioIsFirstTrack || wantsSubtitles) {
      // Audio ou vidéo incompatible, ou qualité réduite → transcodeur Plex (HLS)
      return {
        url: this.getTranscodeUrl(ratingKey, { audioStreamID, subtitleStreamID, quality }),
        isHLS: true,
        method: 'transcode'
      };
    } else {
      // Audio compatible → lecture directe du fichier brut. Le lecteur ira
      // chercher le sous-titre texte à part (voir /api/subtitles/embedded).
      return {
        sousTitreALivrer: sousTitreLivrable ? { ratingKey, streamId: subtitleStreamID, langue: subChoisi.language } : null,
        url: this.getDirectPlayUrl(mediaInfo?.partKey),
        isHLS: false,
        method: 'direct'
      };
    }
  },

  /**
   * Stop the current transcode session to free server resources
   */
  async stopTranscodeSession() {
    if (!this._currentSessionId || this._isStopping) return;
    this._isStopping = true;
    
    try {
      const base = getProxyBase();
      // Use a timeout to avoid hanging the entire app if Plex is slow
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const token = authService.getToken();
      await fetch(`${base}/plex/video/:/transcode/universal/stop?session=${this._currentSessionId}&X-Plex-Client-Identifier=${CLIENT_ID}`, {
        method: 'GET',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      console.log('[Plex] Transcode session stopped:', this._currentSessionId);
    } catch (err) {
      console.warn('[Plex] Failed to stop transcode session or timed out');
    } finally {
      this._currentSessionId = null;
      this._isStopping = false;
    }
  },

  /**
   * Send a timeline/ping to keep the transcode session alive
   */
  /* ⚠️ La timeline DOIT porter l'identifiant de session.
     Sans lui, Plex reçoit bien un « state=playing » mais ne peut pas le
     rattacher au transcodage en cours : de son point de vue, personne ne
     consomme cette session. Au bout de dix minutes il la tue, avec ce motif
     dans son journal — « Terminated session … with reason Playback has been
     paused for too long. » Tous les segments passent alors en 404 et l'épisode
     se fige en plein milieu. On envoie donc aussi le ping dédié du
     transcodeur, qui est le vrai « je suis toujours là » de Plex Web. */
  async pingTranscodeSession(ratingKey, currentTime, duration, state = 'playing') {
    const session = this._currentSessionId;
    if (!session) return;
    const base = getProxyBase();
    const token = authService.getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const timeMs = Math.floor((currentTime || 0) * 1000);
    const durMs = Math.floor((duration || 0) * 1000);

    const params = new URLSearchParams({
      ratingKey: String(ratingKey),
      key: `/library/metadata/${ratingKey}`,
      state,
      time: String(timeMs),
      duration: String(durMs),
      playbackTime: String(timeMs),
      playQueueItemID: '0',
      session,
      'X-Plex-Client-Identifier': CLIENT_ID,
      'X-Plex-Session-Identifier': session,
    });

    try {
      await Promise.all([
        fetch(`${base}/plex/:/timeline?${params}`, { headers }),
        // Ping propre au transcodeur : c'est celui-ci qui remet à zéro le
        // compteur d'inactivité côté Plex.
        state === 'playing'
          ? fetch(`${base}/plex/video/:/transcode/universal/ping?session=${encodeURIComponent(session)}&X-Plex-Client-Identifier=${CLIENT_ID}`, { headers })
          : Promise.resolve(),
      ]);
    } catch (err) {
      // Sans importance : le prochain ping repassera
    }
  },

  // Tell Plex which audio/subtitle track to use for this part. This is what the
  // official Plex Web client does (PUT /library/parts/{id}); the universal
  // transcoder's audioStreamID param alone is not reliably honored, so without
  // this the player keeps the file's DEFAULT track (e.g. German). subtitleStreamID
  // = 0 disables subtitles.
  async setStreams(partId, { audioStreamID, subtitleStreamID } = {}) {
    if (!partId) return;
    const base = getProxyBase();
    const token = authService.getToken();
    const params = new URLSearchParams({ allParts: '1' });
    if (audioStreamID != null) params.set('audioStreamID', String(audioStreamID));
    if (subtitleStreamID != null) params.set('subtitleStreamID', String(subtitleStreamID));
    try {
      await fetch(`${base}/plex/library/parts/${partId}?${params.toString()}`, {
        method: 'PUT',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      console.log('[Plex] setStreams', { partId, audioStreamID, subtitleStreamID });
    } catch (err) {
      console.warn('[Plex] setStreams failed:', err.message);
    }
  },

  _generateSessionId() {
    this._currentSessionId = 'novastream-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    return this._currentSessionId;
  },

  // ═══════════════════════════════════════════════════════════
  //  LIBRARY & METADATA (unchanged)
  // ═══════════════════════════════════════════════════════════

  _camSectionIds: null,

  /* Bibliothèques vidéo du serveur, dans l'ordre choisi par l'administrateur.
     TOUTES sont renvoyées, chacune avec `masquee` : le menu n'affiche que les
     visibles, mais la recherche et les badges CAM ont besoin de la liste
     complète. Une seule requête par 10 min, partagée entre les appelants. */
  _libsPromise: null,
  _libsAt: 0,
  getLibraries() {
    if (this._libsPromise && Date.now() - this._libsAt < this._LIB_TTL) return this._libsPromise;
    this._libsAt = Date.now();
    this._libsPromise = (async () => {
      const token = authService.getToken();
      const res = await fetch(`${getProxyBase()}/api/libraries`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Libraries API ${res.status}`);
      const libs = (await res.json()).libraries || [];
      // Remember which sections are "CAM" (camrip) libraries so we can badge their films.
      this._camSectionIds = new Set(libs.filter(l => /\bcam\b/i.test(l.title || '')).map(l => String(l.key)));
      return libs;
    })();
    this._libsPromise.catch(() => { this._libsPromise = null; });
    return this._libsPromise;
  },

  // Après un changement dans les réglages : la prochaine lecture refait la requête.
  invalidateLibraries() {
    this._libsPromise = null;
  },

  // A title is a camrip if it lives in a "…Cam" library (by section id or name).
  isCamItem(item) {
    if (!item) return false;
    if (item.libraryTitle && /\bcam\b/i.test(item.libraryTitle)) return true;
    const id = item.librarySectionID;
    if (id != null && this._camSectionIds instanceof Set && this._camSectionIds.has(String(id))) return true;
    return this.isCamId(item.id);
  },

  // Set of all ratingKeys living in "…Cam" libraries — lets us badge items that
  // carry no library info (e.g. Continue Watching cards). Cached after first call.
  _camIds: null,
  async ensureCamIds() {
    if (this._camIds) return this._camIds;
    const ids = new Set();
    try {
      const libs = await this.getLibraries(); // also fills _camSectionIds
      const camSecs = libs.filter((l) => this._camSectionIds?.has(String(l.key)));
      for (const sec of camSecs) {
        const items = await this.getLibraryItems(sec.key);
        items.forEach((it) => ids.add(String(it.id)));
      }
    } catch { /* leave empty */ }
    this._camIds = ids;
    return ids;
  },
  isCamId(id) {
    return id != null && this._camIds instanceof Set && this._camIds.has(String(id));
  },

  async getRecentlyAdded() {
    const data = await this.fetchFromPlex('/library/recentlyAdded');
    const items = data?.Metadata || [];
    // Strictly filter recently added items to only include video content types
    return items
      .filter(item => ['movie', 'show', 'season', 'episode'].includes(item.type))
      .map(item => this.formatPlexItem(item));
  },

  async getRecentlyReleased() {
    try {
      const libraries = await this.getLibraries();
      const libraryPromises = libraries.map(async (lib) => {
        const data = await this.fetchFromPlex(`/library/sections/${lib.key}/all?sort=originallyAvailableAt%3Adesc&X-Plex-Container-Start=0&X-Plex-Container-Size=15`);
        // Listing items don't carry their section — stamp it so CAM badges work.
        return (data?.Metadata || []).map(m => ({ ...m, librarySectionID: m.librarySectionID ?? lib.key, librarySectionTitle: m.librarySectionTitle ?? lib.title }));
      });
      
      const results = await Promise.all(libraryPromises);
      let allItems = results.flat();
      
      // Sort combined by release date descending
      allItems.sort((a, b) => {
        const dateA = a.originallyAvailableAt ? new Date(a.originallyAvailableAt).getTime() : 0;
        const dateB = b.originallyAvailableAt ? new Date(b.originallyAvailableAt).getTime() : 0;
        return dateB - dateA;
      });
      
      return allItems
        .filter(item => ['movie', 'show', 'season', 'episode'].includes(item.type))
        .slice(0, 25)
        .map(item => this.formatPlexItem(item));
    } catch (error) {
      console.error("Error fetching recently released:", error);
      return [];
    }
  },

  // Les listings de bibliothèque sont volumineux et changent rarement : on les
  // garde 10 min en mémoire ET en sessionStorage. Revenir sur l'accueil ou
  // changer d'onglet devient instantané (aucune requête).
  _libCache: {},
  _LIB_TTL: 10 * 60 * 1000,

  _cacheRead(key) {
    const hit = this._libCache[key];
    if (hit && Date.now() - hit.at < this._LIB_TTL) return hit.items;
    try {
      const raw = sessionStorage.getItem('nova_lib_' + key);
      if (raw) {
        const p = JSON.parse(raw);
        if (Date.now() - p.at < this._LIB_TTL) {
          this._libCache[key] = p;
          return p.items;
        }
      }
    } catch { /* quota / mode privé : on refera la requête */ }
    return null;
  },

  _cacheWrite(key, items) {
    const entry = { at: Date.now(), items };
    this._libCache[key] = entry;
    try { sessionStorage.setItem('nova_lib_' + key, JSON.stringify(entry)); } catch { /* quota dépassé : le cache mémoire suffit */ }
  },

  /* Listing de bibliothèque ALLÉGÉ.
     Plex renvoie par défaut tout le casting, les réalisateurs, les pays, les
     chapitres ET le résumé de chaque titre : 2,5 Mo pour 1068 films, dont les
     résumés font à eux seuls plus de la moitié du poids compressé. Rien de tout
     ça n'est affiché depuis un listing (les fiches font leur propre requête
     complète), donc on demande à Plex de ne pas l'envoyer : 574 ko → 260 ko
     compressés. C'est le poste le plus lourd du chargement de l'accueil.
     ⚠️ Garder Genre (sous-catégories + filtres) et Media (lien du fichier). */
  LISTING_LEGER:
    'excludeElements=Country,Director,Writer,Role,Producer,Collection,Similar,Guid,Rating,Image,Chapter,Marker,Extras'
    + '&excludeFields=summary,tagline',

  async getLibraryItems(sectionId) {
    const cached = this._cacheRead(`items_${sectionId}`);
    if (cached) return cached;
    const data = await this.fetchFromPlex(`/library/sections/${sectionId}/all?${this.LISTING_LEGER}`);
    const items = data?.Metadata || [];
    // Stamp the section id (listing items don't include it) so CAM films get badged.
    const out = items.map(item => this.formatPlexItem({ ...item, librarySectionID: item.librarySectionID ?? sectionId }));
    if (out.length) this._cacheWrite(`items_${sectionId}`, out);
    return out;
  },

  // Library titles available on a given streaming platform (TMDB provider id, FR).
  // The server resolves & caches the providers; first call may be slow.
  async getPlatformItems(providerId) {
    const base = getProxyBase();
    const token = authService.getToken();
    const res = await fetch(`${base}/api/platform/${providerId}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error(`Platform API ${res.status}`);
    const data = await res.json();
    return {
      items: (data.items || []).map(item => this.formatPlexItem(item)),
      total: data.total || 0,
      scanned: data.scanned || 0,
      warming: !!data.warming,
      done: data.done || 0,
      totalToScan: data.totalToScan || 0
    };
  },

  // Disney+ brand hubs (Marvel / Pixar / Star Wars / Nat Geo / Disney),
  // classified server-side via TMDB production companies. May be warming.
  async getDisneyBrands() {
    const base = getProxyBase();
    const token = authService.getToken();
    const res = await fetch(`${base}/api/brands/disney`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error(`Brands API ${res.status}`);
    const data = await res.json();
    const brands = {};
    for (const [k, arr] of Object.entries(data.brands || {})) {
      brands[k] = (arr || []).map(item => this.formatPlexItem(item));
    }
    return { brands, warming: !!data.warming, done: data.done || 0, totalToScan: data.totalToScan || 0 };
  },

  // Actor page: TMDB person + credits cross-referenced with the library.
  async getActor(name) {
    const base = getProxyBase();
    const token = authService.getToken();
    const res = await fetch(`${base}/api/actor/${encodeURIComponent(name)}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error(`Actor API ${res.status}`);
    return res.json();
  },

  // Official platform logos (TMDB), keyed by provider id. Cached in-module.
  _providerLogos: null,
  async getProviderLogos() {
    if (this._providerLogos) return this._providerLogos;
    const base = getProxyBase();
    const token = authService.getToken();
    try {
      const res = await fetch(`${base}/api/providers`, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
      if (!res.ok) return {};
      this._providerLogos = await res.json();
      return this._providerLogos;
    } catch { return {}; }
  },

  async getByGenre(sectionId, genreId) {
    const data = await this.fetchFromPlex(`/library/sections/${sectionId}/all?genre=${genreId}`);
    const items = data?.Metadata || [];
    return items.map(item => this.formatPlexItem(item));
  },

  async getGenres(sectionId) {
    const data = await this.fetchFromPlex(`/library/sections/${sectionId}/genre`);
    return (data?.Directory || []).map(g => ({ id: g.key, title: g.title }));
  },

  /* Titres mis en avant en haut d'une page. `section` : la bibliothèque de la
     page (on ne garde que ses ajouts récents) ; absente → l'accueil. Sur une
     page de bibliothèque, aucun repli vers les autres : mieux vaut ne rien
     mettre en avant que d'afficher un film sur la page des séries. */
  async getFeatured(section) {
    const recent = await this.getRecentlyAdded();
    let candidates = recent.filter(item => item.backdrop);

    if (section) {
      candidates = candidates.filter(item => String(item.librarySectionID) === String(section.key));
    }

    // Deduplicate by Series to avoid showing the same show multiple times
    const seenSeries = new Set();
    candidates = candidates.filter(item => {
      const seriesId = item.grandparentRatingKey || item.parentRatingKey || item.id;
      if (seenSeries.has(seriesId)) return false;
      seenSeries.add(seriesId);
      return true;
    });
    
    const result = candidates.slice(0, 5);
    if (section) return result;           // la page complète elle-même (voir HomePure)
    return result.length > 0 ? result : recent.slice(0, 5);
  },

  // Mémo court des fiches : ouvrir une fiche, revenir, la réouvrir ne
  // redéclenche pas d'appel Plex (et la page Favoris ne refait rien).
  _metaCache: new Map(),
  _META_TTL: 5 * 60 * 1000,

  async getMetadata(ratingKey) {
    const hit = this._metaCache.get(String(ratingKey));
    if (hit && Date.now() - hit.at < this._META_TTL) return hit.data;
    const data = await this.fetchFromPlex(`/library/metadata/${ratingKey}`);
    if (!data || !data.Metadata || data.Metadata.length === 0) return null;
    
    const item = data.Metadata[0];
    const formatted = this.formatPlexItem(item);
    
    if (item.Role) {
      formatted.cast = item.Role.map(role => ({
        id: role.id,
        name: role.tag,
        character: role.role,
        thumb: this.getImageUrl(role.thumb, 'poster')   // photo d'acteur : petite, donc redimensionnée
      }));
    }

    // Codec ET conteneur de la vidéo : ils décident si le navigateur peut lire
    // le fichier tel quel (voir `videoLisible`).
    if (item.Media?.[0]) {
      formatted.videoCodec = (item.Media[0].videoCodec || '').toLowerCase();
      formatted.container = (item.Media[0].container || '').toLowerCase();
    }

    // Extract stream information with codec details
    if (item.Media?.[0]?.Part?.[0]?.Stream) {
      const streams = item.Media[0].Part[0].Stream;
      formatted.audioStreams = streams.filter(s => s.streamType === 2).map(s => ({
        id: s.id,
        language: s.language || s.languageTag || 'Unknown',
        languageCode: s.languageCode || s.languageTag,
        codec: s.codec,
        channels: s.channels,
        displayTitle: s.displayTitle || s.language || 'Unknown',
        selected: s.selected,
        bitrate: s.bitrate,
        profile: s.profile  // e.g. "ma" for DTS-HD MA
      }));
      formatted.subtitleStreams = streams.filter(s => s.streamType === 3).map(s => ({
        id: s.id,
        language: s.language || s.languageTag || 'Unknown',
        languageCode: s.languageCode || s.languageTag,
        codec: s.codec,
        displayTitle: s.displayTitle || s.language || 'Unknown',
        selected: s.selected
      }));

      // Store the primary audio codec for transcode decision
      const primaryAudio = formatted.audioStreams.find(s => s.selected) || formatted.audioStreams[0];
      formatted.primaryAudioCodec = primaryAudio?.codec || null;
    }

    // Store the part key (direct play) + part id (needed to set the selected
    // audio/subtitle stream on Plex before transcoding — see setStreams()).
    if (item.Media?.[0]?.Part?.[0]?.key) {
      formatted.partKey = item.Media[0].Part[0].key;
    }
    if (item.Media?.[0]?.Part?.[0]?.id != null) {
      formatted.partId = item.Media[0].Part[0].id;
    }

    // Chapter markers (intro / credits) for the "skip" buttons in the player.
    // Offsets come from Plex in milliseconds.
    if (Array.isArray(item.Marker)) {
      formatted.markers = item.Marker
        .filter(m => m.type === 'intro' || m.type === 'credits')
        .map(m => ({
          type: m.type,
          start: (m.startTimeOffset || 0) / 1000,
          end: (m.endTimeOffset || 0) / 1000
        }));
    }

    this._metaCache.set(String(ratingKey), { at: Date.now(), data: formatted });
    return formatted;
  },

  async getSiblingEpisodes(parentRatingKey, currentId) {
    if (!parentRatingKey) return { prev: null, next: null };
    const episodes = await this.getChildren(parentRatingKey);
    const currentIndex = episodes.findIndex(e => e.id === currentId);
    return {
      prev: currentIndex > 0 ? episodes[currentIndex - 1] : null,
      next: currentIndex < episodes.length - 1 ? episodes[currentIndex + 1] : null
    };
  },

  async getChildren(ratingKey) {
    const data = await this.fetchFromPlex(`/library/metadata/${ratingKey}/children`);
    const items = data?.Metadata || [];
    return items.map(item => this.formatPlexItem(item));
  },

  async getSimilar(ratingKey) {
    // Plex uses /related for similar/recommended items
    const data = await this.fetchFromPlex(`/library/metadata/${ratingKey}/related`);
    if (!data || !data.Hub) return [];
    
    // Combine items from all relevant hubs (similar, recommendations, same director/actors etc.)
    let allItems = [];
    for (const hub of data.Hub) {
      if (hub.Metadata) {
        allItems = [...allItems, ...hub.Metadata];
      }
    }

    // Deduplicate by ratingKey and filter for movies/shows only
    const seen = new Set();
    const uniqueItems = [];
    for (const item of allItems) {
      if (['movie', 'show'].includes(item.type) && !seen.has(item.ratingKey)) {
        seen.add(item.ratingKey);
        uniqueItems.push(this.formatPlexItem(item));
      }
    }

    return uniqueItems;
  },

  // Global content search via Plex hubs (movies + shows), deduped.
  async search(query) {
    if (!query || !query.trim()) return [];
    try {
      const data = await this.fetchFromPlex(`/hubs/search?query=${encodeURIComponent(query)}&limit=30`);
      const results = [];
      const seen = new Set();
      for (const hub of (data?.Hub || [])) {
        for (const item of (hub.Metadata || [])) {
          if (['movie', 'show'].includes(item.type) && !seen.has(item.ratingKey)) {
            seen.add(item.ratingKey);
            results.push(this.formatPlexItem(item));
          }
        }
      }
      return results.slice(0, 24);
    } catch (err) {
      console.error('[Plex] search error:', err);
      return [];
    }
  },

  formatPlexItem(item) {
    return {
      id: item.ratingKey,
      title: item.title,
      description: item.summary,
      summary: item.summary,
      // For episodes, use series poster. For seasons/shows/movies, use their own thumb.
      // Affiche 2:3 — pour les cartes des rangées. Un épisode y est représenté
      // par l'affiche de sa saison (ou de la série) : c'est le bon format.
      poster: this.getImageUrl(
        item.type === 'episode'
          ? (item.parentThumb || item.thumb || item.grandparentThumb)
          : item.thumb,
        'poster'
      ),
      /* Vignette 16:9 PROPRE à l'épisode. La liste des épisodes affichait
         jusqu'ici l'affiche 2:3 de la saison dans un cadre 16:9 : elle était
         donc rognée violemment (un visage en gros plan). C'est l'image de
         l'épisode lui-même qu'il faut, au même format que son cadre. */
      still: item.type === 'episode' && item.thumb ? this.getImageUrl(item.thumb, 'still') : null,
      backdrop: this.getImageUrl(item.art, 'backdrop'),
      logo: this.getImageUrl(item.titleLogo || item.logo, 'logo'),
      tmdbId: item.tmdbId,
      imdbId: item.imdbId,
      year: item.year,
      rating: (item.rating || item.audienceRating) ? `${item.rating || item.audienceRating}/10` : null,
      contentRating: item.contentRating,
      duration: item.duration ? `${Math.floor(item.duration / 60000)} min` : null,
      rawDuration: item.duration || 0,
      match: item.audienceRating ? `${item.audienceRating * 10}%` : '90%',
      type: item.type,
      addedAt: item.addedAt || null, // unix seconds — used for the "Nouveau" badge
      // 'raw' impératif : c'est le FICHIER VIDÉO, pas une image.
      mediaUrl: item.Media?.[0]?.Part?.[0]?.key ? this.getImageUrl(item.Media[0].Part[0].key, 'raw') : null,
      parentRatingKey: item.parentRatingKey,
      grandparentRatingKey: item.grandparentRatingKey,
      index: item.index,
      grandparentTitle: item.grandparentTitle,
      parentTitle: item.parentTitle,
      libraryTitle: item.librarySectionTitle,
      librarySectionID: item.librarySectionID,
      genres: item.Genre ? item.Genre.map(g => g.tag) : []
    };
  }
};

export default plexService;
