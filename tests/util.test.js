const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function createMockDOM() {
  const elements = {};
  const createElement = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      innerHTML: '',
      children: [],
      dataset: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
      appendChild(child) { this.children.push(child); },
      addEventListener() {}, removeEventListener() {},
      setAttribute(k, v) { el[`_attr_${k}`] = v; },
      getAttribute(k) { return el[`_attr_${k}`]; },
    };
    return el;
  };

  const mockDocument = {
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = createElement('div');
        elements[id].id = id;
      }
      return elements[id];
    },
    createElement,
  };

  return { mockDocument, elements };
}

function loadUtil(mockLocalStorage, realTranslation = false) {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'browserAction', 'util.js'),
    'utf-8',
  );
  const { mockDocument, elements } = createMockDOM();

  const wrappedCode = `
    ${code}
    __exports = { hasWhiteSpace, validateKeyword, checkCache, setCache, setDefinition, setMsg };
  `;
  const context = {
    globalThis: {
      browser: {
        storage: { local: mockLocalStorage },
      },
    },
    LocalStorage: mockLocalStorage,
    document: mockDocument,
    console,
    Set,
    Object,
    __exports: {},
  };
  vm.createContext(context);
  if (realTranslation) {
    Object.assign(context.globalThis, { document: mockDocument, TextEncoder, AbortController });
    for (const file of ['reviewed-translations.js', 'translation-client.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  vm.runInContext(wrappedCode, context);
  return { ctx: context.__exports, elements };
}

describe('util.js', () => {
  describe('validateKeyword', () => {
    let ctx;

    beforeEach(() => {
      const mock = { get: async () => ({}), set: () => {} };
      ({ ctx } = loadUtil(mock));
    });

    it('returns true for single word', () => {
      assert.equal(ctx.validateKeyword('hello'), true);
    });

    it('accepts searchable phrases', () => {
      assert.equal(ctx.validateKeyword('hello world'), true);
    });

    it('returns true for hyphenated words', () => {
      assert.equal(ctx.validateKeyword('well-known'), true);
    });

    it('rejects empty string', () => {
      assert.equal(ctx.validateKeyword(''), false);
    });

    it('returns false for tab characters', () => {
      assert.equal(ctx.validateKeyword('hello\tworld'), false);
    });
  });

  describe('checkCache', () => {
    it('returns null when cache is empty', async () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx } = loadUtil(mock);

      const result = await ctx.checkCache('hello');
      assert.equal(result, null);
    });

    it('returns cached entry when word exists', async () => {
      const cachedEntry = {
        originalSearch: 'hello',
        definition: { word: 'hello', meanings: [] },
        stemInfo: null,
      };
      const mock = {
        get: async () => ({ recentWords: [cachedEntry] }),
        set: () => {},
      };
      const { ctx } = loadUtil(mock);

      const result = await ctx.checkCache('hello');
      assert.deepEqual(result, cachedEntry);
    });

    it('matches case-insensitively', async () => {
      const cachedEntry = {
        originalSearch: 'hello',
        definition: { word: 'hello', meanings: [] },
        stemInfo: null,
      };
      const mock = {
        get: async () => ({ recentWords: [cachedEntry] }),
        set: () => {},
      };
      const { ctx } = loadUtil(mock);

      const result = await ctx.checkCache('HELLO');
      assert.deepEqual(result, cachedEntry);
    });

    it('returns null when word is not in cache', async () => {
      const cachedEntry = {
        originalSearch: 'world',
        definition: { word: 'world', meanings: [] },
        stemInfo: null,
      };
      const mock = {
        get: async () => ({ recentWords: [cachedEntry] }),
        set: () => {},
      };
      const { ctx } = loadUtil(mock);

      const result = await ctx.checkCache('hello');
      assert.equal(result, null);
    });
  });

  describe('setCache', () => {
    it('adds new word to cache with stemInfo', async () => {
      let stored = null;
      const mock = {
        get: async () => ({ recentWords: [] }),
        set: (data) => { stored = data; },
      };
      const { ctx } = loadUtil(mock);

      const entry = { word: 'hello', meanings: [] };
      const stemInfo = { from: 'hellos', to: 'hello' };
      await ctx.setCache('Hello', entry, stemInfo);

      assert.equal(stored.recentWords.length, 1);
      assert.equal(stored.recentWords[0].originalSearch, 'hello');
      assert.deepEqual(stored.recentWords[0].definition, entry);
      assert.deepEqual(stored.recentWords[0].stemInfo, stemInfo);
    });

    it('stores null stemInfo when not provided', async () => {
      let stored = null;
      const mock = {
        get: async () => ({ recentWords: [] }),
        set: (data) => { stored = data; },
      };
      const { ctx } = loadUtil(mock);

      await ctx.setCache('Hello', { word: 'hello', meanings: [] });

      assert.equal(stored.recentWords[0].stemInfo, null);
    });

    it('evicts oldest entry when cache is full (20 words)', async () => {
      const existing = Array.from({ length: 20 }, (_, i) => ({
        originalSearch: `word${i}`,
        definition: { word: `word${i}`, meanings: [] },
        stemInfo: null,
      }));
      let stored = null;
      const mock = {
        get: async () => ({ recentWords: existing }),
        set: (data) => { stored = data; },
      };
      const { ctx } = loadUtil(mock);

      await ctx.setCache('newword', { word: 'newword', meanings: [] });

      assert.equal(stored.recentWords.length, 20);
      assert.equal(stored.recentWords[0].originalSearch, 'newword');
      assert.equal(
        stored.recentWords.find((w) => w.originalSearch === 'word19'),
        undefined,
      );
    });

    it('initializes recentWords if missing', async () => {
      let stored = null;
      const mock = {
        get: async () => ({}),
        set: (data) => { stored = data; },
      };
      const { ctx } = loadUtil(mock);

      await ctx.setCache('test', { word: 'test', meanings: [] });

      assert.equal(stored.recentWords.length, 1);
    });
  });

  describe('setDefinition', () => {
    it('populates DOM elements with entry data', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'brilliant',
        meanings: [
          { def: 'very bright', speech_part: 'adjective', example: 'a brilliant light' },
          { def: 'exceptionally talented', speech_part: 'adjective' },
        ],
      };

      ctx.setDefinition(entry);

      const keyword = elements['keyword'];
      const pos = elements['pos'];
      const result = elements['result'];
      const emptyState = elements['empty-state'];

      assert.equal(keyword.textContent, 'brilliant');
      assert.equal(pos.textContent, 'adjective');
      assert.ok(!result.classList.contains('hidden'));
      assert.ok(emptyState.classList.contains('hidden'));
    });

    it('shows stem notice when stemInfo provided', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'cat',
        meanings: [{ def: 'a small animal', speech_part: 'noun' }],
      };
      const stemInfo = { from: 'cats', to: 'cat' };

      ctx.setDefinition(entry, stemInfo);

      const stemNotice = elements['stem-notice'];
      assert.ok(!stemNotice.classList.contains('hidden'));
      assert.equal(stemNotice.textContent, 'cats \u2192 cat');
    });

    it('hides stem notice when no stemInfo', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'hello',
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.setDefinition(entry);

      const stemNotice = elements['stem-notice'];
      assert.ok(stemNotice.classList.contains('hidden'));
    });

    it('sets wiktionary source link', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'test',
        meanings: [{ def: 'a trial', speech_part: 'noun' }],
      };

      ctx.setDefinition(entry);

      const sourceLink = elements['source-link'];
      assert.equal(sourceLink._attr_href, 'https://en.wiktionary.org/wiki/test');
    });

    it('groups meanings by speech_part', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'run',
        meanings: [
          { def: 'to move quickly', speech_part: 'verb' },
          { def: 'a period of running', speech_part: 'noun' },
          { def: 'to operate', speech_part: 'verb' },
        ],
      };

      ctx.setDefinition(entry);

      const resultText = elements['text-result'];
      const sectionLabels = resultText.children
        .filter((c) => c.className === 'section-pos')
        .map((c) => c.textContent);
      assert.deepEqual(sectionLabels, ['verb', 'noun']);
    });

    it('shows IPA and pronunciation row when entry.ipa present', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'hello',
        ipa: '/həˈloʊ/',
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.setDefinition(entry);

      assert.equal(elements['ipa'].textContent, '/həˈloʊ/');
      assert.ok(!elements['pronunciation'].classList.contains('hidden'));
      assert.equal(elements['speak-btn'].dataset.word, 'hello');
    });

    it('keeps speech available when no IPA', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'hello',
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.setDefinition(entry);

      assert.ok(!elements['pronunciation'].classList.contains('hidden'));
      assert.equal(elements['speak-btn'].dataset.word, 'hello');
    });

    it('shows etymology when entry.etymology present', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'hello',
        etymology: 'From Old English hēl, greeting.',
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.setDefinition(entry);

      assert.ok(!elements['etymology'].classList.contains('hidden'));
      assert.equal(elements['etymology'].textContent, 'From Old English hēl, greeting.');
    });

    it('hides etymology when absent', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'hello',
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.setDefinition(entry);

      assert.ok(elements['etymology'].classList.contains('hidden'));
    });

    it('renders antonyms when present', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      const entry = {
        word: 'happy',
        meanings: [{
          def: 'full of joy',
          speech_part: 'adjective',
          antonyms: ['sad', 'miserable'],
        }],
      };

      ctx.setDefinition(entry);

      const resultText = elements['text-result'];
      const antEl = resultText.children.find((c) => c.className === 'antonyms');
      assert.ok(antEl, 'antonyms element should exist');
      assert.ok(antEl.textContent.includes('sad'));
      assert.ok(antEl.textContent.includes('miserable'));
    });
  });

  describe('setMsg', () => {
    it('shows error state and hides result', () => {
      const mock = { get: async () => ({}), set: () => {} };
      const { ctx, elements } = loadUtil(mock);

      ctx.setMsg('Word not found');

      assert.ok(elements['result'].classList.contains('hidden'));
      assert.ok(elements['empty-state'].classList.contains('hidden'));
      assert.ok(!elements['error-state'].classList.contains('hidden'));
      assert.equal(elements['error-state'].textContent, 'Word not found');
    });
  });
});

function allByClass(element, name) {
  return (element.className === name ? [element] : []).concat(...(element.children || []).map(child => allByClass(child, name)));
}
it('real popup renderer places reviewed apple translations underneath each matching English sense and example', async () => {
  const storage = { get: async () => ({}), set: async () => {} };
  const { ctx, elements } = loadUtil(storage, true);
  const entry = JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname, '../data/a.json.gz')))).apple;
  ctx.setDefinition(entry); await Promise.resolve();
  const meanings = allByClass(elements['text-result'], 'def-list')[0].children;
  const reviewed = require('../reviewed-translations.js');
  assert.equal(meanings.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(meanings[i].textContent, entry.meanings[i].def);
    assert.equal(meanings[i].children[0].className, 'definition-zh');
    assert.equal(meanings[i].children[0].textContent, reviewed[entry.meanings[i].def]);
    assert.equal(meanings[i].children[1].textContent, '"' + entry.meanings[i].example + '"');
    assert.equal(meanings[i].children[2].textContent, reviewed[entry.meanings[i].example]);
  }
  assert.equal(allByClass(elements['text-result'], 'section-pos')[0].textContent, 'noun（名词）');
  assert.equal(allByClass(elements['text-result'], 'related-zh')[0].textContent, '苹果树（栽培品种）。');
  assert.equal(allByClass(elements['text-result'], 'translate-button')[0].hidden, true);
});
