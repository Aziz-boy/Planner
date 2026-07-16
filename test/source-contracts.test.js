const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('all AI screens use the shared API client', () => {
  const app = read('assets/js/app.js');
  const coach = read('assets/js/ai-coach.js');
  assert.match(app, /apiRequest\('\/generate-plan'/);
  assert.match(app, /apiRequest\('\/plan-studies'/);
  assert.match(app, /apiRequest\('\/summarize-week'/);
  assert.match(coach, /apiRequest\('\/chat'/);
  assert.doesNotMatch(coach, /planner-7do3/);
});

test('cloud sync has a local fallback and merge-safe writes', () => {
  const storage = read('assets/js/firebase-storage.js');
  assert.match(storage, /setDoc\(plannerDoc, payload, \{ merge: true \}\)/);
  assert.match(storage, /Cloud is slow — using local data/);
  assert.match(storage, /decodeField/);
});

test('tracker mutations queue saves and date math stays UTC-safe', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /function saveDietToCloud\(\) \{ scheduleSave\(\); \}/);
  assert.match(app, /function utcDate/);
  assert.doesNotMatch(app, /\.getDay\(\)|\.setDate\(/);
});

test('server exposes health state and accepts planner context for the coach', () => {
  const server = read('src/app.js');
  assert.match(server, /app\.get\('\/health'/);
  assert.match(server, /CURRENT PLANNER DATA/);
  assert.match(server, /express\.json\(\{ limit: '256kb' \}\)/);
});

test('browser reminders register the service worker and persist subscriptions', () => {
  const notifications = read('assets/js/notifications.js');
  assert.match(notifications, /serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(notifications, /apiRequest\('\/subscribe'/);
  assert.match(notifications, /apiRequest\('\/unsubscribe'/);
});
