import './local-speech-document.js';
import { initialize, translate, cancel } from './local-model-core.js';
const api = globalThis.browser || globalThis.chrome;
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'wordworkshop-model-document') return;
  if (message.action === 'model-cancel') { cancel(message.requestId); respond({ ok: true }); return; }
  let task;
  if (message.action === 'model-ready') task = initialize().then(() => ({ ok: true }));
  else if (message.action === 'model-translate') task = translate(message.text, message.requestId);
  else return;
  task.then(respond).catch(() => respond({ ok: false, error: '本机中文模型未能完成翻译，请重新加载插件后重试。' }));
  return true;
});
