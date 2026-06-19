/**
 * Wordle evaluation engine with proper duplicate-letter handling.
 *
 * Algorithm (matches official Wordle):
 * 1. First pass — mark exact (green) matches, record remaining answer letters.
 * 2. Second pass — mark present (yellow) for non-green positions, consuming
 *    from the remaining pool. If pool exhausted → absent (grey).
 */
const CORRECT = 'correct';   // green
const PRESENT = 'present';   // yellow
const ABSENT  = 'absent';    // grey

function evaluate(guess, answer) {
  const g = guess.toLowerCase();
  const a = answer.toLowerCase();
  const len = a.length;
  const result = Array(len).fill(ABSENT);
  const remaining = [];      // answer letters not yet claimed by green

  // Pass 1: greens
  for (let i = 0; i < len; i++) {
    if (g[i] === a[i]) {
      result[i] = CORRECT;
    } else {
      remaining.push(a[i]);
    }
  }

  // Pass 2: yellows
  for (let i = 0; i < len; i++) {
    if (result[i] === CORRECT) continue;
    const idx = remaining.indexOf(g[i]);
    if (idx !== -1) {
      result[i] = PRESENT;
      remaining.splice(idx, 1);
    }
  }

  return result;
}

/**
 * Read a letter's best-known status out of a letter-state map.
 * Accepts both legacy string values ("correct") and the rich object form
 * ({ s, g, y }) produced by computeScore.
 */
function getStatus(letterState, letter) {
  const v = letterState[letter];
  if (v == null) return undefined;
  return typeof v === 'string' ? v : v.s;
}

/**
 * Normalise + deep-clone a letter-state map into the rich object form.
 * Legacy string values ("correct") become { s, g:[], y:0 } — positions are
 * unknown, so the next green at any position is treated as new (acceptable
 * one-time drift when migrating an in-flight challenge).
 */
function normalizeState(prev) {
  const out = {};
  for (const [letter, v] of Object.entries(prev || {})) {
    if (typeof v === 'string') {
      out[letter] = { s: v, g: [], y: 0 };
    } else if (v && typeof v === 'object') {
      out[letter] = { s: v.s, g: [...(v.g || [])], y: v.y || 0 };
    }
  }
  return out;
}

function countOccurrences(str, ch) {
  let n = 0;
  for (let i = 0; i < str.length; i++) if (str[i] === ch) n++;
  return n;
}

/**
 * Compute incremental score delta for a single guess, with proper
 * duplicate-letter (multiplicity) handling.
 *
 * Per letter we track:
 *   s — best-known status (correct > present > absent) for keyboard display
 *   g — positions where the letter is confirmed green
 *   y — count of confirmed-present instances not yet pinned to a green slot
 *
 * `answer` is required to know how many copies of a letter exist, so that
 * discovering a 2nd/3rd instance of a duplicated letter scores correctly.
 *
 * Rules (RULES_TEXT):
 *   new green letter  → +2
 *   new yellow letter → +1
 *   yellow → green upgrade → +1
 *
 * @param {string[]} result  - Array of 'correct'|'present'|'absent'
 * @param {string}   guess   - the guess (case-insensitive)
 * @param {string}   answer  - the answer (case-insensitive)
 * @param {object}   prevLetterState - prior rich/legacy letter-state map
 * @returns {{ delta: number, newLetterState: object }}
 */
function computeScore(result, guess, answer, prevLetterState) {
  const g = guess.toLowerCase();
  const a = answer.toLowerCase();
  const state = normalizeState(prevLetterState);
  let delta = 0;

  for (let i = 0; i < result.length; i++) {
    const letter = g[i];
    const outcome = result[i];
    const st = state[letter] || { s: undefined, g: [], y: 0 };
    const answerCount = countOccurrences(a, letter);

    if (outcome === CORRECT) {
      if (st.g.includes(i)) {
        // Same green position already known → no new info.
      } else if (st.y > 0) {
        // Pin a previously-yellow instance to this position → upgrade +1.
        st.y -= 1;
        st.g.push(i);
        st.s = CORRECT;
        delta += 1;
      } else if (st.g.length + st.y < answerCount) {
        // Brand-new instance, placed green → +2.
        st.g.push(i);
        st.s = CORRECT;
        delta += 2;
      } else {
        // No unclaimed instance left; record position without points.
        st.g.push(i);
        st.s = CORRECT;
      }
    } else if (outcome === PRESENT) {
      if (st.g.length + st.y < answerCount) {
        // Reveals an additional present instance → +1.
        st.y += 1;
        if (st.s !== CORRECT) st.s = PRESENT;
        delta += 1;
      } else {
        // All instances already known → redundant yellow.
        if (st.s !== CORRECT) st.s = PRESENT;
      }
    } else if (outcome === ABSENT) {
      if (!st.s) st.s = ABSENT;
    }

    state[letter] = st;
  }

  return { delta, newLetterState: state };
}

module.exports = { evaluate, computeScore, getStatus, CORRECT, PRESENT, ABSENT };
