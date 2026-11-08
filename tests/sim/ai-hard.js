'use strict';
/*
 * Hard AI regression checks (dev only).
 *
 * These pin the mistakes a player notices immediately: calling a trump suit
 * the caller holds none of, and discarding while holding a winning trump on a
 * suit the caller is void in. They also time a full round so a stronger search
 * cannot make the table feel frozen.
 *
 *   node sim/ai-hard.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'script.js'), 'utf8');

function createEngine() {
    const box = { console, __h: {} };
    const ctx = vm.createContext(box);
    vm.runInContext(`
      const GameView = { beat: (name) => Promise.resolve(), event(){}, log(){}, clearLog(){}, status(){}, thinking(){}, render(){},
        highlightTrickWinner(){}, setStartButton(){}, setNewRoundButton(){}, hideSelectTrumpButton(){},
        setSelectTrumpButton(){}, showTrumpSelection(){}, showCoinToss(){}, coinTossBegin(){},
        coinTossReveal(){}, hideCoinToss(){}, showGameOver(){}, resetForRestart(){}, pendingCount(){ return 0; } };
    `, ctx);
    vm.runInContext(SRC, ctx);
    return {
        gs: vm.runInContext('gameState', ctx),
        ctx,
        run: (code) => vm.runInContext(code, ctx),
        play: () => vm.runInContext('getComputerPlay()', ctx),
        trump: () => vm.runInContext('chooseHardTrump()', ctx)
    };
}

let failures = 0;
const check = (label, condition, detail) => {
    console.log(`${condition ? 'ok' : 'FAIL'} - ${label}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);
    if (!condition) failures++;
};

function reset(eng, hand, faceUp, faceDown) {
    const gs = eng.gs;
    gs.difficulty = 'hard';
    gs.gamePhase = 'playing';
    gs.gameStarted = true;
    gs.gameOver = false;
    gs.trumpSuit = 'clubs';
    gs.lastTrumpSelector = 'computer';
    gs.trickCount = 3;
    gs.roundNumber = 1;
    gs.matchTarget = 3;
    gs.isFirstRound = false;
    gs.playedCards = ['7_hearts', '8_hearts', '9_hearts', 'K_clubs', 'Q_clubs'];
    gs.voids = { player: [], computer: [] };
    gs.lastTrick = null;
    gs.player = { hand: ['A_hearts'], faceUp: ['K_hearts'], faceDown: [], score: 0, tricksWon: 1, wonTricks: [] };
    gs.computer = { hand: hand.slice(), faceUp: (faceUp || []).slice(), faceDown: (faceDown || []).slice(), score: 0, tricksWon: 2, wonTricks: [] };
    gs.trick = { cards: [], leadSuit: null };
    gs.player.hand = ['A_hearts'];
    gs.player.faceUp = ['K_hearts'];
    gs.player.faceDown = [null, null, null, null, null];
}

// ---- 1. Trump choice never picks a suit the caller does not hold ----------
{
    const eng = createEngine();
    reset(eng, ['Q_clubs', 'J_clubs', 'A_hearts', 'K_hearts', '8_diamonds'], [], []);
    const suit = eng.trump();
    check('hard trump is a suit in hand', ['clubs', 'hearts', 'diamonds'].includes(suit), suit);
    check('hard trump is not empty spades', suit !== 'spades', suit);
}

// ---- 2. Ruff a void trick instead of discarding ----------------------------
{
    const eng = createEngine();
    // No hearts, three clubs including the top two, and a diamond to throw away.
    reset(eng, ['A_clubs', 'K_clubs', '10_clubs', '8_diamonds', '7_spades'], ['Q_clubs'], []);
    eng.gs.trick = { cards: [{ card: 'A_hearts', player: 'player' }], leadSuit: 'hearts' };
    eng.gs.currentPlayer = 'computer';
    const play = eng.play();
    check('hard ruffs a heart lead when void', play && play.card.endsWith('_clubs'), play && play.card);
}

// ---- 3. Do not waste a losing trump when the trick is already lost ---------
{
    const eng = createEngine();
    // The player has already ruffed the heart lead with 10_clubs. Anne cannot
    // beat that with her 8_clubs, so she should throw the diamond and keep the
    // trump for the next trick.
    reset(eng, ['8_clubs', '9_diamonds', '8_spades', '9_spades', '10_spades'], [], []);
    eng.gs.player.hand = ['10_clubs'];
    eng.gs.trick = { cards: [{ card: '10_clubs', player: 'player' }], leadSuit: 'hearts' };
    eng.gs.currentPlayer = 'computer';
    const play = eng.play();
    check('hard keeps a trump that cannot win', play && !play.card.endsWith('_clubs'), play && play.card);
}

// ---- 4. Lead a master rather than a random low card ------------------------
{
    const eng = createEngine();
    reset(eng, ['A_spades', 'K_spades', '9_diamonds', '8_diamonds', '7_hearts'], ['Q_spades'], []);
    eng.gs.trick = { cards: [], leadSuit: null };
    eng.gs.currentPlayer = 'computer';
    const play = eng.play();
    check('hard leads a master spade', play && play.card.endsWith('_spades'), play && play.card);
}

// ---- 5. A full round of hard decisions stays responsive --------------------
{
    const eng = createEngine();
    const gs = eng.gs;
    gs.gamePhase = 'playing';
    gs.gameStarted = true;
    gs.difficulty = 'hard';
    gs.trumpSuit = 'clubs';
    gs.lastTrumpSelector = 'computer';
    gs.trickCount = 0;
    gs.playedCards = [];
    gs.voids = { player: [], computer: [] };
    gs.lastTrick = null;
    gs.player = {
        hand: ['A_hearts', 'K_hearts', 'Q_hearts', 'J_hearts', '10_hearts'],
        faceUp: ['9_hearts', '8_hearts', '7_hearts', 'A_spades', 'K_spades'],
        faceDown: ['7_spades', '8_spades', '9_spades', 'J_diamonds', 'Q_diamonds'],
        score: 0, tricksWon: 0, wonTricks: []
    };
    gs.computer = {
        hand: ['A_clubs', 'K_clubs', 'Q_clubs', 'J_clubs', '10_clubs'],
        faceUp: ['8_clubs', '9_clubs', 'A_diamonds', 'K_diamonds', '10_diamonds'],
        faceDown: ['10_spades', 'J_spades', 'Q_spades', '8_diamonds', '9_diamonds'],
        score: 0, tricksWon: 0, wonTricks: []
    };
    gs.trick = { cards: [], leadSuit: null };
    gs.currentPlayer = 'computer';
    let worst = 0;
    let plays = 0;
    for (let i = 0; i < 15; i++) {
        const t0 = Date.now();
        // The AI is the only side acting; force a plausible player response by
        // appending the player's first legal card after each choice.
        const ai = eng.play();
        worst = Math.max(worst, Date.now() - t0);
        plays++;
        if (!ai) break;
        eng.run(`(() => {
            const side = 'computer';
            const data = gameState.computer;
            const play = ${JSON.stringify({ card: ai.card, source: ai.source, index: ai.index })};
            if (play.source === 'hand') data.hand[play.index] = null; else data.faceUp[play.index] = null;
            gameState.trick.cards.push({ card: play.card, player: side });
            if (gameState.trick.cards.length === 1) gameState.trick.leadSuit = play.card.split('_')[1];
            gameState.currentPlayer = 'player';
            // A simple legal reply for the player.
            const lead = gameState.trick.leadSuit;
            const cards = [];
            gameState.player.hand.forEach((c, i) => { if (c && (!lead || c.endsWith('_'+lead))) cards.push({ card: c, source: 'hand', index: i }); });
            gameState.player.faceUp.forEach((c, i) => { if (c && (!lead || c.endsWith('_'+lead))) cards.push({ card: c, source: 'faceUp', index: i }); });
            if (!cards.length) {
                gameState.player.hand.forEach((c, i) => { if (c) cards.push({ card: c, source: 'hand', index: i }); });
                gameState.player.faceUp.forEach((c, i) => { if (c) cards.push({ card: c, source: 'faceUp', index: i }); });
            }
            const pick = cards[0];
            if (!pick) return;
            if (pick.source === 'hand') gameState.player.hand[pick.index] = null; else gameState.player.faceUp[pick.index] = null;
            gameState.trick.cards.push({ card: pick.card, player: 'player' });
            const winner = determineTrickWinner(gameState.trick.cards[0], gameState.trick.cards[1]);
            gameState[winner].tricksWon++;
            gameState.trick = { cards: [], leadSuit: null };
            gameState.trickCount++;
            gameState.currentPlayer = winner === 'computer' ? 'computer' : 'computer';
        })()`);
        if (gs.trickCount >= 15) break;
    }
    check('hard kept playing for a whole round', plays >= 9, plays);
    check('hard decisions stay under 250ms', worst < 250, `${worst}ms`);
    console.log(`slowest hard decision in the round: ${worst}ms`);
}

console.log(failures ? `\n${failures} hard AI check(s) failed` : '\nall hard AI checks passed');
process.exit(failures ? 1 : 0);
