const { WORDS, getRandomWord, isValidWord } = require('../src/words');

describe('getRandomWord', () => {
  test('returns a valid word', () => {
    const w = getRandomWord();
    expect(WORDS).toContain(w);
    expect(w.length).toBe(4);
  });

  test('respects exclude argument', () => {
    const exclude = getRandomWord();
    for (let i = 0; i < 50; i++) {
      expect(getRandomWord(exclude)).not.toBe(exclude);
    }
  });

  test('still returns a word when exclude is not in the list', () => {
    const w = getRandomWord('zzzz');
    expect(WORDS).toContain(w);
  });

  test('can require shared letters with the excluded word', () => {
    const answer = 'boot';
    const word = getRandomWord(answer, { minSharedLetters: 2 });
    const shared = new Set([...word].filter(letter => answer.includes(letter)));

    expect(word).not.toBe(answer);
    expect(WORDS).toContain(word);
    expect(shared.size).toBeGreaterThanOrEqual(2);
  });

  test('falls back to any non-excluded word when no shared-letter match exists', () => {
    const answer = 'zzzz';
    const word = getRandomWord(answer, { minSharedLetters: 5 });

    expect(word).not.toBe(answer);
    expect(WORDS).toContain(word);
  });
});

describe('isValidWord', () => {
  test('accepts a known word', () => {
    const w = WORDS[0];
    expect(isValidWord(w)).toBe(true);
    expect(isValidWord(w.toUpperCase())).toBe(true);
  });

  test('rejects an unknown word', () => {
    expect(isValidWord('zzzz')).toBe(false);
  });
});
