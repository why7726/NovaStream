import authService from './authService';

const getBase = () => import.meta.env.DEV ? 'http://localhost:5174' : '';

const activityService = {
  async log(type, mediaId = null, mediaTitle = null, metadata = {}) {
    const token = authService.getToken();
    if (!token) return;
    try {
      await fetch(`${getBase()}/api/activity/log`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ type, mediaId, mediaTitle, metadata })
      });
    } catch (err) { /* silent fail in production */ }
  }
};

export default activityService;
