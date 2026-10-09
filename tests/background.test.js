const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');

function loadBackground(mockApi, mockFetch) {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'background.js'),
    'utf-8',
  );
  const context = {
    globalThis: { browser: mockApi },
    fetch: async url => {
      const response = await mockFetch(url);
      return new Response(gzipSync(Buffer.from(JSON.stringify(await response.json()))));
    },
    Response,
    DecompressionStream,
    Map,
    console,
    Object,
    Array,
    Set,
    Math,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

describe('background.js', () => {
  describe('getLetterFile', () => {
    let ctx;

    beforeEach(() => {
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: { addListener: () => {} },
        },
      };
      ctx = loadBackground(mockApi, async () => ({
        json: async () => ({}),
      }));
    });

    it('returns the first letter for lowercase words', () => {
      assert.equal(ctx.getLetterFile('hello'), 'h');
      assert.equal(ctx.getLetterFile('apple'), 'a');
      assert.equal(ctx.getLetterFile('zebra'), 'z');
    });

    it('returns the first letter for uppercase words', () => {
      assert.equal(ctx.getLetterFile('Hello'), 'h');
      assert.equal(ctx.getLetterFile('APPLE'), 'a');
    });

    it('returns misc for non-alpha characters', () => {
      assert.equal(ctx.getLetterFile('123'), 'misc');
      assert.equal(ctx.getLetterFile('-test'), 'misc');
      assert.equal(ctx.getLetterFile('!bang'), 'misc');
    });
  });

  describe('stemWord', () => {
    let ctx;

    beforeEach(() => {
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: { addListener: () => {} },
        },
      };
      ctx = loadBackground(mockApi, async () => ({ json: async () => ({}) }));
    });

    it('stems -ing words', () => {
      const candidates = ctx.stemWord('playing');
      assert.ok(candidates.includes('play'));
    });

    it('stems -ing with e-drop', () => {
      const candidates = ctx.stemWord('making');
      assert.ok(candidates.includes('make'));
    });

    it('stems -ing with doubled consonant', () => {
      const candidates = ctx.stemWord('running');
      assert.ok(candidates.includes('run'));
    });

    it('stems -s plurals', () => {
      const candidates = ctx.stemWord('cats');
      assert.ok(candidates.includes('cat'));
    });

    it('stems -es plurals', () => {
      const candidates = ctx.stemWord('boxes');
      assert.ok(candidates.includes('box'));
    });

    it('stems -ies to -y', () => {
      const candidates = ctx.stemWord('babies');
      assert.ok(candidates.includes('baby'));
    });

    it('stems -ed words', () => {
      const candidates = ctx.stemWord('walked');
      assert.ok(candidates.includes('walk'));
    });

    it('stems -ed with e-drop', () => {
      const candidates = ctx.stemWord('liked');
      assert.ok(candidates.includes('like'));
    });

    it('stems -ly words', () => {
      const candidates = ctx.stemWord('quickly');
      assert.ok(candidates.includes('quick'));
    });

    it('stems -ness words', () => {
      const candidates = ctx.stemWord('darkness');
      assert.ok(candidates.includes('dark'));
    });

    it('returns empty for short words', () => {
      const candidates = ctx.stemWord('is');
      assert.equal(candidates.length, 0);
    });

    it('does not include the original word', () => {
      const candidates = ctx.stemWord('playing');
      assert.ok(!candidates.includes('playing'));
    });
  });

  describe('editDistance', () => {
    let ctx;

    beforeEach(() => {
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: { addListener: () => {} },
        },
      };
      ctx = loadBackground(mockApi, async () => ({ json: async () => ({}) }));
    });

    it('returns 0 for identical strings', () => {
      assert.equal(ctx.editDistance('hello', 'hello'), 0);
    });

    it('returns correct distance for similar strings', () => {
      assert.equal(ctx.editDistance('cat', 'car'), 1);
      assert.equal(ctx.editDistance('kitten', 'sitten'), 1);
    });

    it('returns 999 for very different lengths', () => {
      assert.equal(ctx.editDistance('a', 'abcde'), 999);
    });
  });

  describe('lookupEnglishWord', () => {
    it('returns { entry } when word exists', async () => {
      const mockData = {
        hello: {
          word: 'hello',
          meanings: [{ def: 'a greeting', speech_part: 'noun' }],
        },
      };
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: { addListener: () => {} },
        },
      };
      const mockFetch = async () => ({ json: async () => mockData });
      const ctx = loadBackground(mockApi, mockFetch);

      const result = await ctx.lookupEnglishWord('hello');
      assert.deepEqual(JSON.parse(JSON.stringify(result)), { entry: mockData.hello });
    });

    it('returns { entry: null, suggestions } when word does not exist', async () => {
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: { addListener: () => {} },
        },
      };
      const mockFetch = async () => ({ json: async () => ({}) });
      const ctx = loadBackground(mockApi, mockFetch);

      const result = await ctx.lookupEnglishWord('nonexistentword');
      assert.equal(result.entry, null);
      assert.ok(Array.isArray(result.suggestions));
    });

    it('normalizes word to lowercase', async () => {
      const mockData = {
        hello: {
          word: 'hello',
          meanings: [{ def: 'a greeting', speech_part: 'noun' }],
        },
      };
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: { addListener: () => {} },
        },
      };
      const mockFetch = async () => ({ json: async () => mockData });
      const ctx = loadBackground(mockApi, mockFetch);

      const result = await ctx.lookupEnglishWord('HELLO');
      assert.deepEqual(JSON.parse(JSON.stringify(result)), { entry: mockData.hello });
    });

    it('returns { entry: null } for empty string', async () => {
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: { addListener: () => {} },
        },
      };
      const mockFetch = async () => ({ json: async () => ({}) });
      const ctx = loadBackground(mockApi, mockFetch);

      const result = JSON.parse(JSON.stringify(await ctx.lookupEnglishWord('')));
      assert.deepEqual(result, { entry: null });
    });

    it('returns stemmed match with stemmedFrom/stemmedTo', async () => {
      const mockData = {
        cat: {
          word: 'cat',
          meanings: [{ def: 'a small animal', speech_part: 'noun' }],
        },
      };
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: { addListener: () => {} },
        },
      };
      const mockFetch = async () => ({ json: async () => mockData });
      const ctx = loadBackground(mockApi, mockFetch);

      const result = JSON.parse(JSON.stringify(await ctx.lookupEnglishWord('cats')));
      assert.deepEqual(result.entry, mockData.cat);
      assert.equal(result.stemmedFrom, 'cats');
      assert.equal(result.stemmedTo, 'cat');
    });

    it('caches letter data and reuses it', async () => {
      let fetchCount = 0;
      const mockData = {
        hello: { word: 'hello', meanings: [] },
        happy: { word: 'happy', meanings: [] },
      };
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: { addListener: () => {} },
        },
      };
      const mockFetch = async () => {
        fetchCount++;
        return { json: async () => mockData };
      };
      const ctx = loadBackground(mockApi, mockFetch);

      await ctx.lookupEnglishWord('hello');
      await ctx.lookupEnglishWord('happy');
      assert.equal(fetchCount, 1, 'should only fetch h.json once');
    });
  });

  describe('onMessage listener', () => {
    it('responds to lookup action with new format', async () => {
      const mockData = {
        test: { word: 'test', meanings: [{ def: 'a trial', speech_part: 'noun' }] },
      };
      let messageListener;
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: {
            addListener: (fn) => { messageListener = fn; },
          },
        },
      };
      const mockFetch = async () => ({ json: async () => mockData });
      loadBackground(mockApi, mockFetch);

      const result = await new Promise((resolve) => {
        const returnValue = messageListener(
          { action: 'lookup', word: 'test' },
          {},
          resolve,
        );
        assert.equal(returnValue, true, 'should return true for async');
      });

      assert.deepEqual(JSON.parse(JSON.stringify(result.entry)), { ...mockData.test, dataVersion: '4.7.0' });
    });

    it('ignores messages without lookup action', () => {
      let messageListener;
      const mockApi = {
        runtime: {
          getURL: (p) => `chrome-extension://abc/${p}`,
          onMessage: {
            addListener: (fn) => { messageListener = fn; },
          },
        },
      };
      const mockFetch = async () => ({ json: async () => ({}) });
      loadBackground(mockApi, mockFetch);

      const result = messageListener({ action: 'other' }, {}, () => {});
      assert.equal(result, undefined);
    });
  });
});
