import authService from './authService';

// Favorites are stored server-side (per user) so they sync across devices.
const getBase = () => import.meta.env.DEV ? 'http://localhost:5174' : '';

const authHeaders = () => {
  const token = authService.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const favoriteService = {
  async getFavoriteIds() {
    const token = authService.getToken();
    if (!token) return [];
    try {
      const res = await fetch(`${getBase()}/api/favorites/ids`, { headers: authHeaders() });
      const data = await res.json();
      return data.ids || [];
    } catch (e) {
      console.error('Failed to get favorites', e);
      return [];
    }
  },

  async getFavorites() {
    const token = authService.getToken();
    if (!token) return [];
    try {
      const res = await fetch(`${getBase()}/api/favorites`, { headers: authHeaders() });
      const data = await res.json();
      return data.favorites || [];
    } catch (e) {
      console.error('Failed to get favorites', e);
      return [];
    }
  },

  async isFavorite(id) {
    const ids = await this.getFavoriteIds();
    return ids.includes(id);
  },

  async addFavorite(id, meta = {}) {
    if (!authService.getToken()) return false;
    try {
      await fetch(`${getBase()}/api/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          mediaId: id,
          mediaTitle: meta.title,
          mediaPoster: meta.poster,
          mediaType: meta.type
        })
      });
      return true;
    } catch (e) {
      console.error('Failed to add favorite', e);
      return false;
    }
  },

  async removeFavorite(id) {
    if (!authService.getToken()) return false;
    try {
      await fetch(`${getBase()}/api/favorites/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      return true;
    } catch (e) {
      console.error('Failed to remove favorite', e);
      return false;
    }
  },

  // currentlyFav lets callers avoid an extra round-trip; returns the new state.
  async toggleFavorite(id, currentlyFav, meta = {}) {
    if (currentlyFav) {
      await this.removeFavorite(id);
      return false;
    }
    await this.addFavorite(id, meta);
    return true;
  }
};

export default favoriteService;
