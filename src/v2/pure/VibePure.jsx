import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Loader2, Play, Plus, ArrowUp, ChevronDown, Check } from 'lucide-react';
import authService from '../../services/authService';
import plexService from '../../services/plexService';
import RequestDetailModal from '../components/RequestDetailModal';
import requestService from '../lib/requestService';
import { useFeatures } from '../lib/features';
import Indisponible from './Indisponible';

/* « Dis-moi ta soirée » — de l'humeur vers un film.

   Parti pris : l'assistant reste INVISIBLE. Pas de bulle de conversation,
   pas de « je pense que… » : un champ, puis des cartes comme partout
   ailleurs sur Nova. La seule chose qu'on garde de lui, c'est une phrase
   par titre expliquant pourquoi il colle à l'humeur. */

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

const AMORCES = [
  'Fatigué, rien de compliqué',
  'Envie de rire',
  'Envie d\'avoir peur',
  'À deux',
  'Entre potes',
  'Un truc beau et lent',
];

export default function VibePure({ compact = false }) {
  const navigate = useNavigate();
  const [humeur, setHumeur] = useState('');
  const [etat, setEtat] = useState('repos');     // repos | cherche | ok | erreur
  const [erreur, setErreur] = useState('');
  const [res, setRes] = useState(null);
  const [aDemander, setADemander] = useState(null);   // titre ouvert dans la modale
  const [etape, setEtape] = useState('');
  const champ = useRef(null);

  // Demandes groupées : liste dépliée, titres déjà envoyés, envoi en cours
  const [listeOuverte, setListeOuverte] = useState(false);
  const [demandes, setDemandes] = useState(new Set());
  const [envoiTout, setEnvoiTout] = useState(false);
  const [motTout, setMotTout] = useState('');

  const features = useFeatures();
  const clef = (x) => `${x.type}:${x.tmdbId}`;
  const restants = (res?.aDemander || []).filter((x) => !demandes.has(clef(x)));
  const toutEnvoye = !!res?.aDemander?.length && restants.length === 0;

  const demanderUn = async (x) => {
    if (demandes.has(clef(x))) return;
    try {
      await requestService.create({ tmdbId: x.tmdbId, mediaType: x.type, title: x.title, year: x.year, poster: x.poster });
      setDemandes((s) => new Set(s).add(clef(x)));
    } catch (e) {
      setMotTout(e.message || 'Demande impossible');
    }
  };

  /* Tout demander : on envoie un par un (le serveur lance une recherche
     Radarr/Sonarr à chaque fois — les paralléliser le noierait) et on ne
     s'arrête pas au premier échec. */
  const demanderTout = async () => {
    if (envoiTout || !restants.length) return;
    setEnvoiTout(true); setMotTout('');
    let ok = 0, rate = 0;
    for (const x of restants) {
      try {
        await requestService.create({ tmdbId: x.tmdbId, mediaType: x.type, title: x.title, year: x.year, poster: x.poster });
        setDemandes((s) => new Set(s).add(clef(x)));
        ok++;
      } catch { rate++; }
    }
    setEnvoiTout(false);
    setMotTout(rate
      ? `${ok} demande${ok > 1 ? 's' : ''} envoyée${ok > 1 ? 's' : ''}, ${rate} en échec.`
      : `${ok} demande${ok > 1 ? 's' : ''} envoyée${ok > 1 ? 's' : ''} — tu seras prévenu quand c'est prêt.`);
  };

  // Nouvelle recherche → on repart d'une liste propre
  useEffect(() => { setDemandes(new Set()); setListeOuverte(false); setMotTout(''); }, [res]);

  // Messages d'attente : ils décrivent ce qui se passe vraiment, dans l'ordre.
  useEffect(() => {
    if (etat !== 'cherche') return;
    const etapes = [
      'On lit ta bibliothèque…',
      'On cherche ce qui colle à ton humeur…',
      'On vérifie que tout existe bien…',
    ];
    let i = 0;
    setEtape(etapes[0]);
    const t = setInterval(() => { i = Math.min(i + 1, etapes.length - 1); setEtape(etapes[i]); }, 4000);
    return () => clearInterval(t);
  }, [etat]);

  const chercher = async (texte) => {
    const q = (texte ?? humeur).trim();
    if (q.length < 2 || etat === 'cherche') return;
    setHumeur(q); setEtat('cherche'); setErreur(''); setRes(null);
    try {
      const t = authService.getToken();
      const r = await fetch(`${apiBase()}/api/vibe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ humeur: q }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Indisponible');
      setRes(d); setEtat('ok');
    } catch (e) {
      setErreur(e.message); setEtat('erreur');
    }
  };

  /* Sans clé Gemini : l'administrateur voit comment l'activer, les autres ne
     voient rien — une fonction qu'ils n'ont jamais eue n'a pas à s'excuser. */
  if (features && !features.assistant) {
    if (!authService.getUser()?.isAdmin) return null;
    return (
      <section className={compact ? '' : 'mb-10'}>
        <div className="flex items-center gap-2.5 mb-3">
          <Sparkles size={18} className="text-white/55" />
          <h2 className="p-title text-[17px] md:text-[20px]">Dis-moi ta soirée</h2>
        </div>
        <Indisponible feature="assistant" className="max-w-xl" />
      </section>
    );
  }

  return (
    <section className={compact ? '' : 'mb-10'}>
      {!compact && (
        <div className="flex items-center gap-2.5 mb-1.5">
          <Sparkles size={18} className="text-white/55" />
          <h2 className="p-title text-[17px] md:text-[20px]">Dis-moi ta soirée</h2>
        </div>
      )}
      <p className="text-[13px] p-dim mb-3.5">
        Ton humeur, ta journée, avec qui tu es — et on te propose quelque chose.
      </p>

      <div className="relative max-w-xl">
        <input
          ref={champ}
          value={humeur}
          onChange={(e) => setHumeur(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && chercher()}
          placeholder="Journée pourrie, envie de rien de compliqué…"
          className="w-full h-[52px] bg-white/[0.06] border border-white/10 rounded-2xl pl-4 pr-14 text-[14.5px] outline-none focus:border-white/30 transition-colors"
        />
        <button onClick={() => chercher()} disabled={humeur.trim().length < 2 || etat === 'cherche'}
          aria-label="Proposer"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white text-black flex items-center justify-center disabled:opacity-30 transition-opacity">
          {etat === 'cherche' ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {AMORCES.map((a) => (
          <button key={a} onClick={() => chercher(a)} disabled={etat === 'cherche'}
            className="h-8 px-3.5 rounded-full text-[12.5px] font-medium bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white transition-colors disabled:opacity-40">
            {a}
          </button>
        ))}
      </div>

      {/* La réponse prend une dizaine de secondes : un rond qui tourne seul
          donnerait l'impression que c'est cassé. On dit ce qui se passe. */}
      {etat === 'cherche' && (
        <p className="text-[13px] p-faint mt-5 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> {etape}
        </p>
      )}

      {etat === 'erreur' && (
        <p className="text-[13px] text-white/50 mt-5">{erreur}</p>
      )}

      {etat === 'ok' && res && (
        <div className="mt-6">
          {res.ambiance && <p className="text-[14px] text-white/70 mb-4 max-w-xl leading-relaxed">{res.ambiance}</p>}

          {res.surNova?.length > 0 && (
            <>
              <p className="p-label mb-2.5">À lancer maintenant</p>
              <div className="p-rail gap-3 md:gap-4 pb-1 -mx-1 px-1">
                {res.surNova.map((x) => (
                  <button key={x.id} onClick={() => navigate(`/title/${x.id}`)}
                    className="p-card-hit shrink-0 w-[150px] md:w-[176px] text-left group/v">
                    <div className="p-card aspect-[2/3]">
                      {x.thumbPath
                        ? <img src={plexService.getImageUrl(x.thumbPath, 'poster')} alt="" loading="lazy" />
                        : <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-white/40">{x.title}</span>}
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/v:opacity-100 transition-opacity bg-black/25">
                        <span className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center">
                          <Play size={14} fill="white" className="ml-0.5" />
                        </span>
                      </span>
                    </div>
                    <p className="text-[12.5px] font-medium text-white/85 truncate mt-2">{x.title}</p>
                    <p className="text-[11.5px] p-faint leading-snug mt-0.5 line-clamp-3">{x.pourquoi}</p>
                  </button>
                ))}
              </div>
            </>
          )}

          {res.surNova?.length === 0 && (
            <p className="text-[13px] p-dim mb-4">
              Rien dans ta bibliothèque ne colle vraiment à ça. Mais voilà des pistes :
            </p>
          )}

          {res.aDemander?.length > 0 && (
            <div className="mt-7">
              <div className="flex items-center gap-2 mb-2.5">
                <p className="p-label !mb-0">Pas encore sur Nova</p>
              </div>

              {/* Demander la sélection entière : le bouton déroule la liste,
                  le « + » à côté envoie tout d'un coup. Deux gestes distincts
                  pour deux intentions — regarder, ou faire confiance. */}
              <div className="flex items-stretch gap-1.5 mb-3.5">
                <button onClick={() => setListeOuverte((o) => !o)}
                  className="flex-1 md:flex-none h-10 px-4 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[13.5px] font-medium transition-colors inline-flex items-center justify-center gap-2">
                  Demander les titres conseillés
                  <ChevronDown size={15} className={`transition-transform ${listeOuverte ? 'rotate-180' : ''}`} />
                </button>
                <button onClick={demanderTout} disabled={toutEnvoye || envoiTout}
                  title={toutEnvoye ? 'Tout est demandé' : 'Tout demander d\'un coup'}
                  aria-label="Tout demander"
                  className="w-10 h-10 shrink-0 rounded-full bg-white text-black flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-40">
                  {envoiTout ? <Loader2 size={16} className="animate-spin" /> : toutEnvoye ? <Check size={16} /> : <Plus size={17} />}
                </button>
              </div>

              {listeOuverte && (
                <div className="mb-4 rounded-2xl border border-white/[0.09] overflow-hidden">
                  {res.aDemander.map((x, i) => {
                    const fait = demandes.has(`${x.type}:${x.tmdbId}`);
                    return (
                      <div key={`l-${x.tmdbId}`}
                        className={`flex items-center gap-3 px-3 py-2.5 ${i ? 'border-t border-white/[0.07]' : ''}`}>
                        {x.poster
                          ? <img src={x.poster} alt="" loading="lazy" className="w-9 h-[54px] rounded object-cover shrink-0" />
                          : <span className="w-9 h-[54px] rounded bg-white/[0.07] shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-white/85 truncate">
                            {x.title} <span className="text-white/35 font-normal">{x.year}</span>
                          </p>
                          <p className="text-[11.5px] p-faint leading-snug line-clamp-2 mt-0.5">{x.pourquoi}</p>
                        </div>
                        <button onClick={() => demanderUn(x)} disabled={fait}
                          aria-label={fait ? 'Déjà demandé' : `Demander ${x.title}`}
                          className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-colors ${
                            fait ? 'bg-white/[0.06] text-white/40' : 'bg-white/10 text-white hover:bg-white/20'
                          }`}>
                          {fait ? <Check size={14} /> : <Plus size={15} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {motTout && <p className="text-[12.5px] text-white/55 mb-3">{motTout}</p>}
              <div className="p-rail gap-3 md:gap-4 pb-1 -mx-1 px-1">
                {res.aDemander.map((x) => (
                  <button key={`${x.type}-${x.tmdbId}`} onClick={() => setADemander(x)}
                    className="p-card-hit shrink-0 w-[150px] md:w-[176px] text-left group/v">
                    <div className="p-card aspect-[2/3]">
                      {x.poster
                        ? <img src={x.poster} alt="" loading="lazy" />
                        : <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-white/40">{x.title}</span>}
                      <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center">
                        {demandes.has(`${x.type}:${x.tmdbId}`) ? <Check size={13} /> : <Plus size={14} />}
                      </span>
                    </div>
                    <p className="text-[12.5px] font-medium text-white/85 truncate mt-2">{x.title}</p>
                    <p className="text-[11.5px] p-faint leading-snug mt-0.5 line-clamp-3">{x.pourquoi}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {aDemander && (
        <RequestDetailModal item={aDemander} onClose={() => setADemander(null)} onRequested={() => {}} />
      )}
    </section>
  );
}
