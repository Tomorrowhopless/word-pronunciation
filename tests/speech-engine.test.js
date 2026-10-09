const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'speech-engine.js'), 'utf8');
const voices = [
  { voiceName: 'Piper Cori', lang: 'en-GB', engine: 'local-audio' },
];
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function fixture({ settings = {}, getSettings, setStorage, localSpeak, missingBridge = false, available = voices } = {}) {
  let stored = settings;
  const statuses = [], submissions = [], events = [], stops = [], writes = [];
  const local = {
    voices: available,
    stop: async options => { stops.push(options || {}); return { ok: true }; },
    speak: async (text, options, notify) => {
      submissions.push({ text, options }); events.push(notify);
      return localSpeak ? localSpeak(text, options, notify) : { ok: true };
    },
  };
  const api = { storage: { local: {
    get: async () => getSettings ? getSettings() : { speechSettings: stored },
    set: async value => {
      writes.push(value);
      if (value.speechSettings) stored = value.speechSettings;
      if (value.speechStatus) statuses.push(value.speechStatus);
      if (setStorage) await setStorage(value);
    },
  } }, tts: {
    getVoices() { assert.fail('System voice enumeration must never run'); },
    speak() { assert.fail('Old system speech must never run'); },
    stop() { assert.fail('Native TTS must not be used'); },
  } };
  const context = vm.createContext({ WordWorkshopLocalSpeech: missingBridge ? undefined : { create: () => local } });
  vm.runInContext(source, context);
  return { engine: context.WordWorkshopSpeech.create(api), api, statuses, submissions, events, stops, writes, settings: () => stored };
}

test('only Piper voices are returned without enumerating or calling native TTS', async () => {
  const f = fixture({ available: [...voices, { voiceName: 'Samantha', lang: 'en-US' }] });
  assert.deepEqual(Array.from(await f.engine.getVoices(), v => v.voiceName), ['Piper Cori']);
  assert.equal((await f.engine.speak('apple')).voice, 'Piper Cori');
});
test('saved native preferences are forcibly migrated to Piper and persisted', async () => {
  for (const oldVoice of ['Samantha','Daniel','Albert','Kokoro Heart','Kokoro Emma','Piper LJSpeech','Piper Cori']) {
    for (const engine of ['native', 'local-audio']) {
      const f = fixture({ settings: { voiceName: oldVoice, engine, rate: 1.1 } });
      const result = await f.engine.speak('apple');
      assert.equal(result.voice, 'Piper Cori'); assert.equal(result.engine, 'piper');
      assert.equal(f.submissions[0].options.voiceName, 'Piper Cori'); assert.equal(f.submissions[0].options.rate, 1);
      assert.equal(f.settings().voiceName, 'Piper Cori'); assert.equal(f.settings().engine, 'local-audio');assert.equal(f.settings().preset,'cori-reference-v1');
    }
  }
});
test('old Cori slow preference resets to the reference speed during migration', async () => {
  const f=fixture({settings:{voiceName:'Piper Cori',engine:'native',rate:0.85}});
  assert.equal((await f.engine.speak('book')).voice,'Piper Cori');assert.equal(f.settings().rate,1);
});
test('missing packaged service fails visibly instead of returning to the old voice', async () => {
  const f=fixture({missingBridge:true});await assert.rejects(f.engine.getVoices(),/Piper.*未加载/);await assert.rejects(f.engine.speak('apple'),/Piper.*未加载/);
  assert.equal(f.submissions.length,0);
});
test('missing Piper voice files cannot select an available native voice',async()=>{
  const f=fixture({available:[{voiceName:'Samantha',lang:'en-US'}]});await assert.rejects(f.engine.speak('apple'),/Piper.*不可用/);assert.equal(f.submissions.length,0);
});
test('input validation rejects empty, oversized, markup and control text before generation',async()=>{
  const f=fixture();for(const value of ['', ' ', 'a'.repeat(241),'<apple>','apple\n'])await assert.rejects(f.engine.speak(value),/没有可朗读/);assert.equal(f.submissions.length,0);
});
test('rate is clamped and whitespace is trimmed for the model',async()=>{
  for(const [rate,expected] of [[undefined,1],[0.1,0.75],[4,1.25],[1.05,1.05],['invalid',1]]){
    const f=fixture({settings:{rate,preset:'cori-reference-v1',voiceName:'Piper Cori',engine:'local-audio'}});await f.engine.speak(' apple ');assert.equal(f.submissions[0].text,'apple');assert.equal(f.submissions[0].options.rate,expected);
  }
});
test('acceptance stays preparing; real playing and ended events update status',async()=>{
  const f=fixture();assert.equal((await f.engine.speak('apple')).ok,true);assert.equal(f.statuses.at(-1).stage,'preparing');
  f.events[0]({stage:'playing'});await flush();assert.equal(f.statuses.at(-1).stage,'playing');
  f.events[0]({stage:'ended'});await flush();assert.equal(f.statuses.at(-1).stage,'ended');assert.equal(f.statuses.at(-1).voice,'Piper Cori');
});
test('Cori generation failure returns real details without another voice or native fallback',async()=>{
 const f=fixture({localSpeak:async()=>({ok:false,error:'Cori audio rejected'})});
 await assert.rejects(f.engine.speak('apple'),/Cori.*audio rejected/);assert.equal(f.statuses.at(-1).stage,'error');assert.equal(f.submissions.length,1);
});
test('Cori playback error is terminal and stale events cannot claim recovery',async()=>{
 const f=fixture();await f.engine.speak('apple');f.events[0]({stage:'error',error:'output failed'});await flush();
 assert.equal(f.submissions.length,1);assert.match(f.statuses.at(-1).error,/output failed/);
 f.events[0]({stage:'playing'});f.events[0]({stage:'ended'});await flush();assert.equal(f.statuses.at(-1).stage,'error');
});
test('early audio error is preserved when the response arrives later',async()=>{
 const f=fixture({localSpeak:async(text,options,notify)=>{notify({stage:'error',error:'early decode failure'});return {ok:false,error:'late response'};}});
 await assert.rejects(f.engine.speak('apple'),/early decode failure/);assert.equal(f.submissions.length,1);
});
test('saved Cori reference preset preserves the user selected speed',async()=>{
 const f=fixture({settings:{voiceName:'Piper Cori',engine:'local-audio',rate:0.85,preset:'cori-reference-v1'}});
 await f.engine.speak('apple');assert.equal(f.submissions[0].options.rate,0.85);assert.equal(f.settings().rate,0.85);
});
test('old events cannot overwrite a newer word',async()=>{
  const f=fixture();await f.engine.speak('apple');await f.engine.speak('book');f.events[1]({stage:'playing'});await flush();
  for(const stage of ['playing','ended','error','stopped'])f.events[0]({stage,error:'old'});await flush();assert.equal(f.statuses.at(-1).word,'book');assert.equal(f.statuses.at(-1).stage,'playing');
});
test('a slow settings read from an old click cannot start old audio or overwrite settings',async()=>{
  const first=deferred();let reads=0;const f=fixture({getSettings:()=>++reads===1?first.promise:{speechSettings:{voiceName:'Piper Cori',engine:'local-audio',rate:1}}});
  const old=f.engine.speak('apple');await flush();await f.engine.speak('book');first.resolve({speechSettings:{voiceName:'Samantha',engine:'native'}});assert.equal((await old).cancelled,true);assert.deepEqual(f.submissions.map(x=>x.text),['book']);assert.equal(f.submissions[0].options.voiceName,'Piper Cori');
});
test('a delayed preparing write cannot start a superseded word',async()=>{
  const pending=deferred();const f=fixture({setStorage:value=>value.speechStatus?.word==='apple'&&value.speechStatus.stage==='preparing'?pending.promise:undefined});
  const old=f.engine.speak('apple');await flush();const latest=f.engine.speak('book');await flush();pending.resolve();await latest;assert.equal((await old).cancelled,true);assert.deepEqual(f.submissions.map(x=>x.text),['book']);
});
test('stopping during preparation cancels generation before submission',async()=>{
  const pending=deferred();const f=fixture({setStorage:value=>value.speechStatus?.stage==='preparing'?pending.promise:undefined});
  const old=f.engine.speak('apple');await flush();const stopped=f.engine.stop();pending.resolve();await stopped;assert.equal((await old).cancelled,true);assert.equal(f.submissions.length,0);assert.equal(f.statuses.at(-1).stage,'stopped');
});
test('stopping during inference rejects late playback and retains the active word',async()=>{
  const pending=deferred();const f=fixture({localSpeak:()=>pending.promise});const old=f.engine.speak('apple');await flush();await f.engine.stop();
  f.events[0]({stage:'playing'});pending.resolve({ok:true});assert.equal((await old).cancelled,true);await flush();assert.equal(f.statuses.at(-1).word,'apple');assert.equal(f.statuses.at(-1).stage,'stopped');assert.equal(f.stops.at(-1).all,true);
});
test('terminal playback rejects later callbacks for the same request',async()=>{
  const f=fixture();await f.engine.speak('apple');f.events[0]({stage:'ended'});f.events[0]({stage:'playing'});f.events[0]({stage:'error',error:'late'});await flush();assert.equal(f.statuses.at(-1).stage,'ended');assert.equal(f.submissions.length,1);
});
test('the manifest no longer grants access to the old native TTS engine',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));assert.equal(manifest.permissions.includes('tts'),false);assert.equal(manifest.permissions.includes('offscreen'),true);
});
