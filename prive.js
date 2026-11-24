/* ══════════════════════════════════════════════════════════════════
   Bibliothèques privées — celles que l'administrateur n'a PAS cochées

   Films de famille, contenu adulte… : pour Nova, ces bibliothèques
   n'existent pas. Les masquer du menu ne suffirait pas — la recherche,
   l'accueil, les recommandations et l'assistant parcourent tout le
   serveur, et les identifiants Plex se suivent (…/metadata/1234, 1235) :
   n'importe qui pourrait les deviner.

   Donc, côté serveur :
     · toute réponse Plex est filtrée (listes, hubs, recherche, sections) ;
     · tout chemin qui vise un de leurs titres (fiche, image, fichier,
       lecture) est refusé. Pour ça on relève, toutes les 10 minutes, les
       identifiants de leurs titres, saisons, séries et fichiers.
   ══════════════════════════════════════════════════════════════════ */

/**
 * @param lister  (cheminPlex) => Promise<Metadata[]> — lecture NON filtrée du
 *                serveur (Plex ou Jellyfin traduit), pour relever ce qu'il faut bloquer
 * @param actif   () => boolean — un serveur est-il relié ?
 * @param exclues () => string[] — clés des bibliothèques décochées
 * @param adulte  () => string[] — films / séries du serveur classés +18 par l'admin
 * @param accesAdulte () => boolean — la personne qui fait la requête y a-t-elle droit ?
 */
export function creerFiltrePrive({ lister, actif, exclues, adulte = () => [], accesAdulte = () => false }) {
  let titres = new Set();     // ratingKey (films, épisodes, saisons, séries)
  let fichiers = new Set();   // id des « parts » (fichiers vidéo)
  let pret = true;

  /* Titres classés +18 (venus de Plex / Jellyfin) : rangés dans l'onglet +18.
     Ils sortent de TOUTES les listes (accueil, bibliothèques, recherche) ; leur
     fiche, leurs épisodes et leurs fichiers ne s'ouvrent qu'avec l'accès +18. */
  let adTitres = new Set();
  let adFichiers = new Set();
  let adMeta = [];            // fiches des titres classés (pour l'onglet +18)

  const sections = () => new Set((exclues() || []).map(String));

  async function rafraichirAdulte() {
    const ids = [...new Set((adulte() || []).map(String))];
    if (!ids.length || !actif()) { adTitres = new Set(); adFichiers = new Set(); adMeta = []; return; }
    const t = new Set();
    const f = new Set();
    const metas = [];
    const noter = (m) => {
      for (const k of [m.ratingKey, m.parentRatingKey, m.grandparentRatingKey]) if (k) t.add(String(k));
      for (const media of m.Media || []) for (const p of media.Part || []) if (p.id) f.add(String(p.id));
    };
    for (const id of ids) {
      t.add(id);
      try {
        const [m] = await lister(`/library/metadata/${id}`);
        if (!m) continue;
        noter(m);
        metas.push(m);
        if (m.type === 'show') {
          for (const s of await lister(`/library/metadata/${id}/children`).catch(() => [])) noter(s);
          for (const e of await lister(`/library/metadata/${id}/allLeaves`).catch(() => [])) noter(e);
        }
      } catch (e) { console.warn('[+18] titre illisible', id, e.message); }
    }
    adTitres = t; adFichiers = f; adMeta = metas;
    if (t.size) console.log(`[+18] ${ids.length} titre(s) du serveur classé(s) +18`);
  }

  /** Relève les identifiants à bloquer. À appeler après un changement de réglage. */
  async function rafraichir() {
    await rafraichirAdulte().catch((e) => console.warn('[+18] relevé impossible :', e.message));
    const secs = [...sections()];
    if (!secs.length || !actif()) { titres = new Set(); fichiers = new Set(); pret = true; return; }
    pret = false;
    const t = new Set();
    const f = new Set();
    try {
      for (const key of secs) {
        // type=1 films, type=2 séries, type=3 saisons, type=4 épisodes : le
        // paramètre est ignoré quand il ne correspond pas à la section.
        for (const type of [1, 2, 3, 4]) {
          const items = await lister(`/library/sections/${key}/all?type=${type}&includeGuids=0`).catch(() => []);
          for (const m of items) {
            for (const k of [m.ratingKey, m.parentRatingKey, m.grandparentRatingKey]) if (k) t.add(String(k));
            for (const media of m.Media || []) for (const p of media.Part || []) if (p.id) f.add(String(p.id));
          }
        }
      }
      titres = t;
      fichiers = f;
      pret = true;
      if (t.size) console.log(`[Privé] ${secs.length} bibliothèque(s) exclue(s), ${t.size} titres bloqués`);
    } catch (e) {
      // En cas d'échec on garde l'ancienne liste. Les sections elles-mêmes
      // restent bloquées quoi qu'il arrive (voir cheminInterdit).
      console.warn('[Privé] relevé impossible :', e.message);
    }
  }

  const sectionExclue = (id) => id != null && sections().has(String(id));

  /** Ce chemin vise-t-il directement un titre classé +18 ? */
  function visePlus18(p) {
    if (!adTitres.size) return false;
    for (const m of p.matchAll(/\/library\/metadata\/(\d+)/g)) if (adTitres.has(m[1])) return true;
    for (const m of p.matchAll(/\/library\/parts\/(\d+)/g)) if (adFichiers.has(m[1])) return true;
    return false;
  }

  /** Ce chemin Plex vise-t-il un contenu privé ou +18 interdit à la personne ? (déjà décodé ou non, on décode) */
  function cheminInterdit(chemin) {
    let p = String(chemin || '');
    try { p = decodeURIComponent(p); } catch { /* chemin brut */ }
    if (visePlus18(p) && !accesAdulte()) return true;
    if (!sections().size) return false;
    const sec = p.match(/\/library\/sections\/(\d+)/);
    if (sec && sectionExclue(sec[1])) return true;
    for (const m of p.matchAll(/\/library\/metadata\/(\d+)/g)) if (titres.has(m[1])) return true;
    for (const m of p.matchAll(/\/library\/parts\/(\d+)/g)) if (fichiers.has(m[1])) return true;
    return false;
  }

  const itemPlus18 = (m) => !!m && adTitres.size > 0 && (
    adTitres.has(String(m.ratingKey || ''))
    || adTitres.has(String(m.parentRatingKey || ''))
    || adTitres.has(String(m.grandparentRatingKey || ''))
  );
  // Fiche ouverte directement (titre +18, ses saisons, ses épisodes) : on la
  // garde — cheminInterdit a déjà refusé qui n'y a pas droit. Partout ailleurs
  // (listes, hubs, recherche), le titre +18 n'apparaît pas.
  let garderPlus18 = false;
  const itemPrive = (m) => !!m && (
    sectionExclue(m.librarySectionID)
    || titres.has(String(m.ratingKey || ''))
    || titres.has(String(m.grandparentRatingKey || ''))
    || (!garderPlus18 && itemPlus18(m))
  );

  /** Retire le contenu privé d'une réponse JSON de Plex (modifie et renvoie l'objet). */
  function filtrerJson(json, chemin = '') {
    const mc = json?.MediaContainer;
    if (!mc) return json;
    let p = String(chemin || '');
    try { p = decodeURIComponent(p); } catch { /* chemin brut */ }
    garderPlus18 = visePlus18(p) || (!p && Array.isArray(mc.Metadata) && mc.Metadata.length === 1 && itemPlus18(mc.Metadata[0]) && accesAdulte());
    // Les titres +18 portent la mention : la fiche affiche l'avertissement +18.
    if (garderPlus18 && Array.isArray(mc.Metadata)) for (const m of mc.Metadata) if (itemPlus18(m)) { m.adulte = true; m.contentRating = '18+'; }
    if (!sections().size && !adTitres.size) return json;
    // Conteneur entier rattaché à une section privée (enfants d'une série…)
    if (sectionExclue(mc.librarySectionID)) {
      mc.Metadata = []; mc.Directory = []; mc.size = 0;
      return json;
    }
    if (Array.isArray(mc.Metadata)) mc.Metadata = mc.Metadata.filter((m) => !itemPrive(m));
    if (Array.isArray(mc.Directory)) {
      mc.Directory = /\/library\/sections\/?(\?|$)/.test(chemin)
        ? mc.Directory.filter((d) => !sectionExclue(d.key))
        : mc.Directory.filter((d) => !itemPrive(d));
    }
    if (Array.isArray(mc.Hub)) {
      for (const h of mc.Hub) {
        if (Array.isArray(h.Metadata)) { h.Metadata = h.Metadata.filter((m) => !itemPrive(m)); h.size = h.Metadata.length; }
        if (Array.isArray(h.Directory)) h.Directory = h.Directory.filter((m) => !itemPrive(m));
      }
    }
    if (Array.isArray(mc.SearchResult)) mc.SearchResult = mc.SearchResult.filter((r) => !itemPrive(r.Metadata || r.Directory));
    if (Array.isArray(mc.Metadata)) mc.size = mc.Metadata.length;
    return json;
  }

  return {
    rafraichir, cheminInterdit, filtrerJson, sectionExclue,
    // Historique, « Reprendre », lecture Jellyfin : un titre +18 n'y figure que pour qui y a droit.
    estTitrePrive: (rk) => titres.has(String(rk)) || (adTitres.has(String(rk)) && !accesAdulte()),
    pret: () => pret,
    /** Fiches des titres classés +18 (copies), pour l'onglet +18. */
    titresPlus18: () => adMeta.map((m) => ({ ...m, adulte: true, contentRating: '18+' })),
  };
}
