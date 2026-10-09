const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };

test('standalone dictionary worker imports real background and reads packaged English/Chinese gzip without extension APIs', async () => {
  const messages = [], fetched = [], imports = [];
  const context = vm.createContext({ URL, Response, DecompressionStream, console,
    location: { href: 'https://example.test/project/web/dictionary-worker.js' },
    postMessage: message => messages.push(message),
    fetch: async url => {
      const pathname = new URL(url).pathname;
      assert.ok(pathname.startsWith('/project/data/'));
      fetched.push(pathname);
      return new Response(fs.readFileSync(path.join(root, pathname.slice('/project/'.length))));
    },
    speechSynthesis: new Proxy({}, { get() { throw Error('System speech must not be used'); } }),
  });
  context.self = context;
  context.importScripts = name => { imports.push(name); vm.runInContext(read('web/' + name), context); };
  vm.runInContext(read('web/dictionary-worker.js'), context);
  for (const [id, word, chinese] of [[1, 'apple', /苹果/], [2, 'education', /教育/]]) {
    await context.onmessage({ data: { id, word } });
    const response = messages.at(-1);
    assert.equal(response.id, id); assert.equal(response.error, undefined);
    assert.equal(response.result.entry.word.toLowerCase(), word);
    assert.ok(response.result.entry.meanings.length > 0);
    assert.match(response.result.entry.translation, chinese);
  }
  assert.deepEqual(imports, ['../background.js']);
  assert.ok(fetched.some(url => url.endsWith('/a.json.gz')));
  assert.ok(fetched.some(url => url.endsWith('/zh/e.json.gz')));
});

test('explicit standalone provider translates separate slots without runtime/native APIs and cancels disposed work', async () => {
  const calls = [], signals = [], writes = [], listeners = new Map();
  let lateResolve;
  const context = vm.createContext({ AbortController, TextEncoder,
    document: { createElement: () => ({ hidden: false, textContent: '' }) },
    WordWorkshopWebStorage: { get: async () => ({}), set: async value => writes.push(value) },
    WordWorkshopWeb: { translation: {
      availability: async () => 'available', prepare: async () => ({ translate: async (text, { signal }) => {
        calls.push(text); signals.push(signal);
        return text === 'late sentence' ? new Promise(resolve => { lateResolve = resolve; }) : '中译：' + text;
      } }),
    } },
  });
  vm.runInContext(read('translation-client.js'), context);
  const parent = { children: [], appendChild(element) { this.children.push(element); } };
  const button = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const notice = { textContent: '' }, client = context.WordWorkshopTranslation;
  const segments = ['a definition', 'an example'].map(text => client.append(parent, text));
  const dispose = client.bind(segments, { button, notice }); await flush();
  assert.deepEqual(calls, ['a definition', 'an example']);
  assert.equal(segments[0].element.textContent, '中译：a definition');
  assert.equal(segments[1].element.textContent, '中译：an example');
  assert.match(notice.textContent, /机器翻译/); dispose();
  const late = client.append(parent, 'late sentence');
  const cancel = client.bind([late], { button, notice }); await flush();
  assert.ok(lateResolve); const before = writes.length; cancel();
  assert.equal(signals.at(-1).aborted, true); lateResolve('不能显示的旧结果'); await flush();
  assert.equal(late.element.hidden, true); assert.equal(writes.length, before);
});

test('standalone model-client rejects all pending requests after worker failure and creates a fresh worker', async () => {
  const workers = [];
  class Worker {
    constructor(url, options) { this.url = url; this.options = options; this.sent = []; workers.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
  }
  const context = vm.createContext({ Worker, URL, setTimeout, clearTimeout });
  vm.runInContext(read('web/model-client.js').replace('export function', 'function').replaceAll('import.meta.url', '"https://example.test/project/web/model-client.js"') + '\nglobalThis.createModelClient = createModelClient;', context);
  const client = context.createModelClient();
  const first = client.request('prepare'), second = client.request('translate', { text: 'apple' });
  const firstFailure = assert.rejects(first, /模型服务无法启动/), secondFailure = assert.rejects(second, /模型服务无法启动/);
  workers[0].onerror(); await Promise.all([firstFailure, secondFailure]);
  assert.equal(workers[0].terminated, true);
  const retry = client.request('prepare'); assert.equal(workers.length, 2);
  assert.equal(workers[1].options.type, 'module');
  workers[1].onmessage({ data: { id: workers[1].sent[0].id, result: { ok: true } } });
  assert.equal((await retry).ok, true); client.close(); assert.equal(workers[1].terminated, true);
});

test('model-client cleans concurrent tasks on send/message failures and ignores stale worker errors after recovery', async () => {
  const workers = [], timers = new Set();
  class Worker {
    constructor() { this.sent = []; workers.push(this); }
    postMessage(message) { if (this.failSend) throw Error('clone failed'); this.sent.push(message); }
    terminate() { this.terminated = true; }
  }
  const context = vm.createContext({ Worker, URL,
    setTimeout: callback => { const timer = { callback }; timers.add(timer); return timer; },
    clearTimeout: timer => timers.delete(timer),
  });
  vm.runInContext(read('web/model-client.js').replace('export function', 'function').replaceAll('import.meta.url', '"https://example.test/project/web/model-client.js"') + '\nglobalThis.createModelClient = createModelClient;', context);
  const client = context.createModelClient();
  const first = client.request('prepare');
  const firstRejected = assert.rejects(first, /请求无法发送/);
  workers[0].failSend = true;
  const failedSend = client.request('translate', { text: 'apple' });
  await Promise.all([firstRejected, assert.rejects(failedSend, /请求无法发送/)]);
  assert.equal(timers.size, 0); assert.equal(workers[0].terminated, true);
  const a = client.request('prepare'), b = client.request('translate', { text: 'education' });
  const rejected = [assert.rejects(a, /响应无法读取/), assert.rejects(b, /响应无法读取/)];
  workers[1].onmessageerror(); await Promise.all(rejected);
  assert.equal(timers.size, 0); assert.equal(workers[1].terminated, true);
  const recovered = client.request('prepare'); const current = workers[2];
  workers[0].onerror(); workers[1].onmessageerror();
  assert.equal(current.terminated, undefined); assert.equal(timers.size, 1);
  current.onmessage({ data: { id: current.sent[0].id, result: { ok: true } } });
  assert.equal((await recovered).ok, true); assert.equal(timers.size, 0); client.close();
});
