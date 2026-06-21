// Local photo storage. Images live on the machine under data/photos (gitignored).
// The only time an image leaves the box is the analyzer API call. We keep the
// file and store its name alongside the extracted scores in the log payload.

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data', 'photos');
fs.mkdirSync(dir, { recursive: true });

// Save a base64 image, return the stored filename (served at /photos/<name>).
function savePhoto(base64, mediaType) {
  const ext = mediaType === 'image/png' ? 'png' : 'jpg';
  const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  fs.writeFileSync(path.join(dir, name), Buffer.from(base64, 'base64'));
  return name;
}

module.exports = { savePhoto, dir };
