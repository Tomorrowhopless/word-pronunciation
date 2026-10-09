const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const readyIdentity={ok:true,engine:'piper',protocol:3};
const readyReply=(message,result)=>message.action==='speech-ready'?{...readyIdentity}:result;
const flush=async()=>{for(let i=0;i<20;i++) await Promise.resolve();};
function fixture(generate){
 let listener; const events=[],audios=[],revoked=[];
 class Audio {constructor(url){this.url=url;audios.push(this);} play(){return Promise.resolve();}pause(){this.paused=true;}removeAttribute(){}load(){}}
 const context=vm.createContext({generate,Blob,Audio,URL:{createObjectURL:()=>`blob:${audios.length}`,revokeObjectURL:url=>revoked.push(url)},chrome:{runtime:{sendMessage:async m=>events.push(m),onMessage:{addListener:f=>listener=f}}}});
 vm.runInContext(fs.readFileSync(path.join(root,'local-speech-document.js'),'utf8').replace(/^import .*;\n/,''),context);
 const request=m=>new Promise(resolve=>listener({target:'wordworkshop-model-document',engine:'piper',protocol:3,...m},{},resolve));
 return {request,events,audios,revoked,listener};
}
test('audio acceptance is not playing; actual events and cleanup are reported',async()=>{
 const f=fixture(async()=>new Blob(['wav']));
 assert.equal((await f.request({action:'speech-play',text:'apple',requestId:'1'})).ok,true);
 assert.equal(f.events.length,0);f.audios[0].onplaying(); await flush();assert.equal(f.events[0].stage,'playing');
 f.audios[0].onended();await flush();assert.equal(f.events[1].stage,'ended');assert.equal(f.revoked.length,1);
});
test('stop invalidates pending generation and no late audio starts',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));
 const pending=f.request({action:'speech-play',text:'apple',requestId:'1'});
 await f.request({action:'speech-stop',requestId:'1'});resolve(new Blob(['wav']));
 assert.equal((await pending).cancelled,true);assert.equal(f.audios.length,0);assert.equal(f.events[0].stage,'stopped');
});
test('new generation supersedes old and playback failures release URLs',async()=>{
 let resolve;let calls=0;const f=fixture(()=>++calls===1?new Promise(r=>resolve=r):Promise.resolve(new Blob(['wav'])));
 const old=f.request({action:'speech-play',requestId:'1'});await f.request({action:'speech-play',requestId:'2'});
 resolve(new Blob(['old']));assert.equal((await old).cancelled,true);assert.equal(f.audios.length,1);
 f.audios[0].onerror();await flush();assert.equal(f.events.at(-1).stage,'error');assert.equal(f.revoked.length,1);
});
test('invalid or failed synthesis returns real failure and ignores other routes',async()=>{
 const f=fixture(async()=>new Blob([]));assert.equal((await f.request({action:'speech-play',requestId:'1'})).ok,false);
 assert.match(f.events.at(-1).error,/有效音频/);assert.equal(f.listener({target:'other',action:'speech-play'},{},()=>assert.fail()),undefined);
});
test('bridge requires packaged capability, ensures document and rejects stale status',async()=>{
 let ensured=0;const messages=[];const context=vm.createContext({setTimeout,WordWorkshopLocalModel:{ensure:async()=>ensured++}});
 vm.runInContext(fs.readFileSync(path.join(root,'local-speech-bridge.js'),'utf8'),context);
 assert.equal(context.WordWorkshopLocalSpeech.create({runtime:{getManifest:()=>({permissions:[]})}}),undefined);
 const bridge=context.WordWorkshopLocalSpeech.create({runtime:{getManifest:()=>({permissions:['offscreen']}),sendMessage:async m=>{messages.push(m);return readyReply(m,{ok:true});}}});
 const statuses=[];await bridge.speak('apple',{requestId:'2',voiceName:'Piper LJSpeech'},m=>statuses.push(m));
 assert.equal(ensured,1);assert.equal(messages[0].target,'wordworkshop-model-document');assert.equal(statuses.length,0);
 assert.equal(bridge.handleEvent({action:'local-speech-event',requestId:'1',stage:'playing'}),false);
 assert.equal(bridge.handleEvent({action:'local-speech-event',requestId:'2',stage:'playing'}),true);
 await bridge.stop();assert.equal(bridge.handleEvent({action:'local-speech-event',requestId:'2',stage:'ended'}),false);
});

test('rejected audio play returns failure without success or retained URL',async()=>{
 const f=fixture(async()=>new Blob(['wav']));
 const pending=f.request({action:'speech-play',requestId:'reject'});
 // Generation resolves asynchronously, letting the mock replace play before construction.
 await flush();
 // A separate fixture injects rejection through the prototype used by its first audio.
 await pending;
 const proto=Object.getPrototypeOf(f.audios[0]);proto.play=()=>Promise.reject(new Error('NotAllowedError'));
 const result=await f.request({action:'speech-play',requestId:'reject2'});
 assert.equal(result.ok,false);assert.equal(result.error,'NotAllowedError');
 assert.equal(f.events.at(-1).stage,'error');assert.equal(f.revoked.length,2);
});

test('bridge treats superseded completion as cancellation not failure',async()=>{
 let resolve;const context=vm.createContext({setTimeout,WordWorkshopLocalModel:{ensure:async()=>{}}});
 vm.runInContext(fs.readFileSync(path.join(root,'local-speech-bridge.js'),'utf8'),context);
 const bridge=context.WordWorkshopLocalSpeech.create({runtime:{getManifest:()=>({permissions:['offscreen']}),sendMessage:async m=>m.action==='speech-ready'?{...readyIdentity}:m.requestId==='old'?new Promise(r=>resolve=r):{ok:true}}});
 const old=bridge.speak('old',{requestId:'old'},()=>assert.fail());await flush();
 await bridge.speak('new',{requestId:'new'},()=>{});resolve({ok:false,cancelled:true});
 assert.equal((await old).cancelled,true);
});
test('background accepts speech events only from its own offscreen document',()=>{
 let handler,calls=0;const context=vm.createContext({chrome:{runtime:{getURL:p=>'chrome-extension://id/'+p,onMessage:{addListener:f=>handler=f}}},WordWorkshopLocalSpeech:{handleEvent:()=>{calls++;return true;}}});
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
 let response;handler({action:'local-speech-event',requestId:'one'},{url:'https://example.org/'},r=>response=r);
 assert.equal(response.ok,false);assert.equal(calls,0);
 handler({action:'local-speech-event',requestId:'one'},{url:'chrome-extension://id/local-model.html'},r=>response=r);
 assert.equal(response.ok,true);assert.equal(calls,1);
});

test('bridge retries registration handshake but submits actual playback only once',async()=>{
 let readyCalls=0,plays=0;const context=vm.createContext({setTimeout:fn=>fn(),WordWorkshopLocalModel:{ensure:async()=>{}}});
 vm.runInContext(fs.readFileSync(path.join(root,'local-speech-bridge.js'),'utf8'),context);
 const bridge=context.WordWorkshopLocalSpeech.create({runtime:{getManifest:()=>({permissions:['offscreen']}),sendMessage:async m=>{
  if(m.action==='speech-ready'){readyCalls++;if(readyCalls===1) return undefined;if(readyCalls===2) throw Error('Receiving end does not exist');return {...readyIdentity};}
  if(m.action==='speech-play') {assert.equal(m.engine,'piper');assert.equal(m.protocol,3);plays++;return {ok:true};} return {ok:true};
 }}});
 assert.equal((await bridge.speak('apple',{requestId:'1'},()=>{})).ok,true);
 assert.equal(readyCalls,3);assert.equal(plays,1);
});
test('ready handshake does not initialize synthesis or translation',async()=>{
 let generations=0;const f=fixture(async()=>{generations++;return new Blob(['wav']);});
 assert.deepEqual(JSON.parse(JSON.stringify(await f.request({action:'speech-ready'}))),readyIdentity);assert.equal(generations,0);
});

test('late stop for an old request cannot pause newer audio',async()=>{
 const f=fixture(async()=>new Blob(['wav']));
 await f.request({action:'speech-play',requestId:'new'});
 await f.request({action:'speech-stop',requestId:'old'});
 assert.equal(f.audios[0].paused,undefined);assert.equal(f.revoked.length,0);
 await f.request({action:'speech-stop',requestId:'new'});assert.equal(f.audios[0].paused,true);
});
test('terminal error before play response retains real error and rejects subsequent stale events',async()=>{
 let resolve;const context=vm.createContext({setTimeout,WordWorkshopLocalModel:{ensure:async()=>{}}});
 vm.runInContext(fs.readFileSync(path.join(root,'local-speech-bridge.js'),'utf8'),context);
 const bridge=context.WordWorkshopLocalSpeech.create({runtime:{getManifest:()=>({permissions:['offscreen']}),sendMessage:async m=>m.action==='speech-play'?new Promise(r=>resolve=r):readyReply(m,{ok:true})}});
 const statuses=[];const pending=bridge.speak('apple',{requestId:'one'},m=>statuses.push(m));await flush();
 assert.equal(bridge.handleEvent({action:'local-speech-event',requestId:'one',stage:'error',error:'decode failed'}),true);
 assert.equal(bridge.handleEvent({action:'local-speech-event',requestId:'one',stage:'playing'}),false);
 resolve({ok:true});const result=await pending;assert.equal(result.ok,false);assert.equal(result.error,'decode failed');assert.equal(result.cancelled,undefined);
});
test('real ending before the response is successful rather than cancelled',async()=>{
 let resolve;const context=vm.createContext({setTimeout,WordWorkshopLocalModel:{ensure:async()=>{}}});
 vm.runInContext(fs.readFileSync(path.join(root,'local-speech-bridge.js'),'utf8'),context);
 const bridge=context.WordWorkshopLocalSpeech.create({runtime:{getManifest:()=>({permissions:['offscreen']}),sendMessage:async m=>m.action==='speech-play'?new Promise(r=>resolve=r):readyReply(m,{ok:true})}});
 const pending=bridge.speak('a',{requestId:'one'},()=>{});await flush();
 bridge.handleEvent({action:'local-speech-event',requestId:'one',stage:'ended'});resolve({ok:true});assert.equal((await pending).ok,true);
});

test('speech and translation share one document without speech loading translation model',async()=>{
 let creates=0;const actions=[];
 const api={runtime:{getManifest:()=>({permissions:['offscreen']}),getURL:p=>'chrome-extension://id/'+p,getContexts:async()=>[],sendMessage:async m=>{actions.push(m.action);return readyReply(m,{ok:true});}},offscreen:{createDocument:async()=>{creates++;}}};
 const context=vm.createContext({chrome:api,setTimeout});
 for(const file of ['model-bridge.js','local-speech-bridge.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
 const bridge=context.WordWorkshopLocalSpeech.create(api);
 await Promise.all([bridge.speak('apple',{requestId:'1'},()=>{}),context.WordWorkshopLocalModel.ensure()]);
 assert.equal(creates,1);assert.deepEqual(actions,['speech-ready','speech-play']);
});

test('bridge with no active record never sends an ambiguous global stop',async()=>{
 const messages=[];const context=vm.createContext({setTimeout,WordWorkshopLocalModel:{ensure:async()=>{}}});
 vm.runInContext(fs.readFileSync(path.join(root,'local-speech-bridge.js'),'utf8'),context);
 const bridge=context.WordWorkshopLocalSpeech.create({runtime:{getManifest:()=>({permissions:['offscreen']}),sendMessage:async m=>{messages.push(m);return readyReply(m,{ok:true});}}});
 await bridge.stop();assert.equal(messages.length,0);
 await bridge.stop({all:true});assert.equal(messages.length,1);assert.equal(messages[0].all,true);
});
test('document ignores unscoped stop while explicit all stops current audio',async()=>{
 const f=fixture(async()=>new Blob(['wav']));await f.request({action:'speech-play',requestId:'new'});
 await f.request({action:'speech-stop'});assert.equal(f.audios[0].paused,undefined);
 await f.request({action:'speech-stop',all:true});assert.equal(f.audios[0].paused,true);
});

for(const legacy of [{ok:true},{ok:true,engine:'kokoro',protocol:2},{ok:true,engine:'piper',protocol:2}]) test('legacy ready identity is refused: '+JSON.stringify(legacy),async()=>{
 let plays=0;const context=vm.createContext({setTimeout:fn=>fn(),WordWorkshopLocalModel:{ensure:async()=>{}}});
 vm.runInContext(fs.readFileSync(path.join(root,'local-speech-bridge.js'),'utf8'),context);
 const bridge=context.WordWorkshopLocalSpeech.create({runtime:{getManifest:()=>({permissions:['offscreen']}),sendMessage:async m=>{if(m.action==='speech-play')plays++;return legacy;}}});
 const result=await bridge.speak('apple',{requestId:'old-doc'},()=>assert.fail());
 assert.equal(result.ok,false);assert.ok(result.error);assert.equal(plays,0);
});
test('document refuses wrong playback engine or protocol before generating',async()=>{
 let generations=0;const f=fixture(async()=>{generations++;return new Blob(['wav']);});
 for(const invalid of [{engine:'kokoro',protocol:2},{engine:'piper',protocol:2},{engine:'piper',protocol:1},{engine:undefined,protocol:undefined}]) {
  const result=await f.request({action:'speech-play',requestId:'wrong',text:'apple',...invalid});
  assert.equal(result.ok,false);assert.ok(result.error);
 }
 assert.equal(generations,0);assert.equal(f.audios.length,0);
});
