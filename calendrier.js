/* ══════════════════════════════════════════════════════════════════
   Calendrier des sorties programmées

   L'administrateur programme un épisode (ou un film) et, pour chaque
   version — VO, VF, VA —, le jour et l'heure où elle sort. À l'heure
   dite, Nova demande à Sonarr/Radarr de chercher. Ce sont LEURS profils
   (langue, qualité) qui choisissent le fichier : Nova ne fait que
   déclencher au bon moment, puis relancer tant que la version attendue
   n'est pas arrivée.

   Rythme des relances après l'heure prévue (une sortie a souvent du
   retard sur les indexeurs) :
     · 6 premières heures  → toutes les 15 min
     · jusqu'à 3 jours     → toutes les 2 h
     · jusqu'à 14 jours    → toutes les 12 h
     · au-delà             → abandon (« introuvable »), relançable à la main

   Une version est « trouvée » quand le fichier présent la contient :
   VO = un fichier existe · VF = piste French · VA = piste English.
   ══════════════════════════════════════════════════════════════════ */

const MINUTE = 60 * 1000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

function intervalle(depuis) {
  if (depuis < 6 * HEURE) return 15 * MINUTE;
  if (depuis < 3 * JOUR) return 2 * HEURE;
  if (depuis < 14 * JOUR) return 12 * HEURE;
  return null;   // trop tard : on abandonne
}

const LANGUE_ARR = { vf: 'French', va: 'English' };
const NOM_VERSION = { vo: 'VO', vf: 'VF', va: 'VA' };

/**
 * @param app  Express
 * @param deps { db, authMiddleware, adminMiddleware, arr, tmdbGet, notifierAdmins, features }
 */
export function installer(app, { db, authMiddleware, adminMiddleware, arr, tmdbGet, notifierAdmins, features }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sorties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,              -- 'series' | 'movie'
      tmdbId TEXT NOT NULL,
      titre TEXT NOT NULL,
      annee TEXT,
      poster TEXT,
      saison INTEGER,
      episode INTEGER,
      dossier TEXT,
      arrId INTEGER,
      episodeId INTEGER,
      creePar INTEGER,
      creeLe TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sorties_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sortieId INTEGER NOT NULL REFERENCES sorties(id) ON DELETE CASCADE,
      langue TEXT NOT NULL,            -- 'vo' | 'vf' | 'va'
      quand TEXT NOT NULL,             -- ISO 8601 UTC
      etat TEXT NOT NULL DEFAULT 'attente',   -- attente | recherche | trouve | echec
      essais INTEGER NOT NULL DEFAULT 0,
      dernierEssai TEXT,
      trouveLe TEXT,
      detail TEXT,
      UNIQUE(sortieId, langue)
    );
  `);

  const libelle = (s) => (s.kind === 'series' && s.saison != null
    ? `${s.titre} — S${String(s.saison).padStart(2, '0')}E${String(s.episode).padStart(2, '0')}`
    : s.titre);

  /* ── Pré-remplissage depuis TMDB (et Sonarr si la série y est déjà) ── */
  async function preremplir({ kind, tmdbId, saison, episode }) {
    if (kind === 'movie') {
      const m = await tmdbGet(`/movie/${tmdbId}`, { append_to_response: 'release_dates' });
      const sorties = m.release_dates?.results || [];
      // Sortie « numérique » (type 4) : c'est elle qui rend le film trouvable.
      const numerique = (pays) => {
        const r = sorties.find((x) => x.iso_3166_1 === pays)?.release_dates || [];
        return (r.find((d) => d.type === 4) || r.find((d) => d.type === 5))?.release_date || null;
      };
      const origine = (m.origin_country?.[0]) || (m.production_countries?.[0]?.iso_3166_1) || 'US';
      return {
        kind, tmdbId: String(tmdbId), titre: m.title, annee: (m.release_date || '').slice(0, 4),
        poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
        langueOrigine: m.original_language || null,
        vaMasquee: m.original_language === 'en',
        versions: {
          vo: { quand: numerique(origine) || numerique('US'), source: 'TMDB (sortie numérique)' },
          vf: { quand: numerique('FR'), source: 'TMDB (sortie numérique en France)' },
          va: { quand: m.original_language === 'en' ? null : numerique('US') || numerique('GB'), source: 'TMDB' },
        },
      };
    }

    const [s, ext] = await Promise.all([tmdbGet(`/tv/${tmdbId}`), tmdbGet(`/tv/${tmdbId}/external_ids`).catch(() => ({}))]);
    const prochain = s.next_episode_to_air;
    const sa = saison != null && saison !== '' ? Number(saison) : (prochain?.season_number ?? s.last_episode_to_air?.season_number ?? 1);
    const ep = episode != null && episode !== '' ? Number(episode) : (prochain?.season_number === sa ? prochain.episode_number : 1);
    const isAnime = (s.genres || []).some((g) => g.id === 16) && s.original_language === 'ja';

    // Heure exacte : Sonarr la connaît (airDateUtc) si la série y est déjà.
    let quandVo = null;
    let source = 'TMDB (date seulement, heure à vérifier)';
    let dossierActuel = null;
    try {
      if (features().arr && ext.tvdb_id) {
        const serie = await arr.trouverSerie(ext.tvdb_id);
        if (serie) {
          dossierActuel = serie.rootFolderPath || null;
          const heures = await arr.airTimes(serie.id, sa, 3000);
          if (heures[String(ep)]) { quandVo = heures[String(ep)]; source = 'Sonarr (heure de diffusion)'; }
        }
      }
    } catch { /* on se rabat sur TMDB */ }
    if (!quandVo) {
      try {
        const e = await tmdbGet(`/tv/${tmdbId}/season/${sa}/episode/${ep}`);
        if (e.air_date) quandVo = `${e.air_date}T00:00:00.000Z`;
      } catch { /* épisode encore inconnu */ }
    }

    return {
      kind, tmdbId: String(tmdbId), tvdbId: ext.tvdb_id || null, titre: s.name, annee: (s.first_air_date || '').slice(0, 4),
      poster: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : null,
      langueOrigine: s.original_language || null, isAnime,
      vaMasquee: s.original_language === 'en',
      saison: sa, episode: ep, dossierActuel,
      heureConnue: source.startsWith('Sonarr'),
      versions: {
        vo: { quand: quandVo, source },
        vf: { quand: null, source: null },
        va: { quand: null, source: null },
      },
    };
  }

  /* ── Vérification + recherche, pour une sortie ── */
  async function traiter(s, versionsDues) {
    const langues = await arr.languesPresentes(s.kind, s.arrId, s.episodeId).catch(() => null);
    if (langues === null) return;   // Sonarr/Radarr injoignable : on réessaiera
    const aChercher = [];
    for (const v of versionsDues) {
      const trouvee = v.langue === 'vo' ? langues.includes('__fichier') : langues.includes(LANGUE_ARR[v.langue]);
      if (trouvee) {
        db.prepare("UPDATE sorties_versions SET etat = 'trouve', trouveLe = datetime('now'), detail = NULL WHERE id = ?").run(v.id);
        console.log(`[Calendrier] ${libelle(s)} ${NOM_VERSION[v.langue]} disponible`);
        notifierAdmins({ title: `${NOM_VERSION[v.langue]} disponible`, body: libelle(s), url: '/calendrier', tag: `sortie-${s.id}-${v.langue}` });
      } else aChercher.push(v);
    }
    if (!aChercher.length) return;
    try {
      await arr.lancerRecherche(s.kind, s.arrId, s.episodeId);
      const stmt = db.prepare("UPDATE sorties_versions SET etat = 'recherche', essais = essais + 1, dernierEssai = datetime('now'), detail = NULL WHERE id = ?");
      for (const v of aChercher) stmt.run(v.id);
      console.log(`[Calendrier] recherche lancée : ${libelle(s)} (${aChercher.map((v) => NOM_VERSION[v.langue]).join(', ')})`);
    } catch (e) {
      const stmt = db.prepare("UPDATE sorties_versions SET dernierEssai = datetime('now'), detail = ? WHERE id = ?");
      for (const v of aChercher) stmt.run(e.message.slice(0, 200), v.id);
    }
  }

  let enCours = false;
  async function tour({ forcer = null } = {}) {
    if (enCours || !features().arr) return;
    enCours = true;
    try {
      const maintenant = Date.now();
      const lignes = db.prepare(`SELECT v.*, s.kind, s.arrId, s.episodeId FROM sorties_versions v JOIN sorties s ON s.id = v.sortieId
                                 WHERE v.etat IN ('attente', 'recherche')${forcer ? ' AND s.id = ?' : ''}`).all(...(forcer ? [forcer] : []));
      const parSortie = new Map();
      for (const v of lignes) {
        const debut = Date.parse(v.quand);
        if (!forcer && debut > maintenant) continue;
        const depuis = maintenant - debut;
        const pas = intervalle(depuis);
        if (!forcer && pas === null) {
          db.prepare("UPDATE sorties_versions SET etat = 'echec', detail = 'Introuvable après 14 jours' WHERE id = ?").run(v.id);
          continue;
        }
        const dernier = v.dernierEssai ? Date.parse(`${v.dernierEssai.replace(' ', 'T')}Z`) : 0;
        if (!forcer && dernier && maintenant - dernier < pas) continue;
        if (!parSortie.has(v.sortieId)) parSortie.set(v.sortieId, []);
        parSortie.get(v.sortieId).push(v);
      }
      for (const [id, versions] of parSortie) {
        const s = db.prepare('SELECT * FROM sorties WHERE id = ?').get(id);
        if (s?.arrId) await traiter(s, versions);
      }
    } catch (e) {
      console.warn('[Calendrier]', e.message);
    } finally {
      enCours = false;
    }
  }
  setTimeout(() => tour(), 20000);
  setInterval(() => tour(), MINUTE);

  /* ── Routes (administrateur) ── */
  const garde = [authMiddleware, adminMiddleware];
  const erreur = (res, e, code = 400) => res.status(code).json({ error: e.message || String(e) });

  app.get('/api/admin/calendrier', ...garde, (req, res) => {
    const sorties = db.prepare('SELECT * FROM sorties ORDER BY id DESC').all();
    const versions = db.prepare('SELECT * FROM sorties_versions').all();
    res.json({
      sorties: sorties.map((s) => ({ ...s, versions: versions.filter((v) => v.sortieId === s.id) })),
    });
  });

  app.get('/api/admin/calendrier/preremplir', ...garde, async (req, res) => {
    try {
      const { kind, tmdbId, saison, episode } = req.query;
      if (!['series', 'movie'].includes(kind) || !tmdbId) return res.status(400).json({ error: 'Paramètres invalides' });
      res.json(await preremplir({ kind, tmdbId, saison, episode }));
    } catch (e) { erreur(res, e, 502); }
  });

  app.get('/api/admin/arr/dossiers', ...garde, async (req, res) => {
    try { res.json({ dossiers: await arr.dossiers(req.query.kind === 'movie' ? 'movie' : 'series') }); }
    catch (e) { erreur(res, e, 502); }
  });

  app.post('/api/admin/arr/dossiers', ...garde, async (req, res) => {
    try {
      const chemin = String(req.body?.path || '').trim();
      if (!chemin) return res.status(400).json({ error: 'Chemin vide' });
      res.json(await arr.ajouterDossier(req.body?.kind === 'movie' ? 'movie' : 'series', chemin));
    } catch (e) { erreur(res, e); }
  });

  function versionsValides(liste) {
    const out = [];
    for (const v of liste || []) {
      if (!['vo', 'vf', 'va'].includes(v.langue) || !v.quand) continue;
      const t = Date.parse(v.quand);
      if (Number.isNaN(t)) throw new Error(`Date invalide pour la ${NOM_VERSION[v.langue]}`);
      out.push({ langue: v.langue, quand: new Date(t).toISOString() });
    }
    if (!out.length) throw new Error('Indique au moins une version avec sa date');
    return out;
  }

  app.post('/api/admin/calendrier', ...garde, async (req, res) => {
    try {
      if (!features().arr) return res.status(400).json({ error: 'Radarr et Sonarr ne sont pas configurés' });
      const b = req.body || {};
      const kind = b.kind === 'movie' ? 'movie' : 'series';
      const versions = versionsValides(b.versions);
      const dossier = String(b.dossier || '').trim() || null;

      // On prépare TOUT DE SUITE côté Sonarr/Radarr : une erreur (titre ou
      // épisode inconnu, dossier refusé) se voit maintenant, pas le jour J.
      let arrId, episodeId = null;
      if (kind === 'movie') {
        arrId = (await arr.preparerFilm({ tmdbId: b.tmdbId, dossier })).id;
      } else {
        const serie = await arr.preparerSerie({ tvdbId: b.tvdbId, title: b.titre, year: b.annee, isAnime: !!b.isAnime, dossier });
        arrId = serie.id;
        episodeId = (await arr.preparerEpisode(serie.id, b.saison, b.episode)).id;
      }

      const r = db.prepare(`INSERT INTO sorties (kind, tmdbId, titre, annee, poster, saison, episode, dossier, arrId, episodeId, creePar)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(kind, String(b.tmdbId), b.titre, b.annee || null, b.poster || null,
          kind === 'series' ? Number(b.saison) : null, kind === 'series' ? Number(b.episode) : null,
          dossier, arrId, episodeId, req.user.id);
      const ins = db.prepare('INSERT INTO sorties_versions (sortieId, langue, quand) VALUES (?, ?, ?)');
      for (const v of versions) ins.run(r.lastInsertRowid, v.langue, v.quand);
      console.log(`[Calendrier] programmé : ${b.titre} (${versions.map((v) => NOM_VERSION[v.langue]).join(', ')})`);
      res.json({ ok: true, id: r.lastInsertRowid });
      setTimeout(() => tour(), 1000);   // une version déjà passée part tout de suite
    } catch (e) { erreur(res, e); }
  });

  // Modifier les dates : une version modifiée repart de zéro.
  app.put('/api/admin/calendrier/:id', ...garde, (req, res) => {
    try {
      const s = db.prepare('SELECT * FROM sorties WHERE id = ?').get(req.params.id);
      if (!s) return res.status(404).json({ error: 'Introuvable' });
      const versions = versionsValides(req.body?.versions);
      const garder = new Set(versions.map((v) => v.langue));
      db.prepare(`DELETE FROM sorties_versions WHERE sortieId = ? AND langue NOT IN (${[...garder].map(() => '?').join(',')})`).run(s.id, ...garder);
      const maj = db.prepare(`INSERT INTO sorties_versions (sortieId, langue, quand) VALUES (?, ?, ?)
                              ON CONFLICT(sortieId, langue) DO UPDATE SET
                                etat = CASE WHEN excluded.quand <> sorties_versions.quand AND sorties_versions.etat <> 'trouve' THEN 'attente' ELSE sorties_versions.etat END,
                                essais = CASE WHEN excluded.quand <> sorties_versions.quand AND sorties_versions.etat <> 'trouve' THEN 0 ELSE sorties_versions.essais END,
                                dernierEssai = CASE WHEN excluded.quand <> sorties_versions.quand AND sorties_versions.etat <> 'trouve' THEN NULL ELSE sorties_versions.dernierEssai END,
                                quand = excluded.quand`);
      for (const v of versions) maj.run(s.id, v.langue, v.quand);
      res.json({ ok: true });
    } catch (e) { erreur(res, e); }
  });

  app.delete('/api/admin/calendrier/:id', ...garde, (req, res) => {
    db.prepare('DELETE FROM sorties_versions WHERE sortieId = ?').run(req.params.id);
    db.prepare('DELETE FROM sorties WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // « Chercher maintenant » : relance aussi une version abandonnée.
  app.post('/api/admin/calendrier/:id/chercher', ...garde, async (req, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE sorties_versions SET etat = 'recherche', detail = NULL WHERE sortieId = ? AND etat = 'echec'").run(id);
    await tour({ forcer: id });
    res.json({ ok: true });
  });
}
