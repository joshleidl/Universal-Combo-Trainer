# Plan: frame-based inputs

Implements [docs/proposals/2026-11-08-frame-based-inputs-spec.md](../proposals/2026-11-08-frame-based-inputs-spec.md) on branch `frame-based-input`. Each milestone ends with `mise run test` and `mise run typecheck` passing, a commit, `mise run transcript` (SPEC §10), and a stop for review.

## Settled before the plan (user, 2026-11-08)
- **Decision 15:** a new pure module `engine/frames.ts` groups inputs into frame records. `attempt.ts` keeps `press` / `release` / `tick` as its outer calls and grades closed frames inside. Records aren't kept after grading; their reports go on `StepResult.reports`. `pendingCheck` and the chord's `complete` flag go; `AttemptState` gains the frame buffer, and `held` now holds buttons too (the press rule needs them).
- **Countdown mode:** frames before Go (negative frames, from `start()` on) are closed and graded like any other, so a press just before Go still grades `EARLY`.
- **A1–A5** accepted as written.

## Minor gaps: assumptions (simplest option; logged in DECISIONS.md in M1)
1. **Empty frames aren't stored.** Only frames with inputs get a record. The engine still treats every frame as closing: after each record, and on `tick`, it runs the deadline checks (`MISSED`, the chord window running out) for every frame closed since. Same results as one record per frame.
2. **First-input frame 0** starts at the first down event of a non-direction button that isn't already held (a press edge), on its corrected time (A3). Direction inputs before it only change the held state.
3. **The stray press named in a `WRONG_BUTTON` result** is the first non-awaited button press on the frame, in arrival order. Its timing is the frame's timing.
4. **Non-strict extra press / wrong frame:** every press on the frame goes to `ignoredPresses` (one entry per press: its last down event).
5. **Chord `ms` window:** "the first press" is the earliest press ms on the chord's first frame. On the frame where the ms window runs out, presses after the window's end don't count toward the chord; if the chord is still incomplete it's `PARTIAL`, and in non-strict mode those presses are ignored with the broken chord.
6. **A chord's `WRONG_BUTTON` result** lists the chord's earlier presses, then every press of the breaking frame in arrival order, the wrong one last (the timeline marks the last as wrong).
7. **`chordProgress`** shows only presses from closed frames, so the live chord highlight can lag by up to one frame.
8. **The frame fraction** ("+2.3f") is shown wherever the feedback shows ms, including "Wrong button: HP at +1f (+5.0 ms, +0.3f)".
9. **The last step** follows the extra-press rule too: the attempt completes when its frame closes, and a stray press on that frame is a mistake.
10. **Frame 0 in non-strict first-input mode** is cleared when step 1 is ignored; the held state is kept (3.5).

## Milestones

### M1. SPEC step (docs only)
Apply the proposal to the project docs before any code (CLAUDE.md).
- `SPEC.md`: new §3 "Frames" (3.1); §3 Grading (3.2), Chords rules 2, 3, 6 (3.3), Directions rules 4, 5 + reports (3.4), first-input start (3.5), Input rules and known limits (3.6); §4 "Engine API: frames" (decision 15 as settled above; `PendingCheck` and stay-open go); §7 feedback text (3.7); §8 build stages "Frame-based inputs"; §9 remove "Frame snapshots"; update the architecture tree (`engine/frames.ts`).
- `DECISIONS.md`: "Frame-based inputs: spec" entry (decision 15, countdown negative frames, the assumptions above).
- `BACKLOG.md`: add "block mixed input sources", "warn about steps that can't be on time under one-step-per-frame"; note on "Mashing shouldn't cause failures". (The same-frame bug is struck through in M7, once built.)
- `NEXT_SESSION.md`: current state.
- Commit the proposal file and this plan with it.
- **Test:** none (no code). Tests and typecheck still pass (502).

### M2. Frame layer module (done)
- New `src/engine/frames.ts` (pure): `FrameEvent`, `FramePress`, `FrameRecord`, `FrameBuffer`; `createFrames(fps, held)`, `setOrigin`, `clearOrigin`, `addInput(buf, ev, t, down) → { buf, closed }`, `closeBefore(buf, frame) → { buf, closed }`, `lastClosedFrame`, `frameOf` (names as in SPEC §4; the held set is `buf.held`). Grid math reuses `msToFrame` from `timing.ts`.
- Rules: the press rule against the previous frame's end; one press per button per frame, ms from the last down event; lost re-presses; direction taps; end state with SOCD position and opposite pairs; an input on an already closed frame counts on the open frame.
- Export from `engine/index.ts`. Not wired into `attempt.ts` yet.
- **Test first:** `tests/engine/frames.test.ts`: grouping by frame, frame closes on a later input and on `closeBefore`, tap inside a frame registers (F3), double tap is one press timed from the last down (F5), lost re-press (F4), held at arm gives no press, direction tap and opposites flags (F6, F7), late input lands on the open frame, negative frames.

### M3. Engine: single-button steps graded per closed frame (done)
- `src/engine/attempt.ts`: route `press` / `release` / `tick` through the frame buffer; grade each closed frame against the awaited step (3.2): no presses / exactly the step's button / step's button plus a stray (extra press, every step) / only strays. One step per frame. `MISSED` when the last accepted frame closes. First-input start (frame 0 at the first press edge; step 1 graded when frame 0 closes; non-strict failure clears frame 0). Countdown: frames from `start()` on, negative ones included. Direction check on the graded frame's end state. Remove `pendingCheck`. `arm` keeps held buttons; `release` updates button held state.
- `src/engine/types.ts`: drop nothing public yet; `AttemptState` changes (internal).
- Chord steps: their tests (engine and practice) are skipped in this milestone (`describe.skip` / `it.skip`, pointing at M4); chord grading is temporarily a stub that throws. The app's chord example is broken until M4.
- **Tests:** update `tests/engine/attempt.test.ts`, `direction.test.ts`, `directionExamples.test.ts`, `fixedFrameGrid.test.ts`, `gameFrameGap.test.ts` for results arriving at frame close (helpers add a closing `tick`); rewrite same-frame cases (C6): stray on the same frame in either order (F2, F2n, F11), late (F12), relative target 0 can't be on time.
- As built: shared helper `tests/engine/settle.ts` (`settle`, `openFrameEnd`) closes the open frame at its end; new rule tests in `tests/engine/frameGrading.test.ts`; practice tests updated too (results and the next countdown come at frame close; repeated presses of one button now need releases, so practice helpers send taps).

### M4. Engine: chords over frames (done)
- `src/engine/attempt.ts` and `src/engine/chord.ts`: collecting over frames (3.3); window in frames, and in `ms` with the same-frame rule; complete on the frame the last button is pressed, with the extra-press rule on that frame; `PARTIAL` when the window's last frame closes; per-press timing by frame; `SPLIT` unchanged; step-1 chord in first-input mode; chords with a direction checked on the completing frame's end state.
- **Tests:** unskip and update `tests/engine/chord.test.ts` and the chord cases in other engine tests; add F9, F10, and "presses on one frame can't split".

### M5. Engine: reports, and the F1–F12 table test (done)
- `src/engine/types.ts`: `StepResult.reports` (`lostRepresses`, `directionTaps`, `opposites`).
- `src/engine/attempt.ts`: collect lost re-presses for the awaited step until it's graded (A1); on a failed direction check, add ignored direction taps and opposite pairs from the graded frame (A2, decision 5).
- **Tests first:** `tests/engine/frameExamples.test.ts`, one row per worked example F1–F12 (proposal section 2), checking grade, timing fields, when the result is known, and reports. Plus report edge cases: none on a passing check, none when no step is awaited.

### M6. Practice side and feedback text (done)
- `src/practice/format.ts`: frame fraction (`deltaMs / frameMs`, one decimal, sign of the ms) wherever ms is shown; notes after " · ": "→ tapped, not held at end of frame", "(← and → both held)" inside the direction note, "LP pressed again while held (not counted)". `describeStep` takes the fps.
- `src/ui/practice.ts`: pass the fps (text only, C5).
- `src/practice/session.ts`: nothing expected beyond passing held buttons (already passed); confirm.
- **Tests:** `tests/practice/*.test.ts` updated for results at frame close (sounds, stats, countdown after the last step); new format tests for each text in 3.7. Check the app in the browser with the keyboard: a clean run, a same-frame stray, a direction tap.

### M7. Wrap-up (done)
- `BACKLOG.md`: strike through the same-frame bug. `DECISIONS.md`: gaps filled during M2–M6. `NEXT_SESSION.md`: final state. SPEC §8 stages marked done.
- Requirements check: every requirement and acceptance criterion in the proposal reported as met / partly met / not met with a pointer to code or test.
- **Test:** full suite and typecheck.

## Follow-ups (noticed, not built)
- **Hardware check on a pad** (like direction+button session F): F2 (two buttons in one pad poll) is tested in the engine with identical timestamps, and the browser check used the keyboard only.
- **Result delay with a large pad offset:** `tick` closes frames using the largest latency offset, so a keyboard player with a calibrated 40 ms pad offset waits ~40 ms longer for every result. Closing by the source actually in use would remove that (ties in with BACKLOG "Block mixed input sources").
- **Reproducible browser check:** the Playwright script lives in the session scratchpad. A committed script (or a `mise` task) would let later sessions rerun it.
- **Test helpers read the frame buffer's internals** (`tests/engine/settle.ts` uses `frames.origin` / `frames.open`). A small engine query such as `openFrameEnd(state)` would decouple them.

## Requirements check (M7)
Status: **met**, **partly met** or **not met**, against the proposal ([docs/proposals/2026-11-08-frame-based-inputs-spec.md](../proposals/2026-11-08-frame-based-inputs-spec.md)) and SPEC §8 "Frame-based inputs".

### Worked examples (section 2)
| Case | Status | Proof |
|---|---|---|
| F1–F12 | met | `tests/engine/frameExamples.test.ts` (table, plus F2 stray naming and F4 report); text for F1, F6, F7, F12 in `tests/practice/frameFeedback.test.ts` |
| F12 text | met as corrected | "2f late (+38.3 ms, +2.3f)", user's call in M6 (proposal said "1f late") |

### Decisions (section 1)
| # | Requirement | Status | Proof |
|---|---|---|---|
| C1, C7 | SPEC updated before code (§3 "Frames", §4 "Engine API: frames", §8, §9) | met | commit 5f26b72 (M1) |
| C2, 0 | A tap inside one frame registers; every press remembered | met | `frames.ts` `recordOf`; `frames.test.ts` "F3"; `frameGrading.test.ts` "F3" |
| C3, 5 | SOCD neutral kept; opposite directions reported only on a failed check | met | `attempt.ts` `withDirectionCheck`; `frameExamples.test.ts` F7, "opposite directions held on a failed check" |
| C4, 10 | `ms` chord unit kept; same frame always fits | met | `chord.ts` `insideChordWindow`; `chord.test.ts` "F9", "F10" |
| C5 | Only small text additions in the UI | met | `ui/practice.ts` passes `combo.fps` (one line) |
| C6 | Same-frame tests rewritten | met | M3/M4 test changes; DECISIONS "M3", "M4" |
| 1a, A5 | Grid starts at first press / Go; negative frames before Go | met | `frameGrading.test.ts` "first-input start", "countdown start" |
| 1b, 4a | Held state read at frame end; direction check on end state | met | `withDirectionCheck` reads `rec.position`; `directionExamples.test.ts` O1, O2, O4 |
| 3 | Press = down on N and not held at end of N−1 | met | `frames.ts` `recordOf`; `frames.test.ts` "the press rule" |
| 4b, 12 | One press per button per frame, ms from the last down | met | `frames.test.ts` "F5", "counts a button once"; `chord.test.ts` "double tap of a chord button" |
| 4c, A1, A2 | Lost re-presses and ignored taps reported | met | `attempt.ts` `gradeFrame`, `withLostRepresses`, `withDirectionCheck`; `frameExamples.test.ts` F4, F6, "reports: edge cases" |
| 6 | Arrival order; late input counts on the open frame | met | `frames.ts` `addInput`; `frameGrading.test.ts` "closing" |
| 7 | Frame layer replaces per-press grading | met | `attempt.ts` `input` → `advanceTo` → `gradeFrame`; `pendingCheck` removed |
| 8 | Extra-press rule for every step, either order | met | `gradeFrame`, `chordFrame`; `frameGrading.test.ts` "the extra-press rule"; `frameExamples.test.ts` F2, F2n |
| 9 | One step per frame | met | `frameGrading.test.ts` "one step per frame" (F11, absolute, relative target 0) |
| 11 | Results when the frame closes | met | `frameExamples.test.ts` checks each result is absent 0.01 ms before its frame's end and present at it |
| 13a, 13b, A4 | ms from the target frame's start; "ms, frames" format, one decimal | met | `format.ts` `signedFrameFraction`, `describeStep`; `frameFeedback.test.ts` |
| 15 | Module, names, record shape settled | met | SPEC §4 "Engine API: frames" (user's call in M1) |
| A3 | First-input frame 0 at the first down event | met | `attempt.ts` `input`; `frameGrading.test.ts` "frame 0 starts at the first button press" |

### Draft spec (section 3)
| Rule | Status | Proof |
|---|---|---|
| 3.1 Frame record: events, presses, end state, reports | met | `frames.ts` `FrameRecord`; `frames.test.ts` "keeps raw and corrected timestamps" |
| 3.1 "Every grid frame gets a record once it closes" | met as amended | empty frames aren't stored, but their close runs the time checks (SPEC §3 "Frames" says so); `checkDeadline` |
| 3.1 Closing by input and by `tick` with the largest offset | met | `attempt.ts` `tick`; `attempt.test.ts` "tick() waits for the largest offset"; `direction.test.ts` "tick uses the largest latency offset" |
| 3.2 Grading rules 1–3 | met | `gradeFrame`, `checkDeadline`; `attempt.test.ts`, `frameGrading.test.ts` |
| 3.3 Chords over frames, window, complete, `PARTIAL`, per-press timing | met | `chordFrame`, `gradeChord`, `chordResult`; `chord.test.ts` |
| 3.4 Directions rules 4–5 and reports | met | `withDirectionCheck`; `direction.test.ts`, `frameExamples.test.ts` |
| 3.5 First-input start (incl. non-strict clear, step-1 chord) | met | `backToWaiting`; `frameGrading.test.ts` "first-input start"; `chord.test.ts` "a chord as step 1", "a broken step-1 chord" |
| 3.6 Input rules, known limits | met | SPEC §3 "Input rules" |
| 3.7 Feedback text and notes; no new elements, timeline unchanged | met | `format.ts`; `frameFeedback.test.ts`; no timeline change |

### Behavior changes (section 4)
| # | Status | Proof |
|---|---|---|
| 1 Results at frame close | met | `frameExamples.test.ts`; practice tests (sounds, countdown at frame close) |
| 2 Stray on the graded frame is a mistake | met | `frameExamples.test.ts` F2/F2n; browser check (I+U → wrong button) |
| 3 One frame grades one step | met | `frameGrading.test.ts` "one step per frame" |
| 4 Lost re-press doesn't count, reported | met | `frameExamples.test.ts` F4 |
| 5 Double tap = one press, from the second down | met | F5 |
| 6 `ms` window accepts same-frame presses | met | F9 |
| 7 Frame fraction and notes in the text | met | `frameFeedback.test.ts`; browser check |
| 8 `pendingCheck` and stay-open removed | met | `attempt.ts` (no `pendingCheck`, no `complete`) |
| 9 Unchanged parts (grid, O1–O4, SOCD, ms unit, deltaMs reference, countdown frame 0, taps) | met | `fixedFrameGrid.test.ts`, `gameFrameGap.test.ts`, `directionExamples.test.ts` all pass unchanged in values |
| 10 Same-frame tests rewritten; table test added | met | M3/M4 commits; `frameExamples.test.ts` |

### Open items (section 5)
| Item | Status | Proof |
|---|---|---|
| SPEC changes listed (C1, C4, C6, C7, decision 0, §3, §7) | met | SPEC.md (M1, plus F12 fix in M6) |
| NEXT_SESSION tap rule rewritten (decision 0) | met | NEXT_SESSION.md "Reversed from the 2026-11-02 notes" |
| BACKLOG: block mixed sources; warn unreachable steps; mashing note | met | BACKLOG.md (M1) |
| BACKLOG: strike the same-frame bug | met | BACKLOG.md (M7) |

### SPEC §8 "Done when"
| Criterion | Status | Proof |
|---|---|---|
| Every F1–F12 passes as a test | met | `tests/engine/frameExamples.test.ts` |
| Behavior changes hold in the app with a keyboard | partly met | browser check covered a clean run, a same-frame stray, a direction tap and a held direction (DECISIONS "M6"). Not checked in the browser: chords, lost re-press, double tap, countdown mode. All are covered by engine tests. |
