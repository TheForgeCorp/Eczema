// Baseline push glue: registers the service worker, runs the iOS install-then-permit
// flow, subscribes to web push, and fires a local test notification. The Settings
// screen calls enableReminders() and testNotify().

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); }
  catch (e) { console.error('SW registration failed', e); return null; }
}

function setReminderStatus(msg) {
  const el = document.getElementById('reminderStatus');
  if (el) el.textContent = msg;
}

// Must be called from a user gesture (the "Phone push" button).
async function enableReminders() {
  // On iPhone, push only works from an installed (home-screen) PWA.
  if (isIOS && !isStandalone) {
    setReminderStatus('On iPhone, add Baseline to your Home Screen first: tap Share, then Add to Home Screen. Open it from there, then choose phone push.');
    return;
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    setReminderStatus('Push notifications are not supported in this browser.');
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { setReminderStatus('Notifications were not allowed.'); return; }

  const reg = await navigator.serviceWorker.ready;

  let key = '';
  try { key = (await (await fetch('/api/vapidPublicKey')).json()).key; } catch (_) {}
  if (!key) { setReminderStatus('Server is missing its push key. Run npm run gen-vapid and set .env.'); return; }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key)
  });

  await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub)
  });

  setReminderStatus('Phone push on. You will get reminders at 10:00 AM and 9:30 PM.');
}

// Local, in-page test notification (no server round trip).
function testNotify() {
  const s = document.getElementById('notifStatus');
  if (!('Notification' in window)) { s.textContent = 'This browser does not support notifications.'; return; }
  if (Notification.permission === 'granted') { fireNotif(); }
  else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((p) => {
      if (p === 'granted') fireNotif();
      else s.textContent = 'Permission was not granted. Allow notifications for this page to test.';
    });
  } else {
    s.textContent = 'Notifications are blocked. Enable them for this page in your browser settings, then try again.';
  }
}
function fireNotif() {
  const s = document.getElementById('notifStatus');
  try {
    new Notification('Time for your Rinvoq', { body: '10:00 AM · tap to log it' });
    s.textContent = 'Sent. Check your notifications.';
  } catch (e) {
    s.textContent = 'Could not show it here. This works when the app runs from your home screen or desktop.';
  }
}

registerSW();

window.addEventListener('load', () => {
  // Show the iOS install hint on the Settings screen when opened in Safari (not yet installed).
  if (isIOS && !isStandalone) {
    const hint = document.getElementById('iosHint');
    if (hint) hint.hidden = false;
  }
});
