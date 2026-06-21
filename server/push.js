// web-push setup and a helper to push to every stored subscription.

const webpush = require('web-push');
const db = require('./db');

// Configure VAPID only when both keys are present. Without this guard the app
// would crash on startup before push is set up; instead it runs for logging and
// push activates as soon as keys land in .env.
const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:you@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function sendToAll(payload) {
  if (!configured) {
    console.warn('push skipped: VAPID keys not set. Run npm run gen-vapid and add them to .env');
    return;
  }
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
