// Saved app settings in localStorage: strict mode, sound, and latency offsets. Like the mapping,
// nothing is stored until the user changes something, so users on the defaults pick up later
// default changes.

import type { InputSource } from '../engine/types';
import type { StorageLike } from './combos';

/** Latency offsets beyond this (either way) are treated as a mistake and not loaded or saved. */
export const MAX_LATENCY_OFFSET_MS = 1000;

export interface AppSettings {
  /** A wrong button ends the attempt (SPEC §3). */
  strict: boolean;
  /** Event sounds: countdown beats, on time / off, clean / failed, control bound. */
  sound: boolean;
  /** A tick on each target frame during an attempt. */
  metronome: boolean;
  /** 0 to 1. */
  volume: number;
  /** Subtracted from press timestamps before grading, per source (SPEC §6). */
  latencyOffsetMs: Record<InputSource, number>;
}

/** Sound is off by default (SPEC §7). */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  strict: true,
  sound: false,
  metronome: false,
  volume: 0.6,
  latencyOffsetMs: { keyboard: 0, gamepad: 0 },
};

/** True for a usable latency offset: a finite number within ±MAX_LATENCY_OFFSET_MS. */
export const isLatencyOffset = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= MAX_LATENCY_OFFSET_MS;

export const SETTINGS_KEY = 'uct.settings.v1';

/**
 * The saved settings. A field that is missing or malformed falls back to its default on its
 * own, so one bad value doesn't reset the rest.
 */
export function loadSettings(storage: StorageLike): AppSettings {
  const raw = storage.getItem(SETTINGS_KEY);
  if (raw === null) return DEFAULT_APP_SETTINGS;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
  return parseSettings(v);
}

export function parseSettings(v: unknown): AppSettings {
  const d = DEFAULT_APP_SETTINGS;
  if (typeof v !== 'object' || v === null || (v as { version?: unknown }).version !== 1) return d;
  const r = v as Record<string, unknown>;
  const bool = (x: unknown, def: boolean) => (typeof x === 'boolean' ? x : def);
  const volume = typeof r.volume === 'number' && r.volume >= 0 && r.volume <= 1 ? r.volume : d.volume;
  const lat = typeof r.latencyOffsetMs === 'object' && r.latencyOffsetMs !== null ? (r.latencyOffsetMs as Record<string, unknown>) : {};
  return {
    strict: bool(r.strict, d.strict),
    sound: bool(r.sound, d.sound),
    metronome: bool(r.metronome, d.metronome),
    volume,
    latencyOffsetMs: {
      keyboard: isLatencyOffset(lat.keyboard) ? lat.keyboard : d.latencyOffsetMs.keyboard,
      gamepad: isLatencyOffset(lat.gamepad) ? lat.gamepad : d.latencyOffsetMs.gamepad,
    },
  };
}

export function saveSettings(storage: StorageLike, settings: AppSettings): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, ...settings }));
}
