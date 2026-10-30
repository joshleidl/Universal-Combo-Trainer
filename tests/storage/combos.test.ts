import { describe, expect, it } from 'vitest';
import { EXAMPLE_COMBOS } from '../../src/combo/examples';
import { newCombo } from '../../src/combo/edit';
import type { Combo } from '../../src/engine/types';
import {
  COMBOS_BACKUP_KEY,
  COMBOS_KEY,
  ComboStore,
  LAST_OPENED_KEY,
  memoryStorage,
  parseCombo,
  validateForSave,
} from '../../src/storage/combos';

const sequentialIds = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const sample = (name = 'Mine'): Combo => ({
  name,
  fps: 120,
  timingMode: 'absolute',
  startMode: 'countdown',
  steps: [
    { button: 'LP', targetFrame: 0, tolEarly: 0, tolLate: 0, label: 'jab' },
    { button: 'HK', targetFrame: 20, tolEarly: 1, tolLate: 2 },
  ],
});

const emptyStore = (storage = memoryStorage()) => new ComboStore(storage, { examples: [], makeId: sequentialIds() });

describe('seeding examples', () => {
  it('seeds the shipped examples into empty storage', () => {
    const store = new ComboStore(memoryStorage());
    expect(store.list()).toEqual(EXAMPLE_COMBOS.map((e) => ({ id: e.id, combo: e.combo })));
  });

  it('does not reseed once data exists, even if every combo was deleted', () => {
    const storage = memoryStorage();
    const first = new ComboStore(storage);
    for (const s of first.list()) first.delete(s.id);
    expect(new ComboStore(storage).list()).toEqual([]);
  });

  it('does not share objects with the example constants', () => {
    const store = new ComboStore(memoryStorage());
    const id = EXAMPLE_COMBOS[0]!.id;
    store.update(id, { ...store.get(id)!.combo, name: 'changed' });
    expect(EXAMPLE_COMBOS[0]!.combo.name).not.toBe('changed');
  });
});

describe('create / get / list', () => {
  it('saves and reads back a combo', () => {
    const store = emptyStore();
    const saved = store.create(sample());
    expect(saved).toEqual({ id: 'id-1', combo: sample() });
    expect(store.get('id-1')).toEqual(saved);
    expect(store.list()).toEqual([saved]);
  });

  it('survives a reload (a new store over the same storage)', () => {
    const storage = memoryStorage();
    emptyStore(storage).create(sample());
    expect(new ComboStore(storage).list()).toEqual([{ id: 'id-1', combo: sample() }]);
  });

  it('keeps save order', () => {
    const store = emptyStore();
    store.create(sample('a'));
    store.create(sample('b'));
    expect(store.list().map((s) => s.combo.name)).toEqual(['a', 'b']);
  });

  it('returns copies, so callers cannot change stored data by mutation', () => {
    const store = emptyStore();
    store.create(sample());
    store.get('id-1')!.combo.steps[0]!.button = 'MP';
    store.list()[0]!.combo.name = 'mutated';
    expect(store.get('id-1')!.combo).toEqual(sample());
  });

  it('trims the name and drops unknown fields and blank labels', () => {
    const store = emptyStore();
    const messy = {
      ...sample('  padded  '),
      extra: 1,
      steps: [{ button: 'LP', targetFrame: 0, tolEarly: 0, tolLate: 0, label: '  ', junk: true }],
    } as unknown as Combo;
    expect(store.create(messy).combo).toEqual({
      ...sample('padded'),
      steps: [{ button: 'LP', targetFrame: 0, tolEarly: 0, tolLate: 0 }],
    });
  });

  it('rejects invalid combos and leaves storage unchanged', () => {
    const storage = memoryStorage();
    const store = emptyStore(storage);
    const before = storage.dump();
    expect(() => store.create({ ...sample(), name: ' ' })).toThrow(/name is required/);
    expect(() => store.create({ ...sample(), steps: [] })).toThrow(/at least one step/);
    expect(() => store.create({ ...sample(), fps: 0 })).toThrow(/fps/);
    expect(() =>
      store.create({ ...sample(), steps: [{ button: 'LP', targetFrame: 1.5, tolEarly: 0, tolLate: 0 }] }),
    ).toThrow(/targetFrame/);
    expect(() =>
      store.create({ ...sample(), steps: [{ button: 'LP', targetFrame: Number.NaN, tolEarly: 0, tolLate: 0 }] }),
    ).toThrow(/targetFrame/);
    expect(storage.dump()).toEqual(before);
  });

  it('never reuses an existing id', () => {
    const ids = ['dup', 'dup', 'fresh'];
    const store = new ComboStore(memoryStorage(), { examples: [], makeId: () => ids.shift()! });
    expect(store.create(sample()).id).toBe('dup');
    expect(store.create(sample()).id).toBe('fresh');
  });

  it('uses unique default ids', () => {
    const store = new ComboStore(memoryStorage(), { examples: [] });
    const a = store.create(sample()).id;
    const b = store.create(sample()).id;
    expect(a).not.toBe(b);
  });
});

describe('update (edit and rename)', () => {
  it('replaces a combo in place, keeping its position', () => {
    const store = emptyStore();
    store.create(sample('a'));
    store.create(sample('b'));
    store.update('id-1', { ...sample('renamed'), fps: 30 });
    expect(store.list().map((s) => [s.id, s.combo.name, s.combo.fps])).toEqual([
      ['id-1', 'renamed', 30],
      ['id-2', 'b', 120],
    ]);
  });

  it('throws for an unknown id or an invalid combo', () => {
    const store = emptyStore();
    store.create(sample());
    expect(() => store.update('nope', sample())).toThrow(/No saved combo/);
    expect(() => store.update('id-1', { ...sample(), name: '' })).toThrow(/name/);
    expect(store.get('id-1')!.combo).toEqual(sample());
  });
});

describe('delete', () => {
  it('removes a combo and reports whether anything was deleted', () => {
    const store = emptyStore();
    store.create(sample('a'));
    store.create(sample('b'));
    expect(store.delete('id-1')).toBe(true);
    expect(store.delete('id-1')).toBe(false);
    expect(store.list().map((s) => s.id)).toEqual(['id-2']);
  });

  it('clears the last-opened id when that combo is deleted', () => {
    const storage = memoryStorage();
    const store = emptyStore(storage);
    store.create(sample());
    store.create(sample());
    store.setLastOpened('id-2');
    store.delete('id-1');
    expect(store.lastOpenedId()).toBe('id-2');
    store.delete('id-2');
    expect(store.lastOpenedId()).toBeNull();
    expect(storage.getItem(LAST_OPENED_KEY)).toBeNull();
  });
});

describe('last opened', () => {
  it('round-trips and clears', () => {
    const storage = memoryStorage();
    emptyStore(storage).setLastOpened('abc');
    const store = emptyStore(storage);
    expect(store.lastOpenedId()).toBe('abc');
    store.setLastOpened(null);
    expect(store.lastOpenedId()).toBeNull();
  });
});

describe('damaged storage', () => {
  const good = { id: 'ok', combo: sample() };

  it('backs up unparseable JSON and starts empty without reseeding', () => {
    const storage = memoryStorage({ [COMBOS_KEY]: '{not json' });
    const store = new ComboStore(storage);
    expect(store.list()).toEqual([]);
    expect(storage.getItem(COMBOS_BACKUP_KEY)).toBe('{not json');
    expect(JSON.parse(storage.getItem(COMBOS_KEY)!)).toEqual({ version: 1, combos: [] });
  });

  it('backs up data with an unknown version', () => {
    const raw = JSON.stringify({ version: 2, combos: [good] });
    const storage = memoryStorage({ [COMBOS_KEY]: raw });
    expect(new ComboStore(storage).list()).toEqual([]);
    expect(storage.getItem(COMBOS_BACKUP_KEY)).toBe(raw);
  });

  it('keeps readable entries, drops bad ones, and backs up the original once', () => {
    const raw = JSON.stringify({
      version: 1,
      combos: [
        good,
        { id: 'bad-steps', combo: { ...sample(), steps: [] } },
        { id: 'bad-mode', combo: { ...sample(), timingMode: 'weird' } },
        { id: 'bad-label', combo: { ...sample(), steps: [{ button: 'LP', targetFrame: 0, tolEarly: 0, tolLate: 0, label: 5 }] } },
        { combo: sample() },
        { id: 'ok', combo: sample('duplicate id') },
        'junk',
      ],
    });
    const storage = memoryStorage({ [COMBOS_KEY]: raw });
    const store = new ComboStore(storage);
    expect(store.list()).toEqual([good]);
    expect(storage.getItem(COMBOS_BACKUP_KEY)).toBe(raw);

    // The cleaned data was written back, so a later read doesn't overwrite the backup.
    storage.setItem(COMBOS_BACKUP_KEY, 'earlier backup');
    expect(store.list()).toEqual([good]);
    expect(storage.getItem(COMBOS_BACKUP_KEY)).toBe('earlier backup');
  });

  it('does not write a backup for clean data', () => {
    const storage = memoryStorage({ [COMBOS_KEY]: JSON.stringify({ version: 1, combos: [good] }) });
    expect(new ComboStore(storage).list()).toEqual([good]);
    expect(storage.getItem(COMBOS_BACKUP_KEY)).toBeNull();
  });
});

describe('validateForSave / parseCombo', () => {
  it('adds a name check to the engine rules', () => {
    expect(validateForSave(newCombo())).toEqual([]);
    expect(validateForSave({ ...newCombo(), name: '' })).toEqual(['name is required']);
    expect(validateForSave({ ...newCombo(), name: '', steps: [] })).toEqual([
      'name is required',
      'combo must have at least one step',
    ]);
  });

  it('rejects wrong types', () => {
    expect(parseCombo(null)).toBeNull();
    expect(parseCombo([])).toBeNull();
    expect(parseCombo({ ...sample(), fps: '60' })).toBeNull();
    expect(parseCombo({ ...sample(), startMode: 'later' })).toBeNull();
    expect(parseCombo({ ...sample(), steps: [{ button: 1, targetFrame: 0, tolEarly: 0, tolLate: 0 }] })).toBeNull();
    expect(parseCombo(sample())).toEqual(sample());
  });
});
