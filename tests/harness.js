'use strict';
/*
 * Dev-only gameplay trace harness.
 *
 * Loads the REAL index.html + its local <script src> files into jsdom, replaces
 * timers with a deterministic virtual clock, seeds Math.random, and drives the
 * game like a human would (clicking real DOM buttons / cards). After every
 * timer firing or driver action it records a trace of:
 *   - engine state            ([state] [hands] [played] [log] [status])
 *   - DOM-visible output      (everything else)
 * Two runs of the same scenario on behaviour-identical code must produce
 * byte-identical traces, including virtual timing.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class VirtualClock {
    constructor() { this.now = 0; this.seq = 0; this.timers = new Map(); }
    setTimeout(fn, ms, ...args) {
        const id = ++this.seq;
        this.timers.set(id, { id, due: this.now + Math.max(0, Number(ms) || 0), fn, args, owner: 'game' });
        return id;
    }
    clearTimeout(id) { this.timers.delete(id); }
    addDriver(delay, label, fn) {
        const id = ++this.seq;
        this.timers.set(id, { id, due: this.now + delay, fn, args: [], owner: 'driver', label });
        return id;
    }
    pop() {
        let best = null;
        for (const t of this.timers.values()) {
            if (!best || t.due < best.due || (t.due === best.due && t.id < best.id)) best = t;
        }
        if (best) this.timers.delete(best.id);
        return best;
    }
}

const PROFILES = {
    eager: [0],                       // acts the instant it is allowed to (hits the post-trick timing window)
    quick: [0, 300, 600, 900],        // frequently acts inside the 1s post-trick window
    normal: [800, 1500, 2500],
    slow: [3000, 6000]
};

const MODAL_IDS = ['trump-selection-modal', 'game-over-modal', 'coin-toss-modal', 'rules-modal', 'settings-modal', 'game-log-modal'];
const BUTTON_IDS = ['start-game', 'new-round', 'restart-game', 'select-trump-btn', 'show-rules'];
const SECTION_ORDER = [
    'state', 'hands', 'played',
    'dom.playerHand', 'dom.playerFaceUp', 'dom.computerHand', 'dom.computerFaceUp', 'dom.trick',
    'dom.trump', 'dom.scores', 'dom.piles', 'dom.difficulty', 'dom.thinking', 'dom.modals', 'dom.buttons',
    'dom.coin', 'dom.highlight', 'dom.gameover', 'dom.confetti'
];

function flush() { return new Promise(r => setImmediate(r)); }

let unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e)); });

async function runScenario(cfg, rootDir) {
    const out = [];
    const clock = new VirtualClock();
    const consoleEvents = [];
    const vc = new VirtualConsole();
    ['log', 'info', 'warn', 'error', 'debug'].forEach(level => vc.on(level, (...a) => consoleEvents.push(`console.${level}: ${a.join(' ')}`)));
    vc.on('jsdomError', e => consoleEvents.push(`jsdomError: ${String(e.message).split('\n')[0]}`));

    const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', virtualConsole: vc, url: 'http://localhost/' });
    const win = dom.window;
    const doc = win.document;
    const ctx = dom.getInternalVMContext();

    const gameRng = mulberry32(cfg.seed * 1000003 + 17);
    const driverRng = mulberry32(cfg.seed * 7919 + 13);
    win.Math.random = gameRng;
    win.setTimeout = (fn, ms, ...a) => clock.setTimeout(fn, ms, ...a);
    win.clearTimeout = (id) => clock.clearTimeout(id);
    win.confirm = () => true;
    win.close = () => {};

    // Record every log / status mutation individually (multiple per step possible).
    const events = [];
    const observe = (id, tag, fn) => {
        const el = doc.getElementById(id);
        if (!el) return;
        new win.MutationObserver(recs => recs.forEach(r => fn(r))).observe(el, { childList: true });
    };
    observe('game-log', 'log', r => {
        if (r.removedNodes.length) events.push(`[log] -${r.removedNodes.length}`);
        r.addedNodes.forEach(n => events.push(`[log] +{${n.className}} ${n.textContent}`));
    });
    observe('game-status', 'status', r => {
        r.addedNodes.forEach(n => events.push(`[status] ${n.textContent}`));
    });

    // Load the page's own local scripts, in document order.
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>\s*<\/script>/g)]
        .map(m => m[1]).filter(s => !/^https?:/.test(s));
    out.push(`# scripts: ${scripts.join(', ')}`);
    // Vendored libraries are skipped: GSAP's ticker polls on the virtual clock and would flood the trace.
    // (Page load with the vendored files is checked in a real browser instead.)
    for (const rel of scripts.filter(s => !/^assets\/vendor\//.test(s))) {
        const code = fs.readFileSync(path.join(rootDir, rel), 'utf8');
        new vm.Script(code, { filename: rel }).runInContext(ctx);
    }
    if (doc.readyState !== 'complete') await new Promise(r => win.addEventListener('load', r));
    await flush();

    const gs = () => vm.runInContext('gameState', ctx);
    const el = id => doc.getElementById(id);
    const disp = id => { const e = el(id); return e ? e.style.display : undefined; };
    const click = id => { const e = el(id); if (!e) throw new Error('no element ' + id); e.click(); };
    const txt = id => { const e = el(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : '-'; };
    const fmt = a => a.map(c => c === null || c === undefined ? '-' : c).join(',');
    // Cached element references + sibling walking (jsdom's querySelectorAll / .children are slow).
    const q = sel => doc.querySelector(sel);
    const C = {
        playerHand: q('#player-hand .cards-container'), playerFaceUp: q('#player-faceup .cards-container'),
        computerHand: q('#computer-hand .cards-container'), computerFaceUp: q('#computer-faceup .cards-container'),
        trick: q('.trick-cards'), playerArea: q('.player-area'), computerArea: q('.computer-area'),
        playerPiles: q('#player-tricks .tricks-container'), computerPiles: q('#computer-tricks .tricks-container'),
        coinBtns: [...doc.querySelectorAll('.coin-btn')], diffBtns: [...doc.querySelectorAll('.difficulty-btn')]
    };
    const kids = c => { const r = []; for (let e = c && c.firstElementChild; e; e = e.nextElementSibling) r.push(e); return r; };
    const cardEls = c => (c ? [...c.getElementsByClassName('card')] : []);
    const cardsIn = c => cardEls(c).map(e => `${e.textContent.replace(/\s+/g, '')}{${e.className}}`).join(' ');
    const playableCards = () => cardEls(C.playerHand).concat(cardEls(C.playerFaceUp));

    function collect() {
        const g = gs();
        const s = {};
        s.state = [
            `ph=${g.gamePhase}`, `cp=${g.currentPlayer}`, `trump=${g.trumpSuit}`, `lead=${g.trick.leadSuit}`,
            `trick=${g.trick.cards.map(c => c.card + '@' + c.player).join(',')}`,
            `res=${+g.resolvingTrick}`, `think=${+g.computerThinking}`, `over=${+g.gameOver}`, `started=${+g.gameStarted}`,
            `round=${g.roundNumber}`, `tc=${g.trickCount}`, `tw=${g.player.tricksWon}:${g.computer.tricksWon}`,
            `score=${g.player.score}:${g.computer.score}`, `sel=${g.lastTrumpSelector}`, `coin=${g.coinTossWinner}`,
            `first=${+g.isFirstRound}`, `diff=${g.difficulty}`, `won=${g.player.wonTricks.length}:${g.computer.wonTricks.length}`
        ].join(' ');
        s.hands = `P[${fmt(g.player.hand)}|${fmt(g.player.faceUp)}|${fmt(g.player.faceDown)}] C[${fmt(g.computer.hand)}|${fmt(g.computer.faceUp)}|${fmt(g.computer.faceDown)}] rem=${(g.remainingCards || []).length}`;
        s.played = g.playedCards.join(',');
        s['dom.playerHand'] = cardsIn(C.playerHand);
        s['dom.playerFaceUp'] = cardsIn(C.playerFaceUp);
        s['dom.computerHand'] = cardsIn(C.computerHand);
        s['dom.computerFaceUp'] = cardsIn(C.computerFaceUp);
        s['dom.trick'] = cardsIn(C.trick);
        const td = el('trump-display');
        s['dom.trump'] = td ? `${td.innerHTML} {${td.className}}` : '-';
        s['dom.scores'] = `${txt('score-display')} | ${txt('round-info')} | P:${txt('player-tricks')} C:${txt('computer-tricks')}`;
        s['dom.piles'] = `${C.playerPiles ? C.playerPiles.getElementsByClassName('won').length : 0}:${C.computerPiles ? C.computerPiles.getElementsByClassName('won').length : 0}`;
        s['dom.difficulty'] = `${txt('difficulty-display')} | active=${C.diffBtns.filter(b => b.classList.contains('active')).map(b => b.dataset.difficulty)} | ${txt('difficulty-desc')}`;
        s['dom.thinking'] = disp('thinking-indicator');
        s['dom.modals'] = MODAL_IDS.map(i => `${i}:${disp(i)}`).join(' ');
        s['dom.buttons'] = BUTTON_IDS.map(i => `${i}:${disp(i)}`).join(' ');
        const coin = el('coin'), cr = el('coin-result');
        s['dom.coin'] = coin ? `coin{${coin.className}} result{${cr.style.display}|${cr.className}|${cr.textContent}} choice:${disp('coin-choice')} btns:${C.coinBtns.map(b => +b.disabled)}` : '-';
        s['dom.highlight'] = `${C.playerArea.className} / ${C.computerArea.className}`;
        s['dom.gameover'] = `${txt('winner-announcement')} | ${txt('final-scores')}`;
        s['dom.confetti'] = String(doc.getElementsByClassName('confetti').length);
        return s;
    }

    let prev = {};
    let step = 0;
    function snapshot(label) {
        const lines = [`t=${clock.now} #${step++} ${label}`];
        const cur = collect();
        for (const k of SECTION_ORDER) if (cur[k] !== prev[k]) lines.push(`  [${k}] ${cur[k]}`);
        prev = cur;
        events.splice(0).forEach(e => lines.push('  ' + e));
        consoleEvents.splice(0).forEach(e => lines.push('  [console] ' + e));
        unhandled.splice(0).forEach(e => lines.push('  [unhandled] ' + e));
        // Steps with no observable change are counted (via #n) but not printed.
        if (lines.length > 1 || label === 'init') out.push(lines.join('\n'));
    }

    // ---------------------------------------------------------------- driver
    const summary = { id: cfg.id, games: 0, triggered: null, asserts: [] };
    const D = {
        pending: null, pendingId: null, blockedSig: null, finished: false, started: false, tourDone: false,
        restarted: false, seenTc: 0, backdropUsed: false,
        pick(arr) { return arr[Math.floor(driverRng() * arr.length)]; },
        delay() { return this.pick(PROFILES[cfg.profile]); },
        schedule(label, fn, delay) {
            this.pending = label;
            this.pendingId = clock.addDriver(delay === undefined ? this.delay() : delay, label, () => { this.pending = null; this.pendingId = null; fn(); });
        },
        note(msg) { events.push('[driver] ' + msg); },
        trigger(g) {
            // Only states in which the Restart button is physically clickable (no modal overlay open).
            switch (cfg.restartAt) {
                case 'comp-think': return g.computerThinking;
                case 'trick-pending': return g.resolvingTrick;
                case 'post-resolve': return g.trickCount === 3 && g.trickCount === this.seenTc + 1 && g.trick.cards.length === 0;
                case 'dealing': return g.gamePhase === 'dealing-remaining';
                case 'round-end': return /Complete!/.test(txt('game-status')) && g.gamePhase === 'playing';
                case 'comp-trump': return g.gamePhase === 'trump-selection' && g.lastTrumpSelector === 'computer' && !g.trumpSuit;
                default: return false;
            }
        },
        sig(g) { return `${clock.now}|${g.gamePhase}|${g.currentPlayer}|${g.resolvingTrick}|${g.trick.cards.length}|${g.trickCount}|${g.roundNumber}`; },
        observe() {
            const g = gs();
            const hit = cfg.restartAt && !this.restarted && !this.finished && this.trigger(g);
            this.seenTc = g.trickCount;
            if (hit) {
                this.restarted = true;
                summary.triggered = clock.now;
                if (this.pendingId) { clock.clearTimeout(this.pendingId); this.pending = null; this.pendingId = null; }
                return this.schedule('restart-midflow', () => {
                    click('restart-game');
                    this.started = false; this.tourDone = false; this.blockedSig = null;
                    this.schedule('resume-after-restart', () => { this.runAsserts(); }, 7000);
                }, 0);
            }
            if (this.pending || this.finished) return;
            if (disp('game-over-modal') === 'flex') {
                summary.games++;
                if (summary.games < cfg.games) {
                    return this.schedule('play-again', () => { click('play-again'); this.started = false; this.tourDone = false; });
                }
                this.finished = true; return;
            }
            // After a no-op action, wait for the state to move before retrying that same kind of action.
            const blocked = this.blockedSig !== null && this.blockedSig === this.sig(g);
            if (!this.started && disp('start-game') !== 'none' && disp('start-game') !== undefined) {
                return this.schedule('start', () => {
                    if (!this.tourDone) { this.tour(); this.tourDone = true; }
                    this.started = true;
                    click('start-game');
                });
            }
            if (!blocked && disp('coin-toss-modal') === 'flex' && disp('coin-choice') === 'block') {
                return this.schedule('coin', () => {
                    const btns = [...doc.querySelectorAll('.coin-btn')].filter(b => !b.disabled);
                    if (!btns.length) { this.blockedSig = this.sig(gs()); return; }
                    const b = this.pick(btns); this.note('coin ' + b.dataset.choice); b.click();
                });
            }
            if (!blocked && disp('trump-selection-modal') === 'flex') {
                return this.schedule('trump', () => {
                    if (disp('trump-selection-modal') !== 'flex') { this.blockedSig = this.sig(gs()); return; }
                    if (!this.backdropUsed && driverRng() < 0.3) {
                        this.backdropUsed = true; this.note('close trump modal via backdrop');
                        el('trump-selection-modal').click(); return;
                    }
                    const suit = this.pick(['hearts', 'diamonds', 'clubs', 'spades']); // fixed order: independent of button layout
                    const b = doc.querySelector(`.trump-btn[data-suit="${suit}"]`); this.note('trump ' + suit); b.click();
                });
            }
            if (disp('select-trump-btn') === 'block') {
                return this.schedule('select-trump-btn', () => { this.note('click select-trump-btn'); click('select-trump-btn'); });
            }
            if (disp('new-round') === 'block') {
                return this.schedule('new-round', () => { click('new-round'); });
            }
            if (!blocked && g.gamePhase === 'playing' && g.currentPlayer === 'player' && !g.resolvingTrick && g.trick.cards.length < 2) {
                return this.schedule('play', () => {
                    const gg = gs();
                    if (!(gg.gamePhase === 'playing' && gg.currentPlayer === 'player' && !gg.resolvingTrick && gg.trick.cards.length < 2)) { this.note('skip: no longer my turn'); this.blockedSig = this.sig(gg); return; }
                    // Choose in the engine's canonical order (hand, then face-up; index order) so the choice does not
                    // depend on how the view happens to arrange cards, then click the matching element.
                    const canon = [];
                    gg.player.hand.forEach((card, i) => { if (card) canon.push({ card, i, src: 'hand' }); });
                    gg.player.faceUp.forEach((card, i) => { if (card) canon.push({ card, i, src: 'faceUp' }); });
                    const els = playableCards();
                    if (!canon.length || !els.length) { this.note('skip: no card elements'); this.blockedSig = this.sig(gg); return; }
                    const k = Math.floor(driverRng() * canon.length);
                    const want = canon[k];
                    const c = els.find(e => e.dataset && e.dataset.card === want.card) || els[k];
                    this.note(`click card #${k}`);
                    c.click();
                });
            }
        },
        tour() {
            // Exercise the header / settings / modal wiring once per game.
            click('settings-btn');
            doc.querySelector(`.difficulty-btn[data-difficulty="${cfg.difficulty}"]`).click();
            click('settings-game-log');
            click('close-log-modal');
            click('settings-rules');
            click('close-rules');
            click('close-settings');
            if (el('settings-btn-mobile')) click('settings-btn-mobile'); else click('settings-btn');
            doc.getElementById('settings-modal').click(); // backdrop close
        },
        runAsserts() {
            const g = gs();
            const A = (name, ok, val) => { summary.asserts.push(`${name}:${ok ? 'ok' : 'FAIL(' + val + ')'}`); };
            A('phase=setup', g.gamePhase === 'setup', g.gamePhase);
            A('scores=0', g.player.score === 0 && g.computer.score === 0, `${g.player.score}:${g.computer.score}`);
            A('gameOver=false', g.gameOver === false, g.gameOver);
            A('modals-hidden', ['trump-selection-modal', 'game-over-modal', 'coin-toss-modal'].every(i => disp(i) === 'none'), ['trump-selection-modal', 'game-over-modal', 'coin-toss-modal'].map(disp));
            A('new-round-hidden', disp('new-round') === 'none', disp('new-round'));
            A('thinking-hidden', disp('thinking-indicator') === 'none', disp('thinking-indicator'));
            A('no-stale-state-change', !g.resolvingTrick && !g.computerThinking, `res=${g.resolvingTrick} think=${g.computerThinking}`);
            A('start-visible', disp('start-game') === 'block', disp('start-game'));
            events.push('[assert] ' + summary.asserts.join(' '));
        }
    };

    // ------------------------------------------------------------------ run
    snapshot('init');
    let guard = 0;
    const GUARD = Number(process.env.TRACE_GUARD || 60000);
    while (guard++ < GUARD) {
        D.observe();
        const t = clock.pop();
        if (!t) break;
        clock.now = t.due;

        try {
            t.fn(...t.args);
        } catch (e) {
            events.push('[error] ' + String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e));
        }
        await flush();
        snapshot(t.owner === 'driver' ? 'driver:' + t.label : 'timer');
    }
    const g = gs();
    out.push(`# end t=${clock.now} steps=${step} games=${summary.games} round=${g.roundNumber} score=${g.player.score}:${g.computer.score} guardHit=${guard >= GUARD}`);
    summary.end = { t: clock.now, steps: step, round: g.roundNumber, score: `${g.player.score}:${g.computer.score}` };
    dom.window.close();
    return { text: out.join('\n') + '\n', summary };
}

module.exports = { runScenario, PROFILES };
