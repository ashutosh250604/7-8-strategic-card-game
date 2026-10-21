'use strict';
/*
 * Match-target regression check. Loads the real engine with a no-op view and
 * verifies the first-to-N finish, the five-point default, and the rule that a
 * settings change cannot move the goal line inside a live match.
 *
 *   node match-target.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');

function createEngine() {
    const box = { console, __h: { ended: 0, winner: null, target: null, beats: [] } };
    const ctx = vm.createContext(box);
    vm.runInContext(`
      const GameView = {
        beat: (name) => { __h.beats.push(name); return Promise.resolve(); },
        log(){}, clearLog(){}, status(){}, thinking(){}, render(){},
        highlightTrickWinner(){}, setStartButton(){}, setNewRoundButton(){},
        hideSelectTrumpButton(){}, setSelectTrumpButton(){}, showTrumpSelection(){},
        showCoinToss(){}, coinTossBegin(){}, coinTossReveal(){}, hideCoinToss(){},
        showGameOver(winner, scores){ __h.ended++; __h.winner = winner; __h.target = scores.target; },
        resetForRestart(){}
      };
    `, ctx);
    vm.runInContext(SRC, ctx);
    return { ctx, h: box.__h, gs: vm.runInContext('gameState', ctx) };
}

let failed = 0;
const check = (label, condition, detail) => {
    if (condition) console.log('ok -', label);
    else { failed++; console.log('FAIL -', label, detail === undefined ? '' : JSON.stringify(detail)); }
};

const eng = createEngine();
const gs = eng.gs;

check('production default target is five', gs.matchTarget === 5 && gs.pendingMatchTarget === 5, { match: gs.matchTarget, pending: gs.pendingMatchTarget });

gs.player.score = 4;
gs.computer.score = 3;
vm.runInContext('checkGameEnd()', eng.ctx);
check('four points does not end a five-point match', eng.h.ended === 0 && gs.gameOver === false, eng.h);

gs.player.score = 5;
vm.runInContext('checkGameEnd()', eng.ctx);
check('five points ends the match', eng.h.ended === 1 && eng.h.winner === 'Player' && eng.h.target === 5, eng.h);

// A new target waits for a new match.
const eng3 = createEngine();
eng3.gs.player.score = 2;
eng3.gs.computer.score = 2;
const applied = vm.runInContext('GameEngine.setMatchTarget(3)', eng3.ctx);
check('setMatchTarget accepts 3', applied === true);
check('the live match still uses its old target', eng3.gs.matchTarget === 5 && eng3.gs.pendingMatchTarget === 3, { active: eng3.gs.matchTarget, pending: eng3.gs.pendingMatchTarget });
vm.runInContext('restartGame()', eng3.ctx);
check('restart applies the pending three-point target', eng3.gs.matchTarget === 3 && eng3.gs.player.score === 0, { target: eng3.gs.matchTarget, score: eng3.gs.player.score });
eng3.gs.player.score = 3;
vm.runInContext('checkGameEnd()', eng3.ctx);
check('three points ends a three-point match', eng3.h.ended === 1 && eng3.h.target === 3, eng3.h);

// Seven-point target and a computer win.
const eng7 = createEngine();
vm.runInContext('GameEngine.setMatchTarget(7); restartGame();', eng7.ctx);
eng7.gs.computer.score = 6;
vm.runInContext('checkGameEnd()', eng7.ctx);
check('six points does not end a seven-point match', eng7.h.ended === 0, eng7.h);
eng7.gs.computer.score = 7;
vm.runInContext('checkGameEnd()', eng7.ctx);
check('seven points ends a seven-point match for Anne', eng7.h.ended === 1 && eng7.h.winner === 'Computer' && eng7.h.target === 7, eng7.h);

// Invalid values are rejected instead of corrupting the next match.
const bad = vm.runInContext('GameEngine.setMatchTarget(4)', eng7.ctx);
check('unsupported target is rejected', bad === false && eng7.gs.pendingMatchTarget === 7, { result: bad, pending: eng7.gs.pendingMatchTarget });

console.log(failed ? `\n${failed} match-target check(s) failed` : '\nall match-target checks passed');
process.exit(failed ? 1 : 0);
