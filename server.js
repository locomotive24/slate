'use strict';
/* =====================================================================
   slate — server.js  (Express + Socket.io + MongoDB Atlas)
   All data now lives in MongoDB → survives every restart & redeploy.
   ===================================================================== */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const { Server } = require('socket.io');

/* ---------- 1 · environment ---------- */
(function loadEnvFile() {
  try {
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.trim().startsWith('#') || !line.trim()) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch { /* ignore */ }
})();

const PORT = Number(process.env.PORT) || 4000;
if (!process.env.JWT_SECRET) console.warn('[slate] WARNING: JWT_SECRET is not set — using an insecure dev secret.');
const SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production';
const clientOrigins = new Set(
  (process.env.CLIENT_ORIGIN || 'http://localhost:5500').split(',').map(s => s.trim()).filter(Boolean)
);
const isDev = process.env.NODE_ENV !== 'production';
const MONGODB_URI = process.env.MONGODB_URI || '';

/* ---------- 2 · data store: MongoDB + small in-memory mirror ----------
   Users and servers are mirrored in memory for instant reads and are
   written back to Mongo on every change. Messages live ONLY in Mongo
   (one document per message), so history can grow without limit.   */
const db = { users: {}, servers: {} };

let mongoClient = null, usersCol, serversCol, messagesCol;

const clone = (o) => JSON.parse(JSON.stringify(o));
const stripDoc = (d) => { if (!d) return d; const { _id, ...rest } = d; return rest; };

async function initMongo() {
  if (!MONGODB_URI) {
    console.error('[slate] FATAL: MONGODB_URI is not set.');
    console.error('[slate] Add it on Render → Environment (your mongodb+srv:// connection string).');
    process.exit(1);
  }
  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  const database = mongoClient.db('slate');
  usersCol = database.collection('users');
  serversCol = database.collection('servers');
  messagesCol = database.collection('messages');
  await messagesCol.createIndex({ type: 1, room: 1, createdAt: -1 });

  for (const u of await usersCol.find({}).toArray()) db.users[u.id] = stripDoc(u);
  for (const s of await serversCol.find({}).toArray()) db.servers[s.id] = stripDoc(s);
  console.log(`[slate] mongo connected — ${Object.keys(db.users).length} users / ${Object.keys(db.servers).length} servers`);
}

const upsertUser = (u) => usersCol.replaceOne({ id: u.id }, clone(u), { upsert: true });
const upsertServer = (s) => serversCol.replaceOne({ id: s.id }, clone(s), { upsert: true });
const insertMessage = (m) => messagesCol.insertOne({ ...clone(m), _id: m.id });
const replaceMessage = (m) => messagesCol.replaceOne({ _id: m.id }, clone(m) });
async function findMessageById(id) {
  const d = await messagesCol.findOne({ _id: id });
  return d ? stripDoc(d) : null;
}

/* ---- shared helpers ---- */
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
  return { id: u.id, username: u.username, displayName: u.displayName, bio: u.bio || '', avatar: u.avatar || null, createdAt: u.createdAt };
}
const selfUser = (u) => ({ ...publicUser(u), email: u.email });
function dmRoomKey(a, b) { const [x, y] = [a, b].sort(); return `dm:${x}:${y}`; }
function findServerByChannel(channelId) {
  for (const s of Object.values(db.servers)) if (s.channels.some(c => c.id === channelId)) return s;
  return null;
}
function inviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

/* ---- message helpers ---- */
async function messagePayload(m, replyMap) {
  const out = { ...m, author: publicUser(getUser(m.authorId)) };
  if (m.replyTo) {
    const r = replyMap ? replyMap[m.replyTo] : await findMessageById(m.replyTo);
    out.replyPreview = r ? {
      id: r.id, authorId: r.authorId, deleted: !!r.deleted,
      text: r.deleted ? null : String(r.text || '').slice(0, 120),
      image: !r.deleted && !!r.image
    } : null;
  }
  return out;
}
function parseMentions(text, contextUserIds) {
  const found = new Set();
  const re = /@([a-zA-Z0-9_]{3,20})/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const u = findUserByUsername(m[1]);
    if (u && contextUserIds.includes(u.id)) found.add(u.id);
  }
  return [...found];
}
function validImage(img) {
  if (img == null) return true;
  if (typeof img !== 'string') return false;
  if (img.startsWith('data:image/') && img.length < 600000) return true;
  if (/^https:\/\/\S+$/.test(img) && img.length < 600) return true; // Tenor GIF urls
  return false;
}
function notifyMentions(message, place) {
  for (const mid of message.mentions || []) {
    if (mid === message.authorId) continue;
    io.to('user:' + mid).emit('mention', {
      from: publicUser(getUser(message.authorId)),
      place,
      text: String(message.text || '').slice(0, 80),
      info: place.type === 'channel'
        ? { type: 'channel', channelId: place.channelId }
        : { type: 'dm', userIds: place.userIds }
    });
  }
}

/* ---- official server (nobody can edit it — ownerId is "system") ---- */
async function ensureOfficialServer() {
  let s = Object.values(db.servers).find(x => x.official);
  if (!s) {
    s = {
      id: uid(), name: 'Slate Official', ownerId: 'system', official: true,
      memberIds: [], inviteCode: 'SLATE1',
      channels: [{ id: uid(), name: 'general', createdAt: now() }, { id: uid(), name: 'introductions', createdAt: now() }]
    };
    db.servers[s.id] = s;
    await upsertServer(s);
  }
  return s;
}
async function ensureOfficialMembership(user) {
  const s = await ensureOfficialServer();
  if (!s.memberIds.includes(user.id)) {
    s.memberIds.push(user.id);
    await upsertServer(s);
  }
}

/* ---------- 3 · presence ---------- */
const socketsByUser = new Map();
const presence = {
  add(socket) {
    if (!socketsByUser.has(socket.userId)) socketsByUser.set(socket.userId, new Set());
    socketsByUser.get(socket.userId).add(socket.id);
    return socketsByUser.get(socket.userId).size === 1;
  },
  remove(socket) {
    const set = socketsByUser.get(socket.userId);
    if (!set) return false;
    set.delete(socket.id);
    if (set.size === 0) { socketsByUser.delete(socket.userId); return true; }
    return false;
  },
  isOnline(userId) { return socketsByUser.has(userId); }
};

/* ---------- 4 · express + cors ---------- */
const app = express();
const httpServer = http.createServer(app);

const originFn = (origin, cb) => {
  if (!origin) return cb(null, true);
  if (clientOrigins.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
  return cb(new Error('Blocked by CORS'));
};
app.use(cors({ origin: originFn, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '2mb' }));

if (isDev) {
  app.use((req, res, next) => { res.on('finish', () => console.log(req.method, req.originalUrl, res.statusCode)); next(); });
}

// Express 4 doesn't catch errors thrown inside async routes — this wrapper does
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- 5 · socket.io ---------- */
const io = new Server(httpServer, {
  cors: { origin: originFn, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 2e6
});

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

const lastMessageAt = new Map();

io.on('connection', (socket) => {
  const me = () => getUser(socket.userId);

  socket.join('user:' + socket.userId);
  for (const s of Object.values(db.servers)) {
    if (s.memberIds.includes(socket.userId)) socket.join('server:' + s.id);
  }
  if (presence.add(socket)) io.emit('presence:update', { userId: socket.userId, online: true });

  socket.on('message:send', async (payload, ack) => {
    const user = me(); if (!user) return;
    const p = payload || {};
    const text = typeof p.text === 'string' ? p.text.trim().slice(0, 2000) : '';
    const image = validImage(p.image) ? p.image : null;
    if (!text && !image) return;
    if (Date.now() - (lastMessageAt.get(user.id) || 0) < 250) return;
    lastMessageAt.set(user.id, Date.now());

    try {
      if (p.roomType === 'channel') {
        const server = findServerByChannel(p.target);
        if (!server || !server.memberIds.includes(user.id)) return;
        let replyDoc = null;
        if (p.replyTo) {
          const r = await findMessageById(p.replyTo);
          if (r && r.type === 'channel' && r.room === p.target && !r.deleted) replyDoc = r;
        }
        const channelName = (server.channels.find(c => c.id === p.target) || {}).name || 'channel';
        const message = {
          id: uid(), type: 'channel', room: p.target, authorId: user.id,
          text, image, replyTo: replyDoc ? replyDoc.id : null, deleted: false,
          mentions: parseMentions(text, server.memberIds), createdAt: now()
        };
        await insertMessage(message);
        io.to('server:' + server.id).emit('message:new', {
          ...(await messagePayload(message, replyDoc ? { [replyDoc.id]: replyDoc } : {})),
          info: { type: 'channel', serverId: server.id, channelId: p.target }
        });
        notifyMentions(message, { type: 'channel', channelId: p.target, channelName });
        if (typeof ack === 'function') ack({ ok: true, id: message.id });

      } else if (p.roomType === 'dm') {
        const peer = getUser(p.target);
        if (!peer || !user.friends.includes(peer.id)) return;
        let replyDoc = null;
        if (p.replyTo) {
          const r = await findMessageById(p.replyTo);
          if (r && r.type === 'dm' && r.room === dmRoomKey(user.id, peer.id) && !r.deleted) replyDoc = r;
        }
        const message = {
          id: uid(), type: 'dm', room: dmRoomKey(user.id, peer.id), authorId: user.id,
          text, image, replyTo: replyDoc ? replyDoc.id : null, deleted: false,
          mentions: parseMentions(text, [user.id, peer.id]), createdAt: now()
        };
        await insertMessage(message);
        io.to('user:' + user.id).to('user:' + peer.id).emit('message:new', {
          ...(await messagePayload(message, replyDoc ? { [replyDoc.id]: replyDoc } : {})),
          info: { type: 'dm', userIds: [user.id, peer.id] }
        });
        notifyMentions(message, { type: 'dm', userIds: [user.id, peer.id] });
        if (typeof ack === 'function') ack({ ok: true, id: message.id });
      }
    } catch (e) {
      console.warn('[slate] message send failed:', e.message);
      if (typeof ack === 'function') ack({ ok: false });
    }
  });

  socket.on('message:delete', async (payload) => {
    const user = me(); if (!user) return;
    try {
      const m = await findMessageById(payload && payload.id);
      if (!m || m.deleted) return;

      if (m.type === 'channel') {
        const server = findServerByChannel(m.room);
        if (!server || !server.memberIds.includes(user.id)) return;
        if (m.authorId !== user.id && server.ownerId !== user.id) return;
        m.deleted = true; m.text = ''; m.image = null; m.replyTo = null; m.mentions = [];
        await replaceMessage(m);
        io.to('server:' + server.id).emit('message:delete', { id: m.id, type: 'channel', room: m.room });
      } else if (m.type === 'dm') {
        const [a, b] = m.room.slice(3).split(':');
        if (user.id !== a && user.id !== b) return;
        m.deleted = true; m.text = ''; m.image = null; m.replyTo = null; m.mentions = [];
        await replaceMessage(m);
        io.to('user:' + a).to('user:' + b).emit('message:delete', { id: m.id, type: 'dm', room: m.room });
      }
    } catch (e) { console.warn('[slate] message delete failed:', e.message); }
  });

  socket.on('typing', (payload) => {
    const user = me(); if (!user) return;
    const p = payload || {};
    const isTyping = !!p.isTyping;
    if (p.roomType === 'channel') {
      const server = findServerByChannel(p.target);
      if (!server || !server.memberIds.includes(user.id)) return;
      socket.to('server:' + server.id).emit('typing', {
        roomType: 'channel', room: p.target, userId: user.id, displayName: user.displayName, isTyping
      });
    } else if (p.roomType === 'dm') {
      const peer = getUser(p.target);
      if (!peer || !user.friends.includes(peer.id)) return;
      socket.to('user:' + peer.id).emit('typing', {
        roomType: 'dm', room: dmRoomKey(user.id, peer.id), userId: user.id, displayName: user.displayName, isTyping
      });
    }
  });

  socket.on('disconnect', () => {
    if (presence.remove(socket)) io.emit('presence:update', { userId: socket.userId, online: false });
  });
});

function syncRooms(userId, room, join) {
  for (const sock of io.of('/').sockets.values()) {
    if (sock.userId === userId) (join ? sock.join(room) : sock.leave(room));
  }
}

/* ---------- 6 · REST API ---------- */
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
  } catch { return res.status(401).json({ error: 'Session expired — sign in again' }); }
}
const issueToken = (user) => jwt.sign({ uid: user.id }, SECRET, { expiresIn: '7d' });
const bad = (res, code, msg) => res.status(code).json({ error: msg });
const withOnline = (u) => ({ ...publicUser(u), online: presence.isOnline(u.id) });

function friendState(me, other) {
  if (me.friends.includes(other.id)) return 'friend';
  if (me.incoming.includes(other.id)) return 'incoming';
  if (me.outgoing.includes(other.id)) return 'outgoing';
  return 'none';
}
function serializeServer(s) {
  return {
    id: s.id, name: s.name, inviteCode: s.inviteCode, ownerId: s.ownerId,
    official: !!s.official, icon: s.icon || null,
    channels: s.channels.map(c => ({ id: c.id, name: c.name })),
    members: s.memberIds.map(id => getUser(id)).filter(Boolean).map(withOnline)
  };
}
async function history(req, type, room) {
  const before = Number(req.query.before) || Infinity;
  const q = { type, room };
  if (Number.isFinite(before)) q.createdAt = { $lt: before };
  const docs = await messagesCol.find(q).sort({ createdAt: -1 }).limit(50).toArray();
  const list = docs.map(stripDoc).reverse();

  // batch-fetch reply previews in one query
  const replyIds = [...new Set(list.map(m => m.replyTo).filter(Boolean))];
  const replyMap = {};
  if (replyIds.length) {
    for (const r of await messagesCol.find({ _id: { $in: replyIds } }).toArray()) replyMap[r._id] = stripDoc(r);
  }
  const users = {};
  const ensureUser = (id) => { if (!users[id]) users[id] = publicUser(getUser(id)); };
  for (const m of list) {
    ensureUser(m.authorId);
    for (const mid of (m.mentions || [])) ensureUser(mid);
  }
  const messages = [];
  for (const m of list) messages.push(await messagePayload(m, replyMap));
  return { messages, users };
}

/* ---- auth ---- */
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { email, username, displayName, password } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) return bad(res, 400, 'Enter a valid email address');
  if (!username || !USERNAME_RE.test(username)) return bad(res, 400, 'Username must be 3–20 characters (letters, numbers, underscore)');
  if (!password || typeof password !== 'string' || password.length < 8) return bad(res, 400, 'Password must be at least 8 characters');
  if (findUserByEmail(email)) return bad(res, 409, 'That email is already registered');
  if (findUserByUsername(username)) return bad(res, 409, 'That username is already taken');

  const user = {
    id: uid(), email: email.toLowerCase(), username,
    displayName: (displayName || '').trim().slice(0, 32) || username,
    passwordHash: await bcrypt.hash(password, 10),
    bio: '', avatar: null, friends: [], incoming: [], outgoing: [],
    createdAt: now()
  };
  db.users[user.id] = user;
  await upsertUser(user);
  await ensureOfficialMembership(user);
  res.json({ token: issueToken(user), user: selfUser(user) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return bad(res, 400, 'Email/username and password are required');
  const user = findUserByEmail(identifier) || findUserByUsername(identifier);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return bad(res, 401, 'Wrong credentials — check your email/username and password');
  }
  await ensureOfficialMembership(user);
  res.json({ token: issueToken(user), user: selfUser(user) });
}));

app.get('/api/auth/me', auth, (req, res) => res.json({ user: selfUser(req.user) }));

/* ---- profile ---- */
app.patch('/api/me', auth, wrap(async (req, res) => {
  const u = req.user;
  const { displayName, username, bio, avatar } = req.body || {};

  if (username !== undefined) {
    const un = String(username).trim();
    if (!USERNAME_RE.test(un)) return bad(res, 400, 'Username must be 3–20 characters (letters, numbers, underscore)');
    const existing = findUserByUsername(un);
    if (existing && existing.id !== u.id) return bad(res, 409, 'That username is already taken');
    u.username = un;
  }
  if (displayName !== undefined) {
    const name = String(displayName).trim().slice(0, 32);
    if (!name) return bad(res, 400, 'Display name cannot be empty');
    u.displayName = name;
  }
  if (bio !== undefined) u.bio = String(bio).trim().slice(0, 280);
  if (avatar !== undefined) {
    if (avatar === null) u.avatar = null;
    else if (typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length < 400000) u.avatar = avatar;
    else return bad(res, 400, 'Avatar must be an image under ~300KB');
  }
  await upsertUser(u);

  const pub = publicUser(u);
  for (const fid of u.friends) io.to('user:' + fid).emit('user:update', { user: pub });
  io.to('user:' + u.id).emit('user:update', { user: pub });
  res.json({ user: selfUser(u) });
}));

/* ---- features + GIF search ---- */
app.get('/api/features', auth, (req, res) => res.json({ gifs: !!process.env.TENOR_API_KEY }));

app.get('/api/gifs/search', auth, wrap(async (req, res) => {
  if (!process.env.TENOR_API_KEY) return res.json({ configured: false, gifs: [] });
  const q = String(req.query.q || '').trim();
  const url = new URL('https://tenor.googleapis.com/v2/' + (q ? 'search' : 'trending'));
  url.searchParams.set('key', process.env.TENOR_API_KEY);
  url.searchParams.set('client_key', 'slate');
  url.searchParams.set('limit', '24');
  if (q) url.searchParams.set('q', q);
  try {
    const r = await fetch(url);
    const d = await r.json();
    const gifs = (d.results || []).map(g => ({
      id: g.id,
      url: ((g.media_formats || {}).mediumgif || (g.media_formats || {}).gif || {}).url || '',
      preview: ((g.media_formats || {}).tinygif || {}).url || '',
      desc: g.content_description || ''
    })).filter(g => g.url);
    res.json({ configured: true, gifs });
  } catch { res.json({ configured: true, gifs: [] }); }
}));

/* ---- user search ---- */
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

/* ---- friends ---- */
app.get('/api/friends', auth, (req, res) => {
  const me = req.user;
  res.json({
    friends: me.friends.map(id => withOnline(getUser(id))).filter(Boolean),
    incoming: me.incoming.map(id => withOnline(getUser(id))).filter(Boolean),
    outgoing: me.outgoing.map(id => withOnline(getUser(id))).filter(Boolean)
  });
});

app.post('/api/friends/request', auth, wrap(async (req, res) => {
  const target = getUser(req.body && req.body.userId);
  const me = req.user;
  if (!target || target.id === me.id) return bad(res, 400, 'Pick someone else to add');
  if (me.friends.includes(target.id)) return bad(res, 409, 'You are already friends');
  if (me.outgoing.includes(target.id)) return bad(res, 409, 'Request already sent');
  if (me.incoming.includes(target.id)) return bad(res, 409, `${target.username} already sent you a request — accept it on the Friends page`);
  me.outgoing.push(target.id);
  target.incoming.push(me.id);
  await upsertUser(me);
  await upsertUser(target);
  io.to('user:' + target.id).emit('friend:request', { user: { ...publicUser(me), online: true } });
  io.to('user:' + target.id).emit('friends:sync');
  res.json({ ok: true });
}));

app.post('/api/friends/accept', auth, wrap(async (req, res) => {
  const other = getUser(req.body && req.body.userId);
  const me = req.user;
  if (!other || !me.incoming.includes(other.id)) return bad(res, 400, 'No pending request from that user');
  me.incoming = me.incoming.filter(id => id !== other.id);
  other.outgoing = other.outgoing.filter(id => id !== me.id);
  if (!me.friends.includes(other.id)) me.friends.push(other.id);
  if (!other.friends.includes(me.id)) other.friends.push(me.id);
  await upsertUser(me);
  await upsertUser(other);
  io.to('user:' + other.id).emit('friend:accepted', { user: publicUser(me) });
  io.to('user:' + other.id).emit('friends:sync');
  res.json({ ok: true });
}));

app.post('/api/friends/decline', auth, wrap(async (req, res) => {
  const other = getUser(req.body && req.body.userId);
  const me = req.user;
  if (!other) return bad(res, 400, 'Unknown user');
  me.incoming = me.incoming.filter(id => id !== other.id);
  other.outgoing = other.outgoing.filter(id => id !== me.id);
  await upsertUser(me);
  await upsertUser(other);
  io.to('user:' + other.id).emit('friends:sync');
  res.json({ ok: true });
}));

app.post('/api/friends/cancel', auth, wrap(async (req, res) => {
  const other = getUser(req.body && req.body.userId);
  const me = req.user;
  if (!other || !me.outgoing.includes(other.id)) return bad(res, 400, 'No outgoing request to that user');
  me.outgoing = me.outgoing.filter(id => id !== other.id);
  other.incoming = other.incoming.filter(id => id !== me.id);
  await upsertUser(me);
  await upsertUser(other);
  io.to('user:' + other.id).emit('friends:sync');
  res.json({ ok: true });
}));

app.post('/api/friends/remove', auth, wrap(async (req, res) => {
  const other = getUser(req.body && req.body.userId);
  const me = req.user;
  if (!other || !me.friends.includes(other.id)) return bad(res, 400, 'Not friends with that user');
  me.friends = me.friends.filter(id => id !== other.id);
  other.friends = other.friends.filter(id => id !== me.id);
  await upsertUser(me);
  await upsertUser(other);
  io.to('user:' + other.id).emit('friends:sync');
  res.json({ ok: true });
}));

/* ---- servers & channels ---- */
app.get('/api/servers', auth, (req, res) => {
  const mine = Object.values(db.servers).filter(s => s.memberIds.includes(req.user.id));
  res.json({ servers: mine.map(serializeServer) });
});

app.post('/api/servers', auth, wrap(async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 40);
  if (name.length < 2) return bad(res, 400, 'Server name needs at least 2 characters');
  const me = req.user;
  const s = {
    id: uid(), name, ownerId: me.id, official: false, icon: null,
    memberIds: [me.id], inviteCode: inviteCode(),
    channels: [{ id: uid(), name: 'general', createdAt: now() }]
  };
  db.servers[s.id] = s;
  await upsertServer(s);
  syncRooms(me.id, 'server:' + s.id, true);
  res.json({ server: serializeServer(s) });
}));

app.patch('/api/servers/:id', auth, wrap(async (req, res) => {
  const s = db.servers[req.params.id];
  if (!s) return bad(res, 404, 'Server not found');
  if (s.official) return bad(res, 403, 'The community server can’t be edited by anyone');
  if (s.ownerId !== req.user.id) return bad(res, 403, 'Only the server owner can change these settings');
  const { name, icon } = req.body || {};
  if (name !== undefined) {
    const n = String(name).trim().slice(0, 40);
    if (n.length < 2) return bad(res, 400, 'Server name needs at least 2 characters');
    s.name = n;
  }
  if (icon !== undefined) {
    if (icon === null) s.icon = null;
    else if (typeof icon === 'string' && icon.startsWith('data:image/') && icon.length < 400000) s.icon = icon;
    else return bad(res, 400, 'Server icon must be an image under ~300KB');
  }
  await upsertServer(s);
  io.to('server:' + s.id).emit('server:sync', { serverId: s.id });
  res.json({ server: serializeServer(s) });
}));

app.post('/api/servers/join', auth, wrap(async (req, res) => {
  const code = String((req.body && req.body.inviteCode) || '').trim().toUpperCase();
  if (!code) return bad(res, 400, 'Enter an invite code');
  const s = Object.values(db.servers).find(x => x.inviteCode === code);
  if (!s) return bad(res, 404, 'No server matches that invite code');
  const me = req.user;
  if (s.memberIds.includes(me.id)) return bad(res, 409, 'You are already in that server');
  s.memberIds.push(me.id);
  await upsertServer(s);
  syncRooms(me.id, 'server:' + s.id, true);
  io.to('server:' + s.id).emit('server:sync', { serverId: s.id });
  res.json({ server: serializeServer(s) });
}));

app.post('/api/servers/:id/channels', auth, wrap(async (req, res) => {
  const s = db.servers[req.params.id];
  if (!s) return bad(res, 404, 'Server not found');
  if (s.official) return bad(res, 403, 'The community server can’t be edited by anyone');
  if (s.ownerId !== req.user.id) return bad(res, 403, 'Only the server owner can create channels');
  const name = String((req.body && req.body.name) || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
  if (!/^[a-z0-9_-]{1,24}$/.test(name)) return bad(res, 400, 'Channel name: 1–24 chars — letters, numbers, - and _');
  if (s.channels.some(c => c.name === name)) return bad(res, 409, 'A channel with that name already exists');
  const channel = { id: uid(), name, createdAt: now() };
  s.channels.push(channel);
  await upsertServer(s);
  io.to('server:' + s.id).emit('server:sync', { serverId: s.id });
  res.json({ channel });
}));

app.delete('/api/servers/:id/leave', auth, wrap(async (req, res) => {
  const s = db.servers[req.params.id];
  if (!s) return bad(res, 404, 'Server not found');
  const me = req.user;
  if (!s.memberIds.includes(me.id)) return bad(res, 400, 'You are not in that server');
  s.memberIds = s.memberIds.filter(id => id !== me.id);
  if (s.memberIds.length === 0) {
    if (!s.official) {
      delete db.servers[s.id];
      await serversCol.deleteOne({ id: s.id });
    }
  } else {
    if (s.ownerId === me.id) s.ownerId = s.memberIds[0];
    await upsertServer(s);
    io.to('server:' + s.id).emit('server:sync', { serverId: s.id });
  }
  syncRooms(me.id, 'server:' + s.id, false);
  res.json({ ok: true });
}));

/* ---- message history ---- */
app.get('/api/messages/channel/:channelId', auth, wrap(async (req, res) => {
  const server = findServerByChannel(req.params.channelId);
  if (!server) return bad(res, 404, 'Channel not found');
  if (!server.memberIds.includes(req.user.id)) return bad(res, 403, 'No access to this channel');
  res.json(await history(req, 'channel', req.params.channelId));
}));

app.get('/api/messages/dm/:userId', auth, wrap(async (req, res) => {
  const other = getUser(req.params.userId);
  if (!other) return bad(res, 404, 'User not found');
  if (!req.user.friends.includes(other.id)) return bad(res, 403, 'You can only message friends');
  res.json(await history(req, 'dm', dmRoomKey(req.user.id, other.id)));
}));

/* ---------- 7 · health / errors / boot ---------- */
app.get('/', (req, res) => res.json({ ok: true, name: 'slate-server', uptime: Math.floor(process.uptime()) }));
app.get('/api/health', wrap(async (req, res) => res.json({
  ok: true, uptime: Math.floor(process.uptime()),
  users: Object.keys(db.users).length,
  messages: await messagesCol.countDocuments()
})));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ error: 'Invalid or too-large JSON body' });
  }
  if (err && err.message === 'Blocked by CORS') return res.status(403).json({ error: 'Origin not allowed' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

process.on('unhandledRejection', (e) => console.warn('[slate] unhandled rejection:', e && e.message));
async function shutdown() {
  try { if (mongoClient) await mongoClient.close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown); // Render sends this before stopping

initMongo()
  .then(async () => {
    await ensureOfficialServer();
    httpServer.listen(PORT, () => console.log(`slate-server listening on :${PORT} (mongo-backed)`));
  })
  .catch((e) => {
    console.error('[slate] failed to start:', e.message);
    process.exit(1);
  });
