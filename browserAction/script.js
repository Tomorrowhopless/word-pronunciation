// --- Theme init (runs immediately, before DOM renders) ---
function resolveTheme(setting) {
  if (setting === 'dark' || setting === 'light') return setting;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

(async function initTheme() {
  const store = await LocalStorage.get('theme');
  document.documentElement.setAttribute('data-theme', resolveTheme(store.theme || 'system'));
})();

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
  const store = await LocalStorage.get('theme');
  if (!store.theme || store.theme === 'system') {
    document.documentElement.setAttribute('data-theme', resolveTheme('system'));
  }
});

const searchInput = document.getElementById('search');

window.onload = function () {
  const optionsLink = api.runtime.getURL('options/options.html');
  document.getElementById('optionsPage').setAttribute('href', optionsLink);

  // Try to get selected word from the active tab
  api.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    const msg = { from: 'browserAction', msg: 'getText' };

    const handleSelection = (message) => {
      if (message && message.keyword && message.keyword.length > 0) {
        searchInput.value = message.keyword;
        searchWord(message.keyword);
      }
    };

    if (globalThis.browser) {
      api.tabs.sendMessage(tabs[0].id, msg).then(handleSelection, () => {});
    } else {
      api.tabs.sendMessage(tabs[0].id, msg, (response) => {
        if (api.runtime.lastError) return; // content script not available
        handleSelection(response);
      });
    }
  });
};

// Speech is handled by the extension worker, even after the popup closes.
const speechButton = document.getElementById('speak-btn');
const speechNotice = document.createElement('span');
speechNotice.id = 'speech-notice';
speechNotice.setAttribute('role', 'status');
document.getElementById('pronunciation').appendChild(speechNotice);
WordWorkshopPlayback.bind(speechButton, speechNotice, () => speechButton.dataset.word);
let searchSerial = 0;

// Search on Enter
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const word = searchInput.value.trim();
    if (word) searchWord(word);
  }
});

async function searchWord(keyword) {
  const ticket = ++searchSerial;
  const isValid = validateKeyword(keyword);
  if (!isValid) {
    setMsg('请输入英文单词或短语（最多 120 个字符）。');
    return;
  }

  // Check LRU cache first
  const cached = await checkCache(keyword);
  if (ticket !== searchSerial) return;
  if (cached && cached.definition.dataVersion === '4.7.0' && !cached.definition.translationError) {
    setDefinition(cached.definition, cached.stemInfo);
    return;
  }

  // Ask background service worker for lookup
  try {
    const response = await api.runtime.sendMessage({ action: 'lookup', word: keyword });
    if (ticket !== searchSerial) return;
    if (response && response.entry) {
      const stemInfo = response.stemmedFrom
        ? { from: response.stemmedFrom, to: response.stemmedTo }
        : null;
      if (!response.entry.translationError) await setCache(keyword, response.entry, stemInfo);
      if (ticket !== searchSerial) return;
      setDefinition(response.entry, stemInfo);
    } else if (response && response.error) {
      setMsg('离线词库加载失败，请确认 WordWorkshop 文件夹完整，然后重新加载扩展。');
    } else if (response && response.suggestions && response.suggestions.length > 0) {
      showSuggestions(keyword, response.suggestions);
    } else {
      setMsg('本地词库中未找到这个词，请检查拼写。');
    }
  } catch (err) {
    if (ticket === searchSerial) setMsg('本地词库加载失败，请在设置中重新加载插件。');
  }
}

function showSuggestions(word, suggestions) {
  const resultEl = document.getElementById('result');
  const emptyEl = document.getElementById('empty-state');
  const errorEl = document.getElementById('error-state');

  resultEl.classList.add('hidden');
  emptyEl.classList.add('hidden');
  errorEl.classList.remove('hidden');

  errorEl.innerHTML = '';
  const msg = document.createElement('div');
  msg.textContent = `未找到“${word}”，你是否要查：`;
  errorEl.appendChild(msg);

  const list = document.createElement('div');
  list.className = 'suggestions';
  suggestions.forEach((s) => {
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'suggestion-link';
    link.textContent = s;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      searchInput.value = s;
      searchWord(s);
    });
    list.appendChild(link);
  });
  errorEl.appendChild(list);
}
