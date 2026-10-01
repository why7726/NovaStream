// Version audio préférée : VF (doublage français) ou VO (version originale —
// japonais pour un animé, anglais pour un film américain, etc.).
// Un seul mot dans toute l'app : « VO », le même que l'étiquette des affiches.
//
// Beaucoup de fichiers d'animés sont mal étiquetés : les deux pistes sont
// marquées « English » et seul le TITRE de la piste (« Jap », « VOSTFR »…)
// dit la vérité. On regarde donc le titre d'abord, la langue ensuite.
import { useSyncExternalStore } from 'react';

import { tr } from '../../i18n';
const KEY = 'nova_audio_pref';
const EVT = 'nova-audio-pref';

export function getAudioPref() {
  try { return localStorage.getItem(KEY) === 'vao' ? 'vao' : 'vf'; } catch { return 'vf'; }
}

export function setAudioPref(v) {
  try { localStorage.setItem(KEY, v === 'vao' ? 'vao' : 'vf'); } catch {}
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb) {
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(EVT, cb); window.removeEventListener('storage', cb); };
}

export function useAudioPref() {
  return useSyncExternalStore(subscribe, getAudioPref, () => 'vf');
}

const FR = /\b(vf|vff|vfq|vfi|truefrench|french|fran[çc]ais|fre|fra)\b/i;
const ORIG = /\b(vo|vao|vost|vostfr|jap|jpn|japonais|japanese|original|sub|subbed)\b/i;

/** 'vf' | 'vao' | 'other' pour une piste audio Plex. */
export function classifyAudio(stream) {
  if (!stream) return 'other';
  const title = `${stream.title || ''} ${stream.displayTitle || ''} ${stream.extendedDisplayTitle || ''}`;
  const code = `${stream.languageCode || ''}`;
  const lang = `${stream.language || ''}`;

  // Le titre prime : c'est le seul champ fiable sur les fichiers mal tagués.
  if (FR.test(title)) return 'vf';
  if (ORIG.test(title)) return 'vao';
  if (/^(fre|fra|fr)$/i.test(code) || FR.test(lang)) return 'vf';
  if (/^(jpn|ja|jp)$/i.test(code) || /japonais|japanese/i.test(lang)) return 'vao';
  return 'other';
}

/** Libellé lisible : « Français (VF) », « Japonais (VO) »… */
export function audioLabel(stream) {
  const kind = classifyAudio(stream);
  const raw = (stream?.displayTitle || stream?.title || stream?.language || tr('Piste')).trim();
  if (kind === 'vf') return tr('Français (VF) · {0}', [raw]);
  if (kind === 'vao') return tr('Version originale (VO) · {0}', [raw]);
  return raw;
}

/** Vrai si le titre propose réellement les deux versions. */
export function hasBothVersions(streams = []) {
  const kinds = new Set(streams.map(classifyAudio));
  return kinds.has('vf') && kinds.has('vao');
}

const LANGS = { english: tr('Anglais'), japanese: tr('Japonais'), korean: tr('Coréen'), spanish: tr('Espagnol'),
  german: tr('Allemand'), italian: tr('Italien'), chinese: tr('Chinois'), portuguese: tr('Portugais') };

function shortLang(stream) {
  const raw = (stream?.language || stream?.title || '').trim();
  return LANGS[raw.toLowerCase()] || raw || tr('Autre');
}

/**
 * Les deux versions à proposer, adaptées au fichier :
 *  · VF + VO quand les deux existent ;
 *  · « Anglais » + VO quand il n'y a pas de doublage français (cas des animés) ;
 *  · rien du tout s'il n'y a qu'une seule piste — un bouton inutile est pire
 *    qu'un bouton absent.
 * `id` reste 'vf' | 'vao' en interne : 'vf' = « la piste qui n'est pas la VO ».
 */
export function versionOptions(streams = []) {
  if (!streams || streams.length < 2) return null;
  const vao = streams.find((s) => classifyAudio(s) === 'vao');
  if (!vao) return null;
  const vf = streams.find((s) => classifyAudio(s) === 'vf');
  const other = vf || streams.find((s) => s !== vao);
  if (!other) return null;
  return [
    { id: 'vf', label: vf ? 'VF' : shortLang(other) },
    { id: 'vao', label: 'VO' },
  ];
}

/** Choisit la piste à jouer selon la préférence, avec repli raisonnable. */
export function pickAudioStream(streams = [], pref = getAudioPref()) {
  if (!streams.length) return null;
  const want = streams.find((s) => classifyAudio(s) === pref);
  if (want) return want;
  // pas de VO explicite : on prend une piste qui n'est pas la VF
  if (pref === 'vao') {
    const notFr = streams.find((s) => classifyAudio(s) !== 'vf');
    if (notFr) return notFr;
  }
  return streams.find((s) => s.selected) || streams[0];
}

export default { getAudioPref, setAudioPref, useAudioPref, classifyAudio, audioLabel, hasBothVersions, pickAudioStream };
