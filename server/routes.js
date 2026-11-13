'use strict';
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const game = require('./game');

const router = express.Router();
const { GameError, round2 } = game;

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
const TZ_OFFSET = Number(process.env.TZ_OFFSET_MIN ?? 180) * 60000; // Türkiye: UTC+3

function userView(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    balance: u.balance,
    blocked: !!u.blocked,
    createdAt: u.createdAt,
  };
}

// Hataları JSON olarak döndüren sarmalayıcı
const h = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (err) {
    if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Beklenmeyen bir hata oluştu.' });
  }
};

function bad(msg, status = 400) {
  throw new GameError(msg, status);
}

function str(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// ---------- kimlik doğrulama ----------

router.post(
  '/auth/register',
  h((req, res) => {
    const name = str(req.body.name, 40);
    const username = str(req.body.username, 20);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (name.length < 2) bad('Ad Soyad en az 2 karakter olmalı.');
    if (!USERNAME_RE.test(username)) bad('Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ ve .).');
    if (password.length < 6) bad('Şifre en az 6 karakter olmalı.');
    if (db.data.users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
      bad('Bu kullanıcı adı zaten alınmış.', 409);
    const first = db.data.users.length === 0;
    const user = {
      id: db.nextId('user'),
      name,
      username,
      password: auth.hashPassword(password),
      role: first ? 'admin' : 'user',
      balance: 0,
      blocked: false,
      createdAt: Date.now(),
    };
    db.data.users.push(user);
    db.save();
    const { token, ttl } = auth.createSession(user.id, true);
    auth.setCookie(res, token, ttl, true);
    game.notify(user.id, `Hoş geldin ${user.name}! Kartını seç, şansını dene.`, 'info');
    if (first) game.notify(user.id, 'İlk kayıtlı kullanıcı olduğunuz için yönetici yetkisi verildi.', 'info');
    game.adminRefresh();
    return { user: userView(user) };
  })
);

router.post(
  '/auth/login',
  h((req, res) => {
    const username = str(req.body.username, 20);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (auth.tooManyAttempts(key)) bad('Çok fazla hatalı deneme. Lütfen 10 dakika sonra tekrar deneyin.', 429);
    const user = db.data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (!user || !auth.verifyPassword(password, user.password)) {
      auth.recordFailure(key);
      bad('Kullanıcı adı veya şifre hatalı.', 401);
    }
    if (user.blocked) bad('Hesabınız askıya alınmış. Yöneticiyle iletişime geçin.', 403);
    auth.clearFailures(key);
    const remember = !!req.body.remember;
    const { token, ttl } = auth.createSession(user.id, remember);
    auth.setCookie(res, token, ttl, remember);
    return { user: userView(user) };
  })
);

router.post(
  '/auth/logout',
  h((req, res) => {
    auth.destroySession(req.sessionToken);
    auth.clearCookie(res);
    return { ok: true };
  })
);

router.get(
  '/me',
  h((req) => {
    if (!req.user) return { user: null };
    const unread = db.data.notifications.filter((n) => n.userId === req.user.id && !n.read).length;
    return { user: userView(req.user), unread };
  })
);

router.put(
  '/me',
  auth.requireUser,
  h((req) => {
    const name = str(req.body.name, 40);
    if (name.length < 2) bad('Ad Soyad en az 2 karakter olmalı.');
    req.user.name = name;
    db.save();
    return { user: userView(req.user) };
  })
);

router.put(
  '/me/password',
  auth.requireUser,
  h((req) => {
    const { current, next } = req.body || {};
    if (!auth.verifyPassword(String(current || ''), req.user.password)) bad('Mevcut şifre hatalı.');
    if (typeof next !== 'string' || next.length < 6) bad('Yeni şifre en az 6 karakter olmalı.');
    req.user.password = auth.hashPassword(next);
    db.save();
    return { ok: true };
  })
);

// ---------- oyun ----------

router.get('/game', h(() => game.publicState()));

router.get(
  '/game/cards',
  h(() => ({ gameId: game.current().id, cards: game.current().cards }))
);

router.get(
  '/my-cards',
  auth.requireUser,
  h((req) => {
    const g = game.current();
    const purchases = game.gamePurchases(g.id).filter((p) => p.userId === req.user.id);
    const cards = [];
    for (const p of purchases.filter((x) => x.status === 'paid'))
      for (const no of p.cards) cards.push({ cardNo: no, grid: g.cards[no - 1] });
    cards.sort((a, b) => a.cardNo - b.cardNo);
    return { gameId: g.id, cards, purchases: purchases.map(game.purchaseView).reverse() };
  })
);

// ---------- kart talepleri ----------

router.post(
  '/purchases',
  auth.requireUser,
  h((req) => ({ purchase: game.requestCards(req.user, req.body.cards) }))
);

router.get(
  '/purchases/:id',
  auth.requireUser,
  h((req) => {
    const p = db.data.purchases.find((x) => x.id === Number(req.params.id));
    if (!p || (p.userId !== req.user.id && req.user.role !== 'admin')) bad('Talep bulunamadı.', 404);
    return { purchase: game.purchaseView(p), paymentInfo: db.data.settings.paymentInfo, balance: req.user.balance };
  })
);

router.post(
  '/purchases/:id/pay',
  auth.requireUser,
  h((req) => ({ purchase: game.payWithBalance(req.user, req.params.id), balance: req.user.balance }))
);

router.post(
  '/purchases/:id/cancel',
  auth.requireUser,
  h((req) => ({ purchase: game.cancelPurchase(req.user, req.params.id) }))
);

// ---------- geçmiş, kazananlar, bildirimler ----------

router.get(
  '/history',
  auth.requireUser,
  h((req) => {
    const uid = req.user.id;
    const mine = db.data.purchases.filter((p) => p.userId === uid);
    const gameIds = [...new Set(mine.map((p) => p.gameId))].sort((a, b) => b - a);
    const games = gameIds.slice(0, 30).map((gid) => {
      const g = game.getGame(gid);
      const paid = mine.filter((p) => p.gameId === gid && p.status === 'paid');
      const wins = db.data.wins.filter((w) => w.gameId === gid && w.userId === uid);
      return {
        gameId: gid,
        status: g ? g.status : 'unknown',
        createdAt: g ? g.createdAt : null,
        startedAt: g ? g.startedAt : null,
        endedAt: g ? g.endedAt : null,
        drawnCount: g ? g.drawn.length : 0,
        drawn: g ? g.drawn : [],
        cards: paid.flatMap((p) => p.cards.map((no) => ({ cardNo: no, grid: g ? g.cards[no - 1] : null }))),
        spent: round2(paid.reduce((s, p) => s + p.total, 0)),
        refunded: paid.some((p) => p.refunded),
        wins: wins.map((w) => ({ prize: w.prize, label: game.PRIZE_LABEL[w.prize], cardNo: w.cardNo, amount: w.amount })),
        requests: mine
          .filter((p) => p.gameId === gid)
          .map((p) => ({ id: p.id, status: p.status, cards: p.cards, total: p.total, createdAt: p.createdAt })),
      };
    });
    const allWins = db.data.wins.filter((w) => w.userId === uid);
    const allPaid = mine.filter((p) => p.status === 'paid' && !p.refunded);
    return {
      games,
      stats: {
        games: new Set(allPaid.map((p) => p.gameId)).size,
        cards: allPaid.reduce((s, p) => s + p.cards.length, 0),
        spent: round2(allPaid.reduce((s, p) => s + p.total, 0)),
        won: round2(allWins.reduce((s, w) => s + w.amount, 0)),
        wins: allWins.length,
      },
    };
  })
);

function rangeStart(range) {
  const local = new Date(Date.now() + TZ_OFFSET);
  if (range === 'week') {
    const day = (local.getUTCDay() + 6) % 7; // Pazartesi = 0
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day) - TZ_OFFSET;
  }
  if (range === 'month') return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - TZ_OFFSET;
  return 0;
}

router.get(
  '/winners',
  h((req) => {
    const range = ['week', 'month', 'all'].includes(req.query.range) ? req.query.range : 'week';
    const since = rangeStart(range);
    const totals = new Map();
    for (const w of db.data.wins) {
      if (w.at < since) continue;
      const t = totals.get(w.userId) || { userId: w.userId, total: 0, count: 0, tombala: 0 };
      t.total = round2(t.total + w.amount);
      t.count++;
      if (w.prize === 'tombala') t.tombala++;
      totals.set(w.userId, t);
    }
    const list = [...totals.values()]
      .map((t) => {
        const u = db.data.users.find((x) => x.id === t.userId);
        return { ...t, name: u ? u.name : '?', username: u ? u.username : '?' };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 50);
    const recent = db.data.wins
      .slice(-15)
      .reverse()
      .map((w) => {
        const u = db.data.users.find((x) => x.id === w.userId);
        return { ...w, name: u ? u.name : '?', label: game.PRIZE_LABEL[w.prize] };
      });
    return { range, list, recent };
  })
);

router.get(
  '/notifications',
  auth.requireUser,
  h((req) => ({
    items: db.data.notifications
      .filter((n) => n.userId === req.user.id)
      .slice(-50)
      .reverse(),
  }))
);

router.post(
  '/notifications/read',
  auth.requireUser,
  h((req) => {
    for (const n of db.data.notifications) if (n.userId === req.user.id) n.read = true;
    db.save();
    return { ok: true };
  })
);

// ---------- yönetim ----------

const admin = express.Router();
admin.use(auth.requireAdmin);

admin.get(
  '/overview',
  h(() => {
    const g = game.current();
    const purchases = game.gamePurchases(g.id);
    const paid = purchases.filter((p) => p.status === 'paid');
    return {
      state: game.publicState(),
      stats: {
        users: db.data.users.length,
        pending: purchases.filter((p) => p.status === 'pending').length,
        awaiting: purchases.filter((p) => p.status === 'awaiting_payment').length,
        soldCards: paid.reduce((s, p) => s + p.cards.length, 0),
        revenue: round2(paid.reduce((s, p) => s + p.total, 0)),
        totalPaidOut: round2(db.data.wins.reduce((s, w) => s + w.amount, 0)),
        gamesPlayed: db.data.games.filter((x) => x.status === 'finished').length,
      },
      lastGames: db.data.games
        .slice(-6)
        .reverse()
        .map((x) => ({
          id: x.id,
          status: x.status,
          startedAt: x.startedAt,
          endedAt: x.endedAt,
          drawn: x.drawn.length,
          pool: game.poolAmount(x),
          tombala: x.prizes.tombala ? x.prizes.tombala.winners.map((w) => w.name).join(', ') : null,
        })),
    };
  })
);

admin.post('/game/start', h(() => game.startGame()));
admin.post('/game/pause', h(() => game.pauseGame()));
admin.post('/game/cancel', h(() => game.cancelGame()));
admin.post('/game/new', h(() => game.newGame()));
admin.post('/game/draw', h(() => ({ number: game.drawOne() })));
admin.post('/game/schedule', h((req) => game.scheduleGame(req.body.at)));

admin.get(
  '/purchases',
  h((req) => {
    const status = str(req.query.status, 30);
    let list = db.data.purchases;
    if (status === 'open') list = list.filter((p) => ['pending', 'awaiting_payment'].includes(p.status));
    else if (status) list = list.filter((p) => p.status === status);
    return { items: list.slice(-200).reverse().map(game.purchaseView) };
  })
);

admin.post('/purchases/:id/approve', h((req) => ({ purchase: game.approvePurchase(req.params.id) })));
admin.post('/purchases/:id/reject', h((req) => ({ purchase: game.rejectPurchase(req.params.id, req.body.reason) })));
admin.post('/purchases/:id/confirm', h((req) => ({ purchase: game.confirmPayment(req.params.id) })));

admin.get(
  '/users',
  h(() => ({
    items: db.data.users.map((u) => {
      const wins = db.data.wins.filter((w) => w.userId === u.id);
      const paid = db.data.purchases.filter((p) => p.userId === u.id && p.status === 'paid');
      return {
        ...userView(u),
        won: round2(wins.reduce((s, w) => s + w.amount, 0)),
        cards: paid.reduce((s, p) => s + p.cards.length, 0),
      };
    }),
  }))
);

admin.patch(
  '/users/:id',
  h((req) => {
    const u = db.data.users.find((x) => x.id === Number(req.params.id));
    if (!u) bad('Kullanıcı bulunamadı.', 404);
    const b = req.body || {};
    if (b.balanceDelta !== undefined) {
      const d = Number(b.balanceDelta);
      if (!Number.isFinite(d) || d === 0) bad('Geçerli bir tutar girin.');
      if (u.balance + d < 0) bad('Bakiye eksiye düşemez.');
      u.balance = round2(u.balance + d);
      game.emitBalance(u);
      game.notify(
        u.id,
        d > 0
          ? `Bakiyenize ${d.toLocaleString('tr-TR')} TL eklendi.`
          : `Bakiyenizden ${Math.abs(d).toLocaleString('tr-TR')} TL düşüldü.`,
        'info'
      );
    }
    if (b.role !== undefined) {
      if (!['admin', 'user'].includes(b.role)) bad('Geçersiz rol.');
      if (u.id === req.user.id && b.role !== 'admin') bad('Kendi yönetici yetkinizi kaldıramazsınız.');
      u.role = b.role;
    }
    if (b.blocked !== undefined) {
      if (u.id === req.user.id) bad('Kendinizi engelleyemezsiniz.');
      u.blocked = !!b.blocked;
      if (u.blocked) auth.destroyUserSessions(u.id);
    }
    db.save();
    return { user: userView(u) };
  })
);

admin.post(
  '/users/:id/reset-password',
  h((req) => {
    const u = db.data.users.find((x) => x.id === Number(req.params.id));
    if (!u) bad('Kullanıcı bulunamadı.', 404);
    const password = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    u.password = auth.hashPassword(password);
    auth.destroyUserSessions(u.id);
    db.save();
    return { password };
  })
);

admin.get('/settings', h(() => ({ settings: db.data.settings })));

admin.put(
  '/settings',
  h((req) => {
    const b = req.body || {};
    const s = db.data.settings;
    const num = (v, lo, hi, label) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < lo || n > hi) bad(`${label} ${lo} ile ${hi} arasında olmalı.`);
      return n;
    };
    const next = { ...s, prizeSplit: { ...s.prizeSplit } };
    if (b.cardPrice !== undefined) next.cardPrice = round2(num(b.cardPrice, 1, 100000, 'Kart bedeli'));
    if (b.drawIntervalSec !== undefined) next.drawIntervalSec = Math.round(num(b.drawIntervalSec, 2, 120, 'Çekiliş aralığı'));
    if (b.poolMode !== undefined) {
      if (!['sales', 'fixed'].includes(b.poolMode)) bad('Geçersiz havuz modu.');
      next.poolMode = b.poolMode;
    }
    if (b.payoutPercent !== undefined) next.payoutPercent = num(b.payoutPercent, 0, 100, 'Havuz oranı');
    if (b.fixedPool !== undefined) next.fixedPool = round2(num(b.fixedPool, 0, 100000000, 'Sabit havuz'));
    if (b.maxCardsPerRequest !== undefined)
      next.maxCardsPerRequest = Math.round(num(b.maxCardsPerRequest, 1, 100, 'Talep başına kart'));
    if (b.autoApprove !== undefined) next.autoApprove = !!b.autoApprove;
    if (b.paymentInfo !== undefined) next.paymentInfo = String(b.paymentInfo).slice(0, 600);
    if (b.prizeSplit !== undefined) {
      for (const k of game.PRIZES) next.prizeSplit[k] = num(b.prizeSplit[k], 0, 100, `${game.PRIZE_LABEL[k]} oranı`);
      const sum = game.PRIZES.reduce((t, k) => t + next.prizeSplit[k], 0);
      if (Math.abs(sum - 100) > 0.001) bad('Ödül dağılımı toplamı %100 olmalı.');
    }
    db.data.settings = next;
    db.save();
    game.broadcastState();
    return { settings: next };
  })
);

router.use('/admin', admin);

router.use(
  h(() => {
    bad('Bulunamadı.', 404);
  })
);

module.exports = router;
