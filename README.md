# Baseline

A personal eczema elimination tracker. Self-hosted on a Beelink, used from an iPhone as an installed PWA. Logs are captured as events through the day (meal, cream, itch, photo, note) and compose into a daily report. AI reads meal photos for ingredients and allergens and grades skin photos for severity. Trends and insights surface candidate triggers as hypotheses, and a 6-month dermatologist summary is generated for appointments.

Working name: Baseline. The full UI design is in `docs/mockup.html` (clickable, sample data).

## What is in this repo

This is a scaffold, not the finished app. It stands up the parts that are hard to get right:

- PWA shell, manifest, icons, and service worker (`public/`)
- Web push: client subscribe flow with the iOS install path (`public/app.js`), and the service worker push + notification-tap handling (`public/sw.js`)
- Push backend: Express server, SQLite storage, `web-push`, and a `node-cron` schedule at 10:00 and 21:30 (`server/`)

The full screen-by-screen UI still needs building. Do that from the mockup. See `CLAUDE.md`.

## Stack

Node + Express, `web-push` for delivery, `node-cron` for the schedule, `better-sqlite3` for storage. No build step; static files are served from `public/`.

## Setup

1. Install
   ```
   npm install
   ```

2. Generate VAPID keys and put them in `.env`
   ```
   cp .env.example .env
   npm run gen-vapid
   ```
   Paste the public and private keys into `.env`. Set `VAPID_SUBJECT` to your email.

3. Run
   ```
   npm start
   ```
   Serves on `http://localhost:3000`.

## HTTPS over Tailscale (required)

Service workers and web push will not work over plain http. Since the Beelink is on Tailscale, use a real cert from your tailnet. No public exposure.

1. Enable HTTPS and MagicDNS in the Tailscale admin console.
2. Serve the app over HTTPS on the tailnet hostname:
   ```
   tailscale serve --bg 3000
   ```
   This proxies `https://<machine>.<tailnet>.ts.net` to the local port 3000 with a valid cert. Check it with `tailscale serve status`.

Now open `https://<machine>.<tailnet>.ts.net` from any device on the tailnet.

## Install on iPhone (required for push)

iOS only allows web push for a PWA added to the Home Screen (iOS 16.4+). There is no install prompt, and permission can only be requested after launching from the Home Screen.

1. Open the HTTPS URL in Safari on the iPhone.
2. Share, then Add to Home Screen.
3. Open Baseline from the Home Screen icon.
4. Tap Enable reminders and allow notifications. The device subscribes to push.

After that, the Beelink sends the 10:00 and 21:30 reminders even when the app is closed.

## Reminders

Times and timezone live in `server/scheduler.js` and `.env` (`TZ`, default `America/Toronto`). Tapping a reminder deep-links into the app via the `url` in the push payload.

## Run as a service

Keep it alive with PM2:
```
pm2 start server/server.js --name baseline
pm2 save
```

## Icons

`public/icons/icon-192.png` and `icon-512.png` are placeholder marks. Replace with final artwork at the same sizes (maskable safe).
