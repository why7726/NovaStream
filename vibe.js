/* ══════════════════════════════════════════════════════════════════
   « Dis-moi ta soirée » — de l'humeur vers un film

   Chercher demande de connaître un titre ; les thèmes demandent de
   connaître un genre. Or on choisit rarement comme ça : on se dit
   « journée pourrie », « on est trois et on veut rigoler ». Ce module
   traduit une phrase en propositions.

   ⚠️ RÈGLE ABSOLUE : le modèle sert à avoir du GOÛT, jamais à établir
   des FAITS. Il invente des titres et affirme n'importe quoi sur ce que
   contient la bibliothèque. Donc :
     · pour ce qu'on possède, il choisit UNIQUEMENT dans la liste qu'on
       lui fournit, et chaque proposition est revérifiée contre elle ;
     · pour les découvertes, chaque titre passe par TMDB avant d'être
       montré — s'il n'existe pas, il disparaît.
   Rien de ce qui s'affiche ne repose sur sa parole.
   ══════════════════════════════════════════════════════════════════ */

/* Le choix de l'IA (Gemini, ChatGPT, Grok, Claude, Ollama, LM Studio) et les
   appels eux-mêmes vivent dans ia.js : ici, on ne s'occupe que du GOÛT. */
import * as ia from './ia.js';

export function vibeConfigured() {
  return ia.iaConfiguree();
}

/** Normalisation partagée avec le reste du site (accents, ponctuation). */
const DIACRITIQUES = new RegExp('[\\u0300-\\u036f]', 'g');
export function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(DIACRITIQUES, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Le catalogue envoyé au modèle : titre, année, genres. RIEN d'autre —
   pas de chemin de fichier, pas de qui-regarde-quoi. Et on plafonne pour
   garder une requête raisonnable. */
export function listePourModele(catalogue, max = 900) {
  return catalogue
    .filter((it) => it.title)
    .slice(0, max)
    .map((it) => `${it.title}${it.year ? ` (${it.year})` : ''}${it.genres?.length ? ` [${it.genres.slice(0, 3).join(',')}]` : ''}`)
    .join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    ambiance: { type: 'string' },
    surNova: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titre: { type: 'string' },
          annee: { type: 'string' },
          pourquoi: { type: 'string' },
        },
        required: ['titre', 'pourquoi'],
      },
    },
    aDecouvrir: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titre: { type: 'string' },
          annee: { type: 'string' },
          pourquoi: { type: 'string' },
        },
        required: ['titre', 'pourquoi'],
      },
    },
  },
  required: ['surNova', 'aDecouvrir'],
};

function consigne(humeur, liste) {
  return `Tu conseilles un film ou une série à un ami pour sa soirée.

SON HUMEUR : « ${humeur} »

VOICI SA BIBLIOTHÈQUE (un titre par ligne, avec l'année et les genres) :
${liste}

Réponds en JSON :
· "surNova" : 5 titres AU MAXIMUM, choisis STRICTEMENT dans la liste ci-dessus.
  Recopie le titre EXACTEMENT comme il est écrit dans la liste. N'invente rien,
  ne propose rien qui n'y figure pas. Si l'humeur ne colle à rien, renvoie moins
  de titres, voire aucun — c'est mieux que de forcer.
· "aDecouvrir" : 3 titres AU MAXIMUM qui ne sont PAS dans la liste et qui
  existent vraiment (films ou séries connus). Ce sont des suggestions à
  récupérer plus tard.
· "ambiance" : une phrase de moins de 90 caractères qui résume l'ambiance
  choisie, adressée à lui, sans flagornerie.

Pour chaque titre, "pourquoi" fait UNE phrase courte (moins de 110 caractères)
qui dit en quoi ça colle à SON humeur. Pas de résumé du film : il l'a déjà.
Écris en français, sur un ton simple et direct, sans superlatifs.`;
}

/** Appelle l'IA configurée et renvoie l'objet brut (déjà en JSON). */
export async function demanderAuModele(humeur, liste) {
  const res = await ia.demander(consigne(humeur, liste), SCHEMA);
  // Les modèles hors Gemini n'ont pas de schéma imposé : on sécurise la forme.
  return {
    ambiance: typeof res?.ambiance === 'string' ? res.ambiance : '',
    surNova: Array.isArray(res?.surNova) ? res.surNova : [],
    aDecouvrir: Array.isArray(res?.aDecouvrir) ? res.aDecouvrir : [],
  };
}

/**
 * Ne garde que ce qui EXISTE vraiment dans la bibliothèque.
 * On compare sur le titre normalisé ; l'année départage les homonymes.
 */
export function verifierSurNova(propositions, catalogue) {
  const index = new Map();
  for (const it of catalogue) {
    const k = norm(it.title);
    if (!k) continue;
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(it);
  }
  const out = [];
  const vus = new Set();
  for (const p of propositions || []) {
    const cands = index.get(norm(p.titre));
    if (!cands?.length) continue;                    // titre inventé → écarté
    const an = parseInt(p.annee, 10);
    const item = (an ? cands.find((c) => Math.abs((c.year || 0) - an) <= 1) : null) || cands[0];
    if (!item || vus.has(String(item.id))) continue;
    vus.add(String(item.id));
    out.push({ item, pourquoi: (p.pourquoi || '').trim() });
  }
  return out;
}

export default { vibeConfigured, listePourModele, demanderAuModele, verifierSurNova, norm };
