import { InferenceSession, Tensor, env } from './vendor/onnx/ort.wasm.min.mjs';
import { phonemeIds } from './piper-phonemizer.js';
const api = globalThis.browser || globalThis.chrome;
const base = new URL('./', import.meta.url);
const localURL = path => api?.runtime?.getURL ? api.runtime.getURL(path) : new URL(path, base).href;
env.wasm.wasmPaths = { mjs: localURL('vendor/onnx/ort-wasm-simd-threaded.jsep.mjs'), wasm: localURL('vendor/onnx/ort-wasm-simd-threaded.jsep.wasm') };
env.wasm.numThreads = 1;
env.wasm.proxy = false;
const voices = {
  'Piper Cori': { file: 'models/piper-en/gb/en_GB-cori-high.onnx', config: 'models/piper-en/gb/en_GB-cori-high.onnx.json' },
};
const models = new Map(), audioCache = new Map();
let queue = Promise.resolve(), cachedBytes = 0;
async function fetchLocal(path, format) {
  const response = await fetch(localURL(path));
  if (!response.ok) throw new Error('本机英语语音文件无法读取，请重新加载插件。');
  return format === 'json' ? response.json() : response.arrayBuffer();
}
export function initialize(voiceName = 'Piper Cori') {
  const name = voices[voiceName] ? voiceName : 'Piper Cori';
  if (!models.has(name)) {
    const pending = (async () => {
      const descriptor = voices[name];
      const [data, config] = await Promise.all([fetchLocal(descriptor.file), fetchLocal(descriptor.config, 'json')]);
      const session = await InferenceSession.create(data, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { session, config };
    })().catch(error => { models.delete(name); throw error; });
    models.set(name, pending);
  }
  return models.get(name);
}
export function wavFromSamples(samples, samplingRate = 24000) {
  if (!samples?.length || !Number.isInteger(samplingRate) || samplingRate < 8000 || samplingRate > 192000) throw new Error('本机语音模型没有生成有效音频。');
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const tag = (at, text) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  tag(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, samplingRate, true); view.setUint32(28, samplingRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, samples.length * 2, true);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('本机语音模型生成了无效采样。');
    const value = Math.min(1, Math.max(-1, samples[i])); peak = Math.max(peak, Math.abs(value));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  if (peak < 0.0001) throw new Error('本机语音模型生成的音频没有可用声音。');
  return new Blob([buffer], { type: 'audio/wav' });
}
export function generate(text, { voiceName = 'Piper Cori', rate = 1 } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 240 || /[\u0000-\u001f<>]/.test(text)) return Promise.reject(new Error('没有可朗读的英语文本。'));
  const name = voices[voiceName] ? voiceName : 'Piper Cori';
  const speed = Number.isFinite(Number(rate)) ? Math.min(1.25, Math.max(0.75, Number(rate))) : 1;
  const key = JSON.stringify([text.trim(), name, speed]);
  const pending = queue.catch(() => {}).then(async () => {
    if (audioCache.has(key)) { const blob = audioCache.get(key); audioCache.delete(key); audioCache.set(key, blob); return blob; }
    const { session, config } = await initialize(name);
    const sentences = await phonemeIds(text.trim(), config);
    if (!sentences.length) throw new Error('没有可朗读的英语文本。');
    const samplingRate = config.audio.sample_rate, chunks = [];
    for (const ids of sentences) {
      const feeds = {
        input: new Tensor('int64', BigInt64Array.from(ids, id => BigInt(id)), [1, ids.length]),
        input_lengths: new Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new Tensor('float32', Float32Array.from([config.inference.noise_scale, config.inference.length_scale / speed, config.inference.noise_w]), [3]),
      };
      const result = await session.run(feeds), output = result.output || result[session.outputNames[0]];
      if (!(output?.data instanceof Float32Array) || !output.data.length) throw new Error('本机语音模型没有生成有效音频。');
      chunks.push(output.data);
    }
    const pause = Math.round(samplingRate * 0.08);
    const length = chunks.reduce((total, data) => total + data.length, 0) + Math.max(0, chunks.length - 1) * pause;
    const samples = new Float32Array(length); let offset = 0;
    for (let i = 0; i < chunks.length; i++) { samples.set(chunks[i], offset); offset += chunks[i].length + (i + 1 < chunks.length ? pause : 0); }
    const blob = wavFromSamples(samples, samplingRate);
    audioCache.set(key, blob); cachedBytes += blob.size;
    while (audioCache.size > 32 || cachedBytes > 8 * 1024 * 1024) { const oldest = audioCache.keys().next().value; cachedBytes -= audioCache.get(oldest).size; audioCache.delete(oldest); }
    return blob;
  });
  queue = pending;
  return pending;
}
