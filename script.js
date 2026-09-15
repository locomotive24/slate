'use strict';
/* =====================================================================
   slate — script.js (all frontend JS)
   ★ THE ONLY LINE YOU EDIT FOR PRODUCTION IS RIGHT BELOW ★
===================================================================== */
const QUERY_API  = new URLSearchParams(location.search).get('api');
const STORED_API = localStorage.getItem('slate:api');
const IS_LOCAL   = ['localhost', '127.0.0.1'].includes(location.hostname);

const API_BASE = (
  QUERY_API || STORED_API ||
  (IS_LOCAL ? 'http://localhost:4000' : 'https://slate-e6hp.onrender.com')
).replace(/\/+$/, '');

const LS = { token: 'slate:token', theme: 'slate:theme', accent: 'slate:accent', members: 'slate:members' };

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

/* =====================================================================
   STATE
===================================================================== */
const HISTORY_PAGE = 50;
const MSG_CAP = 500;               // max in-memory messages before trimming
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
  sidebarMode: 'friends',
  route: null,
  homeTab: 'online',
  addFriendQ: '',
  addFriendResults: null,
  messages: [],
  authors: {},
  unread: {},
  unreadMentions: {},
  typers: new Map(),
  socket: null,
  connectedOnce: false,
  replyTo: null,
  pendingImage: null,
  gifsEnabled: false,
  mentionUsers: [],
  mentionIndex: 0
};

/* ---------- element refs ---------- */
const authView = $('#authView'), appView = $('#appView');
const chatSection = $('#chatSection');
const railHome = $('#railHome'), railServers = $('#railServers'), railAvatar = $('#railAvatar');
const railAdd = $('#railAdd'), railFriends = $('#railFriends');
const railTheme = $('#railTheme');
const sidebar = $('#sidebar'), sidebarBody = $('#sidebarBody'), scrimSidebar = $('#scrimSidebar');
const chatTitle = $('#chatTitle'), homeTabs = $('#homeTabs'), chatMeta = $('#chatMeta');
const membersToggle = $('#membersToggle'), menuBtn = $('#menuBtn');
const homeView = $('#homeView'), homeBody = $('#homeBody');
const chatScroll = $('#chatScroll'), messagesEl = $('#messages');
const chatEmpty = $('#chatEmpty'), emptyHint = $('#emptyHint');
const emptyCtaFriends = $('#emptyCtaFriends'), emptyCtaServer = $('#emptyCtaServer');
const typingBar = $('#typingBar');
const composerBox = $('#composerBox'), composerInput = $('#composerInput'), sendBtn = $('#sendBtn');
const replyBar = $('#replyBar'), replyInfo = $('#replyInfo'), replyCancel = $('#replyCancel');
const pendingImageRow = $('#pendingImageRow'), pendingImageThumb = $('#pendingImageThumb');
const pendingImageRemove = $('#pendingImageRemove');
const attachBtn = $('#attachBtn'), gifBtn = $('#gifBtn'), imageFile = $('#imageFile');
const mentionPop = $('#mentionPop');
const jumpBtn = $('#jumpBtn');
const membersPanel = $('#membersPanel'), membersHead = $('#membersHead');
const membersBody = $('#membersBody'), scrimMembers = $('#scrimMembers');
const settingsPanel = $('#settingsPanel'), scrimSettings = $('#scrimSettings');
const settingsClose = $('#settingsClose'), settingsAvatar = $('#settingsAvatar');
const avatarFile = $('#avatarFile'), avatarRemove = $('#avatarRemove');
const usernameInput = $('#usernameInput'), displayNameInput = $('#displayNameInput');
const bioInput = $('#bioInput'), bioCount = $('#bioCount');
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
    res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Can’t reach the server — is it running?'); }
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
    img.alt = user.displayName || user.username || '';
    img.decoding = 'async';
    wrap.append(img);
  } else {
    wrap.append(el('span', 'avatar-fallback',
      ((user && (user.displayName || user.username)) || '?').trim().charAt(0).toUpperCase()));
  }
  if (showPresence) wrap.append(el('span', 'presence-dot' + (online ? ' on' : '')));
  return wrap;
}
function toast(message, type = 'info') {
  const t = el('div', 'toast toast-' + type);
  t.append(icon(type === 'error' ? 'x' : type === 'success' ? 'check' : 'message'));
  t.append(el('span', '', message));
  $('#toastRoot').append(t);
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 260); };
  t.addEventListener('click', kill);
  setTimeout(kill, 3600);
}
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

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function fmtDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

/* ---------- text rendering: URLs + @mention pills ---------- */
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
const MENTION_RE = /@([a-zA-Z0-9_]{3,20})/g;

function userByUsername(name) {
  const n = String(name).toLowerCase();
  const pools = [state.me, ...Object.values(state.authors)];
  const r = state.route;
  if (r && r.type === 'channel') {
    const s = state.servers.find(x => x.id === r.serverId);
    if (s) pools.push(...s.members);
  }
  if (r && r.type === 'dm') { const p = getPeer(r.userId); if (p) pools.push(p); }
  pools.push(...state.friends.friends);
  for (const u of pools) if (u && u.username && u.username.toLowerCase() === n) return u;
  return null;
}
function linkify(text) {
  const out = [];
  let last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const a = el('a', 'msg-link', m[0]);
    a.href = m[0]; a.target = '_blank'; a.rel = 'noopener noreferrer';
    out.push(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function renderText(text) {
  const frag = document.createDocumentFragment();
  let idx = 0, m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text))) {
    if (m.index > idx) frag.append(...linkify(text.slice(idx, m.index)));
    const u = userByUsername(m[1]);
    if (u) {
      frag.append(el('span',
        'mention' + (state.me && u.id === state.me.id ? ' mention-me' : ''),
        '@' + u.displayName));
    } else frag.append(m[0]);
    idx = m.index + m[0].length;
  }
  if (idx < text.length) frag.append(...linkify(text.slice(idx)));
  return frag;
}

/* =====================================================================
   NOTIFICATION PING + FAVICON BADGE
===================================================================== */
let audioCtx = null, lastPingAt = 0;
function playPing() {
  try {
    const t = Date.now();
    if (t - lastPingAt < 700) return; // no machine-gun dings
    lastPingAt = t;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const at = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.14;
    master.connect(audioCtx.destination);
    [[880, 0], [1318.5, 0.09]].forEach(([freq, off]) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at + off);
      g.gain.exponentialRampToValueAtTime(1, at + off + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + off + 0.32);
      osc.connect(g);
      g.connect(master);
      osc.start(at + off);
      osc.stop(at + off + 0.36);
    });
  } catch { /* audio not available — ignore */ }
}

let lastBadgeKey = '';
function updateFaviconBadge(total) {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#ff5c38';
  const onAccent = css.getPropertyValue('--on-accent').trim() || '#ffffff';
  // only re-encode the PNG when the number or color actually changed
  const key = total + '|' + accent;
  if (key === lastBadgeKey) return;
  lastBadgeKey = key;
  if (!total) { link.href = 'favicon.svg'; return; }
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#141417';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(32, 27, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = onAccent;
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total > 9 ? '9+' : String(total), 32, 28);
  link.href = cv.toDataURL('image/png');
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
  markActiveSwatch(hex);
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
    const b = el('button', 'swatch');
    b.type = 'button';
    b.title = a.name;
    b.style.background = a.hex;
    b.dataset.hex = a.hex;
    b.addEventListener('click', () => setAccent(a.hex));
    wrap.append(b);
  }
  const custom = el('label', 'swatch swatch-custom');
  custom.title = 'Custom color';
  custom.append(icon('plus'));
  const inp = el('input');
  inp.type = 'color';
  inp.value = cur;
  inp.addEventListener('input', () => setAccent(inp.value));
  custom.append(inp);
  wrap.append(custom);
  markActiveSwatch(cur);
}
function markActiveSwatch(hex) {
  const h = String(hex || '').toLowerCase();
  let matched = false;
  $$('#swatches .swatch').forEach(b => {
    if (b.classList.contains('swatch-custom')) return;
    const on = String(b.dataset.hex || '').toLowerCase() === h;
    b.classList.toggle('is-active', on);
    if (on) matched = true;
  });
  const custom = $('#swatches .swatch-custom');
  if (custom) custom.classList.toggle('is-active', !!h && !matched);
}

/* =====================================================================
   MISC HELPERS
===================================================================== */
const dmRoomKey = (a, b) => { const [x, y] = [a, b].sort(); return `dm:${x}:${y}`; };
const getPeer = (id) => state.friends.friends.find(f => f.id === id) || state.authors[id] || null;
const authorName = (id) => (state.authors[id] && state.authors[id].displayName) || 'unknown';
const isPinned = () => chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 140;
function serverInitials(name) {
  return String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || 'S';
}
function syncOnlineFrom(list) {
  for (const u of list) { if (u.online) state.online.add(u.id); else state.online.delete(u.id); }
}
function updateTitle() {
  const pings = Object.values(state.unreadMentions).reduce((a, b) => a + b, 0);
  document.title = (pings ? `(${pings}) ` : '') + 'slate · realtime chat';
  updateFaviconBadge(pings);
}
function renderAll() {
  renderRail(); renderSidebar(); renderChatChrome(); renderMembers();
}

/* ---------- THE FIX: coalesce event-driven re-renders ----------
   Presence/user/sync events used to trigger full re-renders one by
   one — dozens per second during a storm, each recreating avatar
   images. Now they're merged into at most one render per 300ms.  */
let renderTimer = null;
function requestRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderRail(); renderSidebar(); renderChatChrome(); renderMembers();
  }, 300);
}

/* ---------- THE FIX: cap in-memory messages in long rooms ---------- */
function trimMessagesIfNeeded() {
  if (state.messages.length <= MSG_CAP || !isPinned()) return;
  state.messages = state.messages.slice(-300);
  messagesEl.classList.add('no-anim');
  renderHistory({ instant: true });
  requestAnimationFrame(() => messagesEl.classList.remove('no-anim'));
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

/* ---------- THE FIX: throttle background data refreshes ---------- */
let lastFriendsFetch = 0, lastServersFetch = 0, lastResyncAt = 0;
function loadFriendsThrottled() {
  if (Date.now() - lastFriendsFetch < 2000) return;
  lastFriendsFetch = Date.now();
  loadFriends();
}
function loadServersThrottled() {
  if (Date.now() - lastServersFetch < 2000) return;
  lastServersFetch = Date.now();
  loadServers();
}

function closeDrawers() {
  sidebar.classList.remove('open'); scrimSidebar.classList.remove('show');
  membersPanel.classList.remove('open'); scrimMembers.classList.remove('show');
}
function openSidebarDrawer() {
  sidebar.classList.add('open'); scrimSidebar.classList.add('show');
}
function clearComposerExtras() {
  state.replyTo = null; renderReplyBar();
  state.pendingImage = null; renderPendingImage();
  hideMentionPop();
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

/* ---------- latency seismograph (login screen only — it STOPS after login) ---------- */
const pingHistory = [];
function startPingMeter() {
  const canvas = $('#pingCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const loop = async () => {
    if (authView.hidden) return; // logged in — the meter's job is done
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
    if (ms == null) { dot.classList.remove('on'); text.textContent = 'server unreachable — is it running?'; }
    else {
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
  api('GET', '/api/features').then(d => {
    state.gifsEnabled = !!d.gifs;
    gifBtn.hidden = !state.gifsEnabled;
  }).catch(() => {});
  Promise.all([loadServers(), loadFriends()]).then(() => {
    if (state.servers.length) openChannel(state.servers[0].id, state.servers[0].channels[0].id);
    else goHome();
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
  if (state.route && state.route.type === 'channel') {
    const s = state.servers.find(x => x.id === state.route.serverId);
    const ch = s && s.channels.find(c => c.id === state.route.channelId);
    if (!ch) {
      if (s) openChannel(s.id, s.channels[0].id);
      else goHome();
      return;
    }
  }
  if (state.sidebarMode !== 'friends' && !state.servers.find(s => s.id === state.sidebarMode)) {
    state.sidebarMode = 'friends';
  }
  requestRender();
}
async function loadFriends() {
  try {
    const d = await api('GET', '/api/friends');
    state.friends = d;
    syncOnlineFrom([...d.friends, ...d.incoming, ...d.outgoing]);
  } catch { return; }
  if (state.route && state.route.type === 'dm' && !getPeer(state.route.userId)) state.route = null;
  requestRender();
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
    // resync after a drop — but at most once every 5s if the connection flaps
    if (state.connectedOnce && Date.now() - lastResyncAt > 5000) {
      lastResyncAt = Date.now();
      resync();
    }
    state.connectedOnce = true;
  });
  socket.on('disconnect', () => { if (state.me) connBanner.hidden = false; });
  socket.on('connect_error', (err) => {
    if (String(err.message) === 'auth') doLogout('Your session expired — sign in again');
  });
  socket.on('message:new', onNewMessage);
  socket.on('message:delete', onMessageDeleted);
  socket.on('mention', onMention);
  socket.on('typing', onTyping);
  socket.on('presence:update', onPresence);
  socket.on('friend:request', (d) => { toast(`${d.user.displayName} wants to be your friend`); loadFriendsThrottled(); });
  socket.on('friend:accepted', (d) => { toast(`${d.user.displayName} accepted your request`, 'success'); loadFriendsThrottled(); });
  socket.on('friends:sync', loadFriendsThrottled);
  socket.on('user:update', onUserUpdate);
  socket.on('server:sync', loadServersThrottled);
}
function onUserUpdate({ user }) {
  if (!user) return;
  state.authors[user.id] = user;
  if (state.me && user.id === state.me.id) {
    state.me = { ...state.me, ...user };
  }
  state.friends.friends = state.friends.friends.map(f => (f.id === user.id ? { ...f, ...user } : f));
  requestRender();
}
function onPresence({ userId, online }) {
  if (online) state.online.add(userId); else state.online.delete(userId);
  for (const f of state.friends.friends) if (f.id === userId) f.online = online;
  for (const s of state.servers) for (const m of s.members) if (m.id === userId) m.online = online;
  requestRender();
}

/* THE FIX: mention toasts/sounds only when you're NOT already looking
   at that conversation. No more "document.hidden" pings while you're
   sitting in the room with another window focused.                    */
function onMention(d) {
  if (!d || !d.from) return;
  const r = state.route;
  let current = false;
  if (r && d.info) {
    if (r.type === 'channel' && d.info.type === 'channel') current = d.info.channelId === r.channelId;
    if (r.type === 'dm' && d.info.type === 'dm') current = d.info.userIds && d.info.userIds.includes(r.userId);
  }
  if (current) return; // you're watching that conversation — stay quiet
  const where = (d.place && d.place.channelName) ? '#' + d.place.channelName : 'a direct message';
  toast(`${d.from.displayName} mentioned you in ${where}`);
  // the sound itself is handled by onNewMessage
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

/* THE FIX: one strict sound rule —
   a ding ONLY when (a) it's a DM, or (b) you were @mentioned,
   AND you're not currently viewing that conversation (early return above). */
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
    trimMessagesIfNeeded();
    return;
  }
  if (m.authorId === state.me.id || !key) return;
  state.unread[key] = (state.unread[key] || 0) + 1;

  const isPing = (m.info && m.info.type === 'dm') ||
    (Array.isArray(m.mentions) && m.mentions.includes(state.me.id));
  if (isPing) {
    state.unreadMentions[key] = (state.unreadMentions[key] || 0) + 1;
    playPing();
  }
  requestRender();
  updateTitle();
}
function onMessageDeleted(d) {
  const r = state.route;
  if (!r || !d) return;
  const current = (r.type === 'channel' && d.type === 'channel' && d.room === r.channelId) ||
                  (r.type === 'dm' && d.type === 'dm');
  if (!current) return;
  const m = state.messages.find(x => x.id === d.id);
  if (!m) return;
  m.deleted = true; m.text = ''; m.image = null; m.replyTo = null;
  const node = messagesEl.querySelector(`[data-id="${d.id}"]`);
  if (node) node.replaceWith(messageNode(m, { noAnim: true }));
}

const isCompact = (prev, m) =>
  !!prev && prev.authorId === m.authorId && (m.createdAt - prev.createdAt) < 420000;
const dayChanged = (prev, m) =>
  !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();

function canDeleteMessage(m) {
  if (m.deleted) return false;
  if (m.authorId === state.me.id) return true;
  const r = state.route;
  if (r && r.type === 'dm') return true;
  if (r && r.type === 'channel') {
    const s = state.servers.find(x => x.id === r.serverId);
    if (s && s.ownerId === state.me.id) return true;
  }
  return false;
}

function messageNode(m, opts = {}) {
  const { compact = false, delay = 0, noAnim = false } = opts;
  const rich = !!(m.image || m.replyPreview);
  const compactRow = compact && !rich;
  const row = el('div', 'msg' + (noAnim ? '' : ' msg-in') +
    (compactRow ? ' compact' : '') + (m.deleted ? ' is-deleted' : ''));
  row.dataset.id = m.id;
  row.style.animationDelay = delay + 'ms';
  const body = el('div', 'msg-body');

  if (m.replyPreview) {
    const rq = el('div', 'msg-reply mono');
    rq.append(icon('reply', 'mini-icon'));
    rq.append(el('span', 'reply-name', authorName(m.replyPreview.authorId)));
    let snippet;
    if (m.replyPreview.deleted) snippet = 'message deleted';
    else if (m.replyPreview.image && !m.replyPreview.text) snippet = '🖼 image';
    else snippet = (m.replyPreview.text || '').slice(0, 90);
    rq.append(el('span', 'reply-snippet', snippet));
    body.append(rq);
  }

  if (m.deleted) {
    body.append(el('div', 'msg-text msg-text-deleted', 'message deleted'));
    row.append(el('span', 'msg-spacer'), body);
    return row;
  }

  const text = el('div', 'msg-text');
  text.append(renderText(m.text || ''));

  if (compactRow) {
    row.append(el('span', 'msg-spacer'), body);
    body.append(text);
    row.append(el('span', 'msg-time msg-time-compact mono', fmtTime(m.createdAt)));
  } else {
    row.append(avatarEl(state.authors[m.authorId] || { id: m.authorId, username: '?' }, { size: 34 }));
    const head = el('div', 'msg-head');
    head.append(el('span', 'msg-name', authorName(m.authorId)));
    head.append(el('span', 'msg-time mono', fmtTime(m.createdAt)));
    body.append(head, text);
    row.append(body);
  }

  if (m.image) {
    const img = el('img', 'msg-image');
    img.src = m.image; img.alt = 'image'; img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => {
      const fb = el('div', 'img-broken mono', 'IMAGE UNAVAILABLE');
      img.replaceWith(fb);
    });
    img.addEventListener('click', () => openLightbox(m.image));
    body.append(img);
  }

  const acts = el('div', 'msg-actions');
  const replyBtn = iconBtn('reply', 'act-btn', 'Reply');
  replyBtn.addEventListener('click', () => startReply(m));
  acts.append(replyBtn);
  if (canDeleteMessage(m)) {
    const delBtn = iconBtn('trash', 'act-btn icon-btn-danger', 'Delete message');
    delBtn.addEventListener('click', () => confirmDeleteMessage(m));
    acts.append(delBtn);
  }
  row.append(acts);
  return row;
}

function safeMessageNode(m, opts) {
  try { return messageNode(m, opts); }
  catch (e) {
    console.warn('[slate] skipping a malformed message:', e);
    const row = el('div', 'msg');
    const body = el('div', 'msg-body msg-text msg-text-deleted', 'message could not be displayed');
    row.append(el('span', 'msg-spacer'), body);
    return row;
  }
}

function startReply(m) {
  state.replyTo = m;
  renderReplyBar();
  composerInput.focus();
}
function renderReplyBar() {
  if (!state.replyTo) { replyBar.hidden = true; return; }
  replyInfo.replaceChildren();
  replyInfo.append(el('span', 'replying-to', 'Replying to '));
  replyInfo.append(el('span', 'replying-name', authorName(state.replyTo.authorId)));
  replyBar.hidden = false;
}
function renderPendingImage() {
  if (!state.pendingImage) { pendingImageRow.hidden = true; return; }
  pendingImageThumb.src = state.pendingImage;
  pendingImageRow.hidden = false;
}
function confirmDeleteMessage(m) {
  openModal({
    title: 'Delete message',
    body: 'This will delete it for everyone. This can’t be undone.',
    actions: [
      { label: 'Cancel' },
      { label: 'Delete', cls: 'btn-danger', onClick: async () => {
        if (state.socket) state.socket.emit('message:delete', { id: m.id });
      } }
    ]
  });
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
      prev = null;
    }
    messagesEl.append(safeMessageNode(m, {
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
  messagesEl.append(safeMessageNode(m, { compact: isCompact(prev, m) }));
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
  state.unreadMentions['c:' + channelId] = 0;
  updateTitle();
  openRoom();
}
function openDm(userId) {
  state.sidebarMode = 'friends';
  state.route = { type: 'dm', userId };
  state.unread['dm:' + userId] = 0;
  state.unreadMentions['dm:' + userId] = 0;
  updateTitle();
  openRoom();
}
function goHome(tab) {
  state.sidebarMode = 'friends';
  state.route = null;
  if (tab) state.homeTab = tab;
  state.typers.clear(); renderTyping();
  state.messages = [];
  messagesEl.replaceChildren();
  clearComposerExtras();
  closeDrawers();
  renderAll();
}
async function openRoom() {
  const current = state.route;
  state.typers.clear(); renderTyping();
  clearComposerExtras();
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
    if (!state.messages.length) emptyHint.textContent = 'THIS IS THE BEGINNING — SAY HELLO';
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
function renderRail() {
  if (!state.me) return;
  railAvatar.replaceChildren(avatarEl(state.me, { size: 44 }));
  railHome.classList.toggle('is-active', !state.route);
  railFriends.classList.toggle('is-active', !state.route);
  railServers.replaceChildren(...state.servers.map(s => {
    const b = el('button', 'rail-server' + (state.sidebarMode === s.id ? ' is-active' : ''));
    b.title = s.name + (s.official ? ' · official' : '');
    if (s.icon) {
      const img = el('img'); img.src = s.icon; img.alt = s.name; img.decoding = 'async';
      b.append(img);
    } else {
      b.append(el('span', '', serverInitials(s.name)));
    }
    const unread = s.channels.reduce((a, c) => a + (state.unread['c:' + c.id] || 0), 0);
    const pings = s.channels.reduce((a, c) => a + (state.unreadMentions['c:' + c.id] || 0), 0);
    if (pings) b.append(el('span', 'rail-badge mono', pings > 9 ? '9+' : String(pings)));
    else if (unread) b.append(el('span', 'rail-dot'));
    b.addEventListener('click', () => openChannel(s.id, s.channels[0].id));
    return b;
  }));
  const pending = state.friends.incoming.length;
  const fb = railFriends.querySelector('.rail-badge');
  if (fb) { fb.textContent = pending > 9 ? '9+' : String(pending); fb.hidden = !pending; }
}

/* =====================================================================
   RENDER: SIDEBAR
===================================================================== */
function renderSidebar() {
  sidebarBody.replaceChildren();
  if (state.sidebarMode === 'friends') renderDmSidebar();
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
function renderDmSidebar() {
  const f = state.friends;
  const head = el('div', 'side-head');
  head.append(el('h3', 'side-title', 'Messages'));
  head.append(el('p', 'side-sub mono', `${f.friends.length} FRIENDS · ${f.friends.filter(x => x.online).length} ONLINE`));
  sidebarBody.append(head);

  const find = el('button', 'side-row side-add');
  find.append(icon('search', 'row-icon'), el('span', 'row-label', 'Find friends'));
  find.addEventListener('click', () => goHome('add'));
  sidebarBody.append(find);

  sidebarBody.append(el('div', 'side-label', 'DIRECT MESSAGES — ' + f.friends.length));
  if (!f.friends.length) {
    sidebarBody.append(el('p', 'side-empty mono', 'ADD FRIENDS TO START MESSAGING'));
    return;
  }
  const sorted = [...f.friends].sort((a, b) =>
    (b.online - a.online) || a.displayName.localeCompare(b.displayName));
  for (const u of sorted) {
    const active = state.route && state.route.type === 'dm' && state.route.userId === u.id;
    const row = el('button', 'side-row side-dm' + (active ? ' is-active' : ''));
    row.append(avatarEl(u, { size: 30, showPresence: true, online: u.online }));
    row.append(el('span', 'row-label', u.displayName));
    const un = state.unread['dm:' + u.id] || 0;
    if (un && !active) row.append(el('span', 'badge badge-mention mono', un > 9 ? '9+' : String(un)));
    row.addEventListener('click', () => openDm(u.id));
    sidebarBody.append(row);
  }
}
function renderServerSidebar(s) {
  const isOwner = s.ownerId === state.me.id;
  const head = el('div', 'side-head side-head-row');
  const titles = el('div');
  titles.append(el('h3', 'side-title', s.name));
  titles.append(el('p', 'side-sub mono', `${s.members.length} MEMBERS`));
  head.append(titles);
  if (isOwner) {
    const gear = iconBtn('sliders', '', 'Server settings');
    gear.addEventListener('click', () => openServerSettingsModal(s));
    head.append(gear);
  }
  sidebarBody.append(head);

  for (const c of s.channels) {
    const active = state.route && state.route.type === 'channel' && state.route.channelId === c.id;
    const row = el('button', 'side-row side-channel' + (active ? ' is-active' : ''));
    row.append(icon('hash', 'row-icon'));
    row.append(el('span', 'row-label', c.name));
    const u = state.unread['c:' + c.id] || 0;
    const p = state.unreadMentions['c:' + c.id] || 0;
    if (!active && p) row.append(el('span', 'badge badge-mention mono', p > 9 ? '9+' : String(p)));
    else if (!active && u) row.append(el('span', 'badge mono', u > 9 ? '9+' : String(u)));
    row.addEventListener('click', () => openChannel(s.id, c.id));
    sidebarBody.append(row);
  }

  if (isOwner) {
    const addCh = el('button', 'side-row side-add');
    addCh.append(icon('plus', 'row-icon'), el('span', 'row-label', 'New channel'));
    addCh.addEventListener('click', openNewChannelModal);
    sidebarBody.append(addCh);
  }

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
   HOME VIEW
===================================================================== */
function renderHomeTabs() {
  const f = state.friends;
  const counts = {
    online: f.friends.filter(x => x.online).length,
    all: f.friends.length,
    pending: f.incoming.length + f.outgoing.length
  };
  const defs = [
    ['online', `Online — ${counts.online}`],
    ['all', `All — ${counts.all}`],
    ['pending', `Pending — ${counts.pending}`],
    ['add', 'Add Friend']
  ];
  homeTabs.replaceChildren(...defs.map(([k, label]) => {
    const b = el('button', 'home-tab' + (k === 'add' ? ' home-tab-add' : '') +
      (state.homeTab === k ? ' is-active' : ''));
    b.type = 'button';
    b.dataset.homeTab = k;
    b.textContent = label;
    return b;
  }));
}

/* THE FIX: home rebuilds keep their scroll position */
function renderHome() {
  const keepScroll = homeBody.scrollTop;
  buildHome();
  homeBody.scrollTop = keepScroll;
}
function buildHome() {
  homeBody.replaceChildren();
  const f = state.friends;
  if (state.homeTab === 'add') { renderAddFriend(); return; }
  if (state.homeTab === 'pending') {
    if (!f.incoming.length && !f.outgoing.length) {
      homeBody.append(el('p', 'home-empty mono', 'NO PENDING REQUESTS'));
      return;
    }
    if (f.incoming.length) {
      homeBody.append(el('div', 'side-label', 'INCOMING — ' + f.incoming.length));
      f.incoming.forEach(u => homeBody.append(friendRow(u, 'incoming')));
    }
    if (f.outgoing.length) {
      homeBody.append(el('div', 'side-label', 'OUTGOING — ' + f.outgoing.length));
      f.outgoing.forEach(u => homeBody.append(friendRow(u, 'outgoing')));
    }
    return;
  }
  let list = f.friends;
  if (state.homeTab === 'online') list = list.filter(x => x.online);
  if (!list.length) {
    homeBody.append(el('p', 'home-empty',
      state.homeTab === 'online' ? 'Nobody’s online right now.' : 'No friends yet — add some!'));
    return;
  }
  homeBody.append(el('div', 'side-label',
    (state.homeTab === 'online' ? 'ONLINE' : 'ALL FRIENDS') + ' — ' + list.length));
  list.forEach(u => homeBody.append(friendRow(u, 'friend')));
}
function friendRow(u, kind) {
  const row = el('div', 'friend-row');
  row.append(avatarEl(u, { size: 40, showPresence: true, online: u.online }));
  row.append(personMain(u));
  if (kind === 'friend') {
    row.addEventListener('click', () => openDm(u.id));
    const msg = iconBtn('message', '', 'Message');
    msg.addEventListener('click', (e) => { e.stopPropagation(); openDm(u.id); });
    const rm = iconBtn('trash', 'icon-btn-danger', 'Remove friend');
    rm.addEventListener('click', (e) => { e.stopPropagation(); confirmRemoveFriend(u); });
    row.append(msg, rm);
  } else if (kind === 'incoming') {
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
  } else if (kind === 'outgoing') {
    row.append(el('span', 'state-tag mono', 'PENDING'));
    const cancel = iconBtn('x', 'icon-btn-danger', 'Cancel request');
    cancel.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await api('POST', '/api/friends/cancel', { userId: u.id }); loadFriends(); }
      catch (err) { toast(err.message, 'error'); }
    });
    row.append(cancel);
  }
  return row;
}
function confirmRemoveFriend(u) {
  openModal({
    title: 'Remove friend',
    body: `Remove ${u.displayName} from your friends? The message history stays on the server.`,
    actions: [
      { label: 'Cancel' },
      { label: 'Remove', cls: 'btn-danger', onClick: async () => {
        await api('POST', '/api/friends/remove', { userId: u.id });
        toast('Friend removed');
        loadFriends();
      } }
    ]
  });
}

/* ---------- Add Friend tab — search box survives re-renders now ---------- */
let addFriendDeb = null, addFriendSeq = 0;
function renderAddFriend() {
  // THE FIX: if a background update rebuilds this view while you're
  // typing, your focus and caret position are preserved
  const prev = $('.add-friend-input');
  const wasFocused = !!prev && document.activeElement === prev;
  const caret = prev ? prev.selectionStart : 0;

  const wrap = el('div', 'add-friend');
  const box = el('div', 'add-friend-box');
  box.append(icon('search'));
  const inp = el('input', 'add-friend-input');
  inp.placeholder = 'Type a username or display name…';
  inp.spellcheck = false;
  inp.value = state.addFriendQ;
  box.append(inp);
  const status = el('p', 'add-friend-status mono');
  const results = el('div', 'add-friend-results');
  wrap.append(box, status, results);
  homeBody.append(wrap);

  if (wasFocused) {
    inp.focus();
    try { inp.setSelectionRange(caret, caret); } catch { /* ignore */ }
  }

  if (state.addFriendResults) updateAddFriendResults();
  else { status.textContent = 'SEARCH FOR SOMEONE BY USERNAME OR DISPLAY NAME'; status.hidden = false; }

  inp.addEventListener('input', () => {
    state.addFriendQ = inp.value;
    clearTimeout(addFriendDeb);
    const q = inp.value.trim();
    if (q.length < 2) {
      addFriendSeq++;
      state.addFriendResults = null;
      results.replaceChildren();
      status.textContent = 'KEEP TYPING — AT LEAST 2 CHARACTERS';
      status.hidden = false;
      return;
    }
    status.textContent = 'SEARCHING…';
    status.hidden = false;
    addFriendDeb = setTimeout(() => runAddFriendSearch(q), 300);
  });
}
function runAddFriendSearch(q) {
  const mySeq = ++addFriendSeq;
  api('GET', '/api/users/search?q=' + encodeURIComponent(q)).then(d => {
    if (mySeq !== addFriendSeq) return;
    state.addFriendResults = d.results;
    updateAddFriendResults();
  }).catch(e => {
    if (mySeq !== addFriendSeq) return;
    const status = $('.add-friend-status');
    if (status) { status.textContent = e.message.toUpperCase(); status.hidden = false; }
  });
}
function updateAddFriendResults() {
  const results = $('.add-friend-results');
  const status = $('.add-friend-status');
  if (!results || !status) return;
  const list = state.addFriendResults;
  if (!list) { results.replaceChildren(); return; }
  if (!list.length) {
    results.replaceChildren();
    status.textContent = 'NO RESULTS — CHECK THE SPELLING?';
    status.hidden = false;
    return;
  }
  status.hidden = true;
  results.replaceChildren(...list.map(u => {
    state.authors[u.id] = u;
    const row = el('div', 'person-row');
    row.append(avatarEl(u, { size: 32, showPresence: true, online: u.online }));
    row.append(personMain(u));
    if (u.state === 'friend') row.append(el('span', 'state-tag mono', 'FRIENDS'));
    else if (u.state === 'outgoing') row.append(el('span', 'state-tag mono', 'SENT'));
    else if (u.state === 'incoming') row.append(el('span', 'state-tag mono tag-accent', 'WANTS TO ADD YOU'));
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
}

/* =====================================================================
   RENDER: CHAT CHROME
===================================================================== */
function renderChatChrome() {
  const r = state.route;
  chatSection.classList.toggle('home-mode', !r);
  chatTitle.replaceChildren();

  if (!r) {
    chatTitle.append(el('span', '', 'Friends'));
    const online = state.friends.friends.filter(f => f.online).length;
    chatMeta.textContent = state.friends.friends.length ? `${online} / ${state.friends.friends.length} ONLINE` : '';
    composerBox.classList.add('disabled');
    composerInput.placeholder = 'Message…';
    renderHomeTabs();
    renderHome();
    return;
  }
  composerBox.classList.remove('disabled');

  if (r.type === 'channel') {
    const s = state.servers.find(x => x.id === r.serverId);
    const ch = s && s.channels.find(c => c.id === r.channelId);
    const name = ch ? ch.name : 'channel';
    chatTitle.append(icon('hash', 'title-hash'), el('span', '', name));
    if (s) chatMeta.textContent = `${s.members.length} MEMBERS · ${s.members.filter(m => m.online).length} ONLINE`;
    composerInput.placeholder = `Message #${name} — @ to mention`;
  } else {
    const peer = getPeer(r.userId);
    if (!peer) {
      chatTitle.append(el('span', '', '—'));
      chatMeta.textContent = '';
      composerBox.classList.add('disabled');
      return;
    }
    chatTitle.append(avatarEl(peer, { size: 22 }), el('span', '', peer.displayName));
    chatMeta.textContent = `@${peer.username.toUpperCase()} · ${state.online.has(peer.id) ? 'ONLINE' : 'OFFLINE'}`;
    composerInput.placeholder = `Message ${peer.displayName} — @ to mention`;
  }
}

/* =====================================================================
   RENDER: MEMBERS / ACTIVE NOW
===================================================================== */
function renderMembers() {
  const r = state.route;
  membersBody.replaceChildren();
  if (!r) {
    membersHead.textContent = 'ACTIVE NOW';
    const online = state.friends.friends.filter(f => f.online);
    if (!online.length) {
      const card = el('div', 'quiet-card');
      card.append(el('div', 'quiet-title', 'It’s quiet for now…'));
      card.append(el('p', 'quiet-sub', 'When friends come online, they’ll show up here so you can jump straight into a conversation.'));
      membersBody.append(card);
      return;
    }
    for (const u of online) {
      const row = el('div', 'active-row');
      row.append(avatarEl(u, { size: 32, showPresence: true, online: true }));
      const main = el('div', 'person-main');
      main.append(el('div', 'person-name', u.displayName));
      main.append(el('div', 'person-user mono', 'ONLINE'));
      row.append(main);
      row.addEventListener('click', () => openDm(u.id));
      membersBody.append(row);
    }
    return;
  }
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
    rm.addEventListener('click', () => confirmRemoveFriend(peer));
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

/* ---------- mention autocomplete ---------- */
function mentionCandidates(token) {
  const r = state.route;
  if (!r) return [];
  let pool = [];
  if (r.type === 'channel') {
    const s = state.servers.find(x => x.id === r.serverId);
    if (s) pool = s.members;
  } else {
    const p = getPeer(r.userId);
    if (p) pool = [p];
  }
  if (state.me) pool = [...pool, state.me];
  const seen = new Set(), uniq = [];
  for (const u of pool) if (u && !seen.has(u.id)) { seen.add(u.id); uniq.push(u); }
  const t = token.toLowerCase();
  const score = (u) => {
    const un = u.username.toLowerCase(), dn = (u.displayName || '').toLowerCase();
    if (un.startsWith(t) || dn.startsWith(t)) return 0;
    if (un.includes(t) || dn.includes(t)) return 1;
    return 2;
  };
  return uniq.map(u => ({ u, s: score(u) }))
    .filter(x => x.s < 2)
    .sort((a, b) => a.s - b.s)
    .slice(0, 6).map(x => x.u);
}
function hideMentionPop() {
  mentionPop.hidden = true;
  state.mentionUsers = [];
  state.mentionIndex = 0;
}
function showMentionPop(token) {
  const cands = mentionCandidates(token);
  if (!cands.length) { hideMentionPop(); return; }
  state.mentionUsers = cands;
  state.mentionIndex = 0;
  mentionPop.replaceChildren(...cands.map((u, i) => {
    const item = el('button', 'mention-item' + (i === 0 ? ' is-active' : ''));
    item.type = 'button';
    item.append(avatarEl(u, { size: 24 }));
    item.append(personMain(u));
    item.addEventListener('click', () => insertMention(u));
    return item;
  }));
  mentionPop.hidden = false;
}
function renderMentionActive() {
  [...mentionPop.children].forEach((c, i) => c.classList.toggle('is-active', i === state.mentionIndex));
}
function insertMention(u) {
  if (!u) return;
  const pos = composerInput.selectionStart;
  const before = composerInput.value.slice(0, pos);
  const after = composerInput.value.slice(composerInput.selectionEnd);
  const at = before.lastIndexOf('@');
  if (at === -1) return;
  const insert = '@' + u.username + ' ';
  composerInput.value = before.slice(0, at) + insert + after;
  const np = at + insert.length;
  composerInput.setSelectionRange(np, np);
  composerInput.focus();
  hideMentionPop();
  autosize();
}

composerInput.addEventListener('input', () => {
  autosize();
  const has = composerInput.value.trim().length > 0;
  if (has && !typingSent) { typingSent = true; emitTyping(true); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { typingSent = false; emitTyping(false); }, 1600);
  const pos = composerInput.selectionStart;
  const before = composerInput.value.slice(0, pos);
  const m = before.match(/@([a-zA-Z0-9_]*)$/);
  if (m) showMentionPop(m[1]); else hideMentionPop();
});
composerInput.addEventListener('keydown', (e) => {
  if (!mentionPop.hidden && state.mentionUsers.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.mentionIndex = (state.mentionIndex + 1) % state.mentionUsers.length;
      renderMentionActive(); return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.mentionIndex = (state.mentionIndex - 1 + state.mentionUsers.length) % state.mentionUsers.length;
      renderMentionActive(); return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(state.mentionUsers[state.mentionIndex]); return;
    }
    if (e.key === 'Escape') { e.preventDefault(); hideMentionPop(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
sendBtn.addEventListener('click', () => sendMessage());

/* ---------- image attachment ---------- */
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/gif') {
      if (file.size < 280000) {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Could not read that image'));
        r.readAsDataURL(file);
      } else {
        reject(new Error('GIF files must be under 280KB — use the GIF picker for bigger ones'));
      }
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let data = cv.toDataURL('image/jpeg', 0.78);
      if (data.length > 500000) data = cv.toDataURL('image/jpeg', 0.6);
      if (data.length > 550000) { reject(new Error('Image too large after compression')); return; }
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}
imageFile.addEventListener('change', async () => {
  const file = imageFile.files[0];
  if (!file) return;
  try { state.pendingImage = await fileToImage(file); renderPendingImage(); }
  catch (e) { toast(e.message, 'error'); }
  imageFile.value = '';
});
attachBtn.addEventListener('click', () => imageFile.click());
pendingImageRemove.addEventListener('click', () => { state.pendingImage = null; renderPendingImage(); });
replyCancel.addEventListener('click', () => { state.replyTo = null; renderReplyBar(); });

/* ---------- send ---------- */
function sendMessage(extra = {}) {
  const r = state.route;
  if (!r || !state.socket) return;
  const text = composerInput.value.trim();
  const image = extra.image || state.pendingImage || null;
  if (!text && !image) return;
  state.socket.emit('message:send', {
    roomType: r.type === 'channel' ? 'channel' : 'dm',
    target: r.type === 'channel' ? r.channelId : r.userId,
    text,
    image,
    replyTo: state.replyTo ? state.replyTo.id : null
  });
  composerInput.value = '';
  autosize();
  state.pendingImage = null; renderPendingImage();
  state.replyTo = null; renderReplyBar();
  hideMentionPop();
  typingSent = false; clearTimeout(typingTimer); emitTyping(false);
}

chatScroll.addEventListener('scroll', () => {
  const far = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight > 300;
  jumpBtn.classList.toggle('show', far);
}, { passive: true });
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
  if (s.official) { toast('The community server can’t be edited'); return; }
  if (s.ownerId !== state.me.id) { toast('Only the server owner can create channels'); return; }
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
      { label: 'Leave server', cls: 'btn-danger', onClick: async () => {
        await api('DELETE', `/api/servers/${s.id}/leave`);
        toast(`Left “${s.name}”`);
        await loadServers();
        if (state.servers.length) openChannel(state.servers[0].id, state.servers[0].channels[0].id);
        else goHome();
      } }
    ]
  });
}
function openServerSettingsModal(s) {
  if (s.official) { toast('The community server can’t be edited'); return; }
  let iconPreview = s.icon || null;
  const nameInp = el('input'); nameInp.maxLength = 40; nameInp.value = s.name;
  const err = el('p', 'form-error mono'); err.hidden = true;

  const iconSlot = el('span');
  const fileInp = el('input'); fileInp.type = 'file'; fileInp.accept = 'image/*'; fileInp.hidden = true;
  const uploadLbl = el('label', 'btn btn-ghost btn-sm');
  uploadLbl.append(el('span', '', 'Upload icon'), fileInp);
  const removeBtn = el('button', 'btn btn-ghost btn-sm', 'Remove');
  const actions = el('div', 'avatar-actions'); actions.append(uploadLbl, removeBtn);
  const row = el('div', 'avatar-row'); row.append(iconSlot, actions);

  const renderIcon = () => {
    const w = el('span', 'server-icon');
    w.style.setProperty('--sv', '64px');
    if (iconPreview) { const im = el('img'); im.src = iconPreview; w.append(im); }
    else w.append(el('span', '', serverInitials(nameInp.value || s.name)));
    iconSlot.replaceChildren(w);
    removeBtn.disabled = !iconPreview;
  };
  renderIcon();
  nameInp.addEventListener('input', renderIcon);
  fileInp.addEventListener('change', async () => {
    const f = fileInp.files[0];
    if (!f) return;
    try { iconPreview = await fileToAvatar(f); renderIcon(); }
    catch (e) { toast(e.message, 'error'); }
    fileInp.value = '';
  });
  removeBtn.addEventListener('click', () => { iconPreview = null; renderIcon(); });

  const save = el('button', 'btn btn-accent btn-block', 'Save settings');
  save.type = 'button';
  const body = el('div');
  body.append(row, fieldEl('SERVER NAME', nameInp), save, err);
  const { close } = openModal({ title: 'Server settings', body, actions: [{ label: 'Cancel' }] });
  save.addEventListener('click', async () => {
    const name = nameInp.value.trim();
    if (name.length < 2) { err.textContent = 'Name needs at least 2 characters'; err.hidden = false; return; }
    save.disabled = true;
    try {
      await api('PATCH', `/api/servers/${s.id}`, { name, icon: iconPreview });
      close();
      toast('Server updated', 'success');
      loadServers();
    } catch (e) { err.textContent = e.message; err.hidden = false; save.disabled = false; }
  });
}
function openGifModal() {
  if (!state.gifsEnabled) { toast('GIFs aren’t configured on the server'); return; }
  const search = el('input', 'gif-search');
  search.placeholder = 'Search Tenor…';
  const grid = el('div', 'gif-grid');
  const status = el('p', 'gif-status mono', 'LOADING…');
  const body = el('div', 'gif-wrap');
  body.append(search, status, grid);
  const { close } = openModal({ title: 'GIFs', body, actions: [{ label: 'Close' }] });
  const load = (q) => {
    status.hidden = false; status.textContent = 'LOADING…';
    grid.replaceChildren();
    api('GET', '/api/gifs/search?q=' + encodeURIComponent(q)).then(d => {
      if (!d.gifs.length) { status.textContent = 'NO GIFS FOUND'; return; }
      status.hidden = true;
      grid.replaceChildren(...d.gifs.map(g => {
        const item = el('button', 'gif-item');
        item.type = 'button';
        item.title = g.desc || '';
        const img = el('img');
        img.src = g.preview || g.url;
        img.loading = 'lazy';
        img.alt = g.desc || '';
        img.addEventListener('error', () => item.remove());
        item.append(img);
        item.addEventListener('click', () => { close(); sendMessage({ image: g.url }); });
        return item;
      }));
    }).catch(e => { status.textContent = e.message.toUpperCase(); });
  };
  load('');
  let deb;
  search.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => load(search.value.trim()), 350);
  });
}
function openLightbox(src) {
  const img = el('img', 'lightbox-img');
  img.src = src;
  img.alt = 'image';
  openModal({ title: 'Image', body: img, actions: [{ label: 'Close' }] });
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
  usernameInput.value = state.me.username;
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
  const username = usernameInput.value.trim();
  const displayName = displayNameInput.value.trim();
  if (!displayName) { toast('Display name cannot be empty', 'error'); return; }
  profileSave.disabled = true;
  try {
    const d = await api('PATCH', '/api/me', {
      username, displayName, bio: bioInput.value.trim(), avatar: avatarPreview
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
railHome.append(icon('home'));
railAdd.append(icon('plus'));
railFriends.append(icon('users'), el('span', 'rail-badge mono'));
railFriends.querySelector('.rail-badge').hidden = true;
attachBtn.append(icon('image'));
sendBtn.append(icon('send'));
menuBtn.append(icon('menu'));
membersToggle.append(icon('users'));
settingsClose.append(icon('x'));
jumpBtn.append(icon('arrow-down'));
 $('#replyIconSlot').append(icon('reply', 'mini-icon'));

railHome.addEventListener('click', () => goHome());
railFriends.addEventListener('click', () => goHome('online'));
railAvatar.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
scrimSettings.addEventListener('click', closeSettings);
railAdd.addEventListener('click', openAddServerModal);
gifBtn.addEventListener('click', openGifModal);

homeTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.home-tab');
  if (!b) return;
  state.homeTab = b.dataset.homeTab;
  renderHomeTabs();
  renderHome();
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

emptyCtaFriends.addEventListener('click', () => { goHome('add'); openSidebarDrawer(); });
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
