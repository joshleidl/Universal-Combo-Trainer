import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAPPING,
  bindGamepadAxis,
  bindGamepadButton,
  bindKey,
  decodeHat,
  mapGamepadHat,
  removeGamepadHat,
  setGamepadHat,
  gamepadAxisName,
  gamepadButtonName,
  mapGamepadAxis,
  mapGamepadButton,
  mapKey,
  toPressEvent,
  unbindGamepadAxis,
  unbindGamepadButton,
  unbindKey,
} from '../../src/input/mapping';

describe('default mapping', () => {
  it('maps U/I/O to punches, J/K/L to kicks, WASD to directions', () => {
    expect(['KeyU', 'KeyI', 'KeyO'].map((c) => mapKey(DEFAULT_MAPPING, c))).toEqual(['LP', 'MP', 'HP']);
    expect(['KeyJ', 'KeyK', 'KeyL'].map((c) => mapKey(DEFAULT_MAPPING, c))).toEqual(['LK', 'MK', 'HK']);
    expect(['KeyW', 'KeyA', 'KeyS', 'KeyD'].map((c) => mapKey(DEFAULT_MAPPING, c))).toEqual([
      'UP',
      'LEFT',
      'DOWN',
      'RIGHT',
    ]);
  });

  it('maps the d-pad and face buttons on a standard gamepad', () => {
    expect(mapGamepadButton(DEFAULT_MAPPING, 2)).toBe('LP');
    expect(mapGamepadButton(DEFAULT_MAPPING, 0)).toBe('LK');
    expect(mapGamepadButton(DEFAULT_MAPPING, 12)).toBe('UP');
  });

  it('maps the left stick to directions', () => {
    expect(mapGamepadAxis(DEFAULT_MAPPING, 0, '-')).toBe('LEFT');
    expect(mapGamepadAxis(DEFAULT_MAPPING, 0, '+')).toBe('RIGHT');
    expect(mapGamepadAxis(DEFAULT_MAPPING, 1, '-')).toBe('UP');
    expect(mapGamepadAxis(DEFAULT_MAPPING, 1, '+')).toBe('DOWN');
    expect(mapGamepadAxis(DEFAULT_MAPPING, 2, '-')).toBeNull();
  });

  it('returns null for unmapped controls', () => {
    expect(mapKey(DEFAULT_MAPPING, 'KeyZ')).toBeNull();
    expect(mapGamepadButton(DEFAULT_MAPPING, 9)).toBeNull();
  });
});

describe('decodeHat', () => {
  // Values measured on a Qanba Obsidian in Firefox, by numpad direction.
  it.each([
    [8, -1, ['up']],
    [9, -0.71, ['up', 'right']],
    [6, -0.43, ['right']],
    [3, -0.14, ['down', 'right']],
    [2, 0.14, ['down']],
    [1, 0.43, ['down', 'left']],
    [4, 0.71, ['left']],
    [7, 1, ['up', 'left']],
    [5, 3.29, []],
  ])('numpad %i (%f) → %j', (_numpad, value, dirs) => {
    expect(decodeHat(value)).toEqual(dirs);
  });

  it('decodes exact 2/7 steps', () => {
    expect(decodeHat(-1 + 2 / 7)).toEqual(['up', 'right']);
    expect(decodeHat(-1 + 10 / 7)).toEqual(['down', 'left']);
  });

  it('treats out-of-range values as neutral', () => {
    expect(decodeHat(1 + 2 / 7)).toEqual([]); // Chrome's neutral, 1.2857
    expect(decodeHat(-1.2)).toEqual([]);
    expect(decodeHat(Number.NaN)).toEqual([]);
    expect(decodeHat(Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe('hat mapping', () => {
  it('decodes axis 9 as a hat mapped to directions by default', () => {
    expect(mapGamepadHat(DEFAULT_MAPPING, 9, 'up')).toBe('UP');
    expect(mapGamepadHat(DEFAULT_MAPPING, 9, 'left')).toBe('LEFT');
    expect(mapGamepadHat(DEFAULT_MAPPING, 8, 'up')).toBeNull();
  });

  it('adds and removes hats', () => {
    const custom = { up: 'LP', down: 'LK', left: 'MP', right: 'MK' };
    const m = setGamepadHat(DEFAULT_MAPPING, 6, custom);
    expect(mapGamepadHat(m, 6, 'down')).toBe('LK');
    expect(mapGamepadHat(setGamepadHat(DEFAULT_MAPPING, 7), 7, 'down')).toBe('DOWN');
    expect(mapGamepadHat(removeGamepadHat(DEFAULT_MAPPING, 9), 9, 'up')).toBeNull();
    expect(mapGamepadHat(DEFAULT_MAPPING, 6, 'down')).toBeNull();
  });
});

describe('remapping', () => {
  it('binds and unbinds keys without changing the original', () => {
    const m = bindKey(DEFAULT_MAPPING, 'Space', 'LP');
    expect(mapKey(m, 'Space')).toBe('LP');
    expect(mapKey(m, 'KeyU')).toBe('LP'); // a button can have several keys
    expect(mapKey(DEFAULT_MAPPING, 'Space')).toBeNull();
    expect(mapKey(unbindKey(m, 'KeyU'), 'KeyU')).toBeNull();
  });

  it('rebinding a key replaces its old button', () => {
    expect(mapKey(bindKey(DEFAULT_MAPPING, 'KeyU', 'HK'), 'KeyU')).toBe('HK');
  });

  it('binds and unbinds gamepad axis directions', () => {
    const m = bindGamepadAxis(DEFAULT_MAPPING, 9, '-', 'UP');
    expect(mapGamepadAxis(m, 9, '-')).toBe('UP');
    expect(mapGamepadAxis(m, 9, '+')).toBeNull();
    expect(mapGamepadAxis(unbindGamepadAxis(m, 9, '-'), 9, '-')).toBeNull();
    expect(mapGamepadAxis(DEFAULT_MAPPING, 9, '-')).toBeNull();
  });

  it('binds and unbinds gamepad buttons', () => {
    const m = bindGamepadButton(DEFAULT_MAPPING, 9, 'HP');
    expect(mapGamepadButton(m, 9)).toBe('HP');
    expect(mapGamepadButton(unbindGamepadButton(m, 9), 9)).toBeNull();
    expect(mapGamepadButton(DEFAULT_MAPPING, 9)).toBeNull();
  });
});

describe('helpers', () => {
  it('names standard gamepad buttons', () => {
    expect(gamepadButtonName(2)).toBe('X (2)');
    expect(gamepadButtonName(15)).toBe('D-Right (15)');
    expect(gamepadButtonName(20)).toBe('Button 20');
  });

  it('names axis directions', () => {
    expect(gamepadAxisName(0, '-')).toBe('LS left (Axis 0-)');
    expect(gamepadAxisName(3, '+')).toBe('RS down (Axis 3+)');
    expect(gamepadAxisName(9, '+')).toBe('Axis 9+');
  });

  it('converts mapped presses to engine press events and drops unmapped ones', () => {
    const base = { source: 'keyboard', control: 'KeyU', timestamp: 12.5, timestampSource: 'event' } as const;
    expect(toPressEvent({ ...base, button: 'LP' })).toEqual({ button: 'LP', timestamp: 12.5, source: 'keyboard' });
    expect(toPressEvent({ ...base, button: null })).toBeNull();
  });
});
