const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const commonJsFiles = [
  'bot.js',
  'src/app.js',
  'src/config.js',
  'src/services/firebase-store.js',
  'src/services/openai-client.js',
  'src/services/push-service.js',
  'assets/js/task-schedule-utils.js',
  'assets/js/app.js',
  'assets/js/config.js',
  'assets/js/ai-coach.js',
  'assets/js/notifications.js',
];

for (const file of commonJsFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}

const firebaseModule = fs.readFileSync(path.join(root, 'assets/js/firebase-storage.js'), 'utf8');
const moduleCheck = spawnSync(process.execPath, ['--input-type=module', '--check'], {
  encoding: 'utf8',
  input: firebaseModule,
});
if (moduleCheck.status !== 0) {
  process.stderr.write(moduleCheck.stderr);
  process.exit(moduleCheck.status || 1);
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicates.length) throw new Error(`Duplicate HTML ids: ${duplicates.join(', ')}`);

for (const asset of [
  'assets/css/app.css',
  'assets/js/config.js',
  'assets/js/task-schedule-utils.js',
  'assets/js/app.js',
  'assets/js/ai-coach.js',
  'assets/js/notifications.js',
  'assets/js/firebase-storage.js',
  'assets/icons/planner.svg',
]) {
  if (!html.includes(asset)) throw new Error(`index.html is missing ${asset}`);
}

if (/planner-7do3\.onrender\.com/.test(fs.readFileSync(path.join(root, 'assets/js/ai-coach.js'), 'utf8'))) {
  throw new Error('The stale AI Coach server URL is still present.');
}

console.log(`Project checks passed (${commonJsFiles.length + 1} scripts, ${ids.length} HTML ids).`);
