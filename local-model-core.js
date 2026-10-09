import { pipeline, env } from './vendor/transformers/transformers.min.js';
const api = globalThis.browser || globalThis.chrome;
const base = new URL('./', import.meta.url);
const localURL = path => api?.runtime?.getURL ? api.runtime.getURL(path) : new URL(path, base).href;
env.allowRemoteModels = false;
env.allowLocalModels = true;
// The model is already packaged on disk; keep only the live in-memory pipeline.
env.useBrowserCache = false;
env.useFSCache = false;
env.localModelPath = localURL('models/');
env.backends.onnx.wasm.wasmPaths = localURL('vendor/onnx/');
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let initializing, queue = Promise.resolve();
const cancelled = new Set();
function initialize() {
  if (!initializing) initializing = pipeline('translation', 'opus-mt-en-zh', { dtype: 'int8', device: 'wasm' }).catch(error => { initializing = null; throw error; });
  return initializing;
}
function translate(text, requestId) {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) return Promise.reject(new Error('句子过长或为空，无法生成中文。'));
  const result = queue.catch(() => {}).then(async () => {
    if (cancelled.has(requestId)) throw new Error('翻译已取消。');
    const model = await initialize();
    if (cancelled.has(requestId)) throw new Error('翻译已取消。');
    const output = await model('>>cmn_Hans<< ' + text, { max_new_tokens: 256, num_beams: 1 });
    if (cancelled.has(requestId)) throw new Error('翻译已取消。');
    const translation = output?.[0]?.translation_text;
    if (typeof translation !== 'string' || !translation.trim()) throw new Error('本机模型没有返回中文，请重试。');
    return { ok: true, text: translation.trim() };
  }).finally(() => cancelled.delete(requestId));
  queue = result;
  return result;
}
export function cancel(requestId) { cancelled.add(requestId); if (cancelled.size > 1000) cancelled.delete(cancelled.values().next().value); }
export { initialize, translate };
