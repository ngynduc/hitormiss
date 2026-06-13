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
 * Compute incremental score delta for a single guess.
 *
 * @param {string[]} result  - Array of 'correct'|'present'|'absent'
 * @param {object}   prevLetterState  - Map<letter, 'correct'|'present'|undefined>
 *   Tracks the best known state for each letter across all prior guesses in
 *   the current challenge.
 * @returns {{ delta: number, newLetterState: object }}
 */
function computeScore(result, guess, prevLetterState) {
  const g = guess.toLowerCase();
  const state = { ...prevLetterState };
  let delta = 0;

  for (let i = 0; i < result.length; i++) {
    const letter = g[i];
    const outcome = result[i];
    const prev = state[letter];

    if (outcome === CORRECT) {
      if (!prev || prev === ABSENT) {
        // New green → +2
        delta += 2;
        state[letter] = CORRECT;
      } else if (prev === PRESENT) {
        // Yellow → green upgrade → +1
        delta += 1;
        state[letter] = CORRECT;
      }
    } else if (outcome === PRESENT) {
      if (!prev || prev === ABSENT) {
        // New yellow → +1
        delta += 1;
        state[letter] = PRESENT;
      }
    } else if (outcome === ABSENT) {
      if (!prev) {
        state[letter] = ABSENT;
      }
    }
  }

  return { delta, newLetterState: state };
}

module.exports = { evaluate, computeScore, CORRECT, PRESENT, ABSENT };
