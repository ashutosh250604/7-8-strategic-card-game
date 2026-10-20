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
* `restart` group (24): restart at awkward moments; it asserts a clean idle state afterwards.
  `traces/baseline/restart` was recorded from the pre-refactor code and contains the old
  stale-timer behaviour, so differences there are expected and intentional.
* The recorded baseline in `traces/baseline/` came from the original, untouched
  `index.html` + `script.js` (commit 692a80b).

## Real-browser smoke test

`node browser-smoke.js [--shots] [--file] [--full]` plays the start of `games/7-8/index.html` in headless Edge (`--full` auto-plays a
whole game in real time with animations on) and fails on any console error, page error, failed request or HTTP error
(analytics is blocked). The dev server serves the project root so the game can load shared assets from `../../`.

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

## AI / balance simulator

`node sim/engine-sim.js [roundsPerCell] [matches]` runs the real engine headlessly and prints difficulty ladder,
role balance, trump-choice value, decision density and match length. Use it to measure any AI change.
