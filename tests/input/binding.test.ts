import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAPPING,
  bindControl,
  controlLabel,
  keyLabel,
  listBindings,
  mapControl,
  parseControl,
  sameControl,
  unbindControl,
  type ControlRef,
  type InputMapping,
} from '../../src/input/mapping';
import { GamepadTracker, type GamepadLike } from '../../src/input/gamepad';

const empty: InputMapping = { keyboard: {}, gamepad: {}, gamepadAxes: {}, gamepadHats: {} };

describe('parseControl', () => {
  it('parses every control kind', () => {
    expect(parseControl('keyboard', 'KeyK')).toEqual({ kind: 'key', code: 'KeyK' });
    expect(parseControl('gamepad', 'Button 12')).toEqual({ kind: 'button', index: 12 });
    expect(parseControl('gamepad', 'Axis 1-')).toEqual({ kind: 'axis', axis: 1, dir: '-' });
    expect(parseControl('gamepad', 'Axis 10+')).toEqual({ kind: 'axis', axis: 10, dir: '+' });
    expect(parseControl('gamepad', 'Hat 9 left')).toEqual({ kind: 'hat', axis: 9, dir: 'left' });
  });

  it('rejects anything else', () => {
    expect(parseControl('keyboard', '')).toBeNull();
    expect(parseControl('gamepad', 'Button')).toBeNull();
    expect(parseControl('gamepad', 'Axis 1')).toBeNull();
    expect(parseControl('gamepad', 'Hat 9 diagonal')).toBeNull();
    expect(parseControl('gamepad', 'KeyK')).toBeNull();
  });
});

describe('bindControl / unbindControl / mapControl', () => {
  const refs: ControlRef[] = [
    { kind: 'key', code: 'KeyQ' },
    { kind: 'button', index: 4 },
    { kind: 'axis', axis: 2, dir: '+' },
    { kind: 'hat', axis: 9, dir: 'up' },
  ];

  it('round-trips each kind without touching the input mapping', () => {
    for (const ref of refs) {
      const m = bindControl(empty, ref, 'HK');
      expect(mapControl(m, ref)).toBe('HK');
      expect(mapControl(unbindControl(m, ref), ref)).toBeNull();
      expect(mapControl(empty, ref)).toBeNull();
    }
  });

  it('rebinding a control moves it to the new button', () => {
    const ref: ControlRef = { kind: 'button', index: 2 };
    expect(mapControl(DEFAULT_MAPPING, ref)).toBe('LP');
    expect(mapControl(bindControl(DEFAULT_MAPPING, ref, 'LK'), ref)).toBe('LK');
  });

  it('binds one hat direction and keeps the others', () => {
    const m = bindControl(DEFAULT_MAPPING, { kind: 'hat', axis: 9, dir: 'up' }, 'LP');
    expect(m.gamepadHats[9]).toEqual({ up: 'LP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' });
  });

  it('unbinding a hat direction keeps the axis decoded as a hat', () => {
    let m = DEFAULT_MAPPING;
    for (const dir of ['up', 'down', 'left', 'right'] as const) m = unbindControl(m, { kind: 'hat', axis: 9, dir });
    expect(m.gamepadHats[9]).toEqual({});
    expect(unbindControl(empty, { kind: 'hat', axis: 9, dir: 'up' })).toBe(empty);
  });

  it('a tracker decodes a partly unbound hat: unbound directions come through unmapped', () => {
    const m = unbindControl(DEFAULT_MAPPING, { kind: 'hat', axis: 9, dir: 'down' });
    const tracker = new GamepadTracker(m);
    const pad = (hat: number): GamepadLike => ({
      index: 0,
      connected: true,
      timestamp: 0,
      mapping: 'standard',
      buttons: [],
      axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, hat],
    } as unknown as GamepadLike);
    tracker.poll([pad(3.29)], 10);
    const events = tracker.poll([pad(1 / 7)], 20); // down
    expect(events.map((e) => [e.control, e.button])).toEqual([['Hat 9 down', null]]);
  });
});

describe('listBindings', () => {
  it('lists every default binding with readable labels', () => {
    const list = listBindings(DEFAULT_MAPPING);
    expect(list).toHaveLength(12 + 12 + 4 + 4);
    expect(list.filter((b) => b.button === 'MISC1').map((b) => b.label)).toEqual(['P', 'LB (4)']);
    expect(list.filter((b) => b.button === 'MISC2').map((b) => b.label)).toEqual([';', 'LT (6)']);
    const lp = list.filter((b) => b.button === 'LP').map((b) => b.label);
    expect(lp).toEqual(['U', 'X (2)']);
    const up = list.filter((b) => b.button === 'UP').map((b) => b.label);
    expect(up).toEqual(['W', 'D-Up (12)', 'LS up (Axis 1-)', 'Hat 9 up']);
  });

  it('sorts pad buttons numerically and skips unbound hat directions', () => {
    const m: InputMapping = { ...empty, gamepad: { 10: 'LP', 2: 'MP' }, gamepadHats: { 9: { left: 'LK' } } };
    expect(listBindings(m).map((b) => b.label)).toEqual(['X (2)', 'LS (10)', 'Hat 9 left']);
  });
});

describe('labels', () => {
  it('shortens key codes', () => {
    expect(keyLabel('KeyK')).toBe('K');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Numpad4')).toBe('Num 4');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('Semicolon')).toBe(';');
    expect(keyLabel('Backslash')).toBe('\\');
    expect(keyLabel('ArrowLeft')).toBe('ArrowLeft');
  });

  it('names controls', () => {
    expect(controlLabel({ kind: 'key', code: 'KeyJ' })).toBe('J');
    expect(controlLabel({ kind: 'button', index: 3 })).toBe('Y (3)');
    expect(controlLabel({ kind: 'axis', axis: 0, dir: '-' })).toBe('LS left (Axis 0-)');
    expect(controlLabel({ kind: 'hat', axis: 9, dir: 'right' })).toBe('Hat 9 right');
  });

  it('compares controls', () => {
    expect(sameControl({ kind: 'button', index: 3 }, { kind: 'button', index: 3 })).toBe(true);
    expect(sameControl({ kind: 'button', index: 3 }, { kind: 'button', index: 4 })).toBe(false);
  });
});
