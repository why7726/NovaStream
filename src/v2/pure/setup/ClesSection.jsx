import React, { useState } from 'react';
import { api } from './api';
import { refreshFeatures } from '../../lib/features';
import { Carte, Champ, Bouton, Message, Pastille } from './ui';

import { tr } from '../../../i18n';
/* Services optionnels. Aucun n'est obligatoire : sans sa clé, la fonction
   est simplement éteinte — l'administrateur voit un lien vers ce réglage,
   les autres voient « l'administrateur n'a pas activé cette fonction ». */

export const GROUPES = [
  {
    id: 'tmdb', feature: 'tmdb', titre: 'TMDB',
    role: tr('Affiches et logos HD, bandes-annonces, demandes de films, recommandations et sagas. Fortement conseillé.'),
    champs: [
      { cle: 'TMDB_TOKEN', label: tr('Jeton d\'accès en lecture (API Read Access Token)'), secret: true,
        aide: 'https://www.themoviedb.org/settings/api', note: tr('Le long jeton qui commence par « eyJ », pas la clé courte.') },
    ],
  },
  {
    id: 'soustitres', feature: 'soustitres', titre: 'OpenSubtitles',
    role: tr('Cherche des sous-titres français quand le fichier n\'en a pas. La clé suffit pour chercher ; le compte est nécessaire pour télécharger.'),
    champs: [
      { cle: 'OPENSUBTITLES_API_KEY', label: tr('Clé API'), secret: true, aide: 'https://www.opensubtitles.com/en/consumers' },
      { cle: 'OPENSUBTITLES_USER', label: tr('Identifiant OpenSubtitles') },
      { cle: 'OPENSUBTITLES_PASSWORD', label: tr('Mot de passe OpenSubtitles'), secret: true },
    ],
  },
  {
    id: 'arr', feature: 'arr', titre: tr('Radarr & Sonarr'),
    role: tr('Lance la recherche des films et séries demandés par tes utilisateurs. Sans eux, les demandes arrivent quand même dans ton espace admin.'),
    champs: [
      { cle: 'RADARR_URL', label: tr('Adresse de Radarr'), placeholder: 'http://localhost:7878' },
      { cle: 'RADARR_API_KEY', label: tr('Clé API Radarr'), secret: true, note: tr('Radarr → Settings → General → API Key') },
      { cle: 'SONARR_URL', label: tr('Adresse de Sonarr'), placeholder: 'http://localhost:8989' },
      { cle: 'SONARR_API_KEY', label: tr('Clé API Sonarr'), secret: true, note: tr('Sonarr → Settings → General → API Key') },
      { cle: 'ARR_ROOT_MOVIE', label: tr('Dossier des films (vu par Radarr)'), placeholder: '/data/Films' },
      { cle: 'ARR_ROOT_SERIES', label: tr('Dossier des séries (vu par Sonarr)'), placeholder: '/data/Series' },
      { cle: 'ARR_ROOT_ANIME', label: tr('Dossier des animés (vu par Sonarr)'), placeholder: '/data/Animes' },
    ],
  },
  {
    id: 'qbit', feature: 'qbit', titre: 'qBittorrent',
    role: tr('Lecture seule : retrouve un téléchargement ajouté à la main pour une demande. Nova ne démarre, ne met en pause et ne supprime jamais rien.'),
    champs: [
      { cle: 'QBIT_URL', label: tr('Adresse de l\'interface web'), placeholder: 'http://localhost:8080' },
      { cle: 'QBIT_USER', label: tr('Identifiant') },
      { cle: 'QBIT_PASS', label: tr('Mot de passe'), secret: true },
    ],
  },
];

function Groupe({ g, reglages, features, onChange }) {
  const [saisie, setSaisie] = useState({});
  const [msg, setMsg] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const r = (cle) => reglages?.[cle] || {};
  const valeurAffichee = (c) => (saisie[c.cle] !== undefined ? saisie[c.cle] : (c.secret ? '' : r(c.cle).valeur || ''));
  const modifie = Object.keys(saisie).length > 0;
  const actif = !!features?.[g.feature];
  // « Retirer » n'efface que ce qui a été saisi ici (le .env n'est pas modifiable depuis la page).
  const aDesValeurs = g.champs.some((c) => r(c.cle).defini && !r(c.cle).depuisEnv);

  const tester = async () => {
    setOccupe(true); setMsg(null);
    try {
      const d = await api(`/api/settings/test/${g.id}`, { method: 'POST', body: { reglages: saisie } });
      setMsg({ ok: d.ok, texte: d.message });
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  const enregistrer = async () => {
    setOccupe(true); setMsg(null);
    try {
      await api('/api/settings', { method: 'PUT', body: { reglages: saisie } });
      setSaisie({});
      setMsg({ ok: true, texte: tr('Enregistré.') });
      refreshFeatures();
      onChange();
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  const retirer = async () => {
    setOccupe(true); setMsg(null);
    try {
      const vide = Object.fromEntries(g.champs.map((c) => [c.cle, null]));
      await api('/api/settings', { method: 'PUT', body: { reglages: vide } });
      setSaisie({});
      setMsg({ ok: true, texte: tr('Clés retirées — la fonction est désactivée.') });
      refreshFeatures();
      onChange();
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  return (
    <Carte id={g.id} titre={g.titre} sousTitre={g.role} badge={<Pastille actif={actif} texteInactif={tr('Désactivé')} />}>
      <div className="grid md:grid-cols-2 gap-3">
        {g.champs.map((c) => (
          <Champ key={c.cle} label={c.label} secret={c.secret} aide={c.aide}
            note={r(c.cle).depuisEnv ? tr('Définie dans le fichier .env — une valeur saisie ici la remplace.') : c.note}
            placeholder={c.secret && r(c.cle).defini ? tr('{0} (enregistrée)', [r(c.cle).apercu]) : (c.placeholder || '')}
            valeur={valeurAffichee(c)}
            onChange={(v) => setSaisie((s) => ({ ...s, [c.cle]: v }))} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Bouton onClick={enregistrer} disabled={!modifie || occupe}>{tr('Enregistrer')}</Bouton>
        <Bouton variante="doux" onClick={tester} disabled={occupe}>{occupe ? '…' : tr('Tester')}</Bouton>
        {aDesValeurs && <Bouton variante="discret" onClick={retirer} disabled={occupe}>{tr('Retirer')}</Bouton>}
      </div>
      {msg && <Message ok={msg.ok} className="mt-3">{msg.texte}</Message>}
    </Carte>
  );
}

export default function ClesSection({ reglages, features, onChange }) {
  return (
    <div className="space-y-4">
      {GROUPES.map((g) => <Groupe key={g.id} g={g} reglages={reglages} features={features} onChange={onChange} />)}
    </div>
  );
}
