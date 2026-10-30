import { describe, expect, it } from 'vitest';
import {
  CAL_BEATS,
  CAL_BEAT_MS,
  CAL_COUNT_IN,
  CAL_LEAD_MS,
  CAL_MATCH_MS,
  CAL_MIN_TAPS,
  CAL_TOTAL_BEATS,
  beatTime,
  beatTimes,
  calibrationFinished,
  calibrationPhase,
  calibrationResults,
  calibrationTap,
  createCalibration,
  median,
  type CalibrationState,
} from '../../src/calibration/calibration';

const T0 = 10_000;
const fresh = () => createCalibration(T0);
/** Taps on recorded beats `from`..`to` (0-based among recorded beats) with the given offsets. */
function tapAll(st: CalibrationState, source: 'keyboard' | 'gamepad', offsets: number[], from = 0): CalibrationState {
  return offsets.reduce((s, off, i) => calibrationTap(s, source, beatTime(s, CAL_COUNT_IN + from + i) + off), st);
}

describe('calibration beats', () => {
  it('starts after the lead-in with evenly spaced beats', () => {
    const st = fresh();
    expect(st.startAt).toBe(T0 + CAL_LEAD_MS);
    const times = beatTimes(st);
    expect(times).toHaveLength(CAL_COUNT_IN + CAL_BEATS);
    expect(times[1]! - times[0]!).toBe(CAL_BEAT_MS);
  });

  it('reports waiting, count-in, recording and finished', () => {
    const st = fresh();
    expect(calibrationPhase(st, T0)).toEqual({ kind: 'waiting' });
    expect(calibrationPhase(st, beatTime(st, 0))).toEqual({ kind: 'countIn', left: CAL_COUNT_IN });
    expect(calibrationPhase(st, beatTime(st, CAL_COUNT_IN - 1))).toEqual({ kind: 'countIn', left: 1 });
    expect(calibrationPhase(st, beatTime(st, CAL_COUNT_IN))).toEqual({ kind: 'recording', beat: 1 });
    const last = beatTime(st, CAL_TOTAL_BEATS - 1);
    expect(calibrationPhase(st, last)).toEqual({ kind: 'recording', beat: CAL_BEATS });
    expect(calibrationFinished(st, last + CAL_MATCH_MS - 1)).toBe(false);
    expect(calibrationFinished(st, last + CAL_MATCH_MS)).toBe(true);
    expect(calibrationPhase(st, last + CAL_MATCH_MS)).toEqual({ kind: 'finished' });
  });
});

describe('calibration taps', () => {
  it('records the offset from the nearest beat', () => {
    let st = fresh();
    st = calibrationTap(st, 'keyboard', beatTime(st, CAL_COUNT_IN) + 30);
    st = calibrationTap(st, 'keyboard', beatTime(st, CAL_COUNT_IN + 1) - 12);
    expect(st.taps).toEqual([
      { beat: CAL_COUNT_IN, source: 'keyboard', offsetMs: 30 },
      { beat: CAL_COUNT_IN + 1, source: 'keyboard', offsetMs: -12 },
    ]);
  });

  it('ignores count-in taps, taps after the last beat, and repeat taps on a beat', () => {
    let st = fresh();
    st = calibrationTap(st, 'keyboard', beatTime(st, CAL_COUNT_IN - 1) + 10);
    st = calibrationTap(st, 'keyboard', beatTime(st, CAL_TOTAL_BEATS) - 10);
    expect(st.taps).toEqual([]);
    st = calibrationTap(st, 'keyboard', beatTime(st, CAL_COUNT_IN) + 10);
    const once = st;
    st = calibrationTap(st, 'keyboard', beatTime(st, CAL_COUNT_IN) + 40);
    expect(st).toBe(once);
  });

  it('a tap exactly half a beat away matches nothing', () => {
    const st = fresh();
    // Halfway between recorded beats 0 and 1 rounds up to beat 1, at −CAL_MATCH_MS: rejected.
    expect(calibrationTap(st, 'keyboard', beatTime(st, CAL_COUNT_IN) + CAL_MATCH_MS)).toBe(st);
  });

  it('keeps keyboard and gamepad taps apart, even on the same beat', () => {
    let st = fresh();
    const b = beatTime(st, CAL_COUNT_IN);
    st = calibrationTap(st, 'keyboard', b + 10);
    st = calibrationTap(st, 'gamepad', b + 25);
    expect(st.taps.map((t) => t.source)).toEqual(['keyboard', 'gamepad']);
  });
});

describe('calibration results', () => {
  it('uses the median, so a stray tap does not drag it', () => {
    // One stray tap (−101 ms) among steady ones around +20 ms.
    const offsets = [20, 22, 18, 21, 19, 20, 23, 17, 20, -101, 21];
    const st = tapAll(fresh(), 'keyboard', offsets);
    const [r] = calibrationResults(st);
    expect(r?.source).toBe('keyboard');
    expect(r?.count).toBe(offsets.length);
    expect(r?.medianMs).toBe(20);
    expect(r?.usable).toBe(true);
    expect(r?.spreadMs).toBeGreaterThan(30);
  });

  it(`needs ${CAL_MIN_TAPS} taps for a usable result`, () => {
    const short = calibrationResults(tapAll(fresh(), 'gamepad', Array(CAL_MIN_TAPS - 1).fill(30)));
    expect(short).toEqual([{ source: 'gamepad', count: CAL_MIN_TAPS - 1, medianMs: 30, spreadMs: 0, usable: false }]);
    const enough = calibrationResults(tapAll(fresh(), 'gamepad', Array(CAL_MIN_TAPS).fill(30)));
    expect(enough[0]?.usable).toBe(true);
  });

  it('reports each source that tapped, keyboard first, and nothing with no taps', () => {
    expect(calibrationResults(fresh())).toEqual([]);
    let st = tapAll(fresh(), 'gamepad', [40, 42]);
    st = tapAll(st, 'keyboard', [5, 7], 5);
    expect(calibrationResults(st).map((r) => [r.source, r.medianMs])).toEqual([
      ['keyboard', 6],
      ['gamepad', 41],
    ]);
  });

  it('median handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
