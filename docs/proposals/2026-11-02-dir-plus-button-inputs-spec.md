# Proposal: direction + button steps (e.g. →+MP, ↓+MK)

**Status (2026-11-02):** interview finished, every decision answered. Session A is done: section 3 is in SPEC.md (§3 "Directions", §4 "Engine API: directions" and "Saved data and share links", §7 "Directions in the UI", §8 build stages, §9), and the decisions are in DECISIONS.md ("Direction+button steps"). SPEC.md is now the source of truth; where it differs from section 3 below, SPEC wins. **The proposal was amended on 2026-11-02 (section 7):** share links and position steps were dropped. Next: session B.

## Context
SPEC §3 only allows directions as single-direction steps, graded on the press edge. SPEC §9 lists "directions in chords" as out of scope, and BACKLOG ("Chord follow-ups") asks for them. This proposal adds steps that combine a stick position with a button or a button chord, e.g. →+MP (a command normal), ↓+MK (a crouching normal), ↘+HP, ←+LP+LK (a throw).

Directions are the existing absolute `UP` / `DOWN` / `LEFT` / `RIGHT` controls. There is no forward/back and no facing side.

This changes the engine's `Step` type, grading, and engine API, so per CLAUDE.md the SPEC is updated (session A) before any code.

### What the interview found about the engine
- The engine grades one press at a time on exact timestamps. Same-frame behavior is patched rule by rule (a chord stays open to the end of its frame; the chord window in frames compares grid frames).
- A gamepad poll sends its events in a fixed order: buttons by index, then stick axes, then hat directions ([src/input/gamepad.ts](../../src/input/gamepad.ts), `poll`). On a lever read through a hat (e.g. Qanba Obsidian, axis 9), →+MP pressed together reaches the engine as MP first, then RIGHT, with the same timestamp. That is why the direction check can't run at the button's exact moment (decision 2).
- The same ordering causes a bug for plain steps today (BACKLOG, "same-frame presses … pad button order").
- Out of this came the **frame snapshot** idea (SPEC §9; NEXT_SESSION.md): read every input on a grid frame together, as a game does. The end-of-frame rule below is written so a snapshot can replace it later without changing behavior.

---

## 1. Decisions table

"Settled by" means the answer followed from an earlier choice and was confirmed during the interview without a separate question.

| # | Decision | Answer | Reason | Open items |
|---|---|---|---|---|
| 1 | Held vs fresh direction | **Held** (1B): the direction counts if held when the button lands, whenever it was pressed | Matches how games read a direction+button; holding the direction early is normal play | Engine API change: releases and held state enter the engine |
| 2 | Direction and button on the same frame | **Held at the end of the button's grid frame** (2B) | A game reads input once per frame; on a pad the button can arrive before the direction in the same poll | Result arrives up to 1 frame later; uses the trainer's frame edges, not the game's (known limit) |
| 3 | Direction released before the button | Fails (settled by 1 + 2) | Only what's held at the end of the button's frame counts | — |
| 4 | Forward/back vs left/right | **Absolute `RIGHT`/`LEFT`**, no facing setting | User's intent: use the existing joystick states | Facing / side switching added to SPEC §9 as out of scope |
| 5 | Diagonals | A diagonal is one stick position (settled by 10) | — | — |
| 6 | Exact or lenient match | **Per step: exact or at least** (4C) | Command normals need exact (→ only); crouching accepts any down (at least ↓) | Default for new direction steps: **exact** (assumed, not overridden) |
| 7 | Stray direction presses | **Never mistakes** (3A): direction presses and releases only change what's held | Fits 1B; lever noise and getting ready for the next step never fail | Behavior change for existing strict combos: bumping the lever no longer ends the attempt |
| 8 | Plain button step with a direction held | **Same toggle** (5C): a plain step has no direction; exact = neutral required, at least = anything | One rule for every step | Old steps and new plain steps default to **at least**, so they grade as today |
| 9 | Direction held across steps | Counts for each step (settled by 1) | — | — |
| 10 | Direction with a button chord | **Allowed** (8B), checked at the end of the frame the chord completes on | Covers throws and other direction+chord moves | A chord mistake wins over a direction mistake; a direction mistake replaces the chord's timing grade (incl. `SPLIT`) |
| 11 | Impossible directions (LEFT+RIGHT) | Can't be stored (settled by 19) | — | — |
| 12 | Which press is graded | The button (single) or the chord's last press (settled by 1) | A held direction has no press time to grade | — |
| 13 | Direction timing in the grade | Not graded or shown as early/late (settled by 1 + 2) | — | A direction can never cause `SPLIT` |
| 14 | Direction window | None (settled by 2) | The end of the button's frame is the only check | — |
| 15 | Mistake grades | **Reuse chord grades** (6C): missing direction = `PARTIAL`; wrong or extra direction = `WRONG_BUTTON` | No new grade | Confirmed by the user: a held position that is a strict part of the wanted one (incl. nothing) = missing; anything else = wrong (section 3.2) |
| 16 | Strict / non-strict for direction mistakes | **Never end the attempt** (7B): the step is graded and the attempt moves on | Timing feedback continues for the rest of the combo after a direction slip | The same grade behaves two ways (a button `WRONG_BUTTON` still ends a strict attempt). No new `AttemptEnd` |
| 17 | `MISSED` timer | Unchanged (settled by 1): holding a direction never starts or pauses it | — | — |
| 18 | First-input start, direction+button step 1 | The button press is frame 0; the direction is checked at the end of frame 0 (settled by 1 + 2) | — | — |
| 19 | Step shape | **One stick position** (10C): `direction` 1–9 in numpad layout, plus `directionMatch` | One value, like a stick; impossible combinations can't exist; groundwork for motions | Position 5 never stored (section 3.1) |
| 20 | Storage and share links | **Convert on load, storage stays version 1; share code v3** (13A). *Amended: share links dropped, no v3 (section 7, A1)* | Same approach as chords (`button` → `buttons`) | A tab running the old build would strip the new fields on save (same risk chords accepted) |
| 21 | Single-direction steps | **Position steps** (12B): graded on the frame the stick enters the position. *Amended: position steps out of scope; single-direction steps stay as today (section 7, A2)* | One direction model; a game reads a new position, not a press; groundwork for dashes and motions | Old `buttons: ['DOWN']` loads as `direction: 2`, at least. The graded input may be a release (e.g. ↘ → ↓ by letting go of RIGHT) |
| 22 | Example combo | **Fix and add** (21C): "cr." steps in shipped examples become ↓ (at least); add "Example: command normal" | Examples mean what their labels say, like in a game | New browsers only; 5 examples (SPEC §8 says 2–3); the example test needs updating |
| 23 | Editor picker | **Dropdown in the row; a 3×3 grid opens in a panel under the step** (15A + 15b-2) | The grid is laid out like the stick's gate; the row stays compact | Dropdown lists "↘ down-right", "• none" |
| 24 | Notation | **Arrows** (14B): →+MP, ↓+MK, ↘+HP, ←+LP+LK | What games show in move lists and input displays | Symbol for "at least" not chosen yet (e.g. "↓*" or "any ↓") |
| 25 | Live progress | **A live input display** (17B): stick gate plus pressed buttons on the practice page, not tied to a step | Works like a training-mode input display: shows input without judging it | Always visible; a show/hide toggle could come later |
| 26 | Timeline | **One stick lane for the attempt** (16C), plus the held position tagged on each button dot | Like a training-mode input history on the frame ruler | New field on the attempt result: position history |
| 27 | Feedback text | **Timing, then a direction note** (18C): "On time (+5.2 ms) · Direction: ↘, wanted →" | Input shown next to what was expected, separately from timing | "wanted → exactly" for exact steps; "wanted any ↓" for at least; "wanted neutral" for exact plain steps |
| 28 | Stats, colors, sounds | **Count toward average and spread; separate labels** (19C): "1 wrong direction · 1 missing direction" | Keeps timing and direction apart, like 16 and 27 | New field on the step result for the mistake's cause. Colors stay the grade's (pink / red); "step off" sound |
| 29 | Editor hints and warning | **Nothing new** (20D) | — | BACKLOG: remove the "⚠ Frame edges" marker and panel from chord steps too |
| 30 | Directions held before the attempt | **Count** (9A): held state is always live | A game reads the stick's current position whenever it was pushed | Keyboard tracker forgets keys held across a window blur (known limit). Countdown: **only button presses start or restart it**; direction presses don't (user, 2026-11-02; section 3.6) |
| 31 | SOCD (LEFT+RIGHT or UP+DOWN held) | **Neutral for both** (11A) | Most common game and controller rule; doesn't depend on press order | A per-combo SOCD setting could come later (SPEC §9) |
| 32 | Stray directions ending button-only combos | Fixed by 7 | — | Overlaps BACKLOG "Mashing shouldn't cause failures" (directions only) |
| 33 | Design for motions and charge | **Build only this feature** (22A) | The position history already is what a game reads motions and charges from | Motions, charge and frame snapshots keep their own proposals |
| 34 | Keyboard rollover | Add to the known-limits note in SPEC §3 | WASD plus U/I/O can hit ghosting | — |
| 35 | Build order | **Direction+button first, frame snapshots later** (23A), sessions A–F | Same game-like end result either way; the feature arrives sooner | Same-frame bug on plain steps stays until snapshots |
| — | Phone width | **Out of scope for this feature** (user, 2026-11-02) | — | Conflicts with SPEC §7 ("must be usable at phone width"); left as an open item, SPEC §7 unchanged |
| — | A button press on the frame of a pending direction check | **An extra press, as for chords** (user OK, 2026-11-02): strict = `WRONG_BUTTON`, attempt ends; non-strict = the step's press and the extra press are ignored and the step keeps waiting | Same rule as a press on a chord's completing frame; a game would read both buttons on that frame together | A next step with a relative target of 0 can't be pressed on that frame (the same cost chords have). Plain at-least steps have no check, so the same-frame bug (BACKLOG) remains for them until frame snapshots |

---

## 2. Worked examples (basis for the session C table test)

60 fps, relative mode, the previous step landed on frame 0. Step target frame 10, on-time frames 9–11. Frame 10 covers 166.7–183.3 ms after the reference.

| Case | Step | Inputs | Held at end of the button's frame | Result |
|---|---|---|---|---|
| H1 | →+MP | → held since before the previous step; MP on 10 | → | `ON_TIME` |
| H2 | →+MP | → pressed on 8, still held; MP on 10 | → | `ON_TIME` |
| H3 | →+MP | → pressed on 5, released on 7; MP on 10 | nothing | `PARTIAL` (missing), timing kept, attempt continues |
| H4 | →+MP | MP on 10, → pressed on 11 | nothing | `PARTIAL` (missing) |
| O1 | →+MP | MP at 170 ms, → at 173 ms (same frame) | → | `ON_TIME` |
| O2 | →+MP | MP and → in one pad poll (MP sent first) | → | `ON_TIME` |
| O4 | →+MP | → released at 168 ms, MP at 171 ms | nothing | `PARTIAL` (missing) |
| M2 | →+MP | ← held; MP on 10 | ← | `WRONG_BUTTON` (wrong direction), attempt continues |
| M3 | →+MP, exact | ↘ held; MP on 10 | ↘ | `WRONG_BUTTON` (wrong direction) |
| M3a | →+MP, at least | ↘ held; MP on 10 | ↘ | `ON_TIME` |
| X1 | ↓+MK, at least | ↙ held; MK on 10 | ↙ | `ON_TIME` |
| X2 | ↘+HP, exact | ↓ held; HP on 10 | ↓ | `PARTIAL` (missing: ↓ is part of ↘) |
| M4 | HP, exact (neutral) | ↓ held; HP on 10 | ↓ | `WRONG_BUTTON` (wrong direction) |
| M5 | HP, at least | ↓ held; HP on 10 | ↓ | `ON_TIME` (as today) |
| S1 | →+MP | → then ← added on 9 (both held); MP on 10 | neutral (SOCD) | `PARTIAL` (missing) |
| C1 | ←+LP+LK, window 2f | ← held; LP on 10, LK on 11 | ← (end of 11) | chord grade by its presses (here `ON_TIME`) |
| C2 | ←+LP+LK | ← released during 11; LP 10, LK 11 | nothing | `PARTIAL` (missing); per-press timing kept |
| C3 | ←+LP+LK | LP 10, LK 11; ← pressed on 12 | nothing | `PARTIAL` (missing) |
| C4 | ←+LP+LK | ← held; LP 10, HP 11 | — | chord `WRONG_BUTTON` (chord mistake wins; strict ends) |
| D1 | stray → while step 1 ↓+MK awaited | lever rolls ↓ → ↘ | — | not a mistake |
| L1 *(out of scope, A2)* | position step ↓, at least, target 5 | → held; ↓ pressed on 5 (6 → 3) | — | `ON_TIME` on 5 |
| L1e *(out of scope, A2)* | position step ↓, exact | as L1 | — | still waiting (entered 3, not 2) |
| L2 *(out of scope, A2)* | position step ↓ | ↓ held since before the step | — | waits for leaving and re-entering ↓ |
| K1 | countdown, step 1 ↓+MK, target 0 | ↓ held from before restart; MK on frame 0 | ↓ | `ON_TIME` |
| K2 | countdown, step 1 ↓+MK, target 0 | ↓ pressed during the countdown (doesn't restart it); MK on frame 0 | ↓ | `ON_TIME` |
| F1 | step 2 →+MP, step 3 HP (relative target 0), strict | → held; MP at 170 ms, HP at 178 ms (both on frame 10) | — | step 2 `WRONG_BUTTON` (extra press), attempt ends |
| F2 | as F1, non-strict | as F1 | — | MP and HP ignored; step 2 keeps waiting |

---

## 3. Draft spec (to apply to SPEC.md in session A)

*Amended 2026-11-02 (section 7): the position-step parts (3.1 "Without buttons", 3.2 "Position steps" and the position step 1 bullet, 3.4 "the graded input may be a release", 3.5 storage conversion, 3.7 position-step notation and editor text) and share code v3 (3.5) are dropped. They're left below as the record of the original draft; SPEC.md has the amended rules.*

### 3.1 §3 Combo definition: step fields
Replace the `buttons` bullet and add two fields:

> - `buttons`: the button(s) to press (mapped button IDs, e.g. `LP`, `HK`). One button is a normal step; two or more is a **chord** (see "Chords"). Empty only on a **position step** (below). Directions (`UP`, `DOWN`, `LEFT`, `RIGHT`) are never in `buttons`; they are set with `direction`.
> - `direction` (optional): a stick position in numpad layout: 1 ↙, 2 ↓, 3 ↘, 4 ←, 6 →, 7 ↖, 8 ↑, 9 ↗. 5 (neutral) is never stored; "neutral required" is a plain step set to exact.
>   - With buttons: the position must be held when the button (or the chord's last button) lands (see "Directions").
>   - Without buttons: a **position step**, graded on the frame the stick enters the position.
> - `directionMatch` (optional, default `atLeast`): `exact` or `atLeast`.
>   - `exact`: the held position must be exactly `direction`. On a plain step (no `direction`), the stick must be neutral.
>   - `atLeast`: every direction in `direction` must be held, and others may be too (at least ↓ accepts ↙ ↓ ↘). On a plain step, anything is accepted (today's behavior).
>   - The editor defaults new direction steps to `exact` and new plain steps to `atLeast`.

Validation: a step needs at least one button or a `direction`; `direction` is an integer 1–9 other than 5; `directionMatch` is `exact` or `atLeast`; no direction IDs in `buttons`.

### 3.2 §3 new section "Directions"

> **Held state.** The engine knows which directions are held at every moment: the held set at the time the attempt arms, then every press and release after that, on latency-corrected timestamps. Directions held from before the attempt count.
>
> **Position.** The held directions resolve to one position. Opposite directions held together cancel out (SOCD neutral): LEFT+RIGHT gives no horizontal direction, UP+DOWN gives no vertical one. For example, LEFT+RIGHT+DOWN is ↓.
>
> **Direction presses are never mistakes.** Pressing or releasing a direction never grades a step as wrong and never ends an attempt. It only changes the held position. (Today a direction press during a button step is `WRONG_BUTTON` in strict mode; that rule is removed.)
>
> **The check.** A step with a `direction`, or a plain step set to `exact`, checks the held position at the **end of the grid frame its graded press landed on**: the button for a single-button step, the last press for a chord. Presses and releases anywhere on that frame count, so →+MP pressed together passes in either order.
> ```
> frame:        9            10            11
>                    MP(170 ms)   →(173 ms)      → held at the end of frame 10: passes
>               →━━━━━━━━┛(168 ms) MP(171 ms)    → not held at the end of frame 10: missing
> ```
> The result is known when that frame ends, up to one frame after the press (like a chord). A press arriving later first closes any check that is due by its own corrected time, and `tick()` closes due checks with `now` minus the largest latency offset (as for chords and `MISSED`). A plain step set to `atLeast` has no check and is graded on its press, as today.
>
> **Extra presses while a check is pending.** Until the frame ends, the step stays open, as a complete chord does. A button press on that frame is an extra press:
> - In strict mode the step is `WRONG_BUTTON` and the attempt ends. This is a button mistake, so the "direction mistakes never end the attempt" rule doesn't apply.
> - In non-strict mode the step's press and the extra press are logged as ignored, and the step keeps waiting.
> - Direction presses and releases on that frame aren't extra presses; they only change the held position the check reads.
> - A chord with a direction already follows this rule through its completing frame.
>
> **Result.** The step's timing is graded as usual (single press or chord rules). If the check fails, the grade is replaced:
> - `PARTIAL` (missing direction) when the held position is a strict part of the wanted one, including nothing held (e.g. nothing for →; ↓ for ↘).
> - `WRONG_BUTTON` (wrong direction) otherwise: a different direction, an extra direction on an exact step, or any direction on an exact plain step.
> - The timing fields (`inputFrame`, `deltaFrames`, `deltaMs`, and per-press timing for chords) are kept, and the result records the held and wanted positions and the cause (`missing` / `wrong`).
> - **A direction mistake never ends the attempt, in strict or non-strict mode.** The attempt moves on, and the next relative step counts from the graded press's frame. The attempt isn't a success.
>
> **Chords with a direction.** The chord rules run first. A chord that breaks (wrong or extra button, or `PARTIAL` because its window ran out) is graded by the chord rules and the direction isn't checked. A complete chord is checked at the end of the frame it completed on (the frame it already stays open until). A failed check replaces the chord's grade, including `SPLIT`.
>
> **Position steps.** A step with a `direction` and no buttons is graded on the first grid frame whose end has the stick in the position (exact or at least) when the previous frame's end didn't. A position already held when the step starts doesn't count; the stick has to leave and come back. A position held only inside one frame doesn't count. Its timing is graded like a press on that frame; `deltaMs` uses the timestamp of the input that brought the stick into the position, which may be a release (↘ → ↓ by letting go of RIGHT). Position steps can be `ON_TIME`, `EARLY`, `LATE` or `MISSED`.
>
> **First-input start.** A direction+button step 1: the button press is frame 0, and the direction is checked at the end of frame 0. A position step 1: the input that brings the stick into the position is frame 0. A position held when the attempt arms doesn't start it.

### 3.3 §3 Grading and Input rules
- Grading rule 4, `WRONG_BUTTON`: "a different mapped **button** is pressed" (directions excluded; see "Directions").
- Input rules: "Only the press edge counts" becomes: "Buttons count on the press edge; directions count by what's held (see "Directions"). Holds and key auto-repeat of buttons are ignored."
- Input rules, attempt end: unchanged (direction mistakes don't end an attempt).
- Known limits: add keyboard rollover with direction keys (WASD plus U/I/O), and that the keyboard tracker forgets keys held across a window blur, so such a key reads as up until it's pressed again. Pad held state is always accurate (each poll reads the full state).

### 3.4 Engine API (proposed; final shape set in session A)
- `Step`: `direction?: Position` (`1|2|3|4|6|7|8|9`), `directionMatch?: 'exact' | 'atLeast'`.
- New pure helpers (e.g. `engine/direction.ts`): held set → position (with SOCD); position → directions; `positionMatches(wanted, held, match)`; `directionMistake(wanted, held)` → `'missing' | 'wrong'`.
- Attempt: `arm(state, held?: ButtonId[])` takes the held directions; new `release(state, ev)` alongside `press`; both keep the held set up to date in the `armed` and `running` phases, even when the press itself isn't graded (e.g. before `start()` in countdown mode).
- `AttemptState` gains the held set and a pending end-of-frame check (like `chord`).
- `StepResult` gains `direction?: { wanted?: Position; held: Position | 5; match }` and `directionMistake?: 'missing' | 'wrong'`. For a position step, the graded input may be a release.
- `AttemptResult` gains `positions: { frame, position, timestamp }[]`: the resolved position at frame 0 and every change after (one per frame, the position at the frame's end), for the timeline's stick lane.
- `Grade` and `AttemptEnd` are unchanged.

### 3.5 Storage and share links
- Storage stays `uct.combos.v1`. `parseStep` converts an old single-direction step (`buttons: ['DOWN']`) to `{ direction: 2, directionMatch: 'atLeast', buttons: [] }`; saved back in the new shape on the next save.
- Share code v3: each step tuple gets an optional trailing `[position, 'e' | 'a']`. v1 and v2 links still open, with the same conversion.

### 3.6 Countdown (practice layer; DECISIONS.md Layer 5 Part A)
- **Only a button press starts or restarts a countdown.** Direction presses and releases don't. They still update the held state, so a direction pressed during the countdown counts once the attempt runs (case K2).
- This covers both cases where a press restarts the countdown today: any press during a countdown, and, in countdown start mode, the press that starts it. The restart control (Space, pad Start/Back) is unchanged.
- From the last beat on in countdown start mode, presses already go to the running attempt, as today.

### 3.7 §7 Feedback and UI
- **Notation:** arrows, e.g. →+MP, ↓+MK, ↘+HP, ←+LP+LK, ↓ (position step). A plain step set to exact shows "(neutral)". "At least" gets a small marker (symbol chosen in session E).
- **Editor:** each step row has a direction dropdown ("• none", "↘ down-right", …). Opening it (or a button beside it) shows a 3×3 grid in a panel under the step, laid out like a stick gate; picking there sets the dropdown. An exact / at-least toggle sits next to it ("neutral required" / "any direction" on plain steps). A position step is made by picking a direction and removing the last button. Directions are no longer offered in the button selects. No new hint or warning text.
- **Practice page:** a live input display (stick gate and pressed buttons), always shown, reading held state from the practice layer.
- **Feedback text:** the usual timing text, then a direction note on a mistake: "On time (+5.2 ms) · Direction: ↘, wanted →" ("wanted → exactly" when the step is exact and the held position contains the wanted one; "wanted any ↓" for at least; "wanted neutral" for exact plain steps; "none" when nothing is held).
- **Timeline:** one stick lane above the step lanes: one segment per position from frame 0, tagged with its arrow, neutral left empty, the position after SOCD, the position at each frame's end. Drawn only if the combo has a direction step or a direction was held. Each graded button dot is tagged with the held position, red on a direction mistake.
- **Stats:** direction mistakes count toward average and spread (the button press was right). "Other results" labels them separately: "wrong direction", "missing direction".
- **Sounds:** a direction mistake plays the "step off" sound (it doesn't end the attempt). No new sound or color.

### 3.8 §9 Out of scope
- Replace "directions in chords" (now supported) with the follow-ups listed there (added 2026-11-02).

---

## 4. Behavior changes for existing combos
- **Strict mode:** a direction press while a button step is awaited no longer ends the attempt (7).
- **Countdowns:** a direction press no longer starts or restarts a countdown; only a button press does (section 3.6).
- ~~**Single-direction steps** become position steps (21).~~ *Amended (A6): single-direction steps are removed, and saved combos drop them on load.* They grade the same in normal use, with two differences:
  - A DOWN press while UP is held no longer counts, because SOCD makes the position neutral.
  - Entering the position by a release (↘ → ↓ by letting go of RIGHT) now counts.
- **Examples:** only new browsers get the fixed and new examples.
- Everything else grades as today: old plain steps load as at least, which has no check.

## 5. Open items
1. ~~**Countdown restarts on direction presses.**~~ Answered 2026-11-02: only a button press starts or restarts a countdown; direction presses don't (section 3.6).
2. ~~**A press on the same frame as a pending direction check.**~~ Answered 2026-11-02: the user OK'd the chord-style rule, an extra press (section 3.2, "Extra presses while a check is pending").
3. **"At least" marker symbol** on arrows (session E).
4. ~~**Phone width:**~~ Answered 2026-11-02: phone width support is removed from the whole app, spec and code (SPEC §7; DECISIONS.md "Phone width dropped").
5. ~~**Exact API names and share tuple layout.**~~ API names set in session A (SPEC §4 "Engine API: directions") and approved by the user on 2026-11-02. The share layout is moot: share links were dropped on 2026-11-02 (decision 20's share code v3 and section 3.5's share bullet no longer apply).
6. ~~**Interpretation of 15.**~~ Confirmed 2026-11-02: a strict part of the wanted position (including nothing) is missing (`PARTIAL`); anything else is wrong (`WRONG_BUTTON`).
9. ~~**Position step 1 in first-input mode, released within frame 0.**~~ Answered 2026-11-02 (session A), then made moot by A2: it doesn't count. The input that enters the position sets frame 0, but step 1 only counts if the position is still held at the end of frame 0; otherwise the attempt goes back to waiting (SPEC §3 "Directions", rule 10).
7. **Debug page:** showing the resolved position wasn't decided; not part of this work unless asked.
8. **Unchanged, by assumption:** Hear timing, the metronome, calibration and the input layer's events. The practice layer starts passing releases and the held set to the engine.

## 6. Build order (23A)
One review stop per session. Each ends with `mise run test` and `mise run typecheck` passing. No phone-width checks.

- **A. Spec:** apply section 3 to SPEC.md (§3, §7, §9), log the decisions in DECISIONS.md, update BACKLOG.md ("Directions in chords" done once built). Settle open item 5. No code.
- **B. Types:** `direction` and `directionMatch` on `Step`, validation, ~~storage conversion, share v3 (v1/v2 still open)~~ loading and saving the new fields, removing share links (A1, A2). Grading unchanged until C.
- **C. Engine:**
  - Held state, `release`, and the held set at arm.
  - SOCD position, the end-of-frame check, exact / at least.
  - Grade replacement and continuing after a mistake; chords with a direction.
  - ~~Position steps;~~ stray directions not mistakes (A2).
  - `positions` history and `directionMistake`.
  - A table test covering section 2.
- **D. Practice side:** pass releases and the held set through; only button presses start or restart a countdown; feedback text, stats, sounds, the timeline stick lane and tagged dots, the live input display.
- **E. Editor and examples:** dropdown and grid panel, toggle, arrow notation, examples (fix "cr." steps, add "Example: command normal").
- **F. Hardware check:** keyboard (including SOCD with A+D) and the stick's hat lever; log the results in SPEC like the polling findings.

The frame snapshot proposal (NEXT_SESSION.md) comes after this feature.

## 7. Amendments
The proposal was amended on 2026-11-02 during session A, at the user's request. The decisions table and draft spec above are kept as written, with notes where an amendment changes them. SPEC.md and DECISIONS.md have the amended rules.

| # | Amendment | Changes | Reason |
|---|---|---|---|
| A1 | **Share links dropped** (user) | Decision 20 and section 3.5: no share code v3. Session B removes share links from the app (button, `#share=` route, `combo/share.ts`, tests). Links already sent stop opening. Added back later (BACKLOG, "Bring back share links") | User's call; it also removes the share v3 layout from open item 5 |
| A2 | **Position steps out of scope** (user) | Decision 21 (12B), section 3.2 "Position steps" and the position step 1 bullet, cases L1, L1e, L2, section 4's single-direction bullet, and the session C item. Helper `isPositionStep` is dropped. Single-direction steps were first kept as they were, then removed (A6). Added back later (BACKLOG, "Position steps") | User's call: not needed for direction+button steps. Makes open item 9 and the session A position-step questions moot |
| A3 | **Phone width removed from the whole app** (user) | Open item 4: SPEC §7's phone-width rule, the README line and the phone CSS are removed, not just skipped for this feature | User's call |
| A4 | **Timeline tags only checked steps** (user, Option A) | Section 3.7 "each graded button dot is tagged": only dots of steps that ran a direction check are tagged | Tags mean "checked here"; the stick lane shows the rest |
| A5 | **Engine API approved** (user) | Open item 5: the names in SPEC §4 "Engine API: directions" | — |
| A6 | **Single-direction steps removed** (user) | Steps whose only button is a direction (`['DOWN']`) are gone: validation rejects any direction in `buttons`, the editor no longer offers them, and saved combos drop them on load (relative targets carried to the next step; the original is backed up). Done in session A, before session B | With position steps out of scope, a direction only belongs on a button step |

## Related
- SPEC §9 "Frame snapshots" and the follow-ups added on 2026-11-02.
- BACKLOG: "same-frame presses … pad button order" bug; "Remove the ⚠ Frame edges warning"; "Chord follow-ups → Directions in chords".
- [Chords proposal](2026-10-31-chords.md), whose approach this follows.
