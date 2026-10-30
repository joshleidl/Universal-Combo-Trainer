// Keyboard → timestamped press edges (SPEC §5).

import { mapKey, type InputMapping } from './mapping';
import type { InputPress } from './types';

/** The parts of a KeyboardEvent the tracker needs. */
export interface KeyLike {
  code: string;
  repeat: boolean;
  timeStamp: number;
}

/**
 * Turns keydown/keyup into press edges. Ignores auto-repeat, and also ignores a
 * second keydown for a key that is still held (some setups repeat without setting `repeat`).
 */
export class KeyboardTracker {
  private readonly held = new Set<string>();

  constructor(private mapping: InputMapping) {}

  setMapping(mapping: InputMapping): void {
    this.mapping = mapping;
  }

  keyDown(e: KeyLike): InputPress | null {
    if (e.repeat || this.held.has(e.code)) return null;
    this.held.add(e.code);
    return {
      source: 'keyboard',
      button: mapKey(this.mapping, e.code),
      control: e.code,
      timestamp: e.timeStamp,
      timestampSource: 'event',
    };
  }

  keyUp(e: Pick<KeyLike, 'code'>): void {
    this.held.delete(e.code);
  }

  /** Forget held keys, e.g. when the window loses focus and keyups may be missed. */
  reset(): void {
    this.held.clear();
  }
}

export interface KeyboardOptions {
  mapping: InputMapping;
  onPress: (press: InputPress) => void;
}

export interface KeyboardHandle {
  setMapping(mapping: InputMapping): void;
  stop(): void;
}

/** Listens for keys on `target` (normally `window`). */
export function attachKeyboard(target: EventTarget, options: KeyboardOptions): KeyboardHandle {
  const tracker = new KeyboardTracker(options.mapping);
  let mapping = options.mapping;

  const onKeyDown = (ev: Event) => {
    const e = ev as KeyboardEvent;
    // Leave browser shortcuts (Ctrl+R, Cmd+L, …) alone.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Stop mapped keys from scrolling or typing, including their repeats.
    if (mapKey(mapping, e.code) !== null) e.preventDefault();
    const press = tracker.keyDown(e);
    if (press) options.onPress(press);
  };
  const onKeyUp = (ev: Event) => tracker.keyUp(ev as KeyboardEvent);
  const onBlur = () => tracker.reset();

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  return {
    setMapping(next) {
      mapping = next;
      tracker.setMapping(next);
    },
    stop() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
