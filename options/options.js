const api = globalThis.browser ?? globalThis.chrome;
const commandName = '_execute_action';
const $ = selector => document.querySelector(selector);
function resolveTheme(setting) { return setting === 'dark' || setting === 'light' ? setting : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
function onThemeChange(e) { document.documentElement.setAttribute('data-theme', resolveTheme(e.target.value)); api.storage.local.set({ theme: e.target.value }); }
const supportsShortcutEditing = typeof api.commands.update === 'function' && typeof api.commands.reset === 'function';
async function updateUI() {
  $('#shortcut').readOnly = !supportsShortcutEditing; $('#update').hidden = !supportsShortcutEditing; $('#reset').hidden = !supportsShortcutEditing; $('#browser-shortcuts').hidden = supportsShortcutEditing; $('#shortcut-help').hidden = supportsShortcutEditing;
  for (const command of await api.commands.getAll()) if (command.name === commandName) $('#shortcut').value = command.shortcut || '未设置';
}
async function updateShortcut() { if (supportsShortcutEditing) await api.commands.update({ name: commandName, shortcut: $('#shortcut').value }); }
async function resetShortcut() { if (supportsShortcutEditing) { await api.commands.reset(commandName); await updateUI(); } }
function voiceLabel() { return 'Cori（英式英语 · 你选中的音色）'; }
async function loadVoices() {
  try {
    const response = await api.runtime.sendMessage({ action: 'speech-voices' });
    if (!response?.ok) throw new Error(response?.error || '语音服务尚未更新，请重新加载插件。');
    if (response.engine !== 'piper' || response.protocol !== 3) throw new Error('当前仍是旧朗读服务，请重新加载插件后重新打开设置页。');
    const voices = response.voices.filter(voice => voice.engine === 'local-audio' && voice.voiceName === 'Piper Cori');
    const select = $('#voice'); select.textContent = '';
    for (const voice of voices) { const option = document.createElement('option'); option.value = voice.voiceName; option.dataset.engine = 'local-audio'; option.textContent = voiceLabel(voice); select.appendChild(option); }
    if (!voices.length) throw new Error('Piper 音色未加载，请重新加载插件。');
    const stored = (await api.storage.local.get('speechSettings')).speechSettings || {};
    const settings = WordWorkshopSpeech.normalizeSettings(stored);
    select.value = settings.voiceName;
    $('#rate').value = ['0.85','1','1.15'].includes(String(settings.rate)) ? String(settings.rate) : '1';
    select.disabled = false; $('#rate').disabled = false; await saveSpeechSettings();
  } catch (error) { $('#speech-notice').textContent = error.message; }
}
async function saveSpeechSettings() { await api.storage.local.set({ speechSettings: WordWorkshopSpeech.normalizeSettings({ voiceName: 'Piper Cori', rate: $('#rate').value, preset: 'cori-reference-v1' }) }); }
async function init() {
  const store = await api.storage.local.get('theme'); const theme = ['light','dark'].includes(store.theme) ? store.theme : 'system';
  document.documentElement.setAttribute('data-theme', resolveTheme(theme)); $('input[name="theme"][value="' + theme + '"]').checked = true;
  $('#version').textContent = '当前版本：' + api.runtime.getManifest().version + ' · 音色：Cori 英式';
  await updateUI(); await loadVoices();
}
document.addEventListener('DOMContentLoaded', init);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => { const store = await api.storage.local.get('theme'); if (!store.theme || store.theme === 'system') document.documentElement.setAttribute('data-theme', resolveTheme('system')); });
document.querySelectorAll('input[name="theme"]').forEach(radio => radio.addEventListener('change', onThemeChange));
$('#update').addEventListener('click', updateShortcut); $('#reset').addEventListener('click', resetShortcut);
$('#browser-shortcuts').addEventListener('click', () => api.tabs.create({ url: (/Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome') + '://extensions/shortcuts' }));
$('#voice').addEventListener('change', saveSpeechSettings); $('#rate').addEventListener('change', saveSpeechSettings);
let previewSerial = 0, previewActive = false;
const referenceAudio = $('#reference-audio');
function finishPreview(message) { previewActive = false; $('#preview').disabled = false; $('#speech-notice').textContent = message; }
referenceAudio.addEventListener('playing', () => { if (previewActive) $('#speech-notice').textContent = '正在播放你选中的 Cori 原音频…'; });
referenceAudio.addEventListener('ended', () => { if (previewActive) finishPreview('试听结束 · Cori 英式原音频'); });
referenceAudio.addEventListener('error', () => { if (previewActive) finishPreview('试听音频无法播放，请重新加载插件后重试。'); });
$('#preview').addEventListener('click', async () => {
  const ticket = ++previewSerial; previewActive = true; $('#preview').disabled = true;
  referenceAudio.pause(); referenceAudio.currentTime = 0;
  $('#speech-notice').textContent = '正在打开你选中的原音频…';
  try {
    await api.runtime.sendMessage({ action: 'speech-stop' });
    if (ticket !== previewSerial) return;
    referenceAudio.playbackRate = 1; referenceAudio.volume = 1;
    await referenceAudio.play();
  } catch { if (ticket === previewSerial && previewActive) finishPreview('试听未能启动，请重新加载插件后重试。'); }
});
$('#stop-speech').addEventListener('click', async () => {
  ++previewSerial; referenceAudio.pause(); referenceAudio.currentTime = 0; finishPreview('朗读已停止');
  try { await api.runtime.sendMessage({ action: 'speech-stop' }); } catch { $('#speech-notice').textContent = '试听已停止；后台连接失败，请重新加载插件。'; }
});
window.addEventListener('pagehide', () => { ++previewSerial; previewActive = false; referenceAudio.pause(); });
$('#reload-extension').addEventListener('click', () => { $('#reload-notice').textContent = '正在重新加载。完成后请重新打开设置页，并刷新英文网页。'; api.runtime.reload(); });
$('#prepare-translation').addEventListener('click', async () => {
  const button = $('#prepare-translation'); const notice = $('#translation-notice');
  button.disabled = true; notice.textContent = '正在加载本机英汉模型，请保持本页打开…';
  try {
    await WordWorkshopTranslation.prepare({ onProgress: ratio => { notice.textContent = '首次语言包下载：' + Math.round(ratio * 100) + '%，请保持本页打开。'; } });
    notice.textContent = '本机中文翻译已就绪，重新查词即可显示逐句中文。';
  } catch { notice.textContent = '本机英汉模型未能加载，请重新加载插件后重试。'; }
  finally { button.disabled = false; }
});
