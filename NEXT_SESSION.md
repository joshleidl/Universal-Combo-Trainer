# Next session

Where things stand and what to pick up next. Update this at the end of each session.

- Layer 4 (practice mode + feedback) plus input remapping and the MISC1/MISC2 buttons were reviewed and committed on 2026-10-30.
- Layer 5 Part A (sound, countdowns, saved settings, Hear timing) was reviewed and committed on 2026-10-30.
- Layer 5 Part B (calibration, mobile pass, deploy config, share-by-URL) was reviewed and committed on 2026-10-30. The app is live at https://joshleidl.github.io/Universal-Combo-Trainer/ and redeploys on every push to `main`.
- All SPEC §8 layers are done. Next candidates are in [BACKLOG.md](BACKLOG.md) (e.g. the advanced combo-building mode), plus testing calibration and the phone layout on real hardware.
- **Chords** (2026-11-01, branch `chords`, committed with a pull request open into `main`): the user's answers to the proposal are in SPEC §3 "Chords" and DECISIONS.md "Chords". Engine, storage (old combos still load), share links v2 (v1 still opens), editor (chord picker, window in frames or ms, frame-edge diagram), practice page (split / partial colors, chord timeline dots, "Other results" stats column), and tests (370 passing) are all done. Checked in headless Chromium at desktop width and 375 px.
- Any mix of early / on time / late in one chord grades as SPLIT for now (user's call, 2026-11-01); may be refined later.
- Next: the user is running the hardware check on keyboard and stick (BACKLOG, "Chord follow-ups") to tune the default chord window. Merging the pull request deploys chords to the live site.
