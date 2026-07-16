const { cert, getApp, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const config = require('../config');

const DOC_PATH = { collection: 'lifeplanner', doc: 'azizbek2026' };
const DATA_FIELDS = [
  'tasks', 'diet', 'money', 'savings', 'prayer', 'workout', 'reflect',
  'youtube', 'weight', 'aiPlan', 'roadmap', 'studyPlan', 'customTasks',
];
const NULLABLE_FIELDS = new Set(['aiPlan', 'studyPlan']);
let firestoreDb = null;

function safeJSON(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function parseServiceAccount(value) {
  try { return JSON.parse(value); }
  catch {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  }
}

if (config.firebaseServiceAccount) {
  try {
    const serviceAccount = parseServiceAccount(config.firebaseServiceAccount);
    const firebaseApp = getApps().length
      ? getApp()
      : initializeApp({ credential: cert(serviceAccount) });
    firestoreDb = getFirestore(firebaseApp);
    console.log('Firebase Admin connected');
  } catch (error) {
    console.warn('Firebase Admin initialization failed:', error.message);
  }
}

function plannerDoc() {
  if (!firestoreDb) return null;
  return firestoreDb.collection(DOC_PATH.collection).doc(DOC_PATH.doc);
}

async function readPlannerData() {
  const ref = plannerDoc();
  if (!ref) return null;
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const raw = snapshot.data();
  const result = { savedAt: raw.savedAt || null };
  DATA_FIELDS.forEach((field) => {
    result[field] = safeJSON(raw[field], NULLABLE_FIELDS.has(field) ? null : {});
  });
  return result;
}

async function setPlannerField(field, value) {
  const ref = plannerDoc();
  if (!ref) return false;
  await ref.set({ [field]: JSON.stringify(value) }, { merge: true });
  return true;
}

async function writeReflectReport(weekKey, reportText) {
  const current = await readPlannerData();
  const reflect = current?.reflect || {};
  if (!reflect[weekKey]) {
    reflect[weekKey] = { scores: {}, well: '', bad: '', next: '', grat: '' };
  }
  reflect[weekKey].aiReport = reportText;
  return setPlannerField('reflect', reflect);
}

module.exports = {
  get db() { return firestoreDb; },
  isFirebaseConfigured: () => Boolean(firestoreDb),
  readPlannerData,
  safeJSON,
  setPlannerField,
  writeReflectReport,
};
