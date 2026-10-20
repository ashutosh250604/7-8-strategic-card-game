# Project Instructions — 7–8 Strategic Card Game

## Mission

Build a premium, professional, highly replayable browser game based on the Indian 7–8 trick-taking card game. Optimize for exceptional gameplay, intelligent AI, beautiful design, usability, reliability, and performance—not merely minimal code changes.

## Working Principles

- Inspect existing code before modifying it.
- Read `PROJECT_PLAN.md` for the current priorities and approved scope.
- Work on one coherent milestone at a time. Finish, test, summarize, and stop before starting unrelated work.
- Do not repeatedly analyze the entire repository when the relevant files and architecture are already known.
- Avoid unnecessary rewrites, speculative abstractions, excessive documentation, and duplicate implementations.
- Do not use subagents unless explicitly requested.
- Prefer focused changes and concise reports. Do not produce long planning essays unless requested.
- Do not claim tests passed unless they were actually run.

## Game Integrity

- Preserve the identity and fundamental rules of 7–8.
- The existing `>= 1` scoring conditions are intentional testing settings. Never change them to `>= 5` without explicit permission.
- Never change fundamental rules, scoring, or core game behavior without first explaining the proposed change and obtaining approval.
- AI improvements are encouraged when they respect the approved rules.
- Preserve existing behavior unless a change is intentional, justified, and tested.
- Keep the game playable by opening `games/7-8/index.html` directly (no build step). The root `index.html` is the collection launcher.
- The collection homepage must never present a planned game as playable; mark status honestly.

## Architecture

The current architecture separates:
- `script.js`: GameEngine, state, rules, AI, and gameplay flow.
- `presentation.js`: GameView, DOM rendering, animation beats, and visual effects.
- `ui.js`: UI wiring, buttons, settings, and modals.
- `tutorial.js`: the opt-in, sample-card tutorial. UI-only; it never changes `gameState` or the rules. Finishing the tour arms the live coach for the next real game.
- `coach.js`: the first-round live coach. UI-only and read-only: it reads the real hand/trick to recommend a trump and explain the first follow-suit turn, then retires. It never chooses a card or changes the deal, scoring, or rules.
- `games/7-8/index.html`: the game page. Shared game scripts/styles live at the project root; the root `index.html` is the launcher.
- `home.css` / `index.html`: the collection homepage.

Treat this as the established architecture. Inspect the current implementation before relying on these descriptions; update this file if the architecture changes.

- Keep gameplay rules independent of visual animation details.
- Use the existing presentation beat/Promise mechanism for animation sequencing. `GameView.render()` emits `gameview:render`; UI-only listeners may read settled state after that event.
- Keep coaching read-only. It may label a card or suit, but it must never play, choose, or alter game state.
- Cancel stale asynchronous work when a game restarts.
- Preserve card identity and state consistency across renders.
- Avoid introducing frameworks, build systems, or large dependencies without a compelling reason.

## Quality Requirements

- Deliver polished, coherent, production-quality UI rather than generic templates.
- Use a sophisticated visual identity: deep emerald tabletop, dark walnut, warm gold, premium ivory cards, deliberate typography, realistic depth, and restrained lighting.
- Avoid excessive gradients, neon, generic glassmorphism, visual clutter, and unnecessary effects.
- Treat mobile and desktop as first-class experiences.
- Include keyboard accessibility, visible focus, accessible labels, and reduced-motion support where appropriate.
- Keep animations smooth and avoid expensive continuous rendering.
- Make the AI meaningfully challenging, understandable, and fair.
- Prefer features that improve actual play and replayability over feature count.

## Dependencies and Safety

- Prefer locally vendored dependencies when practical, especially to preserve offline/local-file operation.
- Do not introduce external services, API keys, paid services, or copyrighted assets without approval.
- Never overwrite or discard unrelated user work.
- Do not delete archived work or test assets without checking their purpose.
- Do not commit, push, or publish changes unless explicitly asked.

## Testing

- Run relevant existing tests after each meaningful change.
- Preserve the established gameplay trace baseline and use it to detect unintended behavior changes.
- Keep intentional changes distinguishable from regressions.
- Test browser behavior, restart, complete rounds, invalid plays, responsive layouts, and console errors as relevant.
- Keep the launcher/tutorial/live-coach browser coverage in `tests/tutorial-e2e.js` (`npm run test:e2e`); it fails on console errors and checks first-run state, keyboard flow and the first live round.
- Do not spend time repeatedly running expensive or redundant tests when a focused test is sufficient; run comprehensive verification at major milestones.

## Completion Protocol

At the end of each milestone:
1. Summarize the important changes briefly.
2. List tests actually run and their results.
3. Disclose known issues and unfinished work.
4. Update `PROJECT_PLAN.md` with completed work and the next milestone.
5. Stop and wait for the next instruction.

The goal is a finished, reliable, premium game—not an endless refactor. Make thoughtful decisions autonomously within these boundaries.