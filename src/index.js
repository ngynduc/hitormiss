/**
 * HitOrMiss — Discord.js v14 Co-op Wordle Bot
 */
const { Client, GatewayIntentBits } = require('discord.js');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const game = require('./game');
const { buildBoardEmbed, formatLeaderboard, RULES_TEXT, formatTimeout } = require('./format');

// Ensure data dir exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Init DB
db.init(path.join(dataDir, 'hitormiss.db'));

// Track active challenges and registered channels
const activeChannels = new Map(); // channelId → { challengeId, lastActivity }
const registeredChannels = new Set(db.getRegisteredChannels());

// Custom letter emoji map: { 'a_green': '<:a_green:123>', ... }
let letterEmojis = {};

/**
 * Scan guild emojis and build lookup map for letter_color pattern.
 */
function buildLetterEmojiMap() {
  const map = {};
  for (const emoji of client.emojis.cache.values()) {
    if (/^[a-z]_(green|yellow|gray|blue)$/.test(emoji.name)) {
      map[emoji.name] = `<:${emoji.name}:${emoji.id}>`;
    }
  }
  console.log('📋 Custom letter emojis:', Object.keys(map).join(', ') || 'none found');
  return map;
}

// --- Bot ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`✅ HitOrMiss online as ${client.user.tag}`);
  letterEmojis = buildLetterEmojiMap();
  console.log(`📋 Loaded ${Object.keys(letterEmojis).length} custom letter emojis`);
  startScheduler();
});

client.on('messageCreate', async (msg) => {
  // Ignore bots and DMs
  if (msg.author.bot) return;
  if (!msg.guild) return;

  const content = msg.content.trim();

  // Only process messages starting with #
  if (!content.startsWith('?')) return;

  const channelId = msg.channel.id;

  // --- Commands ---
  if (content.toLowerCase() === '?rules') {
    return msg.reply(RULES_TEXT);
  }

  if (content.toLowerCase() === '?top') {
    const rows = db.getLeaderboard(channelId);
    return msg.reply(formatLeaderboard(rows));
  }

  if (content.toLowerCase() === '?start') {
    // Register channel
    if (!registeredChannels.has(channelId)) {
      registeredChannels.add(channelId);
      db.registerChannel(channelId);
    }

    // Check if challenge already active
    const existing = game.getActiveChallenge(channelId);
    if (existing) {
      return msg.reply('❌ There\'s already an active challenge! Keep guessing.');
    }

    // Start challenge now
    const challenge = game.startNewChallenge(channelId);
    activeChannels.set(channelId, { challengeId: challenge.id, lastActivity: Date.now() });

    await msg.reply('🎯 **Wordle Challenge started!** Guess with `?<word>` — 4-letter words only!');
    await updateBoard(msg.channel, channelId, challenge, false);
    return;
  }

  // --- Guess ---
  if (!registeredChannels.has(channelId)) {
    return msg.reply('❌ This channel isn\'t set up yet. Use `?start` first!');
  }

  const guessRaw = content.slice(1).trim();
  if (!guessRaw) return;

  const result = game.processGuess(channelId, msg.author.id, msg.author.username, guessRaw);

  if (result.error) {
    return msg.reply(`❌ ${result.error}`);
  }

  // Update channel tracking
  activeChannels.set(channelId, {
    challengeId: result.challenge.id,
    lastActivity: Date.now(),
  });

  // If solved, finalize
  if (result.solved) {
    game.awardSolveBonus(result.challenge.id, channelId);
    game.finalizeChallenge(result.challenge.id, channelId, true);
    activeChannels.delete(channelId);
  }

  // Inject updated letter state into challenge object for board display
  const challenge = { ...result.challenge, letter_state: result.letterState };

  // Delete user's guess message — keep channel clean
  try { await msg.delete(); } catch { /* ignore if missing perms */ }

  // Update or create the board message
  await updateBoard(msg.channel, channelId, challenge, result.solved);
});

// --- Board message management ---

/**
 * Update (or create) the persistent board message for a challenge.
 */
async function updateBoard(channel, channelId, challenge, solved = false) {
  const guesses = db.getGuessesForChallenge(challenge.id);
  const nextIn = solved ? null : game.getNextChallengeTime();
  const embed = buildBoardEmbed(challenge, guesses, { solved, timedOut: false, nextIn }, letterEmojis);

  const boardMessageId = challenge.board_message_id;

  // Delete old board message so new one lands at bottom of chat
  if (boardMessageId) {
    try {
      const old = await channel.messages.fetch(boardMessageId);
      await old.delete();
    } catch { /* already gone */ }
  }

  // Send fresh board message at current position
  const sent = await channel.send({ embeds: [embed] });
  db.setBoardMessageId(challenge.id, sent.id);
}

// --- Scheduler ---
function startScheduler() {
  // Every 30 seconds: start new challenges + check timeouts
  setInterval(async () => {
    const now = Date.now();

    // --- Start new challenges on 4h cycle ---
    for (const channelId of registeredChannels) {
      if (!game.shouldStartChallenge(channelId)) continue;

      // Expire old challenge from previous window if still tracked
      if (activeChannels.has(channelId)) {
        const old = db.getActiveChallenge(channelId);
        if (old) {
          db.timeoutChallenge(old.id);
          game.finalizeChallenge(old.id, channelId, false);
          const guesses = db.getGuessesForChallenge(old.id);
          const embed = buildBoardEmbed(old, guesses, { solved: false, timedOut: true, nextIn: null }, letterEmojis);
          try {
            const ch = await client.channels.fetch(channelId);
            if (ch?.isTextBased() && old.board_message_id) {
              const boardMsg = await ch.messages.fetch(old.board_message_id);
              await boardMsg.edit({ embeds: [embed] });
            }
          } catch { /* ignore */ }
          sendToChannel(channelId, formatTimeout(old.answer));
        }
        activeChannels.delete(channelId);
      }

      // Start new challenge
      const challenge = game.startNewChallenge(channelId);
      activeChannels.set(channelId, { challengeId: challenge.id, lastActivity: now });

      try {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isTextBased()) {
          await channel.send('🎯 **New Wordle Challenge!** Guess with `?<word>` — 4-letter words only!');
          await updateBoard(channel, channelId, challenge, false);
        }
      } catch (err) {
        console.error(`Failed to notify channel ${channelId}:`, err.message);
      }
    }

    // --- Clean up stale entries (solved/timed out via guess flow) ---
    for (const [channelId, info] of [...activeChannels]) {
      const challenge = db.getActiveChallenge(channelId);
      if (!challenge) {
        activeChannels.delete(channelId);
      }
    }
  }, 30_000);
}

async function sendToChannel(channelId, content) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased()) {
      await channel.send(content);
    }
  } catch (err) {
    console.error(`Failed to send to channel ${channelId}:`, err.message);
  }
}

// --- Start ---
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN env var.');
  process.exit(1);
}
client.login(token);
