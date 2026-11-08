// The frame layer (SPEC §3 "Frames", §4 "Engine API: frames"): grouping inputs by grid frame
// into frame records. Not wired into the attempt yet (plan milestone M2).

import { describe, expect, it } from 'vitest';
import {
  addInput,
  clearOrigin,
  closeBefore,
  createFrames,
  lastClosedFrame,
  setOrigin,
  type FrameBuffer,
  type FrameRecord,
} from '../../src/engine/frames';
import { frameToMs } from '../../src/engine/timing';
import type { ButtonId, InputSource } from '../../src/engine/types';

const T0 = 1000;
/** ms timestamp `ms` into grid frame `frame` (frame 0 = T0), at 60 fps. */
const at = (frame: number, ms = 5) => T0 + frameToMs(frame, 60) + ms;

type Input = { down: boolean; button: ButtonId; timestamp: number; source?: InputSource };
const D = (button: ButtonId, timestamp: number): Input => ({ down: true, button, timestamp });
const U = (button: ButtonId, timestamp: number): Input => ({ down: false, button, timestamp });

/** Feeds inputs (corrected time = raw time) and collects every record that closed. */
function feed(buf: FrameBuffer, inputs: Input[]): { buf: FrameBuffer; closed: FrameRecord[] } {
  const closed: FrameRecord[] = [];
  for (const { down, button, timestamp, source = 'keyboard' } of inputs) {
    const out = addInput(buf, { button, timestamp, source }, timestamp, down);
    buf = out.buf;
    if (out.closed) closed.push(out.closed);
  }
  return { buf, closed };
}

/** Feeds inputs, then closes everything up to and including `frame`. */
function records(inputs: Input[], { held = [] as ButtonId[], through = 100 } = {}): FrameRecord[] {
  const { buf, closed } = feed(setOrigin(createFrames(60, held), T0), inputs);
  const last = closeBefore(buf, through + 1).closed;
  return last ? [...closed, last] : closed;
}

const only = (rs: FrameRecord[]): FrameRecord => {
  expect(rs).toHaveLength(1);
  return rs[0] as FrameRecord;
};
const pressed = (r: FrameRecord) => r.presses.map((p) => p.button);

describe('grid and closing', () => {
  it('only changes the held set while there is no origin', () => {
    const { buf, closed } = feed(createFrames(60), [D('RIGHT', 900), D('LP', 950)]);
    expect(closed).toEqual([]);
    expect(buf.held).toEqual(['RIGHT', 'LP']);
    expect(closeBefore(buf, 50).closed).toBeNull();
    expect(lastClosedFrame(buf)).toBeNull();
  });

  it('groups inputs by the frame they land on and closes a frame when a later frame gets an input', () => {
    const buf = setOrigin(createFrames(60), T0);
    const a = feed(buf, [D('LP', at(10, 1)), D('MP', at(10, 9))]);
    expect(a.closed).toEqual([]);
    const b = feed(a.buf, [D('HP', at(11, 2))]);
    const r = only(b.closed);
    expect(r.frame).toBe(10);
    expect(r.events.map((e) => [e.button, e.down])).toEqual([['LP', true], ['MP', true]]);
    expect(pressed(r)).toEqual(['LP', 'MP']);
    expect(lastClosedFrame(b.buf)).toBe(10);
  });

  it('closes the open frame by time: closeBefore(n) closes frames before n only', () => {
    const { buf } = feed(setOrigin(createFrames(60), T0), [D('LP', at(10))]);
    expect(closeBefore(buf, 10).closed).toBeNull();
    const out = closeBefore(buf, 11);
    expect(out.closed?.frame).toBe(10);
    expect(lastClosedFrame(out.buf)).toBe(10);
    // Nothing left to close; time still moves on.
    const later = closeBefore(out.buf, 40);
    expect(later.closed).toBeNull();
    expect(lastClosedFrame(later.buf)).toBe(39);
  });

  it('counts an input on a frame boundary on the later frame', () => {
    const r = records([D('LP', T0 + frameToMs(3, 60))]);
    expect(only(r).frame).toBe(3);
  });

  it('opening frame n closes the empty frames before it', () => {
    const { buf } = feed(setOrigin(createFrames(60), T0), [D('LP', at(7))]);
    expect(lastClosedFrame(buf)).toBe(6);
  });

  it('puts an input whose time falls on an already closed frame on the open frame, keeping its ms', () => {
    let buf = setOrigin(createFrames(60), T0);
    buf = closeBefore(buf, 12).buf; // frames up to 11 are closed
    const t = at(9);
    const out = feed(buf, [D('LP', t)]);
    const rec = closeBefore(out.buf, 13).closed as FrameRecord;
    expect(rec.frame).toBe(12);
    expect(rec.presses[0]?.t).toBe(t);
  });

  it('has negative frames before the origin', () => {
    const r = records([D('LP', T0 - 20)]);
    expect(only(r).frame).toBe(-2);
  });

  it('clearOrigin drops the grid and keeps the held set', () => {
    const { buf } = feed(setOrigin(createFrames(60), T0), [D('LP', at(0)), D('RIGHT', at(0, 8))]);
    const closed = closeBefore(buf, 1).buf;
    const cleared = clearOrigin(closed);
    expect(cleared.held).toEqual(['LP', 'RIGHT']);
    expect(lastClosedFrame(cleared)).toBeNull();
    expect(feed(cleared, [U('LP', at(4))]).closed).toEqual([]);
  });

  it('setOrigin starts a fresh grid', () => {
    let buf = setOrigin(createFrames(60), T0);
    buf = closeBefore(buf, 20).buf;
    buf = setOrigin(buf, T0 + 1000);
    expect(lastClosedFrame(buf)).toBeNull();
  });

  it('is pure: the old buffer is unchanged', () => {
    const buf = setOrigin(createFrames(60), T0);
    const before = JSON.stringify(buf);
    feed(buf, [D('LP', at(1)), D('MP', at(2))]);
    expect(JSON.stringify(buf)).toBe(before);
  });
});

describe('the press rule', () => {
  it('F3: a tap pressed and released inside one frame registers', () => {
    const r = only(records([D('LP', 1171), U('LP', 1178)]));
    expect(r.frame).toBe(10);
    expect(pressed(r)).toEqual(['LP']);
    expect(r.held).toEqual([]);
  });

  it('F5: a double tap on one frame is one press, timed from the last down event', () => {
    const r = only(records([D('LP', 1170), U('LP', 1174), D('LP', 1179)]));
    expect(r.presses).toHaveLength(1);
    expect(r.presses[0]?.t).toBe(1179);
    expect(r.presses[0]?.ev.timestamp).toBe(1179);
    expect(r.lostRepresses).toEqual([]);
  });

  it('counts a button once per frame even with repeated down events', () => {
    const r = only(records([D('LP', at(4, 1)), D('LP', at(4, 6))]));
    expect(r.presses).toHaveLength(1);
    expect(r.presses[0]?.t).toBe(at(4, 6));
  });

  it('orders presses by each button\'s first down event', () => {
    const r = only(records([D('MP', at(4, 1)), D('LP', at(4, 2)), U('MP', at(4, 3)), D('MP', at(4, 4))]));
    expect(pressed(r)).toEqual(['MP', 'LP']);
    expect(r.presses[0]?.t).toBe(at(4, 4));
  });

  it('F4: a held button released and pressed again on one frame is a lost re-press, not a press', () => {
    // LP was pressed on frame 0 and held through frame 9.
    const r = records([D('LP', at(0)), U('LP', 1170), D('LP', 1176)]);
    expect(r.map((x) => x.frame)).toEqual([0, 10]);
    const f10 = r[1] as FrameRecord;
    expect(f10.presses).toEqual([]);
    expect(f10.lostRepresses.map((p) => [p.button, p.t])).toEqual([['LP', 1176]]);
    expect(f10.held).toEqual(['LP']);
  });

  it('a lost re-press is timed from its last down event', () => {
    const r = only(records([U('LP', at(3, 1)), D('LP', at(3, 2)), U('LP', at(3, 3)), D('LP', at(3, 4))], { held: ['LP'] }));
    expect(r.lostRepresses).toHaveLength(1);
    expect(r.lostRepresses[0]?.t).toBe(at(3, 4));
  });

  it('a button held at arm gives no press until it is released and pressed again', () => {
    const r = records([D('LP', at(2)), U('LP', at(5)), D('LP', at(8))], { held: ['LP'] });
    // Frame 2: a down event for a held button (e.g. a second source) is neither a press nor a lost re-press.
    expect(r.map((x) => [x.frame, pressed(x), x.lostRepresses.length])).toEqual([
      [2, [], 0],
      [5, [], 0],
      [8, ['LP'], 0],
    ]);
  });

  it('a press on frame n needs the button up at the end of n−1, not at its start', () => {
    // Pressed on 3 and released on 4: frame 4 sees LP held at the end of 3, so its down is lost.
    const r = records([D('LP', at(3)), U('LP', at(4, 1)), D('LP', at(4, 5)), U('LP', at(4, 9))]);
    expect(r.map((x) => [x.frame, pressed(x), x.lostRepresses.map((p) => p.button)])).toEqual([
      [3, ['LP'], []],
      [4, [], ['LP']],
    ]);
  });

  it('remembers direction presses with the buttons', () => {
    const r = only(records([D('RIGHT', at(10, 1)), D('MP', at(10, 4))]));
    expect(pressed(r)).toEqual(['RIGHT', 'MP']);
  });
});

describe('end state and reports', () => {
  it('records the held set and SOCD position at the frame\'s end', () => {
    const r = only(records([D('DOWN', at(2, 1)), D('RIGHT', at(2, 3)), D('LP', at(2, 5))]));
    expect(r.held).toEqual(['DOWN', 'RIGHT', 'LP']);
    expect(r.position).toBe(3);
    expect(r.opposites).toEqual([]);
  });

  it('F6: a direction pressed and released on the frame is a direction tap', () => {
    const r = only(records([D('RIGHT', 1168), D('MP', 1171), U('RIGHT', 1175)]));
    expect(r.position).toBe(5);
    expect(r.directionTaps).toEqual(['RIGHT']);
  });

  it('a direction still held at the frame\'s end is not a tap', () => {
    const r = only(records([D('RIGHT', 1168), D('MP', 1171)]));
    expect(r.directionTaps).toEqual([]);
  });

  it('F7: opposite directions held at the frame\'s end resolve to neutral and are flagged', () => {
    const r = only(records([D('MP', 1170)], { held: ['LEFT', 'RIGHT'] }));
    expect(r.position).toBe(5);
    expect(r.opposites).toEqual(['LEFT_RIGHT']);
  });

  it('flags both opposite pairs', () => {
    const r = only(records([D('UP', at(1, 1)), D('DOWN', at(1, 2))], { held: ['LEFT', 'RIGHT'] }));
    expect(r.opposites).toEqual(['LEFT_RIGHT', 'UP_DOWN']);
  });

  it('keeps raw and corrected timestamps and the source on events', () => {
    const buf = setOrigin(createFrames(60), T0);
    const out = addInput(buf, { button: 'LP', timestamp: at(2) + 8, source: 'gamepad' }, at(2), true);
    const rec = closeBefore(out.buf, 3).closed as FrameRecord;
    expect(rec.events[0]).toEqual({ button: 'LP', down: true, ev: { button: 'LP', timestamp: at(2) + 8, source: 'gamepad' }, t: at(2) });
    expect(rec.presses[0]?.t).toBe(at(2));
  });
});
