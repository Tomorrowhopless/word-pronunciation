const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');

function background(fetcher) {
  let handler;
  const api = { runtime: { getURL: p => p, onMessage: { addListener: fn => handler = fn } } };
  const context = vm.createContext({ chrome: api, fetch: fetcher, Response, DecompressionStream, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
  return { context, handler };
}
const packedResponse = letter => new Response(gzipSync(Buffer.from(JSON.stringify({
  [letter]: { word: letter, meanings: [{ def: 'Test entry', speech_part: 'noun' }] },
}))));

test('compressed dictionary loads locally and evicts old letters after two buckets', async () => {
  const fetched = [];
  const { context } = background(async url => { fetched.push(url); return url.startsWith('data/zh/') ? new Response(gzipSync(Buffer.from(JSON.stringify({})))) : packedResponse(url[5]); });
  for (const word of ['a', 'b', 'a', 'c', 'b']) {
    const result = await context.lookupWord(word);
    assert.equal(result.entry.word, word);
  }
  assert.deepEqual(fetched, ['data/a.json.gz', 'data/zh/a.json.gz', 'data/b.json.gz', 'data/zh/b.json.gz', 'data/c.json.gz', 'data/zh/c.json.gz', 'data/b.json.gz', 'data/zh/b.json.gz']);
});

test('parallel lookups share one read per English and Chinese bucket', async () => {
  let calls = 0;
  const { context } = background(async () => { calls++; return packedResponse('a'); });
  const results = await Promise.all([context.lookupWord('a'), context.lookupWord('a')]);
  assert.equal(calls, 2);
  assert.equal(results[1].entry.word, 'a');
});

test('missing dictionary is reported as a data error instead of a word miss', async () => {
  const { handler } = background(async () => new Response('', { status: 404 }));
  const result = await new Promise(resolve => handler({ action: 'lookup', word: 'apple' }, {}, resolve));
  assert.equal(result.error, 'dictionary-unavailable');
});

test('lookup does not return Object prototype properties as dictionary entries', async () => {
  const { context } = background(async () => packedResponse('c'));
  const result = await context.lookupWord('constructor');
  assert.equal(result.entry, null);
});

const jsonResponse = value => new Response(gzipSync(Buffer.from(JSON.stringify(value))));

test('Chinese is attached by exact word without replacing original English senses or IPA', async () => {
  const english = { apple: { word: 'apple', ipa: '/apple/', meanings: [{ def: 'fruit', speech_part: 'noun', example: 'Eat an apple.' }] } };
  const chinese = { apple: { translation: 'n. 苹果', phonetic: 'apple', definition: 'other definition' } };
  const { context } = background(async url => jsonResponse(url.startsWith('data/zh/') ? chinese : english));
  const result = JSON.parse(JSON.stringify(await context.lookupWord('APPLE')));
  assert.equal(result.entry.translation, 'n. 苹果');
  assert.equal(result.entry.translationWord, 'apple');
  assert.equal(result.entry.translationSource, 'ECDICT');
  assert.equal(result.entry.ipa, '/apple/');
  assert.deepEqual(result.entry.meanings, english.apple.meanings);
});

test('Chinese-only word returns honest ECDICT fallback including empty English definitions', async () => {
  const { context } = background(async url => jsonResponse(url.startsWith('data/zh/') ? {
    acme: { translation: '最高点', phonetic: 'akmi', definition: '' },
  } : {}));
  const result = await context.lookupWord('acme');
  assert.equal(result.entry.translation, '最高点');
  assert.equal(result.entry.meaningsSource, 'ecdict');
  assert.equal(result.entry.meanings.length, 0);
  assert.equal(result.entry.phonetic, 'akmi');
  assert.equal(result.entry.ipa, '');
});

test('missing Chinese file preserves English and flags a loading failure', async () => {
  const { context } = background(async url => url.startsWith('data/zh/') ? new Response('', { status: 404 }) : jsonResponse({
    apple: { word: 'apple', meanings: [{ def: 'fruit', speech_part: 'noun' }] },
  }));
  const result = await context.lookupWord('apple');
  assert.equal(result.entry.word, 'apple');
  assert.equal(result.entry.translationError, true);
  assert.equal(result.entry.meanings[0].def, 'fruit');
});

test('inflection Chinese fallback identifies the referenced stem', async () => {
  const { context } = background(async url => jsonResponse(url.startsWith('data/zh/') ? {
    cat: { translation: '猫', phonetic: '', definition: '' },
  } : { cats: { word: 'cats', meanings: [{ def: 'plural cats', speech_part: 'noun' }] } }));
  const result = await context.lookupWord('cats');
  assert.equal(result.entry.word, 'cats');
  assert.equal(result.entry.translation, '猫');
  assert.equal(result.entry.translationWord, 'cat');
});

test('missing Chinese data without an English entry reports a load error rather than not found', async () => {
  const { context } = background(async url => url.startsWith('data/zh/')
    ? new Response('', { status: 404 }) : jsonResponse({}));
  const result = await context.lookupWord('acme');
  assert.equal(result.entry, null);
  assert.equal(result.error, 'chinese-dictionary-unavailable');
});

test('local run correction teaches ran and removes the incorrect past-tense wording', async () => {
  const { context } = background(async url => new Response(fs.readFileSync(path.join(__dirname, '..', url))));
  const result = await context.lookupWord('run');
  assert.ok(result.entry.translation.includes('过去式：ran；过去分词：run。'));
  assert.ok(!result.entry.translation.includes('run的过去式和过去分词'));
});
