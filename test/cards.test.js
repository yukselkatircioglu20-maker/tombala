'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generateCard, generateDeck, completedRows } = require('../server/cards');

test('kartlar geleneksel tombala kurallarına uyar', () => {
  for (let i = 0; i < 2000; i++) {
    const card = generateCard();
    assert.strictEqual(card.length, 3);
    for (const row of card) {
      assert.strictEqual(row.length, 9);
      assert.strictEqual(row.filter(Boolean).length, 5, 'her satırda 5 sayı');
    }
    const nums = card.flat().filter(Boolean);
    assert.strictEqual(nums.length, 15);
    assert.strictEqual(new Set(nums).size, 15, 'tekrar eden sayı yok');
    for (let c = 0; c < 9; c++) {
      const col = card.map((r) => r[c]).filter(Boolean);
      assert.ok(col.length >= 1 && col.length <= 3, 'her sütunda 1-3 sayı');
      const lo = c === 0 ? 1 : c * 10;
      const hi = c === 0 ? 9 : c === 8 ? 90 : c * 10 + 9;
      for (const n of col) assert.ok(n >= lo && n <= hi, `sütun aralığı: ${n} @ ${c}`);
      for (let k = 1; k < col.length; k++) assert.ok(col[k] > col[k - 1], 'sütun yukarıdan aşağı artan');
    }
  }
});

test('deste benzersiz kartlardan oluşur', () => {
  const deck = generateDeck(100);
  assert.strictEqual(deck.length, 100);
  assert.strictEqual(new Set(deck.map((c) => c.flat().join(','))).size, 100);
});

test('tamamlanan satırlar doğru sayılır', () => {
  const card = generateCard();
  const drawn = new Set();
  assert.strictEqual(completedRows(card, drawn), 0);
  card[0].filter(Boolean).forEach((n) => drawn.add(n));
  assert.strictEqual(completedRows(card, drawn), 1);
  card.flat().filter(Boolean).forEach((n) => drawn.add(n));
  assert.strictEqual(completedRows(card, drawn), 3);
});
