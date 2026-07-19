(function attachTaskScheduleUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlannerTaskSchedule = api;
})(typeof window !== 'undefined' ? window : globalThis, function createTaskScheduleUtils() {
  function parseDateKey(key) {
    return new Date(`${String(key).slice(0, 10)}T00:00:00Z`);
  }

  function dateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  function addDays(date, amount) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + amount);
    return result;
  }

  function getRepeatDateKeys(startKey, scope, selectedDays, maxKey = '9999-12-31') {
    const start = parseDateKey(startKey);
    const limit = parseDateKey(maxKey);
    const allowedDays = new Set((selectedDays || [0,1,2,3,4,5,6]).map(Number));
    let end = new Date(start);

    if (scope === 'week') end = addDays(start, (7 - start.getUTCDay()) % 7);
    else if (scope === 'next7') end = addDays(start, 6);
    else if (scope === 'month') end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    if (end > limit) end = limit;

    const keys = [];
    for (let day = new Date(start); day <= end; day = addDays(day, 1)) {
      if (scope === 'day' || allowedDays.has(day.getUTCDay())) keys.push(dateKey(day));
    }
    return keys;
  }

  function taskFingerprint(task) {
    return [
      String(task?.cat || 'plan').trim().toLowerCase(),
      String(task?.time || '').trim(),
      String(task?.text || '').trim().toLowerCase(),
    ].join('|');
  }

  function mergeSchedules(existingTasks, incomingTasks, targetKey) {
    const merged = (existingTasks || []).map(task => ({ ...task }));
    const fingerprints = new Set(merged.map(taskFingerprint));
    const ids = new Set(merged.map(task => String(task.id)));

    (incomingTasks || []).forEach((task, index) => {
      if (fingerprints.has(taskFingerprint(task))) return;
      const copy = { ...task };
      const originalId = String(copy.id || 'repeat');
      if (ids.has(originalId) || !copy.id) {
        copy.id = `${originalId}_${String(targetKey).replaceAll('-', '')}_${index}`;
      }
      merged.push(copy);
      fingerprints.add(taskFingerprint(copy));
      ids.add(String(copy.id));
    });

    return merged.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  }

  return Object.freeze({ getRepeatDateKeys, mergeSchedules, taskFingerprint });
});
