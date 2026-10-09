const api = globalThis.browser ?? globalThis.chrome;

let currentTooltip = null;
let selectedText = '';
let querySerial = 0;
let themeSetting = 'system';

const getSelectedText = () => window.getSelection().toString().trim();

// --- Theme awareness ---

function resolveTheme(setting) {
  if (setting === 'dark' || setting === 'light') return setting;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

(async function loadTheme() {
  const store = await api.storage.local.get('theme');
  themeSetting = store.theme || 'system';
})();

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) {
    themeSetting = changes.theme.newValue || 'system';
    if (currentTooltip) {
      currentTooltip.classList.toggle('dark-theme', resolveTheme(themeSetting) === 'dark');
    }
  }
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (themeSetting === 'system' && currentTooltip) {
    currentTooltip.classList.toggle('dark-theme', resolveTheme('system') === 'dark');
  }
});

// --- Tooltip helpers ---

function applyTheme(tooltip) {
  if (resolveTheme(themeSetting) === 'dark') tooltip.classList.add('dark-theme');
}

function positionTooltip(tooltip, rect) {
  tooltip.style.top = `${rect.bottom + window.scrollY + 6}px`;
  tooltip.style.left = `${rect.left + window.scrollX}px`;
  document.body.appendChild(tooltip);

  const tooltipRect = tooltip.getBoundingClientRect();
  if (tooltipRect.bottom > window.innerHeight - 8) tooltip.style.top = `${Math.max(8, window.innerHeight - tooltipRect.height - 8) + window.scrollY}px`;
  if (tooltipRect.right > window.innerWidth - 8) {
    tooltip.style.left = `${window.innerWidth - tooltipRect.width - 8 + window.scrollX}px`;
  }
}

// --- Tooltip rendering ---

function createTooltip(entry, rect, stemInfo) {
  removeTooltip();

  const tooltip = document.createElement('div');
  const translator = globalThis.WordWorkshopTranslation;
  const sentenceSegments = [];
  tooltip.className = 'dict-ext-tooltip';
  applyTheme(tooltip);

  // Stem notice
  if (stemInfo) {
    const notice = document.createElement('div');
    notice.className = 'dict-ext-stem-notice';
    notice.textContent = stemInfo.from + ' \u2192 ' + stemInfo.to;
    tooltip.appendChild(notice);
  }

  // Word + part of speech header
  const header = document.createElement('div');
  header.className = 'dict-ext-header';

  const word = document.createElement('span');
  word.className = 'dict-ext-word';
  word.textContent = entry.word;
  header.appendChild(word);

  if (entry.meanings[0]) {
    const pos = document.createElement('span');
    pos.className = 'dict-ext-pos';
    pos.textContent = translator?.posLabel(entry.meanings[0].speech_part) || entry.meanings[0].speech_part;
    header.appendChild(pos);
  }

  tooltip.appendChild(header);

  // IPA is optional; speech uses only installed local English voices.
  {
    const pronRow = document.createElement('div');
    pronRow.className = 'dict-ext-pronunciation';
    if (entry.ipa) {
      const ipaSpan = document.createElement('span');
      ipaSpan.className = 'dict-ext-ipa';
      ipaSpan.textContent = entry.ipa;
      pronRow.appendChild(ipaSpan);
    }
    const speechNotice = document.createElement('span');
    speechNotice.className = 'dict-ext-speech-notice';
    speechNotice.setAttribute('role', 'status');
    const speakBtn = document.createElement('button');
    speakBtn.className = 'dict-ext-speak-btn';
    speakBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    speakBtn.title = '朗读英文';
    speakBtn.setAttribute('aria-label', '朗读英文');
    tooltip._disposeSpeech = WordWorkshopPlayback.bind(speakBtn, speechNotice, () => entry.word);
    pronRow.appendChild(speakBtn);
    pronRow.appendChild(speechNotice);
    tooltip.appendChild(pronRow);
  }

  const chinese = document.createElement('div');
  chinese.className = 'dict-ext-chinese';
  const chineseLabel = document.createElement('strong');
  chineseLabel.textContent = entry.translationWord && entry.translationWord !== entry.word.toLowerCase() ? '中文参考（' + entry.translationWord + '）' : '中文释义';
  const chineseText = document.createElement('div');
  chineseText.textContent = entry.translation || (entry.translationError ? '中文词库加载失败，请重新加载插件。' : '这个词暂未收录中文释义。');
  chinese.appendChild(chineseLabel); chinese.appendChild(chineseText); tooltip.appendChild(chinese);
  const translationButton = document.createElement('button');
  translationButton.type = 'button'; translationButton.className = 'dict-ext-translate-button';
  translationButton.textContent = '生成中文'; translationButton.hidden = true;
  const translationNotice = document.createElement('p');
  translationNotice.className = 'dict-ext-translation-notice'; translationNotice.setAttribute('role', 'status');
  tooltip.appendChild(translationButton); tooltip.appendChild(translationNotice);

  // Definitions (max 3)
  const defs = document.createElement('ol');
  defs.className = 'dict-ext-defs';

  let count = 0;
  for (const meaning of entry.meanings) {
    if (count >= 3) break;
    const li = document.createElement('li');
    li.className = 'dict-ext-def';
    li.textContent = meaning.def;
    if (translator) sentenceSegments.push(translator.append(li, meaning.def, meaning.defZh, 'dict-ext-definition-zh'));

    if (meaning.example) {
      const ex = document.createElement('div');
      ex.className = 'dict-ext-example';
      ex.textContent = `"${meaning.example}"`;
      li.appendChild(ex);
      if (translator) sentenceSegments.push(translator.append(li, meaning.example, meaning.exampleZh, 'dict-ext-example-zh'));
    }

    defs.appendChild(li);
    count++;
  }

  tooltip.appendChild(defs);
  if (translator) tooltip._disposeTranslation = translator.bind(sentenceSegments, { button: translationButton, notice: translationNotice });

  if (entry.etymology) {
    const details = document.createElement('details'); details.className = 'dict-ext-etymology-details';
    const summary = document.createElement('summary'); summary.textContent = '词源';
    const etymology = document.createElement('div'); etymology.className = 'dict-ext-etymology';
    etymology.textContent = entry.etymology.length > 150 ? entry.etymology.slice(0, 148) + '\u2026' : entry.etymology;
    details.appendChild(summary); details.appendChild(etymology); tooltip.appendChild(details);
  }

  // Footer link
  const footer = document.createElement('div');
  footer.className = 'dict-ext-footer';
  if (entry.meaningsSource === 'wordset') {
    const wordsetLink = document.createElement('a');
    wordsetLink.href = 'https://github.com/wordset/wordset-dictionary';
    wordsetLink.target = '_blank';
    wordsetLink.textContent = '释义/例句：Wordset · ';
    wordsetLink.className = 'dict-ext-link';
    footer.appendChild(wordsetLink);
  }
  const link = document.createElement('a');
  link.href = entry.meaningsSource === 'ecdict' ? 'https://github.com/skywind3000/ECDICT' : `https://en.wiktionary.org/wiki/${entry.word}`;
  link.target = '_blank';
  link.textContent = entry.meaningsSource === 'wordset'
    ? 'Wiktionary 音标/词源 \u2192' : entry.meaningsSource === 'ecdict' ? 'ECDICT 中文/英语来源' : 'Wiktionary 英语来源';
  link.className = 'dict-ext-link';
  footer.appendChild(link);
  tooltip.appendChild(footer);

  positionTooltip(tooltip, rect);
  currentTooltip = tooltip;
}

function showSuggestionsTooltip(word, suggestions, rect) {
  removeTooltip();

  const tooltip = document.createElement('div');
  tooltip.className = 'dict-ext-tooltip';
  applyTheme(tooltip);

  const msg = document.createElement('div');
  msg.className = 'dict-ext-notfound';
  msg.textContent = `未找到“${word}”`;
  tooltip.appendChild(msg);

  if (suggestions.length > 0) {
    const container = document.createElement('div');
    container.className = 'dict-ext-suggestions';
    container.textContent = '相近拼写：';
    suggestions.forEach((s) => {
      const tag = document.createElement('span');
      tag.className = 'dict-ext-suggestion';
      tag.textContent = s;
      container.appendChild(tag);
    });
    tooltip.appendChild(container);
  }

  positionTooltip(tooltip, rect);
  currentTooltip = tooltip;
}

function showNotFound(word, rect, message) {
  removeTooltip();

  const tooltip = document.createElement('div');
  tooltip.className = 'dict-ext-tooltip';
  applyTheme(tooltip);

  const msg = document.createElement('div');
  msg.className = 'dict-ext-notfound';
  msg.textContent = message || `本地词库中未找到“${word}”`;
  tooltip.appendChild(msg);

  positionTooltip(tooltip, rect);
  currentTooltip = tooltip;
}

function removeTooltip() {
  if (currentTooltip) {
    currentTooltip._disposeSpeech?.();
    currentTooltip._disposeTranslation?.();
    currentTooltip.remove();
    currentTooltip = null;
  }
}

// --- Event handlers ---

document.addEventListener('dblclick', async (e) => {
  if (e.target?.closest?.('.dict-ext-tooltip,input,textarea,[contenteditable]')) return;
  const word = getSelectedText();
  if (!word || /\s/.test(word)) return;

  selectedText = word;

  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const ticket = ++querySerial;

  try {
    const response = await api.runtime.sendMessage({ action: 'lookup', word });
    if (ticket !== querySerial) return;
    if (response && response.entry) {
      const stemInfo = response.stemmedFrom
        ? { from: response.stemmedFrom, to: response.stemmedTo }
        : null;
      createTooltip(response.entry, rect, stemInfo);
    } else if (response && response.error) {
      showNotFound(word, rect, '词库加载失败，请在设置中重新加载插件。');
    } else if (response && response.suggestions && response.suggestions.length > 0) {
      showSuggestionsTooltip(word, response.suggestions, rect);
    } else {
      showNotFound(word, rect);
    }
  } catch (err) {
    if (ticket === querySerial) showNotFound(word, rect, '插件连接失败，请刷新网页后重新查词。');
  }
});

document.addEventListener('click', (e) => {
  if (!currentTooltip || !currentTooltip.contains(e.target)) {
    querySerial++;
    removeTooltip();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { querySerial++; removeTooltip(); }
});

document.addEventListener('scroll', () => { querySerial++; removeTooltip(); }, { passive: true });

// --- Popup messaging ---

api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.from === 'browserAction') {
    sendResponse({ keyword: selectedText || getSelectedText() });
  }
});
