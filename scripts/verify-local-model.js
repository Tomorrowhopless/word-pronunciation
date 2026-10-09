'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const info = JSON.parse(fs.readFileSync(path.join(root, 'models/model-info.json'), 'utf8'));
const speech = JSON.parse(fs.readFileSync(path.join(root, 'models/speech-model-info.json'), 'utf8'));
const files = [...info.files.map(file => ({ ...file, file: 'models/opus-mt-en-zh/' + file.file })), ...info.runtime_files, ...speech.files, ...speech.runtime_files];
for (const item of files) {
  const filename = path.resolve(root, item.file);
  if (!filename.startsWith(root + path.sep)) throw new Error('Unexpected resource path');
  const data = fs.readFileSync(filename);
  if (data.byteLength !== item.bytes || crypto.createHash('sha256').update(data).digest('hex') !== item.sha256) throw new Error('Model/runtime integrity mismatch: ' + item.file);
}
console.log(JSON.stringify({ verifiedFiles: files.length, bytes: files.reduce((total, item) => total + item.bytes, 0), translation: { repository: info.repository, revision: info.revision }, speech: { repository: speech.repository, revision: speech.revision }, remoteModelsAllowed: false }, null, 2));
