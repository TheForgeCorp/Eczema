// Baseline client glue: registers the service worker, subscribes to push,
// and handles the iOS-specific install-then-permit flow.

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

function setStatus(msg) {
  const el = document.getElementById('reminderStatus');
  if (el) el.textContent = msg;
}

// Must be called from a user gesture (button tap).
async function enableReminders() {
  // On iPhone, push only works from an installed (home-screen) PWA.
  if (isIOS && !isStandalone) {
    setStatus('On iPhone, add Baseline to your Home Screen first: tap Share, then Add to Home Screen. Open it from there, then enable reminders.');
    return;
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    setStatus('Push notifications are not supported in this browser.');
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { setStatus('Notifications were not allowed.'); return; }

  const reg = await navigator.serviceWorker.ready;

  // Fetch the VAPID public key from the server.
  let key = '';
  try { key = (await (await fetch('/api/vapidPublicKey')).json()).key; } catch (_) {}
  if (!key) { setStatus('Server is missing its push key. Run npm run gen-vapid and set .env.'); return; }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key)
  });

  await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub)
  });

  setStatus('Reminders on. You will get them at 10:00 AM and 9:30 PM.');
}

registerSW();

window.addEventListener('load', () => {
  // Show the iOS install hint when opened in Safari (not yet installed).
  if (isIOS && !isStandalone) {
    const hint = document.getElementById('iosHint');
    if (hint) hint.hidden = false;
  }
  const btn = document.getElementById('enableReminders');
  if (btn) btn.addEventListener('click', enableReminders);
});
