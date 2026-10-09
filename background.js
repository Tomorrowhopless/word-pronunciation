// MV3 Service Worker — handles all dictionary lookups for popup and content script
const api = globalThis.browser ?? globalThis.chrome;
if (api?.runtime && typeof importScripts === 'function') importScripts('model-bridge.js', 'local-speech-bridge.js', 'speech-engine.js');
const speechEngine = globalThis.WordWorkshopSpeech?.create(api);
const dictionaryURL = path => api?.runtime?.getURL ? api.runtime.getURL(path) : new URL(path, globalThis.WORDWORKSHOP_DICTIONARY_BASE || globalThis.location.href).href;

const _letterCache = new Map();
const _pendingLetters = new Map();
const MAX_CACHED_LETTERS = 2;
const _chineseCache = new Map();
const _pendingChinese = new Map();

async function loadChineseData(letter) {
  if (_chineseCache.has(letter)) {
    const value = _chineseCache.get(letter); _chineseCache.delete(letter); _chineseCache.set(letter, value); return value;
  }
  if (_pendingChinese.has(letter)) return _pendingChinese.get(letter);
  const pending = (async () => {
    const response = await fetch(dictionaryURL('data/zh/' + letter + '.json.gz'));
    if (!response.ok) throw new Error('Chinese dictionary unavailable');
    const value = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
    _chineseCache.set(letter, value);
    while (_chineseCache.size > 2) _chineseCache.delete(_chineseCache.keys().next().value);
    return value;
  })();
  _pendingChinese.set(letter, pending);
  try { return await pending; } finally { _pendingChinese.delete(letter); }
}

async function attachChinese(result, normalized) {
  const lookup = result.entry?.word?.toLowerCase() || normalized;
  try {
    const chinese = await loadChineseData(getLetterFile(lookup));
    let key = lookup;
    let translation = Object.hasOwn(chinese, key) && typeof chinese[key]?.translation === 'string' ? chinese[key] : null;
    // Inflected entries may exist in the English dictionary but lack Chinese.
    if (!translation && /(?:ing|ed|ies|s)$/.test(lookup)) for (const candidate of stemWord(lookup)) {
      const bucket = getLetterFile(candidate) === getLetterFile(lookup) ? chinese : await loadChineseData(getLetterFile(candidate));
      if (Object.hasOwn(bucket, candidate) && typeof bucket[candidate]?.translation === 'string') { translation = bucket[candidate]; key = candidate; break; }
    }
    if (translation) {
      if (!result.entry) result = { entry: { word: normalized, ipa: '', phonetic: translation.phonetic || '', meanings: translation.definition ? [{ speech_part: '释义', def: translation.definition }] : [], meaningsSource: 'ecdict' } };
      result.entry = { ...result.entry, translation: translation.translation, translationSource: 'ECDICT', translationWord: key };
    }
  } catch {
    if (result.entry) result.entry = { ...result.entry, translationError: true };
    else result = { entry: null, error: 'chinese-dictionary-unavailable' };
  }
  if (result.entry) result.entry = { ...result.entry, dataVersion: '4.7.0' };
  return result;
}

function getLetterFile(word) {
  const first = word.charAt(0).toLowerCase();
  return (first >= 'a' && first <= 'z') ? first : 'misc';
}

async function loadLetterData(letter) {
  if (_letterCache.has(letter)) {
    const cached = _letterCache.get(letter);
    _letterCache.delete(letter);
    _letterCache.set(letter, cached);
    return cached;
  }
  if (_pendingLetters.has(letter)) return _pendingLetters.get(letter);
  const loading = (async () => {
    const url = dictionaryURL('data/' + letter + '.json.gz');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Dictionary file could not be loaded');
    const data = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).json();
    _letterCache.set(letter, data);
    while (_letterCache.size > MAX_CACHED_LETTERS) {
      _letterCache.delete(_letterCache.keys().next().value);
    }
    return data;
  })();
  _pendingLetters.set(letter, loading);
  try { return await loading; } finally { _pendingLetters.delete(letter); }
}

// --- Suffix-stripping stemmer ---

function stemWord(word) {
  const candidates = [];
  const len = word.length;

  function add(w) {
    if (w && w.length >= 2 && w !== word) candidates.push(w);
  }

  // -ing
  if (len > 5 && word.endsWith('ing')) {
    const base = word.slice(0, -3);
    add(base);                                         // play
    add(base + 'e');                                   // make
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      add(base.slice(0, -1));                          // run (from runn)
    }
    if (base.endsWith('y')) {
      add(base.slice(0, -1) + 'ie');                   // die (from dy)
    }
  }

  // -ies → -y (before -es and -s)
  if (len > 4 && word.endsWith('ies')) {
    add(word.slice(0, -3) + 'y');                      // baby
  }

  // -es
  if (len > 3 && word.endsWith('es') && !word.endsWith('ies')) {
    add(word.slice(0, -2));                            // box
    add(word.slice(0, -1));                            // (keep trailing e, e.g. close from closes)
  }

  // -s (but not -ss)
  if (len > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('es')) {
    add(word.slice(0, -1));                            // cat
  }

  // -ied → -y
  if (len > 4 && word.endsWith('ied')) {
    add(word.slice(0, -3) + 'y');                      // carry
  }

  // -ed
  if (len > 4 && word.endsWith('ed') && !word.endsWith('ied')) {
    const base = word.slice(0, -2);
    add(base);                                         // walk
    add(base + 'e');                                   // like
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      add(base.slice(0, -1));                          // stop (from stopp)
    }
  }

  // -ily → -y
  if (len > 5 && word.endsWith('ily')) {
    add(word.slice(0, -3) + 'y');                      // happy
  }

  // -ly
  if (len > 4 && word.endsWith('ly') && !word.endsWith('ily')) {
    const base = word.slice(0, -2);
    add(base);                                         // quick
    add(base + 'le');                                  // simple
  }

  // -ier → -y
  if (len > 4 && word.endsWith('ier')) {
    add(word.slice(0, -3) + 'y');                      // happy
  }

  // -er
  if (len > 4 && word.endsWith('er') && !word.endsWith('ier')) {
    const base = word.slice(0, -2);
    add(base);                                         // fast
    add(base + 'e');                                   // nice
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      add(base.slice(0, -1));                          // big
    }
  }

  // -iest → -y
  if (len > 5 && word.endsWith('iest')) {
    add(word.slice(0, -4) + 'y');                      // happy
  }

  // -est
  if (len > 5 && word.endsWith('est') && !word.endsWith('iest')) {
    const base = word.slice(0, -3);
    add(base);
    add(base + 'e');
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      add(base.slice(0, -1));
    }
  }

  // -tion / -sion
  if (len > 5 && (word.endsWith('tion') || word.endsWith('sion'))) {
    const base = word.slice(0, -4);
    add(base);
    add(base + 't');                                   // invent
    add(base + 'te');                                  // rotate
    add(base + 'se');                                  // tense
    add(base + 'de');                                  // explode
  }

  // -iness → -y
  if (len > 6 && word.endsWith('iness')) {
    add(word.slice(0, -5) + 'y');                      // happy
  }

  // -ness
  if (len > 5 && word.endsWith('ness') && !word.endsWith('iness')) {
    add(word.slice(0, -4));                            // dark
  }

  // -ment
  if (len > 5 && word.endsWith('ment')) {
    add(word.slice(0, -4));                            // move
    add(word.slice(0, -4) + 'e');
  }

  // -ful
  if (len > 5 && word.endsWith('ful')) {
    add(word.slice(0, -3));                            // hope
  }

  // -less
  if (len > 5 && word.endsWith('less')) {
    add(word.slice(0, -4));                            // care
  }

  // -ous
  if (len > 5 && word.endsWith('ous')) {
    const base = word.slice(0, -3);
    add(base);
    add(base + 'e');
  }

  // -ive
  if (len > 5 && word.endsWith('ive')) {
    const base = word.slice(0, -3);
    add(base);
    add(base + 'e');
  }

  // -able / -ible
  if (len > 6 && (word.endsWith('able') || word.endsWith('ible'))) {
    const base = word.slice(0, -4);
    add(base);
    add(base + 'e');                                   // love
  }

  // De-duplicate preserving order
  return [...new Set(candidates)];
}

// --- Edit distance (Levenshtein) ---

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 999;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// --- Suggestions for words not found ---

function findSuggestions(word, data, limit = 5) {
  const prefix = word.substring(0, Math.min(3, word.length));
  const scored = [];

  for (const key of Object.keys(data)) {
    if (key === word) continue;
    if (key.startsWith(prefix)) {
      scored.push({ word: key, dist: editDistance(word, key) });
    }
    if (scored.length >= limit * 5) break;
  }

  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, limit).filter(s => s.dist <= 4).map(s => s.word);
}

// --- Main lookup with stemming + suggestions ---

async function lookupEnglishWord(word) {
  const normalized = word.toLowerCase().trim();
  if (!normalized) return { entry: null };

  const letter = getLetterFile(normalized);
  const data = await loadLetterData(letter);

  // 1. Exact match
  if (Object.hasOwn(data, normalized)) {
    return { entry: data[normalized] };
  }

  // 2. Stemmed match
  const candidates = stemWord(normalized);
  for (const candidate of candidates) {
    const candLetter = getLetterFile(candidate);
    const candData = candLetter === letter ? data : await loadLetterData(candLetter);
    if (Object.hasOwn(candData, candidate)) {
      return {
        entry: candData[candidate],
        stemmedFrom: normalized,
        stemmedTo: candidate,
      };
    }
  }

  // 3. Suggestions
  const suggestions = findSuggestions(normalized, data);
  return { entry: null, suggestions };
}

async function lookupWord(word) {
  const normalized = String(word).toLowerCase().trim();
  if (!normalized || normalized.length > 120) return { entry: null };
  return attachChinese(await lookupEnglishWord(normalized), normalized);
}

// --- Message handler ---

globalThis.WordWorkshopDictionary = { lookupWord };
api?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (message.target === 'wordworkshop-model-document') return;
  if (message.action === 'local-speech-event') {
    const trusted = sender.url === api.runtime.getURL?.('local-model.html');
    const accepted = trusted && (globalThis.WordWorkshopLocalSpeech?.handleEvent(message) || false);
    sendResponse({ ok: accepted }); return;
  }
  if (message.action === 'local-model-ready' || message.action === 'local-model-translate' || message.action === 'local-model-cancel') {
    const model = globalThis.WordWorkshopLocalModel;
    if (!model) { sendResponse({ ok: false, error: '本机翻译服务未加载，请重新加载插件。' }); return; }
    const task = message.action === 'local-model-ready' ? model.ready() : message.action === 'local-model-cancel' ? model.cancel(message.requestId) : model.translate(message.text, message.requestId);
    Promise.resolve(task).then(sendResponse).catch(() => sendResponse({ ok: false, error: '本机中文模型未能完成翻译，请重新加载插件后重试。' }));
    return true;
  }
  if (message.action === 'speech-voices' || message.action === 'speak' || message.action === 'speech-stop') {
    if (!speechEngine) { sendResponse({ ok: false, error: '朗读服务不可用，请重新加载插件。' }); return; }
    const action = message.action === 'speech-voices' ? speechEngine.getVoices().then(voices => ({ ok: true, voices, engine: 'piper', protocol: 3 })) : message.action === 'speak' ? speechEngine.speak(message.text) : speechEngine.stop();
    action.then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message || '朗读失败，请重试。' }));
    return true;
  }
  if (message.action === 'lookup' && message.word) {
    lookupWord(message.word)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ entry: null, error: 'dictionary-unavailable' }));
    return true;
  }
});
