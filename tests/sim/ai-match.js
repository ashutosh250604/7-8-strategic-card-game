'use strict';
/*
 * Match-level AI evaluation. Runs the real engine, the same seeded sensible
 * human stand-in for every difficulty, and first-to-five matches.
 *
 *   node sim/ai-match.js [matches=30] [roundsPerMatchGuard=60]
 *
 * This is evidence, not a promise: a 30-match sample has a wide margin. Run a
 * larger sample before treating a small difference as real.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'script.js'), 'utf8');
const VAL = { '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const val = (card) => VAL[card.split('_')[0]];
const suit = (card) => card.split('_')[1];
const settle = () => new Promise((r) => setImmediate(r));

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createEngine(rng) {
    const box = { console, __rng: rng, __h: { trump: null, games: [], beats: [] } };
    const ctx = vm.createContext(box);
    vm.runInContext(`
      const GameView = { beat: (name) => { __h.beats.push(name); return Promise.resolve(); }, log(){}, clearLog(){}, status(){}, thinking(){}, render(){},
        highlightTrickWinner(){}, setStartButton(){}, setNewRoundButton(){}, hideSelectTrumpButton(){},
        setSelectTrumpButton(){}, showTrumpSelection(cb){ __h.trump = cb; }, showCoinToss(){}, coinTossBegin(){},
        coinTossReveal(){}, hideCoinToss(){}, showGameOver(winner, scores){ __h.games.push({ winner, ...scores }); }, resetForRestart(){} };
      Math.random = () => __rng();
    `, ctx);
    vm.runInContext(SRC, ctx);
    return {
        gs: vm.runInContext('gameState', ctx),
        E: vm.runInContext('GameEngine', ctx),
        h: box.__h,
        startNewRound: vm.runInContext('startNewRound', ctx)
    };
}

const lowest = (a) => a.reduce((x, y) => val(y.card) < val(x.card) ? y : x);

function legalCards(eng) {
    const { gs, E } = eng;
    const out = [];
    ['hand', 'faceUp'].forEach((source) => {
        gs.player[source].forEach((card, index) => {
            if (card && E.isValidPlay(card, gs.trick.leadSuit)) out.push({ card, source, index });
        });
    });
    return out;
}

function sensible(cards, gs) {
    const trump = gs.trumpSuit;
    const lead = gs.trick.leadSuit;
    if (!lead) {
        const aces = cards.filter((x) => val(x.card) === 14 && suit(x.card) !== trump);
        if (aces.length) return aces[0];
        const kings = cards.filter((x) => val(x.card) === 13 && suit(x.card) !== trump);
        if (kings.length) return kings[0];
        const nonTrump = cards.filter((x) => suit(x.card) !== trump);
        return nonTrump.length ? lowest(nonTrump) : lowest(cards);
    }
    const opponent = gs.trick.cards[0].card;
    const follow = cards.filter((x) => suit(x.card) === lead);
    if (follow.length) {
        const winning = follow.filter((x) => val(x.card) > val(opponent));
        return winning.length ? lowest(winning) : lowest(follow);
    }
    const trumps = cards.filter((x) => suit(x.card) === trump);
    if (trumps.length && lead !== trump) return lowest(trumps);
    return lowest(cards);
}

function trumpHeuristic(hand) {
    const counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    const highs = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    hand.filter(Boolean).forEach((card) => {
        counts[suit(card)]++;
        if (val(card) >= 11) highs[suit(card)]++;
    });
    return ['hearts', 'spades', 'diamonds', 'clubs'].reduce((a, s) =>
        (highs[s] * 2 + counts[s] > highs[a] * 2 + counts[a] ? s : a), 'hearts');
}

async function playRound(eng, difficulty) {
    const { gs, h } = eng;
    gs.difficulty = difficulty;
    gs.isFirstRound = false;
    const wasSelector = gs.lastTrumpSelector;
    h.trump = null;
    eng.startNewRound();

    for (let guard = 0; guard < 500; guard++) {
        await settle();
        if (h.trump && gs.gamePhase === 'trump-selection') {
            const cb = h.trump;
            h.trump = null;
            cb(trumpHeuristic(gs.player.hand));
            continue;
        }
        if (gs.gamePhase === 'playing' && gs.currentPlayer === 'player' && !gs.resolvingTrick && gs.trick.cards.length < 2) {
            const legal = legalCards(eng);
            if (legal.length) {
                const pick = sensible(legal, gs);
                eng.E.playCard(pick.index, pick.source);
            }
            continue;
        }
        const left = gs.player.hand.filter(Boolean).length + gs.player.faceUp.filter(Boolean).length +
            gs.computer.hand.filter(Boolean).length + gs.computer.faceUp.filter(Boolean).length;
        if (gs.trickCount >= 15 && left === 0) break;
    }
    if (gs.trickCount < 15) throw new Error(`round did not finish (${difficulty}, selector was ${wasSelector})`);
}

(async () => {
    const matches = Number(process.argv[2] || 30);
    const roundsGuard = Number(process.argv[3] || 60);
    const t0 = Date.now();
    console.log(`AI matches to 5 points, ${matches} per difficulty, sensible baseline\n`);
    console.log('difficulty | player wins | Anne wins | avg player pts | avg Anne pts | avg rounds');
    let failed = 0;

    for (const difficulty of ['easy', 'medium', 'hard']) {
        const rng = mulberry32(4242 + difficulty.length * 31);
        const eng = createEngine(rng);
        let playerWins = 0, anneWins = 0, playerPoints = 0, annePoints = 0, rounds = 0;

        for (let m = 0; m < matches; m++) {
            const gs = eng.gs;
            gs.player.score = 0;
            gs.computer.score = 0;
            gs.matchTarget = 5;
            gs.pendingMatchTarget = 5;
            gs.isFirstRound = false;
            gs.lastTrumpSelector = m % 2 ? 'computer' : 'player';
            gs.gameOver = false;
            let n = 0;
            while (gs.player.score < 5 && gs.computer.score < 5 && n < roundsGuard) {
                await playRound(eng, difficulty);
                n++;
            }
            if (n >= roundsGuard) { failed++; console.log(`FAIL: ${difficulty} match ${m} hit the round guard`); }
            playerPoints += gs.player.score;
            annePoints += gs.computer.score;
            rounds += n;
            if (gs.player.score >= 5) playerWins++;
            else anneWins++;
        }

        console.log(
            `${difficulty.padEnd(10)} | ${String(playerWins).padStart(11)} | ${String(anneWins).padStart(9)} | ` +
            `${(playerPoints / matches).toFixed(2).padStart(14)} | ${(annePoints / matches).toFixed(2).padStart(12)} | ` +
            `${(rounds / matches).toFixed(2).padStart(10)}`
        );
    }
    console.log(`\n(done in ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
