'use strict';
// Basit, bağımlılıksız JSON veri deposu.
// Tüm veri bellekte tutulur ve değişikliklerden sonra diske atomik olarak yazılır.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_SETTINGS = {
  cardPrice: 100, // TL
  drawIntervalSec: 6, // otomatik çekiliş aralığı
  poolMode: 'sales', // 'sales' => satışlardan, 'fixed' => sabit havuz
  payoutPercent: 80, // satış modunda havuza aktarılan yüzde
  fixedPool: 25000, // sabit havuz tutarı (TL)
  prizeSplit: { cinko1: 20, cinko2: 30, tombala: 50 }, // yüzde
  autoApprove: false, // kart taleplerini otomatik onayla
  maxCardsPerRequest: 10,
  paymentInfo:
    'Banka: Örnek Bank\nIBAN: TR00 0000 0000 0000 0000 0000 00\nAlıcı: Tombala\nAçıklama kısmına kullanıcı adınızı yazın.',
};

function defaults() {
  return {
    seq: { user: 0, game: 0, purchase: 0, notification: 0, win: 0 },
    users: [],
    sessions: {},
    games: [],
    purchases: [],
    wins: [],
    notifications: [],
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  };
}

let data = defaults();
let saveTimer = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = Object.assign(defaults(), raw);
    data.seq = Object.assign(defaults().seq, raw.seq || {});
    data.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), raw.settings || {});
    data.settings.prizeSplit = Object.assign({}, DEFAULT_SETTINGS.prizeSplit, (raw.settings || {}).prizeSplit || {});
  }
  return data;
}

function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      flush();
    } catch (err) {
      console.error('Veri kaydedilemedi:', err);
    }
  }, 150);
}

function nextId(kind) {
  data.seq[kind] = (data.seq[kind] || 0) + 1;
  return data.seq[kind];
}

module.exports = {
  load,
  save,
  flush,
  nextId,
  get data() {
    return data;
  },
  DEFAULT_SETTINGS,
};
