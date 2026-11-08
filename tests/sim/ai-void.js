'use strict';
/*
 * Repro + invariant: when Anne is void in the led suit and holds a trump, she
 * must ruff. Discarding a side-suit card there simply hands the trick away.
 *
 *   node sim/ai-void.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'script.js'), 'utf8');

function makeEngine() {
    const box = { console };
    const ctx = vm.createContext(box);
    vm.runInContext(`
      const GameView = { beat: () => Promise.resolve(), log(){}, clearLog(){}, status(){}, thinking(){}, render(){},
        highlightTrickWinner(){}, setStartButton(){}, setNewRoundButton(){}, hideSelectTrumpButton(){},
        setSelectTrumpButton(){}, showTrumpSelection(){}, showCoinToss(){}, coinTossBegin(){},
        coinTossReveal(){}, hideCoinToss(){}, showGameOver(){}, resetForRestart(){}, event(){} };
    `, ctx);
    vm.runInContext(SRC, ctx);
    return (expr) => vm.runInContext(expr, ctx);
}

// Trick 3: player has led the ace of hearts, Anne is void in hearts and holds
// seven clubs (the suit she called). Every other card is accounted for so the
// hard AI's determinised sampler can build complete deals.
function reportedState(gs) {
    Object.assign(gs, {
        difficulty: 'hard',
        trumpSuit: 'clubs',
        lastTrumpSelector: 'computer',
        currentPlayer: 'computer',
        gamePhase: 'playing',
        trickCount: 2,
        trick: { cards: [{ card: 'A_hearts', player: 'player' }], leadSuit: 'hearts' },
        playedCards: ['9_diamonds', 'J_diamonds', 'Q_diamonds'],
        voids: { player: [], computer: [] }
    });
    gs.computer.tricksWon = 1;
    gs.player.tricksWon = 0;
    gs.computer.hand = ['10_diamonds', '8_diamonds', 'A_diamonds', '8_clubs', '9_clubs'];
    gs.computer.faceUp = ['10_clubs', 'J_clubs', 'Q_clubs', 'K_clubs', 'A_clubs'];
    gs.computer.faceDown = ['9_hearts', '10_hearts', 'J_hearts'];
    gs.player.hand = ['7_hearts', '8_hearts', 'Q_hearts', 'K_hearts', 'K_diamonds'];
    gs.player.faceUp = ['10_spades', 'J_spades', 'Q_spades', 'K_spades', 'A_spades'];
    gs.player.faceDown = ['7_spades', '8_spades', '9_spades'];
}

const show = (play) => play ? `${play.card} (${play.source})` : 'null';

const get = makeEngine();
const gs = get('gameState');
reportedState(gs);

const valid = get('getValidCards(gameState.computer)');
const seen = {};
for (let i = 0; i < 30; i++) {
    const play = get('getHardAIPlay(getValidCards(gameState.computer))');
    seen[play.card] = (seen[play.card] || 0) + 1;
}
console.log('legal:', valid.map(show).join(', '));
console.log('hard choices over 30 runs:', JSON.stringify(seen));

gs.difficulty = 'medium';
const medium = get('getMediumAIPlay(getValidCards(gameState.computer))');
console.log('medium choice:', show(medium));

// invariant: every legal trump should be preferred to every discard here
const trumps = valid.filter((p) => p.card.endsWith('_clubs'));
const discards = valid.filter((p) => !p.card.endsWith('_clubs'));
console.log('trumps available:', trumps.length, 'discards available:', discards.length);
