// Client for the "Regarder ensemble" watch party.
// - REST: create / info / join.
// - Socket.io: presence, ready-check, launch, play/pause/seek sync.
// The socket + "current session" live in module scope so they survive SPA
// navigation (invite → room → player) without reconnecting.
import { io } from 'socket.io-client';
import authService from '../../services/authService';

import { tr } from '../../i18n';
const base = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

let socket = null;
let current = null; // { sessionId, pid, isHost, name, avatar }

const listeners = {
  participants: new Set(),
  launch: new Set(),
  control: new Set(),
  sync: new Set(),
  ended: new Set(),
  chat: new Set(),
  reaction: new Set(),
  error: new Set(),
};

const CUR_KEY = 'nova_watch_current';
function persist() {
  try { current ? localStorage.setItem(CUR_KEY, JSON.stringify(current)) : localStorage.removeItem(CUR_KEY); } catch {}
}
export function getCurrent() {
  if (current) return current;
  try { current = JSON.parse(localStorage.getItem(CUR_KEY)); } catch { current = null; }
  return current;
}

// ─── REST ────────────────────────────────────────────────────
export async function createSession(media) {
  const token = authService.getToken();
  const res = await fetch(`${base()}/api/watch/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(media),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || tr('Création impossible'));
  return res.json(); // { sessionId, hostPid }
}

export async function getSessionInfo(id) {
  const res = await fetch(`${base()}/api/watch/${id}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || tr('Séance introuvable'));
  return res.json(); // { media, hostName, started, count }
}

export async function joinSession(id, { name, avatar }) {
  const res = await fetch(`${base()}/api/watch/${id}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, avatar }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || tr('Impossible de rejoindre'));
  return res.json(); // { token, pid, media, hostName, user }
}

// ─── Socket ──────────────────────────────────────────────────
export function connectSession(identity) {
  current = identity;
  persist();
  if (!socket) {
    // The socket is AUTHENTICATED server-side — send the current JWT (host = user
    // token, guest = guest token). Identity/host-role are re-derived from it.
    socket = io(base(), { transports: ['websocket', 'polling'], auth: { token: authService.getToken() } });
  }

  const hello = () => socket.emit('watch:hello', identity);
  socket.off('connect').on('connect', hello);
  if (socket.connected) hello();

  socket.off('connect_error').on('connect_error', (e) =>
    listeners.error.forEach((fn) => fn({ error: e?.message || tr('Connexion refusée') })));

  Object.keys(listeners).forEach((ev) => {
    socket.off(`watch:${ev}`).on(`watch:${ev}`, (data) => listeners[ev].forEach((fn) => fn(data)));
  });
  return socket;
}

export function on(ev, fn) {
  if (!listeners[ev]) return () => {};
  listeners[ev].add(fn);
  return () => listeners[ev].delete(fn);
}

export const setReady = (ready) => socket?.emit('watch:ready', { ready });
export const launch = () => socket?.emit('watch:launch');
export const sendControl = (state) => socket?.emit('watch:control', state);
export const sendSync = (state) => socket?.emit('watch:sync', state);
export const sendChat = (text) => socket?.emit('watch:chat', { text });
export const sendReaction = (emoji) => socket?.emit('watch:reaction', { emoji });
export const sendBuffering = (buffering) => socket?.emit('watch:buffering', { buffering });
export const endSession = () => socket?.emit('watch:end');
export const isConnected = () => !!socket;

export function leave() {
  try { socket?.disconnect(); } catch {}
  socket = null;
  current = null;
  persist();
}
