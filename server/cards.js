'use strict';
// Geleneksel tombala kartı üretimi:
//  - 3 satır x 9 sütun
//  - her satırda tam 5 sayı (toplam 15 sayı)
//  - 1. sütun 1-9, 2. sütun 10-19 ... 9. sütun 80-90
//  - her sütunda en az 1, en fazla 3 sayı; sütun içinde sayılar yukarıdan aşağı artan

const crypto = require('crypto');

const ROWS = 3;
const COLS = 9;
const PER_ROW = 5;

function rand(n) {
  return crypto.randomInt(n);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function columnRange(c) {
  if (c === 0) return [1, 9];
  if (c === 8) return [80, 90];
  return [c * 10, c * 10 + 9];
}

function columnCounts() {
  // Her sütuna 1 sayı, kalan 6 sayıyı (en fazla 3 olacak şekilde) rastgele dağıt
  const counts = new Array(COLS).fill(1);
  let left = ROWS * PER_ROW - COLS;
  while (left > 0) {
    const c = rand(COLS);
    if (counts[c] < ROWS) {
      counts[c]++;
      left--;
    }
  }
  return counts;
}

function layout(counts) {
  // Hangi hücrelerin dolu olacağını belirle (her satır tam 5 hücre)
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  const rowLeft = new Array(ROWS).fill(PER_ROW);
  const order = shuffle([...Array(COLS).keys()]).sort((a, b) => counts[b] - counts[a]);
  for (const c of order) {
    const rows = shuffle([...Array(ROWS).keys()])
      .filter((r) => rowLeft[r] > 0)
      .sort((a, b) => rowLeft[b] - rowLeft[a]);
    if (rows.length < counts[c]) return null;
    for (let i = 0; i < counts[c]; i++) {
      grid[rows[i]][c] = true;
      rowLeft[rows[i]]--;
    }
  }
  return rowLeft.every((v) => v === 0) ? grid : null;
}

function generateCard() {
  let mask = null;
  while (!mask) mask = layout(columnCounts());
  const card = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  for (let c = 0; c < COLS; c++) {
    const rows = [];
    for (let r = 0; r < ROWS; r++) if (mask[r][c]) rows.push(r);
    const [lo, hi] = columnRange(c);
    const pool = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    const picked = shuffle(pool).slice(0, rows.length).sort((a, b) => a - b);
    rows.forEach((r, i) => (card[r][c] = picked[i]));
  }
  return card;
}

function generateDeck(count) {
  const seen = new Set();
  const deck = [];
  while (deck.length < count) {
    const card = generateCard();
    const key = card.flat().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    deck.push(card);
  }
  return deck;
}

// Kartta tamamlanan satır sayısı
function completedRows(card, drawnSet) {
  let done = 0;
  for (const row of card) {
    if (row.every((n) => n === 0 || drawnSet.has(n))) done++;
  }
  return done;
}

module.exports = { generateCard, generateDeck, completedRows, ROWS, COLS };
