require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron        = require('node-cron');
const express     = require('express');
const webpush     = require('web-push');
const cors        = require('cors');
const fs          = require('fs');
const path        = require('path');
const OpenAI      = require('openai');
const admin       = require('firebase-admin');
const PDFDocument = require('pdfkit');
const mammoth     = require('mammoth');

// ── Telegram ──────────────────────────────────────────────────────────────────
const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PORT    = process.env.PORT || 3000;

if (!TOKEN || !CHAT_ID) {
  console.error('❌  TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID required');
  process.exit(1);
}
const bot = new TelegramBot(TOKEN, { polling: true });

// ── OpenAI ────────────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Firebase Admin ────────────────────────────────────────────────────────────
let firestoreDb = null;
const DOC_PATH  = { collection: 'lifeplanner', doc: 'azizbek2026' };

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const sa = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
    );
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    firestoreDb = admin.firestore();
    console.log('✅ Firebase Admin connected');
  } catch (e) {
    console.warn('⚠️  Firebase Admin init failed:', e.message);
  }
}

async function readFirebaseData() {
  if (!firestoreDb) return null;
  const snap = await firestoreDb
    .collection(DOC_PATH.collection)
    .doc(DOC_PATH.doc)
    .get();
  if (!snap.exists) return null;
  const d = snap.data();
  return {
    tasks:   safeJSON(d.tasks),
    diet:    safeJSON(d.diet),
    money:   safeJSON(d.money),
    savings: safeJSON(d.savings),
    prayer:  safeJSON(d.prayer),
    workout: safeJSON(d.workout),
    reflect: safeJSON(d.reflect),
    savedAt: d.savedAt,
  };
}

async function writeReflectToFirebase(weekKey, reportText) {
  if (!firestoreDb) return false;
  const snap = await firestoreDb
    .collection(DOC_PATH.collection)
    .doc(DOC_PATH.doc)
    .get();
  const existing = snap.exists ? safeJSON(snap.data().reflect) : {};
  if (!existing[weekKey]) existing[weekKey] = { scores: {}, well: '', bad: '', next: '', grat: '' };
  // Put AI report in the "well" field as a full report block
  existing[weekKey].aiReport = reportText;
  await firestoreDb
    .collection(DOC_PATH.collection)
    .doc(DOC_PATH.doc)
    .update({ reflect: JSON.stringify(existing) });
  return true;
}

function safeJSON(str) {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}

// ── Web Push ──────────────────────────────────────────────────────────────────
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:shavgoniaziz@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}
function loadSubs() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}
function saveSubs(subs) { fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2)); }

// ── Send helpers ──────────────────────────────────────────────────────────────
function tg(text, opts = {}) {
  return bot.sendMessage(CHAT_ID, text, { parse_mode: 'HTML', ...opts })
    .catch(err => console.error('TG error:', err.message));
}
function push(title, body) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const subs = loadSubs();
  const payload = JSON.stringify({ title, body });
  subs.forEach(sub => {
    webpush.sendNotification(sub, payload).catch(err => {
      if (err.statusCode === 410 || err.statusCode === 404) {
        saveSubs(loadSubs().filter(s => s.endpoint !== sub.endpoint));
      }
    });
  });
}
function remind(text) {
  tg(text);
  push('Life Planner', text.replace(/<[^>]+>/g, ''));
}

// ── Data analysis helpers ─────────────────────────────────────────────────────
function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() + 5 * 3600 * 1000 - i * 86400000);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

function getMonday(d) {
  const r = new Date(d);
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}

function getCurrentWeekKey() {
  const mon = getMonday(new Date(Date.now() + 5 * 3600 * 1000));
  return mon.toISOString().split('T')[0];
}

function buildDataSummary(data, days) {
  if (!data) return 'No data available yet.';

  // Tasks
  const taskSummary = days.map(d => {
    const dayTasks = data.tasks[d] || {};
    const done = Object.values(dayTasks).filter(Boolean).length;
    const total = Object.keys(dayTasks).length;
    return `${d}: ${done}/${total} tasks`;
  }).join('\n');

  // Prayer
  const prayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const prayerSummary = days.map(d => {
    const dp = data.prayer[d] || {};
    const ontime  = prayers.filter(p => dp[p] === 'ontime').length;
    const late    = prayers.filter(p => dp[p] === 'late').length;
    const missed  = prayers.filter(p => dp[p] === 'missed').length;
    return `${d}: ${ontime} on-time, ${late} late, ${missed} missed`;
  }).join('\n');

  // Gym (from tasks: g1=cardio, g2=weights)
  const gymSummary = days.map(d => {
    const t = data.tasks[d] || {};
    const cardio  = t.g1 || t.g ? '✓cardio' : '✗cardio';
    const weights = t.g2 || t.g ? '✓weights' : '✗weights';
    return `${d}: ${cardio} ${weights}`;
  }).join('\n');

  // Diet (rules tracked as boolean flags)
  const dietSummary = days.map(d => {
    const dd = data.diet[d] || {};
    const flags = Object.entries(dd).filter(([,v]) => v).map(([k]) => k);
    return `${d}: ${flags.length > 0 ? flags.join(', ') : 'no data'}`;
  }).join('\n');

  // Money last 7 days
  let totalSpent = 0;
  const moneyByDay = days.map(d => {
    const expenses = Array.isArray(data.money[d]) ? data.money[d] : [];
    const dayTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    totalSpent += dayTotal;
    return `${d}: ${dayTotal.toLocaleString()} UZS`;
  }).join('\n');

  // Savings
  const savingsSummary = Object.entries(data.savings || {}).map(([m, v]) =>
    `Month ${m}: salary ${Number(v.salary||0).toLocaleString()} UZS, saved ${Number(v.saved||0).toLocaleString()} UZS`
  ).join('\n') || 'No savings data';

  // Workout
  const workoutSummary = days.map(d => {
    const w = data.workout[d];
    if (!w || !w.exercises || w.exercises.length === 0) return `${d}: no workout logged`;
    return `${d}: ${w.type || 'session'} — ${w.exercises.length} exercises`;
  }).join('\n');

  // Russian (from tasks: ru = Russian class done)
  const russianDays = days.filter(d => data.tasks[d] && data.tasks[d].ru).length;

  return `=== TASKS (last 7 days) ===\n${taskSummary}
=== PRAYER (last 7 days) ===\n${prayerSummary}
=== GYM (last 7 days) ===\n${gymSummary}
=== DIET (last 7 days) ===\n${dietSummary}
=== MONEY (last 7 days, total: ${totalSpent.toLocaleString()} UZS) ===\n${moneyByDay}
=== SAVINGS ===\n${savingsSummary}
=== WORKOUT LOG ===\n${workoutSummary}
=== RUSSIAN CLASS ===\nCompleted ${russianDays}/7 days this week`;
}

function buildFinanceSummary(data) {
  if (!data) return 'No financial data available.';

  // All money entries
  const allExpenses = {};
  let grandTotal = 0;
  Object.entries(data.money || {}).forEach(([date, entries]) => {
    (Array.isArray(entries) ? entries : []).forEach(e => {
      const cat = e.cat || 'other';
      if (!allExpenses[cat]) allExpenses[cat] = 0;
      allExpenses[cat] += Number(e.amount) || 0;
      grandTotal += Number(e.amount) || 0;
    });
  });

  const byCategory = Object.entries(allExpenses)
    .sort((a,b) => b[1]-a[1])
    .map(([cat, amt]) => `  ${cat}: ${amt.toLocaleString()} UZS (${((amt/grandTotal)*100).toFixed(1)}%)`)
    .join('\n');

  // Savings
  const savings = Object.entries(data.savings || {}).map(([m, v]) => {
    const salary = Number(v.salary || 0);
    const saved  = Number(v.saved  || 0);
    const rate   = salary ? ((saved/salary)*100).toFixed(1) : 0;
    return `  Month ${m}: earned ${salary.toLocaleString()}, saved ${saved.toLocaleString()} (${rate}%)`;
  }).join('\n') || '  No savings data';

  return `Total spending tracked: ${grandTotal.toLocaleString()} UZS
Spending by category:\n${byCategory}
Savings history:\n${savings}
Car goal target: Save 80% of each salary month`;
}

function buildGoalProgress(data, days) {
  if (!data) return 'No data';

  // Gym consistency (last 30 days)
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() + 5*3600*1000 - i*86400000);
    last30.push(d.toISOString().split('T')[0]);
  }
  const gymDays = last30.filter(d => {
    const t = data.tasks[d] || {};
    return t.g1 || t.g2 || t.g;
  }).length;

  // Prayer consistency
  const prayerDays = last30.filter(d => {
    const p = data.prayer[d] || {};
    const prayers = ['fajr','dhuhr','asr','maghrib','isha'];
    return prayers.filter(pr => p[pr] === 'ontime' || p[pr] === 'late').length === 5;
  }).length;

  // Russian consistency
  const russianDays30 = last30.filter(d => data.tasks[d] && data.tasks[d].ru).length;

  // Business tasks
  const businessDays = last30.filter(d => data.tasks[d] && data.tasks[d].bs).length;

  // Savings rate
  const totalSalary = Object.values(data.savings||{}).reduce((s,v) => s+Number(v.salary||0), 0);
  const totalSaved  = Object.values(data.savings||{}).reduce((s,v) => s+Number(v.saved||0),  0);
  const savingsRate = totalSalary ? ((totalSaved/totalSalary)*100).toFixed(1) : 0;

  // Reflect average scores
  const reflectEntries = Object.values(data.reflect || {});
  const latestReflect  = reflectEntries[reflectEntries.length - 1];
  const scores = latestReflect ? latestReflect.scores || {} : {};

  return `GYM (last 30 days): ${gymDays}/30 days (${((gymDays/30)*100).toFixed(0)}% consistency)
PRAYER (all 5 prayed, last 30 days): ${prayerDays}/30 days
RUSSIAN CLASS (last 30 days): ${russianDays30}/30 sessions
BUSINESS STUDY (last 30 days): ${businessDays}/30 days
SAVINGS RATE: ${savingsRate}% of salary saved
LATEST REFLECTION SCORES: ${JSON.stringify(scores)}
GOAL TARGETS:
- Body: reach 85kg (started ~105kg, losing with gym+diet)
- Russian: conversational by end of year
- Car: save 80% salary each month for car fund
- Business: Uzum marketplace live + first sale
- Quran: complete Juz Amma (37 surahs)`;
}

// ── GPT-4o calls ──────────────────────────────────────────────────────────────
async function gptCoach(data) {
  const days = getLast7Days();
  const summary = buildDataSummary(data, days);
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'system',
      content: `You are a strict but caring personal life coach for Azizbek — a 20-something man in Tashkent, Uzbekistan.
He works logistics 01:00–09:00, studies law at university (Sept+), goes to gym daily, does Russian classes, builds a business on Uzum marketplace, studies finance via UTAX videos, and tracks his Muslim prayer. His goals: lose weight to 85kg, buy a car, master Russian, complete Juz Amma Quran, build an online business.
Diet rules: no bread, no sugar. Sleep: 09:30–13:00 and 21:00–00:00.
Analyse his real data and give a SHORT (max 250 words), honest, direct morning briefing. Start with what's going well, then call out exactly what he needs to fix TODAY with specific actions. No generic advice — use his actual numbers. End with one powerful sentence of motivation in Uzbek or Tajik.`
    }, {
      role: 'user',
      content: `Today's date: ${new Date(Date.now()+5*3600*1000).toISOString().split('T')[0]}\nHere is Azizbek's data from the last 7 days:\n\n${summary}`
    }],
    max_tokens: 400,
    temperature: 0.7,
  });
  return resp.choices[0].message.content;
}

async function gptWeeklyReport(data) {
  const days = getLast7Days();
  const summary = buildDataSummary(data, days);
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'system',
      content: `You are writing a weekly performance report for Azizbek. Be honest, specific, and direct. Use his real numbers. Format the report in clear sections: WINS, FAILURES, PATTERNS, NEXT WEEK ACTION PLAN. Be like a mentor who tells the hard truth. Max 400 words.`
    }, {
      role: 'user',
      content: `Week ending: ${new Date(Date.now()+5*3600*1000).toISOString().split('T')[0]}\n\n${summary}`
    }],
    max_tokens: 600,
    temperature: 0.7,
  });
  return resp.choices[0].message.content;
}

async function gptFinance(data) {
  const summary = buildFinanceSummary(data);
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'system',
      content: `You are a financial advisor for Azizbek in Tashkent. Analyse his spending and savings. Tell him exactly where money is leaking, his savings rate vs 80% target, and whether his car savings goal is on track. Be specific and give 3 concrete actions. Max 250 words.`
    }, {
      role: 'user',
      content: summary
    }],
    max_tokens: 400,
    temperature: 0.6,
  });
  return resp.choices[0].message.content;
}

async function gptPredict(data) {
  const days = getLast7Days();
  const progress = buildGoalProgress(data, days);
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'system',
      content: `You are a goal deadline predictor. Use Azizbek's actual consistency rates to calculate real deadlines. Do the math: if he's going to gym X% of days, how long to hit 85kg? If savings rate is Y%, when does he hit car target? Be mathematical and specific. End each prediction with what he needs to change to hit the ORIGINAL deadline. Max 300 words.`
    }, {
      role: 'user',
      content: `Current date: ${new Date(Date.now()+5*3600*1000).toISOString().split('T')[0]}\nGoal deadlines: end of 2026\n\n${progress}`
    }],
    max_tokens: 500,
    temperature: 0.5,
  });
  return resp.choices[0].message.content;
}

// ── Russian practice session state ────────────────────────────────────────────
const russianSessions = new Map();

// ── PDF Law Analyzer session state ───────────────────────────────────────────
const pdfSessions = new Map(); // chatId → { title, chunks: [text] }

function splitIntoArticles(text) {
  // Split on "Modda N." or "Moddа N." or numbered lines like "1." at start
  const lines = text.split('\n');
  const articles = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^(Modda|MODDA|Моdda|Статья|Maqola)\s*(\d+)[.\-–]/i)
                || line.match(/^(\d+)[.\-–]\s+[A-ZА-ЯҚҒҲЎa-z]/);
    if (match) {
      if (current) articles.push(current);
      current = { header: line.trim(), body: '' };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    } else {
      // Text before first article — treat as preamble
      if (articles.length === 0 && line.trim()) {
        if (!current) current = { header: 'Kirish / Preambula', body: '' };
        current.body += line + '\n';
      }
    }
  }
  if (current) articles.push(current);
  return articles;
}

async function analyzeArticle(header, body, docTitle) {
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'system',
      content: `Sen Azizbek uchun yuridik hujjatlarni tahlil qiluvchi yordamchisan. U Toshkentda huquq fakultetida o'qiydi.
Har bir moddani faqat 2 qismda tahlil qil (O'zbek tilida, qisqa):
📌 ASOSIY MA'NO — 1-2 jumlada juda sodda tilda, oddiy odam tushuna olishi kerak
🔑 KALIT TUSHUNCHALAR — 2-3 ta muhim atama va qisqa ta'rifi (har biri 1 qator)
Boshqa hech narsa yozma. Juda qisqa va aniq bo'lsin.`
    }, {
      role: 'user',
      content: `Hujjat: ${docTitle}\n\n${header}\n${body.slice(0, 800)}`
    }],
    max_tokens: 200,
    temperature: 0.4,
  });
  return resp.choices[0].message.content;
}

async function generateLawPDF(title, articles, analyses) {
  return new Promise((resolve, reject) => {
    const filePath = path.join('/tmp', `law_${Date.now()}.pdf`);
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      info: { Title: title, Author: 'Azizbek — Life Planner Bot' }
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ── Register fonts ────────────────────────────────────────
    // PDFKit ships with Helvetica which supports Latin. For Uzbek Cyrillic
    // we fall back gracefully — Helvetica covers most Uzbek Latin chars.
    const FONT_BOLD   = 'Helvetica-Bold';
    const FONT_NORMAL = 'Helvetica';

    // ── Cover page ────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0F0F14');
    doc.fillColor('#C9A84C').font(FONT_BOLD).fontSize(28)
       .text('⚖️', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#C9A84C').font(FONT_BOLD).fontSize(22)
       .text(title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#888888').font(FONT_NORMAL).fontSize(12)
       .text(`AI Tahlil — ${articles.length} ta Modda`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fillColor('#555555').font(FONT_NORMAL).fontSize(10)
       .text(new Date().toLocaleDateString('uz-UZ'), { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#333333').font(FONT_NORMAL).fontSize(9)
       .text('Azizbek uchun tayyorlangan — YouTube video uchun', { align: 'center' });

    // ── Articles ──────────────────────────────────────────────
    for (let i = 0; i < articles.length; i++) {
      doc.addPage();
      const art      = articles[i];
      const analysis = analyses[i] || '';

      // Article number banner
      doc.rect(0, 0, doc.page.width, 8).fill('#C9A84C');

      // Header
      doc.fillColor('#C9A84C').font(FONT_BOLD).fontSize(15)
         .text(art.header, 60, 30, { width: doc.page.width - 120 });

      doc.moveDown(0.4);

      // Original text box
      if (art.body.trim()) {
        doc.rect(60, doc.y, doc.page.width - 120, 1).fill('#333333');
        doc.moveDown(0.3);
        doc.fillColor('#AAAAAA').font(FONT_NORMAL).fontSize(9)
           .text('ORIGINAL MATN:', { continued: false });
        doc.fillColor('#CCCCCC').font(FONT_NORMAL).fontSize(9)
           .text(art.body.trim().slice(0, 600) + (art.body.length > 600 ? '...' : ''),
                 { width: doc.page.width - 120 });
        doc.moveDown(0.6);
      }

      // Divider
      doc.rect(60, doc.y, doc.page.width - 120, 1).fill('#C9A84C44');
      doc.moveDown(0.5);

      // AI analysis
      doc.fillColor('#FFCC44').font(FONT_BOLD).fontSize(10)
         .text('🤖 AI TAHLIL:', { continued: false });
      doc.moveDown(0.2);
      doc.fillColor('#EEEEEE').font(FONT_NORMAL).fontSize(10)
         .text(analysis, { width: doc.page.width - 120, lineGap: 2 });

      // Page footer
      doc.fillColor('#444444').font(FONT_NORMAL).fontSize(8)
         .text(`${i + 1} / ${articles.length} — ${title}`,
               60, doc.page.height - 40,
               { width: doc.page.width - 120, align: 'center' });
    }

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}


const RUSSIAN_SYSTEM = `You are a Russian language tutor for Azizbek — a Uzbek speaker who is learning Russian from scratch and takes daily classes. He works in logistics and studies law.
Rules:
1. Have natural conversations in Russian, but keep it at his level (beginner to intermediate).
2. After each of his messages, silently note any grammar or vocabulary mistakes and GENTLY correct ONE mistake per reply at the end (in Uzbek or simple English so he understands).
3. Mix in logistics and law vocabulary naturally — words like: накладная (waybill), договор (contract), грузоперевозка (cargo transport), суд (court), закон (law), статья (article of law).
4. If he writes in Uzbek or English, understand him but reply in Russian (with translation if needed).
5. Keep replies SHORT (2-4 sentences in Russian) so it feels like a real text conversation.
6. Use Cyrillic. Always end your reply with one new useful word for him to remember.`;

// ── Motivational quote ────────────────────────────────────────────────────────
const MOTIVE = `💎 <i>"Dadet tuba bovar mekunan, muvaffaqiyatatba zemonda shishten, vaqtat mo'l ne umroshon kam mondagi, to'g'ri qaror kun"</i>`;

// ── Daily schedule generator ──────────────────────────────────────────────────
function getDailySchedule() {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const now = new Date(Date.now() + 5 * 3600 * 1000);
  const dow = days[now.getUTCDay()];
  const isLawSchool = now.getUTCMonth() >= 8;
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
😴 <b>23:30</b> — Sleep

🥗 No bread · No sugar · Clean meals only`;
}

// ── Cron jobs ─────────────────────────────────────────────────────────────────
// Daily full schedule — midnight Tashkent
cron.schedule('0 0 * * *', () => remind(getDailySchedule()), { timezone: 'Asia/Tashkent' });

// Motivational quote every 3 hours
cron.schedule('0 0,3,6,9,12,15,18,21 * * *', () => remind(MOTIVE), { timezone: 'Asia/Tashkent' });

// Daily AI Morning Briefing — 09:05 Tashkent (automatically fires /today logic)
cron.schedule('5 9 * * *', async () => {
  tg('☀️ <b>Good morning, brother!</b> Preparing your daily briefing...');
  try {
    const data = await readFirebaseData();
    if (!data) { tg('⚠️ No Firebase data yet. Save your planner data first.'); return; }

    const today     = getTashkentDate();
    const yDate     = new Date(Date.now() + 5*3600*1000 - 86400*1000);
    const yesterday = yDate.toISOString().split('T')[0];
    const yesterTasks = data.tasks[yesterday] || {};
    const yDone = Object.values(yesterTasks).filter(Boolean).length;
    const yTotal = Object.keys(yesterTasks).length;
    const pYest = data.prayer[yesterday] || {};
    const pNames = ['fajr','zuhr','asr','maghrib','isha'];
    const pMissed = pNames.filter(p => !(pYest[p]?.done)).join(', ');

    const prompt = `You are a tough loving coach for Azizbek (25yo, Tashkent).
Goals: 90kg body, Quran memorisation, YouTube FK launch Jun 2026, law school entrance Sep 2026, brokerage skills.

Yesterday ${yesterday}: ${yDone}/${yTotal||'?'} tasks done. Prayers missed: ${pMissed || 'none'}.

Write a morning briefing. Max 180 words. Format:
Line 1: Punchy personalised greeting
[blank line]
📊 Yesterday: honest 1-sentence assessment
🎯 Top 3 Today: 3 specific priorities (numbered)
⚠️ Watch out: 1 risk/weakness to guard against today
💬 Closing: 1 powerful line referencing his specific goals
END`;

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role:'user', content: prompt }],
      max_tokens: 300,
    });
    tg(resp.choices[0].message.content);
  } catch(e) { tg(`❌ Morning briefing error: ${e.message}`); }
}, { timezone: 'Asia/Tashkent' });

// Weekly Report — Sunday 19:30 Tashkent
cron.schedule('30 19 * * 0', async () => {
  tg('📊 <b>Weekly Report</b> — writing your week summary...');
  try {
    const data = await readFirebaseData();
    if (!data) { tg('⚠️ No Firebase data.'); return; }
    const report = await gptWeeklyReport(data);
    const weekKey = getCurrentWeekKey();
    await writeReflectToFirebase(weekKey, report);
    tg(`📊 <b>Weekly Report — Week of ${weekKey}</b>\n\n${report}\n\n<i>✅ Saved to your Reflection tab.</i>`);
  } catch(e) { tg(`❌ Report error: ${e.message}`); }
}, { timezone: 'Asia/Tashkent' });

// ── Smart notification helpers ────────────────────────────────────────────────
// Get today's date key in Tashkent (UTC+5)
function getTashkentDate() {
  const d = new Date(Date.now() + 5*3600*1000);
  return d.toISOString().split('T')[0];
}

// Check Firebase: if task NOT done → send reminder, re-check in `reCheckMins`
async function smartRemind(taskId, msg, reCheckMins = 0) {
  const today = getTashkentDate();
  let tasks = null;
  try {
    const data = await readFirebaseData();
    tasks = data?.tasks?.[today] || null;
  } catch(e) { /* Firebase unavailable — send anyway */ }

  if (!tasks || !tasks[taskId]) {
    // Task not done — send reminder
    tg(msg);
    // Optionally re-check later if still not done
    if (reCheckMins > 0) {
      setTimeout(async () => {
        try {
          const fresh = await readFirebaseData();
          const freshTasks = fresh?.tasks?.[today] || {};
          if (!freshTasks[taskId]) {
            tg(`⏰ Brother, still pending:\n${msg.split('\n')[0]}\n\n<i>Open the planner and mark it done!</i>`);
          }
        } catch(e) {}
      }, reCheckMins * 60 * 1000);
    }
  }
  // If done — silent ✅
}

// Food reminder: send prompt + wait for reply  (logged when user confirms)
const pendingFoodCheck = new Map(); // msgId → meal
async function foodRemind(meal, taskId) {
  const today = getTashkentDate();
  let tasks = null;
  try { const d = await readFirebaseData(); tasks = d?.tasks?.[today] || {}; } catch(e) {}
  if (tasks && tasks[taskId]) return; // already logged

  const sent = await tg(`🍽️ <b>${meal} time!</b>\n\nEat clean — no bread, no sugar, no processed food.\n\nReply with what you ate (e.g. "eggs + oats + tea") to log it 📝`);
  if (sent?.message_id) pendingFoodCheck.set(sent.message_id, meal);

  // Re-remind if no reply in 45 min
  setTimeout(async () => {
    try {
      const fresh = await readFirebaseData();
      const ft = fresh?.tasks?.[today] || {};
      if (!ft[taskId]) tg(`⚠️ <b>${meal} not logged yet</b>\n\nBrother, please eat and reply with what you had!`);
    } catch(e) {}
  }, 45 * 60 * 1000);
}

// ── Smart Cron Schedule ───────────────────────────────────────────────────────
// Work prep — no check needed (just wake-up call)
cron.schedule('30 0 * * *', () => tg('🌙 <b>Work starts in 30 min!</b>\nGet ready brother. Bismillah.'), { timezone: 'Asia/Tashkent' });

// After work — check Quran + gym
cron.schedule('5 9 * * *', () => smartRemind('wk', '✅ Work shift done! Now:\n📖 Quran → 💪 Gym cardio → 📚 Brokerage study\n\nOpen planner: https://azizboyplan.netlify.app'), { timezone: 'Asia/Tashkent' });

// Quran check — 09:15
cron.schedule('15 9 * * *', () => smartRemind('q',  '📖 <b>Quran time</b> — 20 minutes memorisation now!\nDon\'t delay it, brother.', 40), { timezone: 'Asia/Tashkent' });

// Gym cardio — 09:30
cron.schedule('30 9 * * *', () => smartRemind('g1', '💪 <b>Gym Cardio now!</b>\n1 hour fat loss session. You\'re going from 105→90kg!\nEvery session counts.', 45), { timezone: 'Asia/Tashkent' });

// Brokerage study — 11:00
cron.schedule('0 11 * * *', () => smartRemind('br', '📊 <b>Brokerage/Tender study time!</b>\n1 hour deep focus — no phone, no distractions.', 50), { timezone: 'Asia/Tashkent' });

// Breakfast — 13:00
cron.schedule('0 13 * * *', () => foodRemind('Breakfast', 'br'), { timezone: 'Asia/Tashkent' });

// Gym weights — 16:30
cron.schedule('30 16 * * *', () => smartRemind('g2', '💪 <b>Weight Training now!</b>\n1.5 hour session. Build that body brother!', 50), { timezone: 'Asia/Tashkent' });

// Lunch — 18:00 (weekdays)
cron.schedule('0 18 * * 1-6', () => foodRemind('Lunch', 'g2'), { timezone: 'Asia/Tashkent' });

// Maghrib prayer — 20:00
cron.schedule('0 20 * * *', () => smartRemind('pr', '🕌 <b>Maghrib prayer time!</b>\nDon\'t miss it brother. Pray then rest.', 20), { timezone: 'Asia/Tashkent' });

// Dinner — 21:00
cron.schedule('0 21 * * *', () => foodRemind('Dinner', 'pr'), { timezone: 'Asia/Tashkent' });

// Isha prayer — 22:00
cron.schedule('0 22 * * *', () => smartRemind('pr2', '🕌 <b>Isha prayer time!</b>\nLast prayer of the day. Make it count.', 25), { timezone: 'Asia/Tashkent' });

// Auto-save check — 22:00 (check if saved today)
cron.schedule('0 22 * * *', async () => {
  try {
    const data = await readFirebaseData();
    if (!data) return;
    const savedAt = data.savedAt ? new Date(data.savedAt) : null;
    const todayStr = getTashkentDate();
    const savedToday = savedAt && savedAt.toISOString().split('T')[0] === todayStr;
    if (!savedToday) {
      tg('💾 <b>Reminder: Save your progress!</b>\nYour planner hasn\'t been saved today.\n\n<a href="https://azizboyplan.netlify.app">Open planner → tap 💾 Save Progress</a>');
    }
  } catch(e) {}
}, { timezone: 'Asia/Tashkent' });

// Plan tomorrow / sleep
cron.schedule('30 21 * * *', () => smartRemind('pl', '📋 <b>Plan tomorrow</b> now before sleep!\nOpen planner → Daily → write tomorrow\'s focus.', 30), { timezone: 'Asia/Tashkent' });
cron.schedule('30 23 * * *', () => tg('😴 <b>Sleep time!</b>\nWork starts at 01:00. Rest well, brother.'), { timezone: 'Asia/Tashkent' });

// Sunday weekly reflection
cron.schedule('0 18 * * 0', () => tg('📊 <b>Weekly Reflection</b>\nOpen planner → Reflection tab. Rate your week:\n• Discipline • Deen • Health • Business • Mindset\n\nOr use /report for AI analysis.'), { timezone: 'Asia/Tashkent' });
cron.schedule('0 19 * * 0', () => tg('📅 <b>Plan next week!</b>\nOpen your planner and set weekly goals.'), { timezone: 'Asia/Tashkent' });

// ── Telegram commands ─────────────────────────────────────────────────────────
bot.onText(/\/start/, () => {
  tg(`👋 <b>Life Planner Bot — AI Edition</b>

📅 <b>Daily reminders</b> sent automatically (UTC+5)
🧠 <b>AI Coach</b> every morning at 09:05

<b>Commands:</b>
/today — ☀️ Morning briefing (personalised AI priorities for today)
/coach — 🧠 AI analysis of your full data
/finance — 💰 Financial analysis + money leaks
/report — 📊 Weekly AI report
/predict — 📈 Goal deadline predictions
/russian — 🇷🇺 Russian practice session
/pdf — 📄 Analyse law article (Word → PDF)
/schedule — 📅 Today's full schedule
/motive — 💎 Motivational quote
/prayers — 🕌 Tashkent prayer times
/status — Bot status
/chatid — Your chat ID`);
});

bot.onText(/\/schedule/, () => remind(getDailySchedule()));

bot.onText(/\/motive/, () => {
  bot.sendMessage(CHAT_ID, MOTIVE, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '🌐 Send to Browser too', callback_data: 'push_motive' }
      ]]
    }
  }).catch(err => console.error('TG error:', err.message));
});

bot.onText(/\/coach/, async () => {
  tg('🧠 Analysing your data...');
  try {
    const data = await readFirebaseData();
    if (!data) { tg('⚠️ No Firebase data. Make sure FIREBASE_SERVICE_ACCOUNT is set and you\'ve saved your planner.'); return; }
    const report = await gptCoach(data);
    tg(`🧠 <b>AI Coach</b>\n\n${report}`);
  } catch(e) { tg(`❌ Error: ${e.message}`); }
});

// /today — AI morning briefing: reads yesterday's data, gives personalised today priorities
bot.onText(/\/today/, async () => {
  tg('☀️ Preparing your personal morning briefing...');
  try {
    const data = await readFirebaseData();
    if (!data) { tg('⚠️ No Firebase data yet. Save your planner first.'); return; }

    const today   = getTashkentDate();
    const yDate   = new Date(Date.now() + 5*3600*1000 - 86400*1000);
    const yesterday = yDate.toISOString().split('T')[0];
    const todayTasks  = data.tasks[today]   || {};
    const yesterTasks = data.tasks[yesterday] || {};

    // Count yesterday's completion
    const yKeys  = Object.keys(yesterTasks);
    const yDone  = yKeys.filter(k => yesterTasks[k]).length;

    // Find which critical tasks are not yet done today (tasks that should have been done by now)
    const tashHour = new Date(Date.now() + 5*3600*1000).getHours();
    const tasksDue = [
      { id:'q',  time:9,  name:'Quran memorisation' },
      { id:'g1', time:10, name:'Gym cardio' },
      { id:'br', time:11, name:'Brokerage study' },
      { id:'g2', time:17, name:'Gym weights' },
      { id:'pl', time:22, name:'Plan tomorrow' },
    ];
    const overdueToday = tasksDue
      .filter(t => tashHour > t.time && !todayTasks[t.id])
      .map(t => `• ❌ ${t.name} — overdue`)
      .join('\n');

    // Prayer stats yesterday
    const pYest = data.prayer[yesterday] || {};
    const pNames = ['fajr','zuhr','asr','maghrib','isha'];
    const pMissed = pNames.filter(p => !(pYest[p]?.done)).map(p=>p).join(', ');

    const prompt = `You are a tough but caring life coach for Azizbek (25yo, Tashkent, Uzbekistan).
His goals: reach 90kg body weight, memorise Quran surahs, launch YouTube FK series (Civil Code), pass law school entrance, grow brokerage skills.

Yesterday (${yesterday}):
- Tasks completed: ${yDone} / ${yKeys.length || 'unknown'}
- Prayers missed yesterday: ${pMissed || 'none'}

Today (${today}), currently ${tashHour}:00 Tashkent time:
${overdueToday || '- No overdue tasks yet'}

Write a PERSONAL morning briefing for TODAY. Format exactly like this (in English, max 200 words):
Line 1: Short powerful greeting with his name
Line 2: blank
Section "📊 Yesterday": 1-2 sentences about yesterday's performance (honest, no sugarcoating)
Section "🎯 Top 3 Today": exactly 3 specific priorities for today (reference real tasks above)
Section "⚠️ Watch out": 1 thing he's at risk of slipping on today
Section "💬 One line": one motivational sentence specific to his goals
END`;

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role:'user', content: prompt }],
      max_tokens: 350,
    });
    const briefing = resp.choices[0].message.content;
    tg(`☀️ <b>Good morning, brother!</b>\n\n${briefing}`);
  } catch(e) { tg(`❌ Error: ${e.message}`); }
});

bot.onText(/\/finance/, async () => {
  tg('💰 Analysing your finances...');
  try {
    const data = await readFirebaseData();
    if (!data) { tg('⚠️ No Firebase data available.'); return; }
    const report = await gptFinance(data);
    tg(`💰 <b>Financial Report</b>\n\n${report}`);
  } catch(e) { tg(`❌ Error: ${e.message}`); }
});

bot.onText(/\/report/, async () => {
  tg('📊 Writing your weekly report...');
  try {
    const data = await readFirebaseData();
    if (!data) { tg('⚠️ No Firebase data available.'); return; }
    const report = await gptWeeklyReport(data);
    const weekKey = getCurrentWeekKey();
    await writeReflectToFirebase(weekKey, report);
    tg(`📊 <b>Weekly Report</b>\n\n${report}\n\n<i>✅ Saved to your Reflection tab.</i>`);
  } catch(e) { tg(`❌ Error: ${e.message}`); }
});

bot.onText(/\/predict/, async () => {
  tg('🎯 Calculating your goal deadlines...');
  try {
    const data = await readFirebaseData();
    if (!data) { tg('⚠️ No Firebase data available.'); return; }
    const days = getLast7Days();
    const report = await gptPredict(data);
    tg(`🎯 <b>Goal Deadline Predictor</b>\n\n${report}`);
  } catch(e) { tg(`❌ Error: ${e.message}`); }
});

// Russian practice — /russian starts a session
bot.onText(/\/russian/, () => {
  russianSessions.set(CHAT_ID, []);
  tg(`🇷🇺 <b>Russian Practice Started!</b>

Привет! Я твой репетитор по русскому языку.
Just write to me in Russian (or Uzbek/English if you're stuck) and I'll respond naturally, correct your mistakes, and teach you logistics & law vocabulary.

Send /stoprussian to end the session.
Начнём? (Shall we start?) 🎯`);
});

bot.onText(/\/stoprussian/, () => {
  russianSessions.delete(CHAT_ID);
  tg('✅ Russian practice session ended. Молодец! (Well done!) 🇷🇺');
});

// PDF Law Analyzer
bot.onText(/\/pdf/, () => {
  pdfSessions.set(CHAT_ID, { stage: 'waiting_title' });
  tg(`📄 <b>Qonunchilik Hujjati Tahlilchisi</b>

Avval hujjat nomini yuboring.
<i>Misol: Fuqarolik Kodeksi — 1–50 moddalar</i>`);
});

bot.onText(/\/stoppdf/, () => {
  pdfSessions.delete(CHAT_ID);
  tg('✅ PDF sessiyasi tugatildi.');
});

bot.onText(/\/chatid/, (msg) => tg(`Your chat ID: <code>${msg.chat.id}</code>`));
bot.onText(/\/status/, () => {
  const now = new Date(Date.now() + 5 * 3600 * 1000);
  tg(`✅ Bot running\n🕐 Tashkent: ${now.toISOString().replace('T',' ').slice(0,16)}\n🧠 OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌ not set'}\n🔥 Firebase: ${firestoreDb ? '✅' : '❌ not set'}\n📡 Push subscriptions: ${loadSubs().length}`);
});
bot.onText(/\/prayers/, () => {
  tg(`🕌 <b>Prayer Times — Tashkent (approximate)</b>

🌅 Fajr:    04:30
☀️ Dhuhr:   13:15
🌤️ Asr:     17:00
🌇 Maghrib: 20:15
🌙 Isha:    22:00

<i>Update monthly as times shift.</i>`);
});

// Handle all non-command messages
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (String(msg.chat.id) !== String(CHAT_ID)) return;

  // ── Food logging: reply to food reminder ─────────────────────────────────
  if (msg.reply_to_message && pendingFoodCheck.has(msg.reply_to_message.message_id)) {
    const meal = pendingFoodCheck.get(msg.reply_to_message.message_id);
    pendingFoodCheck.delete(msg.reply_to_message.message_id);
    const today = getTashkentDate();
    const food  = msg.text.trim();
    try {
      // Write food log to Firebase diet field
      const data = await readFirebaseData();
      const diet = data?.diet || {};
      if (!diet[today]) diet[today] = { foods:[], score:0 };
      if (!diet[today].foods) diet[today].foods = [];
      diet[today].foods.push(`${meal}: ${food}`);
      await firestoreDb.collection('lifeplanner').doc('azizbek2026').update({
        diet: JSON.stringify(diet)
      });
      tg(`✅ <b>${meal} logged!</b>\n🍽️ "${food}"\n\nKeep eating clean, brother! 💪`);
    } catch(e) {
      tg(`✅ <b>${meal} noted:</b> "${food}"\n<i>(Firebase save failed — log manually in planner)</i>`);
    }
    return;
  }

  // ── PDF session ──────────────────────────────────────────────────────────
  if (pdfSessions.has(CHAT_ID)) {
    const session = pdfSessions.get(CHAT_ID);

    if (session.stage === 'waiting_title') {
      session.title = msg.text.trim();
      session.stage = 'waiting_text';
      pdfSessions.set(CHAT_ID, session);
      tg(`✅ Nom saqlandi: <b>${session.title}</b>

Endi <b>.docx (Word fayl)</b> yuboring 📎
<i>Telegram → qo'shimcha → fayl → Word hujjatingizni tanlang</i>`);
      return;
    }

    if (session.stage === 'waiting_text') {
      tg('📨 Iltimos, <b>.docx</b> (Word) faylni yuboring — matn emas, fayl.');
      return;
    }
    if (session.stage === 'waiting_doc_text') {
      // fallback: accept raw text too
      const rawText = msg.text.trim();
      const articles = splitIntoArticles(rawText);

      if (articles.length === 0) {
        tg('⚠️ Moddalar topilmadi. Matn "Modda 1." yoki "1." formatida bo\'lishi kerak. Qayta yuboring.');
        return;
      }

      tg(`📝 <b>${articles.length} ta modda topildi.</b>\nHar birini GPT-4o bilan tahlil qilyapman...\n⏳ Biroz kuting (${articles.length} × ~10 soniya)`);
      pdfSessions.delete(CHAT_ID);

      try {
        const analyses = [];
        for (let i = 0; i < articles.length; i++) {
          const art = articles[i];
          // Progress every 5 articles
          if (i > 0 && i % 5 === 0) {
            tg(`⏳ ${i}/${articles.length} tahlil qilindi...`);
          }
          const analysis = await analyzeArticle(art.header, art.body, session.title);
          analyses.push(analysis);
        }

        tg('📄 PDF yaratilmoqda...');
        const filePath = await generateLawPDF(session.title, articles, analyses);

        await bot.sendDocument(CHAT_ID, filePath, {}, {
          filename: `${session.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
          contentType: 'application/pdf'
        });
        tg(`✅ <b>${session.title}</b>\n${articles.length} ta modda tahlil qilindi. PDF tayyor!`);

        fs.unlink(filePath, () => {}); // cleanup
      } catch(e) {
        console.error('PDF error:', e);
        tg(`❌ Xato: ${e.message}`);
      }
      return;
    }
  }

  // ── Russian practice session ─────────────────────────────────────────────
  if (russianSessions.has(CHAT_ID)) {
    const history = russianSessions.get(CHAT_ID);
    history.push({ role: 'user', content: msg.text });
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: RUSSIAN_SYSTEM },
          ...history.slice(-10)
        ],
        max_tokens: 200,
        temperature: 0.8,
      });
      const reply = resp.choices[0].message.content;
      history.push({ role: 'assistant', content: reply });
      russianSessions.set(CHAT_ID, history);
      tg(reply);
    } catch(e) { tg(`❌ Error: ${e.message}`); }
  }
});

// ── .docx file handler ────────────────────────────────────────────────────────
bot.on('document', async (msg) => {
  if (String(msg.chat.id) !== String(CHAT_ID)) return;

  const doc  = msg.document;
  const name = doc.file_name || '';
  if (!name.endsWith('.docx') && !name.endsWith('.doc')) {
    tg('⚠️ Faqat <b>.docx</b> (Word) fayl qabul qilinadi.');
    return;
  }

  const session = pdfSessions.get(CHAT_ID);

  // Auto-start session if not started — use filename as title
  if (!session) {
    const autoTitle = name.replace(/\.(docx|doc)$/i, '').replace(/_/g, ' ');
    pdfSessions.set(CHAT_ID, { title: autoTitle, stage: 'waiting_text' });
    tg(`📎 Fayl qabul qilindi: <b>${autoTitle}</b>\nTahlil boshlanmoqda...`);
  } else if (session.stage !== 'waiting_text') {
    tg('⚠️ Avval /pdf buyrug\'ini yuboring, keyin faylni jo\'nating.');
    return;
  } else {
    tg(`📎 Fayl qabul qilindi. Tahlil boshlanmoqda...`);
  }

  const currentSession = pdfSessions.get(CHAT_ID);
  pdfSessions.delete(CHAT_ID);

  try {
    // Download the file
    const fileLink  = await bot.getFileLink(doc.file_id);
    const https     = require('https');
    const http      = require('http');
    const tmpDocx   = path.join('/tmp', `doc_${Date.now()}.docx`);

    await new Promise((resolve, reject) => {
      const proto  = fileLink.startsWith('https') ? https : http;
      const file   = fs.createWriteStream(tmpDocx);
      proto.get(fileLink, res => { res.pipe(file); file.on('finish', resolve); })
           .on('error', reject);
    });

    // Extract text from .docx
    const result  = await mammoth.extractRawText({ path: tmpDocx });
    fs.unlink(tmpDocx, () => {});
    const rawText = result.value.trim();

    if (!rawText) { tg('⚠️ Fayl bo\'sh yoki o\'qib bo\'lmadi.'); return; }

    const articles = splitIntoArticles(rawText);
    if (articles.length === 0) {
      tg('⚠️ Moddalar topilmadi. Matn "Modda 1." yoki raqamli format bo\'lishi kerak.');
      return;
    }

    tg(`📝 <b>${articles.length} ta modda topildi.</b>\nHar birini tahlil qilyapman... ⏳`);

    const analyses = [];
    for (let i = 0; i < articles.length; i++) {
      if (i > 0 && i % 5 === 0) tg(`⏳ ${i}/${articles.length} tahlil qilindi...`);
      analyses.push(await analyzeArticle(articles[i].header, articles[i].body, currentSession.title));
    }

    tg('📄 PDF yaratilmoqda...');
    const pdfPath = await generateLawPDF(currentSession.title, articles, analyses);

    await bot.sendDocument(CHAT_ID, pdfPath, {}, {
      filename: `${currentSession.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
      contentType: 'application/pdf'
    });
    tg(`✅ <b>${currentSession.title}</b> — ${articles.length} ta modda tahlil qilindi. PDF tayyor!`);
    fs.unlink(pdfPath, () => {});

  } catch(e) {
    console.error('DOCX error:', e);
    tg(`❌ Xato: ${e.message}`);
  }
});

// Inline button handler
bot.on('callback_query', (query) => {
  if (query.data === 'push_motive') {
    const count = loadSubs().length;
    if (count === 0) {
      bot.answerCallbackQuery(query.id, {
        text: '⚠️ No browser subscriptions. Open your planner site and enable notifications first.',
        show_alert: true
      });
      return;
    }
    push('💎 Motivation', MOTIVE.replace(/<[^>]+>/g, ''));
    bot.answerCallbackQuery(query.id, { text: `✅ Sent to ${count} browser${count > 1 ? 's' : ''}!` });
  }
});

// ── Express server ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

app.get('/', (req, res) => res.json({ status: 'ok', bot: 'Life Planner Bot AI Edition' }));
app.get('/vapid-public-key', (req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY || null }));

// Web AI Coach chat endpoint
app.post('/chat', async (req, res) => {
  const { message, mode, history } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const systemPrompts = {
    coach: `You are a strict personal life coach for Azizbek in Tashkent. He works logistics, studies law, goes to gym daily, does Russian classes, builds a business. Goals: lose weight to 85kg, buy a car, master Russian, complete Juz Amma. Diet: no bread, no sugar. Be direct, honest, and motivating. Max 150 words per reply.`,
    russian: RUSSIAN_SYSTEM,
    finance: `You are a financial advisor for Azizbek in Tashkent, Uzbekistan. He earns a logistics salary and is trying to save 80% each month for a car. Give practical financial advice based on his questions. Max 150 words per reply.`,
  };

  try {
    const msgs = [
      { role: 'system', content: systemPrompts[mode] || systemPrompts.coach },
      ...(Array.isArray(history) ? history.slice(-6) : []),
      { role: 'user', content: message }
    ];
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o', messages: msgs, max_tokens: 250, temperature: 0.7
    });
    res.json({ reply: resp.choices[0].message.content });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AI Plan Generator ─────────────────────────────────────────────────────────
app.post('/generate-plan', async (req, res) => {
  const { goals, situation, vision, startDate, currentQuarterOnly, progress } = req.body;
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI not configured' });

  // Build a real-progress context block to personalise the plan
  const progressCtx = progress ? `
REAL PROGRESS DATA (use this to personalise — do NOT ignore):
- Task completion rate so far: ${progress.completionRate}%
- Prayer streak: ${progress.prayerStreak} consecutive days with all 5 prayers
- Diet compliance: ${progress.dietCompliance}% of days with clean eating
- Current weight: ${progress.currentWeight ? progress.currentWeight + 'kg' : 'not logged yet'} (target: 90kg)
- YouTube episodes uploaded: ${progress.ytUploaded} of 24
- Total savings: ${progress.savedAmount ? Math.round(progress.savedAmount).toLocaleString() + ' so\'m' : 'not logged'}
` : '';

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{
        role: 'system',
        content: `You are a life planning AI. Generate a complete, deeply personalized 2026 life plan as JSON.
${progressCtx}

OUTPUT THIS EXACT JSON SCHEMA (no extra fields):
{
  "generatedAt": "YYYY-MM-DD",
  "vision": {
    "tenYear": "1 powerful sentence describing the 2035 life",
    "oneYear": "1 sentence: what 2026 achievement means",
    "values": ["4-5 core values as short strings"],
    "milestones": { "2027": "string", "2028": "string", "2030": "string", "2035": "string" }
  },
  "quarters": [
    {
      "id": "summer",
      "name": "Summer 2026",
      "period": "Jun–Aug 2026",
      "theme": "short motivating theme",
      "goals": ["3-5 quarter goals as strings"],
      "months": [
        {
          "month": 6,
          "name": "June",
          "focus": "1 sentence monthly focus",
          "goals": ["3-4 monthly goals"],
          "weeks": [
            {
              "startDate": "YYYY-MM-DD",
              "num": 1,
              "theme": "short week theme",
              "quranSurah": "Surah name or null",
              "weekFocus": "1 sentence focus for this week",
              "tasks": {
                "weekday": [
                  {"id":"wk","cat":"work","text":"Work — Logistics shift (01–09)","time":"01:00","pts":1},
                  {"id":"q","cat":"quran","text":"personalized quran task","time":"09:00","pts":3},
                  {"id":"g1","cat":"gym","text":"personalized gym task","time":"09:30","pts":3},
                  {"id":"br","cat":"finance","text":"specific brokerage/tender study task","time":"11:00","pts":3},
                  {"id":"g2","cat":"gym","text":"Gym — Weight training (1.5hr)","time":"16:30","pts":3},
                  {"id":"pl","cat":"plan","text":"specific evening task","time":"20:00","pts":2}
                ],
                "saturday": [
                  {"id":"q","cat":"quran","text":"personalized","time":"09:00","pts":3},
                  {"id":"g","cat":"gym","text":"Gym — Full session","time":"10:00","pts":3},
                  {"id":"yt","cat":"content","text":"specific YouTube FK episode task","time":"12:00","pts":4},
                  {"id":"ed","cat":"content","text":"Edit & upload FK video","time":"14:30","pts":4},
                  {"id":"br","cat":"finance","text":"specific brokerage study","time":"17:00","pts":3}
                ],
                "sunday": [
                  {"id":"q","cat":"quran","text":"personalized quran review","time":"09:00","pts":3},
                  {"id":"g","cat":"gym","text":"Gym — Full session","time":"10:00","pts":3},
                  {"id":"br","cat":"finance","text":"specific weekly brokerage review","time":"12:00","pts":3},
                  {"id":"wr","cat":"plan","text":"Weekly review + plan next week","time":"18:00","pts":3}
                ]
              }
            }
          ]
        }
      ]
    },
    {
      "id": "school",
      "name": "School Quarter",
      "period": "Sep–Nov 2026",
      "theme": "short theme",
      "goals": ["3-5 goals"],
      "months": [
        {
          "month": 9, "name": "September", "focus": "string", "goals": ["3 goals"],
          "weeks": [{"startDate":"2026-09-01","num":1,"theme":"string","quranSurah":null,"weekFocus":"string","tasks":{"weekday":[{"id":"wk","cat":"work","text":"Work shift (01–09)","time":"01:00","pts":1},{"id":"q","cat":"quran","text":"Quran (20 min)","time":"09:00","pts":3},{"id":"g1","cat":"gym","text":"Gym — Cardio","time":"09:30","pts":3},{"id":"ru","cat":"russian","text":"Russian class (1hr)","time":"10:30","pts":3},{"id":"sc","cat":"study","text":"Law school (13:00–18:30)","time":"13:00","pts":1},{"id":"g2","cat":"gym","text":"Gym — Weights","time":"19:30","pts":3},{"id":"pl","cat":"plan","text":"Plan tomorrow","time":"21:30","pts":2}],"saturday":[{"id":"q","cat":"quran","text":"Quran","time":"09:00","pts":3},{"id":"g","cat":"gym","text":"Full gym session","time":"10:00","pts":3},{"id":"yt","cat":"content","text":"Film/edit YouTube","time":"12:00","pts":4},{"id":"ru","cat":"russian","text":"Russian self-study","time":"16:00","pts":3}],"sunday":[{"id":"q","cat":"quran","text":"Quran review","time":"09:00","pts":3},{"id":"g","cat":"gym","text":"Full gym","time":"10:00","pts":3},{"id":"uz","cat":"business","text":"Uzum marketplace study","time":"13:00","pts":3},{"id":"wr","cat":"plan","text":"Weekly review","time":"18:00","pts":3}]}}]
        },
        {"month":10,"name":"October","focus":"string","goals":["string"],"weeks":[]},
        {"month":11,"name":"November","focus":"string","goals":["string"],"weeks":[]}
      ]
    },
    {
      "id": "final",
      "name": "Final Quarter",
      "period": "Dec 2026",
      "theme": "string",
      "goals": ["2-3 goals"],
      "months": [{"month":12,"name":"December","focus":"string","goals":["string"],"weeks":[]}]
    }
  ]
}

RULES:
- ONLY generate full week tasks for June, July, August (14 weeks total)
- For Sep/Oct/Nov/Dec weeks array: leave empty [] — tasks are handled by app defaults
- Task text should be SPECIFIC to the week theme, not generic
- Quran surahs to memorise (An-Nas/Al-Falaq/Al-Ikhlas already known): Jun1=Al-Masad(111), Jun8=An-Nasr(110), Jun15=Al-Kafirun(109), Jun22=Al-Kawthar(108), Jun29=Al-Ma'un(107), Jul6=Quraysh(106), Jul13=Al-Fil(105), Jul20=Al-Humazah(104), Jul27=Al-Asr(103), Aug3=At-Takathur(102), Aug10=Al-Qari'ah(101), Aug17=Al-Adiyat(100), Aug24=Al-Zalzalah(99), Aug31=Al-Bayyinah(98)
- Summer week dates: Jun1, Jun8, Jun15, Jun22, Jun29, Jul6, Jul13, Jul20, Jul27, Aug3, Aug10, Aug17, Aug24, Aug31
- For YouTube: FK = Fuqarolik Kodeksi series, episodes 1-12 across summer Saturdays`
      }, {
        role: 'user',
        content: `Generate my complete 2026 life plan.

MY GOALS:
${goals}

MY SITUATION:
${situation}

MY 10-YEAR VISION:
${vision}

Today: ${startDate || new Date().toISOString().split('T')[0]}
Be deeply specific. Make every task text reference the actual goal for that week.`
      }],
      max_tokens: 4000,
      temperature: 0.6,
    });

    const plan = JSON.parse(resp.choices[0].message.content);
    plan.generatedAt = new Date().toISOString().split('T')[0];
    res.json({ plan });
  } catch(e) {
    console.error('Generate plan error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const subs = loadSubs();
  if (!subs.find(s => s.endpoint === sub.endpoint)) { subs.push(sub); saveSubs(subs); }
  res.json({ ok: true, total: subs.length });
});

app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  saveSubs(loadSubs().filter(s => s.endpoint !== endpoint));
  res.json({ ok: true });
});

// ── Study Plan Generator ──────────────────────────────────────────────────────
// Parses a freeform paste of video titles/links into daily study sessions.
// Each blank-line-separated group = one session assigned to the next study day.
app.post('/plan-studies', async (req, res) => {
  const { rawText, startDate, month, context = {} } = req.body;
  if (!rawText) return res.status(400).json({ error: 'rawText required' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI not configured' });

  const skipDays  = context.skipDays?.length ? context.skipDays.join(', ') : 'Sunday';
  const pace      = context.pace || 'normal';
  const timeBlock = context.timeBlock || '11:00–13:00';
  const sessionM  = context.sessionMins || 90;
  const goal      = context.goal || '';
  const dailyCtx  = context.dailyContext || 'work 01–09, gym twice a day';

  const paceRule = pace === 'relaxed'   ? '1 video per session (one session per day)'
                 : pace === 'intensive' ? '2-3 videos per session where related'
                 : '1-2 videos per session — pair related topics together';

  try {
    const prompt = `You are a personal study planner for Azizbek in Tashkent (UTC+5).
Parse the following video list into daily study sessions fitted into his real schedule.

CONTEXT:
- Batch goal: ${goal || 'not specified'}
- Study time: ${timeBlock} (${sessionM} minutes per session)
- Days off / skip: ${skipDays}
- Daily schedule: ${dailyCtx}
- Pace: ${paceRule}
- Start date: ${startDate || 'today'}

RAW VIDEO LIST (blank line = natural group):
"""
${rawText.trim()}
"""

RULES:
1. Each blank-line group = one session. Pair items within a group if pace allows.
2. Skip ${skipDays}. Assign Mon–Sat only (unless context says otherwise).
3. Extract any YouTube URL found on the same line as a title → set as "url".
4. Clean up titles: remove trailing commas, strip redundant punctuation.
5. "estimatedMinutes" = realistic watch + note-taking time (use sessionMins as guide).
6. "weekSkill" = one short skill label per calendar week (not per session).
7. "monthSkill" = overall skill gained from the whole batch.
8. "time" = the start of the study block (e.g. "11:00").

OUTPUT EXACTLY THIS JSON SCHEMA:
{
  "month": "${month || new Date().toISOString().slice(0,7)}",
  "monthSkill": "short skill name",
  "sessions": [
    {
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "sessionTitle": "Short combined title",
      "weekSkill": "skill for this week",
      "estimatedMinutes": 90,
      "items": [
        { "title": "clean title", "url": "https://... or null" }
      ]
    }
  ]
}`;

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
    });

    const plan = JSON.parse(resp.choices[0].message.content);
    res.json({ plan });
  } catch(e) {
    console.error('plan-studies error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Week AI Summarizer ────────────────────────────────────────────────────────
app.post('/summarize-week', async (req, res) => {
  const { days } = req.body; // [{date, done:[taskTexts]}]
  if (!days?.length) return res.status(400).json({ error: 'days required' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI not configured' });
  try {
    const dayLines = days.map(d => `${d.date}: ${d.done.join(', ')}`).join('\n');
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: `Summarize this week's completed tasks for Azizbek (Tashkent, goals: weight loss, Quran, YouTube FK series, law school prep, brokerage/finance).

COMPLETED TASKS:
${dayLines}

Output JSON:
{
  "summary": "2-3 sentence plain English summary of what was achieved this week",
  "skills": ["3-5 short skill/knowledge labels gained"],
  "highlights": ["2-3 specific achievements worth noting"]
}` }],
      max_tokens: 400,
    });
    const data = JSON.parse(resp.choices[0].message.content);
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🤖 Life Planner Bot AI Edition`);
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log(`🧠 OpenAI: ${process.env.OPENAI_API_KEY ? 'connected' : 'NOT SET'}`);
  console.log(`🔥 Firebase: ${firestoreDb ? 'connected' : 'NOT SET'}`);
  console.log(`📅 Timezone: Asia/Tashkent (UTC+5)\n`);
});
