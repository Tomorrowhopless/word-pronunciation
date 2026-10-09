(function(root) {
  'use strict';
  const voices = [{voiceName:'Piper Cori',lang:'en-GB',engine:'local-audio',remote:false}];
  let receiver;
  root.WordWorkshopLocalSpeech = {
    handleEvent(message) { return receiver ? receiver(message) : false; },
    create(api) {
      if (!api?.runtime?.getManifest?.().permissions?.includes('offscreen') || !root.WordWorkshopLocalModel?.ensure || !api.runtime.sendMessage) return;
      let current;
      const target = 'wordworkshop-model-document';
      async function ready(record) {
        for (let attempt = 0; attempt < 12; attempt++) {
          if (current !== record) return false;
          try {
            const result = await api.runtime.sendMessage({target,action:'speech-ready'});
            if (result?.ok) {
              if (result.engine !== 'piper' || result.protocol !== 3) throw new Error('后台仍在运行旧朗读服务，请重新加载插件后重新打开词典。');
              return true;
            }
            if (result) throw new Error(result.error || '本机音频服务未能启动。');
          } catch(error) {
            if (!/receiving end|connection|port closed/i.test(error.message || '')) throw error;
          }
          if (attempt < 11) await new Promise(resolve => setTimeout(resolve,100));
        }
        throw new Error('本机音频服务连接失败，请重新加载插件。');
      }
      const instance = {
        voices,
        async speak(text, options, onStatus) {
          const record = {requestId:options.requestId,onStatus}; current = record;
          try {
            await root.WordWorkshopLocalModel.ensure();
            if (current !== record || !await ready(record) || current !== record) return {ok:false,cancelled:true};
            const result = await api.runtime.sendMessage({target,action:'speech-play',text,...options,engine:'piper',protocol:3});
            if (current !== record || result?.cancelled) return {ok:false,cancelled:true};
            if (record.terminal?.stage === 'error') throw new Error(record.terminal.error || '本机音频播放失败。');
            if (!result?.ok) throw new Error(result?.error || '本机音频朗读未能启动。');
            return result;
          } catch(error) { if(current!==record) return {ok:false,cancelled:true}; if(current===record) current=null; return {ok:false,error:error.message}; }
        },
        async stop({ all = false } = {}) {
          const record=current; current=null;
          if (!record && !all) return {ok:true};
          try { return await api.runtime.sendMessage({target,action:'speech-stop',...(all ? {all:true} : {requestId:record.requestId})}); }
          catch(error) {return {ok:false,error:error.message};}
        },
        handleEvent(message) {
          if(message.action!=='local-speech-event' || !current || current.terminal || message.requestId!==current.requestId || !['playing','ended','error','stopped'].includes(message.stage)) return false;
          const record=current;
          if(['ended','error','stopped'].includes(message.stage)) record.terminal=message;
          record.onStatus?.(message); return true;
        }
      };
      receiver=message=>instance.handleEvent(message);
      return instance;
    }
  };
  if(typeof module!=='undefined') module.exports=root.WordWorkshopLocalSpeech;
})(globalThis);
