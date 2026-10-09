(function (root) {
  'use strict';
  const MAX_ITEMS = 500, MAX_BYTES = 1024 * 1024;
  let sessionPromise, writeQueue = Promise.resolve();
  const activeSessions = new Map(), retiredSessions = new Set();
  function releaseSession(session) {
    const count = (activeSessions.get(session) || 1) - 1;
    if (count) activeSessions.set(session, count);
    else { activeSessions.delete(session); if (retiredSessions.delete(session)) { try { session.destroy?.(); } catch {} } }
  }
  const api = root.browser || root.chrome;
  const standalone = () => root.WordWorkshopWeb?.translation;
  const storage = () => api?.storage?.local || root.WordWorkshopWebStorage;
  function posLabel(part) {
    const labels = { noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', pronoun: '代词', preposition: '介词', conjunction: '连词', interjection: '感叹词', article: '冠词', determiner: '限定词', numeral: '数词', phrase: '短语', abbreviation: '缩写' };
    const value = String(part || '');
    return labels[value.toLowerCase()] ? value + '（' + labels[value.toLowerCase()] + '）' : value;
  }
  const valid = value => typeof value === 'string' && value.trim().length > 0;
  function append(parent, source, reviewedZh, className) {
    const element = root.document.createElement('div');
    element.className = className || 'translation'; element.lang = 'zh-CN';
    const map = root.WordWorkshopReviewedTranslations;
    const translation = valid(reviewedZh) ? reviewedZh : map && Object.hasOwn(map, source) ? map[source] : '';
    const reviewed = valid(translation);
    element.textContent = reviewed ? translation : ''; element.hidden = !reviewed;
    parent.appendChild(element);
    return { source, element, reviewed };
  }
  const packagedAvailable = () => !!(api?.runtime?.sendMessage && api.runtime.getManifest?.().permissions?.includes('offscreen'));
  const isEdge = () => /Edg\//.test(root.navigator?.userAgent || '');
  let modelSerial = 0;
  async function packagedSession() {
    const result = await api.runtime.sendMessage({ action: 'local-model-ready' });
    if (!result?.ok) throw new Error(result?.error || '本机翻译模型未加载。');
    return { async translate(source, { signal } = {}) {
      if (signal?.aborted) throw new Error('翻译已取消。');
      const requestId = Date.now() + '-' + (++modelSerial) + '-' + Math.random().toString(36).slice(2);
      const cancel = () => { api.runtime.sendMessage({ action: 'local-model-cancel', requestId }).catch(() => {}); };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const response = await api.runtime.sendMessage({ action: 'local-model-translate', text: source, requestId });
        if (signal?.aborted) throw new Error('翻译已取消。');
        if (!response?.ok || !valid(response.text)) throw new Error(response?.error || '本机翻译未返回中文。');
        return response.text;
      } finally { signal?.removeEventListener('abort', cancel); }
    }, destroy() {} };
  }
  async function availability() {
    if (standalone()) return standalone().availability();
    if (packagedAvailable() && isEdge()) return 'available';
    if (!root.Translator || typeof root.Translator.create !== 'function') return packagedAvailable() ? 'available' : 'unsupported';
    if (typeof root.Translator.availability !== 'function') return packagedAvailable() ? 'available' : 'unavailable';
    try {
      const state = await root.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'zh' });
      return packagedAvailable() && state !== 'available' ? 'available' : state;
    } catch (error) { if (packagedAvailable()) return 'available'; throw error; }
  }
  function createNative(onProgress) {
    return Promise.resolve(root.Translator.create({ sourceLanguage: 'en', targetLanguage: 'zh', monitor(m) {
      m.addEventListener('downloadprogress', event => {
        const ratio = event.total > 0 ? event.loaded / event.total : event.loaded;
        if (Number.isFinite(ratio)) onProgress?.(Math.min(1, Math.max(0, ratio)));
      });
    } })).then(native => {
      if (!packagedAvailable()) return native;
      let fallback;
      return { async translate(source, options) {
        if (fallback) return (await fallback).translate(source, options);
        try { return await native.translate(source, options); }
        catch (error) { if (options?.signal?.aborted) throw error; try { native.destroy?.(); } catch {} fallback = packagedSession(); return (await fallback).translate(source, options); }
      }, destroy() { native.destroy?.(); } };
    });
  }
  function prepare({ onProgress } = {}) {
    if (standalone()) return standalone().prepare({ onProgress });
    if (!sessionPromise) {
      if (packagedAvailable()) {
        sessionPromise = (async () => {
          // The packaged engine needs no network. Only select already-ready native packs.
          if (!isEdge() && root.Translator?.create && root.Translator?.availability) {
            try {
              if (await root.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'zh' }) === 'available') return await createNative(onProgress);
            } catch { /* Use the bundled model when native availability or creation fails. */ }
          }
          return packagedSession();
        })().catch(error => { sessionPromise = null; throw error; });
      } else {
        // Without a packaged model, create synchronously within the initiating click.
        if (!root.Translator?.create) return Promise.reject(new Error('当前浏览器不支持本机逐句翻译。'));
        try { sessionPromise = createNative(onProgress).catch(error => { sessionPromise = null; throw error; }); }
        catch (error) { sessionPromise = null; return Promise.reject(error); }
      }
    }
    return sessionPromise;
  }
  function cacheMap(value) {
    const result = new Map();
    if (value && typeof value === 'object') for (const [key, text] of Object.entries(value)) if (valid(key) && valid(text)) result.set(key, text);
    return result;
  }
  function bounded(cache) {
    while (cache.size > MAX_ITEMS) cache.delete(cache.keys().next().value);
    let output = Object.fromEntries(cache);
    const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
    while (cache.size && bytes(output) > MAX_BYTES) { cache.delete(cache.keys().next().value); output = Object.fromEntries(cache); }
    return output;
  }
  async function readCache() {
    try { return cacheMap((await storage()?.get('sentenceTranslations'))?.sentenceTranslations); } catch { return new Map(); }
  }
  function save(source, text) {
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      try {
        const cache = await readCache(); cache.delete(source); cache.set(source, text);
        await storage()?.set({ sentenceTranslations: bounded(cache) });
      } catch { /* Storage failure does not remove the displayed translation. */ }
    });
    return writeQueue;
  }
  function bind(segments, { button, notice }) {
    let disposed = false, running = false, controller;
    const missing = () => segments.filter(s => !s.reviewed && !valid(s.element.textContent) && valid(s.source));
    const status = text => { if (!disposed && notice) notice.textContent = text; };
    const showButton = visible => { if (!disposed && button) button.hidden = !visible; };
    async function translate() {
      if (disposed || running) return;
      running = true; if (button) button.disabled = true;
      status('准备本机中文翻译…');
      let translator, usedPromise;
      controller = new AbortController();
      try {
        // Do not await availability before create: preserve the initiating click's activation.
        usedPromise = prepare({ onProgress: ratio => status('首次语言包下载：' + Math.round(ratio * 100) + '%') });
        translator = await usedPromise;
        activeSessions.set(translator, (activeSessions.get(translator) || 0) + 1);
        for (const segment of missing()) {
          if (disposed) break;
          const text = await translator.translate(segment.source, { signal: controller.signal });
          if (disposed) break;
          if (!valid(text)) throw new Error('翻译结果为空');
          segment.element.textContent = text.trim(); segment.element.hidden = false;
          status('中文为本机机器翻译');
          await save(segment.source, text.trim());
        }
        if (!disposed) showButton(missing().length > 0);
      } catch {
        if (!disposed) {
          if (sessionPromise === usedPromise) sessionPromise = null;
          if (translator) retiredSessions.add(translator);
        }
        if (!disposed) { showButton(true); status('中文翻译未完成，可点击“生成中文”重试。英文仍可阅读。'); }
      } finally { if (translator) releaseSession(translator); running = false; if (!disposed && button) button.disabled = false; }
    }
    const clicked = () => translate();
    button?.addEventListener('click', clicked);
    showButton(false);
    (async () => {
      const cache = await readCache();
      if (disposed) return;
      let usedCache = false;
      for (const segment of missing()) if (cache.has(segment.source)) {
        segment.element.textContent = cache.get(segment.source); segment.element.hidden = false; usedCache = true;
      }
      if (usedCache) status('中文为本机机器翻译');
      if (!missing().length) return;
      try {
        const state = await availability();
        if (disposed) return;
        if (state === 'available') await translate();
        else if (state === 'downloadable' || state === 'downloading') {
          showButton(true); status(standalone() ? '点击“生成中文”加载英汉模型（首次约 275 MB）。' : '点击“生成中文”准备首次语言包；下载后可离线翻译。');
        } else status('当前浏览器无法使用本机逐句翻译；可继续阅读英文和词级中文。');
      } catch { status('无法检查本机翻译状态，请稍后重新查词。'); }
    })();
    return () => { disposed = true; controller?.abort(); button?.removeEventListener('click', clicked); };
  }
  const exported = { posLabel, append, bind, availability, prepare };
  root.WordWorkshopTranslation = exported;
  if (typeof module !== 'undefined') module.exports = exported;
})(globalThis);
