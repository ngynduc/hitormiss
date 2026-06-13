const fs = require('fs');
const path = require('path');

const WORDS = fs.readFileSync(path.join(__dirname, 'words.txt'), 'utf8')
  .split('\n')
  .map(w => w.trim().toLowerCase())
  .filter(w => w.length === 4);

const VALID_SET = new Set(WORDS);

function getRandomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function isValidWord(word) {
  return VALID_SET.has(word.toLowerCase());
}

module.exports = { WORDS, getRandomWord, isValidWord };
