import { describe, expect, it } from 'vitest';
import { PAD_BANNER_START, PAD_DETECTED_MS, nextPadBanner, padDisplayName } from '../../src/input/wake';

const PAD = 'Qanba Obsidian (STANDARD GAMEPAD Vendor: 2c22 Product: 2000)';

describe('controller wake-up banner', () => {
  it('asks for a press while no pad is detected', () => {
    expect(nextPadBanner(PAD_BANNER_START, [], 0, false)).toEqual({ kind: 'waiting' });
    const waiting = nextPadBanner(PAD_BANNER_START, [], 0, false);
    expect(nextPadBanner(waiting, [], 100, false)).toBe(waiting);
  });

  it('confirms a pad that appears while asking, then hides', () => {
    const waiting = nextPadBanner(PAD_BANNER_START, [], 0, false);
    const detected = nextPadBanner(waiting, [PAD], 1000, false);
    expect(detected).toEqual({ kind: 'detected', name: 'Qanba Obsidian', until: 1000 + PAD_DETECTED_MS });
    expect(nextPadBanner(detected, [PAD], 1000 + PAD_DETECTED_MS - 1, false)).toBe(detected);
    const hidden = nextPadBanner(detected, [PAD], 1000 + PAD_DETECTED_MS, false);
    expect(hidden).toEqual({ kind: 'hidden' });
    expect(nextPadBanner(hidden, [PAD], 9999, false)).toBe(hidden);
  });

  it('shows nothing for a pad that is already there', () => {
    expect(nextPadBanner(PAD_BANNER_START, [PAD], 0, false)).toBe(PAD_BANNER_START);
  });

  it('asks again if every pad disconnects', () => {
    const hidden = nextPadBanner(PAD_BANNER_START, [PAD], 0, false);
    expect(nextPadBanner(hidden, [], 10, false)).toEqual({ kind: 'waiting' });
  });

  it('stays hidden once dismissed, and dismissing hides the request', () => {
    expect(nextPadBanner(PAD_BANNER_START, [], 0, true)).toBe(PAD_BANNER_START);
    const waiting = nextPadBanner(PAD_BANNER_START, [], 0, false);
    expect(nextPadBanner(waiting, [], 10, true)).toEqual({ kind: 'hidden' });
    // A pad connecting after dismissal shows nothing either.
    expect(nextPadBanner(PAD_BANNER_START, [PAD], 20, true)).toBe(PAD_BANNER_START);
  });

  it('makes readable pad names from Chrome and Firefox ids', () => {
    expect(padDisplayName(PAD)).toBe('Qanba Obsidian');
    expect(padDisplayName('2c22-2000-Qanba Obsidian')).toBe('Qanba Obsidian');
    expect(padDisplayName('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('Xbox 360 Controller');
    expect(padDisplayName('(weird)')).toBe('(weird)');
    expect(padDisplayName('  ')).toBe('Controller');
  });
});
