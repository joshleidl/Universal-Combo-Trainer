// Keyboard → timestamped press and release edges (SPEC §5).

import { mapKey, type InputMapping } from './mapping';
import type { InputPress, InputRelease } from './types';

/** The parts of a KeyboardEvent the tracker needs. */
export interface KeyLike {
  code: string;
  repeat: boolean;
  timeStamp: number;
}

/**
 * Turns keydown/keyup into press and release edges. Ignores auto-repeat, and also ignores a
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
      edge: 'press',
      source: 'keyboard',
      button: mapKey(this.mapping, e.code),
      control: e.code,
      timestamp: e.timeStamp,
      timestampSource: 'event',
    };
  }

  /** A release, only for a key whose press was reported (keys held before a reset() stay silent). */
  keyUp(e: Pick<KeyLike, 'code' | 'timeStamp'>): InputRelease | null {
    if (!this.held.delete(e.code)) return null;
    return {
      edge: 'release',
      source: 'keyboard',
      button: mapKey(this.mapping, e.code),
      control: e.code,
      timestamp: e.timeStamp,
      timestampSource: 'event',
    };
  }

  /** Forget held keys, e.g. when the window loses focus and keyups may be missed. */
  reset(): void {
    this.held.clear();
  }

  /**
   * Forgets held keys like reset(), and returns a release at `timeStamp` for each, so listeners
   * see those keys as up (SPEC §3: a key held across a blur reads as up until pressed again).
   */
  releaseAll(timeStamp: number): InputRelease[] {
    const releases = [...this.held].map((code) => this.keyUp({ code, timeStamp }) as InputRelease);
    this.held.clear();
    return releases;
  }
}

export interface KeyboardOptions {
  mapping: InputMapping;
  onPress: (press: InputPress) => void;
  /**
   * Optional. Releases are never graded; they change what is held (directions, the live input
   * display). When the window loses focus, every held key gets a release at the blur time.
   */
  onRelease?: (release: InputRelease) => void;
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
  const onKeyUp = (ev: Event) => {
    const release = tracker.keyUp(ev as KeyboardEvent);
    if (release) options.onRelease?.(release);
  };
  const onBlur = (ev: Event) => {
    for (const release of tracker.releaseAll(ev.timeStamp)) options.onRelease?.(release);
  };

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
