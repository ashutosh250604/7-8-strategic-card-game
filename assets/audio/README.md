# Sound for Seven · Eight

The game makes **14 sounds** (and 9 haptic patterns). All fourteen have a file in
this folder, wired through `manifest.json`. Thirteen are your
recordings; the fourteenth, `matchPoint`, was rendered from the game's own
synthesised cue with `node tests/render-sound.js matchPoint`, so it sits in the
same family as the rest until a recording replaces it. A slot without a file (or
one whose file fails to decode) quietly falls back to the synth, so the game
never breaks over sound.

The supplied files are `shuffle`, `deal`, `flip`, `place`, `select`, `invalid`,
`trickWin`, `trickLose`, `trump`, `coin`, `coinLand`, `matchPoint`, `victory`
and `defeat`.
Each manifest entry carries the mix details measured from the recording:
`gain` lifts a quiet file, `offset` skips dead air before the transient, and
`maxSeconds` trims a long tail with a short fade.

## The 14 slots

| # | Slot / filename | When it fires | Target length | Notes |
|---|-----------------|---------------|---------------|-------|
| 1 | `shuffle` | Shuffling the deck before each deal | 2.0 s | Real riffle: several papery snaps, then the pack squared on the felt. Must fill ~2 s of visible shuffling. |
| 2 | `deal` | Each card leaving the deck into a hand | 0.12 s | Plays in a rapid run (15 times per deal). Dry and unpitched so the run does not turn into a drone. |
| 3 | `flip` | A card turning face-up | 0.1 s | Tiny snap of card stock, quieter than `deal`. |
| 4 | `place` | A card landing on the trick tray | 0.12 s | The most repeated sound in the game (30 per deal). Card on felt with a soft low body. |
| 5 | `select` | Tapping a card, a suit, a control | 0.06 s | Soft wooden tick, not a digital click. |
| 6 | `invalid` | Playing a card the rules forbid | 0.2 s | Gentle two-note nudge down. Never a buzzer. |
| 7 | `trickWin` | You win a trick | 0.5 s | Warm rising two-note chime. Heard up to 15 times a deal, so small and clean. |
| 8 | `trickLose` | Anne wins a trick | 0.5 s | Same family as `trickWin`, settling downward. Quiet. |
| 9 | `trump` | The trump suit is announced | 0.3 s | A short bright flourish. |
| 10 | `coin` | The coin spins in the air (~1.25 s) | 1.3 s | Metallic ring + air whoosh, long enough to cover the whole flight. |
| 11 | `coinLand` | The coin lands, result shown | 0.4 s | One bounce on the table, brighter than a card. |
| 12 | `matchPoint` | Either side is one point from the match | 0.5 s | A rising two-note bell with a shimmer: "almost there". Currently generated from the synth (`tests/render-sound.js`), gain 3.5 so it matches the other event cues. |
| 13 | `victory` | You win the match | 1.2 s | Short warm fanfare. Parlour, not stadium. |
| 14 | `defeat` | Anne wins the match | 0.36 s | Graceful three-note descent. Sympathetic, never mocking. The supplied recording is 0.36 s and is played whole; a longer 1.0 s take would give the last note more room to ring. |

## Haptics (9 patterns, no files needed)

`select`, `play`, `flip`, `coin`, `trickWin`, `trickLose`, `victory`, `defeat`,
`invalid` — short vibration patterns, used only on devices that support the
Vibration API and only when "Haptics" is on in Settings.

## File spec

- **Format:** mp3 or wav, mono or stereo, 44.1 kHz. (`matchPoint` currently
  ships as a 16-bit wav; any slot may use either format.)
- **Loudness:** around -16 LUFS integrated, peaks below -1 dBFS. The game
  applies your in-game volume and a limiter, not a second normalisation.
  `node tests/render-sound.js --levels` prints peak, RMS and the in-game gain of
  every slot, which is the quickest way to check whether a new file sits in the
  same band as the rest (the event cues land around 0.06 mixed RMS).
- **No trailing silence.** `trickWin`, `trickLose`, `deal`, `place`, `flip` and
  `select` overlap each other constantly; leading or trailing air makes the
  table sound muddy.
- **Names:** use the slot name exactly (`shuffle.mp3`, `place.mp3`, ...). One
  file per slot.

## Wiring a file in

```json
"shuffle": { "file": "shuffle.mp3", "when": "...", "seconds": 2.0, "style": "..." }
```

Then reload. `audio.js` reads `manifest.json` once per session on the first
user gesture, decodes every file with a `file`, and uses it from then on.
Existing files are cached by the browser; bump the filename (e.g.
`shuffle-v2.mp3`) when you replace one.
