import authService from '../../services/authService';

const base = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');
const auth = () => ({ Authorization: `Bearer ${authService.getToken()}` });

const requestService = {
  async search(q) {
    const res = await fetch(`${base()}/api/requests/search?q=${encodeURIComponent(q)}`, { headers: auth() });
    if (!res.ok) return [];
    return (await res.json()).results || [];
  },
  /** Parcourir par thème (genre TMDB) au lieu de chercher un titre précis. */
  async browse({ genre, type = 'movie', page = 1 } = {}) {
    const qs = new URLSearchParams({ genre: String(genre), type, page: String(page) });
    const res = await fetch(`${base()}/api/requests/browse?${qs}`, { headers: auth() });
    if (!res.ok) return { results: [], pages: 1 };
    return res.json();
  },
  /** Tous les films de la saga d'un titre TMDB (« tous les Evil Dead »). */
  async collection(id) {
    const res = await fetch(`${base()}/api/requests/collection/${id}`, { headers: auth() });
    if (!res.ok) return [];
    return (await res.json()).films || [];
  },
  async details(type, tmdbId) {
    const res = await fetch(`${base()}/api/requests/details/${type}/${tmdbId}`, { headers: auth() });
    if (!res.ok) throw new Error('Détails indisponibles');
    return res.json();
  },
  async create(item) {
    const res = await fetch(`${base()}/api/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify(item),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Demande impossible');
    return res.json();
  },
  async list(all = false) {
    const res = await fetch(`${base()}/api/requests${all ? '?all=1' : ''}`, { headers: auth() });
    if (!res.ok) return { requests: [], admin: false };
    return res.json();
  },
  async setStatus(id, status) {
    await fetch(`${base()}/api/requests/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ status }),
    });
  },
  async remove(id) {
    await fetch(`${base()}/api/requests/${id}`, { method: 'DELETE', headers: auth() });
  },
};

export default requestService;
