/**
 * SQLite persistence layer.
 *
 * Tables:
 *   challenges  — one row per channel challenge
 *   guesses     — every guess made
 *   leaderboard — cumulative scores per user per channel (or global)
 */
const Database = require('better-sqlite3');
const path = require('path');

let db;

function init(dbPath) {
  if (db) return db;
  db = new Database(dbPath || path.join(__dirname, '..', 'data', 'hitormiss.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS challenges (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id      TEXT NOT NULL,
      answer          TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      solved          INTEGER NOT NULL DEFAULT 0,
      solved_by       TEXT,
      solved_at       INTEGER,
      timed_out       INTEGER NOT NULL DEFAULT 0,
      letter_state    TEXT NOT NULL DEFAULT '{}',
      board_message_id TEXT
    );

    CREATE TABLE IF NOT EXISTS guesses (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id    INTEGER NOT NULL REFERENCES challenges(id),
      user_id         TEXT NOT NULL,
      user_name       TEXT NOT NULL,
      guess           TEXT NOT NULL,
      result          TEXT NOT NULL,
      score_delta     INTEGER NOT NULL DEFAULT 0,
      letter_state    TEXT NOT NULL DEFAULT '{}',
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leaderboard (
      user_id         TEXT NOT NULL,
      channel_id      TEXT NOT NULL,
      user_name       TEXT NOT NULL,
      score           INTEGER NOT NULL DEFAULT 0,
      challenges      INTEGER NOT NULL DEFAULT 0,
      solves          INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS registered_channels (
      channel_id TEXT PRIMARY KEY
    );

    CREATE INDEX IF NOT EXISTS idx_challenges_channel ON challenges(channel_id);
    CREATE INDEX IF NOT EXISTS idx_guesses_challenge ON guesses(challenge_id);
  `);

  // Migrate: add board_message_id if missing (existing DBs)
  const cols = getDb().prepare("PRAGMA table_info(challenges)").all().map(c => c.name);
  if (!cols.includes('board_message_id')) {
    getDb().exec('ALTER TABLE challenges ADD COLUMN board_message_id TEXT');
  }

  return db;
}

function getDb() {
  if (!db) throw new Error('DB not initialized. Call init() first.');
  return db;
}

// --- Challenge CRUD ---

function createChallenge(channelId, answer, startedAt) {
  const stmt = getDb().prepare(`
    INSERT INTO challenges (channel_id, answer, started_at, letter_state)
    VALUES (?, ?, ?, '{}')
  `);
  return stmt.run(channelId, answer, startedAt).lastInsertRowid;
}

function getActiveChallenge(channelId) {
  const row = getDb().prepare(`
    SELECT * FROM challenges
    WHERE channel_id = ? AND solved = 0 AND timed_out = 0
    ORDER BY started_at DESC LIMIT 1
  `).get(channelId);
  return row || null;
}

function solveChallenge(challengeId, userId) {
  const now = Date.now();
  getDb().prepare(`
    UPDATE challenges SET solved = 1, solved_by = ?, solved_at = ? WHERE id = ?
  `).run(userId, now, challengeId);
}

function timeoutChallenge(challengeId) {
  getDb().prepare(`
    UPDATE challenges SET timed_out = 1 WHERE id = ?
  `).run(challengeId);
}

function updateLetterState(challengeId, state) {
  getDb().prepare(`
    UPDATE challenges SET letter_state = ? WHERE id = ?
  `).run(JSON.stringify(state), challengeId);
}

function setBoardMessageId(challengeId, messageId) {
  getDb().prepare(`
    UPDATE challenges SET board_message_id = ? WHERE id = ?
  `).run(messageId, challengeId);
}

// --- Guesses ---

function addGuess(challengeId, userId, userName, guess, result, scoreDelta, letterState) {
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO guesses (challenge_id, user_id, user_name, guess, result, score_delta, letter_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(challengeId, userId, userName, guess, JSON.stringify(result), scoreDelta, JSON.stringify(letterState), now);
}

function getGuessesForChallenge(challengeId) {
  return getDb().prepare(`
    SELECT * FROM guesses WHERE challenge_id = ? ORDER BY created_at
  `).all(challengeId);
}

function getGuessCount(challengeId) {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS cnt FROM guesses WHERE challenge_id = ?
  `).get(challengeId);
  return row.cnt;
}

function getParticipantCount(challengeId) {
  const row = getDb().prepare(`
    SELECT COUNT(DISTINCT user_id) AS cnt FROM guesses WHERE challenge_id = ?
  `).get(challengeId);
  return row.cnt;
}

function getParticipantUserIds(challengeId) {
  const rows = getDb().prepare(`
    SELECT DISTINCT user_id FROM guesses WHERE challenge_id = ?
  `).all(challengeId);
  return rows.map(r => r.user_id);
}

// --- Leaderboard ---

function addToLeaderboard(userId, channelId, userName, points, solvedChallenge) {
  getDb().prepare(`
    INSERT INTO leaderboard (user_id, channel_id, user_name, score, challenges, solves)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET
      score = score + excluded.score,
      challenges = challenges + 1,
      solves = solves + excluded.solves,
      user_name = excluded.user_name
  `).run(userId, channelId, userName, points, solvedChallenge ? 1 : 0);
}

function getLeaderboard(channelId, limit = 10) {
  return getDb().prepare(`
    SELECT user_name, score, challenges, solves
    FROM leaderboard
    WHERE channel_id = ?
    ORDER BY score DESC, solves DESC
    LIMIT ?
  `).all(channelId, limit);
}

// --- Registered Channels ---

function registerChannel(channelId) {
  getDb().prepare('INSERT OR IGNORE INTO registered_channels (channel_id) VALUES (?)').run(channelId);
}

function getRegisteredChannels() {
  return getDb().prepare('SELECT channel_id FROM registered_channels').all().map(r => r.channel_id);
}

module.exports = {
  init, getDb,
  createChallenge, getActiveChallenge, solveChallenge, timeoutChallenge, updateLetterState,
  setBoardMessageId,
  addGuess, getGuessesForChallenge, getGuessCount, getParticipantCount, getParticipantUserIds,
  addToLeaderboard, getLeaderboard,
  registerChannel, getRegisteredChannels,
};
