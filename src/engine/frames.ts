// Frame layer (SPEC §3 "Frames", §4 "Engine API: frames"): groups inputs by the grid frame they
// land on and turns each closed frame into a frame record. Pure; knows nothing about steps or
// attempts. Timestamps are latency-corrected by the caller.

import { isDirection, resolvePosition } from './direction';
import { msToFrame } from './timing';
import type { ButtonId, HeldPosition, PressEvent, ReleaseEvent } from './types';

/** One press or release on a frame, in arrival order. */
export interface FrameEvent {
  readonly button: ButtonId;
  readonly down: boolean;
  /** The raw event (raw timestamp and source). */
  readonly ev: PressEvent | ReleaseEvent;
  /** Corrected timestamp. */
  readonly t: number;
}

/** A button pressed on a frame: its last down event on that frame. */
export interface FramePress {
  readonly button: ButtonId;
  readonly ev: PressEvent;
  /** Corrected timestamp of the last down event. */
  readonly t: number;
}

export type OppositePair = 'LEFT_RIGHT' | 'UP_DOWN';

export interface FrameRecord {
  /** Grid frame (frames since the origin; negative before it). */
  readonly frame: number;
  readonly events: readonly FrameEvent[];
  /**
   * Buttons and directions pressed on the frame by the press rule: a down event, and not held
   * at the end of the frame before. One per button, in order of each button's first down event.
   */
  readonly presses: readonly FramePress[];
  /** Everything held at the frame's end (buttons and directions). */
  readonly held: readonly ButtonId[];
  /** The stick position the held directions resolve to (SOCD neutral). */
  readonly position: HeldPosition;
  /** Buttons held at the end of the frame before, released and pressed again on this one. */
  readonly lostRepresses: readonly FramePress[];
  /** Directions pressed on the frame and not held at its end. */
  readonly directionTaps: readonly ButtonId[];
  /** Opposite directions both held at the frame's end. */
  readonly opposites: readonly OppositePair[];
}

interface OpenFrame {
  readonly frame: number;
  readonly events: readonly FrameEvent[];
  /** The held set at the end of the frame before (just before this frame's first input). */
  readonly heldBefore: readonly ButtonId[];
}

export interface FrameBuffer {
  readonly fps: number;
  /** Corrected time of frame 0, or null before there is a grid. */
  readonly origin: number | null;
  /** The frame taking inputs now, or null when no input has landed since the last close. */
  readonly open: OpenFrame | null;
  /** The last closed frame, or null when none has closed since the origin was set. */
  readonly lastClosed: number | null;
  /** Held right now (buttons and directions, in press order). */
  readonly held: readonly ButtonId[];
}

/** A buffer with no grid yet, holding `held`. */
export function createFrames(fps: number, held: readonly ButtonId[] = []): FrameBuffer {
  return { fps, origin: null, open: null, lastClosed: null, held: held.filter((b, i) => held.indexOf(b) === i) };
}

/** Starts a fresh grid with frame 0 at corrected time `frame0`. The held set is kept. */
export function setOrigin(buf: FrameBuffer, frame0: number): FrameBuffer {
  return { ...buf, origin: frame0, open: null, lastClosed: null };
}

/** Drops the grid (e.g. a first-input step 1 ignored in non-strict mode). The held set is kept. */
export function clearOrigin(buf: FrameBuffer): FrameBuffer {
  return { ...buf, origin: null, open: null, lastClosed: null };
}

/** The last closed frame, or null. Frames with no inputs close too; they just have no record. */
export function lastClosedFrame(buf: FrameBuffer): number | null {
  return buf.lastClosed;
}

/** The grid frame a corrected time lands on. Throws without an origin. */
export function frameOf(buf: FrameBuffer, t: number): number {
  if (buf.origin === null) throw new Error('No frame grid yet');
  return msToFrame(t - buf.origin, buf.fps);
}

export interface FrameStep {
  readonly buf: FrameBuffer;
  /** The record of the frame this call closed, if any. */
  readonly closed: FrameRecord | null;
}

/**
 * One press (`down`) or release at corrected time `t`. With no grid it only changes the held
 * set. Otherwise it closes the open frame first if `t` is past it. An input whose time falls on
 * an already closed frame counts on the first frame not yet closed.
 */
export function addInput(buf: FrameBuffer, ev: PressEvent | ReleaseEvent, t: number, down: boolean): FrameStep {
  const held = withHeld(buf.held, ev.button, down);
  if (buf.origin === null) return { buf: { ...buf, held }, closed: null };
  const frame = Math.max(frameOf(buf, t), buf.lastClosed === null ? -Infinity : buf.lastClosed + 1);
  const { buf: before, closed } = closeBefore(buf, frame);
  const event: FrameEvent = { button: ev.button, down, ev, t };
  const open: OpenFrame = before.open
    ? { ...before.open, events: [...before.open.events, event] }
    : { frame, events: [event], heldBefore: before.held };
  return { buf: { ...before, open, held }, closed };
}

/**
 * Moves time to the start of `frame`: closes the open frame if it is before `frame`, and counts
 * every frame before `frame` as closed.
 */
export function closeBefore(buf: FrameBuffer, frame: number): FrameStep {
  if (buf.origin === null) return { buf, closed: null };
  const lastClosed = Math.max(buf.lastClosed ?? -Infinity, frame - 1);
  if (buf.open && buf.open.frame < frame) {
    return { buf: { ...buf, open: null, lastClosed }, closed: recordOf(buf.open) };
  }
  if (buf.open) return { buf, closed: null };
  return { buf: lastClosed === buf.lastClosed ? buf : { ...buf, lastClosed }, closed: null };
}

function withHeld(held: readonly ButtonId[], button: ButtonId, down: boolean): readonly ButtonId[] {
  if (down === held.includes(button)) return held;
  return down ? [...held, button] : held.filter((b) => b !== button);
}

/** Builds a closed frame's record from its inputs (SPEC §3 "Frames": press rule and reports). */
function recordOf(open: OpenFrame): FrameRecord {
  const heldBefore = open.heldBefore;
  let held = heldBefore;
  const presses = new Map<ButtonId, FramePress>();
  const lost = new Map<ButtonId, FramePress>();
  const releasedHere = new Set<ButtonId>();
  for (const e of open.events) {
    if (e.down) {
      const p: FramePress = { button: e.button, ev: e.ev, t: e.t };
      // Not held at the end of the frame before: a press (its last down event counts).
      if (!heldBefore.includes(e.button)) presses.set(e.button, p);
      // Held before and released on this frame first: a lost re-press.
      else if (releasedHere.has(e.button)) lost.set(e.button, p);
    } else {
      releasedHere.add(e.button);
    }
    held = withHeld(held, e.button, e.down);
  }
  const pressList = [...presses.values()];
  const opposites: OppositePair[] = [];
  if (held.includes('LEFT') && held.includes('RIGHT')) opposites.push('LEFT_RIGHT');
  if (held.includes('UP') && held.includes('DOWN')) opposites.push('UP_DOWN');
  return {
    frame: open.frame,
    events: open.events,
    presses: pressList,
    held,
    position: resolvePosition(held),
    lostRepresses: [...lost.values()],
    directionTaps: pressList.filter((p) => isDirection(p.button) && !held.includes(p.button)).map((p) => p.button),
    opposites,
  };
}
