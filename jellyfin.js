/* ══════════════════════════════════════════════════════════════════
   Jellyfin — traduit en « dialecte Plex »

   Tout NovaStream (interface, lecteur, recommandations, bibliothèques
   privées…) parle le format de Plex. Plutôt que de tout réécrire deux
   fois, le serveur TRADUIT : quand le serveur multimédia est Jellyfin,
   chaque requête « Plex » reçue est convertie en appel Jellyfin, et la
   réponse est remise en forme Plex.

   Trois conversions à connaître :
   · IDENTIFIANTS — Jellyfin utilise des GUID (32 caractères hexa), Plex
     des nombres, et le code de Nova suppose des nombres un peu partout.
     Chaque GUID reçoit donc un numéro stable, rangé en base (table
     jf_ids) et décalé de 50 000 000 pour ne jamais croiser un ancien
     identifiant Plex encore présent dans l'historique.
   · FICHIERS ET PISTES — « part » Plex = source média Jellyfin (même GUID
     que l'élément), « stream » Plex = piste d'index N de cette source.
   · VIDÉO — le transcodeur de Jellyfin sert du HLS (master.m3u8). Le
     jeton Jellyfin reste sur le serveur : le navigateur passe toujours
     par /jfhls, qui ajoute l'authentification.

   Seuls les chemins Plex réellement utilisés par Nova sont traduits ;
   tout le reste répond 404 — le proxy n'est pas une porte ouverte sur
   l'API d'administration de Jellyfin.
   ══════════════════════════════════════════════════════════════════ */
import { Readable } from 'stream';

const DECALAGE = 50_000_000;
const APPAREIL = 'novastream-server';
const TYPE_JF_VERS_PLEX = { Movie: 'movie', Series: 'show', Season: 'season', Episode: 'episode' };
const TYPE_PLEX_VERS_JF = { 1: 'Movie', 2: 'Series', 3: 'Season', 4: 'Episode' };
const TRI = {
  addedAt: 'DateCreated', originallyAvailableAt: 'PremiereDate', titleSort: 'SortName', title: 'SortName',
  year: 'ProductionYear', rating: 'CommunityRating', audienceRating: 'CommunityRating', lastViewedAt: 'DatePlayed',
};
const CHAMPS_LISTE = 'Genres,ProviderIds,DateCreated,PremiereDate,ParentId,OfficialRating,CommunityRating,ChildCount,RecursiveItemCount';
const CHAMPS_FICHE = `${CHAMPS_LISTE},Overview,Taglines,People,Studios,MediaSources,MediaStreams,Chapters,Path`;
const LANGUES = {
  fra: 'Français', fre: 'Français', fr: 'Français', eng: 'English', en: 'English', jpn: '日本語', ja: '日本語',
  spa: 'Español', es: 'Español', ger: 'Deutsch', deu: 'Deutsch', de: 'Deutsch', ita: 'Italiano', it: 'Italiano',
  por: 'Português', pt: 'Português', kor: '한국어', ko: '한국어', chi: '中文', zho: '中文', rus: 'Русский', ara: 'العربية',
};
const epoch = (d) => (d ? Math.floor(new Date(d).getTime() / 1000) : undefined);
const ms = (ticks) => (ticks ? Math.round(ticks / 10000) : undefined);

export function creerJellyfin({ db, url, token, userId }) {
  db.exec(`CREATE TABLE IF NOT EXISTS jf_ids (n INTEGER PRIMARY KEY AUTOINCREMENT, cle TEXT UNIQUE NOT NULL)`);
  const lireCle = db.prepare('SELECT cle FROM jf_ids WHERE n = ?');
  const lireNum = db.prepare('SELECT n FROM jf_ids WHERE cle = ?');
  const ajouter = db.prepare('INSERT OR IGNORE INTO jf_ids (cle) VALUES (?)');
  const versNum = new Map();
  const versCle = new Map();

  /** GUID (ou clé composée) → numéro façon Plex, stable pour toujours. */
  function num(cle) {
    if (!cle) return undefined;
    const c = String(cle);
    let n = versNum.get(c);
    if (n) return n;
    ajouter.run(c);
    n = lireNum.get(c).n + DECALAGE;
    versNum.set(c, n); versCle.set(n, c);
    return n;
  }
  /** Numéro façon Plex → clé d'origine (« i:<guid> », « p:<guid> »…), ou null. */
  function cleDe(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= DECALAGE) return null;
    if (versCle.has(v)) return versCle.get(v);
    const row = lireCle.get(v - DECALAGE);
    if (!row) return null;
    versNum.set(row.cle, v); versCle.set(v, row.cle);
    return row.cle;
  }
  const idItem = (guid) => num(`i:${guid}`);
  const guidDe = (n, prefixe = 'i') => { const c = cleDe(n); return c && c.startsWith(`${prefixe}:`) ? c.slice(prefixe.length + 1) : null; };

  const actif = () => !!(url() && token() && userId());
  const entetes = () => ({
    Authorization: `MediaBrowser Client="NovaStream", Device="NovaStream", DeviceId="${APPAREIL}", Version="1.0", Token="${token()}"`,
  });

  async function jf(chemin, { method = 'GET', body, brut = false, headers = {}, signal } = {}) {
    const r = await fetch(`${url().replace(/\/+$/, '')}${chemin}`, {
      method,
      headers: { ...entetes(), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal || AbortSignal.timeout(30000),
    });
    if (brut) return r;
    if (!r.ok) { const e = new Error(`Jellyfin ${r.status}`); e.statut = r.status; throw e; }
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }
  const u = () => `userId=${userId()}`;

  /* ── Bibliothèques (« sections » Plex) ── */
  let vues = { at: 0, liste: [] };
  async function sections() {
    if (Date.now() - vues.at < 60000 && vues.liste.length) return vues.liste;
    const d = await jf(`/UserViews?${u()}`);
    vues = {
      at: Date.now(),
      liste: (d.Items || [])
        .filter((v) => v.CollectionType === 'movies' || v.CollectionType === 'tvshows')
        .map((v) => ({ key: String(idItem(v.Id)), title: v.Name, type: v.CollectionType === 'movies' ? 'movie' : 'show', guid: v.Id })),
    };
    return vues.liste;
  }

  /* Bibliothèque d'un élément : Jellyfin ne la donne pas directement, on la
     déduit de ses ancêtres (le dossier de collection a le même GUID que la vue). */
  const sectionDeCache = new Map();
  async function sectionDe(guid) {
    if (sectionDeCache.has(guid)) return sectionDeCache.get(guid);
    const secs = await sections();
    let trouve = null;
    try {
      const anc = await jf(`/Items/${guid}/Ancestors?${u()}`);
      for (const a of anc || []) { trouve = secs.find((s) => s.guid === a.Id); if (trouve) break; }
    } catch { /* inconnu */ }
    sectionDeCache.set(guid, trouve);
    return trouve;
  }

  /* ── Conversion d'un élément Jellyfin en « Metadata » Plex ── */
  function image(guid, sorte, tag) {
    return guid ? `/library/metadata/${idItem(guid)}/${sorte}/${tag || 0}` : undefined;
  }

  function flux(item) {
    const source = (item.MediaSources || [])[0];
    const liste = source?.MediaStreams || item.MediaStreams || [];
    const partGuid = source?.Id || item.Id;
    const out = [];
    for (const s of liste) {
      const streamType = s.Type === 'Video' ? 1 : s.Type === 'Audio' ? 2 : s.Type === 'Subtitle' ? 3 : 0;
      if (!streamType) continue;
      const code = (s.Language || '').toLowerCase();
      const codec = (s.Codec || '').toLowerCase();
      out.push({
        id: num(`s:${partGuid}:${s.Index}`),
        index: s.Index,
        streamType,
        codec: codec === 'subrip' ? 'srt' : codec,
        language: LANGUES[code] || s.Language || undefined,
        languageCode: code || undefined,
        languageTag: code ? code.slice(0, 2) : undefined,
        displayTitle: s.DisplayTitle || s.Title || LANGUES[code] || code || undefined,
        title: s.Title || undefined,
        selected: !!s.IsDefault || undefined,
        default: !!s.IsDefault || undefined,
        forced: !!s.IsForced || undefined,
        channels: s.Channels,
        bitrate: s.BitRate ? Math.round(s.BitRate / 1000) : undefined,
        profile: s.Profile ? String(s.Profile).toLowerCase() : undefined,
        height: s.Height, width: s.Width,
        key: s.IsExternal ? `/library/streams/${num(`s:${partGuid}:${s.Index}`)}` : undefined,
      });
    }
    return out;
  }

  function media(item) {
    const source = (item.MediaSources || [])[0];
    const partGuid = source?.Id || item.Id;
    const pid = num(`p:${partGuid}`);
    const video = (source?.MediaStreams || item.MediaStreams || []).find((s) => s.Type === 'Video');
    const audio = (source?.MediaStreams || item.MediaStreams || []).find((s) => s.Type === 'Audio');
    return [{
      id: pid,
      duration: ms(item.RunTimeTicks),
      container: (source?.Container || '').split(',')[0] || undefined,
      videoCodec: (video?.Codec || '').toLowerCase() || undefined,
      audioCodec: (audio?.Codec || '').toLowerCase() || undefined,
      videoResolution: video?.Height ? (video.Height >= 2000 ? '4k' : String(video.Height)) : undefined,
      width: video?.Width, height: video?.Height,
      Part: [{
        id: pid,
        key: `/library/parts/${pid}/0/file`,
        duration: ms(item.RunTimeTicks),
        container: (source?.Container || '').split(',')[0] || undefined,
        size: source?.Size,
        Stream: (item.MediaSources || item.MediaStreams) ? flux(item) : undefined,
      }],
    }];
  }

  function versPlex(item, section) {
    const n = idItem(item.Id);
    const type = TYPE_JF_VERS_PLEX[item.Type] || String(item.Type || '').toLowerCase();
    const guids = [];
    if (item.ProviderIds?.Tmdb) guids.push({ id: `tmdb://${item.ProviderIds.Tmdb}` });
    if (item.ProviderIds?.Imdb) guids.push({ id: `imdb://${item.ProviderIds.Imdb}` });
    if (item.ProviderIds?.Tvdb) guids.push({ id: `tvdb://${item.ProviderIds.Tvdb}` });
    const ud = item.UserData || {};
    const backdropGuid = item.BackdropImageTags?.length ? item.Id : item.ParentBackdropItemId;
    const backdropTag = item.BackdropImageTags?.[0] || item.ParentBackdropImageTags?.[0];
    const m = {
      ratingKey: String(n),
      key: `/library/metadata/${n}${type === 'show' || type === 'season' ? '/children' : ''}`,
      guid: item.ProviderIds?.Tmdb ? `tmdb://${item.ProviderIds.Tmdb}` : `jellyfin://${item.Id}`,
      Guid: guids,
      type,
      title: item.Name,
      titleSort: item.SortName,
      summary: item.Overview,
      tagline: item.Taglines?.[0],
      year: item.ProductionYear,
      originallyAvailableAt: item.PremiereDate ? item.PremiereDate.slice(0, 10) : undefined,
      contentRating: item.OfficialRating,
      rating: item.CommunityRating,
      audienceRating: item.CommunityRating,
      duration: ms(item.RunTimeTicks),
      addedAt: epoch(item.DateCreated),
      viewOffset: ud.PlaybackPositionTicks ? ms(ud.PlaybackPositionTicks) : undefined,
      viewCount: ud.Played ? Math.max(1, ud.PlayCount || 1) : undefined,
      lastViewedAt: epoch(ud.LastPlayedDate),
      thumb: item.ImageTags?.Primary ? image(item.Id, 'thumb', item.ImageTags.Primary) : undefined,
      art: backdropGuid ? image(backdropGuid, 'art', backdropTag) : undefined,
      logo: item.ImageTags?.Logo ? image(item.Id, 'logo', item.ImageTags.Logo) : undefined,
      Genre: (item.Genres || []).map((g) => ({ tag: g, id: num(`g:${g}`) })),
      index: item.IndexNumber,
      parentIndex: item.ParentIndexNumber,
      childCount: item.ChildCount,
      leafCount: item.RecursiveItemCount,
      viewedLeafCount: item.RecursiveItemCount != null && ud.UnplayedItemCount != null ? Math.max(0, item.RecursiveItemCount - ud.UnplayedItemCount) : undefined,
      studio: item.Studios?.[0]?.Name,
    };
    if (type === 'episode') {
      m.parentRatingKey = item.SeasonId ? String(idItem(item.SeasonId)) : undefined;
      m.grandparentRatingKey = item.SeriesId ? String(idItem(item.SeriesId)) : undefined;
      m.parentTitle = item.SeasonName;
      m.grandparentTitle = item.SeriesName;
      m.parentThumb = item.SeasonId ? image(item.SeasonId, 'thumb', item.ParentPrimaryImageTag) : undefined;
      m.grandparentThumb = item.SeriesId ? image(item.SeriesId, 'thumb', item.SeriesPrimaryImageTag) : undefined;
      m.grandparentArt = m.art;
    } else if (type === 'season') {
      m.parentRatingKey = item.SeriesId ? String(idItem(item.SeriesId)) : undefined;
      m.parentTitle = item.SeriesName;
      m.parentThumb = item.SeriesId ? image(item.SeriesId, 'thumb', item.SeriesPrimaryImageTag) : undefined;
      if (!m.thumb) m.thumb = m.parentThumb;
    }
    if (type === 'movie' || type === 'episode') m.Media = media(item);
    if (item.People?.length) {
      m.Role = item.People.filter((p) => p.Type === 'Actor').slice(0, 40).map((p) => ({
        id: idItem(p.Id), tag: p.Name, role: p.Role,
        thumb: p.PrimaryImageTag ? image(p.Id, 'thumb', p.PrimaryImageTag) : undefined,
      }));
      m.Director = item.People.filter((p) => p.Type === 'Director').map((p) => ({ tag: p.Name }));
    }
    if (section) { m.librarySectionID = Number(section.key); m.librarySectionTitle = section.title; }
    return m;
  }

  const conteneur = (Metadata, extra = {}) => ({ MediaContainer: { size: Metadata.length, Metadata, ...extra } });

  /* ── Marqueurs (générique de début / fin) — Jellyfin 10.10+ ── */
  async function marqueurs(guid) {
    try {
      const d = await jf(`/MediaSegments/${guid}?includeSegmentTypes=Intro&includeSegmentTypes=Outro`);
      return (d.Items || []).map((s) => ({
        type: s.Type === 'Intro' ? 'intro' : 'credits',
        startTimeOffset: ms(s.StartTicks) || 0,
        endTimeOffset: ms(s.EndTicks) || 0,
      }));
    } catch { return []; }
  }

  /* ── Les chemins Plex traduits ─────────────────────────────────────── */
  async function plexJson(cheminComplet) {
    const [chemin, qs = ''] = String(cheminComplet).split('?');
    const q = new URLSearchParams(qs);
    let m;

    if (chemin === '/identity') {
      const d = await jf('/System/Info/Public');
      return { MediaContainer: { machineIdentifier: d.Id, version: `Jellyfin ${d.Version}` } };
    }

    if (chemin === '/library/sections' || chemin === '/library/sections/') {
      const secs = await sections();
      return { MediaContainer: { size: secs.length, Directory: secs.map(({ key, title, type }) => ({ key, title, type })) } };
    }

    if ((m = chemin.match(/^\/library\/sections\/(\d+)\/all$/))) {
      const sec = (await sections()).find((s) => s.key === m[1]);
      if (!sec) return conteneur([]);
      const p = new URLSearchParams({ userId: userId(), ParentId: sec.guid, Recursive: 'true', Fields: CHAMPS_LISTE, EnableImageTypes: 'Primary,Backdrop,Logo' });
      const type = TYPE_PLEX_VERS_JF[q.get('type')] || (sec.type === 'movie' ? 'Movie' : 'Series');
      p.set('IncludeItemTypes', type);
      if (!/summary/.test(q.get('excludeFields') || '')) p.set('Fields', `${CHAMPS_LISTE},Overview`);
      if (type === 'Episode' || type === 'Movie') p.set('Fields', `${p.get('Fields')},MediaSources`);
      const [cleTri, sens] = (q.get('sort') || 'titleSort').split(':');
      p.set('SortBy', TRI[cleTri] || 'SortName');
      p.set('SortOrder', sens === 'desc' ? 'Descending' : 'Ascending');
      if (q.get('X-Plex-Container-Start')) p.set('StartIndex', q.get('X-Plex-Container-Start'));
      if (q.get('X-Plex-Container-Size')) p.set('Limit', q.get('X-Plex-Container-Size'));
      if (q.get('unwatched') === '0') p.set('IsPlayed', 'true');
      if (q.get('unwatched') === '1') p.set('IsPlayed', 'false');
      if (q.get('genre')) { const g = cleDe(q.get('genre')); if (g?.startsWith('g:')) p.set('Genres', g.slice(2)); }
      // Filtres par langue audio/sous-titres : propres à Plex, sans équivalent.
      if (q.get('audioLanguage') || q.get('subtitleLanguage')) return conteneur([]);
      const d = await jf(`/Items?${p}`);
      return conteneur((d.Items || []).map((it) => versPlex(it, sec)), { totalSize: d.TotalRecordCount, librarySectionID: Number(sec.key), librarySectionTitle: sec.title });
    }

    if ((m = chemin.match(/^\/library\/sections\/(\d+)\/genre$/))) {
      const sec = (await sections()).find((s) => s.key === m[1]);
      if (!sec) return { MediaContainer: { size: 0, Directory: [] } };
      const d = await jf(`/Genres?${u()}&ParentId=${sec.guid}`);
      return { MediaContainer: { size: (d.Items || []).length, Directory: (d.Items || []).map((g) => ({ key: String(num(`g:${g.Name}`)), title: g.Name })) } };
    }

    // Filtres de langue Plex : on renvoie une liste vide (fonction propre à Plex).
    if (/^\/library\/sections\/\d+\/(audioLanguage|subtitleLanguage)$/.test(chemin)) {
      return { MediaContainer: { size: 0, Directory: [] } };
    }

    if ((m = chemin.match(/^\/library\/metadata\/(\d+)$/))) {
      const guid = guidDe(m[1]);
      if (!guid) return conteneur([]);
      const [item, sec] = await Promise.all([jf(`/Items/${guid}?${u()}&Fields=${CHAMPS_FICHE}`), sectionDe(guid)]);
      const meta = versPlex(item, sec);
      if (item.Type === 'Movie' || item.Type === 'Episode') {
        const marks = await marqueurs(guid);
        if (marks.length) meta.Marker = marks;
      }
      return conteneur([meta], sec ? { librarySectionID: Number(sec.key), librarySectionTitle: sec.title } : {});
    }

    if ((m = chemin.match(/^\/library\/metadata\/(\d+)\/(children|allLeaves)$/))) {
      const guid = guidDe(m[1]);
      if (!guid) return conteneur([]);
      const [item, sec] = await Promise.all([jf(`/Items/${guid}?${u()}`), sectionDe(guid)]);
      let d;
      if (item.Type === 'Series' && m[2] === 'children') d = await jf(`/Shows/${guid}/Seasons?${u()}&Fields=${CHAMPS_LISTE},Overview`);
      else if (item.Type === 'Series') d = await jf(`/Shows/${guid}/Episodes?${u()}&Fields=${CHAMPS_LISTE},Overview,MediaSources`);
      else if (item.Type === 'Season') d = await jf(`/Shows/${item.SeriesId}/Episodes?${u()}&SeasonId=${guid}&Fields=${CHAMPS_LISTE},Overview,MediaSources`);
      else return conteneur([]);
      const extra = sec ? { librarySectionID: Number(sec.key), librarySectionTitle: sec.title } : {};
      return conteneur((d.Items || []).map((it) => versPlex(it, sec)), { ...extra, parentTitle: item.Name, key: String(m[1]) });
    }

    if ((m = chemin.match(/^\/library\/metadata\/(\d+)\/(related|similar)$/))) {
      const guid = guidDe(m[1]);
      if (!guid) return { MediaContainer: { Hub: [] } };
      const d = await jf(`/Items/${guid}/Similar?${u()}&Limit=24&Fields=${CHAMPS_LISTE},Overview`);
      const liste = (d.Items || []).map((it) => versPlex(it));
      return { MediaContainer: { size: 1, Hub: [{ type: 'mixed', title: 'Similaires', size: liste.length, Metadata: liste }] } };
    }

    if (chemin === '/library/recentlyAdded') {
      const secs = await sections();
      const tout = [];
      for (const sec of secs) {
        const d = await jf(`/Items/Latest?${u()}&ParentId=${sec.guid}&Limit=25&Fields=${CHAMPS_LISTE},Overview&GroupItems=true`);
        for (const it of d || []) tout.push(versPlex(it, sec));
      }
      tout.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      return conteneur(tout.slice(0, 50));
    }

    if (chemin === '/hubs/search') {
      const terme = q.get('query') || '';
      if (!terme.trim()) return { MediaContainer: { Hub: [] } };
      const d = await jf(`/Items?${u()}&searchTerm=${encodeURIComponent(terme)}&Recursive=true&IncludeItemTypes=Movie,Series&Limit=${Number(q.get('limit')) || 30}&Fields=${CHAMPS_LISTE},Overview`);
      const liste = (d.Items || []).map((it) => versPlex(it));
      return { MediaContainer: { size: 2, Hub: [
        { type: 'movie', title: 'Films', Metadata: liste.filter((x) => x.type === 'movie') },
        { type: 'show', title: 'Séries', Metadata: liste.filter((x) => x.type === 'show') },
      ] } };
    }

    if (chemin === '/status/sessions') {
      const d = await jf('/Sessions?activeWithinSeconds=120');
      const Metadata = (d || []).filter((s) => s.NowPlayingItem).map((s) => {
        const it = s.NowPlayingItem;
        return {
          title: it.Name, type: TYPE_JF_VERS_PLEX[it.Type], grandparentTitle: it.SeriesName,
          User: { title: s.UserName || '' },
          Player: { state: s.PlayState?.IsPaused ? 'paused' : 'playing', title: s.DeviceName },
          viewOffset: ms(s.PlayState?.PositionTicks), duration: ms(it.RunTimeTicks),
          TranscodeSession: s.TranscodingInfo && !s.TranscodingInfo.IsVideoDirect ? {} : undefined,
        };
      });
      return conteneur(Metadata);
    }

    const e = new Error(`Chemin Plex non traduit pour Jellyfin : ${chemin}`);
    e.statut = 404;
    throw e;
  }

  /* ── Réponses binaires (images, fichiers) : on relaie le flux tel quel ── */
  async function relayer(res, r, cache) {
    res.status(r.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (cache) res.setHeader('Cache-Control', cache);
    if (!r.body) return res.end();
    const flux = Readable.fromWeb(r.body);
    flux.on('error', () => { try { res.destroy(); } catch {} });
    res.on('close', () => flux.destroy());
    flux.pipe(res);
  }

  const SORTE_IMAGE = { thumb: 'Primary', art: 'Backdrop', logo: 'Logo', banner: 'Banner' };

  async function servirImage(res, n, sorte, largeur, hauteur) {
    const guid = guidDe(n);
    if (!guid) return res.status(404).end();
    const p = new URLSearchParams({ quality: '85' });
    if (largeur) p.set('maxWidth', String(largeur));
    if (hauteur) p.set('maxHeight', String(hauteur));
    const r = await jf(`/Items/${guid}/Images/${SORTE_IMAGE[sorte] || 'Primary'}?${p}`, { brut: true });
    return relayer(res, r, 'public, max-age=86400');
  }

  // Choix de pistes faits dans le lecteur (PUT /library/parts), par fichier.
  const pistesChoisies = new Map();   // partNum → { audio, sub }
  // Sessions déjà annoncées à Jellyfin (Sessions/Playing) — une seule fois chacune.
  const sessionsAnnoncees = new Map();   // session → { guid, methode }

  function indexDePiste(streamNum) {
    const c = cleDe(streamNum);
    if (!c?.startsWith('s:')) return null;
    const [, guid, index] = c.split(':');
    return { guid, index: Number(index) };
  }

  /**
   * Proxy /plex/* quand le serveur est Jellyfin.
   * @returns {Promise<void>} a toujours répondu (404 si le chemin n'est pas traduit)
   */
  async function servirProxy(req, res, cheminPlex, filtrer = (j) => j) {
    const [chemin, qs = ''] = cheminPlex.split('?');
    const q = new URLSearchParams(qs);
    const methode = (req.method || 'GET').toUpperCase();
    let m;

    // Images
    if ((m = chemin.match(/^\/library\/metadata\/(\d+)\/(thumb|art|logo|banner)(\/\w+)?$/))) {
      return servirImage(res, m[1], m[2]);
    }
    if (chemin === '/photo/:/transcode') {
      const cible = q.get('url') || '';
      const w = Number(q.get('width')) || undefined;
      const h = Number(q.get('height')) || undefined;
      if ((m = cible.match(/^\/library\/metadata\/(\d+)\/(thumb|art|logo|banner)/))) return servirImage(res, m[1], m[2], w, h);
      // Image externe (affiches TMDB) : seulement depuis TMDB, pour ne pas
      // transformer le serveur en relais vers n'importe quelle adresse.
      if (/^https:\/\/image\.tmdb\.org\//.test(cible)) {
        const r = await fetch(cible, { signal: AbortSignal.timeout(15000) });
        return relayer(res, r, 'public, max-age=86400');
      }
      return res.status(404).end();
    }

    // Lecture directe du fichier
    if ((m = chemin.match(/^\/library\/parts\/(\d+)(\/.*)?$/))) {
      const guid = guidDe(m[1], 'p');
      if (!guid) return res.status(404).end();
      if (methode === 'PUT') {
        pistesChoisies.set(m[1], { audio: q.get('audioStreamID'), sub: q.get('subtitleStreamID') });
        return res.status(200).json({});
      }
      const r = await jf(`/Videos/${guid}/stream?static=true&MediaSourceId=${guid}`, {
        brut: true,
        headers: req.headers.range ? { Range: req.headers.range } : {},
        signal: AbortSignal.timeout(30000),
      });
      return relayer(res, r);
    }

    // Fichier de sous-titres (piste externe)
    if ((m = chemin.match(/^\/library\/streams\/(\d+)$/))) {
      const p = indexDePiste(m[1]);
      if (!p) return res.status(404).end();
      const r = await jf(`/Videos/${p.guid}/${p.guid}/Subtitles/${p.index}/Stream.srt`, { brut: true });
      return relayer(res, r);
    }

    // Suivi de lecture (Nova tient aussi sa propre progression)
    if (chemin === '/:/timeline') {
      await timeline(q).catch(() => {});
      return res.status(200).json({});
    }
    if (chemin === '/:/scrobble' || chemin === '/:/unscrobble') {
      const guid = guidDe(q.get('key'));
      if (guid) await jf(`/UserPlayedItems/${guid}?${u()}`, { method: chemin === '/:/scrobble' ? 'POST' : 'DELETE' }).catch(() => {});
      return res.status(200).json({});
    }
    if (chemin === '/video/:/transcode/universal/ping') {
      const s = q.get('session');
      if (s) await jf(`/Sessions/Playing/Ping?playSessionId=${encodeURIComponent(s)}`, { method: 'POST' }).catch(() => {});
      return res.status(200).json({});
    }
    if (chemin === '/video/:/transcode/universal/stop') {
      const s = q.get('session');
      if (s) await arreter(s).catch(() => {});
      return res.status(200).json({});
    }

    if (methode !== 'GET' && methode !== 'HEAD') return res.status(403).json({ error: 'Méthode non autorisée' });
    const json = await plexJson(cheminPlex);
    return res.json(filtrer(json, chemin));
  }

  async function timeline(q) {
    const session = q.get('session');
    const guid = guidDe(q.get('ratingKey'));
    if (!session || !guid) return;
    const etat = q.get('state');
    const corps = {
      ItemId: guid, MediaSourceId: guid, PlaySessionId: session,
      PositionTicks: Math.round(Number(q.get('time') || 0) * 10000),
      IsPaused: etat === 'paused', CanSeek: true,
      PlayMethod: sessionsAnnoncees.get(session)?.methode || 'Transcode',
    };
    if (etat === 'stopped') {
      sessionsAnnoncees.delete(session);
      return jf('/Sessions/Playing/Stopped', { method: 'POST', body: corps });
    }
    if (!sessionsAnnoncees.has(session)) {
      sessionsAnnoncees.set(session, { guid, methode: corps.PlayMethod });
      await jf('/Sessions/Playing', { method: 'POST', body: corps });
    }
    return jf('/Sessions/Playing/Progress', { method: 'POST', body: corps });
  }

  async function arreter(session) {
    sessionsAnnoncees.delete(session);
    await jf(`/Videos/ActiveEncodings?deviceId=${APPAREIL}&playSessionId=${encodeURIComponent(session)}`, { method: 'DELETE' });
  }

  /* ── Transcodage ─────────────────────────────────────────────────────
     Reçoit les paramètres que le lecteur envoie à Plex et démarre un HLS
     Jellyfin équivalent. Toutes les adresses de la playlist sont réécrites
     vers /jfhls, qui ajoute le jeton Jellyfin côté serveur. */
  async function demarrerTranscodage(query, avecJeton) {
    const p = new URLSearchParams(query);
    const rk = (p.get('path') || '').match(/\/library\/metadata\/(\d+)/)?.[1];
    const guid = guidDe(rk);
    if (!guid) { const e = new Error('Titre inconnu'); e.statut = 404; throw e; }
    const session = p.get('session') || `nova-${Date.now()}`;
    const [w, h] = (p.get('videoResolution') || '1920x1080').split('x').map(Number);
    const debit = Math.max(500, Math.min(Number(p.get('maxVideoBitrate')) || 8000, 40000));

    // Pistes : paramètres explicites, sinon le dernier choix fait pour ce fichier.
    const choix = pistesChoisies.get(String(num(`p:${guid}`))) || {};
    const audio = indexDePiste(p.get('audioStreamID') || choix.audio);
    const sousTitreId = p.get('subtitleStreamID') && p.get('subtitleStreamID') !== '0' ? p.get('subtitleStreamID') : (choix.sub && choix.sub !== '0' ? choix.sub : null);
    const sousTitre = sousTitreId ? indexDePiste(sousTitreId) : null;

    const params = new URLSearchParams({
      MediaSourceId: guid, DeviceId: APPAREIL, PlaySessionId: session,
      VideoCodec: 'h264', AudioCodec: 'aac', TranscodingMaxAudioChannels: '2', AudioBitrate: '192000',
      VideoBitrate: String(debit * 1000), MaxWidth: String(w || 1920), MaxHeight: String(h || 1080),
      SegmentContainer: 'ts', MinSegments: '1', BreakOnNonKeyFrames: 'true',
      RequireAvc: 'false', EnableAutoStreamCopy: 'true', AllowVideoStreamCopy: 'true', AllowAudioStreamCopy: 'false',
    });
    if (audio) params.set('AudioStreamIndex', String(audio.index));
    if (sousTitre) { params.set('SubtitleStreamIndex', String(sousTitre.index)); params.set('SubtitleMethod', 'Encode'); }

    const r = await jf(`/Videos/${guid}/master.m3u8?${params}`, { brut: true, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { const e = new Error(`Jellyfin ${r.status}`); e.statut = r.status; throw e; }
    const texte = await r.text();
    // « main.m3u8?… » est relatif à /Videos/<guid>/ : on le rend absolu vers /jfhls.
    return texte.split('\n').map((ligne) => {
      const l = ligne.trim();
      if (!l || l.startsWith('#')) return ligne;
      return avecJeton(`/jfhls/Videos/${guid}/${l}`);
    }).join('\n');
  }

  /* /jfhls/Videos/<guid>/… → Jellyfin, uniquement les playlists et segments
     d'une lecture ; le reste de l'API n'est pas joignable par ce chemin. */
  const HLS_AUTORISE = /^\/Videos\/([0-9a-f]{32})\/(main\.m3u8|hls1\/[\w-]+\/[\w.-]+\.(ts|mp4|m4s|aac|vtt|m3u8)|[\w-]+\.m3u8)$/i;
  async function servirHls(req, res, chemin, qs, avecJeton, bloque) {
    const m = chemin.match(HLS_AUTORISE);
    if (!m) return res.status(404).end();
    if (bloque(idItem(m[1]))) return res.status(404).end();
    const q = new URLSearchParams(qs);
    q.delete('nova');
    const r = await jf(`${chemin}?${q}`, { brut: true, signal: AbortSignal.timeout(60000) });
    if (/\.m3u8$/i.test(chemin)) {
      const texte = await r.text();
      res.status(r.status);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      // URI relatives des segments : le navigateur perdrait le jeton ?nova=.
      return res.send(texte.split('\n').map((ligne) => {
        const l = ligne.trim();
        if (!l || l.startsWith('#')) return ligne;
        return avecJeton(l);
      }).join('\n'));
    }
    return relayer(res, r, 'no-cache');
  }

  /** Sous-titre intégré au fichier, converti en WebVTT par Jellyfin lui-même. */
  async function sousTitreVtt(streamNum) {
    const p = indexDePiste(streamNum);
    if (!p) return null;
    const r = await jf(`/Videos/${p.guid}/${p.guid}/Subtitles/${p.index}/Stream.vtt`, { brut: true, signal: AbortSignal.timeout(120000) });
    return r.ok ? r.text() : null;
  }

  /** « Marquer comme vu / non vu » fait dans Nova, recopié sur Jellyfin. */
  async function marquerVu(ratingKey, vu = true) {
    const guid = guidDe(ratingKey);
    if (!guid) return false;
    try { await jf(`/UserPlayedItems/${guid}?${u()}`, { method: vu ? 'POST' : 'DELETE' }); return true; }
    catch { return false; }
  }

  function oublier() { vues = { at: 0, liste: [] }; sectionDeCache.clear(); }

  return { actif, plexJson, servirProxy, servirHls, demarrerTranscodage, sousTitreVtt, marquerVu, oublier, guidDe, idItem };
}

/** Connexion d'un compte Jellyfin (assistant de configuration). */
export async function connecter(adresse, identifiant, motDePasse) {
  const base = String(adresse || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Adresse invalide (ex. http://192.168.1.10:8096)');
  let info;
  try {
    info = await (await fetch(`${base}/System/Info/Public`, { signal: AbortSignal.timeout(8000) })).json();
  } catch {
    throw new Error('Jellyfin ne répond pas à cette adresse');
  }
  const r = await fetch(`${base}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `MediaBrowser Client="NovaStream", Device="NovaStream", DeviceId="${APPAREIL}", Version="1.0"`,
    },
    body: JSON.stringify({ Username: identifiant, Pw: motDePasse || '' }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401) throw new Error('Identifiant ou mot de passe refusé');
  if (!r.ok) throw new Error(`Jellyfin répond ${r.status}`);
  const d = await r.json();
  return { url: base, token: d.AccessToken, userId: d.User.Id, nom: info.ServerName, version: info.Version, admin: !!d.User.Policy?.IsAdministrator };
}
