/* ══════════════════════════════════════════════════════════════════
   Messages du serveur en anglais

   Le serveur écrit ses messages en français (error, message…). Quand le
   visiteur a choisi l'anglais (cookie posé par l'interface), la réponse
   JSON est traduite au moment de partir : voir le middleware dans
   server.js. Les messages avec variables ({0}, {1}…) sont reconnus comme
   des motifs. Un message absent d'ici reste en français, jamais vide.
   ══════════════════════════════════════════════════════════════════ */
import { AsyncLocalStorage } from 'node:async_hooks';

/** Contexte de la requête en cours (langue du visiteur). */
export const contexte = new AsyncLocalStorage();
export const langue = () => contexte.getStore()?.langue || 'fr';
/** Langue à demander à TMDB pour les textes (synopsis, titres…). */
export const langueTmdb = () => (langue() === 'en' ? 'en-US' : 'fr-FR');

/** 'en' si le cookie de l'interface le dit, sinon 'fr'. */
export function langueDe(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)nova_langue=(fr|en)\b/);
  return m ? m[1] : 'fr';
}

const EN = {
  // Accès, comptes
  'Token requis': 'Login required',
  'Token invalide': 'Invalid session',
  'Jeton invalide': 'Invalid token',
  'Authentification requise': 'Login required',
  'Session révoquée': 'Session revoked',
  'Accès admin requis': 'Admin access required',
  'Accès invité restreint à la séance': 'Guest access is limited to the watch party',
  'Jeton média restreint': 'Restricted media token',
  'Séance terminée': 'The watch party has ended',
  'Action non autorisée': 'Action not allowed',
  'Non autorisé': 'Not allowed',
  'Non autorise': 'Not allowed',
  'Méthode non autorisée': 'Method not allowed',
  'Trop de tentatives, réessaie plus tard': 'Too many attempts, try again later',
  'Trop de tentatives. Réessayez dans {0} min.': 'Too many attempts. Try again in {0} min.',
  'Trop de tentatives, réessaie dans une minute': 'Too many attempts, try again in a minute',
  'Tous les champs sont requis': 'All fields are required',
  'Pseudo invalide (2 à 32 caractères)': 'Invalid username (2 to 32 characters)',
  'Mot de passe trop court (min 6)': 'Password too short (min 6)',
  'Mot de passe trop court (8 caractères minimum)': 'Password too short (8 characters minimum)',
  'Email invalide': 'Invalid email',
  'Code d\'invitation invalide ou déjà utilisé': 'Invitation code invalid or already used',
  'Email ou pseudo déjà utilisé': 'Email or username already taken',
  'Email et mot de passe requis': 'Email and password required',
  'Email ou mot de passe incorrect': 'Incorrect email or password',
  'Utilisateur introuvable': 'User not found',
  'Image invalide ou trop lourde': 'Invalid or too large image',
  'Format d\'image non supporté': 'Unsupported image format',
  'Langue inconnue': 'Unknown language',
  'Un administrateur existe déjà': 'An administrator already exists',
  'Pour des raisons de sécurité, le compte administrateur se crée depuis le réseau local (http://localhost:5174 sur la machine du serveur).': 'For security reasons, the administrator account must be created from the local network (http://localhost:5174 on the server machine).',
  'Aucun administrateur': 'No administrator',

  // Génériques
  'Erreur serveur': 'Server error',
  'Introuvable': 'Not found',
  'Indisponible': 'Unavailable',
  'Impossible': 'Not possible',
  'Requête invalide': 'Invalid request',
  'Paramètres invalides': 'Invalid parameters',
  'Enregistrement impossible': 'Could not save',
  'Statut invalide': 'Invalid status',
  'Action inconnue': 'Unknown action',
  'Source inconnue': 'Unknown source',
  'Titre manquant': 'Missing title',
  'Titre inconnu': 'Unknown title',
  'Nom requis': 'Name required',
  'Identifiant invalide': 'Invalid ID',
  'Identifiant manquant': 'Missing username',
  'délai dépassé': 'timed out',
  'Connexion impossible': 'Could not connect',
  'Connexion refusée — le service est-il démarré ?': 'Connection refused — is the service running?',

  // Serveur multimédia
  'Serveur média injoignable': 'Media server unreachable',
  'Serveur multimédia injoignable': 'Media server unreachable',
  'Plex indisponible': 'Plex unavailable',
  'Le serveur répond {0}': 'The server responded {0}',
  'Plex {0} joignable': 'Plex {0} reachable',
  'Adresse ou jeton manquant': 'Missing address or token',
  'Jellyfin non relié': 'Jellyfin not connected',
  'Jeton Jellyfin refusé — reconnecte-toi': 'Jellyfin token rejected — sign in again',
  'Jellyfin répond {0}': 'Jellyfin responded {0}',
  'Jellyfin {0} joignable ({1})': 'Jellyfin {0} reachable ({1})',
  'Jellyfin ne répond pas à cette adresse': 'Jellyfin is not responding at this address',
  'Adresse invalide (ex. http://192.168.1.10:8096)': 'Invalid address (e.g. http://192.168.1.10:8096)',
  'Identifiant ou mot de passe refusé': 'Username or password rejected',
  'plex.tv ne répond pas': 'plex.tv is not responding',
  'Connexion expirée, recommence': 'Sign-in expired, please start again',
  'Aucun serveur Plex ne t\'appartient sur ce compte': 'This Plex account doesn\'t own any server',
  'Serveur inconnu, recommence la connexion': 'Unknown server, please sign in again',
  '{0} ne répond sur aucune de ses adresses depuis cette machine. Saisis l\'adresse à la main (ex. http://192.168.1.10:32400).': '{0} isn\'t responding on any of its addresses from this machine. Enter the address manually (e.g. http://192.168.1.10:32400).',
  'Ce serveur utilise Jellyfin : le connecteur Plex ne s\'applique pas.': 'This server uses Jellyfin: the Plex connector doesn\'t apply.',
  'Ce compte Plex n\'a pas accès au serveur. Demande à l\'administrateur de te partager la bibliothèque, puis réessaie.': 'This Plex account has no access to the server. Ask the administrator to share the library with you, then try again.',
  'Aucun compte Plex relié': 'No Plex account linked',
  'Aucune connexion en cours': 'No sign-in in progress',
  'non relié': 'not linked',
  'Aucun épisode': 'No episodes',
  'Erreur de transcodage': 'Transcoding error',
  'Flux en préparation': 'Stream is being prepared',

  // TMDB, recherche, demandes
  'Jeton manquant': 'Missing token',
  'Jeton refusé — utilise le « jeton d\'accès en lecture » (API Read Access Token), pas la clé courte': 'Token rejected — use the "API Read Access Token", not the short API key',
  'TMDB répond {0}': 'TMDB responded {0}',
  'TMDB répond': 'TMDB is responding',
  'Thèmes indisponibles': 'Themes unavailable',
  'Introuvable sur TMDB': 'Not found on TMDB',
  'Personne introuvable sur TMDB': 'Person not found on TMDB',
  'Détails indisponibles': 'Details unavailable',
  'Recherche indisponible': 'Search unavailable',
  'Exploration indisponible': 'Browsing unavailable',
  'Demande introuvable': 'Request not found',

  // Sous-titres
  'Sous-titres en ligne non configurés': 'Online subtitles are not set up',
  'Clé manquante': 'Missing key',
  'Clé API refusée': 'API key rejected',
  'OpenSubtitles répond {0}': 'OpenSubtitles responded {0}',
  'Clé et compte valides — recherche et téléchargement actifs': 'Key and account valid — search and download enabled',
  'Clé valide — ajoute un compte pour pouvoir télécharger': 'Key valid — add an account to be able to download',
  'OpenSubtitles non configuré': 'OpenSubtitles is not set up',
  'Identifiants OpenSubtitles manquants': 'Missing OpenSubtitles credentials',
  'Connexion OpenSubtitles refusée ({0})': 'OpenSubtitles sign-in rejected ({0})',
  'Recherche impossible ({0})': 'Search failed ({0})',
  'Quota de téléchargements atteint pour aujourd’hui': 'Download quota reached for today',
  'Téléchargement refusé ({0})': 'Download rejected ({0})',
  'Lien de téléchargement absent': 'Missing download link',
  'Fichier illisible ({0})': 'Unreadable file ({0})',
  'extraction trop longue': 'extraction took too long',

  // Assistant IA
  'L\'assistant n\'est pas activé : il faut choisir une IA dans les réglages.': 'The assistant is not enabled: choose an AI in the settings.',
  'Dis-m\'en un peu plus': 'Tell me a bit more',
  'Doucement — réessaie dans un moment.': 'Easy — try again in a moment.',
  'L\'assistant n\'a pas répondu. Réessaie.': 'The assistant didn\'t respond. Try again.',
  'Aucune IA configurée': 'No AI configured',
  'Choisis une IA': 'Choose an AI',
  'Clé refusée par {0}': 'Key rejected by {0}',
  '{0} ne répond pas à {1} — est-il démarré ?': '{0} is not responding at {1} — is it running?',
  '{0} répond, mais aucun modèle n\'est disponible': '{0} is responding, but no model is available',
  '{0} : aucun modèle disponible{1}': '{0}: no model available{1}',
  ' (en as-tu téléchargé un ?)': ' (have you downloaded one?)',
  'réponse vide': 'empty response',
  'réponse sans JSON': 'response without JSON',
  'aucun modèle Gemini disponible': 'no Gemini model available',
  '{0} répond — {1} modèle{2} disponible{3}{4}': '{0} is responding — {1} model{2} available{4}',
  ', « {0} » choisi': ', "{0}" selected',

  // Radarr, Sonarr, qBittorrent, calendrier
  '{0} : adresse ou clé manquante': '{0}: missing address or key',
  '{0} : clé refusée': '{0}: key rejected',
  '{0} répond {1}': '{0} responded {1}',
  '{0} et {1} joignables': '{0} and {1} reachable',
  'Adresse manquante': 'Missing address',
  'Identifiants refusés': 'Credentials rejected',
  'qBittorrent joignable (lecture seule)': 'qBittorrent reachable (read-only)',
  'qBittorrent injoignable': 'qBittorrent unreachable',
  'Connexion qBittorrent refusée': 'qBittorrent sign-in rejected',
  'Connexion qBittorrent refusée (nouvel essai dans quelques minutes)': 'qBittorrent sign-in rejected (retrying in a few minutes)',
  'Film introuvable côté Radarr': 'Movie not found in Radarr',
  'Série introuvable côté Sonarr': 'Series not found in Sonarr',
  'Épisode S{0}E{1} inconnu de Sonarr': 'Episode S{0}E{1} unknown to Sonarr',
  'Radarr et Sonarr ne sont pas configurés': 'Radarr and Sonarr are not set up',
  'Date invalide pour la {0}': 'Invalid date for the {0}',
  'Indique au moins une version avec sa date': 'Enter at least one version with its date',
  'Introuvable après 14 jours': 'Not found after 14 days',
  'Chemin vide': 'Empty path',
  'Test inconnu': 'Unknown test',

  // Séances à plusieurs, notifications, TV
  'Les invités ne peuvent pas créer de séance': 'Guests can\'t create a watch party',
  'Trop de séances créées, réessaie dans une minute': 'Too many watch parties created, try again in a minute',
  'Serveur saturé, réessaie plus tard': 'Server is busy, try again later',
  'Tu as déjà trop de séances ouvertes': 'You already have too many open watch parties',
  'Séance introuvable ou terminée': 'Watch party not found or ended',
  'Séance pleine': 'The watch party is full',
  'Jeton invité invalide': 'Invalid guest token',
  'Push indisponible': 'Notifications unavailable',
  'Abonnement invalide': 'Invalid subscription',
  'Chaîne inconnue': 'Unknown channel',
  'Service injoignable': 'Service unreachable',
  'Flux injoignable': 'Stream unreachable',
  'Flux indisponible (HTTP {0})': 'Stream unavailable (HTTP {0})',
};

/* Les clés avec {n} deviennent des expressions régulières (une fois). */
const MOTIFS = Object.entries(EN)
  .filter(([fr]) => /\{\d+\}/.test(fr))
  .map(([fr, en]) => {
    const ordre = [];
    const source = fr.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\d+)\\?\}/g, (m, n) => { ordre.push(n); return '(.*?)'; });
    return { re: new RegExp(`^${source}$`, 's'), ordre, en };
  });

/** Traduit un message du serveur en anglais (inchangé s'il n'est pas connu). */
export function versAnglais(texte) {
  if (typeof texte !== 'string' || !texte) return texte;
  if (EN[texte]) return EN[texte];
  for (const { re, ordre, en } of MOTIFS) {
    const m = texte.match(re);
    if (!m) continue;
    const valeurs = {};
    ordre.forEach((n, i) => { valeurs[n] = versAnglais(m[i + 1]); });
    return en.replace(/\{(\d+)\}/g, (x, n) => valeurs[n] ?? x);
  }
  return texte;
}
