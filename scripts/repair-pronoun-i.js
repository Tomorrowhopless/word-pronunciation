#!/usr/bin/env node
// Preserve the pronoun, which upstream lowercasing and sense capping hid behind the letter i.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..', 'data');
const filename = 'i.json.gz';
const filePath = path.join(root, filename);
const oldRaw = zlib.gunzipSync(fs.readFileSync(filePath));
const data = JSON.parse(oldRaw);
const info = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json')));
if (data.i.meaningsSource === 'wordset') info.wordsetWords--;
const hadExample = data.i.meanings.some(m => m.example);
data.i = { word: 'I', ipa: '/aɪ/', meaningsSource: 'wiktionary', meanings: [{
  def: 'The speaker or writer, referred to as the grammatical subject, of a sentence.',
  speech_part: 'pronoun', example: 'I drove my sister and myself to school.'
}] };
if (!hadExample) info.exampleCount++;
const raw = Buffer.from(JSON.stringify(data));
const packed = zlib.gzipSync(raw, { level: 9 });
const file = info.files.find(f => f.file === filename);
info.compressedBytes += packed.length - file.bytes;
info.uncompressedBytes += raw.length - oldRaw.length;
file.bytes = packed.length;
file.sha256 = crypto.createHash('sha256').update(packed).digest('hex');
info.pronounISource = 'https://en.wiktionary.org/wiki/I#English';
info.sourceUrl = 'https://huggingface.co/datasets/cstr/en-wiktionary-extracted-all/resolve/855a9be08bf9eacc9914cb0221eeab92570a7556/en-wiktionary-all.jsonl';
fs.writeFileSync(filePath, packed);
fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
