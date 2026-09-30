# NovaStream

Une interface de streaming épurée, façon Apple TV+, posée sur **ton propre serveur Plex ou Jellyfin**.
Tes films et séries, tes amis, ta maison — sans abonnement.

- Accueil, pages par bibliothèque (sous le nom qu'elles portent sur ton serveur), recherche tolérante aux fautes, filtres
- Lecteur web complet : reprise, épisode suivant, saut de générique, pistes audio/sous-titres, synchro des sous-titres
- Comptes sur invitation, favoris, historique, « Reprendre », notifications
- **Plex ou Jellyfin**, au choix, en un clic dans l'assistant
- Avec Plex : connexion du compte Plex de chaque utilisateur (progression synchronisée dans les deux sens)
- Bibliothèques **privées** : décoche une bibliothèque et elle n'existe plus pour Nova (menu, recherche, recommandations, lien direct — tout est bloqué côté serveur)
- Assistant « Dis-moi ta soirée » avec **l'IA de ton choix** : Gemini, ChatGPT, Claude, Grok, ou en local avec Ollama / LM Studio
- Services optionnels : TMDB, OpenSubtitles, Radarr/Sonarr (demandes de films), qBittorrent (lecture seule)
- Application installable sur téléphone (PWA)

## Feuille de route

- Calendrier de sorties : programmer la recherche d'un titre à l'heure exacte de sa sortie
- Traductions de l'interface (anglais d'abord)
- Image Docker publiée, pour installer sans compiler

---

## Installation (Docker — recommandé)

Prérequis : [Docker](https://docs.docker.com/get-docker/) et un serveur Plex ou Jellyfin.

```bash
git clone <adresse-du-dépôt> novastream
cd novastream
docker compose up -d
```

Ouvre ensuite **http://localhost:5174** sur la machine du serveur. L'assistant de premier démarrage :

1. **crée le compte administrateur** — uniquement depuis le réseau local, par sécurité ;
2. **relie ton serveur** :
   - **Plex** : bouton « Se connecter avec Plex », tu valides sur plex.tv, c'est tout ;
   - **Jellyfin** : bouton « Se connecter avec Jellyfin », puis l'adresse du serveur et un compte (Nova garde le jeton, jamais le mot de passe) ;
3. te laisse **cocher les bibliothèques** à montrer (et celles à garder privées) ;
4. propose les **clés API optionnelles**, chacune avec un bouton « Tester ».

Tout se modifie ensuite dans **menu du compte → Réglages du serveur**.
Les clés sont rangées dans `data/config.json` sur ta machine et ne sont jamais renvoyées au navigateur.

### Accès depuis l'extérieur (HTTPS)

1. Un nom de domaine qui pointe vers ton IP publique (un domaine gratuit de ta box ou un DNS dynamique convient).
2. Sur ta box, redirige les ports **TCP 80 et 443** vers la machine du serveur.
3. Crée un fichier `.env` (à partir de `.env.example`) avec `DOMAIN=nova.mon-domaine.fr`.
4. Lance avec le reverse proxy :

```bash
docker compose --profile https up -d
```

[Caddy](https://caddyserver.com) obtient et renouvelle le certificat Let's Encrypt tout seul.
N'expose **pas** le port 5174 directement sur Internet : passe toujours par Caddy.

### Mettre à jour

```bash
git pull
docker compose up -d --build
```

Tes données (`data/`) sont conservées.

---

## Installation sans Docker

Prérequis : Node.js 20 ou plus récent.

```bash
npm ci
npm run build
npm start
```

Puis http://localhost:5174. Pour l'HTTPS, installe [Caddy](https://caddyserver.com/docs/install) et lance
`caddy run --config Caddyfile` avec la variable d'environnement `DOMAIN` définie.

---

## Les clés API

Aucune n'est obligatoire. Sans elle, la fonction est désactivée : l'administrateur voit un lien vers le bon réglage, les autres utilisateurs voient « l'administrateur n'a pas activé cette fonction ».

| Service | Sert à | Où l'obtenir |
|---|---|---|
| TMDB *(conseillé)* | affiches HD, bandes-annonces, demandes, recommandations | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) — « API Read Access Token » |
| OpenSubtitles | sous-titres français quand le fichier n'en a pas | [opensubtitles.com/consumers](https://www.opensubtitles.com/en/consumers) + ton compte pour télécharger |
| Une IA au choix | l'assistant « Dis-moi ta soirée » | Gemini ([clé gratuite](https://aistudio.google.com/apikey)), ChatGPT, Claude, Grok — ou Ollama / LM Studio en local, sans clé |
| Radarr / Sonarr | lancer la recherche des films et séries demandés | Settings → General → API Key |
| qBittorrent | retrouver un téléchargement ajouté à la main (lecture seule) | identifiants de l'interface web |

---

## Données et sauvegardes

Tout ce qui est propre à ton installation vit dans `data/` :
base SQLite (comptes, progression, favoris), clés, caches, journaux, et une **sauvegarde quotidienne de la base** (`data/backups/`, 7 jours gardés).
Pour déplacer ce dossier : variable `NOVA_DATA_DIR`.

Ce dossier n'est jamais versionné (voir `.gitignore`).

---

## Développement

```bash
npm ci
npm start          # API sur :5174
npm run dev        # interface avec rechargement à chaud sur :5173
```

Architecture : Vite + React 18 + React Router 7 (interface), Express 5 (API, proxy Plex/Jellyfin/TMDB, authentification JWT), SQLite.
Jellyfin est pris en charge par une couche de traduction côté serveur (`jellyfin.js`) : l'interface parle un seul format.
Testé avec Plex Media Server et Jellyfin 12.
Voir `CLAUDE.md` pour les conventions du projet.

---

## Crédits

Créé par [why7726](https://github.com/why7726), co-créé avec [Claude](https://claude.ai) (Anthropic).
Si tu réutilises NovaStream, merci de garder la mention en bas des pages.

## Licence

[MIT](LICENSE) — libre d'utiliser, modifier et redistribuer, en gardant la mention de copyright.
