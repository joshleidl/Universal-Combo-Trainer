// Raw key / gamepad button → button ID. Pure and user-remappable (SPEC §5).

import type { ButtonId, PressEvent } from '../engine/types';
import type { InputEvent } from './types';

/** Six attack buttons, two extra (MISC1/MISC2) to cover all 8 buttons of a standard stick, and four directions. */
export const BUTTON_IDS = ['LP', 'MP', 'HP', 'MISC1', 'LK', 'MK', 'HK', 'MISC2', 'UP', 'DOWN', 'LEFT', 'RIGHT'] as const;

export interface InputMapping {
  /** KeyboardEvent.code → button. Uses physical key positions, so it works on any layout. */
  keyboard: Readonly<Record<string, ButtonId>>;
  /** Standard-mapping gamepad button index → button. */
  gamepad: Readonly<Record<number, ButtonId>>;
  /** Gamepad axis direction → button, keyed like "0-" (axis 0 pushed negative) or "1+". */
  gamepadAxes: Readonly<Record<string, ButtonId>>;
  /**
   * Axes decoded as 8-way hat switches, keyed by axis index. A hat axis is not also
   * read as a plain axis.
   */
  gamepadHats: Readonly<Record<number, HatMapping>>;
}

export type AxisDirection = '-' | '+';

export type HatDirection = 'up' | 'down' | 'left' | 'right';
export const HAT_DIRECTIONS: readonly HatDirection[] = ['up', 'down', 'left', 'right'];
/** Button per hat direction. A direction left out is unbound (still decoded, but unmapped). */
export type HatMapping = Readonly<Partial<Record<HatDirection, ButtonId>>>;

const DIRECTIONS_HAT: HatMapping = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' };

export const DEFAULT_MAPPING: InputMapping = {
  keyboard: {
    KeyU: 'LP',
    KeyI: 'MP',
    KeyO: 'HP',
    KeyP: 'MISC1',
    KeyJ: 'LK',
    KeyK: 'MK',
    KeyL: 'HK',
    Semicolon: 'MISC2',
    KeyW: 'UP',
    KeyA: 'LEFT',
    KeyS: 'DOWN',
    KeyD: 'RIGHT',
  },
  // 8-button stick layout: top row X / Y / RB / LB = LP / MP / HP / MISC1,
  // bottom row A / B / RT / LT = LK / MK / HK / MISC2, directions on the d-pad.
  gamepad: {
    2: 'LP',
    3: 'MP',
    5: 'HP',
    4: 'MISC1',
    0: 'LK',
    1: 'MK',
    7: 'HK',
    6: 'MISC2',
    12: 'UP',
    13: 'DOWN',
    14: 'LEFT',
    15: 'RIGHT',
  },
  // Left stick, which is also where fight sticks in "LS" mode report the lever.
  gamepadAxes: {
    '0-': 'LEFT',
    '0+': 'RIGHT',
    '1-': 'UP',
    '1+': 'DOWN',
  },
  // Axis 9 is where browsers commonly report a hat switch (seen on a Qanba Obsidian in Firefox).
  gamepadHats: {
    9: DIRECTIONS_HAT,
  },
};

/**
 * Hat steps in order of value: -1 (up) rising by 2/7 clockwise to 1 (up-left).
 * Diagonals are two directions.
 */
const HAT_STEPS: readonly (readonly HatDirection[])[] = [
  ['up'],
  ['up', 'right'],
  ['right'],
  ['down', 'right'],
  ['down'],
  ['down', 'left'],
  ['left'],
  ['up', 'left'],
];

/**
 * Decodes a hat-switch axis value to its held directions. Values outside −1…1
 * (by more than half a step) are neutral, e.g. 3.29 in Firefox or 1.29 in Chrome.
 */
export function decodeHat(value: number): readonly HatDirection[] {
  if (!Number.isFinite(value)) return [];
  const step = Math.round((value + 1) * 3.5); // 2/7 per step
  return HAT_STEPS[step] ?? [];
}

export function gamepadHatControl(axis: number, dir: HatDirection): string {
  return `Hat ${axis} ${dir}`;
}

export function mapGamepadHat(mapping: InputMapping, axis: number, dir: HatDirection): ButtonId | null {
  return mapping.gamepadHats[axis]?.[dir] ?? null;
}

/** Decode `axis` as a hat with the given directions (default: UP/DOWN/LEFT/RIGHT). */
export function setGamepadHat(
  mapping: InputMapping,
  axis: number,
  hat: HatMapping = DIRECTIONS_HAT,
): InputMapping {
  return { ...mapping, gamepadHats: { ...mapping.gamepadHats, [axis]: hat } };
}

/** Stop decoding `axis` as a hat; it goes back to being read as a plain axis. */
export function removeGamepadHat(mapping: InputMapping, axis: number): InputMapping {
  const { [axis]: _removed, ...rest } = mapping.gamepadHats;
  return { ...mapping, gamepadHats: rest };
}

/** Labels for the W3C "standard" gamepad layout (Xbox naming). */
const STANDARD_GAMEPAD_NAMES = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS',
  'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home',
];

export function gamepadControl(index: number): string {
  return `Button ${index}`;
}

/** Human-readable name for a standard gamepad button, e.g. "X (2)". */
export function gamepadButtonName(index: number): string {
  const name = STANDARD_GAMEPAD_NAMES[index];
  return name ? `${name} (${index})` : `Button ${index}`;
}

const axisKey = (axis: number, dir: AxisDirection) => `${axis}${dir}`;

export function gamepadAxisControl(axis: number, dir: AxisDirection): string {
  return `Axis ${axis}${dir}`;
}

const STANDARD_AXIS_NAMES: Record<string, string> = {
  '0-': 'LS left',
  '0+': 'LS right',
  '1-': 'LS up',
  '1+': 'LS down',
  '2-': 'RS left',
  '2+': 'RS right',
  '3-': 'RS up',
  '3+': 'RS down',
};

/** Human-readable name for an axis direction, e.g. "LS left (Axis 0-)". */
export function gamepadAxisName(axis: number, dir: AxisDirection): string {
  const name = STANDARD_AXIS_NAMES[axisKey(axis, dir)];
  const control = gamepadAxisControl(axis, dir);
  return name ? `${name} (${control})` : control;
}

export function mapGamepadAxis(mapping: InputMapping, axis: number, dir: AxisDirection): ButtonId | null {
  return mapping.gamepadAxes[axisKey(axis, dir)] ?? null;
}

export function bindGamepadAxis(
  mapping: InputMapping,
  axis: number,
  dir: AxisDirection,
  button: ButtonId,
): InputMapping {
  return { ...mapping, gamepadAxes: { ...mapping.gamepadAxes, [axisKey(axis, dir)]: button } };
}

export function unbindGamepadAxis(mapping: InputMapping, axis: number, dir: AxisDirection): InputMapping {
  const { [axisKey(axis, dir)]: _removed, ...rest } = mapping.gamepadAxes;
  return { ...mapping, gamepadAxes: rest };
}

export function mapKey(mapping: InputMapping, code: string): ButtonId | null {
  return mapping.keyboard[code] ?? null;
}

export function mapGamepadButton(mapping: InputMapping, index: number): ButtonId | null {
  return mapping.gamepad[index] ?? null;
}

/** Returns a new mapping with `code` bound to `button`. A button may have several keys. */
export function bindKey(mapping: InputMapping, code: string, button: ButtonId): InputMapping {
  return { ...mapping, keyboard: { ...mapping.keyboard, [code]: button } };
}

export function unbindKey(mapping: InputMapping, code: string): InputMapping {
  const { [code]: _removed, ...rest } = mapping.keyboard;
  return { ...mapping, keyboard: rest };
}

export function bindGamepadButton(mapping: InputMapping, index: number, button: ButtonId): InputMapping {
  return { ...mapping, gamepad: { ...mapping.gamepad, [index]: button } };
}

export function unbindGamepadButton(mapping: InputMapping, index: number): InputMapping {
  const { [index]: _removed, ...rest } = mapping.gamepad;
  return { ...mapping, gamepad: rest };
}

/** The engine's press shape, or null for an unmapped control or a release. */
export function toPressEvent(press: InputEvent): PressEvent | null {
  if (press.edge !== 'press' || press.button === null) return null;
  return { button: press.button, timestamp: press.timestamp, source: press.source };
}

// --- generic control binding (used by the Controls page) ----------------------

/** A single bindable control, parsed from an input event's `source` and `control`. */
export type ControlRef =
  | { kind: 'key'; code: string }
  | { kind: 'button'; index: number }
  | { kind: 'axis'; axis: number; dir: AxisDirection }
  | { kind: 'hat'; axis: number; dir: HatDirection };

/** Parses an input event's control into a ControlRef, or null if it isn't recognised. */
export function parseControl(source: 'keyboard' | 'gamepad', control: string): ControlRef | null {
  if (source === 'keyboard') return control ? { kind: 'key', code: control } : null;
  let m = /^Button (\d+)$/.exec(control);
  if (m) return { kind: 'button', index: Number(m[1]) };
  m = /^Axis (\d+)([+-])$/.exec(control);
  if (m) return { kind: 'axis', axis: Number(m[1]), dir: m[2] as AxisDirection };
  m = /^Hat (\d+) (up|down|left|right)$/.exec(control);
  if (m) return { kind: 'hat', axis: Number(m[1]), dir: m[2] as HatDirection };
  return null;
}

/** The button a control is bound to, or null. */
export function mapControl(mapping: InputMapping, ref: ControlRef): ButtonId | null {
  switch (ref.kind) {
    case 'key':
      return mapKey(mapping, ref.code);
    case 'button':
      return mapGamepadButton(mapping, ref.index);
    case 'axis':
      return mapGamepadAxis(mapping, ref.axis, ref.dir);
    case 'hat':
      return mapGamepadHat(mapping, ref.axis, ref.dir);
  }
}

/**
 * Binds a control to a button. A control has one button at most, so this replaces any
 * earlier binding of the same control. A button may have several controls.
 */
export function bindControl(mapping: InputMapping, ref: ControlRef, button: ButtonId): InputMapping {
  switch (ref.kind) {
    case 'key':
      return bindKey(mapping, ref.code, button);
    case 'button':
      return bindGamepadButton(mapping, ref.index, button);
    case 'axis':
      return bindGamepadAxis(mapping, ref.axis, ref.dir, button);
    case 'hat': {
      const hat = mapping.gamepadHats[ref.axis] ?? {};
      return setGamepadHat(mapping, ref.axis, { ...hat, [ref.dir]: button });
    }
  }
}

/**
 * Removes a control's binding. An unbound hat direction stays decoded as a hat, so the
 * axis isn't read as a plain axis instead.
 */
export function unbindControl(mapping: InputMapping, ref: ControlRef): InputMapping {
  switch (ref.kind) {
    case 'key':
      return unbindKey(mapping, ref.code);
    case 'button':
      return unbindGamepadButton(mapping, ref.index);
    case 'axis':
      return unbindGamepadAxis(mapping, ref.axis, ref.dir);
    case 'hat': {
      const hat = mapping.gamepadHats[ref.axis];
      if (!hat) return mapping;
      const { [ref.dir]: _removed, ...rest } = hat;
      return setGamepadHat(mapping, ref.axis, rest);
    }
  }
}

export interface Binding {
  ref: ControlRef;
  source: 'keyboard' | 'gamepad';
  button: ButtonId;
  /** Readable name, e.g. "K", "X (2)", "LS left (Axis 0-)", "Hat 9 up". */
  label: string;
}

/** Every binding in the mapping: keyboard first, then pad buttons, axes and hats. */
export function listBindings(mapping: InputMapping): Binding[] {
  const out: Binding[] = [];
  for (const [code, button] of Object.entries(mapping.keyboard)) {
    out.push({ ref: { kind: 'key', code }, source: 'keyboard', button, label: keyLabel(code) });
  }
  const byNumber = (a: [string, unknown], b: [string, unknown]) => Number.parseFloat(a[0]) - Number.parseFloat(b[0]);
  for (const [index, button] of Object.entries(mapping.gamepad).sort(byNumber)) {
    out.push({ ref: { kind: 'button', index: Number(index) }, source: 'gamepad', button, label: gamepadButtonName(Number(index)) });
  }
  for (const [key, button] of Object.entries(mapping.gamepadAxes).sort(byNumber)) {
    const axis = Number(key.slice(0, -1));
    const dir = key.slice(-1) as AxisDirection;
    out.push({ ref: { kind: 'axis', axis, dir }, source: 'gamepad', button, label: gamepadAxisName(axis, dir) });
  }
  for (const [axis, hat] of Object.entries(mapping.gamepadHats).sort(byNumber)) {
    for (const dir of HAT_DIRECTIONS) {
      const button = hat[dir];
      if (button) {
        out.push({ ref: { kind: 'hat', axis: Number(axis), dir }, source: 'gamepad', button, label: gamepadHatControl(Number(axis), dir) });
      }
    }
  }
  return out;
}

/** Readable name for a ControlRef. */
export function controlLabel(ref: ControlRef): string {
  switch (ref.kind) {
    case 'key':
      return keyLabel(ref.code);
    case 'button':
      return gamepadButtonName(ref.index);
    case 'axis':
      return gamepadAxisName(ref.axis, ref.dir);
    case 'hat':
      return gamepadHatControl(ref.axis, ref.dir);
  }
}

const PUNCTUATION_KEYS: Readonly<Record<string, string>> = {
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

/** "KeyK" → "K", "Digit1" → "1", "Semicolon" → ";", "Numpad4" → "Num 4", others unchanged ("Space"). */
export function keyLabel(code: string): string {
  const punctuation = PUNCTUATION_KEYS[code];
  if (punctuation) return punctuation;
  return code.replace(/^Key(?=.)/, '').replace(/^Digit(?=.)/, '').replace(/^Numpad(?=.)/, 'Num ');
}

export function sameControl(a: ControlRef, b: ControlRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
