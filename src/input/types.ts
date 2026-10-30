// Common input event shape emitted by every input source (SPEC §4–5).

import type { ButtonId, InputSource } from '../engine/types';

/** Where an event timestamp came from. */
export type TimestampSource =
  /** KeyboardEvent.timeStamp */
  | 'event'
  /** Gamepad.timestamp, which changed since the previous poll */
  | 'gamepad'
  /** performance.now() at poll time (fallback) */
  | 'poll';

/** Press = control goes from up to down; release = down to up. Only presses are graded. */
export type InputEdge = 'press' | 'release';

interface InputEventBase {
  edge: InputEdge;
  source: InputSource;
  /** Mapped button, or null when the control isn't mapped. */
  button: ButtonId | null;
  /** Raw control: KeyboardEvent.code (e.g. "KeyU"), or "Button 2" / "Axis 0-" / "Hat 9 up" for a gamepad. */
  control: string;
  /** Milliseconds in the performance.now() clock. */
  timestamp: number;
  timestampSource: TimestampSource;
  /** Which gamepad, for gamepad events. */
  gamepadIndex?: number;
}

export type InputPress = InputEventBase & { edge: 'press' };
export type InputRelease = InputEventBase & { edge: 'release' };
export type InputEvent = InputPress | InputRelease;
