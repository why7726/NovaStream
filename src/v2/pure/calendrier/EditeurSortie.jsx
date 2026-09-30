import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Loader2, FolderPlus } from 'lucide-react';
import { api } from '../setup/api';
import { Champ, Bouton, Message } from '../setup/ui';
import requestService from '../../lib/requestService';
import { versChamp, depuisChamp, LANGUES } from './temps';

/* Programmer (ou modifier) une sortie.
   1. On choisit le titre (recherche TMDB), puis l'épisode pour une série.
   2. Nova pré-remplit la VO (heure exacte si Sonarr connaît la série,
      sinon la date TMDB) et, pour un film, la VF d'après la sortie
      numérique française. Tout reste modifiable.
   3. On choisit le dossier : ceux que Sonarr/Radarr connaissent déjà, ou
      un nouveau — ajouté chez eux par Nova. */

const VERSIONS = [
  { id: 'vo', nom: 'VO', aide: 'Version originale' },
  { id: 'vf', nom: 'VF', aide: 'Version française' },
  { id: 'va', nom: 'VA', aide: 'Version anglaise' },
];

export default function EditeurSortie({ existante, onFerme, onEnregistre }) {
  const modif = !!existante;
  const [kind, setKind] = useState(existante?.kind || 'series');
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [cherche, setCherche] = useState(false);
  const [titre, setTitre] = useState(null);         // résultat choisi
  const [info, setInfo] = useState(null);           // pré-remplissage serveur
  const [saison, setSaison] = useState(existante?.saison ?? '');
  const [episode, setEpisode] = useState(existante?.episode ?? '');
  const [dates, setDates] = useState(() => {
    const d = { vo: '', vf: '', va: '' };
    for (const v of existante?.versions || []) d[v.langue] = versChamp(v.quand);
    return d;
  });
  const [actives, setActives] = useState(() => {
    if (!existante) return { vo: true, vf: true, va: false };
    const a = { vo: false, vf: false, va: false };
    for (const v of existante.versions || []) a[v.langue] = true;
    return a;
  });
  const [dossiers, setDossiers] = useState([]);
  const [dossier, setDossier] = useState(existante?.dossier || '');
  const [nouveau, setNouveau] = useState(null);     // null | '' | chemin en cours de saisie
  const [chargement, setChargement] = useState(false);
  const [msg, setMsg] = useState(null);
  const minuteur = useRef(null);

  // Recherche TMDB (films et séries), filtrée sur le type choisi.
  useEffect(() => {
    if (modif) return;
    clearTimeout(minuteur.current);
    if (q.trim().length < 2) { setResultats([]); return; }
    minuteur.current = setTimeout(async () => {
      setCherche(true);
      const r = await requestService.search(q.trim()).catch(() => []);
      setResultats(r.filter((x) => (kind === 'movie' ? x.type === 'movie' : x.type === 'tv')).slice(0, 8));
      setCherche(false);
    }, 350);
    return () => clearTimeout(minuteur.current);
  }, [q, kind, modif]);

  // Dossiers connus de Sonarr (séries) / Radarr (films).
  const chargerDossiers = async () => {
    try {
      const d = await api(`/api/admin/arr/dossiers?kind=${kind}`);
      setDossiers(d.dossiers || []);
      return d.dossiers || [];
    } catch (e) { setMsg({ ok: false, texte: e.message }); return []; }
  };
  useEffect(() => { if (!modif) chargerDossiers(); }, [kind, modif]);

  // Pré-remplissage à la sélection d'un titre (et au changement d'épisode).
  const preremplir = async (t, sa, ep) => {
    setChargement(true); setMsg(null);
    try {
      const p = new URLSearchParams({ kind, tmdbId: t.tmdbId });
      if (sa !== '' && sa != null) p.set('saison', sa);
      if (ep !== '' && ep != null) p.set('episode', ep);
      const d = await api(`/api/admin/calendrier/preremplir?${p}`);
      setInfo(d);
      if (kind === 'series') { setSaison(d.saison); setEpisode(d.episode); }
      const heure = kind === 'movie' ? '09:00' : '18:00';
      setDates({
        vo: versChamp(d.versions.vo.quand, d.heureConnue ? null : heure),
        vf: versChamp(d.versions.vf.quand, heure),
        va: d.vaMasquee ? '' : versChamp(d.versions.va.quand, heure),
      });
      setActives({ vo: true, vf: true, va: !d.vaMasquee && !!d.versions.va.quand });
      // Dossier : celui de la série si elle est déjà dans Sonarr, sinon un dossier « animés » pour un animé.
      const liste = dossiers.length ? dossiers : await chargerDossiers();
      const conseil = d.dossierActuel
        || (d.isAnime && liste.find((x) => /anim/i.test(x.path))?.path)
        || (kind === 'series' && liste.find((x) => /s[ée]rie/i.test(x.path))?.path)
        || liste[0]?.path || '';
      setDossier(conseil);
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
    finally { setChargement(false); }
  };

  const choisir = (t) => { setTitre(t); setResultats([]); setQ(''); preremplir(t, '', ''); };

  const ajouterDossier = async () => {
    try {
      const d = await api('/api/admin/arr/dossiers', { method: 'POST', body: { kind, path: nouveau } });
      await chargerDossiers();
      setDossier(d.path); setNouveau(null);
      setMsg({ ok: true, texte: `Dossier ajouté dans ${kind === 'movie' ? 'Radarr' : 'Sonarr'} : ${d.path}` });
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
  };

  // VA masquée quand la VO est déjà en anglais (connu au pré-remplissage).
  const vaMasquee = !modif && !!info?.vaMasquee;
  const versions = VERSIONS
    .filter((v) => !(v.id === 'va' && vaMasquee))
    .filter((v) => actives[v.id])
    .map((v) => ({ langue: v.id, quand: depuisChamp(dates[v.id]) }))
    .filter((v) => v.quand);

  const enregistrer = async () => {
    setChargement(true); setMsg(null);
    try {
      if (modif) {
        await api(`/api/admin/calendrier/${existante.id}`, { method: 'PUT', body: { versions } });
      } else {
        await api('/api/admin/calendrier', {
          method: 'POST',
          body: {
            kind, tmdbId: info.tmdbId, tvdbId: info.tvdbId, titre: info.titre, annee: info.annee, poster: info.poster,
            isAnime: info.isAnime, saison, episode, dossier, versions,
          },
        });
      }
      onEnregistre();
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
    finally { setChargement(false); }
  };

  const nomVo = info?.langueOrigine ? `VO · ${LANGUES[info.langueOrigine] || info.langueOrigine}` : 'VO';
  const pret = (modif || (info && (kind === 'movie' || (saison !== '' && episode !== '')))) && versions.length > 0;

  return createPortal(
    <div className="nova-v2 nova-pure fixed inset-0 z-[120] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onFerme}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-[620px] max-h-[92vh] overflow-y-auto rounded-t-[26px] md:rounded-[26px] bg-[#111113] border border-white/[0.08] p-5 md:p-7">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em]">{modif ? 'Modifier les dates' : 'Programmer une sortie'}</h2>
          <button onClick={onFerme} aria-label="Fermer" className="w-9 h-9 rounded-full hover:bg-white/[0.08] flex items-center justify-center text-white/60"><X size={18} /></button>
        </div>

        {/* 1. Le titre */}
        {!modif && !info && (
          <>
            <div className="inline-flex p-1 rounded-full bg-white/[0.06] mb-4">
              {[['series', 'Série / animé'], ['movie', 'Film']].map(([k, n]) => (
                <button key={k} onClick={() => { setKind(k); setResultats([]); }}
                  className={`h-8 px-4 rounded-full text-[13px] font-semibold transition-colors ${kind === k ? 'bg-white text-black' : 'text-white/60'}`}>{n}</button>
              ))}
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'movie' ? 'Titre du film…' : 'Titre de la série ou de l\'animé…'}
                className="w-full h-11 bg-black/25 border border-white/[0.08] rounded-xl pl-10 pr-10 text-[14px] outline-none focus:border-white/25" />
              {cherche && <Loader2 size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-white/40" />}
            </div>
            <div className="mt-2 space-y-1">
              {resultats.map((r) => (
                <button key={r.tmdbId} onClick={() => choisir(r)} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.06] text-left">
                  {r.poster ? <img src={r.poster} alt="" className="w-9 h-[54px] rounded-md object-cover" /> : <span className="w-9 h-[54px] rounded-md bg-white/10" />}
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium truncate">{r.title}</span>
                    <span className="block text-[12px] text-white/40">{r.year || ''}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {(modif || info || titre) && (
          <div className="flex items-center gap-3 mb-5">
            {(info?.poster || existante?.poster || titre?.poster) && (
              <img src={info?.poster || existante?.poster || titre?.poster} alt="" className="w-12 h-[72px] rounded-lg object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold truncate">{info?.titre || existante?.titre || titre?.title}</p>
              <p className="text-[12.5px] text-white/45">
                {(info?.annee || existante?.annee || titre?.year) || ''}{kind === 'series' ? ' · série' : ' · film'}
                {existante?.dossier ? ` · ${existante.dossier}` : ''}
              </p>
            </div>
            {!modif && info && <Bouton variante="discret" onClick={() => { setInfo(null); setTitre(null); }}>Changer</Bouton>}
          </div>
        )}

        {chargement && !info && !modif && titre && (
          <p className="flex items-center gap-2 text-[13px] text-white/45 mb-4"><Loader2 size={15} className="animate-spin" /> Recherche des dates…</p>
        )}

        {/* 2. L'épisode (séries) */}
        {!modif && info && kind === 'series' && (
          <div className="grid grid-cols-2 gap-3 mb-5">
            <Champ label="Saison" valeur={String(saison)} onChange={setSaison} />
            <Champ label="Épisode" valeur={String(episode)} onChange={setEpisode} />
            <div className="col-span-2 -mt-1">
              <Bouton variante="doux" onClick={() => preremplir(titre || { tmdbId: info.tmdbId }, saison, episode)} disabled={chargement}>Recalculer les dates pour cet épisode</Bouton>
            </div>
          </div>
        )}

        {/* 3. Les versions */}
        {(modif || info) && (
          <div className="space-y-2.5 mb-5">
            <p className="text-[12px] font-medium text-white/55">Sorties (heure de ton appareil)</p>
            {VERSIONS.filter((v) => !(v.id === 'va' && vaMasquee)).map((v) => (
              <div key={v.id} className={`flex items-center gap-3 p-3 rounded-2xl ${actives[v.id] ? 'bg-white/[0.05]' : 'bg-white/[0.02]'}`}>
                <label className="flex items-center gap-2.5 w-[132px] shrink-0 cursor-pointer select-none">
                  <input type="checkbox" checked={!!actives[v.id]} onChange={(e) => setActives({ ...actives, [v.id]: e.target.checked })} className="accent-white w-4 h-4" />
                  <span className="text-[13.5px] font-semibold">{v.id === 'vo' ? nomVo : v.nom}</span>
                </label>
                <input type="datetime-local" value={dates[v.id]} disabled={!actives[v.id]}
                  onChange={(e) => setDates({ ...dates, [v.id]: e.target.value })}
                  className="flex-1 min-w-0 h-10 bg-black/25 border border-white/[0.08] rounded-xl px-3 text-[13.5px] text-white [color-scheme:dark] disabled:opacity-30 outline-none focus:border-white/25" />
              </div>
            ))}
            {info && !info.heureConnue && kind === 'series' && (
              <p className="text-[11.5px] text-white/35">Heure de la VO indicative : Sonarr ne connaît pas encore cette série, seule la date vient de TMDB.</p>
            )}
            {info?.vaMasquee && <p className="text-[11.5px] text-white/35">Pas de VA : la version originale est déjà en anglais.</p>}
          </div>
        )}

        {/* 4. Le dossier */}
        {!modif && info && (
          <div className="mb-5">
            <p className="text-[12px] font-medium text-white/55 mb-1.5">Dossier d'installation ({kind === 'movie' ? 'vu par Radarr' : 'vu par Sonarr'})</p>
            {nouveau === null ? (
              <div className="flex gap-2">
                <select value={dossier} onChange={(e) => setDossier(e.target.value)}
                  className="flex-1 min-w-0 h-11 bg-black/25 border border-white/[0.08] rounded-xl px-3 text-[13.5px] text-white outline-none">
                  {dossier && !dossiers.some((d) => d.path === dossier) && <option value={dossier}>{dossier}</option>}
                  {dossiers.map((d) => <option key={d.path} value={d.path}>{d.path}{d.libreGo != null ? ` — ${d.libreGo} Go libres` : ''}</option>)}
                </select>
                <button onClick={() => setNouveau('')} title="Nouveau dossier"
                  className="h-11 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.13] flex items-center gap-2 text-[13px] font-semibold shrink-0">
                  <FolderPlus size={16} /> Nouveau
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Champ label="Chemin du nouveau dossier" placeholder={kind === 'movie' ? '/data/Films 4K' : '/data/Animés'}
                  valeur={nouveau} onChange={setNouveau}
                  note={`Le chemin tel que ${kind === 'movie' ? 'Radarr' : 'Sonarr'} le voit (en Docker, celui du conteneur). Le dossier doit déjà exister.`} />
                <div className="flex gap-2">
                  <Bouton onClick={ajouterDossier} disabled={!nouveau?.trim()}>Ajouter</Bouton>
                  <Bouton variante="discret" onClick={() => setNouveau(null)}>Annuler</Bouton>
                </div>
              </div>
            )}
          </div>
        )}

        {msg && <Message ok={msg.ok} className="mb-4">{msg.texte}</Message>}

        {(modif || info) && (
          <div className="flex items-center gap-2">
            <Bouton onClick={enregistrer} disabled={!pret || chargement}>{chargement ? '…' : modif ? 'Enregistrer' : 'Programmer'}</Bouton>
            <Bouton variante="discret" onClick={onFerme}>Annuler</Bouton>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
