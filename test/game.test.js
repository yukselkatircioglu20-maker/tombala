'use strict';
// Sunucuyu geçici bir veri klasörüyle başlatıp tam oyun akışını test eder.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}/api`;
let proc;
let dir;

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b = {}) => call('POST', u, b),
    put: (u, b = {}) => call('PUT', u, b),
    patch: (u, b = {}) => call('PATCH', u, b),
  };
}

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tombala-test-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/game`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('sunucu başlamadı');
});

test.after(() => {
  if (proc) proc.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tam oyun akışı: kayıt, talep, onay, ödeme, çekiliş, ödüller', async () => {
  const admin = client();
  const ahmet = client();
  const ayse = client();

  let r = await admin.post('/auth/register', { name: 'Yönetici', username: 'admin', password: 'secret12' });
  assert.strictEqual(r.data.user.role, 'admin', 'ilk kullanıcı yönetici olur');
  r = await ahmet.post('/auth/register', { name: 'Ahmet Yılmaz', username: 'ahmet', password: 'secret12' });
  assert.strictEqual(r.data.user.role, 'user');
  await ayse.post('/auth/register', { name: 'Ayşe Demir', username: 'ayse', password: 'secret12' });

  r = await ahmet.post('/auth/register', { name: 'Başka Biri', username: 'AHMET', password: 'secret12' });
  assert.strictEqual(r.status, 409, 'kullanıcı adı benzersiz');

  r = await ahmet.get('/admin/overview');
  assert.strictEqual(r.status, 403, 'normal kullanıcı admin API kullanamaz');

  // kart talebi
  r = await ahmet.post('/purchases', { cards: [1, 2, 3] });
  assert.strictEqual(r.data.purchase.status, 'pending');
  const p1 = r.data.purchase.id;
  r = await ayse.post('/purchases', { cards: [3, 4] });
  assert.strictEqual(r.status, 409, 'alınmış kart tekrar alınamaz');
  r = await ayse.post('/purchases', { cards: [4, 5] });
  const p2 = r.data.purchase.id;

  r = await admin.post('/admin/game/start');
  assert.strictEqual(r.status, 400, 'ödenmiş kart olmadan oyun başlamaz');

  // onay + bakiyeden ödeme
  await admin.post(`/admin/purchases/${p1}/approve`);
  r = await ahmet.post(`/purchases/${p1}/pay`);
  assert.strictEqual(r.status, 400, 'yetersiz bakiye');
  const users = (await admin.get('/admin/users')).data.items;
  const ahmetId = users.find((u) => u.username === 'ahmet').id;
  await admin.patch(`/admin/users/${ahmetId}`, { balanceDelta: 1000 });
  r = await ahmet.post(`/purchases/${p1}/pay`);
  assert.strictEqual(r.data.purchase.status, 'paid');
  assert.strictEqual(r.data.balance, 700);

  // manuel ödeme onayı
  r = await admin.post(`/admin/purchases/${p2}/confirm`);
  assert.strictEqual(r.data.purchase.status, 'paid');

  // açık talep oyun başlayınca iptal olur
  r = await ayse.post('/purchases', { cards: [50] });
  const p3 = r.data.purchase.id;

  r = await admin.post('/admin/game/start');
  assert.strictEqual(r.data.status, 'running');
  assert.strictEqual(r.data.pool, 400, '5 kart x 100 TL x %80');
  r = await ayse.get(`/purchases/${p3}`);
  assert.strictEqual(r.data.purchase.status, 'cancelled');
  r = await ayse.post('/purchases', { cards: [60] });
  assert.strictEqual(r.status, 400, 'oyun sırasında satış kapalı');

  await admin.post('/admin/game/pause');
  for (let i = 0; i < 90; i++) {
    r = await admin.post('/admin/game/draw');
    if (r.status !== 200) break;
  }
  const g = (await admin.get('/game')).data;
  assert.strictEqual(g.status, 'finished');
  for (const k of ['cinko1', 'cinko2', 'tombala']) assert.ok(g.prizes[k], `${k} verildi`);
  assert.ok(g.prizes.cinko1.drawIndex <= g.prizes.cinko2.drawIndex);
  assert.ok(g.prizes.cinko2.drawIndex <= g.prizes.tombala.drawIndex);

  // ödenen toplam ödül havuzu aşamaz, bakiyeler tutarlı
  const totalPaid = ['cinko1', 'cinko2', 'tombala'].reduce((s, k) => s + g.prizes[k].winners.reduce((t, w) => t + w.amount, 0), 0);
  assert.ok(totalPaid <= 400 + 1e-9);
  const after = (await admin.get('/admin/users')).data.items;
  const sumBalances = after.reduce((s, u) => s + u.balance, 0);
  assert.ok(Math.abs(sumBalances - (700 + totalPaid)) < 0.01, 'bakiyeler = başlangıç + ödüller');

  r = await admin.post('/admin/game/new');
  assert.strictEqual(r.data.status, 'waiting');
  assert.strictEqual(r.data.taken.length, 0);
});

test('oturum: hatalı şifre ve çıkış', async () => {
  const c = client();
  let r = await c.post('/auth/login', { username: 'ahmet', password: 'yanlis' });
  assert.strictEqual(r.status, 401);
  r = await c.post('/auth/login', { username: 'ahmet', password: 'secret12', remember: true });
  assert.strictEqual(r.data.user.username, 'ahmet');
  r = await c.get('/me');
  assert.strictEqual(r.data.user.username, 'ahmet');
  await c.post('/auth/logout');
  r = await c.get('/me');
  assert.strictEqual(r.data.user, null);
});
