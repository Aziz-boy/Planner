// State lives on window so Firebase module can access it
window._appState     = {};
window._dietState    = {};
window._moneyState   = {};
window._savingsState = {};
window._prayerState  = {};
window._workoutState = {};
window._reflectState = {};
window._ytState      = {};
window._weightState  = {};
window._aiPlanState  = null;
window._roadmapState = {};
window._studyPlan    = null;
window._customTasks  = {};

const STORAGE_FIELDS = {
  tasks: '_appState',
  diet: '_dietState',
  money: '_moneyState',
  savings: '_savingsState',
  prayer: '_prayerState',
  workout: '_workoutState',
  reflect: '_reflectState',
  youtube: '_ytState',
  weight: '_weightState',
  aiPlan: '_aiPlanState',
  roadmap: '_roadmapState',
  studyPlan: '_studyPlan',
  customTasks: '_customTasks',
};
const NULLABLE_STORAGE_FIELDS = new Set(['aiPlan', 'studyPlan']);
const LEGACY_STORAGE_KEYS = {
  money: 'life_plan_2026_money',
  savings: 'life_plan_2026_savings',
  diet: 'life_plan_2026_diet',
  prayer: 'life_plan_2026_prayer',
  workout: 'life_plan_2026_workout',
  reflect: 'life_plan_2026_reflect',
  youtube: 'life_plan_2026_youtube',
};

function parseStoredValue(field, value) {
  const fallback = NULLABLE_STORAGE_FIELDS.has(field) ? null : {};
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (error) {
    console.warn(`Ignoring invalid local field: ${field}`, error);
    return fallback;
  }
}

window._hydrateLocalBackup = function hydrateLocalBackup() {
  Object.entries(STORAGE_FIELDS).forEach(([field, globalName]) => {
    try {
      const current = localStorage.getItem(field);
      const legacy = current == null && LEGACY_STORAGE_KEYS[field]
        ? localStorage.getItem(LEGACY_STORAGE_KEYS[field])
        : null;
      window[globalName] = parseStoredValue(field, current ?? legacy);
    } catch (error) {
      console.warn(`Local backup unavailable for ${field}`, error);
    }
  });
};

window._collectPlannerPayload = function collectPlannerPayload() {
  const payload = {};
  Object.entries(STORAGE_FIELDS).forEach(([field, globalName]) => {
    const value = window[globalName] ?? (NULLABLE_STORAGE_FIELDS.has(field) ? null : {});
    payload[field] = value == null ? null : JSON.stringify(value);
  });
  payload.savedAt = nowTashkent().toISOString();
  return payload;
};

window._saveLocalBackup = function saveLocalBackup(options = {}) {
  const payload = options.payload || window._collectPlannerPayload();
  Object.entries(payload).forEach(([field, value]) => {
    if (field === 'savedAt') return;
    try {
      if (value == null) localStorage.removeItem(field);
      else localStorage.setItem(field, value);
    }
    catch (error) { console.warn(`Could not back up ${field} locally`, error); }
  });
  if (options.markClean !== false) unsavedChanges = false;
  if (!options.quiet) setSaveStatus('saved', 'Saved locally ✓');
  return payload;
};

// Local proxy references (reassigned after Firebase load)
let state        = window._appState;
let unsavedChanges = false;
let autoSaveTimer = null;

// Called by Firebase module on first load AND on every remote sync
let _appInitialized = false;
window._appInitialized = false;
window._onFirebaseLoaded = function(loadInfo = {}) {
  state        = window._appState;
  dietState    = window._dietState;
  moneyState   = window._moneyState;
  savingsState = window._savingsState;
  prayerState  = window._prayerState;
  workoutState = window._workoutState;
  reflectState = window._reflectState;
  ytState      = window._ytState;

  if (!_appInitialized) {
    _appInitialized = true;
    window._appInitialized = true;
    document.getElementById('loadingOverlay').style.display='none';
  }
  // Every data source, including the first local backup and later cloud
  // snapshots, refreshes the same UI path. Individual renderers are isolated so
  // one legacy value cannot prevent the rest of the planner from loading.
  renderAll();

  const dot=document.getElementById('saveDot');
  const lbl=document.getElementById('saveLabel');
  const labels = {
    local: 'Local data ready — checking cloud…',
    cloud: 'Cloud synced ✓',
    cache: 'Offline — cached data ready',
    'cloud-empty': 'Cloud connected — ready to save',
    'local-fallback': 'Cloud unavailable — local data is safe',
  };
  if(dot) dot.className = loadInfo.source === 'local-fallback' ? 'save-dot error' : 'save-dot saved';
  if(lbl && labels[loadInfo.source]) lbl.textContent = labels[loadInfo.source];
};

function setSaveStatus(status, msg) {
  const dot = document.getElementById('saveDot');
  const lbl = document.getElementById('saveLabel');
  if(dot) dot.className = 'save-dot ' + status;
  if(lbl) lbl.textContent = msg;
}
window._setPlannerSaveStatus = setSaveStatus;
window._markCloudSaved = function markCloudSaved() { unsavedChanges = false; };
window._hasUnsavedPlannerChanges = function hasUnsavedPlannerChanges() { return unsavedChanges; };

// loadFromCloud handled by Firebase module above

function saveToCloud() { return window.saveAllData(); }

function scheduleSave() {
  unsavedChanges = true;
  // Sync ALL state to window globals so saveAllData picks up everything
  window._appState     = state;
  window._dietState    = dietState;
  window._moneyState   = moneyState;
  window._savingsState = savingsState;
  window._prayerState  = prayerState;
  window._workoutState = workoutState;
  window._reflectState = reflectState;
  window._ytState      = ytState;
  // weight + aiPlan synced here too
  if (typeof weightState   !== 'undefined') window._weightState   = weightState;
  if (typeof aiPlanState   !== 'undefined') window._aiPlanState   = aiPlanState;
  if (typeof roadmapState  !== 'undefined') window._roadmapState  = roadmapState;
  if (typeof studyPlan     !== 'undefined') window._studyPlan     = studyPlan;
  if (typeof customTasks   !== 'undefined') window._customTasks   = customTasks;
  // Keep a durable local copy immediately, then debounce cloud writes. The
  // manual button remains as "Sync now", but normal use never depends on it.
  window._saveLocalBackup?.({ markClean: false, quiet: true });
  setSaveStatus('saving', 'Saving automatically…');
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (!_appInitialized) return;
    if (window._firebaseModuleStarted && typeof window.saveAllData === 'function') {
      window.saveAllData();
    } else {
      setSaveStatus('saved', 'Saved locally — cloud will retry');
    }
  }, 900);
}

// The Firebase module replaces this with cloud save. Local save remains available
// when Firebase's CDN or the network cannot be reached.
window.saveAllData = function saveAllDataLocally() {
  return window._saveLocalBackup({ markClean: false });
};

// ═══════════════════════════════════════════
// DATA DEFINITIONS
// ═══════════════════════════════════════════
const CATS = {
  work:    {color:'#D94A4A', label:'Work'},
  quran:   {color:'#C9A84C', label:'Quran'},
  gym:     {color:'#4CAF7D', label:'Gym'},
  russian: {color:'#B464C8', label:'Russian'},
  finance: {color:'#E07A30', label:'Finance'},
  study:   {color:'#4A90D9', label:'Study'},
  content: {color:'#FF6080', label:'Content'},
  business:{color:'#40C0D0', label:'Business'},
  plan:    {color:'#888',    label:'Planning'},
};

const CATEGORY_ALIASES = Object.freeze({
  health: 'gym', fitness: 'gym', workout: 'gym',
  deen: 'quran', faith: 'quran', prayer: 'quran',
  education: 'study', school: 'study', learning: 'study',
  money: 'finance', investing: 'finance',
  youtube: 'content', social: 'content',
  life: 'plan', personal: 'plan', general: 'plan',
});

function getCategoryMeta(value) {
  const raw = String(value || 'plan').toLowerCase();
  const key = CATS[raw] ? raw : (CATEGORY_ALIASES[raw] || 'plan');
  return { key, ...CATS[key] };
}

function taskPoints(task) {
  const points = Number(task?.pts);
  return Number.isFinite(points) && points > 0 ? points : 1;
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeHttpUrl(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const url = new URL(raw, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

const START = new Date('2026-05-30');
const END   = new Date('2026-12-31');

// ── Tashkent time (UTC+5) — authoritative source for ALL date/time logic ──────
// Shifts the UTC clock by +5 h so ISO string and UTC accessors give Tashkent values.
// Use .getUTCFullYear() / .getUTCMonth() / .getUTCDate() / .getUTCDay() / .getUTCHours()
// on the returned object, or just pass it to dateKey() which uses .toISOString().
function nowTashkent() { return new Date(Date.now() + 5 * 3600 * 1000); }
function tashKey()     { return nowTashkent().toISOString().split('T')[0]; } // "YYYY-MM-DD" Tashkent
function tashMidnight(){ const d=nowTashkent(); d.setUTCHours(0,0,0,0); return d; } // today at 00:00 Tashkent

function getDayType(date) {
  const dow = date.getUTCDay(); // use UTC — works for both UTC-midnight dates & nowTashkent() shifted dates
  if (dow === 1) return 'monday';
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return date >= new Date('2026-09-01') ? 'school' : 'summer';
}

// UTAX videos assigned one per finance day (oldest→newest, no shorts <2min)
const UTAX_VIDEOS = [
  {title:'Soliq kodeksiga sharh, 1-modda',                                         url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Soliq kodeksiga sharh, 2-modda',                                         url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Soliq Kodeksiga sharh | 3-modda',                                        url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Soliq Kodeksiga sharh | 4-modda',                                        url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Soliq Kodeksiga sharh | 5-modda',                                        url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Soliq Kodeksiga sharh | 6-modda',                                        url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'EHF bloklanishi qonuniymi?',                                             url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Tadbirkorlar muammolari ko\'tarildi',                                    url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'UTAX tarixi | Murod Muhamedjanov',                                       url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Norezident investorlarning soliq stavkalari qanday?',                    url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Import qilingan tovarni sotishda QQS qanday hisoblanadi?',               url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Chek urishdagi xatolar qanday oqibatlarga olib keladi?',                 url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'MAY oyida qonunchilikka kiritilgan soliqqa oid o\'zgarishlar',           url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'IYUN oyi yangiliklari',                                                  url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Avtokameral natijasida aniqlangan xatoliklar',                           url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'UTAX iyun oyi dayjesti',                                                 url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'UTAX\'ning 14 yilligi — to\'liq video',                                 url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Ustav fondini to\'g\'ri shakllantirish | Murod Muhamedjanov',            url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Oradan 3 yil o\'tib 1 milliard jarima | Saidjon Hamroyev',              url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'UTAX dayjesti | Iyul oyi',                                               url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'PQ-247 | YTT va o\'zini o\'zi band qilgan shaxslar uchun yangi imkoniyatlar', url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Bozor narxini noto\'g\'ri baholashmoqda | Saidjon Hamroyev',             url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Soliq kodeksi 7-8-moddalar sharhi | Murod Muhamedjanov',                url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'"Soliq tekshiruvlaridagi TOP-10 xatolar" jonli efiri | Podcast',        url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'UTAX dayjesti | Avgust oyi',                                             url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'UTAX\'ning Namangandagi yangi filiali | TO\'LIQ VIDEO',                 url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'UTAX dayjesti | Sentabr oyi',                                            url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Chet el fuqarolari uchun maxsus soliq rejimi',                           url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Barqarorlik reytingi va undan ko\'zlangan maqsad | Umidbek Safarov',    url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Debitor qarzdorlikning soliq oqibatlari | Jaloliddin Norboyev',         url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Tadbirkorlar uchun katta yangilik | Umidbek Safarov',                   url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'SOLIQ TIZIMIDAGI MUAMMOLAR | UTAX PODKAST',                             url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Soliqlardan xotirjam bo\'ling! | UTAX dayjest',                         url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Endi biznes boshlash yanada oson | Soliq yangiliklari',                 url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Kameral tekshiruvdan kelgan jarimani qanday bekor qilish mumkin?',      url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'2026-yilda soliq tizimida nimalar o\'zgaradi?',                         url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'2026-yilda bu muammolarga duch kelmaslik uchun videoni ko\'ring!',      url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Yillik soliq hisobotlaridagi muammolar va ularning yechimlari',         url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Tadbirkorlar 2026-yilda nimalarga e\'tiborli bo\'lishi kerak? | Podcast', url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Barqarorlik reyting imtiyozlari va ballni ko\'paytirish yo\'llari!',    url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Tadbirkormisiz? Bu soliqlarni bilishingiz shart! | Niyazmetov Islombek', url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Nega soliq tekshiruvi chiqadi? | UTAX',                                 url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'Alisher Isayev nega UTAX\'ni "102" deb ataydi?',                        url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'"Soliqdagi bitta xato biznesga qimmatga tushadi" — Feedup asoschisi',  url:'https://www.youtube.com/@utax_uzb/videos'},
  // After all videos done, cycle review
  {title:'REVIEW: Soliq kodeksi 1-6-moddalar takrorlash',                         url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'REVIEW: Soliq tekshiruvi mavzularini takrorlash',                       url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'REVIEW: QQS va import mavzularini takrorlash',                          url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'REVIEW: 2026 soliq o\'zgarishlari takrorlash',                          url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'REVIEW: Barqarorlik reytingi takrorlash',                               url:'https://www.youtube.com/@utax_uzb/videos'},
  {title:'REVIEW: Ustav fondi va investorlar mavzusi takrorlash',                 url:'https://www.youtube.com/@utax_uzb/videos'},
];

// Count which finance-day index this date is (Mon–Fri only, starting Jun 1)
function getFinanceVideoForDate(date) {
  const key = dateKey(date);
  // Count finance days from START up to this date
  let idx = 0;
  let d = new Date(START);
  while(d <= date) {
    const dow = d.getUTCDay();
    if(dow !== 0 && dow !== 6) { // Mon–Sat get finance task
      if(dateKey(d) === key) break;
      idx++;
    }
    d = addDays(d, 1);
  }
  return UTAX_VIDEOS[idx % UTAX_VIDEOS.length];
}

function getTasksForDate(date) {
  // If AI plan is active, use AI-generated tasks
  const aiTasks = (typeof getAITasksForDate === 'function') ? getAITasksForDate(date) : null;
  if (aiTasks && aiTasks.length > 0) {
    return (typeof mergeStudyTask === 'function') ? mergeStudyTask(date, aiTasks) : aiTasks;
  }

  const t = getDayType(date);
  const vid = getFinanceVideoForDate(date);
  const fiText = `📺 Watch: ${vid.title}`;

  const isSummer = date < new Date('2026-09-01');

  // ── SATURDAY (filming day year-round) ─────────────────────────────────────
  if (t === 'saturday') return isSummer ? [
    {id:'q', cat:'quran',    text:'Quran — memorize this week\'s surah',  time:'09:00', pts:3},
    {id:'g', cat:'gym',      text:'Gym — Full session (cardio+weights)',  time:'10:00', pts:3},
    {id:'yt',cat:'content',  text:'🎬 Film YouTube FK video (episode)',   time:'12:00', pts:4},
    {id:'ed',cat:'content',  text:'Edit & upload YouTube FK video',       time:'14:00', pts:4},
    {id:'br',cat:'finance',  text:'Brokerage / tender / auction study',   time:'17:00', pts:3},
    {id:'pl',cat:'plan',     text:'Plan next week goals',                 time:'19:00', pts:2},
  ] : [
    {id:'q', cat:'quran',    text:'Quran 45 min + memorization review',   time:'09:00', pts:3},
    {id:'g', cat:'gym',      text:'Gym — Full session (cardio+weights)',  time:'10:00', pts:3},
    {id:'yt',cat:'content',  text:'Film YouTube video (law topic)',        time:'12:00', pts:4},
    {id:'ed',cat:'content',  text:'Edit & post YouTube video',             time:'14:00', pts:4},
    {id:'fi',cat:'finance',  text:fiText,                                  time:'17:00', pts:3, url:vid.url},
    {id:'bs',cat:'business', text:'Business planning: Uzum / China',      time:'19:00', pts:3},
  ];

  // ── SUNDAY ────────────────────────────────────────────────────────────────
  if (t === 'sunday') return isSummer ? [
    {id:'q', cat:'quran',    text:'Quran 45 min + review week\'s surah',  time:'09:00', pts:3},
    {id:'g', cat:'gym',      text:'Gym — Full session',                    time:'10:00', pts:3},
    {id:'br',cat:'finance',  text:'Brokerage/tender/auction deep study',  time:'12:00', pts:3},
    {id:'sc',cat:'finance',  text:'Saving review — check car fund goal',  time:'15:00', pts:2},
    {id:'wr',cat:'plan',     text:'Weekly review — what did I complete?', time:'18:00', pts:3},
    {id:'pw',cat:'plan',     text:'Plan next week — write top goals',     time:'19:00', pts:3},
  ] : [
    {id:'q', cat:'quran',    text:'Quran 45 min + new surah work',        time:'09:00', pts:3},
    {id:'g', cat:'gym',      text:'Gym — Full session',                    time:'10:00', pts:3},
    {id:'uz',cat:'business', text:'Uzum marketplace: research / list',    time:'12:00', pts:3},
    {id:'ch',cat:'business', text:'China import: product research',       time:'14:00', pts:3},
    {id:'fi',cat:'finance',  text:'Review notes from this week\'s video', time:'16:00', pts:3},
    {id:'wr',cat:'plan',     text:'Weekly review — what did I complete?', time:'18:00', pts:3},
    {id:'pw',cat:'plan',     text:'Plan next week — write top goals',     time:'19:00', pts:3},
  ];

  // ── SCHOOL SEASON weekdays (Sept+) ────────────────────────────────────────
  if (t === 'school') return [
    {id:'wk',cat:'work',     text:'Work — Logistics shift (01–09)',        time:'01:00', pts:1},
    {id:'q', cat:'quran',    text:'Quran + prayer (20 min)',               time:'09:00', pts:3},
    {id:'g1',cat:'gym',      text:'Gym — Cardio (45 min)',                 time:'09:20', pts:3},
    {id:'ru',cat:'russian',  text:'Russian class (1 hr)',                  time:'10:30', pts:3},
    {id:'sc',cat:'study',    text:'Law school (13:00–18:30)',              time:'13:00', pts:1},
    {id:'fi',cat:'finance',  text:fiText,                                  time:'18:30', pts:3, url:vid.url},
    {id:'g2',cat:'gym',      text:'Gym — Weight training (1.5hr)',         time:'19:30', pts:3},
    {id:'pl',cat:'plan',     text:'Plan tomorrow\'s top 3 tasks',          time:'21:30', pts:2},
  ];

  // ── SCHOOL SEASON Monday (Sept+) ──────────────────────────────────────────
  if (t === 'monday') return [
    {id:'wk',cat:'work',     text:'Work — Logistics shift (01–09)',        time:'01:00', pts:1},
    {id:'q', cat:'quran',    text:'Quran + prayer (20 min)',               time:'09:00', pts:3},
    {id:'g1',cat:'gym',      text:'Gym — Cardio (1 hr)',                   time:'09:30', pts:3},
    {id:'ru',cat:'russian',  text:'Russian class / self-study (1.5hr)',   time:'10:30', pts:3},
    {id:'sc',cat:'study',    text:'Law school (13:00–18:30)',              time:'13:00', pts:1},
    {id:'fi',cat:'finance',  text:fiText,                                  time:'18:30', pts:3, url:vid.url},
    {id:'g2',cat:'gym',      text:'Gym — Weight training (1.5hr)',         time:'19:30', pts:3},
    {id:'bs',cat:'business', text:'Business study: Uzum / China',          time:'21:00', pts:3},
    {id:'pl',cat:'plan',     text:'Plan tomorrow\'s top 3 tasks',          time:'22:00', pts:2},
  ];

  // ── SUMMER weekday (May 30 – Aug 31) — 4 GOALS ONLY ─────────────────────
  const summerWeekday = [
    {id:'wk',cat:'work',     text:'Work — Logistics shift (01–09)',        time:'01:00', pts:1},
    {id:'q', cat:'quran',    text:'Quran + this week\'s surah (20 min)',   time:'09:00', pts:3},
    {id:'g1',cat:'gym',      text:'Gym — Cardio (1 hr fat loss)',          time:'09:30', pts:3},
    {id:'br',cat:'finance',  text:'Brokerage / tender / auction study',    time:'11:00', pts:3},
    {id:'g2',cat:'gym',      text:'Gym — Weight training (1.5hr)',         time:'16:30', pts:3},
    {id:'sv',cat:'plan',     text:'Car fund: check savings progress',      time:'20:00', pts:2},
    {id:'pl',cat:'plan',     text:'Plan tomorrow\'s top 3 tasks',          time:'20:30', pts:2},
  ];
  return (typeof mergeStudyTask === 'function') ? mergeStudyTask(date, summerWeekday) : summerWeekday;
}

const MONTHLY_GOALS = {
  6:[
    {text:'Start daily Quran habit & memorize 10 surahs',    cat:'quran',    color:'#C9A84C'},
    {text:'Russian: complete month 1 — basic phrases',       cat:'russian',  color:'#B464C8'},
    {text:'Body: first 3kg lost (reach 102kg)',               cat:'gym',      color:'#4CAF7D'},
    {text:'Open investment/brokerage account',               cat:'finance',  color:'#E07A30'},
    {text:'Register as seller on Uzum marketplace',          cat:'business', color:'#40C0D0'},
    {text:'Post 4 YouTube videos (1 per week)',               cat:'content',  color:'#FF6080'},
    {text:'YouTube: reach 400 subscribers',                  cat:'content',  color:'#FF6080'},
    {text:'Save 80% of June salary',                         cat:'plan',     color:'#888'},
  ],
  7:[
    {text:'Memorize 20 surahs total — find an ustoz',        cat:'quran',    color:'#C9A84C'},
    {text:'Russian: hold a basic 5-min conversation',        cat:'russian',  color:'#B464C8'},
    {text:'Body: 7kg total lost (98kg)',                     cat:'gym',      color:'#4CAF7D'},
    {text:'Make first real small investment',                cat:'finance',  color:'#E07A30'},
    {text:'First Uzum sale — 5+ products listed',            cat:'business', color:'#40C0D0'},
    {text:'YouTube: 1,000 subscribers 🎉',                   cat:'content',  color:'#FF6080'},
    {text:'Contact first China supplier',                    cat:'business', color:'#40C0D0'},
  ],
  8:[
    {text:'Complete Juz Amma — all 37 surahs memorized 🎉',  cat:'quran',    color:'#C9A84C'},
    {text:'Russian: 75% of course done',                     cat:'russian',  color:'#B464C8'},
    {text:'Body: 12kg total lost (93kg)',                    cat:'gym',      color:'#4CAF7D'},
    {text:'Start Forex demo trading',                        cat:'finance',  color:'#E07A30'},
    {text:'Scale Uzum to 10+ products',                      cat:'business', color:'#40C0D0'},
    {text:'YouTube: 2,000 subscribers',                      cat:'content',  color:'#FF6080'},
    {text:'Plan September school+work schedule',             cat:'plan',     color:'#888'},
  ],
  9:[
    {text:'Maintain daily Quran habit through new schedule', cat:'quran',    color:'#C9A84C'},
    {text:'Russian: no gap — keep attending class',          cat:'russian',  color:'#B464C8'},
    {text:'Body: 15kg total lost (90kg)',                    cat:'gym',      color:'#4CAF7D'},
    {text:'Focus deep on civil law at school',               cat:'study',    color:'#4A90D9'},
    {text:'Uzum running passively while in school',          cat:'business', color:'#40C0D0'},
    {text:'YouTube: 2,500 subscribers',                      cat:'content',  color:'#FF6080'},
  ],
  10:[
    {text:'10 new surahs memorized with ustoz',              cat:'quran',    color:'#C9A84C'},
    {text:'Russian: complete full course! 🎉',               cat:'russian',  color:'#B464C8'},
    {text:'Body: 18kg total lost (87kg)',                    cat:'gym',      color:'#4CAF7D'},
    {text:'Active Forex + stocks demo trading',              cat:'finance',  color:'#E07A30'},
    {text:'Evaluate China product sample',                   cat:'business', color:'#40C0D0'},
    {text:'YouTube: 3,500 subscribers',                      cat:'content',  color:'#FF6080'},
  ],
  11:[
    {text:'Quran + prayer routine fully consistent',         cat:'quran',    color:'#C9A84C'},
    {text:'Russian: use in real daily situations',           cat:'russian',  color:'#B464C8'},
    {text:'Body: 19kg total lost (86kg)',                    cat:'gym',      color:'#4CAF7D'},
    {text:'Start real investment positions',                 cat:'finance',  color:'#E07A30'},
    {text:'Car savings: evaluate readiness',                 cat:'plan',     color:'#888'},
    {text:'YouTube: 4,500 subscribers',                      cat:'content',  color:'#FF6080'},
  ],
  12:[
    {text:'Annual Quran review + set 2027 memorization plan',cat:'quran',    color:'#C9A84C'},
    {text:'Russian: full conversations confidently',         cat:'russian',  color:'#B464C8'},
    {text:'Body: 20kg lost — 85kg 🎉 GOAL!',                cat:'gym',      color:'#4CAF7D'},
    {text:'Portfolio review — plan 2027 investments',        cat:'finance',  color:'#E07A30'},
    {text:'Buy the car 🚗 if savings ready',                 cat:'plan',     color:'#888'},
    {text:'YouTube: 5,000 subscribers 🎉 GOAL!',            cat:'content',  color:'#FF6080'},
    {text:'Instagram: 10,000 followers 🎉 GOAL!',           cat:'content',  color:'#FF6080'},
    {text:'Write full 2026 review + 2027 plan',              cat:'plan',     color:'#888'},
  ],
};

const VISION = [
  {num:1,label:'Family',   text:'Marry a righteous woman & have 3 children',step:'Save & build stability for marriage'},
  {num:2,label:'Business', text:'Become a successful businessman',           step:'Launch Uzum + learn China imports'},
  {num:3,label:'Faith',    text:'Go to Hajj with family',                    step:'Start dedicated Hajj savings fund'},
  {num:4,label:'Community',text:'Provide jobs for 500 people',               step:'Build first business operation'},
  {num:5,label:'Legacy',   text:'Build a Masjid in Shavgonda',               step:'Save consistently every month'},
  {num:6,label:'Wealth',   text:'Become a dollar millionaire',               step:'Master investing, stocks & trading'},
  {num:7,label:'Deen',     text:'Become a Qori (Quran memorizer)',           step:'Memorize Juz Amma + find ustoz'},
];

const TRACKERS = [
  {icon:'💪',name:'Body Transformation', desc:'105kg → 85kg · Gym every day · 9 months',        cat:'gym',      color:'#4CAF7D'},
  {icon:'📖',name:'Quran Memorization',  desc:'Daily habit → Juz Amma → Juz 29 + ustoz',        cat:'quran',    color:'#C9A84C'},
  {icon:'🇷🇺',name:'Russian Language',   desc:'Paid course → conversational by December',        cat:'russian',  color:'#B464C8'},
  {icon:'📺',name:'YouTube — 5K Subs',   desc:'147 → 5,000 · 1 Uzbek law video / week',         cat:'content',  color:'#FF6080'},
  {icon:'📸',name:'Instagram — 10K',     desc:'298 → 10,000 · Business & Law content in Uzbek', cat:'content',  color:'#FF8860'},
  {icon:'📈',name:'Finance & Investing', desc:'Stocks, Forex, crypto · utax_uzb · 1hr/day',     cat:'finance',  color:'#E07A30'},
  {icon:'🛒',name:'Uzum Marketplace',    desc:'Learn → Register → List → Sell → Scale',         cat:'business', color:'#40C0D0'},
  {icon:'🚗',name:'Buy a Car',           desc:'Save 80% monthly → target car fund',              cat:'plan',     color:'#888'},
];

// ═══════════════════════════════════════════
// STATE HELPERS
// ═══════════════════════════════════════════
function dateKey(d) { return d.toISOString().split('T')[0]; }
function utcDate(year, monthIndex, day) { return new Date(Date.UTC(year, monthIndex, day)); }
// Always use UTC operations so results are correct on any device timezone
function addDays(d,n) { const r=new Date(d); r.setUTCDate(r.getUTCDate()+n); return r; }
function clamp(d) { if(d<START)return new Date(START); if(d>END)return new Date(END); return new Date(d); }
// UTC-safe today: clean UTC-midnight date for current Tashkent day
function todayUTC() { return new Date(tashKey()); }
function getMonday(d) { const r=new Date(d); const dow=r.getUTCDay(); r.setUTCDate(r.getUTCDate()-(dow===0?6:dow-1)); return r; }

function getTask(dateStr,id) { return !!(state[dateStr]&&state[dateStr][id]); }

function toggleTask(dateStr,id) {
  if(!state[dateStr]) state[dateStr]={};
  state[dateStr][id] = !getTask(dateStr,id);
  if(navigator.vibrate) navigator.vibrate(30);
  scheduleSave();
  renderAll();
}

// Get completion stats for a single day
function dayStats(date) {
  if(date<START||date>END) return {done:0,total:0,pts:0,maxPts:0,pct:0};
  const tasks=getTasksForDate(date), key=dateKey(date);
  let done=0,pts=0,maxPts=0;
  tasks.forEach(t=>{const p=taskPoints(t); maxPts+=p; if(getTask(key,t.id)){done++;pts+=p;}});
  return {done,total:tasks.length,pts,maxPts,pct:maxPts?Math.round(pts/maxPts*100):0};
}

// Get cat-level points for a date range
// countAll=true → count all tasks in range as "total" (for monthly/overall bars)
// countAll=false (default) → only count days up to today as "total" (fair %)
function catStatsRange(fromDate, toDate, catFilter, countAll) {
  let done=0, total=0;
  const rangeStart = new Date(Math.max(new Date(fromDate), START));
  const rangeEnd   = new Date(Math.min(new Date(toDate),   END));
  // For "total possible", cap at today unless countAll=true
  const totalCap   = countAll ? rangeEnd : new Date(Math.min(rangeEnd, nowTashkent()));

  let d = new Date(rangeStart);
  while(d <= rangeEnd){
    const key = dateKey(d);
    getTasksForDate(d).forEach(t=>{
      if(!catFilter || getCategoryMeta(t.cat).key===catFilter){
        const points = taskPoints(t);
        // Count as done if checked (regardless of date)
        if(getTask(key, t.id)) done += points;
        // Count as total only up to totalCap
        if(d <= totalCap) total += points;
      }
    });
    d = addDays(d,1);
  }
  // If done > total (checked future tasks), set total = done so pct <= 100
  const eff = Math.max(total, done);
  return {done, total:eff, pct: eff ? Math.round(done/eff*100) : 0};
}

// Overall: done / elapsed tasks (what % of what you SHOULD have done by now did you actually do)
function overallStats() {
  const today = nowTashkent();
  let done=0, elapsedTotal=0, allTotal=0;
  let d=new Date(START);
  while(d<=END){
    const key=dateKey(d);
    getTasksForDate(d).forEach(t=>{
      const points = taskPoints(t);
      allTotal += points;
      if(d <= today) elapsedTotal += points;
      if(getTask(key,t.id)) done += points;
    });
    d=addDays(d,1);
  }
  // % vs elapsed total (meaningful); also return allTotal for context
  return {done, total:elapsedTotal, allTotal, pct: elapsedTotal ? Math.round(done/elapsedTotal*100) : 0};
}

// ═══════════════════════════════════════════
// NAVIGATION STATE
// ═══════════════════════════════════════════
let curDate  = clamp(todayUTC());   // UTC midnight — safe on all timezones
let wkOffset = 0;
let curMonth = Math.max(5, Math.min(12, nowTashkent().getUTCMonth()+1));

// ═══════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════
const MONTHS_SHORT=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL =['','January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_FULL   =['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function renderSafely(name, renderer) {
  try {
    renderer();
    return true;
  } catch (error) {
    console.error(`Planner renderer failed: ${name}`, error);
    return false;
  }
}

function renderAll() {
  if (!_appInitialized) return [];
  const failures = [];
  [
    ['daily', renderDaily],
    ['weekly', renderWeekly],
    ['monthly', renderMonthly],
    ['tracker', renderTracker],
    ['vision', renderVision],
    ['dashboard', renderDashboard],
  ].forEach(([name, renderer]) => {
    if (!renderSafely(name, renderer)) failures.push(name);
  });

  renderSafely('overall progress', () => {
    const ov=overallStats();
    document.getElementById('overallFill').style.width=ov.pct+'%';
    document.getElementById('overallPct').textContent=ov.pct+'%';
  });
  window._plannerRenderFailures = failures;
  return failures;
}

// ── DAILY ──
function renderDaily() {
  const d=curDate, key=dateKey(d);
  const isToday=key===tashKey();
  document.getElementById('dowDisp').textContent=DAYS_FULL[d.getUTCDay()];
  document.getElementById('ddateDisp').innerHTML=(isToday?'<span class="today-dot"></span>':'')+
    d.getUTCDate()+' '+MONTHS_SHORT[d.getUTCMonth()+1]+' 2026';
  document.getElementById('prevDay').disabled=d<=START;
  document.getElementById('nextDay').disabled=d>=END;
  // Edit button: 🔒 for past, ✏️ for today/future
  const editBtn = document.getElementById('editDayBtn');
  if (editBtn) {
    const locked = new Date(dateKey(d)) < new Date(tashKey());
    editBtn.textContent = locked ? '🔒 Locked' : '✏️ Edit';
    editBtn.style.opacity = locked ? '0.5' : '1';
  }

  // Show AI week theme banner if plan is active
  const _aiWeek = (typeof getAIWeekInfo === 'function') ? getAIWeekInfo(d) : null;
  const _weekBanner = document.getElementById('aiWeekBanner');
  if (_weekBanner) {
    if (_aiWeek) {
      // Always source the surah from SURAH_SCHEDULE (authoritative) — never trust AI plan cache
      const _dk = dateKey(d);
      const _sched = typeof SURAH_SCHEDULE !== 'undefined'
        ? [...SURAH_SCHEDULE].reverse().find(s => _dk >= s.week)
        : null;
      const _surahLabel = _sched ? _sched.surah : _aiWeek.quranSurah;
      _weekBanner.style.display = 'block';
      _weekBanner.innerHTML = `<span style="color:var(--gold);font-weight:700;">Week ${_aiWeek.num}:</span> ${_aiWeek.theme}${_surahLabel?' &nbsp;·&nbsp; 📖 '+_surahLabel:''}`;
    } else {
      _weekBanner.style.display = 'none';
    }
  }

  // Sort tasks by time
  const tasks = getTasksForDate(d).slice().sort((a,b) => (a.time||'00:00').localeCompare(b.time||'00:00'));
  const stats  = dayStats(d);

  // Current Tashkent hour:minute (only shown for today)
  const nowH = nowTashkent().getUTCHours();
  const nowM = nowTashkent().getUTCMinutes();
  const nowMins = nowH * 60 + nowM;
  const nowLabel = String(nowH).padStart(2,'0') + ':' + String(nowM).padStart(2,'0');

  // Build timeline rows, inserting "NOW" line at correct position
  let nowInserted = false;
  const rows = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const [th, tm] = (t.time||'00:00').split(':').map(Number);
    const taskMins = th * 60 + tm;

    // Insert NOW line before the first future task (today only)
    if (isToday && !nowInserted && taskMins > nowMins) {
      rows.push(`<div class="tl-now-line" style="height:14px;"><div class="tl-now-label">${nowLabel}</div></div>`);
      nowInserted = true;
    }

    const done = getTask(key, t.id);
    const c    = getCategoryMeta(t.cat);
    const taskText = escapeHTML(t.text || 'Untitled task');
    const taskUrl = safeHttpUrl(t.url);

    // Study task: show sub-items as subtitle
    const subText = t.studyItems
      ? escapeHTML(t.studyItems.map(si => si.title).join(' · '))
      : '';

    rows.push(`
      <div class="tl-item${done?' tl-done':''}" onclick="toggleTask('${key}','${t.id}')">
        <div class="tl-time">${t.time||''}</div>
        <div class="tl-spine">
          <div class="tl-dot" style="background:${c.color};box-shadow:0 0 6px ${c.color}55;"></div>
        </div>
        <div class="tl-body">
          <div class="tl-row-text">${taskText}${taskUrl?`<a href="${taskUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="tl-link">▶ Watch</a>`:''}</div>
          ${subText ? `<div class="tl-row-sub">${subText}</div>` : ''}
        </div>
        <div class="tl-chk" style="${done?'':'border-color:'+c.color+'44'}">${done?'✓':''}</div>
      </div>`);
  }
  // If today and all tasks are in the past, append NOW at end
  if (isToday && !nowInserted) {
    rows.push(`<div class="tl-now-line" style="height:14px;"><div class="tl-now-label">${nowLabel}</div></div>`);
  }

  document.getElementById('dayContent').innerHTML=`
    <div class="tl-wrap">
      <div class="tl-prog">
        <div style="font-size:0.7rem;color:var(--muted);">${stats.done}/${stats.total} tasks</div>
        <div class="tl-prog-bar"><div class="tl-prog-fill" style="width:${stats.pct}%"></div></div>
        <div style="font-size:0.78rem;font-weight:700;color:var(--gold);">${stats.pct}%</div>
        <div style="font-size:0.65rem;color:var(--muted);">${stats.pts}/${stats.maxPts} pts</div>
      </div>
      ${rows.join('')}
    </div>`;
}

// ── WEEKLY ──
function renderWeekly() {
  const today=todayUTC();
  const mon=addDays(getMonday(clamp(today)), wkOffset*7);
  const sun=addDays(mon,6);
  document.getElementById('wkDisp').textContent=
    mon.getUTCDate()+' '+MONTHS_SHORT[mon.getUTCMonth()+1]+' – '+sun.getUTCDate()+' '+MONTHS_SHORT[sun.getUTCMonth()+1]+' 2026';

  // Week cats accumulator (all 7 days)
  let wkCats={};
  let daysHTML='';
  const dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  for(let i=0;i<7;i++){
    const d=addDays(mon,i);
    const inRange=d>=START&&d<=END;
    const key=dateKey(d);
    const isToday=key===dateKey(today);
    const tasks=inRange?getTasksForDate(d):[];
    const stats=dayStats(d);

    // Accumulate category points for this week
    tasks.forEach(t=>{
      const cat = getCategoryMeta(t.cat).key;
      const points = taskPoints(t);
      if(!wkCats[cat]) wkCats[cat]={done:0,total:0};
      wkCats[cat].total+=points;
      if(getTask(key,t.id)) wkCats[cat].done+=points;
    });

    const mini=tasks.slice(0,4).map(t=>{
      const done=getTask(key,t.id);
      const c=getCategoryMeta(t.cat);
      const label=escapeHTML(t.text || 'Untitled task');
      return `<div class="wday-t${done?' done':''}" style="background:${c.color}18;color:${c.color}">
        <div style="width:4px;height:4px;border-radius:50%;background:${c.color};flex-shrink:0"></div>
        ${label.substring(0,18)}
      </div>`;
    }).join('');

    daysHTML+=`<div class="wday${isToday?' today-col':''}">
      <div class="wday-hdr">
        <div class="wday-name" style="${isToday?'color:var(--gold)':''}">${dayNames[i]}</div>
        <div class="wday-dt">${inRange?d.getUTCDate()+' '+MONTHS_SHORT[d.getUTCMonth()+1]:'—'}</div>
      </div>
      <div class="wday-prog"><div class="wday-pfill" style="width:${stats.pct}%;background:${stats.pct===100?'var(--gold)':'var(--green)'}"></div></div>
      <div class="wday-tasks">${inRange?mini:'<div style="font-size:0.58rem;color:var(--muted);padding:2px">—</div>'}</div>
      <div class="wday-pct" style="color:${stats.pct===100?'var(--gold)':stats.pct>0?'var(--green)':'var(--muted)'}">
        ${inRange?stats.pct+'%':''}
      </div>
    </div>`;
  }
  document.getElementById('wdays').innerHTML=daysHTML;

  // Weekly goal bars — pulled from actual wkCats
  const wgCats=[
    {key:'quran',   name:'Quran Practice',    icon:'📖'},
    {key:'gym',     name:'Gym Sessions',      icon:'💪'},
    {key:'russian', name:'Russian Study',     icon:'🇷🇺'},
    {key:'finance', name:'Finance Study',     icon:'📈'},
    {key:'content', name:'Content Creation',  icon:'🎥'},
    {key:'business',name:'Business Work',     icon:'🛒'},
  ];
  document.getElementById('wgoals').innerHTML=wgCats.map(wg=>{
    const cp=wkCats[wg.key]||{done:0,total:0};
    const pct=cp.total?Math.round(cp.done/cp.total*100):0;
    const c=getCategoryMeta(wg.key);
    return `<div class="wg-item">
      <div class="wg-name">${wg.icon} ${wg.name}</div>
      <div class="wg-sub">${cp.done} / ${cp.total} pts this week</div>
      <div class="wg-bar"><div class="wg-fill" style="width:${pct}%;background:${c.color}"></div></div>
      <div class="wg-pct" style="color:${c.color}">${pct}%</div>
    </div>`;
  }).join('');
}

// ── MONTHLY ──
function renderMonthly() {
  document.getElementById('moDisp').textContent=MONTHS_FULL[curMonth]+' 2026';
  const mStart   = utcDate(2026, curMonth-1, 1);
  const mEnd     = utcDate(2026, curMonth,   0); // last day of month
  const planStart= new Date(Math.max(mStart,  START));
  const planEnd  = new Date(Math.min(mEnd,    END));
  const today    = nowTashkent();

  // Month state: past / current / future
  const isFuture  = today < planStart;
  const isPast    = today > planEnd;
  // For progress calculation: only count elapsed days (up to today) as denominator
  const elapsedEnd = isFuture ? new Date(planStart) : (isPast ? planEnd : today);

  // Total plan days in month
  let totalDays=0, d=new Date(planStart);
  while(d<=planEnd){ totalDays++; d=addDays(d,1); }

  // Active days (at least 1 task checked)
  let activeDays=0;
  d=new Date(planStart);
  while(d<=planEnd){
    const key=dateKey(d);
    if(getTasksForDate(d).some(t=>getTask(key,t.id))) activeDays++;
    d=addDays(d,1);
  }

  // Points: for current/past use elapsed total; for future show plan total
  const allStats = catStatsRange(planStart, isFuture ? planEnd : elapsedEnd, null, false);
  // If future month, total=all tasks in month (target), done=0
  const displayTotal = isFuture
    ? (() => { let t=0; let dd=new Date(planStart); while(dd<=planEnd){ getTasksForDate(dd).forEach(tk=>t+=tk.pts||1); dd=addDays(dd,1); } return t; })()
    : allStats.total;
  const monthPct = isFuture ? 0 : allStats.pct;

  // Per-category stats
  const cats=['quran','gym','russian','finance','content','business','study','plan'];
  const catStats={};
  cats.forEach(c=>{
    if(isFuture){
      // Show planned total, 0 done
      let t=0; let dd=new Date(planStart);
      while(dd<=planEnd){ getTasksForDate(dd).filter(tk=>tk.cat===c).forEach(tk=>t+=tk.pts||1); dd=addDays(dd,1); }
      catStats[c]={done:0, total:t, pct:0};
    } else {
      catStats[c]=catStatsRange(planStart, elapsedEnd, c, false);
    }
  });

  const futureNote = isFuture
    ? `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:8px 12px;font-size:0.72rem;color:var(--muted);margin-bottom:12px;">
        ⏳ ${MONTHS_FULL[curMonth]} starts in <b style="color:var(--gold);">${Math.ceil((planStart-today)/(86400000))} days</b> — showing planned targets
       </div>` : '';

  document.getElementById('moSummary').innerHTML=`
    ${futureNote}
    <div class="mo-sum-item">
      <div class="mo-sum-val" style="${isFuture?'color:var(--muted)':''}">${isFuture?'—':monthPct+'%'}</div>
      <div class="mo-sum-lbl">${isFuture?'Not started':'Tasks Done'}</div>
    </div>
    <div class="mo-sum-item">
      <div class="mo-sum-val">${activeDays}</div>
      <div class="mo-sum-lbl">Active / ${totalDays} days</div>
    </div>
    <div class="mo-sum-item">
      <div class="mo-sum-val">${isFuture?'—':allStats.done}</div>
      <div class="mo-sum-lbl">Pts Earned / ${displayTotal}</div>
    </div>
  `;

  const goals=MONTHLY_GOALS[curMonth]||[];
  document.getElementById('moGoals').innerHTML=goals.map(g=>{
    const cs=catStats[g.cat]||{done:0,total:0,pct:0};
    return `<div class="mo-item">
      <div class="mo-hdr">
        <div class="mo-dot" style="background:${g.color}"></div>
        <div class="mo-name">${g.text}</div>
        <div class="mo-cat">${g.cat}</div>
      </div>
      <div class="mo-bar">
        ${isFuture?`<div style="width:100%;height:100%;background:${g.color}18;border-radius:4px;"></div>`
                  :`<div class="mo-fill" style="width:${cs.pct}%;background:${g.color}"></div>`}
      </div>
      <div class="mo-sub">${isFuture ? `${cs.total} pts planned this month` : `${cs.pct}% · ${cs.done}/${cs.total} pts`}</div>
    </div>`;
  }).join('');
}

// ── TRACKER ──
function renderTracker() {
  document.getElementById('gtList').innerHTML=TRACKERS.map(g=>{
    const cs=catStatsRange(START,END,g.cat,true);
    const pct=cs.pct;
    return `<div class="gt-item">
      <div class="gt-icon">${g.icon}</div>
      <div class="gt-info">
        <div class="gt-name">${g.name}</div>
        <div class="gt-desc">${g.desc}</div>
        <div class="gt-bar"><div class="gt-fill" style="width:${pct}%;background:${g.color}"></div></div>
      </div>
      <div class="gt-right">
        <div class="gt-pct" style="color:${g.color}">${pct}%</div>
        <div class="gt-status">${cs.done} / ${cs.total} pts</div>
      </div>
    </div>`;
  }).join('');
}

// ── VISION ──
function renderVision() {
  document.getElementById('visGrid').innerHTML=VISION.map(v=>`
    <div class="vis-card">
      <div class="vis-num">${v.num}</div>
      <div class="vis-label">${v.label}</div>
      <div class="vis-text">${v.text}</div>
      <div class="vis-step">2026 → ${v.step}</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════
// MONEY TRACKER
// ═══════════════════════════════════════════
const MONEY_KEY   = 'life_plan_2026_money';
const SAVINGS_KEY = 'life_plan_2026_savings';
let moneyState   = {}; // { 'YYYY-MM-DD': [ {id,cat,name,amount} ] }
let savingsState = {}; // { '6': {salary, saved}, '7': ... }
let moneyDate    = todayUTC(); // Tashkent today
let moneyWkOff   = 0;
let moneyMonth   = 6; // default to June (plan start month)
let moneyTab     = 'day';

const EXP_CATS = {
  transport:   { label:'Transportation', emoji:'🚌', color:'#4A90D9' },
  food:        { label:'Food',           emoji:'🍽️', color:'#E07A30' },
  accessories: { label:'Accessories',    emoji:'👕', color:'#B464C8' },
  gym:         { label:'Gym',            emoji:'💪', color:'#4CAF7D' },
  courses:     { label:'Courses',        emoji:'📚', color:'#C9A84C' },
  other:       { label:'Other',          emoji:'📦', color:'#888'    },
};

function fmtNum(n) {
  return Number(n).toLocaleString('uz-UZ');
}

function loadMoneyFromCloud() { /* loaded via Firebase */ }

function saveMoneyToCloud() { scheduleSave(); }

function addExpense() {
  const cat    = document.getElementById('expCat').value;
  const amount = parseFloat(document.getElementById('expAmount').value);
  const name   = document.getElementById('expName').value.trim();
  if (!amount || amount <= 0) { alert('Enter a valid amount'); return; }
  if (!name) { alert('Enter a description'); return; }
  const key = dateKey(moneyDate);
  if (!moneyState[key]) moneyState[key] = [];
  moneyState[key].push({ id: Date.now(), cat, name, amount });
  document.getElementById('expAmount').value = '';
  document.getElementById('expName').value   = '';
  saveMoneyToCloud();
  renderMoney();
}

function deleteExpense(dateStr, id) {
  if (!moneyState[dateStr]) return;
  moneyState[dateStr] = moneyState[dateStr].filter(e => e.id !== id);
  saveMoneyToCloud();
  renderMoney();
}

function logSaving() {
  const mo     = document.getElementById('saveMonth').value;
  const salary = parseFloat(document.getElementById('saveSalary').value);
  const saved  = parseFloat(document.getElementById('saveAmount').value);
  if (!salary || !saved) { alert('Enter salary and saved amount'); return; }
  savingsState[mo] = { salary, saved };
  document.getElementById('saveSalary').value = '';
  document.getElementById('saveAmount').value  = '';
  saveMoneyToCloud();
  renderMoney();
}

function getDayTotal(dateStr) {
  return (moneyState[dateStr] || []).reduce((s,e) => s + e.amount, 0);
}

function getCatTotalRange(fromDate, toDate, catKey) {
  let total = 0;
  let d = new Date(fromDate);
  while (d <= toDate) {
    const k = dateKey(d);
    (moneyState[k] || []).forEach(e => {
      if (!catKey || e.cat === catKey) total += e.amount;
    });
    d = addDays(d, 1);
  }
  return total;
}

function showMoneyTab(tab) {
  moneyTab = tab;
  ['day','week','month','save'].forEach(t => {
    document.getElementById('mpanel-' + t).style.display = t === tab ? 'block' : 'none';
    const el = document.getElementById('mtab-' + t);
    if (t === tab) {
      el.style.borderBottom = '2px solid var(--gold)';
      el.style.color = 'var(--gold)';
    } else {
      el.style.borderBottom = '2px solid transparent';
      el.style.color = 'var(--muted)';
    }
  });
  renderMoney();
}

function renderMoney() {
  renderMoneySummary();
  if (moneyTab === 'day')   renderMoneyDaily();
  if (moneyTab === 'week')  renderMoneyWeekly();
  if (moneyTab === 'month') renderMoneyMonthly();
  if (moneyTab === 'save')  renderSavings();
}

function renderMoneySummary() {
  const mStart = utcDate(2026, moneyMonth-1, 1);
  const mEnd   = utcDate(2026, moneyMonth,   0);
  const mTotal = getCatTotalRange(mStart, mEnd, null);
  const sv = savingsState[moneyMonth] || { salary:0, saved:0 };
  const savePct = sv.salary ? Math.round(sv.saved/sv.salary*100) : 0;
  const todayTotal = getDayTotal(dateKey(moneyDate));
  const totalSaved = Object.values(savingsState).reduce((s,v)=>s+(v.saved||0),0);

  document.getElementById('moneySummaryCards').innerHTML = `
    <div class="task-card" style="text-align:center;">
      <div style="font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Today Spent</div>
      <div style="font-family:'Playfair Display',serif;font-size:1.5rem;color:var(--red)">${fmtNum(todayTotal)}</div>
      <div style="font-size:0.62rem;color:var(--muted);margin-top:2px;">so'm</div>
    </div>
    <div class="task-card" style="text-align:center;">
      <div style="font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">This Month Spent</div>
      <div style="font-family:'Playfair Display',serif;font-size:1.5rem;color:var(--orange)">${fmtNum(mTotal)}</div>
      <div style="font-size:0.62rem;color:var(--muted);margin-top:2px;">so'm</div>
    </div>
    <div class="task-card" style="text-align:center;">
      <div style="font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Saved This Month</div>
      <div style="font-family:'Playfair Display',serif;font-size:1.5rem;color:var(--green)">${fmtNum(sv.saved)}</div>
      <div style="font-size:0.62rem;color:var(--muted);margin-top:2px;">${savePct}% of salary</div>
    </div>
    <div class="task-card" style="text-align:center;">
      <div style="font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Total Saved (Jun–Dec)</div>
      <div style="font-family:'Playfair Display',serif;font-size:1.5rem;color:var(--gold)">${fmtNum(totalSaved)}</div>
      <div style="font-size:0.62rem;color:var(--muted);margin-top:2px;">so'm</div>
    </div>
  `;
}

function renderMoneyDaily() {
  const key  = dateKey(moneyDate);
  const dow  = DAYS_FULL[moneyDate.getUTCDay()];
  const isToday = key === tashKey();
  document.getElementById('moneyDowDisp').textContent = dow;
  document.getElementById('moneyDateDisp').innerHTML =
    (isToday ? '<span class="today-dot"></span>' : '') +
    moneyDate.getUTCDate() + ' ' + MONTHS_SHORT[moneyDate.getUTCMonth()+1] + ' 2026';

  const exps = moneyState[key] || [];
  const total = exps.reduce((s,e) => s + e.amount, 0);

  if (exps.length === 0) {
    document.getElementById('dailyExpList').innerHTML =
      `<div style="color:var(--muted);font-size:0.78rem;padding:12px 0;text-align:center;">No expenses logged yet for this day.</div>`;
    document.getElementById('dailyExpTotal').textContent = '';
    return;
  }

  // Group by category
  const grouped = {};
  exps.forEach(e => {
    if (!grouped[e.cat]) grouped[e.cat] = [];
    grouped[e.cat].push(e);
  });

  let html = '';
  Object.entries(grouped).forEach(([cat, items]) => {
    const c = EXP_CATS[cat];
    const catTotal = items.reduce((s,e) => s + e.amount, 0);
    html += `<div style="margin-bottom:10px;">
      <div style="font-size:0.68rem;font-weight:700;color:${c.color};text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;display:flex;justify-content:space-between;">
        <span>${c.emoji} ${c.label}</span><span>${fmtNum(catTotal)} so'm</span>
      </div>`;
    items.forEach(e => {
      html += `<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;background:rgba(255,255,255,0.02);margin-bottom:3px;border:1px solid #1e1e1e;">
        <div style="flex:1;font-size:0.8rem;">${e.name}</div>
        <div style="font-size:0.82rem;font-weight:600;color:${c.color}">${fmtNum(e.amount)} so'm</div>
        <div onclick="deleteExpense('${key}',${e.id})" style="cursor:pointer;color:var(--muted);font-size:0.7rem;padding:2px 6px;border-radius:4px;border:1px solid #333;" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--muted)'">✕</div>
      </div>`;
    });
    html += `</div>`;
  });

  document.getElementById('dailyExpList').innerHTML = html;
  document.getElementById('dailyExpTotal').innerHTML =
    `Total: <span style="color:var(--gold);font-weight:700;">${fmtNum(total)} so'm</span>`;
}

function renderMoneyWeekly() {
  const today = nowTashkent();
  const mon   = addDays(getMonday(clamp(today)), moneyWkOff * 7);
  const sun   = addDays(mon, 6);
  document.getElementById('moneyWkDisp').textContent =
    mon.getUTCDate()+" "+MONTHS_SHORT[mon.getUTCMonth()+1]+' – '+sun.getUTCDate()+" "+MONTHS_SHORT[sun.getUTCMonth()+1]+' 2026';

  // Build daily totals row
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  let dayRowHTML = '<div id="moneyWeekDays" style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:16px;">';
  let weekTotal  = 0;
  for (let i = 0; i < 7; i++) {
    const d  = addDays(mon, i);
    const k  = dateKey(d);
    const dt = getDayTotal(k);
    weekTotal += dt;
    const isT = k === dateKey(today);
    dayRowHTML += `<div style="background:var(--dark2);border:1px solid ${isT?'var(--gold)':'#222'};border-radius:8px;padding:10px 8px;text-align:center;">
      <div style="font-size:0.62rem;color:${isT?'var(--gold)':'var(--muted)'};font-weight:700;text-transform:uppercase;letter-spacing:1px;">${dayNames[i]}</div>
      <div style="font-size:0.68rem;color:var(--muted);margin:2px 0;">${d.getUTCDate()+' '+MONTHS_SHORT[d.getUTCMonth()+1]}</div>
      <div style="font-size:0.82rem;font-weight:700;color:${dt>0?'var(--red)':'var(--muted)'};">${dt>0?fmtNum(dt):'—'}</div>
      <div style="font-size:0.58rem;color:var(--muted);">${dt>0?'so\'m':''}</div>
    </div>`;
  }
  dayRowHTML += '</div>';

  // Category breakdown for the week
  let catHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">`;
  Object.entries(EXP_CATS).forEach(([catKey, c]) => {
    const catTotal = getCatTotalRange(mon, sun, catKey);
    const pct = weekTotal ? Math.round(catTotal/weekTotal*100) : 0;
    catHTML += `<div class="task-card" style="padding:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:0.8rem;font-weight:600;">${c.emoji} ${c.label}</div>
        <div style="font-size:0.82rem;font-weight:700;color:${c.color}">${fmtNum(catTotal)}</div>
      </div>
      <div style="height:4px;background:var(--dark4);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${c.color};border-radius:2px;transition:width .4s;"></div>
      </div>
      <div style="font-size:0.62rem;color:var(--muted);margin-top:3px;">${pct}% of week spend</div>
    </div>`;
  });
  catHTML += '</div>';

  const totalBox = `<div class="task-card" style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;">
    <div style="font-size:0.85rem;font-weight:600;">📊 Total This Week</div>
    <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:var(--gold)">${fmtNum(weekTotal)} <span style="font-size:0.75rem;font-family:'DM Sans',sans-serif;color:var(--muted)">so'm</span></div>
  </div>`;

  document.getElementById('weeklyExpBreakdown').innerHTML = dayRowHTML + catHTML + totalBox;
}

function renderMoneyMonthly() {
  const mStart  = utcDate(2026, moneyMonth-1, 1);
  const mEnd    = utcDate(2026, moneyMonth,   0);
  document.getElementById('moneyMoDisp').textContent = MONTHS_FULL[moneyMonth] + ' 2026';

  const mTotal = getCatTotalRange(mStart, mEnd, null);

  // Category breakdown
  let catHTML = `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">`;
  Object.entries(EXP_CATS).forEach(([catKey, c]) => {
    const catTotal = getCatTotalRange(mStart, mEnd, catKey);
    const pct = mTotal ? Math.round(catTotal/mTotal*100) : 0;
    catHTML += `<div class="task-card" style="padding:14px 18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:0.85rem;font-weight:600;">${c.emoji} ${c.label}</div>
        <div style="font-size:0.9rem;font-weight:700;color:${c.color}">${fmtNum(catTotal)} so'm</div>
      </div>
      <div style="height:5px;background:var(--dark4);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${c.color};border-radius:3px;transition:width .5s;"></div>
      </div>
      <div style="font-size:0.68rem;color:var(--muted);margin-top:4px;">${pct}% of total monthly spend</div>
    </div>`;
  });
  catHTML += '</div>';

  // Daily calendar heatmap
  const firstDow = mStart.getUTCDay();
  const offset   = firstDow === 0 ? 6 : firstDow - 1;
  const daysInM  = mEnd.getUTCDate();
  let calHTML    = `<div class="task-card" style="margin-bottom:16px;"><div class="task-card-hdr" style="color:var(--gold)">Daily Spend Calendar</div>`;
  calHTML += `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:8px;">`;
  ['M','T','W','T','F','S','S'].forEach(d => {
    calHTML += `<div style="text-align:center;font-size:0.6rem;color:var(--muted);padding:2px;">${d}</div>`;
  });
  for (let i = 0; i < offset; i++) calHTML += `<div></div>`;
  // Find max daily spend for color scaling
  let maxDay = 0;
  for (let day = 1; day <= daysInM; day++) {
    const k = dateKey(utcDate(2026, moneyMonth-1, day));
    maxDay = Math.max(maxDay, getDayTotal(k));
  }
  for (let day = 1; day <= daysInM; day++) {
    const dd  = utcDate(2026, moneyMonth-1, day);
    const k   = dateKey(dd);
    const dt  = getDayTotal(k);
    const inR = dd >= START && dd <= END;
    const intensity = maxDay > 0 && dt > 0 ? Math.max(0.15, dt/maxDay) : 0;
    const bg  = inR && dt > 0 ? `rgba(209,74,74,${intensity})` : '#1a1a1a';
    const isT = k === tashKey();
    calHTML += `<div style="aspect-ratio:1;border-radius:4px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:0.55rem;border:${isT?'2px solid var(--gold)':'1px solid #222'};padding:1px;" title="${dt>0?fmtNum(dt)+' so\'m':''}">
      <div style="color:var(--muted)">${inR?day:''}</div>
      ${dt>0?`<div style="color:#FF8888;font-weight:700">${dt>=1000?(dt/1000).toFixed(0)+'k':dt}</div>`:''}
    </div>`;
  }
  calHTML += `</div></div>`;

  const totalBox = `<div class="task-card" style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;">
    <div style="font-size:0.85rem;font-weight:600;">📊 Total Spent This Month</div>
    <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:var(--orange)">${fmtNum(mTotal)} <span style="font-size:0.75rem;font-family:'DM Sans',sans-serif;color:var(--muted)">so'm</span></div>
  </div>`;

  document.getElementById('monthlyExpBreakdown').innerHTML = catHTML + calHTML + totalBox;
}

function renderSavings() {
  const months = [6,7,8,9,10,11,12];
  let totalSalary=0, totalSaved=0;

  let rows = months.map(mo => {
    const sv = savingsState[mo] || null;
    if (sv) { totalSalary += sv.salary || 0; totalSaved += sv.saved || 0; }
    const pct = sv && sv.salary ? Math.round(sv.saved/sv.salary*100) : 0;
    const color = pct >= 80 ? '#4CAF7D' : pct >= 50 ? '#E07A30' : '#D94A4A';
    return `<div style="display:flex;align-items:center;gap:14px;padding:12px 16px;background:var(--dark3);border-radius:8px;margin-bottom:6px;">
      <div style="width:80px;font-size:0.82rem;font-weight:600;color:var(--gold)">${MONTHS_FULL[mo]}</div>
      <div style="flex:1;">
        ${sv ? `<div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:4px;">
          <span style="color:var(--muted)">Salary: <span style="color:var(--text)">${fmtNum(sv.salary)}</span></span>
          <span style="color:var(--muted)">Saved: <span style="color:${color};font-weight:700">${fmtNum(sv.saved)}</span></span>
          <span style="color:${color};font-weight:700">${pct}%</span>
        </div>
        <div style="height:5px;background:var(--dark4);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${Math.min(pct,100)}%;background:${color};border-radius:3px;"></div>
        </div>` :
        `<div style="font-size:0.72rem;color:var(--muted);">Not logged yet</div>`}
      </div>
    </div>`;
  }).join('');

  const overallPct = totalSalary ? Math.round(totalSaved/totalSalary*100) : 0;
  const overallColor = overallPct >= 80 ? '#4CAF7D' : overallPct >= 50 ? '#E07A30' : '#D94A4A';

  document.getElementById('savingsTable').innerHTML = `
    <div class="task-card" style="margin-bottom:14px;padding:18px;">
      <div class="task-card-hdr" style="color:var(--gold)">Monthly Savings Log (Jun–Dec)</div>
      <div style="margin-top:10px;">${rows}</div>
    </div>
    <div class="task-card" style="padding:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:0.9rem;font-weight:600;">🏦 Overall Savings (Jun–Dec)</div>
        <div style="font-size:0.82rem;color:var(--muted)">Goal: 80% of each salary</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
        <div style="text-align:center;">
          <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:var(--text)">${fmtNum(totalSalary)}</div>
          <div style="font-size:0.65rem;color:var(--muted);margin-top:2px;">Total Salary so'm</div>
        </div>
        <div style="text-align:center;">
          <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:var(--green)">${fmtNum(totalSaved)}</div>
          <div style="font-size:0.65rem;color:var(--muted);margin-top:2px;">Total Saved so'm</div>
        </div>
        <div style="text-align:center;">
          <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:${overallColor}">${overallPct}%</div>
          <div style="font-size:0.65rem;color:var(--muted);margin-top:2px;">Overall Save Rate</div>
        </div>
      </div>
      <div style="height:8px;background:var(--dark4);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${Math.min(overallPct,100)}%;background:linear-gradient(90deg,${overallColor},#80FF90);border-radius:4px;transition:width .6s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.65rem;color:var(--muted);margin-top:4px;">
        <span>0%</span><span style="color:var(--green)">80% target</span><span>100%</span>
      </div>
    </div>
  `;
}

function changeMoneyDay(n)    { moneyDate=addDays(moneyDate,n); renderMoney(); }
function moneyGoToday()       { moneyDate=todayUTC(); renderMoney(); }
function changeMoneyWeek(n)   { moneyWkOff+=n; renderMoney(); }
function moneyGoThisWeek()    { moneyWkOff=0; renderMoney(); }
function changeMoneyMonth(n)  { moneyMonth=Math.max(1,Math.min(12,moneyMonth+n)); renderMoney(); }


const DIET_KEY = 'life_plan_2026_diet';
let dietState = {}; // { 'YYYY-MM-DD': { bread:bool, sugar:bool, water:bool, meal:bool } }
let dietDate  = clamp(todayUTC());
let dietMonth = Math.max(6, Math.min(12, nowTashkent().getUTCMonth()+1));

const DIET_RULES = [
  {id:'bread', label:'No bread today',          emoji:'🍞', color:'#E07A30'},
  {id:'sugar', label:'No sugar today',           emoji:'🍬', color:'#D94A4A'},
  {id:'water', label:'Drank enough water (2L+)', emoji:'💧', color:'#4A90D9'},
  {id:'meal',  label:'Ate clean meals today',    emoji:'🍽️', color:'#4CAF7D'},
];

function getDiet(dateStr, ruleId) {
  return !!(dietState[dateStr] && dietState[dateStr][ruleId]);
}

function toggleDiet(ruleId) {
  const key = dateKey(dietDate);
  if (!dietState[key]) dietState[key] = {};
  dietState[key][ruleId] = !getDiet(key, ruleId);
  saveDietToCloud();
  renderDiet();
}

function dietDayScore(dateStr) {
  return DIET_RULES.filter(r => getDiet(dateStr, r.id)).length;
}

function dietDayColor(score) {
  if (score === 4) return '#4CAF7D';
  if (score >= 2) return '#E07A30';
  if (score === 1) return '#D94A4A';
  return '#222';
}

function saveDietToCloud() { scheduleSave(); }

function loadDietFromCloud() {
  // loaded via Firebase loadFromCloud()
}

function getDietStreak() {
  let streak = 0;
  let d = new Date(dietDate);
  while (d >= START) {
    const key = dateKey(d);
    if (dietDayScore(key) === 4) streak++;
    else break;
    d = addDays(d, -1);
  }
  return streak;
}

function renderDiet() {
  const key = dateKey(dietDate);
  const dow = DAYS_FULL[dietDate.getUTCDay()];
  const isToday = key === tashKey();
  document.getElementById('dietDowDisp').textContent = dow;
  document.getElementById('dietDateDisp').innerHTML =
    (isToday ? '<span class="today-dot"></span>' : '') +
    dietDate.getUTCDate() + ' ' + MONTHS_SHORT[dietDate.getUTCMonth()+1] + ' 2026';

  // Daily checkboxes
  DIET_RULES.forEach(r => {
    const done = getDiet(key, r.id);
    const item = document.getElementById('d'+r.id.charAt(0).toUpperCase()+r.id.slice(1)) ||
                 document.querySelector(`[onclick="toggleDiet('${r.id}')"]`);
  });

  // Rebuild daily card rules dynamically
  document.querySelector('#dietDailyCard').innerHTML = `
    <div class="task-card-hdr" style="color:#4CAF7D">Diet Rules — ${isToday?'Today':dow}</div>
    ${DIET_RULES.map(r => {
      const done = getDiet(key, r.id);
      return `<div class="titem${done?' done':''}" onclick="toggleDiet('${r.id}')">
        <div class="tcb">${done?'✓':''}</div>
        <div class="tcat" style="background:${r.color}"></div>
        <div class="ttext">${r.emoji} ${r.label}</div>
      </div>`;
    }).join('')}
    <div class="day-prog-row" style="margin-top:14px;">
      <div class="dp-lbl">Diet Score</div>
      <div class="dp-bar"><div class="dp-fill" style="width:${dietDayScore(key)/4*100}%;background:linear-gradient(90deg,#4CAF7D,#80FF90)"></div></div>
      <div class="dp-pct" style="color:#4CAF7D">${dietDayScore(key)}/4</div>
    </div>
  `;

  // Status box
  const score = dietDayScore(key);
  const streak = getDietStreak();
  const emoji = score===4?'🌟':score===3?'👍':score===2?'⚠️':'❌';
  const msg   = score===4?'Perfect day! Full compliance!':score===3?'Almost! 3/4 rules kept':score===2?'Halfway — push harder tomorrow':score===1?'Only 1 rule kept today':'Not logged yet';

  // Calculate all-time compliance
  let totalDays=0, fullDays=0, partDays=0;
  let d=new Date(START);
  const today=nowTashkent();
  while(d<=today&&d<=END){
    const k=dateKey(d);
    const s=dietDayScore(k);
    if(s>0){totalDays++;if(s===4)fullDays++;else partDays++;}
    d=addDays(d,1);
  }
  const compliancePct = totalDays ? Math.round(fullDays/totalDays*100) : 0;

  document.getElementById('dietStatusBox').innerHTML = `
    <div style="text-align:center;padding:16px 0;">
      <div style="font-size:2.5rem;margin-bottom:6px;">${emoji}</div>
      <div style="font-size:0.9rem;font-weight:600;color:var(--text);margin-bottom:4px;">${msg}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid #222;padding-top:12px;">
      <div style="display:flex;justify-content:space-between;font-size:0.78rem;">
        <span style="color:var(--muted)">🔥 Current streak</span>
        <span style="color:var(--gold);font-weight:700">${streak} days</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.78rem;">
        <span style="color:var(--muted)">✅ Full compliance days</span>
        <span style="color:#4CAF7D;font-weight:700">${fullDays} days</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.78rem;">
        <span style="color:var(--muted)">⚠️ Partial days</span>
        <span style="color:#E07A30;font-weight:700">${partDays} days</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.78rem;">
        <span style="color:var(--muted)">📊 Overall compliance</span>
        <span style="color:#4CAF7D;font-weight:700">${compliancePct}%</span>
      </div>
      <div style="height:5px;background:var(--dark4);border-radius:3px;overflow:hidden;margin-top:4px;">
        <div style="height:100%;width:${compliancePct}%;background:linear-gradient(90deg,#4CAF7D,#80FF90);border-radius:3px;transition:width .5s;"></div>
      </div>
    </div>
  `;

  // Weekly heatmap — current week Mon–Sun
  const mon = getMonday(dietDate);
  document.getElementById('dietWeekHeat').innerHTML = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((dn,i) => {
    const dd = addDays(mon, i);
    const k  = dateKey(dd);
    const s  = dietDayScore(k);
    const inRange = dd>=START&&dd<=END;
    const bg = inRange && s>0 ? dietDayColor(s) : '#1e1e1e';
    const isT = k===tashKey();
    return `<div style="text-align:center;">
      <div style="font-size:0.62rem;color:var(--muted);margin-bottom:4px;${isT?'color:var(--gold)':''}">${dn}</div>
      <div style="height:40px;border-radius:6px;background:${bg};display:flex;align-items:center;justify-content:center;
        font-size:0.7rem;font-weight:700;color:${s>0?'#000':'var(--muted)'};border:${isT?'2px solid var(--gold)':'1px solid #2a2520'}">
        ${inRange&&s>0?s+'/4':''}
      </div>
      <div style="font-size:0.6rem;color:var(--muted);margin-top:3px;">${inRange?dd.getUTCDate()+'':''}</div>
    </div>`;
  }).join('');

  // Monthly stats
  const mStart = utcDate(2026, dietMonth-1, 1);
  const mEnd   = utcDate(2026, dietMonth,   0);
  let mFull=0,mPart=0,mTotal=0;
  let md=new Date(Math.max(mStart,START));
  while(md<=mEnd&&md<=END){
    const k=dateKey(md);
    const s=dietDayScore(k);
    if(s>0){mTotal++;if(s===4)mFull++;else mPart++;}
    md=addDays(md,1);
  }
  const mPct=mTotal?Math.round(mFull/mTotal*100):0;
  document.getElementById('dietMonthStats').innerHTML=`
    <div class="task-card" style="text-align:center;padding:16px;">
      <div style="font-family:'Playfair Display',serif;font-size:1.8rem;color:#4CAF7D">${mFull}</div>
      <div style="font-size:0.7rem;color:var(--muted);margin-top:4px;">Perfect days this month</div>
    </div>
    <div class="task-card" style="text-align:center;padding:16px;">
      <div style="font-family:'Playfair Display',serif;font-size:1.8rem;color:#E07A30">${mPart}</div>
      <div style="font-size:0.7rem;color:var(--muted);margin-top:4px;">Partial days this month</div>
    </div>
    <div class="task-card" style="text-align:center;padding:16px;">
      <div style="font-family:'Playfair Display',serif;font-size:1.8rem;color:var(--gold)">${mPct}%</div>
      <div style="font-size:0.7rem;color:var(--muted);margin-top:4px;">Monthly compliance</div>
    </div>
  `;

  // Monthly calendar
  document.getElementById('dietMonthDisp').textContent = MONTHS_FULL[dietMonth]+' 2026';
  const firstDow = mStart.getUTCDay(); // 0=Sun
  const offset   = firstDow===0?6:firstDow-1; // Mon-based offset
  const daysInMonth = mEnd.getUTCDate();
  let calHTML = ['M','T','W','T','F','S','S'].map(d=>
    `<div style="text-align:center;font-size:0.62rem;color:var(--muted);padding:3px 0;">${d}</div>`).join('');
  for(let i=0;i<offset;i++) calHTML+=`<div></div>`;
  for(let day=1;day<=daysInMonth;day++){
    const dd=utcDate(2026,dietMonth-1,day);
    const k=dateKey(dd);
    const s=dietDayScore(k);
    const inRange=dd>=START&&dd<=END;
    const bg=inRange&&s>0?dietDayColor(s):'#1a1a1a';
    const isT=k===tashKey();
    calHTML+=`<div style="aspect-ratio:1;border-radius:5px;background:${bg};
      display:flex;align-items:center;justify-content:center;font-size:0.65rem;
      color:${s===4?'#000':s>0?'#000':'var(--muted)'};font-weight:600;
      border:${isT?'2px solid var(--gold)':'1px solid #2a2520'};cursor:default;"
      title="${inRange?s+'/4 rules':''}">
      ${inRange?day:''}
    </div>`;
  }
  document.getElementById('dietCal').innerHTML=calHTML;
}

function changeDietDay(n){ dietDate=clamp(addDays(dietDate,n)); renderDiet(); }
function dietGoToday(){ dietDate=clamp(todayUTC()); renderDiet(); }
function changeDietMonth(n){ dietMonth=Math.max(6,Math.min(12,dietMonth+n)); renderDiet(); }

// ═══════════════════════════════════════════
// PRAYER TRACKER
// ═══════════════════════════════════════════
const PRAYER_KEY = 'life_plan_2026_prayer';
let prayerState = {}; // { 'YYYY-MM-DD': { fajr:'ontime'|'late'|'missed', ... } }
let prayerDate  = todayUTC();
let prayerMonth = 6;

const PRAYERS = [
  { id:'fajr',   name:'Fajr',    time:'~05:00', icon:'fa-solid fa-sun',      iconColor:'#C9A84C' },
  { id:'dhuhr',  name:'Dhuhr',   time:'~13:00', icon:'fa-solid fa-circle',   iconColor:'#F0C040' },
  { id:'asr',    name:'Asr',     time:'~17:00', icon:'fa-solid fa-cloud-sun',iconColor:'#E07A30' },
  { id:'maghrib',name:'Maghrib', time:'~20:00', icon:'fa-solid fa-moon',     iconColor:'#B464C8' },
  { id:'isha',   name:'Isha',    time:'~22:00', icon:'fa-solid fa-star',     iconColor:'#4A90D9' },
];

function loadPrayerFromCloud(){
  // loaded via Firebase loadFromCloud()
}
function savePrayerToCloud(){ scheduleSave(); }

function cyclePrayer(dateStr, prayerId){
  if(!prayerState[dateStr]) prayerState[dateStr]={};
  const cur = prayerState[dateStr][prayerId]||'none';
  const next = cur==='none'?'ontime': cur==='ontime'?'late': cur==='late'?'missed':'none';
  prayerState[dateStr][prayerId] = next;
  savePrayerToCloud();
  renderPrayer();
}

function getPrayerStatus(dateStr, prayerId){
  return (prayerState[dateStr]&&prayerState[dateStr][prayerId])||'none';
}

function prayerDayScore(dateStr){
  // returns { ontime, late, missed, total }
  let ontime=0,late=0,missed=0;
  PRAYERS.forEach(p=>{
    const s=getPrayerStatus(dateStr,p.id);
    if(s==='ontime') ontime++;
    else if(s==='late') late++;
    else if(s==='missed') missed++;
  });
  return {ontime,late,missed,total:ontime+late+missed};
}

function prayerDayColor(dateStr){
  const {ontime,late,missed,total}=prayerDayScore(dateStr);
  if(total===0) return '#1a1a1a';
  if(ontime===5) return '#C9A84C';       // all on time = gold
  if(ontime+late===5) return '#4CAF7D';  // all prayed = green
  if(missed<=2) return '#E07A30';        // some missed = orange
  return '#D94A4A';                      // most missed = red
}

function getPrayerStreak(){
  let streak=0;
  let d=new Date(prayerDate);
  while(true){
    const k=dateKey(d);
    const {ontime,late}=prayerDayScore(k);
    if(ontime+late===5) streak++;
    else break;
    d=addDays(d,-1);
    if(d<START) break;
  }
  return streak;
}

function renderPrayer(){
  renderSurahSchedule();
  const key=dateKey(prayerDate);
  const isToday=key===tashKey();
  document.getElementById('prayerDowDisp').textContent=DAYS_FULL[prayerDate.getUTCDay()];
  document.getElementById('prayerDateDisp').innerHTML=(isToday?'<span class="today-dot"></span>':'')+
    prayerDate.getUTCDate()+' '+MONTHS_SHORT[prayerDate.getUTCMonth()+1]+' 2026';

  // 5 prayer cards
  document.getElementById('prayerCards').innerHTML=PRAYERS.map(p=>{
    const status=getPrayerStatus(key,p.id);
    const colors={none:'#222',ontime:'#C9A84C',late:'#4CAF7D',missed:'#D94A4A'};
    const labels={none:'Tap to log',ontime:'✓ On Time',late:'⏰ Late',missed:'✗ Missed'};
    const bg=colors[status];
    return `<div onclick="cyclePrayer('${key}','${p.id}')" style="background:var(--dark2);border:2px solid ${bg};border-radius:10px;padding:16px;text-align:center;cursor:pointer;transition:all .2s;">
      <div style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:${p.iconColor}1A;border:1px solid ${p.iconColor}44;color:${p.iconColor};font-size:1rem;margin-bottom:6px;box-shadow:0 3px 10px rgba(0,0,0,0.4),0 0 12px ${p.iconColor}22;"><i class="${p.icon}"></i></div>
      <div style="font-size:0.85rem;font-weight:700;color:var(--text);margin-bottom:2px;">${p.name}</div>
      <div style="font-size:0.62rem;color:var(--muted);margin-bottom:8px;">${p.time}</div>
      <div style="font-size:0.72rem;font-weight:600;color:${bg==='#222'?'var(--muted)':bg};padding:4px 8px;border-radius:12px;background:${bg}22;">${labels[status]}</div>
    </div>`;
  }).join('');

  // Stats
  const streak=getPrayerStreak();
  let totalOntime=0,totalPrayed=0,totalLogged=0;
  let d=new Date(START);
  while(d<=nowTashkent()&&d<=END){
    const k=dateKey(d);
    const sc=prayerDayScore(k);
    if(sc.total>0){ totalLogged++; totalOntime+=sc.ontime; totalPrayed+=sc.ontime+sc.late; }
    d=addDays(d,1);
  }
  const ontimePct=totalLogged?Math.round(totalOntime/(totalLogged*5)*100):0;

  document.getElementById('prayerStats').innerHTML=`
    <div class="task-card" style="text-align:center;padding:14px;">
      <div style="font-family:'Playfair Display',serif;font-size:1.6rem;color:var(--gold)">${streak}</div>
      <div style="font-size:0.65rem;color:var(--muted);margin-top:3px;">🔥 Day Streak (all 5 prayed)</div>
    </div>
    <div class="task-card" style="text-align:center;padding:14px;">
      <div style="font-family:'Playfair Display',serif;font-size:1.6rem;color:#C9A84C">${ontimePct}%</div>
      <div style="font-size:0.65rem;color:var(--muted);margin-top:3px;">⏰ On-Time Rate</div>
    </div>
    <div class="task-card" style="text-align:center;padding:14px;">
      <div style="font-family:'Playfair Display',serif;font-size:1.6rem;color:#4CAF7D">${totalPrayed}</div>
      <div style="font-size:0.65rem;color:var(--muted);margin-top:3px;">🕌 Total Prayers Prayed</div>
    </div>
    <div class="task-card" style="text-align:center;padding:14px;">
      <div style="font-family:'Playfair Display',serif;font-size:1.6rem;color:#D94A4A">${totalLogged*5-totalPrayed}</div>
      <div style="font-size:0.65rem;color:var(--muted);margin-top:3px;">❌ Missed Total</div>
    </div>`;

  // Weekly heatmap
  const mon=getMonday(nowTashkent());
  document.getElementById('prayerWeekHeat').innerHTML=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((dn,i)=>{
    const dd=addDays(mon,i);
    const k=dateKey(dd);
    const sc=prayerDayScore(k);
    const bg=prayerDayColor(k);
    const isT=k===tashKey();
    return `<div style="text-align:center;">
      <div style="font-size:0.62rem;color:${isT?'var(--gold)':'var(--muted)'};margin-bottom:4px;">${dn}</div>
      <div style="border-radius:6px;background:${bg};padding:8px 4px;border:${isT?'2px solid var(--gold)':'1px solid #2a2520'};">
        ${PRAYERS.map(p=>{
          const s=getPrayerStatus(k,p.id);
          const c=s==='ontime'?'#C9A84C':s==='late'?'#4CAF7D':s==='missed'?'#D94A4A':'#333';
          return `<div style="width:8px;height:8px;border-radius:50%;background:${c};margin:2px auto;"></div>`;
        }).join('')}
      </div>
      <div style="font-size:0.58rem;color:var(--muted);margin-top:3px;">${dd.getUTCDate()}</div>
    </div>`;
  }).join('');

  // Monthly calendar
  document.getElementById('prayerMonthDisp').textContent=MONTHS_FULL[prayerMonth]+' 2026';
  const mStart=utcDate(2026,prayerMonth-1,1);
  const mEnd=utcDate(2026,prayerMonth,0);
  const offset=(mStart.getUTCDay()===0)?6:mStart.getUTCDay()-1;
  let calHTML=['M','T','W','T','F','S','S'].map(d=>`<div style="text-align:center;font-size:0.6rem;color:var(--muted);padding:2px;">${d}</div>`).join('');
  for(let i=0;i<offset;i++) calHTML+=`<div></div>`;
  for(let day=1;day<=mEnd.getUTCDate();day++){
    const dd=utcDate(2026,prayerMonth-1,day);
    const k=dateKey(dd);
    const bg=prayerDayColor(k);
    const isT=k===tashKey();
    const {ontime,late,missed}=prayerDayScore(k);
    calHTML+=`<div style="aspect-ratio:1;border-radius:5px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:0.62rem;font-weight:600;border:${isT?'2px solid var(--gold)':'1px solid #222'};color:${bg==='#1a1a1a'?'var(--muted)':'rgba(0,0,0,0.8)'};" title="${ontime} on time, ${late} late, ${missed} missed">${day}</div>`;
  }
  document.getElementById('prayerCal').innerHTML=calHTML;
}

function changePrayerDay(n){ prayerDate=addDays(prayerDate,n); renderPrayer(); }
function prayerGoToday(){ prayerDate=todayUTC(); renderPrayer(); }
function changePrayerMonth(n){ prayerMonth=Math.max(1,Math.min(12,prayerMonth+n)); renderPrayer(); }

// ═══════════════════════════════════════════
// WORKOUT LOG
// ═══════════════════════════════════════════
const WORKOUT_KEY='life_plan_2026_workout';
let workoutState={}; // { 'YYYY-MM-DD': { type:'chest', exercises:[{id,name,sets,reps,weight,notes}] } }
let workoutDate=todayUTC();

function loadWorkoutFromCloud(){
  // loaded via Firebase loadFromCloud()
}
function saveWorkoutToCloud(){ scheduleSave(); }

function setSessionType(type){
  const key=dateKey(workoutDate);
  if(!workoutState[key]) workoutState[key]={type,exercises:[]};
  workoutState[key].type=type;
  saveWorkoutToCloud();
  renderWorkout();
}

function addExercise(){
  const name=document.getElementById('exName').value.trim();
  const sets=parseInt(document.getElementById('exSets').value)||0;
  const reps=parseInt(document.getElementById('exReps').value)||0;
  const weight=parseFloat(document.getElementById('exWeight').value)||0;
  const notes=document.getElementById('exNotes').value.trim();
  if(!name){ alert('Enter exercise name'); return; }
  const key=dateKey(workoutDate);
  if(!workoutState[key]) workoutState[key]={type:'full',exercises:[]};
  workoutState[key].exercises.push({id:Date.now(),name,sets,reps,weight,notes});
  ['exName','exSets','exReps','exWeight','exNotes'].forEach(id=>document.getElementById(id).value='');
  saveWorkoutToCloud();
  renderWorkout();
}

function deleteExercise(dateStr,id){
  if(!workoutState[dateStr]) return;
  workoutState[dateStr].exercises=workoutState[dateStr].exercises.filter(e=>e.id!==id);
  saveWorkoutToCloud();
  renderWorkout();
}

function getPersonalBests(){
  const bests={};
  Object.values(workoutState).forEach(session=>{
    (session.exercises||[]).forEach(e=>{
      const vol=e.sets*e.reps*e.weight;
      if(!bests[e.name]||vol>bests[e.name].vol)
        bests[e.name]={sets:e.sets,reps:e.reps,weight:e.weight,vol};
    });
  });
  return bests;
}

const SESSION_COLORS={cardio:'#4A90D9',chest:'#D94A4A',back:'#B464C8',legs:'#4CAF7D',shoulders:'#E07A30',arms:'#C9A84C',full:'#40C0D0'};

function renderWorkout(){
  const key=dateKey(workoutDate);
  const isToday=key===tashKey();
  document.getElementById('workoutDowDisp').textContent=DAYS_FULL[workoutDate.getUTCDay()];
  document.getElementById('workoutDateDisp').innerHTML=(isToday?'<span class="today-dot"></span>':'')+
    workoutDate.getUTCDate()+' '+MONTHS_SHORT[workoutDate.getUTCMonth()+1]+' 2026';

  // Session type buttons
  const session=workoutState[key]||{type:null,exercises:[]};
  ['cardio','chest','back','legs','shoulders','arms','full'].forEach(t=>{
    const btn=document.getElementById('stype-'+t);
    if(btn){
      btn.style.borderColor=session.type===t?SESSION_COLORS[t]:'#2a2520';
      btn.style.color=session.type===t?SESSION_COLORS[t]:'var(--muted)';
      btn.style.background=session.type===t?SESSION_COLORS[t]+'22':'var(--dark3)';
    }
  });

  // Session info
  document.getElementById('workoutSessionInfo').innerHTML=session.type
    ?`<div style="font-size:0.78rem;color:${SESSION_COLORS[session.type]};font-weight:600;">Session: ${session.type.charAt(0).toUpperCase()+session.type.slice(1)} · ${session.exercises.length} exercises</div>`
    :'<div style="font-size:0.75rem;color:var(--muted);">Select a session type above, then add exercises.</div>';

  // Exercise list
  if(session.exercises.length===0){
    document.getElementById('workoutList').innerHTML=
      `<div style="color:var(--muted);font-size:0.78rem;padding:10px 0;text-align:center;">No exercises logged yet.</div>`;
  } else {
    document.getElementById('workoutList').innerHTML=session.exercises.map(e=>{
      const vol=e.sets&&e.reps&&e.weight?`${e.sets*e.reps*e.weight}kg vol`:'';
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:7px;background:rgba(255,255,255,0.02);border:1px solid #1e1e1e;margin-bottom:5px;">
        <div style="flex:1;">
          <div style="font-size:0.85rem;font-weight:600;">${e.name}</div>
          <div style="font-size:0.7rem;color:var(--muted);margin-top:2px;">
            ${e.sets?`${e.sets} sets`:''} ${e.reps?`× ${e.reps} reps`:''} ${e.weight?`@ ${e.weight}kg`:''} ${vol?`<span style="color:var(--gold);margin-left:6px;">${vol}</span>`:''}
          </div>
          ${e.notes?`<div style="font-size:0.68rem;color:var(--purple);margin-top:2px;">📝 ${e.notes}</div>`:''}
        </div>
        <div onclick="deleteExercise('${key}',${e.id})" style="cursor:pointer;color:var(--muted);font-size:0.7rem;padding:2px 7px;border-radius:4px;border:1px solid #333;" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--muted)'">✕</div>
      </div>`;
    }).join('');
  }

  // Personal bests
  const bests=getPersonalBests();
  const bestKeys=Object.keys(bests);
  document.getElementById('personalBests').innerHTML=bestKeys.length===0
    ?`<div style="color:var(--muted);font-size:0.78rem;padding:8px 0;">Start logging to see your personal bests!</div>`
    :`<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">${bestKeys.slice(0,10).map(name=>{
      const b=bests[name];
      return `<div style="background:var(--dark3);border-radius:7px;padding:10px 12px;border:1px solid #222;">
        <div style="font-size:0.8rem;font-weight:600;color:var(--gold);">🏆 ${name}</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:3px;">${b.sets}×${b.reps} @ ${b.weight}kg · <span style="color:var(--text)">${b.vol}kg vol</span></div>
      </div>`;
    }).join('')}</div>`;
}

function changeWorkoutDay(n){ workoutDate=addDays(workoutDate,n); renderWorkout(); }
function workoutGoToday(){ workoutDate=todayUTC(); renderWorkout(); }

// ═══════════════════════════════════════════
// WEEKLY REFLECTION
// ═══════════════════════════════════════════
const REFLECT_KEY='life_plan_2026_reflect';
let reflectState={}; // { 'YYYY-WW': { scores:{}, well, bad, next, grat } }
let reflectWkOff=0;

const REFLECT_AREAS=[
  {id:'discipline', label:'Discipline',  icon:'fa-solid fa-bolt',      color:'#C9A84C'},
  {id:'deen',       label:'Deen / Faith',icon:'fa-solid fa-mosque',    color:'#E07A30'},
  {id:'health',     label:'Health / Gym',icon:'fa-solid fa-dumbbell',  color:'#4CAF7D'},
  {id:'business',   label:'Business',    icon:'fa-solid fa-briefcase', color:'#40C0D0'},
  {id:'mindset',    label:'Mindset',     icon:'fa-solid fa-brain',     color:'#B464C8'},
];

function getWeekKey(offset){
  const mon=addDays(getMonday(todayUTC()),offset*7);
  return dateKey(mon);
}

function loadReflectFromCloud(){
  // loaded via Firebase loadFromCloud()
}
function saveReflectToCloud(){ scheduleSave(); }

function saveReflection(){
  const wk=getWeekKey(reflectWkOff);
  if(!reflectState[wk]) reflectState[wk]={scores:{},well:'',bad:'',next:'',grat:''};
  REFLECT_AREAS.forEach(a=>{
    const el=document.getElementById('slider-'+a.id);
    if(el) reflectState[wk].scores[a.id]=parseInt(el.value);
  });
  reflectState[wk].well =document.getElementById('reflectWell').value;
  reflectState[wk].bad  =document.getElementById('reflectBad').value;
  reflectState[wk].next =document.getElementById('reflectNext').value;
  reflectState[wk].grat =document.getElementById('reflectGrat').value;
  saveReflectToCloud();
  renderReflect();
}

function renderReflect(){
  const wk=getWeekKey(reflectWkOff);
  const mon=addDays(getMonday(new Date()),reflectWkOff*7);
  const sun=addDays(mon,6);
  document.getElementById('reflectWkDisp').textContent=
    mon.getUTCDate()+" "+MONTHS_SHORT[mon.getUTCMonth()+1]+' – '+sun.getUTCDate()+" "+MONTHS_SHORT[sun.getUTCMonth()+1]+' 2026';

  const saved=reflectState[wk]||{scores:{},well:'',bad:'',next:'',grat:''};

  // Sliders
  document.getElementById('reflectSliders').innerHTML=REFLECT_AREAS.map(a=>{
    const val=saved.scores[a.id]||5;
    return `<div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:7px;font-size:0.82rem;font-weight:600;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:${a.color}18;border:1px solid ${a.color}44;color:${a.color};font-size:0.6rem;"><i class="${a.icon}"></i></span>${a.label}</div>
        <div style="font-size:0.9rem;font-weight:700;color:${a.color}" id="sliderVal-${a.id}">${val}/10</div>
      </div>
      <input type="range" id="slider-${a.id}" min="1" max="10" value="${val}"
        oninput="document.getElementById('sliderVal-${a.id}').textContent=this.value+'/10'"
        style="width:100%;accent-color:${a.color};height:4px;">
      <div style="display:flex;justify-content:space-between;font-size:0.6rem;color:var(--muted);margin-top:2px;">
        <span>1 — Poor</span><span>5 — OK</span><span>10 — Perfect</span>
      </div>
    </div>`;
  }).join('');

  // Fill text areas
  document.getElementById('reflectWell').value=saved.well||'';
  document.getElementById('reflectBad').value =saved.bad||'';
  document.getElementById('reflectNext').value=saved.next||'';
  document.getElementById('reflectGrat').value=saved.grat||'';

  // Show AI weekly summary if it exists
  const aiSumEl = document.getElementById('reflectAISummary');
  if (aiSumEl) {
    if (saved.aiSummary) {
      aiSumEl.style.display = 'block';
      aiSumEl.innerHTML = `
        <div style="font-size:0.7rem;font-weight:700;color:#4A90D9;margin-bottom:6px;">🧠 AI Summary of this week</div>
        <div style="font-size:0.78rem;color:var(--text);line-height:1.5;margin-bottom:8px;">${saved.aiSummary}</div>
        ${saved.skills?.length ? `<div style="display:flex;gap:5px;flex-wrap:wrap;">${saved.skills.map(s=>`<span style="background:rgba(74,144,217,0.12);border:1px solid rgba(74,144,217,0.25);color:#4A90D9;padding:2px 8px;border-radius:10px;font-size:0.65rem;">${s}</span>`).join('')}</div>` : ''}`;
    } else {
      aiSumEl.style.display = 'none';
    }
  }

  // History — all saved weeks
  const weeks=Object.keys(reflectState).sort().reverse();
  if(weeks.length===0){
    document.getElementById('reflectHistory').innerHTML=
      `<div style="color:var(--muted);font-size:0.78rem;padding:8px;">No reflections saved yet. Fill in above and hit Save!</div>`;
    return;
  }
  document.getElementById('reflectHistory').innerHTML=weeks.map(wKey=>{
    const r=reflectState[wKey];
    const avg=REFLECT_AREAS.reduce((s,a)=>s+(r.scores[a.id]||0),0)/REFLECT_AREAS.length;
    const color=avg>=8?'#4CAF7D':avg>=6?'#C9A84C':avg>=4?'#E07A30':'#D94A4A';
    return `<div style="background:var(--dark3);border-radius:8px;padding:12px 16px;margin-bottom:8px;border:1px solid #222;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="font-size:0.78rem;color:var(--muted);">Week of ${wKey}</div>
        <div style="font-size:1rem;font-weight:700;color:${color}">${avg.toFixed(1)}/10</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${REFLECT_AREAS.map(a=>{
          const v=r.scores[a.id]||0;
          return `<div style="display:inline-flex;align-items:center;gap:4px;font-size:0.68rem;padding:3px 8px;border-radius:10px;background:${a.color}22;color:${a.color};"><i class="${a.icon}" style="font-size:0.55rem;"></i>${v}</div>`;
        }).join('')}
      </div>
      ${r.well?`<div style="font-size:0.72rem;color:var(--muted);margin-top:6px;border-top:1px solid #2a2520;padding-top:6px;">✅ ${r.well.substring(0,80)}${r.well.length>80?'...':''}</div>`:''}
    </div>`;
  }).join('');
}

function changeReflectWeek(n){ reflectWkOff+=n; renderReflect(); }
function reflectThisWeek(){ reflectWkOff=0; renderReflect(); }

// ═══════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════
let focusMode = (() => {
  try { return localStorage.getItem('planner_focus_mode') === 'minimum' ? 'minimum' : 'standard'; }
  catch { return 'standard'; }
})();

function taskMinutes(task) {
  const [hours, minutes] = String(task?.time || '23:59').split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 23) * 60 + (Number.isFinite(minutes) ? minutes : 59);
}

function getFocusSelection(tasks, key) {
  const incomplete = tasks
    .filter(task => task?.id != null && !getTask(key, task.id))
    .slice()
    .sort((a, b) => taskMinutes(a) - taskMinutes(b));
  if (!incomplete.length) return [];

  if (focusMode === 'minimum') {
    const selected = [];
    ['quran', 'gym', 'plan'].forEach(category => {
      const match = incomplete.find(task => getCategoryMeta(task.cat).key === category && !selected.includes(task));
      if (match) selected.push(match);
    });
    incomplete.forEach(task => { if (selected.length < 3 && !selected.includes(task)) selected.push(task); });
    return selected.slice(0, 3);
  }

  const now = nowTashkent();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  let startIndex = incomplete.findIndex(task => taskMinutes(task) >= nowMinutes - 30);
  if (startIndex < 0) startIndex = Math.max(0, incomplete.length - 1);
  return [
    ...incomplete.slice(startIndex),
    ...incomplete.slice(0, startIndex).reverse(),
  ].slice(0, 3);
}

function focusTaskToken(id) {
  return encodeURIComponent(String(id)).replaceAll("'", '%27');
}

function toggleFocusTask(token) {
  toggleTask(tashKey(), decodeURIComponent(token));
}

function setFocusMode(mode) {
  focusMode = mode === 'minimum' ? 'minimum' : 'standard';
  try { localStorage.setItem('planner_focus_mode', focusMode); } catch {}
  renderDashboard();
}

function renderFocusDashboard(tasks, key, taskDone, prayedToday, dietScore, todaySpent) {
  const selection = getFocusSelection(tasks, key);
  const remaining = Math.max(0, tasks.length - taskDone);
  const standardButton = document.getElementById('focusModeStandard');
  const minimumButton = document.getElementById('focusModeMinimum');
  standardButton?.classList.toggle('active', focusMode === 'standard');
  minimumButton?.classList.toggle('active', focusMode === 'minimum');

  const message = document.getElementById('focusMessage');
  if (message) {
    message.textContent = remaining === 0
      ? 'You are finished for today. Rest without guilt.'
      : focusMode === 'minimum'
        ? 'Busy day: protect the essentials. Anything else is a bonus.'
        : `${remaining} task${remaining === 1 ? '' : 's'} remain. Do the next one, not the whole day at once.`;
  }

  const nowBox = document.getElementById('focusNow');
  const list = document.getElementById('focusTasks');
  if (!selection.length) {
    if (nowBox) nowBox.innerHTML = `<div class="focus-complete"><strong>Day complete ✓</strong><span>You kept the promises that mattered today.</span></div>`;
    if (list) list.innerHTML = '';
  } else {
    const next = selection[0];
    const nextCategory = getCategoryMeta(next.cat);
    const nextText = escapeHTML(next.text || 'Untitled task');
    if (nowBox) nowBox.innerHTML = `
      <div class="focus-now">
        <span class="focus-now-badge">DO NOW</span>
        <span class="focus-now-main">
          <strong>${nextText}</strong>
          <small>${escapeHTML(next.time || 'Any time')} · ${escapeHTML(nextCategory.label)} · ${taskPoints(next)} pts</small>
        </span>
        <button class="focus-check" onclick="toggleFocusTask('${focusTaskToken(next.id)}')" title="Mark complete" aria-label="Mark ${nextText} complete"><i class="fa-solid fa-check"></i></button>
      </div>`;
    if (list) list.innerHTML = selection.slice(1).map(task => {
      const category = getCategoryMeta(task.cat);
      return `<div class="focus-task" onclick="toggleFocusTask('${focusTaskToken(task.id)}')">
        <span class="focus-task-dot" style="background:${category.color}"></span>
        <span class="focus-task-text">${escapeHTML(task.text || 'Untitled task')}</span>
        <span class="focus-task-time">${escapeHTML(task.time || '')}</span>
        <i class="fa-regular fa-circle-check" style="color:${category.color}"></i>
      </div>`;
    }).join('');
  }

  const prayerSummary = document.getElementById('focusPrayerSummary');
  const dietSummary = document.getElementById('focusDietSummary');
  const moneySummary = document.getElementById('focusMoneySummary');
  if (prayerSummary) prayerSummary.textContent = `${prayedToday}/5 recorded today`;
  if (dietSummary) dietSummary.textContent = `${dietScore}/4 essentials complete`;
  if (moneySummary) moneySummary.textContent = todaySpent ? `${fmtNum(todaySpent)} so'm spent` : 'No spending logged';
}

function quickAddTodayTask() {
  const input = document.getElementById('quickTaskInput');
  const status = document.getElementById('quickTaskStatus');
  const text = input?.value.trim();
  if (!text) {
    if (status) status.textContent = 'Write a short next action first.';
    input?.focus();
    return;
  }

  const date = todayUTC();
  const key = tashKey();
  const currentTasks = getTasksForDate(date).map(task => ({ ...task }));
  const now = nowTashkent();
  const roundedMinutes = Math.min(23 * 60 + 45, Math.ceil((now.getUTCHours() * 60 + now.getUTCMinutes() + 15) / 15) * 15);
  const time = `${String(Math.floor(roundedMinutes / 60)).padStart(2, '0')}:${String(roundedMinutes % 60).padStart(2, '0')}`;
  currentTasks.push({
    id: `quick_${Date.now()}`,
    cat: 'plan',
    text: text.slice(0, 160),
    time,
    pts: 2,
  });
  customTasks[key] = currentTasks;
  window._customTasks = customTasks;
  input.value = '';
  scheduleSave();
  renderAll();
  if (status) status.textContent = 'Added to today and saving automatically ✓';
}

function askCoachToPrioritize() {
  const prompt = focusMode === 'minimum'
    ? 'Using my live planner data, build the smallest realistic successful day for me. Give me exactly 3 actions and keep the answer short.'
    : 'Using my live planner data and current progress, choose exactly 3 realistic priorities for today. Tell me which one to start now and keep the answer short.';
  window.openAiCoach?.(prompt, true);
}

function renderDashboard(){
  const today = nowTashkent(); // Tashkent time — use UTC accessors
  const key   = tashKey();
  const hour  = today.getUTCHours();
  const greeting = hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const mo = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  document.getElementById('dashGreeting').textContent =
    `${hour<12?'🌅':hour<17?'☀️':'🌙'} ${greeting}, brother!`;
  document.getElementById('dashDate').textContent =
    `${dayNames[today.getUTCDay()]}, ${today.getUTCDate()} ${mo[today.getUTCMonth()]} 2026`;

  // Countdown — compare UTC midnight dates with Tashkent today
  const todayUTC  = tashMidnight(); // today at 00:00 Tashkent = correct UTC reference
  const endOf2026 = new Date('2026-12-31');
  const sepStart  = new Date('2026-09-01');
  const daysLeft  = Math.ceil((endOf2026-todayUTC)/(1000*60*60*24));
  const daysSep   = Math.ceil((sepStart-todayUTC)/(1000*60*60*24));
  document.getElementById('dashCountdown').innerHTML =
    `<div style="color:var(--gold);font-weight:700;font-size:1rem;">${daysLeft} days left in 2026</div>` +
    (daysSep>0?`<div style="color:var(--muted);font-size:0.72rem;margin-top:2px;">${daysSep} days until school starts</div>`:'');

  // Pulse cards — 5 key metrics
  const tasks    = getTasksForDate(today);
  const taskDone = tasks.filter(t=>getTask(key,t.id)).length;
  const taskPct  = tasks.length?Math.round(taskDone/tasks.length*100):0;

  const {ontime,late,missed,total:pTotal} = prayerDayScore(key);
  const prayedToday = ontime+late;

  const dietScore = dietDayScore(key);

  const todaySpent = getDayTotal(key);

  const overallPct = overallStats().pct;
  renderFocusDashboard(tasks, key, taskDone, prayedToday, dietScore, todaySpent);

  // Each card navigates to its section on click — navTo is global so onclick can reach it
  document.getElementById('dashPulse').innerHTML = [
    {label:'Tasks Done',  val:`${taskDone}/${tasks.length}`, sub:`${taskPct}%`,      color:taskPct===100?'#4CAF7D':'#C9A84C', icon:'fa-solid fa-list-check', sec:'daily'},
    {label:'Prayers',     val:`${prayedToday}/5`,            sub:ontime+' on time',  color:prayedToday===5?'#C9A84C':'#D94A4A', icon:'fa-solid fa-mosque',    sec:'prayer'},
    {label:'Diet Score',  val:`${dietScore}/4`,              sub:dietScore===4?'Perfect':'Keep going', color:dietScore===4?'#4CAF7D':dietScore>=2?'#E07A30':'#D94A4A', icon:'fa-solid fa-leaf', sec:'diet'},
    {label:'Spent Today', val:todaySpent?fmtNum(todaySpent):'0',sub:"so'm",          color:'#4A90D9', icon:'fa-solid fa-coins',      sec:'money'},
    {label:'2026 Overall',val:`${overallPct}%`,              sub:'tasks done so far', color:'#C9A84C', icon:'fa-solid fa-chart-line', sec:'tracker'},
  ].map(c=>`
    <div class="task-card" onclick="navTo('${c.sec}')" style="text-align:center;padding:14px;border-top:3px solid ${c.color};cursor:pointer;transition:transform .15s,box-shadow .15s;"
      onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.5)'"
      onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:11px;background:${c.color}1A;border:1px solid ${c.color}44;color:${c.color};font-size:0.95rem;margin-bottom:6px;box-shadow:0 2px 10px rgba(0,0,0,0.4),0 0 12px ${c.color}22;"><i class="${c.icon}"></i></div>
      <div style="font-family:'Playfair Display',serif;font-size:1.3rem;color:${c.color};font-weight:700;">${c.val}</div>
      <div style="font-size:0.62rem;color:var(--muted);margin-top:2px;">${c.label}</div>
      <div style="font-size:0.6rem;color:${c.color};margin-top:1px;">${c.sub}</div>
    </div>`).join('');

  // Today's tasks mini list
  document.getElementById('dashTasks').innerHTML = tasks.slice(0,6).map(t=>{
    const done = getTask(key,t.id);
    const c = getCategoryMeta(t.cat);
    const label = escapeHTML(t.text || 'Untitled task');
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #1a1a1a;">
      <div style="width:14px;height:14px;border-radius:3px;border:2px solid ${done?c.color:'#444'};background:${done?c.color:'transparent'};display:flex;align-items:center;justify-content:center;font-size:0.55rem;color:#000;flex-shrink:0;">${done?'✓':''}</div>
      <div style="font-size:0.75rem;${done?'text-decoration:line-through;opacity:0.5':''};flex:1;">${label.substring(0,35)}${label.length>35?'...':''}</div>
      <div style="font-size:0.6rem;color:var(--muted);">${escapeHTML(t.time || '')}</div>
    </div>`;
  }).join('')+
  (tasks.length>6?`<div style="font-size:0.68rem;color:var(--muted);padding:6px 0;">+${tasks.length-6} more tasks...</div>`:'');

  // Today's prayers mini
  document.getElementById('dashPrayers').innerHTML = PRAYERS.map(p=>{
    const s = getPrayerStatus(key,p.id);
    const colors={none:'#333',ontime:'#C9A84C',late:'#4CAF7D',missed:'#D94A4A'};
    const labels={none:'—',ontime:'On Time',late:'Late',missed:'Missed'};
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #1a1a1a;">
      <div style="display:flex;align-items:center;gap:7px;font-size:0.82rem;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:${p.iconColor}18;border:1px solid ${p.iconColor}44;color:${p.iconColor};font-size:0.55rem;flex-shrink:0;"><i class="${p.icon}"></i></span>${p.name}</div>
      <div style="font-size:0.68rem;font-weight:600;color:${colors[s]};padding:2px 8px;border-radius:10px;background:${colors[s]}22;">${labels[s]}</div>
    </div>`;
  }).join('');

  // Streak cards
  const HABITS = [
    {label:'Tasks',   icon:'fa-solid fa-list-check', color:'#C9A84C',  getStreak: ()=>{
      let s=0,d=new Date(today);
      while(true){ const k=dateKey(d); const ts=getTasksForDate(d); if(ts.length&&ts.every(t=>getTask(k,t.id)))s++; else break; d=addDays(d,-1); if(d<START)break; } return s;
    }},
    {label:'Prayer',  icon:'fa-solid fa-mosque',      color:'#E07A30',  getStreak: ()=>getPrayerStreak()},
    {label:'Diet',    icon:'fa-solid fa-leaf',         color:'#4CAF7D',  getStreak: ()=>getDietStreak()},
    {label:'Gym',     icon:'fa-solid fa-dumbbell',     color:'#4A90D9',  getStreak: ()=>{
      let s=0,d=new Date(today);
      while(true){ const k=dateKey(d); const ts=getTasksForDate(d).filter(t=>t.cat==='gym'); if(ts.length&&ts.every(t=>getTask(k,t.id)))s++; else break; d=addDays(d,-1); if(d<START)break; } return s;
    }},
  ];
  document.getElementById('dashStreaks').innerHTML = HABITS.map(h=>{
    const streak = h.getStreak();
    const fireHtml = streak>=30?'<i class="fa-solid fa-fire" style="color:#FF6B35"></i><i class="fa-solid fa-fire" style="color:#FF6B35"></i><i class="fa-solid fa-fire" style="color:#FF6B35"></i>':streak>=14?'<i class="fa-solid fa-fire" style="color:#FF6B35"></i><i class="fa-solid fa-fire" style="color:#FF6B35"></i>':streak>=3?'<i class="fa-solid fa-fire" style="color:#FF6B35"></i>':'';
    return `<div style="text-align:center;background:linear-gradient(155deg,#13131A,#0E0E14);border-radius:10px;padding:14px;border:1px solid ${streak>0?h.color+'44':'#222'};box-shadow:0 4px 16px rgba(0,0,0,0.4);">
      <div style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:${h.color}18;border:1px solid ${h.color}44;color:${h.color};font-size:0.9rem;margin-bottom:6px;box-shadow:0 2px 8px rgba(0,0,0,0.4),0 0 10px ${h.color}22;"><i class="${h.icon}"></i></div>
      <div style="font-family:'Playfair Display',serif;font-size:1.8rem;color:${streak>0?h.color:'var(--muted)'};font-weight:700;">${streak}</div>
      <div style="font-size:0.65rem;color:var(--muted);margin-top:2px;">${h.label} streak</div>
      <div style="font-size:0.75rem;margin-top:3px;">${fireHtml||'<span style="font-size:0.65rem;color:var(--muted)">Start today!</span>'}</div>
    </div>`;
  }).join('');

  // Money widget
  const sv = savingsState[6]||{salary:0,saved:0};
  const savePct = sv.salary?Math.round(sv.saved/sv.salary*100):0;
  const mStart = utcDate(2026,5,1), mEnd=utcDate(2026,6,0);
  const mSpent = getCatTotalRange(mStart,mEnd,null);
  document.getElementById('dashMoney').innerHTML=`
    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:6px 0;border-bottom:1px solid #1a1a1a;">
      <span style="color:var(--muted)">Today</span><span style="color:var(--red);font-weight:600;">${fmtNum(todaySpent)} so'm</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:6px 0;border-bottom:1px solid #1a1a1a;">
      <span style="color:var(--muted)">This month</span><span style="color:var(--orange);font-weight:600;">${fmtNum(mSpent)} so'm</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:0.78rem;padding:6px 0;">
      <span style="color:var(--muted)">Savings rate</span><span style="color:${savePct>=80?'#4CAF7D':'#E07A30'};font-weight:600;">${savePct}%</span>
    </div>`;

  // Diet widget
  const dRules=['bread','sugar','water','meal'];
  const dLabels={bread:'No bread',sugar:'No sugar',water:'2L water',meal:'Clean meals'};
  const dColors={bread:'#E07A30',sugar:'#D94A4A',water:'#4A90D9',meal:'#4CAF7D'};
  document.getElementById('dashDiet').innerHTML = dRules.map(r=>{
    const done=getDiet(key,r);
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #1a1a1a;">
      <div style="width:12px;height:12px;border-radius:50%;background:${done?dColors[r]:'#333'};flex-shrink:0;"></div>
      <div style="font-size:0.75rem;${done?'':'opacity:0.5'}">${dLabels[r]}</div>
      ${done?`<div style="margin-left:auto;font-size:0.65rem;color:${dColors[r]};">✓</div>`:''}
    </div>`;
  }).join('');

  // Goals widget — top 3 trackers
  document.getElementById('dashGoals').innerHTML = TRACKERS.slice(0,4).map(g=>{
    const cs=catStatsRange(START,END,g.cat,true);
    return `<div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:3px;">
        <span>${g.icon} ${g.name.split('—')[0].trim()}</span>
        <span style="color:${g.color};font-weight:600;">${cs.pct}%</span>
      </div>
      <div style="height:4px;background:var(--dark4);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${cs.pct}%;background:${g.color};border-radius:2px;transition:width .5s;"></div>
      </div>
    </div>`;
  }).join('');

  // Weight card
  if (typeof renderDashWeightCard === 'function') renderDashWeightCard();
}

// ═══════════════════════════════════════════
// STREAK WALL
// ═══════════════════════════════════════════
const STREAK_HABITS = [
  { label:'All Tasks',  icon:'fa-solid fa-list-check', color:'#C9A84C', check:(key)=>{
    const d=new Date(key); const ts=getTasksForDate(d);
    return ts.length>0 && ts.every(t=>getTask(key,t.id));
  }},
  { label:'Prayer (all 5)', icon:'fa-solid fa-mosque', color:'#E07A30', check:(key)=>{
    const {ontime,late}=prayerDayScore(key); return ontime+late===5;
  }},
  { label:'Diet (4/4)',  icon:'fa-solid fa-leaf',     color:'#4CAF7D', check:(key)=> dietDayScore(key)===4 },
  { label:'Gym',        icon:'fa-solid fa-dumbbell',  color:'#4A90D9', check:(key)=>{
    const d=new Date(key); const ts=getTasksForDate(d).filter(t=>t.cat==='gym');
    return ts.length>0 && ts.every(t=>getTask(key,t.id));
  }},
  { label:'Quran',      icon:'fa-solid fa-book-open', color:'#B464C8', check:(key)=>{
    const d=new Date(key); const ts=getTasksForDate(d).filter(t=>t.cat==='quran');
    return ts.length>0 && ts.every(t=>getTask(key,t.id));
  }},
  { label:'Finance',    icon:'fa-solid fa-chart-line', color:'#FF8040', check:(key)=>{
    const d=new Date(key); const ts=getTasksForDate(d).filter(t=>t.cat==='finance');
    return ts.length>0 && ts.every(t=>getTask(key,t.id));
  }},
];

function renderStreakWall(){
  const el = document.getElementById('streakWall');
  if(!el) return;

  // Build all days Jun 1 → Dec 31
  const allDays=[];
  let d=new Date(START);
  while(d<=END){ allDays.push(new Date(d)); d=addDays(d,1); }
  const today=nowTashkent();

  let html='';
  STREAK_HABITS.forEach(h=>{
    // Calculate current streak
    let streak=0;
    let sd=new Date(today);
    while(sd>=START){ if(h.check(dateKey(sd)))streak++; else break; sd=addDays(sd,-1); }

    html+=`<div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:${h.color}18;border:1px solid ${h.color}44;color:${h.color};font-size:0.6rem;"><i class="${h.icon}"></i></span>
        <span style="font-size:0.82rem;font-weight:600;color:${h.color};">${h.label}</span>
        <span style="font-size:0.7rem;color:var(--muted);margin-left:4px;"><i class="fa-solid fa-fire" style="color:#FF6B35;font-size:0.65rem;"></i> ${streak} day streak</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:3px;">`;

    allDays.forEach(day=>{
      const k=dateKey(day);
      const isFuture=day>today;
      const done=!isFuture&&h.check(k);
      const isToday=k===dateKey(today);
      const bg=isFuture?'#111':done?h.color:'#1e1e1e';
      const border=isToday?`2px solid ${h.color}`:'1px solid #2a2520';
      const title=day.getUTCDate()+' '+MONTHS_SHORT[day.getUTCMonth()+1];
      html+=`<div title="${title}" style="width:14px;height:14px;border-radius:2px;background:${bg};border:${border};flex-shrink:0;opacity:${isFuture?0.3:1};transition:background .3s;"></div>`;
    });

    html+=`</div>
      <div style="display:flex;justify-content:space-between;font-size:0.6rem;color:var(--muted);margin-top:4px;">
        <span>Jun 1</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec 31</span>
      </div>
    </div>`;
  });

  el.innerHTML=html;
}

// ═══════════════════════════════════════════
// YOUTUBE CONTENT PLANNER
// ═══════════════════════════════════════════
const YT_KEY = 'life_plan_2026_youtube';
let ytState  = {}; // { ep1: 'none'|'filmed'|'uploaded', ep2: ... }

// Generate all 24 episodes — 50 moddalar each, starting from modda 1
// Week 1 Saturday = Jun 6 2026
const YT_EPISODES = [];
for(let i=0;i<24;i++){
  const startMod = i*50 + 1;
  const endMod   = startMod + 49;
  // Saturday of each week starting Jun 7 (first Saturday of June 2026)
  const satDate  = new Date('2026-06-06');
  satDate.setUTCDate(satDate.getUTCDate() + i*7);
  YT_EPISODES.push({
    id: 'ep'+(i+1),
    ep: i+1,
    startMod,
    endMod,
    date: new Date(satDate),
    title: `FK ${i+1}-qism: ${startMod}–${endMod}-moddalar`,
    description: getFKDescription(startMod, endMod),
  });
}

function getFKDescription(start, end){
  if(start<=50)   return 'Umumiy qoidalar, fuqarolik huquqining asoslari';
  if(start<=100)  return 'Jismoniy shaxslar, yuridik shaxslar';
  if(start<=150)  return 'Bitimlar, vakillik, muddatlar';
  if(start<=200)  return 'Mulk huquqi — umumiy qoidalar';
  if(start<=250)  return 'Mulkchilik shakllari, umumiy mulk';
  if(start<=300)  return 'Mulkni himoya qilish, ashyoviy huquqlar';
  if(start<=350)  return 'Majburiyatlar huquqi — asosiy qoidalar';
  if(start<=400)  return 'Majburiyatlarning bajarilishi va ta\'minlanishi';
  if(start<=450)  return 'Majburiyatlarning tugatilishi, javobgarlik';
  if(start<=500)  return 'Shartnoma — umumiy qoidalar';
  if(start<=550)  return 'Oldi-sotdi shartnomasi';
  if(start<=600)  return 'Mena, sovg\'a, renta shartnomalari';
  if(start<=650)  return 'Ijara shartnomalari';
  if(start<=700)  return 'Pudrat shartnomalari';
  if(start<=750)  return 'Xizmat ko\'rsatish, tashish shartnomalari';
  if(start<=800)  return 'Qarz, kredit, bank hisob shartnomalari';
  if(start<=850)  return 'Sug\'urta, topshiriq, komissiya';
  if(start<=900)  return 'Omborlash, sheriklik shartnomalari';
  if(start<=950)  return 'Majburiyatlar (zarar, asossiz boyish)';
  if(start<=1000) return 'Intellektual mulk — umumiy qoidalar';
  if(start<=1050) return 'Mualliflik huquqi';
  if(start<=1100) return 'Patent huquqi, tovar belgilari';
  if(start<=1150) return 'Vorislik huquqi';
  return 'Xalqaro xususiy huquq';
}

function loadYtFromCloud(){
  // loaded via Firebase loadFromCloud()
}
function saveYtToCloud(){ scheduleSave(); }

function cycleYtStatus(epId){
  const cur = ytState[epId]||'none';
  ytState[epId] = cur==='none'?'planned': cur==='planned'?'filmed': cur==='filmed'?'uploaded':'none';
  saveYtToCloud();
  renderYoutube();
}

function getYtStatus(epId){ return ytState[epId]||'none'; }

function getCurrentEpisode(){
  const today = nowTashkent();
  if (today < YT_EPISODES[0].date) return { ...YT_EPISODES[0], prelaunch: true }; // series not started
  let cur = YT_EPISODES[0];
  for(const ep of YT_EPISODES){
    if(ep.date <= today) cur = ep;
    else break;
  }
  return cur;
}

function renderYoutube(){
  const today   = nowTashkent();
  const curEp   = getCurrentEpisode();
  const uploaded= YT_EPISODES.filter(e=>getYtStatus(e.id)==='uploaded').length;
  const filmed  = YT_EPISODES.filter(e=>getYtStatus(e.id)==='filmed').length;
  const planned = YT_EPISODES.filter(e=>getYtStatus(e.id)==='planned').length;
  const remaining=YT_EPISODES.length - uploaded;

  // Stats
  document.getElementById('ytStats').innerHTML=[
    {label:'Episodes Uploaded', val:uploaded,    sub:'of 24 total',              color:'#FF6080', icon:'fa-solid fa-upload'},
    {label:'Filmed (not yet up)',val:filmed,      sub:'ready to upload',          color:'#C9A84C', icon:'fa-solid fa-video'},
    {label:'Current Episode',   val:'#'+curEp.ep,sub:curEp.startMod+'–'+curEp.endMod+' moddalar', color:'#4A90D9', icon:'fa-solid fa-play'},
    {label:'Episodes Left',     val:remaining,   sub:'to complete the series',   color:'#4CAF7D', icon:'fa-solid fa-film'},
  ].map(c=>`<div class="task-card" style="text-align:center;padding:14px;border-top:3px solid ${c.color};">
    <div style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:11px;background:${c.color}1A;border:1px solid ${c.color}44;color:${c.color};font-size:0.95rem;margin-bottom:6px;box-shadow:0 2px 10px rgba(0,0,0,0.4),0 0 12px ${c.color}22;"><i class="${c.icon}"></i></div>
    <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:${c.color};font-weight:700;">${c.val}</div>
    <div style="font-size:0.62rem;color:var(--muted);margin-top:2px;">${c.label}</div>
    <div style="font-size:0.6rem;color:${c.color};margin-top:1px;">${c.sub}</div>
  </div>`).join('');

  // This week's video card
  const curStatus = getYtStatus(curEp.id);
  const statusColors={none:'#444',planned:'#C9A84C',filmed:'#4A90D9',uploaded:'#4CAF7D'};
  const statusLabels={none:'Not started',planned:'📝 Planned',filmed:'🎥 Filmed',uploaded:'🚀 Uploaded'};
  const nextEp = YT_EPISODES[curEp.ep] || null; // ep is 1-indexed, array is 0-indexed
  const daysToLaunch = curEp.prelaunch ? Math.ceil((YT_EPISODES[0].date - nowTashkent()) / 86400000) : 0;

  document.getElementById('ytThisWeek').innerHTML= curEp.prelaunch ? `
    <div style="text-align:center;padding:20px 0;">
      <div style="font-size:2rem;margin-bottom:6px;">🎬</div>
      <div style="font-family:'Playfair Display',serif;font-size:1.6rem;color:#FF6080;font-weight:700;">${daysToLaunch} days</div>
      <div style="font-size:0.78rem;color:var(--muted);margin-top:4px;">until your YouTube series launches</div>
      <div style="font-size:0.72rem;color:var(--gold);margin-top:8px;">📅 First episode: ${YT_EPISODES[0].date.getUTCDate()} Jun 2026 · EP1: ${YT_EPISODES[0].title}</div>
      <div style="margin-top:14px;font-size:0.7rem;color:var(--muted);">Use this time to prepare EP1 content — film, edit, plan first 4 episodes</div>
    </div>` : `
    <div style="display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;padding:12px 0;">
      <div style="font-family:'Playfair Display',serif;font-size:2.5rem;color:#FF608033;font-weight:900;">
        EP${curEp.ep}
      </div>
      <div>
        <div style="font-size:1rem;font-weight:700;color:var(--text);margin-bottom:4px;">${curEp.title}</div>
        <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">${curEp.description}</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <div style="font-size:0.7rem;color:var(--muted);">📅 ${curEp.date.getUTCDate()+' '+MONTHS_SHORT[curEp.date.getUTCMonth()+1]+' 2026'}</div>
          <div style="font-size:0.7rem;padding:3px 10px;border-radius:10px;background:${statusColors[curStatus]}22;color:${statusColors[curStatus]};font-weight:600;">${statusLabels[curStatus]}</div>
        </div>
      </div>
      <button class="btn btn-gold" onclick="cycleYtStatus('${curEp.id}')" style="white-space:nowrap;padding:8px 14px;">
        ${curStatus==='none'?'▶ Start':curStatus==='planned'?'🎥 Mark Filmed':curStatus==='filmed'?'🚀 Mark Uploaded':'↩ Reset'}
      </button>
    </div>
    ${nextEp?`<div style="background:var(--dark3);border-radius:8px;padding:10px 14px;margin-top:8px;display:flex;align-items:center;gap:10px;">
      <div style="font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;white-space:nowrap;">Next week →</div>
      <div style="font-size:0.8rem;color:var(--text);">EP${nextEp.ep}: ${nextEp.title}</div>
    </div>`:''}
    <div style="margin-top:14px;">
      <div style="display:flex;justify-content:space-between;font-size:0.68rem;color:var(--muted);margin-bottom:5px;">
        <span>Series progress</span><span>${uploaded}/24 episodes uploaded</span>
      </div>
      <div style="height:6px;background:var(--dark4);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${Math.round(uploaded/24*100)}%;background:linear-gradient(90deg,#FF6080,#FFB0C0);border-radius:3px;transition:width .5s;"></div>
      </div>
    </div>`;

  // Full episode list
  document.getElementById('ytEpisodeList').innerHTML = YT_EPISODES.map(ep=>{
    const st    = getYtStatus(ep.id);
    const sc    = {none:'#333',planned:'#C9A84C',filmed:'#4A90D9',uploaded:'#4CAF7D'};
    const sl    = {none:'—',planned:'📝 Planned',filmed:'🎥 Filmed',uploaded:'🚀 Live'};
    const isCur = ep.id===curEp.id;
    const isPast= ep.date < today && !isCur;
    return `<div onclick="cycleYtStatus('${ep.id}')" style="display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:8px;background:${isCur?'rgba(255,96,128,0.06)':'rgba(255,255,255,0.01)'};border:1px solid ${isCur?'rgba(255,96,128,0.3)':'#1e1e1e'};margin-bottom:5px;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='${isCur?'rgba(255,96,128,0.06)':'rgba(255,255,255,0.01)'}'">
      <div style="font-family:'Playfair Display',serif;font-size:1rem;color:${isCur?'#FF6080':isPast&&st==='none'?'#D94A4A':'var(--muted)'};font-weight:700;min-width:36px;">EP${ep.ep}</div>
      <div style="flex:1;">
        <div style="font-size:0.82rem;font-weight:${isCur?'700':'500'};color:${st==='uploaded'?'var(--muted)':'var(--text)'};${st==='uploaded'?'text-decoration:line-through;opacity:0.6':''}">${ep.title}</div>
        <div style="font-size:0.65rem;color:var(--muted);margin-top:1px;">${ep.description}</div>
      </div>
      <div style="font-size:0.62rem;color:var(--muted);white-space:nowrap;">${ep.date.getUTCDate()+' '+MONTHS_SHORT[ep.date.getUTCMonth()+1]}</div>
      <div style="font-size:0.68rem;padding:3px 8px;border-radius:8px;background:${sc[st]}22;color:${sc[st]};font-weight:600;min-width:70px;text-align:center;">${sl[st]}</div>
    </div>`;
  }).join('');
}


// Global nav helper — used by dashboard cards onclick
function navTo(id) {
  const tab = document.querySelector(`.ntab[data-sec="${id}"]`) || document.getElementById('moreNavBtn');
  showSec(id, tab);
}

function showSec(id,tab){
  const section = document.getElementById('sec-'+id);
  if (!section) return;
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('active'));
  section.classList.add('active');
  (tab || document.getElementById('moreNavBtn'))?.classList.add('active');
  closeMoreMenu();

  if(id==='dash')         { renderSafely('dashboard', renderDashboard); renderSafely('streak wall', renderStreakWall); setTimeout(()=>{renderSafely('best day',renderBestDay);renderSafely('month comparison',renderMonthCompare);},50); }
  else if(id==='diet')    renderSafely('diet', renderDiet);
  else if(id==='money')   renderSafely('money', renderMoney);
  else if(id==='prayer')  renderSafely('prayer', renderPrayer);
  else if(id==='workout') renderSafely('workout', renderWorkout);
  else if(id==='reflect') { renderSafely('reflection', renderReflect); setTimeout(()=>renderSafely('reflection chart',renderReflectChart),50); }
  else if(id==='tracker') { renderSafely('tracker', renderTracker); renderSafely('streak wall', renderStreakWall); setTimeout(()=>renderSafely('weight chart',renderWeightChart),50); }
  else if(id==='youtube') renderSafely('youtube', renderYoutube);
  else if(id==='aiplan')  { if(typeof renderAIPlan==='function' && aiPlanState) renderSafely('AI plan', renderAIPlan); }
  else if(id==='roadmap') { if(typeof renderRoadmap==='function') renderSafely('roadmap', renderRoadmap); }
  else renderAll();
}

function toggleMoreMenu() {
  const menu = document.getElementById('moreMenu');
  const backdrop = document.getElementById('moreMenuBackdrop');
  const button = document.getElementById('moreNavBtn');
  const open = !menu?.classList.contains('open');
  menu?.classList.toggle('open', open);
  backdrop?.classList.toggle('open', open);
  menu?.setAttribute('aria-hidden', String(!open));
  button?.setAttribute('aria-expanded', String(open));
}

function closeMoreMenu() {
  const menu = document.getElementById('moreMenu');
  const backdrop = document.getElementById('moreMenuBackdrop');
  const button = document.getElementById('moreNavBtn');
  menu?.classList.remove('open');
  backdrop?.classList.remove('open');
  menu?.setAttribute('aria-hidden', 'true');
  button?.setAttribute('aria-expanded', 'false');
}
function changeDay(n){ curDate=clamp(addDays(curDate,n)); renderAll(); }
function goToday(){ curDate=clamp(todayUTC()); renderAll(); }
function changeWeek(n){ wkOffset+=n; renderAll(); }
function goThisWeek(){ wkOffset=0; renderAll(); }
function changeMo(n){ curMonth=Math.max(5,Math.min(12,curMonth+n)); renderAll(); }

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// BODY WEIGHT TRACKER
// ═══════════════════════════════════════════
let weightState = {}; // { 'YYYY-MM-DD': 103.5 } or { 'YYYY-MM-DD': {w:103.5, cal:450} }

// Helpers to read weight/calories regardless of format (number vs object)
function _wGet(key)   { const v = weightState[key]; return v && typeof v === 'object' ? v.w   : (v || null); }
function _calGet(key) { const v = weightState[key]; return v && typeof v === 'object' ? v.cal : null; }
function _wSet(key, w, cal) {
  weightState[key] = { w, cal: cal || _calGet(key) || null };
}

function logWeight() {
  const val = parseFloat(document.getElementById('weightInput').value);
  if (!val || val < 30 || val > 300) {
    document.getElementById('weightStatus').textContent = '⚠️ Valid kg kiriting';
    return;
  }
  const key = tashKey();
  _wSet(key, val, null);
  window._weightState = weightState;
  scheduleSave();
  document.getElementById('weightInput').value = '';
  document.getElementById('weightStatus').textContent = `✅ ${val} kg saqlandi`;
  if (navigator.vibrate) navigator.vibrate(30);
  renderWeightChart();
  renderDashWeightCard();
}

function logWeightFromDash() {
  const wVal = parseFloat(document.getElementById('dashWeightInput').value);
  const cVal = parseInt(document.getElementById('dashCalInput').value) || null;
  const st   = document.getElementById('dashWeightStatus');
  if (!wVal && !cVal) { st.textContent = '⚠️ Enter weight or calories'; return; }
  const key  = tashKey();
  const existing = _wGet(key);
  _wSet(key, wVal || existing || null, cVal);
  window._weightState = weightState;
  scheduleSave();
  document.getElementById('dashWeightInput').value = '';
  document.getElementById('dashCalInput').value = '';
  if (navigator.vibrate) navigator.vibrate(30);
  const parts = [];
  if (wVal) parts.push(wVal + ' kg');
  if (cVal) parts.push(cVal + ' cal burned');
  st.style.color = '#4CAF7D';
  st.textContent = '✅ ' + parts.join(' · ') + ' saved!';
  setTimeout(() => { st.textContent = ''; st.style.color = ''; }, 3000);
  renderWeightChart();
  renderDashWeightCard();
}

function renderDashWeightCard() {
  const el = document.getElementById('dashWeightProgress');
  if (!el) return;

  const START_W = 105, TARGET = 90;
  const entries = Object.entries(weightState)
    .map(([k]) => ({ k, w: _wGet(k), cal: _calGet(k) }))
    .filter(e => e.w)
    .sort((a,b) => a.k.localeCompare(b.k));

  const latest    = entries.length ? entries[entries.length-1] : null;
  const currentW  = latest?.w ?? START_W;
  const lost      = Math.max(0, START_W - currentW);
  const toGo      = Math.max(0, currentW - TARGET);
  const pct       = Math.min(100, Math.round(lost / (START_W - TARGET) * 100));
  const todayKey  = tashKey();
  const todayCal  = _calGet(todayKey);
  const todayW    = _wGet(todayKey);

  // Trend: compare last 2 entries
  let trendHTML = '';
  if (entries.length >= 2) {
    const diff = currentW - entries[entries.length-2].w;
    const arrow = diff < 0 ? `<span style="color:#4CAF7D;">▼ ${Math.abs(diff).toFixed(1)} kg</span>` :
                  diff > 0 ? `<span style="color:#D94A4A;">▲ ${diff.toFixed(1)} kg</span>` :
                  `<span style="color:var(--muted);">─ no change</span>`;
    trendHTML = `<span style="font-size:0.7rem;"> ${arrow} since last log</span>`;
  }

  el.innerHTML = `
    <!-- Stats row -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
      <div style="text-align:center;min-width:60px;">
        <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:#4CAF7D;font-weight:700;">${currentW}<span style="font-size:0.7rem;font-weight:400;"> kg</span></div>
        <div style="font-size:0.6rem;color:var(--muted);">Current${todayW?' ✓':''}</div>
      </div>
      <div style="text-align:center;min-width:60px;">
        <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:${lost>0?'#C9A84C':'var(--muted)'};font-weight:700;">${lost.toFixed(1)}<span style="font-size:0.7rem;font-weight:400;"> kg</span></div>
        <div style="font-size:0.6rem;color:var(--muted);">Lost</div>
      </div>
      <div style="text-align:center;min-width:60px;">
        <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:#E07A30;font-weight:700;">${toGo.toFixed(1)}<span style="font-size:0.7rem;font-weight:400;"> kg</span></div>
        <div style="font-size:0.6rem;color:var(--muted);">To go</div>
      </div>
      ${todayCal ? `<div style="text-align:center;min-width:60px;">
        <div style="font-family:'Playfair Display',serif;font-size:1.4rem;color:#4A90D9;font-weight:700;">${todayCal}<span style="font-size:0.7rem;font-weight:400;"> cal</span></div>
        <div style="font-size:0.6rem;color:var(--muted);">Burned today</div>
      </div>` : ''}
      <div style="flex:1;display:flex;align-items:center;">${trendHTML}</div>
    </div>

    <!-- Progress bar: 105 → 90 -->
    <div style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;font-size:0.62rem;color:var(--muted);margin-bottom:4px;">
        <span>🏁 105 kg (start)</span>
        <span style="color:#4CAF7D;font-weight:700;">${pct}% complete</span>
        <span>🎯 90 kg (goal)</span>
      </div>
      <div style="height:10px;background:var(--dark4);border-radius:5px;overflow:hidden;position:relative;">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#4CAF7D,#80E0A0);border-radius:5px;transition:width .6s;"></div>
        ${pct > 5 ? `<div style="position:absolute;left:${Math.min(pct,92)}%;top:50%;transform:translate(-50%,-50%);font-size:0.55rem;color:#000;font-weight:700;">${pct}%</div>` : ''}
      </div>
      <div style="font-size:0.6rem;color:var(--muted);margin-top:3px;text-align:right;">${entries.length} weigh-ins logged</div>
    </div>`;
}

function renderWeightChart() {
  const canvas = document.getElementById('weightChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth * window.devicePixelRatio || 600;
  canvas.height = 180 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const W = canvas.offsetWidth, H = 180;

  const entries = Object.keys(weightState).sort().map(k => [k, _wGet(k)]).filter(e => e[1]);
  const statsEl = document.getElementById('weightStats');

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0D0D12';
  ctx.fillRect(0, 0, W, H);

  if (entries.length === 0) {
    ctx.fillStyle = '#706A60';
    ctx.font = '13px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Hali vazn kiritilmagan', W/2, H/2);
    if (statsEl) statsEl.innerHTML = '';
    return;
  }

  const TARGET = 90, START_W = 105;
  const allWeights = entries.map(e => e[1]);
  const minW = Math.min(...allWeights, TARGET) - 2;
  const maxW = Math.max(...allWeights, START_W) + 2;
  const pad = { l:40, r:16, t:16, b:28 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;

  const xOf = i => pad.l + (i / Math.max(entries.length - 1, 1)) * chartW;
  const yOf = v => pad.t + (1 - (v - minW) / (maxW - minW)) * chartH;

  // Grid lines
  [85, 90, 95, 100, 105].forEach(w => {
    if (w < minW || w > maxW) return;
    const y = yOf(w);
    ctx.strokeStyle = w === TARGET ? 'rgba(76,175,125,0.4)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = w === TARGET ? 1.5 : 1;
    ctx.setLineDash(w === TARGET ? [4,4] : []);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = w === TARGET ? '#4CAF7D' : '#555';
    ctx.font = '9px DM Sans, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(w + 'kg', pad.l - 4, y + 3);
  });

  // Target label
  ctx.fillStyle = '#4CAF7D';
  ctx.font = '9px DM Sans, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('🎯 Target', pad.l + 4, yOf(TARGET) - 4);

  // Weight line
  ctx.beginPath();
  entries.forEach(([,v], i) => {
    i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v));
  });
  ctx.strokeStyle = '#C9A84C';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Gradient fill under line
  const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
  grad.addColorStop(0, 'rgba(201,168,76,0.25)');
  grad.addColorStop(1, 'rgba(201,168,76,0)');
  ctx.beginPath();
  entries.forEach(([,v], i) => {
    i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v));
  });
  ctx.lineTo(xOf(entries.length-1), H - pad.b);
  ctx.lineTo(xOf(0), H - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Dots + date labels
  entries.forEach(([date, v], i) => {
    ctx.beginPath();
    ctx.arc(xOf(i), yOf(v), 4, 0, Math.PI*2);
    ctx.fillStyle = '#C9A84C';
    ctx.fill();
    if (i === 0 || i === entries.length - 1 || entries.length <= 6) {
      ctx.fillStyle = '#888';
      ctx.font = '8px DM Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(date.slice(5), xOf(i), H - pad.b + 12);
    }
  });

  // Stats
  if (statsEl) {
    const cur  = entries[entries.length-1][1];
    const lost = (entries[0][1] - cur).toFixed(1);
    const left = (cur - TARGET).toFixed(1);
    statsEl.innerHTML = `
      <div style="font-size:0.72rem;color:var(--muted)">Current: <b style="color:#C9A84C">${cur} kg</b></div>
      <div style="font-size:0.72rem;color:var(--muted)">Lost: <b style="color:#4CAF7D">${lost > 0 ? '-'+lost : lost} kg</b></div>
      <div style="font-size:0.72rem;color:var(--muted)">To target: <b style="color:#E07A30">${left} kg left</b></div>`;
  }
}

// ═══════════════════════════════════════════
// REFLECT SCORE LINE CHART
// ═══════════════════════════════════════════
function renderReflectChart() {
  const canvas = document.getElementById('reflectChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth * window.devicePixelRatio || 600;
  canvas.height = 160 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const W = canvas.offsetWidth, H = 160;

  const areas = [
    {id:'discipline', label:'Discipline', color:'#C9A84C'},
    {id:'deen',       label:'Deen',       color:'#E07A30'},
    {id:'health',     label:'Health',     color:'#4CAF7D'},
    {id:'business',   label:'Business',   color:'#40C0D0'},
    {id:'mindset',    label:'Mindset',    color:'#B464C8'},
  ];

  const weeks = Object.keys(reflectState).sort();
  const pad = {l:24, r:12, t:12, b:24};
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0D0D12';
  ctx.fillRect(0, 0, W, H);

  if (weeks.length < 2) {
    ctx.fillStyle = '#706A60';
    ctx.font = '12px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('2+ hafta ma\'lumoti kerak', W/2, H/2);
    return;
  }

  // Grid
  [2,4,6,8,10].forEach(v => {
    const y = pad.t + (1 - (v-1)/9) * chartH;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W-pad.r, y); ctx.stroke();
    ctx.fillStyle = '#444'; ctx.font = '8px DM Sans,sans-serif';
    ctx.textAlign = 'right'; ctx.fillText(v, pad.l-3, y+3);
  });

  const xOf = i => pad.l + (i / (weeks.length-1)) * chartW;
  const yOf = v => pad.t + (1 - (v-1)/9) * chartH;

  areas.forEach(area => {
    const scores = weeks.map(w => (reflectState[w]?.scores?.[area.id] || 0));
    if (scores.every(s => s === 0)) return;
    ctx.beginPath();
    scores.forEach((s, i) => { i===0 ? ctx.moveTo(xOf(i), yOf(s)) : ctx.lineTo(xOf(i), yOf(s)); });
    ctx.strokeStyle = area.color;
    ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    scores.forEach((s, i) => {
      if (s === 0) return;
      ctx.beginPath(); ctx.arc(xOf(i), yOf(s), 3, 0, Math.PI*2);
      ctx.fillStyle = area.color; ctx.fill();
    });
  });

  // Week labels
  weeks.forEach((w, i) => {
    if (i % Math.max(1, Math.floor(weeks.length/4)) === 0 || i === weeks.length-1) {
      ctx.fillStyle = '#555'; ctx.font = '8px DM Sans,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(w.slice(5), xOf(i), H - pad.b + 12);
    }
  });

  // Legend
  const legend = document.getElementById('reflectChartLegend');
  if (legend) {
    legend.innerHTML = areas.map(a =>
      `<span style="display:flex;align-items:center;gap:4px;color:#888">
        <span style="width:12px;height:2px;background:${a.color};display:inline-block;border-radius:2px;"></span>${a.label}
      </span>`).join('');
  }
}

// ═══════════════════════════════════════════
// BEST DAY + MONTHLY COMPARISON (Dashboard)
// ═══════════════════════════════════════════
function renderBestDay() {
  const el = document.getElementById('dashBestDay');
  if (!el) return;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const totals = [0,0,0,0,0,0,0], counts = [0,0,0,0,0,0,0];
  let d = new Date(START);
  while (d <= nowTashkent()) {
    const key = dateKey(d);
    const tasks = state[key] || {};
    const done = Object.values(tasks).filter(Boolean).length;
    const total = getTasksForDate(d).length;
    if (total > 0) { totals[d.getUTCDay()] += done/total; counts[d.getUTCDay()]++; }
    d = addDays(d, 1);
  }
  const avgs = totals.map((t,i) => counts[i] ? t/counts[i] : null);
  const best = avgs.reduce((bi,v,i) => v !== null && (avgs[bi] === null || v > avgs[bi]) ? i : bi, 0);
  const worst = avgs.reduce((wi,v,i) => v !== null && (avgs[wi] === null || v < avgs[wi]) ? i : wi, 0);

  el.innerHTML = `
    <div style="font-size:0.75rem;color:var(--muted);margin-bottom:8px;">Task completion by day of week:</div>
    ${days.map((day,i) => avgs[i] === null ? '' : `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <div style="width:28px;font-size:0.65rem;color:${i===best?'#4CAF7D':i===worst?'#D94A4A':'var(--muted)'};font-weight:${i===best||i===worst?700:400}">${day}</div>
        <div style="flex:1;height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${Math.round(avgs[i]*100)}%;background:${i===best?'#4CAF7D':i===worst?'#D94A4A':'#C9A84C44'};border-radius:3px;"></div>
        </div>
        <div style="font-size:0.65rem;color:var(--muted);min-width:26px;text-align:right;">${Math.round(avgs[i]*100)}%</div>
      </div>`).join('')}
    <div style="font-size:0.68rem;margin-top:6px;">
      <span style="color:#4CAF7D">✅ Best: ${days[best]}</span> &nbsp;
      <span style="color:#D94A4A">⚠️ Worst: ${days[worst]}</span>
    </div>`;
}

function renderMonthCompare() {
  const canvas = document.getElementById('monthCompareChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth * window.devicePixelRatio || 400;
  canvas.height = 100 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const W = canvas.offsetWidth, H = 100;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0D0D12'; ctx.fillRect(0, 0, W, H);

  const months = [5,6,7,8,9,10,11,12];
  const labels = ['May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = nowTashkent();
  const colors = ['#8B6914','#C9A84C','#E07A30','#4CAF7D','#4A90D9','#B464C8','#40C0D0','#FF6080'];

  // For each month: {pct, isFuture, isCurrent}
  const data = months.map(m => {
    const mStart = utcDate(2026, m-1, 1);
    const mEnd   = utcDate(2026, m, 0);
    const from   = new Date(Math.max(mStart, START));
    const isFuture  = mStart > now;
    const isCurrent = !isFuture && mEnd >= now;
    const to = isFuture ? mEnd : new Date(Math.min(mEnd, now));
    let done=0, total=0;
    if (!isFuture) {
      let d=new Date(from);
      while (d <= to) {
        const key=dateKey(d), tasks=getTasksForDate(d), st=state[key]||{};
        total += tasks.length;
        done  += tasks.filter(t=>st[t.id]).length;
        d = addDays(d,1);
      }
    }
    return { pct: total ? done/total : 0, isFuture, isCurrent };
  });

  const maxV = Math.max(...data.map(d=>d.isFuture?0:d.pct), 0.01);
  const barW = (W - 20) / months.length;

  data.forEach((d, i) => {
    const x  = 10 + i * barW + barW*0.15;
    const bw = barW * 0.7;
    const col = colors[i] || '#C9A84C';

    if (d.isFuture) {
      // Draw outline-only bar as "planned"
      ctx.strokeStyle = col+'44'; ctx.lineWidth = 1;
      const minH = 8;
      ctx.beginPath(); ctx.roundRect(x, H-22-minH, bw, minH, 2); ctx.stroke();
    } else {
      const bh = Math.max(3, (d.pct / maxV) * (H - 28));
      ctx.fillStyle = d.isCurrent ? col : col+'BB';
      ctx.beginPath(); ctx.roundRect(x, H-22-bh, bw, bh, 3); ctx.fill();
      ctx.fillStyle = d.isCurrent ? col : '#666';
      ctx.font = `bold 8px DM Sans,sans-serif`; ctx.textAlign='center';
      ctx.fillText(Math.round(d.pct*100)+'%', x+bw/2, H-24-bh);
    }
    ctx.fillStyle = d.isFuture ? '#333' : (d.isCurrent ? '#AAA' : '#666');
    ctx.font = '8px DM Sans,sans-serif'; ctx.textAlign='center';
    ctx.fillText(labels[i], x + bw/2, H-8);
  });
}

// ═══════════════════════════════════════════
// SWIPE NAVIGATION
// ═══════════════════════════════════════════
(function(){
  const TAB_ORDER = ['dash','daily','weekly','monthly','tracker','vision',
                     'diet','money','prayer','workout','reflect','youtube'];
  let touchX = 0, touchY = 0;
  document.addEventListener('touchstart', e => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, {passive:true});
  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.8) return;
    const active = document.querySelector('.ntab[data-sec].active');
    if (!active) return;
    const tabs = Array.from(document.querySelectorAll('.ntab[data-sec]'));
    const idx  = tabs.indexOf(active);
    const next = dx < 0 ? Math.min(idx+1, tabs.length-1) : Math.max(idx-1, 0);
    if (next !== idx) tabs[next].click();
  }, {passive:true});
})();

// ═══════════════════════════════════════════
// WIRE WEIGHT + AI PLAN INTO FIREBASE
// ═══════════════════════════════════════════
// scheduleSave: sync weightState to window global before any save
// _onFirebaseLoaded: runs on every Firestore snapshot (initial + remote updates)
const _origLoaded = window._onFirebaseLoaded;
window._onFirebaseLoaded = function(loadInfo = {}) {
  weightState   = window._weightState   || {};
  aiPlanState   = window._aiPlanState   || null;
  roadmapState  = window._roadmapState  || {};
  studyPlan     = window._studyPlan     || null;
  customTasks   = window._customTasks   || {};
  if (_origLoaded) _origLoaded(loadInfo);
  renderSafely('weight chart', renderWeightChart);
  renderSafely('weight summary', renderDashWeightCard);
  renderSafely('best day', renderBestDay);
  renderSafely('month comparison', renderMonthCompare);
  renderSafely('reflection chart', renderReflectChart);
  // Restore AI plan UI if a saved plan exists
  if (aiPlanState) {
    document.getElementById('planDisplay').style.display  = 'block';
    document.getElementById('planEmpty').style.display    = 'none';
    document.getElementById('planClearBtn').style.display = 'inline-flex';
    document.getElementById('planSubtitle').textContent   = `Last generated: ${aiPlanState.generatedAt || 'saved'} · Tasks auto-populated into Daily view`;
    renderSafely('AI plan', renderAIPlan);
    renderAll();
  }
  // Restore study plan UI if a saved study plan exists
  if (studyPlan && typeof renderStudyPlan === 'function') {
    document.getElementById('studyPlanDisplay').style.display = 'block';
    document.getElementById('studyInputArea').style.display   = 'none';
    document.getElementById('studyClearBtn').style.display    = 'inline-block';
    renderSafely('study plan', renderStudyPlan);
  }
};


// ═══════════════════════════════════════════
// AI PLAN STATE + LOGIC
// ═══════════════════════════════════════════
let aiPlanState = null; // full plan object from AI

function togglePlanForm() {
  const form = document.getElementById('planForm');
  const empty = document.getElementById('planEmpty');
  const disp  = document.getElementById('planDisplay');
  const isOpen = form.style.display !== 'none';
  form.style.display  = isOpen ? 'none' : 'block';
  if (!aiPlanState) { empty.style.display = isOpen ? 'block' : 'none'; disp.style.display='none'; }
  document.getElementById('planGenBtn').textContent = isOpen ? '✨ Generate My Plan' : '✕ Cancel';
}

// Compute real progress snapshot from current state for sending to AI
function _buildProgressSnapshot() {
  const today = tashMidnight();
  let donePts=0, totalPts=0;
  let d=new Date(START);
  while(d<=today && d<=END){
    const key=dateKey(d);
    getTasksForDate(d).forEach(t=>{
      totalPts+=t.pts||1;
      if(getTask(key,t.id)) donePts+=t.pts||1;
    });
    d=addDays(d,1);
  }
  const completionRate = totalPts ? Math.round(donePts/totalPts*100) : 0;

  // Prayer streak
  let pStreak=0, pd=new Date(today);
  while(pd>=START){
    const pk=dateKey(pd);
    const pp=prayerState[pk]||{};
    const names=['fajr','zuhr','asr','maghrib','isha'];
    if(names.every(n=>pp[n]&&pp[n]!=='missed')) pStreak++;
    else break;
    pd=addDays(pd,-1);
  }

  // Diet compliance
  let dietDays=0, dietGood=0;
  let dd=new Date(START);
  while(dd<=today&&dd<=END){
    const s=dietDayScore(dateKey(dd));
    if(s>0){dietDays++;if(s===4)dietGood++;}
    dd=addDays(dd,1);
  }
  const dietRate=dietDays?Math.round(dietGood/dietDays*100):0;

  // Weight
  const weightEntries=Object.keys(weightState||{}).sort();
  const latestWeight=weightEntries.length?_wGet(weightEntries[weightEntries.length-1]):null;

  // YouTube
  const ytUploaded=Object.values(ytState||{}).filter(v=>v==='uploaded').length;

  // Savings (sum of all savings entries)
  const totalSaved=Object.values(savingsState||{}).reduce((s,v)=>{
    if(Array.isArray(v)) return s+v.reduce((a,e)=>a+(e.amount||0),0);
    return s+(v.saved||v.amount||0);
  },0);

  return { completionRate, prayerStreak:pStreak, dietCompliance:dietRate,
           currentWeight:latestWeight, ytUploaded, savedAmount:totalSaved };
}

window.getPlannerCoachContext = function getPlannerCoachContext() {
  const today = todayUTC();
  const todayKey = tashKey();
  const tasks = getTasksForDate(today);
  const completed = tasks.filter(task => getTask(todayKey, task.id));
  return {
    ..._buildProgressSnapshot(),
    date: todayKey,
    tasksCompletedToday: completed.length,
    tasksTotalToday: tasks.length,
    pendingTasksToday: tasks.filter(task => !getTask(todayKey, task.id)).slice(0, 8).map(task => task.text),
  };
};

async function generatePlan() {
  const goals     = document.getElementById('planGoals').value.trim();
  const situation = document.getElementById('planSituation').value.trim();
  const vision    = document.getElementById('planVision').value.trim();
  if (!goals) { alert('Please fill in your goals.'); return; }

  document.getElementById('planForm').style.display    = 'none';
  document.getElementById('planEmpty').style.display   = 'none';
  document.getElementById('planDisplay').style.display = 'none';
  document.getElementById('planLoading').style.display = 'block';
  document.getElementById('planGenBtn').textContent    = '✨ Generate My Plan';

  const msgs = ['Reading your progress data…','Building 10-year vision…','Planning Summer quarter tasks…','Crafting weekly schedules…','Finalising your personal roadmap…'];
  let mi = 0;
  const msgEl = document.getElementById('planLoadingMsg');
  const ticker = setInterval(() => { if (mi < msgs.length-1) msgEl.textContent = msgs[++mi]; }, 8000);

  // Rule 2: read real progress before generating so AI knows where you actually are
  const progress = _buildProgressSnapshot();

  try {
    const data = await window.apiRequest('/generate-plan', {
      method: 'POST',
      body: JSON.stringify({
        goals, situation, vision,
        startDate: tashKey(),
        progress  // real data: completion %, prayer streak, weight, etc.
      })
    });
    aiPlanState = data.plan;
    window._aiPlanState = aiPlanState;
    scheduleSave();
    clearInterval(ticker);
    document.getElementById('planLoading').style.display  = 'none';
    document.getElementById('planDisplay').style.display  = 'block';
    document.getElementById('planClearBtn').style.display = 'inline-flex';
    document.getElementById('planSubtitle').textContent   = `Last generated: ${aiPlanState.generatedAt} · Tasks auto-populated into Daily view`;
    renderAIPlan();
    renderAll(); // refresh daily view with new tasks
  } catch(e) {
    clearInterval(ticker);
    document.getElementById('planLoading').style.display = 'none';
    document.getElementById('planEmpty').style.display   = 'block';
    alert('❌ Error generating plan: ' + e.message + '\n\nMake sure your Render bot server is running.');
  }
}

function clearAIPlan() {
  if (!confirm('Clear the AI-generated plan? Daily tasks will revert to defaults.')) return;
  aiPlanState = null;
  window._aiPlanState = null;
  scheduleSave();
  document.getElementById('planDisplay').style.display  = 'none';
  document.getElementById('planEmpty').style.display    = 'block';
  document.getElementById('planClearBtn').style.display = 'none';
  document.getElementById('planSubtitle').textContent   = 'Generate your complete 2026 plan — from 10-year vision down to daily tasks.';
  renderAll();
}

function getAITasksForDate(date) {
  if (!aiPlanState || !aiPlanState.quarters) return null;
  // Rule: past is sacred — never overwrite real past completion data with AI tasks
  const today = tashMidnight();
  if (date < today) return null;
  const dateStr = dateKey(date);
  const dow = date.getUTCDay(); // 0=Sun, 6=Sat
  for (const quarter of aiPlanState.quarters) {
    for (const month of (quarter.months || [])) {
      for (const week of (month.weeks || [])) {
        if (!week.startDate || !week.tasks) continue;
        const wStart = new Date(week.startDate);
        const wEnd   = new Date(wStart); wEnd.setUTCDate(wEnd.getUTCDate() + 6);
        const d      = new Date(dateStr);
        if (d >= wStart && d <= wEnd) {
          if (dow === 6) return week.tasks.saturday || null;
          if (dow === 0) return week.tasks.sunday   || null;
          return week.tasks.weekday || null;
        }
      }
    }
  }
  return null;
}

function getAIWeekInfo(date) {
  if (!aiPlanState || !aiPlanState.quarters) return null;
  const _t = tashMidnight();
  if (date < _t) return null; // no banner on past days
  const dateStr = dateKey(date);
  for (const quarter of aiPlanState.quarters) {
    for (const month of (quarter.months || [])) {
      for (const week of (month.weeks || [])) {
        if (!week.startDate) continue;
        const wStart = new Date(week.startDate);
        const wEnd   = new Date(wStart); wEnd.setUTCDate(wEnd.getUTCDate() + 6);
        if (new Date(dateStr) >= wStart && new Date(dateStr) <= wEnd) return week;
      }
    }
  }
  return null;
}

function renderAIPlan() {
  if (!aiPlanState) return;
  const v = aiPlanState.vision || {};

  // Vision
  document.getElementById('planVisionDisplay').innerHTML = `
    <div style="font-size:0.9rem;color:var(--text);line-height:1.6;margin-bottom:12px;">"${v.tenYear || ''}"</div>
    <div style="font-size:0.78rem;color:var(--muted);margin-bottom:10px;">2026: ${v.oneYear || ''}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${(v.values||[]).map(val => `<span style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.2);color:var(--gold);padding:3px 10px;border-radius:20px;font-size:0.68rem;">${val}</span>`).join('')}
    </div>
    ${Object.keys(v.milestones||{}).length ? `<div style="margin-top:12px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
      ${Object.entries(v.milestones).map(([yr,ms])=>`<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(201,168,76,0.08);border-radius:8px;padding:8px 10px;">
        <div style="font-size:0.65rem;color:var(--gold);font-weight:700;">${yr}</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">${ms}</div>
      </div>`).join('')}
    </div>` : ''}`;

  // Quarters
  const QCOLORS = { summer:'#C9A84C', school:'#4A90D9', final:'#4CAF7D' };
  document.getElementById('planQuarters').innerHTML = (aiPlanState.quarters||[]).map(q => {
    const qc = QCOLORS[q.id] || '#C9A84C';
    const months = (q.months||[]).map(m => {
      const weeks = (m.weeks||[]).map(w => {
        // Always use SURAH_SCHEDULE as source of truth for the surah label
        const _ws = w.startDate ? [...SURAH_SCHEDULE].reverse().find(s => w.startDate >= s.week) : null;
        const _wSurah = (_ws && w.startDate < '2026-09-01') ? _ws.surah : (w.quranSurah || null);
        return `
        <div style="padding:8px 12px;border-left:2px solid rgba(201,168,76,0.15);margin-left:12px;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="toggleWeekDetail('${w.startDate}')">
            <div style="font-size:0.68rem;color:var(--gold);min-width:50px;">${w.startDate?w.startDate.slice(5):''}</div>
            <div style="font-size:0.75rem;color:var(--text);flex:1;"><b>Week ${w.num}</b> — ${w.theme}</div>
            ${_wSurah ? `<div style="font-size:0.62rem;background:rgba(201,168,76,0.1);color:var(--gold);padding:2px 7px;border-radius:10px;">📖 ${_wSurah}</div>` : ''}
            <div style="font-size:0.65rem;color:var(--muted);">▼</div>
          </div>
          <div id="week-${w.startDate}" style="display:none;margin-top:8px;">
            <div style="font-size:0.72rem;color:var(--muted);margin-bottom:8px;font-style:italic;">${w.weekFocus||''}</div>
            ${['weekday','saturday','sunday'].map(type => {
              const tasks = (w.tasks||{})[type]||[];
              return tasks.length ? `<div style="margin-bottom:6px;">
                <div style="font-size:0.62rem;color:var(--gold);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${type==='weekday'?'Mon–Fri':type==='saturday'?'Saturday':'Sunday'}</div>
                ${tasks.map(t=>`<div style="display:flex;gap:6px;align-items:flex-start;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.03);">
                  <div style="font-size:0.62rem;color:var(--muted);min-width:36px;">${t.time}</div>
                  <div style="width:6px;height:6px;border-radius:50%;background:${getCategoryMeta(t.cat).color};flex-shrink:0;margin-top:3px;"></div>
                  <div style="font-size:0.73rem;color:var(--text);">${escapeHTML(t.text)}</div>
                </div>`).join('')}
              </div>` : '';
            }).join('')}
          </div>
        </div>`;}).join('');

      return `<div style="margin-bottom:12px;">
        <div style="font-size:0.72rem;font-weight:700;color:var(--text);margin-bottom:6px;padding:6px 10px;background:rgba(255,255,255,0.03);border-radius:8px;display:flex;align-items:center;gap:8px;">
          <span style="color:${qc};">●</span> ${m.name} — ${m.focus||''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;padding-left:10px;">
          ${(m.goals||[]).map(g=>`<div style="font-size:0.68rem;color:var(--muted);background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px;">✓ ${g}</div>`).join('')}
        </div>
        ${weeks}
      </div>`;
    }).join('');

    return `<div class="task-card" style="margin-bottom:16px;border-color:${qc}33;">
      <div class="task-card-hdr" style="color:${qc};">${q.name} <span style="font-weight:400;font-size:0.7rem;color:var(--muted);">${q.period}</span></div>
      <div style="font-size:0.82rem;color:var(--text);margin:8px 0 4px;font-style:italic;">"${q.theme}"</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        ${(q.goals||[]).map(g=>`<div style="font-size:0.7rem;color:${qc};background:${qc}15;border:1px solid ${qc}33;padding:3px 10px;border-radius:12px;">→ ${g}</div>`).join('')}
      </div>
      ${months}
    </div>`;
  }).join('');

  document.getElementById('planClearBtn').style.display = 'inline-flex';
}

function toggleWeekDetail(startDate) {
  const el = document.getElementById('week-' + startDate);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ═══════════════════════════════════════════
// 10-YEAR ROADMAP
// ═══════════════════════════════════════════
const ROADMAP_DATA = [
  { year: 2026, color: '#C9A84C', milestones: [
    { id:'rm-2026-yt',    icon:'🎬', text:'YouTube FK series launched',   sub:'Jun 2026',  cat:'content'   },
    { id:'rm-2026-law',   icon:'📚', text:'Law school started',           sub:'Sep 2026',  cat:'education' },
    { id:'rm-2026-gym',   icon:'💪', text:'Reached 90 kg (from 105)',     sub:'Aug 2026',  cat:'health'    },
    { id:'rm-2026-fin',   icon:'📈', text:'First brokerage trade placed', sub:'Q3 2026',   cat:'finance'   },
    { id:'rm-2026-save',  icon:'💰', text:'10M so\'m saved',              sub:'Dec 2026',  cat:'finance'   },
  ]},
  { year: 2027, color: '#4A90D9', milestones: [
    { id:'rm-2027-nik',   icon:'💍', text:'Nikah (InshaAllah)',           sub:'InshaAllah',cat:'life'      },
    { id:'rm-2027-uzum',  icon:'🛒', text:'Uzum seller registered',      sub:'Q1 2027',   cat:'business'  },
    { id:'rm-2027-law2',  icon:'⚖️', text:'2nd year law complete',        sub:'Jun 2027',  cat:'education' },
    { id:'rm-2027-yt2',   icon:'🎥', text:'YouTube 5,000 subscribers',   sub:'2027',       cat:'content'   },
  ]},
  { year: 2028, color: '#4CAF7D', milestones: [
    { id:'rm-2028-biz',   icon:'🏢', text:'Own business registered',     sub:'2028',       cat:'business'  },
    { id:'rm-2028-law3',  icon:'📜', text:'Law degree complete',          sub:'Jun 2028',  cat:'education' },
    { id:'rm-2028-hajj',  icon:'🕋', text:'Hajj (InshaAllah)',           sub:'2028',       cat:'deen'      },
    { id:'rm-2028-car',   icon:'🚗', text:'Own car (no debt)',           sub:'2028',       cat:'finance'   },
  ]},
  { year: 2029, color: '#E07A30', milestones: [
    { id:'rm-2029-china', icon:'🌏', text:'China import business live',  sub:'2029',       cat:'business'  },
    { id:'rm-2029-yt3',   icon:'▶️', text:'YouTube 50,000 subscribers',  sub:'2029',       cat:'content'   },
    { id:'rm-2029-prop',  icon:'🏠', text:'Property investment start',   sub:'2029',       cat:'finance'   },
  ]},
  { year: 2030, color: '#B464C8', milestones: [
    { id:'rm-2030-mil',   icon:'💎', text:'1 million so\'m net worth',    sub:'2030',       cat:'finance'   },
    { id:'rm-2030-masjid',icon:'🕌', text:'Masjid donation project',     sub:'2030',       cat:'deen'      },
    { id:'rm-2030-biz2',  icon:'📊', text:'Business turns profitable',   sub:'2030',       cat:'business'  },
  ]},
  { year: 2031, color: '#40C0D0', milestones: [
    { id:'rm-2031-inv',   icon:'📈', text:'Investment portfolio $50K',   sub:'2031',       cat:'finance'   },
    { id:'rm-2031-team',  icon:'👥', text:'First employee hired',        sub:'2031',       cat:'business'  },
  ]},
  { year: 2032, color: '#FF6080', milestones: [
    { id:'rm-2032-apt',   icon:'🏡', text:'First apartment purchased',   sub:'2032',       cat:'life'      },
    { id:'rm-2032-yt4',   icon:'🎯', text:'YouTube 200K subscribers',   sub:'2032',       cat:'content'   },
  ]},
  { year: 2035, color: '#C9A84C', milestones: [
    { id:'rm-2035-free',  icon:'🦅', text:'Financially free',            sub:'2035 goal',  cat:'finance'   },
    { id:'rm-2035-law4',  icon:'⚖️', text:'Lawyer / law practice',       sub:'2035',       cat:'education' },
    { id:'rm-2035-yt5',   icon:'🚀', text:'YouTube 1M subscribers',      sub:'2035',       cat:'content'   },
    { id:'rm-2035-haj2',  icon:'🕋', text:'2nd Hajj with family',        sub:'2035',       cat:'deen'      },
  ]},
];

let roadmapState = {}; // { 'rm-id': true }

function toggleRoadmapMilestone(id) {
  roadmapState[id] = !roadmapState[id];
  window._roadmapState = roadmapState;
  scheduleSave();
  renderRoadmap();
}

function renderRoadmap() {
  const el = document.getElementById('roadmapTimeline');
  if (!el) return;

  const doneCount = Object.values(roadmapState).filter(Boolean).length;
  const totalCount = ROADMAP_DATA.reduce((s,y)=>s+y.milestones.length,0);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:10px 14px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.15);border-radius:10px;">
      <div style="font-size:0.75rem;color:var(--muted);flex:1;">Life milestones completed</div>
      <div style="font-size:1rem;font-weight:700;color:var(--gold);">${doneCount} / ${totalCount}</div>
    </div>
    ${ROADMAP_DATA.map(yr => {
      const done = yr.milestones.filter(m => roadmapState[m.id]).length;
      const allDone = done === yr.milestones.length;
      return `
      <div style="margin-bottom:20px;">
        <!-- Year header with line -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="width:44px;height:44px;border-radius:50%;border:2px solid ${allDone?yr.color:yr.color+'44'};background:${allDone?yr.color+'22':'transparent'};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:0.85rem;font-weight:700;color:${allDone?yr.color:yr.color+'88'};flex-shrink:0;">${yr.year}</div>
          <div style="flex:1;height:1px;background:${allDone?yr.color+'55':yr.color+'18'};"></div>
          <div style="font-size:0.65rem;color:${allDone?yr.color:'var(--muted)'};">${done}/${yr.milestones.length}</div>
        </div>
        <!-- Milestones -->
        <div style="padding-left:22px;border-left:2px solid ${yr.color+'22'};">
          ${yr.milestones.map(m => {
            const isDone = !!roadmapState[m.id];
            return `<div onclick="toggleRoadmapMilestone('${m.id}')" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;margin-bottom:5px;background:${isDone?yr.color+'12':'rgba(255,255,255,0.015)'};border:1px solid ${isDone?yr.color+'33':'rgba(255,255,255,0.05)'};cursor:pointer;transition:all .2s;">
              <div style="font-size:1rem;flex-shrink:0;">${m.icon}</div>
              <div style="flex:1;">
                <div style="font-size:0.8rem;font-weight:${isDone?'600':'400'};color:${isDone?yr.color:'var(--text)'};${isDone?'':'opacity:0.85'}">${m.text}</div>
                <div style="font-size:0.62rem;color:var(--muted);margin-top:1px;">${m.sub} · ${m.cat}</div>
              </div>
              <div style="width:20px;height:20px;border-radius:50%;border:2px solid ${isDone?yr.color:yr.color+'44'};background:${isDone?yr.color:'transparent'};display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:${isDone?'#000':'transparent'};flex-shrink:0;transition:all .2s;">✓</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}`;
}

// ═══════════════════════════════════════════
// QURAN SURAH SCHEDULE
// ═══════════════════════════════════════════
// An-Nas (114), Al-Falaq (113), Al-Ikhlas (112) already memorised — start from Al-Masad (111)
const SURAH_SCHEDULE = [
  { week:'2026-06-01', surah:'Al-Masad (111)',     ayahs:5  },
  { week:'2026-06-08', surah:'An-Nasr (110)',      ayahs:3  },
  { week:'2026-06-15', surah:'Al-Kafirun (109)',   ayahs:6  },
  { week:'2026-06-22', surah:'Al-Kawthar (108)',   ayahs:3  },
  { week:'2026-06-29', surah:"Al-Ma'un (107)",     ayahs:7  },
  { week:'2026-07-06', surah:'Quraysh (106)',      ayahs:4  },
  { week:'2026-07-13', surah:'Al-Fil (105)',       ayahs:5  },
  { week:'2026-07-20', surah:'Al-Humazah (104)',   ayahs:9  },
  { week:'2026-07-27', surah:"Al-'Asr (103)",      ayahs:3  },
  { week:'2026-08-03', surah:'At-Takathur (102)',  ayahs:8  },
  { week:'2026-08-10', surah:"Al-Qari'ah (101)",   ayahs:11 },
  { week:'2026-08-17', surah:"Al-'Adiyat (100)",   ayahs:11 },
  { week:'2026-08-24', surah:'Al-Zalzalah (99)',   ayahs:8  },
  { week:'2026-08-31', surah:'Al-Bayyinah (98)',   ayahs:8  },
];

function renderSurahSchedule() {
  const el = document.getElementById('surahSchedule');
  if (!el) return;
  const today = nowTashkent();
  const todayKey = dateKey(today);

  // Find current week's surah
  let currentIdx = -1;
  for (let i = SURAH_SCHEDULE.length - 1; i >= 0; i--) {
    if (todayKey >= SURAH_SCHEDULE[i].week) { currentIdx = i; break; }
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:auto 1fr auto;gap:6px 12px;align-items:center;font-size:0.75rem;">
      ${SURAH_SCHEDULE.map((s, i) => {
        const isPast    = todayKey > s.week && i !== currentIdx;
        const isCurrent = i === currentIdx;
        const isFuture  = todayKey < s.week;
        const icon = isPast ? '✅' : isCurrent ? '📖' : '⬜';
        const dateLabel = s.week.slice(5).replace('-', '/');
        return `
          <div style="color:${isCurrent?'#C9A84C':isPast?'#4CAF7D':'#444'};font-weight:${isCurrent?700:400};">${icon}</div>
          <div style="color:${isCurrent?'#EDE8E0':isPast?'#706A60':'#555'};font-weight:${isCurrent?600:400};
            ${isCurrent?'background:rgba(201,168,76,0.08);padding:3px 8px;border-radius:6px;margin:-3px 0;':''}">
            ${s.surah}${isCurrent?' <span style="color:#C9A84C;font-size:0.65rem;">← THIS WEEK</span>':''}
          </div>
          <div style="color:${isCurrent?'#C9A84C':isPast?'#555':'#3a3a3a'};font-size:0.65rem;white-space:nowrap;">${dateLabel} · ${s.ayahs}v</div>`;
      }).join('')}
    </div>
    ${currentIdx >= 0 ? `<div style="margin-top:12px;padding:10px 12px;background:rgba(201,168,76,0.07);border:1px solid rgba(201,168,76,0.2);border-radius:10px;font-size:0.78rem;color:#C9A84C;">
      📖 This week: <b>${SURAH_SCHEDULE[currentIdx].surah}</b> — ${SURAH_SCHEDULE[currentIdx].ayahs} ayahs
      &nbsp;·&nbsp; Week ${currentIdx+1} of ${SURAH_SCHEDULE.length}
    </div>` : ''}`;
}

// ═══════════════════════════════════════════════════════════════════
// MONTHLY STUDY PLAN
// ═══════════════════════════════════════════════════════════════════
let studyPlan = null; // { month, monthSkill, sessions:[{date,sessionTitle,weekSkill,estimatedMinutes,items:[{title,url}]}] }

// Pre-fill the start date input with today (Tashkent)
(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const inp = document.getElementById('studyStartDate');
    if (inp) inp.value = tashKey();
  });
})();

async function planStudies() {
  const raw = document.getElementById('studyRawText').value.trim();
  if (!raw) { alert('Please paste your video list first.'); return; }
  const startDate = document.getElementById('studyStartDate').value || tashKey();

  // Collect questionnaire answers
  const skipDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .filter(d => document.getElementById('skipDay'+d)?.checked);
  const context = {
    goal:         document.getElementById('studyGoal')?.value.trim() || '',
    sessionMins:  parseInt(document.getElementById('studySessionLen')?.value || '90'),
    skipDays,
    timeBlock:    (document.getElementById('studyTimeFrom')?.value||'11:00') + '–' + (document.getElementById('studyTimeTo')?.value||'13:00'),
    dailyContext: document.getElementById('studyDailyContext')?.value.trim() || '',
    pace:         document.getElementById('studyPace')?.value || 'normal',
  };

  document.getElementById('studyInputArea').style.display  = 'none';
  document.getElementById('studyPlanDisplay').style.display = 'none';
  document.getElementById('studyLoading').style.display    = 'block';

  const msgs = ['Reading your context…', 'Parsing topics…', 'Assigning to your schedule…', 'Building calendar…'];
  let mi = 0;
  const msgEl = document.getElementById('studyLoadingMsg');
  const ticker = setInterval(() => { if (mi < msgs.length-1) msgEl.textContent = msgs[++mi]; }, 5000);

  try {
    const data = await window.apiRequest('/plan-studies', {
      method: 'POST',
      body: JSON.stringify({
        rawText: raw,
        startDate,
        month: startDate.slice(0,7),
        context
      })
    });

    clearInterval(ticker);
    studyPlan = data.plan;
    window._studyPlan = studyPlan;
    scheduleSave();

    document.getElementById('studyLoading').style.display     = 'none';
    document.getElementById('studyInputArea').style.display   = 'none';
    document.getElementById('studyPlanDisplay').style.display = 'block';
    document.getElementById('studyClearBtn').style.display    = 'inline-block';
    renderStudyPlan();
    renderAll(); // refresh daily view with new study tasks
  } catch(e) {
    clearInterval(ticker);
    document.getElementById('studyLoading').style.display   = 'none';
    document.getElementById('studyInputArea').style.display = 'block';
    alert('❌ Error: ' + e.message + '\n\nMake sure Render bot is running.');
  }
}

function clearStudyPlan() {
  if (!confirm('Clear the study plan? Study tasks will be removed from daily view.')) return;
  studyPlan = null;
  window._studyPlan = null;
  scheduleSave();
  document.getElementById('studyPlanDisplay').style.display = 'none';
  document.getElementById('studyInputArea').style.display   = 'block';
  document.getElementById('studyClearBtn').style.display    = 'none';
  document.getElementById('studyPlanMonthLabel').textContent = '';
  document.getElementById('studyRawText').value = '';
  renderAll();
}

function getStudySessionForDate(date) {
  if (!studyPlan || !studyPlan.sessions) return null;
  const dk = dateKey(date);
  return studyPlan.sessions.find(s => s.date === dk) || null;
}

function renderStudyPlan() {
  const el = document.getElementById('studyPlanDisplay');
  if (!el || !studyPlan) return;

  document.getElementById('studyPlanMonthLabel').textContent =
    studyPlan.monthSkill ? '📊 ' + studyPlan.monthSkill : '';

  const today = tashKey();

  // Group sessions by week (Mon–Sat)
  const weekMap = {};
  studyPlan.sessions.forEach(s => {
    const d = new Date(s.date);
    // Get Monday of this week
    const dow = d.getUTCDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() + diff);
    const wk = mon.toISOString().split('T')[0];
    if (!weekMap[wk]) weekMap[wk] = { mon, skill: s.weekSkill, sessions: [] };
    weekMap[wk].sessions.push(s);
  });

  const done  = studyPlan.sessions.filter(s => s.date < today).length;
  const total = studyPlan.sessions.length;

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:8px 12px;background:rgba(74,144,217,0.06);border:1px solid rgba(74,144,217,0.15);border-radius:8px;">
      <div style="font-size:0.72rem;color:var(--muted);flex:1;">${total} study sessions planned</div>
      <div style="font-size:0.85rem;font-weight:700;color:#4A90D9;">${done}/${total} done</div>
    </div>
    ${Object.entries(weekMap).map(([wk, wdata]) => {
      const monLabel = new Date(wdata.mon);
      return `
      <div style="margin-bottom:14px;">
        <div style="font-size:0.68rem;font-weight:700;color:#4A90D9;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
          <span>Week of ${MONTHS_SHORT[monLabel.getUTCMonth()+1]} ${monLabel.getUTCDate()}</span>
          <span style="background:rgba(74,144,217,0.1);border:1px solid rgba(74,144,217,0.2);padding:2px 8px;border-radius:10px;font-weight:600;font-size:0.62rem;text-transform:none;letter-spacing:0;">${wdata.skill}</span>
        </div>
        ${wdata.sessions.map(s => {
          const isPast = s.date < today;
          const isToday = s.date === today;
          const mins = s.estimatedMinutes || 90;
          return `
          <div style="padding:8px 12px;border-radius:8px;margin-bottom:5px;
            background:${isToday ? 'rgba(74,144,217,0.1)' : isPast ? 'rgba(76,175,125,0.05)' : 'rgba(255,255,255,0.02)'};
            border:1px solid ${isToday ? 'rgba(74,144,217,0.4)' : isPast ? 'rgba(76,175,125,0.2)' : 'rgba(255,255,255,0.05)'};">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <div style="font-size:0.62rem;color:${isToday?'#4A90D9':isPast?'var(--green)':'var(--muted)'};font-weight:700;min-width:40px;">${s.date.slice(5)}</div>
              <div style="font-size:0.76rem;color:var(--text);flex:1;font-weight:${isToday?'600':'400'}">${s.sessionTitle}</div>
              <div style="font-size:0.6rem;color:var(--muted);white-space:nowrap;">${isPast?'✅':isToday?'▶ Today':''}${mins>0?' · '+mins+'m':''}</div>
            </div>
            <div style="padding-left:48px;">
              ${s.items.map(item => `
              <div style="display:flex;align-items:center;gap:6px;padding:2px 0;">
                <div style="width:4px;height:4px;border-radius:50%;background:#4A90D9;flex-shrink:0;"></div>
                <div style="font-size:0.68rem;color:var(--muted);flex:1;">${item.title}</div>
                ${item.url ? `<a href="${item.url}" target="_blank" style="font-size:0.6rem;color:#4A90D9;text-decoration:none;white-space:nowrap;flex-shrink:0;">▶ Watch</a>` : ''}
              </div>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
    <button onclick="document.getElementById('studyInputArea').style.display='block';document.getElementById('studyPlanDisplay').style.display='none';"
      style="width:100%;padding:8px;background:rgba(74,144,217,0.08);border:1px solid rgba(74,144,217,0.2);border-radius:8px;color:#4A90D9;font-size:0.72rem;cursor:pointer;margin-top:4px;">
      + Add more topics
    </button>`;
}

// Inject study task into getTasksForDate result
// Called after the base tasks are determined
function mergeStudyTask(date, baseTasks) {
  const session = getStudySessionForDate(date);
  if (!session) return baseTasks;
  const firstUrl = session.items.find(i => i.url)?.url || null;
  const studyTask = {
    id:   'study',
    cat:  'finance',
    text: `📚 Study: ${session.sessionTitle}`,
    time: session.time || '11:00',
    pts:  3,
    url:  firstUrl,
    studyItems: session.items
  };
  // Replace any existing 'study' task, otherwise add after brokerage slot
  const filtered = baseTasks.filter(t => t.id !== 'study');
  // Insert after 'br' (brokerage) task if present, else append
  const brIdx = filtered.findIndex(t => t.id === 'br');
  if (brIdx >= 0) {
    filtered.splice(brIdx + 1, 0, studyTask);
    return filtered;
  }
  return [...filtered, studyTask];
}

// ═══════════════════════════════════════════════════════════════════
// DAY EDITOR — edit/add/remove tasks per day, week, or month
// Past dates are locked. Changes saved to Firebase customTasks field.
// ═══════════════════════════════════════════════════════════════════
let customTasks = {}; // { 'YYYY-MM-DD': [{id,cat,text,time,pts,url}] }
let _editorTasks = []; // working copy while editor is open

function _isLocked(date) {
  // Past dates (before today midnight Tashkent) are always locked
  return new Date(dateKey(date)) < new Date(tashKey());
}

// Override getTasksForDate to check customTasks first
const _origGetTasksForDate = getTasksForDate;
window.getTasksForDate = getTasksForDate; // keep reference
// Patch: inject customTasks lookup at the top
(function() {
  const _orig = getTasksForDate;
  getTasksForDate = function(date) {
    const dk = dateKey(date);
    if (customTasks[dk] && customTasks[dk].length > 0) {
      return (typeof mergeStudyTask === 'function') ? mergeStudyTask(date, customTasks[dk]) : customTasks[dk];
    }
    return _orig(date);
  };
})();

function openDayEditor() {
  const d = curDate;
  if (_isLocked(d)) {
    // Past — show read-only view with lock message
    document.getElementById('editorDateLabel').textContent =
      DAYS_FULL[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS_SHORT[d.getUTCMonth()+1] + ' · 🔒 Locked (past date)';
    _editorTasks = getTasksForDate(d).map(t => ({...t}));
    _renderEditorList(true);
    document.querySelectorAll('[name="editScope"]').forEach(r => r.disabled = true);
    document.getElementById('dayEditor').style.display = 'block';
    return;
  }
  document.getElementById('editorDateLabel').textContent =
    DAYS_FULL[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS_SHORT[d.getUTCMonth()+1] + ' — tap a task to remove it';
  _editorTasks = getTasksForDate(d).map(t => ({...t})); // clone
  document.querySelectorAll('[name="editScope"]').forEach(r => r.disabled = false);
  _renderEditorList(false);
  document.getElementById('editorStatus').textContent = '';
  document.getElementById('dayEditor').style.display = 'block';
}

function closeDayEditor() {
  document.getElementById('dayEditor').style.display = 'none';
}

function _renderEditorList(locked) {
  const CATS_LOCAL = typeof CATS !== 'undefined' ? CATS : {};
  document.getElementById('editorTaskList').innerHTML = _editorTasks.map((t,i) => {
    const c = CATS_LOCAL[t.cat] || {color:'#888'};
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;margin-bottom:5px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);">
      <div style="width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0;"></div>
      <div style="font-size:0.65rem;color:var(--muted);min-width:38px;">${t.time||''}</div>
      <div style="flex:1;font-size:0.78rem;color:var(--text);">${t.text}</div>
      ${!locked ? `<button onclick="_removeEditorTask(${i})" style="background:rgba(217,74,74,0.15);border:none;color:#D94A4A;border-radius:5px;padding:2px 8px;font-size:0.65rem;cursor:pointer;">✕</button>` : ''}
    </div>`;
  }).join('') || `<div style="font-size:0.78rem;color:var(--muted);text-align:center;padding:20px;">No tasks for this day</div>`;
}

function _removeEditorTask(idx) {
  _editorTasks.splice(idx, 1);
  _renderEditorList(false);
}

function addEditorTask() {
  const text = document.getElementById('newTaskText').value.trim();
  if (!text) return;
  const time = document.getElementById('newTaskTime').value || '09:00';
  const cat  = document.getElementById('newTaskCat').value;
  const id   = 'custom_' + Date.now();
  _editorTasks.push({ id, cat, text, time, pts: 2 });
  // Sort by time
  _editorTasks.sort((a,b) => (a.time||'00:00').localeCompare(b.time||'00:00'));
  _renderEditorList(false);
  document.getElementById('newTaskText').value = '';
}

function saveDayEdits() {
  const scope = document.querySelector('[name="editScope"]:checked')?.value || 'day';
  const d     = curDate;
  const st    = document.getElementById('editorStatus');

  if (scope === 'day') {
    customTasks[dateKey(d)] = [..._editorTasks];
  } else if (scope === 'weekdays') {
    // Apply to all remaining weekdays (Mon–Sat) of this week from today onwards
    const today = new Date(tashKey());
    const mon   = getMonday(d);
    for (let i=0; i<7; i++) {
      const day = addDays(mon, i);
      const dk  = dateKey(day);
      if (day >= today && day.getUTCDay() !== 0) { // skip past and Sundays
        customTasks[dk] = [..._editorTasks];
      }
    }
  } else if (scope === 'month') {
    // Apply to all remaining days this month
    const today = new Date(tashKey());
    const mEnd  = utcDate(d.getUTCFullYear(), d.getUTCMonth()+1, 0);
    let cur     = new Date(today);
    while (cur <= mEnd) {
      if (cur.getUTCDay() !== 0) customTasks[dateKey(cur)] = [..._editorTasks];
      cur = addDays(cur, 1);
    }
  }

  window._customTasks = customTasks;
  scheduleSave();
  st.textContent = '✅ Saved! Tasks updated.';
  setTimeout(() => { closeDayEditor(); renderAll(); }, 800);
}

async function aiSummarizeWeek() {
  const st = document.getElementById('editorStatus');
  st.textContent = '🧠 AI is summarizing your week…';
  try {
    const today  = new Date(tashKey());
    const mon    = getMonday(today);
    const weeks  = [];
    for (let i=0; i<7; i++) {
      const d = addDays(mon, i);
      if (d > today) break;
      const dk = dateKey(d);
      const tasks = getTasksForDate(d);
      const done  = tasks.filter(t => getTask(dk, t.id));
      if (done.length) weeks.push({ date: dk, done: done.map(t=>t.text) });
    }
    if (!weeks.length) { st.textContent = '⚠️ No completed tasks this week yet.'; return; }

    const data = await window.apiRequest('/summarize-week', {
      method: 'POST',
      body: JSON.stringify({ days: weeks })
    });

    // Save summary to reflection state for this week
    const wk = getWeekKey(0);
    if (!reflectState[wk]) reflectState[wk] = {scores:{},well:'',bad:'',next:'',grat:''};
    reflectState[wk].aiSummary = data.summary;
    reflectState[wk].skills    = data.skills;
    scheduleSave();

    st.style.color = '#4A90D9';
    st.textContent = '✅ Summary saved to your Reflection tab!';
    setTimeout(() => { st.style.color=''; st.textContent=''; }, 4000);
  } catch(e) {
    st.textContent = '❌ ' + e.message;
  }
}

function init(){
  // Render the local backup immediately. Firestore replaces it when the live
  // snapshot arrives, so a slow or unavailable network never blocks the app.
  window._hydrateLocalBackup();
  window._onFirebaseLoaded({ source: 'local' });
  setSaveStatus('saved', 'Local data ready — syncing cloud...');
  setTimeout(() => {
    if (!window._firebaseModuleStarted) {
      setSaveStatus('error', 'Cloud module unavailable — local mode');
    }
  }, 5000);

  // Auto-save every 30 seconds if there are unsaved changes
  setInterval(() => {
    if (_appInitialized && unsavedChanges && window._firebaseModuleStarted && typeof window.saveAllData === 'function') {
      window.saveAllData();
    }
  }, 30000);
}
init();
window.addEventListener('beforeunload', function(e){
  if(unsavedChanges){ e.preventDefault(); e.returnValue='You have unsaved changes. Save before leaving!'; }
});
