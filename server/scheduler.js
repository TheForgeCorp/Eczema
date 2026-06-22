// Daily reminder schedule. Runs server-side so reminders fire whether the app is open or not.

const cron = require('node-cron');
const { sendToAll } = require('./push');

const TZ = process.env.TZ || 'America/Toronto';

function start() {
  // 8:00 AM daily: morning summary (effects are often felt on waking)
  cron.schedule('0 8 * * *', () => {
    sendToAll({
      title: 'Morning check-in',
      body: 'How did you wake up? Log your morning summary.',
      url: '/?screen=morning',
      tag: 'morning'
    });
  }, { timezone: TZ });

  // 10:00 AM daily: Rinvoq
  cron.schedule('0 10 * * *', () => {
    sendToAll({
      title: 'Time for your Rinvoq',
      body: '30 mg. Tap to log it.',
      url: '/?log=rinvoq',
      tag: 'rinvoq'
    });
  }, { timezone: TZ });

  // 9:30 PM daily: closeout
  cron.schedule('30 21 * * *', () => {
    sendToAll({
      title: 'Daily closeout',
      body: 'Wrap up today with your evening summary.',
      url: '/?screen=closeout',
      tag: 'closeout'
    });
  }, { timezone: TZ });

  console.log('Reminders scheduled: 08:00, 10:00, and 21:30 ' + TZ);
}

module.exports = { start };
