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
        { buttons: ['LP'], targetFrame: 0, tolEarly: 0, tolLate: 0, label: 'st.LP' },
        { buttons: ['MP'], targetFrame: 12, tolEarly: 2, tolLate: 2, label: 'st.MP' },
        { buttons: ['HP'], targetFrame: 15, tolEarly: 2, tolLate: 2, label: 'st.HP' },
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
        { buttons: ['LK'], direction: 2, directionMatch: 'atLeast', targetFrame: 0, tolEarly: 0, tolLate: 0, label: 'cr.LK' },
        { buttons: ['LK'], direction: 2, directionMatch: 'atLeast', targetFrame: 8, tolEarly: 1, tolLate: 1, label: 'cr.LK' },
        { buttons: ['MP'], targetFrame: 10, tolEarly: 0, tolLate: 0, label: 'st.MP (1f link)' },
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
        { buttons: ['LP'], targetFrame: 0, tolEarly: 0, tolLate: 0 },
        { buttons: ['LK'], targetFrame: 15, tolEarly: 1, tolLate: 1 },
        { buttons: ['LP'], targetFrame: 30, tolEarly: 1, tolLate: 1 },
        { buttons: ['LK'], targetFrame: 45, tolEarly: 1, tolLate: 1 },
        { buttons: ['HP'], targetFrame: 60, tolEarly: 1, tolLate: 1 },
      ],
    },
  },
  {
    id: 'example-chord-link',
    combo: {
      name: 'Example: chord link',
      fps: 60,
      timingMode: 'relative',
      startMode: 'firstInput',
      steps: [
        { buttons: ['MK'], direction: 2, directionMatch: 'atLeast', targetFrame: 0, tolEarly: 0, tolLate: 0, label: 'cr.MK' },
        {
          buttons: ['LP', 'LK'],
          targetFrame: 12,
          tolEarly: 1,
          tolLate: 1,
          chordWindow: { size: 2, unit: 'frames' },
          label: 'chord',
        },
        { buttons: ['HP'], targetFrame: 14, tolEarly: 1, tolLate: 1, label: 'st.HP' },
      ],
    },
  },
  {
    // A crouching normal (↓ at least: ↙ and ↘ count too), a command normal that needs → exactly
    // (↘ would be a different move), then a standing normal that needs the stick back at neutral.
    id: 'example-command-normal',
    combo: {
      name: 'Example: command normal',
      fps: 60,
      timingMode: 'relative',
      startMode: 'firstInput',
      steps: [
        { buttons: ['LP'], direction: 2, directionMatch: 'atLeast', targetFrame: 0, tolEarly: 0, tolLate: 0, label: 'cr.LP' },
        { buttons: ['MP'], direction: 6, directionMatch: 'exact', targetFrame: 10, tolEarly: 1, tolLate: 1, label: 'command normal' },
        { buttons: ['HP'], directionMatch: 'exact', targetFrame: 18, tolEarly: 1, tolLate: 1, label: 'st.HP' },
      ],
    },
  },
];
