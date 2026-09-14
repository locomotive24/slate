'use strict';
/* =====================================================================
   slate — script.js  (all frontend JS in one file)

   ★ THE ONLY LINE YOU EDIT FOR PRODUCTION IS RIGHT BELOW ★
   Replace the placeholder with your Render URL, e.g.
       https://slate-chat.onrender.com
   Local development needs no edits — localhost is auto-detected.
   Runtime override without editing (handy for quick tests):
       your-site?api=https%3A%2F%2Fyour-service.onrender.com
===================================================================== */
const QUERY_API  = new URLSearchParams(location.search).get('api');
const STORED_API = localStorage.getItem('slate:api');
const IS_LOCAL   = ['localhost', '127.0.0.1'].includes(location.hostname);

const API_BASE = (
  QUERY_API || STORED_API ||
  (IS_LOCAL ? 'http://localhost:4000' : 'https://slate-e6hp.onrender.com/')
).replace(/\/+$/, '');

const LS = { token: 'slate:token', theme: 'slate:theme', accent: 'slate:accent', members: 'slate:members' };

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

/* =====================================================================
   STATE
===================================================================== */
const HISTORY_PAGE = 50;
const ACCENTS = [
  { name: 'Ember',  hex: '#ff5c38' },
  { name: 'Amber',  hex: '#ffb224' },
  { name: 'Lime',   hex: '#b6e04a' },
  { name: 'Mint',   hex: '#3ecf8e' },
  { name: 'Sky',    hex: '#41c1e5' },
  { name: 'Orchid', hex: '#c66bff' }
];

const state = {
  me: null,
  servers: [],
  friends: { friends: [], incoming: [], outgoing: [] },
  online: new Set(),
  sidebarMode: 'friends',           // 'friends' | serverId
  route: null,                      // {type:'channel',serverId,channelId} | {type:'dm',userId}
  messages: [],
  authors: {},
  unread: {},                       // 'c:<channelId>' | 'dm:<peerId>' -> count
  typers: new Map(),                // userId -> {name, until}
  socket: null,
  connectedOnce: false
};

/* ---------- element refs ---------- */
const authView = $('#authView'), appView = $('#appView');
const railServers = $('#railServers'), railAvatar = $('#railAvatar');
const railAdd = $('#railAdd'), railFriends = $('#railFriends');
const railSettings = $('#railSettings'), railTheme = $('#railTheme');
const sidebar = $('#sidebar'), sidebarBody = $('#sidebarBody'), scrimSidebar = $('#scrimSidebar');
const chatTitle = $('#chatTitle'), chatMeta = $('#chatMeta'), membersToggle = $('#membersToggle');
const menuBtn = $('#menuBtn');
const chatScroll = $('#chatScroll'), messagesEl = $('#messages');
const chatEmpty = $('#chatEmpty'), emptyHint = $('#emptyHint');
const emptyCtaFriends = $('#emptyCtaFriends'), emptyCtaServer = $('#emptyCtaServer');
const typingBar = $('#typingBar');
const composerBox = $('#composerBox'), composerInput = $('#composerInput'), sendBtn = $('#sendBtn');
const jumpBtn = $('#jumpBtn');
const membersPanel = $('#membersPanel'), membersHead = $('#membersHead');
const membersBody = $('#membersBody'), scrimMembers = $('#scrimMembers');
const settingsPanel = $('#settingsPanel'), scrimSettings = $('#scrimSettings');
const settingsClose = $('#settingsClose'), settingsAvatar = $('#settingsAvatar');
const avatarFile = $('#avatarFile'), avatarRemove = $('#avatarRemove');
const displayNameInput = $('#displayNameInput'), bioInput = $('#bioInput'), bioCount = $('#bioCount');
const profileSave = $('#profileSave'), accountFacts = $('#accountFacts');
const logoutBtn = $('#logoutBtn'), settingsApi = $('#settingsApi');
const connBanner = $('#connBanner');

/* =====================================================================
   API helper
===================================================================== */
async function api(method, path, body) {
  const headers = {};
  const token = localStorage.getItem(LS.token);
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('Can’t reach the server — is it running?');
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    if (res.status === 401 && state.me) doLogout('Your session expired — sign in again');
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

/* =====================================================================
   UI helpers
===================================================================== */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon ' + cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

function iconBtn(name, extra = '', title = '') {
  const b = el('button', 'icon-btn ' + extra);
  if (title) b.title = title;
  b.append(icon(name));
  return b;
}

function hashHue(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

function avatarEl(user, opts = {}) {
  const { size = 34, showPresence = false, online = false } = opts;
  const wrap = el('span', 'avatar');
  wrap.style.setProperty('--av', size + 'px');
  wrap.style.setProperty('--av-h', `hsl(${hashHue(user ? user.id : 'x')} 26% 42%)`);
  if (user && user.avatar) {
    const img = el('img');
    img.src = user.avatar;
    img.alt = (user.displayName || user.username || '');
    wrap.append(img);
  } else {
    wrap.append(el('span', 'avatar-fallback',
      ((user && (user.displayName || user.username)) || '?').trim().charAt(0).toUpperCase()));
  }
  if (showPresence) wrap.append(el('span', 'presence-dot' + (online ? ' on' : '')));
  return wrap;
}

/* ---------- toasts (no alert() anywhere) ---------- */
function toast(message, type = 'info') {
  const root = $('#toastRoot');
  const t = el('div', 'toast toast-' + type);
  t.append(icon(type === 'error' ? 'x' : type === 'success' ? 'check' : 'message'));
  t.append(el('span', '', message));
  root.append(t);
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 260); };
  t.addEventListener('click', kill);
  setTimeout(kill, 3600);
}

/* ---------- modal system ---------- */
function openModal({ title, body, actions = [] }) {
  const root = $('#modalRoot');
  const back = el('div', 'modal-back');
  const box  = el('div', 'modal');
  const head = el('header', 'modal-head');
  head.append(el('h3', 'modal-title', title));
  const closeBtn = iconBtn('x', '', 'Close');
  head.append(closeBtn);

  const content = el('div', 'modal-body');
  if (typeof body === 'string') content.textContent = body; else content.append(body);

  const foot = el('footer', 'modal-foot');
  for (const a of actions) {
    const btn = el('button', 'btn ' + (a.cls || 'btn-ghost'), a.label);
    btn.addEventListener('click', async () => {
      if (a.onClick) {
        try { const keep = await a.onClick(); if (keep === false) return; }
        catch (e) { toast(e.message, 'error'); return; }
      }
      close();
    });
    foot.append(btn);
  }
  box.append(head, content, foot);
  back.append(box);
  root.append(back);
  requestAnimationFrame(() => back.classList.add('in'));

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    back.classList.remove('in');
    setTimeout(() => back.remove(), 220);
    document.removeEventListener('keydown', onKey);
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });

  const first = box.querySelector('input, textarea');
  if (first) setTimeout(() => first.focus(), 60);
  return { close, box };
}

/* ---------- time formatting ---------- */
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function fmtDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

/* ---------- safe text rendering with URL linkification ---------- */
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
function renderText(text) {
  const frag = document.createDocumentFragment();
  let last = 0, m;
  while ((m = URL_RE.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const a = el('a', 'msg-link', m[0]);
    a.href = m[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    frag.append(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/* =====================================================================
   THEME & ACCENT
===================================================================== */
function briefThemeAnim() {
  document.body.classList.add('theme-anim');
  setTimeout(() => document.body.classList.remove('theme-anim'), 420);
}

function pickOnAccent(hex) {
  const m = String(hex).match(/^#?([0-9a-f]{6})$/i);
  if (!m) return '#141414';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#151517' : '#ffffff';
}

function setAccent(hex) {
  briefThemeAnim();
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--on-accent', pickOnAccent(hex));
  localStorage.setItem(LS.accent, hex);
  buildSwatches();
}

function setTheme(mode, persist = true) {
  briefThemeAnim();
  document.documentElement.dataset.theme = mode;
  if (persist) localStorage.setItem(LS.theme, mode);
  $$('.seg-btn', $('#themeSeg')).forEach(b => b.classList.toggle('is-active', b.dataset.themeSet === mode));
  railTheme.replaceChildren(icon(mode === 'dark' ? 'sun' : 'moon'));
  railTheme.title = mode === 'dark' ? 'Switch to light' : 'Switch to dark';
}

function buildSwatches() {
  const cur = localStorage.getItem(LS.accent) || '#ff5c38';
  const wrap = $('#swatches');
  wrap.replaceChildren();
  for (const a of ACCENTS) {
    const b = el('button', 'swatch' + (a.hex.toLowerCase() === cur.toLowerCase() ? ' is-active' : ''));
    b.type = 'button'; b.title = a.name; b.style.background = a.hex;
    b.addEventListener('click', () => setAccent(a.hex));
    wrap.append(b);
  }
  const custom = el('label', 'swatch swatch-custom');
  custom.title = 'Custom color';
  custom.append(icon('plus'));
  const inp = el('input'); inp.type = 'color'; inp.value = cur;
  inp.addEventListener('input', () => setAccent(inp.value));
  custom.append(inp);
  wrap.append(custom);
}

/* =====================================================================
   MISC HELPERS
===================================================================== */
const dmRoomKey = (a, b) => { const [x, y] = [a, b].sort(); return `dm:${x}:${y}`; };
const getPeer = (id) => state.friends.friends.find(f => f.id === id) || state.authors[id] || null;
const authorName = (id) => (state.authors[id] && state.authors[id].displayName) || 'unknown';
const isPinned = () => chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 140;

function syncOnlineFrom(list) {
  for (const u of list) {
    if (u.online) state.online.add(u.id); else state.online.delete(u.id);
  }
}

function updateTitle() {
  const total = Object.values(state.unread).reduce((a, b) => a + b, 0);
  document.title = (total ? `(${total}) ` : '') + 'slate · realtime chat';
}

function renderAll() {
  renderRail(); renderSidebar(); renderChatChrome(); renderMembers();
}

function closeDrawers() {
  sidebar.classList.remove('open');
  scrimSidebar.classList.remove('show');
  membersPanel.classList.remove('open');
  scrimMembers.classList.remove('show');
}
function openSidebarDrawer() {
  sidebar.classList.add('open');
  scrimSidebar.classList.add('show');
}

/* =====================================================================
   AUTH
===================================================================== */
function wireAuth() {
  $$('.auth-tab').forEach(t => t.addEventListener('click', () => {
    $$('.auth-tab').forEach(x => x.classList.toggle('is-active', x === t));
    $('#loginForm').hidden  = t.dataset.tab !== 'login';
    $('#signupForm').hidden = t.dataset.tab !== 'signup';
    const form = $(t.dataset.tab === 'login' ? '#loginForm' : '#signupForm');
    form.classList.remove('anim'); void form.offsetWidth; form.classList.add('anim');
  }));

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    withAuthBusy($('#loginBtn'), $('#loginError'), async () => {
      const d = await api('POST', '/api/auth/login', {
        identifier: String(fd.get('identifier')).trim(),
        password: String(fd.get('password'))
      });
      localStorage.setItem(LS.token, d.token);
      enterApp(d.user, d.token);
    });
  });

  $('#signupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    withAuthBusy($('#signupBtn'), $('#signupError'), async () => {
      const d = await api('POST', '/api/auth/signup', {
        email: String(fd.get('email')).trim(),
        username: String(fd.get('username')).trim(),
        displayName: String(fd.get('displayName') || '').trim(),
        password: String(fd.get('password'))
      });
      localStorage.setItem(LS.token, d.token);
      enterApp(d.user, d.token);
      toast(`Welcome to slate, ${d.user.displayName}`, 'success');
    });
  });
}

async function withAuthBusy(btn, errEl, fn) {
  errEl.hidden = true;
  btn.disabled = true;
  try { await fn(); }
  catch (e) { errEl.textContent = e.message; errEl.hidden = false; }
  finally { btn.disabled = false; }
}

/* ---------- latency seismograph (the living first impression) ---------- */
const pingHistory = [];
function startPingMeter() {
  const canvas = $('#pingCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const loop = async () => {
    const t0 = performance.now();
    let ms = null, stats = null;
    try {
      const r = await fetch(API_BASE + '/api/health', { cache: 'no-store' });
      stats = await r.json();
      ms = performance.now() - t0;
    } catch { ms = null; }
    pingHistory.push(ms);
    if (pingHistory.length > 60) pingHistory.shift();
    drawPing(ctx);
    const dot = $('#apiDot'), text = $('#apiStatus');
    if (ms == null) {
      dot.classList.remove('on');
      text.textContent = 'server unreachable — is it running?';
    } else {
      dot.classList.add('on');
      text.textContent = `online · ${ms < 1 ? '<1' : Math.round(ms)}ms` +
        (stats ? ` · ${stats.users} users · ${stats.messages} messages` : '');
    }
    setTimeout(loop, 3000);
  };
  loop();
}

function drawPing(ctx) {
  const W = 440, H = 56;
  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const lineCol = css.getPropertyValue('--line').trim();
  const accent = css.getPropertyValue('--accent').trim();
  ctx.strokeStyle = lineCol; ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const y = H * i / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  if (!pingHistory.length) return;
  const values = pingHistory.filter(v => v != null);
  const max = Math.max(120, ...values);
  ctx.beginPath();
  let started = false;
  pingHistory.forEach((v, i) => {
    if (v == null) { started = false; return; }
    const x = (i / 59) * W;
    const y = H - Math.min(v / max, 1) * (H - 10) - 5;
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.stroke();
  const lastV = pingHistory[pingHistory.length - 1];
  if (lastV != null) {
    const y = H - Math.min(lastV / max, 1) * (H - 10) - 5;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(((pingHistory.length - 1) / 59) * W, y, 3.2, 0, Math.PI * 2); ctx.fill();
  }
}

/* =====================================================================
   APP ENTRY
===================================================================== */
function enterApp(user, token) {
  state.me = user;
  state.authors[user.id] = { ...user };

  authView.classList.add('leaving');
  setTimeout(() => { authView.hidden = true; }, 320);
  appView.hidden = false;
  appView.classList.add('entering');
  if (localStorage.getItem(LS.members) !== 'off') appView.classList.add('members-on');

  connectSocket(token);
  renderAll();

  Promise.all([loadServers(), loadFriends()]).then(() => {
    if (state.servers.length) {
      openChannel(state.servers[0].id, state.servers[0].channels[0].id);
    } else {
      openFriendsHome();
    }
  });
}

function doLogout(msg) {
  try { if (state.socket) state.socket.disconnect(); } catch { /* ignore */ }
  localStorage.removeItem(LS.token);
  if (msg) sessionStorage.setItem('slate:flash', msg);
  location.reload();
}

/* =====================================================================
   DATA LOADERS
===================================================================== */
async function loadServers() {
  try {
    const d = await api('GET', '/api/servers');
    state.servers = d.servers;
    for (const s of state.servers) syncOnlineFrom(s.members);
  } catch (e) { toast(e.message, 'error'); return; }

  // validate the current route still exists
  if (state.route && state.route.type === 'channel') {
    const s = state.servers.find(x => x.id === state.route.serverId);
    const ch = s && s.channels.find(c => c.id === state.route.channelId);
    if (!ch) {
      if (s) openChannel(s.id, s.channels[0].id);
      else openFriendsHome();
      return;
    }
  }
  if (state.sidebarMode !== 'friends' && !state.servers.find(s => s.id === state.sidebarMode)) {
    state.sidebarMode = 'friends';
  }
  renderRail(); renderSidebar(); renderMembers();
}

async function loadFriends() {
  try {
    const d = await api('GET', '/api/friends');
    state.friends = d;
    syncOnlineFrom([...d.friends, ...d.incoming, ...d.outgoing]);
  } catch { return; }
  if (state.route && state.route.type === 'dm' && !getPeer(state.route.userId)) {
    state.route = null;
  }
  renderRail(); renderSidebar(); renderMembers(); renderChatChrome();
}

async function resync() {
  await Promise.all([loadServers(), loadFriends()]);
  if (state.route) {
    const r = state.route;
    try {
      const path = r.type === 'channel' ? `/api/messages/channel/${r.channelId}` : `/api/messages/dm/${r.userId}`;
      const d = await api('GET', path);
      if (state.route === r) {
        state.messages = d.messages;
        Object.assign(state.authors, d.users);
        renderHistory();
      }
    } catch { /* route may be gone */ }
  }
}

/* =====================================================================
   SOCKET
===================================================================== */
function connectSocket(token) {
  const socket = io(API_BASE, { auth: { token }, transports: ['websocket', 'polling'] });
  state.socket = socket;

  socket.on('connect', () => {
    connBanner.hidden = true;
    if (state.connectedOnce) resync();
    state.connectedOnce = true;
  });
  socket.on('disconnect', () => { if (state.me) connBanner.hidden = false; });
  socket.on('connect_error', (err) => {
    if (String(err.message) === 'auth') doLogout('Your session expired — sign in again');
  });

  socket.on('message:new', onNewMessage);
  socket.on('typing', onTyping);
  socket.on('presence:update', onPresence);
  socket.on('friend:request', (d) => {
    toast(`${d.user.displayName} wants to be your friend`);
    loadFriends();
  });
  socket.on('friend:accepted', (d) => {
    toast(`${d.user.displayName} accepted your request`, 'success');
    loadFriends();
  });
  socket.on('friends:sync', loadFriends);
  socket.on('user:update', onUserUpdate);
  socket.on('server:sync', loadServers);
}

function onUserUpdate({ user }) {
  if (!user) return;
  state.authors[user.id] = user;
  if (state.me && user.id === state.me.id) {
    state.me = { ...state.me, ...user };
    renderRail();
  }
  state.friends.friends = state.friends.friends.map(f => (f.id === user.id ? { ...f, ...user } : f));
  renderSidebar(); renderMembers(); renderChatChrome();
}

function onPresence({ userId, online }) {
  if (online) state.online.add(userId); else state.online.delete(userId);
  for (const f of state.friends.friends) if (f.id === userId) f.online = online;
  for (const s of state.servers) for (const m of s.members) if (m.id === userId) m.online = online;
  renderSidebar(); renderMembers(); renderChatChrome();
}

function onTyping(t) {
  const r = state.route;
  if (!r) return;
  const isCurrent = r.type === 'channel'
    ? (t.roomType === 'channel' && t.room === r.channelId)
    : (t.roomType === 'dm' && t.room === dmRoomKey(state.me.id, r.userId));
  if (!isCurrent) return;
  if (t.isTyping) state.typers.set(t.userId, { name: t.displayName, until: Date.now() + 3200 });
  else state.typers.delete(t.userId);
  renderTyping();
}
setInterval(() => {
  let changed = false;
  state.typers.forEach((v, k) => { if (v.until < Date.now()) { state.typers.delete(k); changed = true; } });
  if (changed) renderTyping();
}, 800);

function renderTyping() {
  const names = [...state.typers.values()].map(v => v.name);
  if (!names.length) { typingBar.hidden = true; return; }
  const dots = el('span', 'tdots');
  dots.append(el('i'), el('i'), el('i'));
  const label = names.length === 1 ? `${names[0]} is typing…`
    : names.length === 2 ? `${names[0]} and ${names[1]} are typing…`
    : 'Several people are typing…';
  typingBar.replaceChildren(dots, el('span', '', label));
  typingBar.hidden = false;
}

/* =====================================================================
   MESSAGES
===================================================================== */
function messageKeyFor(m) {
  if (!m.info) return null;
  if (m.info.type === 'channel') return 'c:' + m.info.channelId;
  const peer = m.info.userIds.find(id => id !== state.me.id);
  return peer ? 'dm:' + peer : null;
}

function isCurrentMessage(m) {
  const r = state.route;
  if (!r) return false;
  if (r.type === 'channel') return m.type === 'channel' && m.room === r.channelId;
  return m.type === 'dm' && m.info && m.info.userIds && m.info.userIds.includes(r.userId);
}

function onNewMessage(m) {
  if (m.author) state.authors[m.authorId] = m.author;
  const key = messageKeyFor(m);

  if (isCurrentMessage(m)) {
    const pinned = isPinned();
    state.messages.push(m);
    state.typers.delete(m.authorId);
    renderMessageAppend(m);
    renderTyping();
    if (pinned) chatScroll.scrollTop = chatScroll.scrollHeight;
    return;
  }
  if (m.authorId === state.me.id || !key) return;
  state.unread[key] = (state.unread[key] || 0) + 1;
  renderRail(); renderSidebar();
  updateTitle();
}

const isCompact = (prev, m) =>
  !!prev && prev.authorId === m.authorId && (m.createdAt - prev.createdAt) < 420000;
const dayChanged = (prev, m) =>
  !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();

function messageNode(m, { compact = false, delay = 0 } = {}) {
  const row = el('div', 'msg msg-in' + (compact ? ' compact' : ''));
  row.style.animationDelay = delay + 'ms';
  const body = el('div', 'msg-body');
  const text = el('div', 'msg-text');
  text.append(renderText(m.text));

  if (compact) {
    row.append(el('span', 'msg-spacer'), body);
    body.append(text);
    const time = el('span', 'msg-time msg-time-compact mono', fmtTime(m.createdAt));
    row.append(time);
  } else {
    row.append(avatarEl(state.authors[m.authorId] || { id: m.authorId, username: '?' }, { size: 34 }));
    const head = el('div', 'msg-head');
    head.append(el('span', 'msg-name', authorName(m.authorId)));
    head.append(el('span', 'msg-time mono', fmtTime(m.createdAt)));
    body.append(head, text);
    row.append(body);
  }
  return row;
}

function renderHistory(opts = {}) {
  const list = state.messages;
  messagesEl.replaceChildren();
  chatEmpty.hidden = list.length > 0;
  if (!list.length) return;

  if (list.length === HISTORY_PAGE) {
    const b = el('button', 'older-btn mono', 'LOAD OLDER');
    b.addEventListener('click', loadOlderMessages);
    messagesEl.append(b);
  }
  let prev = null;
  list.forEach((m, i) => {
    if (dayChanged(prev, m)) {
      messagesEl.append(el('div', 'day-div', fmtDay(m.createdAt)));
      prev = null; // a divider breaks grouping
    }
    messagesEl.append(messageNode(m, {
      compact: isCompact(prev, m),
      delay: opts.instant ? 0 : Math.min(i * 12, 380)
    }));
    prev = m;
  });
  if (!opts.preserveScroll) chatScroll.scrollTop = chatScroll.scrollHeight;
}

function renderMessageAppend(m) {
  const prev = state.messages.length > 1 ? state.messages[state.messages.length - 2] : null;
  if (dayChanged(prev, m)) messagesEl.append(el('div', 'day-div', fmtDay(m.createdAt)));
  messagesEl.append(messageNode(m, { compact: isCompact(prev, m) }));
  chatEmpty.hidden = true;
}

async function loadOlderMessages() {
  const first = state.messages[0];
  if (!first) return;
  const r = state.route;
  if (!r) return;
  const base = r.type === 'channel' ? `/api/messages/channel/${r.channelId}` : `/api/messages/dm/${r.userId}`;
  try {
    const d = await api('GET', base + '?before=' + first.createdAt);
    if (state.route !== r || !d.messages.length) return;
    const prevHeight = chatScroll.scrollHeight;
    const prevTop = chatScroll.scrollTop;
    state.messages = [...d.messages, ...state.messages];
    Object.assign(state.authors, d.users);
    messagesEl.classList.add('no-anim');
    renderHistory({ instant: true, preserveScroll: true });
    requestAnimationFrame(() => messagesEl.classList.remove('no-anim'));
    chatScroll.scrollTop = chatScroll.scrollHeight - prevHeight + prevTop;
  } catch (e) { toast(e.message, 'error'); }
}

/* =====================================================================
   ROUTING
===================================================================== */
function openChannel(serverId, channelId) {
  state.sidebarMode = serverId;
  state.route = { type: 'channel', serverId, channelId };
  state.unread['c:' + channelId] = 0;
  updateTitle();
  openRoom();
}

function openDm(userId) {
  state.sidebarMode = 'friends';
  state.route = { type: 'dm', userId };
  state.unread['dm:' + userId] = 0;
  updateTitle();
  openRoom();
}

function openFriendsHome() {
  state.sidebarMode = 'friends';
  state.route = null;
  state.typers.clear();
  renderTyping();
  renderAll();
}

async function openRoom() {
  const current = state.route;
  state.typers.clear();
  renderTyping();
  renderSidebar(); renderRail(); renderMembers(); renderChatChrome();
  closeDrawers();
  messagesEl.replaceChildren();
  state.messages = [];
  chatEmpty.hidden = false;
  emptyHint.textContent = 'LOADING…';

  try {
    const path = current.type === 'channel'
      ? `/api/messages/channel/${current.channelId}`
      : `/api/messages/dm/${current.userId}`;
    const d = await api('GET', path);
    if (state.route !== current) return;
    state.messages = d.messages;
    Object.assign(state.authors, d.users);
    if (!state.messages.length) {
      emptyHint.textContent = 'THIS IS THE BEGINNING — SAY HELLO';
    }
    renderHistory();
  } catch (e) {
    if (state.route !== current) return;
    emptyHint.textContent = e.message.toUpperCase();
    chatEmpty.hidden = false;
    composerBox.classList.add('disabled');
  }
}

/* =====================================================================
   RENDER: RAIL
===================================================================== */
function serverInitials(name) {
  return String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || 'S';
}

function renderRail() {
  if (!state.me) return;
  railAvatar.replaceChildren(avatarEl(state.me, { size: 44 }));
  railServers.replaceChildren(...state.servers.map(s => {
    const b = el('button', 'rail-server' + (state.sidebarMode === s.id ? ' is-active' : ''));
    b.title = s.name;
    b.append(el('span', '', serverInitials(s.name)));
    const unread = s.channels.reduce((acc, c) => acc + (state.unread['c:' + c.id] || 0), 0);
    if (unread) b.append(el('span', 'rail-badge mono', unread > 9 ? '9+' : String(unread)));
    b.addEventListener('click', () => openChannel(s.id, s.channels[0].id));
    return b;
  }));

  railFriends.classList.toggle('is-active', state.sidebarMode === 'friends');
  const pending = state.friends.incoming.length;
  const fb = railFriends.querySelector('.rail-badge');
  if (fb) { fb.textContent = pending > 9 ? '9+' : String(pending); fb.hidden = !pending; }
}

/* =====================================================================
   RENDER: SIDEBAR
===================================================================== */
function renderSidebar() {
  sidebarBody.replaceChildren();
  if (state.sidebarMode === 'friends') renderFriendsSidebar();
  else {
    const s = state.servers.find(x => x.id === state.sidebarMode);
    if (s) renderServerSidebar(s);
  }
}

function personMain(u) {
  const m = el('div', 'person-main');
  m.append(el('div', 'person-name', u.displayName));
  m.append(el('div', 'person-user mono', '@' + u.username));
  return m;
}

function renderFriendsSidebar() {
  const f = state.friends;
  const head = el('div', 'side-head');
  head.append(el('h3', 'side-title', 'Friends'));
  head.append(el('p', 'side-sub mono',
    `${f.friends.length} FRIENDS · ${f.friends.filter(x => x.online).length} ONLINE`));
  sidebarBody.append(head);

  // search
  const search = el('div', 'side-search');
  search.append(icon('search'));
  const inp = el('input', 'side-search-input');
  inp.placeholder = 'Find people…';
  inp.spellcheck = false;
  search.append(inp);
  sidebarBody.append(search);
  const results = el('div', 'side-results');
  sidebarBody.append(results);

  let deb, seq = 0;
  const run = (q) => {
    const mySeq = ++seq;
    api('GET', '/api/users/search?q=' + encodeURIComponent(q)).then(d => {
      if (mySeq !== seq) return;
      results.replaceChildren(...d.results.map(u => {
        state.authors[u.id] = u;
        const row = el('div', 'person-row');
        row.append(avatarEl(u, { size: 32, showPresence: true, online: u.online }));
        row.append(personMain(u));
        if (u.state === 'friend') row.append(el('span', 'state-tag mono', 'FRIENDS'));
        else if (u.state === 'outgoing') row.append(el('span', 'state-tag mono', 'SENT'));
        else if (u.state === 'incoming') row.append(el('span', 'state-tag mono tag-accent', 'WANTS TO ADD'));
        else {
          const add = iconBtn('user-plus', '', 'Send friend request');
          add.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              await api('POST', '/api/friends/request', { userId: u.id });
              toast('Request sent', 'success');
              row.querySelector('.icon-btn').replaceWith(el('span', 'state-tag mono', 'SENT'));
            } catch (err) { toast(err.message, 'error'); }
          });
          row.append(add);
        }
        return row;
      }));
    }).catch(() => {});
  };
  inp.addEventListener('input', () => {
    clearTimeout(deb);
    const q = inp.value.trim();
    if (q.length < 2) { seq++; results.replaceChildren(); return; }
    deb = setTimeout(() => run(q), 250);
  });

  if (f.incoming.length) {
    sidebarBody.append(el('div', 'side-label', 'REQUESTS — ' + f.incoming.length));
    for (const u of f.incoming) {
      const row = el('div', 'person-row');
      row.append(avatarEl(u, { size: 32, showPresence: true, online: u.online }));
      row.append(personMain(u));
      const yes = iconBtn('check', '', 'Accept');
      yes.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await api('POST', '/api/friends/accept', { userId: u.id }); toast('You are now friends', 'success'); loadFriends(); }
        catch (err) { toast(err.message, 'error'); }
      });
      const no = iconBtn('x', 'icon-btn-danger', 'Decline');
      no.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await api('POST', '/api/friends/decline', { userId: u.id }); loadFriends(); }
        catch (err) { toast(err.message, 'error'); }
      });
      row.append(yes, no);
      sidebarBody.append(row);
    }
  }

  if (f.outgoing.length) {
    sidebarBody.append(el('div', 'side-label', 'SENT — ' + f.outgoing.length));
    for (const u of f.outgoing) {
      const row = el('div', 'person-row');
      row.append(avatarEl(u, { size: 32, showPresence: true, online: u.online }));
      row.append(personMain(u));
      row.append(el('span', 'state-tag mono', 'PENDING'));
      sidebarBody.append(row);
    }
  }

  sidebarBody.append(el('div', 'side-label', 'ALL — ' + f.friends.length));
  if (!f.friends.length) {
    sidebarBody.append(el('p', 'side-empty mono', 'NOBODY HERE YET — SEARCH ABOVE'));
  }
  for (const u of f.friends) {
    const row = el('div', 'person-row' +
      ((state.route && state.route.type === 'dm' && state.route.userId === u.id) ? ' is-active' : ''));
    row.tabIndex = 0;
    const go = () => openDm(u.id);
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    row.append(avatarEl(u, { size: 32, showPresence: true, online: u.online }));
    row.append(personMain(u));
    const msg = iconBtn('message', '', 'Message');
    msg.addEventListener('click', (e) => { e.stopPropagation(); go(); });
    const rm = iconBtn('trash', 'icon-btn-danger', 'Remove friend');
    rm.addEventListener('click', (e) => { e.stopPropagation(); inlineRemoveFriend(row, u); });
    row.append(msg, rm);
    sidebarBody.append(row);
  }
}

function inlineRemoveFriend(row, u) {
  const box = el('div', 'inline-confirm');
  box.append(el('span', '', `Remove ${u.displayName}?`));
  const yes = el('button', 'btn btn-danger btn-sm', 'Remove');
  yes.addEventListener('click', async () => {
    try { await api('POST', '/api/friends/remove', { userId: u.id }); toast('Friend removed'); loadFriends(); }
    catch (e) { toast(e.message, 'error'); renderSidebar(); }
  });
  const no = el('button', 'btn btn-ghost btn-sm', 'Cancel');
  no.addEventListener('click', renderSidebar);
  box.append(yes, no);
  row.replaceWith(box);
}

function renderServerSidebar(s) {
  const head = el('div', 'side-head');
  head.append(el('h3', 'side-title', s.name));
  head.append(el('p', 'side-sub mono', `${s.members.length} MEMBERS`));
  sidebarBody.append(head);

  for (const c of s.channels) {
    const active = state.route && state.route.type === 'channel' && state.route.channelId === c.id;
    const row = el('button', 'side-row side-channel' + (active ? ' is-active' : ''));
    row.append(icon('hash', 'row-icon'));
    row.append(el('span', 'row-label', c.name));
    const u = state.unread['c:' + c.id] || 0;
    if (u && !active) row.append(el('span', 'badge mono', u > 9 ? '9+' : String(u)));
    row.addEventListener('click', () => openChannel(s.id, c.id));
    sidebarBody.append(row);
  }

  const addCh = el('button', 'side-row side-add');
  addCh.append(icon('plus', 'row-icon'), el('span', 'row-label', 'New channel'));
  addCh.addEventListener('click', openNewChannelModal);
  sidebarBody.append(addCh);

  const inv = el('div', 'invite-row mono');
  inv.append(el('span', 'invite-label', 'INVITE'));
  inv.append(el('span', 'invite-code', s.inviteCode));
  const copyBtn = iconBtn('copy', '', 'Copy invite code');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(s.inviteCode); toast('Invite code copied', 'success'); }
    catch { toast('Copy failed — code is ' + s.inviteCode, 'error'); }
  });
  inv.append(copyBtn);
  sidebarBody.append(inv);

  const leave = el('button', 'link-danger mono', 'LEAVE SERVER');
  leave.addEventListener('click', () => confirmLeaveServer(s));
  sidebarBody.append(leave);
}

/* =====================================================================
   RENDER: CHAT CHROME
===================================================================== */
function renderChatChrome() {
  const r = state.route;
  chatTitle.replaceChildren();
  membersToggle.style.display = r ? '' : 'none';

  if (!r) {
    chatTitle.append(el('span', '', 'slate'));
    chatMeta.textContent = '';
    composerBox.classList.add('disabled');
    composerInput.placeholder = 'Message…';
    chatEmpty.hidden = false;
    emptyHint.textContent = state.friends.friends.length
      ? 'PICK A CHANNEL OR OPEN A FRIEND CONVERSATION'
      : 'FIND SOMEONE IN THE FRIENDS PANEL — PRESS “/” TO JUMP TO THE COMPOSER ONCE YOU’RE IN A ROOM';
    return;
  }
  composerBox.classList.remove('disabled');

  if (r.type === 'channel') {
    const s = state.servers.find(x => x.id === r.serverId);
    const ch = s && s.channels.find(c => c.id === r.channelId);
    const name = ch ? ch.name : 'channel';
    chatTitle.append(icon('hash', 'title-hash'), el('span', '', name));
    if (s) chatMeta.textContent = `${s.members.length} MEMBERS · ${s.members.filter(m => m.online).length} ONLINE`;
    composerInput.placeholder = `Message #${name}`;
  } else {
    const peer = getPeer(r.userId);
    if (!peer) { renderChatChromeFallback(); return; }
    chatTitle.append(avatarEl(peer, { size: 22 }), el('span', '', peer.displayName));
    chatMeta.textContent = `@${peer.username.toUpperCase()} · ${state.online.has(peer.id) ? 'ONLINE' : 'OFFLINE'}`;
    composerInput.placeholder = `Message ${peer.displayName}`;
  }
}
function renderChatChromeFallback() {
  chatTitle.append(el('span', '', '—'));
  chatMeta.textContent = '';
  composerBox.classList.add('disabled');
}

/* =====================================================================
   RENDER: MEMBERS
===================================================================== */
function renderMembers() {
  const r = state.route;
  membersBody.replaceChildren();
  if (!r) { membersHead.textContent = 'MEMBERS'; return; }

  if (r.type === 'channel') {
    membersHead.textContent = 'MEMBERS';
    const s = state.servers.find(x => x.id === r.serverId);
    if (!s) return;
    const on = s.members.filter(m => m.online);
    const off = s.members.filter(m => !m.online);
    const group = (label, arr, dim) => {
      if (!arr.length) return;
      membersBody.append(el('div', 'side-label', label));
      for (const m of arr) {
        state.authors[m.id] = m;
        const row = el('div', 'member-row' + (dim ? ' off' : ''));
        row.append(avatarEl(m, { size: 30, showPresence: !dim, online: m.online }));
        row.append(el('span', 'member-name', m.displayName + (m.id === state.me.id ? ' (you)' : '')));
        if (m.id === s.ownerId) row.append(el('span', 'member-tag mono', 'OWNER'));
        membersBody.append(row);
      }
    };
    group(`ONLINE — ${on.length}`, on, false);
    group(`OFFLINE — ${off.length}`, off, true);
  } else {
    membersHead.textContent = 'PROFILE';
    const peer = getPeer(r.userId);
    if (!peer) return;
    const card = el('div', 'peer-card');
    card.append(avatarEl(peer, { size: 64, showPresence: true, online: state.online.has(peer.id) }));
    card.append(el('div', 'peer-name', peer.displayName));
    card.append(el('div', 'peer-user mono', '@' + peer.username));
    if (peer.bio) card.append(el('p', 'peer-bio', peer.bio));
    card.append(el('div', 'peer-status mono', state.online.has(peer.id) ? '● ONLINE' : '○ OFFLINE'));
    const rm = el('button', 'btn btn-danger btn-sm', 'Remove friend');
    rm.addEventListener('click', () => {
      openModal({
        title: 'Remove friend',
        body: `Remove ${peer.displayName} from your friends? The message history stays on the server.`,
        actions: [
          { label: 'Cancel' },
          {
            label: 'Remove', cls: 'btn-danger',
            onClick: async () => {
              await api('POST', '/api/friends/remove', { userId: peer.id });
              toast('Friend removed');
            }
          }
        ]
      });
    });
    card.append(rm);
    membersBody.append(card);
  }
}

/* =====================================================================
   COMPOSER
===================================================================== */
function autosize() {
  composerInput.style.height = 'auto';
  composerInput.style.height = Math.min(composerInput.scrollHeight, 140) + 'px';
}

let typingSent = false, typingTimer = null;
function emitTyping(isTyping) {
  const r = state.route;
  if (!r || !state.socket) return;
  state.socket.emit('typing', {
    roomType: r.type === 'channel' ? 'channel' : 'dm',
    target: r.type === 'channel' ? r.channelId : r.userId,
    isTyping
  });
}

composerInput.addEventListener('input', () => {
  autosize();
  const has = composerInput.value.trim().length > 0;
  if (has && !typingSent) { typingSent = true; emitTyping(true); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { typingSent = false; emitTyping(false); }, 1600);
});

composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
sendBtn.addEventListener('click', sendMessage);

function sendMessage() {
  const r = state.route;
  if (!r || !state.socket) return;
  const text = composerInput.value.trim();
  if (!text) return;
  state.socket.emit('message:send', {
    roomType: r.type === 'channel' ? 'channel' : 'dm',
    target: r.type === 'channel' ? r.channelId : r.userId,
    text
  });
  composerInput.value = '';
  autosize();
  typingSent = false;
  clearTimeout(typingTimer);
  emitTyping(false);
}

chatScroll.addEventListener('scroll', () => {
  const far = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight > 300;
  jumpBtn.classList.toggle('show', far);
});
jumpBtn.addEventListener('click', () =>
  chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'smooth' }));

/* =====================================================================
   MODALS
===================================================================== */
function fieldEl(label, input) {
  const f = el('label', 'field');
  f.append(el('span', 'field-label mono', label));
  f.append(input);
  return f;
}

function openAddServerModal() {
  const nameInp = el('input'); nameInp.maxLength = 40; nameInp.placeholder = 'e.g. Late Night Club';
  const codeInp = el('input', 'mono'); codeInp.placeholder = 'e.g. K7X4RM';
  codeInp.style.textTransform = 'uppercase';
  const err = el('p', 'form-error mono'); err.hidden = true;

  const body = el('div');
  body.append(fieldEl('SERVER NAME', nameInp));
  const createBtn = el('button', 'btn btn-accent btn-block', 'Create server');
  createBtn.type = 'button';
  body.append(createBtn);
  const divi = el('div', 'modal-divider');
  divi.append(el('span', 'mono', 'OR JOIN WITH AN INVITE CODE'));
  body.append(divi);
  body.append(fieldEl('INVITE CODE', codeInp));
  const joinBtn = el('button', 'btn btn-ghost btn-block', 'Join server');
  joinBtn.type = 'button';
  body.append(joinBtn, err);

  const { close } = openModal({ title: 'Add a server', body, actions: [{ label: 'Cancel' }] });
  const fail = (m) => { err.textContent = m; err.hidden = false; };

  createBtn.addEventListener('click', async () => {
    const name = nameInp.value.trim();
    if (name.length < 2) return fail('Server name needs at least 2 characters');
    createBtn.disabled = true;
    try {
      const d = await api('POST', '/api/servers', { name });
      close();
      toast(`Server “${name}” created`, 'success');
      await loadServers();
      openChannel(d.server.id, d.server.channels[0].id);
    } catch (e) { fail(e.message); createBtn.disabled = false; }
  });

  joinBtn.addEventListener('click', async () => {
    const code = codeInp.value.trim().toUpperCase();
    if (!code) return fail('Enter an invite code');
    joinBtn.disabled = true;
    try {
      const d = await api('POST', '/api/servers/join', { inviteCode: code });
      close();
      toast(`Joined “${d.server.name}”`, 'success');
      await loadServers();
      openChannel(d.server.id, d.server.channels[0].id);
    } catch (e) { fail(e.message); joinBtn.disabled = false; }
  });
}

function openNewChannelModal() {
  const s = state.servers.find(x => x.id === state.sidebarMode);
  if (!s) return;
  const inp = el('input'); inp.placeholder = 'e.g. design-crit';
  const err = el('p', 'form-error mono'); err.hidden = true;
  const body = el('div');
  body.append(fieldEl('CHANNEL NAME', inp), err);
  const create = el('button', 'btn btn-accent btn-block', 'Create channel');
  create.type = 'button';
  body.append(create);
  const { close } = openModal({ title: 'New channel', body, actions: [{ label: 'Cancel' }] });

  create.addEventListener('click', async () => {
    const name = inp.value.trim();
    if (!name) { err.textContent = 'Give the channel a name'; err.hidden = false; return; }
    create.disabled = true;
    try {
      await api('POST', `/api/servers/${s.id}/channels`, { name });
      close();
      toast(`#${name.replace(/\s+/g, '-').toLowerCase()} created`, 'success');
      await loadServers();
      const created = (state.servers.find(x => x.id === s.id) || s).channels.slice(-1)[0];
      if (created) openChannel(s.id, created.id);
    } catch (e) { err.textContent = e.message; err.hidden = false; create.disabled = false; }
  });
}

function confirmLeaveServer(s) {
  openModal({
    title: 'Leave server',
    body: `You’ll need an invite code to rejoin “${s.name}”.`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Leave server', cls: 'btn-danger',
        onClick: async () => {
          await api('DELETE', `/api/servers/${s.id}/leave`);
          toast(`Left “${s.name}”`);
          await loadServers();
          if (state.servers.length) openChannel(state.servers[0].id, state.servers[0].channels[0].id);
          else openFriendsHome();
        }
      }
    ]
  });
}

/* =====================================================================
   SETTINGS
===================================================================== */
let avatarPreview = null;

function openSettings() {
  if (!state.me) return;
  avatarPreview = state.me.avatar || null;
  settingsPanel.classList.add('open');
  scrimSettings.classList.add('show');
  displayNameInput.value = state.me.displayName;
  bioInput.value = state.me.bio || '';
  bioCount.textContent = String(bioInput.value.length);
  renderSettingsAvatar();

  const factRow = (k, v) => {
    const row = el('div', 'fact-row');
    row.append(el('dt', '', k), el('dd', '', v));
    return row;
  };
  accountFacts.replaceChildren(
    factRow('USERNAME', '@' + state.me.username),
    factRow('EMAIL', state.me.email),
    factRow('MEMBER SINCE', new Date(state.me.createdAt)
      .toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase())
  );
  settingsApi.textContent = API_BASE;
}

function closeSettings() {
  settingsPanel.classList.remove('open');
  scrimSettings.classList.remove('show');
}

function renderSettingsAvatar() {
  settingsAvatar.replaceChildren(avatarEl({ ...state.me, avatar: avatarPreview }, { size: 64 }));
  avatarRemove.disabled = !avatarPreview;
}

function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 128;
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      URL.revokeObjectURL(url);
      let data = cv.toDataURL('image/png');
      if (data.length > 300000) data = cv.toDataURL('image/jpeg', 0.82);
      if (data.length > 400000) { reject(new Error('That image is too large')); return; }
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

avatarFile.addEventListener('change', async () => {
  const file = avatarFile.files[0];
  if (!file) return;
  try { avatarPreview = await fileToAvatar(file); renderSettingsAvatar(); }
  catch (e) { toast(e.message, 'error'); }
  avatarFile.value = '';
});
avatarRemove.addEventListener('click', () => { avatarPreview = null; renderSettingsAvatar(); });
bioInput.addEventListener('input', () => { bioCount.textContent = String(bioInput.value.length); });

profileSave.addEventListener('click', async () => {
  const displayName = displayNameInput.value.trim();
  if (!displayName) { toast('Display name cannot be empty', 'error'); return; }
  profileSave.disabled = true;
  try {
    const d = await api('PATCH', '/api/me', {
      displayName,
      bio: bioInput.value.trim(),
      avatar: avatarPreview
    });
    state.me = { ...state.me, ...d.user };
    state.authors[state.me.id] = { ...state.me };
    toast('Profile saved', 'success');
    renderRail(); renderMembers();
  } catch (e) { toast(e.message, 'error'); }
  finally { profileSave.disabled = false; }
});

logoutBtn.addEventListener('click', () => doLogout());

/* =====================================================================
   WIRING
===================================================================== */
railAdd.append(icon('plus'));
railFriends.append(icon('users'), el('span', 'rail-badge mono'));
railFriends.querySelector('.rail-badge').hidden = true;
railSettings.append(icon('sliders'));
sendBtn.append(icon('send'));
menuBtn.append(icon('menu'));
membersToggle.append(icon('users'));
settingsClose.append(icon('x'));
jumpBtn.append(icon('arrow-down'));

railAvatar.addEventListener('click', openSettings);
railSettings.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
scrimSettings.addEventListener('click', closeSettings);
railAdd.addEventListener('click', openAddServerModal);

railFriends.addEventListener('click', () => {
  state.sidebarMode = 'friends';
  if (state.route && state.route.type === 'channel') state.route = null;
  renderAll();
});

railTheme.addEventListener('click', () =>
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

 $$('.seg-btn', $('#themeSeg')).forEach(b =>
  b.addEventListener('click', () => setTheme(b.dataset.themeSet)));

membersToggle.addEventListener('click', () => {
  if (matchMedia('(min-width:1081px)').matches) {
    const on = appView.classList.toggle('members-on');
    localStorage.setItem(LS.members, on ? 'on' : 'off');
  } else {
    const open = membersPanel.classList.toggle('open');
    scrimMembers.classList.toggle('show', open);
  }
});
scrimMembers.addEventListener('click', closeDrawers);
scrimSidebar.addEventListener('click', closeDrawers);
menuBtn.addEventListener('click', openSidebarDrawer);

emptyCtaFriends.addEventListener('click', () => {
  state.sidebarMode = 'friends';
  if (state.route && state.route.type === 'channel') state.route = null;
  renderAll();
  openSidebarDrawer();
});
emptyCtaServer.addEventListener('click', openAddServerModal);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSettings(); closeDrawers(); }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && state.route) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); composerInput.focus(); }
  }
});

/* =====================================================================
   BOOT
===================================================================== */
(function init() {
  setTheme(localStorage.getItem(LS.theme) || 'dark', false);
  setAccent(localStorage.getItem(LS.accent) || '#ff5c38');
  buildSwatches();
  wireAuth();
  startPingMeter();
  updateTitle();

  const flash = sessionStorage.getItem('slate:flash');
  if (flash) { sessionStorage.removeItem('slate:flash'); toast(flash); }

  const token = localStorage.getItem(LS.token);
  if (token) {
    api('GET', '/api/auth/me')
      .then((d) => enterApp(d.user, token))
      .catch(() => { localStorage.removeItem(LS.token); });
  }
})();
