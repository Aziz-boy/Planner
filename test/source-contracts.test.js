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
  const app = read('assets/js/app.js');
  assert.match(storage, /setDoc\(plannerDoc, payload, \{ merge: true \}\)/);
  assert.match(storage, /Cloud is slow — using local data/);
  assert.match(storage, /decodeField/);
  assert.match(storage, /notifyPlannerLoaded/);
  assert.match(app, /Saving automatically/);
  assert.match(app, /window\._saveLocalBackup\?\.\(\{ markClean: false, quiet: true \}\)/);
});

test('legacy task categories cannot crash planner rendering', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /function getCategoryMeta/);
  assert.match(app, /function renderSafely/);
  assert.match(app, /if \(!raw\) return ''/);
  assert.match(app, /\['weekly', renderWeekly\]/);
  assert.doesNotMatch(app, /const c\s*=\s*CATS\[t\.cat\]/);
});

test('focus experience reduces the main navigation and supports minimum days', () => {
  const html = read('index.html');
  const app = read('assets/js/app.js');
  const primaryTabs = [...html.matchAll(/class="ntab[^"\n]*"[^>]*data-sec=/g)];
  assert.equal(primaryTabs.length, 4);
  assert.match(html, /id="moreNavBtn"/);
  assert.match(html, /id="focusModeMinimum"/);
  assert.match(html, /id="quickTaskInput"/);
  assert.match(app, /function renderFocusDashboard/);
  assert.match(app, /function quickAddTodayTask/);
});

test('AI Coach can prioritize live planner data from focus shortcuts', () => {
  const coach = read('assets/js/ai-coach.js');
  assert.match(coach, /window\.openAiCoach/);
  assert.match(coach, /window\.useAiPrompt/);
  assert.match(coach, /exactly 3 realistic priorities/);
  assert.match(coach, /window\.getPlannerCoachContext/);
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

test('Telegram works with both CommonJS and named/default package exports', () => {
  const telegramModule = require('node-telegram-bot-api');
  const TelegramBot = telegramModule.TelegramBot || telegramModule.default || telegramModule;
  assert.equal(typeof TelegramBot, 'function');

  const server = read('src/app.js');
  assert.match(server, /telegramModule\.TelegramBot \|\| telegramModule\.default \|\| telegramModule/);
});

test('browser reminders register the service worker and persist subscriptions', () => {
  const notifications = read('assets/js/notifications.js');
  assert.match(notifications, /serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(notifications, /apiRequest\('\/subscribe'/);
  assert.match(notifications, /apiRequest\('\/unsubscribe'/);
});
