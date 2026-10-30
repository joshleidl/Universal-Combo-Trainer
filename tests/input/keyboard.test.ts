import { describe, expect, it } from 'vitest';
import { KeyboardTracker, attachKeyboard } from '../../src/input/keyboard';
import { DEFAULT_MAPPING, bindKey } from '../../src/input/mapping';
import type { InputPress } from '../../src/input/types';

const down = (code: string, timeStamp: number, repeat = false) => ({ code, timeStamp, repeat });

describe('KeyboardTracker', () => {
  it('emits a press with the event timestamp and mapped button', () => {
    const t = new KeyboardTracker(DEFAULT_MAPPING);
    expect(t.keyDown(down('KeyU', 123.456))).toEqual({
      source: 'keyboard',
      button: 'LP',
      control: 'KeyU',
      timestamp: 123.456,
      timestampSource: 'event',
    });
  });

  it('ignores auto-repeat', () => {
    const t = new KeyboardTracker(DEFAULT_MAPPING);
    expect(t.keyDown(down('KeyU', 0))).not.toBeNull();
    expect(t.keyDown(down('KeyU', 500, true))).toBeNull();
  });

  it('ignores a held key even when repeat is not set', () => {
    const t = new KeyboardTracker(DEFAULT_MAPPING);
    t.keyDown(down('KeyU', 0));
    expect(t.keyDown(down('KeyU', 30))).toBeNull();
    t.keyUp({ code: 'KeyU' });
    expect(t.keyDown(down('KeyU', 60))?.timestamp).toBe(60);
  });

  it('tracks keys independently', () => {
    const t = new KeyboardTracker(DEFAULT_MAPPING);
    t.keyDown(down('KeyU', 0));
    expect(t.keyDown(down('KeyI', 5))?.button).toBe('MP');
  });

  it('reports unmapped keys with a null button', () => {
    const t = new KeyboardTracker(DEFAULT_MAPPING);
    expect(t.keyDown(down('KeyZ', 0))).toMatchObject({ button: null, control: 'KeyZ' });
  });

  it('reset() forgets held keys', () => {
    const t = new KeyboardTracker(DEFAULT_MAPPING);
    t.keyDown(down('KeyU', 0));
    t.reset();
    expect(t.keyDown(down('KeyU', 10))).not.toBeNull();
  });

  it('uses an updated mapping', () => {
    const t = new KeyboardTracker(DEFAULT_MAPPING);
    t.setMapping(bindKey(DEFAULT_MAPPING, 'KeyU', 'HK'));
    expect(t.keyDown(down('KeyU', 0))?.button).toBe('HK');
  });
});

// Node's Event has a read-only timeStamp, so set it with defineProperty.
function keyEvent(
  type: string,
  code: string,
  opts: { timeStamp?: number; repeat?: boolean; ctrlKey?: boolean } = {},
): Event {
  const e = new Event(type, { cancelable: true });
  Object.defineProperties(e, {
    code: { value: code },
    repeat: { value: opts.repeat ?? false },
    timeStamp: { value: opts.timeStamp ?? 0 },
    ctrlKey: { value: opts.ctrlKey ?? false },
    metaKey: { value: false },
    altKey: { value: false },
  });
  return e;
}

describe('attachKeyboard', () => {
  function setup() {
    const target = new EventTarget();
    const presses: InputPress[] = [];
    const handle = attachKeyboard(target, { mapping: DEFAULT_MAPPING, onPress: (p) => presses.push(p) });
    return { target, presses, handle };
  }

  it('emits presses from keydown, skipping repeats and holds', () => {
    const { target, presses } = setup();
    target.dispatchEvent(keyEvent('keydown', 'KeyU', { timeStamp: 10 }));
    target.dispatchEvent(keyEvent('keydown', 'KeyU', { timeStamp: 40, repeat: true }));
    target.dispatchEvent(keyEvent('keyup', 'KeyU'));
    target.dispatchEvent(keyEvent('keydown', 'KeyU', { timeStamp: 90 }));
    expect(presses.map((p) => p.timestamp)).toEqual([10, 90]);
  });

  it('prevents default for mapped keys only', () => {
    const { target } = setup();
    const mapped = keyEvent('keydown', 'KeyU');
    const unmapped = keyEvent('keydown', 'KeyZ');
    target.dispatchEvent(mapped);
    target.dispatchEvent(unmapped);
    expect(mapped.defaultPrevented).toBe(true);
    expect(unmapped.defaultPrevented).toBe(false);
  });

  it('ignores keys pressed with Ctrl/Cmd/Alt', () => {
    const { target, presses } = setup();
    const e = keyEvent('keydown', 'KeyU', { ctrlKey: true });
    target.dispatchEvent(e);
    expect(presses).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('clears held keys on blur', () => {
    const { target, presses } = setup();
    target.dispatchEvent(keyEvent('keydown', 'KeyU', { timeStamp: 1 }));
    target.dispatchEvent(new Event('blur'));
    target.dispatchEvent(keyEvent('keydown', 'KeyU', { timeStamp: 2 }));
    expect(presses).toHaveLength(2);
  });

  it('stops listening after stop()', () => {
    const { target, presses, handle } = setup();
    handle.stop();
    target.dispatchEvent(keyEvent('keydown', 'KeyU'));
    expect(presses).toHaveLength(0);
  });

  it('applies setMapping to later presses', () => {
    const { target, presses, handle } = setup();
    handle.setMapping(bindKey(DEFAULT_MAPPING, 'KeyZ', 'LP'));
    const e = keyEvent('keydown', 'KeyZ');
    target.dispatchEvent(e);
    expect(presses[0]?.button).toBe('LP');
    expect(e.defaultPrevented).toBe(true);
  });
});
