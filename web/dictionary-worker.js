'use strict';
globalThis.WORDWORKSHOP_DICTIONARY_BASE = new URL('../', self.location.href).href;
importScripts('../background.js');
self.onmessage = async ({ data }) => {
  try { self.postMessage({ id: data.id, result: await WordWorkshopDictionary.lookupWord(data.word) }); }
  catch { self.postMessage({ id: data.id, error: '词库暂时无法读取，请检查网络后重试。' }); }
};
