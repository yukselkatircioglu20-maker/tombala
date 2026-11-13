// Supabase arka ucu.
// Uygulamanın geri kalanı REST benzeri yollar (api.get('/game') gibi) ve olaylar
// (live.on('game:state')) kullanır; bu dosya bunları Supabase RPC çağrılarına,
// Realtime aboneliğine ve kısa aralıklı yoklamaya (polling) çevirir.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY && window.supabase);

const sb = isConfigured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

// ---------------------------------------------------------------------
// Oturum anahtarı ("Beni Hatırla" → localStorage, değilse sessionStorage)
// ---------------------------------------------------------------------

const TOKEN_KEY = 'tb_token';
let memToken = null;

function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || memToken;
  } catch {
    return memToken;
  }
}

function setToken(token, remember) {
  memToken = token || null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    /* gizli sekme: bellekte tut */
  }
}

// ---------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------

function fail(message, status = 400, code) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

async function rpc(fn, args = {}) {
  if (!sb) throw fail('Supabase bağlantısı yapılandırılmamış.', 0);
  let res;
  try {
    res = await sb.rpc(fn, args);
  } catch {
    throw fail('Sunucuya ulaşılamıyor. İnternet bağlantınızı kontrol edin.', 0);
  }
  const { data, error } = res;
  if (error) {
    const msg = String(error.message || '');
    if (error.code === 'TB401') throw fail(msg, 401, error.code);
    if (error.code === 'TB403') throw fail(msg, 403, error.code);
    if (error.code === 'PGRST202' || error.code === '42883')
      throw fail('Veritabanı kurulmamış: supabase/schema.sql dosyasını Supabase SQL Editor\'de çalıştırın.', 500, error.code);
    if (!error.code && /fetch|network|load failed/i.test(msg))
      throw fail('Sunucuya ulaşılamıyor. İnternet bağlantınızı kontrol edin.', 0);
    throw fail(msg || 'İstek başarısız.', 400, error.code);
  }
  return data;
}

// ---------------------------------------------------------------------
// Yollar → RPC eşlemesi
// ---------------------------------------------------------------------

const T = () => getToken();

function track(purchase) {
  if (purchase && purchaseStatus) purchaseStatus.set(purchase.id, purchase.status);
  return purchase;
}

const ROUTES = [
  [
    'POST',
    /^\/auth\/register$/,
    async (_m, b) => {
      const d = await rpc('tb_register', { p_name: b.name, p_username: b.username, p_password: b.password });
      setToken(d.token, true);
      return { user: d.user };
    },
  ],
  [
    'POST',
    /^\/auth\/login$/,
    async (_m, b) => {
      const d = await rpc('tb_login', { p_username: b.username, p_password: b.password, p_remember: !!b.remember });
      if (d.error) throw fail(d.error, 401);
      setToken(d.token, !!b.remember);
      return { user: d.user };
    },
  ],
  [
    'POST',
    /^\/auth\/logout$/,
    async () => {
      const t = T();
      setToken(null);
      if (t) await rpc('tb_logout', { p_token: t }).catch(() => {});
      return { ok: true };
    },
  ],
  ['GET', /^\/me$/, () => (T() ? rpc('tb_me', { p_token: T() }) : { user: null })],
  ['PUT', /^\/me$/, (_m, b) => rpc('tb_update_me', { p_token: T(), p_name: b.name })],
  ['PUT', /^\/me\/password$/, (_m, b) => rpc('tb_change_password', { p_token: T(), p_current: b.current, p_next: b.next })],
  [
    'GET',
    /^\/game$/,
    async () => {
      const s = await rpc('tb_state');
      noteState(s);
      return s;
    },
  ],
  ['GET', /^\/game\/cards$/, () => rpc('tb_deck')],
  ['GET', /^\/my-cards$/, () => rpc('tb_my_cards', { p_token: T() })],
  [
    'POST',
    /^\/purchases$/,
    async (_m, b) => {
      const d = await rpc('tb_request_cards', { p_token: T(), p_cards: b.cards });
      track(d.purchase);
      return d;
    },
  ],
  [
    'GET',
    /^\/purchases\/(\d+)$/,
    async (m) => {
      const d = await rpc('tb_purchase', { p_token: T(), p_id: Number(m[1]) });
      track(d.purchase);
      return d;
    },
  ],
  [
    'POST',
    /^\/purchases\/(\d+)\/pay$/,
    async (m) => {
      const d = await rpc('tb_pay', { p_token: T(), p_id: Number(m[1]) });
      track(d.purchase);
      lastBalance = Number(d.balance);
      return d;
    },
  ],
  [
    'POST',
    /^\/purchases\/(\d+)\/cancel$/,
    async (m) => {
      const d = await rpc('tb_cancel_purchase', { p_token: T(), p_id: Number(m[1]) });
      track(d.purchase);
      return d;
    },
  ],
  ['GET', /^\/history$/, () => rpc('tb_history', { p_token: T() })],
  ['GET', /^\/winners(?:\?range=(\w+))?$/, (m) => rpc('tb_winners', { p_range: m[1] || 'week' })],
  ['GET', /^\/notifications$/, () => rpc('tb_notifications', { p_token: T() })],
  ['POST', /^\/notifications\/read$/, () => rpc('tb_notifications_read', { p_token: T() })],
  ['GET', /^\/admin\/overview$/, () => rpc('tb_admin_overview', { p_token: T() })],
  [
    'POST',
    /^\/admin\/game\/(start|pause|cancel|new|draw)$/,
    async (m) => {
      const d = await rpc('tb_admin_game', { p_token: T(), p_action: m[1] });
      if (d && d.id) noteState(d);
      else pollState();
      return d;
    },
  ],
  [
    'POST',
    /^\/admin\/game\/schedule$/,
    async (_m, b) => {
      const d = await rpc('tb_admin_schedule', { p_token: T(), p_at: b.at == null ? null : Math.round(b.at) });
      noteState(d);
      return d;
    },
  ],
  ['GET', /^\/admin\/purchases(?:\?status=(\w*))?$/, (m) => rpc('tb_admin_purchases', { p_token: T(), p_status: m[1] || '' })],
  [
    'POST',
    /^\/admin\/purchases\/(\d+)\/(approve|reject|confirm|cancel)$/,
    (m, b) =>
      rpc('tb_admin_purchase_action', { p_token: T(), p_id: Number(m[1]), p_action: m[2], p_reason: (b && b.reason) || null }),
  ],
  ['GET', /^\/admin\/users$/, () => rpc('tb_admin_users', { p_token: T() })],
  [
    'PATCH',
    /^\/admin\/users\/(\d+)$/,
    (m, b) =>
      rpc('tb_admin_update_user', {
        p_token: T(),
        p_id: Number(m[1]),
        p_balance_delta: b.balanceDelta == null ? null : Number(b.balanceDelta),
        p_role: b.role == null ? null : b.role,
        p_blocked: b.blocked == null ? null : !!b.blocked,
      }),
  ],
  ['POST', /^\/admin\/users\/(\d+)\/reset-password$/, (m) => rpc('tb_admin_reset_password', { p_token: T(), p_id: Number(m[1]) })],
  ['GET', /^\/admin\/settings$/, () => rpc('tb_admin_settings', { p_token: T() })],
  ['PUT', /^\/admin\/settings$/, (_m, b) => rpc('tb_admin_update_settings', { p_token: T(), p: b })],
];

async function request(method, url, body) {
  for (const [m, re, fn] of ROUTES) {
    if (m !== method) continue;
    const match = url.match(re);
    if (match) return fn(match, body || {});
  }
  throw fail(`Bilinmeyen istek: ${method} ${url}`, 404);
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
};

// ---------------------------------------------------------------------
// Canlı olaylar
// ---------------------------------------------------------------------

const handlers = new Map();
function emit(ev, data) {
  for (const fn of handlers.get(ev) || []) {
    try {
      fn(data);
    } catch (err) {
      console.error(err);
    }
  }
}

const LABEL = { cinko1: '1. Çinko', cinko2: '2. Çinko', tombala: 'Tombala' };
const isObj = (v) => v && typeof v === 'object';
const num = (v) => (v == null ? null : Number(v));

let cur = null; // son oyun durumu
let lastRow = null; // Realtime'dan gelen son ham satır
let offset = 0; // sunucu saati - istemci saati
let rtStatus = 'CLOSED';
let channel = null;
let lastStatePoll = 0;
let lastTick = 0;
let lastUpdateAt = 0; // son yeni durumun alındığı an (istemci saati)

function noteState(s) {
  if (!s || s.id == null) return;
  if (s.serverNow) offset = s.serverNow - Date.now();
  applyState(s);
}

function rowToState(row) {
  const serverNow = Date.now() + offset;
  const status = row.status;
  return {
    id: Number(row.id),
    status,
    createdAt: num(row.created_ms),
    scheduledAt: num(row.scheduled_ms),
    startedAt: num(row.started_ms),
    endedAt: num(row.ended_ms),
    elapsedMs: Number(row.active_ms || 0) + (status === 'running' && row.resumed_ms ? serverNow - Number(row.resumed_ms) : 0),
    nextDrawAt: num(row.next_draw_ms),
    serverNow,
    drawn: (row.drawn || []).map(Number),
    pool: Number(row.pool || 0),
    prizeAmounts: row.prize_amounts || { cinko1: 0, cinko2: 0, tombala: 0 },
    prizes: row.prizes || { cinko1: null, cinko2: null, tombala: null },
    taken: (row.taken || []).map(Number),
    soldCount: Number(row.sold_count || 0),
    playerCount: Number(row.player_count || 0),
    cardCount: 100,
    cardPrice: Number(row.card_price || 0),
    drawIntervalSec: Number(row.draw_interval_sec || 6),
    maxCardsPerRequest: Number(row.max_cards_per_request || 10),
    updatedAt: num(row.updated_ms),
  };
}

function applyState(s) {
  if (cur) {
    if (s.id < cur.id) return;
    if (s.id === cur.id && s.updatedAt != null && cur.updatedAt != null && s.updatedAt <= cur.updatedAt) return;
  }
  const prev = cur;
  cur = s;
  lastUpdateAt = Date.now();
  emit('game:state', s);
  if (!prev) return;
  if (prev.id !== s.id) {
    emit('game:new', { id: s.id });
    return;
  }
  if (s.drawn.length > prev.drawn.length) emit('game:draw', { number: s.drawn[s.drawn.length - 1], count: s.drawn.length });
  for (const k of ['cinko1', 'cinko2', 'tombala']) {
    if (!isObj(prev.prizes && prev.prizes[k]) && isObj(s.prizes && s.prizes[k])) {
      emit('game:winner', { gameId: s.id, prize: k, label: LABEL[k], winners: s.prizes[k].winners || [] });
    }
  }
  if (prev.status === 'waiting' && s.status === 'running') emit('game:started', { id: s.id });
  if (prev.status !== 'finished' && s.status === 'finished') emit('game:finished', { id: s.id, prizes: s.prizes });
}

async function pollState() {
  lastStatePoll = Date.now();
  try {
    noteState(await rpc('tb_state'));
  } catch {
    /* bir sonraki denemede */
  }
}

function startRealtime() {
  if (!sb || channel) return;
  channel = sb
    .channel('tombala-oyun')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, (payload) => {
      const row = payload && payload.new;
      if (!row || row.id == null) return;
      const merged = lastRow && Number(lastRow.id) === Number(row.id) ? { ...lastRow, ...row } : row;
      lastRow = merged;
      applyState(rowToState(merged));
    })
    .subscribe((status) => {
      rtStatus = status;
      if (status === 'SUBSCRIBED') pollState();
    });
}

// Oyun durumu yedek yoklaması + zamanı geçmiş top için yedek tetikleme
function stateLoop() {
  const now = Date.now();
  const live = rtStatus === 'SUBSCRIBED';
  let every = live ? 20000 : document.hidden ? 6000 : 2000;
  // Oyun sürerken beklenen güncelleme gelmediyse (Realtime sessiz kaldıysa) hemen yokla
  if (cur && cur.status === 'running' && now - lastUpdateAt > cur.drawIntervalSec * 1000 + 2500) every = 2000;
  if (now - lastStatePoll >= every) pollState();
  if (cur) {
    const sNow = now + offset;
    const overdue =
      (cur.status === 'running' && cur.nextDrawAt && sNow > cur.nextDrawAt + 1200) ||
      (cur.status === 'waiting' && cur.scheduledAt && sNow > cur.scheduledAt + 1200);
    if (overdue && now - lastTick > 1500) {
      lastTick = now;
      rpc('tb_tick')
        .then(() => {
          if (!live) pollState();
        })
        .catch(() => {});
    }
  }
}

// ---------- oturum açmış kullanıcı için yoklama ----------

let seenNotif = null;
let purchaseStatus = null;
let seenPending = null;
let adminVersion = null;
let lastBalance = null;
let userInit = false;
let userTimer = null;
let polling = false;

async function pollUser() {
  const t = getToken();
  if (!t || !sb || polling) return;
  polling = true;
  let d;
  try {
    d = await rpc('tb_poll', { p_token: t });
  } catch (e) {
    if (e.status === 401 && getToken() === t) {
      setToken(null);
      emit('auth:lost');
    }
    return;
  } finally {
    polling = false;
  }
  if (getToken() !== t) return;
  const first = !userInit;
  userInit = true;
  if (d.user) {
    const bal = Number(d.user.balance);
    if (!first && lastBalance !== null && bal !== lastBalance) emit('balance', { balance: bal });
    lastBalance = bal;
  }
  for (const n of d.notifications || []) {
    if (seenNotif.has(n.id)) continue;
    seenNotif.add(n.id);
    if (!first && !n.read) emit('notify', n);
  }
  emit('unread', Number(d.unread || 0));
  for (const p of d.purchases || []) {
    const prev = purchaseStatus.get(p.id);
    purchaseStatus.set(p.id, p.status);
    if (!first && prev !== undefined && prev !== p.status) emit('purchase:update', p);
  }
  if (d.admin) {
    for (const p of d.admin.pending || []) {
      if (seenPending.has(p.id)) continue;
      seenPending.add(p.id);
      if (!first) emit('admin:request', p);
    }
    if (adminVersion !== null && adminVersion !== d.admin.version) emit('admin:refresh');
    adminVersion = d.admin.version;
  }
}

function scheduleUserPoll() {
  clearTimeout(userTimer);
  userTimer = setTimeout(async () => {
    await pollUser();
    scheduleUserPoll();
  }, document.hidden ? 10000 : 3000);
}

export const live = {
  on(ev, fn) {
    if (!handlers.has(ev)) handlers.set(ev, new Set());
    handlers.get(ev).add(fn);
    return () => handlers.get(ev).delete(fn);
  },
  start() {
    if (!sb) return;
    startRealtime();
    setInterval(stateLoop, 500);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        pollState();
        pollUser();
      }
    });
    this.resetUser();
  },
  // Giriş/çıkış sonrası kullanıcıya özel önbellekleri sıfırla
  resetUser() {
    seenNotif = new Set();
    purchaseStatus = new Map();
    seenPending = new Set();
    adminVersion = null;
    lastBalance = null;
    userInit = false;
    pollUser();
    scheduleUserPoll();
  },
  serverNow() {
    return Date.now() + offset;
  },
  // Realtime bağlantı durumu (hata ayıklama için)
  status() {
    return rtStatus;
  },
};
