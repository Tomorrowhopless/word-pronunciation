#!/usr/bin/env node

/**
 * One-time script to download and strip the Wordset Dictionary data.
 * Downloads 27 JSON files (a-z + misc) from the Wordset GitHub repo,
 * strips metadata fields, and writes stripped files to data/.
 *
 * Usage: node scripts/prepare-wordset.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('').concat(['misc']);
const RAW_BASE =
  'https://raw.githubusercontent.com/wordset/wordset-dictionary/master/data';
const OUT_DIR = path.join(__dirname, '..', 'data');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error for ${url}: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

function stripEntry(entry) {
  return {
    word: entry.word,
    meanings: (entry.meanings || []).map((m) => {
      const stripped = {
        def: m.def,
        speech_part: m.speech_part,
      };
      if (m.example) stripped.example = m.example;
      if (m.synonyms && m.synonyms.length > 0) stripped.synonyms = m.synonyms;
      return stripped;
    }),
  };
}

async function processLetter(letter) {
  const url = `${RAW_BASE}/${letter}.json`;
  console.log(`Downloading ${letter}.json...`);
  const raw = await fetchJSON(url);

  const stripped = {};
  for (const [word, entry] of Object.entries(raw)) {
    stripped[word] = stripEntry(entry);
  }

  const outPath = path.join(OUT_DIR, `${letter}.json`);
  fs.writeFileSync(outPath, JSON.stringify(stripped));
  const sizeMB = (Buffer.byteLength(JSON.stringify(stripped)) / 1024 / 1024).toFixed(2);
  console.log(`  Wrote ${outPath} (${sizeMB} MB, ${Object.keys(stripped).length} words)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Output directory: ${OUT_DIR}\n`);

  let totalWords = 0;
  for (const letter of LETTERS) {
    try {
      await processLetter(letter);
    } catch (err) {
      console.error(`Error processing ${letter}: ${err.message}`);
    }
  }

  // Print total size
  let totalSize = 0;
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (file.endsWith('.json')) {
      totalSize += fs.statSync(path.join(OUT_DIR, file)).size;
    }
  }
  console.log(`\nDone! Total data size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
}

// Allow importing stripEntry for testing
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { stripEntry };
