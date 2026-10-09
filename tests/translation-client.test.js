const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
function fixture({ Translator, cache = {}, reviewed = {}, storageFails = false, modelMessage, userAgent = '' } = {}) {
  let stored = cache; const writes = []; const listeners = new Map();
  const button = { hidden: false, disabled: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const notice = { textContent: '' }, parent = { children: [], appendChild(e) { this.children.push(e); } };
  const context = vm.createContext({ Translator, TextEncoder, AbortController, navigator: { userAgent }, document: { createElement: () => ({ textContent: '', hidden: false }) }, WordWorkshopReviewedTranslations: reviewed,
    chrome: { runtime: modelMessage ? { sendMessage: modelMessage, getManifest: () => ({ permissions: ['offscreen'] }) } : {}, storage: { local: { get: async () => { if (storageFails) throw Error('storage'); return { sentenceTranslations: stored }; }, set: async value => { if (storageFails) throw Error('storage'); stored = value.sentenceTranslations; writes.push(stored); } } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../translation-client.js'), 'utf8'), context);
  return { client: context.WordWorkshopTranslation, button, notice, parent, writes, click: () => listeners.get('click')?.(), cache: () => stored };
}
function segment(f, source, zh) { return f.client.append(f.parent, source, zh, 'meaning-zh'); }

test('reviewed exact-source translations need no model and labels retain English', async () => {
  const f = fixture({ reviewed: { fruit: '水果', constructor: '构造函数' } });
  const segments = [segment(f, 'fruit'), segment(f, 'other', '人工中文'), segment(f, 'constructor')];
  f.client.bind(segments, f); await flush();
  assert.equal(f.button.hidden, true); assert.equal(f.parent.children[0].textContent, '水果');
  assert.equal(f.parent.children[0].lang, 'zh-CN'); assert.equal(f.client.posLabel('noun'), 'noun（名词）');
  assert.equal(f.client.posLabel('unknown'), 'unknown');
});

test('exact cache coverage skips model and identifies machine translation', async () => {
  const f = fixture({ cache: { fruit: '水果' } }); const s = segment(f, 'fruit');
  f.client.bind([s], f); await flush(); assert.equal(s.element.textContent, '水果');
  assert.equal(f.button.hidden, true); assert.match(f.notice.textContent, /机器翻译/);
});

test('available model translates each sentence into its own slot in sequence', async () => {
  const calls = []; const f = fixture({ Translator: { availability: async () => 'available', create: async () => ({ translate: async text => { calls.push(text); return '中文:' + text; } }) } });
  const s = [segment(f, 'first'), segment(f, 'second')]; f.client.bind(s, f); await flush();
  assert.deepEqual(calls, ['first', 'second']); assert.equal(s[0].element.textContent, '中文:first'); assert.equal(s[1].element.textContent, '中文:second'); assert.equal(f.writes.length, 2);
});

test('downloadable model waits for click and creates directly with compatible progress', async () => {
  let creates = 0, monitor; const gate = deferred();
  const f = fixture({ Translator: { availability: async () => 'downloadable', create: options => { creates++; options.monitor({ addEventListener: (name, fn) => monitor = fn }); return gate.promise; } } });
  const s = segment(f, 'fruit'); f.client.bind([s], f); await flush(); assert.equal(creates, 0); assert.equal(f.button.hidden, false);
  const pending = f.click(); assert.equal(creates, 1);
  monitor({ loaded: 0.4 }); assert.match(f.notice.textContent, /40%/);
  monitor({ loaded: 3, total: 4 }); assert.match(f.notice.textContent, /75%/);
  gate.resolve({ translate: async () => '水果' }); await pending; assert.equal(s.element.hidden, false);
});

test('dispose ignores a late translation and prevents subsequent sentences', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture({ Translator: { availability: async () => 'available', create: async () => ({ translate: () => { calls++; return gate.promise; } }) } });
  const s = [segment(f, 'first'), segment(f, 'second')]; const dispose = f.client.bind(s, f); await flush(); dispose(); gate.resolve('旧中文'); await flush();
  assert.equal(calls, 1); assert.equal(s[0].element.hidden, true); assert.equal(f.writes.length, 0);
});

test('failed creation clears session for a successful retry', async () => {
  let creates = 0; const f = fixture({ Translator: { availability: async () => 'downloadable', create: async () => { if (++creates === 1) throw Error('download'); return { translate: async () => '水果' }; } } });
  const s = segment(f, 'fruit'); f.client.bind([s], f); await flush(); await f.click(); assert.match(f.notice.textContent, /重试/); await f.click(); assert.equal(creates, 2); assert.equal(s.element.textContent, '水果');
});

test('empty translation remains hidden and offers retry without storing empty result', async () => {
  const f = fixture({ Translator: { availability: async () => 'available', create: async () => ({ translate: async () => '  ' }) } });
  const s = segment(f, 'fruit'); f.client.bind([s], f); await flush(); assert.equal(s.element.hidden, true); assert.equal(f.writes.length, 0); assert.match(f.notice.textContent, /重试/);
});

test('storage failure does not suppress completed machine translations', async () => {
  const f = fixture({ storageFails: true, Translator: { availability: async () => 'available', create: async () => ({ translate: async () => '水果' }) } });
  const s = segment(f, 'fruit'); f.client.bind([s], f); await flush(); assert.equal(s.element.textContent, '水果'); assert.equal(s.element.hidden, false);
});

test('cache limits item count and encoded byte size and preserves safe prototype keys', async () => {
  const cache = Object.fromEntries(Array.from({ length: 510 }, (_, i) => ['old' + i, '字'.repeat(1000)]));
  const f = fixture({ cache, Translator: { availability: async () => 'available', create: async () => ({ translate: async () => '原型中文' }) } });
  const s = segment(f, '__proto__'); f.client.bind([s], f); await flush();
  assert.ok(Object.keys(f.cache()).length <= 500); assert.ok(Buffer.byteLength(JSON.stringify(f.cache())) <= 1024 * 1024);
  assert.equal(Object.getOwnPropertyDescriptor(f.cache(), '__proto__').value, '原型中文');
});

test('unsupported API is honest and keeps missing slot hidden', async () => {
  const f = fixture(); const s = segment(f, 'fruit'); f.client.bind([s], f); await flush();
  assert.equal(await f.client.availability(), 'unsupported'); assert.equal(s.element.hidden, true); assert.match(f.notice.textContent, /无法使用/);
});

test('concurrent bindings reuse one session and merge distinct cache writes', async () => {
  let creates = 0;
  const f = fixture({ Translator: { availability: async () => 'available', create: async () => { creates++; return { translate: async text => '中文:' + text }; } } });
  const one = segment(f, 'first'), two = segment(f, 'second');
  f.client.bind([one], { button: f.button, notice: f.notice });
  f.client.bind([two], { notice: { textContent: '' } });
  await flush(); assert.equal(creates, 1); assert.equal(f.cache().first, '中文:first'); assert.equal(f.cache().second, '中文:second');
});

test('dispose while availability is pending never creates a model or touches new slots', async () => {
  const gate = deferred(); let creates = 0;
  const f = fixture({ Translator: { availability: () => gate.promise, create: async () => { creates++; return { translate: async () => '旧中文' }; } } });
  const s = segment(f, 'first'); const dispose = f.client.bind([s], f); await flush(); dispose(); gate.resolve('available'); await flush();
  assert.equal(creates, 0); assert.equal(s.element.hidden, true);
});

test('dispose aborts its pending translation without destroying another binding session', async () => {
  let signal, destroys = 0;
  const f = fixture({ Translator: { availability: async () => 'available', create: async () => ({ destroy() { destroys++; }, translate: (text, options) => {
    signal = options.signal; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted'))));
  } }) } });
  const s = segment(f, 'first'); const dispose = f.client.bind([s], f); await flush(); dispose(); await flush();
  assert.equal(signal.aborted, true); assert.equal(destroys, 0); assert.equal(s.element.hidden, true);
});

test('failed translation destroys retired model and retry creates a fresh session', async () => {
  let creates = 0, destroys = 0;
  const f = fixture({ Translator: { availability: async () => 'available', create: async () => {
    const attempt = ++creates; return { destroy() { destroys++; }, translate: async () => { if (attempt === 1) throw Error('failed'); return '中文'; } };
  } } });
  const s = segment(f, 'first'); f.client.bind([s], f); await flush(); assert.equal(destroys, 1);
  await f.click(); assert.equal(creates, 2); assert.equal(s.element.textContent, '中文');
});

test('Edge uses packaged model without calling broken native translator', async () => {
  const messages = []; let nativeCalls = 0;
  const f = fixture({ userAgent: 'Edg/154.0', Translator: { create: async () => { nativeCalls++; throw Error('NotSupported'); }, availability: async () => 'downloadable' },
    modelMessage: async message => { messages.push(message.action); return message.action === 'local-model-translate' ? { ok: true, text: '本机中文' } : { ok: true }; } });
  const s = segment(f, 'unknown definition'); f.client.bind([s], f); await flush();
  assert.equal(nativeCalls, 0); assert.equal(s.element.textContent, '本机中文'); assert.deepEqual(messages, ['local-model-ready', 'local-model-translate']);
});

test('native creation failure falls back to packaged model and model failures remain visible', async () => {
  const f = fixture({ Translator: { create: async () => { throw Error('NotSupported'); }, availability: async () => 'available' }, modelMessage: async () => ({ ok: false, error: 'model missing' }) });
  const s = segment(f, 'unknown'); f.client.bind([s], f); await flush(); assert.equal(s.element.hidden, true); assert.match(f.notice.textContent, /重试/); assert.equal(f.writes.length, 0);
});

test('native translation failure falls back to packaged sentence translation', async () => {
  let destroyed = 0;
  const f = fixture({ Translator: { create: async () => ({ destroy() { destroyed++; }, translate: async () => { throw Error('native'); } }), availability: async () => 'available' }, modelMessage: async message => message.action === 'local-model-translate' ? { ok: true, text: '离线中文' } : { ok: true } });
  const s = segment(f, 'unknown'); f.client.bind([s], f); await flush(); assert.equal(s.element.textContent, '离线中文'); assert.equal(destroyed, 1);
});

test('packaged model bypasses native downloadable or downloading packs without invoking native create', async () => {
  for (const state of ['downloadable', 'downloading', 'unavailable']) {
    let creates = 0; const messages = [];
    const f = fixture({ Translator: { availability: async () => state, create: async () => { creates++; throw Error('would download'); } }, modelMessage: async message => { messages.push(message.action); return { ok: true, text: '离线中文' }; } });
    const session = await f.client.prepare();
    assert.equal(await session.translate('a sentence'), '离线中文');
    assert.equal(creates, 0); assert.deepEqual(messages, ['local-model-ready', 'local-model-translate']);
  }
});

test('packaged model still permits an already available native model', async () => {
  let creates = 0, packaged = 0;
  const f = fixture({ Translator: { availability: async () => 'available', create: async () => { creates++; return { translate: async () => '原生中文' }; } }, modelMessage: async () => { packaged++; return { ok: true }; } });
  const session = await f.client.prepare(); assert.equal(await session.translate('text'), '原生中文'); assert.equal(creates, 1); assert.equal(packaged, 0);
});
