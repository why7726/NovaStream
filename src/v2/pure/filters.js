/* Application des filtres — Bêta Pure.
   Tout est calculé sur les items déjà en mémoire : instantané, hors ligne. */

const num = (r) => {
  const m = String(r || '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
};

export const EMPTY = { genre: null, decade: null, length: null, rating: null, unseen: null, sort: null };

export function isFiltered(f) {
  return !!(f.genre || f.decade || f.length || f.rating || f.unseen || f.sort);
}

/** Genres présents dans un lot, triés par fréquence — « Horreur + » en tête. */
export function genresOf(items) {
  const count = new Map();
  items.forEach((it) => (it.genres || []).forEach((g) => count.set(g, (count.get(g) || 0) + 1)));
  const liste = [...count.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([name, c]) => ({ name, count: c }));

  // Sélection maison : elle est peu fournie par nature, mais c'est celle
  // qu'on vient chercher — elle ne doit pas se perdre en bas de la liste.
  const i = liste.findIndex((g) => g.name === 'Horreur +');
  if (i > 0) liste.unshift(liste.splice(i, 1)[0]);
  return liste;
}

export function applyFilters(items, f, watchedIds) {
  let out = items;

  if (f.genre) out = out.filter((it) => (it.genres || []).includes(f.genre));

  if (f.decade) {
    out = out.filter((it) => {
      const y = it.year || 0;
      if (f.decade === 'old') return y > 0 && y < 1980;
      const from = parseInt(f.decade, 10);
      return f.decade === '2020' ? y >= 2020 : y >= from && y < from + 10;
    });
  }

  if (f.length) {
    out = out.filter((it) => {
      const min = (it.rawDuration || 0) / 60000;
      if (!min) return false;
      if (f.length === 'short') return min < 95;
      if (f.length === 'long') return min >= 145;
      return min >= 95 && min < 145;
    });
  }

  if (f.rating) out = out.filter((it) => num(it.rating) >= f.rating);

  if (f.unseen && watchedIds) out = out.filter((it) => !watchedIds.has(it.id));

  if (f.sort) {
    const copy = [...out];
    if (f.sort === 'recent') copy.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    else if (f.sort === 'rating') copy.sort((a, b) => num(b.rating) - num(a.rating));
    else if (f.sort === 'year') copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    else if (f.sort === 'az') copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    out = copy;
  }

  return out;
}

export default { applyFilters, genresOf, isFiltered, EMPTY };
