/* ══════════════════════════════════════════════════════════════════
   « Horreur + » — l'horreur qui laisse des traces

   Aucun algorithme ne sait faire ce tri : pour Plex comme pour TMDB,
   Scream, Conjuring et Martyrs portent la même étiquette « Horror ».
   La sélection est donc FAITE À LA MAIN, d'après ce qui revient
   systématiquement dans les discussions de fans d'horreur extrême
   (r/horror, r/HorrorMovies, les listes « most disturbing films »).

   Critère : même quelqu'un qui enchaîne les films d'horreur en sort
   secoué — dérangeant, malsain, ou d'une tension qu'on ne supporte pas
   jusqu'au bout. Les licences à jumpscares (Conjuring, Insidious,
   Annabelle, Paranormal Activity…) y figurent aussi : si le public les
   désigne comme terrifiantes, elles ont leur place.
   Elles sont simplement placées EN FIN de liste, et l'ordre de la liste
   est celui de la rangée — le noyau dur reste donc en premier.

   Chaque entrée est identifiée par son id TMDB (relevé sur les GUID de
   la bibliothèque : aucune ambiguïté possible, même si le titre Plex
   change), avec le titre + l'année en secours pour les films qui
   arriveront plus tard.
   ══════════════════════════════════════════════════════════════════ */

/** { tmdb, t: titre de référence, y: année, note: pourquoi il est là } */
export const LISTE = [
  // ── Le noyau dur : les titres cités dès qu'on parle de films traumatisants
  { tmdb: 9539,    t: 'Martyrs', y: 2008 },
  { tmdb: 5336,    t: 'Salò ou les 120 Journées de Sodome', y: 1975 },
  { tmdb: 8689,    t: 'Cannibal Holocaust', y: 1980 },
  { tmdb: 979,     t: 'Irréversible', y: 2002 },
  { tmdb: 63197,   t: 'Megan Is Missing', y: 2011 },
  { tmdb: 38410,   t: 'The Poughkeepsie Tapes', y: 2007 },
  { tmdb: 74997,   t: 'The Human Centipede 2', y: 2011 },
  { tmdb: 37169,   t: 'The Human Centipede', y: 2009 },
  { tmdb: 94365,   t: 'The Human Centipede 3', y: 2015 },
  { tmdb: 9696,    t: 'Ichi the Killer', y: 2001 },
  { tmdb: 43947,   t: 'I Spit on Your Grave', y: 2010 },
  { tmdb: 207768,  t: 'I Spit on Your Grave 2', y: 2013 },

  // ── L'extrémité française (la « new french extremity »)
  { tmdb: 13492,   t: 'Frontière(s)', y: 2007 },
  { tmdb: 12517,   t: 'Calvaire', y: 2004 },
  { tmdb: 13312,   t: 'À l\'intérieur', y: 2007 },
  { tmdb: 10226,   t: 'Haute Tension', y: 2003 },
  { tmdb: 393519,  t: 'Grave', y: 2017 },

  // ── Torture / survie sans échappatoire
  { tmdb: 1690,    t: 'Hostel', y: 2006 },
  { tmdb: 1691,    t: 'Hostel, chapitre II', y: 2007 },
  { tmdb: 176,     t: 'Saw', y: 2004 },
  { tmdb: 313922,  t: 'Green Room', y: 2016 },
  { tmdb: 9392,    t: 'The Descent', y: 2005 },
  { tmdb: 424121,  t: 'Le Bon apôtre', y: 2018 },

  // ── Gore total assumé
  { tmdb: 420634,  t: 'Terrifier', y: 2016 },
  { tmdb: 663712,  t: 'Terrifier 2', y: 2022 },
  { tmdb: 1034541, t: 'Terrifier 3', y: 2024 },
  { tmdb: 776797,  t: 'The Sadness', y: 2021 },
  { tmdb: 713704,  t: 'Evil Dead Rise', y: 2023 },
  { tmdb: 1214509, t: 'In a Violent Nature', y: 2024 },

  // ── Malaise et effroi lents — ceux dont on ne se remet pas
  { tmdb: 493922,  t: 'Hérédité', y: 2018 },
  { tmdb: 530385,  t: 'Midsommar', y: 2019 },
  { tmdb: 472269,  t: 'Possum', y: 2018 },
  { tmdb: 994143,  t: 'Skinamarink', y: 2023 },
  { tmdb: 27374,   t: 'Lake Mungo', y: 2008 },
  { tmdb: 21506,   t: 'Noroi: The Curse', y: 2005 },
  { tmdb: 284303,  t: 'Goodnight Mommy', y: 2014 },
  { tmdb: 833339,  t: 'Ne dis rien', y: 2022 },
  // (The Substance a été retirée : plus body horror satirique que
  //  terrifiante.)
  { tmdb: 82507,   t: 'Sinister', y: 2012 },
  { tmdb: 397243,  t: 'The Jane Doe Identity', y: 2016 },
  { tmdb: 310131,  t: 'The Witch', y: 2015 },
  { tmdb: 270303,  t: 'It Follows', y: 2014 },
  { tmdb: 8329,    t: '[Rec]', y: 2007 },
  { tmdb: 1008042, t: 'La Main', y: 2022 },
  { tmdb: 1151031, t: 'Bring Her Back', y: 2025 },
  { tmdb: 913290,  t: 'Barbare', y: 2022 },

  /* ── Les grosses trouilles grand public
        Ces licences font sursauter tout le
        monde et sont citées comme terrifiantes, même si elles jouent sur le
        sursaut plutôt que sur le malaise. Elles restent en fin de liste, donc
        derrière le noyau dur dans la rangée. */
  { tmdb: 138843,  t: 'Conjuring : Les Dossiers Warren', y: 2013 },
  { tmdb: 259693,  t: 'Conjuring 2 : Le Cas Enfield', y: 2016 },
  { tmdb: 396422,  t: 'Annabelle 2 : La Création du Mal', y: 2017 },
  { tmdb: 49018,   t: 'Insidious', y: 2010 },
  { tmdb: 91586,   t: 'Insidious : Chapitre 2', y: 2013 },
  { tmdb: 23827,   t: 'Paranormal Activity', y: 2007 },
  { tmdb: 346364,  t: 'Ça', y: 2017 },
  { tmdb: 565,     t: 'Le Cercle : The Ring', y: 2002 },
  { tmdb: 242224,  t: 'Mister Babadook', y: 2014 },
  { tmdb: 882598,  t: 'Smile', y: 2022 },
  { tmdb: 694,     t: 'Shining', y: 1980 },
  /* Volontairement PAS retenues : les suites de remplissage (Conjuring 3 et 4,
     Insidious 3/4/5, Annabelle 1 et 3, La Nonne 1 et 2, Paranormal Activity
     2 à 6, Ça chapitre 2, Smile 2, Sinister 2, Esther). Elles font peut-être
     sursauter, mais elles ne « valent pas le titre » — et une rangée diluée
     ne veut plus rien dire. Elles restent dans « Frissons garantis ». */

  /* ── Pas encore sur Nova : ils rejoindront la rangée tout seuls le jour
        où ils arrivent. Les ids ci-dessous ont été relevés sur TMDB, pas
        devinés — un id faux collerait l'étiquette à un film au hasard. */
  { tmdb: 73861,   t: 'A Serbian Film', y: 2010 },
  { tmdb: 10234,   t: 'Funny Games', y: 1997 },
  { tmdb: 11075,   t: 'Audition', y: 2000 },
  { tmdb: 17609,   t: 'Antichrist', y: 2009 },
  { tmdb: 18912,   t: 'Angst', y: 1983 },
  { tmdb: 11822,   t: 'Nekromantik', y: 1988 },
  { tmdb: 25998,   t: 'Camp 731', y: 1988 },                 // Men Behind the Sun
  { tmdb: 15356,   t: 'The Girl Next Door', y: 2007 },
  { tmdb: 23966,   t: 'Deadgirl', y: 2008 },
  { tmdb: 84194,   t: 'Excision', y: 2012 },
  { tmdb: 13510,   t: 'Eden Lake', y: 2008 },
  { tmdb: 9885,    t: 'Wolf Creek', y: 2005 },
  { tmdb: 30497,   t: 'The Texas Chain Saw Massacre', y: 1974 },
  { tmdb: 15516,   t: 'La Dernière Maison sur la gauche', y: 1972 },
  { tmdb: 74725,   t: 'Kill List', y: 2011 },
  { tmdb: 744857,  t: 'When Evil Lurks', y: 2023 },
  { tmdb: 489430,  t: 'Terrified', y: 2018 },                // Aterrados
  { tmdb: 938614,  t: 'Late Night with the Devil', y: 2024 },
  { tmdb: 254194,  t: 'Starry Eyes', y: 2014 },
  { tmdb: 334394,  t: 'Baskın: Karabasan', y: 2015 },
  { tmdb: 864370,  t: 'Incantation', y: 2022 },
  { tmdb: 293670,  t: 'The Strangers', y: 2016 },            // Goksung / The Wailing
  { tmdb: 508642,  t: 'Gonjiam: Haunted Asylum', y: 2018 },
  { tmdb: 572468,  t: 'Impetigore', y: 2019 },
  { tmdb: 467012,  t: 'Satan\'s Slaves', y: 2017 },
];

/* ── Croisement avec la bibliothèque ───────────────────────────────
   D'abord l'id TMDB (exact), sinon le titre normalisé + l'année à un an
   près : un film ajouté sans métadonnées TMDB est rattrapé au titre. */

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
export function norm(s) {
  return (s || '')
    .toLowerCase().normalize('NFD').replace(DIACRITICS, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {Array<{ratingKey:string|number, title:string, originalTitle?:string, year?:number, tmdbId?:string|number}>} biblio
 * @returns {{ids:string[], manquants:Array}} identifiants Plex trouvés + entrées absentes
 */
export function croiser(biblio = []) {
  const parTmdb = new Map();
  const parTitre = new Map();
  for (const m of biblio) {
    if (m.tmdbId) parTmdb.set(String(m.tmdbId), m);
    for (const t of [m.title, m.originalTitle]) {
      const n = norm(t);
      if (!n) continue;
      if (!parTitre.has(n)) parTitre.set(n, []);
      parTitre.get(n).push(m);
    }
  }

  const ids = [];
  const vus = new Set();
  const manquants = [];
  for (const f of LISTE) {
    let hit = parTmdb.get(String(f.tmdb));
    if (!hit) {
      const cands = parTitre.get(norm(f.t)) || [];
      hit = cands.find((c) => !c.year || !f.y || Math.abs(c.year - f.y) <= 1) || null;
    }
    if (hit) {
      const id = String(hit.ratingKey);
      if (!vus.has(id)) { vus.add(id); ids.push(id); }
    } else {
      manquants.push({ tmdb: f.tmdb, title: f.t, year: f.y });
    }
  }
  return { ids, manquants };
}

export default { LISTE, croiser, norm };
