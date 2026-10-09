let speech, translation;
self.onmessage = async ({ data }) => {
  const { id, action, text, rate, requestId } = data;
  try {
    let result;
    if (action === 'speak') {
      speech ||= import('../local-speech-core.js');
      result = await (await speech).generate(text, { voiceName: 'Piper Cori', rate });
    } else if (action === 'prepare') {
      translation ||= import('../local-model-core.js');
      await (await translation).initialize(); result = { ok: true };
    } else if (action === 'translate') {
      translation ||= import('../local-model-core.js');
      result = await (await translation).translate(text, requestId);
    } else if (action === 'cancel') {
      if (translation) (await translation).cancel(requestId);
      result = { ok: true };
    } else throw new Error('未知的词典操作。');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message || '模型暂时无法加载，请检查网络后重试。' }); }
};
