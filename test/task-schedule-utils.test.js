const test = require('node:test');
const assert = require('node:assert/strict');
const { getRepeatDateKeys, mergeSchedules } = require('../assets/js/task-schedule-utils.js');

test('rest of week includes every selected day through Sunday', () => {
  assert.deepEqual(
    getRepeatDateKeys('2026-07-13', 'week', [0,1,2,3,4,5,6], '2026-12-31'),
    ['2026-07-13','2026-07-14','2026-07-15','2026-07-16','2026-07-17','2026-07-18','2026-07-19'],
  );
});

test('rest of month begins on the selected date, not today', () => {
  const dates = getRepeatDateKeys('2026-07-19', 'month', [0,1,2,3,4,5,6], '2026-12-31');
  assert.equal(dates[0], '2026-07-19');
  assert.equal(dates.at(-1), '2026-07-31');
  assert.equal(dates.length, 13);
});

test('repeat day filters support weekdays without silently forcing them', () => {
  assert.deepEqual(
    getRepeatDateKeys('2026-07-19', 'next7', [1,2,3,4,5], '2026-12-31'),
    ['2026-07-20','2026-07-21','2026-07-22','2026-07-23','2026-07-24'],
  );
});

test('safe merge preserves existing tasks and skips matching duplicates', () => {
  const existing = [
    { id:'quran', cat:'quran', time:'07:00', text:'Read Quran' },
    { id:'work', cat:'work', time:'09:00', text:'Existing work' },
  ];
  const incoming = [
    { id:'quran-copy', cat:'quran', time:'07:00', text:'Read Quran' },
    { id:'work', cat:'study', time:'20:00', text:'Study session' },
  ];
  const merged = mergeSchedules(existing, incoming, '2026-07-20');
  assert.equal(merged.length, 3);
  assert.equal(merged.filter(task => task.text === 'Read Quran').length, 1);
  assert.match(merged.find(task => task.text === 'Study session').id, /^work_20260720_/);
});
