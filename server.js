'use strict';
/* =====================================================================
   slate — server.js
   The ENTIRE backend in one file: environment, data store, presence,
   REST routes, and Socket.io realtime events.
   Run:   npm install   →   npm start
   ===================================================================== */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

/* =====================================================================
   1 · ENVIRONMENT
   Loads a .env file sitting NEXT TO this file (local dev only).
   On Render, real environment variables are injected — no .env needed.
===================================================================== */
(function loadEnvFile() {
  try {
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.trim().startsWith('#') || !line.trim()) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch { /* ignore */ }
})();

const PORT = Number(process.env.PORT) || 4000;
if (!process.env.JWT_SECRET) {
  console.warn('[slate] WARNING: JWT_SECRET is not set — using an insecure dev secret.');
}
const SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production';
const clientOrigins = new Set(
  (process.env.CLIENT_ORIGIN || 'http://localhost:5500')
    .split(',').map(s => s.trim()).filter(Boolean)
);
const isDev = process.env.NODE_ENV !== 'production';

/* =====================================================================
   2 · DATA STORE
   Simple JSON-file persistence. A `data/` folder appears next to this
   file the first time you run it — you never create it by hand, and
   it's gitignored. Swap this section for Postgres/Mongo later without
   touching anything below it.
===================================================================== */
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const db = { users: {}, servers: {}, messages: [] };

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(db));
    } catch (e) {
      console.warn('[slate] could not persist data:', e.message);
    }
  }, 400);
}

try {
  if (fs.existsSync(DATA_FILE)) {
    Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    console.log(`[slate] loaded ${Object.keys(db.users).length} users / ${db.messages.length} messages from disk`);
  }
} catch (e) { console.warn('[slate] could not load data file:', e.message); }

function flushAndExit() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db));
  } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit); // Render sends SIGTERM before shutting down

/* ---- store helpers ---- */
const uid = () => crypto.randomUUID();
const now = () => Date.now();
const getUser = (id) => db.users[id] || null;

function findUserByEmail(email) {
  const e = String(email).toLowerCase();
  return Object.values(db.users).find(u => u.email.toLowerCase() === e) || null;
}
function findUserByUsername(username) {
  const n = String(username).toLowerCase();
  return Object.values(db.users).find(u => u.username.toLowerCase() === n) || null;
}
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, displayName: u.displayName,
    bio: u.bio || '', avatar: u.avatar || null, createdAt: u.createdAt
  };
}
const selfUser = (u) => ({ ...publicUser(u), email: u.email });
function dmRoomKey(a, b) { const [x, y] = [a, b].sort(); return `dm:${x}:${y}`; }
function findServerByChannel(channelId) {
  for (const s of Object.values(db.servers)) {
    if (s.channels.some(c => c.id === channelId)) return s;
  }
  return null;
}
function inviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

/* =====================================================================
   3 · PRESENCE  (who is online — shared by REST routes and sockets)
===================================================================== */
const socketsByUser = new Map();
const presence = {
  add(socket) {
    if (!socketsByUser.has(socket.userId)) socketsByUser.set(socket.userId, new Set());
    socketsByUser.get(socket.userId).add(socket.id);
    return socketsByUser.get(socket.userId).size === 1; // true = user just came online
  },
  remove(socket) {
    const set = socketsByUser.get(socket.userId);
    if (!set) return false;
    set.delete(socket.id);
    if (set.size === 0) { socketsByUser.delete(socket.userId); return true; } // user went offline
    return false;
  },
  isOnline(userId) { return socketsByUser.has(userId); }
};

/* =====================================================================
   4 · EXPRESS APP + CORS
===================================================================== */
const app = express();
const httpServer = http.createServer(app);

// CLIENT_ORIGIN (comma-separated list) + any localhost port for development.
// IMPORTANT: origins are scheme + host only — no path. Your GitHub Pages
// site lives at https://<username>.github.io/<repo>, but its ORIGIN is
// just https://<username>.github.io
const originFn = (origin, cb) => {
  if (!origin) return cb(null, true); // curl / same-origin requests
  if (clientOrigins.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return cb(null, true);
  }
  return cb(new Error('Blocked by CORS'));
};
app.use(cors({ origin: originFn, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '512kb' }));

if (isDev) {
  app.use((req, res, next) => {
    res.on('finish', () => console.log(req.method, req.originalUrl, res.statusCode));
    next();
  });
}

/* =====================================================================
   5 · SOCKET.IO  (realtime: messages, typing, presence, notifications)
===================================================================== */
const io = new Server(httpServer, { cors: { origin: originFn, methods: ['GET', 'POST'] } });

// handshake auth — the token arrives from the client's `auth` option
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('auth'));
  try {
    const payload = jwt.verify(token, SECRET);
    if (!getUser(payload.uid)) return next(new Error('auth'));
    socket.userId = payload.uid;
    next();
  } catch { next(new Error('auth')); }
});

const lastMessageAt = new Map(); // simple per-user flood control

io.on('connection', (socket) => {
  const me = () => getUser(socket.userId);

  // personal room (DMs, notifications) + one room per server
  socket.join('user:' + socket.userId);
  for (const s of Object.values(db.servers)) {
    if (s.memberIds.includes(socket.userId)) socket.join('server:' + s.id);
  }
  if (presence.add(socket)) io.emit('presence:update', { userId: socket.userId, online: true });

  socket.on('message:send', (payload, ack) => {
    const user = me(); if (!user) return;
    const p = payload || {};
    const text = typeof p.text === 'string' ? p.text.trim().slice(0, 2000) : '';
    if (!text) return;
    if (Date.now() - (lastMessageAt.get(user.id) || 0) < 250) return; // slow down
    lastMessageAt.set(user.id, Date.now());

    if (p.roomType === 'channel') {
      const server = findServerByChannel(p.target);
      if (!server || !server.memberIds.includes(user.id)) return;
      const message = {
        id: uid(), type: 'channel', room: p.target,
        authorId: user.id, text, createdAt: now()
      };
      db.messages.push(message);
      save();
      io.to('server:' + server.id).emit('message:new', {
        ...message,
        author: publicUser(user),
        info: { type: 'channel', serverId: server.id, channelId: p.target }
      });
      if (typeof ack === 'function') ack({ ok: true, id: message.id });

    } else if (p.roomType === 'dm') {
      const peer = getUser(p.target);
      if (!peer || !user.friends.includes(peer.id)) return;
      const message = {
        id: uid(), type: 'dm', room: dmRoomKey(user.id, peer.id),
        authorId: user.id, text, createdAt: now()
      };
      db.messages.push(message);
      save();
      io.to('user:' + user.id).to('user:' + peer.id).emit('message:new', {
        ...message,
        author: publicUser(user),
        info: { type: 'dm', userIds: [user.id, peer.id] }
      });
      if (typeof ack === 'function') ack({ ok: true, id: message.id });
    }
  });

  socket.on('typing', (payload) => {
    const user = me(); if (!user) return;
    const p = payload || {};
    const isTyping = !!p.isTyping;
    if (p.roomType === 'channel') {
      const server = findServerByChannel(p.target);
      if (!server || !server.memberIds.includes(user.id)) return;
      socket.to('server:' + server.id).emit('typing', {
        roomType: 'channel', room: p.target,
        userId: user.id, displayName: user.displayName, isTyping
      });
    } else if (p.roomType === 'dm') {
      const peer = getUser(p.target);
      if (!peer || !user.friends.includes(peer.id)) return;
      socket.to('user:' + peer.id).emit('typing', {
        roomType: 'dm', room: dmRoomKey(user.id, peer.id),
        userId: user.id, displayName: user.displayName, isTyping
      });
    }
  });

  socket.on('disconnect', () => {
    if (presence.remove(socket)) {
      io.emit('presence:update', { userId: socket.userId, online: false });
    }
  });
});

// keep every socket of a user in sync with their server memberships
// (used by the REST routes below when they join/create/leave)
function syncRooms(userId, room, join) {
  for (const sock of io.of('/').sockets.values()) {
    if (sock.userId === userId) (join ? sock.join(room) : sock.leave(room));
  }
}

/* =====================================================================
   6 · REST API
===================================================================== */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = getUser(payload.uid);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — sign in again' });
  }
}

const issueToken = (user) => jwt.sign({ uid: user.id }, SECRET, { expiresIn: '7d' });
const bad = (res, code, msg) => res.status(code).json({ error: msg });
const withOnline = (u) => ({ ...publicUser(u), online: presence.isOnline(u.id) });

function friendState(me, other) {
  if (me.friends.includes(other.id)) return 'friend';
  if (me.incoming.includes(other.id)) return 'incoming'; // they sent me a request
  if (me.outgoing.includes(other.id)) return 'outgoing';
  return 'none';
}

function serializeServer(s) {
  return {
    id: s.id, name: s.name, inviteCode: s.inviteCode, ownerId: s.ownerId,
    channels: s.channels.map(c => ({ id: c.id, name: c.name })),
    members: s.memberIds.map(id => getUser(id)).filter(Boolean).map(withOnline)
  };
}

function history(req, type, room) {
  const before = Number(req.query.before) || Infinity;
  const list = db.messages
    .filter(m => m.type === type && m.room === room && m.createdAt < before)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
  list.reverse();
  const users = {};
  for (const m of list) if (!users[m.authorId]) users[m.authorId] = publicUser(getUser(m.authorId));
  return { messages: list, users };
}

/* ---------- auth ---------- */
app.post('/api/auth/signup', async (req, res) => {
  const { email, username, displayName, password } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) return bad(res, 400, 'Enter a valid email address');
  if (!username || !USERNAME_RE.test(username)) {
    return bad(res, 400, 'Username must be 3–20 characters (letters, numbers, underscore)');
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return bad(res, 400, 'Password must be at least 8 characters');
  }
  if (findUserByEmail(email)) return bad(res, 409, 'That email is already registered');
  if (findUserByUsername(username)) return bad(res, 409, 'That username is already taken');

  const user = {
    id: uid(),
    email: email.toLowerCase(),
    username,
    displayName: (displayName || '').trim().slice(0, 32) || username,
    passwordHash: await bcrypt.hash(password, 10),
    bio: '', avatar: null,
    friends: [], incoming: [], outgoing: [],
    createdAt: now()
  };
  db.users[user.id] = user;
  save();
  res.json({ token: issueToken(user), user: selfUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return bad(res, 400, 'Email/username and password are required');
  const user = findUserByEmail(identifier) || findUserByUsername(identifier);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return bad(res, 401, 'Wrong credentials — check your email/username and password');
  }
  res.json({ token: issueToken(user), user: selfUser(user) });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: selfUser(req.user) }));

/* ---------- profile ---------- */
app.patch('/api/me', auth, (req, res) => {
  const u = req.user;
  const { displayName, bio, avatar } = req.body || {};

  if (displayName !== undefined) {
    const name = String(displayName).trim().slice(0, 32);
    if (!name) return bad(res, 400, 'Display name cannot be empty');
    u.displayName = name;
  }
  if (bio !== undefined) u.bio = String(bio).trim().slice(0, 280);
  if (avatar !== undefined) {
    if (avatar === null) u.avatar = null;
    else if (typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length < 400000) {
      u.avatar = avatar;
    } else return bad(res, 400, 'Avatar must be an image under ~300KB');
  }
  save();

  const pub = publicUser(u);
  for (const fid of u.friends) io.to('user:' + fid).emit('user:update', { user: pub });
  io.to('user:' + u.id).emit('user:update', { user: pub }); // own tabs stay in sync

  res.json({ user: selfUser(u) });
});

/* ---------- user search ---------- */
app.get('/api/users/search', auth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ results: [] });
  const me = req.user;
  const results = Object.values(db.users)
    .filter(u => u.id !== me.id &&
      (u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)))
    .slice(0, 20)
    .map(u => ({ ...publicUser(u), online: presence.isOnline(u.id), state: friendState(me, u) }));
  res.json({ results });
});

/* ---------- friends ---------- */
app.get('/api/friends', auth, (req, res) => {
  const me = req.user;
  res.json({
    friends: me.friends.map(id => withOnline(getUser(id))).filter(Boolean),
    incoming: me.incoming.map(id => withOnline(getUser(id))).filter(Boolean),
    outgoing: me.outgoing.map(id => withOnline(getUser(id))).filter(Boolean)
  });
});

app.post('/api/friends/request', auth, (req, res) => {
  const target = getUser(req.body && req.body.userId);
  const me = req.user;
  if (!target || target.id === me.id) return bad(res, 400, 'Pick someone else to add');
  if (me.friends.includes(target.id)) return bad(res, 409, 'You are already friends');
  if (me.outgoing.includes(target.id)) return bad(res, 409, 'Request already sent');
  if (me.incoming.includes(target.id)) {
    return bad(res, 409, `${target.username} already sent you a request — accept it in the Friends panel`);
  }
  me.outgoing.push(target.id);
  target.incoming.push(me.id);
  save();
  io.to('user:' + target.id).emit('friend:request', { user: { ...publicUser(me), online: true } });
  io.to('user:' + target.id).emit('friends:sync');
  res.json({ ok: true });
});

app.post('/api/friends/accept', auth, (req, res) => {
  const other = getUser(req.body && req.body.userId);
  const me = req.user;
  if (!other || !me.incoming.includes(other.id)) return bad(res, 400, 'No pending request from that user');
  me.incoming = me.incoming.filter(id => id !== other.id);
  other.outgoing = other.outgoing.filter(id => id !== me.id);
  if (!me.friends.includes(other.id)) me.friends.push(other.id);
  if (!other.friends.includes(me.id)) other.friends.push(me.id);
  save();
  io.to('user:' + other.id).emit('friend:accepted', { user: publicUser(me) });
  io.to('user:' + other.id).emit('friends:sync');
  res.json({ ok: true });
});

app.post('/api/friends/decline', auth, (req, res) => {
  const other = getUser(req.body && req.body.userId);
  const me = req.user;
  if (!other) return bad(res, 400, 'Unknown user');
  me.incoming = me.incoming.filter(id => id !== other.id);
  other.outgoing = other.outgoing.filter(id => id !== me.id);
  save();
  io.to('user:' + other.id).emit('friends:sync');
  res.json({ ok: true });
});

app.post('/api/friends/remove', auth, (req, res) => {
  const other = getUser(req.body && req.body.userId);
  const me = req.user;
  if (!other || !me.friends.includes(other.id)) return bad(res, 400, 'Not friends with that user');
  me.friends = me.friends.filter(id => id !== other.id);
  other.friends = other.friends.filter(id => id !== me.id);
  save();
  io.to('user:' + other.id).emit('friends:sync');
  res.json({ ok: true });
});

/* ---------- servers & channels ---------- */
app.get('/api/servers', auth, (req, res) => {
  const mine = Object.values(db.servers).filter(s => s.memberIds.includes(req.user.id));
  res.json({ servers: mine.map(serializeServer) });
});

app.post('/api/servers', auth, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 40);
  if (name.length < 2) return bad(res, 400, 'Server name needs at least 2 characters');
  const me = req.user;
  const s = {
    id: uid(), name, ownerId: me.id, memberIds: [me.id],
    inviteCode: inviteCode(),
    channels: [{ id: uid(), name: 'general', createdAt: now() }]
  };
  db.servers[s.id] = s;
  save();
  syncRooms(me.id, 'server:' + s.id, true); // creator must receive live messages
  res.json({ server: serializeServer(s) });
});

app.post('/api/servers/join', auth, (req, res) => {
  const code = String((req.body && req.body.inviteCode) || '').trim().toUpperCase();
  if (!code) return bad(res, 400, 'Enter an invite code');
  const s = Object.values(db.servers).find(x => x.inviteCode === code);
  if (!s) return bad(res, 404, 'No server matches that invite code');
  const me = req.user;
  if (s.memberIds.includes(me.id)) return bad(res, 409, 'You are already in that server');
  s.memberIds.push(me.id);
  save();
  syncRooms(me.id, 'server:' + s.id, true);
  io.to('server:' + s.id).emit('server:sync', { serverId: s.id });
  res.json({ server: serializeServer(s) });
});

app.post('/api/servers/:id/channels', auth, (req, res) => {
  const s = db.servers[req.params.id];
  if (!s) return bad(res, 404, 'Server not found');
  if (!s.memberIds.includes(req.user.id)) return bad(res, 403, 'Join the server first');
  const name = String((req.body && req.body.name) || '')
    .trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
  if (!/^[a-z0-9_-]{1,24}$/.test(name)) {
    return bad(res, 400, 'Channel name: 1–24 chars — letters, numbers, - and _');
  }
  if (s.channels.some(c => c.name === name)) return bad(res, 409, 'A channel with that name already exists');
  const channel = { id: uid(), name, createdAt: now() };
  s.channels.push(channel);
  save();
  io.to('server:' + s.id).emit('server:sync', { serverId: s.id });
  res.json({ channel });
});

app.delete('/api/servers/:id/leave', auth, (req, res) => {
  const s = db.servers[req.params.id];
  if (!s) return bad(res, 404, 'Server not found');
  const me = req.user;
  if (!s.memberIds.includes(me.id)) return bad(res, 400, 'You are not in that server');
  s.memberIds = s.memberIds.filter(id => id !== me.id);
  if (s.memberIds.length === 0) {
    delete db.servers[s.id];
  } else {
    if (s.ownerId === me.id) s.ownerId = s.memberIds[0]; // transfer ownership
    io.to('server:' + s.id).emit('server:sync', { serverId: s.id });
  }
  syncRooms(me.id, 'server:' + s.id, false);
  save();
  res.json({ ok: true });
});

/* ---------- message history ---------- */
app.get('/api/messages/channel/:channelId', auth, (req, res) => {
  const server = findServerByChannel(req.params.channelId);
  if (!server) return bad(res, 404, 'Channel not found');
  if (!server.memberIds.includes(req.user.id)) return bad(res, 403, 'No access to this channel');
  res.json(history(req, 'channel', req.params.channelId));
});

app.get('/api/messages/dm/:userId', auth, (req, res) => {
  const other = getUser(req.params.userId);
  if (!other) return bad(res, 404, 'User not found');
  if (!req.user.friends.includes(other.id)) return bad(res, 403, 'You can only message friends');
  res.json(history(req, 'dm', dmRoomKey(req.user.id, other.id)));
});

/* =====================================================================
   7 · HEALTH, 404, ERROR HANDLER, LISTEN
===================================================================== */
// Render's default health check hits "/"
app.get('/', (req, res) => res.json({ ok: true, name: 'slate-server', uptime: Math.floor(process.uptime()) }));
app.get('/api/health', (req, res) => res.json({
  ok: true,
  uptime: Math.floor(process.uptime()),
  users: Object.keys(db.users).length,
  messages: db.messages.length
}));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ error: 'Invalid or too-large JSON body' });
  }
  if (err && err.message === 'Blocked by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

httpServer.listen(PORT, () => console.log(`slate-server listening on :${PORT}`));
