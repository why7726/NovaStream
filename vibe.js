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

/* Modèles essayés dans l'ordre. Le palier gratuit de Google se déplace au fil
   des versions : en août 2026, `gemini-2.0-flash` est à **limit: 0** alors que
   les modèles récents répondent normalement avec la même clé. On garde donc
   une liste plutôt qu'un nom en dur, et on retient celui qui a marché.
   `gemini-flash-latest` est un alias : il suit les montées de version. */
const MODELES = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-flash-lite-latest'];
let modeleQuiMarche = null;

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function vibeConfigured() {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}
const cle = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

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

/** Appelle le modèle et renvoie l'objet brut (déjà en JSON). */
export async function demanderAuModele(humeur, liste) {
  const corps = JSON.stringify({
    contents: [{ parts: [{ text: consigne(humeur, liste) }] }],
    generationConfig: {
      temperature: 0.9,               // du goût, pas de la rigueur
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
    },
  });

  // La clé passe par l'EN-TÊTE : c'est ce qu'attend le nouveau format de clé
  // Google (`AQ.…`), et l'ancien (`AIza…`) l'accepte aussi.
  const essayer = async (modele) => {
    const r = await fetch(`${URL_BASE}/${modele}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cle() },
      body: corps,
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) {
      const err = new Error(`Gemini ${r.status} ${(await r.text()).slice(0, 120)}`);
      err.statut = r.status;
      throw err;
    }
    const d = await r.json();
    const texte = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texte) throw new Error('réponse vide');
    return JSON.parse(texte);
  };

  const ordre = modeleQuiMarche ? [modeleQuiMarche, ...MODELES.filter((m) => m !== modeleQuiMarche)] : MODELES;
  let derniere = null;
  for (const m of ordre) {
    try {
      const res = await essayer(m);
      if (modeleQuiMarche !== m) { modeleQuiMarche = m; console.log(`[Soirée] modèle retenu : ${m}`); }
      return res;
    } catch (e) {
      derniere = e;
      // Quota épuisé ou modèle absent → on tente le suivant ; sinon on s'arrête.
      if (e.statut !== 429 && e.statut !== 404) throw e;
      if (modeleQuiMarche === m) modeleQuiMarche = null;
    }
  }
  throw derniere || new Error('aucun modèle disponible');
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
