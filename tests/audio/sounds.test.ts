import { describe, expect, it } from 'vitest';
import { SOUNDS, SoundPlayer, toContextTime } from '../../src/audio/sounds';

describe('sounds', () => {
  it('converts performance.now() times to the audio clock', () => {
    expect(toContextTime(1500, 1000, 10)).toBeCloseTo(10.5);
    // Past times play right away rather than being scheduled before "now".
    expect(toContextTime(900, 1000, 10)).toBe(10);
  });

  it('every sound has at least one short, audible tone', () => {
    for (const tones of Object.values(SOUNDS)) {
      expect(tones.length).toBeGreaterThan(0);
      for (const t of tones) {
        expect(t.dur).toBeGreaterThan(0);
        expect(t.dur).toBeLessThanOrEqual(300);
        expect(t.gain).toBeGreaterThan(0);
        expect(t.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it('does nothing (and does not throw) without Web Audio', () => {
    const player = new SoundPlayer(() => null);
    expect(() => player.play('beat').cancel()).not.toThrow();
    expect(player.blocked).toBe(false);
    player.volume = 2;
    expect(player.volume).toBe(1);
  });
});
