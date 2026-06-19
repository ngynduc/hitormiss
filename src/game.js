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
  const now = Date.now();
  const id = db.createChallenge(channelId, answer, now);
  return { id, channel_id: channelId, answer, started_at: now, letter_state: {}, solved: 0, board_message_id: null };
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
  const { delta, newLetterState } = computeScore(result, guess, challenge.answer, prevLetterState);

  const solved = result.every(r => r === 'correct');

  // Persist
  db.addGuess(challenge.id, userId, userName, guess, result, delta, newLetterState);
  db.updateLetterState(challenge.id, newLetterState);

  if (solved) {
    db.solveChallenge(challenge.id, userId);
  }

  return { result, scoreDelta: delta, solved, letterState: newLetterState, challenge };
}

/**
 * Award solve bonus (+2) to all participants when challenge is solved.
 * Called after processGuess returns solved=true.
 */
function awardSolveBonus(challengeId, channelId) {
  const participants = db.getParticipantUserIds(challengeId);
  const guessRows = db.getGuessesForChallenge(challengeId);
  const nameMap = {};
  for (const g of guessRows) {
    if (!nameMap[g.user_id]) nameMap[g.user_id] = g.user_name;
  }

  for (const uid of participants) {
    db.getDb().prepare(`
      UPDATE leaderboard SET score = score + 2 WHERE user_id = ? AND channel_id = ?
    `).run(uid, channelId);
  }
  return { participants, nameMap };
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
    db.addToLeaderboard(uid, channelId, info.name, info.totalScore, solved);
  }
}

module.exports = {
  getActiveChallenge,
  startNewChallenge,
  shouldStartChallenge,
  processGuess,
  awardSolveBonus,
  finalizeChallenge,
  getNextChallengeTime,
  CHALLENGE_INTERVAL_MS,
  MAX_GUESSES,
};
