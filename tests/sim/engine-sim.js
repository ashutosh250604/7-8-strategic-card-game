'use strict';
/*
 * Dev-only headless simulator. Runs the REAL script.js engine (no DOM; every beat resolves
 * immediately) so AI strength and rule balance can be MEASURED over thousands of rounds.
 *
 *   node sim/engine-sim.js [roundsPerCell=1000] [matches=400]
 *
 * Human stand-ins (the engine has no "player AI"): `random` plays a random legal card;
 * `sensible` plays like a decent casual player (see sensiblePolicy). Neither is an expert, so
 * results say "Hard beats a casual player by X", not "Hard is expert".
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'script.js'), 'utf8');
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VAL = { '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const val = c => VAL[c.split('_')[0]];
const suit = c => c.split('_')[1];

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const settle = () => new Promise(r => setImmediate(r));

function createEngine(rng) {
    const box = { console, __rng: rng };
    const ctx = vm.createContext(box);
    vm.runInContext(`
      var __h = { trump: null, ended: false };
      const GameView = { beat: () => Promise.resolve(), log(){}, clearLog(){}, status(){}, thinking(){}, render(){},
        highlightTrickWinner(){}, setStartButton(){}, setNewRoundButton(s){ if (s) __h.ended = true; }, hideSelectTrumpButton(){},
        setSelectTrumpButton(){}, showTrumpSelection(cb){ __h.trump = cb; }, showCoinToss(){}, coinTossBegin(){}, coinTossReveal(){},
        hideCoinToss(){}, showGameOver(){ __h.ended = true; }, resetForRestart(){} };
      Math.random = () => __rng();
    `, ctx);
    vm.runInContext(SRC, ctx);
    const get = e => vm.runInContext(e, ctx);
    return { gs: get('gameState'), E: get('GameEngine'), h: get('__h'), startNewRound: get('startNewRound') };
}

// ---------------------------------------------------------------- human stand-ins
const lowest = a => a.reduce((x, y) => val(y.card) < val(x.card) ? y : x);
const highest = a => a.reduce((x, y) => val(y.card) > val(x.card) ? y : x);

function legalCards(eng) {
    const { gs, E } = eng, out = [];
    gs.player.hand.forEach((c, index) => { if (c && E.isValidPlay(c, gs.trick.leadSuit)) out.push({ card: c, source: 'hand', index }); });
    gs.player.faceUp.forEach((c, index) => { if (c && E.isValidPlay(c, gs.trick.leadSuit)) out.push({ card: c, source: 'faceUp', index }); });
    return out;
}

const policies = {
    random: (c, gs, rng) => c[Math.floor(rng() * c.length)],
    sensible: (c, gs) => {
        const trump = gs.trumpSuit, lead = gs.trick.leadSuit;
        if (!lead) {
            const aces = c.filter(x => val(x.card) === 14 && suit(x.card) !== trump); if (aces.length) return aces[0];
            const kings = c.filter(x => val(x.card) === 13 && suit(x.card) !== trump); if (kings.length) return kings[0];
            const nonT = c.filter(x => suit(x.card) !== trump); return nonT.length ? lowest(nonT) : lowest(c);
        }
        const opp = gs.trick.cards[0].card;
        const follow = c.filter(x => suit(x.card) === lead);
        if (follow.length) {
            const win = follow.filter(x => val(x.card) > val(opp));
            return win.length ? lowest(win) : lowest(follow);
        }
        const trumps = c.filter(x => suit(x.card) === trump);
        if (trumps.length && lead !== trump) return lowest(trumps);
        return lowest(c);
    }
};

const trumpPolicies = {
    heuristic: (hand) => { // same formula as the computer's selectComputerTrump
        const cnt = {}, hi = {}; SUITS.forEach(s => { cnt[s] = 0; hi[s] = 0; });
        hand.forEach(c => { cnt[suit(c)]++; if (val(c) >= 11) hi[suit(c)]++; });
        let best = 'hearts', bs = -1; SUITS.forEach(s => { const sc = hi[s] * 2 + cnt[s]; if (sc > bs) { bs = sc; best = s; } }); return best;
    },
    longest: (hand) => { const cnt = {}; SUITS.forEach(s => cnt[s] = 0); hand.forEach(c => cnt[suit(c)]++); return SUITS.reduce((a, s) => cnt[s] > cnt[a] ? s : a, 'hearts'); },
    random: (hand, rng) => SUITS[Math.floor(rng() * 4)],
    worst: (hand) => { const cnt = {}; SUITS.forEach(s => cnt[s] = 0); hand.forEach(c => cnt[suit(c)]++); return SUITS.reduce((a, s) => cnt[s] < cnt[a] ? s : a, 'hearts'); }
};

// ---------------------------------------------------------------- one round
async function playRound(eng, opts, rng, stats) {
    const { gs, E, h } = eng;
    gs.difficulty = opts.difficulty;
    gs.isFirstRound = false;
    gs.lastTrumpSelector = opts.selector === 'player' ? 'computer' : 'player'; // engine flips it
    h.ended = false; h.trump = null;
    const before = { p: gs.player.score, c: gs.computer.score };
    eng.startNewRound();
    for (let guard = 0; guard < 400 && !h.ended; guard++) {
        await settle();
        if (h.trump && gs.gamePhase === 'trump-selection') {
            const cb = h.trump; h.trump = null;
            cb(trumpPolicies[opts.trump](gs.player.hand.filter(Boolean), rng));
        } else if (gs.gamePhase === 'playing' && gs.currentPlayer === 'player' && !gs.resolvingTrick && gs.trick.cards.length < 2) {
            const cands = legalCards(eng);
            if (!cands.length) continue;
            if (stats) { stats.decisions++; stats.legalSum += cands.length; if (cands.length === 1) stats.forced++; }
            const pick = policies[opts.policy](cands, gs, rng);
            E.playCard(pick.index, pick.source);
        }
    }
    if (!h.ended) throw new Error('round did not finish');
    return {
        selector: gs.lastTrumpSelector,
        pTricks: gs.player.tricksWon, cTricks: gs.computer.tricksWon,
        pPts: gs.player.score - before.p, cPts: gs.computer.score - before.c
    };
}

const pct = (n, d) => (100 * n / d).toFixed(1).padStart(5) + '%';
const f2 = x => x.toFixed(2).padStart(6);

(async () => {
    const N = Number(process.argv[2] || 1000), M = Number(process.argv[3] || 400);
    const t0 = Date.now();

    // ---------------- 1. AI ladder
    console.log(`\n=== 1. AI LADDER  (${N} rounds per cell, half with each side choosing trump; trump choice = heuristic)`);
    console.log('human stand-in  AI      | AI avg tricks | AI scores | human scores | nobody scores | AI pts/round - human pts/round');
    const ladder = {};
    for (const policy of ['random', 'sensible']) {
        for (const difficulty of ['easy', 'medium', 'hard']) {
            const rng = mulberry32(1234 + difficulty.length * 7 + policy.length), eng = createEngine(rng);
            let cT = 0, cS = 0, pS = 0, none = 0, cP = 0, pP = 0, n = 0;
            for (let i = 0; i < N; i++) {
                const r = await playRound(eng, { difficulty, policy, selector: i % 2 ? 'player' : 'computer', trump: 'heuristic' }, rng);
                cT += r.cTricks; cP += r.cPts; pP += r.pPts; n++;
                if (r.cPts > 0) cS++; if (r.pPts > 0) pS++; if (!r.cPts && !r.pPts) none++;
            }
            ladder[`${policy}/${difficulty}`] = (cP - pP) / n;
            console.log(`${policy.padEnd(14)}  ${difficulty.padEnd(6)} | ${f2(cT / n)}        | ${pct(cS, n)}    | ${pct(pS, n)}       | ${pct(none, n)}        | ${f2(cP / n)} - ${f2(pP / n)} = ${f2((cP - pP) / n)}`);
        }
    }

    // ---------------- 2. Role balance (selector = harder target 8, opponent target 7)
    console.log(`\n=== 2. ROLE BALANCE  (selector needs 9+ tricks to score, non-selector needs 8+; averaged over both seats)`);
    for (const [policy, difficulty] of [['random', 'easy'], ['sensible', 'medium'], ['sensible', 'hard']]) {
        const rng = mulberry32(99 + policy.length + difficulty.length), eng = createEngine(rng);
        let selPts = 0, oppPts = 0, selScores = 0, oppScores = 0, none = 0, selTricks = 0, n = 0;
        const dist = {};
        for (let i = 0; i < N * 2; i++) {
            const r = await playRound(eng, { difficulty, policy, selector: i % 2 ? 'player' : 'computer', trump: 'heuristic' }, rng);
            const sel = r.selector === 'player' ? { t: r.pTricks, p: r.pPts } : { t: r.cTricks, p: r.cPts };
            const opp = r.selector === 'player' ? { t: r.cTricks, p: r.cPts } : { t: r.pTricks, p: r.pPts };
            selPts += sel.p; oppPts += opp.p; if (sel.p) selScores++; if (opp.p) oppScores++; if (!sel.p && !opp.p) none++; selTricks += sel.t; n++;
            dist[sel.t] = (dist[sel.t] || 0) + 1;
        }
        console.log(`${policy}/${difficulty}: selector avg tricks ${f2(selTricks / n)} (needs 9) | selector scores ${pct(selScores, n)} avg ${f2(selPts / n)} pts | opponent scores ${pct(oppScores, n)} avg ${f2(oppPts / n)} pts | nobody ${pct(none, n)}  | total pts/round ${f2((selPts + oppPts) / n)}`);
        const keys = Object.keys(dist).map(Number).sort((a, b) => a - b);
        console.log('   selector tricks distribution: ' + keys.map(k => `${k}:${(100 * dist[k] / n).toFixed(0)}%`).join(' '));
    }

    // ---------------- 3. Does trump choice matter?
    console.log(`\n=== 3. DOES TRUMP CHOICE MATTER?  (human = sensible, AI = medium, human always selects trump; ${N} rounds each)`);
    for (const trump of ['heuristic', 'longest', 'random', 'worst']) {
        const rng = mulberry32(555), eng = createEngine(rng);
        let t = 0, sc = 0, n = 0, pts = 0;
        for (let i = 0; i < N; i++) {
            const r = await playRound(eng, { difficulty: 'medium', policy: 'sensible', selector: 'player', trump }, rng);
            t += r.pTricks; n++; pts += r.pPts; if (r.pPts) sc++;
        }
        console.log(`trump = ${trump.padEnd(9)}: avg tricks ${f2(t / n)} | scores ${pct(sc, n)} | pts/round ${f2(pts / n)}`);
    }

    // ---------------- 4. Decision density
    console.log(`\n=== 4. DECISION DENSITY  (how often does the player have a real choice?)`);
    {
        const rng = mulberry32(7), eng = createEngine(rng), stats = { decisions: 0, legalSum: 0, forced: 0 };
        for (let i = 0; i < 300; i++) await playRound(eng, { difficulty: 'medium', policy: 'sensible', selector: i % 2 ? 'player' : 'computer', trump: 'heuristic' }, rng, stats);
        console.log(`player turns per round ${(stats.decisions / 300).toFixed(1)} | avg legal cards ${(stats.legalSum / stats.decisions).toFixed(2)} | exactly one legal card: ${pct(stats.forced, stats.decisions)}`);
    }

    // ---------------- 5. Match length at the intended production target (5 points)
    console.log(`\n=== 5. MATCH LENGTH TO 5 POINTS  (${M} matches, selector alternates, human = sensible vs medium)`);
    {
        const rng = mulberry32(2024), eng = createEngine(rng), rounds = [], wins = { player: 0, computer: 0 }, margins = [];
        for (let m = 0; m < M; m++) {
            eng.gs.player.score = 0; eng.gs.computer.score = 0; eng.gs.lastTrumpSelector = rng() < 0.5 ? 'player' : 'computer';
            let n = 0;
            while (eng.gs.player.score < 5 && eng.gs.computer.score < 5 && n < 200) {
                // keep alternating exactly like the real game
                const next = eng.gs.lastTrumpSelector === 'player' ? 'computer' : 'player';
                await playRound(eng, { difficulty: 'medium', policy: 'sensible', selector: next, trump: 'heuristic' }, rng); n++;
            }
            rounds.push(n); wins[eng.gs.player.score >= 5 ? 'player' : 'computer']++;
            margins.push(Math.abs(eng.gs.player.score - eng.gs.computer.score));
        }
        rounds.sort((a, b) => a - b);
        const q = p => rounds[Math.floor(p * (rounds.length - 1))];
        console.log(`rounds per match: median ${q(0.5)} | p10 ${q(0.1)} | p90 ${q(0.9)} | max ${rounds[rounds.length - 1]} | player win rate ${pct(wins.player, M)}`);
    }
    console.log(`\n(done in ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
})().catch(e => { console.error(e); process.exit(1); });
