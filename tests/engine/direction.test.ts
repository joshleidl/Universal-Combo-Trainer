import { describe, expect, it } from 'vitest';
import {
  arm,
  attemptResult,
  createAttempt,
  currentStepIndex,
  heldPosition,
  press,
  release,
  start,
  tick,
  type AttemptState,
} from '../../src/engine/attempt';
import {
  directionMistake,
  hasDirectionCheck,
  isDirection,
  positionDirections,
  positionMatches,
  resolvePosition,
} from '../../src/engine/direction';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import { settle } from './settle';
import type { ButtonId, Combo, HeldPosition, InputSource, Settings, Step } from '../../src/engine/types';

// --- helpers ---------------------------------------------------------------

const T0 = 1000;
/** ms timestamp `ms` into grid frame `frame` (frame 0 = T0), at 60 fps. Default: 5 ms in. */
const at = (frame: number, ms = 5) => T0 + frameToMs(frame, 60) + ms;

const ev = (button: ButtonId, timestamp: number, source: InputSource = 'keyboard') => ({ button, timestamp, source });
const down = (st: AttemptState, button: ButtonId, t: number, source: InputSource = 'keyboard') => press(st, ev(button, t, source));
const up = (st: AttemptState, button: ButtonId, t: number, source: InputSource = 'keyboard') => release(st, ev(button, t, source));

const step = (buttons: ButtonId[], targetFrame: number, over: Partial<Step> = {}): Step => ({
  buttons,
  targetFrame,
  tolEarly: 1,
  tolLate: 1,
  ...(buttons.length > 1 ? { chordWindow: { size: 2, unit: 'frames' as const } } : {}),
  ...over,
});

const combo = (steps: Step[], over: Partial<Combo> = {}): Combo => ({
  name: 'directions',
  steps,
  fps: 60,
  timingMode: 'relative',
  startMode: 'firstInput',
  ...over,
});

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

const ALL: HeldPosition[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// --- helpers in engine/direction.ts ----------------------------------------

describe('direction helpers', () => {
  it('isDirection is true only for UP, DOWN, LEFT, RIGHT', () => {
    expect(['UP', 'DOWN', 'LEFT', 'RIGHT'].map(isDirection)).toEqual([true, true, true, true]);
    expect(['LP', 'HK', 'MISC1', ''].map(isDirection)).toEqual([false, false, false, false]);
  });

  it('resolvePosition maps held directions to numpad positions', () => {
    expect(resolvePosition([])).toBe(5);
    expect(resolvePosition(['DOWN', 'LEFT'])).toBe(1);
    expect(resolvePosition(['DOWN'])).toBe(2);
    expect(resolvePosition(['RIGHT', 'DOWN'])).toBe(3);
    expect(resolvePosition(['LEFT'])).toBe(4);
    expect(resolvePosition(['RIGHT'])).toBe(6);
    expect(resolvePosition(['UP', 'LEFT'])).toBe(7);
    expect(resolvePosition(['UP'])).toBe(8);
    expect(resolvePosition(['UP', 'RIGHT'])).toBe(9);
  });

  it('resolvePosition cancels opposite directions (SOCD neutral) and ignores buttons', () => {
    expect(resolvePosition(['LEFT', 'RIGHT'])).toBe(5);
    expect(resolvePosition(['UP', 'DOWN'])).toBe(5);
    expect(resolvePosition(['LEFT', 'RIGHT', 'DOWN'])).toBe(2);
    expect(resolvePosition(['UP', 'DOWN', 'RIGHT'])).toBe(6);
    expect(resolvePosition(['UP', 'DOWN', 'LEFT', 'RIGHT'])).toBe(5);
    expect(resolvePosition(['LP', 'DOWN', 'HK'])).toBe(2);
  });

  it('positionDirections is the inverse of resolvePosition', () => {
    expect(positionDirections(5)).toEqual([]);
    expect(positionDirections(3)).toEqual(['DOWN', 'RIGHT']);
    expect(positionDirections(7)).toEqual(['UP', 'LEFT']);
    for (const p of ALL) expect(resolvePosition(positionDirections(p))).toBe(p);
  });

  it('positionMatches exact needs the same position', () => {
    for (const w of ALL) for (const h of ALL) expect(positionMatches(w, h, 'exact')).toBe(w === h);
  });

  it('positionMatches at least needs every wanted direction', () => {
    expect([1, 2, 3].map((h) => positionMatches(2, h as HeldPosition, 'atLeast'))).toEqual([true, true, true]);
    expect([4, 5, 6, 7, 8, 9].some((h) => positionMatches(2, h as HeldPosition, 'atLeast'))).toBe(false);
    expect(positionMatches(3, 2, 'atLeast')).toBe(false);
    expect(positionMatches(3, 3, 'atLeast')).toBe(true);
    for (const h of ALL) expect(positionMatches(5, h, 'atLeast')).toBe(true); // a plain at-least step
  });

  it('directionMistake: missing when the held position is a strict part of the wanted one', () => {
    expect(directionMistake(6, 5)).toBe('missing');
    expect(directionMistake(3, 2)).toBe('missing');
    expect(directionMistake(3, 6)).toBe('missing');
    expect(directionMistake(3, 5)).toBe('missing');
  });

  it('directionMistake: wrong for a different or extra direction, or any direction when neutral is wanted', () => {
    expect(directionMistake(6, 4)).toBe('wrong');
    expect(directionMistake(6, 3)).toBe('wrong');
    expect(directionMistake(3, 1)).toBe('wrong');
    expect(directionMistake(5, 2)).toBe('wrong');
  });

  it('hasDirectionCheck: a direction, or a plain step set to exact', () => {
    expect(hasDirectionCheck(step(['MP'], 0))).toBe(false);
    expect(hasDirectionCheck(step(['MP'], 0, { directionMatch: 'atLeast' }))).toBe(false);
    expect(hasDirectionCheck(step(['MP'], 0, { directionMatch: 'exact' }))).toBe(true);
    expect(hasDirectionCheck(step(['MP'], 0, { direction: 6 }))).toBe(true);
    expect(hasDirectionCheck(step(['LP', 'LK'], 0, { direction: 4, directionMatch: 'atLeast' }))).toBe(true);
  });
});

// --- held state --------------------------------------------------------------

describe('held state', () => {
  const c = combo([step(['LP'], 0), step(['MP'], 10)]);

  it('arm takes the held set, buttons and directions, each once', () => {
    const st = arm(createAttempt(c), ['DOWN', 'LP', 'RIGHT', 'DOWN']);
    expect(st.held).toEqual(['DOWN', 'LP', 'RIGHT']);
    expect(heldPosition(st)).toBe(3);
  });

  it('a fresh attempt holds nothing', () => {
    const st = arm(createAttempt(c));
    expect(st.held).toEqual([]);
    expect(heldPosition(st)).toBe(5);
  });

  it('presses and releases update the held set while idle, armed and running', () => {
    let st = createAttempt(c);
    st = down(st, 'DOWN', 900);
    expect(st.phase).toBe('idle');
    expect(st.held).toEqual(['DOWN']);
    st = arm(st);
    expect(st.held).toEqual(['DOWN']); // arm without a held set keeps it
    st = down(st, 'RIGHT', 950);
    expect(heldPosition(st)).toBe(3);
    st = down(st, 'LP', T0);
    expect(st.phase).toBe('armed'); // step 1 is graded when frame 0 closes
    st = up(st, 'DOWN', at(2));
    expect(st.phase).toBe('running');
    expect(st.held).toEqual(['RIGHT', 'LP']);
    expect(heldPosition(st)).toBe(6);
  });

  it('countdown mode tracks directions before start()', () => {
    const cd = combo([step(['LP'], 0)], { startMode: 'countdown' });
    let st = down(arm(createAttempt(cd)), 'LEFT', 500);
    expect(st.held).toEqual(['LEFT']);
    st = start(st, T0);
    expect(heldPosition(st)).toBe(4);
  });

  it('pressing a held direction again or releasing one that is not held changes nothing', () => {
    const st = arm(createAttempt(c), ['DOWN']);
    expect(down(st, 'DOWN', 900)).toBe(st);
    expect(up(st, 'UP', 900)).toBe(st);
  });

  it('a button release updates the held set (the press rule needs it)', () => {
    const st = down(arm(createAttempt(c)), 'LP', T0);
    expect(st.held).toEqual(['LP']);
    expect(up(st, 'LP', at(1)).held).toEqual([]);
  });

  it('keeps tracking after the attempt ends, and a quick restart keeps the held set', () => {
    let st = arm(createAttempt(combo([step(['LP'], 0)])));
    st = settle(down(st, 'LP', T0));
    expect(st.phase).toBe('done');
    st = down(st, 'UP', at(3));
    expect(st.held).toEqual(['LP', 'UP']);
    const again = arm(st);
    expect(again.phase).toBe('armed');
    expect(again.results).toEqual([]);
    expect(again.held).toEqual(['LP', 'UP']);
    expect(arm(st, []).held).toEqual([]); // a held set passed in wins
  });

  it('a direction press during a button step is never a mistake, in strict or non-strict mode', () => {
    for (const strict of [true, false]) {
      let st = arm(createAttempt(c, settings({ strict })));
      st = down(st, 'RIGHT', 900);
      st = down(st, 'LP', T0);
      st = down(st, 'DOWN', at(4));
      st = up(st, 'RIGHT', at(5));
      expect(st.phase).toBe('running');
      expect(st.ignoredPresses).toEqual([]);
      st = settle(down(st, 'MP', at(10)));
      expect(st.results.map((r) => r.grade)).toEqual(['ON_TIME', 'ON_TIME']);
    }
  });
});

// --- the end-of-frame check --------------------------------------------------

describe('end-of-frame check', () => {
  const c = combo([step(['LP'], 0), step(['MP'], 10, { direction: 6, directionMatch: 'exact' }), step(['HP'], 10)]);

  it('waits until the end of the press frame before grading', () => {
    let st = down(down(arm(createAttempt(c), ['RIGHT']), 'LP', T0), 'MP', at(10));
    expect(st.results).toHaveLength(1);
    expect(currentStepIndex(st)).toBe(1);
    st = tick(st, at(10, 16)); // still frame 10
    expect(st.results).toHaveLength(1);
    st = tick(st, at(11, 0));
    expect(st.results[1]).toMatchObject({ grade: 'ON_TIME', direction: { wanted: 6, held: 6, match: 'exact' } });
    expect(st.lastInputFrame).toBe(10);
  });

  it('a direction release on a later frame closes the frame first, reading its end state', () => {
    let st = down(down(arm(createAttempt(c), ['RIGHT']), 'LP', T0), 'MP', at(10));
    st = up(st, 'RIGHT', at(11, 1));
    expect(st.results[1]?.grade).toBe('ON_TIME');
    expect(st.held).toEqual(['LP', 'MP']);
  });

  it('the next step counts from the graded press frame, also after a direction mistake', () => {
    let st = down(down(arm(createAttempt(c), ['LEFT']), 'LP', T0), 'MP', at(10));
    st = settle(down(st, 'HP', at(20)));
    expect(st.results.map((r) => r.grade)).toEqual(['ON_TIME', 'WRONG_BUTTON', 'ON_TIME']);
    expect(st.results[2]?.inputFrame).toBe(10);
  });

  it('tick uses the largest latency offset before closing', () => {
    const st0 = arm(createAttempt(c, settings({ latencyOffsetMs: { keyboard: 0, gamepad: 20 } })), ['RIGHT']);
    let st = down(down(st0, 'LP', T0), 'MP', at(10));
    st = tick(st, at(11, 5)); // minus 20 ms is still frame 10
    expect(st.results).toHaveLength(1);
    // A late-arriving pad release still on frame 10 (after its offset) counts.
    st = up(st, 'RIGHT', at(11, 5), 'gamepad');
    st = tick(st, at(12, 5));
    expect(st.results[1]).toMatchObject({ grade: 'PARTIAL', directionMistake: 'missing' });
  });

  it('direction timestamps are latency-corrected', () => {
    const st0 = arm(createAttempt(c, settings({ latencyOffsetMs: { keyboard: 0, gamepad: 10 } })));
    // The pad press arrives at raw frame 11 + 5 ms; minus the pad's 10 ms offset it lands on
    // frame 10, so it doesn't close the check and counts as held at the end of frame 10.
    let st = down(down(st0, 'LP', T0), 'MP', at(10));
    st = down(st, 'RIGHT', at(11, 5), 'gamepad');
    st = tick(st, at(13));
    expect(st.results[1]?.grade).toBe('ON_TIME');
  });

  it('a plain at-least step has no check', () => {
    const plain = combo([step(['LP'], 0), step(['MP'], 10), step(['HP'], 10)]);
    const st = settle(down(down(arm(createAttempt(plain), ['LEFT']), 'LP', T0), 'MP', at(10)));
    expect(st.results[1]?.grade).toBe('ON_TIME');
    expect(st.results[1]?.direction).toBeUndefined();
  });

  it('an exact plain step wants neutral', () => {
    const neutral = combo([step(['LP'], 0), step(['MP'], 10, { directionMatch: 'exact' }), step(['HP'], 10)]);
    const ok = tick(down(down(arm(createAttempt(neutral)), 'LP', T0), 'MP', at(10)), at(12));
    expect(ok.results[1]).toMatchObject({ grade: 'ON_TIME', direction: { wanted: 5, held: 5, match: 'exact' } });
    const socd = tick(down(down(arm(createAttempt(neutral), ['LEFT', 'RIGHT']), 'LP', T0), 'MP', at(10)), at(12));
    expect(socd.results[1]?.grade).toBe('ON_TIME');
  });

  it('a wrong button while the step is awaited is still WRONG_BUTTON (button mistakes are unchanged)', () => {
    const st = settle(down(down(arm(createAttempt(c), ['RIGHT']), 'LP', T0), 'HK', at(10)));
    expect(st.endedBy).toBe('wrongButton');
    expect(st.results[1]?.direction).toBeUndefined();
  });

  it('holding a direction never starts or pauses the MISSED timer', () => {
    let st = down(arm(createAttempt(c)), 'LP', T0);
    st = down(st, 'RIGHT', at(5));
    st = tick(st, at(10 + 1 + 30 + 1, 0));
    expect(st.endedBy).toBe('missed');
  });

  it('a press past the timeout is MISSED, with no check', () => {
    let st = down(arm(createAttempt(c), ['RIGHT']), 'LP', T0);
    st = down(st, 'MP', at(42));
    expect(st.endedBy).toBe('missed');
    expect(st.results[1]?.direction).toBeUndefined();
  });
});

// --- step 1 in first-input mode (Directions, rule 9) -------------------------

describe('direction+button step 1 in first-input mode', () => {
  const c = combo([step(['MK'], 0, { direction: 2, directionMatch: 'exact' }), step(['HP'], 10)]);

  it('the press is frame 0 and the direction is checked at the end of frame 0', () => {
    let st = down(arm(createAttempt(c)), 'MK', T0);
    expect(st.phase).toBe('armed');
    expect(st.results).toEqual([]);
    st = down(st, 'DOWN', T0 + 10); // still frame 0
    st = tick(st, at(1, 0));
    expect(st.phase).toBe('running');
    expect(st.frame0).toBe(T0);
    expect(st.results[0]).toMatchObject({ grade: 'ON_TIME', inputFrame: 0, direction: { held: 2 } });
    st = settle(down(st, 'HP', at(10)));
    expect(st.results[1]).toMatchObject({ grade: 'ON_TIME', inputFrame: 10 });
  });

  it('a failed check replaces the start grade and the attempt goes on', () => {
    const st = tick(down(arm(createAttempt(c)), 'MK', T0), at(1, 0));
    expect(st.phase).toBe('running');
    expect(st.results[0]).toMatchObject({ grade: 'PARTIAL', directionMistake: 'missing', direction: { held: 5 } });
  });

  it('a 1-step combo completes when the check closes', () => {
    const one = combo([step(['MK'], 0, { direction: 2 })]);
    const st = tick(down(arm(createAttempt(one), ['DOWN']), 'MK', T0), at(1, 0));
    expect(st.phase).toBe('done');
    expect(attemptResult(st)?.success).toBe(true);
  });

  it('strict: an extra press on frame 0 is WRONG_BUTTON', () => {
    const st = settle(down(down(arm(createAttempt(c), ['DOWN']), 'MK', T0), 'HP', T0 + 8));
    expect(st.endedBy).toBe('wrongButton');
    expect(st.results[0]).toMatchObject({ stepIndex: 0, grade: 'WRONG_BUTTON', press: { button: 'HP' } });
    expect(attemptResult(st)?.positions).toEqual([]); // ended before frame 0 was set
  });

  it('non-strict: an extra press on frame 0 ignores both presses and step 1 waits again', () => {
    let st = arm(createAttempt(c, settings({ strict: false })), ['DOWN']);
    st = settle(down(down(st, 'MK', T0), 'HP', T0 + 8));
    expect(st.phase).toBe('armed');
    expect(st.frames.origin).toBeNull(); // frame 0 is cleared
    expect(st.ignoredPresses.map((e) => e.timestamp)).toEqual([T0, T0 + 8]);
    st = up(st, 'MK', T0 + 400);
    st = tick(down(st, 'MK', T0 + 500), T0 + 600);
    expect(st.frame0).toBe(T0 + 500);
    expect(st.results[0]?.grade).toBe('ON_TIME');
  });
});

// --- chords with a direction (Directions, rule 8) ----------------------------

describe('chords with a direction', () => {
  it('a failed check replaces SPLIT', () => {
    const c = combo([step(['LK'], 0), step(['LP', 'LK'], 10, { direction: 4, directionMatch: 'exact' }), step(['HP'], 10)]);
    let st = down(arm(createAttempt(c), ['RIGHT']), 'LK', T0);
    st = up(st, 'LK', at(1)); // so the chord can press LK again
    st = down(down(st, 'LP', at(8)), 'LK', at(10)); // early + on time = SPLIT
    st = tick(st, at(11, 0));
    expect(st.results[1]).toMatchObject({ grade: 'WRONG_BUTTON', directionMistake: 'wrong', direction: { held: 6 } });
    expect(st.results[1]?.presses?.map((p) => p.timing)).toEqual(['EARLY', 'ON_TIME']);
    expect(st.phase).toBe('running');
  });

  it('a passing check keeps the chord grade', () => {
    const c = combo([step(['LK'], 0), step(['LP', 'LK'], 10, { direction: 4 }), step(['HP'], 10)]);
    let st = down(arm(createAttempt(c), ['LEFT']), 'LK', T0);
    st = up(st, 'LK', at(1)); // so the chord can press LK again
    st = tick(down(down(st, 'LP', at(8)), 'LK', at(10)), at(11, 0));
    expect(st.results[1]).toMatchObject({ grade: 'SPLIT', direction: { wanted: 4, held: 4, match: 'atLeast' } });
  });

  it('a chord that runs out of window is PARTIAL by the chord rules, with no check', () => {
    const c = combo([step(['LK'], 0), step(['LP', 'LK'], 10, { direction: 4 }), step(['HP'], 10)]);
    let st = down(arm(createAttempt(c), ['LEFT']), 'LK', T0);
    st = up(st, 'LK', at(1)); // so the chord can press LK again
    st = tick(down(st, 'LP', at(10)), at(13, 0));
    expect(st.endedBy).toBe('partial');
    expect(st.results[1]?.direction).toBeUndefined();
  });

  it('step 1 chord in first-input mode is checked at the end of the frame it completed on', () => {
    const c = combo([step(['LP', 'LK'], 0, { direction: 2, directionMatch: 'exact' }), step(['HP'], 10)]);
    let st = arm(createAttempt(c));
    st = down(down(st, 'LP', T0), 'LK', at(1));
    st = down(st, 'DOWN', at(1, 10)); // same frame as the completing press
    st = tick(st, at(2, 0));
    expect(st.phase).toBe('running');
    expect(st.results[0]).toMatchObject({ grade: 'ON_TIME', direction: { held: 2 } });
    expect(st.lastInputFrame).toBe(1);
  });
});

// --- positions history ---------------------------------------------------------

describe('AttemptResult.positions', () => {
  const c = combo([step(['LP'], 0), step(['MP'], 20, { tolEarly: 30, tolLate: 30 })]);
  const finishAt = (st: AttemptState, frame: number) => attemptResult(settle(down(st, 'MP', at(frame))))?.positions;

  it('starts with the position at frame 0, timestamped at frame 0', () => {
    const st = down(arm(createAttempt(c), ['DOWN']), 'LP', T0);
    expect(finishAt(st, 20)).toEqual([{ frame: 0, position: 2, timestamp: T0 }]);
  });

  it('adds one entry per frame whose ending position changed, with the input time', () => {
    let st = down(arm(createAttempt(c)), 'LP', T0);
    st = down(st, 'DOWN', at(3));
    st = down(st, 'RIGHT', at(5));
    st = up(st, 'DOWN', at(8));
    expect(finishAt(st, 20)).toEqual([
      { frame: 0, position: 5, timestamp: T0 },
      { frame: 3, position: 2, timestamp: at(3) },
      { frame: 5, position: 3, timestamp: at(5) },
      { frame: 8, position: 6, timestamp: at(8) },
    ]);
  });

  it('uses the position at the end of each frame: changes within a frame collapse', () => {
    let st = down(arm(createAttempt(c)), 'LP', T0);
    st = down(st, 'DOWN', at(4, 1));
    st = down(st, 'RIGHT', at(4, 9)); // frame 4 ends on ↘
    st = down(st, 'UP', at(6, 1));
    st = up(st, 'UP', at(6, 9)); // frame 6 ends where frame 5 did
    expect(finishAt(st, 20)).toEqual([
      { frame: 0, position: 5, timestamp: T0 },
      { frame: 4, position: 3, timestamp: at(4, 9) },
    ]);
  });

  it('applies SOCD', () => {
    let st = down(arm(createAttempt(c), ['LEFT']), 'LP', T0);
    st = down(st, 'RIGHT', at(2));
    expect(finishAt(st, 20)).toEqual([
      { frame: 0, position: 4, timestamp: T0 },
      { frame: 2, position: 5, timestamp: at(2) },
    ]);
  });

  it('changes before frame 0 and on frame 0 give the frame-0 position', () => {
    let st = arm(createAttempt(c));
    st = down(st, 'UP', 500);
    st = up(st, 'UP', 600);
    st = down(st, 'DOWN', 700);
    st = down(st, 'LP', T0);
    st = down(st, 'LEFT', T0 + 10); // still frame 0
    expect(finishAt(st, 20)).toEqual([{ frame: 0, position: 1, timestamp: T0 }]);
    expect(st.positionLog.length).toBeLessThanOrEqual(2); // wiggling before frame 0 isn't kept
  });

  it('countdown mode counts from the countdown frame 0', () => {
    const cd = combo([step(['LP'], 0, { tolEarly: 5, tolLate: 5 }), step(['MP'], 20, { tolEarly: 30, tolLate: 30 })], { startMode: 'countdown' });
    let st = start(arm(createAttempt(cd), ['DOWN']), T0);
    st = up(st, 'DOWN', at(1));
    st = down(st, 'LP', at(2));
    expect(finishAt(st, 22)).toEqual([
      { frame: 0, position: 2, timestamp: T0 },
      { frame: 1, position: 5, timestamp: at(1) },
    ]);
  });

  it('includes changes up to the closing of the last check, not after the end', () => {
    const last = combo([step(['LP'], 0), step(['MP'], 10, { direction: 6 })]);
    let st = down(arm(createAttempt(last)), 'LP', T0);
    st = down(st, 'RIGHT', at(10, 1));
    st = down(st, 'MP', at(10, 2));
    st = up(st, 'RIGHT', at(11, 0)); // closes the check (and the attempt) first
    expect(st.phase).toBe('done');
    expect(attemptResult(st)?.positions).toEqual([
      { frame: 0, position: 5, timestamp: T0 },
      { frame: 10, position: 6, timestamp: at(10, 1) },
    ]);
  });

  it('a step-1 chord in first-input mode anchors frame 0 at its first press', () => {
    const ch = combo([step(['LP', 'LK'], 0), step(['MP'], 20, { tolEarly: 30, tolLate: 30 })]);
    let st = down(arm(createAttempt(ch)), 'LP', T0);
    st = down(st, 'DOWN', at(1, 1));
    st = down(st, 'LK', at(1, 2));
    expect(finishAt(tick(st, at(2)), 21)).toEqual([
      { frame: 0, position: 5, timestamp: T0 },
      { frame: 1, position: 2, timestamp: at(1, 1) },
    ]);
  });
});
