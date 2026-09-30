import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Film, Tv, Sparkles, Moon, CalendarDays, Trophy, User } from 'lucide-react';
import { motion } from 'framer-motion';
import authService from '../../services/authService';
import FooterV2 from '../components/FooterV2';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

/* ── Wrapped — personal viewing stats, Spotify-Wrapped style ────────── */

const fmtHours = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h >= 100) return `${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
  return `${m} min`;
};

const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 26 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
});

function StatCard({ icon, label, value, sub, gradient, delay = 0, children }) {
  return (
    <motion.div {...rise(delay)}
      className="relative overflow-hidden rounded-3xl p-6 md:p-8 ring-1 ring-white/10"
      style={{ background: gradient }}>
      <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-white/[0.07] blur-2xl pointer-events-none" />
      <div className="flex items-center gap-2 text-white/70 text-[11px] font-black uppercase tracking-widest mb-3">
        {icon} {label}
      </div>
      {value != null && <p className="text-4xl md:text-5xl font-black tracking-tight text-glow">{value}</p>}
      {sub && <p className="text-sm text-white/65 mt-1.5">{sub}</p>}
      {children}
    </motion.div>
  );
}

function RankList({ items, render }) {
  return (
    <ol className="mt-4 space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-3">
          <span className={`w-7 text-center font-black ${i === 0 ? 'text-2xl text-white' : 'text-sm text-white/40'}`}>{i + 1}</span>
          {render(it, i)}
        </li>
      ))}
    </ol>
  );
}

export default function WrappedV2() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let on = true;
    window.scrollTo(0, 0);
    const token = authService.getToken();
    fetch(`${apiBase()}/api/me/wrapped`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => on && setStats(d))
      .catch(() => on && setError(true));
    return () => { on = false; };
  }, []);

  if (error) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Impossible de charger tes stats</h1>
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-white transition-colors">Retour</button>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-indigo-400/30 border-t-indigo-300 rounded-full animate-spin" />
      </div>
    );
  }

  const hasData = stats.totalSeconds > 60;
  const since = stats.firstPlay ? new Date(stats.firstPlay).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : null;
  const badge = stats.nightOwlPct >= 35
    ? { emoji: '🌙', title: 'Couche-tard certifié', sub: `${stats.nightOwlPct}% de tes lectures démarrent après 22 h` }
    : stats.episodesWatched > stats.moviesCompleted * 3
      ? { emoji: '📺', title: 'Dévoreur de séries', sub: 'Les épisodes s\'enchaînent, les saisons tremblent' }
      : { emoji: '🎬', title: 'Cinéphile maison', sub: 'Le grand écran, c\'est chez toi' };

  return (
    <div className="pt-24 md:pt-28">
      <div className="px-5 md:px-12 max-w-5xl mx-auto">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-sm font-semibold text-white/85 hover:text-white transition-colors mb-10">
          <ArrowLeft size={15} /> Retour
        </button>

        {/* hero */}
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-12 md:mb-16">
          <p className="v2-eyebrow mb-3 flex items-center justify-center gap-2"><Sparkles size={13} /> Nova Wrapped</p>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight text-glow mb-3">
            {stats.username}, ton histoire NovaStream
          </h1>
          {since && <p className="text-white/50 text-sm md:text-base">Depuis {since}</p>}
        </motion.div>

        {!hasData ? (
          <div className="text-center text-white/50 py-20">
            <p className="text-lg font-bold mb-2">Pas encore assez de visionnage…</p>
            <p className="text-sm">Lance quelques films et reviens voir tes stats !</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 md:gap-6 pb-4">
            {/* total time — full width */}
            <div className="md:col-span-2">
              <StatCard icon={<Clock size={13} />} label="Temps de visionnage total"
                value={fmtHours(stats.totalSeconds)}
                sub={`Soit ${Math.round(stats.totalSeconds / 60).toLocaleString('fr-FR')} minutes devant NovaStream`}
                gradient="linear-gradient(135deg, #4c1d95 0%, #1e1b4b 55%, #0f0f23 100%)" />
            </div>

            <StatCard icon={<Film size={13} />} label="Films terminés" value={stats.moviesCompleted}
              sub={`${stats.distinctTitles} titres lancés au total`} delay={0.05}
              gradient="linear-gradient(135deg, #9f1239 0%, #4c0519 60%, #1c0509 100%)" />

            <StatCard icon={<Tv size={13} />} label="Épisodes vus" value={stats.episodesWatched}
              sub={`Répartis sur ${stats.distinctShows} série${stats.distinctShows > 1 ? 's' : ''}`} delay={0.1}
              gradient="linear-gradient(135deg, #155e75 0%, #082f49 60%, #04141f 100%)" />

            {/* top shows */}
            {stats.topShows.length > 0 && (
              <StatCard icon={<Trophy size={13} />} label="Tes séries de l'année" delay={0.05}
                gradient="linear-gradient(135deg, #92400e 0%, #451a03 60%, #1a0a02 100%)">
                <RankList items={stats.topShows.slice(0, 3)} render={(s, i) => (
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {s.poster && <img src={s.poster} alt="" className="w-9 h-[52px] object-cover rounded-md ring-1 ring-white/15" />}
                    <div className="min-w-0">
                      <p className={`font-bold truncate ${i === 0 ? 'text-base' : 'text-sm text-white/80'}`}>{s.title}</p>
                      <p className="text-[11px] text-white/50">{s.episodes} épisode{s.episodes > 1 ? 's' : ''} · {fmtHours(s.seconds)}</p>
                    </div>
                  </div>
                )} />
              </StatCard>
            )}

            {/* top genres */}
            {stats.topGenres.length > 0 && (
              <StatCard icon={<Sparkles size={13} />} label="Tes genres favoris" delay={0.1}
                gradient="linear-gradient(135deg, #115e59 0%, #042f2e 60%, #021413 100%)">
                <RankList items={stats.topGenres.slice(0, 3)} render={(g, i) => (
                  <div className="flex items-baseline justify-between gap-3 min-w-0 flex-1">
                    <p className={`font-bold truncate ${i === 0 ? 'text-base' : 'text-sm text-white/80'}`}>{g.name}</p>
                    <p className="text-[11px] text-white/50 shrink-0">{fmtHours(g.seconds)}</p>
                  </div>
                )} />
              </StatCard>
            )}

            {/* top actors */}
            {stats.topActors.length > 0 && (
              <StatCard icon={<User size={13} />} label="Tes acteurs les plus vus" delay={0.05}
                gradient="linear-gradient(135deg, #581c87 0%, #2e1065 60%, #120524 100%)">
                <RankList items={stats.topActors.slice(0, 3)} render={(a, i) => (
                  <button onClick={() => navigate(`/actor/${encodeURIComponent(a.name)}`)}
                    className="flex items-baseline justify-between gap-3 min-w-0 flex-1 text-left group">
                    <p className={`font-bold truncate group-hover:underline ${i === 0 ? 'text-base' : 'text-sm text-white/80'}`}>{a.name}</p>
                    <p className="text-[11px] text-white/50 shrink-0">{fmtHours(a.seconds)}</p>
                  </button>
                )} />
              </StatCard>
            )}

            {/* habits */}
            <StatCard icon={<CalendarDays size={13} />} label="Tes habitudes" delay={0.1}
              gradient="linear-gradient(135deg, #1e3a8a 0%, #172554 60%, #0a0f24 100%)">
              <div className="mt-2 space-y-3">
                {stats.busiestDay && (
                  <p className="text-sm text-white/80">Jour préféré : <span className="font-black text-white capitalize">{stats.busiestDay}</span></p>
                )}
                <p className="text-sm text-white/80">{stats.sessions} session{stats.sessions > 1 ? 's' : ''} de lecture lancée{stats.sessions > 1 ? 's' : ''}</p>
                {stats.nightOwlPct > 0 && (
                  <p className="text-sm text-white/80 flex items-center gap-1.5">
                    <Moon size={13} className="text-indigo-300" /> {stats.nightOwlPct}% de lectures nocturnes (après 22 h)
                  </p>
                )}
              </div>
            </StatCard>

            {/* fun badge — full width */}
            <motion.div {...rise(0.1)} className="md:col-span-2 glass-panel rounded-3xl p-6 md:p-8 flex items-center gap-5">
              <span className="text-5xl md:text-6xl">{badge.emoji}</span>
              <div>
                <p className="text-xl md:text-2xl font-black tracking-tight">{badge.title}</p>
                <p className="text-sm text-white/55">{badge.sub}</p>
              </div>
            </motion.div>
          </div>
        )}
      </div>
      <FooterV2 />
    </div>
  );
}
