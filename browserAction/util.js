const api = globalThis.browser ?? globalThis.chrome;
const LocalStorage = api?.storage?.local || globalThis.WordWorkshopWebStorage;
let disposeSentenceTranslation;

const hasWhiteSpace = (word) => /\s/g.test(word);

const validateKeyword = (keyword) => typeof keyword === 'string' && keyword.trim().length > 0 && keyword.length <= 120 && !/[\u0000-\u001f<>]/.test(keyword);

async function checkCache(keyword) {
  let store = await LocalStorage.get('recentWords');
  if (!store.recentWords) {
    store = { recentWords: [] };
    LocalStorage.set(store);
  }
  let foundWord = null;
  store.recentWords.some((word) => {
    if (word.originalSearch === keyword.toLowerCase()) {
      foundWord = word;
      return true;
    }
  });
  return foundWord;
}

async function setCache(keyword, entry, stemInfo) {
  const newRecentWord = {
    originalSearch: keyword.toLowerCase(),
    definition: entry,
    stemInfo: stemInfo || null,
  };
  let store = await LocalStorage.get('recentWords');
  if (!store.recentWords) store.recentWords = [];
  if (store.recentWords.length >= 20) store.recentWords.pop();
  store.recentWords.unshift(newRecentWord);
  LocalStorage.set(store);
}

function setDefinition(entry, stemInfo) {
  disposeSentenceTranslation?.();
  const translator = globalThis.WordWorkshopTranslation;
  const sentenceSegments = [];
  const resultEl = document.getElementById('result');
  const emptyEl = document.getElementById('empty-state');
  const errorEl = document.getElementById('error-state');
  const stemNotice = document.getElementById('stem-notice');
  const keywordEl = document.getElementById('keyword');
  const posEl = document.getElementById('pos');
  const pronEl = document.getElementById('pronunciation');
  const ipaEl = document.getElementById('ipa');
  const speakBtn = document.getElementById('speak-btn');
  const etymEl = document.getElementById('etymology');
  const resultText = document.getElementById('text-result');
  const sourceLink = document.getElementById('source-link');
  const chineseText = document.getElementById('chinese-text');
  const chineseHeading = document.getElementById('chinese-heading');
  const etymologyDetails = document.getElementById('etymology-details');

  // Show result, hide empty/error
  resultEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  // Stem notice
  if (stemInfo) {
    stemNotice.classList.remove('hidden');
    stemNotice.textContent = stemInfo.from + ' \u2192 ' + stemInfo.to;
  } else {
    stemNotice.classList.add('hidden');
  }

  // Word
  keywordEl.textContent = entry.word;
  if (chineseText) chineseText.textContent = entry.translation || (entry.translationError ? (globalThis.WordWorkshopWeb ? '中文词库未能读取，请检查网络后重试。' : '中文词库未能加载，请重新加载插件后重试。') : '这个词暂未收录中文释义。');
  if (chineseHeading) chineseHeading.textContent = entry.translationWord && entry.translationWord !== entry.word.toLowerCase() ? '中文参考（' + entry.translationWord + '）' : '中文释义';

  // First part of speech
  posEl.textContent = entry.meanings[0] ? (translator?.posLabel(entry.meanings[0].speech_part) || entry.meanings[0].speech_part) : '';

  // IPA is optional; local speech remains available for every word.
  pronEl.classList.remove('hidden');
  ipaEl.textContent = entry.ipa || '';
  speakBtn.dataset.word = entry.word;
  const speechNotice = document.getElementById('speech-notice');
  if (speechNotice) speechNotice.textContent = '';

  // Etymology
  if (entry.etymology) {
    etymEl.classList.remove('hidden');
    etymEl.textContent = entry.etymology;
    etymologyDetails?.classList.remove('hidden');
  } else {
    etymEl.classList.add('hidden');
    etymEl.textContent = '';
    etymologyDetails?.classList.add('hidden');
  }

  // Source link
  sourceLink.setAttribute('href', `https://en.wiktionary.org/wiki/${entry.word}`);

  // Group meanings by speech_part
  const grouped = {};
  entry.meanings.forEach((m) => {
    const part = m.speech_part || 'other';
    if (!grouped[part]) grouped[part] = [];
    grouped[part].push(m);
  });

  // Render definitions
  resultText.innerHTML = '';
  const englishHeading = document.createElement('h2');
  englishHeading.className = 'english-heading';
  englishHeading.textContent = '英英释义与例句';
  resultText.appendChild(englishHeading);
  const translationButton = document.createElement('button');
  translationButton.type = 'button'; translationButton.className = 'translate-button';
  translationButton.textContent = '生成中文'; translationButton.hidden = true;
  const translationNotice = document.createElement('p');
  translationNotice.className = 'translation-notice'; translationNotice.setAttribute('role', 'status');
  resultText.appendChild(translationButton); resultText.appendChild(translationNotice);
  if (!entry.meanings.length) {
    const missing = document.createElement('p'); missing.className = 'source-note'; missing.textContent = '这个词暂未收录英英释义。'; resultText.appendChild(missing);
  }

  if (entry.meaningsSource === 'wordset') {
    const attribution = document.createElement('div');
    attribution.className = 'source-note';
    const link = document.createElement('a');
    link.href = 'https://github.com/wordset/wordset-dictionary';
    link.target = '_blank';
    link.textContent = '英语来源：Wordset';
    attribution.appendChild(link);
    resultText.appendChild(attribution);
    sourceLink.textContent = 'Wiktionary 音标/词源';
  } else if (entry.meaningsSource === 'ecdict') {
    sourceLink.textContent = 'ECDICT';
    sourceLink.setAttribute('href', 'https://github.com/skywind3000/ECDICT');
  } else {
    sourceLink.textContent = 'Wiktionary';
  }

  for (const [speechPart, meanings] of Object.entries(grouped)) {
    const posLabel = document.createElement('div');
    posLabel.className = 'section-pos';
    posLabel.textContent = translator?.posLabel(speechPart) || speechPart;
    resultText.appendChild(posLabel);

    const ol = document.createElement('ol');
    ol.className = 'def-list';
    meanings.forEach((meaning) => {
      const li = document.createElement('li');
      li.textContent = meaning.def;
      if (translator) sentenceSegments.push(translator.append(li, meaning.def, meaning.defZh, 'definition-zh'));

      if (meaning.example) {
        const example = document.createElement('div');
        example.className = 'example';
        example.textContent = `"${meaning.example}"`;
        li.appendChild(example);
        if (translator) sentenceSegments.push(translator.append(li, meaning.example, meaning.exampleZh, 'example-zh'));
      }

      ol.appendChild(li);
    });
    resultText.appendChild(ol);

    // Synonyms
    const allSynonyms = meanings.flatMap((m) => m.synonyms || []);
    const uniqueSynonyms = [...new Set(allSynonyms)];
    if (uniqueSynonyms.length > 0) {
      const synDiv = document.createElement('div');
      synDiv.className = 'synonyms';
      synDiv.textContent = '同义词：' + uniqueSynonyms.join(', ');
      if (translator) sentenceSegments.push(translator.append(synDiv, uniqueSynonyms.join(', '), null, 'related-zh'));
      resultText.appendChild(synDiv);
    }

    // Antonyms
    const allAntonyms = meanings.flatMap((m) => m.antonyms || []);
    const uniqueAntonyms = [...new Set(allAntonyms)];
    if (uniqueAntonyms.length > 0) {
      const antDiv = document.createElement('div');
      antDiv.className = 'antonyms';
      antDiv.textContent = '反义词：' + uniqueAntonyms.join(', ');
      if (translator) sentenceSegments.push(translator.append(antDiv, uniqueAntonyms.join(', '), null, 'related-zh'));
      resultText.appendChild(antDiv);
    }
  }
  if (translator) disposeSentenceTranslation = translator.bind(sentenceSegments, { button: translationButton, notice: translationNotice });
}

function setMsg(msg) {
  disposeSentenceTranslation?.();
  const resultEl = document.getElementById('result');
  const emptyEl = document.getElementById('empty-state');
  const errorEl = document.getElementById('error-state');

  resultEl.classList.add('hidden');
  emptyEl.classList.add('hidden');
  errorEl.classList.remove('hidden');
  errorEl.textContent = msg;
}
