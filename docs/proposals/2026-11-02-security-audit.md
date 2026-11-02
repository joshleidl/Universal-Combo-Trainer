# Proposal: security audit fixes

**Status (2026-11-02):** audit done, no code written. Waiting on the decisions in section 2. Fix 1 changes what `validateCombo` accepts (the engine API), so per CLAUDE.md the SPEC is updated first (section 3) before any code.

## Context
A read-only security review of the whole repo: app source, share links, storage, the deploy workflow, hosting config, the transcript script, and dependencies.

The app is a static site with no backend, accounts, secrets, or server-side data. That rules out most serious risks. No serious vulnerability was found. There is one low-severity bug that an outside link can trigger, plus some hardening.

### What was checked and is fine
- **No XSS path.** All rendering goes through the `el()` helper with `textContent` ([src/ui/dom.ts](../../src/ui/dom.ts)). The only `innerHTML` is a hard-coded SVG with no user data ([src/ui/editor.ts:609](../../src/ui/editor.ts#L609)).
- **Share-link decoding is defensive** ([src/combo/share.ts](../../src/combo/share.ts)): a 20,000-character cap, a strict base64url check, a fatal UTF-8 decode, field-by-field type checks, and a final `validateCombo`. The link is cleared from the URL after it's read.
- **Saved data is rebuilt from known fields only** (combos, settings, key mapping in [src/storage/](../../src/storage/)). A `__proto__` key in stored JSON can't pollute objects, because values are only copied into fresh objects field by field. Unreadable combos and mappings are backed up rather than lost.
- **Transcript script** ([scripts/backup-transcript.mjs](../../scripts/backup-transcript.mjs)) runs git with `execFileSync` and an argument list, with no shell, so there's no command injection.
- **Dependencies:** `npm audit` found 0 vulnerabilities (3 dev dependencies: TypeScript, Vite, Vitest).
- **Repo history:** no secrets, `mise.local.toml`, or transcripts were ever committed. `.gitignore` covers `mise.local.toml`.
- **Workflow triggers:** only `push` to `main` and `workflow_dispatch`. There's no `pull_request_target`, so pull requests from forks can't run with deploy permissions.

---

## 1. Findings

### F1. A crafted share link can freeze the tab (low)
**Where:** [src/engine/attempt.ts:64](../../src/engine/attempt.ts#L64) (`validateCombo`), [src/practice/timeline.ts:71](../../src/practice/timeline.ts#L71) and [:119](../../src/practice/timeline.ts#L119) (`rulerStep`), [src/ui/practice.ts:382](../../src/ui/practice.ts#L382) (ruler tick loop).

**What happens:** validation checks that `targetFrame`, `tolEarly` and `tolLate` are non-negative integers, and that `fps` is positive and finite. It has no upper limits. `Number.isInteger(1e308)` is true, so a link can carry:

```
step 2: targetFrame 1e308, tolLate 1e308
```

1. The victim opens the link, goes to Practice, and presses two buttons. The second press grades `EARLY` (it's ~1e308 frames early), so a result exists for step 2.
2. `buildTimeline` computes `windowEnd = ref + targetFrame + tolLate + 1`, which overflows to `Infinity`. `endFrame` becomes `Infinity`.
3. `rulerStep(Infinity)` returns `Infinity`.
4. The tick loop `for (fr = 0; fr <= Infinity; fr += Infinity)` never ends, because `Infinity + Infinity` is still `Infinity`. It keeps creating DOM elements until the tab hangs or runs out of memory.

A huge `fps` (e.g. `1e308`) reaches the same state another way: `msToFrame` multiplies by `fps`, so frame numbers overflow.

**Impact:** a denial of service in the victim's own tab. It needs user interaction, and closing the tab recovers it. If the victim saves the combo, it happens on every practice attempt with that combo until they delete it. It exposes no data. The trace was followed through the code; it hasn't been reproduced in a browser.

**Fix:**
1. Add upper limits to `validateCombo` (values in decision S1). Share links, saved combos, the editor and `createAttempt` all go through it, so one change covers every entry point.
2. Defense in depth: `buildTimeline` returns `null` when `endFrame` isn't finite. The practice page already handles a `null` timeline.

### F2. Text from a share link shows in a native confirm dialog (low)
**Where:** [src/main.ts:103](../../src/main.ts#L103).

**What happens:** when the editor has unsaved changes, opening a share link asks `window.confirm('Open the shared combo "<name>"? …')`. The name comes from the link, has no length limit (up to the 20,000-character code cap), and may contain newlines. A link can fill the browser's own dialog with misleading text, e.g. a fake "session expired, visit …" message shown on the real site's origin.

**Fix:** cap the combo name length (S1). Collapse whitespace, including newlines and tabs, to single spaces when decoding a share link (S2).

### F3. No Content-Security-Policy (hardening)
**Where:** [index.html](../../index.html), [netlify.toml](../../netlify.toml).

There is no XSS today. A CSP is a backup layer that would block injected scripts if a future change ever slipped one in (e.g. someone adds `innerHTML` with a combo label). GitHub Pages can't set response headers, so it has to be a `<meta>` tag.

**Fix:** add this CSP to the **built** `index.html` only:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
```

- Build only, because the Vite dev server injects CSS through `<style>` tags and HMR scripts, which this policy would block. A small inline Vite plugin (`transformIndexHtml`, `apply: 'build'`) in [vite.config.ts](../../vite.config.ts) adds the tag. This is a build-config change, not a stack change.
- Setting `element.style.left = …` (used by the timeline) is not blocked by `style-src 'self'`. Only style attributes in parsed markup are, and the SVG markup uses classes only.
- `frame-ancestors` (clickjacking) is ignored in a `<meta>` tag. The app has no sensitive actions to click-jack, so that's acceptable on GitHub Pages. On Netlify, the same policy plus `frame-ancestors 'none'` and `X-Content-Type-Options: nosniff` can go in a `[[headers]]` block (S4).

### F4. CI gives deploy permissions to the build job (hardening)
**Where:** [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml).

`pages: write` and `id-token: write` are set at the workflow level, so the `build` job gets them too. That job runs `npm ci` and the tests, which is third-party code. A compromised dev dependency could use the job's token to publish to Pages. The actions are also pinned by tag (`@v4`), and a tag can be moved to different code.

**Fix:**
- Workflow level: `permissions: contents: read`. Move `pages: write` and `id-token: write` onto the `deploy` job only.
- `actions/configure-pages` in the build job may need `pages: read`. If the first run fails with a permissions error, add `pages: read` to the build job only.
- Optional (S3): pin each action to a full commit SHA with the tag as a comment, e.g. `actions/checkout@<sha> # v4`. Without Dependabot, pinned SHAs don't get updates, so this adds upkeep.

### F5. The raw transcript copy holds everything (note)
**Where:** [scripts/backup-transcript.mjs](../../scripts/backup-transcript.mjs), SPEC §10.

The `(raw).jsonl` copy is the full session log: command output, file contents, and anything pasted into the session. It's written to a folder on the Windows side. That's fine as long as the folder stays private and isn't synced somewhere public, and it's already kept out of git.

**Fix:** no code change. Add one sentence to SPEC §10 saying the raw copy can contain command output and file contents, so the folder should stay private. Optional tidy: reject a `--session` value that contains `/` or `..`. It's a local script the user runs, so this isn't a real threat.

---

## 2. Decisions

Each row has a proposed default. Answer with the ID and a choice, or "default".

| ID | Question | Options | Default |
|---|---|---|---|
| S1 | Upper limits in `validateCombo` | **A.** The values below. **B.** Other values. | A |
| S2 | Clean up the name from a share link | **A.** Collapse whitespace (including newlines) to single spaces on decode. **B.** Length cap only. | A |
| S3 | Pin GitHub Actions to commit SHAs | **A.** Yes, and add Dependabot for `github-actions` to keep them updated. **B.** Yes, without Dependabot. **C.** No, keep tags (scoped permissions only). | C |
| S4 | Netlify security headers | **A.** Add a `[[headers]]` block (CSP + `frame-ancestors 'none'` + `nosniff`). **B.** Skip; the site is deployed on GitHub Pages. | B |
| S5 | Saved combos that exceed the new limits | **A.** Drop them on load into the existing backup key (`uct.combos.v1.backup`), as for any unreadable combo today. **B.** Clamp values into range on load. | A |
| S6 | Reject unknown button IDs in share links (not a security issue; a link can name a button like `"ZZ"` that no key presses, so the combo can't be finished) | **A.** Yes, in `decodeCombo` only (the engine keeps `ButtonId` as a plain string). **B.** No. | B |

**S1 proposed limits** (constants exported from `engine/attempt.ts` so the editor can set `max` on its inputs):

| Field | Limit | Why this size |
|---|---|---|
| `fps` | ≤ 1000 | Presets are 30/60/120; leaves room for any real game. |
| `targetFrame`, `tolEarly`, `tolLate` | integer ≤ 9999 | ~2.8 minutes at 60 fps; far past any real link. |
| `chordWindow` frames | integer ≤ 9999 | Same as frame fields. |
| `chordWindow` ms | ≤ 10000 | 10 seconds. |
| steps per combo | ≤ 200 | Long combos are ~20 steps. |
| combo `name` | ≤ 100 characters | Fits the saved-combo list and dialogs. |
| step `label` | ≤ 40 characters | Labels are short ("cr.MK", "st.HP"). |

With these limits, the largest frame number an attempt can reach is about 200 steps × 3 fields × 9999 ≈ 6 million, nowhere near overflow.

**S5 note:** with option A, a saved combo over the limits disappears from the list (but stays recoverable in the backup key). No real combo should be near these limits, so A is the simpler choice.

---

## 3. Draft spec changes (to apply to SPEC.md before code)

### 3.1 §3 Combo definition: add after the step fields
> **Limits.** `fps` ≤ 1000. `targetFrame`, `tolEarly`, `tolLate` and a frames `chordWindow` are integers ≤ 9999; an ms `chordWindow` is ≤ 10000. A combo has at most 200 steps, a `name` of at most 100 characters and labels of at most 40. A combo outside these limits is invalid, wherever it comes from (editor, saved data, share link).

### 3.2 §7 Feedback and UI: add
> Share links are untrusted: the combo name is shown with whitespace collapsed, and every value is validated before the combo opens.

### 3.3 §10 Session transcripts: add to "What it writes"
> The raw copy is the full session log, including command output and file contents, so the transcript folder should stay private.

### 3.4 DECISIONS.md entry (after the work is done)
Record the limits and why, the CSP being build-only, and the workflow permission split.

Grading rules are unchanged.

---

## 4. Tests

- `validateCombo`: rejects each field one step past its limit, and accepts it exactly at the limit.
- `decodeCombo`: rejects a link with `targetFrame: 1e308` and one with `fps: 1e308`. A name with newlines comes back with single spaces (S2 A).
- `buildTimeline`: returns `null` when `endFrame` isn't finite. This needs a state built directly in the test, since validation now blocks such combos.
- `parseCombo` / `ComboStore`: a stored combo over the limits is dropped and the raw data is written to the backup key (S5 A).
- Existing tests: the examples and every existing fixture are well inside the limits, so none should change.

---

## 5. Build order (one session)

1. Apply section 3 to SPEC.md.
2. F1 + F2: limits in `validateCombo`, the `buildTimeline` guard, name cleanup in `decodeCombo`, `max` / `maxLength` on the editor inputs, friendly editor messages for the new errors (`friendlyError` in [src/ui/editor.ts](../../src/ui/editor.ts)). Tests from section 4.
3. F3: build-only CSP plugin in `vite.config.ts`. Check with `npm run build && npm run preview`: the editor, practice page, sound, gamepad, calibration and share links all work, with no CSP errors in the console.
4. F4: workflow permissions (and S3 if chosen). Check that the next push to `main` deploys.
5. F5: the SPEC §10 sentence.
6. DECISIONS.md entry; update NEXT_SESSION.md.

## 6. Out of scope
- Clickjacking protection on GitHub Pages (needs a response header Pages can't set; nothing sensitive to click-jack).
- Subresource Integrity: all scripts are same-origin build output, so there is nothing third-party to pin.

## Related
- [SPEC.md](../../SPEC.md) §2 (static hosting, no backend), §3 (combo definition), §10 (transcripts).
- [DECISIONS.md](../../DECISIONS.md), "Chords" (share code v2 and storage formats).
