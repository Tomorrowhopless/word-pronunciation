const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function findByClass(element, className) {
  if (element.className === className) return element;
  for (const child of element.children || []) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return undefined;
}

function createMockDOM() {
  const eventListeners = {};
  const bodyChildren = [];

  const createElement = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      href: '',
      target: '',
      style: {},
      children: [],
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
        toggle(c, force) {
          if (force) this._classes.add(c);
          else this._classes.delete(c);
        },
      },
      addEventListener() {},
      setAttribute(name, value) { this[name] = value; },
      appendChild(child) { this.children.push(child); },
      contains(other) {
        return this.children.includes(other);
      },
      remove() {
        const idx = bodyChildren.indexOf(el);
        if (idx >= 0) bodyChildren.splice(idx, 1);
      },
      getBoundingClientRect() {
        return { top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20 };
      },
    };
    return el;
  };

  const mockDocument = {
    createElement,
    body: {
      children: bodyChildren,
      addEventListener() {},
      appendChild(child) { bodyChildren.push(child); },
    },
    addEventListener(event, handler, opts) {
      if (!eventListeners[event]) eventListeners[event] = [];
      eventListeners[event].push(handler);
    },
  };

  return { mockDocument, eventListeners, bodyChildren };
}

function loadContent(mockApi, realTranslation = false) {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'content.js'),
    'utf-8',
  );
  const { mockDocument, eventListeners, bodyChildren } = createMockDOM();

  const mockWindow = {
    getSelection: () => ({
      toString: () => 'hello',
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => ({
          top: 100, bottom: 120, left: 50, right: 150,
        }),
      }),
    }),
    scrollY: 0,
    scrollX: 0,
    innerWidth: 1024,
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
    }),
  };

  const wrappedCode = `
    ${code}
    __exports = { createTooltip, showNotFound, showSuggestionsTooltip, removeTooltip, getSelectedText };
    __state = { get currentTooltip() { return currentTooltip; } };
  `;

  const context = {
    globalThis: { browser: mockApi },
    WordWorkshopPlayback: { bind: () => () => {} },
    window: mockWindow,
    document: mockDocument,
    console,
    Set,
    __exports: {},
    __state: {},
  };
  vm.createContext(context);
  if (realTranslation) {
    Object.assign(context.globalThis, { document: mockDocument, TextEncoder, AbortController });
    for (const file of ['reviewed-translations.js', 'translation-client.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  vm.runInContext(wrappedCode, context);
  return { ctx: context.__exports, state: context.__state, eventListeners, bodyChildren, mockWindow };
}

function createMockApi() {
  return {
    runtime: {
      sendMessage: async () => ({}),
      onMessage: { addListener: () => {} },
    },
    storage: {
      local: { get: async () => ({}) },
      onChanged: { addListener: () => {} },
    },
  };
}

describe('content.js', () => {
  describe('createTooltip', () => {
    it('creates a tooltip with word and definitions', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      const entry = {
        word: 'hello',
        meanings: [
          { def: 'a greeting', speech_part: 'noun', example: 'Hello there!' },
          { def: 'to say hello', speech_part: 'verb' },
        ],
      };
      const rect = { bottom: 100, left: 50 };

      ctx.createTooltip(entry, rect);

      assert.equal(bodyChildren.length, 1);
      const tooltip = bodyChildren[0];
      assert.equal(tooltip.className, 'dict-ext-tooltip');

      // Header should contain word
      const header = tooltip.children[0];
      assert.equal(header.className, 'dict-ext-header');
      assert.equal(header.children[0].textContent, 'hello');
      assert.equal(header.children[1].textContent, 'noun');
    });

    it('shows stem notice when stemInfo provided', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      const entry = {
        word: 'cat',
        meanings: [{ def: 'a small animal', speech_part: 'noun' }],
      };
      const stemInfo = { from: 'cats', to: 'cat' };

      ctx.createTooltip(entry, { bottom: 100, left: 50 }, stemInfo);

      const tooltip = bodyChildren[0];
      // First child should be stem notice
      assert.equal(tooltip.children[0].className, 'dict-ext-stem-notice');
      assert.equal(tooltip.children[0].textContent, 'cats \u2192 cat');
      // Header is second child
      assert.equal(tooltip.children[1].className, 'dict-ext-header');
    });

    it('limits definitions to 3', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      const entry = {
        word: 'test',
        meanings: [
          { def: 'def1', speech_part: 'noun' },
          { def: 'def2', speech_part: 'noun' },
          { def: 'def3', speech_part: 'noun' },
          { def: 'def4', speech_part: 'noun' },
          { def: 'def5', speech_part: 'noun' },
        ],
      };

      ctx.createTooltip(entry, { bottom: 100, left: 50 });

      const tooltip = bodyChildren[0];
      const defs = tooltip.children.find(c => c.className === 'dict-ext-defs');
      assert.equal(defs.children.length, 3);
    });

    it('includes example when present', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      const entry = {
        word: 'hello',
        meanings: [{ def: 'a greeting', speech_part: 'noun', example: 'Say hello!' }],
      };

      ctx.createTooltip(entry, { bottom: 100, left: 50 });

      const tooltip = bodyChildren[0];
      const defs = tooltip.children.find(c => c.className === 'dict-ext-defs');
      const firstDef = defs.children[0];
      const exampleEl = firstDef.children[0];
      assert.equal(exampleEl.className, 'dict-ext-example');
      assert.equal(exampleEl.textContent, '"Say hello!"');
    });

    it('shows IPA row when entry.ipa is present', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      const entry = {
        word: 'hello',
        ipa: '/həˈloʊ/',
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.createTooltip(entry, { bottom: 100, left: 50 });

      const tooltip = bodyChildren[0];
      const allClasses = tooltip.children.map((c) => c.className);
      assert.ok(allClasses.includes('dict-ext-pronunciation'), 'should have pronunciation row');
      const pronRow = tooltip.children.find((c) => c.className === 'dict-ext-pronunciation');
      assert.equal(pronRow.children[0].textContent, '/həˈloʊ/');
      assert.equal(pronRow.children[0].className, 'dict-ext-ipa');
    });

    it('keeps speech row when no IPA', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      const entry = {
        word: 'hello',
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.createTooltip(entry, { bottom: 100, left: 50 });

      const tooltip = bodyChildren[0];
      const allClasses = tooltip.children.map((c) => c.className);
      assert.ok(allClasses.includes('dict-ext-pronunciation'));
    });

    it('renders Chinese separately from original English definitions and examples', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());
      const entry = { word: 'apple', translation: 'n. 苹果', meanings: [{ def: 'fruit', speech_part: 'noun', example: 'Eat an apple.' }] };
      ctx.createTooltip(entry, { bottom: 100, left: 50 });
      const tooltip = bodyChildren[0];
      const chinese = tooltip.children.find(c => c.className === 'dict-ext-chinese');
      assert.equal(chinese.children[0].textContent, '中文释义');
      assert.equal(chinese.children[1].textContent, 'n. 苹果');
      const defs = tooltip.children.find(c => c.className === 'dict-ext-defs');
      assert.equal(defs.children[0].textContent, 'fruit');
      assert.equal(defs.children[0].children[0].textContent, '"Eat an apple."');
    });

    it('labels stem Chinese as a reference and honestly displays absent Chinese', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());
      ctx.createTooltip({ word: 'cats', translation: '猫', translationWord: 'cat', meanings: [] }, { bottom: 100, left: 50 });
      let chinese = bodyChildren[0].children.find(c => c.className === 'dict-ext-chinese');
      assert.equal(chinese.children[0].textContent, '中文参考（cat）');
      ctx.createTooltip({ word: 'rare', meanings: [] }, { bottom: 100, left: 50 });
      chinese = bodyChildren[0].children.find(c => c.className === 'dict-ext-chinese');
      assert.match(chinese.children[1].textContent, /暂未收录/);
    });

    it('shows etymology when entry.etymology is present', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      const entry = {
        word: 'hello',
        etymology: 'From Old English.',
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.createTooltip(entry, { bottom: 100, left: 50 });

      const tooltip = bodyChildren[0];
      const etymEl = findByClass(tooltip, 'dict-ext-etymology');
      assert.ok(etymEl, 'should have etymology element');
      assert.equal(etymEl.textContent, 'From Old English.');
    });

    it('truncates long etymology to 150 chars in tooltip', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      const entry = {
        word: 'hello',
        etymology: 'X'.repeat(200),
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.createTooltip(entry, { bottom: 100, left: 50 });

      const tooltip = bodyChildren[0];
      const etymEl = findByClass(tooltip, 'dict-ext-etymology');
      assert.ok(etymEl.textContent.length <= 150);
      assert.ok(etymEl.textContent.endsWith('\u2026'));
    });

    it('omits etymology when absent', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      const entry = {
        word: 'hello',
        meanings: [{ def: 'a greeting', speech_part: 'noun' }],
      };

      ctx.createTooltip(entry, { bottom: 100, left: 50 });

      const tooltip = bodyChildren[0];
      assert.equal(findByClass(tooltip, 'dict-ext-etymology'), undefined);
    });
  });

  describe('showSuggestionsTooltip', () => {
    it('shows not-found message with suggestions', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      ctx.showSuggestionsTooltip('helo', ['hello', 'help', 'held'], { bottom: 100, left: 50 });

      assert.equal(bodyChildren.length, 1);
      const tooltip = bodyChildren[0];
      assert.equal(tooltip.children[0].className, 'dict-ext-notfound');
      assert.equal(tooltip.children[0].textContent, '未找到“helo”');
      // Suggestions container
      assert.equal(tooltip.children[1].className, 'dict-ext-suggestions');
      assert.equal(tooltip.children[1].children.length, 3);
    });
  });

  describe('removeTooltip', () => {
    it('removes existing tooltip', () => {
      const { ctx, state, bodyChildren } = loadContent(createMockApi());

      ctx.createTooltip(
        { word: 'test', meanings: [{ def: 'x', speech_part: 'noun' }] },
        { bottom: 100, left: 50 },
      );
      assert.equal(bodyChildren.length, 1);

      ctx.removeTooltip();
      assert.equal(bodyChildren.length, 0);
      assert.equal(state.currentTooltip, null);
    });

    it('does nothing when no tooltip exists', () => {
      const { ctx, state } = loadContent(createMockApi());

      ctx.removeTooltip(); // should not throw
      assert.equal(state.currentTooltip, null);
    });
  });

  describe('showNotFound', () => {
    it('shows not-found message', () => {
      const { ctx, bodyChildren } = loadContent(createMockApi());

      ctx.showNotFound('xyzzy', { bottom: 100, left: 50 });

      assert.equal(bodyChildren.length, 1);
      const tooltip = bodyChildren[0];
      const msg = tooltip.children[0];
      assert.equal(msg.className, 'dict-ext-notfound');
      assert.equal(msg.textContent, '本地词库中未找到“xyzzy”');
    });
  });

  describe('message listener', () => {
    it('responds to popup with selected text', () => {
      let messageListener;
      const mockApi = {
        runtime: {
          sendMessage: async () => ({}),
          onMessage: {
            addListener: (fn) => { messageListener = fn; },
          },
        },
        storage: {
          local: { get: async () => ({}) },
          onChanged: { addListener: () => {} },
        },
      };
      loadContent(mockApi);

      let response;
      messageListener(
        { from: 'browserAction' },
        {},
        (r) => { response = r; },
      );

      assert.ok(response);
      assert.equal(typeof response.keyword, 'string');
    });
  });
});

function pendingLookup() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function selectWord(mockWindow, word) {
  mockWindow.getSelection = () => ({ toString: () => word, rangeCount: 1, getRangeAt: () => ({ getBoundingClientRect: () => ({ bottom: 100, left: 50 }) }) });
}

it('latest double-click result wins over an older delayed dictionary response', async () => {
  const old = pendingLookup();
  const api = createMockApi();
  api.runtime.sendMessage = ({ word }) => word === 'apple' ? old.promise : Promise.resolve({ entry: { word, meanings: [{ def: 'new word', speech_part: 'noun' }] } });
  const { eventListeners, mockWindow, bodyChildren } = loadContent(api);
  selectWord(mockWindow, 'apple');
  const pending = eventListeners.dblclick[0]({ target: {} });
  selectWord(mockWindow, 'book');
  await eventListeners.dblclick[0]({ target: {} });
  old.resolve({ entry: { word: 'apple', meanings: [{ def: 'old word', speech_part: 'noun' }] } });
  await pending;
  assert.equal(findByClass(bodyChildren[0], 'dict-ext-word').textContent, 'book');
});

it('Escape cancels a pending tooltip lookup instead of reopening it later', async () => {
  const old = pendingLookup();
  const api = createMockApi();
  api.runtime.sendMessage = () => old.promise;
  const { eventListeners, mockWindow, bodyChildren } = loadContent(api);
  selectWord(mockWindow, 'apple');
  const pending = eventListeners.dblclick[0]({ target: {} });
  eventListeners.keydown[0]({ key: 'Escape' });
  old.resolve({ entry: { word: 'apple', meanings: [{ def: 'fruit', speech_part: 'noun' }] } });
  await pending;
  assert.equal(bodyChildren.length, 0);
});


it('native click-click-dblclick sequence still displays the current word', async () => {
  const api = createMockApi();
  api.runtime.sendMessage = async ({ word }) => ({ entry: { word, meanings: [{ def: 'fruit', speech_part: 'noun' }] } });
  const { eventListeners, mockWindow, bodyChildren } = loadContent(api);
  selectWord(mockWindow, 'apple');
  eventListeners.click[0]({ target: {} });
  eventListeners.click[0]({ target: {} });
  await eventListeners.dblclick[0]({ target: {} });
  assert.equal(findByClass(bodyChildren[0], 'dict-ext-word').textContent, 'apple');
});

for (const cancelEvent of ['click', 'scroll']) {
  it(`${cancelEvent} cancels a pending tooltip lookup`, async () => {
    const old = pendingLookup();
    const api = createMockApi();
    api.runtime.sendMessage = () => old.promise;
    const { eventListeners, mockWindow, bodyChildren } = loadContent(api);
    selectWord(mockWindow, 'apple');
    const pending = eventListeners.dblclick[0]({ target: {} });
    eventListeners[cancelEvent][0]({ target: {} });
    old.resolve({ entry: { word: 'apple', meanings: [{ def: 'fruit', speech_part: 'noun' }] } });
    await pending;
    assert.equal(bodyChildren.length, 0);
  });
}

it('dictionary failure and connection failure show actionable Chinese messages', async () => {
  for (const scenario of [
    { lookup: async () => ({ entry: null, error: 'chinese-dictionary-unavailable' }), message: '词库加载失败，请在设置中重新加载插件。' },
    { lookup: async () => { throw new Error('Extension context invalidated'); }, message: '插件连接失败，请刷新网页后重新查词。' },
  ]) {
    const api = createMockApi();
    api.runtime.sendMessage = scenario.lookup;
    const { eventListeners, mockWindow, bodyChildren } = loadContent(api);
    selectWord(mockWindow, 'acme');
    await eventListeners.dblclick[0]({ target: {} });
    assert.equal(findByClass(bodyChildren[0], 'dict-ext-notfound').textContent, scenario.message);
  }
});

it('real tooltip renderer preserves reviewed Chinese under its own apple definition and example', async () => {
  const { ctx, bodyChildren } = loadContent(createMockApi(), true);
  const entry = JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname, '../data/a.json.gz')))).apple;
  ctx.createTooltip(entry, { bottom: 100, left: 50 }); await Promise.resolve();
  const meanings = findByClass(bodyChildren[0], 'dict-ext-defs').children;
  const reviewed = require('../reviewed-translations.js');
  assert.equal(meanings.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(meanings[i].textContent, entry.meanings[i].def);
    assert.equal(meanings[i].children[0].textContent, reviewed[entry.meanings[i].def]);
    assert.equal(meanings[i].children[1].textContent, '"' + entry.meanings[i].example + '"');
    assert.equal(meanings[i].children[2].textContent, reviewed[entry.meanings[i].example]);
  }
  assert.equal(findByClass(bodyChildren[0], 'dict-ext-translate-button').hidden, true);
});
