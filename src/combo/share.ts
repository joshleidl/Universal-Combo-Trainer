// Share a combo by URL: the combo is packed into the link's hash (`#share=<code>`), so sharing
// needs no backend. Pure and unit tested; the code is base64url of compact JSON.

import { validateCombo } from '../engine/attempt';
import type { ChordWindow, Combo, Step } from '../engine/types';

export const SHARE_PREFIX = '#share=';
/** Longer codes are rejected rather than parsed (a real combo is far smaller). */
export const MAX_SHARE_CODE_LENGTH = 20_000;

/** Version 1 layout (before chords): each step is [button, target, early, late, label?]. Still decoded. */
type RowV1 = [string, number, number, number, string?];

/**
 * Version 2 layout: short keys keep links short. Each step is
 * [buttons, target, early, late, label?, chordWindow?]. `label` is '' when only a window follows;
 * the window is [size, 'f' | 'm'] (frames or ms) and is written for chords only.
 */
type RowV2 = [string[], number, number, number, string?, [number, 'f' | 'm']?];

interface Shared<Row> {
  v: 1 | 2;
  n: string;
  f: number;
  t: 'r' | 'a';
  s: 'f' | 'c';
  p: Row[];
}

export function encodeCombo(combo: Combo): string {
  const data: Shared<RowV2> = {
    v: 2,
    n: combo.name,
    f: combo.fps,
    t: combo.timingMode === 'absolute' ? 'a' : 'r',
    s: combo.startMode === 'countdown' ? 'c' : 'f',
    p: combo.steps.map((st) => {
      const row: RowV2 = [[...st.buttons], st.targetFrame, st.tolEarly, st.tolLate];
      const win = st.buttons.length > 1 ? st.chordWindow : undefined;
      if (st.label || win) row.push(st.label ?? '');
      if (win) row.push([win.size, win.unit === 'ms' ? 'm' : 'f']);
      return row;
    }),
  };
  return toBase64Url(JSON.stringify(data));
}

/** The combo in a share code, or null if the code is damaged or the combo is invalid. */
export function decodeCombo(code: string): Combo | null {
  if (code.length === 0 || code.length > MAX_SHARE_CODE_LENGTH) return null;
  let data: unknown;
  try {
    data = JSON.parse(fromBase64Url(code));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Partial<Record<keyof Shared<unknown>, unknown>>;
  if ((d.v !== 1 && d.v !== 2) || typeof d.n !== 'string' || typeof d.f !== 'number' || !Array.isArray(d.p)) return null;
  if (d.t !== 'r' && d.t !== 'a') return null;
  if (d.s !== 'f' && d.s !== 'c') return null;

  const steps: Step[] = [];
  for (const row of d.p) {
    const step = d.v === 1 ? decodeRowV1(row) : decodeRowV2(row);
    if (!step) return null;
    steps.push(step);
  }
  const combo: Combo = {
    name: d.n.trim() || 'Shared combo',
    steps,
    fps: d.f,
    timingMode: d.t === 'a' ? 'absolute' : 'relative',
    startMode: d.s === 'c' ? 'countdown' : 'firstInput',
  };
  return validateCombo(combo).length === 0 ? combo : null;
}

function decodeRowV1(row: unknown): Step | null {
  if (!Array.isArray(row) || row.length < 4 || row.length > 5) return null;
  const [button, ...rest] = row as unknown[];
  if (typeof button !== 'string') return null;
  return decodeTiming([button], rest, undefined);
}

function decodeRowV2(row: unknown): Step | null {
  if (!Array.isArray(row) || row.length < 4 || row.length > 6) return null;
  const [buttons, targetFrame, tolEarly, tolLate, label, win] = row as unknown[];
  if (!Array.isArray(buttons) || !buttons.every((b): b is string => typeof b === 'string')) return null;
  let chordWindow: ChordWindow | undefined;
  if (win !== undefined) {
    if (!Array.isArray(win) || win.length !== 2) return null;
    const [size, unit] = win as unknown[];
    if (typeof size !== 'number' || (unit !== 'f' && unit !== 'm')) return null;
    chordWindow = { size, unit: unit === 'm' ? 'ms' : 'frames' };
  }
  return decodeTiming(buttons, [targetFrame, tolEarly, tolLate, label], chordWindow);
}

/** The rest of a row: [target, early, late, label?]. */
function decodeTiming(buttons: string[], rest: unknown[], chordWindow: ChordWindow | undefined): Step | null {
  const [targetFrame, tolEarly, tolLate, label] = rest;
  if (typeof targetFrame !== 'number' || typeof tolEarly !== 'number' || typeof tolLate !== 'number') return null;
  if (label !== undefined && typeof label !== 'string') return null;
  const step: Step = { buttons: [...buttons], targetFrame, tolEarly, tolLate };
  if (label) step.label = label;
  if (chordWindow && buttons.length > 1) step.chordWindow = chordWindow;
  return step;
}

/** The share code in a location hash, or null if the hash isn't a share link. */
export function shareCodeFromHash(hash: string): string | null {
  return hash.startsWith(SHARE_PREFIX) ? hash.slice(SHARE_PREFIX.length) : null;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('not base64url');
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
