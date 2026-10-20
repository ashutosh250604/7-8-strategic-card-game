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

- Three difficulty levels (Easy, Medium, Hard)
- Coin toss for first round
- Optional interactive tutorial: trump choice, the 8-vs-7 target, and follow-suit
- Live first-round coaching after the tour: a recommendation from your real hand, then your first real follow-suit decision
- **Rules** in the game HUD (Settings on phones) and a **Deal the cards** start (no lobby, no account)
- Game log to track moves
- Works on mobile too

## Collection roadmap

- **7–8** — ready to play
- **3–2–5** — in development (three players, same 30-card deck)
- **Coat & Shuffle** — in development (four players, 52 cards, partners)
- **Kachuful** — planned
- **Seep** — planned

The homepage lists these with honest status labels; no unfinished game is
presented as playable.

## Rules (Quick Version)

- 30 card deck (7♥, 7♠, and 8-A of all suits)
- Trump selector needs 8 tricks, opponent needs 7
- Must follow suit if you can
- Trump beats everything
- First to 5 points wins

## Tech

Just vanilla HTML, CSS, and JavaScript. GSAP is vendored locally for the game's
card motion; the launcher uses CSS only. No build step and no runtime CDN.

## Play Online

[Play here](https://ashutosh250604.github.io/7-8-A-Strategic-Card-Game/)

---

Made by [Ashutosh Rajput](https://github.com/ashutosh250604)
