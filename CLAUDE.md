# NovaStream

Interface de streaming privée posée sur un serveur Plex ou Jellyfin.

## Ce que c'est, techniquement

**Vite 4 + React 18 + React Router 7**, servi en statique par un **Express 5**
(`server.js`) qui fait aussi proxy Plex, proxy TMDB et authentification JWT.
**Pas de Next.js, pas de TypeScript, pas de rendu serveur.** Tailwind 3 pour les
styles, Framer Motion 10 pour les animations.

- Design unique : calque **Pure** (`src/v2/pure/`, CSS `src/v2/pure.css`
  scopé `.nova-v2.nova-pure`), esprit Apple TV+. L'ancien design et la bêta
  « motion » ont été retirés du code (archivés hors du dépôt).
- Routes déclarées dans `src/v2/ShellV2.jsx`, toutes en `React.lazy`.
- Données Plex via `src/services/plexService.js` (cache 10 min mémoire +
  sessionStorage) et le proxy `/plex` du serveur.

## Configuration — rien en dur

- `config.js` est importé EN PREMIER par `server.js` : il charge `.env` puis
  `data/config.json` (réglages saisis dans l'interface, prioritaires) et les
  recopie dans `process.env`. Les modules lisent l'environnement **à l'usage**,
  jamais au chargement, pour qu'un changement de réglage s'applique sans redémarrage.
- Tout l'état d'une installation vit dans `data/` (`NOVA_DATA_DIR`) : base,
  `.jwt_secret`, caches, journaux, sauvegardes, `config.json`. Jamais versionné.
- `setup.js` : assistant de premier démarrage (création de l'admin — réseau
  local uniquement), réglages, tests de clés, liaison Plex par PIN, bibliothèques.
- Fonctions optionnelles : `config.features()` → `/api/features` → hook
  `useFeatures()`. Une fonction sans clé affiche `<Indisponible feature="…" />`
  (admin : lien vers les réglages ; utilisateurs : « l'administrateur n'a pas
  activé cette fonction »).

## Jellyfin — traduit en « dialecte Plex »

- Tout Nova (front ET serveur) parle le format Plex. Quand le serveur est
  Jellyfin (`config.serveurType()`), `jellyfin.js` traduit : `/plex/*` (proxy),
  `plexJsonBrut()` (lectures internes), `/plex-transcode/start` (HLS Jellyfin),
  `/jfhls/*` (playlists/segments, jeton Jellyfin ajouté côté serveur).
- Identifiants : GUID Jellyfin → numéro stable (table `jf_ids`, décalage
  50 000 000). Préfixes de clé : `i:` élément, `p:` fichier, `s:<guid>:<index>`
  piste, `g:` genre.
- Seuls les chemins Plex effectivement utilisés sont traduits ; tout autre
  chemin répond 404. Nouveau besoin côté front = l'ajouter dans `plexJson()`
  de jellyfin.js, et le vérifier contre `/api-docs/openapi.json` de Jellyfin
  (en v12, `?api_key=` est refusé : en-tête `Authorization: MediaBrowser Token=…`).
- Ne jamais lire le serveur multimédia avec `fetch(PLEX_URL…)` : passer par
  `plexJson` (filtré) ou `plexJsonBrut` (réservé à prive.js).

## Langues (français / anglais)

- Tout texte affiché passe par `tr('Texte en français')` (`src/i18n`). La clé
  EST le texte français ; la traduction anglaise va dans `src/i18n/en.js`
  (même clé, exacte). Clé absente = le français s'affiche, jamais un trou.
- Variables : `tr('{0} min restantes', [n])`. La fonction s'appelle `tr` et
  pas `t` : beaucoup de fichiers nomment `t` le jeton de connexion.
- Ne JAMAIS passer dans `tr` : clés internes (genres de `categories.js`,
  « Horreur + »), classes CSS, URL, en-têtes (`Bearer …`), noms de marque.
  Les genres se regroupent sous leur nom français et se traduisent à
  l'affichage seulement.
- Changer de langue recharge la page (des textes sont calculés à l'import
  des modules) : `appliquerLangue(l)`. La langue est une préférence du
  compte (`users.langue`), posée aussi en cookie `nova_langue`.
- Serveur : `i18n-serveur.js` traduit `error` / `message` des réponses JSON
  (cookie `nova_langue=en`) ; `langue()` / `langueTmdb()` donnent la langue de
  la requête en cours (AsyncLocalStorage) — TMDB et l'assistant IA la suivent.
- Un nouveau message serveur affiché à l'utilisateur → l'ajouter à `EN` dans
  `i18n-serveur.js`.

## Bibliothèques

- Le menu est construit depuis `/api/libraries` (hook `useLibraries()`), une
  page par bibliothèque : `/bibliotheque/:key`. `/movies`, `/shows`, `/animes`
  redirigent vers la première bibliothèque du bon type.
- Trois réglages : `exclues` (privées), `masquees` (hors menu), `ordre`.
- **Privées** (`prive.js`) : filtrées de TOUTE réponse Plex (proxy JSON,
  `plexJson`, sections) et tout chemin visant leurs titres/fichiers renvoie 404.
  Tout nouvel accès à Plex doit passer par `plexJson` ou le proxy — sinon
  appliquer `prive.filtrerJson` / `prive.cheminInterdit` à la main.

## Règles de travail

- Ne jamais committer `data/`, `.env`, ni aucune clé. Vérifier avant chaque commit.
- `emptyOutDir: false` dans `vite.config.js` : les anciens chunks doivent
  survivre à un redéploiement, sinon les pages ouvertes plantent.
- Ne jamais toucher aux conteneurs Docker `gluetun` et `qbittorrent` de la
  machine de production.
- Déploiement local : `npm run build`, puis relancer `node server.js`.
