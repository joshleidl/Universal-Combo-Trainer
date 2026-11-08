// Shared test helper for frame-based grading (SPEC §3, "Frames").

import { tick, type AttemptState } from '../../src/engine/attempt';
import { frameToMs } from '../../src/engine/timing';

/**
 * Closes the open frame at its end (plus the largest latency offset), the moment it would close
 * anyway. A step's result comes when its frame closes, so tests call this to see it.
 */
export function settle(st: AttemptState): AttemptState {
  const end = openFrameEnd(st);
  return end === null ? st : tick(st, end);
}

/** When the open frame closes (raw time, with the largest latency offset), or null if none is open. */
export function openFrameEnd(st: AttemptState): number | null {
  const { origin, open, fps } = st.frames;
  if (origin === null || !open) return null;
  return origin + frameToMs(open.frame + 1, fps) + Math.max(...Object.values(st.settings.latencyOffsetMs));
}
