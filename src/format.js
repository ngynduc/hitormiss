/**
 * Format helpers for Discord messages.
 */
const { EmbedBuilder } = require('discord.js');
const { CORRECT, PRESENT, ABSENT, getStatus } = require('./wordle');

const KEYBOARD_ROWS = [
  'QWERTYUIOP'.split(''),
  'ASDFGHJKL'.split(''),
  'ZXCVBNM'.split(''),
];

const COLOR_ACTIVE  = 0xFFA500;
const COLOR_SOLVED  = 0x57F287;
const COLOR_EXPIRED = 0x4E5058;

/**
 * Format a single guess as a row of custom letter emojis.
 * Requires emojiMap from buildLetterEmojiMap().
 */
function emojiWord(guess, result, emojiMap) {
  return guess.toLowerCase().split('').map((ch, i) => {
    const r = result[i];
    const color = r === CORRECT ? 'green' : r === PRESENT ? 'yellow' : 'gray';
    return emojiMap[`${ch}_${color}`] || '⬛';
  }).join(' ');
}

// --- Board Embed ---

function buildBoardEmbed(challenge, guesses, status, emojiMap) {
  if (!status) status = { solved: false, timedOut: false, nextIn: null };
  const letterState = typeof challenge.letter_state === 'string'
    ? JSON.parse(challenge.letter_state || '{}')
    : (challenge.letter_state || {});

  const date = new Date(challenge.started_at);
  const title = `HitOrMiss for ${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`;

  // --- Keyboard with custom letter emojis ---
  const kbLines = KEYBOARD_ROWS.map((row, ri) => {
    const pad = ' '.repeat(ri);
    const keys = row.map(letter => {
      const lower = letter.toLowerCase();
      const st = getStatus(letterState, lower);
      if (st === CORRECT) return emojiMap[`${lower}_green`] || '🟩';
      if (st === PRESENT) return emojiMap[`${lower}_yellow`] || '🟨';
      if (st === ABSENT)  return emojiMap[`${lower}_gray`] || '⬛';
      return emojiMap[`${lower}_blue`] || `:regional_indicator_${lower}:`;
    });
    return pad + keys.join(' ');
  });

  let description;
  if (guesses.length === 0) {
    description = '*No guesses yet. Use `?<word>` to guess!*';
  } else {
    const rows = guesses.map((g, i) => {
      const result = typeof g.result === 'string' ? JSON.parse(g.result) : g.result;
      const tiles = emojiWord(g.guess, result, emojiMap);
      return `${tiles}  — @${g.user_name} (+${g.score_delta})`;
    });
    description = rows.join('\n\n') + '\n\n───────────────\n\n' + kbLines.join('\n');
  }

  // --- Status ---
  let statusText;
  if (status.solved) {
    statusText = `🎉 **Solved!** The word was **${challenge.answer.toUpperCase()}**.`;
  } else if (status.timedOut) {
    statusText = `⏰ **Timed out!** The word was **${challenge.answer.toUpperCase()}**.`;
  } else {
    statusText = 'Not solved yet.';
    if (status.nextIn) statusText += `\nNext challenge in ${status.nextIn}.`;
  }

  // --- Color ---
  let color;
  if (status.solved) color = COLOR_SOLVED;
  else if (status.timedOut) color = COLOR_EXPIRED;
  else color = COLOR_ACTIVE;

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .addFields(
      { name: 'Status', value: statusText, inline: false },
    );
}

// --- Leaderboard ---

function formatLeaderboard(rows) {
  if (rows.length === 0) return 'No scores yet. Start guessing!';
  const lines = ['🏆 **Leaderboard** 🏆\n'];
  const medals = ['🥇', '🥈', '🥉'];
  rows.forEach((r, i) => {
    const medal = medals[i] || `**${i + 1}.**`;
    lines.push(`${medal} ${r.user_name} — ${r.score} pts (${r.solves} solve${r.solves !== 1 ? 's' : ''})`);
  });
  return lines.join('\n');
}

// --- Rules ---

const RULES_TEXT = `**🟩 Co-Wordle Rules 🟩**

• Each challenge has a hidden **4-letter** word
• Guess with \`?<word>\` (e.g. \`?discord\`)
• Each guess must be a valid 4-letter word
• Repeated guesses for the same word are blocked
• **🟩 Green** = correct letter, correct position
• **🟨 Yellow** = correct letter, wrong position
• **⬛ Grey** = letter not in the word
• New challenge every **4 hours** (00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
• Max **10 guesses** per challenge

**Scoring:**
• +2 pts for finding a **new green** letter
• +1 pt for finding a **new yellow** letter
• +1 pt for upgrading a yellow → green
• +2 pts to **all participants** when solved

Work together to crack the word!`;

function formatTimeout(answer) {
  return `⏰ **Challenge timed out!** The word was **${answer.toUpperCase()}**.\nBetter luck next time!`;
}

module.exports = {
  buildBoardEmbed,
  formatLeaderboard,
  RULES_TEXT,
  formatTimeout,
};
