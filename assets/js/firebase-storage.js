import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA7AwtfRArmS-hz0uIf4teeg6mp-kduiKk',
  authDomain: 'life-planner-c5205.firebaseapp.com',
  projectId: 'life-planner-c5205',
  storageBucket: 'life-planner-c5205.firebasestorage.app',
  messagingSenderId: '114850967336',
  appId: '1:114850967336:web:af0e75368b3ccb075aea1d',
};

const FIELD_MAP = {
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

const NULLABLE_FIELDS = new Set(['aiPlan', 'studyPlan']);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const plannerDoc = doc(db, 'lifeplanner', 'azizbek2026');
let receivedSnapshot = false;
let saveInFlight = null;

window._firebaseModuleStarted = true;

function notifyPlannerLoaded(loadInfo) {
  try {
    window._onFirebaseLoaded?.(loadInfo);
  } catch (error) {
    // A broken optional view must never hide data that already loaded safely.
    console.error('Planner data loaded, but a view refresh failed:', error);
    window._setPlannerSaveStatus?.('saved', 'Cloud synced — one view needs a refresh');
  }
}

function decodeField(field, value) {
  const fallback = NULLABLE_FIELDS.has(field) ? null : {};
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (error) {
    console.warn(`Ignoring invalid cloud field: ${field}`, error);
    const existing = window[FIELD_MAP[field]];
    return existing == null ? fallback : existing;
  }
}

function applySnapshot(snapshot) {
  receivedSnapshot = true;
  if (!snapshot.exists()) {
    notifyPlannerLoaded({ source: 'cloud-empty' });
    return;
  }
  if (snapshot.metadata.hasPendingWrites && window._appInitialized) return;
  if (window._hasUnsavedPlannerChanges?.()) {
    // Do not let a late snapshot erase edits made while the app was starting.
    window.saveAllData?.();
    return;
  }

  const data = snapshot.data();
  Object.entries(FIELD_MAP).forEach(([field, globalName]) => {
    window[globalName] = decodeField(field, data[field]);
  });
  // Refresh the durable browser backup after every valid snapshot so the next
  // launch still has data even if Firestore is slow or temporarily offline.
  window._saveLocalBackup?.({
    payload: window._collectPlannerPayload?.(),
    markClean: true,
    quiet: true,
  });

  notifyPlannerLoaded({
    source: snapshot.metadata.fromCache ? 'cache' : 'cloud',
    savedAt: data.savedAt || null,
  });
}

window.saveAllData = function saveAllData() {
  if (saveInFlight) return saveInFlight;
  const button = document.getElementById('globalSaveBtn');
  if (button) {
    button.disabled = true;
    button.textContent = 'Syncing…';
  }
  window._setPlannerSaveStatus?.('saving', 'Saving to cloud...');

  saveInFlight = (async () => {
    const payload = window._collectPlannerPayload();
    try {
      await setDoc(plannerDoc, payload, { merge: true });
      window._saveLocalBackup?.({ payload, markClean: true, quiet: true });
      window._markCloudSaved?.();
      window._setPlannerSaveStatus?.('saved', 'Saved to cloud ✓');
      if (button) {
        button.style.background = '#4CAF7D';
        button.style.color = '#000';
        button.textContent = '✓ Synced';
      }
    } catch (error) {
      console.error('Cloud save failed:', error);
      window._saveLocalBackup?.({ payload, markClean: false, quiet: true });
      window._setPlannerSaveStatus?.('error', 'Cloud unavailable — saved locally');
      if (button) {
        button.style.background = '#D94A4A';
        button.textContent = 'Retry cloud save';
      }
    } finally {
      if (button) {
        button.disabled = false;
        setTimeout(() => {
          button.style.background = '';
          button.style.color = '';
          button.textContent = '↻ Sync now';
        }, 2000);
      }
      saveInFlight = null;
    }
  })();

  return saveInFlight;
};

onSnapshot(
  plannerDoc,
  { includeMetadataChanges: true },
  applySnapshot,
  (error) => {
    console.error('Firestore listener failed:', error);
    window._setPlannerSaveStatus?.('error', 'Cloud sync unavailable — using local data');
    if (!receivedSnapshot) notifyPlannerLoaded({ source: 'local-fallback' });
  },
);

setTimeout(() => {
  if (receivedSnapshot) return;
  window._setPlannerSaveStatus?.('error', 'Cloud is slow — using local data');
  notifyPlannerLoaded({ source: 'local-fallback' });
}, 8000);
