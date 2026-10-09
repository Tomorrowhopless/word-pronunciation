#!/usr/bin/env node

/**
 * Download and prepare Wiktionary dictionary data for WordWorkshop.
 *
 * Source: kaikki.org — Wiktionary extracts (CC BY-SA 3.0)
 * https://kaikki.org/dictionary/English/
 *
 * Downloads the English Wiktionary JSONL, streams + parses it, strips to
 * essential fields, and writes one JSON file per letter to data/.
 *
 * Output data shape (per entry in data/a.json):
 * {
 *   "apple": {
 *     "word": "apple",
 *     "ipa": "/ˈæp.əl/",            // optional, US pronunciation
 *     "etymology": "From Middle...", // optional, truncated to 300 chars
 *     "meanings": [
 *       {
 *         "def": "A common round fruit",
 *         "speech_part": "noun",
 *         "example": "I ate an apple.", // optional
 *         "synonyms": ["pome"],         // optional
 *         "antonyms": []               // optional
 *       }
 *     ]
 *   }
 * }
 *
 * Usage: node scripts/prepare-wiktionary.js
 * Requires Node.js 18+ (native fetch). The download is ~230MB compressed.
 * Expect ~3-8 minutes on a typical connection.
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// English-only JSONL from kaikki.org.
// If this URL becomes unavailable, use the full raw dump and filter lang_code:
// 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz'
const DOWNLOAD_URL =
  'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl';

const OUT_DIR = path.join(__dirname, '..', 'data');
const MAX_MEANINGS = 8;
const MAX_ETYMOLOGY_LENGTH = 300;
const MIN_WORD_LENGTH = 1;

// ---------------------------------------------------------------------------
// Part-of-speech normalisation
// ---------------------------------------------------------------------------

const POS_MAP = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  prep: 'preposition',
  conj: 'conjunction',
  pron: 'pronoun',
  det: 'determiner',
  intj: 'interjection',
  num: 'numeral',
  particle: 'particle',
  phrase: 'phrase',
  prefix: 'prefix',
  suffix: 'suffix',
  affix: 'affix',
  name: 'proper noun',
  'proper noun': 'proper noun',
  adjective: 'adjective',
  adverb: 'adverb',
  preposition: 'preposition',
  conjunction: 'conjunction',
  pronoun: 'pronoun',
  determiner: 'determiner',
  interjection: 'interjection',
  numeral: 'numeral',
};

function normalisePos(pos) {
  return POS_MAP[pos] || pos || 'other';
}

// ---------------------------------------------------------------------------
// IPA extraction
// ---------------------------------------------------------------------------

/**
 * Extract the most useful IPA string from a sounds array.
 * Prefers US/General American tags; falls back to first IPA found.
 * @param {Array} sounds  — wiktextract sounds array
 * @returns {string|null}
 */
function extractIPA(sounds) {
  if (!Array.isArray(sounds) || sounds.length === 0) return null;

  let fallback = null;

  for (const s of sounds) {
    if (!s.ipa) continue;
    const tags = ((s.tags || []).join(' ')).toLowerCase();

    // US / General American preferred
    if (tags.includes('us') || tags.includes('general-american') || tags.includes('general american')) {
      return s.ipa;
    }
    // Keep first IPA found as fallback (often untagged = General English)
    if (!fallback) fallback = s.ipa;
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Synonym/antonym helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a synonym/antonym item — wiktextract uses either plain strings
 * or objects with a `word` property.
 */
function normWord(item) {
  if (!item) return null;
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object' && item.word) return item.word.trim();
  return null;
}

function uniqueWords(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const result = [];
  for (const item of arr) {
    const w = normWord(item);
    if (w && !seen.has(w)) {
      seen.add(w);
      result.push(w);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Entry stripping
// ---------------------------------------------------------------------------

/**
 * Convert a wiktextract raw entry object into our stripped format.
 *
 * @param {string} word
 * @param {Object[]} posEntries  — array of JSONL lines for the same word
 *   (different POS values: noun, verb, adj…)
 * @returns {Object|null}  stripped entry, or null if unusable
 */
function stripEntry(word, posEntries) {
  if (!posEntries || posEntries.length === 0) return null;

  // Collect all meanings across POS entries
  const meanings = [];

  for (const entry of posEntries) {
    const pos = normalisePos(entry.pos);
    const senses = entry.senses || [];

    for (const sense of senses) {
      const glosses = sense.glosses;
      if (!Array.isArray(glosses) || glosses.length === 0) continue;
      const def = glosses[0];
      if (!def || !def.trim()) continue;

      // Skip meta-definitions (form-of, alternative spelling, etc.)
      if (/^(form of|alternative|misspelling|archaic form|dated form)/i.test(def)) continue;

      const meaning = {
        def: def.trim(),
        speech_part: pos,
      };

      // Example sentence
      const examples = sense.examples || [];
      if (examples.length > 0 && examples[0].text) {
        meaning.example = examples[0].text.trim();
      }

      // Sense-level synonyms
      const senseSyns = uniqueWords(sense.synonyms);
      if (senseSyns.length > 0) meaning.synonyms = senseSyns;

      // Sense-level antonyms
      const senseAnts = uniqueWords(sense.antonyms);
      if (senseAnts.length > 0) meaning.antonyms = senseAnts;

      meanings.push(meaning);
      if (meanings.length >= MAX_MEANINGS) break;
    }

    if (meanings.length >= MAX_MEANINGS) break;
  }

  if (meanings.length === 0) return null;

  const result = { word, meanings };

  // IPA — try all POS entries, use first hit
  for (const entry of posEntries) {
    const ipa = extractIPA(entry.sounds);
    if (ipa) {
      result.ipa = ipa;
      break;
    }
  }

  // Etymology — use first non-empty etymology_text
  for (const entry of posEntries) {
    if (entry.etymology_text && entry.etymology_text.trim()) {
      let etym = entry.etymology_text.trim();
      if (etym.length > MAX_ETYMOLOGY_LENGTH) {
        etym = etym.slice(0, MAX_ETYMOLOGY_LENGTH - 1) + '…';
      }
      result.etymology = etym;
      break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Letter file helpers
// ---------------------------------------------------------------------------

function getLetterFile(word) {
  const ch = word[0].toLowerCase();
  return /^[a-z]$/.test(ch) ? ch : 'misc';
}

// ---------------------------------------------------------------------------
// Memory-efficient entry trimmer
// ---------------------------------------------------------------------------

/**
 * Extract only the fields stripEntry() actually needs before storing in the
 * word map.  A raw kaikki.org entry can be 1-5 KB (with forms, categories,
 * head_templates, inflections …).  This reduces each stored entry to ~100-300
 * bytes, keeping peak heap well under 1 GB for the full English dataset.
 *
 * @param {Object} entry  raw wiktextract JSON object
 * @returns {Object}      minimal object with only pos / senses / sounds / etymology
 */
function miniEntry(entry) {
  const senses = (entry.senses || []).map((s) => {
    const out = {};
    if (Array.isArray(s.glosses) && s.glosses.length > 0) out.glosses = [s.glosses[0]];
    if (Array.isArray(s.examples) && s.examples.length > 0 && s.examples[0].text) {
      out.examples = [{ text: s.examples[0].text }];
    }
    if (Array.isArray(s.synonyms) && s.synonyms.length > 0) out.synonyms = s.synonyms;
    if (Array.isArray(s.antonyms) && s.antonyms.length > 0) out.antonyms = s.antonyms;
    return out;
  });

  const out = { pos: entry.pos, senses };

  // Keep only IPA-bearing sounds, drop audio/rhyme entries
  const ipaSounds = (entry.sounds || []).filter((s) => s.ipa);
  if (ipaSounds.length > 0) {
    out.sounds = ipaSounds.slice(0, 4).map((s) => ({ ipa: s.ipa, tags: s.tags }));
  }

  if (entry.etymology_text) out.etymology_text = entry.etymology_text;

  return out;
}

// ---------------------------------------------------------------------------
// Download helper (streams HTTPS → callback with readable stream)
// ---------------------------------------------------------------------------

function streamURL(url, onStream) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirects
        streamURL(res.headers.location, onStream).then(resolve, reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      onStream(res).then(resolve, reject);
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('WordWorkshop — Wiktionary Data Preparation');
  console.log('===========================================');
  console.log(`Source: ${DOWNLOAD_URL}`);
  console.log(`Output: ${OUT_DIR}\n`);
  console.log('Streaming and parsing JSONL (this may take several minutes)...\n');

  // word → [posEntry, ...]
  const wordMap = new Map();

  let lineCount = 0;
  let skipped = 0;

  await streamURL(DOWNLOAD_URL, (responseStream) => {
    return new Promise((resolve, reject) => {
      // Handle optional gzip compression
      const contentEncoding = responseStream.headers['content-encoding'] || '';
      const stream = contentEncoding.includes('gzip')
        ? responseStream.pipe(zlib.createGunzip())
        : responseStream;

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        lineCount++;
        if (lineCount % 100000 === 0) process.stdout.write(`  Parsed ${(lineCount / 1000).toFixed(0)}k lines...\r`);

        if (!line.trim()) return;

        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          return;
        }

        // Filter to English entries only
        if (entry.lang_code !== 'en') { skipped++; return; }

        const word = (entry.word || '').toLowerCase().trim();
        if (!word || word.length < MIN_WORD_LENGTH) { skipped++; return; }

        // Skip entries with no usable senses
        if (!entry.senses || entry.senses.length === 0) { skipped++; return; }

        // Group by word — store only the minimal fields we need (see miniEntry)
        if (!wordMap.has(word)) wordMap.set(word, []);
        wordMap.get(word).push(miniEntry(entry));
      });

      rl.on('close', resolve);
      rl.on('error', reject);
      stream.on('error', reject);
    });
  });

  console.log(`\nParsed ${lineCount.toLocaleString()} lines, skipped ${skipped.toLocaleString()} non-English.`);
  console.log(`Unique English words: ${wordMap.size.toLocaleString()}\n`);
  console.log('Building and writing letter files...');

  // Group stripped entries by letter
  const letterBuckets = {};

  for (const [word, entries] of wordMap) {
    const stripped = stripEntry(word, entries);
    wordMap.delete(word); // free raw entries immediately so GC can reclaim RAM
    if (!stripped) continue;

    const letter = getLetterFile(word);
    if (!letterBuckets[letter]) letterBuckets[letter] = {};
    letterBuckets[letter][word] = stripped;
  }

  // Write files
  let totalWords = 0;
  let totalBytes = 0;

  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('').concat(['misc']);

  for (const letter of letters) {
    const bucket = letterBuckets[letter] || {};
    const json = JSON.stringify(bucket);
    const outPath = path.join(OUT_DIR, `${letter}.json`);
    fs.writeFileSync(outPath, json);
    const count = Object.keys(bucket).length;
    const bytes = Buffer.byteLength(json);
    totalWords += count;
    totalBytes += bytes;
    console.log(`  ${letter}.json  ${(bytes / 1024 / 1024).toFixed(2)} MB  (${count.toLocaleString()} words)`);
  }

  console.log(`\nDone!`);
  console.log(`  Total words: ${totalWords.toLocaleString()}`);
  console.log(`  Total size:  ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

// Allow importing individual functions for testing
if (require.main === module) {
  main().catch((err) => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { extractIPA, stripEntry, normalisePos, getLetterFile, miniEntry };
