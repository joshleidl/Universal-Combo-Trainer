// Gamepad API polling → timestamped press edges, plus polling-resolution measurement (SPEC §5).

import { frameMs } from '../engine/timing';
import {
  HAT_DIRECTIONS,
  decodeHat,
  gamepadAxisControl,
  gamepadControl,
  gamepadHatControl,
  mapGamepadAxis,
  mapGamepadButton,
  mapGamepadHat,
  type AxisDirection,
  type InputMapping,
} from './mapping';
import type { InputPress } from './types';

/** The parts of a Gamepad the tracker needs (a real Gamepad satisfies this). */
export interface GamepadLike {
  index: number;
  id: string;
  connected: boolean;
  mapping: string;
  timestamp: number;
  buttons: readonly { pressed: boolean }[];
  axes: readonly number[];
}

/** An axis direction becomes pressed at this deflection... */
export const AXIS_PRESS_THRESHOLD = 0.5;
/** ...and released below this one, so a value hovering near the threshold doesn't chatter. */
export const AXIS_RELEASE_THRESHOLD = 0.4;

const AXIS_DIRS: readonly [AxisDirection, number][] = [
  ['-', -1],
  ['+', 1],
];

/**
 * Held state per axis direction, indexed axis * 2 + (0 for "-", 1 for "+").
 * Hat axes are skipped (always false); they are decoded by hatHeld().
 */
function axisHeld(
  axes: readonly number[],
  prev: readonly boolean[] | undefined,
  isHat: (axis: number) => boolean,
): boolean[] {
  const held: boolean[] = [];
  axes.forEach((value, axis) => {
    AXIS_DIRS.forEach(([, sign], d) => {
      const i = axis * 2 + d;
      const threshold = prev?.[i] ? AXIS_RELEASE_THRESHOLD : AXIS_PRESS_THRESHOLD;
      held[i] = !isHat(axis) && sign * value >= threshold; // false for NaN
    });
  });
  return held;
}

/** Held hat directions, keyed like "9 up". */
function hatHeld(axes: readonly number[], hatAxes: readonly number[]): Set<string> {
  const held = new Set<string>();
  for (const axis of hatAxes) {
    const value = axes[axis];
    if (value === undefined) continue;
    for (const dir of decodeHat(value)) held.add(`${axis} ${dir}`);
  }
  return held;
}

export interface IntervalSummary {
  count: number;
  median: number;
  mean: number;
  min: number;
  max: number;
}

/** Rolling window of intervals. Intervals above `maxInterval` are idle gaps and are dropped. */
export class IntervalMeter {
  private readonly samples: number[] = [];

  constructor(
    private readonly size = 120,
    private readonly maxInterval = 250,
  ) {}

  add(intervalMs: number): void {
    if (!(intervalMs > 0) || intervalMs > this.maxInterval) return;
    this.samples.push(intervalMs);
    if (this.samples.length > this.size) this.samples.shift();
  }

  reset(): void {
    this.samples.length = 0;
  }

  summary(): IntervalSummary | null {
    const n = this.samples.length;
    if (n === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = Math.floor(n / 2);
    const median = n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    return {
      count: n,
      median,
      mean: sorted.reduce((a, b) => a + b, 0) / n,
      min: sorted[0]!,
      max: sorted[n - 1]!,
    };
  }
}

/** A changed Gamepad.timestamp is only trusted if it is in the past and at most this old. */
const MAX_TIMESTAMP_AGE_MS = 1000;

interface PadState {
  timestamp: number;
  pressed: boolean[];
  axes: boolean[];
  hats: Set<string>;
}

/**
 * Compares each poll with the previous one to find press edges. Buttons already held
 * the first time a pad is seen are treated as held, not pressed.
 */
export class GamepadTracker {
  /** Time between our polls. */
  readonly pollMeter = new IntervalMeter(120, 250);
  /**
   * Time between changes of Gamepad.timestamp. The timestamp only changes when the pad's
   * data changes, so with a digital-only device (arcade stick, hitbox) this mostly measures
   * how fast the player moves. Its minimum is an upper limit on the browser's read interval.
   */
  readonly updateMeter = new IntervalMeter(120, 100);

  private readonly pads = new Map<number, PadState>();
  private lastPoll: number | null = null;

  constructor(private mapping: InputMapping) {}

  setMapping(mapping: InputMapping): void {
    this.mapping = mapping;
  }

  poll(gamepads: readonly (GamepadLike | null)[], now: number): InputPress[] {
    if (this.lastPoll !== null) this.pollMeter.add(now - this.lastPoll);
    this.lastPoll = now;

    const presses: InputPress[] = [];
    const seen = new Set<number>();
    const hatAxes = Object.keys(this.mapping.gamepadHats).map(Number);
    const isHat = (axis: number) => hatAxes.includes(axis);

    for (const pad of gamepads) {
      if (!pad || !pad.connected) continue;
      seen.add(pad.index);
      const prev = this.pads.get(pad.index);
      const pressed = pad.buttons.map((b) => b.pressed);
      const axes = axisHeld(pad.axes, prev?.axes, isHat);
      const hats = hatHeld(pad.axes, hatAxes);
      this.pads.set(pad.index, { timestamp: pad.timestamp, pressed, axes, hats });
      if (!prev) continue;

      const changed = pad.timestamp !== prev.timestamp;
      const trusted = changed && isPlausibleTimestamp(pad.timestamp, now);
      if (trusted) this.updateMeter.add(pad.timestamp - prev.timestamp);

      const emit = (button: InputPress['button'], control: string) =>
        presses.push({
          source: 'gamepad',
          button,
          control,
          timestamp: trusted ? pad.timestamp : now,
          timestampSource: trusted ? 'gamepad' : 'poll',
          gamepadIndex: pad.index,
        });

      pressed.forEach((down, i) => {
        if (down && !prev.pressed[i]) emit(mapGamepadButton(this.mapping, i), gamepadControl(i));
      });
      axes.forEach((down, i) => {
        if (!down || prev.axes[i]) return;
        const axis = Math.floor(i / 2);
        const dir = AXIS_DIRS[i % 2]![0];
        emit(mapGamepadAxis(this.mapping, axis, dir), gamepadAxisControl(axis, dir));
      });
      for (const axis of hatAxes) {
        for (const dir of HAT_DIRECTIONS) {
          const key = `${axis} ${dir}`;
          if (hats.has(key) && !prev.hats.has(key)) {
            emit(mapGamepadHat(this.mapping, axis, dir), gamepadHatControl(axis, dir));
          }
        }
      }
    }

    for (const index of this.pads.keys()) {
      if (!seen.has(index)) this.pads.delete(index);
    }
    return presses;
  }

  /** Clear measurements and the previous-poll time (e.g. after changing poll mode). */
  resetStats(): void {
    this.pollMeter.reset();
    this.updateMeter.reset();
    this.lastPoll = null;
  }

  /**
   * Timestamp resolution: the median poll interval. Null until there is data.
   * The browser's own read rate can't be measured reliably (see updateMeter), so it isn't included.
   */
  resolutionMs(): number | null {
    return this.pollMeter.summary()?.median ?? null;
  }
}

function isPlausibleTimestamp(ts: number, now: number): boolean {
  return ts > 0 && ts <= now + 1 && now - ts <= MAX_TIMESTAMP_AGE_MS;
}

/**
 * Warn when resolution is about one target frame or coarser. The 0.9 factor catches
 * the common 60 Hz display + 60 fps case, where intervals jitter around exactly one frame.
 */
export const RESOLUTION_WARNING_FACTOR = 0.9;

export function isResolutionTooCoarse(resolutionMs: number, fps: number): boolean {
  return resolutionMs >= frameMs(fps) * RESOLUTION_WARNING_FACTOR;
}

// --- polling loop ---------------------------------------------------------------

export type PollMode =
  /** Timer every `ms` while the page has focus; animation frames otherwise (SPEC §5). */
  | { kind: 'auto'; ms: number }
  | { kind: 'raf' }
  | { kind: 'interval'; ms: number };

export const DEFAULT_POLL_MODE: PollMode = { kind: 'auto', ms: 4 };

/** The loop actually running right now. */
export type ActivePoll = { kind: 'raf' } | { kind: 'interval'; ms: number };

/** Browser hooks, injectable for tests. */
export interface PollerDeps {
  getGamepads: () => readonly (GamepadLike | null)[];
  now: () => number;
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
  setInterval: (cb: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  hasFocus: () => boolean;
  /** Calls `cb` with the new focus state on change. Returns an unsubscribe function. */
  onFocusChange: (cb: (focused: boolean) => void) => () => void;
}

export function browserPollerDeps(): PollerDeps {
  return {
    getGamepads: () => (navigator.getGamepads ? navigator.getGamepads() : []),
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    setInterval: (cb, ms) => window.setInterval(cb, ms),
    clearInterval: (id) => window.clearInterval(id),
    hasFocus: () => document.hasFocus(),
    onFocusChange: (cb) => {
      const onFocus = () => cb(true);
      const onBlur = () => cb(false);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      return () => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
      };
    },
  };
}

export interface PollerOptions {
  tracker: GamepadTracker;
  mode: PollMode;
  onPress: (press: InputPress) => void;
  deps?: PollerDeps;
}

export interface PollerHandle {
  /** The loop in use right now (auto mode switches between the two). */
  active(): ActivePoll;
  stop(): void;
}

/** Polls gamepads in the given mode (default: auto). */
export function startGamepadPolling(options: PollerOptions): PollerHandle {
  const deps = options.deps ?? browserPollerDeps();
  const pollOnce = () => {
    for (const press of options.tracker.poll(deps.getGamepads(), deps.now())) options.onPress(press);
  };

  const run = (loop: ActivePoll): (() => void) => {
    if (loop.kind === 'interval') {
      const id = deps.setInterval(pollOnce, loop.ms);
      return () => deps.clearInterval(id);
    }
    let frame = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      pollOnce();
      frame = deps.requestFrame(tick);
    };
    frame = deps.requestFrame(tick);
    return () => {
      running = false;
      deps.cancelFrame(frame);
    };
  };

  const mode = options.mode;
  if (mode.kind !== 'auto') {
    const stop = run(mode);
    return { active: () => mode, stop };
  }

  const focusedLoop: ActivePoll = { kind: 'interval', ms: mode.ms };
  const unfocusedLoop: ActivePoll = { kind: 'raf' };
  let current = deps.hasFocus() ? focusedLoop : unfocusedLoop;
  let stopCurrent = run(current);

  const unsubscribe = deps.onFocusChange((focused) => {
    const next = focused ? focusedLoop : unfocusedLoop;
    if (next === current) return;
    stopCurrent();
    options.tracker.resetStats();
    current = next;
    stopCurrent = run(current);
  });

  return {
    active: () => current,
    stop() {
      unsubscribe();
      stopCurrent();
    },
  };
}
