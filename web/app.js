import { createModelClient } from './model-client.js';
const $ = selector => document.querySelector(selector);
const storage = globalThis.WordWorkshopWebStorage;
const models = createModelClient();
let translationReady = false, preparingTranslation, translationSerial = 0;
globalThis.WordWorkshopWeb = { translation: {
  availability: async () => translationReady ? 'available' : 'downloadable',
  prepare() {
    preparingTranslation ||= models.request('prepare').then(() => {
      translationReady = true;
      return { async translate(text, { signal } = {}) {
        if (signal?.aborted) throw new Error('翻译已取消。');
        const requestId = 'web-' + (++translationSerial);
        const cancel = () => { models.request('cancel', { requestId }).catch(() => {}); };
        signal?.addEventListener('abort', cancel, { once: true });
        try {
          const result = await models.request('translate', { text, requestId });
          if (signal?.aborted) throw new Error('翻译已取消。');
          return result.text;
        } finally { signal?.removeEventListener('abort', cancel); }
      }, destroy() {} };
    }).catch(error => { preparingTranslation = null; translationReady = false; throw error; });
    return preparingTranslation;
  },
} };

const dictionary = new Worker(new URL('./dictionary-worker.js', import.meta.url));
let dictionarySerial = 0, searchSerial = 0;
const searches = new Map();
dictionary.onmessage = ({ data }) => {
  const task = searches.get(data.id); if (!task) return;
  searches.delete(data.id); clearTimeout(task.timer);
  if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
};
dictionary.onerror = () => {
  for (const task of searches.values()) { clearTimeout(task.timer); task.reject(new Error('词库服务无法启动，请刷新页面后重试。')); }
  searches.clear();
};
function lookup(word) {
  const id = ++dictionarySerial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { searches.delete(id); reject(new Error('词库读取超时，请检查网络后重试。')); }, 60000);
    searches.set(id, { resolve, reject, timer }); dictionary.postMessage({ id, word });
  });
}
async function searchWord(word) {
  const ticket = ++searchSerial;
  if (!validateKeyword(word)) { setMsg('请输入英文单词或短语，最多 120 个字符。'); return; }
  stopSpeech(); $('#lookup-notice').textContent = '正在查询…'; $('#result').setAttribute('aria-busy', 'true');
  try {
    const result = await lookup(word.trim()); if (ticket !== searchSerial) return;
    $('#lookup-notice').textContent = '';
    if (result.entry) {
      setDefinition(result.entry, result.stemmedFrom ? { from: result.stemmedFrom, to: result.stemmedTo } : null);
      const url = new URL(location.href); url.searchParams.set('q', word.trim()); history.replaceState(null, '', url);
    } else if (result.error) setMsg('词库暂时无法读取，请检查网络后重试。');
    else if (result.suggestions?.length) {
      setMsg('未找到“' + word + '”，试试下面的词：');
      const list = document.createElement('div'); list.className = 'suggestions';
      for (const value of result.suggestions) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'suggestion-link'; button.textContent = value;
        button.onclick = () => { $('#search').value = value; searchWord(value); }; list.appendChild(button);
      }
      $('#error-state').appendChild(list);
    } else setMsg('词库中暂未找到这个词，请检查拼写。');
  } catch (error) { if (ticket === searchSerial) { $('#lookup-notice').textContent = ''; setMsg(error.message); } }
  finally { if (ticket === searchSerial) $('#result').removeAttribute('aria-busy'); }
}
$('#search-form').addEventListener('submit', event => { event.preventDefault(); searchWord($('#search').value.trim()); });
for (const button of document.querySelectorAll('[data-word]')) button.addEventListener('click', () => { $('#search').value = button.dataset.word; searchWord(button.dataset.word); });

let speechSerial = 0, activeAudio, audioURL;
const reference = $('#reference-audio');
function stopSpeech() {
  ++speechSerial;
  if (activeAudio) { activeAudio.onplaying = activeAudio.onended = activeAudio.onerror = null; activeAudio.pause(); if (activeAudio !== reference) { activeAudio.removeAttribute('src'); activeAudio.load(); } }
  reference.pause(); reference.currentTime = 0; activeAudio = null;
  if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
  $('#speak-btn').disabled = false; $('#preview').disabled = false;
  $('#speech-notice').textContent = ''; $('#preview-notice').textContent = '';
}
function playAudio(audio, ticket, notice, label) {
  activeAudio = audio;
  const finish = message => {
    if (ticket !== speechSerial) return;
    notice.textContent = message; $('#speak-btn').disabled = false; $('#preview').disabled = false;
    if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
  };
  audio.onplaying = () => { if (ticket === speechSerial) notice.textContent = '正在播放 · ' + label; };
  audio.onended = () => finish('播放结束 · ' + label);
  audio.onerror = () => finish('音频无法播放，请检查网络后重试。');
  return audio.play().catch(error => { finish('播放未能启动，请再次点击朗读。'); throw error; });
}
$('#speak-btn').addEventListener('click', async () => {
  stopSpeech(); const ticket = speechSerial, notice = $('#speech-notice'), text = $('#speak-btn').dataset.word;
  if (!text) return;
  $('#speak-btn').disabled = true; notice.textContent = '正在准备 Cori 发音，首次加载约 155 MB，请稍等…';
  try {
    const blob = await models.request('speak', { text, rate: Number($('#rate').value) }); if (ticket !== speechSerial) return;
    audioURL = URL.createObjectURL(blob); await playAudio(new Audio(audioURL), ticket, notice, 'Cori 英式');
  } catch (error) { if (ticket === speechSerial) { notice.textContent = '朗读未完成，请检查网络后重试。'; $('#speak-btn').disabled = false; } }
});
$('#stop-speech').addEventListener('click', () => { stopSpeech(); $('#speech-notice').textContent = '朗读已停止'; });
$('#preview').addEventListener('click', async () => {
  stopSpeech(); const ticket = speechSerial; $('#preview').disabled = true; reference.playbackRate = 1;
  $('#preview-notice').textContent = '正在打开原音频…';
  try { await playAudio(reference, ticket, $('#preview-notice'), 'Cori 原音频'); } catch {}
});
$('#stop-preview').addEventListener('click', () => { stopSpeech(); $('#preview-notice').textContent = '试听已停止'; });

const media = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(value) { document.documentElement.dataset.theme = value === 'system' ? media.matches ? 'dark' : 'light' : value; }
const savedTheme = (await storage.get('theme')).theme;
$('#theme').value = ['light', 'dark', 'system'].includes(savedTheme) ? savedTheme : 'system'; applyTheme($('#theme').value);
$('#theme').addEventListener('change', () => { applyTheme($('#theme').value); storage.set({ theme: $('#theme').value }); });
media.addEventListener('change', () => { if ($('#theme').value === 'system') applyTheme('system'); });
const savedRate = (await storage.get('coriWebRate')).coriWebRate;
if ([0.85, 1, 1.15].includes(savedRate)) $('#rate').value = String(savedRate);
$('#rate').addEventListener('change', () => storage.set({ coriWebRate: Number($('#rate').value) }));
window.addEventListener('pagehide', () => { stopSpeech(); models.close(); dictionary.terminate(); });
const initialWord = new URL(location.href).searchParams.get('q');
if (initialWord) { $('#search').value = initialWord; searchWord(initialWord); }
