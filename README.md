# The Indian Card Table

A small collection of classic Indian card games, starting with **7–8**.

Open `index.html` for the collection homepage, or go straight to
`games/7-8/index.html` to play. Both pages work when opened directly from disk:
the fonts are embedded in `fonts.css`, so the table looks the same from
a folder and from a local server. There is no build step and no stale deploy
copy in the project.

## What is 7-8?

It's a two-player card game where one player needs to win 7 tricks and the other needs 8. The player who chooses the trump suit has the harder target (8 tricks).

## How to Play

1. Open `index.html` and choose **7–8**, or open `games/7-8/index.html`
2. Click **Deal the cards**
3. Win the coin toss to choose trump first
4. Pick your trump suit based on your hand
5. Play your cards and try to win tricks!

Rules stay directly reachable in the game HUD (and in Settings on small
screens), the way a card table should work: pick a table, deal, and start
playing without a lobby or an account.

## Features

- Anne, a resident card-table host: one living portrait from the supplied reference, used on every screen, with a slow breath, mood grading, a speaking ring and optional spoken lines (browser speech synthesis; female English with Indian English preferred, plus per-mood delivery), and contextual reactions and match-result lines
- First to 3 match points by default, with 5 and 7 also selectable; changes apply to the next match
- Three genuinely different difficulty levels (Easy, Medium, Hard). Hard samples the unseen hands with Monte Carlo and never reads hidden cards
- A deliberate opening shuffle, face-down deal, face-up turn and trick sweep, all coordinated through the presentation beats
- 14 local sound slots (13 effects plus the match-point cue) with synthesised fallbacks, recorded files over both localhost and `file://`, master volume, mute and persisted preferences
- 3D coin toss with heads and tails faces, plus an in-app Calm motion setting that shortens every beat
- Optional haptics on browsers that support vibration, with a setting and a clear unsupported state
- Automatic local save/resume: refreshing or closing the tab reopens the same settled deal, trick and score; a new match deliberately clears it
- Victory and defeat screens with the final score, Anne's reaction, optional canvas fireworks on a win (off by default; enable in Settings) and a one-click rematch
- Optional interactive tutorial: trump choice, the 8-vs-7 target, and follow-suit
- Live first-round coaching after the tour: a recommendation from your real hand, then your first real follow-suit decision
- **Rules** in the game HUD (Settings on phones) and a **Deal the cards** start (no lobby, no account)
- Game log to track moves, safe restart confirmation, keyboard play and an in-app Calm mode
- Works on mobile: the whole table fits 320×568, 360×800, 390×844 and 844×390 without page scrolling. Cards are 52–69px wide, HUD controls are 36–38px, labels stay at 10.5px or larger, and a first tap raises a card with an in-place “tap again” cue

## Collection roadmap

- **7–8** - ready to play
- **3–2–5** - in development (three players, same 30-card deck)
- **Coat & Shuffle** - in development (four players, 52 cards, partners)
- **Kachuful** - planned
- **Seep** - planned

The homepage lists these with honest status labels; no unfinished game is
presented as playable.

## Rules (Quick Version)

- 30 card deck (7♥, 7♠, and 8-A of all suits)
- Trump selector needs 8 tricks, opponent needs 7
- Must follow suit if you can
- Trump beats everything
- Points are tricks won above your target; the first player to the match target wins (3 by default, 5 or 7 optional)

## Tech

Just vanilla HTML, CSS, and JavaScript. GSAP is vendored locally for the game's
card motion. Sound is Web Audio over HTTP and a media-element path over `file://`: every
slot has a synth fallback and a recorded file in `assets/audio/`. Fonts are self-hosted and
embedded as data URIs in `fonts.css` so `file://` works. The launcher uses CSS
only. No build step and no runtime CDNs.

## Play Online

[Play here](https://site-ce1b006d23c6499196f6bc7cc15d028c.freebuff.page/)

---

Made by [Ashutosh Rajput](https://github.com/ashutosh250604)
