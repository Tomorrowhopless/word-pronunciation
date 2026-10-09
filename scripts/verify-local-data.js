#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const info = JSON.parse(fs.readFileSync(path.join(root, 'data/build-info.json')));
const totals = { wordCount: 0, ipaCount: 0, exampleCount: 0, compressedBytes: 0, uncompressedBytes: 0 };
for (const file of info.files) {
  const raw = fs.readFileSync(path.join(root, 'data', file.file));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), file.sha256);
  const unpacked = zlib.gunzipSync(raw);
  const data = JSON.parse(unpacked);
  assert.equal(Object.keys(data).length, file.count);
  for (const [key, entry] of Object.entries(data)) {
    assert.equal(entry.word.toLowerCase(), key);
    assert.ok(entry.meanings.length > 0);
    assert.ok(entry.meanings.every(m => typeof m.def === 'string' && m.def.trim()));
    totals.wordCount++;
    if (entry.ipa) totals.ipaCount++;
    if (entry.meanings.some(m => m.example)) totals.exampleCount++;
  }
  totals.compressedBytes += raw.length;
  totals.uncompressedBytes += unpacked.length;
}
for (const [key, value] of Object.entries(totals)) assert.equal(value, info[key]);
const chineseInfo = JSON.parse(fs.readFileSync(path.join(root, 'data/chinese-build-info.json')));
const requiredFiles = 'abcdefghijklmnopqrstuvwxyz'.split('').map(letter => letter + '.json.gz').concat('misc.json.gz').sort();
assert.deepEqual(Object.keys(chineseInfo.files).sort(), requiredFiles);
const chineseTotals = { lookupWords: 0, compressedBytes: 0, uncompressedBytes: 0,
  wordsWithDefinition: 0, wordsWithPhonetic: 0, wordsWithChineseCharacters: 0, exactEnglishOverlap: 0 };
let chineseFallbackSample;
for (const [filename, metadata] of Object.entries(chineseInfo.files)) {
  const raw = fs.readFileSync(path.join(root, 'data/zh', filename));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), metadata.sha256, filename);
  const unpacked = zlib.gunzipSync(raw);
  assert.equal(raw.length, metadata.compressedBytes, filename);
  assert.equal(unpacked.length, metadata.uncompressedBytes, filename);
  const data = JSON.parse(unpacked);
  const english = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'data', filename))));
  assert.equal(Object.keys(data).length, metadata.words, filename);
  for (const [word, entry] of Object.entries(data)) {
    assert.equal(word, word.trim().toLowerCase());
    assert.ok(word.length);
    const letter = /^[a-z]/.test(word) ? word[0] : 'misc';
    assert.equal(filename, letter + '.json.gz');
    assert.deepEqual(Object.keys(entry).sort(), ['definition', 'phonetic', 'translation']);
    assert.equal(typeof entry.translation, 'string');
    assert.ok(entry.translation.trim());
    assert.equal(typeof entry.phonetic, 'string');
    assert.equal(typeof entry.definition, 'string');
    assert.ok(!/\\+[nr]/.test(entry.translation), 'Undecoded line break: ' + word);
    chineseTotals.lookupWords++;
    chineseTotals.wordsWithDefinition += !!entry.definition;
    chineseTotals.wordsWithPhonetic += !!entry.phonetic;
    chineseTotals.wordsWithChineseCharacters += /[\u3400-\u9fff]/.test(entry.translation);
    if (Object.hasOwn(english, word)) chineseTotals.exactEnglishOverlap++;
    else if (!chineseFallbackSample && !/\s/.test(word) && word.length > 2) chineseFallbackSample = { word, translation: entry.translation };
  }
  chineseTotals.compressedBytes += raw.length;
  chineseTotals.uncompressedBytes += unpacked.length;
}
for (const [key, value] of Object.entries(chineseTotals)) {
  if (key !== 'exactEnglishOverlap') assert.equal(value, chineseInfo.stats[key], key);
}
assert.ok(fs.readFileSync(path.join(root, 'ECDICT-LICENSE.txt'), 'utf8').includes('Copyright (c) 2025 Linwei'));
const context = vm.createContext({ chrome: { runtime: { getURL: p => p, onMessage: { addListener() {} } } },
  fetch: async url => new Response(fs.readFileSync(path.join(root, url))), Response, DecompressionStream, console });
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
(async () => {
  const samples = [];
  for (const word of ['a', 'I', 'apple', 'hello', 'dictionary', 'run', 'running', 'learn', 'education', 'electromagnetism']) {
    const result = await context.lookupWord(word);
    assert.ok(result.entry, `Missing ${word}`);
    samples.push({ search: word, word: result.entry.word, ipa: result.entry.ipa || null,
      translation: result.entry.translation || null, translationWord: result.entry.translationWord || null,
      definition: result.entry.meanings[0]?.def || null,
      example: result.entry.meanings.find(m => m.example)?.example || null });
  }
  for (const word of ['apple', 'hello', 'dictionary']) {
    const entry = (await context.lookupWord(word)).entry;
    assert.ok(entry.ipa, `Missing IPA for ${word}`);
  }
  for (const word of ['apple', 'hello', 'education', 'run']) {
    assert.ok((await context.lookupWord(word)).entry.meanings.some(m => m.example), `Missing example for ${word}`);
  }
  for (const word of ['a', 'I', 'apple', 'hello', 'education', 'electromagnetism']) {
    const entry = (await context.lookupWord(word)).entry;
    assert.ok(entry.translation && /[\u3400-\u9fff]/.test(entry.translation), 'Missing Chinese: ' + word);
    assert.equal(entry.translationSource, 'ECDICT');
  }
  assert.ok(chineseFallbackSample);
  const fallback = (await context.lookupWord(chineseFallbackSample.word)).entry;
  assert.ok(fallback, 'Chinese-only word must remain searchable');
  assert.ok(fallback.translation, 'Chinese-only result must include a translation');
  assert.ok(Array.isArray(fallback.meanings));
  assert.equal((await context.lookupWord('zzzzzzzzzzzznotarealword')).entry, null);
  console.log(JSON.stringify({ verifiedFiles: info.files.length, verifiedChineseFiles: Object.keys(chineseInfo.files).length, ...totals, chinese: chineseTotals, chineseFallbackSample: { word: chineseFallbackSample.word, returnedWord: fallback.word, translation: fallback.translation, meaningsSource: fallback.meaningsSource }, samples }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
