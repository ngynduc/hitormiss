const fs = require('fs');
const path = require('path');

const WORDS = fs.readFileSync(path.join(__dirname, 'words.txt'), 'utf8')
  .split('\n')
  .map(w => w.trim().toLowerCase())
  .filter(w => w.length === 4);

const VALID_SET = new Set(WORDS);

function countSharedLetters(word, target) {
  if (!target) return 0;
  const targetLetters = new Set(target);
  return [...new Set(word)].filter(letter => targetLetters.has(letter)).length;
}

function getRandomWord(exclude, options = {}) {
  if (WORDS.length <= 1) return WORDS[0];

  const {
    minSharedLetters = 0,
    sharedWith = exclude,
  } = options;

  let candidates = WORDS.filter(w => w !== exclude);
  if (minSharedLetters > 0) {
    const matchingCandidates = candidates.filter(w =>
      countSharedLetters(w, sharedWith) >= minSharedLetters
    );
    if (matchingCandidates.length > 0) {
      candidates = matchingCandidates;
    }
  }

  if (candidates.length === 0) return WORDS[0];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function isValidWord(word) {
  return VALID_SET.has(word.toLowerCase());
}

module.exports = { WORDS, getRandomWord, isValidWord };
