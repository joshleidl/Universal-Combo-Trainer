# Combo Timing Trainer: Project Spec

## 1. Purpose

A browser app for practicing fighting game combo timing. The user defines a sequence of button inputs, the target frame for each input, and a target framerate. They then perform the sequence and receive per-input feedback: early, late, or on time, by how many frames (and milliseconds).

The tool is game-agnostic. It does not read or hook into any game; it only measures the user's own inputs against the timing they defined.

## 2. Tech stack (decided, do not change without updating this spec)

- **Language:** TypeScript (strict mode)
- **Build tool:** Vite
- **UI:** Vanilla TypeScript + DOM. No UI framework. If one is added later, the timing engine and input layer must stay framework-free modules that the UI only reads from.
- **Tests:** Vitest
- **Hosting:** Static files only (GitHub Pages / Netlify). No backend.
- **Persistence:** `localStorage` for saved combos and settings. Share-by-URL is a later, optional feature.

## 3. Core concepts and definitions

### Frame timing
- `fps` is user-set (default **60**). Common presets: 30, 60, 120.
- `frameMs = 1000 / fps`.
- All internal timing uses millisecond timestamps from `performance.now()` (or `KeyboardEvent.timeStamp`, which shares the same clock). Frames are derived from milliseconds, never counted by a loop.

### Combo definition
A **combo** is an ordered list of **steps**. Each step has:
- `button`: the input to press (a mapped button ID, e.g. `LP`, `HK`, `UP`)
- `targetFrame`: integer frame the input should land on
- `tolEarly`: frames early still counted as on time (default 0)
- `tolLate`: frames late still counted as on time (default 0)
- `label` (optional): display name, e.g. "cr.MK"

Combo-level settings:
- `fps`
- `timingMode`:
  - `relative` (**default**): each step's `targetFrame` is measured from the **previous step's actual input**. Matches how links are usually described ("a 3-frame gap after the last hit").
  - `absolute`: each step's `targetFrame` is measured from the attempt's frame 0.
- `startMode`:
  - `firstInput` (**default**): the first step's press defines frame 0 and is always graded on time (button correctness only).
  - `countdown`: a visual/audio countdown defines frame 0, and step 1 is graded against its `targetFrame` like any other step.

### Grading (per step)
1. `elapsedMs` = input timestamp − reference timestamp (previous input or frame 0, per `timingMode`), after applying the latency offset (§6).
2. `inputFrame = floor(elapsedMs / frameMs)`.
3. `deltaFrames = inputFrame − targetFrame`.
4. Result:
   - `ON_TIME` if `−tolEarly ≤ deltaFrames ≤ tolLate`
   - `EARLY` if `deltaFrames < −tolEarly`
   - `LATE` if `deltaFrames > tolLate`
   - `WRONG_BUTTON` if a different mapped button is pressed while this step is awaited
   - `MISSED` if no input arrives within `targetFrame + tolLate + timeoutFrames` (default timeout 30 frames)
5. Always report `deltaFrames` and raw `deltaMs` (relative to the start of the target frame) so feedback can show "2f late (+31.4 ms)".

### Input rules
- Only the **press edge** counts (button goes from up to down). Holds and key auto-repeat are ignored.
- **Strict mode** (default on): a wrong button ends the attempt with `WRONG_BUTTON`. With strict mode off, wrong presses are logged but ignored, and the step keeps waiting.
- An attempt ends when all steps are graded, on `MISSED`, or on a strict-mode `WRONG_BUTTON`.

## 4. Architecture

```
src/
  engine/        # pure timing logic, no DOM; fully unit tested
    types.ts       Combo, Step, Settings, StepResult, AttemptResult
    timing.ts      frame/ms conversion, grading function
    attempt.ts     attempt state machine: idle → armed → running → done
  input/         # converts keyboard + gamepad into timestamped press events
    keyboard.ts
    gamepad.ts
    mapping.ts     raw key/button → button ID; user-remappable
  ui/            # DOM rendering only; reads engine state, never owns timing
    editor.ts      combo builder
    practice.ts    run attempts, show live feedback
    results.ts     timeline + stats
    calibrate.ts   latency calibration screen
  storage/
    combos.ts      save/load via localStorage
  main.ts
tests/
  engine/*.test.ts
```

Rules:
- `engine/` has no imports from `input/` or `ui/`. It accepts `{ button, timestamp }` press events and returns results. This makes it testable with synthetic timestamps.
- `input/` emits press events in a common shape regardless of source.
- `ui/` never computes timing itself.

## 5. Input sources

### Keyboard
- Use `keydown` with `event.timeStamp`; ignore `event.repeat`.
- Default mapping provided (e.g. U/I/O = LP/MP/HP, J/K/L = LK/MK/HK, WASD = directions), remappable.

### Gamepad (Gamepad API)
- Poll `navigator.getGamepads()` every `requestAnimationFrame`. Detect press edges by comparing to the previous poll.
- Timestamp each press with `gamepad.timestamp` when it changed, otherwise `performance.now()` at poll time.
- **Known limitation:** polling resolution is tied to the display refresh rate (~16.7 ms at 60 Hz), which is about one game frame at 60 fps. Layer 2 must measure and display the actual observed polling interval, and the UI must warn the user when resolution is coarser than one target frame. Investigate whether faster polling is reliable in current browsers and document findings here.

## 6. Latency calibration
- A calibration screen plays a steady visual + audio beat; the user taps along for ~20 beats.
- Compute the median offset between beat and press; store as `latencyOffsetMs` per input source (keyboard vs gamepad).
- The offset is subtracted from input timestamps before grading. User can also set it manually or set it to 0.

## 7. Feedback and UI

- **Practice view:** shows the combo as a row of steps. Each step lights up as it is graded, colored by result (on time / early / late / wrong / missed) with "±Nf (±X ms)".
- **Timeline view:** a horizontal frame ruler showing target windows vs actual inputs for the last attempt.
- **Session stats:** per-step on-time rate, average and spread of `deltaFrames`, and a running streak. Reset per session.
- **Optional audio:** a metronome tick on target frames and distinct sounds for on-time vs miss. Off by default.
- Quick restart key (e.g. Space or a gamepad button) to re-arm immediately.
- Must be usable at phone width, though desktop with keyboard/controller is the primary target.

## 8. Build layers

Implement **one layer at a time**. At the end of each layer: tests pass, the app runs, and you stop and summarize for review before starting the next.

### Layer 1: Timing engine
- `engine/` modules and types per §3–4.
- Unit tests with synthetic timestamps covering: on-time at exact frame boundaries, 1f early/late, tolerance windows, relative vs absolute mode, both start modes, wrong button (strict on/off), missed/timeout, multiple fps values (30/60/120), and the latency offset.
- No UI beyond a placeholder page.

**Done when:** all engine tests pass and grading matches §3 exactly.

### Layer 2: Input layer
- Keyboard and gamepad press events per §5, with mapping.
- A debug page showing live presses, timestamps, and measured gamepad polling interval.

**Done when:** presses from both sources appear with correct timestamps; repeats/holds are ignored.

### Layer 3: Sequence editor + storage
- Add/remove/reorder steps; edit button, target frame, tolerances, label; combo-level settings.
- Save, load, rename, delete combos in `localStorage`. Ship 2–3 example combos.

**Done when:** a combo can be created, saved, reloaded after refresh, and edited.

### Layer 4: Practice mode + feedback
- Wire editor → engine → input → practice view with live per-step feedback, timeline view, and session stats.

**Done when:** a full attempt can be performed with keyboard or gamepad and results display correctly.

### Layer 5: Polish
- Latency calibration screen (§6), audio cues, countdown start mode UI, input remapping UI, mobile layout pass, deploy config for static hosting.
- Optional: share combo via URL.

## 9. Out of scope (for now)
- Motion inputs (quarter-circles, charge inputs) and simultaneous multi-button presses. Design types so these can be added later (e.g. a step could become a list of required inputs within a chord window).
- Reading game memory or game frame data.
- Accounts, online leaderboards, any backend.

## Decisions log

### Layer 1 (2026-10-29)
- **Tooling versions:** TypeScript 7, Vite 8, Vitest 5. `tsconfig` adds `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on top of `strict`.
- **Engine API shape:** pure functions over an immutable `AttemptState`: `createAttempt(combo, settings)`, `arm`, `start(state, frame0)`, `press(state, event)`, `tick(state, now)`, `attemptResult(state)`, `currentStepIndex(state)`. A call that doesn't fit the current phase returns the state unchanged. `arm()` on a `done` attempt returns a fresh armed attempt (quick restart).
- **Where settings live:** `fps`, `timingMode` and `startMode` sit on `Combo`. `strict`, `timeoutFrames` and `latencyOffsetMs` (per source) sit on a separate `Settings` object (defaults: strict, 30, 0/0).
- **Press events carry `source`** (`keyboard` | `gamepad`) so the engine can apply the right latency offset.
- **Frame math:** `inputFrame` is computed as `floor(elapsedMs * fps / 1000 + 1e-9)`. This is the same as §3's formula, but it avoids float error at exact frame boundaries (e.g. 50 ms at 60 fps is frame 3).
- **Validation:** `createAttempt` throws unless there is at least one step, `fps > 0`, `targetFrame`/`tolEarly`/`tolLate`/`timeoutFrames` are integers ≥ 0, and every step has a button.
- **MISSED window:** the last accepted frame is `targetFrame + tolLate + timeoutFrames` (inclusive). In relative mode it is measured from the previous input, like grading. A press after the window grades the step `MISSED` (no timing fields) whatever its button, so the result is the same whether or not `tick()` ran first. A miss takes priority over a wrong button.
- **`tick(now)`** takes a raw timestamp and subtracts the *largest* latency offset, so it never declares a miss while a press that would still count could arrive.
- **firstInput start:** a wrong first press is `WRONG_BUTTON` (strict) or ignored and logged (non-strict). The first correct press gets `elapsedMs`, `inputFrame`, `deltaFrames` and `deltaMs` all 0.
- **Countdown start:** frame 0 is the timestamp passed to `start()` and is not latency-corrected (it is a stimulus time, not an input). Presses before `start()` are ignored. `start()` may be given a future time; presses before it grade `EARLY` with negative frames.
- **WRONG_BUTTON results** keep the press and its timing fields (frame, delta), so the timeline can show where the wrong press landed.
- **Attempt success** means it completed with every step `ON_TIME`.
