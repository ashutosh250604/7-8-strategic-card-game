# App Audit - 7–8

November 8, 2026

Scope: runtime files, styles, assets, tests and repository integrity, followed by a
browser pass on the real table at desktop, portrait and landscape sizes. No physical
handset was available; the mobile evidence is Chromium touch emulation.

## Verdict

The app is complete enough to play offline from a folder or over HTTP, with no build
step. No unreferenced runtime JavaScript or CSS module and no unused runtime image or
audio asset was found. The release commit tracks the previously untracked core styles,
scripts, assets and test tools, so the pushed project is self-contained.

## Runtime and assets

- `script.js`, `presentation.js`, `ui.js`, `settings.js`, `audio.js`, `character.js`,
  `anne-avatar.js`, `anne-voice.js`, `fireworks.js`, `tutorial.js` and `coach.js` are
  all loaded by the game or launcher and have a live role.
- `style.css`, `table.css`, `overlays.css` and `theme.css` are all linked by the game;
  `theme.css` is intentionally last so the compact and readability rules win.
- Anne's portrait variants, the audio slots, favicons and web manifests are referenced
  by the runtime or their local manifests. `assets/fonts/*.woff2` are source files
  embedded as data URIs in `fonts.css`; they are not fetched at runtime.
- `assets/anne.svg` was deleted and has no remaining references. `_archive/` is
  intentional abandoned work, not a runtime dependency.
- The game remains dependency-light: only the vendored GSAP is used for card motion.
  No remote runtime CDN, framework or service is required.

## Mobile and interaction

The table was designed for one screen, not a shrunk desktop layout:

| Viewport | Hand | Face-up | HUD controls |
|---|---:|---:|---:|
| 320×568 | 52×73 | 44×61 | 36px |
| 360×800 | 64×89 | 56×78 | 38px |
| 390×844 | 69×97 | 61×85 | 38px |
| 844×390 | 54×75 | 45×63 | 36px |

All four have `documentHeight === viewportHeight`, no horizontal overflow, every player
card on screen and no in-game page scroll. Visible labels are at least 10.5px; the
turn status clears the trick tray. On touch, the first tap only selects a card and the
row changes its label to “tap again”, so the second tap is discoverable. The short
landscape coach now sits in normal centre flow instead of covering the hand.

Pinch zoom remains available for accessibility; the table no longer requires it to
read the score, labels or cards.

## Motion, depth and performance

This is a 2D card table with CSS-perspective depth, so adding Three.js or WebGL would
add download and GPU cost without improving play. The existing depth is the CSS coin
and card flip. Motion stays on transform and opacity, runs in short beats, and is
shortened by Calm/reduced-motion settings. There are no continuous blur animations or
scroll-driven loops; the fireworks canvas is opt-in, capped and stops when the result
closes.

## Test and generated-file inventory

- Browser suites cover the animated full match and rematch, tutorial/coach, settings,
  responsive layout, touch behavior, audio unlock, haptics call path, visual polish,
  AI rules and direct `file://` loading. The probe scripts are dev-only diagnostics and
  are documented in `tests/README.md`; they are not loaded by the game.
- `tests/out/` is generated evidence: 176 MB across 958 files at the time of this
  audit, git-ignored and not part of the release. The trace baseline is also generated
  and git-ignored.
- The previously untracked runtime and test files are included in this release commit.
  Core app files, assets and test entry points must stay tracked from here on.

## Remaining honest limits

- Physical speaker output, vibration hardware and iOS Safari behavior were not tested
  on a real phone; browser emulation cannot prove those.
- The game still has no save/resume, statistics or match history, and the other
  collection tiles remain clearly labelled placeholders.
- The 320×568 layout is deliberately dense; it is verified to fit, not to feel as
  spacious as a 390×844 phone.
