import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Square, SkipForward, X, MonitorPlay } from 'lucide-react';
import plexService from '../../services/plexService';
import progressService from '../../services/progressService';
import activityService from '../../services/activityService';
import authService from '../../services/authService';
import { getAudioPref, pickAudioStream } from '../lib/audioPref';
import { tr } from '../../i18n';

/* Lecture dans l'application de bureau (Windows) : la vidéo s'ouvre dans
   mpv, le lecteur natif, sur le FICHIER d'origine — aucun transcodage. mpv
   décode tout (AV1, HEVC, HDR, DTS, TrueHD, sous-titres ASS) avec la carte
   graphique. Cette page reste derrière : elle enregistre la progression
   comme le lecteur web, puis enchaîne l'épisode suivant ou revient.

   `window.novaDesktop` n'existe que dans l'application (voir desktop/preload.js). */

export const estBureau = () => typeof window !== 'undefined' && !!window.novaDesktop;

const SUITE_SECONDES = 6;

export default function LecteurNatif({ surRepli }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [media, setMedia] = useState(null);
  const [etat, setEtat] = useState('chargement');   // chargement | lecture | suite | erreur
  const [erreur, setErreur] = useState('');
  const [suivant, setSuivant] = useState(null);
  const [compte, setCompte] = useState(SUITE_SECONDES);
  const position = useRef({ t: 0, d: 0 });

  const revenir = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(media?.grandparentRatingKey ? `/title/${media.grandparentRatingKey}` : `/title/${id}`, { replace: true });
  };

  useEffect(() => {
    let vivant = true;
    let desabonner = null;
    const enregistrer = (m, t, d) => {
      if (t > 0 && d > 0) progressService.saveProgress(id, t, d, { mediaTitle: m.title, mediaPoster: m.poster, mediaType: m.type });
    };

    (async () => {
      try {
        const m = await plexService.getMetadata(id);
        if (!vivant) return;
        // Saison ou série ouverte par erreur : vers la fiche
        if (m && !m.partKey && (m.type === 'season' || m.type === 'show')) {
          navigate(`/title/${m.type === 'show' ? m.id : (m.parentRatingKey || m.id)}`, { replace: true });
          return;
        }
        if (!m?.partKey) throw new Error(tr('Ce titre n\'a pas de fichier à lire.'));
        setMedia(m);
        activityService.log('play', id, m.title);

        const [progres, freres] = await Promise.all([
          progressService.getProgress(id),
          m.parentRatingKey ? plexService.getSiblingEpisodes(m.parentRatingKey, id).catch(() => ({})) : Promise.resolve({}),
        ]);
        if (!vivant) return;
        setSuivant(freres?.next || null);
        const precedent = freres?.prev || null;

        // Pistes : mpv les numérote à partir de 1, par type, dans l'ordre du fichier.
        const audios = m.audioStreams || [];
        const choix = pickAudioStream(audios, getAudioPref());
        const aid = choix ? audios.indexOf(choix) + 1 : 'auto';

        const origine = window.location.origin;
        const subs = m.subtitleStreams || [];
        const integres = subs.filter((s) => !s.key);
        const externes = subs.filter((s) => s.key);
        const selection = subs.find((s) => s.selected);
        let sid = 'no';
        if (selection) sid = selection.key ? integres.length + externes.indexOf(selection) + 1 : integres.indexOf(selection) + 1;

        const titre = m.grandparentTitle
          ? `${m.grandparentTitle} — S${m.parentIndex ?? '?'}E${m.index ?? '?'}${m.title ? ` · ${m.title}` : ''}`
          : m.title;
        const debut = progres && progres.currentTime > 10 && !progres.completed ? progres.currentTime : 0;
        position.current = { t: debut, d: m.rawDuration ? m.rawDuration / 1000 : 0 };

        let dernierEnvoi = 0;
        desabonner = window.novaDesktop.surProgression(({ position: t, duree: d }) => {
          position.current = { t, d };
          if (Date.now() - dernierEnvoi >= 10000) { dernierEnvoi = Date.now(); enregistrer(m, t, d); }
        });

        setEtat('lecture');
        const fin = await window.novaDesktop.lire({
          url: `${origine}/plex${m.partKey}`,
          jeton: authService.getToken(),
          titre, debut, aid, sid,
          // Le lecteur affiche « épisode précédent / suivant » seulement s'il y en a un
          aPrecedent: !!precedent, aSuivant: !!freres?.next,
          sousTitres: externes.map((s) => `${origine}/plex${s.key}`),
        });
        if (!vivant) return;
        desabonner?.(); desabonner = null;
        // Position finale : un titre fini est enregistré à sa durée complète.
        enregistrer(m, fin.fini ? fin.duree : fin.position, fin.duree);

        if (fin.precedent && precedent) navigate(`/play/${precedent.id}`, { replace: true });
        else if ((fin.suivant || fin.fini) && freres?.next) {
          if (fin.suivant) navigate(`/play/${freres.next.id}`, { replace: true });
          else setEtat('suite');
        } else revenir();
      } catch (e) {
        if (!vivant) return;
        setErreur(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
        setEtat('erreur');
      }
    })();

    return () => { vivant = false; desabonner?.(); window.novaDesktop?.arreter(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Fin d'un épisode : on enchaîne le suivant après un court compte à rebours.
  useEffect(() => {
    if (etat !== 'suite' || !suivant) return undefined;
    setCompte(SUITE_SECONDES);
    const t = setInterval(() => setCompte((c) => {
      if (c <= 1) { clearInterval(t); navigate(`/play/${suivant.id}`, { replace: true }); return 0; }
      return c - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [etat, suivant, navigate]);

  const fond = media?.backdrop || media?.poster;

  return (
    <div className="fixed inset-0 z-[200] bg-black text-white flex items-center justify-center overflow-hidden">
      {fond && <img src={fond} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 blur-2xl scale-110" />}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-black" />

      <div className="relative z-10 max-w-[560px] px-8 text-center">
        {etat === 'chargement' && <Loader2 size={30} className="mx-auto animate-spin text-white/60" />}

        {media && etat !== 'erreur' && (
          <>
            {media.grandparentTitle && <p className="text-[13px] font-medium text-white/50 mb-1">{media.grandparentTitle}</p>}
            <h1 className="text-[28px] font-semibold tracking-[-0.03em] leading-tight">{media.title}</h1>
          </>
        )}

        {etat === 'lecture' && (
          <>
            <p className="mt-4 text-[14px] text-white/55 flex items-center justify-center gap-2">
              <MonitorPlay size={16} /> {tr('Lecture dans le lecteur NovaStream')}
            </p>
            {window.novaDesktop?.plateforme === 'windows' && (
              <p className="mt-1.5 text-[12px] text-white/35">{tr('Retour ou Q pour revenir · N pour l\'épisode suivant')}</p>
            )}
            <button onClick={() => window.novaDesktop.arreter()}
              className="mt-8 h-[44px] px-6 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[14px] font-semibold inline-flex items-center gap-2 transition-colors">
              <Square size={14} /> {tr('Arrêter')}
            </button>
          </>
        )}

        {etat === 'suite' && suivant && (
          <>
            <p className="mt-6 text-[14px] text-white/55">{tr('Épisode suivant dans {0} s', [compte])}</p>
            <p className="mt-1 text-[16px] font-semibold">{suivant.title}</p>
            <div className="mt-7 flex gap-2.5 justify-center">
              <button onClick={() => navigate(`/play/${suivant.id}`, { replace: true })}
                className="h-[44px] px-6 rounded-full bg-white text-black text-[14px] font-semibold inline-flex items-center gap-2">
                <SkipForward size={15} /> {tr('Lire maintenant')}
              </button>
              <button onClick={revenir}
                className="h-[44px] px-6 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[14px] font-semibold inline-flex items-center gap-2">
                <X size={15} /> {tr('Annuler')}
              </button>
            </div>
          </>
        )}

        {etat === 'erreur' && (
          <>
            <h1 className="text-[22px] font-semibold">{tr('Lecture impossible')}</h1>
            <p className="mt-2 text-[13.5px] text-white/55">{erreur}</p>
            <div className="mt-7 flex gap-2.5 justify-center">
              {surRepli && (
                <button onClick={surRepli} className="h-[44px] px-6 rounded-full bg-white text-black text-[14px] font-semibold">
                  {tr('Lire dans la fenêtre')}
                </button>
              )}
              <button onClick={revenir} className="h-[44px] px-6 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[14px] font-semibold">
                {tr('Retour')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
