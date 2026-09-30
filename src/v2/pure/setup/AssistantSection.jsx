import React, { useEffect, useState } from 'react';
import { api } from './api';
import { refreshFeatures } from '../../lib/features';
import { Carte, Champ, Bouton, Message, Pastille } from './ui';

/* L'IA de l'assistant « Dis-moi ta soirée » : chacun branche la sienne.
   En ligne (clé API) ou locale (Ollama, LM Studio — rien ne sort de chez
   soi). Le modèle est facultatif : sans choix, Nova en prend un rapide
   parmi ceux que le fournisseur propose. */

const IA = [
  { id: 'gemini', nom: 'Gemini', par: 'Google', cle: 'GEMINI_API_KEY', aide: 'https://aistudio.google.com/apikey', note: 'Le palier gratuit suffit.' },
  { id: 'openai', nom: 'ChatGPT', par: 'OpenAI', cle: 'OPENAI_API_KEY', aide: 'https://platform.openai.com/api-keys' },
  { id: 'claude', nom: 'Claude', par: 'Anthropic', cle: 'ANTHROPIC_API_KEY', aide: 'https://console.anthropic.com/settings/keys' },
  { id: 'grok', nom: 'Grok', par: 'xAI', cle: 'XAI_API_KEY', aide: 'https://console.x.ai' },
  { id: 'ollama', nom: 'Ollama', par: 'sur ta machine', url: 'OLLAMA_URL', defaut: 'http://localhost:11434', aide: 'https://ollama.com/download', note: 'Gratuit et privé. Installe Ollama puis un modèle (ex. « ollama pull llama3.2 »). En Docker, remplace localhost par l\'IP de la machine.' },
  { id: 'lmstudio', nom: 'LM Studio', par: 'sur ta machine', url: 'LMSTUDIO_URL', defaut: 'http://localhost:1234', aide: 'https://lmstudio.ai', note: 'Gratuit et privé. Charge un modèle puis active le serveur local (onglet Developer). En Docker, remplace localhost par l\'IP de la machine.' },
];

export default function AssistantSection({ reglages, features, onChange }) {
  const r = (k) => reglages?.[k] || {};
  const enregistre = r('IA_FOURNISSEUR').valeur
    || (r('GEMINI_API_KEY').defini ? 'gemini' : IA.find((x) => x.cle && r(x.cle).defini)?.id)
    || 'gemini';
  const [choix, setChoix] = useState(enregistre);
  const [saisie, setSaisie] = useState({});
  const [modeles, setModeles] = useState([]);
  const [msg, setMsg] = useState(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => { setChoix(enregistre); }, [enregistre]);
  const ia = IA.find((x) => x.id === choix);
  const modeleActuel = saisie.IA_MODELE !== undefined ? saisie.IA_MODELE : (choix === enregistre ? r('IA_MODELE').valeur || '' : '');

  const choisir = (id) => { setChoix(id); setSaisie({}); setModeles([]); setMsg(null); };

  // Ce qu'on envoie : le fournisseur choisi + ce qui a été tapé pour lui.
  const aEnvoyer = () => {
    const out = { IA_FOURNISSEUR: choix };
    if (ia.cle && saisie[ia.cle]) out[ia.cle] = saisie[ia.cle];
    if (ia.url && saisie[ia.url] !== undefined) out[ia.url] = saisie[ia.url] || null;
    // Changer de fournisseur efface le modèle de l'ancien (il n'existerait pas ici).
    out.IA_MODELE = modeleActuel || null;
    return out;
  };

  const tester = async () => {
    setOccupe(true); setMsg(null);
    try {
      const d = await api('/api/settings/test/assistant', { method: 'POST', body: { reglages: aEnvoyer() } });
      setMsg({ ok: d.ok, texte: d.message });
      setModeles(d.modeles || []);
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  const enregistrer = async () => {
    setOccupe(true); setMsg(null);
    try {
      await api('/api/settings', { method: 'PUT', body: { reglages: aEnvoyer() } });
      setSaisie({});
      setMsg({ ok: true, texte: `Enregistré — l'assistant utilise ${ia.nom}.` });
      refreshFeatures();
      onChange();
    } catch (e) { setMsg({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  const pret = ia.url || saisie[ia.cle] || r(ia.cle).defini;

  return (
    <Carte id="assistant" titre="Assistant « Dis-moi ta soirée »"
      sousTitre="Une humeur, et l'IA propose des films de ta bibliothèque. Choisis celle que tu veux : en ligne avec une clé, ou installée sur ta machine."
      badge={<Pastille actif={!!features?.assistant} texteActif={`Actif · ${IA.find((x) => x.id === enregistre)?.nom || ''}`} texteInactif="Désactivé" />}>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
        {IA.map((x) => {
          const on = x.id === choix;
          const configuree = x.cle ? r(x.cle).defini : x.id === enregistre;
          return (
            <button key={x.id} onClick={() => choisir(x.id)}
              className={`text-left p-3 rounded-xl border transition-colors ${on ? 'bg-white text-black border-white' : 'bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.08]'}`}>
              <span className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold">{x.nom}</span>
                {configuree && <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-emerald-600' : 'bg-emerald-400'}`} title="Configurée" />}
              </span>
              <span className={`block text-[11.5px] mt-0.5 ${on ? 'text-black/55' : 'text-white/40'}`}>{x.par}</span>
            </button>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {ia.cle && (
          <Champ label={`Clé API ${ia.nom}`} secret aide={ia.aide} note={ia.note}
            placeholder={r(ia.cle).defini ? `${r(ia.cle).apercu} (enregistrée)` : ''}
            valeur={saisie[ia.cle] || ''} onChange={(v) => setSaisie((s) => ({ ...s, [ia.cle]: v }))} />
        )}
        {ia.url && (
          <Champ label={`Adresse de ${ia.nom}`} aide={ia.aide} note={ia.note} placeholder={ia.defaut}
            valeur={saisie[ia.url] !== undefined ? saisie[ia.url] : r(ia.url).valeur || ''}
            onChange={(v) => setSaisie((s) => ({ ...s, [ia.url]: v }))} />
        )}
        <label className="block">
          <span className="block text-[12px] font-medium text-white/55 mb-1.5">Modèle</span>
          {modeles.length > 0 ? (
            <select value={modeleActuel} onChange={(e) => setSaisie((s) => ({ ...s, IA_MODELE: e.target.value }))}
              className="w-full h-11 bg-black/25 border border-white/[0.08] rounded-xl px-3 text-[13.5px] text-white focus:outline-none focus:border-white/25">
              <option value="">Automatique (conseillé)</option>
              {modeles.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={modeleActuel} onChange={(e) => setSaisie((s) => ({ ...s, IA_MODELE: e.target.value }))}
              placeholder="Automatique — « Tester » affiche la liste"
              className="w-full h-11 bg-black/25 border border-white/[0.08] rounded-xl px-3.5 text-[13.5px] text-white placeholder:text-white/25 focus:outline-none focus:border-white/25" />
          )}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Bouton onClick={enregistrer} disabled={occupe || !pret}>Enregistrer</Bouton>
        <Bouton variante="doux" onClick={tester} disabled={occupe || !pret}>{occupe ? '…' : 'Tester'}</Bouton>
        {features?.assistant && (
          <Bouton variante="discret" disabled={occupe} onClick={async () => {
            await api('/api/settings', { method: 'PUT', body: { reglages: { IA_FOURNISSEUR: null, IA_MODELE: null, ...Object.fromEntries(IA.map((x) => [x.cle || x.url, null])) } } });
            setMsg({ ok: true, texte: 'Assistant désactivé.' }); refreshFeatures(); onChange();
          }}>Désactiver</Bouton>
        )}
      </div>
      {msg && <Message ok={msg.ok} className="mt-3">{msg.texte}</Message>}
      <p className="text-[11.5px] text-white/30 mt-4 leading-relaxed">
        Seuls les titres, années et genres de ta bibliothèque sont envoyés à l'IA — jamais qui regarde quoi. Chaque proposition est revérifiée : un titre inventé n'est jamais affiché.
      </p>
    </Carte>
  );
}
