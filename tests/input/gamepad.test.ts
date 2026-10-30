import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLL_MODE,
  GamepadTracker,
  IntervalMeter,
  isResolutionTooCoarse,
  startGamepadPolling,
  type GamepadLike,
  type PollerDeps,
} from '../../src/input/gamepad';
import { DEFAULT_MAPPING, removeGamepadHat } from '../../src/input/mapping';
import type { InputPress } from '../../src/input/types';

/** A pad with 17 buttons and 4 axes; `held` lists pressed button indices. */
function pad(timestamp: number, held: number[] = [], index = 0, axes: number[] = [0, 0, 0, 0]): GamepadLike {
  return {
    index,
    id: 'Test pad',
    connected: true,
    mapping: 'standard',
    timestamp,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i) })),
    axes,
  };
}

/** Same pad, only axes differ. */
const stick = (timestamp: number, axes: number[]) => pad(timestamp, [], 0, axes);

describe('GamepadTracker axes', () => {
  it('turns left-stick directions into mapped presses', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([stick(1, [0, 0])], 2);
    expect(t.poll([stick(5, [-1, 0])], 6)).toEqual([
      {
        source: 'gamepad',
        button: 'LEFT',
        control: 'Axis 0-',
        timestamp: 5,
        timestampSource: 'gamepad',
        gamepadIndex: 0,
      },
    ]);
    expect(t.poll([stick(9, [0, 1])], 10).map((p) => p.button)).toEqual(['DOWN']);
    expect(t.poll([stick(13, [1, -1])], 14).map((p) => p.button)).toEqual(['RIGHT', 'UP']);
  });

  it('ignores holds and reports a diagonal as two presses', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([stick(1, [0, 0])], 2);
    expect(t.poll([stick(5, [-1, 1])], 6).map((p) => p.button)).toEqual(['LEFT', 'DOWN']);
    expect(t.poll([stick(9, [-1, 1])], 10)).toHaveLength(0);
    // Down-left → left: DOWN releases, LEFT stays held, no new press.
    expect(t.poll([stick(13, [-1, 0])], 14)).toHaveLength(0);
    // Back to down-left: DOWN presses again.
    expect(t.poll([stick(17, [-1, 1])], 18).map((p) => p.button)).toEqual(['DOWN']);
  });

  it('uses hysteresis so values near the threshold do not chatter', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([stick(1, [0, 0])], 2);
    expect(t.poll([stick(2, [-0.49, 0])], 3)).toHaveLength(0); // below press threshold
    expect(t.poll([stick(3, [-0.5, 0])], 4)).toHaveLength(1); // pressed
    expect(t.poll([stick(4, [-0.45, 0])], 5)).toHaveLength(0); // still held above release
    expect(t.poll([stick(5, [-0.52, 0])], 6)).toHaveLength(0);
    expect(t.poll([stick(6, [-0.39, 0])], 7)).toHaveLength(0); // released
    expect(t.poll([stick(7, [-0.5, 0])], 8)).toHaveLength(1); // pressed again
  });

  it('reports unmapped axes so the debug page can show them', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([stick(1, [0, 0, 0, 0, 0])], 2);
    expect(t.poll([stick(5, [0, 0, 0, 0, 1])], 6)[0]).toMatchObject({ button: null, control: 'Axis 4+' });
  });

  it('treats axes already deflected on first sight as held (e.g. a trigger resting at -1)', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    expect(t.poll([stick(1, [0, 0, 0, 0, -1])], 2)).toHaveLength(0);
    expect(t.poll([stick(5, [0, 0, 0, 0, -1])], 6)).toHaveLength(0);
    expect(t.poll([stick(9, [0, 0, 0, 0, 1])], 10).map((p) => p.control)).toEqual(['Axis 4+']);
  });

  it('ignores NaN axis values', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([stick(1, [0, 0])], 2);
    expect(t.poll([stick(5, [Number.NaN, 0])], 6)).toHaveLength(0);
  });
});

describe('GamepadTracker hat switch', () => {
  const NEUTRAL = 3.29;
  /** 10 axes with the hat on axis 9. */
  const hat = (timestamp: number, value: number) =>
    stick(timestamp, [0, 0, 0, 0, 0, 0, 0, 0, 0, value]);

  it('turns hat directions into mapped presses', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([hat(1, NEUTRAL)], 2);
    expect(t.poll([hat(5, -1)], 6)).toEqual([
      {
        source: 'gamepad',
        button: 'UP',
        control: 'Hat 9 up',
        timestamp: 5,
        timestampSource: 'gamepad',
        gamepadIndex: 0,
      },
    ]);
  });

  it('reports a diagonal as two presses and ignores holds', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([hat(1, NEUTRAL)], 2);
    expect(t.poll([hat(5, -0.14)], 6).map((p) => p.button)).toEqual(['DOWN', 'RIGHT']); // numpad 3
    expect(t.poll([hat(9, -0.14)], 10)).toHaveLength(0);
    expect(t.poll([hat(13, 0.14)], 14)).toHaveLength(0); // 3 → 2: DOWN still held
    expect(t.poll([hat(17, 0.43)], 18).map((p) => p.button)).toEqual(['LEFT']); // 2 → 1
  });

  it('a quarter-circle forward (2, 3, 6) presses DOWN, RIGHT, then nothing new', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([hat(1, NEUTRAL)], 2);
    const seq = [0.14, -0.14, -0.43].map((v, i) => t.poll([hat(5 + i * 4, v)], 6 + i * 4));
    expect(seq.map((ps) => ps.map((p) => p.button))).toEqual([['DOWN'], ['RIGHT'], []]);
  });

  it('does not also report the hat axis as a plain axis', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([hat(1, NEUTRAL)], 2);
    const presses = [-1, NEUTRAL, 1, NEUTRAL].flatMap((v, i) => t.poll([hat(5 + i * 4, v)], 6 + i * 4));
    expect(presses.every((p) => p.control.startsWith('Hat'))).toBe(true);
  });

  it('treats a hat held on first sight as held', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    expect(t.poll([hat(1, -1)], 2)).toHaveLength(0);
    expect(t.poll([hat(5, -1)], 6)).toHaveLength(0);
  });

  it('reads the axis as a plain axis again once the hat is removed', () => {
    const t = new GamepadTracker(removeGamepadHat(DEFAULT_MAPPING, 9));
    t.poll([hat(1, 0)], 2);
    expect(t.poll([hat(5, -1)], 6).map((p) => p.control)).toEqual(['Axis 9-']);
  });

  it('ignores pads without that axis', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([stick(1, [0, 0])], 2);
    expect(t.poll([stick(5, [0, 0])], 6)).toHaveLength(0);
  });
});

describe('GamepadTracker press edges', () => {
  it('emits a press when a button goes from up to down', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([pad(100)], 100);
    const presses = t.poll([pad(110, [2])], 116);
    expect(presses).toEqual([
      {
        source: 'gamepad',
        button: 'LP',
        control: 'Button 2',
        timestamp: 110,
        timestampSource: 'gamepad',
        gamepadIndex: 0,
      },
    ]);
  });

  it('ignores holds', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([pad(100)], 100);
    expect(t.poll([pad(110, [2])], 116)).toHaveLength(1);
    expect(t.poll([pad(120, [2])], 133)).toHaveLength(0);
    expect(t.poll([pad(130, [])], 150)).toHaveLength(0); // release
    expect(t.poll([pad(140, [2])], 166)).toHaveLength(1); // press again
  });

  it('treats buttons already down on first sight as held', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    expect(t.poll([pad(100, [2])], 100)).toHaveLength(0);
    expect(t.poll([pad(110, [2])], 116)).toHaveLength(0);
  });

  it('reports several buttons pressed in one poll', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([pad(100)], 100);
    const presses = t.poll([pad(110, [2, 0])], 116);
    expect(presses.map((p) => p.button).sort()).toEqual(['LK', 'LP']);
  });

  it('reports unmapped buttons with a null button', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([pad(100)], 100);
    expect(t.poll([pad(110, [9])], 116)[0]).toMatchObject({ button: null, control: 'Button 9' });
  });

  it('tracks pads independently', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([pad(100, [], 0), pad(100, [], 1)], 100);
    const presses = t.poll([pad(100, [], 0), pad(110, [3], 1)], 116);
    expect(presses).toHaveLength(1);
    expect(presses[0]).toMatchObject({ gamepadIndex: 1, button: 'MP' });
  });

  it('forgets a disconnected pad, so held buttons on reconnect are not presses', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([pad(100)], 100);
    t.poll([null], 116);
    expect(t.poll([pad(130, [2])], 133)).toHaveLength(0);
    const gone = { ...pad(140, [2]), connected: false };
    expect(t.poll([gone], 150)).toHaveLength(0);
  });
});

describe('GamepadTracker timestamps', () => {
  it('uses poll time when Gamepad.timestamp did not change', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([pad(100)], 100);
    expect(t.poll([pad(100, [2])], 116)[0]).toMatchObject({ timestamp: 116, timestampSource: 'poll' });
  });

  it('falls back to poll time for implausible timestamps', () => {
    const future = new GamepadTracker(DEFAULT_MAPPING);
    future.poll([pad(100)], 100);
    expect(future.poll([pad(5000, [2])], 116)[0]?.timestampSource).toBe('poll');

    const stale = new GamepadTracker(DEFAULT_MAPPING);
    stale.poll([pad(1)], 5000);
    expect(stale.poll([pad(2, [2])], 5016)[0]?.timestampSource).toBe('poll');

    const zero = new GamepadTracker(DEFAULT_MAPPING);
    zero.poll([pad(0)], 100);
    zero.poll([pad(0)], 110);
    expect(zero.poll([pad(-1, [2])], 116)[0]?.timestampSource).toBe('poll');
  });
});

describe('IntervalMeter', () => {
  it('summarizes intervals', () => {
    const m = new IntervalMeter();
    [10, 20, 30, 40].forEach((v) => m.add(v));
    expect(m.summary()).toEqual({ count: 4, median: 25, mean: 25, min: 10, max: 40 });
  });

  it('is empty until data arrives, and after reset', () => {
    const m = new IntervalMeter();
    expect(m.summary()).toBeNull();
    m.add(5);
    m.reset();
    expect(m.summary()).toBeNull();
  });

  it('drops idle gaps and non-positive intervals, and keeps a rolling window', () => {
    const m = new IntervalMeter(3, 100);
    [0, -1, 500, 1, 2, 3, 4].forEach((v) => m.add(v));
    expect(m.summary()).toMatchObject({ count: 3, min: 2, max: 4 });
  });
});

describe('polling measurement', () => {
  it('measures poll and browser update intervals', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    for (let i = 0; i < 10; i++) t.poll([pad(i * 4)], 1 + i * 16);
    expect(t.pollMeter.summary()?.median).toBe(16);
    // Timestamps 0, 4, 8, ... but sampled every 16 ms poll, so the gap seen between changes is 4.
    expect(t.updateMeter.summary()?.median).toBe(4);
    expect(t.resolutionMs()).toBe(16);
  });

  it('resolution is null before two polls', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    expect(t.resolutionMs()).toBeNull();
    t.poll([pad(1)], 1);
    expect(t.resolutionMs()).toBeNull();
  });

  it('resolution is the poll interval, not the time between input changes', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    // Poll every 4 ms; the pad's data only changes every 32 ms (e.g. a hand-moved lever).
    for (let i = 0; i < 40; i++) t.poll([pad(Math.floor(i / 8) * 32 + 1)], 2 + i * 4);
    expect(t.pollMeter.summary()?.median).toBe(4);
    expect(t.updateMeter.summary()?.median).toBe(32);
    expect(t.resolutionMs()).toBe(4);
  });

  it('resetStats() clears measurements', () => {
    const t = new GamepadTracker(DEFAULT_MAPPING);
    t.poll([pad(1)], 1);
    t.poll([pad(2)], 17);
    t.resetStats();
    expect(t.resolutionMs()).toBeNull();
  });
});

describe('isResolutionTooCoarse', () => {
  it('warns at about one frame or coarser', () => {
    expect(isResolutionTooCoarse(16.7, 60)).toBe(true);
    expect(isResolutionTooCoarse(16.5, 60)).toBe(true); // 60 Hz jitter
    expect(isResolutionTooCoarse(8.3, 60)).toBe(false);
    expect(isResolutionTooCoarse(8.3, 120)).toBe(true);
    expect(isResolutionTooCoarse(4, 120)).toBe(false);
    expect(isResolutionTooCoarse(16.7, 30)).toBe(false);
  });
});

describe('startGamepadPolling', () => {
  function fakeDeps(frames: GamepadLike[][], focused = true) {
    let frameCb: (() => void) | null = null;
    let intervalCb: (() => void) | null = null;
    let focusCb: ((f: boolean) => void) | null = null;
    let time = 0;
    let call = 0;
    const deps: PollerDeps = {
      hasFocus: () => focused,
      onFocusChange: (cb) => {
        focusCb = cb;
        return () => {
          focusCb = null;
        };
      },
      getGamepads: () => frames[Math.min(call++, frames.length - 1)]!,
      now: () => time,
      requestFrame: (cb) => {
        frameCb = cb;
        return 1;
      },
      cancelFrame: () => {
        frameCb = null;
      },
      setInterval: (cb) => {
        intervalCb = cb;
        return 2;
      },
      clearInterval: () => {
        intervalCb = null;
      },
    };
    const step = (dt: number) => {
      time += dt;
      const cb = frameCb ?? intervalCb;
      cb?.();
    };
    return {
      deps,
      step,
      active: () => frameCb !== null || intervalCb !== null,
      loops: () => ({ raf: frameCb !== null, interval: intervalCb !== null }),
      setFocus: (f: boolean) => focusCb?.(f),
      subscribed: () => focusCb !== null,
    };
  }

  it('defaults to auto mode with a 4 ms timer', () => {
    expect(DEFAULT_POLL_MODE).toEqual({ kind: 'auto', ms: 4 });
  });

  it('auto: uses the timer while focused and animation frames while not', () => {
    const fake = fakeDeps([[pad(1)]], true);
    const tracker = new GamepadTracker(DEFAULT_MAPPING);
    const handle = startGamepadPolling({ tracker, mode: DEFAULT_POLL_MODE, onPress: () => {}, deps: fake.deps });
    expect(handle.active()).toEqual({ kind: 'interval', ms: 4 });
    expect(fake.loops()).toEqual({ raf: false, interval: true });

    fake.step(4);
    fake.step(4);
    expect(tracker.pollMeter.summary()).not.toBeNull();

    fake.setFocus(false);
    expect(handle.active()).toEqual({ kind: 'raf' });
    expect(fake.loops()).toEqual({ raf: true, interval: false });
    expect(tracker.pollMeter.summary()).toBeNull(); // stats reset on switch

    fake.setFocus(true);
    expect(handle.active()).toEqual({ kind: 'interval', ms: 4 });
    expect(fake.loops()).toEqual({ raf: false, interval: true });

    handle.stop();
    expect(fake.active()).toBe(false);
    expect(fake.subscribed()).toBe(false);
  });

  it('auto: starts on animation frames when the page is not focused', () => {
    const fake = fakeDeps([[pad(1)]], false);
    const handle = startGamepadPolling({
      tracker: new GamepadTracker(DEFAULT_MAPPING),
      mode: DEFAULT_POLL_MODE,
      onPress: () => {},
      deps: fake.deps,
    });
    expect(handle.active()).toEqual({ kind: 'raf' });
    handle.stop();
  });

  it('auto: a repeated focus event does not restart the loop', () => {
    const fake = fakeDeps([[pad(1)]], true);
    const tracker = new GamepadTracker(DEFAULT_MAPPING);
    startGamepadPolling({ tracker, mode: DEFAULT_POLL_MODE, onPress: () => {}, deps: fake.deps });
    fake.step(4);
    fake.step(4);
    fake.setFocus(true);
    expect(tracker.pollMeter.summary()).not.toBeNull();
  });

  it.each([{ kind: 'raf' } as const, { kind: 'interval', ms: 4 } as const])(
    'polls in $kind mode and stops cleanly',
    (mode) => {
      const { deps, step, active } = fakeDeps([[pad(1)], [pad(1)], [pad(20, [2])]]);
      const presses: InputPress[] = [];
      const handle = startGamepadPolling({
        tracker: new GamepadTracker(DEFAULT_MAPPING),
        mode,
        onPress: (p) => presses.push(p),
        deps,
      });
      step(10);
      step(10);
      step(10);
      expect(presses.map((p) => p.button)).toEqual(['LP']);
      expect(handle.active()).toEqual(mode);
      handle.stop();
      expect(active()).toBe(false);
    },
  );
});
