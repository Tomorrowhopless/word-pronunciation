import createPiperPhonemize from './vendor/piper/phonemize.js';
const api = globalThis.browser || globalThis.chrome;
const base = new URL('./vendor/piper/', import.meta.url);
const assetURL = name => api?.runtime?.getURL ? api.runtime.getURL('vendor/piper/' + name) : new URL(name, base).href;
let initializing, capture, queue = Promise.resolve();
async function initialize() {
  if (!initializing) initializing = createPiperPhonemize({
    noInitialRun: true, noExitRuntime: true,
    locateFile(name) {
      if (!['piper_phonemize.wasm', 'piper_phonemize.data'].includes(name)) throw new Error('未知的本机语音资源。');
      return assetURL(name);
    },
    print(line) { if(capture) capture.lines.push(line); },
    printErr(line) { if(capture) capture.errors.push(line); },
  }).catch(error => { initializing=null; throw error; });
  return initializing;
}
function decode(record, config) {
  const native = record.phoneme_ids, phonemes = record.phonemes, map=config.phoneme_id_map;
  if(!Array.isArray(native) || !Array.isArray(phonemes) || !native.length) throw new Error('本机语音前端未返回有效音素。');
  const idsFor = symbol => {
    const ids=Object.hasOwn(map,symbol) ? map[symbol] : undefined;
    if(!Array.isArray(ids) || !ids.length || ids.some(id=>!Number.isSafeInteger(id) || id<0)) throw new Error('语音模型缺少音素：' + symbol);
    return ids;
  };
  let offset=0, count=0, open=false; const sentences=[];
  for(const id of native) {
    if(!Number.isSafeInteger(id) || id<0) throw new Error('本机语音前端返回了无效 ID。');
    if(id===1) {if(open) throw new Error('本机语音句子边界无效。'); open=true;count=0;}
    else if(id===2) {
      if(!open || count===0) throw new Error('本机语音句子为空。');
      const sentence=[...idsFor('^'),...idsFor('_')];
      for(const phoneme of phonemes.slice(offset,offset+count)) sentence.push(...idsFor(phoneme),...idsFor('_'));
      offset+=count;sentence.push(...idsFor('$'));sentences.push(sentence);open=false;
    } else if(id!==0) {if(!open) throw new Error('本机语音句子边界无效。');count++;}
  }
  if(open || offset!==phonemes.length || !sentences.length) throw new Error('本机语音音素与句子长度不一致。');
  return sentences;
}
export async function phonemeIds(text, config) {
  if(typeof text!=='string' || !text.trim() || text.length>2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('没有有效的英语朗读文本。');
  if(config?.phoneme_type!=='espeak' || !config.espeak?.voice || !config.phoneme_id_map) throw new Error('本机语音模型配置无效。');
  const task=queue.catch(()=>{}).then(async()=>{
    const module=await initialize(); const result={lines:[],errors:[]};capture=result;
    try {
      module.callMain(['-l',config.espeak.voice,'--input',JSON.stringify([{text:text.trim()}]),'--espeak_data','/espeak-ng-data']);
    } finally {capture=null;}
    if(result.errors.length) throw new Error('本机语音音素生成失败：'+result.errors.join(' ').slice(0,300));
    return result.lines.flatMap(line=>decode(JSON.parse(line),config));
  });
  queue=task; return task;
}
