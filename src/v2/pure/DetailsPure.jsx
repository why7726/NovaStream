import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, ChevronLeft, Heart, Check, X, RotateCcw, ChevronDown, Bell, CheckCheck } from 'lucide-react';
import plexService from '../../services/plexService';
import authService from '../../services/authService';
import favoriteService from '../../services/favoriteService';
import progressService from '../../services/progressService';
import RowPure from './RowPure';
import PickerPure from './PickerPure';
import SagaRow from './SagaRow';
import UpcomingEpisodes from './UpcomingEpisodes';
import SynopsisPure from './SynopsisPure';
import { useAudioPref, setAudioPref, versionOptions } from '../lib/audioPref';
import { useLangBadges } from './langBadges';
import WatchTogetherButton from '../components/WatchTogetherButton';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

/* Bascule VF / VO — n'apparaît que si le fichier propose vraiment les deux.
   Le choix est une préférence globale, appliquée au lancement de la lecture. */
function VersionSwitch({ pref, options }) {
  if (!options) return null;
  return (
    <div className="flex p-[3px] rounded-full bg-white/[0.08] shrink-0">
      {options.map((v) => (
        <button key={v.id} onClick={() => setAudioPref(v.id)}
          title={v.id === 'vf' ? 'Doublage français' : 'Version originale'}
          className={`h-[26px] px-3 rounded-full text-[12px] font-semibold transition-colors ${
            pref === v.id ? 'bg-white text-black' : 'text-white/55 hover:text-white'
          }`}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

// Plex renvoie souvent « Season 2 » / « Specials » même en bibliothèque FR.
function seasonLabel(s) {
  const t = (s.title || '').trim();
  const m = t.match(/^season\s*(\d+)$/i);
  if (m) return `Saison ${m[1]}`;
  if (/^specials?$/i.test(t)) return 'Hors-série';
  if (!t && s.index != null) return `Saison ${s.index}`;
  return t;
}

/* Fiche "Pure" — l'affiche, le titre, une ligne d'infos, un bouton.
   Les épisodes deviennent une liste verticale sobre (façon iOS),
   les métadonnées une seule ligne séparée par des points. */
export default function DetailsPure() {
  const { id } = useParams();
  const navigate = useNavigate();
  const audioPref = useAudioPref();
  const langMap = useLangBadges();

  const [movie, setMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isFav, setIsFav] = useState(false);
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [similar, setSimilar] = useState([]);
  const [watchedIds, setWatchedIds] = useState(new Set());
  const [progressMap, setProgressMap] = useState({});
  const [full, setFull] = useState(false);
  const [trailer, setTrailer] = useState(false);
  const [versions, setVersions] = useState(null);
  const [epVersions, setEpVersions] = useState(null);   // quels episodes sont en VF
  // Clé de la bibliothèque d'animés : sert à savoir vers quelle section ressortir
  // quand la fiche ne porte pas son titre de bibliothèque.
  const [suivi, setSuivi] = useState(false);
  const [saisonVue, setSaisonVue] = useState(false);

  const entetes = () => {
    const t = authService.getToken();
    return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  };

  useEffect(() => {
    if (!movie || movie.type === 'movie') return;
    fetch(`${apiBase()}/api/follow/${movie.id}`, { headers: entetes() })
      .then((r) => r.json()).then((d) => setSuivi(!!d.suivi)).catch(() => {});
  }, [movie?.id, movie?.type]);

  const toggleSuivi = async () => {
    const veut = !suivi;
    setSuivi(veut);                                     // retour immédiat
    try {
      await fetch(`${apiBase()}/api/follow/${movie.id}`, {
        method: veut ? 'POST' : 'DELETE', headers: entetes(),
        body: veut ? JSON.stringify({ title: movie.title }) : undefined,
      });
    } catch { setSuivi(!veut); }
  };

  // Marquer toute la saison affichée comme vue
  const marquerSaisonVue = async () => {
    if (!season) return;
    setSaisonVue(true);
    try {
      // `season` est l'IDENTIFIANT de la saison, pas un objet.
      await fetch(`${apiBase()}/api/progress/season/${season}`, { method: 'POST', headers: entetes() });
      setWatchedIds((s) => { const n = new Set(s); episodes.forEach((e) => n.add(e.id)); return n; });
    } catch { setSaisonVue(false); }
  };

  useEffect(() => {
    let on = true;
    window.scrollTo(0, 0);
    setLoading(true); setMovie(null); setSeasons([]); setEpisodes([]); setSimilar([]); setFull(false);

    (async () => {
      try {
        const data = await plexService.getMetadata(id);
        if (!on || !data) { if (on) setLoading(false); return; }
        if (data.type === 'season') return navigate(`/title/${data.parentRatingKey}`, { replace: true });
        if (data.type === 'episode') return navigate(`/title/${data.grandparentRatingKey || data.parentRatingKey}`, { replace: true });

        favoriteService.isFavorite(id).then((v) => on && setIsFav(v));

        try {
          const r = await fetch(`${apiBase()}/api/tmdb-v2/assets/${data.type === 'movie' ? 'movie' : 'tv'}/${encodeURIComponent(data.tmdbId || data.title)}`);
          if (r.ok) {
            const a = await r.json();
            if (a.poster) data.poster = a.poster;
            if (a.backdrop) data.backdrop = a.backdrop;
            if (a.logo) data.logo = a.logo;
            if (a.trailer) data.trailer = a.trailer;
          }
        } catch { /* l'art Plex suffit */ }
        if (!on) return;
        setMovie(data);
        setLoading(false);

        Promise.all([progressService.getWatchedIds(), progressService.getContinueWatching()]).then(([w, cw]) => {
          if (!on) return;
          setWatchedIds(new Set(w));
          const pm = {};
          cw.forEach((it) => { pm[it.mediaId] = it.duration > 0 ? (it.currentTime / it.duration) * 100 : 0; });
          setProgressMap(pm);
        });

        if (data.type === 'show') {
          const kids = await plexService.getChildren(id);
          if (!on) return;
          const sns = kids.filter((k) => k.type === 'season');
          setSeasons(sns);
          if (sns[0]) {
            setSeason(sns[0].id);
            const eps = await plexService.getChildren(sns[0].id);
            if (on) setEpisodes(eps);
          }
        }

        let sim = await plexService.getSimilar(id);
        if (sim.length < 15 && data.librarySectionID) {
          const lib = await plexService.getLibraryItems(data.librarySectionID);
          const mine = new Set(data.genres || []);
          sim = [...sim, ...lib
            .filter((it) => it.id !== id && !sim.find((s) => s.id === it.id))
            .filter((it) => (it.genres || []).some((g) => mine.has(g)))
            .slice(0, 20 - sim.length)];
        }
        if (on) setSimilar(sim.slice(0, 24));
      } catch (e) {
        console.error('[DetailsPure]', e);
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, [id]);

  /* Pour une série partiellement doublée, on demande épisode par épisode
     ce qui existe en français : c'est ce qui permet de n'afficher que la VF
     quand la bascule est sur VF. */
  useEffect(() => {
    let on = true;
    setEpVersions(null);
    if (!movie || movie.type !== 'show' || !season) return;
    const num = (seasons.find((x) => x.id === season) || {}).index;
    if (!num) return;
    const t = authService.getToken();
    fetch(`${apiBase()}/api/versions/${movie.id}?season=${num}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    })
      .then((r) => r.json())
      .then((d) => { if (on && d.supported) setEpVersions(d); })
      .catch(() => {});
    return () => { on = false; };
  }, [movie, season, seasons]);

  const pickSeason = async (sid) => {
    setSeason(sid);
    setEpisodes([]);
    setEpisodes(await plexService.getChildren(sid));
  };

  const toggleFav = async () => {
    setIsFav(!isFav);
    setIsFav(await favoriteService.toggleFavorite(movie.id, isFav, { title: movie.title, poster: movie.poster, type: movie.type }));
  };

  const resume = useMemo(() => {
    if (!movie) return null;
    if (movie.type === 'movie') {
      const pct = progressMap[movie.id];
      return pct > 0 && pct < 95 ? { id: movie.id, pct } : null;
    }
    const ep = episodes.find((e) => progressMap[e.id] > 0 && progressMap[e.id] < 95 && !watchedIds.has(e.id));
    return ep ? { id: ep.id, pct: progressMap[ep.id], label: ep.index ? `l'épisode ${ep.index}` : '' } : null;
  }, [movie, episodes, progressMap, watchedIds]);

  /* Les « bonus » (PV, génériques sans crédits, menus de Blu-ray) sont
     rangés par Plex comme un épisode ordinaire — souvent numéroté 100 et
     long d'une minute. On les sort de la liste : ce n'est pas un épisode.
     Règle : nettement plus court que la durée médiane de la saison. */
  const [realEpisodes, bonusEpisodes] = useMemo(() => {
    if (episodes.length < 3) return [episodes, []];
    const mins = episodes.map((e) => (e.rawDuration || 0) / 60000).filter((m) => m > 0).sort((a, b) => a - b);
    if (!mins.length) return [episodes, []];
    const median = mins[Math.floor(mins.length / 2)];
    const isBonus = (e) => {
      const m = (e.rawDuration || 0) / 60000;
      return m > 0 && median > 10 && m < median * 0.4;
    };
    return [episodes.filter((e) => !isBonus(e)), episodes.filter(isBonus)];
  }, [episodes]);

  /* Les pistes audio ne vivent pas sur la fiche d'une série mais sur ses
     épisodes : on interroge le premier (réponse en cache ensuite). */
  useEffect(() => {
    let on = true;
    setVersions(null);
    if (!movie) return;
    if (movie.type === 'movie') {
      setVersions(versionOptions(movie.audioStreams || []));
      return;
    }
    const first = realEpisodes[0];
    if (!first) return;
    plexService.getMetadata(first.id)
      .then((d) => { if (on) setVersions(versionOptions(d?.audioStreams || [])); })
      .catch(() => {});
    return () => { on = false; };
  }, [movie, realEpisodes]);

  /* Bascule sur VF : on masque les épisodes qu'on n'a qu'en VO — ils
     réapparaissent plus bas, dans « Prochainement en VF ». */
  const enVf = audioPref === 'vf' && epVersions && epVersions.partial;
  const episodesAffiches = enVf
    ? realEpisodes.filter((e) => epVersions.vf.includes(Number(e.index)))
    : realEpisodes;

  const play = () => {
    if (resume) return navigate(`/play/${resume.id}`);
    if (movie.type === 'movie') return navigate(`/play/${movie.id}`);
    if (episodes[0]) return navigate(`/play/${episodes[0].id}`);
    document.getElementById('pure-eps')?.scrollIntoView({ behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-white/15 border-t-white/70 rounded-full animate-spin" />
      </div>
    );
  }
  if (!movie) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-3">
        <p className="p-title text-xl">Contenu introuvable</p>
        <button onClick={() => navigate('/')} className="text-[13px] p-dim hover:text-white transition-colors">Retour à l'accueil</button>
      </div>
    );
  }

  /* La flèche SORT du titre : elle mène à la page de SA bibliothèque (celle
     d'où il vient, sous le nom qu'elle porte sur le serveur), jamais à
     l'historique — revenir en arrière rebondissait de fiche en fiche quand on
     avait suivi des recommandations, alors qu'on veut juste ressortir. */
  const sortie = movie.librarySectionID != null ? `/bibliotheque/${movie.librarySectionID}` : '/';

  const desc = movie.summary || movie.description || '';
  const isCam = plexService.isCamItem(movie);
  const langBadge = langMap ? langMap[String(movie.id)] : null;
  const meta = [
    langBadge,
    movie.year,
    movie.type === 'movie' ? movie.duration : (seasons.length ? `${seasons.length} saison${seasons.length > 1 ? 's' : ''}` : null),
    movie.contentRating,
    movie.rating ? `★ ${movie.rating}` : null,
    ...(movie.genres || []).slice(0, 2),
  ].filter(Boolean);

  return (
    <div className="overflow-x-hidden pb-6 md:pb-16">
      {/* ── hero ── */}
      <div className="relative w-full h-[74vh] md:h-[86vh]">
        <picture>
          <source media="(max-width: 767px)" srcSet={movie.poster || movie.backdrop} />
          <img src={movie.backdrop || movie.poster} alt="" fetchpriority="high" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
        </picture>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #000 0%, rgba(0,0,0,0.9) 24%, rgba(0,0,0,0.2) 66%, rgba(0,0,0,0.4) 100%)' }} />

        {/* z-30 : au-dessus du dégradé ET du bloc de titre, pour que la zone
            cliquable ne soit jamais recouverte. */}
        <button onClick={() => navigate(sortie)} aria-label={movie.type === 'movie' ? 'Retour aux films' : 'Retour aux séries'}
          className="absolute top-[68px] md:top-[72px] left-4 md:left-8 z-30 w-9 h-9 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center text-white/85 hover:text-white active:scale-95 transition-all">
          <ChevronLeft size={19} />
        </button>

        <div className="absolute inset-x-0 bottom-0 px-5 md:px-8 pb-9 md:pb-12 max-w-[1400px] mx-auto">
          <div className="p-in max-w-2xl">
            {movie.logo
              ? <img src={movie.logo} alt={movie.title} className="max-h-[62px] md:max-h-[110px] max-w-[74vw] md:max-w-[400px] object-contain mb-4" />
              : <h1 className="p-display text-[32px] md:text-[56px] mb-4">{movie.title}</h1>}

            <p className="text-[12.5px] md:text-[13.5px] font-medium p-dim mb-5">{meta.join('  ·  ')}</p>

            {isCam && (
              <p className="text-[12px] md:text-[12.5px] text-white/70 mb-5 pl-3 border-l border-white/25 max-w-xl leading-relaxed">
                <span className="text-white font-medium">Version CAM.</span> Ce film a été filmé en salle : image et son de qualité réduite.
              </p>
            )}

            {/* Résumé : tronqué à 3 lignes, tout le bloc ouvre la fenêtre de
                lecture. Le « plus » était AUTREFOIS placé dans le paragraphe
                tronqué — donc sur la 4ᵉ ligne, coupé par line-clamp : invisible
                et impossible à cliquer. Il est désormais en dehors du clamp. */}
            {desc && (
              <div className="max-w-xl mb-6">
                <p onClick={() => setFull(true)}
                  className="text-[13.5px] md:text-[15px] text-white/75 leading-relaxed line-clamp-3 cursor-pointer">
                  {desc}
                </p>
                {desc.length > 180 && (
                  <button onClick={() => setFull(true)}
                    className="mt-1 text-[13px] font-medium text-white/50 hover:text-white transition-colors">
                    plus
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button onClick={play} className="p-btn relative overflow-hidden">
                {resume ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />}
                {resume ? `Reprendre${resume.label ? ' ' + resume.label : ''}` : 'Lecture'}
                {resume && <span className="absolute bottom-0 left-0 h-[2px] bg-black/35" style={{ width: `${Math.min(resume.pct, 100)}%` }} />}
              </button>
              {movie.trailer && (
                <button onClick={() => setTrailer(true)} className="p-btn p-btn-ghost">Bande-annonce</button>
              )}
              {/* Suivre : prévenu dès qu'un nouvel épisode ARRIVE SUR NOVA —
                  la seule alerte qui serve à quelque chose. */}
              {movie.type !== 'movie' && (
                <button onClick={toggleSuivi} aria-label={suivi ? 'Ne plus suivre' : 'Suivre la série'}
                  title={suivi ? 'Suivi — tu seras prévenu des nouveaux épisodes' : 'Être prévenu des nouveaux épisodes'}
                  className={`p-icon-btn ${suivi ? 'bg-white text-black hover:bg-white' : ''}`}>
                  <Bell size={18} fill={suivi ? 'currentColor' : 'none'} />
                </button>
              )}
              <button onClick={toggleFav} aria-label="Favori" className="p-icon-btn">
                <Heart size={18} fill={isFav ? 'currentColor' : 'none'} className={isFav ? 'text-white' : 'text-white/85'} />
              </button>
              <WatchTogetherButton media={movie} />
            </div>

            {movie.type === 'movie' && versions && (
              <div className="mt-4 flex items-center gap-2.5">
                <span className="text-[12px] p-faint">Version</span>
                <VersionSwitch pref={audioPref} options={versions} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── épisodes ── */}
      {movie.type === 'show' && seasons.length > 0 && (
        <section id="pure-eps" className="max-w-[1000px] mx-auto px-5 md:px-8 pt-10 md:pt-14">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="p-title text-[19px] md:text-[24px]">Épisodes</h2>
            <div className="flex items-center gap-2">
              {/* Toute la saison d'un coup — rageant quand ça manque. */}
              {season && episodes.length > 1 && (
                <button onClick={marquerSaisonVue} disabled={saisonVue}
                  title="Marquer toute la saison comme vue"
                  className="h-9 px-3 rounded-full text-[12.5px] font-medium bg-white/[0.08] text-white/75 hover:bg-white/[0.14] transition-colors inline-flex items-center gap-1.5 disabled:opacity-50">
                  <CheckCheck size={14} /> Saison vue
                </button>
              )}
              <VersionSwitch pref={audioPref} options={versions} />
              {seasons.length > 1 && (
              <PickerPure
                title="Choisir une saison"
                label="Saison"
                value={season || ''}
                options={seasons.map((s) => ({ value: s.id, label: seasonLabel(s) }))}
                onPick={pickSeason}
              />
              )}
            </div>
          </div>

          <div>
            {episodesAffiches.map((ep) => (
              <button key={ep.id} onClick={() => navigate(`/play/${ep.id}`)}
                className="w-full flex gap-3.5 md:gap-4 py-3.5 p-hair text-left group/ep">
                <div className="p-card w-[122px] md:w-[158px] aspect-video shrink-0">
                  {/* `still` = l'image 16:9 de l'épisode, au format du cadre :
                      elle s'affiche donc ENTIÈRE. Les replis restent des images
                      larges (jamais l'affiche 2:3, qui serait rognée). */}
                  <img src={ep.still || ep.backdrop || movie.backdrop} alt="" loading="lazy" decoding="async" />
                  <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/ep:opacity-100 transition-opacity bg-black/25">
                    <Play size={18} fill="white" />
                  </span>
                  {!watchedIds.has(ep.id) && progressMap[ep.id] > 0 && (
                    <span className="absolute bottom-0 inset-x-0 h-[3px] bg-white/20">
                      <span className="block h-full bg-white" style={{ width: `${Math.min(progressMap[ep.id], 100)}%` }} />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-medium truncate">{ep.index}. {ep.title}</p>
                    {watchedIds.has(ep.id) && <Check size={13} strokeWidth={3} className="text-white/45 shrink-0" />}
                  </div>
                  {ep.duration && <p className="text-[11.5px] p-faint mt-0.5">{ep.duration}</p>}
                  <p className="text-[12.5px] p-dim leading-snug line-clamp-2 mt-1">{ep.description || ''}</p>
                </div>
              </button>
            ))}
            {episodes.length === 0 && <p className="text-[13px] p-faint py-6">Chargement…</p>}
          </div>

          {/* La suite de la saison, pas encore diffusée */}
          <UpcomingEpisodes
            ratingKey={movie.id}
            season={(seasons.find((x) => x.id === season) || {}).index}
            fallbackImage={movie.backdrop}
            mode={enVf ? 'vf' : 'vo'}
            offset={epVersions ? epVersions.offset || 0 : 0}
            have={enVf ? epVersions.vf : null}
          />

          {bonusEpisodes.length > 0 && (
            <div className="mt-8">
              <h3 className="p-label mb-3">Bonus</h3>
              {bonusEpisodes.map((ep) => (
                <button key={ep.id} onClick={() => navigate(`/play/${ep.id}`)}
                  className="w-full flex items-center gap-3.5 py-3 p-hair text-left group/b">
                  <div className="p-card w-[92px] md:w-[120px] aspect-video shrink-0">
                    {/* `still` = l'image 16:9 de l'épisode, au format du cadre :
                      elle s'affiche donc ENTIÈRE. Les replis restent des images
                      larges (jamais l'affiche 2:3, qui serait rognée). */}
                  <img src={ep.still || ep.backdrop || movie.backdrop} alt="" loading="lazy" decoding="async" />
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/b:opacity-100 transition-opacity bg-black/25">
                      <Play size={16} fill="white" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium truncate">
                      {/^episode\s*\d+$/i.test(ep.title || '') ? 'Contenus bonus' : ep.title}
                    </p>
                    <p className="text-[11.5px] p-faint mt-0.5">
                      Bandes-annonces, génériques{ep.duration ? ` · ${ep.duration}` : ''}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── distribution ── */}
      {movie.cast?.length > 0 && (
        <section className="pt-10 md:pt-14">
          <h2 className="p-title text-[19px] md:text-[24px] px-5 md:px-8 mb-4">Distribution</h2>
          <div className="p-rail p-marge gap-5 px-5 md:px-8">
            {movie.cast.map((a) => (
              <button key={a.id} onClick={() => navigate(`/actor/${encodeURIComponent(a.name)}`)} className="shrink-0 w-[76px] md:w-[88px] group/a">
                <div className="relative w-[76px] h-[76px] md:w-[88px] md:h-[88px] rounded-full overflow-hidden bg-white/[0.07]">
                  <span className="absolute inset-0 flex items-center justify-center text-white/25 text-lg font-medium">{a.name?.charAt(0)}</span>
                  {a.thumb && <img src={a.thumb} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />}
                </div>
                <p className="text-[11.5px] font-medium text-center text-white/80 truncate mt-2">{a.name}</p>
                <p className="text-[10.5px] p-faint text-center truncate">{a.character}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── la saga, quand le film en fait partie ── */}
      {movie.type === 'movie' && <SagaRow ratingKey={movie.id} />}

      {/* ── recommandations ── */}
      {similar.length > 0 && (
        <div className="pt-10 md:pt-14">
          <RowPure title="À voir ensuite" items={similar} watchedIds={watchedIds} />
        </div>
      )}

      {/* résumé en grand */}
      <AnimatePresence>
        {full && desc && (
          <SynopsisPure title={movie.title} text={desc} meta={meta.join('  ·  ')} onClose={() => setFull(false)} />
        )}
      </AnimatePresence>

      {/* bande-annonce */}
      <AnimatePresence>
        {trailer && movie.trailer && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex items-center justify-center px-4">
            <button onClick={() => setTrailer(false)} aria-label="Fermer"
              className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/85 hover:bg-white/20 transition-colors">
              <X size={19} />
            </button>
            <div className="w-full max-w-5xl rounded-xl overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
              <iframe src={`https://www.youtube.com/embed/${movie.trailer}?autoplay=1&rel=0`} title="Bande-annonce"
                className="w-full h-full" allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
