import React, { useEffect, useState } from 'react';
import { ChevronUp, ChevronDown, Film, Tv, Sparkles, Lock, Loader2 } from 'lucide-react';
import { api } from './api';
import { refreshLibraries, libraryKind } from '../../lib/libraries';
import { Carte, Bouton, Message } from './ui';

/* Quelles bibliothèques du serveur Nova montre, et comment.

   Deux cases par bibliothèque :
   · « Partagée » — décochée, elle devient PRIVÉE : films de famille, contenu
     adulte… Nova fait alors comme si elle n'existait pas (ni menu, ni
     recherche, ni recommandations, ni lien direct — c'est bloqué côté
     serveur, pas seulement caché).
   · « Dans le menu » — partagée mais sans onglet (on la trouve par la
     recherche et l'accueil). Utile pour une bibliothèque d'appoint.
   L'ordre est celui des onglets. */

const ICONES = { movie: Film, show: Tv, anime: Sparkles };

function Case({ coche, onChange, disabled, children }) {
  return (
    <label className={`inline-flex items-center gap-2 text-[12.5px] select-none ${disabled ? 'opacity-35' : 'cursor-pointer'}`}>
      <input type="checkbox" className="sr-only" checked={coche} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={`w-[18px] h-[18px] rounded-[6px] border flex items-center justify-center transition-colors ${coche ? 'bg-white border-white' : 'border-white/25'}`}>
        {coche && <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 6.2l2.6 2.6L10 3.4" stroke="#000" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      <span className="text-white/70">{children}</span>
    </label>
  );
}

export default function BibliothequesSection({ serveurRelie }) {
  const [libs, setLibs] = useState(null);      // [{ key, title, type, partagee, menu }]
  const [initial, setInitial] = useState('');
  const [msg, setMsg] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const charger = () => {
    api('/api/settings/libraries')
      .then((d) => { setLibs(d.libraries); setInitial(JSON.stringify(d.libraries)); })
      .catch((e) => { setLibs([]); setMsg({ ok: false, texte: e.message }); });
  };
  useEffect(() => { if (serveurRelie) charger(); }, [serveurRelie]);

  const maj = (key, patch) => setLibs((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const deplacer = (i, d) => setLibs((l) => {
    const n = [...l];
    const j = i + d;
    if (j < 0 || j >= n.length) return l;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const modifie = libs && JSON.stringify(libs) !== initial;

  const enregistrer = async () => {
    setEnvoi(true); setMsg(null);
    try {
      await api('/api/settings/libraries', {
        method: 'PUT',
        body: {
          ordre: libs.map((l) => l.key),
          exclues: libs.filter((l) => !l.partagee).map((l) => l.key),
          masquees: libs.filter((l) => l.partagee && !l.menu).map((l) => l.key),
        },
      });
      setInitial(JSON.stringify(libs));
      setMsg({ ok: true, texte: 'Enregistré — le menu est à jour.' });
      refreshLibraries();
    } catch (e) {
      setMsg({ ok: false, texte: e.message });
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Carte id="bibliotheques" titre="Bibliothèques"
      sousTitre="Coche celles que Nova peut montrer. Chaque bibliothèque partagée devient un onglet, sous le nom qu'elle porte sur ton serveur.">
      {!serveurRelie && <p className="text-[13px] text-white/40">Relie d'abord ton serveur.</p>}

      {serveurRelie && !libs && (
        <div className="flex items-center gap-2 text-[13px] text-white/40"><Loader2 size={15} className="animate-spin" /> Lecture du serveur…</div>
      )}

      {libs && libs.length > 0 && (
        <div className="space-y-2">
          {libs.map((l, i) => {
            const Icone = ICONES[libraryKind(l)] || Film;
            return (
              <div key={l.key} className={`flex items-center gap-3 p-3 md:p-3.5 rounded-2xl transition-colors ${l.partagee ? 'bg-white/[0.05]' : 'bg-white/[0.02]'}`}>
                <div className="flex flex-col">
                  <button onClick={() => deplacer(i, -1)} disabled={i === 0} aria-label="Monter" className="text-white/35 hover:text-white disabled:opacity-20"><ChevronUp size={16} /></button>
                  <button onClick={() => deplacer(i, 1)} disabled={i === libs.length - 1} aria-label="Descendre" className="text-white/35 hover:text-white disabled:opacity-20"><ChevronDown size={16} /></button>
                </div>
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${l.partagee ? 'bg-white/[0.08] text-white/70' : 'bg-white/[0.03] text-white/25'}`}>
                  {l.partagee ? <Icone size={17} /> : <Lock size={15} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[14px] font-medium truncate ${l.partagee ? '' : 'text-white/40'}`}>{l.title}</p>
                  <p className="text-[11.5px] text-white/35 mt-0.5">
                    {l.partagee ? (l.type === 'movie' ? 'Films' : 'Séries') : 'Privée — invisible sur Nova'}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 sm:gap-5 shrink-0">
                  <Case coche={l.partagee} onChange={(v) => maj(l.key, { partagee: v })}>Partagée</Case>
                  <Case coche={l.partagee && l.menu} disabled={!l.partagee} onChange={(v) => maj(l.key, { menu: v })}>Dans le menu</Case>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {libs && libs.length === 0 && serveurRelie && !msg && (
        <p className="text-[13px] text-white/40">Aucune bibliothèque de films ou de séries sur ce serveur.</p>
      )}

      {libs && libs.some((l) => !l.partagee) && (
        <p className="flex items-start gap-2 text-[12px] text-white/40 mt-4 leading-relaxed">
          <Lock size={13} className="shrink-0 mt-[2px]" />
          Une bibliothèque privée n'apparaît nulle part : ni menu, ni recherche, ni recommandations, ni historique — et ses titres sont bloqués par le serveur même avec un lien direct.
        </p>
      )}

      {libs && libs.length > 0 && (
        <div className="flex items-center gap-3 mt-5">
          <Bouton onClick={enregistrer} disabled={!modifie || envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
          {modifie && <Bouton variante="discret" onClick={() => setLibs(JSON.parse(initial))}>Annuler</Bouton>}
        </div>
      )}
      {msg && <Message ok={msg.ok} className="mt-3">{msg.texte}</Message>}
    </Carte>
  );
}
