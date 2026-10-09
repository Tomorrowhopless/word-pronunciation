const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function popup({ cache, lookup, writeCache } = {}) {
  const elements = {};
  const element = id => elements[id] ||= { value: '', dataset: {}, children: [], addEventListener() {}, setAttribute() {}, appendChild(child) { this.children.push(child); }, classList: { add() {}, remove() {} } };
  const shown = [];
  const context = vm.createContext({
    api: { runtime: { sendMessage: lookup || (async () => ({})) } },
    LocalStorage: { get: async () => ({}) },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    document: { getElementById: element, createElement: () => element('new'), documentElement: { setAttribute() {} } },
    WordWorkshopPlayback: { bind() {} },
    validateKeyword: value => !!value,
    checkCache: cache || (async () => null),
    setCache: writeCache || (async () => {}),
    setDefinition(entry) { shown.push(entry.word); },
    setMsg(message) { shown.push('error:' + message); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'browserAction/script.js'), 'utf8'), context);
  return { context, shown };
}
const entry = word => ({ entry: { word, dataVersion: '4.7.0', meanings: [] } });

test('slow previous background lookup does not overwrite new popup search', async () => {
  const slow = deferred();
  const f = popup({ lookup: ({ word }) => word === 'apple' ? slow.promise : Promise.resolve(entry(word)) });
  const previous = f.context.searchWord('apple');
  await flush();
  await f.context.searchWord('book');
  slow.resolve(entry('apple'));
  await previous;
  assert.deepEqual(f.shown, ['book']);
});

test('slow previous cache read does not overwrite new popup search', async () => {
  const slow = deferred();
  const f = popup({ cache: word => word === 'apple' ? slow.promise : Promise.resolve({ definition: entry('book').entry }), lookup: async ({ word }) => entry(word) });
  const previous = f.context.searchWord('apple');
  await flush();
  await f.context.searchWord('book');
  slow.resolve({ definition: entry('apple').entry });
  await previous;
  assert.deepEqual(f.shown, ['book']);
});

test('old async cache write cannot redraw old popup result after a new search', async () => {
  const slow = deferred();
  const f = popup({ lookup: async ({ word }) => entry(word), writeCache: word => word === 'apple' ? slow.promise : Promise.resolve() });
  const previous = f.context.searchWord('apple');
  await flush();
  await f.context.searchWord('book');
  slow.resolve();
  await previous;
  assert.deepEqual(f.shown, ['book']);
});

test('Chinese loading failures are displayed but not cached, allowing the next search to recover', async () => {
  let calls = 0;
  const writes = [];
  const f = popup({
    lookup: async () => { calls++; return calls === 1
      ? { entry: { ...entry('apple').entry, translationError: true } }
      : { entry: { ...entry('apple').entry, translation: '苹果' } }; },
    writeCache: async (word, value) => writes.push(value),
  });
  await f.context.searchWord('apple');
  assert.equal(writes.length, 0);
  assert.deepEqual(f.shown, ['apple']);
  await f.context.searchWord('apple');
  assert.equal(calls, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].translation, '苹果');
});

test('cached translation failure or old data version is refreshed from the background', async () => {
  for (const stale of [
    { ...entry('apple').entry, translationError: true },
    { ...entry('apple').entry, dataVersion: '4.1.0', translation: 'old translation' },
  ]) {
    let calls = 0;
    let written;
    const f = popup({
      cache: async () => ({ definition: stale }),
      lookup: async () => { calls++; return { entry: { ...entry('apple').entry, translation: '苹果' } }; },
      writeCache: async (word, value) => { written = value; },
    });
    await f.context.searchWord('apple');
    assert.equal(calls, 1);
    assert.equal(written.translation, '苹果');
    assert.equal(written.dataVersion, '4.7.0');
    assert.deepEqual(f.shown, ['apple']);
  }
});
