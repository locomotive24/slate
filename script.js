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
const MSG_CAP = 300;
const MSG_KEEP = 150;
const ACCENTS = [
  { name: 'Ember',  hex: '#ff5c38' },
  { name: 'Amber',  hex: '#ffb224' },
  { name: 'Lime',   hex: '#b6e04a' },
  { name: 'Mint',   hex: '#3ecf8e' },
  { name: 'Sky',    hex: '#41c1e5' },
  { name: 'Orchid', hex: '#c66bff' }
];
const EMOJIS = [
  '👍','👎','❤️','😂','😮','😢','🙏','🔥','🎉','😡','💯','✅','❌','👀','🤔','😅',
  '🤝','👋','🤖','⭐','💜','👏','😭','😍','😎','🥳','💤','🚀','☕','🍕','🎮','🎵',
  '📢','💡','🐱','🐶','🦀','🐙'
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
  mentionIndex: 0,
  hasMore: false,
  loadingOlder: false
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
const replyIconSlot = $('#replyIconSlot');
const pendingImageRow = $('#pendingImageRow'), pendingImageThumb = $('#pendingImageThumb');
const pendingImageRemove = $('#pendingImageRemove');
const attachBtn = $('#attachBtn'), emojiBtn = $('#emojiBtn'), gifBtn = $('#gifBtn'), imageFile = $('#imageFile');
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
  b.type = 'button';
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
    btn.type = 'button';
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
function modalAction(btn, fn) {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
  });
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

/* =====================================================================
   TEXT RENDERING — markdown-lite + links + @mention pills
   All DOM-built (no innerHTML) so it's XSS-safe by construction.
===================================================================== */
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

/* url | `code` | @mention (word-bounded) | **bold** | *italic* | ~~strike~~ */
const INLINE_RE = /(https?:\/\/[^\s<>"']+)|(`[^`\n]+`)|((?:^|\s)@[a-zA-Z0-9_]{3,20}(?![a-zA-Z0-9_]))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)/g;

function inlinePass(text) {
  const out = [];
  let last = 0, m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      const a = el('a', 'msg-link', tok);
      a.href = tok; a.target = '_blank'; a.rel = 'noopener noreferrer';
      out.push(a);
    } else if (m[2]) {
      out.push(el('code', 'inline-code', tok.slice(1, -1)));
    } else if (m[3]) {
      const lead = tok[0] === '@' ? '' : tok[0];
      if (lead) out.push(lead);
      const uname = tok.slice(lead.length + 1);
      const u = userByUsername(uname);
      if (u) {
        out.push(el('span',
          'mention' + (state.me && u.id === state.me.id ? ' mention-me' : ''),
          '@' + u.displayName));
      } else out.push(tok.slice(lead.length));
    } else if (m[4]) {
      out.push(el('b', '', tok.slice(2, -2)));
    } else if (m[5]) {
      out.push(el('em', '', tok.slice(1, -1)));
    } else if (m[6]) {
      out.push(el('s', '', tok.slice(2, -2)));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function renderRich(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text || '').split('```');
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      let code = parts[i].replace(/^\n/, '').replace(/\n+$/, '');
      if (/^[a-zA-Z0-9+#-]{1,10}\n/.test(code)) code = code.replace(/^[a-zA-Z0-9+#-]{1,10}\n/, '');
      const pre = el('pre', 'code-block');
      pre.textContent = code || ' ';
      frag.append(pre);
    } else if (parts[i]) {
      frag.append(...inlinePass(parts[i]));
    }
  }
  return frag;
}

/* =====================================================================
   NOTIFICATION PING + FAVICON BADGE
===================================================================== */
let audioCtx = null, lastPingAt = 0;
function playPing() {
  try {
    const t = Date.now();
    if (t - lastPingAt < 700) return;
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
  } catch { /* audio not available */ }
}

let lastBadgeKey = '';
function updateFaviconBadge(total) {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#ff5c38';
  const onAccent = css.getPropertyValue('--on-accent').trim() || '#ffffff';
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
  updateFaviconBadge(Object.values(state.unread).reduce((a, b) => a + b, 0));
}
function setTheme(mode, persist = true) {
  briefThemeAnim();
  document.documentElement.dataset.theme = mode;
  if (persist) localStorage.setItem(LS.theme, mode);
  $$('.seg-btn', $('#themeSeg')).forEach(b => b.classList.toggle('is-active', b.dataset.themeSet === mode));
  railTheme.replaceChildren(icon(mode === 'dark' ? 'sun' : 'moon'));
  railTheme.title = mode === 'dark' ? 'Switch to light' : 'Switch to dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = mode === 'dark' ? '#101013' : '#e7e5df';
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

const isPinned = () => chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 80;

function serverInitials(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || 'S';
}
function syncOnlineFrom(list) {
  for (const u of list) { if (u.online) state.online.add(u.id); else state.online.delete(u.id); }
}
function updateTitle() {
  const total = Object.values(state.unread).reduce((a, b) => a + b, 0);
  document.title = (total ? `(${total}) ` : '') + 'Slate';
  updateFaviconBadge(total);
}
function renderAll() {
  renderRail(); renderSidebar(); renderChatChrome(); renderMembers();
  if (!state.route) renderHome();
}
function setView(mode) {
  chatSection.classList.toggle('home-mode', mode === 'home');
}

/* coalesce event-driven re-renders (max one per 300ms) */
let renderTimer = null;
function requestRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if (document.hidden) return;
    renderAll();
  }, 300);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRender(); });

function trimMessagesIfNeeded() {
  if (state.messages.length <= MSG_CAP || !isPinned()) return;
  state.messages = state.messages.slice(-MSG_KEEP);
  state.hasMore = true;
  messagesEl.classList.add('no-anim');
  renderHistory({ instant: true });
  requestAnimationFrame(() => messagesEl.classList.remove('no-anim'));
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

/* throttled loaders — trailing edge, so an event arriving during the
   cooldown is DEFERRED, never dropped (this is what made member lists
   go stale until a refresh) */
let lastFriendsFetch = 0, lastServersFetch = 0, lastResyncAt = 0;
let friendsFetchTimer = null, serversFetchTimer = null;
function loadFriendsThrottled() {
  const due = Date.now() - lastFriendsFetch;
  if (due >= 2000) { lastFriendsFetch = Date.now(); loadFriends(); return; }
  clearTimeout(friendsFetchTimer);
  friendsFetchTimer = setTimeout(() => { lastFriendsFetch = Date.now(); loadFriends(); }, 2100 - due);
}
function loadServersThrottled() {
  const due = Date.now() - lastServersFetch;
  if (due >= 2000) { lastServersFetch = Date.now(); loadServers(); return; }
  clearTimeout(serversFetchTimer);
  serversFetchTimer = setTimeout(() => { lastServersFetch = Date.now(); loadServers(); }, 2100 - due);
}

function closeDrawers() {
  sidebar.classList.remove('open'); scrimSidebar.classList.remove('show');
  membersPanel.classList.remove('open'); scrimMembers.classList.remove('show');
}
function clearComposerExtras() {
  state.replyTo = null; renderReplyBar();
  state.pendingImage = null; renderPendingImage();
  hideMentionPop();
  closeEmojiPop();
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

/* ---------- latency seismograph (login screen only) ---------- */
const pingHistory = [];
function startPingMeter() {
  const canvas = $('#pingCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const loop = async () => {
    if (authView.hidden) return;
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
  goHome();
  updateTitle();
  api('GET', '/api/features').then(d => {
    state.gifsEnabled = !!d.gifs;
    gifBtn.hidden = !state.gifsEnabled;
  }).catch(() => {});
  Promise.all([loadServers(), loadFriends()]).then(() => {
    if (state.servers.length && !state.route) openChannel(state.servers[0].id, state.servers[0].channels[0].id);
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
      if (s && s.channels.length) openChannel(s.id, s.channels[0].id);
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
  if (state.route && state.route.type === 'dm' && !getPeer(state.route.userId)) {
    goHome();
    return;
  }
  requestRender();
}

/* reconnects only APPEND messages you actually missed */
async function resync() {
  await Promise.all([loadServers(), loadFriends()]);
  const r = state.route;
  if (!r) return;
  try {
    const path = r.type === 'channel' ? `/api/messages/channel/${r.channelId}` : `/api/messages/dm/${r.userId}`;
    const d = await api('GET', path);
    if (state.route !== r) return;
    Object.assign(state.authors, d.users);

    if (!state.messages.length) {
      state.messages = d.messages;
      state.hasMore = d.messages.length === HISTORY_PAGE;
      renderHistory();
      return;
    }
    const newestAt = state.messages[state.messages.length - 1].createdAt;
    const fresh = d.messages.filter(m => m.createdAt > newestAt);
    if (!fresh.length) return;
    for (const m of fresh) {
      state.messages.push(m);
      state.typers.delete(m.authorId);
      renderMessageAppend(m);
    }
    renderTyping();
    if (isPinned()) chatScroll.scrollTop = chatScroll.scrollHeight;
  } catch { /* route may be gone */ }
}

/* =====================================================================
   SOCKET
===================================================================== */
function safeHandler(fn) {
  return (...args) => {
    try { fn(...args); }
    catch (e) { console.warn('[slate] handler error:', e); }
  };
}
function connectSocket(token) {
  const socket = io(API_BASE, { auth: { token }, transports: ['websocket', 'polling'] });
  state.socket = socket;
  socket.on('connect', () => {
    connBanner.hidden = true;
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
  socket.on('message:new', safeHandler(onNewMessage));
  socket.on('message:delete', safeHandler(onMessageDeleted));
  socket.on('message:update', safeHandler(onMessageUpdated));
  socket.on('reaction:update', safeHandler(onReactionUpdate));
  socket.on('mention', safeHandler(onMention));
  socket.on('typing', safeHandler(onTyping));
  socket.on('presence:update', safeHandler(onPresence));
  socket.on('friend:request', safeHandler((d) => { toast(`${d.user.displayName} wants to be your friend`); loadFriendsThrottled(); }));
  socket.on('friend:accepted', safeHandler((d) => { toast(`${d.user.displayName} accepted your request`, 'success'); loadFriendsThrottled(); }));
  socket.on('friends:sync', safeHandler(loadFriendsThrottled));
  socket.on('user:update', safeHandler(onUserUpdate));
  socket.on('server:sync', safeHandler(loadServersThrottled));
}
function onUserUpdate({ user }) {
  if (!user) return;
  state.authors[user.id] = user;
  if (state.me && user.id === state.me.id) {
    state.me = { ...state.me, ...user };
  }
  state.friends.friends = state.friends.friends.map(f => (f.id === user.id ? { ...f, ...user } : f));
  loadServersThrottled();   /* refresh member lists that show this user */
  requestRender();
}
function onPresence({ userId, online }) {
  if (online) state.online.add(userId); else state.online.delete(userId);
  for (const f of state.friends.friends) if (f.id === userId) f.online = online;
  for (const s of state.servers) for (const m of s.members) if (m.id === userId) m.online = online;
  requestRender();
}
function onMention(d) {
  if (!d || !d.from) return;
  const r = state.route;
  let current = false;
  if (r && d.info) {
    if (r.type === 'channel' && d.info.type === 'channel') current = d.info.channelId === r.channelId;
    if (r.type === 'dm' && d.info.type === 'dm') current = d.info.userIds && d.info.userIds.includes(r.userId);
  }
  if (current) return;
  const where = (d.place && d.place.channelName) ? '#' + d.place.channelName : 'a direct message';
  toast(`${d.from.displayName} mentioned you in ${where}`);
}
function onTyping(t) {
  const r = state.route;
  if (!r || !state.me) return;
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
  if (!r || !m || !state.me) return false;
  if (r.type === 'channel') return m.type === 'channel' && m.room === r.channelId;
  return m.type === 'dm' && m.room === dmRoomKey(state.me.id, r.userId);
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
    trimMessagesIfNeeded();
    return;
  }
  if (m.authorId === state.me.id || !key) return;
  state.unread[key] = (state.unread[key] || 0) + 1;

  const isDM = !!(m.info && m.info.type === 'dm');
  const isPing = isDM || (Array.isArray(m.mentions) && m.mentions.includes(state.me.id));
  if (isPing) {
    state.unreadMentions[key] = (state.unreadMentions[key] || 0) + 1;
    playPing();
    if (isDM) {
      const from = (m.author && m.author.displayName) || authorName(m.authorId);
      const snippet = m.text ? m.text.slice(0, 70) : 'sent an image';
      toast(`${from} · DM — ${snippet}`);
    }
  }
  requestRender();
  updateTitle();
}
function onMessageDeleted(d) {
  const r = state.route;
  if (!r || !d || !state.me) return;
  const current = (r.type === 'channel' && d.type === 'channel' && d.room === r.channelId) ||
                  (r.type === 'dm' && d.type === 'dm' && d.room === dmRoomKey(state.me.id, r.userId));
  if (!current) return;
  const m = state.messages.find(x => x.id === d.id);
  if (!m) return;
  m.deleted = true; m.text = ''; m.image = null; m.replyTo = null; m.reactions = {};
  replaceMessageNode(m);
}
function onMessageUpdated(d) {
  const r = state.route;
  if (!r || !d || !state.me) return;
  const current = (r.type === 'channel' && d.type === 'channel' && d.room === r.channelId) ||
                  (r.type === 'dm' && d.type === 'dm' && d.room === dmRoomKey(state.me.id, r.userId));
  if (!current) return;
  const m = state.messages.find(x => x.id === d.id);
  if (!m || m.deleted) return;
  m.text = d.text;
  m.editedAt = d.editedAt;
  m.mentions = d.mentions || [];
  replaceMessageNode(m);
}
function onReactionUpdate(d) {
  const r = state.route;
  if (!r || !d || !state.me) return;
  const current = (r.type === 'channel' && d.type === 'channel' && d.room === r.channelId) ||
                  (r.type === 'dm' && d.type === 'dm' && d.room === dmRoomKey(state.me.id, r.userId));
  if (!current) return;
  const m = state.messages.find(x => x.id === d.id);
  if (!m || m.deleted) return;
  m.reactions = d.reactions || {};
  replaceMessageNode(m);
}

const isCompact = (prev, m) =>
  !!prev && prev.authorId === m.authorId && (m.createdAt - prev.createdAt) < 420000;
const dayChanged = (prev, m) =>
  !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();

/* DMs: only your own messages. Channels: yours, or any if you own the server. */
function canDeleteMessage(m) {
  if (m.deleted) return false;
  if (m.authorId === state.me.id) return true;
  const r = state.route;
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
  text.append(renderRich(m.text || ''));
  if (m.authorId === state.me.id) {
    text.addEventListener('dblclick', () => startEdit(m));
  }

  if (compactRow) {
    row.append(el('span', 'msg-spacer'), body);
    body.append(text);
    row.append(el('span', 'msg-time msg-time-compact mono',
      fmtTime(m.createdAt) + (m.editedAt ? ' · EDITED' : '')));
  } else {
    row.append(avatarEl(state.authors[m.authorId] || { id: m.authorId, username: '?' }, { size: 34 }));
    const head = el('div', 'msg-head');
    head.append(el('span', 'msg-name', authorName(m.authorId)));
    head.append(el('span', 'msg-time mono', fmtTime(m.createdAt)));
    if (m.editedAt) head.append(el('span', 'msg-edited mono', 'EDITED'));
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
    img.addEventListener('load', () => {
      if (isPinned()) chatScroll.scrollTop = chatScroll.scrollHeight;
    });
    body.append(img);
  }

  const rrow = reactionsRow(m);
  if (rrow) body.append(rrow);

  const acts = el('div', 'msg-actions');
  const replyBtn = iconBtn('reply', 'act-btn', 'Reply');
  replyBtn.addEventListener('click', () => startReply(m));
  acts.append(replyBtn);
  const reactBtn = iconBtn('smile', 'act-btn', 'Add reaction');
  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEmojiPop(reactBtn, (em) => toggleReaction(m, em));
  });
  acts.append(reactBtn);
  if (m.authorId === state.me.id) {
    const editBtn = iconBtn('edit', 'act-btn', 'Edit');
    editBtn.addEventListener('click', () => startEdit(m));
    acts.append(editBtn);
  }
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
function replaceMessageNode(m) {
  const node = messagesEl.querySelector(`[data-id="${m.id}"]`);
  if (!node) return;
  const i = state.messages.indexOf(m);
  const prev = i > 0 ? state.messages[i - 1] : null;
  node.replaceWith(safeMessageNode(m, { compact: isCompact(prev, m), noAnim: true }));
}

/* ---------- reactions ---------- */
function reactionsRow(m) {
  const rx = m.reactions || {};
  const chips = [];
  for (const emoji of Object.keys(rx)) {
    const list = rx[emoji] || [];
    if (!list.length) continue;
    const chip = el('button', 'reaction' + (list.includes(state.me.id) ? ' is-mine' : ''));
    chip.type = 'button';
    chip.title = list.length + (list.length === 1 ? ' reaction' : ' reactions');
    chip.append(el('span', 'r-emoji', emoji), el('span', 'r-count mono', String(list.length)));
    chip.addEventListener('click', () => toggleReaction(m, emoji));
    chips.push(chip);
  }
  if (!chips.length) return null;
  const rowEl = el('div', 'reactions');
  for (const c of chips) rowEl.append(c);
  const add = el('button', 'reaction reaction-add');
  add.type = 'button';
  add.title = 'Add reaction';
  add.append(el('span', 'r-emoji', '+'));
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    openEmojiPop(add, (em) => toggleReaction(m, em));
  });
  rowEl.append(add);
  return rowEl;
}
function toggleReaction(m, emoji) {
  if (!state.socket || m.deleted) return;
  m.reactions = m.reactions || {};
  const list = m.reactions[emoji] || [];
  if (list.includes(state.me.id)) {
    const next = list.filter(id => id !== state.me.id);
    if (next.length) m.reactions[emoji] = next; else delete m.reactions[emoji];
  } else {
    m.reactions[emoji] = [...list, state.me.id];
  }
  replaceMessageNode(m);
  state.socket.emit('reaction:toggle', { messageId: m.id, emoji });
}

/* ---------- inline editing ---------- */
function startEdit(m) {
  const node = messagesEl.querySelector(`[data-id="${m.id}"]`);
  if (!node || m.deleted) return;
  const textEl = node.querySelector('.msg-text');
  if (!textEl) return;
  const ta = el('textarea', 'edit-input');
  ta.value = m.text || '';
  ta.maxLength = 2000;
  textEl.replaceWith(ta);
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = ta.value.trim();
    if (save && v !== (m.text || '') && (v || m.image) && state.socket) {
      m.text = v;
      m.editedAt = Date.now();
      state.socket.emit('message:edit', { id: m.id, text: v }, (ack) => {
        if (ack && !ack.ok) toast('Edit failed', 'error');
      });
    }
    replaceMessageNode(m);
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  ta.addEventListener('blur', () => finish(false));
}

function startReply(m) {
  state.replyTo = m;
  renderReplyBar();
  composerInput.focus();
}
function renderReplyBar() {
  if (!state.replyTo) { replyBar.hidden = true; replyIconSlot.replaceChildren(); return; }
  replyIconSlot.replaceChildren(icon('reply', 'mini-icon'));
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
  if (state.hasMore) {
    const b = el('button', 'older-btn mono', 'LOAD OLDER');
    b.type = 'button';
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
  if (!opts.preserveScroll) {
    chatScroll.scrollTop = chatScroll.scrollHeight;
    requestAnimationFrame(() => { if (isPinned()) chatScroll.scrollTop = chatScroll.scrollHeight; });
  }
}
function renderMessageAppend(m) {
  const prev = state.messages.length > 1 ? state.messages[state.messages.length - 2] : null;
  if (dayChanged(prev, m)) messagesEl.append(el('div', 'day-div', fmtDay(m.createdAt)));
  messagesEl.append(safeMessageNode(m, { compact: isCompact(prev, m) }));
  chatEmpty.hidden = true;
  jumpBtn.classList.toggle('show', !isPinned());
}
async function loadOlderMessages() {
  const first = state.messages[0];
  const r = state.route;
  if (!first || !r || state.loadingOlder) return;
  state.loadingOlder = true;
  const base = r.type === 'channel' ? `/api/messages/channel/${r.channelId}` : `/api/messages/dm/${r.userId}`;
  try {
    const d = await api('GET', base + '?before=' + first.createdAt);
    if (state.route !== r) return;
    if (!d.messages.length) {
      state.hasMore = false;
      const btn = messagesEl.querySelector('.older-btn');
      if (btn) btn.remove();
      return;
    }
    state.hasMore = d.messages.length === HISTORY_PAGE;
    state.messages = [...d.messages, ...state.messages];
    Object.assign(state.authors, d.users);
    messagesEl.classList.add('no-anim');
    renderHistory({ instant: true, preserveScroll: true });
    requestAnimationFrame(() => messagesEl.classList.remove('no-anim'));

    const anchor = () => {
      const node = messagesEl.querySelector(`[data-id="${first.id}"]`);
      if (!node) return;
      const delta = node.getBoundingClientRect().top - chatScroll.getBoundingClientRect().top;
      chatScroll.scrollTop += delta - 8;
    };
    anchor();
    const until = Date.now() + 1500;
    $$('img.msg-image', messagesEl).forEach(img => {
      img.addEventListener('load', () => { if (Date.now() < until) anchor(); }, { once: true });
    });
  } catch (e) { toast(e.message, 'error'); }
  finally { state.loadingOlder = false; }
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
  setView('room');
  openRoom();
}
function openDm(userId) {
  state.sidebarMode = 'friends';
  state.route = { type: 'dm', userId };
  state.unread['dm:' + userId] = 0;
  state.unreadMentions['dm:' + userId] = 0;
  updateTitle();
  setView('room');
  openRoom();
}
function goHome(tab) {
  state.sidebarMode = 'friends';
  state.route = null;
  if (tab) state.homeTab = tab;
  state.typers.clear(); renderTyping();
  state.messages = [];
  state.hasMore = false;
  messagesEl.replaceChildren();
  composerInput.value = '';
  autosize();
  clearComposerExtras();
  closeDrawers();
  setView('home');
  renderAll();
}
async function openRoom() {
  const current = state.route;
  state.typers.clear(); renderTyping();
  clearComposerExtras();
  composerInput.value = '';
  autosize();
  composerBox.classList.remove('disabled');
  renderSidebar(); renderRail(); renderMembers(); renderChatChrome();
  closeDrawers();
  jumpBtn.classList.remove('show');
  messagesEl.replaceChildren();
  state.messages = [];
  state.hasMore = false;
  chatEmpty.hidden = false;
  emptyHint.textContent = 'LOADING…';
  try {
    const path = current.type === 'channel'
      ? `/api/messages/channel/${current.channelId}`
      : `/api/messages/dm/${current.userId}`;
    const d = await api('GET', path);
    if (state.route !== current) return;
    state.messages = d.messages;
    state.hasMore = d.messages.length === HISTORY_PAGE;
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
    b.type = 'button';
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
  /* friends button badge */
  let fb = railFriends.querySelector('.rail-badge');
  if (pending) {
    if (!fb) { fb = el('span', 'rail-badge mono'); railFriends.append(fb); }
    fb.textContent = pending > 9 ? '9+' : String(pending);
  } else if (fb) fb.remove();
  /* home button badge */
  let hb = railHome.querySelector('.rail-badge');
  if (pending) {
    if (!hb) { hb = el('span', 'rail-badge mono'); railHome.append(hb); }
    hb.textContent = pending > 9 ? '9+' : String(pending);
  } else if (hb) hb.remove();
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
  find.type = 'button';
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
    row.type = 'button';
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

  sidebarBody.append(el('div', 'side-label', 'CHANNELS'));
  for (const c of s.channels) {
    const active = state.route && state.route.type === 'channel' && state.route.channelId === c.id;
    const row = el('button', 'side-row side-channel' + (active ? ' is-active' : ''));
    row.type = 'button';
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
    addCh.type = 'button';
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

  if (!s.official) {
    const leave = el('button', 'link-danger mono', 'LEAVE SERVER');
    leave.type = 'button';
    leave.addEventListener('click', () => confirmLeaveServer(s));
    sidebarBody.append(leave);
  }
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
    (state.homeTab === 'online' ? 'ONLINE — ' : 'ALL FRIENDS — ') + list.length));
  const sorted = [...list].sort((a, b) =>
    (b.online - a.online) || a.displayName.localeCompare(b.displayName));
  for (const u of sorted) homeBody.append(friendRow(u, 'friend'));
}

function friendRow(u, kind) {
  const row = el('div', 'friend-row');
  row.append(avatarEl(u, { size: 38, showPresence: true, online: u.online }));
  row.append(personMain(u));
  const acts = el('div', 'friend-actions');
  if (kind === 'friend') {
    const msg = iconBtn('message', '', 'Message');
    msg.addEventListener('click', (e) => { e.stopPropagation(); openDm(u.id); });
    const rem = iconBtn('trash', 'icon-btn-danger', 'Remove friend');
    rem.addEventListener('click', (e) => { e.stopPropagation(); confirmRemoveFriend(u); });
    acts.append(msg, rem);
  } else if (kind === 'incoming') {
    const ok = iconBtn('check', '', 'Accept');
    ok.addEventListener('click', (e) => { e.stopPropagation(); friendAction(u, 'accept'); });
    const no = iconBtn('x', 'icon-btn-danger', 'Decline');
    no.addEventListener('click', (e) => { e.stopPropagation(); friendAction(u, 'decline'); });
    acts.append(ok, no);
  } else {
    const no = iconBtn('x', 'icon-btn-danger', 'Cancel request');
    no.addEventListener('click', (e) => { e.stopPropagation(); friendAction(u, 'cancel'); });
    acts.append(no);
  }
  row.append(acts);
  if (kind === 'friend') row.addEventListener('click', () => openDm(u.id));
  return row;
}

function renderAddFriend() {
  const wrap = el('div', 'add-friend');
  const box = el('div', 'add-friend-box');
  box.append(icon('search'));
  const input = el('input', 'add-friend-input');
  input.placeholder = 'Search people by username or display name';
  input.spellcheck = false;
  input.value = state.addFriendQ;
  box.append(input);
  const status = el('p', 'add-friend-status mono', '');
  const results = el('div', 'add-friend-results');
  wrap.append(box, status, results);
  homeBody.append(wrap);

  let deb = null;
  const searchUsers = async () => {
    const q = state.addFriendQ.trim();
    if (q.length < 2) { state.addFriendResults = null; status.textContent = ''; results.replaceChildren(); return; }
    status.textContent = 'SEARCHING…';
    try {
      const d = await api('GET', '/api/users/search?q=' + encodeURIComponent(q));
      state.addFriendResults = d.results;
      renderAddFriendResults(results, status, q);
    } catch (e) { status.textContent = e.message.toUpperCase(); }
  };
  input.addEventListener('input', () => {
    state.addFriendQ = input.value;
    clearTimeout(deb);
    deb = setTimeout(searchUsers, 300);
  });
  if (state.addFriendResults) renderAddFriendResults(results, status, state.addFriendQ);
  else if (state.addFriendQ.trim().length >= 2) searchUsers();
  else status.textContent = 'SEARCH BY USERNAME OR NAME — 2+ CHARACTERS';
  setTimeout(() => { if (!homeBody.contains(document.activeElement)) input.focus(); }, 40);
}
function renderAddFriendResults(results, status, q) {
  results.replaceChildren();
  const list = state.addFriendResults;
  if (!list) return;
  status.textContent = list.length
    ? `${list.length} RESULT${list.length === 1 ? '' : 'S'}`
    : 'NO MATCHES FOR “' + String(q).toUpperCase() + '”';
  for (const u of list) results.append(personRow(u));
}
function personRow(u) {
  const row = el('div', 'person-row');
  row.append(avatarEl(u, { size: 34, showPresence: true, online: u.online }));
  row.append(personMain(u));
  const rel = u.state || friendRelation(u.id);
  if (rel === 'friend') {
    row.append(el('span', 'state-tag tag-accent mono', 'FRIENDS'));
  } else if (rel === 'outgoing') {
    row.append(el('span', 'state-tag mono', 'PENDING'));
  } else {
    const b = el('button', 'btn btn-sm ' + (rel === 'incoming' ? 'btn-accent' : 'btn-ghost'),
      rel === 'incoming' ? 'Accept' : 'Add');
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      friendAction(u, rel === 'incoming' ? 'accept' : 'request');
    });
    row.append(b);
  }
  row.addEventListener('click', () => openProfileModal(u));
  return row;
}

/* ---------- friends actions ---------- */
function friendRelation(id) {
  const f = state.friends;
  if (f.friends.some(u => u.id === id)) return 'friend';
  if (f.incoming.some(u => u.id === id)) return 'incoming';
  if (f.outgoing.some(u => u.id === id)) return 'outgoing';
  return 'none';
}
const FRIEND_MSG = {
  request: u => `Friend request sent to ${u.displayName}`,
  accept:  u => `You and ${u.displayName} are now friends`,
  decline: () => 'Request declined',
  cancel:  () => 'Request cancelled',
  remove:  u => `${u.displayName} was removed from your friends`
};
async function friendAction(u, action) {
  try {
    await api('POST', '/api/friends/' + action, { userId: u.id });
    state.addFriendResults = null;
    await loadFriends();
    toast((FRIEND_MSG[action] || (() => 'Done'))(u), 'success');
    renderRail(); renderChatChrome();
    if (!state.route) renderHome();
  } catch (e) { toast(e.message, 'error'); }
}
function confirmRemoveFriend(p) {
  openModal({
    title: 'Remove friend',
    body: `This removes ${p.displayName} from your friends. You can add each other again later.`,
    actions: [
      { label: 'Cancel' },
      { label: 'Remove', cls: 'btn-danger', onClick: () => friendAction(p, 'remove') }
    ]
  });
}

/* =====================================================================
   CHAT CHROME + MEMBERS PANEL
===================================================================== */
function renderChatChrome() {
  if (!state.me) return;
  const r = state.route;
  chatTitle.replaceChildren();
  membersToggle.replaceChildren(icon('users'));

  if (!r) {
    chatTitle.append(icon('users', 'title-hash'), el('span', '', 'Friends'));
    const online = state.friends.friends.filter(x => x.online).length;
    chatMeta.textContent = `${state.friends.friends.length} FRIENDS · ${online} ONLINE`;
    renderHomeTabs();
    composerInput.placeholder = 'Message…';
    membersToggle.title = 'Active now';
    return;
  }
  if (r.type === 'channel') {
    const s = state.servers.find(x => x.id === r.serverId);
    const ch = s && s.channels.find(c => c.id === r.channelId);
    chatTitle.append(icon('hash', 'title-hash'), el('span', '', (ch && ch.name) || 'channel'));
    chatMeta.textContent = s ? `${s.name.toUpperCase()} · ${s.members.length} MEMBERS` : '';
    composerInput.placeholder = ch ? `Message #${ch.name}` : 'Message…';
    membersToggle.title = 'Toggle members';
    return;
  }
  const p = getPeer(r.userId);
  if (p) {
    const online = state.online.has(p.id);
    chatTitle.append(avatarEl(p, { size: 22, showPresence: true, online }), el('span', '', p.displayName));
    chatMeta.textContent = '@' + p.username.toUpperCase() + ' · ' + (online ? 'ONLINE' : 'OFFLINE');
    composerInput.placeholder = 'Message @' + p.username;
  }
  membersToggle.title = 'Toggle profile';
}

function renderMembers() {
  if (!state.me) return;
  const r = state.route;
  membersBody.replaceChildren();

  if (!r) {
    membersHead.textContent = 'ACTIVE NOW';
    const online = state.friends.friends.filter(f => f.online);
    if (!online.length) {
      const c = el('div', 'quiet-card');
      c.append(el('p', 'quiet-title', 'All quiet'));
      c.append(el('p', 'quiet-sub', 'Friends will show up here when they come online.'));
      membersBody.append(c);
      return;
    }
    membersBody.append(el('div', 'side-label', 'ONLINE — ' + online.length));
    for (const u of online) {
      const row = el('button', 'active-row');
      row.type = 'button';
      row.append(avatarEl(u, { size: 30, showPresence: true, online: true }));
      row.append(el('span', 'member-name', u.displayName));
      row.addEventListener('click', () => openDm(u.id));
      membersBody.append(row);
    }
    return;
  }

  if (r.type === 'dm') {
    membersHead.textContent = 'PROFILE';
    const p = getPeer(r.userId);
    if (!p) return;
    const card = el('div', 'peer-card');
    card.append(avatarEl(p, { size: 76, showPresence: true, online: state.online.has(p.id) }));
    card.append(el('div', 'peer-name', p.displayName));
    card.append(el('div', 'peer-user mono', '@' + p.username));
    if (p.bio) card.append(el('p', 'peer-bio', p.bio));
    card.append(el('div', 'peer-status mono', state.online.has(p.id) ? 'ONLINE' : 'OFFLINE'));
    const btn = el('button', 'btn btn-danger btn-sm', 'Remove friend');
    btn.type = 'button';
    btn.addEventListener('click', () => confirmRemoveFriend(p));
    card.append(btn);
    membersBody.append(card);
    return;
  }

  const s = state.servers.find(x => x.id === r.serverId);
  if (!s) return;
  membersHead.textContent = `MEMBERS — ${s.members.length}`;
  const online = s.members.filter(m => state.online.has(m.id) || m.online);
  const offline = s.members.filter(m => !(state.online.has(m.id) || m.online));
  const rowFor = (m) => {
    const row = el('button', 'member-row' + (!(state.online.has(m.id) || m.online) ? ' off' : ''));
    row.type = 'button';
    row.append(avatarEl(m, { size: 30, showPresence: true, online: state.online.has(m.id) || m.online }));
    row.append(el('span', 'member-name', m.displayName));
    if (s.ownerId === m.id) row.append(el('span', 'member-tag mono', 'OWNER'));
    row.addEventListener('click', () => openProfileModal(m));
    return row;
  };
  if (online.length) {
    membersBody.append(el('div', 'side-label', 'ONLINE — ' + online.length));
    online.forEach(m => membersBody.append(rowFor(m)));
  }
  if (offline.length) {
    membersBody.append(el('div', 'side-label', 'OFFLINE — ' + offline.length));
    offline.forEach(m => membersBody.append(rowFor(m)));
  }
}

function openProfileModal(u) {
  const body = el('div', 'peer-card');
  body.append(avatarEl(u, { size: 72, showPresence: true, online: state.online.has(u.id) }));
  body.append(el('div', 'peer-name', u.displayName));
  body.append(el('div', 'peer-user mono', '@' + u.username));
  if (u.bio) body.append(el('p', 'peer-bio', u.bio));
  body.append(el('div', 'peer-status mono', state.online.has(u.id) ? 'ONLINE' : 'OFFLINE'));
  const rel = friendRelation(u.id);
  const actions = [];
  if (rel === 'friend') actions.push({ label: 'Message', cls: 'btn-accent', onClick: () => { openDm(u.id); } });
  else if (rel === 'none') actions.push({ label: 'Add friend', cls: 'btn-accent', onClick: () => friendAction(u, 'request') });
  else if (rel === 'incoming') actions.push({ label: 'Accept request', cls: 'btn-accent', onClick: () => friendAction(u, 'accept') });
  openModal({ title: 'Profile', body, actions });
}

/* =====================================================================
   COMPOSER — typing, mentions, sending, images
===================================================================== */
function autosize() { autosizeEl(composerInput); }
function autosizeEl(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
}

let typingSentAt = 0, typingStopTimer = null;
function queueTyping() {
  if (!state.route || !state.socket) return;
  if (Date.now() - typingSentAt > 2000) {
    typingSentAt = Date.now();
    emitTyping(true);
  }
  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(() => { typingSentAt = 0; emitTyping(false); }, 1600);
}
function emitTyping(isTyping) {
  const r = state.route;
  if (!r || !state.socket) return;
  state.socket.emit('typing', {
    roomType: r.type,
    target: r.type === 'channel' ? r.channelId : r.userId,
    isTyping: !!isTyping
  });
}

let lastSendAt = 0;
function sendMessage() {
  const r = state.route;
  if (!r || !state.socket) return;
  const text = composerInput.value.trim();
  const image = state.pendingImage;
  if (!text && !image) return;
  if (Date.now() - lastSendAt < 150) return;
  const reply = state.replyTo;
  lastSendAt = Date.now();

  state.socket.emit('message:send', {
    roomType: r.type,
    target: r.type === 'channel' ? r.channelId : r.userId,
    text,
    image: image || null,
    replyTo: reply ? reply.id : null
  }, (ack) => {
    if (!ack || !ack.ok) {
      /* put the message back so the user never loses their text */
      composerInput.value = text;
      autosize();
      if (image) { state.pendingImage = image; renderPendingImage(); }
      if (reply) { state.replyTo = reply; renderReplyBar(); }
      if (!ack || ack.reason !== 'rate') toast('Message didn’t send — try again', 'error');
    }
  });

  composerInput.value = '';
  autosize();
  clearComposerExtras();
  clearTimeout(typingStopTimer);
  typingSentAt = 0;
  emitTyping(false);
}

/* ---------- @mention popup ---------- */
function mentionCandidates() {
  const r = state.route;
  if (!r || !state.me) return [];
  if (r.type === 'channel') {
    const s = state.servers.find(x => x.id === r.serverId);
    return (s ? s.members : []).filter(u => u.id !== state.me.id);
  }
  const p = getPeer(r.userId);
  return p ? [p] : [];
}
function updateMentionPop() {
  if (!state.route) { hideMentionPop(); return; }
  const pos = composerInput.selectionStart ?? composerInput.value.length;
  const upto = composerInput.value.slice(0, pos);
  const m = upto.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
  if (!m) { hideMentionPop(); return; }
  const prefix = m[2].toLowerCase();
  const cands = mentionCandidates().filter(u =>
    u.username.toLowerCase().startsWith(prefix) ||
    (u.displayName || '').toLowerCase().startsWith(prefix)
  ).slice(0, 6);
  if (!cands.length) { hideMentionPop(); return; }
  state.mentionUsers = cands;
  state.mentionIndex = 0;
  mentionPop.replaceChildren(...cands.map((u, i) => {
    const row = el('button', 'mention-item' + (i === 0 ? ' is-active' : ''));
    row.type = 'button';
    row.append(avatarEl(u, { size: 24 }));
    row.append(el('span', 'row-label mono', '@' + u.username));
    row.append(el('span', 'm-hint', u.displayName));
    row.addEventListener('click', () => selectMention(u));
    return row;
  }));
  mentionPop.hidden = false;
}
function hideMentionPop() {
  mentionPop.hidden = true;
  state.mentionUsers = [];
}
function moveMention(dir) {
  const n = state.mentionUsers.length;
  if (!n) return;
  state.mentionIndex = (state.mentionIndex + dir + n) % n;
  $$('.mention-item', mentionPop).forEach((b, i) => b.classList.toggle('is-active', i === state.mentionIndex));
}
function selectMention(u) {
  const ta = composerInput;
  const pos = ta.selectionStart ?? ta.value.length;
  const before = ta.value.slice(0, pos);
  const m = before.match(/@([a-zA-Z0-9_]*)$/);
  if (m) {
    const start = pos - m[1].length - 1;
    ta.value = ta.value.slice(0, start) + '@' + u.username + ' ' + ta.value.slice(pos);
    const np = start + u.username.length + 2;
    ta.setSelectionRange(np, np);
  }
  hideMentionPop();
  ta.focus();
}

function composerKeydown(e) {
  if (!mentionPop.hidden && state.mentionUsers.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveMention(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      selectMention(state.mentionUsers[state.mentionIndex]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideMentionPop();
      return;
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
    return;
  }
  if (e.key === 'Escape' && state.replyTo) {
    e.preventDefault();
    state.replyTo = null;
    renderReplyBar();
    return;
  }
  if (e.key === 'ArrowUp' && composerInput.value === '' && state.route && state.me) {
    const mine = [...state.messages].reverse().find(m => m.authorId === state.me.id && !m.deleted);
    if (mine) { e.preventDefault(); startEdit(mine); }
  }
}

/* ---------- image attach (client-side compression) ---------- */
function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, (maxDim / Math.max(img.width, img.height)) || 1);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        let out = cv.toDataURL('image/webp', quality);
        if (!out.startsWith('data:image/webp')) {
          const cv2 = document.createElement('canvas');
          cv2.width = w; cv2.height = h;
          const c2 = cv2.getContext('2d');
          c2.fillStyle = '#ffffff';
          c2.fillRect(0, 0, w, h);
          c2.drawImage(img, 0, 0, w, h);
          out = cv2.toDataURL('image/jpeg', quality);
        }
        URL.revokeObjectURL(url);
        resolve(out);
      } catch (err) { URL.revokeObjectURL(url); reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Couldn’t decode that image')); };
    img.src = url;
  });
}
async function handleImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('That file isn’t an image', 'error'); return; }
  try {
    let src;
    /* keep small GIFs animated — everything else gets compressed */
    if (file.type === 'image/gif' && file.size < 500 * 1024) {
      src = await readAsDataURL(file);
    } else {
      src = await compressImage(file, 1280, 0.82);
      if (src.length > 560000) src = await compressImage(file, 1000, 0.6);
    }
    if (src.length > 590000) { toast('Image too large even after compression', 'error'); return; }
    state.pendingImage = src;
    renderPendingImage();
  } catch { toast('Couldn’t read that image', 'error'); }
  finally { imageFile.value = ''; }
}
function insertAtCaret(ta, str) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.setRangeText(str, s, e, 'end');
}

/* =====================================================================
   EMOJI POPOVER (reactions + composer)
===================================================================== */
let emojiPopEl = null, emojiPopDown = null;
function closeEmojiPop() {
  if (emojiPopEl) { emojiPopEl.remove(); emojiPopEl = null; }
  if (emojiPopDown) { document.removeEventListener('mousedown', emojiPopDown); emojiPopDown = null; }
}
function openEmojiPop(anchor, onPick) {
  closeEmojiPop();
  const pop = el('div', 'emoji-pop');
  for (const em of EMOJIS) {
    const b = el('button', 'emoji-cell', em);
    b.type = 'button';
    b.addEventListener('click', () => { closeEmojiPop(); onPick(em); });
    pop.append(b);
  }
  document.body.append(pop);
  emojiPopEl = pop;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const x = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let y = r.top - h - 8;
  if (y < 8) y = Math.min(r.bottom + 8, window.innerHeight - h - 8);
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  emojiPopDown = (ev) => { if (emojiPopEl && !emojiPopEl.contains(ev.target)) closeEmojiPop(); };
  setTimeout(() => document.addEventListener('mousedown', emojiPopDown), 0);
}

/* =====================================================================
   LIGHTBOX / KLIPY GIF+STICKER PICKER / QUICK SWITCHER
===================================================================== */
function openLightbox(src) {
  const img = el('img', 'lightbox-img');
  img.src = src; img.alt = 'image';
  openModal({ title: 'Image', body: img, actions: [{ label: 'Close' }] });
}

function openGifModal() {
  const wrap = el('div', 'gif-wrap');

  const seg = el('div', 'seg gif-tabs');
  const gifTab = el('button', 'seg-btn is-active', 'GIFs');
  const stickerTab = el('button', 'seg-btn', 'Stickers');
  gifTab.type = 'button'; stickerTab.type = 'button';
  seg.append(gifTab, stickerTab);

  const search = el('input', 'gif-search');
  search.placeholder = 'Search KLIPY…';      /* required attribution */
  search.spellcheck = false;
  const status = el('p', 'gif-status mono', 'LOADING…');
  const grid = el('div', 'gif-grid');
  const credit = el('p', 'gif-credit mono', 'POWERED BY KLIPY');
  wrap.append(seg, search, status, grid, credit);

  const { close } = openModal({ title: 'Pick a GIF', body: wrap, actions: [{ label: 'Cancel' }] });

  let kind = 'gifs';
  let deb = null, seq = 0;

  async function load(q) {
    const my = ++seq;
    status.textContent = 'LOADING…';
    grid.replaceChildren();
    try {
      const locale = ((navigator.language || 'en').split('-')[1] || 'us').toLowerCase();
      const d = await api('GET', '/api/gifs/search?kind=' + kind +
        '&locale=' + encodeURIComponent(locale) + '&q=' + encodeURIComponent(q));
      if (my !== seq) return;
      if (!d.configured) { status.textContent = 'GIFS ARE NOT CONFIGURED ON THIS SERVER'; return; }
      status.textContent = d.gifs.length ? '' : 'NO RESULTS';
      for (const g of d.gifs) {
        const b = el('button', 'gif-item');
        b.type = 'button';
        b.title = g.title || '';
        const img = el('img');
        img.src = g.preview || g.url;
        img.alt = g.title || 'gif';
        img.loading = 'lazy';
        b.append(img);
        b.addEventListener('click', () => {
          state.pendingImage = g.url;
          renderPendingImage();
          close();
          toast((kind === 'stickers' ? 'Sticker' : 'GIF') + ' attached — sends with your next message');
          if (g.slug) api('POST', '/api/gifs/share', { slug: g.slug, q, kind }).catch(() => {});
        });
        grid.append(b);
      }
    } catch (e) {
      if (my === seq) status.textContent = e.message.toUpperCase();
    }
  }

  const setKind = (k) => {
    kind = k;
    gifTab.classList.toggle('is-active', k === 'gifs');
    stickerTab.classList.toggle('is-active', k === 'stickers');
    load(search.value.trim());
  };
  gifTab.addEventListener('click', () => setKind('gifs'));
  stickerTab.addEventListener('click', () => setKind('stickers'));
  search.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => load(search.value.trim()), 400);
  });
  load('');
  setTimeout(() => search.focus(), 60);
}

function openQuickSwitcher() {
  const items = [{ label: 'Home', hint: 'Friends', run: () => goHome() }];
  for (const s of state.servers) {
    for (const c of s.channels) items.push({ label: '# ' + c.name, hint: s.name, run: () => openChannel(s.id, c.id) });
  }
  for (const f of state.friends.friends) items.push({ label: f.displayName, hint: '@' + f.username, run: () => openDm(f.id) });

  const input = el('input', 'gif-search');
  input.placeholder = 'Jump to… channels, servers, people';
  input.spellcheck = false;
  const list = el('div', 'switch-list');
  const body = el('div');
  body.append(input, list);
  const { close } = openModal({ title: 'Quick switcher', body, actions: [{ label: 'Close' }] });

  let idx = 0, shown = items;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = items.filter(it =>
      !q || it.label.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q)).slice(0, 20);
    idx = Math.min(idx, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((it, i) => {
      const b = el('button', 'switch-row' + (i === idx ? ' is-active' : ''));
      b.type = 'button';
      b.append(el('span', '', it.label));
      b.append(el('span', 'hint mono', it.hint));
      b.addEventListener('click', () => { close(); it.run(); });
      return b;
    }));
    if (!shown.length) list.append(el('p', 'gif-status mono', 'NO MATCHES'));
  };
  input.addEventListener('input', () => { idx = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, shown.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = shown[idx]; if (it) { close(); it.run(); } }
  });
  render();
  setTimeout(() => input.focus(), 60);
}

/* =====================================================================
   SERVER / CHANNEL MODALS
===================================================================== */
function openServerModal() {
  const body = el('div');
  const nameF = el('label', 'field');
  nameF.append(el('span', 'field-label mono', 'SERVER NAME'));
  const nameIn = el('input');
  nameIn.maxLength = 40; nameIn.spellcheck = false;
  nameF.append(nameIn);
  const createBtn = el('button', 'btn btn-accent btn-block', 'Create server');
  createBtn.type = 'button';
  body.append(nameF, createBtn);

  body.append(el('div', 'modal-divider', 'OR JOIN WITH AN INVITE CODE'));
  const codeF = el('label', 'field');
  codeF.append(el('span', 'field-label mono', 'INVITE CODE'));
  const codeIn = el('input');
  codeIn.spellcheck = false;
  codeIn.placeholder = 'e.g. SLATE1';
  codeIn.style.textTransform = 'uppercase';
  codeF.append(codeIn);
  const joinBtn = el('button', 'btn btn-ghost btn-block', 'Join server');
  joinBtn.type = 'button';
  body.append(codeF, joinBtn);

  const { close } = openModal({ title: 'Add a server', body, actions: [{ label: 'Close' }] });
  setTimeout(() => nameIn.focus(), 60);

  modalAction(createBtn, async () => {
    const name = nameIn.value.trim();
    if (name.length < 2) throw new Error('Server name needs at least 2 characters');
    const d = await api('POST', '/api/servers', { name });
    await loadServers();
    close();
    if (d.server && d.server.channels.length) openChannel(d.server.id, d.server.channels[0].id);
    toast(`Server “${d.server.name}” created`, 'success');
  });
  modalAction(joinBtn, async () => {
    const code = codeIn.value.trim().toUpperCase();
    if (!code) throw new Error('Enter an invite code');
    const d = await api('POST', '/api/servers/join', { inviteCode: code });
    await loadServers();
    close();
    if (d.server && d.server.channels.length) openChannel(d.server.id, d.server.channels[0].id);
    toast(`You joined ${d.server.name}`, 'success');
  });
}

function openNewChannelModal() {
  const r = state.route;
  const serverId = (r && r.type === 'channel') ? r.serverId : state.sidebarMode;
  const s = state.servers.find(x => x.id === serverId);
  if (!s) return;
  const body = el('div');
  const f = el('label', 'field');
  f.append(el('span', 'field-label mono', 'CHANNEL NAME'));
  const inp = el('input');
  inp.spellcheck = false;
  inp.placeholder = 'e.g. design';
  f.append(inp);
  f.append(el('span', 'field-hint mono', '1–24 chars — letters, numbers, - and _'));
  const btn = el('button', 'btn btn-accent btn-block', 'Create channel');
  btn.type = 'button';
  body.append(f, btn);
  const { close } = openModal({ title: 'New channel · ' + s.name, body, actions: [{ label: 'Cancel' }] });
  setTimeout(() => inp.focus(), 60);
  modalAction(btn, async () => {
    const name = inp.value.trim().toLowerCase().replace(/\s+/g, '-');
    const d = await api('POST', `/api/servers/${s.id}/channels`, { name });
    await loadServers();
    close();
    openChannel(s.id, d.channel.id);
    toast(`#${d.channel.name} created`, 'success');
  });
}

function openServerSettingsModal(server) {
  let iconData; /* undefined = unchanged, null = removed, string = new */
  const body = el('div');

  const nameF = el('label', 'field');
  nameF.append(el('span', 'field-label mono', 'SERVER NAME'));
  const nameIn = el('input');
  nameIn.value = server.name; nameIn.maxLength = 40; nameIn.spellcheck = false;
  nameF.append(nameIn);
  body.append(nameF);

  body.append(el('p', 'field-label mono', 'ICON'));
  const iconRow = el('div', 'avatar-row');
  const preview = el('span', 'server-icon');
  const renderPreview = () => {
    preview.replaceChildren();
    const src = iconData !== undefined ? iconData : server.icon;
    if (src) {
      const img = el('img'); img.src = src; img.alt = '';
      preview.append(img);
    } else preview.append(el('span', '', serverInitials(server.name)));
  };
  renderPreview();
  const upload = el('label', 'btn btn-ghost btn-sm');
  upload.append(el('span', '', 'Upload icon'));
  const fileIn = el('input');
  fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.hidden = true;
  upload.append(fileIn);
  const rmBtn = el('button', 'btn btn-ghost btn-sm', 'Remove');
  rmBtn.type = 'button';
  rmBtn.addEventListener('click', () => { iconData = null; renderPreview(); });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    if (!file) return;
    try {
      const data = await compressImage(file, 128, 0.8);
      if (data.length > 390000) { toast('Icon too large — try a smaller image', 'error'); }
      else { iconData = data; renderPreview(); }
    } catch { toast('Couldn’t read that image', 'error'); }
    fileIn.value = '';
  });
  iconRow.append(preview, upload, rmBtn);
  body.append(iconRow);

  const saveBtn = el('button', 'btn btn-accent btn-block', 'Save changes');
  saveBtn.type = 'button';
  body.append(saveBtn);

  body.append(el('div', 'modal-divider', `CHANNELS — ${server.channels.length}`));
  for (const c of server.channels) {
    const row = el('div', 'channel-manage-row');
    row.append(icon('hash', 'row-icon'));
    row.append(el('span', 'row-label', c.name));
    const del = iconBtn('trash', 'icon-btn-danger', 'Delete channel');
    del.addEventListener('click', () => confirmDeleteChannel(server, c));
    row.append(del);
    body.append(row);
  }

  body.append(el('div', 'modal-divider', 'INVITE'));
  const inv = el('div', 'invite-row mono');
  inv.append(el('span', 'invite-label', 'CODE'));
  inv.append(el('span', 'invite-code', server.inviteCode));
  const copyBtn = iconBtn('copy', '', 'Copy invite code');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(server.inviteCode); toast('Invite code copied', 'success'); }
    catch { toast('Copy failed — code is ' + server.inviteCode, 'error'); }
  });
  inv.append(copyBtn);
  body.append(inv);

  const { close } = openModal({ title: 'Server settings', body, actions: [{ label: 'Close' }] });
  modalAction(saveBtn, async () => {
    const payload = {};
    const name = nameIn.value.trim();
    if (name !== server.name) payload.name = name;
    if (iconData !== undefined) payload.icon = iconData;
    if (!Object.keys(payload).length) { close(); return; }
    await api('PATCH', `/api/servers/${server.id}`, payload);
    await loadServers();
    close();
    toast('Server saved', 'success');
    requestRender();
  });
}

function confirmDeleteChannel(server, channel) {
  openModal({
    title: 'Delete #' + channel.name,
    body: 'The channel and all its messages will be deleted for everyone. This can’t be undone.',
    actions: [
      { label: 'Cancel' },
      { label: 'Delete', cls: 'btn-danger', onClick: async () => {
        await api('DELETE', `/api/servers/${server.id}/channels/${channel.id}`);
        await loadServers();
        const r = state.route;
        if (r && r.type === 'channel' && r.channelId === channel.id) {
          const s = state.servers.find(x => x.id === server.id);
          if (s && s.channels.length) openChannel(s.id, s.channels[0].id);
          else goHome();
        }
        toast(`#${channel.name} deleted`, 'success');
      } }
    ]
  });
}
function confirmLeaveServer(s) {
  openModal({
    title: 'Leave ' + s.name,
    body: 'You’ll stop receiving messages from this server. You can rejoin later with the invite code.',
    actions: [
      { label: 'Cancel' },
      { label: 'Leave server', cls: 'btn-danger', onClick: async () => {
        await api('DELETE', `/api/servers/${s.id}/leave`);
        await loadServers();
        goHome();
        toast(`You left ${s.name}`);
      } }
    ]
  });
}
function confirmLogout() {
  openModal({
    title: 'Log out',
    body: 'You’ll be signed out of slate on this device.',
    actions: [
      { label: 'Cancel' },
      { label: 'Log out', cls: 'btn-danger', onClick: () => { doLogout(); } }
    ]
  });
}

/* =====================================================================
   SETTINGS PANEL
===================================================================== */
function openSettings() {
  if (!state.me) return;
  usernameInput.value = state.me.username;
  displayNameInput.value = state.me.displayName || '';
  bioInput.value = state.me.bio || '';
  bioCount.textContent = String(bioInput.value.length);
  renderSettingsAvatar();
  accountFacts.replaceChildren(...[
    ['USERNAME', state.me.username],
    ['EMAIL', state.me.email],
    ['JOINED', new Date(state.me.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })],
    ['USER ID', state.me.id]
  ].map(([k, v]) => {
    const row = el('div', 'fact-row');
    row.append(el('dt', '', k), el('dd', '', v));
    return row;
  }));
  settingsApi.textContent = API_BASE;
  settingsPanel.classList.add('open');
  scrimSettings.classList.add('show');
}
function closeSettings() {
  settingsPanel.classList.remove('open');
  scrimSettings.classList.remove('show');
}
function renderSettingsAvatar() {
  settingsAvatar.replaceChildren(avatarEl(state.me, { size: 64 }));
}
async function saveProfile() {
  const displayName = displayNameInput.value.trim();
  if (!displayName) { toast('Display name cannot be empty', 'error'); return; }
  profileSave.disabled = true;
  try {
    const d = await api('PATCH', '/api/me', {
      username: usernameInput.value.trim(),
      displayName,
      bio: bioInput.value.trim()
    });
    state.me = d.user;
    state.authors[d.user.id] = { ...d.user };
    renderSettingsAvatar();
    requestRender();
    toast('Profile saved', 'success');
  } catch (e) { toast(e.message, 'error'); }
  profileSave.disabled = false;
}
async function handleAvatarFile(file) {
  if (!file) return;
  try {
    const data = await compressImage(file, 256, 0.85);
    if (data.length > 390000) { toast('Picture too large — try a smaller image', 'error'); return; }
    const d = await api('PATCH', '/api/me', { avatar: data });
    state.me = d.user;
    state.authors[d.user.id] = { ...d.user };
    renderSettingsAvatar();
    requestRender();
    toast('Picture updated', 'success');
  } catch (e) { toast(e.message, 'error'); }
  avatarFile.value = '';
}
async function removeAvatar() {
  try {
    const d = await api('PATCH', '/api/me', { avatar: null });
    state.me = d.user;
    state.authors[d.user.id] = { ...d.user };
    renderSettingsAvatar();
    requestRender();
  } catch (e) { toast(e.message, 'error'); }
}

/* =====================================================================
   APP WIRING
===================================================================== */
function wireApp() {
  /* static icons */
  railHome.append(icon('home'));
  railFriends.append(icon('users'));
  railAdd.append(icon('plus'));
  menuBtn.append(icon('menu'));
  sendBtn.append(icon('send'));
  attachBtn.append(icon('image'));
  emojiBtn.append(icon('smile'));
  replyCancel.append(icon('x'));
  pendingImageRemove.append(icon('x'));
  settingsClose.append(icon('x'));
  jumpBtn.append(icon('arrow-down'));
  membersToggle.append(icon('users'));

  railHome.addEventListener('click', () => goHome());
  railFriends.addEventListener('click', () => goHome('online'));
  railAdd.addEventListener('click', openServerModal);
  railTheme.addEventListener('click', () =>
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  railAvatar.addEventListener('click', openSettings);

  /* mobile drawers */
  menuBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) closeDrawers();
    else { sidebar.classList.add('open'); scrimSidebar.classList.add('show'); }
  });
  scrimSidebar.addEventListener('click', closeDrawers);
  scrimMembers.addEventListener('click', closeDrawers);
  membersToggle.addEventListener('click', () => {
    if (window.innerWidth <= 1080) {
      const open = membersPanel.classList.toggle('open');
      scrimMembers.classList.toggle('show', open);
    } else {
      const on = appView.classList.toggle('members-on');
      localStorage.setItem(LS.members, on ? 'on' : 'off');
    }
  });

  homeTabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-home-tab]');
    if (!b) return;
    state.homeTab = b.dataset.homeTab;
    renderHome();
  });
  emptyCtaFriends.addEventListener('click', () => goHome('add'));
  emptyCtaServer.addEventListener('click', openServerModal);

  /* composer */
  composerInput.addEventListener('input', () => { autosize(); updateMentionPop(); queueTyping(); });
  composerInput.addEventListener('keydown', composerKeydown);
  composerInput.addEventListener('blur', () => setTimeout(() => {
    if (!mentionPop.contains(document.activeElement)) hideMentionPop();
  }, 120));
  sendBtn.addEventListener('click', sendMessage);
  attachBtn.addEventListener('click', () => imageFile.click());
  imageFile.addEventListener('change', () => handleImageFile(imageFile.files[0]));
  pendingImageRemove.addEventListener('click', () => { state.pendingImage = null; renderPendingImage(); });
  replyCancel.addEventListener('click', () => { state.replyTo = null; renderReplyBar(); });
  gifBtn.addEventListener('click', openGifModal);
  emojiBtn.addEventListener('click', () => openEmojiPop(emojiBtn, (em) => {
    insertAtCaret(composerInput, em);
    autosize();
    composerInput.focus();
    queueTyping();
  }));

  /* scroll */
  jumpBtn.addEventListener('click', () => {
    chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'smooth' });
  });
  chatScroll.addEventListener('scroll', () => {
    jumpBtn.classList.toggle('show', !isPinned() && state.messages.length > 0);
    if (emojiPopEl) closeEmojiPop();
  });

  /* settings */
  settingsClose.addEventListener('click', closeSettings);
  scrimSettings.addEventListener('click', closeSettings);
  profileSave.addEventListener('click', saveProfile);
  avatarFile.addEventListener('change', () => handleAvatarFile(avatarFile.files[0]));
  avatarRemove.addEventListener('click', removeAvatar);
  bioInput.addEventListener('input', () => { bioCount.textContent = String(bioInput.value.length); });
  logoutBtn.addEventListener('click', confirmLogout);
  $('#themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (b) setTheme(b.dataset.themeSet);
  });

  document.addEventListener('keydown', globalKeydown);

  /* ---- drag & drop image attach ---- */
  let dragDepth = 0;
  chatSection.addEventListener('dragenter', (e) => {
    if (!state.route) return;
    e.preventDefault();
    dragDepth++;
    chatSection.classList.add('dragging');
  });
  chatSection.addEventListener('dragover', (e) => { if (state.route) e.preventDefault(); });
  chatSection.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) chatSection.classList.remove('dragging');
  });
  chatSection.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    chatSection.classList.remove('dragging');
    if (!state.route) return;
    const file = [...((e.dataTransfer && e.dataTransfer.files) || [])][0];
    if (file) handleImageFile(file);
  });

  /* ---- paste an image straight into the chat ---- */
  document.addEventListener('paste', (e) => {
    if (!state.route || !state.me) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae !== composerInput) return;
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      handleImageFile(item.getAsFile());
    }
  });

  /* ---- start typing anywhere → jump into the composer ---- */
  document.addEventListener('keydown', (e) => {
    if (!state.me || appView.hidden || !state.route) return;
    if ($('#modalRoot').childElementCount) return;
    if (settingsPanel.classList.contains('open')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    composerInput.focus();
  });
}

function globalKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (state.me && !appView.hidden) { e.preventDefault(); openQuickSwitcher(); }
    return;
  }
  if (e.key !== 'Escape') return;
  if ($('#modalRoot').childElementCount) return;   /* modals close themselves */
  if (emojiPopEl) { closeEmojiPop(); return; }
  if (!mentionPop.hidden) { hideMentionPop(); return; }
  if (state.replyTo) { state.replyTo = null; renderReplyBar(); return; }
  if (settingsPanel.classList.contains('open')) { closeSettings(); return; }
  if (sidebar.classList.contains('open') || membersPanel.classList.contains('open')) closeDrawers();
}

/* =====================================================================
   BOOT
===================================================================== */
(function boot() {
  setTheme(localStorage.getItem(LS.theme) === 'light' ? 'light' : 'dark', false);
  const savedAccent = localStorage.getItem(LS.accent);
  setAccent(savedAccent && /^#[0-9a-f]{6}$/i.test(savedAccent) ? savedAccent : ACCENTS[0].hex);
  buildSwatches();

  wireAuth();
  wireApp();

  const flash = sessionStorage.getItem('slate:flash');
  if (flash) {
    sessionStorage.removeItem('slate:flash');
    setTimeout(() => toast(flash), 500);
  }
  startPingMeter();

  /* session restore — survives refresh */
  const token = localStorage.getItem(LS.token);
  if (token) {
    api('GET', '/api/auth/me')
      .then(d => enterApp(d.user, token))
      .catch(() => { localStorage.removeItem(LS.token); });
  }
})();
