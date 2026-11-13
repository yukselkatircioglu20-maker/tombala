import { api, live, isConfigured } from './backend.js';
import { sound } from './sound.js';
import {
  icon,
  crownSVG,
  hourglassSVG,
  esc,
  fmtTL,
  fmtDate,
  fmtAgo,
  fmtDuration,
  fmtCountdown,
  statusPill,
  STATUS_LABEL,
  avatar,
  ball,
  cardHTML,
  miniCard,
  dotsSpinner,
  rowsDone,
  remainingCount,
  el,
  $,
  $$,
  toast,
  modal,
  confirmModal,
  formModal,
} from './ui.js';

// =========================================================
// Durum & olay yolu
// =========================================================

const state = {
  user: null,
  unread: 0,
  game: null,
  gameRecvAt: 0,
  serverOffset: 0,
  settings: loadSettings(),
  route: '',
};

const listeners = new Map();
const bus = {
  on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev).delete(fn);
  },
  emit(ev, data) {
    for (const fn of listeners.get(ev) || []) {
      try {
        fn(data);
      } catch (err) {
        console.error(err);
      }
    }
  },
};

const PRIZE_KEYS = [
  ['cinko1', '1. Çinko'],
  ['cinko2', '2. Çinko'],
  ['tombala', 'Tombala'],
];

// ---------- ayarlar ----------

function loadSettings() {
  const def = { notifications: true, sfx: true, music: false, speech: true, theme: 'dark' };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('tb_settings') || '{}') };
  } catch {
    return def;
  }
}

function saveSettings(next) {
  state.settings = { ...state.settings, ...next };
  try {
    localStorage.setItem('tb_settings', JSON.stringify(state.settings));
  } catch {
    /* gizli sekme vb. */
  }
  applySettings();
}

function applySettings() {
  const s = state.settings;
  if (s.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = s.theme === 'light' ? '#f4efe4' : '#060a17';
  sound.setPrefs({ sfx: s.sfx, music: s.music, speech: s.speech });
}

function storeGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function storeSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* yoksay */
  }
}

// =========================================================
// Gerçek zamanlı bağlantı
// =========================================================

function setupLive() {
  live.on('game:state', (s) => {
    const prevId = state.game && state.game.id;
    state.game = s;
    state.gameRecvAt = Date.now();
    state.serverOffset = s.serverNow - Date.now();
    bus.emit('game', s);
    if (prevId && prevId !== s.id) bus.emit('newgame', s);
  });
  live.on('game:draw', ({ number }) => bus.emit('draw', number));
  live.on('game:winner', onWinner);
  live.on('game:started', () => {
    if (!state.user) return;
    if (state.route !== 'game')
      toast('Çekiliş başladı!', 'game', { action: { label: 'Canlı İzle', onClick: () => go('game') }, duration: 7000 });
  });
  live.on('game:new', () => {
    if (state.user && state.settings.notifications)
      toast('Yeni oyun için kart satışı başladı!', 'game', {
        action: { label: 'Kart Al', onClick: () => go('select') },
        duration: 6000,
      });
  });
  live.on('notify', (n) => {
    state.unread++;
    updateBadges();
    if (n.type === 'win') return; // kazanç ekranı ayrıca gösterilir
    if (state.settings.notifications) {
      toast(n.text, n.type === 'error' ? 'error' : n.type === 'success' ? 'success' : 'info');
      sound.notify();
      systemNotify(n.text);
    }
  });
  live.on('unread', (n) => {
    if (!state.user || state.unread === n) return;
    state.unread = n;
    updateBadges();
  });
  live.on('balance', ({ balance }) => {
    if (!state.user) return;
    state.user.balance = balance;
    updateBalances();
    bus.emit('user', state.user);
  });
  live.on('purchase:update', (p) => bus.emit('purchase', p));
  live.on('admin:request', (p) => {
    if (adminQueue.some((x) => x.id === p.id)) return;
    adminQueue.push(p);
    sound.notify();
    showNextAdminRequest();
    bus.emit('admin');
  });
  live.on('admin:refresh', () => bus.emit('admin'));
  live.on('auth:lost', () => {
    if (!state.user) return;
    state.user = null;
    state.unread = 0;
    myCardsCache = null;
    toast('Oturumunuz sona erdi, lütfen tekrar giriş yapın.', 'error');
    go('login');
  });
  live.start();
}

function systemNotify(text) {
  if (!state.settings.notifications || !document.hidden) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification('Tombala', { body: text, icon: '/img/icon.svg' });
  } catch {
    /* yoksay */
  }
}

function onWinner(e) {
  bus.emit('winner', e);
  const me = state.user && e.winners.filter((w) => w.userId === state.user.id);
  if (me && me.length) {
    const total = me.reduce((s, w) => s + w.amount, 0);
    setTimeout(() => showWin({ prize: e.prize, label: e.label, amount: total, cards: me.map((w) => w.cardNo) }), 1300);
    systemNotify(`Tebrikler! ${e.label} yaptınız: ${fmtTL(total)}`);
  } else if (state.settings.notifications) {
    const names = [...new Set(e.winners.map((w) => w.name))].join(', ');
    setTimeout(() => {
      toast(`${names} ${e.label} yaptı! (${fmtTL(e.winners[0].amount)})`, 'win', { duration: 5500 });
      sound.notify();
    }, 1300);
  }
}

// =========================================================
// Yönlendirme
// =========================================================

const app = document.getElementById('app');
const nav = document.getElementById('nav');

const routes = {
  splash: { render: screenSplash, public: true },
  welcome: { render: screenWelcome, public: true },
  register: { render: screenRegister, public: true },
  login: { render: screenLogin, public: true },
  bye: { render: screenBye, public: true, any: true },
  home: { render: screenHome, nav: 'home' },
  select: { render: screenSelect },
  request: { render: screenRequest },
  cards: { render: screenCards, nav: 'home' },
  game: { render: screenGame, public: true, any: true },
  izle: { render: screenGame, public: true, any: true },
  history: { render: screenHistory, nav: 'history' },
  winners: { render: screenWinners, nav: 'winners' },
  profile: { render: screenProfile, nav: 'profile' },
  settings: { render: screenSettings, nav: 'settings' },
  admin: { render: screenAdmin, admin: true, wide: true },
};

function go(path) {
  const target = `#/${path}`;
  if (location.hash === target) render();
  else location.hash = target;
}

let cleanupFns = [];

function render() {
  if (!isConfigured) return screenSetup();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let name = parts[0] || '';
  const params = parts.slice(1);
  if (!name) {
    if (state.user) return go('home');
    return go(storeGet('tb_seen') ? 'welcome' : 'splash');
  }
  const r = routes[name];
  if (!r) return go(state.user ? 'home' : 'welcome');
  if (!r.public && !state.user) return go('welcome');
  if (r.public && !r.any && state.user) return go('home');
  if (r.admin && (!state.user || state.user.role !== 'admin')) return go('home');

  for (const fn of cleanupFns) fn();
  cleanupFns = [];
  state.route = name;
  app.className = r.wide ? 'wide' : '';
  app.innerHTML = '';
  const ctx = {
    params,
    on: (ev, fn) => cleanupFns.push(bus.on(ev, fn)),
    every: (fn, ms) => {
      const t = setInterval(fn, ms);
      cleanupFns.push(() => clearInterval(t));
    },
    later: (fn, ms) => {
      const t = setTimeout(fn, ms);
      cleanupFns.push(() => clearTimeout(t));
    },
  };
  renderNav(r.nav);
  r.render(ctx);
  window.scrollTo(0, 0);
}

function mount(html) {
  app.innerHTML = html;
  return app.firstElementChild;
}

function renderNav(active) {
  if (!active || !state.user) {
    nav.hidden = true;
    return;
  }
  const items = [
    ['home', 'home', 'Ana Sayfa'],
    ['history', 'history', 'Geçmiş'],
    ['winners', 'trophy', 'Kazananlar'],
    ['profile', 'user', 'Profil'],
    ['settings', 'gear', 'Ayarlar'],
  ];
  nav.innerHTML = items
    .map(([r, ic, label]) => `<a href="#/${r}" class="${r === active ? 'active' : ''}">${icon(ic)}<span>${label}</span></a>`)
    .join('');
  nav.hidden = false;
}

// =========================================================
// Ortak parçalar
// =========================================================

function updateBalances() {
  if (!state.user) return;
  for (const n of $$('[data-balance]')) n.textContent = fmtTL(state.user.balance);
}

function updateBadges() {
  for (const b of $$('[data-unread]')) {
    b.textContent = state.unread > 99 ? '99+' : state.unread;
    b.hidden = !state.unread;
  }
}

function topbar() {
  const u = state.user;
  return `<header class="topbar">
    <a href="#/profile" aria-label="Profil">${avatar(u, 46)}</a>
    <div class="who"><b class="ellipsis">${esc(u.name)}</b><small>@${esc(u.username)}</small></div>
    <span class="chip-balance" title="Bakiye"><span class="coin">₺</span><span data-balance>${fmtTL(u.balance)}</span></span>
    ${u.role === 'admin' ? `<a class="icon-btn" href="#/admin" title="Admin Paneli" aria-label="Admin Paneli">${icon('shield')}</a>` : ''}
    <button class="icon-btn" data-bell title="Bildirimler" aria-label="Bildirimler">${icon('bell')}<span class="badge" data-unread ${
      state.unread ? '' : 'hidden'
    }>${state.unread}</span></button>
  </header>`;
}

function barHead(title, sub, iconName, back = 'home', right = '') {
  return `<header class="bar-head">
    ${back ? `<button class="back-btn" data-back="${back}" aria-label="Geri">${icon('back')}</button>` : ''}
    <div class="ttl"><h1>${iconName ? icon(iconName) : ''}${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
    ${right}
  </header>`;
}

function prizeRow(g) {
  let nextMarked = false;
  const live = g.status === 'running' || g.status === 'paused';
  return PRIZE_KEYS.map(([k, label]) => {
    const p = g.prizes[k];
    let cls = '';
    if (p) cls = 'won';
    else if (live && !nextMarked) {
      cls = 'next';
      nextMarked = true;
    }
    const amount = p ? p.amount : g.prizeAmounts[k];
    const who = p ? [...new Set(p.winners.map((w) => w.name))].join(', ') : '';
    return `<div class="prize ${cls}"><span>${label}</span><b>${fmtTL(amount)}</b>${
      who ? `<small title="${esc(who)}">✓ ${esc(who)}</small>` : cls === 'next' ? `<small class="gold">Sırada</small>` : ''
    }</div>`;
  }).join('');
}

function gameStatusText(g) {
  switch (g.status) {
    case 'waiting':
      return g.scheduledAt ? `Çekiliş: ${fmtDate(g.scheduledAt)}` : 'Çekiliş saati yakında duyurulacak';
    case 'running':
      return `Çekiliş canlı! ${g.drawn.length}/90 top çekildi`;
    case 'paused':
      return 'Çekiliş kısa bir süre duraklatıldı';
    case 'finished':
      return 'Oyun sona erdi';
    case 'cancelled':
      return 'Oyun iptal edildi';
    default:
      return '';
  }
}

function serverNow() {
  return Date.now() + state.serverOffset;
}

function gameElapsed() {
  const g = state.game;
  if (!g) return 0;
  return g.elapsedMs + (g.status === 'running' ? Date.now() - state.gameRecvAt : 0);
}

async function run(fn, btn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401 && state.user) {
      state.user = null;
      live.resetUser();
      toast('Oturumunuz sona erdi, lütfen tekrar giriş yapın.', 'error');
      go('login');
      return undefined;
    }
    toast(err.message || 'Bir hata oluştu.', 'error');
    sound.error();
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

let myCardsCache = null;
async function fetchMyCards(force = false) {
  if (!state.user) return { cards: [], purchases: [] };
  if (!force && myCardsCache && state.game && myCardsCache.gameId === state.game.id) return myCardsCache;
  myCardsCache = await api.get('/my-cards');
  return myCardsCache;
}
bus.on('purchase', () => (myCardsCache = null));
bus.on('newgame', () => (myCardsCache = null));

let deckCache = null;
async function fetchDeck() {
  if (deckCache && state.game && deckCache.gameId === state.game.id) return deckCache;
  deckCache = await api.get('/game/cards');
  return deckCache;
}

// Global tıklama yönetimi
document.addEventListener('click', (e) => {
  const goEl = e.target.closest('[data-go]');
  if (goEl) {
    e.preventDefault();
    sound.click();
    go(goEl.dataset.go);
    return;
  }
  const back = e.target.closest('[data-back]');
  if (back) {
    e.preventDefault();
    sound.click();
    go(back.dataset.back);
    return;
  }
  if (e.target.closest('[data-bell]')) {
    e.preventDefault();
    openNotifications();
  }
});
document.addEventListener('pointerdown', () => sound.unlock(), { passive: true });

// =========================================================
// Bildirim çekmecesi
// =========================================================

async function openNotifications() {
  const root = document.getElementById('overlay-root');
  const ov = el(`<div class="overlay" style="justify-content:flex-end;padding:0">
    <aside class="drawer panel" role="dialog" aria-label="Bildirimler">
      <div class="row between"><b style="font-size:20px" class="row">${icon('bell')} Bildirimler</b>
      <button class="icon-btn" data-close aria-label="Kapat">${icon('x')}</button></div>
      <div class="list" data-list>${dotsSpinner()}</div>
    </aside></div>`);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) close();
  });
  root.appendChild(ov);
  const data = await run(() => api.get('/notifications'));
  if (!data) return close();
  const list = $('[data-list]', ov);
  list.innerHTML = data.items.length
    ? data.items
        .map(
          (n) =>
            `<div class="notif ${n.read ? 'read' : ''} ${esc(n.type)}"><span class="dot"></span><div>${esc(n.text)}<small>${fmtAgo(
              n.at
            )}</small></div></div>`
        )
        .join('')
    : `<div class="empty">${icon('bell')}Henüz bildiriminiz yok.</div>`;
  if (state.unread) {
    await run(() => api.post('/notifications/read'));
    state.unread = 0;
    updateBadges();
  }
}

// =========================================================
// Admin: kart talebi açılır penceresi (8/16)
// =========================================================

const adminQueue = [];
let adminModalOpen = false;

function showNextAdminRequest() {
  if (adminModalOpen || !adminQueue.length || !state.user || state.user.role !== 'admin') return;
  const p = adminQueue.shift();
  adminModalOpen = true;
  const user = { name: p.name, username: p.username };
  modal({
    title: 'Admin Bildirimi',
    iconName: 'bell',
    body: `<div class="admin-req">
      ${avatar(user, 60)}
      <div class="txt"><b>${esc(p.name)}</b><br><span class="muted">adlı kullanıcı</span><br>
      ${p.cards.length} adet kart almak istiyor.
      <div class="card-chips" style="justify-content:flex-start;margin:8px 0">${p.cards
        .map((c) => `<span class="card-chip">${c}</span>`)
        .join('')}</div>
      Toplam Tutar: <b class="gold">${fmtTL(p.total)}</b></div>
    </div>
    ${adminQueue.length ? `<p class="center-text muted small" style="margin-top:10px">+${adminQueue.length} talep daha bekliyor</p>` : ''}`,
    actions: [
      {
        label: 'Onayla',
        cls: 'btn-green',
        icon: 'check',
        onClick: async () => {
          const r = await run(() => api.post(`/admin/purchases/${p.id}/approve`));
          if (r) toast(`${p.name} adlı kullanıcının talebi onaylandı.`, 'success');
        },
      },
      {
        label: 'Reddet',
        cls: 'btn-red',
        icon: 'x',
        onClick: async () => {
          const r = await run(() => api.post(`/admin/purchases/${p.id}/reject`, {}));
          if (r) toast('Talep reddedildi.', 'info');
        },
      },
    ],
    onClose: () => {
      adminModalOpen = false;
      setTimeout(showNextAdminRequest, 250);
    },
  });
}

// =========================================================
// Kazandın ekranı (12/16)
// =========================================================

function showWin({ prize, label, amount, cards }) {
  const u = state.user;
  if (!u) return;
  sound.win();
  if (navigator.vibrate) navigator.vibrate([120, 60, 120, 60, 240]);
  const colors = ['#ffd978', '#f4c661', '#fff1c1', '#e5484d', '#3168ff', '#4ade80'];
  let conf = '';
  for (let i = 0; i < 90; i++) {
    const c = colors[i % colors.length];
    conf += `<i style="left:${Math.random() * 100}%;background:${c};--dx:${(Math.random() - 0.5) * 200}px;--r:${
      Math.random() * 900
    }deg;animation-duration:${2.4 + Math.random() * 2.6}s;animation-delay:${Math.random() * 1.2}s;${
      i % 3 === 0 ? 'border-radius:50%;width:10px;height:10px;' : ''
    }"></i>`;
  }
  const ov = el(`<div class="win-overlay" role="dialog" aria-label="Kazandınız">
    <div class="rays"></div>
    <div class="confetti">${conf}</div>
    ${crownSVG(150)}
    <div class="win-title">KAZANDIN!</div>
    <div class="who">${avatar(u, 58)}<span>${esc(u.name)}</span></div>
    <div class="win-amount">${fmtTL(amount)}</div>
    <p>${prize === 'tombala' ? 'Tebrikler! Büyük ödül senin oldu.' : `Tebrikler! ${esc(label)} senin oldu.`}</p>
    <p class="small muted">${esc(label)} · Kart No: ${cards.join(', ')}</p>
    <button class="btn btn-gold" style="min-width:220px">Devam Et ${icon('chevron')}</button>
  </div>`);
  ov.querySelector('button').addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);
  sound.speak(prize === 'tombala' ? 'Tombala! Tebrikler!' : `${label}! Tebrikler!`);
}

// =========================================================
// EKRANLAR
// =========================================================

// ---------- Kurulum uyarısı ----------
function screenSetup() {
  nav.hidden = true;
  mount(`<section class="screen no-nav center" style="gap:18px">
    ${crownSVG(90)}
    <h1 class="logo" style="font-size:44px">TOMBALA</h1>
    <div class="panel pad stack" style="text-align:left">
      <b style="font-size:18px">Supabase bağlantısı yapılandırılmamış</b>
      <p class="muted small">Site sahibiyseniz <code>public/js/config.js</code> dosyasına Supabase projenizin
      <b>Project URL</b> ve <b>anon / publishable</b> anahtarını yazın, ardından
      <code>supabase/schema.sql</code> dosyasını Supabase SQL Editor'de çalıştırın.</p>
    </div>
  </section>`);
}

// ---------- 1/16 Açılış ----------
function decoCard(cls, style) {
  const nums = [4, 17, 23, 41, 56, 7, 19, 28, 44, 60, 9, 21, 32, 47, 62, 11, 25, 36, 49, 65];
  return `<div class="deco-card ${cls}" style="${style}">${nums.map((n) => `<i>${n}</i>`).join('')}</div>`;
}

function brandBlock(size = 1) {
  return `<div class="brand" style="transform:scale(${size})">
    ${decoCard('', 'left:-120px;top:70px;transform:rotate(-16deg)')}
    ${decoCard('', 'right:-120px;top:90px;transform:rotate(14deg)')}
    ${crownSVG(122)}
    <div class="balls">${ball(7, 72, '', '#1e5bd8')}${ball(90, 94, '', '#1e5bd8')}${ball(5, 72, '', '#1e5bd8')}</div>
    <h1 class="logo">TOMBALA</h1>
  </div>`;
}

function screenSplash() {
  storeSet('tb_seen', '1');
  mount(`<section class="screen splash no-nav">
    <div></div>
    <div class="stack" style="align-items:center">
      ${brandBlock()}
      <p class="script">Şansın en güzel hali...</p>
    </div>
    <div class="stack" style="width:100%;gap:22px">
      <button class="btn btn-gold cta" data-go="welcome">Başlayın ${icon('chevron')}</button>
      <div class="features">
        <span>${icon('shield')}Güvenli Oyun</span>
        <span>${icon('bolt')}Hızlı İşlem</span>
        <span>${icon('headset')}7/24 Destek</span>
      </div>
    </div>
  </section>`);
}

// ---------- 2/16 Hoş Geldiniz ----------
function screenWelcome() {
  mount(`<section class="screen no-nav" style="justify-content:center">
    <div class="stack" style="align-items:center;gap:6px;margin-bottom:8px">
      ${crownSVG(84)}
      <h1 class="logo" style="font-size:46px">TOMBALA</h1>
    </div>
    <div class="page-head" style="margin-top:8px">
      <h1>Hoş Geldiniz</h1>
      <p>Devam etmek için giriş yapın<br>veya kaydolun</p>
    </div>
    <div class="choice-grid" style="margin-top:10px">
      <button class="panel choice" data-go="register">${icon('userPlus')}<b>Kayıt Ol</b><span>Hemen üye olun</span></button>
      <button class="panel choice" data-go="login">${icon('login')}<b>Giriş Yap</b><span>Zaten üye misiniz?</span></button>
    </div>
    <button class="btn btn-ghost btn-block" data-go="izle" style="margin-top:4px">${icon('tv')}Canlı Çekilişi İzle</button>
    <div class="features" style="margin-top:18px">
      <span>${icon('shield')}Güvenli Oyun</span>
      <span>${icon('bolt')}Hızlı İşlem</span>
      <span>${icon('headset')}7/24 Destek</span>
    </div>
  </section>`);
}

function passwordToggle(scr) {
  for (const b of $$('[data-eye]', scr)) {
    b.addEventListener('click', () => {
      const input = b.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.innerHTML = icon(show ? 'eyeOff' : 'eye');
    });
  }
}

async function afterAuth(user, msg) {
  state.user = user;
  const me = await api.get('/me').catch(() => null);
  if (me && me.user) {
    state.user = me.user;
    state.unread = me.unread || 0;
  }
  myCardsCache = null;
  live.resetUser();
  toast(msg, 'success');
  go('home');
  if (state.user.role === 'admin') loadPendingForAdmin();
}

// ---------- 3/16 Kayıt Ol ----------
function screenRegister() {
  const scr = mount(`<section class="screen no-nav">
    <div class="page-head">
      <button class="back-btn" data-back="welcome" aria-label="Geri">${icon('back')}</button>
      ${icon('user', 'head-icon')}
      <h1>Kayıt Ol</h1>
      <p>Hemen üye olarak oyuna katılın</p>
    </div>
    <form class="form" novalidate style="margin-top:8px">
      <label class="field">${icon('user')}<input name="name" placeholder="Ad Soyad" autocomplete="name" maxlength="40" required /></label>
      <label class="field">${icon('user')}<input name="username" placeholder="Kullanıcı Adı" autocomplete="username" maxlength="20" autocapitalize="off" required /></label>
      <label class="field">${icon('lock')}<input name="password" type="password" placeholder="Şifre (en az 6 karakter)" autocomplete="new-password" required /><button type="button" class="eye" data-eye aria-label="Şifreyi göster">${icon(
        'eye'
      )}</button></label>
      <div class="form-error" data-err></div>
      <button class="btn btn-gold btn-block" type="submit">Kayıt Ol</button>
      <p class="center-text muted small">Zaten hesabın var mı? <a href="#/login" class="link-btn">Giriş Yap</a></p>
    </form>
  </section>`);
  passwordToggle(scr);
  const form = $('form', scr);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    const body = Object.fromEntries(new FormData(form).entries());
    $('[data-err]', scr).textContent = '';
    btn.disabled = true;
    try {
      const r = await api.post('/auth/register', body);
      await afterAuth(r.user, `Hoş geldin ${r.user.name}!`);
    } catch (err) {
      $('[data-err]', scr).textContent = err.message;
      sound.error();
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- 4/16 Giriş Yap ----------
function screenLogin() {
  const scr = mount(`<section class="screen no-nav">
    <div class="page-head">
      <button class="back-btn" data-back="welcome" aria-label="Geri">${icon('back')}</button>
      ${icon('login', 'head-icon')}
      <h1>Giriş Yap</h1>
      <p>Hesabınıza giriş yapın</p>
    </div>
    <form class="form" novalidate style="margin-top:8px">
      <label class="field">${icon('user')}<input name="username" placeholder="Kullanıcı Adı" autocomplete="username" autocapitalize="off" required /></label>
      <label class="field">${icon('lock')}<input name="password" type="password" placeholder="Şifre" autocomplete="current-password" required /><button type="button" class="eye" data-eye aria-label="Şifreyi göster">${icon(
        'eye'
      )}</button></label>
      <div class="row between">
        <label class="check"><input type="checkbox" name="remember" checked /> Beni Hatırla</label>
        <button type="button" class="link-btn" data-forgot>Şifremi Unuttum?</button>
      </div>
      <div class="form-error" data-err></div>
      <button class="btn btn-gold btn-block" type="submit">Giriş Yap</button>
      <p class="center-text muted small">Hesabın yok mu? <a href="#/register" class="link-btn">Kayıt Ol</a></p>
    </form>
  </section>`);
  passwordToggle(scr);
  $('[data-forgot]', scr).addEventListener('click', () =>
    modal({
      title: 'Şifremi Unuttum',
      iconName: 'key',
      body: `<p class="center-text muted">Güvenliğiniz için şifre sıfırlama işlemi yönetici tarafından yapılır. Lütfen destek hattı üzerinden yöneticiyle iletişime geçin; size yeni bir geçici şifre verilecektir.</p>`,
      actions: [{ label: 'Tamam', cls: 'btn-gold' }],
    })
  );
  const form = $('form', scr);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    const fd = new FormData(form);
    const body = { username: fd.get('username'), password: fd.get('password'), remember: fd.get('remember') === 'on' };
    $('[data-err]', scr).textContent = '';
    btn.disabled = true;
    try {
      const r = await api.post('/auth/login', body);
      await afterAuth(r.user, `Tekrar hoş geldin ${r.user.name}!`);
    } catch (err) {
      $('[data-err]', scr).textContent = err.message;
      sound.error();
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- 5/16 Ana Sayfa ----------
function screenHome(ctx) {
  const scr = mount(`<section class="screen">
    ${topbar()}
    <div class="panel hero glow">
      <svg class="swoosh" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 170 C 120 120, 220 200, 400 110" stroke="#f4cf74" stroke-opacity=".55" stroke-width="1.5" fill="none"/>
        <path d="M0 185 C 140 140, 240 210, 400 130" stroke="#f4cf74" stroke-opacity=".25" stroke-width="1" fill="none"/>
      </svg>
      <h2 class="gold-text">Tombala Heyecanı Devam Ediyor!</h2>
      <p>Hemen kartlarını seç, şansını dene!</p>
      <button class="btn btn-gold btn-sm" data-go="select" style="height:44px;font-size:16px">Kart Satın Al</button>
      <div class="hero-art" aria-hidden="true">${miniCard([4, 17, 23, 41, 56, 7, 19, 28, 44, 60, 9, 21, 32, 47, 62])}${ball(90, 112, '', '#1e5bd8')}</div>
    </div>
    <div data-banners class="stack"></div>
    <div class="panel pad stack" data-status></div>
    <div class="panel pad" data-mycards></div>
    <div class="panel pad" data-recent></div>
  </section>`);

  const renderStatus = () => {
    const g = state.game;
    const box = $('[data-status]', scr);
    if (!g) {
      box.innerHTML = dotsSpinner();
      return;
    }
    let action = '';
    if (g.status === 'waiting')
      action = `<button class="btn btn-gold btn-block" data-go="select">${icon('cards')}Kart Seç (${fmtTL(g.cardPrice)}/kart)</button>`;
    else if (g.status === 'running' || g.status === 'paused')
      action = `<button class="btn btn-green btn-block" data-go="game">${icon('tv')}Canlı Çekilişi İzle</button>`;
    else action = `<button class="btn btn-ghost btn-block" data-go="game">${icon('trophy')}Sonuçları Gör</button>`;
    const countdown =
      g.status === 'waiting' && g.scheduledAt
        ? `<div class="row small"><span class="muted">Başlamasına:</span><b class="gold" data-countdown>${fmtCountdown(
            g.scheduledAt - serverNow()
          )}</b></div>`
        : '';
    box.innerHTML = `
      <div class="row between"><b style="font-size:17px">Oyun #${g.id}</b>${statusPill(g.status)}</div>
      <div class="muted small" style="margin-top:-6px">${esc(gameStatusText(g))}</div>
      ${countdown}
      <div class="row between" style="align-items:flex-end">
        <div><div class="muted small">Havuz Ödülü</div><div class="big-amount gold-text">${fmtTL(g.pool)}</div></div>
        <div class="center-text"><div class="muted small">Oyuncu / Kart</div><b style="font-size:18px">${g.playerCount} / ${g.soldCount}</b></div>
      </div>
      <div class="prize-row">${prizeRow(g)}</div>
      ${action}`;
  };

  const renderMine = async () => {
    const box = $('[data-mycards]', scr);
    const banners = $('[data-banners]', scr);
    const data = await fetchMyCards().catch(() => null);
    if (!data || !scr.isConnected) return;
    const open = data.purchases.filter((p) => ['pending', 'awaiting_payment'].includes(p.status));
    banners.innerHTML = open
      .map(
        (p) => `<div class="banner" data-go="request/${p.id}">${icon(p.status === 'pending' ? 'clock' : 'wallet')}
        <div class="grow"><b>${p.status === 'pending' ? 'Talebiniz onay bekliyor' : 'Ödemeniz bekleniyor'}</b>
        <div class="small muted">${p.cards.length} kart · ${fmtTL(p.total)}</div></div>${icon('chevron', 'chev')}</div>`
      )
      .join('');
    const g = state.game;
    const drawn = new Set(g && g.id === data.gameId ? g.drawn : []);
    const best = data.cards
      .map((c) => ({ ...c, left: remainingCount(c.grid, drawn) }))
      .sort((a, b) => a.left - b.left)[0];
    box.innerHTML = `<div class="section-title">Kartlarım <a class="link" href="#/cards">Tümünü Gör</a></div>
      ${
        data.cards.length
          ? `<div class="row" style="margin-bottom:12px"><div class="stat grow"><b>${data.cards.length}</b><span>Aktif Kart</span></div>
             <div class="stat grow"><b>${best ? best.left : '-'}</b><span>En İyi Kart Kalan</span></div></div>
             ${best ? cardHTML(best.cardNo, best.grid, { drawnSet: drawn, compact: true, showProgress: true }) : ''}`
          : `<div class="empty" style="padding:12px">${icon('cards')}Bu oyun için henüz kartınız yok.</div>`
      }`;
  };

  const renderRecent = async () => {
    const box = $('[data-recent]', scr);
    const data = await api.get('/winners?range=all').catch(() => null);
    if (!data || !scr.isConnected) return;
    box.innerHTML = `<div class="section-title">Son Kazananlar <a class="link" href="#/winners">Tümü</a></div>
      ${
        data.recent.length
          ? `<div class="list">${data.recent
              .slice(0, 4)
              .map(
                (w) => `<div class="list-item" style="padding:10px 2px">${avatar(w, 36)}<div class="grow"><b class="ellipsis">${esc(
                  w.name
                )}</b><div class="tiny muted">${esc(w.label)} · Oyun #${w.gameId} · ${fmtAgo(w.at)}</div></div><b class="gold nowrap">${fmtTL(
                  w.amount
                )}</b></div>`
              )
              .join('')}</div>`
          : `<div class="empty" style="padding:10px">${icon('trophy')}İlk kazanan sen ol!</div>`
      }`;
  };

  if (state.user.role === 'admin') {
    api
      .get('/admin/overview')
      .then((o) => {
        if (!scr.isConnected) return;
        const n = o.stats.pending + o.stats.awaiting;
        if (n)
          $('[data-banners]', scr).insertAdjacentHTML(
            'afterbegin',
            `<div class="banner green" data-go="admin/payments">${icon('shield')}<div class="grow"><b>${n} açık kart talebi var</b><div class="small muted">${o.stats.pending} onay, ${o.stats.awaiting} ödeme bekliyor</div></div>${icon(
              'chevron',
              'chev'
            )}</div>`
          );
      })
      .catch(() => {});
  }

  renderStatus();
  renderMine();
  renderRecent();
  ctx.on('game', () => {
    renderStatus();
    renderMine();
  });
  ctx.on('purchase', renderMine);
  ctx.on('winner', () => setTimeout(renderRecent, 800));
  ctx.every(() => {
    const c = $('[data-countdown]', scr);
    if (c && state.game && state.game.scheduledAt) c.textContent = fmtCountdown(state.game.scheduledAt - serverNow());
  }, 1000);
}

// ---------- 6/16 Kart Seçimi ----------
function screenSelect(ctx) {
  const selected = new Set();
  let preview = null;
  let deck = null;
  let mine = new Set();

  const scr = mount(`<section class="screen no-nav">
    ${barHead(
      'Kart Seçimi',
      'İstediğiniz kartları seçin',
      'cards',
      'home',
      `<div class="price-pill"><span class="coin">₺</span><div><small>Kart Bedeli</small><b data-price>-</b></div></div>`
    )}
    <div data-closed></div>
    <div class="legend">
      <span><i style="background:#1b2850;border:1px solid rgba(255,255,255,.2)"></i>Müsait</span>
      <span><i style="background:linear-gradient(#ffeaa9,#dc9d37)"></i>Seçili</span>
      <span><i style="background:#4ade80"></i>Sizin</span>
      <span><i style="background:#555c70;opacity:.5"></i>Dolu</span>
    </div>
    <div class="panel pad"><div class="pick-grid" data-grid></div></div>
    <div class="row">
      <button class="btn btn-ghost btn-sm grow" data-random>${icon('dice')}Rastgele Seç</button>
      <button class="btn btn-ghost btn-sm grow" data-clear>${icon('x')}Temizle</button>
    </div>
    <div data-preview></div>
    <div class="panel glow select-footer">
      <div class="info"><div>Seçilen Kart: <b data-count>0</b></div><div class="small muted">Toplam: <b data-total>0 TL</b></div></div>
      <button class="btn btn-gold" data-ok style="min-width:120px">Tamam</button>
    </div>
  </section>`);

  const grid = $('[data-grid]', scr);
  grid.innerHTML = Array.from({ length: 100 }, (_, i) => `<button class="pick" data-n="${i + 1}">${i + 1}</button>`).join('');

  const isOpen = () => state.game && state.game.status === 'waiting';

  const paint = () => {
    const g = state.game;
    if (!g) return;
    const taken = new Set(g.taken);
    for (const b of $$('.pick', grid)) {
      const n = Number(b.dataset.n);
      if (taken.has(n) && selected.has(n) && !mine.has(n)) selected.delete(n);
      b.classList.toggle('mine', mine.has(n));
      b.classList.toggle('taken', taken.has(n) && !mine.has(n));
      b.classList.toggle('sel', selected.has(n));
      b.classList.toggle('preview', preview === n);
    }
    $('[data-price]', scr).textContent = fmtTL(g.cardPrice);
    $('[data-count]', scr).textContent = selected.size;
    $('[data-total]', scr).textContent = fmtTL(selected.size * g.cardPrice);
    $('[data-ok]', scr).disabled = !selected.size || !isOpen();
    $('[data-closed]', scr).innerHTML = isOpen()
      ? ''
      : `<div class="banner" data-go="game">${icon('info')}<div class="grow"><b>Kart satışı şu an kapalı</b><div class="small muted">${esc(
          gameStatusText(g)
        )}. Yeni oyun açıldığında kart alabilirsiniz.</div></div>${icon('chevron', 'chev')}</div>`;
  };

  const showPreview = () => {
    const box = $('[data-preview]', scr);
    if (!preview || !deck) {
      box.innerHTML = `<p class="center-text muted small">Bir karta dokunarak sayılarını önizleyebilirsiniz.</p>`;
      return;
    }
    box.innerHTML = `<div class="small muted" style="margin-bottom:6px">Önizleme</div>${cardHTML(preview, deck.cards[preview - 1])}`;
  };

  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (!b) return;
    const n = Number(b.dataset.n);
    preview = n;
    if (!isOpen() || b.classList.contains('taken') || mine.has(n)) {
      showPreview();
      paint();
      return;
    }
    if (selected.has(n)) selected.delete(n);
    else {
      const max = state.game.maxCardsPerRequest || 10;
      if (selected.size >= max) {
        toast(`Tek seferde en fazla ${max} kart seçebilirsiniz.`, 'error');
        return;
      }
      selected.add(n);
    }
    sound.select();
    showPreview();
    paint();
  });

  $('[data-random]', scr).addEventListener('click', () => {
    if (!isOpen()) return;
    const taken = new Set(state.game.taken);
    const free = [];
    for (let n = 1; n <= 100; n++) if (!taken.has(n) && !selected.has(n)) free.push(n);
    if (!free.length) return toast('Müsait kart kalmadı.', 'error');
    if (selected.size >= (state.game.maxCardsPerRequest || 10)) return toast('Seçim limitine ulaştınız.', 'error');
    const n = free[Math.floor(Math.random() * free.length)];
    selected.add(n);
    preview = n;
    sound.select();
    showPreview();
    paint();
  });
  $('[data-clear]', scr).addEventListener('click', () => {
    selected.clear();
    preview = null;
    showPreview();
    paint();
  });

  $('[data-ok]', scr).addEventListener('click', async (e) => {
    if (!selected.size) return;
    const r = await run(() => api.post('/purchases', { cards: [...selected] }), e.currentTarget);
    if (r) {
      myCardsCache = null;
      go(`request/${r.purchase.id}`);
    }
  });

  const load = async () => {
    const [d, my] = await Promise.all([fetchDeck().catch(() => null), fetchMyCards().catch(() => null)]);
    deck = d;
    mine = new Set();
    if (my)
      for (const p of my.purchases) if (['pending', 'awaiting_payment', 'paid'].includes(p.status)) p.cards.forEach((c) => mine.add(c));
    if (!scr.isConnected) return;
    showPreview();
    paint();
  };
  paint();
  showPreview();
  load();
  ctx.on('game', paint);
  ctx.on('newgame', () => {
    selected.clear();
    preview = null;
    load();
  });
  ctx.on('purchase', load);
}

// ---------- 7/16 & 9/16 Talep durumu ----------
function screenRequest(ctx) {
  const id = Number(ctx.params[0]);
  let data = null;
  let wasOpen = false;
  const scr = mount(`<section class="screen no-nav">
    ${barHead('Kart Talebi', `Talep #${id}`, '', 'home')}
    <div class="wait" data-body>${dotsSpinner()}</div>
  </section>`);
  const body = $('[data-body]', scr);

  const chips = (p) => `<div class="card-chips">${p.cards.map((c) => `<span class="card-chip">${c}</span>`).join('')}</div>`;

  const draw = () => {
    if (!data) return;
    const p = data.purchase;
    const cancelBtn = `<button class="link-btn" data-cancel>Talebi İptal Et</button>`;
    if (p.status === 'pending') {
      wasOpen = true;
      body.innerHTML = `
        <div class="ring-check">${icon('check')}</div>
        <h2>Seçiminiz Onaylanıyor...</h2>
        <p>Lütfen bekleyin</p>
        ${dotsSpinner()}
        <div class="panel pad stack" style="width:100%;margin-top:14px">
          <div class="row between"><span class="muted">Seçilen Kartlar</span><b>${p.cards.length} adet</b></div>
          ${chips(p)}
          <div class="row between"><span class="muted">Toplam Tutar</span><b class="gold">${fmtTL(p.total)}</b></div>
        </div>
        <p class="small muted">Talebiniz yöneticiye iletildi. Onaylandığında bu ekran otomatik olarak güncellenecek.</p>
        ${cancelBtn}`;
    } else if (p.status === 'awaiting_payment') {
      wasOpen = true;
      const enough = state.user.balance >= p.total;
      body.innerHTML = `
        ${hourglassSVG()}
        <h2>Ödemeniz Bekleniyor...</h2>
        <p>Lütfen işlemin tamamlanmasını bekleyin.</p>
        ${dotsSpinner()}
        <div class="panel pad pay-box stack" style="margin-top:14px">
          <div class="row between"><span class="muted">Kartlar</span>${chips(p)}</div>
          <div class="row between"><span class="muted">Ödenecek Tutar</span><b class="gold" style="font-size:22px">${fmtTL(p.total)}</b></div>
          <button class="btn btn-gold btn-block" data-pay ${enough ? '' : 'disabled'}>${icon('wallet')}Bakiyeden Öde</button>
          <div class="center-text small muted">Bakiyeniz: <b data-balance>${fmtTL(state.user.balance)}</b>${
            enough ? '' : ' · <span class="red">Yetersiz bakiye</span>'
          }</div>
          <div class="divider"></div>
          <div class="row between"><b>Havale / EFT ile Ödeme</b><button class="btn btn-ghost btn-xs" data-copy>${icon('copy')}Kopyala</button></div>
          <pre>${esc(data.paymentInfo)}</pre>
          <p class="small muted">Ödemeniz yönetici tarafından onaylandığında kartlarınız aktif olur.</p>
        </div>
        ${cancelBtn}`;
    } else if (p.status === 'paid') {
      body.innerHTML = `
        <div class="ring-check green">${icon('check')}</div>
        <h2>Ödeme Alındı!</h2>
        <p>Kartlarınız oyuna hazır. Bol şans!</p>
        ${chips(p)}
        <button class="btn btn-gold" data-go="cards" style="margin-top:10px;min-width:220px">${icon('cards')}Kartlarımı Gör</button>`;
      if (wasOpen) {
        sound.win();
        ctx.later(() => go('cards'), 2600);
      }
    } else {
      const rejected = p.status === 'rejected';
      body.innerHTML = `
        <div class="ring-check red">${icon('x')}</div>
        <h2>${rejected ? 'Talep Reddedildi' : 'Talep İptal Edildi'}</h2>
        <p>${p.reason ? esc(p.reason) : rejected ? 'Talebiniz yönetici tarafından reddedildi.' : 'Bu talep artık geçerli değil.'}</p>
        ${chips(p)}
        <button class="btn btn-gold" data-go="select" style="margin-top:10px;min-width:220px">Yeni Kart Seç</button>`;
    }
    const cancel = $('[data-cancel]', body);
    if (cancel)
      cancel.addEventListener('click', async () => {
        if (!(await confirmModal('Talebi İptal Et', 'Bu kart talebini iptal etmek istediğinize emin misiniz?', { okLabel: 'İptal Et', okCls: 'btn-red' })))
          return;
        const r = await run(() => api.post(`/purchases/${id}/cancel`));
        if (r) {
          data.purchase = r.purchase;
          wasOpen = false;
          draw();
        }
      });
    const pay = $('[data-pay]', body);
    if (pay)
      pay.addEventListener('click', async () => {
        const r = await run(() => api.post(`/purchases/${id}/pay`), pay);
        if (r) {
          state.user.balance = r.balance;
          updateBalances();
          data.purchase = r.purchase;
          draw();
        }
      });
    const copy = $('[data-copy]', body);
    if (copy)
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(data.paymentInfo);
          toast('Ödeme bilgileri kopyalandı.', 'success');
        } catch {
          toast('Kopyalanamadı, lütfen elle seçin.', 'error');
        }
      });
  };

  const load = async () => {
    const r = await run(() => api.get(`/purchases/${id}`));
    if (!r || !scr.isConnected) return;
    data = r;
    draw();
  };
  load();
  ctx.on('purchase', (p) => {
    if (p.id !== id || !data) return;
    data.purchase = p;
    draw();
  });
  ctx.on('user', () => {
    if (data && data.purchase.status === 'awaiting_payment') draw();
  });
  ctx.every(() => {
    if (data && ['pending', 'awaiting_payment'].includes(data.purchase.status)) load();
  }, 15000);
}

// ---------- 10/16 Kartlarım ----------
function screenCards(ctx) {
  const scr = mount(`<section class="screen">
    ${barHead('Kartlarım', 'Seçtiğiniz kartlar aşağıda listelenmiştir.', 'cards', 'home')}
    <div data-top class="stack"></div>
    <div class="cards-list" data-list>${dotsSpinner()}</div>
  </section>`);
  let data = null;

  const draw = () => {
    if (!data) return;
    const g = state.game;
    const top = $('[data-top]', scr);
    const live = g && (g.status === 'running' || g.status === 'paused');
    const open = data.purchases.filter((p) => ['pending', 'awaiting_payment'].includes(p.status));
    top.innerHTML =
      (live && data.cards.length
        ? `<div class="banner green" data-go="game">${icon('tv')}<div class="grow"><b>Çekiliş canlı!</b><div class="small muted">${g.drawn.length}/90 top çekildi · Kartların otomatik işaretleniyor</div></div>${icon(
            'chevron',
            'chev'
          )}</div>`
        : '') +
      open
        .map(
          (p) => `<div class="banner" data-go="request/${p.id}">${icon('clock')}<div class="grow"><b>${STATUS_LABEL[p.status]}</b>
          <div class="small muted">Kart: ${p.cards.join(', ')} · ${fmtTL(p.total)}</div></div>${icon('chevron', 'chev')}</div>`
        )
        .join('');
    const list = $('[data-list]', scr);
    if (!data.cards.length) {
      list.innerHTML = `<div class="panel empty">${icon('cards')}Bu oyun için aktif kartınız yok.<br><br>
        ${g && g.status === 'waiting' ? `<button class="btn btn-gold btn-sm" data-go="select">Kart Satın Al</button>` : ''}</div>`;
      return;
    }
    const drawn = new Set(g && g.id === data.gameId ? g.drawn : []);
    const last = g && g.drawn.length ? g.drawn[g.drawn.length - 1] : null;
    list.innerHTML = data.cards.map((c) => cardHTML(c.cardNo, c.grid, { drawnSet: drawn, last, showProgress: true })).join('');
  };

  const load = async (force) => {
    data = await fetchMyCards(force).catch(() => null);
    if (scr.isConnected) draw();
  };
  load(true);
  ctx.on('game', draw);
  ctx.on('purchase', () => load(true));
  ctx.on('newgame', () => load(true));
}

// ---------- 11/16 Oyun ----------
function screenGame(ctx) {
  let mine = null;
  let shown = state.game ? state.game.drawn.length : 0;
  let animating = false;

  const sphereBalls = () => {
    let s = '';
    const nums = [7, 38, 58, 26, 33, 20, 6, 89, 49, 72, 14, 65, 3, 81];
    nums.forEach((n, i) => {
      const a = (i / nums.length) * Math.PI * 2;
      const r = 38 + (i % 3) * 14;
      const x = 83 + Math.cos(a) * r;
      const y = 92 + Math.sin(a) * r * 0.75;
      const rnd = () => `${Math.round((Math.random() - 0.5) * 60)}px`;
      s += `<span class="ball" style="--s:34px;--c:${['#e53935', '#2e9e4f', '#f57c00', '#1e5bd8', '#d4a017', '#8e24aa'][i % 6]};left:${x}px;top:${y}px;--x1:${rnd()};--y1:${rnd()};--x2:${rnd()};--y2:${rnd()};--x3:${rnd()};--y3:${rnd()};--d:${(
        1.8 +
        Math.random() * 1.6
      ).toFixed(2)}s;--dl:-${(Math.random() * 2).toFixed(2)}s"><b>${n}</b></span>`;
    });
    return s;
  };

  const scr = mount(`<section class="screen no-nav">
    <div class="row between">
      <button class="back-btn" data-back="${state.user ? 'home' : 'welcome'}" aria-label="Geri">${icon('back')}</button>
      <div class="row small">
        <button class="btn btn-ghost btn-xs" data-sound hidden>${icon('volume')}Sesi Aç</button>
        <span class="muted" data-gameid></span><span data-pill></span>
      </div>
    </div>
    <div class="game-top">
      <span class="pill-box">${icon('clock')}<span data-timer>00:00:00</span></span>
      <span class="pill-box title">Tombala</span>
      <span class="pill-box prize-box"><small>Havuz Ödülü</small><b>${icon('trophy')}<span data-pool>-</span></b></span>
    </div>
    <div class="stage">
      <div class="beam l"></div><div class="beam r"></div>
      <div class="lights">${'<i></i>'.repeat(14)}</div>
      <div class="sphere-wrap"><div class="sphere" data-sphere>${sphereBalls()}</div><div class="pedestal"></div></div>
      <div class="stage-info"><b data-count>0/90</b>top çekildi</div>
      <div class="current-ball" data-current></div>
      <div class="stage-msg" data-msg></div>
    </div>
    <div class="progress" aria-hidden="true"><i data-progress></i></div>
    <div class="row between small muted"><span data-next></span><span data-players></span></div>
    <div class="panel pad"><div class="section-title">Son 10 Taş</div><div class="last-balls" data-last></div></div>
    <div class="prize-row" data-prizes></div>
    <div class="section-title" style="margin:6px 0 -4px">${state.user ? 'Kartlarım <a class="link" href="#/cards">Tümü</a>' : 'Oyuna Katıl'}</div>
    <div class="cards-list" data-cards>${dotsSpinner()}</div>
    <div class="panel pad"><div class="section-title">Çekilen Sayılar</div><div class="board" data-board></div></div>
  </section>`);

  const board = $('[data-board]', scr);
  board.innerHTML = Array.from({ length: 90 }, (_, i) => `<span data-b="${i + 1}">${i + 1}</span>`).join('');

  const drawnList = () => {
    const g = state.game;
    return g ? g.drawn.slice(0, shown) : [];
  };

  const paintStatic = () => {
    const g = state.game;
    if (!g) return;
    $('[data-gameid]', scr).textContent = `Oyun #${g.id}`;
    $('[data-pill]', scr).innerHTML = statusPill(g.status);
    $('[data-pool]', scr).textContent = fmtTL(g.pool);
    $('[data-prizes]', scr).innerHTML = prizeRow(g);
    $('[data-players]', scr).textContent = `${g.playerCount} oyuncu · ${g.soldCount} kart`;
    const msg = $('[data-msg]', scr);
    if (g.status === 'waiting')
      msg.innerHTML = g.scheduledAt
        ? `Çekilişe <span class="gold" data-cd>${fmtCountdown(g.scheduledAt - serverNow())}</span>`
        : 'Çekiliş yakında başlayacak';
    else if (g.status === 'paused') msg.textContent = 'Çekiliş duraklatıldı';
    else if (g.status === 'finished') {
      const t = g.prizes.tombala;
      msg.innerHTML = t ? `🏆 Tombala: <span class="gold">${esc([...new Set(t.winners.map((w) => w.name))].join(', '))}</span>` : 'Oyun sona erdi';
    } else if (g.status === 'cancelled') msg.textContent = 'Oyun iptal edildi';
    else msg.textContent = '';
    $('[data-current]', scr).hidden = g.status === 'waiting' || !shown;
  };

  const paintDrawn = (popLast = false) => {
    const list = drawnList();
    const last = list[list.length - 1];
    $('[data-count]', scr).textContent = `${list.length}/90`;
    const cur = $('[data-current]', scr);
    cur.innerHTML = last ? `${ball(last, 92, popLast ? 'pop' : '')}<small>Son Çekilen</small>` : '';
    cur.hidden = !last || (state.game && state.game.status === 'waiting');
    const ten = list.slice(-10).reverse();
    let lb = ten.map((n, i) => ball(n, 46, i === 0 && popLast ? 'new' : 'flat')).join('');
    for (let i = ten.length; i < 10; i++) lb += `<span class="slot"></span>`;
    $('[data-last]', scr).innerHTML = lb;
    const set = new Set(list);
    for (const s of $$('span', board)) {
      const n = Number(s.dataset.b);
      s.classList.toggle('on', set.has(n));
      s.classList.toggle('last', n === last && popLast);
    }
    paintCards(set, popLast ? last : null);
  };

  const paintCards = (set, last) => {
    const box = $('[data-cards]', scr);
    if (!state.user) {
      box.innerHTML = `<div class="panel pad stack center-text">
        <b>Sen de oynamak ister misin?</b>
        <span class="small muted">Kayıt ol, kartını seç ve bir sonraki çekilişe katıl.</span>
        <div class="row"><button class="btn btn-gold btn-sm grow" data-go="register">Kayıt Ol</button>
        <button class="btn btn-ghost btn-sm grow" data-go="login">Giriş Yap</button></div></div>`;
      return;
    }
    if (!mine) return;
    const g = state.game;
    if (!mine.cards.length || !g || mine.gameId !== g.id) {
      box.innerHTML = `<div class="panel empty">${icon('cards')}Bu oyunda kartınız yok. Çekilişi izleyebilirsiniz.${
        g && g.status === 'waiting' ? `<br><br><button class="btn btn-gold btn-sm" data-go="select">Kart Satın Al</button>` : ''
      }</div>`;
      return;
    }
    const sorted = mine.cards
      .map((c) => ({ ...c, left: remainingCount(c.grid, set), rows: rowsDone(c.grid, set) }))
      .sort((a, b) => a.left - b.left || a.cardNo - b.cardNo);
    box.innerHTML = sorted.map((c) => cardHTML(c.cardNo, c.grid, { drawnSet: set, last, showProgress: true, compact: sorted.length > 2 })).join('');
  };

  const tick = () => {
    const g = state.game;
    if (!g) return;
    $('[data-timer]', scr).textContent = fmtDuration(gameElapsed());
    const prog = $('[data-progress]', scr);
    const next = $('[data-next]', scr);
    if (g.status === 'running' && g.nextDrawAt) {
      const total = g.drawIntervalSec * 1000;
      const rem = Math.max(0, g.nextDrawAt - serverNow());
      prog.style.width = `${Math.min(100, (1 - rem / total) * 100)}%`;
      next.textContent = rem > 0 ? `Sonraki top: ${Math.ceil(rem / 1000)} sn` : 'Top çekiliyor...';
    } else {
      prog.style.width = g.status === 'finished' ? '100%' : '0%';
      next.textContent = STATUS_LABEL[g.status] || '';
    }
    const cd = $('[data-cd]', scr);
    if (cd && g.scheduledAt) cd.textContent = fmtCountdown(g.scheduledAt - serverNow());
  };

  const onGame = () => {
    const g = state.game;
    if (!g) return;
    paintStatic();
    if (g.drawn.length < shown) {
      // yeni oyun
      shown = g.drawn.length;
      paintDrawn(false);
      return;
    }
    if (g.drawn.length > shown && !animating) {
      if (g.drawn.length - shown > 1) {
        shown = g.drawn.length - 1;
        paintDrawn(false);
      }
      animating = true;
      const sphere = $('[data-sphere]', scr);
      sphere.classList.add('fast');
      sound.draw();
      setTimeout(() => {
        if (!scr.isConnected) return;
        sphere.classList.remove('fast');
        shown = state.game.drawn.length;
        animating = false;
        const n = state.game.drawn[shown - 1];
        paintDrawn(true);
        sound.speak(n);
        if (mine && mine.cards.some((c) => c.grid.flat().includes(n))) {
          setTimeout(() => sound.hit(), 350);
          if (navigator.vibrate) navigator.vibrate(60);
        }
      }, 900);
    }
  };

  const load = async (force) => {
    mine = await fetchMyCards(force).catch(() => ({ cards: [], purchases: [] }));
    if (!scr.isConnected) return;
    paintDrawn(false);
  };

  const soundBtn = $('[data-sound]', scr);
  const syncSound = () => {
    soundBtn.hidden = sound.isUnlocked() || (!state.settings.sfx && !state.settings.speech);
  };
  soundBtn.addEventListener('click', () => {
    sound.unlock();
    sound.speak('Ses açık');
    setTimeout(syncSound, 300);
  });
  syncSound();
  ctx.every(syncSound, 2000);

  paintStatic();
  paintDrawn(false);
  load(true);
  tick();
  ctx.on('game', onGame);
  ctx.on('newgame', () => load(true));
  ctx.on('purchase', () => load(true));
  ctx.on('winner', () => paintStatic());
  ctx.every(tick, 250);
}

// ---------- Geçmiş ----------
function statsBlock(s) {
  return `<div class="stat-grid">
      <div class="stat"><b>${s.games}</b><span>Oyun</span></div>
      <div class="stat"><b>${s.cards}</b><span>Kart</span></div>
      <div class="stat"><b>${s.wins}</b><span>Ödül</span></div>
    </div>
    <div class="row between" style="margin-top:12px"><span class="muted">Toplam kazanç</span><b class="gold">${fmtTL(s.won)}</b></div>
    <div class="row between small" style="margin-top:6px"><span class="muted">Toplam kart harcaması</span><b>${fmtTL(s.spent)}</b></div>`;
}

function screenHistory() {
  const scr = mount(`<section class="screen">
    ${barHead('Geçmiş', 'Katıldığınız oyunlar ve kazançlarınız', 'history', 'home')}
    <div data-body>${dotsSpinner()}</div>
  </section>`);
  run(() => api.get('/history')).then((d) => {
    if (!d || !scr.isConnected) return;
    const body = $('[data-body]', scr);
    const s = d.stats;
    body.innerHTML = `<div class="stack">
      <div class="panel pad">
        ${statsBlock(s)}
      </div>
      ${
        d.games.length
          ? d.games
              .map((g) => {
                const drawn = new Set(g.drawn);
                return `<div class="panel pad stack" data-game="${g.gameId}">
            <div class="row between"><b style="font-size:17px">Oyun #${g.gameId}</b>${statusPill(g.status)}</div>
            <div class="small muted">${fmtDate(g.startedAt || g.createdAt)} · ${g.drawnCount}/90 top</div>
            <div class="row between"><span class="muted">${g.cards.length} kart${g.refunded ? ' (iade edildi)' : ''}</span><b>${fmtTL(g.spent)}</b></div>
            ${
              g.wins.length
                ? `<div class="chips">${g.wins
                    .map((w) => `<span class="card-chip" style="color:#4ade80;border-color:rgba(74,222,128,.4);background:rgba(34,197,94,.1)">${esc(w.label)} · Kart ${w.cardNo} · +${fmtTL(w.amount)}</span>`)
                    .join('')}</div>`
                : ''
            }
            ${g.requests
              .filter((r) => r.status !== 'paid')
              .map((r) => `<div class="row between small"><span class="muted">Talep #${r.id} · ${r.cards.length} kart</span>${statusPill(r.status)}</div>`)
              .join('')}
            ${
              g.cards.length
                ? `<button class="btn btn-ghost btn-sm" data-toggle>${icon('eye')}Kartları Göster</button>
                   <div class="cards-list" data-cards hidden>${g.cards
                     .map((c) => (c.grid ? cardHTML(c.cardNo, c.grid, { drawnSet: drawn, compact: true, showProgress: true }) : ''))
                     .join('')}</div>`
                : ''
            }
          </div>`;
              })
              .join('')
          : `<div class="panel empty">${icon('history')}Henüz bir oyuna katılmadınız.<br><br><button class="btn btn-gold btn-sm" data-go="select">İlk Kartını Al</button></div>`
      }
    </div>`;
    for (const b of $$('[data-toggle]', body)) {
      b.addEventListener('click', () => {
        const list = b.nextElementSibling;
        list.hidden = !list.hidden;
        b.innerHTML = `${icon(list.hidden ? 'eye' : 'eyeOff')}${list.hidden ? 'Kartları Göster' : 'Kartları Gizle'}`;
      });
    }
  });
}

// ---------- 13/16 Kazananlar ----------
function screenWinners(ctx) {
  let range = 'week';
  const scr = mount(`<section class="screen">
    <div class="page-head" style="flex-direction:row;justify-content:center;gap:10px">
      ${icon('trophy', 'gold')}<h1 style="font-size:26px">Kazananlar</h1>
    </div>
    <div class="panel" style="padding:12px">
      <div class="tabs" data-tabs>
        <button data-r="week" class="active">Bu Hafta</button>
        <button data-r="month">Bu Ay</button>
        <button data-r="all">Tüm Zamanlar</button>
      </div>
      <div data-list style="margin-top:12px">${dotsSpinner()}</div>
      <div class="champ-foot">${icon('crown')}Tombalanın Şampiyonları</div>
    </div>
    <div class="panel pad" data-recent></div>
  </section>`);
  $('[data-tabs]', scr).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    range = b.dataset.r;
    for (const x of $$('button', e.currentTarget)) x.classList.toggle('active', x === b);
    load();
  });
  const load = async () => {
    const d = await api.get(`/winners?range=${range}`).catch(() => null);
    if (!d || !scr.isConnected) return;
    const list = $('[data-list]', scr);
    list.innerHTML = d.list.length
      ? d.list
          .map(
            (w, i) => `<div class="rank-item ${i === 0 ? 'top1' : ''}">
          <span class="medal ${i < 3 ? `m${i + 1}` : ''}">${i + 1}</span>
          ${avatar(w, 38)}
          <div class="name ellipsis">${esc(w.name)}<small>${w.count} ödül${w.tombala ? ` · ${w.tombala} tombala` : ''}</small></div>
          <span class="amt">${fmtTL(w.total)}</span>
        </div>`
          )
          .join('')
      : `<div class="empty">${icon('trophy')}Bu dönemde henüz kazanan yok.</div>`;
    $('[data-recent]', scr).innerHTML = `<div class="section-title">Son Kazananlar</div>${
      d.recent.length
        ? `<div class="list">${d.recent
            .map(
              (w) => `<div class="list-item" style="padding:10px 2px">${avatar(w, 34)}<div class="grow"><b class="ellipsis">${esc(
                w.name
              )}</b><div class="tiny muted">${esc(w.label)} · Kart ${w.cardNo} · Oyun #${w.gameId} · ${fmtAgo(w.at)}</div></div><b class="gold nowrap">${fmtTL(
                w.amount
              )}</b></div>`
            )
            .join('')}</div>`
        : `<div class="empty">Henüz kazanan yok.</div>`
    }`;
  };
  load();
  ctx.on('winner', () => setTimeout(load, 600));
}

// ---------- Profil ----------
function screenProfile(ctx) {
  const u = state.user;
  const scr = mount(`<section class="screen">
    <div class="stack" style="align-items:center;text-align:center;gap:8px">
      ${avatar(u, 92)}
      <div><h1 style="font-size:24px" data-name>${esc(u.name)}</h1><div class="muted">@${esc(u.username)} ${
        u.role === 'admin' ? '<span class="role-tag">Yönetici</span>' : ''
      }</div></div>
    </div>
    <div class="panel pad glow row between">
      <div><div class="muted small">Bakiyeniz</div><div class="big-amount gold-text" data-balance>${fmtTL(u.balance)}</div></div>
      <span class="coin" style="width:52px;height:52px;font-size:26px">₺</span>
    </div>
    <p class="small muted center-text" style="margin-top:-6px">Bakiye yüklemek veya çekmek için yöneticiyle iletişime geçin.</p>
    <div class="panel pad" data-stats>${dotsSpinner()}</div>
    <div class="panel">
      ${u.role === 'admin' ? `<button class="set-item" style="width:100%" data-go="admin">${icon('shield')}<span class="grow" style="text-align:left">Admin Paneli</span>${icon('chevron')}</button>` : ''}
      <button class="set-item" style="width:100%" data-go="cards">${icon('cards')}<span class="grow" style="text-align:left">Kartlarım</span>${icon('chevron')}</button>
      <button class="set-item" style="width:100%" data-edit>${icon('edit')}<span class="grow" style="text-align:left">Adımı Düzenle</span>${icon('chevron')}</button>
      <button class="set-item" style="width:100%" data-pass>${icon('key')}<span class="grow" style="text-align:left">Şifre Değiştir</span>${icon('chevron')}</button>
      <button class="set-item" style="width:100%" data-logout>${icon('logout')}<span class="grow red" style="text-align:left">Çıkış Yap</span></button>
    </div>
  </section>`);

  api
    .get('/history')
    .then((d) => {
      if (!scr.isConnected) return;
      const s = d.stats;
      $('[data-stats]', scr).innerHTML = statsBlock(s);
    })
    .catch(() => {});

  $('[data-edit]', scr).addEventListener('click', async () => {
    const v = await formModal({ title: 'Adımı Düzenle', iconName: 'edit', fields: [{ name: 'name', label: 'Ad Soyad', value: state.user.name }] });
    if (!v) return;
    const r = await run(() => api.put('/me', { name: v.name }));
    if (r) {
      state.user = r.user;
      toast('Bilgileriniz güncellendi.', 'success');
      render();
    }
  });
  $('[data-pass]', scr).addEventListener('click', async () => {
    const v = await formModal({
      title: 'Şifre Değiştir',
      iconName: 'key',
      fields: [
        { name: 'current', label: 'Mevcut Şifre', type: 'password' },
        { name: 'next', label: 'Yeni Şifre (en az 6 karakter)', type: 'password' },
      ],
    });
    if (!v) return;
    const r = await run(() => api.put('/me/password', v));
    if (r) toast('Şifreniz değiştirildi.', 'success');
  });
  $('[data-logout]', scr).addEventListener('click', logout);
  ctx.on('user', updateBalances);
}

async function logout() {
  await api.post('/auth/logout').catch(() => {});
  state.user = null;
  state.unread = 0;
  myCardsCache = null;
  live.resetUser();
  go('bye');
}

// ---------- 15/16 Ayarlar ----------
function screenSettings() {
  const s = state.settings;
  const sw = (name, ic, label, sub) => `<label class="set-item">${icon(ic)}<span class="grow">${label}${sub ? `<small>${sub}</small>` : ''}</span>
    <span class="switch"><input type="checkbox" name="${name}" ${s[name] ? 'checked' : ''}/><span></span></span></label>`;
  const scr = mount(`<section class="screen">
    <div class="page-head" style="flex-direction:row;justify-content:center;gap:10px">${icon('gear', 'gold')}<h1 style="font-size:26px">Ayarlar</h1></div>
    <form class="panel" data-form>
      ${sw('notifications', 'bell', 'Bildirimler', 'Oyun ve talep bildirimleri')}
      ${sw('sfx', 'volume', 'Ses Efektleri', 'Çekiliş ve kazanma sesleri')}
      ${sw('music', 'music', 'Müzik', 'Arka plan müziği')}
      ${sw('speech', 'mic', 'Sesli Okuma', 'Çekilen sayıları sesli oku')}
      <label class="set-item">${icon(s.theme === 'light' ? 'sun' : 'moon')}<span class="grow">Tema</span>
        <select name="theme"><option value="dark" ${s.theme !== 'light' ? 'selected' : ''}>Koyu Tema</option><option value="light" ${
          s.theme === 'light' ? 'selected' : ''
        }>Açık Tema</option></select>${icon('down')}</label>
    </form>
    <button class="btn btn-gold btn-block" data-save>Değişiklikleri Kaydet</button>
    <button class="btn btn-ghost btn-block btn-sm" data-test>${icon('volume')}Sesi Test Et</button>
    <p class="center-text tiny dim">Tombala v1.0 · Şans her zaman seninle olsun</p>
  </section>`);
  const form = $('[data-form]', scr);
  $('[data-save]', scr).addEventListener('click', async () => {
    const next = {
      notifications: form.notifications.checked,
      sfx: form.sfx.checked,
      music: form.music.checked,
      speech: form.speech.checked,
      theme: form.theme.value,
    };
    if (next.notifications && 'Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* yoksay */
      }
    }
    saveSettings(next);
    sound.unlock();
    toast('Ayarlarınız kaydedildi.', 'success');
    render();
  });
  $('[data-test]', scr).addEventListener('click', () => {
    sound.unlock();
    sound.setPrefs({ sfx: true, speech: true });
    sound.draw();
    setTimeout(() => sound.speak('Kırk iki'), 900);
    setTimeout(() => sound.setPrefs({ sfx: state.settings.sfx, speech: state.settings.speech, music: state.settings.music }), 1500);
  });
}

// ---------- 16/16 Veda ----------
function screenBye(ctx) {
  mount(`<section class="screen splash no-nav bye" style="justify-content:center;gap:24px" data-go="welcome">
    <div class="brand">
      ${crownSVG(140)}
      <h1 class="logo" style="margin-top:6px">TOMBALA</h1>
      <p class="script" style="margin-top:14px">Şans her zaman<br>seninle olsun...</p>
      <div class="balls" style="margin-top:28px">${ball(7, 70, '', '#1e5bd8')}${ball(90, 92, '', '#1e5bd8')}${ball(5, 70, '', '#1e5bd8')}</div>
    </div>
  </section>`);
  ctx.later(() => go('welcome'), 3200);
}

// =========================================================
// 14/16 Admin Paneli
// =========================================================

function screenAdmin(ctx) {
  const TABS = [
    ['game', 'Oyun Yönetimi'],
    ['users', 'Kullanıcılar'],
    ['payments', 'Ödemeler'],
    ['settings', 'Ayarlar'],
  ];
  let tab = TABS.some((t) => t[0] === ctx.params[0]) ? ctx.params[0] : 'game';
  let payFilter = 'open';
  let userQuery = '';

  const scr = mount(`<section class="screen no-nav">
    ${barHead('Admin Paneli', 'Oyun, kullanıcı ve ödeme yönetimi', 'gear', 'home')}
    <div class="tabs" data-tabs>${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${l}<span data-cnt="${k}"></span></button>`).join('')}</div>
    <div data-body>${dotsSpinner()}</div>
  </section>`);
  const body = $('[data-body]', scr);

  $('[data-tabs]', scr).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    tab = b.dataset.t;
    for (const x of $$('button', e.currentTarget)) x.classList.toggle('active', x === b);
    history.replaceState(null, '', `#/admin/${tab}`);
    body.innerHTML = dotsSpinner();
    refresh();
  });

  const setCount = (n) => {
    const c = $('[data-cnt="payments"]', scr);
    if (c) c.innerHTML = n ? ` <b class="gold">(${n})</b>` : '';
  };

  // ----- Oyun Yönetimi -----
  const renderGame = async () => {
    const o = await run(() => api.get('/admin/overview'));
    if (!o || !scr.isConnected || tab !== 'game') return;
    const g = o.state;
    const st = o.stats;
    setCount(st.pending + st.awaiting);
    const live = g.status === 'running' || g.status === 'paused';
    const toLocalInput = (ts) => {
      if (!ts) return '';
      const d = new Date(ts);
      const p = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    body.innerHTML = `<div class="stack" style="gap:14px"><div class="admin-grid cols">
      <div class="panel pad">
        <div class="admin-row"><span>Oyun</span><b>#${g.id}</b></div>
        <div class="admin-row"><span>Oyun Durumu</span>${statusPill(g.status, g.status === 'running' ? 'Aktif' : undefined)}</div>
        <div class="admin-row"><span>Havuz Tutarı</span><b class="gold">${fmtTL(g.pool)}</b></div>
        <div class="admin-row"><span>Son Çekiliş</span><b>${g.scheduledAt ? fmtDate(g.scheduledAt) : g.startedAt ? fmtDate(g.startedAt) : '-'}</b></div>
        <div class="admin-row"><span>Çekilen Top</span><b>${g.drawn.length}/90</b></div>
        <div class="admin-row"><span>Satılan Kart / Oyuncu</span><b>${g.soldCount} / ${g.playerCount}</b></div>
        <div class="admin-row"><span>Bu Oyunun Geliri</span><b>${fmtTL(st.revenue)}</b></div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-green grow" data-act="start" ${g.status === 'waiting' || g.status === 'paused' ? '' : 'disabled'}>${icon('play')}${
            g.status === 'paused' ? 'Devam Et' : 'Oyun Başlat'
          }</button>
          <button class="btn btn-red grow" data-act="pause" ${g.status === 'running' ? '' : 'disabled'}>${icon('stop')}Oyun Durdur</button>
        </div>
        <div class="row wrap" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm grow" data-act="draw" ${live ? '' : 'disabled'}>${icon('dice')}Top Çek</button>
          <button class="btn btn-ghost btn-sm grow" data-act="cancel" ${['waiting', 'running', 'paused'].includes(g.status) ? '' : 'disabled'}>${icon(
            'ban'
          )}Oyunu İptal Et</button>
          <button class="btn btn-gold btn-sm grow" data-act="new" ${['finished', 'cancelled'].includes(g.status) ? '' : 'disabled'}>${icon('plus')}Yeni Oyun</button>
        </div>
      </div>
      <div class="stack">
        <div class="panel pad">
          <div class="section-title">Çekiliş Zamanı</div>
          ${
            g.status === 'waiting'
              ? `<p class="small muted" style="margin-bottom:10px">Belirlenen saatte, ödemesi tamamlanmış en az bir kart varsa oyun otomatik başlar.</p>
                 <div class="row"><input class="input grow" type="datetime-local" data-at value="${toLocalInput(g.scheduledAt)}" />
                 <button class="btn btn-gold btn-sm" data-act="schedule">Kaydet</button></div>
                 ${g.scheduledAt ? `<button class="link-btn" style="margin-top:8px" data-act="unschedule">Planı kaldır</button>` : ''}`
              : `<p class="small muted">Çekiliş zamanı yalnızca satıştaki (bekleyen) oyun için ayarlanabilir.</p>`
          }
        </div>
        <div class="panel pad"><div class="section-title">Ödüller</div><div class="prize-row">${prizeRow(g)}</div></div>
        <div class="panel pad">
          <div class="stat-grid two">
            <div class="stat"><b>${st.users}</b><span>Kullanıcı</span></div>
            <div class="stat"><b>${st.gamesPlayed}</b><span>Biten Oyun</span></div>
            <div class="stat"><b class="${st.pending + st.awaiting ? 'gold' : ''}">${st.pending} / ${st.awaiting}</b><span>Onay / Ödeme</span></div>
            <div class="stat"><b>${fmtTL(st.totalPaidOut)}</b><span>Dağıtılan Ödül</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="panel pad">
      <div class="section-title">Son Oyunlar</div>
      <div class="list">${o.lastGames
        .map(
          (x) => `<div class="list-item" style="padding:10px 2px"><b style="width:52px">#${x.id}</b><div class="grow small"><div>${statusPill(x.status)}</div>
          <div class="muted tiny" style="margin-top:3px">${x.startedAt ? fmtDate(x.startedAt) : 'Başlamadı'} · ${x.drawn}/90 top${
            x.tombala ? ` · Tombala: ${esc(x.tombala)}` : ''
          }</div></div><b class="gold nowrap">${fmtTL(x.pool)}</b></div>`
        )
        .join('')}</div>
    </div></div>`;

    for (const b of $$('[data-act]', body)) {
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'cancel') {
          const ok = await confirmModal('Oyunu İptal Et', 'Oyun iptal edilecek ve ödenen kart bedelleri oyuncuların bakiyesine iade edilecek. Emin misiniz?', {
            okLabel: 'İptal Et',
            okCls: 'btn-red',
          });
          if (!ok) return;
        }
        if (act === 'new') {
          const ok = await confirmModal('Yeni Oyun', 'Yeni bir oyun oluşturulup kart satışı başlatılacak.', { okLabel: 'Oluştur', iconName: 'plus' });
          if (!ok) return;
        }
        if (act === 'schedule' || act === 'unschedule') {
          const v = act === 'schedule' ? $('[data-at]', body).value : '';
          if (act === 'schedule' && !v) return toast('Lütfen bir tarih ve saat seçin.', 'error');
          const at = v ? new Date(v).getTime() : null;
          const r = await run(() => api.post('/admin/game/schedule', { at }), b);
          if (r) toast(at ? 'Çekiliş zamanı kaydedildi.' : 'Plan kaldırıldı.', 'success');
          return renderGame();
        }
        const r = await run(() => api.post(`/admin/game/${act}`), b);
        if (r) {
          const msg = { start: 'Oyun başlatıldı.', pause: 'Oyun durduruldu.', cancel: 'Oyun iptal edildi.', new: 'Yeni oyun oluşturuldu.', draw: `Çekilen top: ${r.number}` }[act];
          toast(msg, 'success');
          renderGame();
        }
      });
    }
  };

  // ----- Ödemeler -----
  const renderPayments = async () => {
    const [d, o] = await Promise.all([
      run(() => api.get(`/admin/purchases?status=${payFilter === 'all' ? '' : payFilter}`)),
      api.get('/admin/overview').catch(() => null),
    ]);
    if (!d || !scr.isConnected || tab !== 'payments') return;
    if (o) setCount(o.stats.pending + o.stats.awaiting);
    const filters = [
      ['open', 'Açık'],
      ['pending', 'Onay Bekleyen'],
      ['awaiting_payment', 'Ödeme Bekleyen'],
      ['paid', 'Ödenen'],
      ['rejected', 'Reddedilen'],
      ['all', 'Tümü'],
    ];
    body.innerHTML = `<div class="stack">
      <div class="chips">${filters.map(([k, l]) => `<button class="chip ${k === payFilter ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="panel">${
        d.items.length
          ? d.items
              .map(
                (p) => `<div class="req-item">
            <div class="row">${avatar(p, 42)}<div class="grow"><b class="ellipsis">${esc(p.name)}</b><div class="tiny muted">@${esc(p.username)} · Talep #${p.id} · Oyun #${
                  p.gameId
                } · ${fmtAgo(p.createdAt)}</div></div>${statusPill(p.status)}</div>
            <div class="row between"><div class="card-chips" style="justify-content:flex-start">${p.cards
              .map((c) => `<span class="card-chip">${c}</span>`)
              .join('')}</div><b class="gold nowrap" style="font-size:17px">${fmtTL(p.total)}</b></div>
            ${p.paidVia ? `<div class="tiny muted">Ödeme: ${p.paidVia === 'balance' ? 'Bakiyeden' : 'Havale/EFT (manuel onay)'} · ${fmtDate(p.paidAt)}${p.refunded ? ' · İade edildi' : ''}</div>` : ''}
            ${p.reason ? `<div class="tiny muted">Not: ${esc(p.reason)}</div>` : ''}
            ${
              ['pending', 'awaiting_payment'].includes(p.status)
                ? `<div class="req-actions">
                  ${p.status === 'pending' ? `<button class="btn btn-green btn-xs" data-a="approve" data-id="${p.id}">${icon('check')}Onayla</button>` : ''}
                  <button class="btn btn-gold btn-xs" data-a="confirm" data-id="${p.id}">${icon('wallet')}Ödeme Alındı</button>
                  <button class="btn btn-red btn-xs" data-a="reject" data-id="${p.id}">${icon('x')}Reddet</button></div>`
                : ''
            }
          </div>`
              )
              .join('')
          : `<div class="empty">${icon('card')}Bu filtrede talep yok.</div>`
      }</div></div>`;
    for (const c of $$('[data-f]', body))
      c.addEventListener('click', () => {
        payFilter = c.dataset.f;
        renderPayments();
      });
    for (const b of $$('[data-a]', body)) {
      b.addEventListener('click', async () => {
        const a = b.dataset.a;
        let payload = {};
        if (a === 'reject') {
          const v = await formModal({ title: 'Talebi Reddet', iconName: 'x', fields: [{ name: 'reason', label: 'Sebep (isteğe bağlı)' }], submitLabel: 'Reddet' });
          if (!v) return;
          payload = v;
        }
        if (a === 'confirm') {
          const ok = await confirmModal('Ödeme Alındı', 'Bu talebin ödemesini aldığınızı onaylıyor musunuz? Kartlar oyuncu için aktif olacak.', {
            okLabel: 'Onayla',
            okCls: 'btn-green',
            iconName: 'wallet',
          });
          if (!ok) return;
        }
        const r = await run(() => api.post(`/admin/purchases/${b.dataset.id}/${a}`, payload), b);
        if (r) {
          toast({ approve: 'Talep onaylandı, ödeme bekleniyor.', confirm: 'Ödeme onaylandı, kartlar aktif.', reject: 'Talep reddedildi.' }[a], 'success');
          renderPayments();
        }
      });
    }
  };

  // ----- Kullanıcılar -----
  const renderUsers = async () => {
    const d = await run(() => api.get('/admin/users'));
    if (!d || !scr.isConnected || tab !== 'users') return;
    const q = userQuery.toLocaleLowerCase('tr-TR');
    const items = d.items
      .filter((u) => !q || u.name.toLocaleLowerCase('tr-TR').includes(q) || u.username.toLowerCase().includes(q))
      .sort((a, b) => b.id - a.id);
    body.innerHTML = `<div class="stack">
      <label class="field" style="height:46px">${icon('search')}<input data-q placeholder="Kullanıcı ara..." value="${esc(userQuery)}" /></label>
      <div class="small muted">${items.length} kullanıcı</div>
      <div class="panel">${items
        .map(
          (u) => `<div class="user-item">
          <div class="row">${avatar(u, 44)}<div class="grow"><b class="ellipsis">${esc(u.name)}</b>
            <div class="tiny muted">@${esc(u.username)} · ${fmtDate(u.createdAt, false)} · ${u.cards} kart · Kazanç ${fmtTL(u.won)}</div></div>
            <div class="stack" style="gap:4px;align-items:flex-end">${u.role === 'admin' ? '<span class="role-tag">Yönetici</span>' : ''}${
            u.blocked ? '<span class="role-tag blocked">Engelli</span>' : ''
          }</div></div>
          <div class="row between"><span class="muted small">Bakiye</span><b class="gold">${fmtTL(u.balance)}</b></div>
          <div class="req-actions">
            <button class="btn btn-green btn-xs" data-u="add" data-id="${u.id}">${icon('plus')}Bakiye Ekle</button>
            <button class="btn btn-ghost btn-xs" data-u="sub" data-id="${u.id}">${icon('minus')}Bakiye Düş</button>
            ${
              u.id !== state.user.id
                ? `<button class="btn btn-ghost btn-xs" data-u="role" data-id="${u.id}" data-v="${u.role === 'admin' ? 'user' : 'admin'}">${icon('shield')}${
                    u.role === 'admin' ? 'Yetkiyi Al' : 'Yönetici Yap'
                  }</button>
                   <button class="btn ${u.blocked ? 'btn-ghost' : 'btn-red'} btn-xs" data-u="block" data-id="${u.id}" data-v="${u.blocked ? '0' : '1'}">${icon('ban')}${
                    u.blocked ? 'Engeli Kaldır' : 'Engelle'
                  }</button>`
                : ''
            }
            <button class="btn btn-ghost btn-xs" data-u="reset" data-id="${u.id}" data-name="${esc(u.name)}">${icon('key')}Şifre Sıfırla</button>
          </div>
        </div>`
        )
        .join('') || `<div class="empty">Kullanıcı bulunamadı.</div>`}</div></div>`;
    const qi = $('[data-q]', body);
    let qt;
    qi.addEventListener('input', () => {
      clearTimeout(qt);
      qt = setTimeout(() => {
        userQuery = qi.value;
        renderUsers().then(() => {
          const n = $('[data-q]', body);
          if (n) {
            n.focus();
            n.setSelectionRange(n.value.length, n.value.length);
          }
        });
      }, 300);
    });
    for (const b of $$('[data-u]', body)) {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const a = b.dataset.u;
        let r;
        if (a === 'add' || a === 'sub') {
          const v = await formModal({
            title: a === 'add' ? 'Bakiye Ekle' : 'Bakiye Düş',
            iconName: 'wallet',
            fields: [{ name: 'amount', label: 'Tutar (TL)', type: 'number', step: '0.01', placeholder: '0' }],
            submitLabel: a === 'add' ? 'Ekle' : 'Düş',
          });
          if (!v) return;
          const amt = Number(String(v.amount).replace(',', '.'));
          if (!(amt > 0)) return toast('Geçerli bir tutar girin.', 'error');
          r = await run(() => api.patch(`/admin/users/${id}`, { balanceDelta: a === 'add' ? amt : -amt }), b);
          if (r) toast('Bakiye güncellendi.', 'success');
        } else if (a === 'role') {
          r = await run(() => api.patch(`/admin/users/${id}`, { role: b.dataset.v }), b);
          if (r) toast('Yetki güncellendi.', 'success');
        } else if (a === 'block') {
          r = await run(() => api.patch(`/admin/users/${id}`, { blocked: b.dataset.v === '1' }), b);
          if (r) toast(b.dataset.v === '1' ? 'Kullanıcı engellendi.' : 'Engel kaldırıldı.', 'success');
        } else if (a === 'reset') {
          const ok = await confirmModal('Şifre Sıfırla', `${b.dataset.name} için yeni bir geçici şifre oluşturulacak.`, { okLabel: 'Sıfırla', iconName: 'key' });
          if (!ok) return;
          r = await run(() => api.post(`/admin/users/${id}/reset-password`), b);
          if (r)
            modal({
              title: 'Yeni Geçici Şifre',
              iconName: 'key',
              body: `<p class="center-text muted">Bu şifreyi kullanıcıya iletin. Kullanıcı giriş yaptıktan sonra Profil &gt; Şifre Değiştir bölümünden değiştirebilir.</p>
                <div class="center-text gold" style="font-size:28px;font-weight:800;letter-spacing:2px;margin-top:14px">${esc(r.password)}</div>`,
              actions: [{ label: 'Tamam', cls: 'btn-gold' }],
            });
        }
        if (r) renderUsers();
      });
    }
  };

  // ----- Ayarlar -----
  const renderSettings = async () => {
    const d = await run(() => api.get('/admin/settings'));
    if (!d || !scr.isConnected || tab !== 'settings') return;
    const s = d.settings;
    body.innerHTML = `<form class="panel pad stack" data-sform>
      <div class="form-grid">
        <div><label class="label">Kart Bedeli (TL)</label><input class="input" name="cardPrice" type="number" min="1" step="0.01" value="${s.cardPrice}" /></div>
        <div><label class="label">Çekiliş Aralığı (sn)</label><input class="input" name="drawIntervalSec" type="number" min="2" max="120" value="${s.drawIntervalSec}" /></div>
        <div><label class="label">Havuz Modu</label><select class="input" name="poolMode">
          <option value="sales" ${s.poolMode === 'sales' ? 'selected' : ''}>Satışlardan (%)</option>
          <option value="fixed" ${s.poolMode === 'fixed' ? 'selected' : ''}>Sabit Tutar</option></select></div>
        <div data-mode="sales"><label class="label">Havuza Aktarılan (%)</label><input class="input" name="payoutPercent" type="number" min="0" max="100" value="${s.payoutPercent}" /></div>
        <div data-mode="fixed"><label class="label">Sabit Havuz (TL)</label><input class="input" name="fixedPool" type="number" min="0" step="0.01" value="${s.fixedPool}" /></div>
        <div><label class="label">Talep Başına Maks. Kart</label><input class="input" name="maxCardsPerRequest" type="number" min="1" max="100" value="${s.maxCardsPerRequest}" /></div>
      </div>
      <div><div class="label">Ödül Dağılımı (% — toplam 100)</div>
        <div class="form-grid" style="grid-template-columns:repeat(3,1fr)">
          <div><label class="label tiny">1. Çinko</label><input class="input" name="cinko1" type="number" min="0" max="100" value="${s.prizeSplit.cinko1}" /></div>
          <div><label class="label tiny">2. Çinko</label><input class="input" name="cinko2" type="number" min="0" max="100" value="${s.prizeSplit.cinko2}" /></div>
          <div><label class="label tiny">Tombala</label><input class="input" name="tombala" type="number" min="0" max="100" value="${s.prizeSplit.tombala}" /></div>
        </div><div class="hint" data-sum></div></div>
      <label class="set-item" style="padding:6px 0;border:0">${icon('check')}<span class="grow">Otomatik Onay<small>Kart talepleri admin onayı beklemeden ödeme adımına geçer</small></span>
        <span class="switch"><input type="checkbox" name="autoApprove" ${s.autoApprove ? 'checked' : ''}/><span></span></span></label>
      <div><label class="label">Ödeme Bilgileri (oyunculara gösterilir)</label><textarea class="input" name="paymentInfo" maxlength="600">${esc(s.paymentInfo)}</textarea></div>
      <p class="hint">Not: Havuz ve ödül oranları oyun başladığı anda sabitlenir; çalışan oyunu etkilemez.</p>
      <button class="btn btn-gold btn-block" type="submit">Değişiklikleri Kaydet</button>
    </form>`;
    const f = $('[data-sform]', body);
    const sync = () => {
      for (const m of $$('[data-mode]', f)) m.hidden = m.dataset.mode !== f.poolMode.value;
      const sum = Number(f.cinko1.value) + Number(f.cinko2.value) + Number(f.tombala.value);
      const h = $('[data-sum]', f);
      h.textContent = `Toplam: %${sum}`;
      h.style.color = Math.abs(sum - 100) < 0.001 ? '' : '#ff8f91';
    };
    f.addEventListener('input', sync);
    sync();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        cardPrice: f.cardPrice.value,
        drawIntervalSec: f.drawIntervalSec.value,
        poolMode: f.poolMode.value,
        payoutPercent: f.payoutPercent.value,
        fixedPool: f.fixedPool.value,
        maxCardsPerRequest: f.maxCardsPerRequest.value,
        autoApprove: f.autoApprove.checked,
        paymentInfo: f.paymentInfo.value,
        prizeSplit: { cinko1: f.cinko1.value, cinko2: f.cinko2.value, tombala: f.tombala.value },
      };
      const r = await run(() => api.put('/admin/settings', payload), $('button[type=submit]', f));
      if (r) toast('Ayarlar kaydedildi.', 'success');
    });
  };

  const refresh = () => {
    if (tab === 'game') return renderGame();
    if (tab === 'payments') return renderPayments();
    if (tab === 'users') return renderUsers();
    return renderSettings();
  };

  let rt = null;
  const soon = () => {
    if (tab === 'settings') return;
    if (tab === 'users' && document.activeElement && document.activeElement.matches('[data-q]')) return;
    clearTimeout(rt);
    rt = setTimeout(refresh, 400);
  };
  refresh();
  if (tab !== 'game') api.get('/admin/overview').then((o) => setCount(o.stats.pending + o.stats.awaiting)).catch(() => {});
  ctx.on('admin', soon);
  ctx.on('game', () => {
    if (tab === 'game') soon();
  });
  ctx.on('winner', soon);
}

async function loadPendingForAdmin() {
  if (!state.user || state.user.role !== 'admin') return;
  const d = await api.get('/admin/purchases?status=pending').catch(() => null);
  if (!d || !d.items.length) return;
  const known = new Set(adminQueue.map((p) => p.id));
  for (const p of d.items.slice(0, 5).reverse()) if (!known.has(p.id)) adminQueue.push(p);
  showNextAdminRequest();
}

// =========================================================
// Başlat
// =========================================================

async function init() {
  applySettings();
  try {
    const me = await api.get('/me');
    state.user = me.user;
    state.unread = me.unread || 0;
  } catch {
    state.user = null;
  }
  if (!isConfigured) {
    render();
    return;
  }
  setupLive();
  try {
    const g = await api.get('/game');
    state.game = g;
    state.gameRecvAt = Date.now();
    state.serverOffset = g.serverNow - Date.now();
  } catch {
    /* socket ile gelecek */
  }
  window.addEventListener('hashchange', render);
  render();
  if (state.user && state.user.role === 'admin') setTimeout(loadPendingForAdmin, 800);
}

init();
