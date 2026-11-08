# Universal Combo Trainer

A browser app for practicing fighting game combo timing. You write down a combo as a list of button presses, say which frame each press should land on, and pick a framerate. Then you perform it on a keyboard or controller, and the app tells you how each press went: on time, early, or late, by how many frames and milliseconds (for example "2f late (+31.4 ms, +1.9f)").

It works with any game, because it never touches the game. It only measures your own inputs against the timing you set.

**Try it:** https://joshleidl.github.io/Universal-Combo-Trainer/

## Features

- **Combo editor:** add, remove and reorder steps; set each step's button, target frame, early/late tolerance and label. Save, rename and delete combos in your browser. Four example combos are included.
- **Chords:** a step can be two or more buttons pressed together (e.g. LP+LK), with its own chord window in frames or milliseconds.
- **Two timing modes:** *relative* (each step counts from the frame the previous press landed on, the way links are usually described) or *absolute* (every step counts from the start of the attempt).
- **Two start modes:** start on your first press, or start from a countdown.
- **Live feedback:** each step lights up as it's graded, plus a frame timeline of your last attempt and per-step session stats (on-time rate, other results, average and spread, streak).
- **Keyboard and gamepad:** works with arcade sticks, hitboxes and pads through the Gamepad API. Keys and pad controls can be remapped.
- **Latency calibration:** tap along to a beat to measure and subtract your setup's input delay, separately for keyboard and gamepad.
- **Sound (optional):** metronome ticks on target frames, on-time and miss sounds, and a "Hear timing" preview of the combo's rhythm.
- Built for desktop with a keyboard or controller; phone screens aren't supported.

## Default controls

| Button | Keyboard | Standard gamepad |
|---|---|---|
| LP / MP / HP / MISC1 | U / I / O / P | X / Y / RB / LB |
| LK / MK / HK / MISC2 | J / K / L / ; | A / B / RT / LT |
| Directions | W / A / S / D | D-pad |
| Restart attempt | Space | Back / Start |

Change them on the Controls page.

## How grading works

Frames are worked out from timestamps, not counted by a loop: at 60 fps, one frame is 16.67 ms. Each attempt has one fixed frame grid starting at frame 0. Like a game, the app reads input once per frame: everything pressed on one frame is judged together, and each result shows up when its frame ends. A press is **on time** if it lands within the step's tolerance of its target frame, **early** or **late** if it lands outside it, **wrong button** if you press a different button (in strict mode this ends the attempt), and **missed** if nothing arrives before the timeout. Chords are graded on the press that completes them, and can also come out **split** (one press early, another not) or **partial** (a button missing). The full rules are in [SPEC.md](SPEC.md) §3.

One known limit: browsers read gamepads by polling. The app polls every 4 ms while the page has focus and warns you if the measured rate is about one frame or slower. See [SPEC.md](SPEC.md) §5 for measurements.

## Running locally

Needs Node 24 (pinned in [mise.toml](mise.toml); `mise install` sets it up if you use [mise](https://mise.jdx.dev/)).

```sh
npm install
npm run dev        # start the dev server
npm test           # run the unit tests
npm run typecheck  # type-check
npm run build      # type-check and build static files into dist/
```

The same commands are available as mise tasks (`mise run dev`, `mise run test`, and so on).

## Project layout

TypeScript, Vite and Vitest, with plain DOM code for the UI and no framework or backend.

- `src/engine/`: the timing engine. Pure functions and an attempt state machine with no DOM, fully unit tested.
- `src/input/`: turns keyboard and gamepad activity into timestamped press events.
- `src/practice/`, `src/combo/`, `src/calibration/`: pure logic for practice sessions, combo editing and sharing, and calibration.
- `src/ui/`: DOM rendering only. It reads engine state and never does timing itself.
- `src/audio/`, `src/storage/`: Web Audio sounds and `localStorage` saving.
- `tests/`: unit tests, mirroring `src/`.

## Deploying

It's a static site. Every push to `main` deploys to GitHub Pages through [.github/workflows/deploy.yml](.github/workflows/deploy.yml). A [netlify.toml](netlify.toml) is also included if you'd rather use Netlify.

## Project docs

- [SPEC.md](SPEC.md): what the app is and the rules it follows.
- [DECISIONS.md](DECISIONS.md): decisions made along the way.
- [BACKLOG.md](BACKLOG.md): requested features and known bugs.
- [NEXT_SESSION.md](NEXT_SESSION.md): current status and what's next.
- [CLAUDE.md](CLAUDE.md): working conventions for Claude Code, which is used to develop this project.

## License

[MIT](LICENSE)
