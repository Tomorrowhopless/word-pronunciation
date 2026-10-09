const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function fixture(voiceName,legacy=false){
 const url='chrome-extension://test/local-model.html',listeners=[],generated=[],audios=[],messages=[];
 const store={speechSettings:{engine:'native',voiceName,rate:1}};let docExists=false;
 const dispatch=(message,sender)=>new Promise((resolve,reject)=>{
  let waiting=false,replied=false;
  const respond=result=>{if(!replied){replied=true;resolve(result);}};
  try{for(const listener of listeners){if(listener(message,sender,respond)===true)waiting=true;}if(!waiting&&!replied)resolve(undefined);}catch(error){reject(error);}
 });
 const runtime=sender=>({getManifest:()=>({permissions:['offscreen']}),getURL:p=>'chrome-extension://test/'+p,getContexts:async()=>docExists?[{documentUrl:url}]:[],onMessage:{addListener:listener=>listeners.push(listener)},sendMessage:message=>{messages.push(message);return dispatch(message,{url:sender});}});
 const storage={local:{get:async key=>({[key]:store[key]}),set:async values=>Object.assign(store,values)}};
 const tts=new Proxy({}, {get(){throw Error('native TTS must never be accessed');}});
 const worker=vm.createContext({chrome:{runtime:runtime('chrome-extension://test/background.js'),storage,tts,offscreen:{createDocument:async()=>{docExists=true;}}},setTimeout,clearTimeout,console});
 worker.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),worker,{filename:file});};
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),worker,{filename:'background.js'});
 class Audio{constructor(source){this.source=source;audios.push(this);}play(){return Promise.resolve();}pause(){}removeAttribute(){}load(){}}
 const docRuntime=runtime(url);
 if(legacy){const add=docRuntime.onMessage.addListener;docRuntime.onMessage.addListener=listener=>add((message,sender,respond)=>{if(message.target==='wordworkshop-model-document'&&message.action==='speech-ready'){respond({ok:true});return;}return listener(message,sender,respond);});}
 const document=vm.createContext({chrome:{runtime:docRuntime},Blob,Audio,URL:{createObjectURL:()=> 'blob:local',revokeObjectURL(){}},generate:async(text,options)=>{generated.push({text,...options});return new Blob(['wav']);}});
 vm.runInContext(fs.readFileSync(path.join(root,'local-speech-document.js'),'utf8').replace(/^import .*;\n/,''),document,{filename:'local-speech-document.js'});
 return {store,generated,audios,messages,send:(message,sender='chrome-extension://test/browserAction/index.html')=>dispatch(message,{url:sender})};
}
test('real background and bridge migrate native preferences and route only Piper playback events',async()=>{
 for(const old of ['Samantha','Daniel','Piper LJSpeech']){
  const expected='Piper Cori';const f=fixture(old);f.store.speechSettings.rate=0.85;const response=await f.send({action:'speak',text:'apple'});
  assert.equal(response.ok,true);assert.equal(response.engine,'piper');assert.equal(f.generated.length,1);assert.equal(f.generated[0].voiceName,expected);
  assert.equal(f.store.speechSettings.voiceName,expected);assert.equal(f.store.speechSettings.engine,'local-audio');assert.equal(f.store.speechSettings.rate,1);assert.equal(f.store.speechSettings.preset,'cori-reference-v1');assert.equal(f.generated[0].rate,1);
  assert.equal(f.store.speechStatus.stage,'preparing');
  const play=f.messages.find(message=>message.action==='speech-play');assert.equal(play.engine,'piper');assert.equal(play.protocol,3);
  const rejected=await f.send({action:'local-speech-event',requestId:play.requestId,stage:'playing'},'https://example.org/');assert.equal(rejected.ok,false);assert.equal(f.store.speechStatus.stage,'preparing');
  f.audios[0].onplaying();await flush();assert.equal(f.store.speechStatus.stage,'playing');assert.equal(f.store.speechStatus.voice,expected);
  f.audios[0].onended();await flush();assert.equal(f.store.speechStatus.stage,'ended');
 }
});
test('real route rejects a legacy offscreen handshake without synthesis or native fallback',async()=>{
 const f=fixture('Samantha',true);const response=await f.send({action:'speak',text:'apple'});
 assert.equal(response.ok,false);assert.match(response.error,/重新加载/);assert.equal(f.generated.length,0);assert.equal(f.audios.length,0);
 assert.equal(f.messages.some(message=>message.action==='speech-play'),false);
 assert.equal(f.store.speechStatus.stage,'error');assert.match(f.store.speechStatus.error,/旧朗读服务.*重新加载/);
});
