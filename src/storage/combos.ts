// Saved combos in localStorage (SPEC §2, Layer 3). Storage is injected so this module can be
// tested without a browser.

import { cloneCombo } from '../combo/edit';
import { EXAMPLE_COMBOS, type ExampleCombo } from '../combo/examples';
import { validateCombo } from '../engine/attempt';
import type { Combo, Step } from '../engine/types';

/** The subset of the Web Storage API this module uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedCombo {
  id: string;
  combo: Combo;
}

export const COMBOS_KEY = 'uct.combos.v1';
/** Raw copy of stored data that could not be read in full, kept so nothing is lost silently. */
export const COMBOS_BACKUP_KEY = 'uct.combos.v1.backup';
export const LAST_OPENED_KEY = 'uct.lastComboId';

interface StoredData {
  version: 1;
  combos: SavedCombo[];
}

export interface ComboStoreOptions {
  /** Seeded when no combo data exists yet. Defaults to the shipped examples. */
  examples?: readonly ExampleCombo[];
  makeId?: () => string;
}

/** Problems that block saving: a blank name plus anything the engine would reject. */
export function validateForSave(combo: Combo): string[] {
  const errors: string[] = [];
  if (!combo.name.trim()) errors.push('name is required');
  return [...errors, ...validateCombo(combo)];
}

export class ComboStore {
  private readonly storage: StorageLike;
  private readonly makeId: () => string;

  constructor(storage: StorageLike, options: ComboStoreOptions = {}) {
    this.storage = storage;
    this.makeId = options.makeId ?? defaultMakeId;
    if (storage.getItem(COMBOS_KEY) === null) {
      const examples = options.examples ?? EXAMPLE_COMBOS;
      this.write(examples.map((e) => ({ id: e.id, combo: cloneCombo(e.combo) })));
    }
  }

  /** All saved combos, in save order. Returns copies. */
  list(): SavedCombo[] {
    return this.read().map(copy);
  }

  get(id: string): SavedCombo | undefined {
    const found = this.read().find((s) => s.id === id);
    return found && copy(found);
  }

  /** Saves a new combo under a fresh id. Throws if the combo is invalid. */
  create(combo: Combo): SavedCombo {
    const saved: SavedCombo = { id: this.uniqueId(), combo: normalize(combo) };
    this.write([...this.read(), saved]);
    return copy(saved);
  }

  /** Replaces the combo saved under `id`. Throws if it doesn't exist or is invalid. */
  update(id: string, combo: Combo): SavedCombo {
    const all = this.read();
    const index = all.findIndex((s) => s.id === id);
    if (index < 0) throw new Error(`No saved combo with id ${id}`);
    const saved: SavedCombo = { id, combo: normalize(combo) };
    all[index] = saved;
    this.write(all);
    return copy(saved);
  }

  /** Returns false if there was nothing to delete. */
  delete(id: string): boolean {
    const all = this.read();
    const rest = all.filter((s) => s.id !== id);
    if (rest.length === all.length) return false;
    this.write(rest);
    if (this.lastOpenedId() === id) this.storage.removeItem(LAST_OPENED_KEY);
    return true;
  }

  lastOpenedId(): string | null {
    return this.storage.getItem(LAST_OPENED_KEY);
  }

  setLastOpened(id: string | null): void {
    if (id === null) this.storage.removeItem(LAST_OPENED_KEY);
    else this.storage.setItem(LAST_OPENED_KEY, id);
  }

  // --- internals ----------------------------------------------------------

  private read(): SavedCombo[] {
    const raw = this.storage.getItem(COMBOS_KEY);
    if (raw === null) return [];
    const { combos, clean } = parseStored(raw);
    if (!clean) {
      // Keep the unreadable original, then rewrite what could be read so this happens once.
      this.storage.setItem(COMBOS_BACKUP_KEY, raw);
      this.write(combos);
    }
    return combos;
  }

  private write(combos: SavedCombo[]): void {
    const data: StoredData = { version: 1, combos };
    this.storage.setItem(COMBOS_KEY, JSON.stringify(data));
  }

  private uniqueId(): string {
    const taken = new Set(this.read().map((s) => s.id));
    let id = this.makeId();
    while (taken.has(id)) id = this.makeId();
    return id;
  }
}

/** An in-memory StorageLike, for tests and for browsers where localStorage is blocked. */
export function memoryStorage(initial: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    dump: () => Object.fromEntries(data),
  };
}

function defaultMakeId(): string {
  // crypto.randomUUID needs a secure context, which a LAN address over http isn't.
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function copy(s: SavedCombo): SavedCombo {
  return { id: s.id, combo: cloneCombo(s.combo) };
}

/** Validates and returns a clean copy with only known fields and a trimmed name. */
function normalize(combo: Combo): Combo {
  const errors = validateForSave(combo);
  if (errors.length > 0) throw new Error(`Invalid combo: ${errors.join('; ')}`);
  const parsed = parseCombo({ ...combo, name: combo.name.trim() });
  if (!parsed) throw new Error('Invalid combo');
  return parsed;
}

function parseStored(raw: string): { combos: SavedCombo[]; clean: boolean } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { combos: [], clean: false };
  }
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.combos)) {
    return { combos: [], clean: false };
  }
  const combos: SavedCombo[] = [];
  const seen = new Set<string>();
  let clean = true;
  for (const entry of data.combos) {
    const combo = isRecord(entry) ? parseCombo(entry.combo) : null;
    const id = isRecord(entry) ? entry.id : undefined;
    if (!combo || typeof id !== 'string' || !id || seen.has(id)) {
      clean = false;
      continue;
    }
    seen.add(id);
    combos.push({ id, combo });
  }
  return { combos, clean };
}

/** Builds a Combo from unknown data, or null if it isn't a valid, saveable combo. */
export function parseCombo(v: unknown): Combo | null {
  if (!isRecord(v) || typeof v.name !== 'string' || !Array.isArray(v.steps)) return null;
  if (typeof v.fps !== 'number') return null;
  if (v.timingMode !== 'relative' && v.timingMode !== 'absolute') return null;
  if (v.startMode !== 'firstInput' && v.startMode !== 'countdown') return null;
  const steps: Step[] = [];
  for (const s of v.steps) {
    const step = parseStep(s);
    if (!step) return null;
    steps.push(step);
  }
  const combo: Combo = { name: v.name, steps, fps: v.fps, timingMode: v.timingMode, startMode: v.startMode };
  return validateForSave(combo).length === 0 ? combo : null;
}

function parseStep(v: unknown): Step | null {
  if (!isRecord(v) || typeof v.button !== 'string') return null;
  const { targetFrame, tolEarly, tolLate, label } = v;
  if (typeof targetFrame !== 'number' || typeof tolEarly !== 'number' || typeof tolLate !== 'number') return null;
  if (label !== undefined && typeof label !== 'string') return null;
  const step: Step = { button: v.button, targetFrame, tolEarly, tolLate };
  if (label?.trim()) step.label = label;
  return step;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
