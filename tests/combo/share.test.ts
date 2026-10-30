import { describe, expect, it } from 'vitest';
import { MAX_SHARE_CODE_LENGTH, SHARE_PREFIX, decodeCombo, encodeCombo, shareCodeFromHash } from '../../src/combo/share';
import { EXAMPLE_COMBOS } from '../../src/combo/examples';
import type { Combo } from '../../src/engine/types';

const combo: Combo = {
  name: 'Ryu — cr.MK xx Hadōken 🔥',
  fps: 60,
  timingMode: 'absolute',
  startMode: 'countdown',
  steps: [
    { button: 'MK', targetFrame: 0, tolEarly: 1, tolLate: 2, label: 'cr.MK' },
    { button: 'HP', targetFrame: 7, tolEarly: 0, tolLate: 0 },
  ],
};
const json = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('share by URL', () => {
  it('round-trips a combo, including non-ASCII names and labels', () => {
    const code = encodeCombo(combo);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCombo(code)).toEqual(combo);
  });

  it('round-trips the shipped examples', () => {
    for (const ex of EXAMPLE_COMBOS) expect(decodeCombo(encodeCombo(ex.combo))).toEqual(ex.combo);
  });

  it('drops blank labels and names a nameless combo', () => {
    const c = { ...combo, name: '  ', steps: [{ ...combo.steps[0]!, label: '' }] };
    const out = decodeCombo(encodeCombo(c));
    expect(out?.name).toBe('Shared combo');
    expect(out?.steps[0]).not.toHaveProperty('label');
  });

  it('rejects damaged codes', () => {
    const code = encodeCombo(combo);
    expect(decodeCombo('')).toBeNull();
    expect(decodeCombo(code.slice(0, -6))).toBeNull();
    expect(decodeCombo('not base64!')).toBeNull();
    expect(decodeCombo('a'.repeat(MAX_SHARE_CODE_LENGTH + 1))).toBeNull();
  });

  it('rejects wrong shapes, unknown versions and invalid combos', () => {
    const ok = { v: 1, n: 'x', f: 60, t: 'r', s: 'f', p: [['LP', 0, 0, 0]] };
    expect(decodeCombo(json(ok))).not.toBeNull();
    expect(decodeCombo(json({ ...ok, v: 2 }))).toBeNull();
    expect(decodeCombo(json({ ...ok, t: 'x' }))).toBeNull();
    expect(decodeCombo(json({ ...ok, p: [['LP', '0', 0, 0]] }))).toBeNull();
    expect(decodeCombo(json({ ...ok, p: [['LP', 0, 0, 0, 5]] }))).toBeNull();
    expect(decodeCombo(json({ ...ok, p: [] }))).toBeNull(); // no steps
    expect(decodeCombo(json({ ...ok, p: [['LP', 1.5, 0, 0]] }))).toBeNull(); // engine validation
    expect(decodeCombo(json({ ...ok, f: 0 }))).toBeNull();
    expect(decodeCombo(json([1, 2]))).toBeNull();
  });

  it('reads the code from a share hash only', () => {
    expect(shareCodeFromHash(`${SHARE_PREFIX}abc`)).toBe('abc');
    expect(shareCodeFromHash('#practice')).toBeNull();
    expect(shareCodeFromHash('')).toBeNull();
  });
});
