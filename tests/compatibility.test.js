const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function playbackFixture({ response = { ok: true }, status, reject = false } = {}) {
  let changed;
  let removed = false;
  let text = 'apple';
  const calls = [];
  const button = { disabled: false, listeners: {}, classList: {
    speaking: false, toggle(name, on) { if (name === 'speaking') this.speaking = on; },
  }, addEventListener(event, handler) { this.listeners[event] = handler; }, removeEventListener(event, handler) { if (this.listeners[event] === handler) delete this.listeners[event]; } };
  const notice = { textContent: '' };
  const api = { runtime: { async sendMessage(message) {
    calls.push(message);
    if (reject) throw new Error('disconnected');
    return response;
  } }, storage: {
    local: { get: async () => ({ speechStatus: status }) },
    onChanged: { addListener(handler) { changed = handler; }, removeListener(handler) { removed = handler === changed; } },
  } };
  const context = vm.createContext({ chrome: api,
    // Any accidental old WebSpeech/network fallback fails the test.
    speechSynthesis: { speak() { throw new Error('WebSpeech fallback forbidden'); } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'speech-client.js'), 'utf8'), context);
  const dispose = context.WordWorkshopPlayback.bind(button, notice, () => text);
  return { button, notice, calls, dispose, setText(value) { text = value; },
    emit(state, area = 'local') { changed({ speechStatus: { newValue: state } }, area); },
    get removed() { return removed; } };
}

test('playback client delegates to native background and waits for actual start/end', async () => {
  const f = playbackFixture({ status: { word: 'apple', stage: 'preparing', voice: 'Samantha', lang: 'en-US' } });
  await f.button.listeners.click({ stopPropagation() {} });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].action, 'speak');
  assert.equal(f.calls[0].text, 'apple');
  assert.equal(f.notice.textContent, '准备朗读…');
  assert.equal(f.button.classList.speaking, false);
  f.emit({ word: 'apple', stage: 'playing', voice: 'Samantha', lang: 'en-US' });
  assert.match(f.notice.textContent, /正在朗读.*Samantha.*美式/);
  assert.equal(f.button.classList.speaking, true);
  f.emit({ word: 'apple', stage: 'ended', voice: 'Samantha', lang: 'en-US' });
  assert.match(f.notice.textContent, /已朗读/);
  assert.equal(f.button.classList.speaking, false);
});

test('unavailable local voice shows background error without browser/network fallback', async () => {
  const f = playbackFixture({ response: { ok: false, error: '未找到本机语音' } });
  await f.button.listeners.click();
  assert.equal(f.notice.textContent, '未找到本机语音');
  assert.equal(f.button.classList.speaking, false);
  assert.equal(f.button.disabled, false);
  assert.equal(f.calls.length, 1);
});

test('background connection failure is not reported as played', async () => {
  const f = playbackFixture({ reject: true });
  await f.button.listeners.click();
  assert.match(f.notice.textContent, /连接失败/);
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.classList.speaking, false);
});

test('client ignores other words, other storage areas and disposed tooltip listeners', () => {
  const f = playbackFixture();
  f.emit({ word: 'book', stage: 'ended', voice: 'Samantha', lang: 'en-US' });
  f.emit({ word: 'apple', stage: 'ended', voice: 'Samantha', lang: 'en-US' }, 'sync');
  assert.equal(f.notice.textContent, '');
  f.dispose();
  assert.equal(f.removed, true);
  f.emit({ word: 'apple', stage: 'ended', voice: 'Samantha', lang: 'en-US' });
  assert.equal(f.notice.textContent, '');
});

test('actual native error event clears the playing state', () => {
  const f = playbackFixture();
  f.emit({ word: 'apple', stage: 'playing', voice: 'Daniel', lang: 'en-GB' });
  assert.match(f.notice.textContent, /Daniel.*英式/);
  f.emit({ word: 'apple', stage: 'error', voice: 'Daniel', lang: 'en-GB' });
  assert.match(f.notice.textContent, /没有完成朗读/);
  assert.equal(f.button.classList.speaking, false);
});

for (const [userAgent, scheme] of [['Chrome/130', 'chrome'], ['Chrome/130 Edg/130', 'edge']]) {
  test(scheme + ': shortcut settings use browser page without unsupported APIs', async () => {
    const elements = {};
    const get = selector => elements[selector] ||= { addEventListener(event, fn) { this[event] = fn; } };
    let opened;
    const context = vm.createContext({
      chrome: { commands: { getAll: async () => [{ name: '_execute_action', shortcut: 'Alt+S' }] },
        storage: { local: { get: async () => ({}), set() {} } }, tabs: { create: args => { opened = args.url; } } },
      document: { querySelector: get, querySelectorAll: () => [], addEventListener() {}, documentElement: { setAttribute() {} } },
      window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} },
      navigator: { userAgent },
      WordWorkshopPlayback: { bind() {} },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'options/options.js'), 'utf8'), context);
    await context.updateUI();
    assert.equal(get('#shortcut').readOnly, true);
    assert.equal(get('#update').hidden, true);
    assert.equal(get('#reset').hidden, true);
    assert.equal(get('#browser-shortcuts').hidden, false);
    await context.updateShortcut();
    await context.resetShortcut();
    get('#browser-shortcuts').click();
    assert.equal(opened, scheme + '://extensions/shortcuts');
  });
}

function settingsFixture(settings, response = { ok: true, engine: 'piper', protocol: 3, voices: [
  { voiceName: 'Piper Cori', lang: 'en-GB', engine: 'local-audio' },
] }) {
  const elements = {};
  const get = selector => elements[selector] ||= { value: '', textContent: '', disabled: true, children: [],
    get selectedOptions() { return this.children.filter(child => child.value === this.value); },
    addEventListener(event, handler) { this[event] = handler; }, appendChild(child) { this.children.push(child); }, pause() { this.paused = true; }, async play() { this.paused = false; this.plays = (this.plays || 0) + 1; } };
  let saved;
  const context = vm.createContext({
    chrome: { commands: { getAll: async () => [] }, runtime: { sendMessage: async () => response },
      storage: { local: { get: async () => ({ speechSettings: settings }), set: async value => { saved = value; } } } },
    document: { querySelector: get, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({dataset:{}}), documentElement: { setAttribute() {} } },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} },
    navigator: { userAgent: 'Chrome/130' }, WordWorkshopPlayback: { bind() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'speech-engine.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'options/options.js'), 'utf8'), context);
  return { get, context, saved: () => saved };
}
test('settings migrate every previous voice and speed to the chosen Cori reference', async () => {
  for (const oldVoice of ['Daniel','Kokoro Emma','Kokoro Heart','Samantha','Piper LJSpeech','Piper Cori']) {
    const expected = 'Piper Cori';
    const f=settingsFixture({voiceName:oldVoice,engine:'local-audio',rate:0.85});await f.context.loadVoices();
    assert.equal(f.get('#voice').disabled,false);assert.equal(f.get('#voice').value,expected);assert.equal(f.get('#rate').value,'1');
    assert.equal(f.saved().speechSettings.voiceName,expected);assert.equal(f.saved().speechSettings.engine,'local-audio');assert.equal(f.saved().speechSettings.rate,1);
    assert.equal(f.saved().speechSettings.preset,'cori-reference-v1');
    assert.match(f.get('#voice').children.find(item=>item.value===expected).textContent,/Cori.*英式英语/);
  }
});
test('settings reject an old worker voice list instead of presenting it as Piper',async()=>{
  const f=settingsFixture({voiceName:'Samantha',engine:'native'},{ok:true,voices:[{voiceName:'Samantha',lang:'en-US'}]});await f.context.loadVoices();
  assert.equal(f.get('#voice').disabled,true);assert.match(f.get('#speech-notice').textContent,/旧朗读服务.*重新加载/);assert.equal(f.saved(),undefined);
});
test('settings reject the previous Piper service before saving reference preferences',async()=>{
  const f=settingsFixture({voiceName:'Piper LJSpeech'}, {ok:true,engine:'piper',protocol:2,voices:[{voiceName:'Piper Cori',lang:'en-GB',engine:'local-audio'}]});
  await f.context.loadVoices();assert.match(f.get('#speech-notice').textContent,/旧朗读服务.*重新加载/);assert.equal(f.saved(),undefined);
});
test('settings cannot offer system voices even if an unexpected entry reaches the response',async()=>{
  const f=settingsFixture({}, {ok:true,engine:'piper',protocol:3,voices:[{voiceName:'Samantha',lang:'en-US',engine:'native'},{voiceName:'Piper LJSpeech',lang:'en-US',engine:'local-audio'},{voiceName:'Piper Cori',lang:'en-GB',engine:'local-audio'}]});await f.context.loadVoices();
  assert.deepEqual(f.get('#voice').children.map(item=>item.value),['Piper Cori']);assert.equal(f.saved().speechSettings.engine,'local-audio');
});

test('settings preserve a speed explicitly chosen after the Cori migration', async () => {
  const f=settingsFixture({voiceName:'Piper Cori',engine:'local-audio',rate:0.85,preset:'cori-reference-v1'});
  await f.context.loadVoices();assert.equal(f.get('#rate').value,'0.85');assert.equal(f.saved().speechSettings.rate,0.85);
  f.get('#rate').value='1.15';await f.get('#rate').change();assert.equal(f.saved().speechSettings.rate,1.15);
});

test('settings reference is the exact approved PCM WAV, independent of synthesis', async () => {
  const crypto=require('node:crypto');const data=fs.readFileSync(path.join(__dirname,'..','assets/piper-gb-demo.wav'));
  assert.equal(crypto.createHash('sha256').update(data).digest('hex'),'2cd9357341e2e327d590589274421e0156deb452813ed6a42c42944d4099a67d');
  assert.equal(data.length,120764);assert.equal(data.readUInt32LE(24),22050);assert.equal(data.readUInt16LE(22),1);
  const html=fs.readFileSync(path.join(__dirname,'..','options/options.html'),'utf8');
  assert.match(html,/<audio[^>]+id="reference-audio"[^>]+src="\.\.\/assets\/piper-gb-demo\.wav"/);assert.doesNotMatch(html,/autoplay/);
  const f=settingsFixture({}),messages=[];
  f.context.chrome.runtime.sendMessage=async message=>{messages.push(message);return {ok:true};};
  const audio=f.get('#reference-audio');audio.currentTime=2;audio.playbackRate=0.85;
  await f.get('#preview').click();
  assert.deepEqual(messages.map(m=>m.action),['speech-stop']);assert.equal(audio.plays,1);assert.equal(audio.currentTime,0);assert.equal(audio.playbackRate,1);
  assert.doesNotMatch(f.get('#speech-notice').textContent,/正在播放/);
  audio.playing();assert.match(f.get('#speech-notice').textContent,/正在播放.*Cori/);
  audio.ended();assert.match(f.get('#speech-notice').textContent,/试听结束/);assert.equal(f.get('#preview').disabled,false);
});

test('stopping a pending reference click prevents late playback', async () => {
  const f=settingsFixture({});let release;
  f.context.chrome.runtime.sendMessage=()=>new Promise(resolve=>{release=resolve;});
  const pending=f.get('#preview').click();const firstRelease=release;
  const stopped=f.get('#stop-speech').click();const stopRelease=release;
  firstRelease({ok:true});stopRelease({ok:true});await Promise.all([pending,stopped]);
  assert.equal(f.get('#reference-audio').plays,undefined);assert.equal(f.get('#reference-audio').paused,true);assert.equal(f.get('#preview').disabled,false);
  f.get('#reference-audio').playing();assert.equal(f.get('#speech-notice').textContent,'朗读已停止');
});

test('reference audio rejection and decode errors never report successful playback', async () => {
  const f=settingsFixture({});f.get('#reference-audio').play=async()=>{throw new Error('NotAllowedError');};
  await f.get('#preview').click();assert.match(f.get('#speech-notice').textContent,/试听未能启动/);assert.equal(f.get('#preview').disabled,false);
  f.get('#reference-audio').play=async()=>{};await f.get('#preview').click();f.get('#reference-audio').error();
  assert.match(f.get('#speech-notice').textContent,/无法播放/);assert.equal(f.get('#preview').disabled,false);
  f.get('#reference-audio').ended();assert.match(f.get('#speech-notice').textContent,/无法播放/);
});

test('speech error preserves specific Chinese and native error details instead of claiming playback', () => {
  const f = playbackFixture();
  f.emit({ word: 'apple', stage: 'playing', voice: 'Daniel', lang: 'en-GB' });
  f.emit({ word: 'apple', stage: 'error', error: '本机朗读失败：Voice is unavailable' });
  assert.equal(f.notice.textContent, '本机朗读失败：Voice is unavailable');
  assert.equal(f.button.classList.speaking, false);
  f.emit({ word: 'apple', stage: 'error', reason: 'timeout' });
  assert.match(f.notice.textContent, /未收到朗读开始事件.*无法确认已播放/);
});

test('stop status without a word updates bound notice and clears speaking', () => {
  const f = playbackFixture(); f.emit({ word: 'apple', stage: 'playing', voice: 'Daniel', lang: 'en-GB' });
  f.emit({ stage: 'stopped' }); assert.equal(f.notice.textContent, '朗读已停止'); assert.equal(f.button.classList.speaking, false);
});

test('dispose removes click listener and even a retained stale click cannot invoke speech', async () => {
  const f = playbackFixture(); const staleClick = f.button.listeners.click;
  f.dispose(); assert.equal(f.button.listeners.click, undefined); await staleClick();
  assert.equal(f.calls.length, 0); assert.equal(f.notice.textContent, '');
});

test('failed response clears an existing speaking indicator', async () => {
  const f = playbackFixture({ response: { ok: false, error: '语音不可用' } });
  f.emit({ word: 'apple', stage: 'playing', voice: 'Daniel', lang: 'en-GB' });
  await f.button.listeners.click(); assert.equal(f.button.classList.speaking, false); assert.equal(f.notice.textContent, '语音不可用');
});

test('missing start event is unconfirmed rather than an error or claimed playback', () => {
  const f = playbackFixture();
  f.emit({ word: 'apple', stage: 'unconfirmed', reason: 'missing-start-event', voice: 'Daniel', lang: 'en-GB' });
  assert.equal(f.notice.textContent, '已提交朗读，未收到开始事件；请确认是否有声音。');
  assert.equal(f.button.classList.speaking, false);
});

test('retry preparation names the alternative voice and dialect', () => {
  const f = playbackFixture();
  f.emit({ word: 'apple', stage: 'preparing', retry: 1, voice: 'Daniel', lang: 'en-GB' });
  assert.equal(f.notice.textContent, '正在改用 Daniel · 英式…');
  assert.equal(f.button.classList.speaking, false);
});

test('packaged speech preparation describes real local generation', () => {
 const f=playbackFixture(); f.emit({word:'apple',stage:'preparing',engine:'local-audio',voice:'Piper LJSpeech',lang:'en-US'});
 assert.equal(f.notice.textContent,'正在生成离线英语音频，首次加载请稍等…');
 assert.equal(f.button.classList.speaking,false);
});
