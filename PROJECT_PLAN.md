# 7–8 Game - Completion Roadmap

## Product Goal

Create a premium, portfolio-quality browser game with sophisticated visuals, satisfying card interactions, strategically capable AI, clear UX, excellent mobile usability, and strong replayability.

The game should feel like a finished product, not a demo or a collection of unrelated features. It is also the first table in a planned collection of Indian card games (7–8, 3–2–5, Coat & Shuffle), so its language and structure should be reusable without building the other games prematurely.

## Current Baseline

- Phase 1 architecture separation completed.
- GameEngine, GameView, and UI wiring separated.
- GSAP is locally vendored.
- Restart cancellation/session protection implemented.
- Gameplay trace harness and browser smoke tests exist.
- The player-approved match target is 3, 5 or 7 points, default 5. The old one-point test shortcut must not return to the production path.
- Some previous experimental files may exist in `_archive/abandoned-attempt/`; inspect before touching.
- Phase 2 work may already exist. Inspect the current working tree and recent changes before deciding what remains.

## Priority Order

### P0 - Stabilize and Establish the Starting Point

- Inspect current Git status, project files, test setup, and Phase 2 changes.
- Preserve all valuable completed work.
- Identify incomplete, broken, or duplicate features.
- Establish a concise remaining-work checklist.
- Do not repeat Phase 1 or Phase 2 work that is already complete.

### P1 - Premium Visual Foundation

- Sophisticated dark walnut and emerald tabletop.
- Warm gold accents, premium ivory card faces, and distinctive card backs.
- Excellent typography, spacing, lighting, shadows, and hierarchy.
- Clear opponent area, player hand, central trick area, score, trump, turn status, and controls.
- Responsive desktop and mobile layouts.

### P2 - Persistent Cards and Animation

- Stable DOM identity for cards.
- Smooth dealing, movement, flipping, playing, trick collection, and reveal animations.
- GSAP timelines coordinated through the presentation layer.
- No repeated deal animation on every state update.
- Correct interaction timing and cancellation on restart.

### P3 - Core UX and Interaction Quality

- Clear playable/invalid card states after every turn.
- Explain invalid plays, including follow-suit restrictions.
- Improve trump selection, scoring feedback, turn indicators, and game-end presentation.
- Make touch interactions reliable; consider optional tap-to-preview.
- Improve rules access and add a concise interactive tutorial. **Done:** opt-in first-run tutorial on sample cards teaches trump choice, the 8-vs-7 target and follow-suit without touching engine state.

### P4 - AI and Gameplay Quality

- Evaluate Easy, Medium, and Hard separately.
- Improve strategic card selection, trump selection, leads, responses, and endgame decisions.
- Make difficulty differences meaningful and AI behavior fair.
- Consider opponent personalities only if they add real value.
- Preserve fundamental rules unless changes are explicitly approved.
- Measure AI changes with repeatable simulations where practical.

### P5 - Product Features

Prioritize only features that substantially improve the finished game:
- Persist settings.
- Save/resume a game if reliable and useful.
- Statistics and match history.
- Optional sound effects and audio controls.
- Useful achievements or challenges if budget/time permits.

Avoid multiplayer, online services, large feature expansions, and unnecessary dependencies unless separately approved.

### P6 - Accessibility, Mobile, and Performance

- Keyboard operation and visible focus.
- Accessible card labels and status announcements.
- Reduced-motion support.
- Touch targets and readable cards on small screens.
- Smooth performance without unnecessary animation loops.
- Test major viewport sizes and relevant browser behavior.

### P7 - Final QA and Release Polish

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
- Rules and trick targets are unchanged. The player-approved match target is now configurable at 3, 5 or 7 points, defaults to 5, and the old one-point test shortcut is gone from the production path.
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
  - Added an opt-in tutorial (`tutorial.js`): a first-run invitation in the setup panel plus a permanent Tutorial button. Three short interactive steps use fixed sample cards - pick the strongest trump, answer the 8-vs-7 quiz, then choose the legal follow-suit card. Sample faces reuse the table's own renderer (`GameView.cardFaceHTML`), so pips and court cards match the real deal. A recap launches the normal first round. It never changes `gameState` (it only checks whether a game is already running before starting one); closing it marks the invitation as seen in `localStorage`.
  - Tutorial is keyboard operable (focus moved into the dialog, Escape closes, focus returns), respects reduced motion, and fits 320×568 without overflow.
- **Live coaching + acceptance E2E (milestone 5, complete)**:
  - Finishing the tour arms `coach.js` for the next real game. It is read-only: it recommends a trump from the actual five-card hand, marks the recommended suit, explains the 8-vs-7 target, then coaches the first live follow-suit turn on the real trick. It highlights the recommended legal card when one exists, explains a void hand, and retires after the follow turn (or via “Got it”).
  - If the computer wins the toss, the coach explains the computer-called trump and the player’s 7-trick target; it never presents a choice the player does not have.
  - Card-site flow polish: the start action is **Deal the cards**, the setup panel explains the toss/targets in one line, and **Rules** is a permanent HUD action (plus settings and the start panel). The live tile says **Deal the cards**. This follows the direct table → deal → play shape of cardgames.io without copying its layout.
  - Added `tests/tutorial-e2e.js` (`npm run test:e2e`): tracked headless Edge/Chrome coverage for the launcher, first-run localStorage, wrong-answer feedback, keyboard flow, live trump/follow coaching, the computer-called path, and coach layout at 390×844, 320×568 and 844×390. It fails on console/page errors.
- **Premium character and table pass (milestone 6, complete)**:
  - **Anne**: a custom local SVG portrait (`assets/anne.svg`), her name and difficulty badge at the opposite seat, a compact reaction bubble, tutorial-guide framing, and result-screen dialogue selected from the real match outcome. `character.js` owns the local script and an avatar registry with two reserved slots for future tables. No network dialogue or image service.
  - **Card handling**: the opening stack now shuffles in three controlled passes and settles before the deal. The deal is split into a face-down row followed by a face-up turn, both driven by engine-owned state and presentation beats. Card play, face-down reveal, trick sweep and collection retain persistent DOM identity; restart clears running tweens and pending beats so stale sequences cannot fire into a new match.
  - **Sound and haptics**: `audio.js` synthesises local card, coin, trick, invalid, victory and defeat effects with Web Audio, a master gain, duplicate-event limits and silent failure. `GameHaptics` uses the Vibration API only where present, with a preference, short patterns and duplicate protection. Preferences are persisted by `settings.js`.
  - **Coin and results**: a CSS 3D coin with edge, rim, ornaments, metallic shading and five-plus rotations, landing on the engine's already-chosen result. The result screen shows the actual final score, target, winner and Anne's reaction, with a restrained gold spark burst and one-click rematch. Backdrop clicks cannot dismiss it.
  - **Settings**: target (3/5/7), difficulty, sound, master volume, motion (full/fast/reduced), haptics, tutorial replay, rules and log. A target change applies to the next match and the UI says so; difficulty applies immediately and the copy says so.
  - **AI**: Easy stays deliberately loose. Medium is a new public-information heuristic that cashes safe masters, follows cheaply, values trumps and avoids blind ruffing. Hard remains determinised Monte Carlo over sampled unseen hands, now with measured results below. No difficulty reads hidden cards.
  - **Quality of life**: safe restart confirmation, a result screen that cannot be dismissed by a stray backdrop click, a one-click rematch that deals immediately, mute in the HUD, per-event haptics, and remembered preferences.
  - Added `tests/settings-e2e.js` and extended the real-browser smoke to assert shuffle/deal stages, result visibility and rematch/restart behavior.

### Verification (latest run)

- `node --check` on `coach.js`, `tutorial.js`, `presentation.js`, `ui.js`, `script.js` and the test scripts: pass.
- Engine trace baseline was **12/12 identical** before this milestone. It is now a historical reference: match-target and Medium/Hard AI changes are intentional engine differences. Use `match-target.js`, `sim/ai-rules.js` and `sim/ai-match.js` as the current gates.
- `tests/tutorial-e2e.js` (headless Edge, reduced motion): **0 problems** after the rematch change. Covers launcher tile counts/keyboard Enter, first-run invite/Not now/localStorage persistence, wrong trump/target/follow feedback, Escape/Tab focus, recap start, live trump recommendation on the actual hand, choosing a different suit, first live follow-suit coach and completion retirement, the computer-wins-toss path, coach fit at three sizes, both result screens, one-click rematch, settings persistence and sanitisation.
- Restart group (24 scenarios, animated view): 24/24 pass idle-state assertions, 0 console/error/guard flags. The 24 full-trace diffs are expected: the recorded restart baseline predates the presentation refactor (see tests/README.md). Re-confirmed after the live-coach changes.
- Real Edge (`browser-smoke.js`): start, three real tricks, invalid-play state, and restart; 0 console/page errors. Presentation stages confirmed the shuffle beat and a five-card face-down row with zero face-up cards before the turn.
- Real Edge (`browser-smoke.js --shots --full`, full motion): a complete first-to-five match reached a state-backed result screen, the result survived a backdrop click, "Play another match" started a clean 0-0 rematch and the next restart asked for confirmation. The final run finished in 43 s (Anne 5-0), with no stuck/leaked cards, no console/page errors and no failed game requests. The human-victory spark path was exercised separately at 390×844: 36 spark nodes.
- `settings-e2e.js` (real headless Edge): 16/16 checks. Malformed storage falls back safely, all preference controls and volume persist across reload, the HUD mute restores sound, every effect can be invoked without throwing, target changes defer to the next match, reduced motion settles the coin in under 3.5 s, and the haptics switch disables itself with an explanation when the API is missing.
- `layout-e2e.js` (real headless Edge): **36/36 checks** at 1440×900, 390×844, 320×568 and 844×390. The collection host line, setup, live table, settings and result screens all fit without horizontal overflow or clipped player cards; result actions remain reachable by scrolling; Anne's portrait loads at every size and her trick-target reaction was exercised on the live table.
- `match-target.js`: 10/10 checks. Default 5, alternate 3 and 7, live-match deferral, restart application, computer victory and invalid-target rejection.
- `sim/ai-rules.js` (6 rounds per difficulty in the final pass): 90 selections each, 0 illegal for Easy, Medium and Hard. An earlier 8-round pass was also clean.
- `sim/ai-match.js` (60 first-to-five matches per difficulty, after the Medium rewrite): Easy 7 wins, Medium 21, Hard 48 against the same seeded sensible baseline.
- Keyboard pass: focused card exposes `role=button`, `tabindex=0`, an `aria-label` and `:focus-visible`; Enter plays it, ArrowRight/Left moves focus between cards. Reduced-motion pass: two live tricks complete with zero `flying` cards or console errors.
- Earlier UI matrix (1440×900, 1024×768, 1024×600, 768×1024, 390×844, 360×640, 320×568, 844×390) remains the reference for the pre-character layout; the current four-size matrix above is the current evidence.
- Forced end-of-round state through the real `endRound()` path: result card updates, status is muted, `.is-round-end` centres the felt, New Round appears, and starting the next round clears the result and restores the table.
- Limitation: the in-app preview webview again produced no frames for screenshots, so visual checks used headless Edge screenshots plus DOM geometry. The screenshots were not viewed by a human in this session. Mobile landscape (844×390) is browser-checked, not real-device-checked.
- Launcher matrix (headless Edge): 1440×900, 1024×768, 768×1024, 390×844, 320×568 - 3/2/1 responsive columns as intended, no horizontal overflow, no clipped tile copy; live tile navigates to `games/7-8/index.html`.
- Tutorial (headless Edge): wrong trump/target/follow answers are rejected with explanations; correct answers advance; recap starts the normal game at `coin-toss`, and the first real trick can be played; `78-tutorial-seen-v1` persists across reload; Escape closes and returns focus; Tab stays inside the dialog; no overflow at 390×844, 320×568 or 844×390 (step 3 is the tallest state).
- Game setup with the first-run invitation fits 1440×900, 390×844, 320×568 and 844×390 landscape without pushing the panel outside the felt.

### Measured AI results (tests/sim/ai-match.js, real engine, 60 matches per difficulty)

The baseline is the same seeded `sensible` heuristic for every cell; all matches are first to 5 points.

| AI | Player wins | Anne wins | Avg player points | Avg Anne points | Avg rounds |
|---|---|---|---|---|---|
| Easy | 53 | 7 | 5.62 | 1.43 | 3.50 |
| Medium | 39 | 21 | 4.73 | 2.97 | 4.87 |
| Hard | 12 | 48 | 2.40 | 5.20 | 4.37 |

- The ladder is now monotonic on this sample: Easy wins 11.7% of matches, Medium 35%, Hard 80%.
- An earlier 40-match sample had Medium at 5 wins and Easy at 7; that noise prompted the Medium rewrite. The 60-match sample is evidence, not a proof, and the margin around small differences is wide.
- Hard uses sampled unseen hands and owns only public information (own cards, visible face-up cards, played cards). `ai-rules.js` wraps every choice against the engine's legal list.
- Older round-level engine-sim findings (trump choice matters, 7/8 role balance near 42/35/23, 20% of turns have one legal card) still describe the rules and are not invalidated by the AI change.
- Match to 5 points: median 4 rounds in the older 2000-round sample (p10 2, p90 7).

### Not done yet / known gaps

- The in-app preview webview did not composite frames during this session, so visual checks rely on headless Edge screenshots and DOM geometry rather than a live human look. Mobile landscape still needs a real-device pass.
- Anne's portrait is a hand-built local SVG illustration, not commissioned or AI-generated professional artwork. It is consistent and distinctive, but should be treated as a strong placeholder for final art.
- Sound is synthesised with Web Audio, not recorded card or coin samples. It is tuned and local, but it is not a studio sound library.
- Haptics were verified through the API path and a simulated missing-API fallback in headless Edge; they have not been felt on real mobile hardware.
- Save/resume, statistics/history, achievements, and additional tables are not implemented. 3–2–5 and Coat & Shuffle remain status-only tiles; the character registry has two empty avatar slots for them.
- The rules modal remains the long reference; the tutorial and first-round coach cover the opening decisions, not every scoring edge case.
- The setup hero cards and sample tutorial cards are decorative/sample only; the live coach reads the real hand and trick but never changes them.

### Next highest-value task

The premium character/table milestone is verified and ready to commit. The next product step is a real-device mobile pass (touch card selection, vibration, audio unlock, landscape) and a human visual review of Anne's portrait and the result/settings screens. After that, save/resume or match history would add more value than another round of cosmetic changes. Do not start 3-2-5 or Coat & Shuffle until their rules and hosts are approved.

Do not assume any milestone is incomplete or complete without checking the working tree and relevant tests.

## Definition of Done

The project is done when the game is visually polished, responsive, strategically enjoyable, reliable across complete games and restarts, accessible for common interactions, and free of known critical defects. Optional experimental features are not required for completion.