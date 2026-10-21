# The Indian Card Table

A small collection of classic Indian card games, starting with **7–8**.

Open `index.html` for the collection homepage, or go straight to
`games/7-8/index.html` to play. The game page still works when opened directly
from disk; the launcher is a normal static page with no build step.

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

- Anne, a resident card-table host with a custom local portrait, contextual reactions and match-result lines
- First to 5 match points by default, with 3 and 7 also selectable; changes apply to the next match
- Three genuinely different difficulty levels (Easy, Medium, Hard). Hard samples the unseen hands with Monte Carlo and never reads hidden cards
- A deliberate opening shuffle, face-down deal, face-up turn and trick sweep, all coordinated through the presentation beats
- Local Web Audio card, coin and result sounds with a master volume, mute control and persisted preferences
- 3D coin toss with heads and tails faces, plus reduced-motion handling
- Optional haptics on browsers that support vibration, with a setting and a clear unsupported state
- Victory and defeat screens with the final score, Anne's reaction, a restrained spark burst and a one-click rematch
- Optional interactive tutorial: trump choice, the 8-vs-7 target, and follow-suit
- Live first-round coaching after the tour: a recommendation from your real hand, then your first real follow-suit decision
- **Rules** in the game HUD (Settings on phones) and a **Deal the cards** start (no lobby, no account)
- Game log to track moves, safe restart confirmation, keyboard play and reduced motion
- Works on mobile too

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
- Points are tricks won above your target; the first player to the match target wins (5 by default, 3 or 7 optional)

## Tech

Just vanilla HTML, CSS, and JavaScript. GSAP is vendored locally for the game's
card motion; sound is synthesised with Web Audio, so there are no audio files or
runtime CDNs. The launcher uses CSS only. No build step.

## Play Online

[Play here](https://ashutosh250604.github.io/7-8-A-Strategic-Card-Game/)

---

Made by [Ashutosh Rajput](https://github.com/ashutosh250604)
