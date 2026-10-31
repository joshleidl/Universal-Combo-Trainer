import { describe, expect, it } from 'vitest';
import { arm, attemptResult, createAttempt, press } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS } from '../../src/engine/timing';
import type { Combo, Grade } from '../../src/engine/types';

// User-supplied table. The first press (A = LP) is always at t = 0 ms, the start of frame 0.
// Frame k spans [k × 1000/60, (k+1) × 1000/60) ms at 60 FPS, the same frame length the engine
// uses. Each row gives the time of the second press (B = MP). Values and expected grades are
// the user's; do not edit.

interface Row {
  row: number;
  bMs: number;
  gap: number;
  tolEarly: number;
  tolLate: number;
  expected: Grade;
  note: string;
}

const rows: Row[] = [
  { row: 1, bMs: 50.5, gap: 3, tolEarly: 0, tolLate: 0, expected: 'ON_TIME', note: 'Frame perfect case' },
  { row: 2, bMs: 66.8, gap: 3, tolEarly: 0, tolLate: 1, expected: 'ON_TIME', note: 'Acceptable one frame late' },
  { row: 3, bMs: 33.4, gap: 3, tolEarly: 1, tolLate: 0, expected: 'ON_TIME', note: 'Acceptable one frame early' },
  { row: 4, bMs: 66.8, gap: 3, tolEarly: 0, tolLate: 0, expected: 'LATE', note: 'Missed window, late' },
  { row: 5, bMs: 33.4, gap: 3, tolEarly: 0, tolLate: 0, expected: 'EARLY', note: 'Missed window, early' },
  { row: 6, bMs: 3 * (1000 / 60), gap: 3, tolEarly: 0, tolLate: 0, expected: 'ON_TIME', note: 'See if frame boundaries are sensitive' },
  { row: 7, bMs: 55, gap: 3, tolEarly: 0, tolLate: 0, expected: 'ON_TIME', note: 'See if frame detection is phase sensitive' },
  { row: 8, bMs: 65, gap: 3, tolEarly: 0, tolLate: 0, expected: 'ON_TIME', note: 'Extreme case, second input at very end of frame window' },
];

describe('frame gap table (relative mode, first press at t = 0)', () => {
  for (const r of rows) {
    it(`row ${r.row}: B=${r.bMs}ms gap=${r.gap} tol=${r.tolEarly}/${r.tolLate} → ${r.expected} (${r.note})`, () => {
      const combo: Combo = {
        name: `row ${r.row}`,
        steps: [
          { button: 'LP', targetFrame: 0, tolEarly: 0, tolLate: 0 },
          { button: 'MP', targetFrame: r.gap, tolEarly: r.tolEarly, tolLate: r.tolLate },
        ],
        fps: 60,
        timingMode: 'relative',
        startMode: 'firstInput',
      };
      let st = arm(createAttempt(combo, DEFAULT_SETTINGS));
      st = press(st, { button: 'LP', timestamp: 0, source: 'keyboard' });
      st = press(st, { button: 'MP', timestamp: r.bMs, source: 'keyboard' });

      const step2 = attemptResult(st)?.results[1];
      expect(step2?.grade).toBe(r.expected);
    });
  }
});
