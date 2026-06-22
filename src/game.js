/**
 * Per-channel game state manager.
 * Bridges Discord messages → Wordle engine → DB persistence.
 */
const { evaluate, computeScore } = require('./wordle');
const { isValidWord, getRandomWord } = require('./words');
const db = require('./db');

const CHALLENGE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const GUESS_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between guesses per user
const MAX_GUESSES = 10;
const PARTICIPATION_POINTS = 2; // awarded once per round participant
const BONUS_POINTS = 4; // secret bonus word, first finder only

/**
 * Get the active challenge for a channel (if any).
 * Returns challenge object or null.
 */
function getActiveChallenge(channelId) {
  let challenge = db.getActiveChallenge(channelId);
  if (!challenge) return null;

  challenge.letter_state = JSON.parse(challenge.letter_state || '{}');
  return challenge;
}

/**
 * Start a new challenge for a channel.
 * Returns the new challenge object.
 */
function startNewChallenge(channelId) {
  const answer = getRandomWord();
  let bonusWord = getRandomWord(answer, { minSharedLetters: 2 });
  if (!bonusWord || ![...new Set(bonusWord)].some(letter => answer.includes(letter))) {
    bonusWord = getRandomWord(answer, { minSharedLetters: 1 });
  }
  const now = Date.now();
  const id = db.createChallenge(channelId, answer, now, bonusWord);
  return {
    id, channel_id: channelId, answer, started_at: now,
    letter_state: {}, solved: 0, board_message_id: null,
    bonus_word: bonusWord, bonus_found_by: null,
  };
}

function getLastGuessTime(challengeId) {
  const row = db.getDb().prepare(`
    SELECT MAX(created_at) AS t FROM guesses WHERE challenge_id = ?
  `).get(challengeId);
  return row.t || null;
}

/**
 * Get start of current 4-hour window (anchored to midnight).
 * Windows: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00
 */
function getCurrentWindowStart() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const hoursSinceMidnight = (now.getTime() - midnight) / CHALLENGE_INTERVAL_MS;
  const windowIndex = Math.floor(hoursSinceMidnight);
  return midnight + windowIndex * CHALLENGE_INTERVAL_MS;
}

/**
 * Calculate time until next 4-hour window.
 */
function getNextChallengeTime() {
  const windowStart = getCurrentWindowStart();
  const nextWindow = windowStart + CHALLENGE_INTERVAL_MS;
  const remaining = nextWindow - Date.now();
  const mins = Math.ceil(remaining / 60_000);
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  if (hrs > 0) return `${hrs}h ${m}m`;
  return `${m}m`;
}

/**
 * Check if a new challenge should start for a channel.
 * Returns true if no challenge was started in the current 4-hour window.
 */
function shouldStartChallenge(channelId) {
  const windowStart = getCurrentWindowStart();

  const lastRow = db.getDb().prepare(`
    SELECT started_at FROM challenges WHERE channel_id = ? AND started_at >= ? ORDER BY started_at DESC LIMIT 1
  `).get(channelId, windowStart);

  return !lastRow;
}

/**
 * Process a guess.
 * Returns { result, scoreDelta, solved, letterState, challenge } or { error }.
 */
function processGuess(channelId, userId, userName, guessRaw) {
  const guess = guessRaw.toLowerCase();

  if (guess.length !== 4) {
    return { error: 'Guess must be exactly 4 letters.' };
  }
  if (!/^[a-z]{4}$/.test(guess)) {
    return { error: 'Guess must contain only letters (a-z).' };
  }
  if (!isValidWord(guess)) {
    return { error: `"${guessRaw.toUpperCase()}" is not a valid word.` };
  }

  const challenge = getActiveChallenge(channelId);

  if (!challenge) {
    const nextIn = getNextChallengeTime();
    return { error: `No active challenge right now. Next game starts in ~${nextIn}!` };
  }

  if (challenge.solved) {
    return { error: 'This challenge is already solved! Wait for the next one.' };
  }

  // Check duplicate guess for this challenge
  const existing = db.getDb().prepare(`
    SELECT 1 FROM guesses WHERE challenge_id = ? AND guess = ?
  `).get(challenge.id, guess);
  if (existing) {
    return { error: `"${guessRaw.toUpperCase()}" was already guessed in this challenge.` };
  }

  // Rate limit: prevent spam guessing (must wait between guesses)
  const userLastGuess = db.getDb().prepare(`
    SELECT MAX(created_at) AS t FROM guesses WHERE challenge_id = ? AND user_id = ?
  `).get(challenge.id, userId);
  if (userLastGuess.t && (Date.now() - userLastGuess.t < GUESS_COOLDOWN_MS)) {
    const waitMin = Math.ceil((GUESS_COOLDOWN_MS - (Date.now() - userLastGuess.t)) / 60_000);
    return { error: `Slow down! Wait **${waitMin}m** before guessing again.` };
  }

  // Check max guesses
  const guessCount = db.getGuessCount(challenge.id);
  if (guessCount >= MAX_GUESSES) {
    db.timeoutChallenge(challenge.id);
    return { error: `No more guesses left! The answer was \`${challenge.answer.toUpperCase()}\`.` };
  }

  const result = evaluate(guess, challenge.answer);
  const prevLetterState = challenge.letter_state || {};
  const { delta: baseDelta, newLetterState } = computeScore(result, guess, challenge.answer, prevLetterState);

  const solved = result.every(r => r === 'correct');

  // Secret bonus word: first finder gets +4, folded into this guess's delta.
  let bonusFound = false;
  let scoreDelta = baseDelta;
  if (challenge.bonus_word && !challenge.bonus_found_by && guess === challenge.bonus_word) {
    scoreDelta += BONUS_POINTS;
    db.markBonusFound(challenge.id, userId);
    bonusFound = true;
  }

  // Persist
  db.addGuess(challenge.id, userId, userName, guess, result, scoreDelta, newLetterState);
  db.updateLetterState(challenge.id, newLetterState);

  if (solved) {
    db.solveChallenge(challenge.id, userId);
  }

  return {
    result, scoreDelta, solved, letterState: newLetterState, challenge,
    bonusFound, bonusWord: challenge.bonus_word,
  };
}

/**
 * Finalize a challenge (add all participants to leaderboard).
 * Called when challenge ends (solved or timed out).
 */
function finalizeChallenge(challengeId, channelId, solved) {
  const guessRows = db.getGuessesForChallenge(challengeId);
  const seen = new Map(); // userId → { name, totalScore }
  for (const g of guessRows) {
    if (!seen.has(g.user_id)) {
      seen.set(g.user_id, { name: g.user_name, totalScore: 0 });
    }
    seen.get(g.user_id).totalScore += g.score_delta;
  }

  for (const [uid, info] of seen) {
    db.addToLeaderboard(uid, channelId, info.name, info.totalScore + PARTICIPATION_POINTS, solved);
  }
}

/**
 * Resolve the secret-bonus outcome for a challenge (for end-of-challenge reveal).
 * Returns { word, foundByName } or null if the challenge has no bonus word.
 */
function getBonusOutcome(challengeId) {
  const row = db.getDb().prepare(`
    SELECT bonus_word, bonus_found_by FROM challenges WHERE id = ?
  `).get(challengeId);
  if (!row || !row.bonus_word) return null;
  const foundByName = row.bonus_found_by
    ? db.getUserNameInChallenge(challengeId, row.bonus_found_by)
    : null;
  return { word: row.bonus_word, foundByName };
}

module.exports = {
  getActiveChallenge,
  startNewChallenge,
  shouldStartChallenge,
  processGuess,
  finalizeChallenge,
  getBonusOutcome,
  getNextChallengeTime,
  CHALLENGE_INTERVAL_MS,
  MAX_GUESSES,
  PARTICIPATION_POINTS,
  BONUS_POINTS,
};
