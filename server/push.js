// web-push setup and a helper to push to every stored subscription.

const webpush = require('web-push');
const db = require('./db');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:you@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendToAll(payload) {
  const subs = db.getSubscriptions();
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (row) => {
    try {
      await webpush.sendNotification(JSON.parse(row.sub), body);
    } catch (err) {
      // 404/410 means the subscription is dead; drop it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.removeSubscription(row.endpoint);
      } else {
        console.error('push send error', err.statusCode || err.message);
      }
    }
  }));
}

module.exports = { sendToAll };
