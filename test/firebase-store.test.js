const test = require('node:test');
const assert = require('node:assert/strict');

const { safeJSON } = require('../src/services/firebase-store');

test('safeJSON accepts both legacy JSON strings and object fields', () => {
  assert.deepEqual(safeJSON('{"done":true}'), { done: true });
  const objectValue = { saved: 100 };
  assert.equal(safeJSON(objectValue), objectValue);
});

test('safeJSON returns the requested fallback for corrupt data', () => {
  assert.deepEqual(safeJSON('{bad json'), {});
  assert.equal(safeJSON('', null), null);
});
