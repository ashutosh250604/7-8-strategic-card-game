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
whole first-to-three match in real time with animations on, checks the result screen, starts a rematch and restarts it). It
fails on any console error, page error, failed request or HTTP error (analytics is blocked). The presentation hook also
asserts that the shuffle ran, the face-down row was dealt before any face-up card appeared, and cards had settled before
the next phase. The dev server serves the project root so the game can load shared assets from `../../`.

`--full` is measured in wall clock, so it needs a browser that is not being throttled: Edge is launched with
`--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`, and
`prefers-reduced-motion: no-preference` is emulated so the animated path is what gets timed. Without those, a backgrounded
page clamps timers and starves rAF, and every beat is stretched several times over. A hard match is first to three points,
so it runs 3-7 rounds of coin-decided start, riffle (4 s), deal and eight animated tricks - roughly a minute per round. The
budget is 20 minutes (worst case plus headroom); if a match still does not finish, the result and rematch checks are
skipped with a recorded problem instead of erroring on a modal that is not on screen.

`node probe-timing.js [w h] [--match|--trace]` is the pacing instrument for that budget: `--match` prints the wall clock
per round, and `--trace` samples the table four times a second and prints every stretch where nothing changed, with the
`GameView.pendingCount()` gate and the status/log text on both sides. It answers "is this round slow, or stuck?" without
guessing.

## Opening animation check

`node anim-check.js [width height]` (default 1280×800) opens the real table and
fails unless the opening shuffle is at full opacity and visibly moving, the coin
turns through at least eight distinct transforms, and real Web Audio sources are created
for both. It is the regression guard for "there is no shuffle/coin animation".
Screenshots go to `tests/out/anim-<w>x<h>.png`.

`node motion-check.js` (`npm run test:motion`) opens the table with the operating
system set to reduce motion and verifies that the in-app setting wins: Full and
Fast still animate, Calm still shuffles and flips the coin, and each mode
schedules audio. It is the regression guard for the motion preference itself.

## AI invariants and ladder

- `node sim/ai-rules.js [rounds]` - every AI choice is in the engine's legal list.
- `node sim/ai-ruff.js [rounds]` - Medium and Hard never discard when void in the
  led side suit while holding a trump (the reported Hard blunder). Easy may
  blunder; the engine's `enforceRuffRule` guard corrects it.
- `node sim/ai-match.js [matches] [rounds]` - first-to-three ladder against the
  same seeded `sensible` baseline for Easy, Medium and Hard.

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

Checks malformed `localStorage` fallback, persisted sound/difficulty/target/motion/voice/fireworks
preferences, the winner-fireworks default and toggle, the live-match target deferral, the shortened
Calm shuffle, and graceful behaviour when the Vibration API or Web Audio is missing. Also verifies
that a live match keeps its target until the next match.

## Responsive layout E2E

```
node layout-e2e.js        # or: npm run test:layout
```

Checks the collection host line, setup, a reduced-motion live table, keyboard card
play, Anne's trick-target reaction, the settings dialog and both result layouts at
1440x900, 390x844, 320x568 and 844x390. It fails on vertical or horizontal document
overflow, clipped player cards, an unloaded Anne portrait, inaccessible result
actions, missing victory fireworks, or a broken keyboard play. Every target must
fit without page scrolling, with every player card on screen. Screenshots go to
`tests/out/`.

## Mobile / touch pass

```
node mobile-pass.js       # or: npm run test:mobile
```

Emulates touch phones at 320x568, 360x800, 390x844 and 844x390. At 320 it taps the
start flow and a card twice, proving that the first tap only selects and the second
plays; the card row also changes its label to “tap again”. It stubs
`navigator.vibrate`, instruments `AudioContext`, and confirms that the touch gesture
creates the audio context. At every size it checks that the full table fits without
scrolling, that each player card is on screen, that HUD controls are at least 36px
and visible labels at least 10.5px, that the status row clears the trick tray, and
that Anne's longest line stays inside the viewport. Screenshots go to `tests/out/`
as `mobile-<width>x<height>.png`.

This is browser emulation, not a physical handset: speaker output, real vibration
hardware and iOS Safari behavior still need a device check before release.

## Visual polish and trump sheet

```
node ui-polish.js
```

Checks the default preferences, the trump sheet's actual mini-cards/counts/
centering/no blur, the fixed subtitle lane, the selected female voice, all 14
recorded audio slots, default-off and enabled fireworks, result hit-testing, and
overflow/portrait checks at 1440x900, 390x844, 320x568 and 844x390.

## Anne's face and speech bubble

```
node probe-face.js [width] [height]
```

Reaches a live table and reports whether the seat avatar is the supplied photograph, every mood's computed transform and mouth shape, that she blinks, the gap
between her cheek and the speech bubble, and which sound slots were loaded from
`assets/audio/`. It also writes 4x portraits per mood (`out/face-<size>-<mood>.png`)
and the seat with a line showing, for visual review. `layout-e2e.js` asserts the
two permanent rules: the face is drawn and the bubble stays close to it.

## Match target and AI checks

```
node match-target.js                     # 3-point default, alternate targets, live-match deferral
node sim/ai-rules.js [rounds]            # every Easy/Medium/Hard choice is legal
node sim/ai-ruff.js [rounds] [level]     # never discards when a trump could ruff
node sim/ai-match.js [matches]           # first-to-three matches vs a seeded sensible player
node sim/engine-sim.js [rounds] [matches]
```

`ai-ruff.js` is the invariant gate for the two-player rule that a ruff can never be
over-ruffed: if the AI is void in the led side suit and holds a trump, it must play the trump.
`ai-match.js` uses the real engine and the same seeded baseline for each difficulty, so the
sample is repeatable. A 60-match sample is useful evidence, not a proof: expect a wide margin
around small differences. `engine-sim.js` prints the older round-level ladder, role balance,
trump-choice value, decision density and match length.


## Dialogue, layout and sound dev tools

```
node probe-dialogue.js [matches] [seed]   # plays full Hard matches and audits what Anne says
node probe-overlap.js [width] [height]    # overlap / centring / small-text audit of a live table
node probe-stall.js [seconds]            # plays a match with every beat instrumented; dumps evidence on a freeze
node probe-hit.js [width] [height]        # is every on-screen control really the thing under the cursor?
node probe-timing.js [w h] [--match|--trace]  # wall clock per round; where each second goes
node render-sound.js <slot> [seconds]     # renders a synth effect from audio.js to assets/audio/<slot>.wav
node render-sound.js --levels             # peak, RMS and in-game gain of every sound slot
node file-url.js                          # opens both pages from disk and proves the current build loads
```

`file-url.js` exists because opening the folder is a supported way to play. It
asserts the four game stylesheets, the embedded fonts, Anne's portrait and the
start flow all work over `file://`, and that no console errors are produced by
the blocked audio manifest or font requests. Run it after touching CSS, fonts or
asset paths.

`probe-dialogue.js` drives the human seat with a sensible baseline, records every line
Anne says next to the situation that produced it (mood, score, round, trick), maps each
line back to its category in `character.js` and reports back-to-back categories, exact
sentences repeated inside a match and the ordered transcript
(`tests/out/dialogue-hard.txt`). It is the guard for "she repeats herself" and "that line
does not fit the situation": a target line must appear once per deal, the last-trick and
final-trick lines must land on the real remaining count, and a run of six tricks must not
be described as three.

`probe-stall.js` plays a real match the way a person does and wraps `GameView.beat`,
recording when each beat starts and settles. If the table makes no progress for twelve
seconds it prints the open beats, the presentation promises still pending, the rAF
clock and every console error, then exits 3. It exists because a frozen turn used to
look like a rules bug: the animation promises and the beat clock froze together when
the test page was backgrounded. The smoke test now keeps its page in front.

`probe-overlap.js` measures a live table with a card in the trick tray and reports pairs
of elements that must never overlap, how far centred blocks are from the board centre,
page overflow and every visible piece of text under 11px with its colour and background.
Run it after any CSS work; `layout-e2e.js` covers the same ground as a pass/fail gate.
Two readings need care: a pair is compared as axis-aligned boxes, so a rotated card in
the tray can report a few pixels against the caption above it that no one can see - check
the screenshot it writes before treating those as real. And "off centre" is only a fault
for blocks that are meant to be centred: Anne's identity block and the trick meters are
anchored left and right on purpose.

`render-sound.js` renders one of `audio.js`'s synthesised effects offline and writes it as
a 16-bit PCM WAV, reading the effect body and the `tone`/`hiss` helpers straight out of
`audio.js` so the file and the in-game fallback cannot drift. `matchPoint.wav` was produced
this way; `--levels` prints every slot's peak, RMS and gain so a new recording can be
placed in the same band as the rest.
