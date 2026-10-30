// Saved input mapping in localStorage. Nothing is stored until the user changes a binding,
// so users on the defaults pick up any later change to the defaults.

import { DEFAULT_MAPPING, HAT_DIRECTIONS, type HatMapping, type InputMapping } from '../input/mapping';
import type { StorageLike } from './combos';

export const MAPPING_KEY = 'uct.mapping.v1';
/** Raw copy of a stored mapping that couldn't be read, so it isn't lost silently. */
export const MAPPING_BACKUP_KEY = 'uct.mapping.v1.backup';

/** The saved mapping, or the defaults if none is saved or it can't be read. */
export function loadMapping(storage: StorageLike): InputMapping {
  const raw = storage.getItem(MAPPING_KEY);
  if (raw === null) return DEFAULT_MAPPING;
  let parsed: InputMapping | null = null;
  try {
    parsed = parseMapping(JSON.parse(raw));
  } catch {
    parsed = null;
  }
  if (parsed) return parsed;
  storage.setItem(MAPPING_BACKUP_KEY, raw);
  storage.removeItem(MAPPING_KEY);
  return DEFAULT_MAPPING;
}

export function saveMapping(storage: StorageLike, mapping: InputMapping): void {
  storage.setItem(MAPPING_KEY, JSON.stringify({ version: 1, ...mapping }));
}

/** Forgets the saved mapping, going back to the defaults. */
export function resetMapping(storage: StorageLike): InputMapping {
  storage.removeItem(MAPPING_KEY);
  return DEFAULT_MAPPING;
}

/** Builds an InputMapping from unknown data, or null if anything in it is malformed. */
export function parseMapping(v: unknown): InputMapping | null {
  if (!isRecord(v) || v.version !== 1) return null;
  const keyboard = stringMap(v.keyboard, (k) => k.length > 0);
  const gamepad = stringMap(v.gamepad, (k) => /^\d+$/.test(k));
  const gamepadAxes = stringMap(v.gamepadAxes, (k) => /^\d+[+-]$/.test(k));
  if (!keyboard || !gamepad || !gamepadAxes || !isRecord(v.gamepadHats)) return null;

  const gamepadHats: Record<number, HatMapping> = {};
  for (const [axis, hat] of Object.entries(v.gamepadHats)) {
    if (!/^\d+$/.test(axis) || !isRecord(hat)) return null;
    const out: Partial<Record<(typeof HAT_DIRECTIONS)[number], string>> = {};
    for (const [dir, button] of Object.entries(hat)) {
      if (!(HAT_DIRECTIONS as readonly string[]).includes(dir) || !isButton(button)) return null;
      out[dir as (typeof HAT_DIRECTIONS)[number]] = button;
    }
    gamepadHats[Number(axis)] = out;
  }
  return { keyboard, gamepad, gamepadAxes, gamepadHats };
}

function stringMap(v: unknown, keyOk: (k: string) => boolean): Record<string, string> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, button] of Object.entries(v)) {
    if (!keyOk(k) || !isButton(button)) return null;
    out[k] = button;
  }
  return out;
}

const isButton = (b: unknown): b is string => typeof b === 'string' && b.length > 0;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
