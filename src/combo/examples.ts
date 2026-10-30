// Example combos seeded into storage on first run (Layer 3). Game-agnostic drills, not
// frame data from any real game.

import type { Combo } from '../engine/types';

export interface ExampleCombo {
  id: string;
  combo: Combo;
}

export const EXAMPLE_COMBOS: readonly ExampleCombo[] = [
  {
    id: 'example-starter-links',
    combo: {
      name: 'Example: starter links',
      fps: 60,
      timingMode: 'relative',
      startMode: 'firstInput',
      steps: [
        { button: 'LP', targetFrame: 0, tolEarly: 0, tolLate: 0, label: 'st.LP' },
        { button: 'MP', targetFrame: 12, tolEarly: 2, tolLate: 2, label: 'st.MP' },
        { button: 'HP', targetFrame: 15, tolEarly: 2, tolLate: 2, label: 'st.HP' },
      ],
    },
  },
  {
    id: 'example-one-frame-link',
    combo: {
      name: 'Example: 1-frame link',
      fps: 60,
      timingMode: 'relative',
      startMode: 'firstInput',
      steps: [
        { button: 'LK', targetFrame: 0, tolEarly: 0, tolLate: 0, label: 'cr.LK' },
        { button: 'LK', targetFrame: 8, tolEarly: 1, tolLate: 1, label: 'cr.LK' },
        { button: 'MP', targetFrame: 10, tolEarly: 0, tolLate: 0, label: 'st.MP (1f link)' },
      ],
    },
  },
  {
    id: 'example-rhythm-drill',
    combo: {
      name: 'Example: absolute rhythm drill',
      fps: 60,
      timingMode: 'absolute',
      startMode: 'firstInput',
      steps: [
        { button: 'LP', targetFrame: 0, tolEarly: 0, tolLate: 0 },
        { button: 'LK', targetFrame: 15, tolEarly: 1, tolLate: 1 },
        { button: 'LP', targetFrame: 30, tolEarly: 1, tolLate: 1 },
        { button: 'LK', targetFrame: 45, tolEarly: 1, tolLate: 1 },
        { button: 'HP', targetFrame: 60, tolEarly: 1, tolLate: 1 },
      ],
    },
  },
];
