// Direction+button steps on the practice side (SPEC §4 "Engine API: directions", Practice
// bullet; SPEC §7 "Directions in the UI"): held state across attempts, countdowns started only by
// buttons (proposal cases K1 and K2), feedback text, stats, sounds and the timeline.

import { describe, expect, it } from 'vitest';
import { arm, attemptResult, createAttempt, press, release, tick, type AttemptState } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { ButtonId, Combo, DirectionMatch, HeldPosition, PressEvent, ReleaseEvent, Settings, Step, StepResult } from '../../src/engine/types';
import { practiceCues } from '../../src/practice/cues';
import { describeStep, directionNote, otherResultsText, stepNotation, timingGrade } from '../../src/practice/format';
import {
  countdownFrom,
  countdownGoAt,
  countdownLiveAt,
  createPractice,
  liveInput,
  practicePress,
  practiceRelease,
  practiceRestart,
  practiceTick,
  practiceWithSettings,
  waitingToStart,
  type PracticeState,
} from '../../src/practice/session';
import { emptyStats, recordAttempt, resultKind, summarizeStep } from '../../src/practice/stats';
import { buildTimeline } from '../../src/practice/timeline';

const T0 = 1000;
const f = (frames: number) => frameToMs(frames, 60);
/** ms timestamp `ms` into grid frame `frame` counted from `base`, at 60 fps. */
const at = (frame: number, ms = 5, base = T0) => base + f(frame) + ms;

const p = (button: ButtonId, timestamp: number): PressEvent => ({ button, timestamp, source: 'keyboard' });
const r = (button: ButtonId, timestamp: number): ReleaseEvent => ({ button, timestamp, source: 'keyboard' });

type Input = ['press' | 'release', ButtonId, number];
const feedPractice = (st: PracticeState, inputs: Input[]) =>
  inputs.reduce((s, [edge, b, t]) => (edge === 'press' ? practicePress(s, p(b, t)) : practiceRelease(s, r(b, t))), st);
const feedEngine = (st: AttemptState, inputs: Input[]) =>
  inputs.reduce((s, [edge, b, t]) => (edge === 'press' ? press(s, p(b, t)) : release(s, r(b, t))), st);

const step = (buttons: ButtonId[], over: Partial<Step> = {}): Step => ({
  buttons,
  targetFrame: 10,
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

/** LK to start, then →+MP (exact) 10 frames later, then HK. */
const rightMp = combo([step(['LK'], { targetFrame: 0 }), step(['MP'], { direction: 6, directionMatch: 'exact' }), step(['HK'])]);

/** Countdown combo: ↓+MK on frame 0 (the proposal's K cases), then HP 10 frames later. */
const downMk = combo([step(['MK'], { targetFrame: 0, tolEarly: 0, tolLate: 0, direction: 2 }), step(['HP'])], {
  startMode: 'countdown',
});

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

// --- session -----------------------------------------------------------------

describe('practice session: held state', () => {
  it('createPractice arms with the held set', () => {
    const st = createPractice(rightMp, DEFAULT_SETTINGS, undefined, ['RIGHT', 'LP']);
    expect(st.held).toEqual(['RIGHT', 'LP']);
    expect(st.attempt.held).toEqual(['RIGHT']);
    expect(liveInput(st)).toEqual({ position: 6, buttons: ['LP'] });
  });

  it('tracks presses and releases of buttons and directions, with SOCD for the stick', () => {
    let st = createPractice(rightMp, DEFAULT_SETTINGS);
    st = feedPractice(st, [
      ['press', 'DOWN', 100],
      ['press', 'RIGHT', 110],
      ['press', 'HP', 120],
    ]);
    expect(liveInput(st)).toEqual({ position: 3, buttons: ['HP'] });
    st = practicePress(st, p('LEFT', 130));
    expect(liveInput(st).position).toBe(2);
    st = feedPractice(st, [
      ['release', 'DOWN', 140],
      ['release', 'HP', 150],
    ]);
    expect(liveInput(st)).toEqual({ position: 5, buttons: [] });
    expect(st.attempt.held).toEqual(['RIGHT', 'LEFT']);
  });

  it('a direction held across the end of an attempt counts in the next one', () => {
    let st = createPractice(rightMp, DEFAULT_SETTINGS);
    st = feedPractice(st, [
      ['press', 'RIGHT', T0 - 100],
      ['press', 'LK', at(0)],
      ['press', 'MP', at(10)],
      ['press', 'HK', at(20)],
    ]);
    st = practiceTick(st, at(20) + 10);
    expect(st.attempt.phase).toBe('done');
    expect(st.stats.successes).toBe(1);
    // Next attempt arms at Go with → still held.
    const go = countdownGoAt(st.countdown!);
    st = practiceTick(st, go);
    expect(st.attempt.phase).toBe('armed');
    expect(st.attempt.held).toEqual(['RIGHT']);
    st = feedPractice(st, [
      ['press', 'LK', at(0, 5, go + 100)],
      ['press', 'MP', at(10, 5, go + 100)],
      ['press', 'HK', at(20, 5, go + 100)],
    ]);
    expect(st.attempt.results[1]).toMatchObject({ grade: 'ON_TIME', direction: { held: 6 } });
  });

  it('a direction released during the countdown is not held in the next attempt', () => {
    let st = createPractice(rightMp, DEFAULT_SETTINGS);
    st = feedPractice(st, [
      ['press', 'RIGHT', T0 - 100],
      ['press', 'LK', at(0)],
      ['press', 'MP', at(10)],
      ['press', 'HK', at(20)],
    ]);
    const countdown = st.countdown;
    st = practiceRelease(st, r('RIGHT', at(20) + 300));
    expect(st.countdown).toBe(countdown); // releases never restart a countdown
    st = practiceTick(st, countdownGoAt(countdown!));
    expect(st.attempt.held).toEqual([]);
  });

  it('quick restart and a settings change keep the held set', () => {
    let st = createPractice(rightMp, DEFAULT_SETTINGS);
    st = feedPractice(st, [
      ['press', 'LK', at(0)],
      ['press', 'RIGHT', at(5)],
    ]);
    st = practiceRestart(st, at(6));
    expect(st.attempt.phase).toBe('armed');
    expect(st.attempt.results).toEqual([]);
    expect(st.attempt.held).toEqual(['RIGHT']);
    st = practiceWithSettings(st, settings({ strict: false }));
    expect(st.attempt.held).toEqual(['RIGHT']);
  });

  it('a direction input that closes the last step’s check finishes the attempt and records it', () => {
    const c = combo([step(['LK'], { targetFrame: 0 }), step(['MP'], { direction: 6 })]);
    let st = createPractice(c, DEFAULT_SETTINGS);
    st = feedPractice(st, [
      ['press', 'LK', at(0)],
      ['press', 'MP', at(10)],
    ]);
    expect(st.attempt.phase).toBe('running');
    // Pressed a frame later, so the check on frame 10 closes first and finds nothing held.
    st = practicePress(st, p('RIGHT', at(11)));
    expect(st.attempt.phase).toBe('done');
    expect(st.stats.attempts).toBe(1);
    expect(st.attempt.results[1]).toMatchObject({ grade: 'PARTIAL', directionMistake: 'missing' });
    expect(st.countdown).toEqual(countdownFrom(at(11)));
  });
});

describe('practice session: countdowns start on buttons only', () => {
  it('a direction press while waiting to start doesn’t start the countdown', () => {
    let st = createPractice(downMk, DEFAULT_SETTINGS);
    st = practicePress(st, p('DOWN', 100));
    expect(waitingToStart(st)).toBe(true);
    expect(st.countdown).toBeNull();
    st = practiceRelease(st, r('DOWN', 150));
    expect(st.countdown).toBeNull();
    st = practicePress(st, p('LP', 200));
    expect(st.countdown).toEqual(countdownFrom(200));
  });

  it('direction presses and releases during a countdown don’t restart it; a button press does', () => {
    const twoStep = combo([step(['LP'], { targetFrame: 0 }), step(['MP'])]);
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = feedPractice(st, [
      ['press', 'LP', at(0)],
      ['press', 'MP', at(10)],
    ]);
    const c = st.countdown;
    st = feedPractice(st, [
      ['press', 'DOWN', at(10) + 200],
      ['press', 'RIGHT', at(10) + 300],
      ['release', 'DOWN', at(10) + 400],
    ]);
    expect(st.countdown).toBe(c);
    st = practicePress(st, p('HK', at(10) + 500));
    expect(st.countdown).toEqual(countdownFrom(at(10) + 500));
  });

  it('K1: ↓ held from before restart, MK on frame 0 is on time', () => {
    let st = createPractice(downMk, DEFAULT_SETTINGS);
    st = practicePress(st, p('DOWN', 100));
    st = practiceRestart(st, 200);
    const go = countdownGoAt(st.countdown!);
    st = practiceTick(st, countdownLiveAt(st.countdown!));
    expect(st.attempt.phase).toBe('running');
    expect(st.attempt.held).toEqual(['DOWN']);
    st = practicePress(st, p('MK', go + 5));
    st = practiceTick(st, go + f(1) + 1); // closes the check at the end of frame 0
    expect(st.attempt.results[0]).toMatchObject({ grade: 'ON_TIME', direction: { wanted: 2, held: 2 } });
  });

  it('K1: ↓ held across the previous attempt’s end and its countdown', () => {
    let st = createPractice(downMk, DEFAULT_SETTINGS);
    st = practicePress(st, p('DOWN', 100));
    st = practicePress(st, p('LP', 200)); // starts the countdown
    let go = countdownGoAt(st.countdown!);
    st = practiceTick(st, countdownLiveAt(st.countdown!));
    st = feedPractice(st, [
      ['press', 'MK', go + 5],
      ['press', 'HP', at(10, 5, go)],
    ]);
    expect(st.attempt.phase).toBe('done');
    expect(st.stats.successes).toBe(1);
    // ↓ is still held: the next attempt, started by the countdown after this one, sees it.
    go = countdownGoAt(st.countdown!);
    st = practiceTick(st, countdownLiveAt(st.countdown!));
    st = practicePress(st, p('MK', go + 5));
    st = practiceTick(st, go + f(1) + 1);
    expect(st.attempt.results[0]).toMatchObject({ grade: 'ON_TIME', direction: { held: 2 } });
  });

  it('K2: ↓ pressed during the countdown doesn’t restart it and counts on frame 0', () => {
    let st = createPractice(downMk, DEFAULT_SETTINGS);
    st = practicePress(st, p('LP', 200));
    const c = st.countdown!;
    st = practicePress(st, p('DOWN', c.startAt + 100));
    expect(st.countdown).toBe(c);
    st = practiceTick(st, countdownLiveAt(c));
    const go = countdownGoAt(c);
    st = practicePress(st, p('MK', go + 5));
    st = practiceTick(st, go + f(1) + 1);
    expect(st.attempt.results[0]).toMatchObject({ grade: 'ON_TIME', direction: { held: 2 } });
  });

  it('K2 variant: ↓ released before Go is missing', () => {
    let st = createPractice(downMk, DEFAULT_SETTINGS);
    st = practicePress(st, p('LP', 200));
    const c = st.countdown!;
    st = feedPractice(st, [
      ['press', 'DOWN', c.startAt + 100],
      ['release', 'DOWN', c.startAt + 200],
    ]);
    st = practiceTick(st, countdownLiveAt(c));
    const go = countdownGoAt(c);
    st = practicePress(st, p('MK', go + 5));
    st = practiceTick(st, go + f(1) + 1);
    expect(st.attempt.results[0]).toMatchObject({ grade: 'PARTIAL', directionMistake: 'missing' });
    expect(st.attempt.phase).toBe('running'); // a direction mistake doesn't end the attempt
  });

  it('from the last beat on, a direction press goes to the running attempt', () => {
    let st = createPractice(downMk, DEFAULT_SETTINGS);
    st = practicePress(st, p('LP', 200));
    const c = st.countdown!;
    const live = countdownLiveAt(c);
    st = practicePress(st, p('DOWN', live + 10));
    expect(st.attempt.phase).toBe('running');
    expect(st.countdown).toBe(c);
    expect(st.attempt.held).toEqual(['DOWN']);
  });
});

// --- feedback text -----------------------------------------------------------

describe('direction feedback text', () => {
  const dir = (wanted: HeldPosition, held: HeldPosition, match: DirectionMatch) => ({ wanted, held, match });

  it('words the direction note per SPEC §7', () => {
    expect(directionNote(dir(6, 3, 'exact'))).toBe('Direction: ↘, wanted → exactly');
    expect(directionNote(dir(6, 4, 'exact'))).toBe('Direction: ←, wanted →');
    expect(directionNote(dir(3, 2, 'exact'))).toBe('Direction: ↓, wanted ↘');
    expect(directionNote(dir(2, 4, 'atLeast'))).toBe('Direction: ←, wanted any ↓');
    expect(directionNote(dir(5, 2, 'exact'))).toBe('Direction: ↓, wanted neutral');
    expect(directionNote(dir(6, 5, 'exact'))).toBe('Direction: none, wanted →');
    expect(directionNote(dir(2, 5, 'atLeast'))).toBe('Direction: none, wanted any ↓');
  });

  const mistake = (over: Partial<StepResult>): StepResult => ({
    stepIndex: 1,
    expected: ['MP'],
    grade: 'WRONG_BUTTON',
    deltaFrames: 0,
    deltaMs: 5.2,
    press: p('MP', 0),
    direction: { wanted: 6, held: 3, match: 'exact' },
    directionMistake: 'wrong',
    ...over,
  });

  it('puts the timing the press earned before the note', () => {
    const tol = { tolEarly: 1, tolLate: 1 };
    expect(describeStep(mistake({}), false, tol)).toBe('On time (+5.2 ms) · Direction: ↘, wanted → exactly');
    expect(describeStep(mistake({ deltaFrames: 1, deltaMs: 20 }), false, tol)).toBe(
      'On time, 1f late (+20.0 ms) · Direction: ↘, wanted → exactly',
    );
    expect(describeStep(mistake({ deltaFrames: 2, deltaMs: 36 }), false, tol)).toBe('2f late (+36.0 ms) · Direction: ↘, wanted → exactly');
    expect(
      describeStep(mistake({ grade: 'PARTIAL', directionMistake: 'missing', direction: { wanted: 6, held: 5, match: 'exact' } }), false, tol),
    ).toBe('On time (+5.2 ms) · Direction: none, wanted →');
  });

  it('a start step says Start, then the note', () => {
    const start = mistake({ stepIndex: 0, direction: { wanted: 2, held: 5, match: 'atLeast' }, directionMistake: 'missing', grade: 'PARTIAL' });
    expect(describeStep(start, true, { tolEarly: 0, tolLate: 0 })).toBe('Start · Direction: none, wanted any ↓');
  });

  it('a chord with a direction mistake keeps its split wording', () => {
    const c = combo([step(['HK'], { targetFrame: 0 }), step(['LP', 'LK'], { direction: 4 })]);
    let st = feedEngine(arm(createAttempt(c)), [
      ['press', 'HK', at(0)],
      ['press', 'LP', at(8)],
      ['press', 'LK', at(10)],
    ]);
    st = tick(st, at(11) + 1);
    const res = st.results[1]!;
    expect(res).toMatchObject({ grade: 'PARTIAL', directionMistake: 'missing' });
    expect(timingGrade(res, c.steps[1]!)).toBe('SPLIT');
    expect(describeStep(res, false, c.steps[1])).toBe('Split: LP 2f early, LK on time · Direction: none, wanted any ←');
  });

  it('writes steps in arrow notation', () => {
    expect(stepNotation(step(['MP'], { direction: 6 }))).toBe('→+MP');
    expect(stepNotation(step(['LP', 'LK'], { direction: 4, directionMatch: 'exact' }))).toBe('←+LP+LK');
    expect(stepNotation(step(['HP'], { directionMatch: 'exact' }))).toBe('HP (neutral)');
    expect(stepNotation(step(['HP'], { directionMatch: 'atLeast' }))).toBe('HP');
    expect(stepNotation(step(['MK'], { direction: 3 }))).toBe('↘+MK');
  });
});

// --- stats, sounds -------------------------------------------------------------

/** →+MP pressed on time with ← held (wrong), then with nothing held (missing), then clean. */
function threeAttempts() {
  const run = (held: ButtonId[], mpFrame: number) => {
    const st = feedEngine(arm(createAttempt(rightMp), held), [
      ['press', 'LK', at(0)],
      ['press', 'MP', at(mpFrame)],
      ['press', 'HK', at(mpFrame + 10)],
    ]);
    return attemptResult(st)!;
  };
  return [run(['LEFT'], 11), run([], 9), run(['RIGHT'], 10)];
}

describe('direction stats', () => {
  it('counts direction mistakes on their own and keeps their timing in average and spread', () => {
    const results = threeAttempts();
    expect(results[0]!.results[1]).toMatchObject({ grade: 'WRONG_BUTTON', directionMistake: 'wrong' });
    expect(results[1]!.results[1]).toMatchObject({ grade: 'PARTIAL', directionMistake: 'missing' });
    const stats = results.reduce(recordAttempt, emptyStats(3));
    const sum = summarizeStep(stats.steps[1]!);
    expect(sum.reached).toBe(3);
    expect(sum.onTime).toBe(1);
    expect(sum.counts).toMatchObject({ wrongDirection: 1, missingDirection: 1, WRONG_BUTTON: 0, PARTIAL: 0, ON_TIME: 1 });
    expect(stats.steps[1]!.deltas).toEqual([1, -1, 0]);
    expect(sum.meanDelta).toBe(0);
    expect(otherResultsText(sum.counts)).toBe('1 wrong direction · 1 missing direction');
    expect(stats.successes).toBe(1);
  });

  it('maps results to kinds', () => {
    const [wrong, missing, clean] = threeAttempts();
    expect(resultKind(wrong!.results[1]!)).toBe('wrongDirection');
    expect(resultKind(missing!.results[1]!)).toBe('missingDirection');
    expect(resultKind(clean!.results[1]!)).toBe('ON_TIME');
  });

  it('labels every other result', () => {
    const counts = { ...emptyStats(1).steps[0]!.counts, EARLY: 2, SPLIT: 1, WRONG_BUTTON: 1, MISSED: 3 };
    expect(otherResultsText(counts)).toBe('2 early · 1 split · 1 wrong · 3 missed');
    expect(otherResultsText(emptyStats(1).steps[0]!.counts)).toBe('—');
  });
});

describe('direction sounds', () => {
  it('a direction mistake plays the step-off sound and the attempt goes on', () => {
    let st = createPractice(rightMp, DEFAULT_SETTINGS, undefined, ['LEFT']);
    st = practicePress(st, p('LK', at(0)));
    const before = practicePress(st, p('MP', at(10)));
    // The check closes at the end of frame 10.
    const after = practiceTick(before, at(11) + 1);
    expect(after.attempt.results[1]).toMatchObject({ directionMistake: 'wrong' });
    expect(after.attempt.phase).toBe('running');
    expect(practiceCues(before, after)).toEqual(['off']);
  });

  it('a first-input start step with a direction mistake plays step off; a clean one is silent', () => {
    const c = combo([step(['LK'], { targetFrame: 0, direction: 2 }), step(['HK'])]);
    const startWith = (held: ButtonId[]) => {
      const before = practicePress(createPractice(c, DEFAULT_SETTINGS, undefined, held), p('LK', at(0)));
      return practiceCues(before, practiceTick(before, at(1) + 1));
    };
    expect(startWith([])).toEqual(['off']);
    expect(startWith(['DOWN'])).toEqual([]);
  });
});

// --- timeline -------------------------------------------------------------------

describe('direction timeline', () => {
  it('draws the stick lane from the position history, neutral left empty', () => {
    const st = feedEngine(arm(createAttempt(rightMp)), [
      ['press', 'LK', at(0)],
      ['press', 'DOWN', at(3)],
      ['press', 'RIGHT', at(5)],
      ['release', 'DOWN', at(7)],
      ['press', 'MP', at(10)],
      ['release', 'RIGHT', at(14)],
      ['press', 'HK', at(20)],
    ]);
    const tl = buildTimeline(st)!;
    expect(tl.stick).toEqual([
      { start: 3, end: 5, position: 2 },
      { start: 5, end: 7, position: 3 },
      { start: 7, end: 14, position: 6 },
    ]);
  });

  it('runs the last segment to the end of the ruler', () => {
    const st = feedEngine(arm(createAttempt(rightMp), ['RIGHT']), [
      ['press', 'LK', at(0)],
      ['press', 'MP', at(10)],
      ['press', 'HK', at(20)],
    ]);
    const tl = buildTimeline(st)!;
    expect(tl.stick).toEqual([{ start: 0, end: tl.endFrame, position: 6 }]);
  });

  it('tags dots of checked steps with the held position, flagging mistakes', () => {
    const st = feedEngine(arm(createAttempt(rightMp), ['LEFT']), [
      ['press', 'LK', at(0)],
      ['press', 'MP', at(10)],
      ['press', 'HK', at(20)],
    ]);
    const tl = buildTimeline(st)!;
    expect(tl.steps[0]!.direction).toBeUndefined(); // plain at-least step: no check
    expect(tl.steps[1]!.direction).toEqual({ held: 4, mistake: true });
    expect(tl.steps[2]!.direction).toBeUndefined();
  });

  it('tags a passed check without flagging it', () => {
    const st = feedEngine(arm(createAttempt(rightMp), ['RIGHT']), [
      ['press', 'LK', at(0)],
      ['press', 'MP', at(10)],
      ['press', 'HK', at(20)],
    ]);
    expect(buildTimeline(st)!.steps[1]!.direction).toEqual({ held: 6, mistake: false });
  });

  it('has no stick lane for a plain combo with nothing held, but has one if a direction was held', () => {
    const plain = combo([step(['LK'], { targetFrame: 0 }), step(['MP'])]);
    const none = feedEngine(arm(createAttempt(plain)), [
      ['press', 'LK', at(0)],
      ['press', 'MP', at(10)],
    ]);
    expect(buildTimeline(none)!.stick).toBeNull();
    const held = feedEngine(arm(createAttempt(plain)), [
      ['press', 'LK', at(0)],
      ['press', 'DOWN', at(4)],
      ['release', 'DOWN', at(6)],
      ['press', 'MP', at(10)],
    ]);
    expect(buildTimeline(held)!.stick).toEqual([{ start: 4, end: 6, position: 2 }]);
  });

  it('draws an empty stick lane for a direction combo with nothing held', () => {
    const st = feedEngine(arm(createAttempt(rightMp)), [
      ['press', 'LK', at(0)],
      ['press', 'MP', at(10)],
      ['press', 'HK', at(20)],
    ]);
    expect(buildTimeline(st)!.stick).toEqual([]);
  });

  it('an exact plain step counts as a direction step for the stick lane', () => {
    const c = combo([step(['LK'], { targetFrame: 0 }), step(['MP'], { directionMatch: 'exact' })]);
    const st = feedEngine(arm(createAttempt(c)), [
      ['press', 'LK', at(0)],
      ['press', 'MP', at(10)],
    ]);
    const tl = buildTimeline(tick(st, at(12)))!;
    expect(tl.stick).toEqual([]);
    expect(tl.steps[1]!.direction).toEqual({ held: 5, mistake: false });
  });
});
