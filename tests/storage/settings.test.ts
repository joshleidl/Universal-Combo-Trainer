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
    const s = { strict: false, sound: true, metronome: true, volume: 0.25 };
    saveSettings(st, s);
    expect(loadSettings(st)).toEqual(s);
  });

  it('falls back per field for missing or bad values', () => {
    const st = memoryStorage();
    st.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, strict: false, sound: 'yes', volume: 3 }));
    expect(loadSettings(st)).toEqual({ ...DEFAULT_APP_SETTINGS, strict: false });
  });

  it('uses the defaults for unreadable data or an unknown version', () => {
    const st = memoryStorage();
    st.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(st)).toEqual(DEFAULT_APP_SETTINGS);
    st.setItem(SETTINGS_KEY, JSON.stringify({ version: 2, sound: true }));
    expect(loadSettings(st)).toEqual(DEFAULT_APP_SETTINGS);
  });
});
