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
- `buttons`: the input(s) to press (mapped button IDs, e.g. `LP`, `HK`, `UP`). One button is a normal step. Two or more is a **chord**: all of them must be pressed within the chord window, in any order. Directions can't be part of a chord (yet).
- `chordWindow` (chords only, required for them): how far apart a chord's presses may be, as `{ size, unit }`. `unit` is `frames` (grid frames, the same grid grading uses; `size` is an integer ≥ 0) or `ms` (corrected timestamps; `size` is a number ≥ 0). Default for a new chord in the editor: 2 frames.
- `targetFrame`: integer frame the input should land on
- `tolEarly`: frames early still counted as on time (default 0)
- `tolLate`: frames late still counted as on time (default 0)
- `label` (optional): display name, e.g. "cr.MK"

Combo-level settings:
- `fps`
- `timingMode`:
  - `relative` (**default**): each step's `targetFrame` is counted from the **frame the previous step's input landed on**. Matches how links are usually described ("a 3-frame gap after the last hit"). Frames form one fixed grid per attempt that starts at frame 0; presses never move it (see [DECISIONS.md](DECISIONS.md), "Fixed frame grid").
  - `absolute`: each step's `targetFrame` is measured from the attempt's frame 0.
- `startMode`:
  - `firstInput` (**default**): the first step's press defines frame 0 and is always graded on time (button correctness only).
  - `countdown`: a visual/audio countdown defines frame 0, and step 1 is graded against its `targetFrame` like any other step.

### Grading (per step)
1. The press lands on grid frame `floor((input timestamp − frame 0) / frameMs)`, after applying the latency offset (§6). The reference frame is the previous input's grid frame (`relative`) or frame 0 (`absolute`). `elapsedMs` = input timestamp − start of the reference frame.
2. `inputFrame` = press's grid frame − reference frame.
3. `deltaFrames = inputFrame − targetFrame`.
4. Result:
   - `ON_TIME` if `−tolEarly ≤ deltaFrames ≤ tolLate`
   - `EARLY` if `deltaFrames < −tolEarly`
   - `LATE` if `deltaFrames > tolLate`
   - `WRONG_BUTTON` if a different mapped button is pressed while this step is awaited
   - `MISSED` if no input arrives within `targetFrame + tolLate + timeoutFrames` (default timeout 30 frames)
5. Always report `deltaFrames` and raw `deltaMs` (relative to the start of the target frame) so feedback can show "2f late (+31.4 ms)".

### Chords
A single-button step is graded exactly as above. A chord step (2+ buttons) works like this:
1. **Collecting.** The chord starts with the first press of one of its buttons. While it is collecting, the `MISSED` timer is paused (it is counted from the chord's first press: a chord whose first press arrives in time can't become `MISSED`). The first press is still subject to the `MISSED` rule: a first press past the step's deadline is `MISSED`.
2. **Window.** Every chord button must be pressed within `chordWindow` of the first press: in `frames`, the last press's grid frame − the first press's grid frame ≤ `size`; in `ms`, last corrected timestamp − first corrected timestamp ≤ `size`.
3. **Complete.** When the last missing button is pressed inside the window, the chord is complete. It stays open until the end of the grid frame it completed on, so a press on that same frame counts as an extra press (a game reading buttons once per frame sees them together). Then it is graded. Its result appears at most one frame after it completes.
4. **Graded press = the last press** (the one that completed the chord). `inputFrame`, `deltaFrames`, `deltaMs` and `elapsedMs` are that press's. The next relative step counts from the frame it landed on.
5. **Each press also gets its own timing** (`EARLY` / `ON_TIME` / `LATE` against the step's window), reported per press. Result:
   - `SPLIT` if the presses don't all get the same grade (any mix of early, on time and late).
   - Otherwise that grade (`ON_TIME`, `EARLY` or `LATE`).
6. **Mistakes** (exact match):
   - `WRONG_BUTTON` if a button that isn't in the chord is pressed while the chord is awaited, or one of its buttons is pressed twice, or any press lands on the frame the chord completed on.
   - `PARTIAL` if the window runs out with only some of the chord's buttons pressed. It is known once the window runs out, even if no other press arrives.
   - Strict mode applies to both: strict ends the attempt; non-strict logs every press of the broken chord as ignored, resets the chord, and the step keeps waiting.
7. **First-input start with a chord as step 1:** the chord's first press is frame 0. Timing isn't checked (button correctness only, as for any start step). The next relative step counts from the frame the chord completed on.

### Input rules
- Only the **press edge** counts (button goes from up to down). Holds and key auto-repeat are ignored.
- **Strict mode** (default on): a wrong button ends the attempt with `WRONG_BUTTON`. With strict mode off, wrong presses are logged but ignored, and the step keeps waiting.
- An attempt ends when all steps are graded, on `MISSED`, or on a strict-mode `WRONG_BUTTON` or `PARTIAL`.
- A chord's presses are ordinary press edges; the input layer doesn't change. Known limits: some keyboards can't register certain 3+ key combinations (rollover / ghosting), and pad buttons seen in the same poll share one timestamp.

## 4. Architecture

```
src/
  engine/        # pure timing logic, no DOM; fully unit tested
    types.ts       Combo, Step, Settings, StepResult, AttemptResult
    timing.ts      frame/ms conversion, grading function
    attempt.ts     attempt state machine: idle → armed → running → done
    chord.ts       chord helpers: window checks, per-press timing, split rule
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

- **Practice view:** shows the combo as a row of steps. Each step lights up as it is graded, colored by result (on time / early / late / split / partial / wrong / missed) with "±Nf (±X ms)".
- **Timeline view:** a horizontal frame ruler showing target windows vs actual inputs for the last attempt.
- **Session stats:** per-step on-time rate, a count of each other result (early, late, split, partial, wrong, missed), average and spread of `deltaFrames`, and a running streak. Reset per session.
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
- Motion inputs (quarter-circles, charge inputs), negative edge (a release as an input), and directions in chords. Button chords are supported (§3, "Chords").
- **Frame snapshots:** grouping every press, release and held input on one grid frame into a single snapshot that grading reads at once, the way a game reads input once per frame. Today the engine grades press by press, so presses on the same frame can give different results depending on their order (BACKLOG, "same-frame presses" bug). Already decided for it: a tap pressed and released within one frame doesn't register, as in a game that reads held state once per frame; and the chord window's `ms` unit becomes obsolete, since snapshots group presses by frame. Found during the direction+button interview; see [docs/proposals/2026-11-02-dir-plus-button-inputs-spec.md](docs/proposals/2026-11-02-dir-plus-button-inputs-spec.md).
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
