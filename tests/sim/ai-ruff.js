'use strict';
/*
 * Ruff invariant. In a two-player trick game a trump shown on a side-suit lead
 * always wins the trick, because the opponent's card is already on the table.
 * So an AI that is void in the led suit and still holds a trump must never
 * discard. This drives the real engine headlessly, records every computer
 * decision, and fails if the engine's ruff guard ever has to override the AI.
 *
 *   node sim/ai-ruff.js [rounds=40]
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
    const box = { console, __rng: rng, __h: { forced: [], discardsWhenVoid: [], selections: 0, rounds: 0 } };
    const ctx = vm.createContext(box);
    vm.runInContext(`
      const GameView = { beat: () => Promise.resolve(), log(){}, clearLog(){}, status(){}, thinking(){}, render(){},
        highlightTrickWinner(){}, setStartButton(){}, setNewRoundButton(){}, hideSelectTrumpButton(){},
        setSelectTrumpButton(){}, showTrumpSelection(cb){ __h.trump = cb; }, showCoinToss(){}, coinTossBegin(){},
        coinTossReveal(){}, hideCoinToss(){}, showGameOver(){}, resetForRestart(){}, event(){} };
      Math.random = () => __rng();
    `, ctx);
    vm.runInContext(SRC, ctx);
    // Record what the AI chose before the guard could correct it.
    vm.runInContext(`
      const __ai = getComputerPlay;
      getComputerPlay = function () {
        const choice = __ai();
        __h.selections++;
        if (choice) {
          const corrected = enforceRuffRule(choice);
          if (corrected && corrected.card !== choice.card) {
            __h.forced.push({ lead: gameState.trick.leadSuit, trump: gameState.trumpSuit, ai: choice.card, ruff: corrected.card });
          }
        }
        return choice;
      };
    `, ctx);
    return {
        gs: vm.runInContext('gameState', ctx),
        E: vm.runInContext('GameEngine', ctx),
        h: box.__h,
        startNewRound: vm.runInContext('startNewRound', ctx)
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
        const left = gs.player.hand.filter(Boolean).length + gs.player.faceUp.filter(Boolean).length +
            gs.computer.hand.filter(Boolean).length + gs.computer.faceUp.filter(Boolean).length;
        if (gs.trickCount >= 15 && left === 0) break;
    }
    h.rounds++;
    if (gs.trickCount < 15) throw new Error(`round did not finish for ${difficulty}: ${gs.trickCount}`);
}

(async () => {
    const rounds = Number(process.argv[2] || 40);
    let failed = 0;
    for (const difficulty of ['easy', 'medium', 'hard']) {
        const rng = mulberry32(7717 + difficulty.length * 13);
        const eng = createEngine(rng);
        // High enough that the match can never end during the sample: a
        // finished match deliberately refuses to deal another round.
        eng.gs.matchTarget = 9999;
        eng.gs.pendingMatchTarget = 9999;
        for (let i = 0; i < rounds; i++) await playRound(eng, difficulty);
        console.log(`${difficulty}: ${eng.h.rounds} rounds, ${eng.h.selections} decisions, ${eng.h.forced.length} forced ruffs`);
        // Easy is allowed to blunder, so the guard correcting it is expected.
        // Medium and hard must never need correcting.
        if (difficulty !== 'easy' && eng.h.forced.length) {
            failed++;
            console.log('  guard had to fix:', JSON.stringify(eng.h.forced.slice(0, 3)));
        }
    }
    console.log(failed
        ? '\nruff invariant failed'
        : '\nruff invariant holds: medium and hard always ruff when void with trump');
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
