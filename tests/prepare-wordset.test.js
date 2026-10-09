const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { stripEntry } = require('../scripts/prepare-wordset.js');

describe('prepare-wordset.js', () => {
  describe('stripEntry', () => {
    it('keeps word and meanings', () => {
      const raw = {
        word: 'hello',
        wordset_id: 'abc123',
        meanings: [
          {
            id: 'def456',
            def: 'a greeting',
            speech_part: 'noun',
            example: 'Hello there!',
            synonyms: ['hi', 'hey'],
          },
        ],
        editors: ['user1'],
        contributors: ['user2', 'user3'],
      };

      const result = stripEntry(raw);

      assert.deepEqual(result, {
        word: 'hello',
        meanings: [
          {
            def: 'a greeting',
            speech_part: 'noun',
            example: 'Hello there!',
            synonyms: ['hi', 'hey'],
          },
        ],
      });
    });

    it('strips wordset_id, meaning id, editors, contributors', () => {
      const raw = {
        word: 'test',
        wordset_id: 'xyz',
        meanings: [{ id: '123', def: 'a trial', speech_part: 'noun' }],
        editors: ['editor1'],
        contributors: ['contrib1'],
      };

      const result = stripEntry(raw);

      assert.equal(result.wordset_id, undefined);
      assert.equal(result.editors, undefined);
      assert.equal(result.contributors, undefined);
      assert.equal(result.meanings[0].id, undefined);
    });

    it('omits example when not present', () => {
      const raw = {
        word: 'test',
        meanings: [{ id: '1', def: 'a trial', speech_part: 'noun' }],
      };

      const result = stripEntry(raw);

      assert.equal(result.meanings[0].example, undefined);
    });

    it('omits synonyms when empty', () => {
      const raw = {
        word: 'test',
        meanings: [{ id: '1', def: 'a trial', speech_part: 'noun', synonyms: [] }],
      };

      const result = stripEntry(raw);

      assert.equal(result.meanings[0].synonyms, undefined);
    });

    it('keeps synonyms when present', () => {
      const raw = {
        word: 'happy',
        meanings: [
          {
            id: '1',
            def: 'feeling joy',
            speech_part: 'adjective',
            synonyms: ['glad', 'joyful'],
          },
        ],
      };

      const result = stripEntry(raw);

      assert.deepEqual(result.meanings[0].synonyms, ['glad', 'joyful']);
    });

    it('handles entry with no meanings', () => {
      const raw = { word: 'empty' };

      const result = stripEntry(raw);

      assert.deepEqual(result, { word: 'empty', meanings: [] });
    });

    it('handles multiple meanings', () => {
      const raw = {
        word: 'run',
        meanings: [
          { id: '1', def: 'to move fast', speech_part: 'verb' },
          { id: '2', def: 'a period of running', speech_part: 'noun', example: 'a quick run' },
        ],
      };

      const result = stripEntry(raw);

      assert.equal(result.meanings.length, 2);
      assert.equal(result.meanings[0].def, 'to move fast');
      assert.equal(result.meanings[1].example, 'a quick run');
    });
  });
});
