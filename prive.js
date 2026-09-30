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

export function creerFiltrePrive({ plexUrl, token, exclues }) {
  let titres = new Set();     // ratingKey (films, épisodes, saisons, séries)
  let fichiers = new Set();   // id des « parts » (fichiers vidéo)
  let pret = true;

  const sections = () => new Set((exclues() || []).map(String));

  async function lister(chemin) {
    const sep = chemin.includes('?') ? '&' : '?';
    const r = await fetch(`${plexUrl()}${chemin}${sep}X-Plex-Token=${token()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`Plex ${r.status}`);
    return (await r.json())?.MediaContainer?.Metadata || [];
  }

  /** Relève les identifiants à bloquer. À appeler après un changement de réglage. */
  async function rafraichir() {
    const secs = [...sections()];
    if (!secs.length || !plexUrl() || !token()) { titres = new Set(); fichiers = new Set(); pret = true; return; }
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

  /** Ce chemin Plex vise-t-il un contenu privé ? (déjà décodé ou non, on décode) */
  function cheminInterdit(chemin) {
    if (!sections().size) return false;
    let p = String(chemin || '');
    try { p = decodeURIComponent(p); } catch { /* chemin brut */ }
    const sec = p.match(/\/library\/sections\/(\d+)/);
    if (sec && sectionExclue(sec[1])) return true;
    for (const m of p.matchAll(/\/library\/metadata\/(\d+)/g)) if (titres.has(m[1])) return true;
    for (const m of p.matchAll(/\/library\/parts\/(\d+)/g)) if (fichiers.has(m[1])) return true;
    return false;
  }

  const itemPrive = (m) => !!m && (
    sectionExclue(m.librarySectionID)
    || titres.has(String(m.ratingKey || ''))
    || titres.has(String(m.grandparentRatingKey || ''))
  );

  /** Retire le contenu privé d'une réponse JSON de Plex (modifie et renvoie l'objet). */
  function filtrerJson(json, chemin = '') {
    const mc = json?.MediaContainer;
    if (!mc || !sections().size) return json;
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

  return { rafraichir, cheminInterdit, filtrerJson, sectionExclue, estTitrePrive: (rk) => titres.has(String(rk)), pret: () => pret };
}
