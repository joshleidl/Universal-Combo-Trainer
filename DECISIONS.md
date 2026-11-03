# Decisions log

Decisions not covered by [SPEC.md](SPEC.md), grouped by layer or topic, oldest first. Add new entries at the bottom.

## Layer 1 (2026-10-29)
- **Tooling versions:** TypeScript 7, Vite 8, Vitest 5. `tsconfig` adds `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on top of `strict`.
- **Engine API shape:** pure functions over an immutable `AttemptState`: `createAttempt(combo, settings)`, `arm`, `start(state, frame0)`, `press(state, event)`, `tick(state, now)`, `attemptResult(state)`, `currentStepIndex(state)`. A call that doesn't fit the current phase returns the state unchanged. `arm()` on a `done` attempt returns a fresh armed attempt (quick restart).
- **Where settings live:** `fps`, `timingMode` and `startMode` sit on `Combo`. `strict`, `timeoutFrames` and `latencyOffsetMs` (per source) sit on a separate `Settings` object (defaults: strict, 30, 0/0).
- **Press events carry `source`** (`keyboard` | `gamepad`) so the engine can apply the right latency offset.
- **Frame math:** `inputFrame` is computed as `floor(elapsedMs * fps / 1000 + 1e-9)`. This is the same as SPEC §3's formula, but it avoids float error at exact frame boundaries (e.g. 50 ms at 60 fps is frame 3).
- **Validation:** `createAttempt` throws unless there is at least one step, `fps > 0`, `targetFrame`/`tolEarly`/`tolLate`/`timeoutFrames` are integers ≥ 0, and every step has a button.
- **MISSED window:** the last accepted frame is `targetFrame + tolLate + timeoutFrames` (inclusive). In relative mode it is counted from the previous input's grid frame, like grading. A press after the window grades the step `MISSED` (no timing fields) whatever its button, so the result is the same whether or not `tick()` ran first. A miss takes priority over a wrong button.
- **`tick(now)`** takes a raw timestamp and subtracts the *largest* latency offset, so it never declares a miss while a press that would still count could arrive.
- **firstInput start:** a wrong first press is `WRONG_BUTTON` (strict) or ignored and logged (non-strict). The first correct press gets `elapsedMs`, `inputFrame`, `deltaFrames` and `deltaMs` all 0.
- **Countdown start:** frame 0 is the timestamp passed to `start()` and is not latency-corrected (it is a stimulus time, not an input). Presses before `start()` are ignored. `start()` may be given a future time; presses before it grade `EARLY` with negative frames.
- **WRONG_BUTTON results** keep the press and its timing fields (frame, delta), so the timeline can show where the wrong press landed.
- **Attempt success** means it completed with every step `ON_TIME`.

## Layer 2 (2026-10-29)
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

## Release events (2026-10-30)
- **Event shape:** input events carry `edge: 'press' | 'release'`. `InputEvent` is the union of `InputPress` and `InputRelease`, so code can narrow on `edge`. `KeyboardTracker.keyUp()` returns a release; `GamepadTracker.poll()` returns both edges.
- **Callbacks:** `attachKeyboard` and `startGamepadPolling` keep sending only presses to `onPress`, and send releases to a new optional `onRelease`. Anything wired for presses can't get a release by accident.
- **`toPressEvent()`** returns null for releases as well as unmapped controls. Grading and the engine are unchanged.
- **Keyboard:** a keyup only counts as a release if its press was reported. Keys held across a window blur (held set cleared) or pressed with Ctrl/Cmd/Alt give no release.
- **Gamepad:** releases use the same timestamp rules as presses. A button held when the pad is first seen gives no press but does give a release. A pad that disconnects gives no releases. Axis directions release below the 0.4 hysteresis threshold, and hat diagonals release one direction at a time.
- **Debug log:** one row per edge, with an Edge column. "Since last press" is press-to-press only. Releases show hold time (release − press) in ms and frames (floored, like grading), or "—" when the press wasn't seen. Clearing the log keeps the press times of held controls.

## Layer 3 (2026-10-30)
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
- **On-time window hint:** each step shows its on-time frames and the ms span they cover (start of the first frame to the end of the last), e.g. "frames 10 to 14, 166.7 to 250.0 ms after the start of the previous input's frame".
- **Start mode** can be set to countdown in the editor now; the countdown itself is Layer 5 and the hint says so.
- **Routing:** the editor is the home page; the input debug page moved to `#debug`. A shared header has links to both.

## Layer 4 (2026-10-30)
- **New `practice/` module:** the attempt-to-attempt flow (`createPractice`, `practicePress`, `practiceTick`, `practiceRestart`, `practiceWithSettings`, `resetStats`, `shownAttempt`), session stats, timeline geometry and feedback text. All pure and unit tested with synthetic timestamps, so `ui/practice.ts` only renders and forwards input. The engine is unchanged.
- **What gets practiced:** the combo open in the editor, including unsaved changes. The editor has a Practice button (disabled while the combo is invalid) and the header has a Practice link (`#practice`).
- **Countdown combos** show a message on the practice page instead of running, because the countdown UI is Layer 5. (Superseded: countdown combos run, see Layer 5 Part A.)
- **Auto re-arm:** after an attempt ends, the next one arms once there has been **1 s with no presses** (`REARM_QUIET_MS`). Each press during that time restarts the wait, so mashing out the rest of a dropped combo doesn't start (and fail) a new attempt. (Superseded: a countdown replaces the quiet wait, see Layer 5 Part A.)
- **Quick restart:** Space on the keyboard, or Back (8) / Start (9) on a standard-layout pad, re-arms immediately. These only count as restart while they're unmapped. Restarting during an attempt abandons it, and an abandoned attempt isn't counted in the stats. Space's default action (scrolling, clicking the focused button) is blocked on the practice page.
- **Results stay on screen:** the last finished attempt stays on screen until the next attempt grades its first step.
- **Ticks:** a `requestAnimationFrame` loop calls `practiceTick(performance.now())` to declare misses and re-arm. A 250 ms timer does the same while rAF is paused in a background tab. Grading itself only uses press timestamps, so rendering speed doesn't affect results.
- **Timeline:** one lane per graded step on a frame ruler that starts at frame 0. It shows the on-time window (shaded), the start of the target frame (line), and the latency-corrected press (dot). A missed step shows its deadline. A wrong button shows which button was pressed. In non-strict mode, ignored presses get their own lane. Relative windows start at the frame the previous press landed on (fixed frame grid), so they line up with the ruler. Steps never reached aren't drawn. The ruler ends 2 frames past the last item. If the attempt ended on its first press, there is no timeline.
- **Stats:**
  - **On-time rate** = on-time / times the step was reached. A step counts as reached when it got any grade, including MISSED and WRONG_BUTTON.
  - **Average and spread** use `deltaFrames` of correct-button presses only. Spread is the population standard deviation.
  - **Streaks** count clean attempts in a row; best streak is kept too.
  - The first-input start step shows how many times it started an attempt instead of a rate.
- **Session = this combo, unchanged:** stats stay in memory across page switches while the practiced combo is unchanged. Editing it, opening another combo, Reset stats, or reloading the page starts a new session. Stats are not saved to storage.
- **Strict mode** is a checkbox on the practice page (default on). It's kept in memory only for now; saving settings comes with the Layer 5 settings work (calibration, remapping). Changing it arms a fresh attempt and keeps the stats. (Superseded: saved in `uct.settings.v1`, see Layer 5 Part A.)
- **Mappings:** the practice page lists the current keyboard bindings and links to the Controls page (see "Input remapping").
- **Gamepad resolution warning** (SPEC §5) shows on the practice page when a pad is connected and the measured poll interval is about one frame or coarser at the combo's fps.
- **Feedback text:**
  - "On time (+5.2 ms)"; "On time, 1f late (+20.1 ms)" when inside the tolerance but off the target frame.
  - "2f early (−31.4 ms)" / "2f late (+31.4 ms)".
  - "Wrong button: HK at +1f (+20.0 ms)"; "Missed".
  - The first-input start step shows "Start".

## Input remapping (2026-10-30, during Layer 4 review)
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

## Layer 5 Part A: sound and countdowns (2026-10-30)
- **Countdown replaces the 1 s quiet wait.** Every countdown has a 500 ms lead-in, then 3 beats ("3", "2", "1") 500 ms apart, then "Go!". From trigger to Go is 2 s (`COUNTDOWN_LEAD_MS`, `COUNTDOWN_BEATS`, `COUNTDOWN_BEAT_MS` in `practice/session.ts`). The lead-in keeps the result sound clear of beat 3. It also keeps a mashing player from hearing beat 3 over and over.
- **When a countdown runs:**
  - It starts as soon as an attempt ends (completed, missed or wrong button).
  - In countdown start mode it also starts on any mapped press or the restart control. This covers the first attempt after opening the page, and the first attempt after changing strict mode.
  - In first-input mode the first attempt after opening the page is armed right away, with no countdown.
- **A press during a countdown restarts it** and isn't graded. This keeps the old mash protection (mashing out a dropped combo can't start and fail the next attempt), but now it's visible. Countdown start mode has one exception: from the last beat ("1") on, the attempt is already running with frame 0 = Go, so a slightly early press grades `EARLY` (negative frames) instead of restarting. That uses the engine's existing "`start()` may be given a future time" rule.
- **First-input mode:** the attempt arms at Go and then waits for the first press as before. Restart (Space, pad Start/Back) still arms right away and skips the countdown (SPEC §7, "re-arm immediately").
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
  - Relative timing only knows the awaited step's tick, counted from the frame the previous press landed on (fixed frame grid). Absolute timing schedules every remaining step from frame 0.
  - No tick for the first-input start step. Ticks already in the past when they become known (very short gaps) are skipped.
- **Settings:** "Sounds" (event sounds and countdown beats) and "Metronome tick on target frames" are separate checkboxes on the practice page, with one volume slider. Both are off by default (SPEC §7). Turning one on plays a short test sound. The countdown always shows on screen; it only makes sound with Sounds on.
- **Audio unlock:** browsers keep audio suspended until a click or key press on the page, and gamepad presses don't count. The app resumes audio on any click or key press while a sound option is on. The practice page shows a note while audio is still blocked.
- **Saved settings:** `localStorage` key `uct.settings.v1` holds `{ version: 1, strict, sound, metronome, volume }`. This replaces Layer 4's in-memory strict mode. Nothing is stored until the first change. A missing or malformed field falls back to its own default; an unreadable value or unknown version gives all defaults (no backup copy, since nothing hard to recreate is lost). Part B will add the latency offsets here.
- **Hear timing** (added 2026-10-30 at the user's request, after trying the Part A sounds): a button on the practice page plays the combo's expected timing.
  - One tone per step, where a press on the middle of its target frame would land (the metronome point). Relative steps count whole frames from the previous step's target frame, and the half frame is added only when placing each sound, so it doesn't build up; absolute steps count from frame 0. The first-input start step is frame 0. Countdown combos play the 3 beats and Go first, with Go as frame 0. A 300 ms lead-in comes before the first sound.
  - Each step card is outlined while its tone plays.
  - It plays even with Sounds off, since the user asked to hear it. Volume still applies. Clicking again restarts it.
  - Any button press stops it, so its tones don't mix with an attempt. It doesn't change the practice state.
  - The schedule is a pure function (`timingPreview` in `practice/cues.ts`) and is unit tested. A new `press` tone is used for the steps.
- **Editor:** the countdown start-mode hint no longer says it's coming in Layer 5, and the practice page runs countdown combos instead of showing a message.

## Layer 5 Part B: calibration, mobile, deploy, sharing (2026-10-30)
- **New `calibration/` module:** pure beat schedule, tap matching and results, unit tested with synthetic taps. `ui/calibrate.ts` only renders and plays the beat. The engine API is unchanged; offsets reach it through the existing `Settings.latencyOffsetMs`.
- **Calibration run:** Start → 1 s lead-in → 4 count-in beats (not recorded) → 20 recorded beats, 500 ms apart (120 BPM). Count-in beats use the countdown `beat` sound, recorded beats the short `tick` (a sharp start is easier to tap to). The beat always plays on this page, whatever the Sounds setting, because it is the point of the page. A circle flashes on each beat as a visual guide. Escape or Stop ends a run.
- **Starting needs a click** (the Start button), not a pad press, because the click also unlocks browser audio.
- **Tap matching:** any press counts, mapped or not. A tap belongs to the nearest recorded beat and only if it is less than half a beat (250 ms) away. Only the first tap per beat per source counts. Count-in taps and taps after the last beat are ignored.
- **Result per source:**
  - Keyboard and gamepad are measured separately from the same run, so one run can calibrate both.
  - Offset = **median** of (tap − beat), as SPEC §6 says. Spread = population standard deviation (the same "spread" as session stats).
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
  - There is still no on-screen touch input for presses; a phone needs a keyboard or controller (desktop is the primary target, SPEC §7).

## Controller wake-up banner (2026-10-30, after Layer 5)
- **Why:** browsers hide gamepads from a page until a button is pressed on them, so a stick can look "not working" until it's touched. The page can't tell "no pad plugged in" from "pad not woken yet".
- **Behavior:** a banner at the top of every page says "Using a controller or arcade stick? Press any button on it to wake it up…" whenever no pad is detected. When a pad appears while it's showing, it turns green with "✓ Controller detected: <name>" for 2.5 s (`PAD_DETECTED_MS`), then hides. A pad that is already detected when the page loads shows nothing. If every pad disconnects, the request comes back.
- **Dismiss:** keyboard-only users would otherwise see it on every visit, so the banner has a Dismiss button. Dismissal is saved (`padBannerDismissed` in `uct.settings.v1`) and also skips the "detected" message. There's no button to undo it yet; the Controls and debug pages still say how to wake a pad.
- **Pad names:** `padDisplayName` trims browser extras from `Gamepad.id` (Chrome's "(STANDARD GAMEPAD Vendor: … Product: …)", Firefox's "2c22-2000-" prefix).
- **Detection:** the app shell checks `navigator.getGamepads()` every 250 ms and on `gamepadconnected` / `gamepaddisconnected`. The state logic is pure (`input/wake.ts`) and unit tested; `ui/padBanner.ts` only renders.

## Tooling (2026-10-29)
- **Transcript script** is plain Node (`scripts/backup-transcript.mjs`, no dependencies), using the Node version mise already pins. It needs no build step and adds nothing to the app's stack. The backup folder is a mise env var, so the script has no personal paths in it.
- **mise** pins the Node version (`mise.toml`, Node 24.14.0) and provides task shortcuts (`mise run test`, `dev`, `build`, `typecheck`, `install`) that wrap the npm scripts. The npm scripts stay the source of truth.
- **Transcript folder moved to `mise.local.toml`** (2026-10-30): the repo is public, so the personal path (Windows username, folder layout) no longer lives in tracked files. `mise.local.toml` is gitignored; `mise.toml` has a commented example.

## Fixed frame grid (2026-10-30, approved; implemented 2026-10-31)
- **Problem:** in relative mode each step is timed from the previous press's exact timestamp, which usually falls partway through a frame. The grid restarts mid-frame on every press, so step 3 and later can be graded one frame short.
- **Approved rule (relative mode):** one fixed frame grid per attempt, starting at frame 0 (the first input in first-input mode, Go in countdown mode). A press lands on `gridFrame = floor((t − frame0) / frameMs)`. A relative step is counted from the start of the frame the previous press landed on, not from the press's exact time. SPEC §3 now states this rule.
- **Known limit:** the trainer can't see where the first press falls inside the game's own frame, so a gap can still differ from the real game by up to one frame.
- **Absolute mode:** no change needed for now. It already counts every step from frame 0, so it is already on the fixed grid.
- **Engine (2026-10-31):** `AttemptState` gains `lastInputFrame`, the grid frame of the previous graded press. Grading, the MISSED window and `tick()` count whole frames on the grid, so float error can't move a press across a frame edge. `elapsedMs` on a relative step is ms since the start of the previous press's frame. It replaces `lastInput` (ms), which nothing reads anymore. New `gradeFrames()` in `timing.ts` grades a known frame count; `gradeTiming()` is unchanged and calls it.
- **Practice side (2026-10-31):** metronome ticks, the Hear timing preview and timeline windows count relative steps from the previous press's grid frame, like grading. The preview chains whole frames and adds the half frame only when placing each sound. The editor hints say "the frame the previous input landed on".

## Chords (2026-11-01)
Proposal: [docs/proposals/2026-10-31-chords.md](docs/proposals/2026-10-31-chords.md). SPEC §3 "Chords" has the rules; this is the record of how they were chosen.
- **User's answers:**
  - Q1 = 1C: the chord window is set per step. It can be entered in frames or ms; the editor warns about the frame-edge problem and explains it with a diagram on hover.
  - Q2 = 2B: the graded press is the last one (when the chord completes).
  - Q3 = 3C and Q4 = 4C: a new `SPLIT` grade.
  - Q5 = 5B: exact match, with a new `PARTIAL` grade for a subset.
- **Step shape:** `button` is replaced by `buttons: ButtonId[]` (one code path; a single button is a list of one). `chordWindow: { size, unit: 'frames' | 'ms' }` is required on chords and ignored (and stripped on save) on single steps. Frames must be a whole number ≥ 0; ms any number ≥ 0. Required rather than defaulted, so tuning the editor's default later can't silently change saved chords.
- **Directions** can't be in a chord: validation rejects them, and `DIRECTION_BUTTONS` lives in `engine/types.ts`.
- **Old data:** saved combos with a `button` field load as `buttons: [button]`, so the storage version stays 1. Share codes are now v2 (`[buttons, target, early, late, label?, [size, 'f' | 'm']?]`, label `''` when only a window follows); v1 links still open.
- **SPLIT rule:** SPLIT whenever the presses don't all get the same grade (any mix of early, on time and late); otherwise that shared grade. First built as "SPLIT only when the first press is early and the last isn't" (so on-time-then-late was `LATE`, the proposal's S3 under 2B); changed the same day at the user's request to call any mixed result a split for now, to be refined later. Each press also gets its own timing (`StepResult.presses`, with `timing` early / on time / late) for the feedback text and timeline.
- **Extra presses on the completing frame:** a complete chord stays open until the end of the grid frame it completed on, and any press on that frame is an extra press (`WRONG_BUTTON`). Without this, S8 (three buttons on one frame) would depend on press order: a pad reports buttons from one poll in button order, so LP+MP+HP would complete LP+MP and hand HP to the next step. Cost: the result appears up to one frame later, and a next step with a relative target of 0 can't be pressed on the chord's frame.
- **PARTIAL is a mistake like WRONG_BUTTON:** strict ends the attempt (new `AttemptEnd` `'partial'`, "Partial chord on step N."); non-strict ignores every press of the broken chord, resets it, and keeps waiting (proposal default). The same goes for wrong and extra presses during a chord.
- **Pressing a chord button twice** is an extra press (proposal default).
- **MISSED:** the chord's first press is checked against the deadline like any press. Once a chord has started, the MISSED timer is paused, so a chord can complete after the deadline and grade `LATE` (proposal default: counted from the first press).
- **When a chord closes:** a press first closes any chord that is due by its own corrected time, so results don't depend on whether `tick()` ran in between (same idea as MISSED). `tick()` uses `now` minus the largest latency offset, as for MISSED.
- **Chord as step 1 in first-input mode** (open question 3): the chord's first press is frame 0, so the chord window is measured on the same grid as everything else. Its timing isn't checked (all zeros, per-press timing left out). The next relative step counts from the last press's frame (2B). A start chord that breaks before completing has no timing fields, like a wrong first press today.
- **Step-level timing fields** are the last press's for every chord result, including WRONG_BUTTON (the wrong press) and PARTIAL (the last press that did arrive), matching how WRONG_BUTTON keeps its timing today.
- **Stats:** each step counts every grade (`StepStats.counts`), shown in a new "Other results" column (e.g. "2 early · 1 partial"). SPLIT counts toward average and spread (its graded press is a correct button); PARTIAL doesn't (the chord never completed).
- **Sounds:** SPLIT and PARTIAL use the existing "off" sound; no new sound.
- **Colors:** split is purple, partial is pink, in both light and dark themes.
- **Practice page:** chord steps show as "LP+MP". While a chord is half pressed, the pressed buttons are underlined on the step card.
- **Timeline** (open question 7): every press of a chord gets a dot tagged with its button (tags alternate above and below so close presses stay readable). The press that broke the chord is red. The chord window is shaded from the first press: to the end of the last allowed frame for frames, or exactly `size` ms for ms.
- **Editor:**
  - "+" adds the first button not already in the step, skipping directions. It's disabled when the only button is a direction or every button is used. Chord selects don't offer directions. "✕" removes a button; going back to one button drops the window.
  - A new chord gets 2 frames (open question 5; to be tuned in the hardware check). Switching units converts the size at the combo's fps (frames → ms rounded to 0.1 ms, ms → nearest frame), so the window doesn't jump to a very different size.
  - The warning shows on every chord, worded for the unit in use ("⚠ Frame edges" / "⚠ Games count frames"). Hover, keyboard focus, or a tap shows a panel under the step: a diagram of two chords (A: 14 ms apart inside one frame = 0 frames; B: 2 ms apart across an edge = 1 frame), then what that means for the unit in use, then for the other unit, then a note that the trainer's frame edges aren't the game's. It's a full-width panel rather than a floating tooltip so it can't push the page sideways on a phone.
  - The step hint adds the chord rule, e.g. "Press LP+LK within 2 frames of the first press; timing is graded on the last press."
- **Examples** (open question 6): a fourth example, "Example: chord link" (cr.MK, then LP+LK, then st.HP), is seeded for new browsers only. Existing users don't get it, since examples are only seeded into empty storage. This goes past SPEC §8 Layer 3's "2–3 example combos"; the example test now expects 3–4.
- **Engine module:** `engine/chord.ts` holds the pure helpers (`isChord`, `insideChordWindow`, `chordGrade`, `missingButtons`); `attempt.ts` holds the chord state (`AttemptState.chord`) and exports `chordProgress` for the practice page.
- **Branch:** `chords` was branched before the spec split, so `main` was merged into it at the start of this work.

## Direction+button steps: spec (2026-11-02, session A)
Proposal: [docs/proposals/2026-11-02-dir-plus-button-inputs-spec.md](docs/proposals/2026-11-02-dir-plus-button-inputs-spec.md). Its decisions table (section 1) is the record of the user's interview answers; SPEC §3 "Directions", §4, §7 and §8 have the rules. This entry records what session A added or settled on top of it.
- **User's main answers** (proposal numbering): held, not fresh, directions (1B), checked at the end of the button's grid frame (2B); absolute `LEFT` / `RIGHT`, no facing; per-step exact / at least (4C), new direction steps default to exact, plain steps to at least; stray direction presses are never mistakes (3A); direction mistakes reuse `PARTIAL` (missing) and `WRONG_BUTTON` (wrong) and never end the attempt (6C, 7B); directions with chords allowed (8B); one stick position in numpad layout (10C); SOCD resolves to neutral (11A); single-direction steps become position steps (12B, later dropped: see "Position steps out of scope"); storage stays v1 with share code v3 (13A); build direction+button before frame snapshots (23A).
- **Position step 1 in first-input mode** (asked in session A; superseded the same day, position steps are out of scope): a position released within frame 0 doesn't count (user's Option 1). The input that enters the position sets frame 0, and step 1 only counts if the position is still held at the end of frame 0; otherwise the attempt goes back to waiting. Matches every other position step and the frame snapshot rule that a sub-frame tap doesn't register.
- **Position steps, gaps filled (simplest option; superseded the same day, position steps are out of scope):**
  - Only frames after the frame the previous step landed on count, so a position step can't land on the previous step's frame (a relative target of 0 is impossible, the same cost chords and direction checks have). This also settles what "already held when the step starts" means: held at the end of the previous step's frame.
  - Step 1 in countdown mode: frame 0 counts, compared with the position held when frame 0 starts.
  - A button press while a position step is awaited is `WRONG_BUTTON` (strict ends, non-strict ignores), as a button press during a single-direction step was before. A button press on the frame a position step lands on is an extra press, like any other pending end-of-frame check.
- **API names (open item 5)**, written into SPEC §4 "Engine API: directions" and **approved by the user on 2026-11-02**:
  - `Position` (1–9 without 5) for steps, `HeldPosition` (adds 5, neutral) for what the stick reads. `StepResult.direction.wanted` is a `HeldPosition` so an exact plain step can record "wanted neutral" as 5.
  - `press()` takes direction presses too (no separate direction-press call); new `release()` and `ReleaseEvent`; `arm(state, held?)` keeps the existing held set when `held` is left out, so quick restart from `done` keeps it.
  - `StepResult.direction` is set only on steps that ran a check. The timeline tags only those steps' dots with the held position. The proposal said "each graded button dot"; the user chose this option (A) over tagging every dot (B, which needed a grey "not checked" tag style and the held position on every result) on 2026-11-02. The stick lane above still shows what was held on every frame.
  - `AttemptResult.positions` entries carry the corrected timestamp of the input that made the change.
  - `heldPosition(state)` for the live input display; `practiceRelease()` on the practice layer.
- **Share code v3 layout (open item 5), not built:** drafted as `[buttons, target, early, late, label?, chordWindow?, direction?]`, with `direction = [position, 'e' | 'a']`, missing label `''` and missing chord window `null` when a later field is written, and position 5 with `'e'` for an exact plain step. Dropped the same day along with share links (below); kept here for when they come back.
- **Examples:** SPEC §8 Layer 3's "2–3 example combos" now notes the later growth to 4 (chords) and 5 (this feature) instead of being contradicted.
- **BACKLOG "Directions in chords"** is marked as specified and in progress; it gets struck through once the editor (session E) is done.

## Phone width dropped (2026-11-02)
- **User's call:** remove phone width support from the spec, the requirements and the code. The app is built and checked for desktop with a keyboard or controller only (SPEC §7).
- **Removed:** the SPEC §7 "must be usable at phone width" rule, the README line, the `@media (max-width: 600px)` block in `src/style.css` (narrow practice step grid, single-column stats, tighter header nav, stacked Controls rows, smaller calibration pulse, chord tip margin), and a stale comment in `src/ui/controls.ts`. The NEXT_SESSION item to test the phone layout on hardware is gone.
- **Kept:** the viewport meta tag in `index.html` and general wrapping rules (e.g. the header nav wraps), since they also help narrow desktop windows. Older entries (Layer 5 Part B "Mobile layout pass", the chords proposal's 375 px check) stay as history.

## Share links dropped (2026-11-02)
- **User's call** (direction+button session A): share-by-URL is dropped for now and will be added back later (BACKLOG, "Bring back share links"). This replaces the planned share code v3.
- **When:** the code (`combo/share.ts`, the editor's "Copy share link" button, the `#share=` route and notices in `main.ts`, `tests/combo/share.test.ts`) is removed in direction+button session B, which was going to change it anyway. Until then the current build still has it.
- **Effect:** links already sent (v1 and v2) stop opening once the code is removed. Combos saved in the browser aren't affected.

## Position steps out of scope (2026-11-02)
- **User's call** (direction+button session A, after reviewing the position-step gaps): position steps (a direction with no button, graded on the frame the stick enters it; proposal decision 21, 12B) are out of this feature. They can come back later (SPEC §9; BACKLOG "Position steps"). The proposal has an "Amendments" section recording the change.
- **What this settles:** the position-step questions from session A (position step 1 released within frame 0, landing on the previous step's frame, countdown frame 0, button presses while one is awaited) no longer apply. The answers given are kept in BACKLOG "Position steps" for when the feature comes back.
- **Single-direction steps stay as they are** (simplest option; superseded the same day by "Single-direction steps removed", below): a step whose only button is one direction (e.g. `['DOWN']`) is graded on that direction's press edge like a button, with no end-of-frame check, SOCD or held state. Storage needs no conversion. A button press while one is awaited is still `WRONG_BUTTON`. The one change, from decision 7: a press of a *different* direction while one is awaited is ignored instead of `WRONG_BUTTON`.
- **API:** the approved `isPositionStep(step)` helper is dropped. Nothing else in the approved API changes.
- **Gone from the plan:** the storage conversion of single-direction steps, proposal cases L1, L1e and L2, and the "single-direction steps become position steps" behavior changes (SOCD on a single-direction step, entering it by a release).

## Single-direction steps removed (2026-11-02)
- **User's call** (direction+button session A): steps whose only button is a direction (e.g. `['DOWN']`) are removed from the app, and existing combos are converted. Directions are now never a step's button; they only come back through `direction` on a button step (sessions B–E).
- **Validation:** any direction in `buttons` is an error ("directions can't be a step's button (DOWN)"), alone or in a chord. This replaces the chord-only check.
- **Conversion on load** (`dropDirectionSteps` in `storage/combos.ts`, simplest option):
  - The step is dropped. In relative mode its `targetFrame` is added to the next kept step's (consecutive direction steps add up), so the following buttons keep their timing, assuming the direction landed on its target. In absolute mode nothing else changes.
  - The removed step's tolerances and label are lost; the next step keeps its own tolerances.
  - A combo made only of direction steps ends up empty, fails validation and is dropped.
  - When anything changed, the original goes to `uct.combos.v1.backup` and storage is rewritten once (the existing damaged-data path), so a later build could still recover it.
- **Editor:** button selects no longer offer directions (one list, `STEP_BUTTONS`, for single buttons and chords). The "+" button's "Directions can't be part of a chord" case is gone.
- **Examples:** none of the shipped examples had a direction step, so they don't change.
- **Share links:** v1 / v2 links containing a direction step no longer open (validation rejects them). Not converted, since share links are removed in session B.
- **Until session C:** a direction press during a button step is still `WRONG_BUTTON` in strict mode (decision 7 lands with the engine work).

## Direction+button steps: session B (2026-11-02)
- **Types:** `Position`, `HeldPosition` and `DirectionMatch` are in `engine/types.ts`; `Step` has `direction?` and `directionMatch?`. `DirectionMistake`, `ReleaseEvent`, `PositionChange` and the `StepResult` / `AttemptResult` additions wait for session C, which uses them.
- **Validation** (`validateCombo`): `direction` must be one of 1, 2, 3, 4, 6, 7, 8, 9 ("direction must be a numpad position 1–9 other than 5"); `directionMatch` must be `exact` or `atLeast`. Both are allowed on any button step, including chords; a `directionMatch` without a `direction` is a plain step's neutral / any setting. A step still needs a button, so a direction alone isn't a step.
- **Storage** (simplest option): the fields are saved as given and loaded only when well formed. A wrong type or value makes the combo unreadable, so it goes through the existing damaged-data path (dropped, original backed up), like a bad chord window. A missing field stays missing; nothing is filled in on load, so `directionMatch: 'atLeast'` and no `directionMatch` both mean at least.
- **`combosEqual`** compares `direction` and `directionMatch`, treating a missing match as `atLeast`, so the editor's unsaved-changes check and the practice page's "combo changed" check see direction edits.
- **Share links removed:** `combo/share.ts`, `tests/combo/share.test.ts`, the share tests in `tests/combo/chords.test.ts`, the editor's "Copy share link" button, and the `#share=` handling in `main.ts`. The editor's one-time `notice` (its `EditorSession.notice` field, the message element and the `.notice` style) only ever showed share-link messages, so it went too.
- **Not yet:** grading ignores the new fields (session C), and the editor has no direction controls or friendly wording for the new validation messages (session E). Until then a direction can only come from saved data.

## Direction+button steps: session C (2026-11-02)
Engine only (`engine/direction.ts`, `engine/attempt.ts`, `engine/types.ts`), per SPEC §3 "Directions" and §4 "Engine API: directions". Tests: `tests/engine/direction.test.ts` (helpers and behavior) and `tests/engine/directionExamples.test.ts` (the proposal's section 2 cases, except L1, L1e, L2).
- **`AttemptState.positionLog`** (user's call, asked in session C; added to SPEC §4): `positions` needs a record of when the position changed, and in first-input mode frame 0 isn't known until the first button press, so the state keeps the changes with their corrected times and `attemptResult` builds `positions` from them. While there's no frame 0 and nothing pending that would set one, only the latest position is kept.
- **Gaps filled (simplest option):**
  - **Held set in `done` too.** SPEC lists idle, armed and running; tracking after the end as well means `arm()` from `done` without a held set keeps an accurate one. The `positions` history still stops when the attempt ends.
  - **Button releases are ignored entirely**, including for closing due checks. A later direction input or `tick()` closes the check with the same result, so only when it shows changes.
  - **Direction inputs close due chords and checks but don't end a step as `MISSED`.** SPEC rule 4 only names checks; `MISSED` stays with `tick()` and button presses.
  - **`pendingCheck` is for single-button steps only.** A chord already stays open to the end of its completing frame, so its check runs when it's graded.
  - **Step 1 with a check in first-input mode stays `armed`** until the end of frame 0, as a step-1 chord does while it's collected. In non-strict mode an extra press on frame 0 ignores both presses and step 1 waits again (frame 0 isn't set). In strict mode the `WRONG_BUTTON` result has no timing fields, like a wrong first press.
  - **A strict extra press (later steps)** gives the step a `WRONG_BUTTON` result for the extra press with its own timing against the step, and no `direction` (the check didn't run), like a chord's wrong press.
  - **`positions`:** the first entry is the position at the end of frame 0 (changes before frame 0 count toward it), with frame 0's timestamp. Empty when the attempt ended before it had a frame 0 (a strict wrong first press, a step-1 chord mistake, or an extra press during a step-1 check).
  - **Inputs are taken in arrival order.** A check reads the held set left by every input that arrived before the one that closed it. Inputs from two sources with different latency offsets can arrive in a different order from their corrected times (the same limit chords have); in `positions` such a change counts on the later frame.
- **Old rule removed:** a direction press during a button step is no longer `WRONG_BUTTON` in strict mode. No existing test relied on it (none pressed a direction during an attempt), so no test changed; new tests cover the new rule in both modes.
- **Until session D:** the practice layer doesn't send releases or pass the held set to `arm`, so in the app a direction press stays held for the rest of that attempt, restarts start with nothing held, and a direction press still starts or restarts a countdown. Plain at-least steps (every step the editor can build today) grade as before.
