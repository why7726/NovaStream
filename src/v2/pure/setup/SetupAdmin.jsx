import React, { useState } from 'react';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import authService from '../../../services/authService';

/* Tout premier écran d'une installation neuve : personne n'a encore
   revendiqué le serveur. On crée le compte administrateur, puis on part
   vers les réglages (serveur multimédia, clés, bibliothèques). */

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

const champ = 'w-full bg-white/[0.05] border border-white/[0.08] rounded-xl py-3 px-4 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 transition-colors';

export default function SetupAdmin({ local, onDone }) {
  const [f, setF] = useState({ username: '', email: '', password: '', confirm: '' });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const maj = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const creer = async (e) => {
    e.preventDefault();
    setErreur('');
    if (f.password !== f.confirm) return setErreur('Les deux mots de passe ne correspondent pas');
    setEnvoi(true);
    try {
      const r = await fetch(`${apiBase()}/api/setup/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: f.username, email: f.email, password: f.password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Création impossible');
      authService.saveSession(d);
      onDone(d.user);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060606] text-white flex items-center justify-center p-5">
      <div className="w-full max-w-[400px]">
        <div className="flex items-baseline justify-center gap-1.5 mb-10">
          <span className="text-[26px] font-semibold tracking-[-0.03em]">Nova</span>
          <span className="text-[26px] font-light tracking-[-0.03em] text-white/60">Stream</span>
        </div>

        <h1 className="text-[24px] font-semibold tracking-[-0.03em] text-center">Bienvenue</h1>
        <p className="text-[14px] text-white/50 text-center mt-2 mb-8 leading-relaxed">
          Crée le compte administrateur. Tu relieras ensuite ton serveur Plex ou Jellyfin et, si tu le souhaites, les services optionnels.
        </p>

        {!local && (
          <div className="flex gap-2.5 bg-amber-400/10 text-amber-200/90 text-[13px] p-3.5 rounded-xl mb-5 leading-relaxed">
            <ShieldCheck size={16} className="shrink-0 mt-0.5" />
            Par sécurité, ce compte se crée depuis le réseau local : ouvre <b className="font-semibold">http://localhost:5174</b> sur la machine du serveur.
          </div>
        )}

        {erreur && (
          <div className="flex items-center gap-2 bg-red-500/10 text-red-300 text-[13px] p-3 rounded-xl mb-4">
            <AlertCircle size={15} className="shrink-0" /> {erreur}
          </div>
        )}

        <form onSubmit={creer} className="space-y-3">
          <input className={champ} placeholder="Pseudo" autoComplete="username" value={f.username} onChange={maj('username')} required />
          <input className={champ} placeholder="Email" type="email" autoComplete="email" value={f.email} onChange={maj('email')} required />
          <input className={champ} placeholder="Mot de passe (8 caractères minimum)" type="password" autoComplete="new-password" value={f.password} onChange={maj('password')} required minLength={8} />
          <input className={champ} placeholder="Confirme le mot de passe" type="password" autoComplete="new-password" value={f.confirm} onChange={maj('confirm')} required />
          <button type="submit" disabled={envoi || !local}
            className="w-full h-[48px] mt-2 rounded-full bg-white text-black text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">
            {envoi ? 'Création…' : 'Créer le compte administrateur'}
          </button>
        </form>
      </div>
    </div>
  );
}
