'use strict';
// Oyun motoru: oyun durumları, kart talepleri, çekilişler ve ödüller.

const crypto = require('crypto');
const db = require('./db');
const { generateDeck, completedRows } = require('./cards');

const CARD_COUNT = 100;
const PRIZES = ['cinko1', 'cinko2', 'tombala'];
const PRIZE_LABEL = { cinko1: '1. Çinko', cinko2: '2. Çinko', tombala: 'Tombala' };
const PRIZE_ROWS = { cinko1: 1, cinko2: 2, tombala: 3 };
const OPEN_PURCHASE = ['pending', 'awaiting_payment'];
const HOLD_PURCHASE = ['pending', 'awaiting_payment', 'paid'];
const START_DELAY_MS = 4000;

let io = null;

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const settings = () => db.data.settings;
const fmtTL = (n) => `${Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} TL`;

function findUser(id) {
  return db.data.users.find((u) => u.id === id);
}

function current() {
  return db.data.games[db.data.games.length - 1];
}

function getGame(id) {
  return db.data.games.find((g) => g.id === id);
}

function createGame() {
  const game = {
    id: db.nextId('game'),
    status: 'waiting', // waiting | running | paused | finished | cancelled
    createdAt: Date.now(),
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    activeMs: 0,
    resumedAt: null,
    nextDrawAt: null,
    cards: generateDeck(CARD_COUNT),
    drawn: [],
    pool: null,
    prizes: { cinko1: null, cinko2: null, tombala: null },
  };
  db.data.games.push(game);
  db.save();
  return game;
}

// ---------- yardımcılar ----------

function gamePurchases(gameId, statuses) {
  return db.data.purchases.filter((p) => p.gameId === gameId && (!statuses || statuses.includes(p.status)));
}

function takenCards(gameId) {
  const out = [];
  for (const p of gamePurchases(gameId, HOLD_PURCHASE)) out.push(...p.cards);
  return out.sort((a, b) => a - b);
}

function soldCards(gameId) {
  const out = [];
  for (const p of gamePurchases(gameId, ['paid'])) for (const c of p.cards) out.push({ cardNo: c, userId: p.userId });
  return out;
}

function poolAmount(game) {
  if (game.pool != null) return game.pool;
  const s = settings();
  if (s.poolMode === 'fixed') return round2(Number(s.fixedPool) || 0);
  const revenue = gamePurchases(game.id, ['paid']).reduce((sum, p) => sum + p.total, 0);
  return round2((revenue * (Number(s.payoutPercent) || 0)) / 100);
}

function prizeAmounts(game) {
  const pool = poolAmount(game);
  const split = game.prizeSplit || settings().prizeSplit;
  const out = {};
  for (const k of PRIZES) out[k] = round2((pool * (Number(split[k]) || 0)) / 100);
  return out;
}

function elapsedMs(game) {
  return game.activeMs + (game.status === 'running' && game.resumedAt ? Date.now() - game.resumedAt : 0);
}

function publicState(game = current()) {
  const sold = soldCards(game.id);
  return {
    id: game.id,
    status: game.status,
    createdAt: game.createdAt,
    scheduledAt: game.scheduledAt,
    startedAt: game.startedAt,
    endedAt: game.endedAt,
    elapsedMs: elapsedMs(game),
    nextDrawAt: game.nextDrawAt,
    serverNow: Date.now(),
    drawn: game.drawn,
    pool: poolAmount(game),
    prizeAmounts: prizeAmounts(game),
    prizes: game.prizes,
    taken: takenCards(game.id),
    soldCount: sold.length,
    playerCount: new Set(sold.map((s) => s.userId)).size,
    cardCount: CARD_COUNT,
    cardPrice: settings().cardPrice,
    drawIntervalSec: settings().drawIntervalSec,
    maxCardsPerRequest: settings().maxCardsPerRequest,
  };
}

function broadcastState() {
  if (io) io.emit('game:state', publicState());
}

function adminRefresh() {
  if (io) io.to('admins').emit('admin:refresh');
}

function notify(userId, text, type = 'info', extra = {}) {
  const n = { id: db.nextId('notification'), userId, text, type, at: Date.now(), read: false, ...extra };
  db.data.notifications.push(n);
  // kullanıcı başına son 50 bildirimi tut
  const mine = db.data.notifications.filter((x) => x.userId === userId);
  if (mine.length > 50) {
    const drop = new Set(mine.slice(0, mine.length - 50).map((x) => x.id));
    db.data.notifications = db.data.notifications.filter((x) => !drop.has(x.id));
  }
  db.save();
  if (io) io.to(`user:${userId}`).emit('notify', n);
  return n;
}

function emitBalance(user) {
  if (io) io.to(`user:${user.id}`).emit('balance', { balance: user.balance });
}

function purchaseView(p) {
  const u = findUser(p.userId);
  return { ...p, name: u ? u.name : '?', username: u ? u.username : '?' };
}

function emitPurchase(p) {
  if (io) io.to(`user:${p.userId}`).emit('purchase:update', purchaseView(p));
  adminRefresh();
}

// ---------- kart talepleri ----------

function requestCards(user, rawCards) {
  const game = current();
  if (game.status !== 'waiting') throw new GameError('Kart satışı şu an kapalı. Oyun başladı veya sona erdi.');
  const s = settings();
  if (!Array.isArray(rawCards) || rawCards.length === 0) throw new GameError('En az bir kart seçmelisiniz.');
  const cards = [...new Set(rawCards.map(Number))];
  if (cards.some((c) => !Number.isInteger(c) || c < 1 || c > CARD_COUNT)) throw new GameError('Geçersiz kart numarası.');
  if (cards.length > s.maxCardsPerRequest)
    throw new GameError(`Tek seferde en fazla ${s.maxCardsPerRequest} kart alabilirsiniz.`);
  const taken = new Set(takenCards(game.id));
  const conflicts = cards.filter((c) => taken.has(c));
  if (conflicts.length) throw new GameError(`Bu kartlar artık müsait değil: ${conflicts.join(', ')}`, 409);

  const p = {
    id: db.nextId('purchase'),
    gameId: game.id,
    userId: user.id,
    cards: cards.sort((a, b) => a - b),
    unitPrice: s.cardPrice,
    total: round2(s.cardPrice * cards.length),
    status: s.autoApprove ? 'awaiting_payment' : 'pending',
    createdAt: Date.now(),
    approvedAt: s.autoApprove ? Date.now() : null,
    paidAt: null,
    paidVia: null,
  };
  db.data.purchases.push(p);
  db.save();
  if (io && p.status === 'pending') io.to('admins').emit('admin:request', purchaseView(p));
  adminRefresh();
  broadcastState();
  return purchaseView(p);
}

function getPurchase(id) {
  const p = db.data.purchases.find((x) => x.id === Number(id));
  if (!p) throw new GameError('Talep bulunamadı.', 404);
  return p;
}

function approvePurchase(id) {
  const p = getPurchase(id);
  if (p.status !== 'pending') throw new GameError('Bu talep onay beklemiyor.');
  p.status = 'awaiting_payment';
  p.approvedAt = Date.now();
  db.save();
  notify(p.userId, `${p.cards.length} adet kart talebiniz onaylandı. Ödeme bekleniyor (${fmtTL(p.total)}).`, 'info', {
    purchaseId: p.id,
  });
  emitPurchase(p);
  return purchaseView(p);
}

function rejectPurchase(id, reason) {
  const p = getPurchase(id);
  if (!OPEN_PURCHASE.includes(p.status)) throw new GameError('Bu talep artık reddedilemez.');
  p.status = 'rejected';
  p.reason = reason ? String(reason).slice(0, 200) : null;
  p.closedAt = Date.now();
  db.save();
  notify(p.userId, `Kart talebiniz reddedildi.${p.reason ? ' Sebep: ' + p.reason : ''}`, 'error', { purchaseId: p.id });
  emitPurchase(p);
  broadcastState();
  return purchaseView(p);
}

function markPaid(p, via) {
  p.status = 'paid';
  p.paidAt = Date.now();
  p.paidVia = via;
  if (!p.approvedAt) p.approvedAt = p.paidAt;
  db.save();
  notify(p.userId, `Ödemeniz alındı! ${p.cards.length} kartınız oyuna hazır: ${p.cards.join(', ')}`, 'success', {
    purchaseId: p.id,
  });
  emitPurchase(p);
  broadcastState();
  return purchaseView(p);
}

function confirmPayment(id) {
  const p = getPurchase(id);
  if (!OPEN_PURCHASE.includes(p.status)) throw new GameError('Bu talep ödeme beklemiyor.');
  const game = getGame(p.gameId);
  if (!game || game.status !== 'waiting') throw new GameError('Oyun başladığı için bu talep onaylanamaz.');
  return markPaid(p, 'manual');
}

function payWithBalance(user, id) {
  const p = getPurchase(id);
  if (p.userId !== user.id) throw new GameError('Talep bulunamadı.', 404);
  if (p.status !== 'awaiting_payment') throw new GameError('Bu talep ödeme beklemiyor.');
  const game = getGame(p.gameId);
  if (!game || game.status !== 'waiting') throw new GameError('Oyun başladığı için ödeme yapılamaz.');
  if (user.balance < p.total) throw new GameError('Bakiyeniz yetersiz.');
  user.balance = round2(user.balance - p.total);
  emitBalance(user);
  return markPaid(p, 'balance');
}

function cancelPurchase(user, id) {
  const p = getPurchase(id);
  if (p.userId !== user.id) throw new GameError('Talep bulunamadı.', 404);
  if (!OPEN_PURCHASE.includes(p.status)) throw new GameError('Bu talep iptal edilemez.');
  p.status = 'cancelled';
  p.closedAt = Date.now();
  db.save();
  emitPurchase(p);
  broadcastState();
  return purchaseView(p);
}

function cancelOpenRequests(game, why) {
  for (const p of gamePurchases(game.id, OPEN_PURCHASE)) {
    p.status = 'cancelled';
    p.reason = why;
    p.closedAt = Date.now();
    notify(p.userId, `Kart talebiniz iptal edildi: ${why}`, 'error', { purchaseId: p.id });
    emitPurchase(p);
  }
}

// ---------- oyun kontrolü ----------

function startGame() {
  const game = current();
  if (game.status === 'paused') {
    game.status = 'running';
    game.resumedAt = Date.now();
    game.nextDrawAt = Date.now() + 1500;
    db.save();
    broadcastState();
    adminRefresh();
    return publicState(game);
  }
  if (game.status !== 'waiting') throw new GameError('Oyun başlatılamaz. Önce yeni bir oyun oluşturun.');
  const sold = soldCards(game.id);
  if (sold.length === 0) throw new GameError('Ödemesi tamamlanmış kart olmadan oyun başlatılamaz.');
  cancelOpenRequests(game, 'Oyun başladı, satış kapandı.');
  game.pool = poolAmount(game);
  game.prizeSplit = { ...settings().prizeSplit };
  game.status = 'running';
  game.startedAt = Date.now();
  game.resumedAt = game.startedAt;
  game.scheduledAt = null;
  game.nextDrawAt = game.startedAt + START_DELAY_MS;
  db.save();
  for (const uid of new Set(sold.map((s) => s.userId))) {
    notify(uid, 'Oyun başladı! Kartlarınız hazır, bol şans!', 'game');
  }
  if (io) io.emit('game:started', { id: game.id });
  broadcastState();
  adminRefresh();
  return publicState(game);
}

function pauseGame() {
  const game = current();
  if (game.status !== 'running') throw new GameError('Oyun şu an çalışmıyor.');
  game.activeMs = elapsedMs(game);
  game.status = 'paused';
  game.resumedAt = null;
  game.nextDrawAt = null;
  db.save();
  broadcastState();
  adminRefresh();
  return publicState(game);
}

function finishGame(game) {
  game.activeMs = elapsedMs(game);
  game.status = 'finished';
  game.resumedAt = null;
  game.nextDrawAt = null;
  game.endedAt = Date.now();
  db.save();
}

function cancelGame() {
  const game = current();
  if (!['waiting', 'running', 'paused'].includes(game.status)) throw new GameError('Bu oyun iptal edilemez.');
  cancelOpenRequests(game, 'Oyun iptal edildi.');
  for (const p of gamePurchases(game.id, ['paid'])) {
    const u = findUser(p.userId);
    if (!u) continue;
    u.balance = round2(u.balance + p.total);
    p.refunded = true;
    emitBalance(u);
    notify(u.id, `Oyun iptal edildi. ${fmtTL(p.total)} bakiyenize iade edildi.`, 'info');
  }
  game.activeMs = elapsedMs(game);
  game.status = 'cancelled';
  game.resumedAt = null;
  game.nextDrawAt = null;
  game.endedAt = Date.now();
  db.save();
  broadcastState();
  adminRefresh();
  return publicState(game);
}

function newGame() {
  const game = current();
  if (!['finished', 'cancelled'].includes(game.status))
    throw new GameError('Mevcut oyun bitmeden yeni oyun oluşturulamaz.');
  const g = createGame();
  if (io) io.emit('game:new', { id: g.id });
  broadcastState();
  adminRefresh();
  return publicState(g);
}

function scheduleGame(ts) {
  const game = current();
  if (game.status !== 'waiting') throw new GameError('Sadece bekleyen oyun için tarih belirlenebilir.');
  if (ts == null || ts === '') game.scheduledAt = null;
  else {
    const t = Number(ts);
    if (!Number.isFinite(t) || t < Date.now() - 60000) throw new GameError('Geçerli, ileri bir tarih seçin.');
    game.scheduledAt = t;
  }
  db.save();
  broadcastState();
  adminRefresh();
  return publicState(game);
}

function drawOne() {
  const game = current();
  if (!['running', 'paused'].includes(game.status)) throw new GameError('Oyun aktif değil.');
  const drawnSet = new Set(game.drawn);
  const remaining = [];
  for (let n = 1; n <= 90; n++) if (!drawnSet.has(n)) remaining.push(n);
  if (!remaining.length) throw new GameError('Tüm toplar çekildi.');
  const number = remaining[crypto.randomInt(remaining.length)];
  game.drawn.push(number);
  game.lastDrawAt = Date.now();
  game.nextDrawAt = game.status === 'running' ? Date.now() + settings().drawIntervalSec * 1000 : null;
  db.save();
  const events = checkWinners(game);
  if (game.status === 'running' && game.drawn.length >= 90) finishGame(game);
  broadcastState();
  if (io) {
    io.emit('game:draw', { number, count: game.drawn.length });
    for (const e of events) io.emit('game:winner', e);
  }
  if (game.status === 'finished') {
    if (io) io.emit('game:finished', { id: game.id, prizes: game.prizes });
    adminRefresh();
  }
  return number;
}

function checkWinners(game) {
  const drawnSet = new Set(game.drawn);
  const cards = soldCards(game.id).map((c) => ({ ...c, rows: completedRows(game.cards[c.cardNo - 1], drawnSet) }));
  const amounts = prizeAmounts(game);
  const events = [];
  for (const k of PRIZES) {
    if (game.prizes[k]) continue;
    const winners = cards.filter((c) => c.rows >= PRIZE_ROWS[k]);
    if (!winners.length) break; // ödüller sırayla verilir
    const share = Math.floor((amounts[k] * 100) / winners.length) / 100;
    const list = winners.map((w) => {
      const u = findUser(w.userId);
      if (u) {
        u.balance = round2(u.balance + share);
        emitBalance(u);
      }
      db.data.wins.push({
        id: db.nextId('win'),
        gameId: game.id,
        userId: w.userId,
        cardNo: w.cardNo,
        prize: k,
        amount: share,
        at: Date.now(),
      });
      if (u) notify(u.id, `Tebrikler! ${w.cardNo} numaralı kartınızla ${PRIZE_LABEL[k]} yaptınız: ${fmtTL(share)}`, 'win');
      return { userId: w.userId, name: u ? u.name : '?', username: u ? u.username : '?', cardNo: w.cardNo, amount: share };
    });
    game.prizes[k] = { amount: amounts[k], winners: list, drawIndex: game.drawn.length, at: Date.now() };
    db.save();
    events.push({ gameId: game.id, prize: k, label: PRIZE_LABEL[k], winners: list });
  }
  if (game.prizes.tombala) finishGame(game);
  return events;
}

function tick() {
  const game = current();
  if (!game) return;
  const now = Date.now();
  try {
    if (game.status === 'running' && game.nextDrawAt && now >= game.nextDrawAt) {
      drawOne();
    } else if (game.status === 'waiting' && game.scheduledAt && now >= game.scheduledAt) {
      if (soldCards(game.id).length > 0) {
        startGame();
      } else {
        game.scheduledAt = null;
        db.save();
        for (const a of db.data.users.filter((u) => u.role === 'admin'))
          notify(a.id, 'Planlanan oyun başlatılamadı: ödemesi tamamlanmış kart yok.', 'error');
        broadcastState();
        adminRefresh();
      }
    }
  } catch (err) {
    console.error('Oyun döngüsü hatası:', err);
  }
}

function init(_io) {
  io = _io;
  if (!current()) createGame();
  // Sunucu yeniden başladıysa çalışan oyunun zamanlayıcısını düzelt
  const g = current();
  if (g.status === 'running') {
    g.resumedAt = Date.now();
    g.nextDrawAt = Date.now() + START_DELAY_MS;
    db.save();
  }
  setInterval(tick, 300);
}

module.exports = {
  GameError,
  PRIZES,
  PRIZE_LABEL,
  CARD_COUNT,
  init,
  current,
  getGame,
  publicState,
  broadcastState,
  adminRefresh,
  notify,
  emitBalance,
  purchaseView,
  poolAmount,
  prizeAmounts,
  gamePurchases,
  soldCards,
  requestCards,
  approvePurchase,
  rejectPurchase,
  confirmPayment,
  payWithBalance,
  cancelPurchase,
  startGame,
  pauseGame,
  cancelGame,
  newGame,
  scheduleGame,
  drawOne,
  round2,
};
