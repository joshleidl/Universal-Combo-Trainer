// Raw key / gamepad button → button ID. Pure and user-remappable (SPEC §5).

import type { ButtonId, PressEvent } from '../engine/types';
import type { InputPress } from './types';

export const BUTTON_IDS = ['LP', 'MP', 'HP', 'LK', 'MK', 'HK', 'UP', 'DOWN', 'LEFT', 'RIGHT'] as const;

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
export type HatMapping = Readonly<Record<HatDirection, ButtonId>>;

const DIRECTIONS_HAT: HatMapping = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' };

export const DEFAULT_MAPPING: InputMapping = {
  keyboard: {
    KeyU: 'LP',
    KeyI: 'MP',
    KeyO: 'HP',
    KeyJ: 'LK',
    KeyK: 'MK',
    KeyL: 'HK',
    KeyW: 'UP',
    KeyA: 'LEFT',
    KeyS: 'DOWN',
    KeyD: 'RIGHT',
  },
  // Common 6-button pad layout: punches on X / Y / RB, kicks on A / B / RT, directions on the d-pad.
  gamepad: {
    2: 'LP',
    3: 'MP',
    5: 'HP',
    0: 'LK',
    1: 'MK',
    7: 'HK',
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

/** The engine's press shape, or null for an unmapped control. */
export function toPressEvent(press: InputPress): PressEvent | null {
  if (press.button === null) return null;
  return { button: press.button, timestamp: press.timestamp, source: press.source };
}
