# Proposal: frame-based inputs

**Status (2026-11-08):** interview finished; every approved decision is answered or deferred. Nothing is applied yet. Per CLAUDE.md, SPEC.md is updated (section 5, "SPEC changes") before any code.

**Applied (2026-11-08, plan milestone M1):** SPEC.md updated; decision 15 settled (SPEC §4 "Engine API: frames"); A1–A5 confirmed; countdown frames before Go are graded. See DECISIONS.md "Frame-based inputs: spec".

## Context
The engine grades one press at a time on exact timestamps. Same-frame behavior is patched rule by rule: a chord stays open to the end of its completing frame, a direction check waits for the end of its frame (`pendingCheck`), and a plain step is graded on whichever press arrives first. On a pad, presses from one poll arrive in button-index order, so a plain step plus a stray button on the same frame grades differently depending on which button has the lower index (BACKLOG, "same-frame presses" bug).

This proposal adds a **frame layer**: inputs are grouped by the grid frame they land on, each closed frame becomes a **frame record**, and grading reads one closed frame at a time, the way a fighting game reads its input once per frame. It follows SPEC §9 "Frame snapshots", with the changes below. ms timestamps are kept for feedback.

The modeled game is generic: it remembers every button press during a frame and reads the stick's held position at the frame's end. Matching a specific game's frame phase is out of scope.

In scope: the frame grouping layer; ms feedback on how early or late each input was; opposite directions (reporting); edge detection against the previous frame.
Out of scope: input history beyond the previous frame; matching a specific game's frame phase; UI changes beyond small text additions (C5); mixed input sources in one attempt (6).

---

## 1. Decisions table

"Reason" is taken from the chosen option's trade-offs as presented in the interview; the user didn't give separate reasons.

### Conflicts resolved before the interview

| # | Decision | Answer | Reason | Open items |
|---|---|---|---|---|
| C1 | Frame snapshots are listed out of scope in SPEC §9 | Process per CLAUDE.md: this is a proposal; SPEC is updated in its own step before code (assumed, not asked) | CLAUDE.md rule | SPEC §9 "Frame snapshots" moves into a new SPEC §3 section; §8 gets build stages (section 5) |
| C2 | SPEC §9: "a tap pressed and released within one frame doesn't register" | Superseded by decision 0 (user: this was SPEC's rule, not a baseline; decision 4 reopened) | — | SPEC §9 and NEXT_SESSION tap rule rewritten (section 5) |
| C3 | Opposite directions (SPEC §3 Directions rule 2, SOCD neutral) | **Keep neutral, and report** | Explains confusing misses | Detail in decision 5 |
| C4 | SPEC §9: the chord window's `ms` unit becomes obsolete | **Keep the `ms` unit** | No migration, no change for saved chords | SPEC §9 line removed; same-frame rule in decision 10 |
| C5 | "Display format is a decision" vs "UI changes out of scope" | **Small UI allowed**: text changes and small additions to existing elements | Reports (4c, 5) and the format (13b) can be seen | No new pages, layouts or timeline changes |
| C6 | SPEC §9: snapshots replace the end-of-frame rules "without changing their behavior" | **Free to change**: a new model; today's behavior is a reference, not a constraint | Cleanest design | Behavior changes listed in section 4; same-frame tests rewritten |
| C7 | Grading in a frame layer changes the engine API | Process per CLAUDE.md: SPEC §4 updated first (assumed, not asked) | CLAUDE.md rule | SPEC §4 rewrite (section 5); names deferred (15) |
| C8 | File location | `docs/proposals/2026-11-08-frame-based-inputs-spec.md` | Matches the proposals convention | — |

### Interview

| # | Decision | Answer | Reason | Open items |
|---|---|---|---|---|
| 0 | How the modeled game reads input | **Remember every press during the frame** (buttons and directions); held state tracked alongside | Nothing the player does is lost | Conflicted with the SPEC §9 tap rule; resolved by logging a SPEC change (section 5) |
| 1a | Where the grid starts | **At the first press** (first-input) / **Go** (countdown), as today | No change; results repeatable | Countdown kept as is, including negative frames before Go (assumed, not asked) |
| 1b | When the held state is read | **At the end of each frame**, after every input on it | Matches SPEC §3 Directions rule 4 (→+MP together passes in either order) | A result can't be known before the frame ends (11) |
| 2 | What a frame record holds | Settled by C2–C4 and 0: events with ms, presses, end state, reports | — | Record shape deferred (15) |
| 3 | What counts as a press on frame N | **A down event on N, and the button not held at the end of N−1.** For frame 0, "N−1" is the held state just before frame 0 starts | A real edge against the previous frame | A held button released and re-pressed inside one frame is lost (reported, 4c) |
| 4a | What a direction check reads | **Held position at the end of the graded frame only** (SPEC §3 rule 4 unchanged) | One position per frame; matches the stick history | Remembered direction taps don't count for the check |
| 4b | Same button pressed more than once on one frame | **One press per button per frame**; extra down events dropped | Game-like; a double tap on one frame can't cause a mistake | Overlaps BACKLOG "Mashing shouldn't cause failures" |
| 4c | Which unused inputs are reported | **Both**: ignored direction taps and lost re-presses | Every input that didn't count is explained | Attach rule assumed (section 5, A1); ignored taps reported on failed checks only (interpretation, A2) |
| 5 | SOCD report | **Only when it caused a failed direction check** | Appears only when it explains a mistake | — |
| 6 | Event order and frame closing | **Arrival order** (today). Mixed input sources are **out of scope and not enforced** | Results as soon as possible; no buffering | Known limit: mixed sources may land a frame late. BACKLOG: block mixed sources |
| 7 | Which layer grades | **The frame layer replaces per-press grading**: the engine grades one closed frame at a time | One model; same-frame cases decided by rule, not arrival order | SPEC §4 API rewrite; outer API names deferred (15) |
| 8 | Awaited button plus a stray on the same frame | **Extra-press rule for every step**: strict = `WRONG_BUTTON`, attempt ends; non-strict = every press on that frame ignored, step keeps waiting | One rule for all steps; a game sees both together | Fixes the BACKLOG same-frame bug |
| 9 | Can one frame grade more than one step | **No**: the next step can land no earlier than the frame after | Simple; consistent with 8 | Relative target 0 is never on time and nothing warns (BACKLOG) |
| 10 | `ms` chord window and presses on the same frame | **Same frame always passes**; the `ms` size applies only between presses on different frames | Never stricter than what the game sees | — |
| 11 | Results arriving up to a frame late | **Accept the delay**: result, feedback and sound when the frame closes | One result, never changed | Plain steps are no longer graded instantly |
| 12 | Which timestamp gives a press its ms | **The last down event** of that button on its frame | The press still held at the frame's end | — |
| 13a | What early/late ms is measured from | **Start of the target frame** (today) | No change | — |
| 13b | How early/late is written | **Both**: "1f late (+38.3 ms, +2.3f)" | Both readings; ms kept | Rounding and wording assumed (A4) |
| 14 | Which behaviors and tests change | Output, not asked (C6): section 4 | — | — |
| 15 | Module location, API names, record shape | **Deferred** (user: no default) | — | Settle in the SPEC step before code |

---

## 2. Worked examples (basis for the engine table test)

60 fps, relative mode, strict unless noted, latency offset 0. The previous step landed on frame 0. Step target frame 10, `tolEarly` = `tolLate` = 1, so on time is frames 9–11. Frame 10 covers 166.7–183.3 ms, frame 12 covers 200.0–216.7 ms.

| Case | Step | Inputs | Result |
|---|---|---|---|
| F1 | MP | MP↓ 170 | `ON_TIME`, known at 183.3 (frame 10 closes). "On time (+3.3 ms, +0.2f)" |
| F2 | MP | LP↓ 170 and MP↓ 170 in one pad poll, either order | `WRONG_BUTTON`, attempt ends |
| F2n | MP, non-strict | as F2 | Both presses ignored; step keeps waiting |
| F3 | LP | LP↓ 171, LP↑ 178 | `ON_TIME` (a tap inside one frame registers) |
| F4 | LP (previous step LP, still held) | LP↑ 170, LP↓ 176 (LP held at the end of frame 9) | No press on frame 10; lost re-press reported on this step; step keeps waiting |
| F5 | LP | LP↓ 170, LP↑ 174, LP↓ 179 | One press, ms from 179: `ON_TIME` "On time (+12.3 ms, +0.7f)" |
| F6 | →+MP, exact | →↓ 168, MP↓ 171, →↑ 175 | Neutral at the end of 10: `PARTIAL` (missing); note "→ tapped, not held at end of frame" |
| F7 | →+MP, exact | ← and → held; MP↓ 170 | Neutral (SOCD): `PARTIAL` (missing); note "(← and → both held)" |
| F8 | →+MP (O1 today) | MP↓ 170, →↓ 173 | → held at the end of 10: `ON_TIME` (unchanged) |
| F9 | LP+LK, window 5 ms | LP↓ 168, LK↓ 181 (both on frame 10, 13 ms apart) | Chord complete on frame 10 (same frame always passes) |
| F10 | LP+LK, window 5 ms | LP↓ 180 (frame 10), LK↓ 186 (frame 11) | 6 ms apart on different frames: `PARTIAL` |
| F11 | step 2 MP, step 3 HP (relative target 0) | MP↓ 170, HP↓ 174 | Step 2 `WRONG_BUTTON` (HP is a stray on its frame), attempt ends |
| F12 | MP | MP↓ 205 (frame 12) | `LATE`: "1f late (+38.3 ms, +2.3f)" |

---

## 3. Draft spec (to apply to SPEC.md in the SPEC step)

### 3.1 §3 new section "Frames"

> **Grid.** Unchanged: one fixed grid per attempt, starting at frame 0 (the first button press in first-input mode, Go in countdown mode). An input lands on grid frame `floor((corrected timestamp − frame 0) / frameMs)`. Frames before Go are negative.
>
> **Frame record.** Every grid frame from frame 0 on gets a record once it closes. It holds:
> - **Events:** every press and release on the frame, in arrival order, with its button, source and raw and corrected timestamps.
> - **Presses:** the buttons pressed on the frame (below), each with its ms.
> - **End state:** the buttons and directions held after every input on the frame, and the stick position they resolve to (SOCD neutral, §3 "Directions" rule 2).
> - **Reports:** lost re-presses, ignored direction taps, and opposite directions held at the frame's end (below).
>
> **Press.** Button B is pressed on frame N when B has a down event on N and B was not held at the end of frame N−1. A button counts at most once per frame; extra down events of the same button on that frame are dropped. The press's ms is the corrected timestamp of B's **last** down event on the frame. For frame 0, "the end of frame N−1" means the held state just before frame 0 starts: what was held when the attempt armed, plus every input before frame 0. A button held at arm and still held gives no press until it is released and pressed again.
>
> **A tap inside one frame registers.** A button pressed and released on the same frame is pressed on that frame. Direction presses are remembered on the frame too, but they only feed reports; a direction check reads the end state (§3 "Directions" rule 4).
>
> **Lost re-press.** If B was held at the end of N−1 and is released and pressed again on N, it is not pressed on N. The result of the step awaited on frame N reports it (button, frame, ms). If no step is awaited, it isn't reported.
>
> **Closing.** Inputs are taken in arrival order. Frame N closes when an input arrives whose corrected time is at or past N's end, or when `tick(now)` finds `now − largest latency offset` at or past N's end. An input whose corrected time falls on an already closed frame counts on the open frame. Mixing keyboard and pad in one attempt isn't supported (known limit: such inputs can land a frame late).
>
> **Grading reads closed frames.** The engine grades one closed frame at a time against the awaited step. A step's result, feedback and sound come when its frame closes: up to one frame plus the largest latency offset after the press.

### 3.2 §3 Grading (per step), replacing the per-press rules
1. When frame N closes, its presses are compared with the awaited step:
   - **No presses:** nothing happens, unless N is the step's last accepted frame (`targetFrame + tolLate + timeoutFrames` past the reference frame), in which case the step is `MISSED`. A chord that is collecting pauses the timer, as today.
   - **Exactly the step's button** (single-button step): graded on N. `inputFrame` = N − reference frame; `deltaFrames` = `inputFrame − targetFrame`; `deltaMs` = the press's ms − start of the target frame; `elapsedMs` = the press's ms − start of the reference frame. `ON_TIME` / `EARLY` / `LATE` as today. A step with a direction check then runs it on N's end state.
   - **The step's button plus any other button** (extra press, for every step): strict = `WRONG_BUTTON`, the attempt ends; non-strict = every press on N is logged as ignored and the step keeps waiting. The order the presses arrived in doesn't matter.
   - **Only other buttons:** `WRONG_BUTTON` (strict, attempt ends) or ignored (non-strict), as today.
2. **One step per frame.** After a step is graded on frame N, the next step's presses count from frame N+1. A relative target of 0, or an early tolerance that reaches the previous step's frame, can't be met. Two absolute steps can't land on the same frame.
3. The reference frame is unchanged: the previous graded step's frame (relative) or frame 0 (absolute).

### 3.3 §3 Chords, replacing rules 2, 3 and 6
- **Collecting** over frames: each closed frame's presses must be chord buttons not yet pressed. Any other button, or a chord button pressed again on a later frame, is a mistake (`WRONG_BUTTON`, chord rules for strict and non-strict, as today).
- **Window:** in `frames`, last press's frame − first press's frame ≤ `size`. In `ms`, presses on the **same frame always fit**; a press on a later frame must be within `size` ms of the first press (press ms per §3 "Frames").
- **Complete** on the frame the last missing button is pressed on. Any other press on that frame is an extra press (§3.2 rule 1). The chord no longer "stays open": every step is graded when its frame closes.
- **`PARTIAL`** when the window runs out with buttons missing, known when the frame that ends the window closes.
- **Per-press timing** is by each press's frame; presses on the same frame get the same timing, so they can't make a `SPLIT` between themselves. `SPLIT` is otherwise unchanged.

### 3.4 §3 Directions, rules 4 and 5
- Rule 4 (the check) is unchanged: the held position at the end of the graded frame. Its "result known up to one frame later" now applies to every step (§3 "Frames"). `pendingCheck` is no longer needed.
- Rule 5 (extra presses while a check is pending) is replaced by §3.2 rule 1 (extra press), which covers every step.
- **Reports on a failed check:**
  - **Ignored direction tap:** a wanted direction was pressed on the graded frame but isn't held at its end.
  - **Opposite directions:** an opposite pair (← and →, or ↑ and ↓) was held at the frame's end.
  - Neither is reported on a passing check.

### 3.5 §3 First-input start
- Frame 0 starts at the first down event of a mapped button. Frame 0's record is graded as step 1 when it closes: button correctness (including the extra-press rule) and any direction check; timing fields are 0 as today.
- If step 1 fails in non-strict mode, the attempt goes back to waiting and frame 0 is cleared (as a step-1 direction check does today).
- A step-1 chord: its first press sets frame 0, and the chord rules run over frames.

### 3.6 §3 Input rules
- "Buttons count on the press edge (up to down)" becomes "Buttons count by the press rule in §3 'Frames' (a down event on a frame, not held at the end of the frame before)."
- Known limits gain: mixed keyboard and pad input in one attempt isn't supported (§3 "Frames", Closing).

### 3.7 §7 Feedback text
- Timing: "On time (+3.3 ms, +0.2f)", "On time, 1f late (+20.1 ms, +1.2f)", "2f early (−31.4 ms, −1.9f)", "1f late (+38.3 ms, +2.3f)". The frame fraction is `deltaMs / frameMs`, one decimal, with the same sign as the ms.
- Notes, after " · " as for the direction note:
  - Ignored direction tap: "→ tapped, not held at end of frame".
  - Opposite directions, inside the direction note: "Direction: none, wanted → (← and → both held)".
  - Lost re-press: "LP pressed again while held (not counted)".
- No new elements, colors or sounds; the timeline doesn't show the reports.

---

## 4. Behavior changes for existing combos (decision 14)
1. **Every result arrives when its frame closes** (11), including plain steps that were graded instantly.
2. **A stray button on the graded frame is a mistake for every step** (8), whatever the arrival order. Plain steps whose right button arrived first no longer pass. Non-strict ignores every press on that frame instead of grading the right one.
3. **One frame grades one step** (9). A relative target of 0, or early tolerance reaching the previous step's frame, can't be met. Saved combos with these get no warning.
4. **A held button released and pressed again inside one frame doesn't count** (3); it's reported.
5. **A double tap inside one frame is one press, timed from the second down event** (4b, 12).
6. **`ms` chord windows always accept presses on the same frame** (10).
7. **Feedback text adds the frame fraction** (13b) and the new notes (4c, 5).
8. **`pendingCheck` and the chord's "stays open to the end of its frame" go away**; their behavior is covered by the per-frame rules.
9. Unchanged: the grid, the direction check (O1–O4), SOCD neutral, the `ms` unit, `deltaMs`'s reference point, countdown frame 0, and buttons tapped inside one frame (already counted today).
10. Tests for same-frame cases are rewritten (C6); the table test in section 2 is added.

---

## 5. Open items

### SPEC changes required (C1, C6, C7, and decisions that change SPEC text)
- **C1:** remove "Frame snapshots" from SPEC §9; add §3 "Frames" (section 3.1); add build stages to §8.
- **C6:** drop §9's "without changing their behavior"; behavior changes are in section 4.
- **C7:** rewrite SPEC §4 "Engine API" for frame-at-a-time grading: `PendingCheck`, the chord's stay-open state and per-press grading go; frame records come in. Names and shape are decision 15.
- **Decision 0:** rewrite the tap rule in SPEC §9 and NEXT_SESSION.md ("a tap inside one frame doesn't register" → it registers).
- **C4:** remove SPEC §9's "the chord window's `ms` unit becomes obsolete".
- SPEC §3: Grading (3.2), Chords rules 2, 3 and 6 (3.3), Directions rules 4 and 5 (3.4), first-input start (3.5), Input rules and known limits (3.6).
- SPEC §7: feedback text (3.7).

### BACKLOG
- New: block mixed input sources in one attempt (6).
- New: warn about or validate steps that can't be on time under one-step-per-frame (relative target 0, early tolerance into the previous step's frame) (9).
- Strike through the "same-frame presses" bug once built (8).
- Note on "Mashing shouldn't cause failures": a double tap inside one frame is one press (4b), but mashing across frames is unchanged.

### Deferred
- **15:** module location, engine API names, whether `press` / `release` / `tick` stay as the outer calls, and the frame record's shape. No default; settle in the SPEC step.

### Assumptions to confirm
- **A1:** a lost re-press is reported on the step awaited on that frame; none if no step is awaited (before frame 0, or after the attempt ends).
- **A2:** ignored direction taps are reported only on a failed direction check (read from 4c's options, where the tap report was tied to failed checks).
- **A3:** in first-input mode, frame 0 starts at the first down event, while that press's ms (unused for step 1's timing) follows decision 12.
- **A4:** frame fraction to one decimal; note wording as in section 3.7.
- **A5:** countdown mode keeps Go as frame 0 and negative frames before it (1a).

### Known limits
- The grid is the trainer's, not the game's (unchanged).
- Mixed input sources can land a frame late (6).
- With rAF gamepad polling (~1 frame), presses from one poll share a timestamp and frame; frame records can't be finer than the poll.

## Related
- SPEC §9 "Frame snapshots"; NEXT_SESSION.md ("frame buffer proposal").
- BACKLOG: same-frame presses bug; "Mashing shouldn't cause failures"; "Remove the ⚠ Frame edges warning".
- [Direction+button proposal](2026-11-02-dir-plus-button-inputs-spec.md), whose end-of-frame rules this replaces.
