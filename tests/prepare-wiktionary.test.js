const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractIPA, stripEntry, normalisePos, getLetterFile } = require('../scripts/prepare-wiktionary.js');

describe('prepare-wiktionary.js', () => {
  // -------------------------------------------------------------------------
  describe('normalisePos', () => {
    it('maps abbreviated forms to full names', () => {
      assert.equal(normalisePos('adj'), 'adjective');
      assert.equal(normalisePos('adv'), 'adverb');
      assert.equal(normalisePos('prep'), 'preposition');
      assert.equal(normalisePos('conj'), 'conjunction');
      assert.equal(normalisePos('pron'), 'pronoun');
      assert.equal(normalisePos('intj'), 'interjection');
    });

    it('passes through full-form pos unchanged', () => {
      assert.equal(normalisePos('noun'), 'noun');
      assert.equal(normalisePos('verb'), 'verb');
      assert.equal(normalisePos('adjective'), 'adjective');
    });

    it('returns "other" for unknown pos', () => {
      assert.equal(normalisePos('unknown_pos'), 'unknown_pos');
      assert.equal(normalisePos(undefined), 'other');
    });
  });

  // -------------------------------------------------------------------------
  describe('getLetterFile', () => {
    it('returns first letter for normal words', () => {
      assert.equal(getLetterFile('apple'), 'a');
      assert.equal(getLetterFile('zoo'), 'z');
      assert.equal(getLetterFile('Hello'), 'h');
    });

    it('returns misc for non-alpha first char', () => {
      assert.equal(getLetterFile('3D'), 'misc');
      assert.equal(getLetterFile('-dash'), 'misc');
    });
  });

  // -------------------------------------------------------------------------
  describe('extractIPA', () => {
    it('returns null for empty or missing sounds', () => {
      assert.equal(extractIPA(null), null);
      assert.equal(extractIPA([]), null);
      assert.equal(extractIPA(undefined), null);
    });

    it('returns first IPA found when no tags', () => {
      const sounds = [{ ipa: '/ˈhɛl.oʊ/' }];
      assert.equal(extractIPA(sounds), '/ˈhɛl.oʊ/');
    });

    it('prefers US-tagged IPA over untagged', () => {
      const sounds = [
        { ipa: '/ˈhɛl.ə/' },               // untagged
        { ipa: '/ˈhɛl.oʊ/', tags: ['US'] }, // US
        { ipa: '/ˈhɛl.əʊ/', tags: ['UK'] }, // UK
      ];
      assert.equal(extractIPA(sounds), '/ˈhɛl.oʊ/');
    });

    it('prefers General American tag', () => {
      const sounds = [
        { ipa: '/ˈæp.əl/', tags: ['General-American'] },
        { ipa: '/ˈap.əl/', tags: ['UK'] },
      ];
      assert.equal(extractIPA(sounds), '/ˈæp.əl/');
    });

    it('falls back to first IPA when no US/GA tag matches', () => {
      const sounds = [
        { ipa: '/ˈap.əl/', tags: ['UK'] },
        { ipa: '/ˈæp.əl/', tags: ['UK'] },
      ];
      assert.equal(extractIPA(sounds), '/ˈap.əl/');
    });

    it('skips entries without ipa field', () => {
      const sounds = [
        { audio: 'en-hello.ogg' },
        { ipa: '/ˈhɛl.oʊ/', tags: ['US'] },
      ];
      assert.equal(extractIPA(sounds), '/ˈhɛl.oʊ/');
    });
  });

  // -------------------------------------------------------------------------
  describe('stripEntry', () => {
    it('returns null for empty posEntries', () => {
      assert.equal(stripEntry('hello', []), null);
      assert.equal(stripEntry('hello', null), null);
    });

    it('returns null when all senses have no glosses', () => {
      const entries = [{ pos: 'noun', senses: [{ glosses: [] }] }];
      assert.equal(stripEntry('empty', entries), null);
    });

    it('extracts basic definition and speech_part', () => {
      const entries = [{
        pos: 'noun',
        senses: [{ glosses: ['A round fruit'] }],
      }];
      const result = stripEntry('apple', entries);
      assert.ok(result);
      assert.equal(result.word, 'apple');
      assert.equal(result.meanings.length, 1);
      assert.equal(result.meanings[0].def, 'A round fruit');
      assert.equal(result.meanings[0].speech_part, 'noun');
    });

    it('maps abbreviated pos through normalisePos', () => {
      const entries = [{
        pos: 'adj',
        senses: [{ glosses: ['Having good cheer'] }],
      }];
      const result = stripEntry('happy', entries);
      assert.equal(result.meanings[0].speech_part, 'adjective');
    });

    it('includes example when present', () => {
      const entries = [{
        pos: 'noun',
        senses: [{
          glosses: ['A fruit'],
          examples: [{ text: 'I ate an apple.' }],
        }],
      }];
      const result = stripEntry('apple', entries);
      assert.equal(result.meanings[0].example, 'I ate an apple.');
    });

    it('omits example when absent', () => {
      const entries = [{ pos: 'noun', senses: [{ glosses: ['A fruit'] }] }];
      const result = stripEntry('apple', entries);
      assert.equal(result.meanings[0].example, undefined);
    });

    it('extracts synonyms from senses (object format)', () => {
      const entries = [{
        pos: 'noun',
        senses: [{ glosses: ['A fruit'], synonyms: [{ word: 'pome' }, { word: 'pip fruit' }] }],
      }];
      const result = stripEntry('apple', entries);
      assert.deepEqual(result.meanings[0].synonyms, ['pome', 'pip fruit']);
    });

    it('extracts synonyms from senses (string format)', () => {
      const entries = [{
        pos: 'noun',
        senses: [{ glosses: ['A fruit'], synonyms: ['pome'] }],
      }];
      const result = stripEntry('apple', entries);
      assert.deepEqual(result.meanings[0].synonyms, ['pome']);
    });

    it('omits synonyms when empty', () => {
      const entries = [{
        pos: 'noun',
        senses: [{ glosses: ['A fruit'], synonyms: [] }],
      }];
      const result = stripEntry('apple', entries);
      assert.equal(result.meanings[0].synonyms, undefined);
    });

    it('extracts antonyms from senses', () => {
      const entries = [{
        pos: 'adjective',
        senses: [{ glosses: ['Full of joy'], antonyms: [{ word: 'sad' }] }],
      }];
      const result = stripEntry('happy', entries);
      assert.deepEqual(result.meanings[0].antonyms, ['sad']);
    });

    it('extracts IPA from sounds', () => {
      const entries = [{
        pos: 'noun',
        senses: [{ glosses: ['A fruit'] }],
        sounds: [{ ipa: '/ˈæp.əl/', tags: ['US'] }],
      }];
      const result = stripEntry('apple', entries);
      assert.equal(result.ipa, '/ˈæp.əl/');
    });

    it('omits ipa when no sounds', () => {
      const entries = [{ pos: 'noun', senses: [{ glosses: ['A fruit'] }] }];
      const result = stripEntry('apple', entries);
      assert.equal(result.ipa, undefined);
    });

    it('extracts etymology_text', () => {
      const entries = [{
        pos: 'noun',
        senses: [{ glosses: ['A fruit'] }],
        etymology_text: 'From Old English æppel.',
      }];
      const result = stripEntry('apple', entries);
      assert.equal(result.etymology, 'From Old English æppel.');
    });

    it('truncates long etymology to 300 chars', () => {
      const longEtym = 'X'.repeat(400);
      const entries = [{
        pos: 'noun',
        senses: [{ glosses: ['A fruit'] }],
        etymology_text: longEtym,
      }];
      const result = stripEntry('apple', entries);
      assert.ok(result.etymology.length <= 300);
      assert.ok(result.etymology.endsWith('…'));
    });

    it('omits etymology when absent', () => {
      const entries = [{ pos: 'noun', senses: [{ glosses: ['A fruit'] }] }];
      const result = stripEntry('apple', entries);
      assert.equal(result.etymology, undefined);
    });

    it('merges multiple POS entries for the same word', () => {
      const entries = [
        { pos: 'noun', senses: [{ glosses: ['The animal'] }] },
        { pos: 'verb', senses: [{ glosses: ['To run quickly'] }] },
      ];
      const result = stripEntry('run', entries);
      assert.equal(result.meanings.length, 2);
      assert.equal(result.meanings[0].speech_part, 'noun');
      assert.equal(result.meanings[1].speech_part, 'verb');
    });

    it('caps meanings at MAX_MEANINGS (8)', () => {
      const senses = Array.from({ length: 12 }, (_, i) => ({
        glosses: [`Definition ${i + 1}`],
      }));
      const entries = [{ pos: 'noun', senses }];
      const result = stripEntry('test', entries);
      assert.ok(result.meanings.length <= 8);
    });

    it('skips form-of / alternative spelling glosses', () => {
      const entries = [{
        pos: 'noun',
        senses: [
          { glosses: ['form of apple'] },
          { glosses: ['A real definition'] },
        ],
      }];
      const result = stripEntry('apples', entries);
      assert.equal(result.meanings.length, 1);
      assert.equal(result.meanings[0].def, 'A real definition');
    });

    it('deduplicates synonyms within a single sense', () => {
      const entries = [{
        pos: 'noun',
        senses: [
          // Same synonym listed twice in one sense — should be deduplicated
          { glosses: ['Def 1'], synonyms: [{ word: 'foo' }, { word: 'foo' }, { word: 'bar' }] },
        ],
      }];
      const result = stripEntry('test', entries);
      assert.deepEqual(result.meanings[0].synonyms, ['foo', 'bar']);
    });
  });
});
