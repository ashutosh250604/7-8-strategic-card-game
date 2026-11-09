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
- The player-approved match target is 3, 5 or 7 points, default 3. The old one-point test shortcut must not return to the production path.
- Some previous experimental files may exist in `_archive/abandoned-attempt/`; inspect before touching.
- Phase 2 work may already exist. Inspect the current working tree and recent changes before deciding what remains.

## Previous Pass - Tabletop Refinement (October 2026)

The visual layer was rebuilt around a dark walnut and deep-felt table with warm
gold accents, replacing the neon arcade skin while keeping the working layout
and motion plumbing.

- Final stylesheet: `theme.css`, loaded last on both pages, owns the palette,
  chrome, cards, modals, Anne and the launcher. `fonts.css` (embedded Bungee,
  Manrope and Space Grotesk) supplies the faces; `table.css` and `overlays.css`
  keep the responsive layout, and `home.css` keeps the collection structure.
- One portrait: `anne-avatar.js` draws Anne as a layered vector portrait
  inspired by the supplied reference, not a pasted photograph. The same SVG
  component mounts on the home hero, seat, trump sheet, tutorial and result
  card; it blinks, breathes, shifts mood, moves its mouth while the voice
  speaks, and includes her hands on the felt rail with a small card fan.
- Anne's voice (`anne-voice.js`) uses the platform speech engine, respects the
  sound setting, and has a test button in Settings.
- All 14 sound slots are wired, including the recorded `matchPoint.wav`.
  `file://` uses the synthesised table instead of failing on fetch.
- The stale `freebuff-sites-build/` deploy copy and its ignore rule were
  removed; there is now exactly one home page and one game page.
- Fixed a real turn deadlock: animation waits are bounded and Anne's turn has a
  watchdog, so a killed tween can no longer freeze a match.
- Mobile: two-row HUD, stacked card rows, 2x2 trump sheet, dialogs constrained
  to the viewport, and a compact one-screen landscape layout. Live-table chrome
  is at least 10.5px at 390px, and 320px phones keep the score names and the
  target instead of collapsing to two bare numbers.
- Settings shows Anne's voice as a real switch: its label, aria-checked state
  and the "Say hello" button all follow whether the voice can actually speak,
  and turning it on greets the player through the chosen system voice.
- Verified with `tests/layout-e2e.js`, `tutorial-e2e.js`, `settings-e2e.js`,
  `browser-smoke.js --full`, `probe-dialogue.js`, `audio-slots.js`,
  `probe-stall.js`, `probe-overlap.js`, `probe-ui.js`, `probe-face.js`,
  `probe-portrait.js` and `file-url.js`.

Remaining honest limits: Anne is a designed illustration rather than a
photograph, so she reads as the game's host rather than a real person; her
speaking mouth is a stylised loop, not phoneme lip-sync. The collection's other
games are still clearly labelled placeholders; statistics and match history are
not built. Save/resume now covers settled live turns.

## Current Pass - Portrait, AI and Riffle Polish (November 2026)

The supplied reference photograph is now the single Anne portrait, and the
remaining defaults and game-feel gaps from the previous pass were closed.

- `anne-avatar.js` mounts `assets/anne/anne-portrait.png` everywhere Anne
  appears: home hero, table seat, trump sheet, tutorial and result. The same
  photograph is used at every mount; mood grading, the speaking ring and voice
  bars animate the photo. The drawn SVG portrait is gone.
- Defaults are **Medium**, **first to 3 points** and **Anne voice off**, in
  `settings.js`, the settings UI, the rules copy, the live HUD and the README.
- Medium uses the stronger public-information policy (card counting, void
  awareness, trump conservation and target pressure); Hard keeps the
  determinised Monte Carlo lead search. Both read only public information.
- The riffle builds all 30 card backs, holds two tight packets with visible
  cut-edge thickness, releases in three waves timed to the recording, then
  squares the pack with the two recorded felt taps. The deck now centers on the
  table: `.center-area > *` had made it `position: relative`, so `left: 50%`
  shifted it right instead of centering it.
- A human victory stages canvas fireworks over the result card; the result
  actions remain above the canvas and clickable. Reduced motion skips them.
- `file://` audio parity: recorded samples play through media elements when
  fetching sibling files is blocked, while HTTP keeps the decoded Web Audio
  path. All 14 sample slots load and play from disk.
- Added `tests/ui-polish.js` for the exact defaults, the identical photograph at
  every mount, riffle card count/centering, 14 localhost recordings, staged
  fireworks, result hit-testing and 1440/390/320/844 layout overflow checks.

## Mobile Compact, Touch and Repo Audit (November 8, 2026)

The final mobile/device pass and the pre-next-game audit are complete.

- **Four target screens now fit, without a page scroll.** The old
  `max-height: 700px` rule forced a 640px board and a 230px centre, so 320×568
  and 844×390 always scrolled. Compact overrides at the end of `theme.css`
  reclaim header chrome and empty felt. All four targets now have
  `documentHeight === viewportHeight`, no horizontal overflow and every player
  card on screen:
  - 320×568: hand 52×73, face-up 44×61, HUD controls 36px.
  - 360×800: hand 64×89, face-up 56×78, HUD controls 38px.
  - 390×844: hand 69×97, face-up 61×85, HUD controls 38px.
  - 844×390: hand 54×75, face-up 45×63, HUD controls 36px.
  The 844 layout uses a two-column rail/card arrangement and a full-width
  speech lane; the long Anne line stays inside the viewport at every size.
  Labels stay at 10.5–13px and the status row clears the trick tray at all four
  sizes.
- **Touch pass.** `tests/mobile-pass.js` (`npm run test:mobile`) drives a coarse
  pointer at all four sizes. The first tap only selects and the card row adds an
  in-place “tap again” cue; the second tap plays. The 320px flow also stubs the
  Vibration API and confirms the gesture creates/resumes the AudioContext. The
  suite checks 36px minimum HUD controls, 10.5px minimum labels, the
  status/trick gap and every card box. This is emulation; real speaker output,
  vibration hardware and iOS Safari still need a physical-device check.
- **Landscape coach.** The short-screen coach was pinned to the viewport and
  covered the player's hand. It now sits in the normal centre stack above the
  rail; at 844×390 its bottom is 291.2px and the player row starts at 294.2px.
- **A real character bug was fixed.** Anne's target bookkeeping could be read
  before her memory was initialised when a restored/directly rendered table was
  already on target. `onTrick()` now initialises memory before reading
  `anneTargetSaid` / `playerTargetSaid`.
- **Repo scan.** There are no unreferenced runtime JS/CSS modules or unused image
  or audio assets. `assets/fonts/*.woff2` are source files embedded as data URIs
  in `fonts.css`; they are intentionally not fetched at runtime. `_archive/` is
  intentional abandoned work and `tests/out/` is 176 MB of generated evidence
  (958 files, git-ignored). `assets/anne.svg` was deleted and has no references.
  The core files that were untracked at the start of this pass, including
  `theme.css`, `table.css`, `overlays.css`, `fonts.css`, `anne-avatar.js`,
  `anne-voice.js`, `fireworks.js`, the test tools and the new `assets/` trees, are
  included in this release commit so the pushed project is self-contained. Full
  details: `APP_AUDIT.md`.

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
- Rules and trick targets are unchanged. The player-approved match target is now configurable at 3, 5 or 7 points, defaults to 3, and the old one-point test shortcut is gone from the production path.
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
  - **Anne**: a drawn vector portrait generated by `anne-avatar.js` from the supplied reference (side-parted dark hair, warm skin, dusty-rose halter, hands on the felt), with her name and difficulty badge at the opposite seat, a compact parchment reaction bubble, tutorial-guide framing, and result-screen dialogue selected from the real match outcome. `character.js` owns the local script and an avatar registry with two reserved slots for future tables. No network dialogue or image service.
  - **Card handling**: the opening stack now shuffles in three controlled passes and settles before the deal. The deal is split into a face-down row followed by a face-up turn, both driven by engine-owned state and presentation beats. Card play, face-down reveal, trick sweep and collection retain persistent DOM identity; restart clears running tweens and pending beats so stale sequences cannot fire into a new match.
  - **Sound and haptics**: `audio.js` synthesises local card, coin, trick, invalid, victory and defeat effects with Web Audio, a master gain, duplicate-event limits and silent failure. `GameHaptics` uses the Vibration API only where present, with a preference, short patterns and duplicate protection. Preferences are persisted by `settings.js`.
  - **Coin and results**: a CSS 3D coin with edge, rim, ornaments, metallic shading and five-plus rotations, landing on the engine's already-chosen result. The result screen shows the actual final score, target, winner and Anne's reaction, with a restrained gold spark burst and one-click rematch. Backdrop clicks cannot dismiss it.
  - **Settings**: target (3/5/7), difficulty, sound, master volume, motion (full/fast/reduced), haptics, tutorial replay, rules and log. A target change applies to the next match and the UI says so; difficulty applies immediately and the copy says so.
  - **AI**: Easy stays deliberately loose. Medium is a public-information heuristic that cashes safe masters, follows cheaply and now ruffles as a rule. Hard is split in two: the *following* half is exact (a ruff cannot be over-ruffed in a two-player trick, so a void hand always ruffs with its cheapest trump; otherwise take the cheapest winner or shed the lowest card), and only the *lead* — the genuinely strategic decision — runs the determinised Monte Carlo over sampled unseen hands. Reading the hand back from the sampler on every follow was where the "hard is like easy" discards came from; the split is both stronger and faster. No difficulty reads hidden cards.
  - **Quality of life**: safe restart confirmation, a result screen that cannot be dismissed by a stray backdrop click, a one-click rematch that deals immediately, mute in the HUD, per-event haptics, and remembered preferences.
  - Added `tests/settings-e2e.js` and extended the real-browser smoke to assert shuffle/deal stages, result visibility and rematch/restart behavior.
- **Host and sound pass (milestone 7, complete)**:
  - **Anne is drawn live**: the seat no longer shows a cropped still portrait. `anne-avatar.js` draws a purpose-made 120×120 head inline and animates the parts that make a character read as a person: idle breathing, a random blink with closed-eye lashes, per-mood brows/eyes/mouth (warm, teasing, impressed, focused, sympathetic, thinking), a three-shape mouth cycle with a head nod while she speaks, and a small body beat when she lands a line. This is the Duolingo approach in miniature — a few viseme shapes driven by timing, plus idle behaviour — with no video, no sprite sheets and no dependency.
  - **Her line sits beside her face**: the bubble used to hang below her whole seat, a long way from the mouth saying it. It is now anchored to the portrait, tail pointing at her cheek, 13 px away, vertically centred on her head, popping in from the left. On a phone it floats over her own name/tricks strip and is gone before the cards.
  - **HUD states the win condition**: the centre chip read “Round 2 / to 5”, which looked like a five-round match. It now reads **First to 5 points**; the deal number lives in the round summary.
  - **Recorded sounds are drop-in**: `assets/audio/manifest.json` names one file per slot and `assets/audio/README.md` lists all 14 sounds with when they fire, target length and mixing notes. A slot without a file keeps the synth, so shipping recordings is additive, never a rewrite. `matchPoint` was wired to the first arrival at one point from the match.
  - Verified: `layout-e2e` is 39/39 at 1440×900, 390×844, 320×568 and 844×390 including two new checks (the face is drawn, the line is beside it; the HUD states points, not rounds); `settings-e2e`, `tutorial-e2e`, `browser-smoke` and `sim/ai-rules` are all clean.
- **Recorded sound and character pass (milestone 8, complete)**:
  - **Thirteen recordings wired in**: `assets/audio/` now holds the supplied mp3s and `manifest.json` mixes each one with a measured gain, start offset and trimmed tail. `matchPoint` has no supplied recording and deliberately keeps the synth. `audio.js` loads the manifest once on the first gesture and falls back per slot, so a missing file can never stall the table.
  - **Riffle, not a fan**: the shuffle is two square packets that lean together (±7.2°), release their cards into one pile and square up with two felt taps; the timeline follows the recording (cascade ≈0.4–1.7 s, taps at 3.1/3.5 s). The pack is smaller and lower on the felt so it no longer covers the opponent's face-up row.
  - **Coin first, riffle every deal**: starting or restarting a match opens the toss; the toss result then triggers the shuffle and the first deal. Every later round riffles again before its deal. Restart cancels the pending shuffle continuation, so an old riffle can never deal into a new match.
  - **Anne's portrait rebuilt**: adult proportions with a defined jaw and cheekbones, soft blurred contour, side-swept dark hair with strand highlights, lash wings, berry lips with a gloss, drop earrings, bare shoulders and a thin gold chain. The seat avatar is larger (56–82 px), still breathing, blinking (sometimes twice), gazing, and talking in syllable-shaped visemes; moods move brows, eyes, mouth and a body beat together.
  - **She remembers the match**: dialogue bags still guarantee no line repeats before every line in that category has been used, and new callback categories fire only on the second (and fourth) ruff or void, e.g. “Twice now. I am starting to take it personally.” Rematch greetings know it is not the first match.
  - Reduced motion now shortens every beat, not just the transforms: `settings-e2e` measures the Calm shuffle directly at 1.2 s. The old total-opening budget was retired because headless startup and the random coin presentation made it flaky, not because the shortening regressed.
  - Verified: `settings-e2e` 0 problems, `tutorial-e2e` 0 problems, `browser-smoke` 0 problems, `layout-e2e` 0 problems, and a dedicated round-flow probe recorded `coin-toss > shuffling > trump-selection > dealing-remaining > playing` on round 1 and a second `shuffling` on round 2, with all 13 recordings decoded.
- **Dialogue, sound and legibility pass (milestone 8 follow-up, complete)**:
  - **A whole Hard match of dialogue, audited**: `probe-dialogue.js` drove two complete Hard matches (seed 11, reduced motion) and recorded 150 lines with the situation that produced each one, then mapped them back to `character.js`. The audit drove the rewrite: bags are three to five lines deep per category, a line cannot return until its bag is empty, contextual lines (target, streak, ruff, void, match point) only fire on the situation that earns them, and the second and fourth occurrence of a repeat event gets its own callback line instead of the first line again.
  - **`matchPoint` has a recording**: the slot had no supplied file, so `tests/render-sound.js` rendered the game's own cue - a rising two-note bell with a soft shimmer over a low body, "almost there" without celebrating - to `assets/audio/matchPoint.wav` (0.5 s, first arrival at one point from the match). The synth stays as the fallback and the manifest entry carries the measured gain, so swapping in a real recording is a one-file change.
  - **Legibility, three passes**: pass 1 raised the poster-sized labels, pass 2 caught the rest and stopped the phone shrinking them again, and pass 3 - after measuring the live table - put a real floor under every label that carries meaning: seat names, the centre chip ("First to 5 points"), the mood chip, the difficulty chip, face-down/trick counts, the lead chip and the suit names are now 11-11.5 px instead of 8-10.5 px, the corner suit mark on a card grew, and the mobile breakpoints keep the same floor instead of stepping back down. `probe-overlap` now reports **0 items under 11 px at 390x844 and at 1440x900** (it was 26 on the phone). The mobile header's centre chip is centred again (4 px off, inside the pill's own padding), and no visible element collides on either viewport.
  - **Two harness bugs fixed**: headless Edge was throttling the page (clamped timers, starved rAF), which stretched every animated beat and made the full-match smoke measure throttling rather than the game - the browser now launches with the anti-throttling flags, and the full-match budget covers a real first-to-five match (5-9 rounds at about a minute per round) instead of the one-round shortcut-era 420 s. A match that still runs out of budget now reports that problem and skips the result/rematch checks instead of crashing on a modal that is not on screen.
  - **New dev instruments**: `probe-hit.js` asks the browser what is really under the cursor for every on-screen control (an invisible overlay can make a control that looks right unclickable), and `probe-timing.js` now reports wall clock per round and every stretch where nothing changed, next to `GameView.pendingCount()`.
  - Verified: a complete first-to-five animated match in real Edge via `browser-smoke.js --full` (415 s, Anne 7-1) with a state-backed result screen, a clean 0-0 rematch, a confirmed restart and **0 problems**; `layout-e2e` 0 problems across 390x844, 320x568 and 844x390 (re-run after the type change, including the tap-box and keyboard-play checks); `tutorial-e2e` and `settings-e2e` 0 problems; `probe-overlap` reports no page overflow at either viewport and no text under 11 px; `probe-hit` finds every on-screen control clickable at 1280x800, 1280x900 and 390x844.
  - Note: the animated `--full` smoke is the long pole of the suite (up to 20 minutes in the worst case, typically 7-9); run it at milestones, not after every edit. `probe-overlap` compares axis-aligned boxes, so a rotated card in the trick tray can report a few pixels of "overlap" that is not visible - confirm those in its screenshot before treating them as real.
- **Trump clarity, optional fireworks and stable speech (November 2026, complete)**:
  - **Trump sheet rebuilt for confidence**: all four suit plaques stay visible over an unblurred table; each shows the actual cards held (high to low), the exact count or an explicit "None in hand", a selected ring and an aria label. Anne, her name and the prompt share the modal's centre.
  - **Fireworks are opt-in**: `fireworks` is a persisted setting that starts off. Result presentation and `TableFireworks.start()` both refuse to run while it is off; the enabled path caps DPR at 1.5 and particles at 260, and stops on close, rematch or restart.
  - **Speech can no longer move cards**: the dialogue bubble lives in a reserved speech lane on desktop, phone and landscape, so long lines wrap without changing card geometry. The voice selector prefers a female English voice with en-IN weighting, speaks one utterance at a time, and drives the portrait ring from real utterance start/end. Browser TTS only; no paid voice service or dependency was added.
  - Verified: `ui-polish` 0 problems (counts 2/2/0/1 with five mini-cards; portrait centre delta 0; backdrop blur `none`; subtitle card delta 0; default fireworks `starts:0, frames:0`; enabled fireworks active with 114 particles); `settings-e2e`, `layout-e2e`, `tutorial-e2e` and `browser-smoke --full` 0 problems across 1440x900, 390x844, 320x568 and 844x390.

### Verification - current pass (November 4, 2026)

- `tests/ui-polish.js`: **all checks pass**, 0 console or page errors. Defaults are `{ difficulty: 'medium', matchTarget: 3, voice: false, fireworks: false }`; all four photo mounts use the same loaded asset; the trump sheet reports counts 2/2/0/1 with five visible mini-cards, no backdrop blur and a centered portrait; subtitles hold the card position (delta 0); the riffle has 30 cards, 125px spread and a deck center at 720.5px on a 1440px viewport; all 14 recorded slots load; fireworks do no work when off and use a bounded canvas when on; the result button hit-tests above it.
- `tests/anim-check.js`: **all checks pass** in real headless Edge at 1280x800. The pack is fully visible from 65ms, all 30 card backs animate, the pack is 122px wide, and both the coin and shuffle create sound sources.
- `tests/motion-check.js`: **all Full, Fast and Calm checks pass**. Calm still completes its coin flip in 22 distinct frames and its shuffle in 1.13 s; every mode schedules audio.
- `tests/layout-e2e.js`, `settings-e2e.js`, `tutorial-e2e.js`, `file-url.js` and `match-target.js`: **0 problems** after the final CSS and defaults changes.
- `browser-smoke.js --full`: a complete first-to-3 animated match finished in 44 s (Anne 0-4), showed the state-backed result, started a clean 0-0 rematch, accepted the restart confirmation, produced no stuck cards and reported **0 problems**.
- Earlier AI gate in this pass: 40 first-to-3 matches against the same seeded sensible baseline gave Easy 29 player wins, Medium 17, Hard 15 (Anne 23 and 25). Hard remains the strongest; no hidden cards are read.
- The deck-centering root cause was fixed in `table.css` (`.center-area > .deck { position: absolute; }`) rather than with an inline override. The final working tree is intentionally uncommitted.

### Verification - previous passes

#### Final polish pass (previous pass)

- The 44 checked runtime files are byte-identical between disk and localhost, and both entry pages load. The only runtime differences are the separate local-storage origin and the skipped audio-manifest fetch on `file://` (the synth fallback still works).
- `browser-smoke.js --full`: a complete first-to-five match finished in 229 s over 4 rounds (Anne 2-6), showed the state-backed result, started a clean 0-0 rematch, restarted to setup, and produced **0 problems**.
- `motion-check.js` (`npm run test:motion`): **all checks pass**. Full, Fast and Calm all animate with the OS set to reduce motion; Calm's shuffle measured 1.14 s. The settings harness measured 1.2 s for the same beat.
- `settings-e2e.js`: **all checks pass**, including malformed-storage fallback, persistence, the shortened Calm shuffle, live-target deferral, missing haptics and missing Web Audio.
- `file-url.js`: pass; both pages load from disk with fonts, portrait and start flow intact.
- Settled screenshots at 1440×900, 390×844, 320×568 and 844×390 were inspected: no horizontal overflow, no seat/trick overlap, no clipped player cards. A later compact pass removed the old short-screen scrolling; see the November 6 pass below.
- Known limitation at the time: mobile landscape still needed a real-device/touch pass. The working tree is intentionally uncommitted.

- `node --check` on `coach.js`, `tutorial.js`, `presentation.js`, `ui.js`, `script.js` and the test scripts: pass.
- Engine trace baseline was **12/12 identical** before this milestone. It is now a historical reference: match-target and Medium/Hard AI changes are intentional engine differences. Use `match-target.js`, `sim/ai-rules.js` and `sim/ai-match.js` as the current gates.
- `tests/tutorial-e2e.js` (headless Edge, reduced motion): **0 problems** after the rematch change. Covers launcher tile counts/keyboard Enter, first-run invite/Not now/localStorage persistence, wrong trump/target/follow feedback, Escape/Tab focus, recap start, live trump recommendation on the actual hand, choosing a different suit, first live follow-suit coach and completion retirement, the computer-wins-toss path, coach fit at three sizes, both result screens, one-click rematch, settings persistence and sanitisation.
- Restart group (24 scenarios, animated view): 24/24 pass idle-state assertions, 0 console/error/guard flags. The 24 full-trace diffs are expected: the recorded restart baseline predates the presentation refactor (see tests/README.md). Re-confirmed after the live-coach changes.
- Real Edge (`browser-smoke.js`): start, three real tricks, invalid-play state, and restart; 0 console/page errors. Presentation stages confirmed the shuffle beat and a five-card face-down row with zero face-up cards before the turn.
- Real Edge (`browser-smoke.js --full`, full motion): a complete first-to-five match reached a state-backed result screen, the result survived a backdrop click, "Play another match" started a clean 0-0 rematch and the next restart asked for confirmation. The final run finished in 229 s over 4 rounds (Anne 2-6), with no stuck/leaked cards, no console/page errors and no failed game requests. The human-victory spark path was exercised separately at 390×844: 36 spark nodes.
- `settings-e2e.js` (real headless Edge): all checks pass. Malformed storage falls back safely, all preference controls and volume persist across reload, the HUD mute restores sound, every effect can be invoked without throwing, target changes defer to the next match, the Calm shuffle measures 1.2 s directly, and the haptics switch disables itself with an explanation when the API is missing. A page with Web Audio removed still deals and reaches the coin toss without throwing.
- `layout-e2e.js` (real headless Edge): **37/37 checks** at 1440×900, 390×844, 320×568 and 844×390. The collection host line, setup, live table, settings and result screens all fit without horizontal overflow or clipped player cards; result actions remain reachable by scrolling; Anne's portrait loads at every size, her trick-target reaction fires on the live table, and a real card accepts Arrow-key focus plus Enter.
- Direct-from-disk (`browser-smoke.js --file`): pass with 0 problems. The manifest is now added only over HTTP(S), so `file://` no longer emits a CORS error while the game still deals and plays.
- `match-target.js`: 10/10 checks. Default 3, alternate 5 and 7, live-match deferral, restart application, computer victory and invalid-target rejection.
- `sim/ai-rules.js` (6 rounds per difficulty in the final pass): 90 selections each, 0 illegal for Easy, Medium and Hard. An earlier 8-round pass was also clean.
- `sim/ai-match.js` (200 first-to-five matches per difficulty, after the ruff-rule rewrite): Easy 179 player wins, Medium 74, Hard 33 — Anne 167 of 200 on Hard. Same seeded sensible baseline for every cell.
- `sim/ai-ruff.js` (invariant): 25 rounds per difficulty, 375 decisions each. Medium and Hard record **0 discards** when void in the led side suit while holding a trump; Easy still blunders by design, and the engine-level `enforceRuffRule` guard corrects it before the card lands. Before the guard the same check reported discards on the reported Hard game.
- `sim/ai-match.js` after the stronger Hard sampler (56 deals, void tracking inside playouts, shortest-suit discards): 18 first-to-five matches per difficulty against the same seeded baseline — Easy 12 player wins, Medium 5, **Hard 1** (Anne 6.00 points per match). Hard is again a clear step above Medium, not a relabelled Easy.
- `tests/anim-check.js` (new, real headless Edge at 1280×800 and 390×844): the pack is at full opacity from ~65 ms of the shuffle (243 px wide on desktop, 136 px on a phone), 11+ distinct card transforms, the coin produces 20+ distinct transforms through the flip, and real Web Audio nodes are created for both the shuffle and the coin. Fails if any of that disappears.
- `tests/motion-check.js` (real headless Edge, OS set to reduce motion): Full and Fast still animate, Calm still shows a 1.1–1.2 s shuffle and coin movement, and every mode schedules audio; **all checks pass**.
- Keyboard pass: focused card exposes `role=button`, `tabindex=0`, an `aria-label` and `:focus-visible`; Enter plays it, ArrowRight/Left moves focus between cards. Reduced-motion pass: two live tricks complete with zero `flying` cards or console errors.
- Earlier UI matrix (1440×900, 1024×768, 1024×600, 768×1024, 390×844, 360×640, 320×568, 844×390) remains the reference for the pre-character layout; the current four-size matrix above is the current evidence.
- Forced end-of-round state through the real `endRound()` path: result card updates, status is muted, `.is-round-end` centres the felt, New Round appears, and starting the next round clears the result and restores the table.
- Limitation: settled screenshots at all four sizes were inspected in this pass, but mobile landscape (844×390) remains browser-checked, not real-device/touch-checked. The table scrolls vertically there by design.
- Launcher matrix (headless Edge): 1440×900, 1024×768, 768×1024, 390×844, 320×568 - 3/2/1 responsive columns as intended, no horizontal overflow, no clipped tile copy; live tile navigates to `games/7-8/index.html`.
- Tutorial (headless Edge): wrong trump/target/follow answers are rejected with explanations; correct answers advance; recap starts the normal game at `coin-toss`, and the first real trick can be played; `78-tutorial-seen-v1` persists across reload; Escape closes and returns focus; Tab stays inside the dialog; no overflow at 390×844, 320×568 or 844×390 (step 3 is the tallest state).
- Game setup with the first-run invitation fits 1440×900, 390×844, 320×568 and 844×390 landscape without pushing the panel outside the felt.

### Measured AI results (tests/sim/ai-match.js, real engine, 200 matches per difficulty)

The baseline is the same seeded `sensible` heuristic for every cell; all matches are first to 5 points.

| AI | Player wins | Anne wins | Avg player points | Avg Anne points | Avg rounds |
|---|---|---|---|---|---|
| Easy | 179 | 21 | 5.59 | 1.56 | 3.55 |
| Medium | 74 | 126 | 3.02 | 4.38 | 4.95 |
| Hard | 33 | 167 | 1.92 | 5.31 | 3.80 |

- The ladder is monotonic and steep on this sample: the baseline player wins 89.5% against Easy, 37% against Medium and 16.5% against Hard.
- Round-level ladder (tests/sim/engine-sim.js, 140 rounds per cell): Hard takes 8.5 tricks per round and +0.96 points against the sensible baseline, Medium 7.9 and +0.37, Easy 6.4 and -1.06.
- An earlier 40-match sample had Medium at 5 wins and Easy at 7; that noise prompted the Medium rewrite. The 60-match sample is evidence, not a proof, and the margin around small differences is wide.
- Hard uses sampled unseen hands and owns only public information (own cards, visible face-up cards, played cards). `ai-rules.js` wraps every choice against the engine's legal list.
- Older round-level engine-sim findings (trump choice matters, 7/8 role balance near 42/35/23, 20% of turns have one legal card) still describe the rules and are not invalidated by the AI change.
- Match to 5 points: median 4 rounds in the older 2000-round sample (p10 2, p90 7).

### Not done yet / known gaps

- The in-app preview webview did not composite frames during this session, so visual checks rely on headless Edge screenshots and DOM geometry rather than a live human look. Mobile landscape still needs a real-device pass.
- Anne is the supplied reference photograph, mounted from the single asset `assets/anne/anne-portrait.png` on every screen. Breath, mood grading, the speaking ring and voice bars animate the photo; it is not a phoneme-level lip-sync rig.
- All fourteen sound slots have a file. Thirteen are recordings; `matchPoint` is rendered from the game's own synth by `tests/render-sound.js` (a rising two-note bell, gain 3.5 so it matches the other event cues) until a recording replaces it. The synth remains the fallback for any slot whose file is missing or fails to decode.
- Haptics were verified through the API path and a simulated missing-API fallback in headless Edge; they have not been felt on real mobile hardware.
- Save/resume is implemented for the opening trump choice, a settled live turn, a one-card trick and the between-rounds gap; it clears on a new match or game over. Statistics/history, achievements, and additional tables are not implemented. 3–2–5 and Coat & Shuffle remain status-only tiles; the character registry has two empty avatar slots for them.
- The rules modal remains the long reference; the tutorial and first-round coach cover the opening decisions, not every scoring edge case.
- The setup hero cards and sample tutorial cards are decorative/sample only; the live coach reads the real hand and trick but never changes them.

### Current state and next work

The current release includes the portrait, AI, fireworks, file-audio and
riffle-polish work, plus automatic save/resume and the 320px HUD pass. It is
verified by the checks above. A refreshed tab restores a settled turn, trick,
trump choice or between-rounds result; New deliberately clears it.

The game now defaults to Medium, first to 3 points, Anne's voice off and fireworks
off. The supplied photograph is mounted consistently everywhere, and the
Medium/Hard policies use only public information. The trump sheet shows the
actual held cards; subtitles use a fixed lane; the voice is browser TTS with a
female English/en-IN preference and utterance-synchronised portrait ring. The
riffle is centered and timed to the recording; `file://` has recorded-audio
parity; victory fireworks are opt-in.

**Next product step:** a real-device mobile pass (touch selection, vibration,
audio unlock, iOS Safari, landscape) and a human visual review of the result and
settings screens; browser emulation verifies fit and input, not speaker or
vibration hardware. A phoneme-level mouth or second pose would add more than
another CSS pass. Match history is the next product feature.
Do not start 3-2-5 or Coat & Shuffle until their rules and hosts are approved.

## Visual Symmetry and Trump Clarity (November 9, 2026)

- The round's trump now lives beside the trick caption instead of the crowded
  HUD, so it remains visible on phones and short landscape screens. On 320px
  screens it floats in the clear felt beside the trick rather than covering
  Anne's bottom card edge.
- The playing felt sits above both seat card rows, so a settled trick cannot be
  hidden under Anne's face-up cards. The felt itself stays click-through.
- The trump sheet mounts the full bust photograph instead of the face crop. It
  uses a centred 3:4 portrait on desktop and most phones, and a horizontal row
  on short 320px screens so the suit choices still fit.
- Desktop seats use equal card sizes and packet gaps; the player-only divider
  is hidden at that width. The HUD compact `New` label now applies to every
  phone width, and the HUD controls share a consistent height.
- Verified with `tests/layout-e2e.js`, `tests/mobile-pass.js`,
  `tests/resume-e2e.js` and `tests/tutorial-e2e.js`, including 1440×900 live
  layout, trump visibility at 320/360/390/844, trump/card clearance, the full
  modal portrait and the trick-over-seat layer. Physical iOS/Android and real
  iOS Safari remain browser-emulated rather than hardware-tested.

## Avatar, Restart and Home Scroll Repair (November 9, 2026)

- Every Anne mount now uses the same full square crop of the single 900×900
  source. Legacy face-crop markup is normalised, desktop and phone hosts use a
  square frame, and the photograph is never zoomed or positioned differently by
  screen. This covers the home page, seat, trump sheet, tutorial and result.
- Starting a new match now clears the previous deck, both hands, face-up and
  face-down packets, won tricks and the current trick in the engine as well as
  the table DOM. The coin toss and riffle can no longer repaint the old deal.
- The collection page opts into normal document flow so mobile screens keep a
  working vertical scrollbar and can reach the footer; the game table remains a
  fixed one-screen shell.
- Verified with `tests/layout-e2e.js` (1440×900, 390×844, 320×568, footer
  scroll), `tests/mobile-pass.js` (320/360/390/844 touch layouts and card
  play), `tests/ui-polish.js` (shared square avatar frame), `tests/resume-e2e.js`
  (empty-table restart, toss, resume and trump portrait) and
  `tests/tutorial-e2e.js` (full coached round). Physical iOS/Android and real
  iOS Safari remain browser-emulated rather than hardware-tested.

## Definition of Done

The project is done when the game is visually polished, responsive, strategically enjoyable, reliable across complete games and restarts, accessible for common interactions, and free of known critical defects. Optional experimental features are not required for completion.