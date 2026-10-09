(function (root) {
  'use strict';
  const api = root.browser || root.chrome;
  const target = 'wordworkshop-model-document';
  let creating;
  async function ensure() {
    if (creating) return creating;
    creating = (async () => {
      const url = api.runtime.getURL('local-model.html');
      const contexts = await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
      if (!contexts.length) await api.offscreen.createDocument({ url: 'local-model.html', reasons: ['WORKERS', 'BLOBS'], justification: '在本机运行随插件打包的翻译及语音模型并播放音频。' });
    })().finally(() => { creating = null; });
    return creating;
  }
  async function request(action, payload = {}) {
    await ensure();
    // createDocument resolves after page load; module initialization can still be pending.
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const result = await api.runtime.sendMessage({ target, action, ...payload });
        if (result) { if (!result.ok) throw new Error(result.error || '本机翻译模型未能运行，请重新加载插件。'); return result; }
      } catch (error) {
        if (!/receiving end|connection|port closed/i.test(error.message || '')) throw error;
        if (attempt === 11) throw new Error('本机翻译服务连接失败，请重新加载插件。');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('本机翻译服务连接失败，请重新加载插件。');
  }
  root.WordWorkshopLocalModel = {
    ensure,
    ready: () => request('model-ready'),
    translate: (text, requestId) => request('model-translate', { text, requestId }),
    cancel: requestId => api.runtime.sendMessage({ target, action: 'model-cancel', requestId })
  };
  if (typeof module !== 'undefined') module.exports = root.WordWorkshopLocalModel;
})(globalThis);
