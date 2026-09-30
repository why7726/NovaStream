import authService from './authService';

const getBase = () => import.meta.env.DEV ? 'http://localhost:5174' : '';

const progressService = {
  async saveProgress(mediaId, currentTime, duration, metadata = {}) {
    const token = authService.getToken();
    if (!token) return;
    try {
      await fetch(`${getBase()}/api/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ mediaId, currentTime, duration, ...metadata })
      });
    } catch (err) { console.error('Progress save error:', err); }
  },

  async getProgress(mediaId) {
    const token = authService.getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${getBase()}/api/progress/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      return data.progress;
    } catch { return null; }
  },

  async getContinueWatching() {
    const token = authService.getToken();
    if (!token) return [];
    try {
      const res = await fetch(`${getBase()}/api/progress/list/continue`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      return data.items || [];
    } catch { return []; }
  },
  
  async deleteProgress(mediaId) {
    const token = authService.getToken();
    if (!token) return;
    try {
      await fetch(`${getBase()}/api/progress/${mediaId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (err) { console.error('Progress delete error:', err); }
  },

  /* Écarter une carte de « Reprendre » sans rien changer à la progression :
     ce n'est pas « je l'ai vu », juste « ne me le propose plus ». */
  async hideFromContinue(mediaId) {
    const token = authService.getToken();
    if (!token) return;
    try {
      await fetch(`${getBase()}/api/continue/${mediaId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (err) { console.error('Continue hide error:', err); }
  },

  async getHistory() {
    const token = authService.getToken();
    if (!token) return [];
    try {
      const res = await fetch(`${getBase()}/api/history`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      return data.items || [];
    } catch { return []; }
  },

  async getWatchedIds() {
    const token = authService.getToken();
    if (!token) return [];
    try {
      const res = await fetch(`${getBase()}/api/progress/all/completed`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      return data.watchedIds || [];
    } catch { return []; }
  }
};

export default progressService;
