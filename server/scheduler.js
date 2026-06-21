// Daily reminder schedule. Runs server-side so reminders fire whether the app is open or not.

const cron = require('node-cron');
const { sendToAll } = require('./push');

const TZ = process.env.TZ || 'America/Toronto';

function start() {
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

  console.log('Reminders scheduled: 10:00 and 21:30 ' + TZ);
}

module.exports = { start };
