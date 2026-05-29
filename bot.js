require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const PORT      = process.env.PORT || 3000;
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');

if (!TOKEN || !CHAT_ID) {
  console.error('❌  TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required in .env');
  process.exit(1);
}

// ── Telegram bot (polling) ────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });

// ── Web Push setup ────────────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── Push subscription store (JSON file) ──────────────────────────────────────
function loadSubs() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); }
  catch { return []; }
}
function saveSubs(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

// ── Send helpers ──────────────────────────────────────────────────────────────
function tg(text) {
  bot.sendMessage(CHAT_ID, text, { parse_mode: 'HTML' })
    .catch(err => console.error('TG error:', err.message));
}

function push(title, body) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const subs = loadSubs();
  const payload = JSON.stringify({ title, body });
  subs.forEach(sub => {
    webpush.sendNotification(sub, payload).catch(err => {
      // Remove dead subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        const updated = loadSubs().filter(s => s.endpoint !== sub.endpoint);
        saveSubs(updated);
      }
    });
  });
}

// Send to both Telegram and browser
function remind(text) {
  tg(text);
  const title = text.split('\n')[0].replace(/<[^>]+>/g, '');
  push('Life Planner', text.replace(/<[^>]+>/g, ''));
}

// ── Daily full schedule message ───────────────────────────────────────────────
function getDailySchedule() {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  // Get current day in Tashkent (UTC+5)
  const now = new Date(Date.now() + 5 * 3600 * 1000);
  const dow = days[now.getUTCDay()];
  const isLawSchool = now.getUTCMonth() >= 8; // September onwards (month 8 = Sept)

  return `📅 <b>TODAY'S FULL SCHEDULE — ${dow.toUpperCase()}</b>

🌙 <b>00:30</b> — Work starts (logistics shift)
⏰ <b>01:00–09:00</b> — 💼 Work shift

🌅 <b>MORNING BLOCK</b>
09:05 — ✅ Work done
09:15 — 📖 Quran (20 min)
10:00 — 💪 Gym — Cardio (1 hr fat loss)
10:30 — 🇷🇺 Russian class
12:30 — 📺 Finance video (UTAX)
13:00 — 🍽️ BREAKFAST — no bread, no sugar

${isLawSchool ? `🎓 <b>LAW SCHOOL BLOCK (Sept–)</b>
13:00–18:30 — 📚 Law school

` : ''}💪 <b>EVENING BLOCK</b>
16:30 — 💪 Gym — Weights session
18:00 — 🍽️ LUNCH — clean meal${dow === 'Sunday' ? '\n18:00 — 📊 Weekly reflection! Rate 1–10: Discipline, Deen, Health, Business, Mindset' : ''}
18:30 — 📚 Business study (Uzum / China imports)${dow === 'Sunday' ? '\n19:00 — 📅 Plan next week — set goals in life plan' : ''}
20:00 — 🕌 Maghrib prayer
21:00 — 🍽️ DINNER — last meal, clean
21:30 — 💾 Save life plan progress
22:00 — 🕌 Isha prayer

😴 <b>23:30</b> — Sleep (wake at 00:30 for work)

🥗 <b>Diet rules:</b> No bread · No sugar · Clean meals only
💪 <b>Gym:</b> Cardio AM + Weights PM (daily)

<i>Bismillah — make today count.</i>`;
}

// ── Motivational quote (Tajik) ────────────────────────────────────────────────
const MOTIVE = `💎 <i>"Dadet tuba bovar mekunan, muvaffaqiyatatba zemonda shishten, vaqtat mo'l ne umroshon kam mondagi, to'g'ri qaror kun"</i>`;

// ── Cron jobs (all times UTC+5 = Asia/Tashkent) ───────────────────────────────
// node-cron uses: second(opt) minute hour day month weekday
// TZ option sets the timezone for the schedule

// Daily full schedule at midnight Tashkent
cron.schedule('0 0 * * *', () => {
  remind(getDailySchedule());
}, { timezone: 'Asia/Tashkent' });

// Motivational message every 3 hours
cron.schedule('0 0,3,6,9,12,15,18,21 * * *', () => {
  remind(MOTIVE);
}, { timezone: 'Asia/Tashkent' });

// ── Daily schedule ────────────────────────────────────────────────────────────
const schedule = [
  { time: '30 0  * * *', msg: '🌙 Work starts in 30 min! Prepare yourself.' },
  { time: '5  9  * * *', msg: '✅ Work done! Morning routine: Quran → Gym cardio → Russian class → Finance video' },
  { time: '15 9  * * *', msg: '📖 Quran time — 20 minutes. Don\'t skip it!' },
  { time: '0  10 * * *', msg: '💪 Gym — Cardio session now! 1 hour fat loss' },
  { time: '30 10 * * *', msg: '🇷🇺 Russian class time!' },
  { time: '30 12 * * *', msg: '📺 Finance video time — watch today\'s UTAX video' },
  { time: '0  13 * * *', msg: '🍽️ BREAKFAST — eat clean, no bread no sugar!' },
  { time: '30 16 * * *', msg: '💪 Gym — Weight training session now!' },
  { time: '0  18 * * 1-6', msg: '🍽️ LUNCH — clean meal, no bread no sugar!' }, // Mon–Sat
  { time: '30 18 * * *', msg: '📚 Business study: Uzum marketplace or China imports' },
  { time: '0  20 * * *', msg: '🕌 Maghrib prayer time!' },
  { time: '0  21 * * *', msg: '🍽️ DINNER — last meal, keep it clean!' },
  { time: '30 21 * * *', msg: '💾 Save your life plan progress before sleep!' },
  { time: '0  22 * * *', msg: '🕌 Isha prayer time!' },
  { time: '30 23 * * *', msg: '😴 Sleep now — wake up at 00:30 for work!' },
  // Sunday specials
  { time: '0  18 * * 0', msg: '📊 Weekly reflection time! Rate your week 1–10 on:\n• Discipline\n• Deen\n• Health\n• Business\n• Mindset' },
  { time: '0  19 * * 0', msg: '📅 Plan next week — open your life plan and set goals' },
];

schedule.forEach(({ time, msg }) => {
  cron.schedule(time, () => remind(msg), { timezone: 'Asia/Tashkent' });
});

// ── Telegram bot commands ─────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  tg(`👋 <b>Life Planner Bot active!</b>

Commands:
/schedule — Today's full daily schedule
/motive — Get motivational quote
/status — Bot status
/prayers — Prayer times for Tashkent
/chatid — Show your chat ID

I'll send you reminders automatically throughout the day (Tashkent UTC+5).`);
});

bot.onText(/\/schedule/, () => remind(getDailySchedule()));
bot.onText(/\/motive/, () => remind(MOTIVE));
bot.onText(/\/chatid/, (msg) => tg(`Your chat ID: <code>${msg.chat.id}</code>`));
bot.onText(/\/status/, () => {
  const now = new Date(Date.now() + 5 * 3600 * 1000);
  tg(`✅ Bot is running\n🕐 Tashkent time: ${now.toUTCString().replace('GMT', 'UTC+5 approx')}\n📡 Push subscriptions: ${loadSubs().length}`);
});
bot.onText(/\/prayers/, () => {
  tg(`🕌 <b>Prayer Times — Tashkent (approximate)</b>

🌅 Fajr:   04:30
☀️ Dhuhr:  13:15
🌤️ Asr:    17:00
🌇 Maghrib: 20:15
🌙 Isha:   22:00

<i>Update monthly as times shift.</i>`);
});

// ── Express server for push subscriptions ─────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.PLANNER_URL || '*' }));

// Health check (keeps free Render instance alive)
app.get('/', (req, res) => res.json({ status: 'ok', bot: 'Life Planner Bot running' }));

// Return VAPID public key to browser
app.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// Save browser push subscription
app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const subs = loadSubs();
  const exists = subs.find(s => s.endpoint === sub.endpoint);
  if (!exists) {
    subs.push(sub);
    saveSubs(subs);
    console.log('New push subscription saved. Total:', subs.length);
  }
  res.json({ ok: true, total: subs.length });
});

// Remove subscription (browser unsubscribe)
app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  const updated = loadSubs().filter(s => s.endpoint !== endpoint);
  saveSubs(updated);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n🤖 Life Planner Bot started`);
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log(`📅 Timezone: Asia/Tashkent (UTC+5)`);
  console.log(`📡 Push subscriptions loaded: ${loadSubs().length}\n`);
});
