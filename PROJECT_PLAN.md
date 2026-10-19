# 7–8 Game — Completion Roadmap

## Product Goal

Create a premium, portfolio-quality browser game with sophisticated visuals, satisfying card interactions, strategically capable AI, clear UX, excellent mobile usability, and strong replayability.

The game should feel like a finished product, not a demo or a collection of unrelated features.

## Current Baseline

- Phase 1 architecture separation completed.
- GameEngine, GameView, and UI wiring separated.
- GSAP is locally vendored.
- Restart cancellation/session protection implemented.
- Gameplay trace harness and browser smoke tests exist.
- The original `>= 1` testing conditions must remain unchanged unless explicitly approved.
- Some previous experimental files may exist in `_archive/abandoned-attempt/`; inspect before touching.
- Phase 2 work may already exist. Inspect the current working tree and recent changes before deciding what remains.

## Priority Order

### P0 — Stabilize and Establish the Starting Point

- Inspect current Git status, project files, test setup, and Phase 2 changes.
- Preserve all valuable completed work.
- Identify incomplete, broken, or duplicate features.
- Establish a concise remaining-work checklist.
- Do not repeat Phase 1 or Phase 2 work that is already complete.

### P1 — Premium Visual Foundation

- Sophisticated dark walnut and emerald tabletop.
- Warm gold accents, premium ivory card faces, and distinctive card backs.
- Excellent typography, spacing, lighting, shadows, and hierarchy.
- Clear opponent area, player hand, central trick area, score, trump, turn status, and controls.
- Responsive desktop and mobile layouts.

### P2 — Persistent Cards and Animation

- Stable DOM identity for cards.
- Smooth dealing, movement, flipping, playing, trick collection, and reveal animations.
- GSAP timelines coordinated through the presentation layer.
- No repeated deal animation on every state update.
- Correct interaction timing and cancellation on restart.

### P3 — Core UX and Interaction Quality

- Clear playable/invalid card states after every turn.
- Explain invalid plays, including follow-suit restrictions.
- Improve trump selection, scoring feedback, turn indicators, and game-end presentation.
- Make touch interactions reliable; consider optional tap-to-preview.
- Improve rules access and add a concise interactive tutorial.

### P4 — AI and Gameplay Quality

- Evaluate Easy, Medium, and Hard separately.
- Improve strategic card selection, trump selection, leads, responses, and endgame decisions.
- Make difficulty differences meaningful and AI behavior fair.
- Consider opponent personalities only if they add real value.
- Preserve fundamental rules unless changes are explicitly approved.
- Measure AI changes with repeatable simulations where practical.

### P5 — Product Features

Prioritize only features that substantially improve the finished game:
- Persist settings.
- Save/resume a game if reliable and useful.
- Statistics and match history.
- Optional sound effects and audio controls.
- Useful achievements or challenges if budget/time permits.

Avoid multiplayer, online services, large feature expansions, and unnecessary dependencies unless separately approved.

### P6 — Accessibility, Mobile, and Performance

- Keyboard operation and visible focus.
- Accessible card labels and status announcements.
- Reduced-motion support.
- Touch targets and readable cards on small screens.
- Smooth performance without unnecessary animation loops.
- Test major viewport sizes and relevant browser behavior.

### P7 — Final QA and Release Polish

- Run gameplay regression tests and browser smoke tests.
- Verify new game, restart, complete rounds, all difficulties, invalid plays, and game-over flow.
- Check console errors, missing assets, and broken controls.
- Verify `index.html` still works directly if that remains the project's supported workflow.
- Update README and remove only genuinely unnecessary development artifacts.
- Report remaining limitations honestly.

## Execution Rules

- Inspect existing work before starting each milestone.
- Implement one coherent milestone at a time.
- Combine tightly related visual changes to avoid repetitive analysis.
- Test after implementation.
- Update this roadmap as work is completed.
- Ask before fundamental rule changes or costly architectural migrations.
- Prefer a small number of excellent features over many unfinished ones.

## Current Status

### Done

- **P0/Phase 1**: engine / presentation / UI separation, beats (Promise-gated flow), restart cancellation, vendored GSAP, regression harness.
- **P1 + P2 + part of P3 (milestone 2, complete)**:
  - New tabletop (walnut rim, emerald felt with grain, trump-suit watermark), ivory cards with real pips/court cards, engraved card back, serif/sans type, HUD (score, round, trump chip, difficulty, tricks `n / target` with 15-pip meters, turn dot).
  - Persistent card elements (`presentation.js`): one DOM node per card, FLIP/arc moves, deal-from-deck, face-down reveal flip, trick sweep to the winner's meter, 3D coin toss, trump sheet that keeps the hand visible. Beats wait for running animations; reduced-motion / no-GSAP use short timers.
  - Hand auto-sorted by suit (trump first, alternating colours, high to low).
  - **Playable/invalid highlighting fixed** (computed from the table, so it is right after computer moves); invalid plays shake the card and show a toast ("Follow suit: ..."); touch = tap to raise, tap again to play.
  - Keyboard play (Tab / Arrows / Enter), aria-labels ("Ace of clubs, not playable, follow suit"), live-region status, visible focus.
  - Pacing: a full round now takes ~20 s of table time instead of ~90 s (beats are in `BEAT_MS` in `presentation.js`).
  - Scoreboard refreshes at round end (added one `updateDisplay()` call in `endRound`; view only). Engine got two read-only helpers: `isValidPlayFor`, `getTrickTarget`.
- Rules/scoring/AI untouched; `>= 1` conditions untouched.

### Verification (latest run)

- `node run-trace.js --compare baseline --group main --only slow --engine-only`: **12/12 identical** engine state, logs, status and AI plays vs the original baseline (up to first game over; patient profile only, see tests/README.md).
- Restart group (24 scenarios, new animated view): 24/24 pass idle-state assertions, 0 console errors.
- Real Edge (`browser-smoke.js --full`): full game in ~20 s, 0 console/page errors, no stuck/leaked cards; keyboard-only play and reduced-motion verified.

### Measured findings (tests/sim/engine-sim.js, real engine, 2000 rounds per cell)

Human stand-in `sensible` = decent casual player. AI pts/round minus human pts/round:

| AI | vs random | vs sensible |
|---|---|---|
| Easy | +0.04 | -1.14 |
| Medium | +0.50 | -0.56 |
| Hard | +0.74 | **-0.15** |

- **Hard still loses to a casual heuristic player** (scores 34% of rounds vs the human's 43%). Medium/Hard only differ in play; all three pick trump with the same heuristic.
- 7/8 asymmetry looks balanced under equal-ish skill (selector scores 42-44%, opponent 35-39%, nobody 17-23%).
- Trump choice matters (avg tricks: heuristic 8.6, random 7.9, worst 7.3), so "trump is the key decision" is true.
- 20% of the player's turns have exactly one legal card (avg 4.3 legal) -> optional auto-play is reasonable.
- Match to 5 points: median 4 rounds (p10 2, p90 7).

### Not done yet / known gaps

- Tutorial, persisted settings, save/resume, stats/history, sound (hook `GameAudio.play(name)` exists; no `audio.js` yet), achievements.
- Mobile landscape is only CSS-checked; test on a real device.
- Rules modal text is the original; HUD shows targets but the rules are not yet taught interactively.
- Game-over modal/coin/trump polished; settings/rules/log modals only restyled.

### Next highest-value task (P4)

Make **Hard genuinely hard** while keeping rules fixed: determinised Monte-Carlo (PIMC) for lead/follow using only information a player legitimately has (own cards, visible face-up cards, played cards), with Medium = current heuristic improved lightly and Easy = deliberately beatable. Measure with `tests/sim/engine-sim.js` (target: Hard beats `sensible` by a clear margin; Medium roughly even; Easy loses). Then P3 tutorial + P5 settings persistence/stats/sound.

Note: the `>= 1` game-end condition (and README/rules text saying 5) is still intentionally untouched awaiting your approval.

Do not assume any milestone is incomplete or complete without checking the working tree and relevant tests.

## Definition of Done

The project is done when the game is visually polished, responsive, strategically enjoyable, reliable across complete games and restarts, accessible for common interactions, and free of known critical defects. Optional experimental features are not required for completion.