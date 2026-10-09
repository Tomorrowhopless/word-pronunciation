const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
function fixture(factory) {
 const assets=path.join(root,'vendor/piper/');
 const context=vm.createContext({createPiperPhonemize:factory,URL,console,WebAssembly,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,setTimeout,clearTimeout,process,require,__dirname:assets,__filename:path.join(assets,'phonemize.js'),chrome:{runtime:{getURL:p=>path.join(root,p)}}});
 if(!factory) vm.runInContext(fs.readFileSync(path.join(assets,'phonemize.js'),'utf8').replace('export default createPiperPhonemize;',''),context);
 vm.runInContext(fs.readFileSync(path.join(root,'piper-phonemizer.js'),'utf8').replace(/^import .*;\n/,'').replace('import.meta.url',"'http://localhost/piper-phonemizer.js'").replace('export async function','async function'),context);
 return context;
}
function config() {return JSON.parse(fs.readFileSync(path.join(root,'models/piper-en/gb/en_GB-cori-high.onnx.json'),'utf8'));}
test('actual packaged Piper WASM produces exact reference IDs for English words and sentence',async()=>{
 const f=fixture();const c=config();c.espeak.voice='en-us';
 const golden={apple:[1,0,120,0,39,0,28,0,59,0,24,0,2],dictionary:[1,0,17,0,120,0,74,0,23,0,96,0,59,0,26,0,121,0,61,0,88,0,21,0,2],education:[1,0,121,0,61,0,17,0,108,0,33,0,122,0,23,0,120,0,18,0,74,0,96,0,59,0,26,0,2]};
 for(const [word,ids] of Object.entries(golden)) assert.deepEqual(JSON.parse(JSON.stringify(await f.phonemeIds(word,c))),[ids]);
 const sentence=await f.phonemeIds('This is a clear English sentence.',c);
 assert.deepEqual(Array.from(sentence[0]),[1,0,41,0,74,0,31,0,3,0,74,0,38,0,3,0,50,0,3,0,23,0,24,0,120,0,74,0,88,0,3,0,120,0,74,0,44,0,66,0,24,0,74,0,96,0,3,0,31,0,120,0,61,0,26,0,32,0,59,0,26,0,31,0,10,0,2]);
 const gb=await f.phonemeIds('apple',config('gb'));assert.deepEqual(Array.from(gb[0]),[1,0,120,0,14,0,28,0,59,0,24,0,2]);
 const multi=await f.phonemeIds('Hello world. How are you?',config('gb'));assert.equal(multi.length,2);for(const ids of multi){assert.equal(ids[0],1);assert.equal(ids[1],0);assert.equal(ids.at(-1),2);}
});
test('initialization coalesces, resource paths are local and text requests run in order',async()=>{
 let init=0;const texts=[];const f=fixture(async options=>{init++;assert.match(options.locateFile('piper_phonemize.wasm'),/WordWorkshop\/vendor\/piper\/piper_phonemize.wasm$/);assert.throws(()=>options.locateFile('https://remote/file'));return {callMain(args){texts.push(JSON.parse(args[3])[0].text);options.print(JSON.stringify({phoneme_ids:[1,0,14,0,2],phonemes:['a']}));}};});
 const c={phoneme_type:'espeak',espeak:{voice:'en-us'},phoneme_id_map:{'^':[1],'_':[0],'$':[2],a:[14]}};
 await Promise.all([f.phonemeIds('apple',c),f.phonemeIds('dictionary',c)]);assert.equal(init,1);assert.deepEqual(texts,['apple','dictionary']);
});
test('empty, invalid config, native errors and missing symbols fail honestly',async()=>{
 const f=fixture(async options=>({callMain(){options.printErr('Missing phoneme');}}));
 const c={phoneme_type:'espeak',espeak:{voice:'en-us'},phoneme_id_map:{}};
 await assert.rejects(f.phonemeIds('',c));await assert.rejects(f.phonemeIds('apple',{}));await assert.rejects(f.phonemeIds('apple',c),/Missing phoneme/);
});
test('model-specific ID mapping is applied without silently dropping missing phonemes',async()=>{
 const f=fixture(async options=>({callMain(){options.print(JSON.stringify({phoneme_ids:[1,0,14,0,2],phonemes:['a']}));}}));
 const c={phoneme_type:'espeak',espeak:{voice:'en'},phoneme_id_map:{'^':[7],'_':[8],'$':[9],a:[12,13]}};
 assert.deepEqual(JSON.parse(JSON.stringify(await f.phonemeIds('a',c))),[[7,8,12,13,8,9]]);
 delete c.phoneme_id_map.a;await assert.rejects(f.phonemeIds('a',c),/缺少音素/);
});
test('failed frontend initialization can retry without a poisoned shared promise',async()=>{
 let attempts=0;const f=fixture(async options=>{if(++attempts===1)throw Error('missing wasm');return {callMain(){options.print(JSON.stringify({phoneme_ids:[1,0,14,0,2],phonemes:['a']}));}};});
 const c={phoneme_type:'espeak',espeak:{voice:'en'},phoneme_id_map:{'^':[1],'_':[0],'$':[2],a:[14]}};
 await assert.rejects(f.phonemeIds('a',c),/missing wasm/);assert.equal((await f.phonemeIds('a',c)).length,1);assert.equal(attempts,2);
});
test('native sentence boundaries remain exact with nonstandard model special IDs',async()=>{
 const f=fixture(async options=>({callMain(){options.print(JSON.stringify({phoneme_ids:[1,0,14,0,2,1,0,14,0,14,0,2],phonemes:['a','a','a']}));}}));
 const c={phoneme_type:'espeak',espeak:{voice:'en'},phoneme_id_map:{'^':[41,42],'_':[77],'$':[88,89],a:[200]}};
 assert.deepEqual(JSON.parse(JSON.stringify(await f.phonemeIds('a. aa.',c))),[[41,42,77,200,77,88,89],[41,42,77,200,77,200,77,88,89]]);
});
test('actual British sentence uses original front end rather than American phoneme substitution',async()=>{
 const f=fixture();const ids=await f.phonemeIds('This is a clear English sentence.',config('gb'));
 assert.deepEqual(Array.from(ids[0]),[1,0,41,0,74,0,31,0,3,0,74,0,38,0,3,0,50,0,3,0,23,0,24,0,120,0,21,0,59,0,88,0,3,0,120,0,74,0,44,0,66,0,24,0,74,0,96,0,3,0,31,0,120,0,61,0,26,0,32,0,59,0,26,0,31,0,10,0,2]);
});
