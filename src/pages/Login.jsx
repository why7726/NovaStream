import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, LogIn, AlertCircle } from 'lucide-react';
import authService from '../services/authService';
import { CREDITS } from '../credits';

function Login({ onAuth }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await authService.login(email, password);
      onAuth(user);
      // Login activity is logged server-side (see /api/auth/login).
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
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
            <span className="text-black font-black text-xl">N</span>
          </div>
          <span className="text-white font-bold text-2xl tracking-wide">NovaStream</span>
        </div>

        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 md:p-8">
          <h1 className="text-xl font-bold text-white mb-1">Connexion</h1>
          <p className="text-sm text-gray-500 mb-6">Accédez à votre espace streaming</p>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl mb-4">
              <AlertCircle size={16} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  placeholder="vous@email.com"
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-white/25 transition-colors" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Mot de passe</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  placeholder="••••••••"
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-white/25 transition-colors" />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-white text-black rounded-xl font-bold text-sm hover:bg-gray-100 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <LogIn size={16} />}
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-600 mt-6">
            Pas de compte ?{' '}
            <Link to="/register" className="text-white font-medium hover:underline">S'inscrire</Link>
          </p>
        </div>

        <p className="text-center text-[11.5px] text-white/25 mt-8">
          NovaStream · créé par{' '}
          <a href={CREDITS.github} target="_blank" rel="noreferrer" className="hover:text-white/60 transition-colors">{CREDITS.auteur}</a>
          {' '}avec {CREDITS.coAuteur}
        </p>
      </div>
    </div>
  );
}

export default Login;
