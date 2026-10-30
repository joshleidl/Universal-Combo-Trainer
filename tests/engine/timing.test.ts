import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  correctedTimestamp,
  frameMs,
  frameToMs,
  gradeTiming,
  lastAcceptedFrame,
  msToFrame,
} from '../../src/engine/timing';
import type { Step } from '../../src/engine/types';

const step = (targetFrame: number, tolEarly = 0, tolLate = 0): Step => ({
  button: 'LP',
  targetFrame,
  tolEarly,
  tolLate,
});

describe('frame/ms conversion', () => {
  it('computes frame length for common fps', () => {
    expect(frameMs(30)).toBeCloseTo(33.3333, 4);
    expect(frameMs(60)).toBeCloseTo(16.6667, 4);
    expect(frameMs(120)).toBeCloseTo(8.3333, 4);
  });

  it.each([30, 60, 120, 144, 59.94])('lands exactly on every frame boundary at %s fps', (fps) => {
    for (let frame = 0; frame <= 600; frame++) {
      const start = frameToMs(frame, fps);
      expect(msToFrame(start, fps)).toBe(frame);
      expect(msToFrame(start - 0.001, fps)).toBe(frame - 1);
      expect(msToFrame(start + frameMs(fps) - 0.001, fps)).toBe(frame);
    }
  });

  it('floors negative elapsed times', () => {
    expect(msToFrame(-0.001, 60)).toBe(-1);
    expect(msToFrame(-16.67, 60)).toBe(-2);
  });
});

describe('gradeTiming', () => {
  it('grades the exact start of the target frame on time with zero deltas', () => {
    const g = gradeTiming(step(3), 50, 60);
    expect(g).toEqual({ grade: 'ON_TIME', inputFrame: 3, deltaFrames: 0, deltaMs: 0 });
  });

  it('treats any point inside the target frame as on time', () => {
    const g = gradeTiming(step(3), 66.6, 60);
    expect(g.grade).toBe('ON_TIME');
    expect(g.deltaMs).toBeCloseTo(16.6, 6);
  });

  it('grades 1 frame early and 1 frame late', () => {
    const early = gradeTiming(step(3), 49.99, 60);
    expect(early.grade).toBe('EARLY');
    expect(early.deltaFrames).toBe(-1);
    expect(early.deltaMs).toBeCloseTo(-0.01, 6);

    const late = gradeTiming(step(3), frameToMs(4, 60), 60);
    expect(late.grade).toBe('LATE');
    expect(late.deltaFrames).toBe(1);
    expect(late.deltaMs).toBeCloseTo(16.6667, 4);
  });

  it('applies tolerance windows at their edges', () => {
    const s = step(10, 2, 1);
    const at = (frame: number) => gradeTiming(s, frameToMs(frame, 60), 60).grade;
    expect(at(7)).toBe('EARLY');
    expect(at(8)).toBe('ON_TIME');
    expect(at(10)).toBe('ON_TIME');
    expect(at(11)).toBe('ON_TIME');
    expect(at(12)).toBe('LATE');
  });
});

describe('lastAcceptedFrame', () => {
  it('is target + tolLate + timeout', () => {
    expect(lastAcceptedFrame(step(3, 0, 2), 30)).toBe(35);
    expect(lastAcceptedFrame(step(0), 0)).toBe(0);
  });
});

describe('correctedTimestamp', () => {
  it('subtracts the offset for the press source', () => {
    const settings = { ...DEFAULT_SETTINGS, latencyOffsetMs: { keyboard: 12, gamepad: -5 } };
    expect(correctedTimestamp({ button: 'LP', timestamp: 100, source: 'keyboard' }, settings)).toBe(88);
    expect(correctedTimestamp({ button: 'LP', timestamp: 100, source: 'gamepad' }, settings)).toBe(105);
  });
});
