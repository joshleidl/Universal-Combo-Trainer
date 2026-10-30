import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPPING, bindControl, unbindControl } from '../../src/input/mapping';
import { memoryStorage } from '../../src/storage/combos';
import {
  MAPPING_BACKUP_KEY,
  MAPPING_KEY,
  loadMapping,
  parseMapping,
  resetMapping,
  saveMapping,
} from '../../src/storage/mapping';

const custom = unbindControl(
  bindControl(bindControl(DEFAULT_MAPPING, { kind: 'button', index: 4 }, 'LP'), { kind: 'key', code: 'Space' }, 'HK'),
  { kind: 'hat', axis: 9, dir: 'down' },
);

describe('mapping storage', () => {
  it('returns the defaults and stores nothing when nothing is saved', () => {
    const storage = memoryStorage();
    expect(loadMapping(storage)).toBe(DEFAULT_MAPPING);
    expect(storage.dump()).toEqual({});
  });

  it('saves and reloads a custom mapping, including a partly unbound hat', () => {
    const storage = memoryStorage();
    saveMapping(storage, custom);
    expect(loadMapping(storage)).toEqual(custom);
    expect(loadMapping(storage).gamepadHats[9]).toEqual({ up: 'UP', left: 'LEFT', right: 'RIGHT' });
  });

  it('reset forgets the saved mapping', () => {
    const storage = memoryStorage();
    saveMapping(storage, custom);
    expect(resetMapping(storage)).toBe(DEFAULT_MAPPING);
    expect(storage.getItem(MAPPING_KEY)).toBeNull();
    expect(loadMapping(storage)).toBe(DEFAULT_MAPPING);
  });

  it('backs up unreadable data and falls back to the defaults', () => {
    for (const raw of ['{oops', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, keyboard: {} })]) {
      const storage = memoryStorage({ [MAPPING_KEY]: raw });
      expect(loadMapping(storage)).toBe(DEFAULT_MAPPING);
      expect(storage.getItem(MAPPING_BACKUP_KEY)).toBe(raw);
      expect(storage.getItem(MAPPING_KEY)).toBeNull();
    }
  });
});

describe('parseMapping', () => {
  const base = { version: 1, keyboard: {}, gamepad: {}, gamepadAxes: {}, gamepadHats: {} };

  it('accepts an empty mapping', () => {
    expect(parseMapping(base)).toEqual({ keyboard: {}, gamepad: {}, gamepadAxes: {}, gamepadHats: {} });
  });

  it('rejects malformed keys and values', () => {
    expect(parseMapping({ ...base, keyboard: { KeyK: 5 } })).toBeNull();
    expect(parseMapping({ ...base, keyboard: { KeyK: '' } })).toBeNull();
    expect(parseMapping({ ...base, gamepad: { x: 'LP' } })).toBeNull();
    expect(parseMapping({ ...base, gamepadAxes: { '1': 'LP' } })).toBeNull();
    expect(parseMapping({ ...base, gamepadHats: { 9: { diagonal: 'LP' } } })).toBeNull();
    expect(parseMapping({ ...base, gamepadHats: { 9: 'UP' } })).toBeNull();
    expect(parseMapping({ ...base, gamepadHats: [] })).toBeNull();
    expect(parseMapping(null)).toBeNull();
  });

  it('round-trips the defaults', () => {
    expect(parseMapping(JSON.parse(JSON.stringify({ version: 1, ...DEFAULT_MAPPING })))).toEqual(DEFAULT_MAPPING);
  });
});
