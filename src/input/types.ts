// Common press shape emitted by every input source (SPEC §4–5).

import type { ButtonId, InputSource } from '../engine/types';

/** Where a press timestamp came from. */
export type TimestampSource =
  /** KeyboardEvent.timeStamp */
  | 'event'
  /** Gamepad.timestamp, which changed since the previous poll */
  | 'gamepad'
  /** performance.now() at poll time (fallback) */
  | 'poll';

export interface InputPress {
  source: InputSource;
  /** Mapped button, or null when the control isn't mapped. */
  button: ButtonId | null;
  /** Raw control: KeyboardEvent.code (e.g. "KeyU"), or "Button 2" / "Axis 0-" / "Hat 9 up" for a gamepad. */
  control: string;
  /** Milliseconds in the performance.now() clock. */
  timestamp: number;
  timestampSource: TimestampSource;
  /** Which gamepad, for gamepad presses. */
  gamepadIndex?: number;
}
