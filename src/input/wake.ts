// "Wake up your controller" banner logic. Browsers hide gamepads from a page until a button is
// pressed on them, so the app can't tell "no pad plugged in" from "pad not woken yet". The banner
// asks for a press while no pad is detected, then briefly confirms once one appears. Pure.

/** How long the "detected" message stays before the banner hides. */
export const PAD_DETECTED_MS = 2500;

export type PadBanner =
  | { kind: 'hidden' }
  | { kind: 'waiting' }
  | { kind: 'detected'; name: string; until: number };

export const PAD_BANNER_START: PadBanner = { kind: 'hidden' };

/**
 * Next banner state.
 * - No pad: ask for a press (unless the user dismissed the banner).
 * - A pad appears while asking: show "detected" for PAD_DETECTED_MS, then hide.
 * - A pad that was already there (e.g. at page load) shows nothing.
 * `padIds` are the ids of the connected pads.
 */
export function nextPadBanner(state: PadBanner, padIds: readonly string[], now: number, dismissed: boolean): PadBanner {
  const first = padIds[0];
  if (first === undefined) {
    if (dismissed) return state.kind === 'hidden' ? state : PAD_BANNER_START;
    return state.kind === 'waiting' ? state : { kind: 'waiting' };
  }
  if (state.kind === 'waiting') return { kind: 'detected', name: padDisplayName(first), until: now + PAD_DETECTED_MS };
  if (state.kind === 'detected' && now >= state.until) return PAD_BANNER_START;
  return state;
}

/**
 * A readable name from a Gamepad.id. Chrome: "Qanba Obsidian (STANDARD GAMEPAD Vendor: 2c22
 * Product: 2000)"; Firefox: "2c22-2000-Qanba Obsidian". Falls back to the raw id.
 */
export function padDisplayName(id: string): string {
  const name = id
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '')
    .trim();
  return name || id.trim() || 'Controller';
}
