/* Croisement TMDB ↔ catalogue Plex.
   Sert à ne pas demander un titre qui est déjà sur Nova : on compare le
   titre normalisé (sans accents ni ponctuation) et, quand les deux années
   sont connues, on tolère un an d'écart (dates de sortie FR ≠ US). */

import { norm } from './catalog';

// Articles de tête ignorés : « Le Seigneur des anneaux » ≡ « Seigneur des anneaux »
const LEADING = /^(le|la|les|l|the|a|an|un|une|des|du|de)\s+/;

function keys(title) {
  const n = norm(title);
  if (!n) return [];
  const out = new Set([n]);
  let stripped = n;
  while (LEADING.test(stripped)) stripped = stripped.replace(LEADING, '');
  if (stripped) out.add(stripped);
  return [...out];
}

/** Index { clé → [items] } + liste à plat pour la comparaison par préfixe. */
export function buildIndex(catalog = []) {
  const idx = new Map();
  const all = [];
  for (const it of catalog) {
    const ks = keys(it.title);
    all.push({ item: it, keys: ks });
    for (const k of ks) {
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(it);
    }
  }
  idx._all = all;
  return idx;
}

// « Dune » ↔ « Dune : Première partie » : l'un commence par l'autre, à une
// frontière de mot. On n'accepte ça QUE si les deux années concordent, sinon
// « Annabelle » (2014) avalerait « Annabelle 2 » (2017).
function isPrefixOf(a, b) {
  return b.startsWith(a) && (b.length === a.length || b[a.length] === ' ');
}

/**
 * Renvoie l'item Plex correspondant à un résultat TMDB, ou null.
 * @param {Map} idx  index produit par buildIndex
 * @param {{title:string, year?:string|number, type?:string}} tmdb
 */
export function findLocal(idx, tmdb) {
  if (!idx || !tmdb?.title) return null;
  const wanted = tmdb.year ? parseInt(tmdb.year, 10) : null;
  const wantShow = tmdb.type === 'tv';

  const mine = keys(tmdb.title);

  // 1) correspondance exacte du titre
  for (const k of mine) {
    const hits = idx.get(k);
    if (!hits) continue;
    // même famille (film vs série) en priorité
    const sameKind = hits.filter((h) => (h.type === 'show') === wantShow);
    for (const h of (sameKind.length ? sameKind : hits)) {
      if (!wanted || !h.year) return h;           // une année manque : le titre suffit
      if (Math.abs(h.year - wanted) <= 1) return h;
    }
  }

  // 2) titre étendu côté Plex (sous-titre français ajouté), même année
  if (wanted && Array.isArray(idx._all)) {
    for (const { item, keys: ks } of idx._all) {
      if (!item.year || Math.abs(item.year - wanted) > 1) continue;
      if ((item.type === 'show') !== wantShow) continue;
      for (const a of mine) {
        if (a.length < 3) continue;               // « Up », « Ça »… trop court pour un préfixe
        for (const b of ks) {
          if (isPrefixOf(a, b) || isPrefixOf(b, a)) return item;
        }
      }
    }
  }

  return null;
}

export default { buildIndex, findLocal };
