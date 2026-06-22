const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../src/db');
const game = require('../src/game');

describe('finalizeChallenge', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitormiss-game-'));

  beforeAll(() => {
    db.init(path.join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('awards participation points once per participant', () => {
    const channelId = 'participation-channel';
    const challengeId = db.createChallenge(channelId, 'boot', Date.now(), null);

    db.addGuess(challengeId, 'u1', 'Alice', 'word', ['absent'], 3, {});
    db.addGuess(challengeId, 'u1', 'Alice', 'mono', ['absent'], 5, {});
    db.addGuess(challengeId, 'u2', 'Bob', 'loop', ['absent'], 1, {});

    game.finalizeChallenge(challengeId, channelId, false);

    const rows = db.getLeaderboard(channelId, 10);
    const byName = Object.fromEntries(rows.map(row => [row.user_name, row]));

    expect(byName.Alice.score).toBe(10);
    expect(byName.Alice.challenges).toBe(1);
    expect(byName.Bob.score).toBe(3);
    expect(byName.Bob.challenges).toBe(1);
  });

  test('applies participation points to solved rounds without extra solve bonus', () => {
    const channelId = 'solved-channel';
    const challengeId = db.createChallenge(channelId, 'boot', Date.now(), null);

    db.addGuess(challengeId, 'u1', 'Alice', 'boot', ['correct'], 8, {});

    game.finalizeChallenge(challengeId, channelId, true);

    const [row] = db.getLeaderboard(channelId, 10);
    expect(row.user_name).toBe('Alice');
    expect(row.score).toBe(10);
    expect(row.challenges).toBe(1);
    expect(row.solves).toBe(1);
  });
});
