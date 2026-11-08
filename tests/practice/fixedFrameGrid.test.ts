import { describe, expect, it } from 'vitest';
import { arm, createAttempt, press } from '../../src/engine/attempt';
import { settle } from '../engine/settle';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { Combo, PressEvent, Step } from '../../src/engine/types';
import { METRONOME_FRAME_POINT, PREVIEW_LEAD_MS, metronomeTicks, timingPreview } from '../../src/practice/cues';
import { COUNTDOWN_BEATS, COUNTDOWN_BEAT_MS, createPractice, practicePress, practiceTick } from '../../src/practice/session';
import { buildTimeline } from '../../src/practice/timeline';

// Practice side of the fixed frame grid (DECISIONS.md, "Fixed frame grid"): the metronome,
// Hear timing preview and timeline count relative steps from the frame the previous press landed
// on, the same as grading. Example from the proposal: LP at 0 ms, MP at 60 ms (frame 3, 10 ms in),
// gaps 3/3, so HP's on-time frame is 6.

const s = (button: string, targetFrame: number): Step => ({ buttons: [button], targetFrame, tolEarly: 0, tolLate: 0 });
const combo = (steps: Step[], opts: Partial<Omit<Combo, 'steps'>> = {}): Combo => ({
  name: 'fixed grid',
  steps,
  fps: 60,
  timingMode: 'relative',
  startMode: 'firstInput',
  ...opts,
});
const p = (button: string, timestamp: number): PressEvent => ({ button, timestamp, source: 'keyboard' });
const f = (frames: number) => frameToMs(frames, 60);
/** Middle of a frame, where a metronome tick or preview sound lands. */
const mid = (frame: number) => f(frame + METRONOME_FRAME_POINT);
const T0 = 1000;
const threeStep = combo([s('LP', 0), s('MP', 3), s('HP', 3)]);

describe('metronome on the fixed grid', () => {
  it('ticks HP in the middle of frame 6 when MP landed 10 ms into frame 3', () => {
    let st = createPractice(threeStep, DEFAULT_SETTINGS);
    st = practicePress(st, p('LP', T0));
    st = practicePress(st, p('MP', T0 + 60));
    st = practiceTick(st, T0 + f(4)); // MP's frame (3) closes
    expect(metronomeTicks(st.attempt).map((t) => t.at)).toEqual([T0 + mid(6)]);
  });
});

describe('Hear timing preview on the fixed grid', () => {
  const L = PREVIEW_LEAD_MS;

  it('places each relative step in the middle of its frame, with no half-frame drift', () => {
    expect(timingPreview(threeStep).map((x) => x.at)).toEqual([L, L + mid(3), L + mid(6)]);
  });

  it('countdown: step 2 is in the middle of frame 6 + 10 = 16', () => {
    const c = combo([s('HP', 6), s('LK', 10)], { startMode: 'countdown' });
    const go = L + COUNTDOWN_BEATS * COUNTDOWN_BEAT_MS;
    const presses = timingPreview(c).filter((x) => x.kind === 'press').map((x) => x.at);
    expect(presses).toEqual([go + mid(6), go + mid(16)]);
  });
});

describe('timeline on the fixed grid', () => {
  it('places HP\'s window on frame 6, lined up with the ruler', () => {
    let st = arm(createAttempt(threeStep, DEFAULT_SETTINGS));
    for (const ev of [p('LP', T0), p('MP', T0 + 60), p('HP', T0 + 105)]) st = press(st, ev);
    st = settle(st);
    const hp = buildTimeline(st)!.steps[2]!;
    expect(hp).toMatchObject({ windowStart: 6, windowEnd: 7, target: 6, grade: 'ON_TIME' });
  });
});
