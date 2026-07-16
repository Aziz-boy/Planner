(function initializeNotifications() {
  const button = document.getElementById('notificationBtn');
  if (!button) return;

  let registration = null;
  let subscription = null;

  function setButton(state, label, title) {
    button.dataset.state = state;
    button.textContent = label;
    button.title = title;
    button.disabled = state === 'busy';
  }

  function decodeVapidKey(value) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
  }

  async function setup() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setButton('unsupported', '🔕', 'Notifications are not supported in this browser.');
      button.disabled = true;
      return;
    }
    try {
      registration = await navigator.serviceWorker.register('/sw.js');
      subscription = await registration.pushManager.getSubscription();
      if (subscription) setButton('enabled', '🔔', 'Reminders are on — click to disable.');
      else if (Notification.permission === 'denied') setButton('denied', '🔕', 'Notifications are blocked in browser settings.');
      else setButton('disabled', '🔔', 'Enable browser reminders.');
    } catch (error) {
      console.error('Notification setup failed:', error);
      setButton('error', '🔕', 'Could not set up browser reminders.');
    }
  }

  button.addEventListener('click', async () => {
    if (!registration) return setup();
    setButton('busy', '…', 'Updating reminders...');
    try {
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await window.apiRequest('/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint }),
          timeoutMs: 30000,
        });
        subscription = null;
        setButton('disabled', '🔔', 'Enable browser reminders.');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setButton('denied', '🔕', 'Notifications are blocked in browser settings.');
        return;
      }
      const { key } = await window.apiRequest('/vapid-public-key', { timeoutMs: 30000 });
      if (!key) throw new Error('Push notifications are not configured on the server.');
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(key),
      });
      await window.apiRequest('/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription),
        timeoutMs: 30000,
      });
      setButton('enabled', '🔔', 'Reminders are on — click to disable.');
    } catch (error) {
      console.error('Notification update failed:', error);
      setButton('error', '🔕', error.message || 'Could not update reminders.');
    }
  });

  setup();
})();
