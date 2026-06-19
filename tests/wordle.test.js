const { evaluate, computeScore, CORRECT, PRESENT, ABSENT } = require('../src/wordle');

// --- evaluate() ---

describe('evaluate', () => {
  test('all correct', () => {
    expect(evaluate('discord', 'discord')).toEqual(
      [CORRECT, CORRECT, CORRECT, CORRECT, CORRECT, CORRECT, CORRECT]
    );
  });

  test('all absent', () => {
    expect(evaluate('aaaaaaaa', 'bbbbbbb')).toEqual(
      Array(7).fill(ABSENT)
    );
  });

  test('mixed correct, present, absent', () => {
    // answer: DISCORD → d i s c o r d
    const result = evaluate('discard', 'discord');
    // d=D correct, i=I correct, s=S? no (s vs s) wait
    // answer: d i s c o r d
    // guess:  d i s c a r d
    //         ^ ^ ^ ^   ^ ^
    // d=correct, i=correct, s=correct, c=correct, a=absent, r=correct, d=correct
    expect(result).toEqual([
      CORRECT, CORRECT, CORRECT, CORRECT, ABSENT, CORRECT, CORRECT,
    ]);
  });

  test('present letters detected', () => {
    // answer: discord
    const result = evaluate('ricotta', 'discord');
    // r→present, i→present, c→present, o→absent(t), t→absent, a→absent, a→absent
    // Wait let me think:
    // answer: d i s c o r d
    // guess:  r i c o t t a
    // Pass 1 (greens): i=pos1 matches → green, all others not exact
    // remaining from answer: d, s, c, o, r, d
    // Pass 2:
    // pos0 r → in remaining? r is there → yellow, remove r
    // pos2 c → in remaining? c is there → yellow, remove c
    // pos3 o → in remaining? o is there → yellow, remove o
    // pos4 t → not in remaining → absent
    // pos5 t → absent
    // pos6 a → absent
    expect(result).toEqual([
      PRESENT, CORRECT, PRESENT, PRESENT, ABSENT, ABSENT, ABSENT,
    ]);
  });

  describe('duplicate-letter handling', () => {
    test('answer has duplicate letters, guess has one', () => {
      // answer: ADDRESS (a d d r e s s) — two d's, two s's
      const result = evaluate('discord', 'address');
      // Pass 1 (greens):
      // d vs a → no, i vs d → no, s vs d → no, c vs r → no,
      // o vs e → no, r vs s → no, d vs s → no
      // remaining: a,d,d,r,e,s,s
      // Pass 2:
      // d → in remaining → yellow, remove one d
      // i → not in remaining → absent
      // s → in remaining → yellow, remove one s
      // c → not → absent
      // o → not → absent
      // r → in remaining → yellow, remove r
      // d → in remaining → yellow, remove one d
      expect(result).toEqual([
        PRESENT, ABSENT, PRESENT, ABSENT, ABSENT, PRESENT, PRESENT,
      ]);
    });

    test('guess has duplicate, answer has one', () => {
      // answer: DISCORD (d i s c o r d) — two d's
      // guess:  DDDDDDD
      const result = evaluate('ddddddd', 'discord');
      // Pass 1: pos0 d=d → green, pos6 d=d → green
      // remaining: i, s, c, o, r
      // Pass 2: pos1 d → not in remaining → absent
      // pos2 d → absent, pos3 d → absent, pos4 d → absent, pos5 d → absent
      expect(result).toEqual([
        CORRECT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, CORRECT,
      ]);
    });

    test('guess has two of a letter, answer has two — both present', () => {
      // answer: SESSION (s e s s i o n) — three s's
      const result = evaluate('biopsys', 'session');
      // answer: s e s s i o n
      // guess:  b i o p s y s
      // Pass 1 (greens): no exact matches
      // remaining: s,e,s,s,i,o,n
      // Pass 2:
      // b → no, i → yes (remove i), o → yes (remove o), p → no,
      // s → yes (remove one s), y → no, s → yes (remove one s)
      expect(result).toEqual([
        ABSENT, PRESENT, PRESENT, ABSENT, PRESENT, ABSENT, PRESENT,
      ]);
    });

    test('guess has three of a letter, answer has one — excess are absent', () => {
      // answer: NETWORK (n e t w o r k)
      const result = evaluate('neeeeee', 'network');
      // Pass 1: pos0 n=n → green, pos1 e=e → green
      // remaining: t,w,o,r,k
      // Pass 2: pos2 e → not in remaining → absent (×5)
      expect(result).toEqual([
        CORRECT, CORRECT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT,
      ]);
    });

    test('answer: DRESSER, guess: reedier', () => {
      // answer: D R E S S E R — d,r,e,s,s,e,r
      // guess:  R E E D I E R
      // Pass 1: pos2 e=e green, pos5 e=e green, pos6 r=r green
      // remaining: d,r,s,s
      // Pass 2: pos0 r→yellow, pos1 e→absent, pos3 d→yellow, pos4 i→absent
      const res = evaluate('reedier', 'dresser');
      expect(res).toEqual([
        PRESENT, ABSENT, CORRECT, PRESENT, ABSENT, CORRECT, CORRECT,
      ]);
    });
  });
});

// --- computeScore() ---
// Signature: computeScore(result, guess, answer, prevLetterState)
// Results are derived from evaluate() so guess/answer stay consistent.

describe('computeScore', () => {
  // Helper: score a (guess, answer) pair against prior state.
  const score = (guess, answer, prev = {}) =>
    computeScore(evaluate(guess, answer), guess, answer, prev);

  test('all absent → 0 points', () => {
    expect(score('xxxxx', 'brain').delta).toBe(0);
  });

  test('new green → +2 per letter (two greens → +4)', () => {
    // answer discab: d@0 green, i@1 green, x's absent
    expect(score('dixxxx', 'discab').delta).toBe(4);
  });

  test('new yellow → +1 per letter', () => {
    // answer apple; pleas → p,l,e,a all yellow (4 distinct letters)
    expect(score('pleas', 'apple').delta).toBe(4);
  });

  test('yellow → green upgrade → +1', () => {
    const answer = 'drain';
    const s1 = score('lader', answer); // d yellow
    expect(score('dxxxx', answer, s1.newLetterState).delta).toBe(1); // d → green
  });

  test('new green directly → +2 (not +1 yellow + 1 green)', () => {
    expect(score('dxxxxx', 'discab').delta).toBe(2);
  });

  test('already green → 0', () => {
    const answer = 'drain';
    const s1 = score('dxxxx', answer);
    expect(score('dxxxx', answer, s1.newLetterState).delta).toBe(0);
  });

  test('already yellow → 0 (no new instance)', () => {
    const answer = 'brain';
    const s1 = score('xxxxa', answer); // a yellow
    expect(score('xxxxa', answer, s1.newLetterState).delta).toBe(0);
  });

  test('mixed: upgrade +1 + new green +2', () => {
    const answer = 'discab';
    const s1 = score('xdxxxx', answer); // d yellow
    // d upgrade +1, i new green +2
    expect(score('dixxxx', answer, s1.newLetterState).delta).toBe(3);
  });

  test('accumulates state across calls', () => {
    const answer = 'discab';
    let state = {};
    const r1 = score('xdxxxx', answer, state); // d yellow
    expect(r1.delta).toBe(1);
    state = r1.newLetterState;
    const r2 = score('dixixx', answer, state); // d upgrade +1, i green +2
    expect(r2.delta).toBe(3);
    state = r2.newLetterState;
    const r3 = score('disxxx', answer, state); // s new green +2 (d,i already green)
    expect(r3.delta).toBe(2);
  });

  describe('duplicate-letter handling (the bug fix)', () => {
    // Answer BOOT has 'o' twice (positions 2,3).
    const ANSWER = 'boot';

    test('word → o green new → +2', () => {
      expect(score('word', ANSWER).delta).toBe(2);
    });

    test('mono → 2nd o revealed as yellow → +1 (was +0 before fix)', () => {
      const s1 = score('word', ANSWER);
      expect(score('mono', ANSWER, s1.newLetterState).delta).toBe(1);
    });

    test('loop → 2nd o upgraded yellow→green → +1', () => {
      let state = score('word', ANSWER).newLetterState;
      state = score('mono', ANSWER, state).newLetterState;
      expect(score('loop', ANSWER, state).delta).toBe(1);
    });

    test('hook → 2nd o already green → +0', () => {
      let state = score('word', ANSWER).newLetterState;
      state = score('mono', ANSWER, state).newLetterState;
      state = score('loop', ANSWER, state).newLetterState;
      expect(score('hook', ANSWER, state).delta).toBe(0);
    });

    test('both o instances discovered green in one guess → +4', () => {
      // oooo: pos2,3 green (2 new instances × +2)
      expect(score('oooo', ANSWER).delta).toBe(4);
    });

    test('full boot sequence → deltas 2,1,1,0', () => {
      let state = {};
      const out = [];
      for (const guess of ['word', 'mono', 'loop', 'hook']) {
        const r = score(guess, ANSWER, state);
        out.push(r.delta);
        state = r.newLetterState;
      }
      expect(out).toEqual([2, 1, 1, 0]);
    });
  });

  test('legacy string state is migrated without crashing', () => {
    // Old shape { o: 'correct' } has no positions; first green re-scores once.
    const legacy = { o: CORRECT };
    // mono vs boot: o@pos2 green (migrated slot, +2) + o@pos4 yellow (+1)
    expect(score('mono', 'boot', legacy).delta).toBe(3);
  });
});
