'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'local-speech-core.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/import\.meta\.url/g, JSON.stringify('https://local.invalid/local-speech-core.js'))
  .replace(/export function /g, 'function ') + '\n globalThis.core={initialize,generate,wavFromSamples};';
function fixture({ load, generate } = {}) {
  const calls = [], feeds = [], fetched = []; let loads = 0, currentText;
  const env = { wasm: {} };
  const context = vm.createContext({ URL, Blob, Float32Array, BigInt64Array, env,
    fetch: async url => { fetched.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), json: async () => ({audio:{sample_rate:22050}, inference:{noise_scale:0.667,length_scale:1,noise_w:0.8}, model:url.includes('/gb/')?'gb':'us'}) }; },
    phonemeIds: async (text, config) => {currentText=text; calls.push({text,options:{voice:config.model}});return [[1,4,0,2]];},
    Tensor: class Tensor {constructor(type,data,dims){Object.assign(this,{type,data,dims});}},
    InferenceSession: { create: async () => {
      loads++; if (load) await load(loads);
      return { outputNames:['output'], run: async inputs => {feeds.push(inputs);const result=generate?await generate(currentText,inputs):{audio:[0,-0.5,0.5]};return {output:{data:Float32Array.from(result.audio)}};} };
    } },
  });
  vm.runInContext(source, context);
  return { core: context.core, env, calls, feeds, fetched, get loads() { return loads; } };
}
test('generated WAV has valid mono PCM header and signed, clipped sample data', async () => {
  const f = fixture(), blob = f.core.wavFromSamples([-2, -0.5, 0, 0.5, 2], 24000);
  const data = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav'); assert.equal(blob.size, 54);
  assert.equal(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 4)), 'RIFF');
  assert.equal(data.getUint32(4, true), 46); assert.equal(data.getUint16(20, true), 1);
  assert.equal(data.getUint16(22, true), 1); assert.equal(data.getUint32(24, true), 24000);
  assert.equal(data.getUint32(40, true), 10);
  assert.deepEqual([44, 46, 48, 50, 52].map(at => data.getInt16(at, true)), [-32768, -16384, 0, 16384, 32767]);
});
test('silent, non-finite and invalid-rate output cannot masquerade as successful audio', () => {
  const f = fixture();
  for (const [samples, rate] of [[[0, 0], 24000], [[NaN], 24000], [[Infinity], 24000], [[0.5], 0], [[0.5], -1], [[0.5], 24000.5]]) {
    assert.throws(() => f.core.wavFromSamples(samples, rate));
  }
});
test('default and legacy voice requests use Cori and its cache while a new rate regenerates', async () => {
  const f = fixture();
  const first = await f.core.generate(' apple ');
  assert.equal(await f.core.generate('apple'), first);
  assert.equal(await f.core.generate('apple', { voiceName: 'Piper Cori' }), first);
  assert.equal(await f.core.generate('apple', { voiceName: 'Piper LJSpeech' }), first);
  await f.core.generate('apple', { rate: 1.1 });
  assert.equal(f.calls.length, 2); assert.equal(f.loads, 1);
  assert.equal(f.calls[1].options.voice, 'gb');
  assert.ok(f.fetched.every(url=>url.startsWith('https://local.invalid/models/piper-en/gb/'))); assert.equal(f.env.wasm.numThreads, 1); assert.equal(f.env.wasm.proxy, false);
});
test('audio cache evicts old entries and remains bounded to 32 utterances', async () => {
  const f = fixture();
  for (let i = 0; i < 33; i++) await f.core.generate('word ' + i);
  await f.core.generate('word 32'); assert.equal(f.calls.length, 33);
  await f.core.generate('word 0'); assert.equal(f.calls.length, 34);
});
test('failed model initialization can retry and does not poison subsequent inference', async () => {
  const f = fixture({ load: async count => { if (count === 1) throw new Error('bad load'); } });
  await assert.rejects(f.core.generate('apple'), /bad load/);
  assert.ok((await f.core.generate('book')).size > 44); assert.equal(f.loads, 2);
});
test('inference stays serial when multiple words arrive together', async () => {
  let active = 0, peak = 0;
  const f = fixture({ generate: async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return { audio: [0.25], sampling_rate: 24000 }; } });
  await Promise.all([f.core.generate('apple'), f.core.generate('book'), f.core.generate('camera')]);
  assert.equal(peak, 1); assert.equal(f.calls.length, 3);
});

test('Piper feeds preserve phoneme IDs and map spoken speed to inverse duration', async () => {
 const f=fixture(); await f.core.generate('apple',{rate:1.25}); const feed=f.feeds[0];
 assert.equal(feed.input.type,'int64');assert.deepEqual(Array.from(feed.input.data),[1n,4n,0n,2n]);
 assert.deepEqual(Array.from(feed.input.dims),[1,4]);assert.equal(feed.input_lengths.data[0],4n);
 assert.equal(feed.scales.type,'float32');assert.ok(Math.abs(feed.scales.data[1]-0.8)<1e-6);
 assert.ok(!('sid' in feed));
});
