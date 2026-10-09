#!/usr/bin/env node
// Reorder three checked Wordset entries without changing their source wording or examples.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..', 'data');
const info = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json')));
const selected = { run: "move fast by using one's feet", study: 'learn by reading books',
  education: 'the gradual process of acquiring knowledge' };
for (const [word, definition] of Object.entries(selected)) {
  const filename = `${word[0]}.json.gz`;
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, filename))));
  const entry = data[word];
  const index = entry.meanings.findIndex(m => m.def.startsWith(definition));
  assert.ok(index >= 0, `Missing checked sense: ${word}`);
  entry.meanings.unshift(...entry.meanings.splice(index, 1));
  const raw = Buffer.from(JSON.stringify(data));
  const packed = zlib.gzipSync(raw, { level: 9 });
  const file = info.files.find(f => f.file === filename);
  info.compressedBytes += packed.length - file.bytes;
  fs.writeFileSync(path.join(root, filename), packed);
  file.bytes = packed.length;
  file.sha256 = crypto.createHash('sha256').update(packed).digest('hex');
}
info.reorderedStudyWords = Object.keys(selected);
fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
