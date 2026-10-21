'use strict';
/*
 * AI rules check. Wraps the engine's computer chooser and asserts that every
 * selected card is in the engine's own legal-play list. This guards the new
 * Hard simulation from ever returning a card the rules do not allow.
 *
 *   node sim/ai-rules.js [roundsPerDifficulty=24]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'script.js'), 'utf8');

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
const settle = () => new Promise((r) => setImmediate(r));

function createEngine(rng) {
    const box = { console, __rng: rng, __h: { illegal: [], selections: 0, rounds: 0 } };
    const ctx = vm.createContext(box);
    vm.runInContext(`
      const GameView = { beat: () => Promise.resolve(), log(){}, clearLog(){}, status(){}, thinking(){}, render(){},
        highlightTrickWinner(){}, setStartButton(){}, setNewRoundButton(){}, hideSelectTrumpButton(){},
        setSelectTrumpButton(){}, showTrumpSelection(cb){ __h.trump = cb; }, showCoinToss(){}, coinTossBegin(){},
        coinTossReveal(){}, hideCoinToss(){}, showGameOver(){}, resetForRestart(){} };
      Math.random = () => __rng();
    `, ctx);
    vm.runInContext(SRC, ctx);
    vm.runInContext(`
      const __originalComputerPlayChoice = getComputerPlay;
      getComputerPlay = function () {
        const legal = getValidCards(gameState.computer).map((entry) => entry.card);
        const choice = __originalComputerPlayChoice();
        __h.selections++;
        if (choice && !legal.includes(choice.card)) __h.illegal.push({ card: choice.card, legal });
        return choice;
      };
    `, ctx);
    return {
        gs: vm.runInContext('gameState', ctx),
        E: vm.runInContext('GameEngine', ctx),
        h: box.__h,
        startNewRound: vm.runInContext('startNewRound', ctx),
        setTrump: vm.runInContext('setTrump', ctx)
    };
}

function legalPlayerCards(eng) {
    const { gs, E } = eng;
    const out = [];
    ['hand', 'faceUp'].forEach((source) => {
        gs.player[source].forEach((card, index) => {
            if (card && E.isValidPlay(card, gs.trick.leadSuit)) out.push({ card, source, index });
        });
    });
    return out;
}

async function playRound(eng, difficulty) {
    const { gs, h } = eng;
    gs.difficulty = difficulty;
    gs.isFirstRound = false;
    gs.lastTrumpSelector = gs.lastTrumpSelector === 'player' ? 'computer' : 'player';
    h.trump = null;
    eng.startNewRound();

    for (let guard = 0; guard < 500; guard++) {
        await settle();
        if (h.trump && gs.gamePhase === 'trump-selection') {
            const cb = h.trump;
            h.trump = null;
            cb(['hearts', 'spades', 'diamonds', 'clubs'][Math.floor(Math.random() * 4)]);
            continue;
        }
        if (gs.gamePhase === 'playing' && gs.currentPlayer === 'player' && !gs.resolvingTrick && gs.trick.cards.length < 2) {
            const legal = legalPlayerCards(eng);
            if (legal.length) {
                const pick = legal[Math.floor(Math.random() * legal.length)];
                eng.E.playCard(pick.index, pick.source);
            }
            continue;
        }
        const cardsLeft = gs.player.hand.filter(Boolean).length + gs.player.faceUp.filter(Boolean).length +
            gs.computer.hand.filter(Boolean).length + gs.computer.faceUp.filter(Boolean).length;
        if (gs.trickCount >= 15 && cardsLeft === 0) break;
    }
    h.rounds++;
    if (gs.trickCount < 15) throw new Error(`round did not finish for ${difficulty}: ${gs.trickCount}`);
}

(async () => {
    const rounds = Number(process.argv[2] || 24);
    let failed = 0;
    for (const difficulty of ['easy', 'medium', 'hard']) {
        const rng = mulberry32(90210 + difficulty.length);
        const eng = createEngine(rng);
        eng.gs.matchTarget = 99;
        eng.gs.pendingMatchTarget = 99;
        for (let i = 0; i < rounds; i++) await playRound(eng, difficulty);
        const illegal = eng.h.illegal.length;
        console.log(`${difficulty}: ${eng.h.rounds} rounds, ${eng.h.selections} AI selections, ${illegal} illegal`);
        if (illegal) {
            failed++;
            console.log('  first illegal choice:', JSON.stringify(eng.h.illegal[0]));
        }
    }
    console.log(failed ? '\nAI rules check failed' : '\nall AI selections were legal');
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
