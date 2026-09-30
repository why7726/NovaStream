/* Catalogue partagé — Bêta Pure.
   Charge une fois toutes les bibliothèques (via le cache 10 min de plexService)
   et sert de source unique pour la recherche instantanée, les filtres et les
   suggestions. Aucune de ces trois fonctions ne refait d'appel réseau. */

import plexService from '../../services/plexService';

let cache = null;      // { at, items }
let inflight = null;
const TTL = 10 * 60 * 1000;

/** Tout le catalogue (films + séries + animés), dédoublonné. */
export async function getCatalog() {
  if (cache && Date.now() - cache.at < TTL) return cache.items;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const libs = await plexService.getLibraries();
      const lists = await Promise.all(
        libs.map((l) => plexService.getLibraryItems(l.key).catch(() => []))
      );
      const seen = new Set();
      const items = [];
      for (const list of lists) {
        for (const it of list) {
          if (it && it.id && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
        }
      }
      cache = { at: Date.now(), items };
      return items;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function getCatalogSync() {
  return cache && Date.now() - cache.at < TTL ? cache.items : null;
}

/* ── Normalisation : minuscules, sans accents, sans ponctuation ───── */
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

export function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Distance de Levenshtein bornée : au-delà de `max`, on abandonne tôt.
   Sert à pardonner les fautes de frappe ("intersteller" → "interstellar"). */
function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Recherche locale tolérante aux fautes.
 * Score : préfixe exact > mot entier > sous-chaîne > faute de frappe,
 * bonifié par la note et les correspondances acteur/genre.
 */
export function searchCatalog(items, query, limit = 40) {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(' ').filter(Boolean);
  const tol = q.length >= 6 ? 2 : q.length >= 4 ? 1 : 0;

  const scored = [];
  for (const it of items) {
    const title = norm(it.title);
    const alt = norm(it.grandparentTitle || '');
    let score = 0;

    if (title === q) score = 1000;
    else if (title.startsWith(q)) score = 800;
    else if (title.includes(q)) score = 620;
    else if (alt && alt.includes(q)) score = 560;
    else {
      // tous les mots présents (ordre libre)
      const titleWords = title.split(' ');
      const allIn = words.every((w) => titleWords.some((tw) => tw.startsWith(w)));
      if (allIn) score = 500;
      else if (tol > 0) {
        // faute de frappe : sur le titre entier ou sur un mot du titre
        let d = editDistance(q, title, tol);
        if (d > tol) {
          d = tol + 1;
          for (const tw of titleWords) {
            if (Math.abs(tw.length - q.length) > tol) continue;
            const dd = editDistance(q, tw, tol);
            if (dd < d) d = dd;
          }
        }
        if (d <= tol) score = 420 - d * 60;
      }
    }

    // genres et acteurs, en secours
    if (!score) {
      if ((it.genres || []).some((g) => norm(g).includes(q))) score = 240;
      else if ((it.cast || []).some((c) => norm(c.name).includes(q))) score = 220;
    }

    if (score) {
      const rating = parseFloat(String(it.rating || '').replace(/[^\d.]/g, '')) || 0;
      scored.push({ it, score: score + rating * 2 });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.it);
}

/** Nouveauté = ajoutée il y a moins de `days` jours (addedAt en secondes). */
export function isNew(item, days = 7) {
  if (!item?.addedAt) return false;
  return Date.now() / 1000 - item.addedAt < days * 86400;
}

export default { getCatalog, getCatalogSync, searchCatalog, norm, isNew };
