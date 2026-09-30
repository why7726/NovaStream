import React, { useRef, useState } from 'react';
import { Check, Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { api, signalerInstallation } from './api';
import { refreshLibraries } from '../../lib/libraries';
import { Carte, Champ, Bouton, Message } from './ui';

/* Relier le serveur multimédia.
   Plex : même principe qu'Overseerr — plex.tv donne un code, on valide dans
   un nouvel onglet, Nova récupère la liste de TES serveurs et essaie leurs
   adresses jusqu'à en trouver une qui répond depuis cette machine.
   Jellyfin : adresse du serveur + un compte. Nova garde le jeton que
   Jellyfin lui donne, jamais le mot de passe. */

function LogoPlex() {
  // Chevron Plex, dessiné simplement (pas d'image externe).
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M7 3h5.2l5.3 9-5.3 9H7l5.3-9z" fill="#1f1f1f" />
    </svg>
  );
}

function LogoJellyfin() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <defs>
        <linearGradient id="jf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#AA5CC3" /><stop offset="1" stopColor="#00A4DC" />
        </linearGradient>
      </defs>
      <path d="M12 3c-1.6 0-7.2 10.2-6.4 11.8.8 1.6 12 1.6 12.8 0C19.2 13.2 13.6 3 12 3zm0 5.2c.9 0 3.9 5.4 3.5 6.2-.4.9-6.6.9-7 0-.4-.8 2.6-6.2 3.5-6.2z" fill="url(#jf)" />
      <path d="M12 19.5c-3 0-7.6-.6-8.3-1.9.3 1.9 5.3 3.4 8.3 3.4s8-1.5 8.3-3.4c-.7 1.3-5.3 1.9-8.3 1.9z" fill="url(#jf)" />
    </svg>
  );
}

export default function ServeurSection({ reglages, features, onChange }) {
  const type = features?.serveurType || null;          // 'plex' | 'jellyfin' | null
  const relie = !!type;
  const [jfOuvert, setJfOuvert] = useState(false);
  const [jf, setJf] = useState({ url: '', identifiant: '', motDePasse: '' });
  const [etape, setEtape] = useState('repos');   // repos | attente | choix | liaison
  const [serveurs, setServeurs] = useState([]);
  const [msg, setMsg] = useState(null);           // { ok, texte }
  const [manuel, setManuel] = useState(false);
  const [saisie, setSaisie] = useState({ PLEX_URL: '', PLEX_TOKEN: '' });
  const [avance, setAvance] = useState(false);
  const [jetonNova, setJetonNova] = useState('');
  const arret = useRef(false);

  const choisir = async (s, uri) => {
    setEtape('liaison'); setMsg(null);
    try {
      const d = await api('/api/setup/plex/choose', { method: 'POST', body: { id: s.id, uri } });
      setMsg({ ok: true, texte: `${d.nom} est relié (${d.uri}).` });
      setEtape('repos');
      refreshLibraries();
      signalerInstallation();
      onChange();
    } catch (e) {
      setMsg({ ok: false, texte: e.message });
      setEtape('choix');
      setManuel(true);
      setSaisie((x) => ({ ...x, PLEX_URL: x.PLEX_URL || s.adresses?.[0]?.uri || '' }));
    }
  };

  const connecterPlex = async () => {
    setMsg(null);
    // Onglet ouvert TOUT DE SUITE (sinon le navigateur le bloque), rempli ensuite.
    const onglet = window.open('', '_blank');
    try {
      const { url } = await api('/api/setup/plex/start', { method: 'POST' });
      if (onglet) onglet.location.href = url; else window.open(url, '_blank');
      setEtape('attente');
      arret.current = false;
      const debut = Date.now();
      while (!arret.current && Date.now() - debut < 10 * 60000) {
        await new Promise((r) => setTimeout(r, 2000));
        const d = await api('/api/setup/plex/finish', { method: 'POST' });
        if (d.pending) continue;
        setServeurs(d.serveurs || []);
        if ((d.serveurs || []).length === 1) return choisir(d.serveurs[0]);
        setEtape('choix');
        return;
      }
      setEtape('repos');
    } catch (e) {
      try { onglet?.close(); } catch { /* déjà fermé */ }
      setMsg({ ok: false, texte: e.message });
      setEtape('repos');
    }
  };

  const enregistrerManuel = async () => {
    setMsg(null);
    try {
      const t = await api('/api/settings/test/serveur', { method: 'POST', body: { reglages: saisie } });
      if (!t.ok) return setMsg({ ok: false, texte: t.message });
      await api('/api/settings', { method: 'PUT', body: { reglages: saisie } });
      setMsg({ ok: true, texte: t.message });
      setManuel(false);
      refreshLibraries();
      signalerInstallation();
      onChange();
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
  };

  const connecterJellyfin = async (e) => {
    e.preventDefault();
    setEtape('liaison'); setMsg(null);
    try {
      const d = await api('/api/setup/jellyfin', { method: 'POST', body: jf });
      setMsg({ ok: true, texte: `${d.nom} (Jellyfin ${d.version}) est relié.` });
      setJf({ url: '', identifiant: '', motDePasse: '' });
      setJfOuvert(false);
      refreshLibraries();
      signalerInstallation();
      onChange();
    } catch (err) { setMsg({ ok: false, texte: err.message }); }
    finally { setEtape('repos'); }
  };

  const enregistrerJetonNova = async (valeur) => {
    try {
      await api('/api/settings', { method: 'PUT', body: { reglages: { PLEX_NOVA_TOKEN: valeur } } });
      setJetonNova('');
      onChange();
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
  };

  return (
    <Carte id="serveur" titre="Serveur multimédia"
      sousTitre="Nova lit tes films et séries directement sur ton serveur.">
      {relie && (
        <div className="flex items-center gap-2.5 text-[13.5px] text-white/80 mb-4 min-w-0">
          <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-400/15 text-emerald-300 flex items-center justify-center"><Check size={12} strokeWidth={3} /></span>
          {type === 'jellyfin' ? 'Jellyfin' : 'Plex'} relié — <span className="text-white/45 truncate">{type === 'jellyfin' ? reglages?.JELLYFIN_URL?.valeur : reglages?.PLEX_URL?.valeur}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2.5">
        <button onClick={connecterPlex} disabled={etape === 'attente' || etape === 'liaison'}
          className="flex-1 h-[48px] rounded-xl bg-[#E5A00D] text-[#1f1f1f] text-[14.5px] font-semibold flex items-center justify-center gap-2.5 hover:brightness-105 transition disabled:opacity-60">
          {etape === 'attente' || etape === 'liaison' ? <Loader2 size={17} className="animate-spin" /> : <LogoPlex />}
          {etape === 'attente' ? 'En attente de Plex…' : etape === 'liaison' ? 'Liaison…' : type === 'plex' ? 'Changer de serveur Plex' : 'Se connecter avec Plex'}
        </button>
        <button onClick={() => setJfOuvert(!jfOuvert)} disabled={etape === 'attente' || etape === 'liaison'}
          className={`flex-1 h-[48px] rounded-xl text-[14.5px] font-semibold flex items-center justify-center gap-2.5 transition disabled:opacity-60 ${jfOuvert ? 'bg-white text-black' : 'bg-white/[0.08] hover:bg-white/[0.13] text-white'}`}>
          <LogoJellyfin /> {type === 'jellyfin' ? 'Changer de serveur Jellyfin' : 'Se connecter avec Jellyfin'}
        </button>
      </div>

      {jfOuvert && (
        <form onSubmit={connecterJellyfin} className="mt-4 p-4 rounded-2xl bg-white/[0.04] space-y-3">
          <Champ label="Adresse du serveur Jellyfin" placeholder="http://192.168.1.10:8096"
            valeur={jf.url} onChange={(v) => setJf({ ...jf, url: v })}
            note="L'adresse que tu tapes dans ton navigateur pour ouvrir Jellyfin. En Docker, pas de « localhost » : mets l'IP de la machine." />
          <div className="grid sm:grid-cols-2 gap-3">
            <Champ label="Identifiant Jellyfin" valeur={jf.identifiant} onChange={(v) => setJf({ ...jf, identifiant: v })} />
            <Champ label="Mot de passe" secret valeur={jf.motDePasse} onChange={(v) => setJf({ ...jf, motDePasse: v })} />
          </div>
          <p className="text-[11.5px] text-white/35 leading-relaxed">
            Nova lira tout avec ce compte : choisis-en un qui voit les bibliothèques à partager. Le mot de passe n'est pas conservé, seulement le jeton que Jellyfin renvoie.
          </p>
          <Bouton type="submit" disabled={!jf.url || !jf.identifiant || etape === 'liaison'}>{etape === 'liaison' ? 'Connexion…' : 'Se connecter'}</Bouton>
        </form>
      )}

      {etape === 'attente' && (
        <p className="text-[12.5px] text-white/45 mt-3">
          Valide la connexion dans l'onglet Plex qui vient de s'ouvrir, puis reviens ici.{' '}
          <button className="underline hover:text-white" onClick={() => { arret.current = true; setEtape('repos'); }}>Annuler</button>
        </p>
      )}

      {etape === 'choix' && serveurs.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[12.5px] text-white/45">Quel serveur relier ?</p>
          {serveurs.map((s) => (
            <button key={s.id} onClick={() => choisir(s)}
              className="w-full text-left p-3.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] transition-colors">
              <p className="text-[14px] font-medium">{s.nom}</p>
              <p className="text-[11.5px] text-white/40 mt-0.5 truncate">{s.adresses.map((a) => a.uri).join(' · ')}</p>
            </button>
          ))}
        </div>
      )}

      {msg && <Message ok={msg.ok} className="mt-4">{msg.texte}</Message>}

      <button onClick={() => setManuel(!manuel)} className="mt-4 text-[12.5px] text-white/40 hover:text-white/70 transition-colors">
        {manuel ? 'Masquer la saisie manuelle' : 'Plex : saisir l\'adresse et le jeton à la main'}
      </button>
      {manuel && (
        <div className="mt-3 space-y-3">
          <Champ label="Adresse du serveur Plex" placeholder="http://192.168.1.10:32400"
            valeur={saisie.PLEX_URL} onChange={(v) => setSaisie({ ...saisie, PLEX_URL: v })} />
          <Champ label="Jeton Plex (X-Plex-Token)" secret placeholder={reglages?.PLEX_TOKEN?.apercu || ''}
            aide="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
            valeur={saisie.PLEX_TOKEN} onChange={(v) => setSaisie({ ...saisie, PLEX_TOKEN: v })} />
          <Bouton onClick={enregistrerManuel} disabled={!saisie.PLEX_URL || (!saisie.PLEX_TOKEN && !reglages?.PLEX_TOKEN?.defini)}>Tester et enregistrer</Bouton>
        </div>
      )}

      {type === 'plex' && (
        <div className="mt-5 pt-4 border-t border-white/[0.07]">
          <button onClick={() => setAvance(!avance)} className="flex items-center gap-1.5 text-[12.5px] text-white/40 hover:text-white/70 transition-colors">
            <ChevronDown size={14} className={`transition-transform ${avance ? 'rotate-180' : ''}`} /> Avancé
          </button>
          {avance && (
            <div className="mt-3 space-y-3">
              <p className="text-[12px] text-white/45 leading-relaxed">
                Facultatif : le jeton d'un compte Plex géré dédié à Nova. Les lectures de tes utilisateurs apparaîtront sous ce compte plutôt que sous le tien, et ta propre reprise de lecture reste intacte.
              </p>
              <Champ label="Jeton du compte Plex dédié" secret placeholder={reglages?.PLEX_NOVA_TOKEN?.apercu || 'non défini'}
                valeur={jetonNova} onChange={setJetonNova} />
              <div className="flex gap-2">
                <Bouton onClick={() => enregistrerJetonNova(jetonNova)} disabled={!jetonNova}>Enregistrer</Bouton>
                {reglages?.PLEX_NOVA_TOKEN?.defini && !reglages.PLEX_NOVA_TOKEN.depuisEnv && (
                  <Bouton variante="discret" onClick={() => enregistrerJetonNova(null)}>Retirer</Bouton>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!relie && etape === 'repos' && !msg && (
        <p className="flex items-center gap-2 text-[12.5px] text-white/40 mt-4">
          <AlertCircle size={14} /> Tant qu'aucun serveur n'est relié, les autres utilisateurs voient une page d'attente.
        </p>
      )}
    </Carte>
  );
}
