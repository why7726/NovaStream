import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Plus, Search, Pencil, Trash2, Check, Loader2, Clock, AlertCircle } from 'lucide-react';
import { api } from '../setup/api';
import { useFeatures } from '../../lib/features';
import Indisponible from '../Indisponible';
import EditeurSortie from './EditeurSortie';
import { lisible, relatif } from './temps';

/* Calendrier des sorties (administrateur).
   Un épisode ou un film programmé, et pour chaque version (VO, VF, VA)
   son heure de sortie et où en est la recherche. À l'heure dite, Nova
   demande à Sonarr/Radarr de chercher — leurs profils choisissent le
   fichier — et relance tant que la version n'est pas arrivée. */

const NOM = { vo: 'VO', vf: 'VF', va: 'VA' };
const ORDRE = { vo: 0, vf: 1, va: 2 };

function Etat({ v }) {
  const futur = Date.parse(v.quand) > Date.now();
  if (v.etat === 'trouve') {
    return <span className="inline-flex items-center gap-1 text-emerald-300/90"><Check size={12} strokeWidth={3} /> disponible</span>;
  }
  if (v.etat === 'echec') {
    return <span className="inline-flex items-center gap-1 text-red-300/80"><AlertCircle size={12} /> introuvable</span>;
  }
  if (futur) return <span className="text-white/40">{relatif(v.quand)}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-amber-200/80" title={v.detail || ''}>
      <Loader2 size={12} className="animate-spin" /> recherche{v.essais ? ` · ${v.essais} essai${v.essais > 1 ? 's' : ''}` : ''}
    </span>
  );
}

function Carte({ s, onModifier, onSupprimer, onChercher }) {
  const [occupe, setOccupe] = useState(false);
  const versions = [...s.versions].sort((a, b) => ORDRE[a.langue] - ORDRE[b.langue]);
  const ep = s.kind === 'series' && s.saison != null ? `S${String(s.saison).padStart(2, '0')}E${String(s.episode).padStart(2, '0')}` : 'Film';
  return (
    <div className="flex gap-4 p-4 rounded-[20px] bg-white/[0.035] border border-white/[0.06]">
      {s.poster ? <img src={s.poster} alt="" className="w-[58px] h-[87px] rounded-xl object-cover shrink-0" /> : <span className="w-[58px] h-[87px] rounded-xl bg-white/10 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold truncate">{s.titre}</p>
            <p className="text-[12px] text-white/40 truncate">{ep}{s.dossier ? ` · ${s.dossier}` : ''}</p>
          </div>
          <div className="flex items-center shrink-0 -mr-1.5 -mt-1">
            <button title="Chercher maintenant" disabled={occupe} onClick={async () => { setOccupe(true); await onChercher(s); setOccupe(false); }}
              className="w-8 h-8 rounded-full hover:bg-white/[0.08] flex items-center justify-center text-white/55 hover:text-white disabled:opacity-40">
              {occupe ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            </button>
            <button title="Modifier les dates" onClick={() => onModifier(s)} className="w-8 h-8 rounded-full hover:bg-white/[0.08] flex items-center justify-center text-white/55 hover:text-white"><Pencil size={15} /></button>
            <button title="Supprimer" onClick={() => onSupprimer(s)} className="w-8 h-8 rounded-full hover:bg-white/[0.08] flex items-center justify-center text-white/55 hover:text-red-300"><Trash2 size={15} /></button>
          </div>
        </div>
        <div className="mt-2.5 space-y-1.5">
          {versions.map((v) => (
            <div key={v.id} className="flex items-center gap-3 text-[12.5px]">
              <span className="w-8 font-semibold text-white/80">{NOM[v.langue]}</span>
              <span className="text-white/60 w-[140px] shrink-0">{lisible(v.quand)}</span>
              <span className="truncate"><Etat v={v} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CalendrierPure() {
  const features = useFeatures();
  const [sorties, setSorties] = useState(null);
  const [editeur, setEditeur] = useState(null);    // null | 'nouveau' | sortie
  const [erreur, setErreur] = useState('');

  const charger = useCallback(() => {
    api('/api/admin/calendrier').then((d) => setSorties(d.sorties)).catch((e) => setErreur(e.message));
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    charger();
    const t = setInterval(charger, 30000);   // l'état des recherches avance tout seul
    return () => clearInterval(t);
  }, [charger]);

  const chercher = async (s) => { await api(`/api/admin/calendrier/${s.id}/chercher`, { method: 'POST' }).catch(() => {}); charger(); };
  const supprimer = async (s) => {
    // Supprimer ne touche ni Sonarr/Radarr ni les fichiers : on arrête juste de surveiller.
    await api(`/api/admin/calendrier/${s.id}`, { method: 'DELETE' }).catch(() => {});
    charger();
  };

  // En cours / à venir d'abord (par prochaine date), puis terminées.
  const prochaine = (s) => Math.min(...s.versions.filter((v) => v.etat !== 'trouve').map((v) => Date.parse(v.quand)), Infinity);
  const actives = (sorties || []).filter((s) => s.versions.some((v) => v.etat !== 'trouve')).sort((a, b) => prochaine(a) - prochaine(b));
  const finies = (sorties || []).filter((s) => s.versions.length && s.versions.every((v) => v.etat === 'trouve'));

  return (
    <div className="max-w-[860px] mx-auto px-4 md:px-8 pt-24 md:pt-28 pb-32">
      <div className="flex items-end justify-between gap-4 mb-2">
        <h1 className="text-[28px] md:text-[34px] font-semibold tracking-[-0.035em] flex items-center gap-3">
          <CalendarClock size={28} className="text-white/60" /> Calendrier des sorties
        </h1>
        {features?.arr && (
          <button onClick={() => setEditeur('nouveau')}
            className="shrink-0 h-10 px-4 rounded-full bg-white text-black text-[13.5px] font-semibold flex items-center gap-1.5 hover:opacity-90">
            <Plus size={16} strokeWidth={2.6} /> <span className="hidden sm:inline">Programmer</span>
          </button>
        )}
      </div>
      <p className="text-[14px] text-white/50 mb-8 max-w-xl leading-relaxed">
        À l'heure de sortie de chaque version, Nova demande à Sonarr ou Radarr de chercher, puis relance jusqu'à ce qu'elle arrive. Tu es prévenu dès qu'elle est disponible.
      </p>

      {features && !features.arr && <Indisponible feature="arr" />}
      {erreur && <p className="text-[13px] text-red-300/80">{erreur}</p>}
      {features?.arr && !sorties && !erreur && <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-white/40" /></div>}

      {features?.arr && sorties && !sorties.length && (
        <div className="rounded-[22px] border border-dashed border-white/10 p-10 text-center">
          <Clock size={26} className="mx-auto text-white/30 mb-3" />
          <p className="text-[14px] text-white/55">Rien de programmé pour l'instant.</p>
          <button onClick={() => setEditeur('nouveau')} className="mt-4 h-9 px-4 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[13px] font-semibold">Programmer une sortie</button>
        </div>
      )}

      {actives.length > 0 && (
        <section className="space-y-3 mb-10">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-white/35 px-1">À venir et en cours</h2>
          {actives.map((s) => <Carte key={s.id} s={s} onModifier={setEditeur} onSupprimer={supprimer} onChercher={chercher} />)}
        </section>
      )}
      {finies.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-white/35 px-1">Disponibles</h2>
          {finies.map((s) => <Carte key={s.id} s={s} onModifier={setEditeur} onSupprimer={supprimer} onChercher={chercher} />)}
        </section>
      )}

      {editeur && (
        <EditeurSortie existante={editeur === 'nouveau' ? null : editeur}
          onFerme={() => setEditeur(null)}
          onEnregistre={() => { setEditeur(null); charger(); }} />
      )}
    </div>
  );
}
