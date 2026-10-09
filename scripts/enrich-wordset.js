#!/usr/bin/env node
// Prefer Wordset's more concise meanings, retaining Wiktionary pronunciation and etymology.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dataPath = path.join(__dirname, '..', 'data');
const wordsetPath = process.argv[2];
assert.ok(wordsetPath, 'Provide the extracted WordWorkshop release data folder');
const info = JSON.parse(fs.readFileSync(path.join(dataPath, 'build-info.json')));
assert.ok(!info.wordsetWords, 'Wordset is already integrated');
Object.assign(info, { wordCount: 0, ipaCount: 0, exampleCount: 0, uncompressedBytes: 0, compressedBytes: 0,
  wordsetWords: 0, files: [] });
for (const letter of [...'abcdefghijklmnopqrstuvwxyz', 'misc']) {
  const filename = `${letter}.json.gz`;
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dataPath, filename))));
  const wordset = JSON.parse(fs.readFileSync(path.join(wordsetPath, `${letter}.json`)));
  for (const [word, entry] of Object.entries(wordset)) {
    const key = word.toLowerCase().trim();
    if (!entry.meanings?.length) continue;
    const meanings = entry.meanings.filter(m => m.def?.trim());
    if (!meanings.length) continue;
    data[key] = { ...(Object.hasOwn(data, key) ? data[key] : {}), word: key,
      meanings, meaningsSource: 'wordset' };
    info.wordsetWords++;
  }
  const entries = Object.values(data);
  const raw = Buffer.from(JSON.stringify(data));
  const packed = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(path.join(dataPath, filename), packed);
  info.wordCount += entries.length;
  info.ipaCount += entries.filter(e => e.ipa).length;
  info.exampleCount += entries.filter(e => e.meanings.some(m => m.example)).length;
  info.compressedBytes += packed.length;
  info.uncompressedBytes += raw.length;
  info.files.push({ file: filename, count: entries.length, bytes: packed.length,
    sha256: crypto.createHash('sha256').update(packed).digest('hex') });
}
info.wordsetSource = 'WordWorkshop v4.0.0 chrome release, Wordset data';
info.wordsetReleaseSha256 = 'ac1de7dac9e089c0bb3fb161433e7350200ac8afd561f88b2322cd81d1d2324e';
fs.writeFileSync(path.join(dataPath, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(JSON.stringify(info, null, 2));
