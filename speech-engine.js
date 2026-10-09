// Piper audio runs in the shared offscreen document, independent of popup lifetime.
(function (root) {
  'use strict';
  const voices = [
    { voiceName: 'Piper Cori', lang: 'en-GB', engine: 'local-audio', remote: false },
  ];
  function normalizeSettings(value) {
    const stored = value && typeof value === 'object' ? value : {};
    const rate = stored.preset === 'cori-reference-v1' ? Number(stored.rate) : 1;
    return { voiceName: 'Piper Cori', engine: 'local-audio', rate: Number.isFinite(rate) ? Math.min(1.25, Math.max(0.75, rate)) : 1, preset: 'cori-reference-v1' };
  }
  function create(api) {
    let serial = 0, attemptSerial = 0, lastState;
    const localSpeech = root.WordWorkshopLocalSpeech?.create(api);
    let storageQueue = Promise.resolve();
    function write(values, ticket = serial) {
      storageQueue = storageQueue.catch(() => {}).then(() => {
        if (ticket !== serial) return;
        if (values.speechStatus) lastState = values.speechStatus;
        return api.storage.local.set(values);
      });
      return storageQueue;
    }
    async function getVoices() {
      if (!localSpeech) throw new Error('Piper 语音服务未加载，请重新加载插件后重试。');
      return voices.filter(v => localSpeech.voices.some(available => available.voiceName === v.voiceName)).map(v => ({ ...v }));
    }
    async function speak(text) {
      if (typeof text !== 'string' || !text.trim() || text.length > 240 || /[\u0000-\u001f<>]/.test(text)) throw new Error('没有可朗读的英语文本。');
      const ticket = ++serial;
      const available = await getVoices();
      const store = await api.storage.local.get('speechSettings');
      const settings = normalizeSettings(store.speechSettings);
      if (ticket !== serial) return { ok: false, cancelled: true };
      if (!available.length) throw new Error('Piper 音色不可用，请重新加载插件后重试。');
      const chosen = available.find(v => v.voiceName === settings.voiceName) || available[0];
      settings.voiceName = chosen.voiceName;
      if (Object.keys(settings).some(key => settings[key] !== store.speechSettings?.[key])) await write({ speechSettings: settings }, ticket);
      if (ticket !== serial) return { ok: false, cancelled: true };
      const requestId = Date.now() + '-' + ticket;
      async function attempt() {
        if (ticket !== serial) return { ok: false, cancelled: true };
        const attemptId = ++attemptSerial, voice = chosen;
        const state = { word: text.trim(), voice: voice.voiceName, lang: voice.lang, engine: 'local-audio', requestId };
        let terminal = false, failureTask;
        const current = () => ticket === serial && attemptId === attemptSerial;
        const update = (stage, extras = {}) => current() ? write({ speechStatus: { ...state, stage, ...extras } }, ticket) : Promise.resolve();
        const publish = stage => { update(stage).catch(() => {}); };
        function fail(error) {
          if (!current() || terminal) return Promise.resolve({ ok: false, cancelled: true });
          terminal = true;
          failureTask = (async () => {
            const message = 'Piper Cori 朗读失败：' + String(error?.message || error || '本机音频播放失败。').slice(0, 300);
            await update('error', { error: message, reason: 'audio-error' });
            throw new Error(message);
          })();
          failureTask.catch(() => {});
          return failureTask;
        }
        try {
          await localSpeech.stop();
          await update('preparing');
          if (!current()) return { ok: false, cancelled: true };
          const result = await localSpeech.speak(state.word, { voiceName: voice.voiceName, rate: settings.rate, requestId: requestId + '-' + attemptId }, event => {
            if (!current() || terminal) return;
            if (event.stage === 'playing') publish('playing');
            if (event.stage === 'ended' || event.stage === 'stopped') { terminal = true; publish(event.stage); }
            if (event.stage === 'error') fail(event.error);
          });
          if (failureTask) return failureTask;
          if (!current() || result?.cancelled) return { ok: false, cancelled: true };
          if (!result?.ok) throw new Error(result?.error || 'Piper 音频朗读未能启动。');
          return { ok: true, voice: voice.voiceName, lang: voice.lang, engine: 'piper', requestId };
        } catch (error) {
          if (failureTask) return failureTask;
          return fail(error);
        }
      }
      return attempt();
    }
    async function stop() {
      const ticket = ++serial; ++attemptSerial;
      if (localSpeech) await localSpeech.stop({ all: true });
      await write({ speechStatus: { ...lastState, stage: 'stopped' } }, ticket);
      return { ok: true };
    }
    return { getVoices, speak, stop };
  }
  root.WordWorkshopSpeech = { normalizeSettings, create, engine: 'piper', protocol: 3 };
  if (typeof module !== 'undefined') module.exports = root.WordWorkshopSpeech;
})(globalThis);
