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
    types.ts       InputPress / InputRelease event shapes
    keyboard.ts
    gamepad.ts
    mapping.ts     raw key/button → button ID; user-remappable
    wake.ts        "wake your controller" banner state (pure)
  ui/            # DOM rendering only; reads engine state, never owns timing
    editor.ts      combo builder
    practice.ts    run attempts, live feedback, last-attempt timeline, session stats
    controls.ts    Controls page: remap keys and pad controls
    calibrate.ts   latency calibration screen
    debug.ts       input debug page (Layer 2)
    padBanner.ts   app-wide controller wake-up banner
    dom.ts         shared element helper
  combo/         # pure combo-editing helpers + shipped examples; no DOM; unit tested
    edit.ts
    examples.ts
    share.ts       combo ↔ share-link code
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
  main.ts        page shell + hash routing (#practice, #controls, #calibrate, #debug, #share=…)
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
- Latency calibration screen (§6), audio cues, countdown start mode UI, input remapping UI (done early, in Layer 4, at the user's request), mobile layout pass, deploy config for static hosting.
- Optional: share combo via URL.
- Reviewed in two parts:
  - **Part A:** audio cues and sound feedback, countdown start mode, countdown before each attempt, saved settings, and a "Hear timing" preview.
  - **Part B:** latency calibration, mobile layout pass, deploy config, optional share-by-URL.

## 9. Out of scope (for now)
- Motion inputs (quarter-circles, charge inputs) and simultaneous multi-button presses. Design types so these can be added later (e.g. a step could become a list of required inputs within a chord window).
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

## Backlog
- ~~Countdown before each attempt~~ and ~~basic sound feedback for app events~~ (requested 2026-10-30, Layer 4 review): done in Layer 5 Part A, see the Decisions log.
- **Hear the on-time window in Hear timing** (possible feature, requested and then shelved 2026-10-30). Let the timing preview also convey each step's wiggle room, not just its target moment.
  - Tried: an optional sustained tone spanning each step's on-time window (from the start of frame `target − tolEarly` to the end of frame `target + tolLate`), playing under the press tone, with a dashed outline on the step card during the window. Steps with no tolerance got no window tone. The user wasn't happy with how it turned out and it was removed before committing.
  - Sound settings tried: a 370 Hz triangle at level 0.3 (too loud, too deep), then a 622 Hz sine at 0.12, a minor third below the 740 Hz press tone. The idea may need a different approach rather than a different tone, e.g. two short ticks marking the window's edges, or a visual-only window.
- **Advanced combo-building mode** (requested 2026-10-30, after the Layer 3 review). An optional editor mode for steps that need more than one button press:
  - **Release events as steps:** grade the timing of a button release, not only presses (e.g. negative-edge inputs, or holding a button for a set number of frames). The input layer already emits releases (see Decisions log, "Release events").
  - **Grouped inputs:** a step made of several inputs. They can be *sequential*, like a motion input (quarter-circle forward = DOWN, DOWN+RIGHT, RIGHT, then a button), or *simultaneous*, like a chord (two buttons within a few frames of each other).
  - **Input leniency for motions:** accept shortcuts the way many games do, e.g. DOWN → RIGHT counts as a quarter-circle forward even though DOWN+RIGHT was skipped. Leniency should be adjustable per group.
  - Motion and chord inputs are out of scope for now (§9). This changes the engine's `Step` type and grading, so a written proposal and spec update come before any code (CLAUDE.md).

## Next session
- Layer 4 (practice mode + feedback) plus input remapping and the MISC1/MISC2 buttons were reviewed and committed on 2026-10-30.
- Layer 5 Part A (sound, countdowns, saved settings, Hear timing) was reviewed and committed on 2026-10-30.
- Layer 5 Part B (calibration, mobile pass, deploy config, share-by-URL) was reviewed and committed on 2026-10-30. The app is live at https://joshleidl.github.io/Universal-Combo-Trainer/ and redeploys on every push to `main`.
- All §8 layers are done. Next candidates are in the Backlog (e.g. the advanced combo-building mode), plus testing calibration and the phone layout on real hardware.

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

### Layer 2 (2026-10-29)
- **Common press shape:** input sources emit `InputPress` (`source`, `button` or null when unmapped, raw `control`, `timestamp`, `timestampSource`, `gamepadIndex`). `toPressEvent()` converts mapped presses to the engine's `PressEvent`. Unmapped presses are kept so the debug page can show them.
- **Keyboard mapping uses `KeyboardEvent.code`** (physical key position), so the defaults work on any keyboard layout.
- **Hold detection:** besides `event.repeat`, the keyboard tracker ignores a keydown for a key that is still held. Held keys are cleared on window blur. Keys pressed with Ctrl/Cmd/Alt are ignored so browser shortcuts still work. Mapped keys have their default action prevented.
- **Default gamepad mapping** (W3C standard layout): X/Y/RB = LP/MP/HP, A/B/RT = LK/MK/HK, d-pad = directions. (LB = MISC1 and LT = MISC2 added later, see "Input remapping".) Pads with a non-standard mapping get a warning on the debug page.
- **Axes as directions:** each axis direction ("Axis 0-", "Axis 1+", …) is a pressable control. It counts as pressed at |value| ≥ 0.5 and released below 0.4 (hysteresis). The left stick (axes 0/1) maps to LEFT/RIGHT/UP/DOWN by default, which also covers fight sticks in LS mode. A diagonal is two presses. Unmapped axis directions still appear in the debug log. Added after the first hardware test: the arcade stick's lever reported through axes and showed nothing in the log.
- **Hat switches:** an axis listed in `InputMapping.gamepadHats` is decoded as an 8-way hat and is not also read as a plain axis. Encoding: the value rises by 2/7 clockwise from up (−1) to up-left (+1), and is rounded to the nearest step. Anything more than half a step outside −1…1 is neutral (Firefox reports 3.29, Chrome 1.29). Diagonals are two directions (numpad 3 = DOWN + RIGHT). Default: axis 9 → UP/DOWN/LEFT/RIGHT, confirmed on a Qanba Obsidian in Firefox / Windows 11. Pads without an axis 9 are unaffected. Remap with `setGamepadHat` / `removeGamepadHat`.
- **First sight of a pad:** buttons already down the first time a pad appears are treated as held, so connecting a pad never makes phantom presses. Side effect: the press that wakes up the pad in the browser isn't reported.
- **Gamepad timestamps:** use `Gamepad.timestamp` only if it changed since the last poll and is plausible (> 0, not in the future, at most 1 s old). Otherwise use poll time. Each press records which one was used.
- **Interval stats** use a rolling window of 120 samples. Gaps over 250 ms (poll) or 100 ms (input changes) are treated as idle time and dropped.
- **Auto poll mode:** "focused" means `document.hasFocus()`, updated on window `focus`/`blur`. Poll stats reset on each switch, so the shown interval always matches the mode in use.
- **Gamepad resolution = median poll interval.** The time between input changes is shown only as a diagnostic (fastest and median). It is not used for the warning, because on digital-only pads it measures the player, not the browser. Revised after the first hardware test.
- **Resolution warning** shows when resolution ≥ 0.9 × one target frame, so 60 Hz polling at 60 fps warns even though intervals jitter just under 16.67 ms.
- **Remapping** is pure helper functions for now (`bindKey`, `unbindKey`, `bindGamepadButton`, `unbindGamepadButton`). A remap UI and saving mappings come with Layer 5. (Superseded: done during the Layer 4 review, see "Input remapping".)
- **The debug page is the app's home page** until the editor and practice views exist.

### Release events (2026-10-30)
- **Event shape:** input events carry `edge: 'press' | 'release'`. `InputEvent` is the union of `InputPress` and `InputRelease`, so code can narrow on `edge`. `KeyboardTracker.keyUp()` returns a release; `GamepadTracker.poll()` returns both edges.
- **Callbacks:** `attachKeyboard` and `startGamepadPolling` keep sending only presses to `onPress`, and send releases to a new optional `onRelease`. Anything wired for presses can't get a release by accident.
- **`toPressEvent()`** returns null for releases as well as unmapped controls. Grading and the engine are unchanged.
- **Keyboard:** a keyup only counts as a release if its press was reported. Keys held across a window blur (held set cleared) or pressed with Ctrl/Cmd/Alt give no release.
- **Gamepad:** releases use the same timestamp rules as presses. A button held when the pad is first seen gives no press but does give a release. A pad that disconnects gives no releases. Axis directions release below the 0.4 hysteresis threshold, and hat diagonals release one direction at a time.
- **Debug log:** one row per edge, with an Edge column. "Since last press" is press-to-press only. Releases show hold time (release − press) in ms and frames (floored, like grading), or "—" when the press wasn't seen. Clearing the log keeps the press times of held controls.

### Layer 3 (2026-10-30)
- **New `combo/` module:** pure editing helpers (`newCombo`, `addStep`, `removeStep`, `moveStep`, `updateStep`, `combosEqual`, `onTimeWindow`) and the shipped examples. They aren't timing logic, so they stay out of `engine/` and its API is unchanged; they aren't DOM, so they stay out of `ui/` and are unit tested.
- **Storage format:** one `localStorage` key, `uct.combos.v1`, holding `{ version: 1, combos: [{ id, combo }] }` in save order. The id lives beside the engine `Combo`, so the engine type is unchanged. The last-opened combo id is kept in `uct.lastComboId`, so a refresh reopens it.
- **Ids** are `c-<time>-<random>` rather than `crypto.randomUUID()`, which only works on secure origins (it fails on a LAN address over http, e.g. testing on a phone).
- **Storage is injected** (`StorageLike`), so tests use an in-memory fake and need no jsdom. If the browser blocks `localStorage`, the app uses the in-memory store and shows a warning that combos won't persist.
- **Examples** (3 game-agnostic drills) are seeded only when `uct.combos.v1` doesn't exist. They are ordinary saved combos: editable and deletable. Deleting all of them doesn't bring them back. No "restore examples" button for now.
- **Saving validates:** a combo is saved only if its name isn't blank and it passes the engine's `validateCombo`. The editor shows the problems and disables Save until they're fixed. Names are trimmed on save, blank labels are dropped, and unknown fields are stripped. Names don't need to be unique.
- **Damaged data:** if stored data can't be read (bad JSON, unknown version, invalid entries), the raw text is copied to `uct.combos.v1.backup`, readable entries are kept, and the cleaned data is written back. Nothing is reseeded.
- **Rename** is done by editing the name field and saving. There's no separate rename action; `ComboStore` has `list`, `get`, `create`, `update`, `delete`.
- **Save as new** creates a copy. If the name is unchanged it gets " (copy)" appended so the two can be told apart.
- **Unsaved changes:** the editor compares the draft with the last saved version. Switching combos, starting a new one, or deleting asks before discarding changes, and closing the tab triggers the browser's leave-page warning. The draft is kept in memory when visiting the debug page and coming back.
- **Reorder** uses ↑/↓ buttons per step (works with keyboard and touch). No drag and drop.
- **Add step** copies the last step's button, target frame and tolerances (not its label).
- **Step 1 in first-input mode:** its target frame and tolerances are disabled in the editor, since the engine doesn't grade its timing. The stored values are kept.
- **Button choices** are the fixed `BUTTON_IDS` list. An unknown button in loaded data stays selectable instead of being changed silently.
- **fps** is a number input with 30/60/120 suggestions; any positive number is allowed, matching the engine.
- **On-time window hint:** each step shows its on-time frames and the ms span they cover (start of the first frame to the end of the last), e.g. "frames 10 to 14, 166.7 to 250.0 ms after the previous input".
- **Start mode** can be set to countdown in the editor now; the countdown itself is Layer 5 and the hint says so.
- **Routing:** the editor is the home page; the input debug page moved to `#debug`. A shared header has links to both.

### Layer 4 (2026-10-30)
- **New `practice/` module:** the attempt-to-attempt flow (`createPractice`, `practicePress`, `practiceTick`, `practiceRestart`, `practiceWithSettings`, `resetStats`, `shownAttempt`), session stats, timeline geometry and feedback text. All pure and unit tested with synthetic timestamps, so `ui/practice.ts` only renders and forwards input. The engine is unchanged.
- **What gets practiced:** the combo open in the editor, including unsaved changes. The editor has a Practice button (disabled while the combo is invalid) and the header has a Practice link (`#practice`).
- **Countdown combos** show a message on the practice page instead of running, because the countdown UI is Layer 5. (Superseded: countdown combos run, see Layer 5 Part A.)
- **Auto re-arm:** after an attempt ends, the next one arms once there has been **1 s with no presses** (`REARM_QUIET_MS`). Each press during that time restarts the wait, so mashing out the rest of a dropped combo doesn't start (and fail) a new attempt. (Superseded: a countdown replaces the quiet wait, see Layer 5 Part A.)
- **Quick restart:** Space on the keyboard, or Back (8) / Start (9) on a standard-layout pad, re-arms immediately. These only count as restart while they're unmapped. Restarting during an attempt abandons it, and an abandoned attempt isn't counted in the stats. Space's default action (scrolling, clicking the focused button) is blocked on the practice page.
- **Results stay on screen:** the last finished attempt stays on screen until the next attempt grades its first step.
- **Ticks:** a `requestAnimationFrame` loop calls `practiceTick(performance.now())` to declare misses and re-arm. A 250 ms timer does the same while rAF is paused in a background tab. Grading itself only uses press timestamps, so rendering speed doesn't affect results.
- **Timeline:** one lane per graded step on a frame ruler that starts at frame 0. It shows the on-time window (shaded), the start of the target frame (line), and the latency-corrected press (dot). A missed step shows its deadline. A wrong button shows which button was pressed. In non-strict mode, ignored presses get their own lane. Relative windows are placed after the previous actual press. Steps never reached aren't drawn. The ruler ends 2 frames past the last item. If the attempt ended on its first press, there is no timeline.
- **Stats:**
  - **On-time rate** = on-time / times the step was reached. A step counts as reached when it got any grade, including MISSED and WRONG_BUTTON.
  - **Average and spread** use `deltaFrames` of correct-button presses only. Spread is the population standard deviation.
  - **Streaks** count clean attempts in a row; best streak is kept too.
  - The first-input start step shows how many times it started an attempt instead of a rate.
- **Session = this combo, unchanged:** stats stay in memory across page switches while the practiced combo is unchanged. Editing it, opening another combo, Reset stats, or reloading the page starts a new session. Stats are not saved to storage.
- **Strict mode** is a checkbox on the practice page (default on). It's kept in memory only for now; saving settings comes with the Layer 5 settings work (calibration, remapping). Changing it arms a fresh attempt and keeps the stats. (Superseded: saved in `uct.settings.v1`, see Layer 5 Part A.)
- **Mappings:** the practice page lists the current keyboard bindings and links to the Controls page (see "Input remapping").
- **Gamepad resolution warning** (§5) shows on the practice page when a pad is connected and the measured poll interval is about one frame or coarser at the combo's fps.
- **Feedback text:**
  - "On time (+5.2 ms)"; "On time, 1f late (+20.1 ms)" when inside the tolerance but off the target frame.
  - "2f early (−31.4 ms)" / "2f late (+31.4 ms)".
  - "Wrong button: HK at +1f (+20.0 ms)"; "Missed".
  - The first-input start step shows "Start".

### Input remapping (2026-10-30, during Layer 4 review)
- **Pulled forward from Layer 5** at the user's request: their stick's buttons didn't match the default punches-on-top / kicks-on-bottom layout, so the Controls page and saving mappings were done early. This replaces the Layer 2 note that remapping would wait for Layer 5.
- **Controls page** (`#controls`): one row per button, showing its keyboard and gamepad bindings as chips (✕ removes one). "Bind" waits for the next press (key, pad button, stick direction or hat direction) and binds it to that row's button. Escape cancels, and Escape and Tab can't be bound. While no row is waiting for a press, pressing anything flashes the row of the button it's bound to, as a live test. "Reset to defaults" asks first.
- **One button per control:** binding a control that already belongs to another button moves it, and the status line says so. A button can have any number of controls.
- **Pure helpers** in `input/mapping.ts`: `parseControl` (event `source` + `control` → `ControlRef`), `mapControl`, `bindControl`, `unbindControl`, `listBindings`, `controlLabel`, `keyLabel`. Unit tested.
- **Hat directions can be unbound:** `HatMapping` is now partial. An axis listed as a hat stays decoded as a hat even with no directions bound, so it isn't read as a plain axis instead. Unbound hat directions come through as unmapped presses, so they can be bound.
- **One mapping for every pad** (no per-device profiles) plus the keyboard. Simplest option; profiles can come later if needed.
- **Saved** in `localStorage` key `uct.mapping.v1` as `{ version: 1, keyboard, gamepad, gamepadAxes, gamepadHats }`. Nothing is stored until the first change, and reset deletes the key, so users on the defaults get future default changes. An unreadable saved mapping is copied to `uct.mapping.v1.backup` and the defaults are used.
- **Every page uses the saved mapping:** practice, controls and the debug page (whose table is now "Current mapping"). A page picks up the mapping when it opens.
- **MISC1 / MISC2 buttons** (added 2026-10-30 at the user's request) cover all 8 buttons of a standard stick. Defaults: LB (4) = MISC1 and LT (6) = MISC2, the two pad buttons the 6-button layout left free (top row X/Y/RB/LB, bottom row A/B/RT/LT); keyboard P = MISC1 and ; = MISC2, continuing the U/I/O and J/K/L rows. They are ordinary button IDs, so combo steps can use them too. Users with a saved mapping keep it and bind MISC1/MISC2 themselves; reset picks up the new defaults.
- **Restart controls** (Space, pad Start/Back) only restart while they aren't bound to a button. The practice page's restart hint lists only the ones that are free.

### Layer 5 Part A: sound and countdowns (2026-10-30)
- **Countdown replaces the 1 s quiet wait.** Every countdown has a 500 ms lead-in, then 3 beats ("3", "2", "1") 500 ms apart, then "Go!". From trigger to Go is 2 s (`COUNTDOWN_LEAD_MS`, `COUNTDOWN_BEATS`, `COUNTDOWN_BEAT_MS` in `practice/session.ts`). The lead-in keeps the result sound clear of beat 3. It also keeps a mashing player from hearing beat 3 over and over.
- **When a countdown runs:**
  - It starts as soon as an attempt ends (completed, missed or wrong button).
  - In countdown start mode it also starts on any mapped press or the restart control. This covers the first attempt after opening the page, and the first attempt after changing strict mode.
  - In first-input mode the first attempt after opening the page is armed right away, with no countdown.
- **A press during a countdown restarts it** and isn't graded. This keeps the old mash protection (mashing out a dropped combo can't start and fail the next attempt), but now it's visible. Countdown start mode has one exception: from the last beat ("1") on, the attempt is already running with frame 0 = Go, so a slightly early press grades `EARLY` (negative frames) instead of restarting. That uses the engine's existing "`start()` may be given a future time" rule.
- **First-input mode:** the attempt arms at Go and then waits for the first press as before. Restart (Space, pad Start/Back) still arms right away and skips the countdown (§7, "re-arm immediately").
- **Countdown start mode:** restart abandons the attempt and starts a fresh countdown. Frame 0 is Go's scheduled time, not latency-corrected (Layer 1 rule). The engine API is unchanged.
- **Timing is pure:** the countdown lives in `PracticeState.countdown` and is driven by timestamps, so `practicePress` catches up on countdown steps that are due even if no tick ran in between. `practiceRestart` now takes `now`. `REARM_QUIET_MS` and `lastActivityAt` are removed.
- **Display:** a large number at the top right of the practice card shows 3 / 2 / 1 / "Go!". "Go!" stays up for one beat. In countdown mode, the status line says what to press and on which frame after Go. The timeline note says frames count from Go.
- **Sounds:**
  - Synthesized with Web Audio oscillators (`audio/sounds.ts`). No audio files, no dependencies.
  - Sounds: countdown beat, Go, metronome tick, step on time, step off (early/late), attempt clean, attempt failed (missed, wrong button, or any step off), and control bound (Controls page).
  - Which sounds play is decided by pure functions in `practice/cues.ts`. A finished attempt plays only its clean/fail sound, not also its last step's sound. The first-input start step makes no sound, since its timing isn't graded. Non-strict ignored presses make no sound.
- **Scheduling:**
  - Countdown beats and metronome ticks are scheduled ahead on the audio clock. A performance.now() time is converted with `ctx.currentTime + (t − performance.now()) / 1000`, so they don't jitter with the frame rate.
  - Audio output latency isn't corrected here. Part B's calibration measures beat to press through the same path, so that latency ends up in the calibrated offset.
  - Scheduled beats are cancelled when a countdown restarts or stops. Scheduled ticks are cancelled when their step is graded or the attempt ends.
- **Metronome:**
  - The tick plays at the **middle** of each target frame (`METRONOME_FRAME_POINT = 0.5`), the safest moment to press.
  - Relative timing only knows the awaited step's tick, from the previous actual press. Absolute timing schedules every remaining step from frame 0.
  - No tick for the first-input start step. Ticks already in the past when they become known (very short gaps) are skipped.
- **Settings:** "Sounds" (event sounds and countdown beats) and "Metronome tick on target frames" are separate checkboxes on the practice page, with one volume slider. Both are off by default (§7). Turning one on plays a short test sound. The countdown always shows on screen; it only makes sound with Sounds on.
- **Audio unlock:** browsers keep audio suspended until a click or key press on the page, and gamepad presses don't count. The app resumes audio on any click or key press while a sound option is on. The practice page shows a note while audio is still blocked.
- **Saved settings:** `localStorage` key `uct.settings.v1` holds `{ version: 1, strict, sound, metronome, volume }`. This replaces Layer 4's in-memory strict mode. Nothing is stored until the first change. A missing or malformed field falls back to its own default; an unreadable value or unknown version gives all defaults (no backup copy, since nothing hard to recreate is lost). Part B will add the latency offsets here.
- **Hear timing** (added 2026-10-30 at the user's request, after trying the Part A sounds): a button on the practice page plays the combo's expected timing.
  - One tone per step, where a press on the middle of its target frame would land (the metronome point). Relative steps follow the previous expected press; absolute steps count from frame 0. The first-input start step is frame 0. Countdown combos play the 3 beats and Go first, with Go as frame 0. A 300 ms lead-in comes before the first sound.
  - Each step card is outlined while its tone plays.
  - It plays even with Sounds off, since the user asked to hear it. Volume still applies. Clicking again restarts it.
  - Any button press stops it, so its tones don't mix with an attempt. It doesn't change the practice state.
  - The schedule is a pure function (`timingPreview` in `practice/cues.ts`) and is unit tested. A new `press` tone is used for the steps.
- **Editor:** the countdown start-mode hint no longer says it's coming in Layer 5, and the practice page runs countdown combos instead of showing a message.

### Layer 5 Part B: calibration, mobile, deploy, sharing (2026-10-30)
- **New `calibration/` module:** pure beat schedule, tap matching and results, unit tested with synthetic taps. `ui/calibrate.ts` only renders and plays the beat. The engine API is unchanged; offsets reach it through the existing `Settings.latencyOffsetMs`.
- **Calibration run:** Start → 1 s lead-in → 4 count-in beats (not recorded) → 20 recorded beats, 500 ms apart (120 BPM). Count-in beats use the countdown `beat` sound, recorded beats the short `tick` (a sharp start is easier to tap to). The beat always plays on this page, whatever the Sounds setting, because it is the point of the page. A circle flashes on each beat as a visual guide. Escape or Stop ends a run.
- **Starting needs a click** (the Start button), not a pad press, because the click also unlocks browser audio.
- **Tap matching:** any press counts, mapped or not. A tap belongs to the nearest recorded beat and only if it is less than half a beat (250 ms) away. Only the first tap per beat per source counts. Count-in taps and taps after the last beat are ignored.
- **Result per source:**
  - Keyboard and gamepad are measured separately from the same run, so one run can calibrate both.
  - Offset = **median** of (tap − beat), as §6 says. Spread = population standard deviation (the same "spread" as session stats).
  - A source needs at least 10 recorded taps to be usable. A spread over 30 ms gets a "consider trying again" note.
  - The result is not applied automatically: a "Use +X ms" button applies it, rounded to 0.1 ms.
- **What the offset includes:** everything between the scheduled beat and the press timestamp: audio output delay, the player's habit of tapping early or late, and input delay. Beats use the same audio scheduling as the countdown and metronome (Part A), so the offset matches those exactly. Not measured separately: display delay of the flash.
- **Manual offsets:** number inputs per source on the Calibrate page, saved on change, with "Set to 0". Values must be within ±1000 ms (`MAX_LATENCY_OFFSET_MS`); anything else is rejected on input and on load.
- **Saved** in `uct.settings.v1` as `latencyOffsetMs: { keyboard, gamepad }`, each falling back to 0 on its own if invalid. The practice page uses them for grading and shows them with a link to Calibrate.
- **When the offset matters** (explained on the page): countdown starts (step 1 is measured from Go) and the metronome. In first-input combos frame 0 is the first press, which shifts by the same offset as every other press, so it cancels out unless keyboard and gamepad are mixed in one attempt.
- **Share by URL:**
  - "Copy share link" in the editor puts the combo, including unsaved changes, into `#share=<code>`. The code is base64url of compact JSON (`{ v: 1, n, f, t, s, p: [[button, target, early, late, label?]] }`), about 200 characters for a 3-step combo. Disabled while the combo is invalid.
  - Copies with the Clipboard API, or shows the link in a prompt to copy by hand where that isn't available (e.g. http on a LAN address).
  - Opening a link: the hash is cleared from the URL, and the combo opens in the editor as a new, unsaved combo with a notice saying to Save it. If the current draft has unsaved changes, the app asks first. A damaged link, unknown version, or a combo the engine rejects opens nothing and shows a notice. A blank name becomes "Shared combo". Codes over 20,000 characters are rejected unread.
- **Deploy:**
  - Vite already builds with `base: './'`, so the same `dist/` works at a domain root or a subfolder (GitHub Pages serves `/Universal-Combo-Trainer/`). Hash routing means no server rewrites are needed.
  - `.github/workflows/deploy.yml` runs `npm ci`, the tests and the build on every push to `main`, then publishes `dist/` to GitHub Pages. **One-time setup:** repo Settings → Pages → Source: "GitHub Actions".
  - `netlify.toml` is the alternative: same tests and build, publish `dist/`. Both pin Node 24.14.0 like `mise.toml`.
  - **Host (2026-10-30):** the repo was made public so GitHub Pages is free, and Pages is the host: https://joshleidl.github.io/Universal-Combo-Trainer/. `netlify.toml` stays as a fallback.
  - **First deploy problem (2026-10-30):** the account's user site (`joshleidl.github.io` repo) had a `CNAME` for joshleidl.com, a domain with no DNS, and every project site redirected there. The user removed it. Separately, the first push ran while the Pages source was still "Deploy from a branch", so GitHub's branch deploy of the raw files (whose `index.html` loads `/src/main.ts`) overwrote the built app; Firefox showed `NS_ERROR_CORRUPTED_CONTENT`. With the source on "GitHub Actions" only the workflow deploys. If it ever happens again, re-run the workflow from the Actions tab.
- **Mobile layout pass:** every page was checked at 375 px wide.
  - The header nav now wraps; with the new Calibrate link it was pushing the page wider than the screen.
  - On the Controls page each button's row stacks at ≤ 600 px (name and Bind button on top, keyboard and gamepad chips below, each labelled), because the Bind column was off screen.
  - The calibration circle is smaller on phones.
  - Wide tables on the practice stats and debug pages keep scrolling inside their own box, which is acceptable there.
  - No page scrolls sideways at 375 px.
  - There is still no on-screen touch input for presses; a phone needs a keyboard or controller (desktop is the primary target, §7).

### Controller wake-up banner (2026-10-30, after Layer 5)
- **Why:** browsers hide gamepads from a page until a button is pressed on them, so a stick can look "not working" until it's touched. The page can't tell "no pad plugged in" from "pad not woken yet".
- **Behavior:** a banner at the top of every page says "Using a controller or arcade stick? Press any button on it to wake it up…" whenever no pad is detected. When a pad appears while it's showing, it turns green with "✓ Controller detected: <name>" for 2.5 s (`PAD_DETECTED_MS`), then hides. A pad that is already detected when the page loads shows nothing. If every pad disconnects, the request comes back.
- **Dismiss:** keyboard-only users would otherwise see it on every visit, so the banner has a Dismiss button. Dismissal is saved (`padBannerDismissed` in `uct.settings.v1`) and also skips the "detected" message. There's no button to undo it yet; the Controls and debug pages still say how to wake a pad.
- **Pad names:** `padDisplayName` trims browser extras from `Gamepad.id` (Chrome's "(STANDARD GAMEPAD Vendor: … Product: …)", Firefox's "2c22-2000-" prefix).
- **Detection:** the app shell checks `navigator.getGamepads()` every 250 ms and on `gamepadconnected` / `gamepaddisconnected`. The state logic is pure (`input/wake.ts`) and unit tested; `ui/padBanner.ts` only renders.

### Tooling (2026-10-29)
- **Transcript script** is plain Node (`scripts/backup-transcript.mjs`, no dependencies), using the Node version mise already pins. It needs no build step and adds nothing to the app's stack. The backup folder is a mise env var, so the script has no personal paths in it.
- **mise** pins the Node version (`mise.toml`, Node 24.14.0) and provides task shortcuts (`mise run test`, `dev`, `build`, `typecheck`, `install`) that wrap the npm scripts. The npm scripts stay the source of truth.
- **Transcript folder moved to `mise.local.toml`** (2026-10-30): the repo is public, so the personal path (Windows username, folder layout) no longer lives in tracked files. `mise.local.toml` is gitignored; `mise.toml` has a commented example.
