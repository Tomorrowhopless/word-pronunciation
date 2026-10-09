(function (root) {
  'use strict';
  const api = root.browser || root.chrome;
  const dialect = lang => /en[-_]US/i.test(lang) ? '美式' : /en[-_]GB/i.test(lang) ? '英式' : '英语';
  function bind(button, notice, getText) {
    let disposed = false;
    function render(state) {
      if (disposed || !state || (state.stage !== 'stopped' && (!state.word || state.word !== getText()?.trim())) || (state.stage === 'stopped' && state.word && state.word !== getText()?.trim())) return;
      const name = state.voice + ' · ' + dialect(state.lang);
      const messages = { preparing: state.engine === 'local-audio' ? '正在生成离线英语音频，首次加载请稍等…' : '准备朗读…', playing: '正在朗读 · ' + name, ended: '已朗读 · ' + name, stopped: '朗读已停止', error: '没有完成朗读。请在设置中试听或更换音色。', unconfirmed: '已提交朗读，未收到开始事件；请确认是否有声音。' };
      const timedOut = state.reason === 'timeout' || state.code === 'speech-start-timeout' || state.timeout === true;
      notice.textContent = state.stage === 'preparing' && state.retry > 0 ? '正在改用 ' + name + '…' : state.stage === 'error' ? (state.error || (timedOut ? '未收到朗读开始事件，无法确认已播放。请在设置中重试。' : messages.error)) : messages[state.stage] || '';
      button.classList.toggle('speaking', state.stage === 'playing');
    }
    async function click(event) {
      event?.stopPropagation();
      const text = getText()?.trim();
      if (disposed || !text || button.disabled) return;
      button.disabled = true; notice.textContent = '准备朗读…';
      try {
        const response = await api.runtime.sendMessage({ action: 'speak', text });
        if (disposed || getText()?.trim() !== text) return;
        if (!response?.ok) {
          button.classList.toggle('speaking', false);
          notice.textContent = response?.cancelled ? '朗读已取消' : response?.error || '朗读失败，请重新加载插件后重试。';
        }
        if (response?.ok) render((await api.storage.local.get('speechStatus')).speechStatus);
      } catch { if (!disposed && getText()?.trim() === text) { notice.textContent = '朗读服务连接失败，请重新加载插件。'; button.classList.toggle('speaking', false); } }
      finally { button.disabled = false; }
    }
    const changed = (changes, area) => { if (area === 'local' && changes.speechStatus) render(changes.speechStatus.newValue); };
    button.addEventListener('click', click);
    api.storage.onChanged?.addListener(changed);
    return () => { disposed = true; button.removeEventListener?.('click', click); api.storage.onChanged?.removeListener?.(changed); };
  }
  root.WordWorkshopPlayback = { bind };
})(globalThis);
