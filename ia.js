/* ══════════════════════════════════════════════════════════════════
   Fournisseurs d'IA pour l'assistant « Dis-moi ta soirée »

   Chacun choisit son IA dans les réglages : Gemini, ChatGPT, Grok,
   Claude, ou un modèle LOCAL (Ollama, LM Studio — rien ne sort de la
   maison, aucune clé).

   Les noms de modèles changent tous les quelques mois : on n'en fige
   aucun. Sans modèle choisi, on demande la liste au fournisseur et on
   prend le premier qui correspond à nos préférences (rapide et bon
   marché : on veut du goût, pas un raisonnement de 30 secondes).

   Tous renvoient un OBJET JSON (voir vibe.js pour ce qu'on en fait).
   ══════════════════════════════════════════════════════════════════ */

const env = (k) => (process.env[k] || '').trim();

export const FOURNISSEURS = {
  gemini:   { nom: 'Gemini',    cle: 'GEMINI_API_KEY' },
  openai:   { nom: 'ChatGPT',   cle: 'OPENAI_API_KEY',    base: 'https://api.openai.com/v1', prefere: [/^gpt-5.*mini/, /^gpt-4\.1-mini/, /^gpt-4o-mini/, /^gpt-/] },
  grok:     { nom: 'Grok',      cle: 'XAI_API_KEY',       base: 'https://api.x.ai/v1',       prefere: [/fast/, /mini/, /^grok/] },
  claude:   { nom: 'Claude',    cle: 'ANTHROPIC_API_KEY', prefere: [/haiku/, /sonnet/, /^claude/] },
  ollama:   { nom: 'Ollama',    url: 'OLLAMA_URL',        defaut: 'http://localhost:11434', local: true },
  lmstudio: { nom: 'LM Studio', url: 'LMSTUDIO_URL',      defaut: 'http://localhost:1234',  local: true },
};

/* Modèles Gemini essayés dans l'ordre. Le palier gratuit de Google se déplace
   au fil des versions : en août 2026, `gemini-2.0-flash` est à **limit: 0**
   alors que les modèles récents répondent normalement avec la même clé.
   `gemini-flash-latest` est un alias : il suit les montées de version. */
const MODELES_GEMINI = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-flash-lite-latest'];

/** Valeurs à utiliser : celles passées (test depuis les réglages) ou l'environnement. */
function lire(v = {}) {
  const g = (k) => (v[k] !== undefined && v[k] !== '' ? String(v[k]).trim() : env(k));
  return {
    fournisseur: g('IA_FOURNISSEUR'),
    modele: g('IA_MODELE'),
    cles: Object.fromEntries(Object.values(FOURNISSEURS).filter((f) => f.cle).map((f) => [f.cle, g(f.cle) || (f.cle === 'GEMINI_API_KEY' ? env('GOOGLE_API_KEY') : '')])),
    urls: Object.fromEntries(Object.values(FOURNISSEURS).filter((f) => f.url).map((f) => [f.url, g(f.url)])),
  };
}

/** Le fournisseur retenu : celui choisi, sinon le premier qui a une clé (compatibilité). */
export function fournisseurActif(v) {
  const c = lire(v);
  if (c.fournisseur && FOURNISSEURS[c.fournisseur]) return c.fournisseur;
  if (c.cles.GEMINI_API_KEY) return 'gemini';
  for (const [id, f] of Object.entries(FOURNISSEURS)) if (f.cle && c.cles[f.cle]) return id;
  return null;
}

/** L'assistant peut-il fonctionner ? (clé présente, ou IA locale choisie) */
export function iaConfiguree(v) {
  const id = fournisseurActif(v);
  if (!id) return false;
  const f = FOURNISSEURS[id];
  return f.local ? true : !!lire(v).cles[f.cle];
}

const baseLocale = (f, c) => `${(c.urls[f.url] || f.defaut).replace(/\/+$/, '').replace(/\/v1$/, '')}/v1`;

async function lireJson(r, qui) {
  if (!r.ok) {
    const err = new Error(`${qui} ${r.status} ${(await r.text()).slice(0, 160)}`);
    err.statut = r.status;
    throw err;
  }
  return r.json();
}

/* Les modèles hors Gemini renvoient parfois le JSON entouré de texte ou de
   ```json … ``` : on isole le premier objet complet. */
export function extraireJson(texte) {
  const t = String(texte || '').trim();
  try { return JSON.parse(t); } catch { /* on cherche l'objet */ }
  const debut = t.indexOf('{');
  const fin = t.lastIndexOf('}');
  if (debut === -1 || fin <= debut) throw new Error('réponse sans JSON');
  return JSON.parse(t.slice(debut, fin + 1));
}

/* ── Liste des modèles disponibles (sert au test ET au choix automatique) ── */
export async function listerModeles(id, v) {
  const f = FOURNISSEURS[id];
  const c = lire(v);
  const attente = AbortSignal.timeout(10000);
  if (id === 'gemini') {
    const d = await lireJson(await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': c.cles.GEMINI_API_KEY }, signal: attente }), 'Gemini');
    return (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  }
  if (id === 'claude') {
    const d = await lireJson(await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': c.cles.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, signal: attente }), 'Claude');
    return (d.data || []).map((m) => m.id);
  }
  const base = f.local ? baseLocale(f, c) : f.base;
  const entetes = f.cle ? { Authorization: `Bearer ${c.cles[f.cle]}` } : {};
  const d = await lireJson(await fetch(`${base}/models`, { headers: entetes, signal: attente }), f.nom);
  return (d.data || []).map((m) => m.id).filter((m) => !/embed|whisper|tts|dall-e|image|audio|realtime|moderation|transcribe/i.test(m));
}

const modeleRetenu = {};   // par fournisseur : celui qui a marché, pour ne pas relister à chaque fois

async function choisirModele(id, v) {
  const c = lire(v);
  if (c.modele) return c.modele;
  if (modeleRetenu[id]) return modeleRetenu[id];
  const liste = await listerModeles(id, v);
  if (!liste.length) throw new Error(`${FOURNISSEURS[id].nom} : aucun modèle disponible${FOURNISSEURS[id].local ? ' (en as-tu téléchargé un ?)' : ''}`);
  for (const re of FOURNISSEURS[id].prefere || []) {
    const m = liste.find((x) => re.test(x));
    if (m) return (modeleRetenu[id] = m);
  }
  return (modeleRetenu[id] = liste[0]);
}

/* ── Appels ─────────────────────────────────────────────────────────── */
async function appelGemini(consigne, schema, c) {
  const corps = JSON.stringify({
    contents: [{ parts: [{ text: consigne }] }],
    generationConfig: { temperature: 0.9, responseMimeType: 'application/json', responseSchema: schema },
  });
  const essayer = async (modele) => {
    // La clé passe par l'EN-TÊTE : c'est ce qu'attend le nouveau format de clé
    // Google (`AQ.…`), et l'ancien (`AIza…`) l'accepte aussi.
    const d = await lireJson(await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.cles.GEMINI_API_KEY },
      body: corps,
      // Les modèles « flash » récents réfléchissent avant de répondre : avec toute
      // une bibliothèque dans la question, 25 s ne suffisaient plus (sept. 2026).
      signal: AbortSignal.timeout(45000),
    }), 'Gemini');
    const texte = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texte) throw new Error('réponse vide');
    return JSON.parse(texte);
  };
  const base = c.modele ? [c.modele] : MODELES_GEMINI;
  const ordre = modeleRetenu.gemini && !c.modele ? [modeleRetenu.gemini, ...base.filter((m) => m !== modeleRetenu.gemini)] : base;
  let derniere = null;
  for (const m of ordre) {
    try {
      const res = await essayer(m);
      if (modeleRetenu.gemini !== m) { modeleRetenu.gemini = m; console.log(`[IA] Gemini : modèle retenu ${m}`); }
      return res;
    } catch (e) {
      derniere = e;
      // Quota épuisé, modèle absent ou surchargé → on tente le suivant ; sinon on s'arrête.
      if (![429, 404, 500, 503].includes(e.statut) && e.name !== 'TimeoutError') throw e;
      if (modeleRetenu.gemini === m) modeleRetenu.gemini = null;
    }
  }
  throw derniere || new Error('aucun modèle Gemini disponible');
}

const CONSIGNE_JSON = '\n\nRéponds UNIQUEMENT avec l\'objet JSON, sans texte autour ni balises de code.';

async function appelClaude(consigne, c, modele) {
  const d = await lireJson(await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': c.cles.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: modele,
      max_tokens: 2000,
      temperature: 0.9,
      messages: [{ role: 'user', content: consigne + CONSIGNE_JSON }],
    }),
    signal: AbortSignal.timeout(40000),
  }), 'Claude');
  return extraireJson((d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

// ChatGPT, Grok, Ollama et LM Studio parlent tous le format « chat completions » d'OpenAI.
async function appelCompatibleOpenAI(id, consigne, c, modele) {
  const f = FOURNISSEURS[id];
  const base = f.local ? baseLocale(f, c) : f.base;
  const corps = {
    model: modele,
    messages: [{ role: 'user', content: consigne + CONSIGNE_JSON }],
    temperature: 0.9,
  };
  // Mode JSON natif quand le service le connaît (LM Studio ne l'accepte pas toujours).
  if (id !== 'lmstudio') corps.response_format = { type: 'json_object' };
  const d = await lireJson(await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(f.cle ? { Authorization: `Bearer ${c.cles[f.cle]}` } : {}) },
    body: JSON.stringify(corps),
    // Un modèle local sur une machine modeste peut prendre son temps.
    signal: AbortSignal.timeout(f.local ? 120000 : 40000),
  }), f.nom);
  return extraireJson(d?.choices?.[0]?.message?.content);
}

/**
 * Pose la question au fournisseur configuré et renvoie l'objet JSON.
 * @param {string} consigne   le texte complet (humeur + bibliothèque + format attendu)
 * @param {object} schema     schéma JSON (utilisé nativement par Gemini)
 */
export async function demander(consigne, schema, v) {
  const id = fournisseurActif(v);
  if (!id || !iaConfiguree(v)) throw new Error('Aucune IA configurée');
  const c = lire(v);
  if (id === 'gemini') return appelGemini(consigne, schema, c);
  const modele = await choisirModele(id, v);
  return id === 'claude' ? appelClaude(consigne, c, modele) : appelCompatibleOpenAI(id, consigne, c, modele);
}

/** Pour le bouton « Tester » : le fournisseur répond-il, et avec quels modèles ? */
export async function tester(v) {
  const id = fournisseurActif(v);
  if (!id) throw new Error('Choisis une IA');
  const f = FOURNISSEURS[id];
  if (!f.local && !lire(v).cles[f.cle]) throw new Error('Clé manquante');
  let modeles;
  try {
    modeles = await listerModeles(id, v);
  } catch (e) {
    if (e.statut === 401 || e.statut === 403 || e.statut === 400) throw new Error(`Clé refusée par ${f.nom}`);
    if (f.local) throw new Error(`${f.nom} ne répond pas à ${lire(v).urls[f.url] || f.defaut} — est-il démarré ?`);
    throw e;
  }
  if (!modeles.length) throw new Error(`${f.nom} répond, mais aucun modèle n'est disponible`);
  const choisi = lire(v).modele;
  return {
    message: `${f.nom} répond — ${modeles.length} modèle${modeles.length > 1 ? 's' : ''} disponible${modeles.length > 1 ? 's' : ''}${choisi ? `, « ${choisi} » choisi` : ''}`,
    modeles: modeles.slice(0, 200),
  };
}

/** Oublie le modèle mémorisé (après un changement de réglage). */
export function oublierModeles() {
  for (const k of Object.keys(modeleRetenu)) delete modeleRetenu[k];
}
