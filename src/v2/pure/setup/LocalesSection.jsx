import React, { useEffect, useState } from 'react';
import { FolderOpen, Plus, Trash2, ShieldAlert, Loader2 } from 'lucide-react';
import { api } from './api';
import { refreshLibraries } from '../../lib/libraries';
import { Carte, Champ, Bouton, Message } from './ui';
import { tr } from '../../../i18n';

/* Bibliothèques locales : des dossiers que Nova lit lui-même, hors du serveur
   multimédia (contenu adulte, vidéos perso…). Marquées +18, elles n'existent
   que pour les comptes cochés plus bas — le serveur les cache à tous les
   autres, recherche comprise. */

function Case({ coche, onChange, disabled, children }) {
  return (
    <label className={`inline-flex items-center gap-2 text-[12.5px] select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" className="sr-only" checked={coche} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={`w-[18px] h-[18px] rounded-[6px] border flex items-center justify-center transition-colors ${coche ? 'bg-white border-white' : 'border-white/25'}`}>
        {coche && <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 6.2l2.6 2.6L10 3.4" stroke="#000" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      <span className="text-white/75">{children}</span>
    </label>
  );
}

export default function LocalesSection() {
  const [libs, setLibs] = useState(null);
  const [initial, setInitial] = useState('[]');
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const charger = () => api('/api/settings/locales')
    .then((d) => {
      const l = d.locales.map(({ id, nom, chemin, adulte, absente, series, episodes, films }) => ({ id, nom, chemin, adulte, absente, series, episodes, films }));
      setLibs(l); setInitial(JSON.stringify(l.map(({ id, nom, chemin, adulte }) => ({ id, nom, chemin, adulte }))));
      setUsers(d.utilisateurs);
    })
    .catch((e) => { setLibs([]); setMsg({ ok: false, texte: e.message }); });
  useEffect(() => { charger(); }, []);

  const maj = (i, patch) => setLibs((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const valeur = libs ? JSON.stringify(libs.map(({ id, nom, chemin, adulte }) => ({ id, nom, chemin, adulte }))) : initial;
  const modifie = valeur !== initial;

  const enregistrer = async () => {
    setEnvoi(true); setMsg(null);
    try {
      await api('/api/settings/locales', { method: 'PUT', body: { locales: libs.map(({ id, nom, chemin, adulte }) => ({ id, nom, chemin, adulte })) } });
      await charger();
      refreshLibraries();
      setMsg({ ok: true, texte: tr('Enregistré — le menu est à jour.') });
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
    finally { setEnvoi(false); }
  };

  const basculerAcces = async (u, adulte) => {
    setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, adulte } : x)));
    try { await api(`/api/settings/acces-adulte/${u.id}`, { method: 'PUT', body: { adulte } }); }
    catch (e) { setMsg({ ok: false, texte: e.message }); setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, adulte: !adulte } : x))); }
  };

  return (
    <Carte id="locales" titre={tr('Dossiers lus par Nova')}
      sousTitre={tr('Des vidéos que ton serveur multimédia ne doit pas voir : Nova lit le dossier lui-même et reconnaît séries et épisodes d\'après les noms de fichiers (Titre.S01E02…).')}>
      {!libs && <p className="flex items-center gap-2 text-[13px] text-white/40"><Loader2 size={15} className="animate-spin" /> {tr('Chargement…')}</p>}

      {libs && (
        <div className="space-y-3">
          {libs.map((l, i) => (
            <div key={l.id || i} className="p-4 rounded-2xl bg-white/[0.04] space-y-3">
              <div className="grid sm:grid-cols-[1fr_2fr] gap-3">
                <Champ label={tr('Nom dans le menu')} valeur={l.nom} onChange={(v) => maj(i, { nom: v })} placeholder="+18" />
                <Champ label={tr('Dossier sur le serveur')} valeur={l.chemin} onChange={(v) => maj(i, { chemin: v })} placeholder="D:\Videos\Perso" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <Case coche={!!l.adulte} onChange={(v) => maj(i, { adulte: v })}>{tr('Contenu +18')}</Case>
                  <span className="text-[12px] text-white/40 flex items-center gap-1.5">
                    <FolderOpen size={13} />
                    {l.absente ? tr('Dossier introuvable')
                      : l.series != null ? tr('{0} série(s) · {1} épisode(s) · {2} film(s)', [l.series, l.episodes, l.films]) : tr('Pas encore enregistré')}
                  </span>
                </div>
                <button onClick={() => setLibs((x) => x.filter((_, k) => k !== i))} title={tr('Retirer')}
                  className="w-8 h-8 rounded-full hover:bg-white/[0.08] flex items-center justify-center text-white/45 hover:text-red-300"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
          <button onClick={() => setLibs((x) => [...x, { id: '', nom: '', chemin: '', adulte: true }])}
            className="w-full h-11 rounded-2xl border border-dashed border-white/15 hover:border-white/30 text-[13px] text-white/60 hover:text-white flex items-center justify-center gap-2 transition-colors">
            <Plus size={15} /> {tr('Ajouter un dossier')}
          </button>
          <div className="flex items-center gap-3">
            <Bouton onClick={enregistrer} disabled={!modifie || envoi}>{envoi ? tr('Un instant…') : tr('Enregistrer')}</Bouton>
            {modifie && <Bouton variante="discret" onClick={charger}>{tr('Annuler')}</Bouton>}
          </div>
          {msg && <Message ok={msg.ok}>{msg.texte}</Message>}
        </div>
      )}

      {/* Qui peut voir le contenu +18 */}
      <div className="mt-6 pt-5 border-t border-white/[0.07]">
        <p className="flex items-center gap-2 text-[14px] font-semibold"><ShieldAlert size={15} className="text-red-300/80" /> {tr('Accès au contenu +18')}</p>
        <p className="text-[12.5px] text-white/45 mt-1 mb-4 leading-relaxed">
          {tr('Pour les comptes non cochés, ce contenu n\'existe pas : pas d\'onglet, rien dans la recherche, et ses titres sont bloqués par le serveur même avec un lien direct.')}
        </p>
        <div className="space-y-1.5">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.03]">
              <span className="text-[13.5px]">{u.username}{u.isAdmin && <span className="text-white/35 text-[12px]"> · {tr('administrateur')}</span>}</span>
              <Case coche={!!u.adulte} disabled={u.isAdmin} onChange={(v) => basculerAcces(u, v)}>{tr('Autorisé')}</Case>
            </div>
          ))}
        </div>
      </div>
    </Carte>
  );
}
