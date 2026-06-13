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

describe('computeScore', () => {
  test('all absent → 0 points', () => {
    const { delta } = computeScore(
      Array(7).fill(ABSENT), 'zzzzzzz', {}
    );
    expect(delta).toBe(0);
  });

  test('new green → +2 per letter', () => {
    const { delta } = computeScore(
      [CORRECT, CORRECT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
      'disable', {}
    );
    expect(delta).toBe(4); // d + i
  });

  test('new yellow → +1 per letter', () => {
    const { delta } = computeScore(
      [PRESENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
      'abandon', {}
    );
    expect(delta).toBe(1); // a is new yellow
  });

  test('yellow → green upgrade → +1', () => {
    const prev = { d: PRESENT };
    const { delta } = computeScore(
      [CORRECT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
      'discard', prev
    );
    expect(delta).toBe(1); // d upgraded from yellow to green
  });

  test('new green directly → +2 (not +1 yellow + 1 green)', () => {
    const { delta } = computeScore(
      [CORRECT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
      'discord', {}
    );
    expect(delta).toBe(2);
  });

  test('already green → 0', () => {
    const prev = { d: CORRECT };
    const { delta } = computeScore(
      [CORRECT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
      'discord', prev
    );
    expect(delta).toBe(0);
  });

  test('already yellow → 0', () => {
    const prev = { d: PRESENT };
    const { delta } = computeScore(
      [PRESENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
      'discard', prev
    );
    expect(delta).toBe(0);
  });

  test('mixed: new yellow + new green + upgrade', () => {
    // State: d is yellow, everything else unknown
    const prev = { d: PRESENT };
    // Result for "discord" where d=green, i=green, rest unknown
    const result = [CORRECT, CORRECT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT];
    // d: PRESENT → CORRECT = +1
    // i: undefined → CORRECT = +2
    const { delta } = computeScore(result, 'discord', prev);
    expect(delta).toBe(3);
  });

  test('accumulates state across calls', () => {
    let state = {};
    // Guess 1: d is yellow
    const r1 = computeScore(
      [PRESENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
      'discard', state
    );
    expect(r1.delta).toBe(1);
    state = r1.newLetterState;

    // Guess 2: d is green, i is yellow
    const r2 = computeScore(
      [CORRECT, PRESENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT],
      'discord', state
    );
    expect(r2.delta).toBe(2); // d upgrade +1, i new yellow +1
    state = r2.newLetterState;

    // Guess 3: d green (already), i green (upgrade), s new green
    const r3 = computeScore(
      [CORRECT, CORRECT, CORRECT, ABSENT, ABSENT, ABSENT, ABSENT],
      'disable', state
    );
    expect(r3.delta).toBe(3); // d nope(0), i upgrade(+1), s new(+2)
  });
});
