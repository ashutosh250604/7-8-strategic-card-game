# 7–8 Game — Completion Roadmap

## Product Goal

Create a premium, portfolio-quality browser game with sophisticated visuals, satisfying card interactions, strategically capable AI, clear UX, excellent mobile usability, and strong replayability.

The game should feel like a finished product, not a demo or a collection of unrelated features. It is also the first table in a planned collection of Indian card games (7–8, 3–2–5, Coat & Shuffle), so its language and structure should be reusable without building the other games prematurely.

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
- Improve rules access and add a concise interactive tutorial. **Done:** opt-in first-run tutorial on sample cards teaches trump choice, the 8-vs-7 target and follow-suit without touching engine state.

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
- **P1 + P3 premium UI pass (milestone 3, complete)**:
  - Setup is now a proper title screen: the namesake 7♥/8♠ fanned on the felt as a cover illustration, then eyebrow, title, tagline, facts and a larger primary action. The empty deck no longer floats on this screen.
  - Seats are grouped and labelled (`Hand`, `Face-up`, counts), with the player's table cards and hand side by side on wide screens and stacked on phones.
  - The centre has an oval felt inlay, empty trick placeholders that show where the two cards land, a trick caption and lead-suit chip, and a turn-pulse status dot.
  - End of round is a result card on the cleared felt: targets, tricks won and points for both sides, with the next-round action centred beneath it. The engine's plain duplicate status line is suppressed while it shows.
  - HUD brand lockup, score/round hierarchy, gold primary CTA, modal touch targets, muted-text contrast and card labels refined.
  - Responsive: single-row HUD on short landscape (more table height), stacked HUD in portrait, tray/status sizing tuned down to 320×568, reduced-motion and keyboard paths preserved.
  - Trump sheet no longer blurs the hand the choice is based on.
- **Collection + tutorial (milestone 4, complete)**:
  - The project root is now the collection homepage (`index.html` + `home.css`): polished 7–8 tile, clearly labelled coming-soon tiles for 3–2–5 and Coat & Shuffle, planned tiles for Kachuful and Seep, and a “more tables” tile. Only 7–8 is presented as playable.
  - The game moved to `games/7-8/index.html`; shared game scripts and `style.css` stay at the project root. Its brand mark links back to the collection, and direct-from-disk play still works.
  - Added an opt-in tutorial (`tutorial.js`): a first-run invitation in the setup panel plus a permanent Tutorial button. Three short interactive steps use fixed sample cards — pick the strongest trump, answer the 8-vs-7 quiz, then choose the legal follow-suit card. Sample faces reuse the table's own renderer (`GameView.cardFaceHTML`), so pips and court cards match the real deal. A recap launches the normal first round. It never changes `gameState` (it only checks whether a game is already running before starting one); closing it marks the invitation as seen in `localStorage`.
  - Tutorial is keyboard operable (focus moved into the dialog, Escape closes, focus returns), respects reduced motion, and fits 320×568 without overflow.
- **Live coaching + acceptance E2E (milestone 5, complete)**:
  - Finishing the tour arms `coach.js` for the next real game. It is read-only: it recommends a trump from the actual five-card hand, marks the recommended suit, explains the 8-vs-7 target, then coaches the first live follow-suit turn on the real trick. It highlights the recommended legal card when one exists, explains a void hand, and retires after the follow turn (or via “Got it”).
  - If the computer wins the toss, the coach explains the computer-called trump and the player’s 7-trick target; it never presents a choice the player does not have.
  - Card-site flow polish: the start action is **Deal the cards**, the setup panel explains the toss/targets in one line, and **Rules** is a permanent HUD action (plus settings and the start panel). The live tile says **Deal the cards**. This follows the direct table → deal → play shape of cardgames.io without copying its layout.
  - Added `tests/tutorial-e2e.js` (`npm run test:e2e`): tracked headless Edge/Chrome coverage for the launcher, first-run localStorage, wrong-answer feedback, keyboard flow, live trump/follow coaching, the computer-called path, and coach layout at 390×844, 320×568 and 844×390. It fails on console/page errors.

### Verification (latest run)

- `node --check` on `coach.js`, `tutorial.js`, `presentation.js`, `ui.js`, `script.js` and the test scripts: pass.
- `node run-trace.js --compare baseline --group main --only slow --engine-only`: **12/12 identical** engine state, logs, status and AI plays vs the original baseline (up to first game over; patient profile only, see tests/README.md).
- `tests/tutorial-e2e.js` (headless Edge, reduced motion): **0 problems**. Covers launcher tile counts/keyboard Enter, first-run invite/Not now/localStorage persistence, wrong trump/target/follow feedback, Escape/Tab focus, recap start, live trump recommendation on the actual hand, choosing a different suit, first live follow-suit coach and completion retirement, the computer-wins-toss path, and coach fit at 390×844, 320×568 and 844×390.
- Restart group (24 scenarios, animated view): 24/24 pass idle-state assertions, 0 console/error/guard flags. The 24 full-trace diffs are expected: the recorded restart baseline predates the presentation refactor (see tests/README.md). Re-confirmed after the live-coach changes.
- Real Edge (`browser-smoke.js`): start, three real tricks and restart; 0 console/page errors (latest run). The earlier `--full` run still stands for the complete game flow, with no stuck/leaked cards.
- Keyboard pass: focused card exposes `role=button`, `tabindex=0`, an `aria-label` and `:focus-visible`; Enter plays it, ArrowRight/Left moves focus between cards. Reduced-motion pass: two live tricks complete with zero `flying` cards or console errors.
- Headless Edge UI matrix: 1440×900, 1024×768, 1024×600, 768×1024, 390×844, 360×640, 320×568 and 844×390 landscape; no document overflow, no clipped cards, status/tray collision fixed at 320 and 360 heights, round-result panel and New Round fit every size.
- Forced end-of-round state through the real `endRound()` path: result card updates, status is muted, `.is-round-end` centres the felt, New Round appears, and starting the next round clears the result and restores the table.
- Limitation: the in-app preview webview produced no frames for screenshots in this session; visual checks used headless Edge screenshots plus DOM geometry. Mobile landscape still needs a real-device pass.
- Launcher matrix (headless Edge): 1440×900, 1024×768, 768×1024, 390×844, 320×568 — 3/2/1 responsive columns as intended, no horizontal overflow, no clipped tile copy; live tile navigates to `games/7-8/index.html`.
- Tutorial (headless Edge): wrong trump/target/follow answers are rejected with explanations; correct answers advance; recap starts the normal game at `coin-toss`, and the first real trick can be played; `78-tutorial-seen-v1` persists across reload; Escape closes and returns focus; Tab stays inside the dialog; no overflow at 390×844, 320×568 or 844×390 (step 3 is the tallest state).
- Game setup with the first-run invitation fits 1440×900, 390×844, 320×568 and 844×390 landscape without pushing the panel outside the felt.

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

- Persisted settings, save/resume, stats/history, sound (hook `GameAudio.play(name)` exists; no `audio.js` yet), achievements.
- Mobile landscape is only CSS-checked; test on a real device.
- Rules modal text is still the long reference; the tutorial and live coach cover the first-round ideas, not every scoring edge case.
- The launcher is built and the 7–8 game is the visual/interaction reference. 3–2–5 and Coat & Shuffle are intentionally not implemented; their tiles are status-only.
- The setup hero cards and sample tutorial cards are decorative/sample only; the live coach reads the real hand and trick but never changes them.
- Git changes for this milestone are intentionally left uncommitted until requested.

### Next highest-value task (P4)

Make **Hard genuinely hard** while keeping rules fixed: determinised Monte-Carlo (PIMC) for lead/follow using only information a player legitimately has (own cards, visible face-up cards, played cards), with Medium = current heuristic improved lightly and Easy = deliberately beatable. Measure with `tests/sim/engine-sim.js` (target: Hard beats `sensible` by a clear margin; Medium roughly even; Easy loses). The tutorial, live coach, collection shell and acceptance E2E are now done. Later, P5 settings persistence/stats/sound and the first real second game (3–2–5) are the natural follow-ons; do not start a second game until its rules are approved.

Note: the `>= 1` game-end condition (and README/rules text saying 5) is still intentionally untouched awaiting your approval.

Do not assume any milestone is incomplete or complete without checking the working tree and relevant tests.

## Definition of Done

The project is done when the game is visually polished, responsive, strategically enjoyable, reliable across complete games and restarts, accessible for common interactions, and free of known critical defects. Optional experimental features are not required for completion.