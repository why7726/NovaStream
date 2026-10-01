import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Copy, Check, ArrowLeft, Ticket, User, Clock, Activity, History, Monitor, LogIn, LogOut, PlayCircle, UserPlus, Square, Eye, Globe } from 'lucide-react';

const ACTIVITY_LABELS = {
  login: tr('Connexion'),
  logout: tr('Déconnexion'),
  register: tr('Inscription'),
  visit: tr('Visite'),
  play: tr('Lecture'),
  stop: tr('Arrêt de lecture'),
  view: tr('Consultation')
};
const activityLabel = (type) => ACTIVITY_LABELS[type] || type;
import authService from '../services/authService';

import { tr, locale } from '../i18n';
function Admin() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('codes'); // 'codes' or 'users'
  const [codes, setCodes] = useState([]);
  const [users, setUsers] = useState([]);
  const [globalActivity, setGlobalActivity] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userHistory, setUserHistory] = useState({ history: [], watchHistory: [] });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(null);
  const user = authService.getUser();

  const getBase = () => import.meta.env.DEV ? 'http://localhost:5174' : '';

  useEffect(() => {
    if (!user?.isAdmin) { navigate('/'); return; }
    if (activeTab === 'codes') fetchCodes();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'activity') fetchActivity();
  }, [activeTab]);

  const fetchCodes = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getBase()}/api/admin/codes`, {
        headers: { 'Authorization': `Bearer ${authService.getToken()}` }
      });
      const data = await res.json();
      setCodes(data.codes || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getBase()}/api/admin/users`, {
        headers: { 'Authorization': `Bearer ${authService.getToken()}` }
      });
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchActivity = async () => {
    setLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${authService.getToken()}` };
      const [actRes, statsRes] = await Promise.all([
        fetch(`${getBase()}/api/admin/activity`, { headers }),
        fetch(`${getBase()}/api/admin/stats`, { headers })
      ]);
      const actData = await actRes.json();
      setGlobalActivity(actData.activity || []);
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const formatDuration = (totalSeconds) => {
    const s = Math.floor(totalSeconds || 0);
    const h = Math.floor(s / 3600);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}j ${h % 24}h`;
    if (h > 0) return tr('{0}h {1}min', [h, Math.floor((s % 3600) / 60)]);
    return tr('{0}min', [Math.floor(s / 60)]);
  };

  const fetchUserHistory = async (userId) => {
    try {
      const res = await fetch(`${getBase()}/api/admin/user/${userId}/history`, {
        headers: { 'Authorization': `Bearer ${authService.getToken()}` }
      });
      const data = await res.json();
      setUserHistory(data);
    } catch (err) { console.error(err); }
  };

  const generateCode = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${getBase()}/api/admin/codes`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authService.getToken()}` }
      });
      if (res.ok) await fetchCodes();
    } catch (err) { console.error(err); }
    finally { setGenerating(false); }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const formatTime = (iso) => {
    if (!iso) return tr('Jamais');
    const date = new Date(iso);
    return date.toLocaleString(locale(), { 
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const getActivityIcon = (type) => {
    switch(type) {
      case 'login': return <LogIn size={14} className="text-emerald-400" />;
      case 'logout': return <LogOut size={14} className="text-red-400" />;
      case 'register': return <UserPlus size={14} className="text-cyan-400" />;
      case 'play': return <PlayCircle size={14} className="text-blue-400" />;
      case 'stop': return <Square size={14} className="text-orange-400" />;
      case 'visit': return <Eye size={14} className="text-gray-400" />;
      case 'view': return <Monitor size={14} className="text-purple-400" />;
      default: return <Activity size={14} className="text-gray-400" />;
    }
  };

  if (!user?.isAdmin) return null;

  return (
    <div className="min-h-screen bg-[#060606] text-white overflow-x-hidden">
      <div className="pt-24 md:pt-32 px-4 md:px-12 max-w-5xl mx-auto pb-28">
        <header className="mb-10 text-center md:text-left">
          <h1 className="text-3xl md:text-4xl font-black mb-2 tracking-tight">{tr('Espace Admin')}</h1>
          <p className="text-gray-500 text-sm">{tr('Gestion des accès et surveillance de l\'activité NovaStream')}</p>
        </header>

        {/* Tab Navigation (Liquid Bubbles) — wraps on mobile so nothing is clipped */}
        <div className="flex flex-wrap gap-2 md:gap-3 justify-center md:justify-start mb-10">
          <button
            onClick={() => setActiveTab('codes')}
            className={`flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 rounded-full font-bold text-[13px] md:text-sm transition-all whitespace-nowrap ${
              activeTab === 'codes' ? 'bg-white text-black shadow-lg shadow-white/10' : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            <Ticket size={16} className="md:w-[18px] md:h-[18px]" /> {tr('Invitations')}
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 rounded-full font-bold text-[13px] md:text-sm transition-all whitespace-nowrap ${
              activeTab === 'users' ? 'bg-white text-black shadow-lg shadow-white/10' : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            <History size={16} className="md:w-[18px] md:h-[18px]" /> {tr('Utilisateurs')}
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 rounded-full font-bold text-[13px] md:text-sm transition-all whitespace-nowrap ${
              activeTab === 'activity' ? 'bg-white text-black shadow-lg shadow-white/10' : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            <Globe size={16} className="md:w-[18px] md:h-[18px]" /> {tr('Activité')}
          </button>
        </div>

        {activeTab === 'codes' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold">{tr('Codes d\'invitation')}</h2>
              <button onClick={generateCode} disabled={generating}
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl font-bold text-sm hover:bg-gray-100 transition-all active:scale-[0.98] disabled:opacity-50">
                {generating ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <Plus size={16} />}
                {tr('Générer un code')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {loading ? (
                <div className="col-span-full flex justify-center py-20">
                  <div className="w-10 h-10 border-2 border-white/10 border-t-white rounded-full animate-spin" />
                </div>
              ) : codes.length === 0 ? (
                <div className="col-span-full text-center py-20 bg-white/[0.02] rounded-3xl border border-white/5">
                  <Ticket size={40} className="mx-auto mb-4 text-gray-700" />
                  <p className="text-gray-500">{tr('Aucun code créé pour le moment')}</p>
                </div>
              ) : codes.map((c) => (
                <div key={c.id} className={`flex items-center justify-between p-5 rounded-2xl border transition-all ${
                  c.usedBy ? 'bg-white/[0.01] border-white/[0.04]' : 'bg-white/[0.04] border-white/[0.08] hover:border-white/20'
                }`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${c.usedBy ? 'bg-white/5' : 'bg-white/10'}`}>
                      <Ticket size={18} className={c.usedBy ? 'text-gray-600' : 'text-white'} />
                    </div>
                    <div>
                      <p className={`font-mono font-bold text-base tracking-widest ${c.usedBy ? 'text-gray-600 line-through' : 'text-white'}`}>
                        {c.code}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        {c.usedBy ? (
                          <span className="text-[11px] text-gray-500 font-medium bg-white/5 px-2 py-0.5 rounded-full">
                            {tr('Utilisé par')} {c.usedByName}
                          </span>
                        ) : (
                          <span className="text-[11px] text-emerald-400 font-bold bg-emerald-400/10 px-2 py-0.5 rounded-full">{tr('Disponible')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {!c.usedBy && (
                    <button onClick={() => copyCode(c.code)}
                      className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-gray-400 hover:text-white">
                      {copied === c.code ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && !selectedUser && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-xl font-bold mb-8">{tr('Utilisateurs inscrits')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {loading ? (
                <div className="col-span-full flex justify-center py-20">
                  <div className="w-10 h-10 border-2 border-white/10 border-t-white rounded-full animate-spin" />
                </div>
              ) : users.map((u) => (
                <div 
                  key={u.id} 
                  onClick={() => { setSelectedUser(u); fetchUserHistory(u.id); }}
                  className="group p-6 rounded-3xl bg-white/[0.03] border border-white/[0.06] hover:border-white/20 hover:bg-white/[0.05] transition-all cursor-pointer relative overflow-hidden"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl overflow-hidden bg-white/10 flex items-center justify-center text-white font-black text-xl group-hover:scale-110 transition-transform">
                      {u.avatar ? <img src={u.avatar} alt={u.username} className="w-full h-full object-cover" /> : u.username.charAt(0).toUpperCase()}
                    </div>
                    {u.isAdmin && <span className="text-[10px] font-black tracking-widest text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-md uppercase">{tr('Admin')}</span>}
                  </div>
                  <h3 className="font-bold text-lg mb-1">{u.username}</h3>
                  <p className="text-gray-500 text-xs truncate mb-4">{u.email}</p>
                  
                  <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[10px] text-gray-600 flex items-center gap-1.5 uppercase tracking-wider font-bold">
                      <Clock size={12} /> {u.lastActivity ? tr('Actif') : tr('Jamais vu')}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {formatTime(u.lastActivity)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && selectedUser && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <button onClick={() => setSelectedUser(null)} className="flex items-center gap-2 text-gray-500 hover:text-white mb-8 transition-colors text-sm font-bold">
              <ArrowLeft size={16} /> {tr('Retour à la liste')}
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Profile Card */}
              <div className="lg:col-span-1">
                <div className="p-8 rounded-[32px] bg-white/[0.04] border border-white/[0.08] text-center">
                  <div className="w-24 h-24 rounded-3xl bg-white/10 mx-auto mb-6 flex items-center justify-center text-4xl font-black">
                    {selectedUser.username.charAt(0).toUpperCase()}
                  </div>
                  <h2 className="text-2xl font-bold mb-1">{selectedUser.username}</h2>
                  <p className="text-gray-500 text-sm mb-6">{selectedUser.email}</p>
                  <div className="flex flex-col gap-3">
                    <div className="bg-white/5 p-4 rounded-2xl text-left">
                      <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">{tr('Inscription')}</p>
                      <p className="text-sm font-bold">{formatTime(selectedUser.createdAt)}</p>
                    </div>
                    <div className="bg-white/5 p-4 rounded-2xl text-left">
                      <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">{tr('Dernière activité')}</p>
                      <p className="text-sm font-bold text-emerald-400">{formatTime(selectedUser.lastActivity)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* History Lists */}
              <div className="lg:col-span-2 space-y-8">
                {/* Watch Progress */}
                <div className="p-8 rounded-[32px] bg-white/[0.02] border border-white/[0.04]">
                  <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                    <PlayCircle size={20} className="text-blue-400" /> {tr('Reprendre / En cours')}
                  </h3>
                  <div className="space-y-4">
                    {userHistory.watchHistory.length === 0 ? (
                      <p className="text-gray-600 text-sm italic">{tr('Aucun visionnage enregistré')}</p>
                    ) : userHistory.watchHistory.slice(0, 5).map((w) => (
                      <div key={w.id} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="font-bold text-sm truncate">{w.mediaTitle}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1 bg-white/10 rounded-full max-w-[100px]">
                              <div className="h-full bg-red-500 rounded-full" style={{ width: `${w.duration > 0 ? Math.min((w.currentTime/w.duration)*100, 100) : 0}%` }} />
                            </div>
                            <span className="text-[10px] text-gray-500">{w.completed ? tr('Terminé') : `${w.duration > 0 ? Math.round((w.currentTime/w.duration)*100) : 0}%`}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap">
                          {formatTime(w.updatedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Activity Log */}
                <div className="p-8 rounded-[32px] bg-white/[0.02] border border-white/[0.04]">
                  <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                    <Activity size={20} className="text-purple-400" /> {tr('Historique détaillé (100 derniers logs)')}
                  </h3>
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {userHistory.history.length === 0 ? (
                      <p className="text-gray-600 text-sm italic">{tr('Aucune activité enregistrée')}</p>
                    ) : userHistory.history.map((h) => (
                      <div key={h.id} className="flex items-center gap-4 p-3 hover:bg-white/[0.02] rounded-xl transition-colors">
                        <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                          {getActivityIcon(h.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">
                            <span className="text-gray-400">{activityLabel(h.type)}</span>
                            {h.mediaTitle && <span className="text-white ml-1">→ {h.mediaTitle}</span>}
                          </p>
                          <p className="text-[10px] text-gray-600 font-mono mt-0.5">{formatTime(h.timestamp)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Stats cards */}
            {stats && (
              <div className="mb-10">
                <h2 className="text-xl font-bold mb-5">{tr('Statistiques')}</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
                  {[
                    { icon: <Clock size={18} className="text-emerald-400" />, label: tr('Temps visionné'), value: formatDuration(stats.totalSeconds) },
                    { icon: <PlayCircle size={18} className="text-blue-400" />, label: tr('Lectures'), value: stats.totalPlays },
                    { icon: <Check size={18} className="text-green-400" />, label: tr('Terminés'), value: stats.completed },
                    { icon: <Activity size={18} className="text-purple-400" />, label: tr('Actifs (7j)'), value: `${stats.activeWeek}/${stats.totalUsers}` }
                  ].map((c, i) => (
                    <div key={i} className="p-4 md:p-5 rounded-3xl bg-white/[0.03] border border-white/[0.06]">
                      <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center mb-3">{c.icon}</div>
                      <p className="text-xl md:text-2xl font-black tracking-tight">{c.value}</p>
                      <p className="text-[11px] text-gray-500 uppercase tracking-wider font-bold mt-0.5">{c.label}</p>
                    </div>
                  ))}
                </div>

                {stats.topTitles && stats.topTitles.length > 0 && (
                  <div className="p-5 md:p-6 rounded-[28px] bg-white/[0.02] border border-white/[0.04]">
                    <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">{tr('Top contenus')}</h3>
                    <div className="space-y-3">
                      {stats.topTitles.map((t, i) => {
                        const max = stats.topTitles[0].seconds || 1;
                        return (
                          <div key={i} className="flex items-center gap-3">
                            <span className="text-xs font-mono text-gray-600 w-4 shrink-0">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-medium truncate pr-2">{t.mediaTitle}</p>
                                <span className="text-[11px] text-gray-500 font-mono shrink-0">{formatDuration(t.seconds)}</span>
                              </div>
                              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full" style={{ width: `${(t.seconds / max) * 100}%` }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <h2 className="text-xl font-bold mb-8">{tr('Activité globale (100 derniers événements)')}</h2>
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-10 h-10 border-2 border-white/10 border-t-white rounded-full animate-spin" />
              </div>
            ) : globalActivity.length === 0 ? (
              <div className="text-center py-20 bg-white/[0.02] rounded-3xl border border-white/5">
                <Globe size={40} className="mx-auto mb-4 text-gray-700" />
                <p className="text-gray-500">{tr('Aucune activité enregistrée')}</p>
              </div>
            ) : (
              <div className="space-y-2.5 p-4 md:p-6 rounded-[32px] bg-white/[0.02] border border-white/[0.04]">
                {globalActivity.map((a) => (
                  <div key={a.id} className="flex items-center gap-4 p-3 hover:bg-white/[0.03] rounded-2xl transition-colors">
                    <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                      {getActivityIcon(a.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        <span className="font-bold text-white">{a.username}</span>
                        <span className="text-gray-400 ml-2">{activityLabel(a.type)}</span>
                        {a.mediaTitle && <span className="text-gray-300 ml-1">→ {a.mediaTitle}</span>}
                      </p>
                    </div>
                    <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap shrink-0">
                      {formatTime(a.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Admin;
