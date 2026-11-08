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
- **Persistence:** `localStorage` for saved combos and settings. Share-by-URL was built in Layer 5 and **dropped on 2026-11-02**; it will be added back later (BACKLOG, "Bring back share links").

## 3. Core concepts and definitions

### Frame timing
- `fps` is user-set (default **60**). Common presets: 30, 60, 120.
- `frameMs = 1000 / fps`.
- All internal timing uses millisecond timestamps from `performance.now()` (or `KeyboardEvent.timeStamp`, which shares the same clock). Frames are derived from milliseconds, never counted by a loop.

### Combo definition
A **combo** is an ordered list of **steps**. Each step has:
- `buttons`: the button(s) to press (mapped button IDs, e.g. `LP`, `HK`). One button is a normal step. Two or more is a **chord**: all of them must be pressed within the chord window, in any order (see "Chords"). Directions (`UP`, `DOWN`, `LEFT`, `RIGHT`) are never in `buttons`; they are set with `direction`. (Single-direction steps such as `['DOWN']` were removed on 2026-11-02; see "Saved data" in §4.)
- `direction` (optional): a stick position in numpad layout: 1 ↙, 2 ↓, 3 ↘, 4 ←, 6 →, 7 ↖, 8 ↑, 9 ↗. 5 (neutral) is never stored; "neutral required" is a plain step set to `exact`.
  - The position must be held when the button (or the chord's last button) lands (see "Directions").
  - A step with a direction and no buttons (a "position step") is out of scope (§9).
- `directionMatch` (optional, default `atLeast`): `exact` or `atLeast`.
  - `exact`: the held position must be exactly `direction`. On a plain step (no `direction`), the stick must be neutral.
  - `atLeast`: every direction in `direction` must be held, and others may be too (at least ↓ accepts ↙ ↓ ↘). On a plain step, anything is accepted (the behavior before directions existed).
  - The editor defaults new direction steps to `exact` and new plain steps to `atLeast`.
- `chordWindow` (chords only, required for them): how far apart a chord's presses may be, as `{ size, unit }`. `unit` is `frames` (grid frames, the same grid grading uses; `size` is an integer ≥ 0) or `ms` (corrected timestamps; `size` is a number ≥ 0; presses on the same frame always fit, see "Chords"). Default for a new chord in the editor: 2 frames.
- `targetFrame`: integer frame the input should land on
- `tolEarly`: frames early still counted as on time (default 0)
- `tolLate`: frames late still counted as on time (default 0)
- `label` (optional): display name, e.g. "cr.MK"

Validation: a step needs at least one button; `direction` is an integer 1–9 other than 5; `directionMatch` is `exact` or `atLeast`; no direction IDs in `buttons`; no button twice.

Combo-level settings:
- `fps`
- `timingMode`:
  - `relative` (**default**): each step's `targetFrame` is counted from the **frame the previous step's input landed on**. Matches how links are usually described ("a 3-frame gap after the last hit"). Frames form one fixed grid per attempt that starts at frame 0; presses never move it (see [DECISIONS.md](DECISIONS.md), "Fixed frame grid").
  - `absolute`: each step's `targetFrame` is measured from the attempt's frame 0.
- `startMode`:
  - `firstInput` (**default**): the first step's press defines frame 0 and is always graded on time (button correctness only).
  - `countdown`: a visual/audio countdown defines frame 0, and step 1 is graded against its `targetFrame` like any other step.

### Frames
Added 2026-11-08 from [docs/proposals/2026-11-08-frame-based-inputs-spec.md](docs/proposals/2026-11-08-frame-based-inputs-spec.md). Inputs are grouped by the grid frame they land on, and grading reads one closed frame at a time, the way a fighting game reads its input once per frame. The modeled game is generic: it remembers every button press during a frame and reads the stick's held position at the frame's end. Matching a specific game's frame phase is out of scope.

- **Grid.** One fixed grid per attempt, starting at frame 0 (the first button press in first-input mode, Go in countdown mode). An input lands on grid frame `floor((corrected timestamp − frame 0) / frameMs)`. Frames before Go are negative; in countdown mode they are closed and graded like any other frame from `start()` on, so a press before Go grades `EARLY`.
- **Frame record.** Every grid frame gets a record once it closes. It holds:
  - **Events:** every press and release on the frame, in arrival order, with its button, source and raw and corrected timestamps.
  - **Presses:** the buttons pressed on the frame (below), each with its ms.
  - **End state:** the buttons and directions held after every input on the frame, and the stick position they resolve to (SOCD neutral, "Directions" rule 2).
  - **Reports:** lost re-presses, ignored direction taps, and opposite directions held at the frame's end (below).
  - A frame with no inputs has an empty record with the previous frame's end state. The engine doesn't need to store it; it only has to run the time-based checks (`MISSED`, a chord window running out) for it when it closes.
- **Press.** Button B is pressed on frame N when B has a down event on N and B was not held at the end of frame N−1. A button counts at most once per frame; extra down events of the same button on that frame are dropped. The press's ms is the corrected timestamp of B's **last** down event on the frame. For the first frame of an attempt, "the end of frame N−1" means the held state just before it starts: what was held when the attempt armed, plus every input before it. A button held at arm and still held gives no press until it is released and pressed again.
- **A tap inside one frame registers.** A button pressed and released on the same frame is pressed on that frame. Direction presses are remembered on the frame too, but they only feed reports; a direction check reads the end state ("Directions" rule 4).
- **Lost re-press.** If B was held at the end of N−1 and is released and pressed again on N, it is not pressed on N. The result of the step awaited on frame N reports it (button, frame, ms), even if that step is graded on a later frame. If no step is awaited (before frame 0, or after the attempt ends), it isn't reported.
- **Closing.** Inputs are taken in arrival order. Frame N closes when an input arrives whose corrected time is at or past N's end, or when `tick(now)` finds `now − largest latency offset` at or past N's end. An input whose corrected time falls on an already closed frame counts on the open frame (the first frame not yet closed). Mixing keyboard and pad in one attempt isn't supported (known limit: such inputs can land a frame late).
- **Grading reads closed frames.** The engine grades one closed frame at a time against the awaited step. A step's result, feedback and sound come when its frame closes: up to one frame plus the largest latency offset after the press.

### Grading (per step)
1. When frame N closes, its button presses (directions aside) are compared with the awaited step. The reference frame is the previous graded step's frame (`relative`) or frame 0 (`absolute`).
   - **No presses:** nothing happens, unless N is the step's last accepted frame (`targetFrame + tolLate + timeoutFrames` past the reference frame; default timeout 30 frames), in which case the step is `MISSED`. A chord that is collecting pauses the timer ("Chords").
   - **Exactly the step's button** (single-button step): graded on N:
     - `inputFrame` = N − reference frame.
     - `deltaFrames = inputFrame − targetFrame`.
     - `deltaMs` = the press's ms − start of the target frame; `elapsedMs` = the press's ms − start of the reference frame.
     - `ON_TIME` if `−tolEarly ≤ deltaFrames ≤ tolLate`; `EARLY` if `deltaFrames < −tolEarly`; `LATE` if `deltaFrames > tolLate`.
     - A step with a direction check then runs it on N's end state ("Directions").
   - **The step's button plus any other button** (extra press, for every step, chords included): strict = `WRONG_BUTTON`, the attempt ends; non-strict = every press on N is logged as ignored and the step keeps waiting. The order the presses arrived in doesn't matter.
   - **Only other buttons:** `WRONG_BUTTON` (strict, the attempt ends) or ignored (non-strict, the step keeps waiting). Direction presses never count here ("Directions").
2. **One step per frame.** After a step is graded on frame N, the next step's presses count from frame N+1. A relative target of 0, or an early tolerance that reaches the previous step's frame, can't be met. Two absolute steps can't land on the same frame.
3. Always report `deltaFrames` and raw `deltaMs` (relative to the start of the target frame) so feedback can show "2f late (+31.4 ms, +1.9f)" (§7).

### Chords
A single-button step is graded exactly as above. A chord step (2+ buttons) works like this:
1. **Collecting** over frames. The chord starts on the first closed frame with one of its buttons pressed. Each later closed frame's presses must be chord buttons not yet pressed. While it is collecting, the `MISSED` timer is paused (a chord whose first press lands in time can't become `MISSED`). The first frame is still subject to the `MISSED` rule: a step whose last accepted frame closes with no chord press is `MISSED`.
2. **Window.** In `frames`: last press's frame − first press's frame ≤ `size`. In `ms`: presses on the **same frame as the first press always fit**; a press on a later frame must be within `size` ms of the first press (press ms per "Frames"; the first press is the earliest press ms on the chord's first frame).
3. **Complete** on the frame the last missing button is pressed on. Any other press on that frame is an extra press ("Grading" rule 1). Every step is graded when its frame closes, so the chord's result is known when that frame closes.
4. **Graded press = the last press** (the one that completed the chord; the latest on its frame if two did). `inputFrame` is the completing frame's; `deltaFrames`, `deltaMs` and `elapsedMs` follow from it and that press's ms. The next relative step counts from that frame.
5. **Each press also gets its own timing** (`EARLY` / `ON_TIME` / `LATE` against the step's window, by the press's frame), reported per press. Presses on the same frame get the same timing, so they can't make a `SPLIT` between themselves. Result:
   - `SPLIT` if the presses don't all get the same grade (any mix of early, on time and late).
   - Otherwise that grade (`ON_TIME`, `EARLY` or `LATE`).
6. **Mistakes** (exact match):
   - `WRONG_BUTTON` if a button that isn't in the chord is pressed while the chord is awaited (directions don't count), or one of its buttons is pressed again on a later frame, or any other press lands on the frame the chord completed on.
   - `PARTIAL` if the window runs out with only some of the chord's buttons pressed. It is known when the frame that ends the window closes, even if no other press arrives. On that frame, presses after an `ms` window's end don't count toward the chord.
   - Strict mode applies to both: strict ends the attempt; non-strict logs every press of the broken chord (and every press on the breaking frame) as ignored, resets the chord, and the step keeps waiting.
7. **First-input start with a chord as step 1:** the chord's first press sets frame 0, and the chord rules run over frames. Timing isn't checked (button correctness only, as for any start step). The next relative step counts from the frame the chord completed on.

### Directions
Directions are the absolute `UP` / `DOWN` / `LEFT` / `RIGHT` controls. There is no forward/back and no facing side.

1. **Held state.** The engine knows which directions are held at every moment: the held set at the time the attempt arms, then every press and release after that, on latency-corrected timestamps. Directions held from before the attempt count.
2. **Position.** The held directions resolve to one position. Opposite directions held together cancel out (SOCD neutral): LEFT+RIGHT gives no horizontal direction, UP+DOWN gives no vertical one. For example, LEFT+RIGHT+DOWN is ↓. "The position at the end of a frame" is the position after every press and release on that frame.
3. **Direction presses are never mistakes.** Pressing or releasing a direction never grades a step as wrong and never ends an attempt. It only changes the held position. (Before this, a direction press during a button step was `WRONG_BUTTON` in strict mode; that rule is removed.)
4. **The check.** A step with a `direction` and buttons, or a plain step set to `exact`, checks the held position at the **end of the grid frame it was graded on**: the frame of the button for a single-button step, the completing frame for a chord. Presses and releases anywhere on that frame count, so →+MP pressed together passes in either order.
   ```
   frame:        9            10            11
                      MP(170 ms)   →(173 ms)      → held at the end of frame 10: passes
                 →━━━━━━━━┛(168 ms) MP(171 ms)    → not held at the end of frame 10: missing
   ```
   The check reads the graded frame's end state ("Frames"), so its result comes when that frame closes, like every step's. A plain step set to `atLeast` has no check.
5. **Extra presses on the graded frame** follow "Grading" rule 1 (extra press), which covers every step. Direction presses and releases on that frame aren't extra presses; they only change the held position the check reads. An extra button press is a button mistake, so rule 7 doesn't apply.
   - **Reports on a failed check** (none on a passing one):
     - **Ignored direction tap:** a wanted direction was pressed on the graded frame ("Frames", press rule) but isn't held at its end.
     - **Opposite directions:** an opposite pair (← and →, or ↑ and ↓) was held at the frame's end.
6. **Result.** The step's timing is graded as usual (single press or chord rules). If the check fails, the grade is replaced:
   - `PARTIAL` (missing direction) when the held position is a strict part of the wanted one, including nothing held (e.g. nothing for →; ↓ for ↘).
   - `WRONG_BUTTON` (wrong direction) otherwise: a different direction, an extra direction on an exact step, or any direction on an exact plain step.
   - The timing fields (`inputFrame`, `deltaFrames`, `deltaMs`, and per-press timing for chords) are kept, and the result records the held and wanted positions and the cause (`missing` / `wrong`).
7. **A direction mistake never ends the attempt, in strict or non-strict mode.** The attempt moves on, and the next relative step counts from the graded press's frame. The attempt isn't a success.
8. **Chords with a direction.** The chord rules run first. A chord that breaks (wrong or extra button, or `PARTIAL` because its window ran out) is graded by the chord rules and the direction isn't checked. A complete chord is checked at the end of the frame it completed on. A failed check replaces the chord's grade, including `SPLIT`.
9. **First-input start.** A direction+button step 1: the button press is frame 0, and the direction is checked at the end of frame 0.

### First-input start
- Frame 0 starts at the first down event of a mapped button (not a direction) that isn't already held, on its corrected time. Directions before it only change the held state.
- Frame 0's record is graded as step 1 when it closes: button correctness (including the extra-press rule) and any direction check. Timing fields are 0.
- If step 1 fails in non-strict mode, the attempt goes back to waiting and frame 0 is cleared; the held state is kept. The next button press edge sets a new frame 0.
- A step-1 chord: its first press sets frame 0, and the chord rules run over frames.
10. **`MISSED`** is unchanged: holding a direction never starts or pauses the timer.

### Input rules
- Buttons count by the **press rule** in "Frames" (a down event on a frame, not held at the end of the frame before). Directions count by what's held (see "Directions"). Holds and key auto-repeat of buttons are ignored.
- **Strict mode** (default on): a wrong button ends the attempt with `WRONG_BUTTON`. With strict mode off, wrong presses are logged but ignored, and the step keeps waiting.
- An attempt ends when all steps are graded, on `MISSED`, or on a strict-mode `WRONG_BUTTON` or `PARTIAL` from a button or chord mistake. Direction mistakes never end it.
- A chord's presses are ordinary presses ("Frames"); the input layer doesn't change. Known limits:
  - Some keyboards can't register certain 3+ key combinations (rollover / ghosting), including direction keys with buttons (e.g. WASD plus U/I/O).
  - Pad buttons seen in the same poll share one timestamp.
  - The keyboard tracker forgets keys held across a window blur, so such a key reads as up until it's pressed again. Pad held state is always accurate (each poll reads the full state).
  - Mixing keyboard and pad input in one attempt isn't supported and isn't blocked: with different latency offsets, inputs can land a frame late ("Frames", Closing).
  - With rAF gamepad polling (~1 frame), presses from one poll share a timestamp and frame; frame records can't be finer than the poll.

## 4. Architecture

```
src/
  engine/        # pure timing logic, no DOM; fully unit tested
    types.ts       Combo, Step, Settings, StepResult, AttemptResult
    timing.ts      frame/ms conversion, grading function
    frames.ts      frame layer: groups inputs into frame records (press rule, end state, reports)
    attempt.ts     attempt state machine: idle → armed → running → done; grades closed frames
    chord.ts       chord helpers: window checks, per-press timing, split rule
    direction.ts   direction helpers: held set → position (SOCD), matching, mistake cause
  input/         # converts keyboard + gamepad into timestamped press events
    types.ts       InputPress / InputRelease event shapes
    keyboard.ts
    gamepad.ts
    mapping.ts     raw key/button → button ID; user-remappable
    wake.ts        "wake your controller" banner state (pure)
  ui/            # DOM rendering only; reads engine state, never owns timing
    editor.ts      combo builder
    notation.ts    step notation on the page (colored direction arrows)
    practice.ts    run attempts, live feedback, last-attempt timeline, session stats
    controls.ts    Controls page: remap keys and pad controls
    calibrate.ts   latency calibration screen
    debug.ts       input debug page (Layer 2)
    padBanner.ts   app-wide controller wake-up banner
    dom.ts         shared element helper
  combo/         # pure combo-editing helpers + shipped examples; no DOM; unit tested
    edit.ts
    examples.ts
  calibration/   # pure latency-calibration math; no DOM; unit tested
    calibration.ts beat schedule, tap matching, median offset per source
  practice/      # pure practice-session logic on top of the engine; no DOM; unit tested
    session.ts     back-to-back attempts, countdown before each attempt, quick restart
    cues.ts        which sounds a state change makes; metronome tick times
    stats.ts       session stats
    timeline.ts    timeline geometry (frames since frame 0)
    format.ts      feedback text ("2f late (+31.4 ms)")
  audio/
    sounds.ts      synthesized sounds via Web Audio, scheduled on the performance.now() clock
  storage/
    combos.ts      save/load via localStorage (storage injected, so it's testable in Node)
    mapping.ts     saved input mapping
    settings.ts    saved app settings (strict mode, sound, latency offsets)
  main.ts        page shell + hash routing (#practice, #controls, #calibrate, #debug)
  style.css      all app styles, light and dark
scripts/
  backup-transcript.mjs        session transcript backup (§10)
.github/workflows/deploy.yml   GitHub Pages deploy
netlify.toml                   Netlify alternative
mise.toml                      pinned Node version, task shortcuts
mise.local.toml                transcript folder (machine-specific, not committed)
CLAUDE.md                      working conventions for Claude Code
tests/
  audio/*.test.ts
  calibration/*.test.ts
  engine/*.test.ts
  input/*.test.ts
  combo/*.test.ts
  storage/*.test.ts
  practice/*.test.ts
```

Rules:
- `engine/` has no imports from `input/` or `ui/`. It accepts `{ button, timestamp }` press events and returns results. This makes it testable with synthetic timestamps.
- `input/` emits press events in a common shape regardless of source.
- `ui/` never computes timing itself.

### Engine API: directions
Additions for "Directions" (§3), approved by the user on 2026-11-02. `Grade` and `AttemptEnd` don't change.
- **Types** (`engine/types.ts`):
  - `Position = 1 | 2 | 3 | 4 | 6 | 7 | 8 | 9` (what a step stores) and `HeldPosition = Position | 5` (what the stick can read; 5 is neutral).
  - `DirectionMatch = 'exact' | 'atLeast'`; `DirectionMistake = 'missing' | 'wrong'`.
  - `Step` gains `direction?: Position` and `directionMatch?: DirectionMatch`.
  - `ReleaseEvent`: same shape as `PressEvent` (`{ button, timestamp, source }`).
  - `StepResult` gains `direction?: { wanted: HeldPosition; held: HeldPosition; match: DirectionMatch }`, set on every step that ran a check (`wanted` is 5 for an exact plain step), and `directionMistake?: DirectionMistake` when the check failed.
  - `AttemptResult` gains `positions: PositionChange[]`, with `PositionChange = { frame: number; position: HeldPosition; timestamp: number }`: the position at frame 0, then one entry for each frame whose ending position differs from the frame before. `timestamp` is the corrected time of the input that made the change (frame 0's timestamp for the first entry).
- **Helpers** (`engine/direction.ts`, pure): `isDirection(button)`; `resolvePosition(held: readonly ButtonId[]): HeldPosition` (with SOCD); `positionDirections(p: HeldPosition): ButtonId[]`; `positionMatches(wanted: HeldPosition, held: HeldPosition, match: DirectionMatch): boolean`; `directionMistake(wanted: HeldPosition, held: HeldPosition): DirectionMistake`; `hasDirectionCheck(step)`.
- **Attempt** (`engine/attempt.ts`):
  - `arm(state, held?: readonly ButtonId[])`: the directions held when the attempt arms. Left out, it keeps the held set the state already has (so a quick restart from `done` keeps it).
  - `press(state, ev)` takes button and direction presses. A direction press only changes the held set.
  - New `release(state, ev: ReleaseEvent)`: a button release is ignored; a direction release changes the held set.
  - Both keep the held set up to date in the `idle`, `armed` and `running` phases, even when the press itself isn't graded (e.g. before `start()` in countdown mode).
  - `AttemptState` gains `held: readonly ButtonId[]` (directions only) and `pendingCheck`, an end-of-frame check waiting to close (like `chord`). New query `heldPosition(state): HeldPosition` for the live input display.
  - `AttemptState` also gains `positionLog: readonly { t: number; position: HeldPosition }[]` (approved by the user on 2026-11-02, session C): the position at arm (`t` = −Infinity), then each change of the resolved position with its corrected time. `attemptResult` turns it into `positions` once frame 0 is known; in first-input mode frame 0 isn't known until the first button press, so `positions` can't be built live.
- **Practice** (`practice/session.ts`): new `practiceRelease(state, ev)`. `createPractice` and restarts pass the held set to `arm`.
- Changed by "Engine API: frames" (2026-11-08): `pendingCheck` is gone, and `held` now holds buttons too.

### Engine API: frames
For "Frames" (§3), settled by the user on 2026-11-08 (proposal decision 15). `Grade`, `AttemptEnd`, `AttemptResult` and the outer calls don't change.
- **Outer calls stay** `press(state, ev)`, `release(state, ev)` and `tick(state, now)`. Inside, every input goes to the frame layer first; the attempt grades each frame record as it closes. The practice layer and UI call the engine as before.
- **Frame layer** (`engine/frames.ts`, pure, no attempt knowledge):
  - `FrameEvent = { button, down: boolean, ev: PressEvent | ReleaseEvent, t }` (`t` is the corrected timestamp).
  - `FramePress = { button, ev: PressEvent, t }`: one per button per frame, `ev` and `t` from its last down event, in the order of each button's first down event.
  - `OppositePair = 'LEFT_RIGHT' | 'UP_DOWN'`.
  - `FrameRecord = { frame, events: FrameEvent[], presses: FramePress[], held: ButtonId[], position: HeldPosition, lostRepresses: FramePress[], directionTaps: ButtonId[], opposites: OppositePair[] }`. `presses` holds buttons and directions; `held` is the end state (buttons and directions), `position` its SOCD position; `directionTaps` are directions pressed on the frame and not held at its end; `opposites` are pairs held at its end.
  - `FrameBuffer`: the grid origin (or none yet), the open frame, the last closed frame, and the held set.
  - Functions: `createFrames(fps, held)`, `setOrigin(buf, frame0)`, `clearOrigin(buf)`, `addInput(buf, ev, t, down) → { buf, closed }` (closes the open frame first when `t` is past it; with no origin it only changes the held set), `closeBefore(buf, frame) → { buf, closed }` (closes the open frame if it's before `frame`), `lastClosedFrame(buf)`. Frames with no inputs get no record; `lastClosedFrame` tells the attempt how far time has moved.
- **Attempt** (`engine/attempt.ts`):
  - `AttemptState` loses `pendingCheck` and `PendingChord.complete`; it gains `frames: FrameBuffer` and `lostRepresses` (collected for the awaited step until it's graded). `PendingChord.presses` record each press's frame.
  - `AttemptState.held` holds buttons and directions (the press rule needs held buttons). `arm(state, held?)` keeps both; `release` updates both. `heldPosition` is unchanged (it resolves directions only).
  - `frame0` is still set when step 1 is graded (first-input) or by `start()` (countdown); the frame layer keeps its own origin while frame 0 is open.
  - `chordProgress` shows presses from closed frames only.
- **Results** (`engine/types.ts`): `StepResult` gains `reports?: StepReports`, with `StepReports = { lostRepresses?: LostRepress[]; directionTaps?: ButtonId[]; opposites?: OppositePair[] }` and `LostRepress = { button, frame, timestamp }`. `OppositePair` lives in `types.ts` and is re-exported by `frames.ts`. `frame` is the grid frame since frame 0, `timestamp` the corrected time. `directionTaps` and `opposites` are set only on a failed direction check; `lostRepresses` on the step awaited when they happened. Frame records aren't kept in `AttemptResult`.

### Saved data
- **Storage** stays `uct.combos.v1`. A step without `direction` or `directionMatch` is a plain at-least step, so old steps load as they were.
- **Single-direction steps removed (2026-11-02):** loading drops any step whose only button is a direction (e.g. `['DOWN']`). In relative mode the next kept step's `targetFrame` absorbs the removed steps' targets, so the rest of the combo keeps its timing; in absolute mode targets don't change. Tolerances and labels of removed steps are lost. A combo made only of direction steps is dropped. When anything was converted or dropped, the original data goes to the backup key (`uct.combos.v1.backup`) and storage is rewritten once.
- **Share links are dropped** (2026-11-02; code removed in direction+button session B). There is no share code v3. When share links come back (BACKLOG), their format has to carry `direction` and `directionMatch`.

## 5. Input sources

### Keyboard
- Use `keydown` with `event.timeStamp`; ignore `event.repeat`.
- Default mapping provided (e.g. U/I/O/P = LP/MP/HP/MISC1, J/K/L/; = LK/MK/HK/MISC2, WASD = directions), remappable.

### Gamepad (Gamepad API)
- Poll `navigator.getGamepads()` on a **4 ms timer while the page has focus** (default, "auto" mode). When the page loses focus, fall back to polling every `requestAnimationFrame`, and switch back on focus. Fixed rAF or timer modes stay available on the debug page. Detect press edges by comparing to the previous poll.
- Timestamp each press with `gamepad.timestamp` when it changed, otherwise `performance.now()` at poll time.
- **Known limitation:** polling resolution is tied to the display refresh rate (~16.7 ms at 60 Hz), which is about one game frame at 60 fps. Layer 2 must measure and display the actual observed polling interval, and the UI must warn the user when resolution is coarser than one target frame. Investigate whether faster polling is reliable in current browsers and document findings here.

#### Polling findings (Layer 2)
How it is measured: the debug page records two intervals.
- **Poll interval:** time between our own polls. This is the timestamp resolution used for the warning.
- **Time between input changes:** time between changes of `Gamepad.timestamp`. That timestamp only changes when the pad's data changes, so this is **not** the browser's read rate. With a digital-only device (arcade stick, hitbox), it mostly measures how fast the player moves. The fastest gap seen is an upper limit on the browser's read interval. Only an analog stick with constant noise would show the true rate.

The page can poll every animation frame (default) or on a timer (8 / 4 / 1 ms) to compare.

What is expected (from browser docs and specs, **not yet confirmed on hardware**):
- `requestAnimationFrame` polling follows the display: ~16.7 ms at 60 Hz, ~6.9 ms at 144 Hz. It pauses in background tabs.
- Timer polling can go faster, but browsers clamp nested timers to ≥ 4 ms and throttle background tabs heavily, so it is only useful while the page is focused.
- The browser's own gamepad sampling rate varies by browser and OS, and it caps what any polling mode can achieve.
- `Gamepad.timestamp` changes on *any* new data, including analog stick noise, so it marks the latest sample, not necessarily the press itself. That is why resolution is treated as the worst case rather than trusting the timestamp alone.

Measured results:

| Date | Browser / OS | Pad / connection | rAF poll (median) | 4 ms timer poll (median) | Time between input changes (median) |
|---|---|---|---|---|---|
| 2026-10-29 | Firefox / Windows 11 | Qanba Obsidian arcade stick, USB (possibly via Steam Input) | 17 ms | 4 ms | 31 ms (rAF), 29.5 ms (timer), lever wiggled by hand |

Findings so far:
- In a focused Firefox tab, timer polling at 4 ms works and holds its rate. That is about 4× finer than rAF polling on a 60 Hz display (≈ 0.24 frame vs ≈ 1 frame at 60 fps).
- The ~30 ms "change" interval was the speed of the hand on the lever, not a browser limit. It was the same in both poll modes, and the stick has no analog noise. An earlier build used it for the warning; that was wrong and has been fixed.
- Not yet known: the browser's real read rate for this pad, and any delay Steam Input adds (it can't be seen from the page). Measuring the read rate needs an analog stick, or the fastest change gap from very fast input.
- Not yet tested: Chrome/Edge, other pads, displays other than 60 Hz.

**Decision (approved 2026-10-29):** the default gamepad poll is a 4 ms timer while the page is focused, falling back to rAF when it isn't (see §5 above). The resolution warning still shows whenever the measured poll interval is about one frame or coarser, e.g. if a browser can't hold the 4 ms rate.

## 6. Latency calibration
- A calibration screen plays a steady visual + audio beat; the user taps along for ~20 beats.
- Compute the median offset between beat and press; store as `latencyOffsetMs` per input source (keyboard vs gamepad).
- The offset is subtracted from input timestamps before grading. User can also set it manually or set it to 0.

## 7. Feedback and UI

- **Practice view:** shows the combo as a row of steps. Each step lights up as it is graded, colored by result (on time / early / late / split / partial / wrong / missed) with "±Nf (±X ms, ±Y.Yf)".
- **Timing text** (frame-based inputs, 2026-11-08): "On time (+3.3 ms, +0.2f)", "On time, 1f late (+20.1 ms, +1.2f)", "2f early (−31.4 ms, −1.9f)", "2f late (+38.3 ms, +2.3f)". Frames count from the target frame, as before (`deltaFrames`). The frame fraction is `deltaMs / frameMs`, one decimal, with the same sign as the ms. It's shown wherever the ms is.
- **Frame notes**, after " · " as for the direction note:
  - Ignored direction tap (failed check only): "→ tapped, not held at end of frame".
  - Opposite directions (failed check only), inside the direction note: "Direction: none, wanted → (← and → both held)".
  - Lost re-press: "LP pressed again while held (not counted)".
  - No new elements, colors or sounds; the timeline doesn't show the reports.
- **Timeline view:** a horizontal frame ruler showing target windows vs actual inputs for the last attempt.
- **Session stats:** per-step on-time rate, a count of each other result (early, late, split, partial, wrong, missed), average and spread of `deltaFrames`, and a running streak. Reset per session.
- **Optional audio:** a metronome tick on target frames and distinct sounds for on-time vs miss. Off by default.
- Quick restart key (e.g. Space or a gamepad button) to re-arm immediately.
- **Desktop only:** the app is built and checked for desktop with a keyboard or controller. Phone width isn't supported (dropped 2026-11-02, see DECISIONS.md).

### Directions in the UI
- **Notation:** arrows (↙ ↓ ↘ ← → ↖ ↑ ↗, "•" for neutral), e.g. →+MP, ↓+MK, ↘+HP, ←+LP+LK. A plain step set to exact shows "(neutral)". Exact and at-least directions are told apart by **color, not a symbol** (user's call, session E): the arrow is blue when exact, orange when at least, and "(neutral)" is blue (exact). Blue vs orange was picked to stay distinct with color blindness, and each color keeps at least 4.5:1 contrast on every card background in light and dark themes. Hovering an arrow says "exactly ↓" / "at least ↓", and screen readers read the same. A plain at-least step has no arrow and no color. The practice page (step cards, status line, timeline lane names, stats rows) and the editor share this notation (`practice/format.ts`, drawn by `ui/notation.ts`).
- **Editor:** each step row has a direction dropdown ("• none", "↘ down-right", …). Opening it (or a button beside it) shows a 3×3 grid in a panel under the step, laid out like a stick gate; picking there sets the dropdown. An exact / at-least toggle sits next to it ("neutral required" / "any direction" on plain steps). Button selects don't offer directions (removed 2026-11-02 with single-direction steps). No new hint or warning text.
- **Practice page:** a live input display (stick gate and pressed buttons), always shown, reading held state from the practice layer. It shows input without judging it.
- **Feedback text:** the usual timing text, then a direction note on a mistake: "On time (+5.2 ms, +0.3f) · Direction: ↘, wanted → exactly". The note says "wanted → exactly" when the step is exact and the held position contains the wanted one, "wanted any ↓" for at least, "wanted neutral" for exact plain steps, and "none" when nothing is held.
- **Timeline:** one stick lane above the step lanes: one segment per position from frame 0, tagged with its arrow, neutral left empty, using the position after SOCD at each frame's end (`AttemptResult.positions`). Drawn only if the combo has a direction step or a direction was held. Each graded button dot of a step that ran a check is tagged with the held position, red on a direction mistake.
- **Stats:** direction mistakes count toward average and spread (the button press was right). "Other results" labels them separately: "wrong direction", "missing direction".
- **Sounds:** a direction mistake plays the "step off" sound (it doesn't end the attempt). No new sound or color: colors stay the grade's (pink for `PARTIAL`, red for `WRONG_BUTTON`).
- **Countdowns:** only a button press starts or restarts a countdown; direction presses and releases don't. They still update the held state, so a direction pressed during the countdown counts once the attempt runs. This covers any press during a countdown and, in countdown start mode, the press that starts it. The restart control (Space, pad Start/Back) is unchanged. From the last beat on in countdown start mode, presses already go to the running attempt, as before.

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
- Save, load, rename, delete combos in `localStorage`. Ship 2–3 example combos (later grown to 4 with chords and 5 with direction+button steps).

**Done when:** a combo can be created, saved, reloaded after refresh, and edited.

### Layer 4: Practice mode + feedback
- Wire editor → engine → input → practice view with live per-step feedback, timeline view, and session stats.

**Done when:** a full attempt can be performed with keyboard or gamepad and results display correctly.

### Layer 5: Polish
- Latency calibration screen (§6), audio cues, countdown start mode UI, input remapping UI (done early, in Layer 4, at the user's request), mobile layout pass, deploy config for static hosting.
- Optional: share combo via URL (built, then dropped on 2026-11-02; see §2).
- Reviewed in two parts:
  - **Part A:** audio cues and sound feedback, countdown start mode, countdown before each attempt, saved settings, and a "Hear timing" preview.
  - **Part B:** latency calibration, mobile layout pass, deploy config, optional share-by-URL.
- The phone-width requirement and the mobile layout were removed on 2026-11-02 (§7).

### Direction+button steps (2026-11-02)
Built from [docs/proposals/2026-11-02-dir-plus-button-inputs-spec.md](docs/proposals/2026-11-02-dir-plus-button-inputs-spec.md). One review stop per session; each ends with `mise run test` and `mise run typecheck` passing.
- **A. Spec:** apply the proposal (as amended in its section 7) to SPEC.md, log the decisions in DECISIONS.md, update BACKLOG.md, settle the API names. No feature code.
- **B. Types:** `direction` and `directionMatch` on `Step`, validation, loading and saving the new fields. Remove share links (the editor's "Copy share link" button, the `#share=` route, `combo/share.ts` and its tests). Grading doesn't change yet.
- **C. Engine:**
  - Held state, `release`, and the held set at arm.
  - SOCD position, the end-of-frame check, exact / at least.
  - Grade replacement and continuing after a mistake; chords with a direction.
  - Stray directions not mistakes.
  - `positions` history and `directionMistake`.
  - A table test covering the proposal's worked examples (section 2), except the position-step cases L1, L1e and L2.
- **D. Practice side:** pass releases and the held set through; only button presses start or restart a countdown; feedback text, stats, sounds, the timeline stick lane and tagged dots, the live input display.
- **E. Editor and examples:** dropdown and grid panel, toggle, arrow notation with exact / at-least colors (a symbol marker was planned; the user chose colors), examples (fix "cr." steps to ↓ at least, add "Example: command normal").
- **F. Hardware check:** keyboard (including SOCD with A+D) and the stick's hat lever; log the results in SPEC like the polling findings.

**Done when:** every in-scope case in the proposal's section 2 passes as a test, and direction+button steps can be built, saved, practiced and reviewed on the timeline with a keyboard or controller.

### Frame-based inputs (2026-11-08)
Built from [docs/proposals/2026-11-08-frame-based-inputs-spec.md](docs/proposals/2026-11-08-frame-based-inputs-spec.md); plan in [docs/plans/2026-11-08-frame-based-inputs.md](docs/plans/2026-11-08-frame-based-inputs.md). One review stop per milestone; each ends with `mise run test` and `mise run typecheck` passing.
- **M1. Spec:** apply the proposal to SPEC.md, log decisions in DECISIONS.md, update BACKLOG.md, settle decision 15 (§4 "Engine API: frames"). No feature code.
- **M2. Frame layer:** `engine/frames.ts` and its tests, not yet wired in.
- **M3. Engine, single-button steps:** grading per closed frame, extra-press rule, one step per frame, `MISSED`, both start modes, the direction check on the end state; `pendingCheck` removed.
- **M4. Engine, chords:** collecting over frames, the window (same-frame rule for `ms`), completion, `PARTIAL`, `SPLIT`.
- **M5. Engine, reports:** lost re-presses, ignored direction taps, opposite directions; a table test of the proposal's worked examples F1–F12.
- **M6. Practice side:** feedback text with the frame fraction and the notes; practice tests for results at frame close.
- **M7. Wrap-up:** BACKLOG, DECISIONS, NEXT_SESSION; requirements check.

**Done when:** every worked example F1–F12 passes as a test, and the behavior changes in the proposal's section 4 hold in the app with a keyboard.

## 9. Out of scope (for now)
- Motion inputs (quarter-circles, charge inputs), negative edge (a release as an input), and **position steps** (a direction with no button, graded on the frame the stick enters it; dropped from direction+button on 2026-11-02, BACKLOG "Position steps"). Button chords (§3, "Chords") and directions with buttons or chords (§3, "Directions") are supported.
- **Frame-based input follow-ups** (2026-11-08): input history beyond the previous frame; matching a specific game's frame phase; mixed input sources in one attempt. (Frame snapshots themselves moved into §3 "Frames".)
- **Direction+button follow-ups** (found during the same interview, 2026-11-02): facing / side switching (forward and back relative to the character; steps use absolute `RIGHT` / `LEFT`); a per-combo SOCD rule (the proposal resolves opposite directions to neutral); numpad notation as a display option (the proposal uses arrows); setting a step's direction by holding it on the stick; a "return to neutral" position step; a show/hide toggle for the live input display.
- Reading game memory or game frame data.
- Accounts, online leaderboards, any backend.

## 10. Session transcripts
- **On every commit, back up the session transcript.** Right after making a commit, Claude Code runs `mise run transcript`. This applies to every commit Claude makes, including mid-session ones.
- **What it writes:** two files in `$TRANSCRIPT_DIR`. It's set in `mise.local.toml`, which is gitignored so the personal folder path stays out of the public repo. Development runs in WSL, so it's a WSL path to a folder on the Windows side (`/mnt/c/...`).
  - `YYYY-MM-DD Claude Code session <id>.md`: readable transcript with a header (date and time range, session ID, commits made during the session). It has the conversation text, with each tool call summarized as a one-line *Actions* entry. Command output and internal reasoning are left out.
  - `YYYY-MM-DD Claude Code session <id> (raw).jsonl`: an exact copy of the session log.
- **One pair of files per session.** Running it again in the same session overwrites that session's files with the latest version. The date is the session's start date.
- **Session lookup:** the script uses the most recently updated session log for this project, or `--session <id>` (`node scripts/backup-transcript.mjs --session <id>`).
- Transcripts are not committed to the repo.
- If the backup fails (e.g. the folder isn't reachable), the commit stands. Claude reports the failure instead of retrying silently.

## Related files
- [DECISIONS.md](DECISIONS.md): decisions made along the way, newest at the bottom.
- [BACKLOG.md](BACKLOG.md): requested features and known bugs.
- [NEXT_SESSION.md](NEXT_SESSION.md): where things stand and what to pick up next.
