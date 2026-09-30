const getBase = () => import.meta.env.DEV ? 'http://localhost:5174' : '';

const authService = {
  async login(email, password) {
    const res = await fetch(`${getBase()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur de connexion');
    localStorage.setItem('nova_token', data.token);
    localStorage.setItem('nova_user', JSON.stringify(data.user));
    return data.user;
  },

  async register(username, email, password, inviteCode) {
    const res = await fetch(`${getBase()}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, inviteCode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur d'inscription");
    localStorage.setItem('nova_token', data.token);
    localStorage.setItem('nova_user', JSON.stringify(data.user));
    return data.user;
  },

  // Session ouverte par un autre chemin que login/register (assistant de premier démarrage).
  saveSession({ token, user }) {
    localStorage.setItem('nova_token', token);
    localStorage.setItem('nova_user', JSON.stringify(user));
  },

  async verify() {
    const token = localStorage.getItem('nova_token');
    if (!token) return null;
    try {
      const res = await fetch(`${getBase()}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { this.logout(); return null; }
      const data = await res.json();
      localStorage.setItem('nova_user', JSON.stringify(data.user));
      return data.user;
    } catch { this.logout(); return null; }
  },

  async updateAvatar(dataUrl) {
    const token = localStorage.getItem('nova_token');
    if (!token) return false;
    try {
      const res = await fetch(`${getBase()}/api/profile/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ avatar: dataUrl })
      });
      if (!res.ok) return false;
      const user = this.getUser() || {};
      user.avatar = dataUrl || null;
      localStorage.setItem('nova_user', JSON.stringify(user));
      return true;
    } catch { return false; }
  },

  getToken() { return localStorage.getItem('nova_token'); },
  getUser() { try { return JSON.parse(localStorage.getItem('nova_user')); } catch { return null; } },
  isLoggedIn() { return !!localStorage.getItem('nova_token'); },

  // ── Short-lived, read-only "media token" for URL params (?nova=) ──
  // Keeps the 30-day session JWT out of <img>/<video> URLs (history/logs/referrer).
  _media: { token: null, exp: 0 },
  _mediaTimer: null,
  async refreshMediaToken() {
    const main = this.getToken();
    const u = this.getUser();
    if (!main || u?.guest) { this._media = { token: null, exp: 0 }; return null; }
    try {
      const res = await fetch(`${getBase()}/api/media-token`, { headers: { Authorization: `Bearer ${main}` } });
      if (!res.ok) return null;
      const d = await res.json();
      this._media = { token: d.token, exp: Date.now() + (d.ttlMs || 10800000) - 300000 }; // refresh 5min early
      return d.token;
    } catch { return null; }
  },
  getMediaToken() {
    const u = this.getUser();
    if (u?.guest) return this.getToken(); // guests already use a short-lived, session-scoped token
    if (this._media.token && Date.now() < this._media.exp) return this._media.token;
    this.refreshMediaToken(); // fire-and-forget; fall back to the main token until it lands
    return this.getToken();
  },
  initMediaToken() {
    this.refreshMediaToken();
    if (this._mediaTimer) clearInterval(this._mediaTimer);
    this._mediaTimer = setInterval(() => this.refreshMediaToken(), 2.5 * 3600 * 1000);
  },

  // Revoke every token of this account server-side, then log out locally.
  async logoutAll() {
    const token = this.getToken();
    if (token) {
      try { await fetch(`${getBase()}/api/auth/logout-all`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch {}
    }
    this.logout();
  },

  logout() {
    // Log logout if token exists
    const token = localStorage.getItem('nova_token');
    if (token) {
      import('./activityService').then(m => m.default.log('logout'));
    }
    this._media = { token: null, exp: 0 };
    if (this._mediaTimer) { clearInterval(this._mediaTimer); this._mediaTimer = null; }
    localStorage.removeItem('nova_token');
    localStorage.removeItem('nova_user');
  }
};

export default authService;
