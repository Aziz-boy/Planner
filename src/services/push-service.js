const fs = require('fs');
const webpush = require('web-push');
const config = require('../config');

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.email, config.vapid.publicKey, config.vapid.privateKey);
}

function loadSubscriptions() {
  try {
    const data = JSON.parse(fs.readFileSync(config.subscriptionsFile, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveSubscriptions(subscriptions) {
  fs.writeFileSync(config.subscriptionsFile, JSON.stringify(subscriptions, null, 2));
}

function addSubscription(subscription) {
  const subscriptions = loadSubscriptions();
  if (subscriptions.length >= 1000 && !subscriptions.some((item) => item.endpoint === subscription.endpoint)) {
    throw new Error('Push subscription limit reached.');
  }
  if (!subscriptions.some((item) => item.endpoint === subscription.endpoint)) {
    subscriptions.push(subscription);
    saveSubscriptions(subscriptions);
  }
  return subscriptions.length;
}

function removeSubscription(endpoint) {
  const subscriptions = loadSubscriptions().filter((item) => item.endpoint !== endpoint);
  saveSubscriptions(subscriptions);
  return subscriptions.length;
}

function push(title, body) {
  if (!config.vapid.publicKey || !config.vapid.privateKey) return;
  const payload = JSON.stringify({ title, body });
  loadSubscriptions().forEach((subscription) => {
    webpush.sendNotification(subscription, payload).catch((error) => {
      if (error.statusCode === 404 || error.statusCode === 410) {
        removeSubscription(subscription.endpoint);
      } else {
        console.error('Push notification failed:', error.message);
      }
    });
  });
}

module.exports = {
  addSubscription,
  loadSubscriptions,
  push,
  removeSubscription,
};
