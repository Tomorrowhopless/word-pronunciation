#!/usr/bin/env node
// Accept a local JSONL file or stdin, without downloading or retaining the raw dump.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { miniEntry, stripEntry, getLetterFile } = require('./prepare-wiktionary');

async function main() {
  const input = process.argv[2] ? fs.createReadStream(process.argv[2]) : process.stdin;
  const words = new Map();
  const sourceHash = crypto.createHash('sha256');
  input.on('data', chunk => sourceHash.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let count = 0;
  let bad = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    count++;
    let entry;
    try { entry = JSON.parse(line); } catch { bad++; continue; }
    if (entry.lang_code !== 'en') continue;
    const word = (entry.word || '').toLowerCase().trim();
    if (!word || !entry.senses?.length) continue;
    if (!words.has(word)) words.set(word, []);
    words.get(word).push(miniEntry(entry));
    if (count % 100000 === 0) process.stderr.write(`Parsed ${count.toLocaleString()} lines; ${words.size.toLocaleString()} English keys\n`);
  }
  if (bad || count < 100000 || words.size < 100000) {
    throw new Error(`Incomplete or invalid source: ${count} lines, ${bad} invalid, ${words.size} English keys`);
  }
  const digest = sourceHash.digest('hex');
  if (process.env.WS_SOURCE_SHA256 && digest !== process.env.WS_SOURCE_SHA256) {
    throw new Error(`Source checksum mismatch: ${digest}`);
  }
  const out = path.join(__dirname, '..', 'data');
  fs.mkdirSync(out, { recursive: true });
  const buckets = Object.create(null);
  for (const [word, entries] of words) {
    const entry = stripEntry(word, entries);
    words.delete(word);
    if (!entry) continue;
    const letter = getLetterFile(word);
    (buckets[letter] ||= Object.create(null))[word] = entry;
  }
  const stats = { sourceLines: count, sourceSha256: digest, wordCount: 0, ipaCount: 0,
    exampleCount: 0, uncompressedBytes: 0, compressedBytes: 0, files: [] };
  for (const letter of [...'abcdefghijklmnopqrstuvwxyz', 'misc']) {
    const bucket = buckets[letter] || {};
    const entries = Object.values(bucket);
    const bytes = Buffer.from(JSON.stringify(bucket));
    const packed = zlib.gzipSync(bytes, { level: 9 });
    const filename = `${letter}.json.gz`;
    fs.writeFileSync(path.join(out, filename), packed);
    stats.wordCount += entries.length;
    stats.ipaCount += entries.filter(entry => entry.ipa).length;
    stats.exampleCount += entries.filter(entry => entry.meanings.some(meaning => meaning.example)).length;
    stats.uncompressedBytes += bytes.length;
    stats.compressedBytes += packed.length;
    stats.files.push({ file: filename, count: entries.length, bytes: packed.length,
      sha256: crypto.createHash('sha256').update(packed).digest('hex') });
    delete buckets[letter];
    process.stderr.write(`${filename}: ${entries.length.toLocaleString()} words, ${(packed.length / 1048576).toFixed(2)} MiB\n`);
  }
  fs.writeFileSync(path.join(out, 'build-info.json'), JSON.stringify(stats, null, 2) + '\n');
  process.stderr.write(JSON.stringify(stats, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
