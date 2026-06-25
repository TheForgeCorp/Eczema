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

// Read a stored photo back as base64 so it can be re-sent to the analyzer (for
// re-grading). basename guards against path traversal from the stored name.
function readBase64(name) {
  if (!name) return null;
  const file = path.join(dir, path.basename(String(name)));
  if (!fs.existsSync(file)) return null;
  const mediaType = path.extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  return { base64: fs.readFileSync(file).toString('base64'), mediaType };
}

module.exports = { savePhoto, readBase64, dir };
