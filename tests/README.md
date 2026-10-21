# Dev-only tests

Not needed to play the game. Requires Node 18+ and `npm install` inside this folder.

## Gameplay trace harness

Loads the real game page (`games/7-8/index.html`) + its local scripts into jsdom with a virtual clock and a
seeded `Math.random`, drives the game like a human (real DOM clicks, several reaction-speed
profiles including acting inside the post-trick window), and records engine state + visible
DOM after every step.

```
node run-trace.js --write <name>                 # record traces  -> tests/traces/<name>/
node run-trace.js --compare <name>               # re-run and diff against a recorded set
node run-trace.js --compare baseline --group main
node run-trace.js --only medium-quick-s1 ...     # single scenario
node run-trace.js --determinism --group restart  # same code twice must match
```

`--root` defaults to `games/7-8` (the folder holding the game's `index.html`), not the project root.

* The baseline lives in `tests/traces/` (git-ignored, ~8 MB). Recreate it from the original code with
  `git show 692a80b:index.html` and `git show 692a80b:script.js` into a folder (those were the
  pre-launcher root files), then
  `node run-trace.js --write baseline --root <that folder>`.
* After presentation/pacing changes, compare only the engine with
  `node run-trace.js --compare baseline --group main --only slow --engine-only`
  (state, logs, status, AI plays, in order; DOM and timing ignored; patient profile, up to first game over).
* `main` group (48 scenarios): byte-identical to the baseline for the Phase 1 refactor (full DOM compare).
  After the match-target and AI work, engine-only comparisons can differ intentionally (target and
  Medium/Hard choices). Use those diffs as an intentional-change check, not as a pass/fail gate;
  `match-target.js` and `sim/ai-rules.js` are the current gates for those behaviors.
* `restart` group (24): restart at awkward moments; it asserts a clean idle state afterwards.
  `traces/baseline/restart` was recorded from the pre-refactor code and contains the old
  stale-timer behaviour, so differences there are expected and intentional.
* The recorded baseline in `traces/baseline/` came from the original, untouched
  `index.html` + `script.js` (commit 692a80b).

## Real-browser smoke test

`node browser-smoke.js [--shots] [--file] [--full]` plays the start of `games/7-8/index.html` in headless Edge (`--full` auto-plays a
whole first-to-five match in real time with animations on, checks the result screen, starts a rematch and restarts it). It
fails on any console error, page error, failed request or HTTP error (analytics is blocked). The presentation hook also
asserts that the shuffle ran, the face-down row was dealt before any face-up card appeared, and cards had settled before
the next phase. The dev server serves the project root so the game can load shared assets from `../../`.

## Launcher + tutorial + live-coach E2E

```
node tutorial-e2e.js        # or: npm run test:e2e
```

Runs the real homepage and game in headless Edge/Chrome (set `EDGE_PATH` or
`CHROME_PATH` if the browser is not in a standard location). It covers the
launcher tile status and keyboard navigation, first-run `localStorage`, the
full tutorial with wrong-answer feedback, Escape/Tab keyboard behavior, the
live trump recommendation on the real hand, the first real follow-suit turn,
and the computer-called-trump path. It also checks the coach and trump sheet at
390×844, 320×568 and 844×390. Screenshots go to `tests/out/` (git-ignored).

## Settings and match-control E2E

```
node settings-e2e.js        # or: npm run test:settings
```

Checks malformed `localStorage` fallback, persisted sound/difficulty/target/motion preferences,
the live-match target deferral, reduced-motion coin timing, and graceful behaviour when the
Vibration API or Web Audio is missing. Also verifies that a live match keeps its target until
the next match.

## Responsive layout E2E

```
node layout-e2e.js        # or: npm run test:layout
```

Checks the collection host line, setup, a reduced-motion live table, keyboard card
play, Anne's trick-target reaction, the settings dialog and both result layouts at
1440x900, 390x844, 320x568 and 844x390. It fails on horizontal overflow, clipped
player cards, an unloaded Anne portrait, inaccessible result actions, a missing
victory spark burst, or a broken keyboard play. Screenshots go to `tests/out/`.

## Match target and AI checks

```
node match-target.js                     # 5-point default, alternate targets, live-match deferral
node sim/ai-rules.js [rounds]            # every Easy/Medium/Hard choice is legal
node sim/ai-match.js [matches]           # first-to-five matches vs a seeded sensible player
node sim/engine-sim.js [rounds] [matches]
```

`ai-match.js` uses the real engine and the same seeded baseline for each difficulty, so the
sample is repeatable. A 60-match sample is useful evidence, not a proof: expect a wide margin
around small differences. `engine-sim.js` prints the older round-level ladder, role balance,
trump-choice value, decision density and match length.
