import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../../src/storage/combos';
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  saveSettings,
} from '../../src/storage/settings';

describe('app settings storage', () => {
  it('uses the defaults (sound off) when nothing is saved', () => {
    const st = memoryStorage();
    expect(loadSettings(st)).toEqual(DEFAULT_APP_SETTINGS);
    expect(DEFAULT_APP_SETTINGS.sound).toBe(false);
    expect(DEFAULT_APP_SETTINGS.metronome).toBe(false);
    expect(st.getItem(SETTINGS_KEY)).toBeNull();
  });

  it('round-trips saved settings', () => {
    const st = memoryStorage();
    const s = { strict: false, sound: true, metronome: true, volume: 0.25, latencyOffsetMs: { keyboard: 12.5, gamepad: -4 }, padBannerDismissed: true };
    saveSettings(st, s);
    expect(loadSettings(st)).toEqual(s);
  });

  it('falls back per field for missing or bad values', () => {
    const st = memoryStorage();
    st.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, strict: false, sound: 'yes', volume: 3 }));
    expect(loadSettings(st)).toEqual({ ...DEFAULT_APP_SETTINGS, strict: false });
  });

  it('keeps each latency offset only if it is a finite number within the limit', () => {
    const st = memoryStorage();
    st.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, latencyOffsetMs: { keyboard: 25, gamepad: 5000 } }));
    expect(loadSettings(st).latencyOffsetMs).toEqual({ keyboard: 25, gamepad: 0 });
    st.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, latencyOffsetMs: 'x' }));
    expect(loadSettings(st).latencyOffsetMs).toEqual({ keyboard: 0, gamepad: 0 });
  });

  it('uses the defaults for unreadable data or an unknown version', () => {
    const st = memoryStorage();
    st.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(st)).toEqual(DEFAULT_APP_SETTINGS);
    st.setItem(SETTINGS_KEY, JSON.stringify({ version: 2, sound: true }));
    expect(loadSettings(st)).toEqual(DEFAULT_APP_SETTINGS);
  });
});
