import React, { useEffect, useState } from 'react';
import { Download, Check, X, Loader2 } from 'lucide-react';
import plexService from '../../services/plexService';
import authService from '../../services/authService';
import { getAudioPref, pickAudioStream } from '../lib/audioPref';
import { tr } from '../../i18n';

/* Télécharger pour regarder hors ligne — seulement dans l'application
   Android (window.novaDesktop.telecharger). Le serveur prépare le fichier
   dans la qualité choisie (voir telechargements.js), l'application le
   télécharge en arrière-plan et le lit sans connexion. */

export const peutTelecharger = () => typeof window !== 'undefined' && typeof window.novaDesktop?.telecharger === 'function';

// Mêmes débits que telechargements.js (vidéo + 160 kbit/s de son)
const QUALITES = [
  { id: 'original', libelle: tr('Originale'), detail: tr('Le fichier tel quel — meilleure qualité') },
  { id: '1080p', libelle: '1080p', detail: '8 Mbps', kbps: 8160 },
  { id: '720p-4', libelle: '720p', detail: '4 Mbps', kbps: 4160 },
  { id: '720p-2', libelle: '720p', detail: tr('2 Mbps — bon compromis'), kbps: 2160 },
  { id: '480p', libelle: '480p', detail: tr('1,5 Mbps — le plus léger'), kbps: 1660 },
];
const TEXTE = /^(srt|subrip|ass|ssa|webvtt|vtt|mov_text|text)$/i;

const enGo = (octets) => (octets >= 1e9 ? `${(octets / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(octets / 1e6))} Mo`);

/** Ce qui est déjà téléchargé (ou en cours) sur ce téléphone. */
export function useTelechargements() {
  const [liste, setListe] = useState([]);
  useEffect(() => {
    if (!peutTelecharger()) return undefined;
    let vivant = true;
    const lire = () => window.novaDesktop.telechargements().then((l) => { if (vivant) setListe(Array.isArray(l) ? l : []); }).catch(() => {});
    lire();
    const t = setInterval(lire, 4000);
    return () => { vivant = false; clearInterval(t); };
  }, []);
  return liste;
}

export function ChoixQualite({ mediaId, episodes = null, libelle = '', onFerme }) {
  const [media, setMedia] = useState(null);
  const [envoi, setEnvoi] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    const premier = mediaId || episodes?.[0]?.id;
    if (premier) plexService.getMetadata(premier).then(setMedia).catch(() => setMsg({ ok: false, texte: tr('Titre introuvable') }));
  }, [mediaId, episodes?.[0]?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Saison : tailles additionnées sur tous ses épisodes
  const liste = episodes && episodes.length ? episodes : null;
  const dureeS = liste ? liste.reduce((n, e) => n + (e.rawDuration || 0), 0) / 1000 : (media?.rawDuration ? media.rawDuration / 1000 : 0);
  const tailleOrig = liste ? liste.reduce((n, e) => n + (e.taille || 0), 0) : media?.taille;
  const taille = (q) => (q.id === 'original' ? tailleOrig || null : q.kbps && dureeS ? (q.kbps * 1000 * dureeS) / 8 : null);
  const [avance, setAvance] = useState(null);

  /** Envoie UN titre à l'application (sa fiche complète : pistes, sous-titres…). */
  const envoyerUn = async (media, q) => {
      const origine = window.location.origin;
      const audios = media.audioStreams || [];
      const audio = pickAudioStream(audios, getAudioPref());
      const subs = (media.subtitleStreams || []).filter((s) => TEXTE.test(s.codec || '') && !s.key).slice(0, 6);
      const choisi = (media.subtitleStreams || []).find((s) => s.selected);
      await window.novaDesktop.telecharger({
        mediaId: String(media.id),
        qualite: q.id,
        audioStreamId: audio?.id ?? null,
        // Version originale : les pistes restent DANS le fichier → n° de piste comme en lecture.
        aidOriginal: audio ? audios.indexOf(audio) + 1 : null,
        sidOriginal: choisi && !choisi.key ? (media.subtitleStreams || []).filter((s) => !s.key).indexOf(choisi) + 1 : 0,
        // Version préparée (MP4) : les sous-titres texte partent à côté du fichier.
        sousTitres: q.id === 'original' ? [] : subs.map((s) => ({
          url: `${origine}/api/subtitles/embedded/${media.id}/${s.id}`,
          langue: s.language || '', defaut: !!s.selected,
        })),
        titre: media.title,
        sousTitre: media.grandparentTitle ? `${media.grandparentTitle} · S${media.parentIndex ?? '?'}E${media.index ?? '?'}` : (media.year ? String(media.year) : ''),
        type: media.type,
        affiche: media.poster ? new URL(media.poster, origine).href : null,
        dureeMs: media.rawDuration || 0,
        jeton: authService.getToken(),
      });
  };

  const choisir = async (q) => {
    if (!media || envoi) return;
    setEnvoi(q.id); setMsg(null);
    try {
      if (liste) {
        for (let i = 0; i < liste.length; i++) {
          setAvance(`${i + 1} / ${liste.length}`);
          await envoyerUn(await plexService.getMetadata(liste[i].id), q);
        }
        setAvance(null);
      } else await envoyerUn(media, q);
      setMsg({ ok: true, texte: q.id === 'original' ? tr('Téléchargement lancé.') : tr('Ajouté : le serveur prépare le fichier, puis le téléchargement démarre tout seul.') });
      setTimeout(onFerme, 1600);
    } catch (e) {
      setMsg({ ok: false, texte: String(e?.message || e) });
    } finally { setEnvoi(null); }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/60" onClick={onFerme}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-[420px] rounded-t-3xl sm:rounded-3xl bg-[#141416] border border-white/10 p-5 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <p className="text-[17px] font-semibold">{tr('Télécharger')}</p>
            <p className="text-[12.5px] text-white/45 truncate">{liste ? libelle || tr('{0} épisodes', [liste.length]) : media ? media.title : tr('Chargement…')}</p>
          </div>
          <button onClick={onFerme} aria-label={tr('Fermer')} className="w-8 h-8 rounded-full hover:bg-white/[0.08] flex items-center justify-center text-white/60"><X size={17} /></button>
        </div>
        <p className="text-[12px] text-white/40 mb-4">{tr('Pour regarder sans connexion. Plus la qualité est basse, plus le fichier est léger.')}</p>
        <div className="space-y-1.5">
          {QUALITES.map((q) => {
            const t = taille(q);
            return (
              <button key={q.id} disabled={!media || !!envoi} onClick={() => choisir(q)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-50 text-left transition-colors">
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-medium">{q.libelle}</span>
                  <span className="block text-[12px] text-white/45">{q.detail}</span>
                </span>
                <span className="shrink-0 text-[12.5px] text-white/55 flex items-center gap-2">
                  {t ? `≈ ${enGo(t)}` : ''}
                  {envoi === q.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                </span>
              </button>
            );
          })}
        </div>
        {avance && <p className="mt-4 text-[13px] text-white/60">{tr('Ajout des épisodes… {0}', [avance])}</p>}
        {msg && <p className={`mt-4 text-[13px] ${msg.ok ? 'text-emerald-300/90' : 'text-red-300/90'}`}>{msg.texte}</p>}
      </div>
    </div>
  );
}

/** Bouton rond (fiche d'un film) ou petite icône (ligne d'épisode). */
export default function BoutonTelecharger({ mediaId, episodes = null, libelle = '', compact = false, telecharges = [] }) {
  const [ouvert, setOuvert] = useState(false);
  if (!peutTelecharger() || (!mediaId && !episodes?.length)) return null;
  // Saison : téléchargée quand tous ses épisodes le sont
  if (episodes?.length) {
    const faits = episodes.filter((e) => telecharges.some((x) => String(x.mediaId) === String(e.id))).length;
    return (
      <>
        <button onClick={() => (faits === episodes.length ? window.novaDesktop.ouvrirTelechargements() : setOuvert(true))}
          aria-label={tr('Télécharger')} title={tr('Télécharger la saison')} className="p-icon-btn">
          {faits === episodes.length ? <Check size={18} strokeWidth={2.6} /> : <Download size={18} />}
        </button>
        {ouvert && <ChoixQualite episodes={episodes.filter((e) => !telecharges.some((x) => String(x.mediaId) === String(e.id)))} libelle={libelle} onFerme={() => setOuvert(false)} />}
      </>
    );
  }
  const deja = telecharges.find((x) => String(x.mediaId) === String(mediaId));
  const ouvrir = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (deja?.etat === 'pret') window.novaDesktop.ouvrirTelechargements();
    else if (!deja) setOuvert(true);
  };
  const icone = deja?.etat === 'pret' ? <Check size={compact ? 15 : 18} strokeWidth={2.6} />
    : deja ? <Loader2 size={compact ? 15 : 18} className="animate-spin" /> : <Download size={compact ? 15 : 18} />;
  return (
    <>
      {compact ? (
        <span role="button" tabIndex={0} onClick={ouvrir} aria-label={tr('Télécharger')}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white/65 hover:text-white hover:bg-white/[0.08]">
          {icone}
        </span>
      ) : (
        <button onClick={ouvrir} aria-label={tr('Télécharger')} title={deja?.etat === 'pret' ? tr('Téléchargé') : tr('Télécharger')} className="p-icon-btn">
          {icone}
        </button>
      )}
      {ouvert && <ChoixQualite mediaId={mediaId} onFerme={() => setOuvert(false)} />}
    </>
  );
}
