import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import { api } from './api';
import { Carte, Champ, Bouton, Message, Pastille } from './ui';
import ServeurSection from './ServeurSection';
import BibliothequesSection from './BibliothequesSection';
import ClesSection from './ClesSection';
import AssistantSection from './AssistantSection';
import APropos from './APropos';

import { tr } from '../../../i18n';
/* Réglages du serveur (administrateur) — et assistant de premier démarrage.

   Une seule page, dans l'ordre où on en a besoin : le serveur, les
   bibliothèques, les services optionnels, l'accès depuis l'extérieur.
   Arrivé ici juste après la création du compte (?bienvenue=1), on affiche
   en tête les étapes restantes. */

function Acces({ reglages, onChange }) {
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState(null);
  const actuelle = reglages?.PUBLIC_URL?.valeur || '';

  const enregistrer = async () => {
    setMsg(null);
    let v = url.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//.test(v)) v = `https://${v}`;
    try {
      if (v) new URL(v);
      await api('/api/settings', { method: 'PUT', body: { reglages: { PUBLIC_URL: v || null } } });
      setUrl('');
      setMsg({ ok: true, texte: v ? tr('Adresse publique : {0}', [v]) : tr('Adresse publique retirée.') });
      onChange();
    } catch { setMsg({ ok: false, texte: tr('Adresse invalide') }); }
  };

  return (
    <Carte id="acces" titre={tr('Accès depuis l\'extérieur')}
      sousTitre={tr('Pour regarder hors de chez toi, en HTTPS.')}
      badge={<Pastille actif={!!actuelle} texteActif={tr('Configuré')} texteInactif={tr('Réseau local')} />}>
      <Champ label={tr('Adresse publique de Nova')} placeholder={actuelle || 'https://nova.mon-domaine.fr'}
        valeur={url} onChange={setUrl}
        note={tr('Sert aux liens d\'invitation et à autoriser les requêtes venant de cette adresse.')} />
      <div className="flex gap-2 mt-3">
        <Bouton onClick={enregistrer} disabled={!url.trim()}>{tr('Enregistrer')}</Bouton>
        {actuelle && <Bouton variante="discret" onClick={() => { setUrl(''); api('/api/settings', { method: 'PUT', body: { reglages: { PUBLIC_URL: null } } }).then(onChange); }}>{tr('Retirer')}</Bouton>}
      </div>
      {msg && <Message ok={msg.ok} className="mt-3">{msg.texte}</Message>}

      <div className="mt-5 pt-4 border-t border-white/[0.07] text-[12.5px] text-white/50 leading-relaxed space-y-2">
        <p className="text-white/70 font-medium">{tr('Le certificat HTTPS est automatique')}</p>
        <p>{tr('Avec l\'installation Docker, Caddy obtient et renouvelle le certificat tout seul : indique ton domaine dans la variable')} <code className="text-white/75">{'DOMAIN'}</code> {tr('du fichier')} <code className="text-white/75">{'.env'}</code>{tr(', puis redémarre.')}</p>
        <p>{tr('Il faut que ton domaine pointe vers ton adresse IP publique et que ta box redirige les ports')} <b className="text-white/75">80</b> et <b className="text-white/75">443</b> {tr('vers cette machine. Détails dans le README.')}</p>
      </div>
    </Carte>
  );
}

export default function SettingsPure() {
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  const bienvenue = new URLSearchParams(search).has('bienvenue');
  const [etat, setEtat] = useState(null);    // { reglages, features, bibliotheques }
  const [erreur, setErreur] = useState('');

  const charger = useCallback(() => {
    api('/api/settings').then(setEtat).catch((e) => setErreur(e.message));
  }, []);
  useEffect(() => { window.scrollTo(0, 0); charger(); }, [charger]);

  // Lien direct vers une section (#soustitres depuis « Configure la clé… »)
  useEffect(() => {
    if (!etat || !hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [etat, hash]);

  if (erreur) return <div className="max-w-2xl mx-auto px-5 pt-28"><Message ok={false}>{erreur}</Message></div>;
  if (!etat) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 size={22} className="animate-spin text-white/40" /></div>;
  }

  const { reglages, features } = etat;
  const etapes = [
    { fait: true, texte: tr('Compte administrateur créé') },
    { fait: features.serveur, texte: tr('Relier ton serveur Plex ou Jellyfin') },
    { fait: features.tmdb, texte: tr('Ajouter la clé TMDB (conseillé)') },
  ];

  return (
    <div className="max-w-[860px] mx-auto px-4 md:px-8 pt-24 md:pt-28 pb-32">
      <h1 className="text-[28px] md:text-[34px] font-semibold tracking-[-0.035em]">
        {bienvenue ? tr('Configurons NovaStream') : tr('Réglages du serveur')}
      </h1>
      <p className="text-[14px] text-white/50 mt-2 mb-8 max-w-xl leading-relaxed">
        {bienvenue
          ? tr('Seul le serveur est indispensable. Tout le reste est facultatif et se change ici à tout moment (menu du compte → Réglages du serveur).')
          : tr('Les clés restent sur ce serveur : elles ne sont jamais renvoyées au navigateur.')}
      </p>

      {bienvenue && (
        <div className="rounded-[22px] bg-white/[0.035] border border-white/[0.06] p-5 mb-4">
          <ol className="space-y-2.5">
            {etapes.map((e, i) => (
              <li key={i} className="flex items-center gap-3 text-[13.5px]">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${e.fait ? 'bg-white text-black' : 'bg-white/[0.08] text-white/50'}`}>
                  {e.fait ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <span className={e.fait ? 'text-white/45 line-through decoration-white/20' : 'text-white/85'}>{e.texte}</span>
              </li>
            ))}
          </ol>
          {features.serveur && (
            <div className="mt-5">
              <Bouton onClick={() => navigate('/')}>{tr('Ouvrir NovaStream')}</Bouton>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <ServeurSection reglages={reglages} features={features} onChange={charger} />
        <BibliothequesSection serveurRelie={features.serveur} />
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-white/35 pt-6 pb-1 px-1">{tr('Services optionnels')}</h2>
        <AssistantSection reglages={reglages} features={features} onChange={charger} />
        <ClesSection reglages={reglages} features={features} onChange={charger} />
        <div className="pt-6" />
        <Acces reglages={reglages} onChange={charger} />
        <APropos />
      </div>
    </div>
  );
}
