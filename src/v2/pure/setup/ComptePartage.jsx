import React, { useEffect, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { api } from './api';
import { Champ, Bouton, Message } from './ui';
import { tr } from '../../../i18n';

/* Compte partagé : un compte GÉRÉ du Plex Home de l'administrateur. Il n'a
   pas de mot de passe, donc pas de jeton à copier : Nova en obtient un
   depuis le compte admin. Le compte choisi est retenu, et Nova régénère
   alors le jeton tout seul si Plex le refuse un jour. */

export default function ComptePartage({ onChange }) {
  const [etat, setEtat] = useState(null);    // { comptes, choisi, defini, refuse }
  const [id, setId] = useState('');
  const [pin, setPin] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [msg, setMsg] = useState(null);

  const charger = () => api('/api/settings/plex-partage')
    .then((d) => {
      setEtat(d);
      setId(d.choisi || d.comptes.find((c) => /nova/i.test(c.nom))?.id || d.comptes[0]?.id || '');
    })
    .catch((e) => setMsg({ ok: false, texte: e.message }));
  useEffect(() => { charger(); }, []);

  const compte = etat?.comptes.find((c) => c.id === id);

  const regenerer = async () => {
    setEnvoi(true); setMsg(null);
    try {
      await api('/api/settings/plex-partage', { method: 'POST', body: { id, pin: compte?.protege ? pin : undefined } });
      setPin('');
      setMsg({ ok: true, texte: tr('Nouveau jeton enregistré — le compte « {0} » est actif.', [compte?.nom || '']) });
      await charger();
      onChange?.();
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
    finally { setEnvoi(false); }
  };

  if (!etat && !msg) {
    return <p className="flex items-center gap-2 text-[12.5px] text-white/40"><Loader2 size={14} className="animate-spin" /> {tr('Chargement…')}</p>;
  }

  return (
    <div className="space-y-3">
      {etat && etat.comptes.length === 0 && (
        <p className="text-[12.5px] text-white/45 leading-relaxed">
          {tr('Aucun compte géré dans ton Plex Home. Crée-en un dans Plex (Paramètres → Plex Home), puis reviens ici.')}
        </p>
      )}
      {etat && etat.comptes.length > 0 && (
        <>
          {etat.refuse && <Message ok={false}>{tr('Plex refuse le jeton actuel : Nova passe par ton compte en attendant.')}</Message>}
          <label className="block">
            <span className="block text-[12px] font-medium text-white/55 mb-1.5">{tr('Compte partagé (Plex Home)')}</span>
            <select value={id} onChange={(e) => setId(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-white/[0.06] border border-white/10 text-[14px] text-white outline-none focus:border-white/30">
              {etat.comptes.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#1a1a1c]">{c.nom}{c.id === etat.choisi ? ` · ${tr('actuel')}` : ''}</option>
              ))}
            </select>
          </label>
          {compte?.protege && (
            <Champ label={tr('Code PIN de ce compte')} secret placeholder="••••" valeur={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))} />
          )}
          <Bouton onClick={regenerer} disabled={!id || envoi || (compte?.protege && pin.length !== 4)}>
            <span className="inline-flex items-center gap-2">
              {envoi ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {etat.choisi === id && etat.defini ? tr('Régénérer le jeton') : tr('Utiliser ce compte')}
            </span>
          </Bouton>
        </>
      )}
      {msg && <Message ok={msg.ok}>{msg.texte}</Message>}
    </div>
  );
}
