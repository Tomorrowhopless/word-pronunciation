import { generate } from './local-speech-core.js';
const api = globalThis.browser || globalThis.chrome;
let serial = 0, active;
function emit(record, stage, error) {
  if(active !== record) return;
  Promise.resolve(api.runtime.sendMessage({action:'local-speech-event',requestId:record.requestId,stage,...(error ? {error} : {})})).catch(()=>{});
}
function release(record) {
  if(!record) return;
  if(record.audio) {record.audio.onplaying=record.audio.onended=record.audio.onerror=null; record.audio.pause(); record.audio.removeAttribute('src'); record.audio.load();}
  if(record.url) {URL.revokeObjectURL(record.url); record.url=null;}
}
function stop() {serial++; const record=active; if(record) emit(record,'stopped'); active=null; release(record);}
async function play(message) {
  stop(); const ticket=serial; const record={requestId:message.requestId}; active=record;
  try {
    const blob=await generate(message.text,{voiceName:message.voiceName,rate:message.rate});
    if(ticket!==serial || active!==record) return {ok:false,cancelled:true};
    if(!(blob instanceof Blob) || !blob.size) throw new Error('本机模型未生成有效音频。');
    record.url=URL.createObjectURL(blob); const audio=record.audio=new Audio(record.url);
    audio.onplaying=()=>emit(record,'playing');
    audio.onended=()=>{emit(record,'ended'); if(active===record) active=null; release(record);};
    audio.onerror=()=>{emit(record,'error','本机音频播放失败。'); if(active===record) active=null; release(record);};
    await audio.play();
    if(ticket!==serial) return {ok:false,cancelled:true};
    return {ok:true,requestId:record.requestId};
  } catch(error) {
    if(active===record) {emit(record,'error',error.message || '本机音频朗读失败。'); active=null;}
    release(record); return {ok:false,error:error.message || '本机音频朗读失败。'};
  }
}
api.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.target!=='wordworkshop-model-document') return;
  if(message.action==='speech-ready') {respond({ok:true,engine:'piper',protocol:3}); return;}
  if(message.action==='speech-stop') {
    if(message.all===true || (message.requestId && active?.requestId===message.requestId)) stop();
    respond({ok:true}); return;
  }
  if(message.action!=='speech-play') return;
  if(message.engine!=='piper' || message.protocol!==3) {respond({ok:false,error:'朗读服务版本不匹配，请重新加载插件。'}); return;}
  play(message).then(respond); return true;
});
