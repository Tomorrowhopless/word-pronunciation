const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('bridge coalesces document creation and targets only model document', async () => {
  let creates = 0; const messages = [];
  const context = vm.createContext({ setTimeout, chrome: { runtime: { getURL: p => p, getContexts: async () => [], sendMessage: async msg => { messages.push(msg); return { ok: true, text: '中文' }; } }, offscreen: { createDocument: async options => { creates++; assert.deepEqual(Array.from(options.reasons), ['WORKERS', 'BLOBS']); } } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'model-bridge.js'), 'utf8'), context);
  await Promise.all([context.WordWorkshopLocalModel.ready(), context.WordWorkshopLocalModel.translate('text', 'id')]);
  assert.equal(creates, 1); assert.ok(messages.every(m => m.target === 'wordworkshop-model-document'));
});

function documentFixture(pipeline) {
  let listener; const env = { backends: { onnx: { wasm: {} } } };
  const context = vm.createContext({ env, pipeline, URL, chrome: { runtime: { getURL: p => 'chrome-extension://id/' + p, onMessage: { addListener: fn => listener = fn } } } });
  const core = fs.readFileSync(path.join(root, 'local-model-core.js'), 'utf8').replace(/^import .*;\n/, '').replace("import.meta.url", "'https://localhost/local-model-core.js'").replace(/export /g, '').replace(/\{ initialize, translate \};/, '');
  const listenerCode = fs.readFileSync(path.join(root, 'local-model.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('const api = globalThis.browser || globalThis.chrome;', '');
  const code = core + '\n' + listenerCode;
  vm.runInContext(code, context);
  return { env, request: (action, extras = {}) => new Promise(resolve => listener({ target: 'wordworkshop-model-document', action, ...extras }, {}, resolve)), listener };
}

test('document uses packaged WASM files, no remote model, init coalescing and serial sentences', async () => {
  let initializing = 0, active = 0, peak = 0; const inputs = [];
  const f = documentFixture(async (task, model, options) => {
    initializing++; assert.equal(model, 'opus-mt-en-zh'); assert.equal(options.dtype, 'int8'); assert.equal(options.device, 'wasm');
    return async (source, options) => { active++; peak = Math.max(peak, active); inputs.push(source); await Promise.resolve(); active--; assert.equal(options.max_new_tokens, 256); return [{ translation_text: '中文:' + source }]; };
  });
  assert.equal(f.env.allowRemoteModels, false); assert.equal(f.env.allowLocalModels, true); assert.equal(f.env.backends.onnx.wasm.numThreads, 1);
  assert.equal(f.env.backends.onnx.wasm.wasmPaths, 'chrome-extension://id/vendor/onnx/');
  const results = await Promise.all([f.request('model-ready'), f.request('model-translate', { text: 'first', requestId: '1' }), f.request('model-translate', { text: 'second', requestId: '2' })]);
  assert.equal(initializing, 1); assert.equal(peak, 1); assert.equal(results[2].ok, true); assert.deepEqual(inputs, ['>>cmn_Hans<< first', '>>cmn_Hans<< second']);
  assert.equal(f.listener({ action: 'local-model-ready' }, {}, () => { throw Error('wrong target'); }), undefined);
});

test('document reports model failure and empty results honestly and retries initialization', async () => {
  let attempts = 0; const f = documentFixture(async () => { if (++attempts === 1) throw Error('missing model'); return async () => [{ translation_text: '' }]; });
  assert.equal((await f.request('model-ready')).ok, false);
  assert.equal((await f.request('model-ready')).ok, true);
  assert.equal((await f.request('model-translate', { text: 'text', requestId: 'id' })).ok, false);
  assert.equal((await f.request('model-translate', { text: 'x'.repeat(2001), requestId: 'long' })).ok, false);
});

test('document skips cancelled queued sentences', async () => {
  let calls = 0; const f = documentFixture(async () => async () => { calls++; return [{ translation_text: '中文' }]; });
  await f.request('model-cancel', { requestId: 'id' });
  assert.equal((await f.request('model-translate', { text: 'text', requestId: 'id' })).ok, false); assert.equal(calls, 0);
});

test('background routes model client requests and does not answer its own targeted messages', async () => {
  let handler, calls = 0;
  const context = vm.createContext({ chrome: { runtime: { onMessage: { addListener: fn => handler = fn } } }, WordWorkshopLocalModel: { ready: async () => { calls++; return { ok: true }; }, translate: async () => { throw Error('failed'); } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  assert.equal(handler({ target: 'wordworkshop-model-document', action: 'model-ready' }, {}, () => { throw Error('loop'); }), undefined);
  const ready = await new Promise(resolve => assert.equal(handler({ action: 'local-model-ready' }, {}, resolve), true));
  assert.equal(ready.ok, true); assert.equal(calls, 1);
  const failed = await new Promise(resolve => handler({ action: 'local-model-translate', text: 'text' }, {}, resolve));
  assert.equal(failed.ok, false); assert.match(failed.error, /本机中文模型/);
});

test('formal model core resolves localhost assets without extension runtime or remote hosts', async () => {
  const env = { backends: { onnx: { wasm: {} } } };
  const context = vm.createContext({ env, URL, pipeline: async () => async () => [{ translation_text: '中文' }] });
  const core = fs.readFileSync(path.join(root, 'local-model-core.js'), 'utf8').replace(/^import .*;\n/, '').replace('import.meta.url', "'http://localhost:8765/local-model-core.js'").replace(/export /g, '').replace(/\{ initialize, translate \};/, '');
  vm.runInContext(core, context);
  assert.equal(env.localModelPath, 'http://localhost:8765/models/');
  assert.equal(env.backends.onnx.wasm.wasmPaths, 'http://localhost:8765/vendor/onnx/');
  assert.equal(env.allowRemoteModels, false);
  assert.equal((await context.translate('A simple sentence.', 'probe')).text, '中文');
});
