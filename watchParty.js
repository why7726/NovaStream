// ═══════════════════════════════════════════════════════════
//  WATCH PARTY — "Regarder ensemble" (Bêta 2.5)  [HARDENED]
//  Real-time synchronized viewing between a Nova host and guests
//  who don't need an account. Security model:
//   • Socket.io is AUTHENTICATED (handshake JWT). Identity + host role
//     are derived from the token, never trusted from the client — so
//     nobody can impersonate the host by guessing a session id.
//   • Guest tokens are short-lived, bound to one session, and are
//     revoked the moment the host ends it (proxyAuth checks isSessionActive).
//   • Inputs are sanitized & size-capped; sessions/participants are quota'd;
//     join/create are rate-limited.
// ═══════════════════════════════════════════════════════════
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const HOST_GRACE_MS = 10 * 60 * 1000; // keep a séance alive this long after the host leaves (to share the link & come back)
const GUEST_TOKEN_TTL = '6h';
const MAX_SESSIONS = 200;         // global safety cap
const MAX_PER_HOST = 3;           // concurrent sessions per host user
const MAX_PARTICIPANTS = 12;      // per session
const NAME_MAX = 32;
const CHAT_MAX = 300;
const AVATAR_URL_MAX = 400000;    // ~300KB base64 photo ceiling
// Strip ASCII control characters (defined via constructor to keep source pure-ASCII).
const CTRL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'ip';

// ─── input sanitizers ────────────────────────────────────────
function sanitizeName(v) {
  if (typeof v !== 'string') return 'Invité';
  const s = v.replace(CTRL_CHARS, '').trim().slice(0, NAME_MAX);
  return s || 'Invité';
}
function sanitizeAvatar(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.type === 'photo') {
    if (typeof a.url !== 'string' || a.url.length > AVATAR_URL_MAX || !/^data:image\//.test(a.url)) return null;
    return { type: 'photo', url: a.url };
  }
  if (a.type === 'emoji') {
    return {
      type: 'emoji',
      animal: typeof a.animal === 'string' ? a.animal.slice(0, 8) : '🙂',
      accessory: typeof a.accessory === 'string' ? a.accessory.slice(0, 12) : 'none',
      color: typeof a.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(a.color) ? a.color : '#6366F1',
    };
  }
  return null;
}

// tiny sliding-window rate limiter
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    return true;
  };
}

export function setupWatchParty({ app, io, JWT_SECRET, authMiddleware, watchApi }) {
  /** @type {Map<string, any>} */
  const sessions = new Map();
  const genId = () => crypto.randomBytes(6).toString('hex');   // 12-char, ~2^48 space
  const genPid = () => crypto.randomBytes(8).toString('hex');

  const joinLimiter = makeLimiter(30, 60000);   // 30 joins / min / IP
  const createLimiter = makeLimiter(10, 60000);  // 10 creates / min / user

  // Expose session liveness to the Plex proxy so ending a séance instantly
  // revokes its guest tokens' streaming access.
  if (watchApi) watchApi.isSessionActive = (id) => sessions.has(id);

  const publicSession = (s) => ({
    id: s.id,
    media: s.media,
    hostName: s.host.name,
    started: s.started,
    hostPresent: [...s.participants.values()].some((p) => p.isHost),
    participants: [...s.participants.values()].map((p) => ({
      pid: p.pid, name: p.name, avatar: p.avatar, ready: p.ready, isHost: p.isHost, buffering: !!p.buffering,
    })),
  });
  const emitState = (s) => io.to(s.id).emit('watch:participants', publicSession(s));

  // ─── REST ──────────────────────────────────────────────────
  app.post('/api/watch/create', authMiddleware, (req, res) => {
    if (req.user.guest) return res.status(403).json({ error: 'Les invités ne peuvent pas créer de séance' });
    if (!createLimiter(String(req.user.id))) return res.status(429).json({ error: 'Trop de séances créées, réessaie dans une minute' });
    if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ error: 'Serveur saturé, réessaie plus tard' });
    const active = [...sessions.values()].filter((s) => s.host.userId === req.user.id).length;
    if (active >= MAX_PER_HOST) return res.status(429).json({ error: 'Tu as déjà trop de séances ouvertes' });

    const { mediaId, mediaType, mediaTitle, mediaPoster, mediaBackdrop } = req.body || {};
    if (!mediaId || !/^[\w:-]{1,64}$/.test(String(mediaId))) return res.status(400).json({ error: 'mediaId invalide' });
    const id = genId();
    const hostPid = genPid();
    sessions.set(id, {
      id, createdAt: Date.now(), started: false,
      host: { userId: req.user.id, name: sanitizeName(req.user.username || 'Hôte'), pid: hostPid },
      media: {
        id: String(mediaId),
        type: ['movie', 'show', 'episode'].includes(mediaType) ? mediaType : 'movie',
        title: sanitizeName(mediaTitle || 'un film').slice(0, 120) || 'un film',
        poster: typeof mediaPoster === 'string' ? mediaPoster.slice(0, 1000) : null,
        backdrop: typeof mediaBackdrop === 'string' ? mediaBackdrop.slice(0, 1000) : null,
      },
      participants: new Map(),
      state: { playing: false, position: 0, at: Date.now() },
    });
    // Return hostPid so the host's client knows its OWN participant id (needed so
    // it doesn't count itself in the "waiting for…" buffering list → auto-wait deadlock).
    res.json({ sessionId: id, hostPid });
  });

  app.get('/api/watch/:id', (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Séance introuvable ou terminée' });
    res.json({ media: s.media, hostName: s.host.name, started: s.started, count: s.participants.size });
  });

  app.post('/api/watch/:id/join', (req, res) => {
    if (!joinLimiter(clientIp(req))) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans une minute' });
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Séance introuvable ou terminée' });
    if (s.participants.size >= MAX_PARTICIPANTS) return res.status(403).json({ error: 'Séance pleine' });
    const name = sanitizeName(req.body?.name);
    const pid = genPid();
    const token = jwt.sign({ guest: true, sessionId: s.id, pid, username: name }, JWT_SECRET, { expiresIn: GUEST_TOKEN_TTL });
    res.json({
      token, pid, media: s.media, hostName: s.host.name,
      user: { id: null, username: name, isAdmin: false, guest: true, avatar: null, sessionId: s.id },
    });
  });

  // ─── Socket.io (AUTHENTICATED) ─────────────────────────────
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentification requise'));
      socket.data.auth = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      next();
    } catch {
      next(new Error('Jeton invalide'));
    }
  });

  io.on('connection', (socket) => {
    let sid = null;
    let pid = null;
    let isHostConn = false;
    const chatOk = makeLimiter(5, 2000);      // per-socket
    const reactOk = makeLimiter(12, 3000);

    socket.on('watch:hello', ({ sessionId, avatar, name } = {}) => {
      const auth = socket.data.auth || {};
      const s = sessions.get(sessionId);
      if (!s) { socket.emit('watch:ended'); return; }

      let host = false, thePid, dispName;
      if (auth.guest) {
        // Guests are locked to the session encoded in their token.
        if (auth.sessionId !== sessionId) { socket.emit('watch:error', { error: 'Jeton invité invalide' }); return; }
        thePid = auth.pid; dispName = name || auth.username || 'Invité';
      } else if (auth.id != null) {
        // Only the session's real owner is the host; other Nova users join as guests.
        if (auth.id === s.host.userId) { host = true; thePid = s.host.pid; dispName = s.host.name; }
        else { thePid = 'u' + auth.id; dispName = auth.username || name || 'Invité'; }
      } else {
        socket.emit('watch:error', { error: 'Non autorisé' }); return;
      }

      if (!s.participants.has(thePid) && s.participants.size >= MAX_PARTICIPANTS) {
        socket.emit('watch:error', { error: 'Séance pleine' }); return;
      }

      sid = sessionId; pid = thePid; isHostConn = host;
      socket.join(sid);
      if (host) s.hostGone = null; // host is back — cancel the grace timer
      s.participants.set(pid, {
        pid, name: sanitizeName(dispName), avatar: sanitizeAvatar(avatar),
        isHost: host, ready: true, buffering: false, socketId: socket.id,
      });
      emitState(s);
      if (s.started) socket.emit('watch:launch', { mediaId: s.media.id, state: s.state });
    });

    socket.on('watch:ready', ({ ready } = {}) => {
      const s = sessions.get(sid); if (!s) return;
      const p = s.participants.get(pid); if (!p) return;
      p.ready = !!ready; emitState(s);
    });

    socket.on('watch:launch', () => {
      const s = sessions.get(sid); if (!s || !isHostConn) return;
      s.started = true; s.state = { playing: true, position: 0, at: Date.now() };
      io.to(sid).emit('watch:launch', { mediaId: s.media.id, state: s.state });
    });

    socket.on('watch:control', ({ playing, position } = {}) => {
      const s = sessions.get(sid); if (!s || !isHostConn) return;
      s.state = { playing: !!playing, position: Number(position) || 0, at: Date.now() };
      socket.to(sid).emit('watch:control', s.state);
    });

    socket.on('watch:sync', ({ playing, position } = {}) => {
      const s = sessions.get(sid); if (!s || !isHostConn) return;
      s.state = { playing: !!playing, position: Number(position) || 0, at: Date.now() };
      socket.to(sid).emit('watch:sync', s.state);
    });

    socket.on('watch:chat', ({ text } = {}) => {
      const s = sessions.get(sid); if (!s) return;
      const p = s.participants.get(pid); if (!p) return;
      if (!chatOk(socket.id)) return;
      const clean = String(text || '').replace(CTRL_CHARS, '').trim().slice(0, CHAT_MAX);
      if (!clean) return;
      io.to(sid).emit('watch:chat', { pid, name: p.name, avatar: p.avatar, text: clean, at: Date.now() });
    });

    socket.on('watch:reaction', ({ emoji } = {}) => {
      const s = sessions.get(sid); if (!s) return;
      const p = s.participants.get(pid); if (!p) return;
      if (!reactOk(socket.id)) return;
      io.to(sid).emit('watch:reaction', { pid, name: p.name, emoji: String(emoji || '').slice(0, 8), at: Date.now() });
    });

    socket.on('watch:buffering', ({ buffering } = {}) => {
      const s = sessions.get(sid); if (!s) return;
      const p = s.participants.get(pid); if (!p || p.buffering === !!buffering) return;
      p.buffering = !!buffering; emitState(s);
    });

    socket.on('watch:end', () => {
      const s = sessions.get(sid); if (!s || !isHostConn) return;
      io.to(sid).emit('watch:ended'); sessions.delete(sid);
    });

    socket.on('disconnect', () => {
      const s = sessions.get(sid); if (!s) return;
      const p = s.participants.get(pid);
      s.participants.delete(pid);
      // Host leaving does NOT end the séance immediately — they may just be
      // switching apps to share the link. Start a grace timer instead; the
      // reaper ends it only if they don't come back (or they click "Terminer").
      if (p?.isHost) s.hostGone = Date.now();
      emitState(s);
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      let dead = false;
      if (now - s.createdAt > SESSION_TTL_MS) dead = true;                              // hard 6h cap
      else if (s.hostGone && now - s.hostGone > HOST_GRACE_MS) dead = true;             // host didn't return
      else if (!s.hostGone && s.participants.size === 0 && now - s.createdAt > 120000) dead = true; // created but never used
      if (dead) { io.to(id).emit('watch:ended'); sessions.delete(id); }
    }
  }, 30000).unref?.();

  console.log('  ║  Watch:   Regarder ensemble OK (securise)       ║');
}
