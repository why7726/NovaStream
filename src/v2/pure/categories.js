/* Moteur de sous-catégories — Bêta Pure.
   Tout est calculé côté client à partir des items déjà chargés
   (aucun appel réseau supplémentaire) : genres, décennies, durées,
   notes, classification, versions CAM.
   Une rangée n'est publiée que si elle contient assez de titres. */

const MIN_ITEMS = 6;
const MAX_ROW = 30;

// Quelques genres Plex arrivent en anglais selon la source des métadonnées.
const GENRE_FR = {
  'Action': 'Action', 'Adventure': 'Aventure', 'Animation': 'Animation',
  'Comedy': 'Comédie', 'Crime': 'Policier', 'Documentary': 'Documentaire',
  'Drama': 'Drame', 'Family': 'Famille', 'Fantasy': 'Fantastique',
  'History': 'Histoire', 'Horror': 'Horreur', 'Music': 'Musique',
  'Mystery': 'Mystère', 'Romance': 'Romance', 'Science Fiction': 'Science-fiction',
  'Sci-Fi': 'Science-fiction', 'Thriller': 'Thriller', 'War': 'Guerre',
  'Western': 'Western', 'Suspense': 'Suspense', 'Sport': 'Sport',
  'Biography': 'Biographie', 'Musical': 'Comédie musicale',
};
const frGenre = (g) => GENRE_FR[g] || g;

// Formulations par genre — un titre de rangée qui donne envie, pas une étiquette.
const GENRE_TITLE = {
  'Action': 'Action non-stop',
  'Aventure': 'Grandes aventures',
  'Animation': 'Animation',
  'Comédie': 'Pour rire un peu',
  'Policier': 'Polars & enquêtes',
  'Documentaire': 'Documentaires',
  'Drame': 'Drames',
  'Famille': 'À voir en famille',
  'Fantastique': 'Fantastique',
  'Histoire': 'Films historiques',
  'Horreur': 'Frissons garantis',
  'Musique': 'Musique',
  'Mystère': 'Mystères',
  'Romance': 'Histoires d\'amour',
  'Science-fiction': 'Science-fiction',
  'Thriller': 'Thrillers sous tension',
  'Guerre': 'Films de guerre',
  'Western': 'Westerns',
  'Suspense': 'Suspense',
  'Sport': 'Sport',
  'Biographie': 'Histoires vraies',
  'Comédie musicale': 'Comédies musicales',
  // Genre maison, posé sur les titres par horrorPlus.js — la sélection
  // « ceux dont on ne se remet pas », par opposition aux frissons du samedi.
  'Horreur +': 'Horreur + · à vos risques',
};

// Ce genre-là n'est pas de Plex : il est ajouté côté client, et on le remonte
// en haut de page au lieu de le laisser tomber dans l'ordre des effectifs.
const HORREUR_PLUS = 'Horreur +';

const num = (r) => {
  if (!r) return 0;
  const m = String(r).match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const row = (title, items, opts = {}) => {
  if (!items || items.length < (opts.min || MIN_ITEMS)) return null;
  return { title, items: items.slice(0, MAX_ROW), variant: opts.variant || 'poster' };
};

/**
 * Construit les rangées de sous-catégories.
 * @param {Array}  items    titres (films et/ou séries) déjà formatés
 * @param {Object} opts     { camIds:Set, exclude:Set(ids déjà mis en avant), kind:'movie'|'show'|'mixed' }
 */
export function buildCategories(items = [], opts = {}) {
  const { camIds = null, kind = 'mixed' } = opts;
  if (!items.length) return [];

  const pool = items.filter((it) => it && it.id);
  const rows = [];
  const seenTitle = new Set();
  const push = (r) => { if (r && !seenTitle.has(r.title)) { seenTitle.add(r.title); rows.push(r); } };

  // ── Genres, du plus fourni au moins fourni ──────────────────────
  const byGenre = new Map();
  pool.forEach((it) => {
    (it.genres || []).forEach((raw) => {
      const g = frGenre(raw);
      if (!byGenre.has(g)) byGenre.set(g, []);
      byGenre.get(g).push(it);
    });
  });
  const genres = [...byGenre.entries()]
    .filter(([, list]) => list.length >= MIN_ITEMS)
    .sort((a, b) => b[1].length - a[1].length);

  // ── Rangées "d'humeur", intercalées entre les genres ────────────
  const topRated = pool.filter((it) => num(it.rating) >= 7.5).sort((a, b) => num(b.rating) - num(a.rating));
  const hidden = pool.filter((it) => num(it.rating) >= 7 && it.year && it.year < 2015);
  const short = pool.filter((it) => it.rawDuration > 0 && it.rawDuration < 95 * 60000);
  const long = pool.filter((it) => it.rawDuration >= 145 * 60000);
  const family = pool.filter((it) => /^(G|TV-G|TV-Y|TV-Y7|PG|TV-PG|U|TP|-?10|fr\/-?10|fr\/u)$/i.test(it.contentRating || ''));
  const adult = pool.filter((it) => /(NC-17|R|TV-MA|18|16)/i.test(it.contentRating || ''));
  const cam = camIds ? pool.filter((it) => camIds.has(String(it.id))) : [];

  const decade = (from, to) => pool.filter((it) => it.year >= from && it.year <= to).sort((a, b) => b.year - a.year);
  const d2020 = decade(2020, 2100);
  const d2010 = decade(2010, 2019);
  const d2000 = decade(2000, 2009);
  const d1990 = decade(1990, 1999);
  const d1980 = decade(1980, 1989);
  const older = pool.filter((it) => it.year && it.year < 1980).sort((a, b) => b.year - a.year);

  const kindWord = kind === 'show' ? 'séries' : kind === 'movie' ? 'films' : 'titres';

  push(row('Les mieux notés', topRated));
  // 3 titres suffisent : c'est une sélection, pas un genre à remplir. L'ordre
  // vient de la sélection elle-même (`hpRank`), pas de la note ni du hasard.
  const horreurPlus = [...(byGenre.get(HORREUR_PLUS) || [])].sort((a, b) => (a.hpRank ?? 999) - (b.hpRank ?? 999));
  push(row(GENRE_TITLE[HORREUR_PLUS], horreurPlus, { min: 3 }));
  push(row(`Sortis depuis 2020`, d2020));

  // on alterne : 2 genres, 1 humeur, 2 genres, 1 humeur…
  const moods = [
    row('Courts : moins de 1 h 35', short),
    row('Années 2010', d2010),
    row('Longs formats : plus de 2 h 25', long),
    row('Années 2000', d2000),
    row('À voir en famille', family),
    row('Les années 90', d1990),
    row(`Perles oubliées`, shuffle(hidden)),
    row('Les années 80', d1980),
    row('Réservé aux adultes', adult),
    row('Avant 1980 · les classiques', older),
    row('Versions CAM', cam, { min: 3 }),
    row(`Au hasard ce soir`, shuffle(pool), { min: 8 }),
  ].filter(Boolean);

  let mi = 0;
  genres.forEach(([g, list], i) => {
    push(row(GENRE_TITLE[g] || g, list.sort((a, b) => num(b.rating) - num(a.rating))));
    if (i % 2 === 1 && mi < moods.length) push(moods[mi++]);
  });
  while (mi < moods.length) push(moods[mi++]);

  // Si la bibliothèque est minuscule, au moins un fourre-tout
  if (!rows.length) push(row(`Tous les ${kindWord}`, pool, { min: 1 }));

  return rows;
}

export default buildCategories;
