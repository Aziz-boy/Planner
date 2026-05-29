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
    process.env.VAPID_EMAIL || 'mailto:admin@example.com',
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
      content: `Sen Azizbek uchun yuridik hujjatlarni tahlil qiluvchi yordamchisan. U Toshkentda huquq fakultetida o'qiydi va YouTube uchun video tushiradi.
Har bir moddani quyidagi formatda tahlil qil (O'zbek tilida yoz):
1. 📌 ASOSIY MA'NO — 1-2 jumlada sodda tilda
2. 🔑 KALIT TUSHUNCHALAR — 3-5 ta muhim atama va ta'rifi
3. ⚖️ AMALIY MISOL — real hayotdan 1 ta konkret misol
4. ❓ VIDEO UCHUN SAVOL — tomoshabinlarga beriladigan 1 ta qiziqarli savol

Qisqa, aniq, tushinarli yoz. Huquqiy jargondan qoching.`
    }, {
      role: 'user',
      content: `Hujjat: ${docTitle}\n\n${header}\n${body}`
    }],
    max_tokens: 400,
    temperature: 0.5,
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

// Daily AI Coach — 09:05 Tashkent (after work ends)
cron.schedule('5 9 * * *', async () => {
  tg('🧠 <b>Daily AI Coach</b> — analysing your data...');
  try {
    const data = await readFirebaseData();
    if (!data) { tg('⚠️ No Firebase data yet. Save your planner data first.'); return; }
    const report = await gptCoach(data);
    tg(`🧠 <b>Daily AI Coach — ${new Date(Date.now()+5*3600*1000).toISOString().split('T')[0]}</b>\n\n${report}`);
  } catch(e) { tg(`❌ Coach error: ${e.message}`); }
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

// Daily schedule reminders
const schedule = [
  { time: '30 0  * * *', msg: '🌙 Work starts in 30 min! Prepare yourself.' },
  { time: '5  9  * * *', msg: '✅ Work done! Morning routine: Quran → Gym cardio → Russian class → Finance video' },
  { time: '15 9  * * *', msg: '📖 Quran time — 20 minutes. Don\'t skip it!' },
  { time: '0  10 * * *', msg: '💪 Gym — Cardio session now! 1 hour fat loss' },
  { time: '30 10 * * *', msg: '🇷🇺 Russian class time!' },
  { time: '30 12 * * *', msg: '📺 Finance video time — watch today\'s UTAX video' },
  { time: '0  13 * * *', msg: '🍽️ BREAKFAST — eat clean, no bread no sugar!' },
  { time: '30 16 * * *', msg: '💪 Gym — Weight training session now!' },
  { time: '0  18 * * 1-6', msg: '🍽️ LUNCH — clean meal, no bread no sugar!' },
  { time: '30 18 * * *', msg: '📚 Business study: Uzum marketplace or China imports' },
  { time: '0  20 * * *', msg: '🕌 Maghrib prayer time!' },
  { time: '0  21 * * *', msg: '🍽️ DINNER — last meal, keep it clean!' },
  { time: '30 21 * * *', msg: '💾 Save your life plan progress before sleep!' },
  { time: '0  22 * * *', msg: '🕌 Isha prayer time!' },
  { time: '30 23 * * *', msg: '😴 Sleep now — wake up at 00:30 for work!' },
  { time: '0  18 * * 0', msg: '📊 Weekly reflection time! Rate your week 1–10:\n• Discipline\n• Deen\n• Health\n• Business\n• Mindset' },
  { time: '0  19 * * 0', msg: '📅 Plan next week — open your life plan and set goals' },
];
schedule.forEach(({ time, msg }) => {
  cron.schedule(time, () => remind(msg), { timezone: 'Asia/Tashkent' });
});

// ── Telegram commands ─────────────────────────────────────────────────────────
bot.onText(/\/start/, () => {
  tg(`👋 <b>Life Planner Bot — AI Edition</b>

📅 <b>Daily reminders</b> sent automatically (UTC+5)
🧠 <b>AI Coach</b> every morning at 09:05

<b>Commands:</b>
/coach — AI analysis of your data right now
/russian — Start Russian practice session
/finance — Financial analysis + money leak report
/report — Generate this week's full report
/predict — Goal deadline predictions with real math
/pdf — Qonun moddalarini tahlil qilib PDF yaratish
/schedule — Today's full schedule
/motive — Motivational quote
/prayers — Tashkent prayer times
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

  // ── PDF session ──────────────────────────────────────────────────────────
  if (pdfSessions.has(CHAT_ID)) {
    const session = pdfSessions.get(CHAT_ID);

    if (session.stage === 'waiting_title') {
      session.title = msg.text.trim();
      session.stage = 'waiting_text';
      pdfSessions.set(CHAT_ID, session);
      tg(`✅ Nom saqlandi: <b>${session.title}</b>

Endi hujjat matnini yuboring.
Barcha moddalar bo'lsa ham yuboring — men o'zim ajrataman.
<i>Katta matn bo'lsa ham muammo yo'q.</i>`);
      return;
    }

    if (session.stage === 'waiting_text') {
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

        await bot.sendDocument(CHAT_ID, filePath, {
          caption: `✅ <b>${session.title}</b>\n${articles.length} ta modda tahlil qilindi.\n\n📺 YouTube video uchun tayyor!`,
          parse_mode: 'HTML'
        });

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

app.listen(PORT, () => {
  console.log(`\n🤖 Life Planner Bot AI Edition`);
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log(`🧠 OpenAI: ${process.env.OPENAI_API_KEY ? 'connected' : 'NOT SET'}`);
  console.log(`🔥 Firebase: ${firestoreDb ? 'connected' : 'NOT SET'}`);
  console.log(`📅 Timezone: Asia/Tashkent (UTC+5)\n`);
});
