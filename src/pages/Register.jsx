import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Mail, Lock, Ticket, UserPlus, AlertCircle } from 'lucide-react';
import authService from '../services/authService';

import { tr } from '../i18n';
function Register({ onAuth }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await authService.register(username, email, password, inviteCode);
      onAuth(user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060606] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
            <span className="text-black font-black text-xl">N</span>
          </div>
          <span className="text-white font-bold text-2xl tracking-wide">{'NovaStream'}</span>
        </div>

        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 md:p-8">
          <h1 className="text-xl font-bold text-white mb-1">{tr('Créer un compte')}</h1>
          <p className="text-sm text-gray-500 mb-6">{tr('Un code d\'invitation est requis')}</p>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl mb-4">
              <AlertCircle size={16} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('Code d\'invitation')}</label>
              <div className="relative">
                <Ticket size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
                <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} required
                  placeholder={'NOVA-XXXXXX'}
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-white/25 transition-colors font-mono tracking-wider" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('Pseudo')}</label>
              <div className="relative">
                <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required
                  placeholder={tr('Votre pseudo')}
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-white/25 transition-colors" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('Email')}</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  placeholder={tr('vous@email.com')}
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-white/25 transition-colors" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('Mot de passe')}</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  placeholder="••••••••"
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-white/25 transition-colors" />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-white text-black rounded-xl font-bold text-sm hover:bg-gray-100 transition-all active:scale-[0.98] disabled:opacity-50 mt-2">
              {loading ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <UserPlus size={16} />}
              {loading ? tr('Création...') : tr('Créer mon compte')}
            </button>
          </form>

          <p className="text-center text-sm text-gray-600 mt-6">
            {tr('Déjà un compte ?')}{' '}
            <Link to="/login" className="text-white font-medium hover:underline">{tr('Se connecter')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;
