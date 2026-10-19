/*
 * presentation.js - everything the player SEES and WAITS for.
 *
 * The engine (script.js) never touches the DOM and never knows how long anything
 * takes. It calls GameView.* to show things and advances the game by awaiting
 * "beats": GameView.beat(name) returns a Promise that resolves when that
 * presentation moment is over. Beats first wait for every running card animation
 * to finish, so gameplay always continues from a settled table; under
 * prefers-reduced-motion (or without GSAP) the same beats are short timers.
 *
 * Cards are persistent DOM elements: one element per card (hidden cards use a
 * pooled "back" element until they are revealed), moved between containers with
 * FLIP / arc animations instead of being rebuilt on every state change.
 *
 * Depends on: GameEngine (bottom of script.js, used lazily), gsap (optional).
 */
const GameView = (() => {
    const $ = (id) => document.getElementById(id);
    const hasGsap = typeof gsap !== 'undefined';
    const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const mqCoarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
    const canAnimate = () => hasGsap && !mqReduce.matches;

    const GLYPH = { hearts: '\u2665\uFE0E', diamonds: '\u2666\uFE0E', clubs: '\u2663\uFE0E', spades: '\u2660\uFE0E' };
    const SUIT_NAME = { hearts: 'hearts', diamonds: 'diamonds', clubs: 'clubs', spades: 'spades' };
    const RANK_NAME = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };
    const HAND_SUIT_ORDER = ['spades', 'hearts', 'clubs', 'diamonds']; // alternating colours
    const PIPS = {
        '7':  [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78], [50, 36]],
        '8':  [[28, 22], [72, 22], [28, 41], [72, 41], [28, 59], [72, 59], [28, 78], [72, 78]],
        '9':  [[28, 22], [72, 22], [28, 41], [72, 41], [28, 59], [72, 59], [28, 78], [72, 78], [50, 50]],
        '10': [[28, 22], [72, 22], [28, 41], [72, 41], [28, 59], [72, 59], [28, 78], [72, 78], [50, 31], [50, 69]]
    };

    // ------------------------------------------------------------------
    // Beats (pacing). Animated values are used when GSAP runs; the short
    // values apply to reduced motion / no-GSAP. Some beats are animations
    // (trick-cleared, coin-flip) and take as long as the animation takes.
    // ------------------------------------------------------------------
    const BEAT_MS = {
        'computer-response': 380, 'computer-think': 650, 'computer-lead': 420, 'trick-complete': 900,
        'trick-cleared': 850, 'round-end': 2200, 'computer-trump': 1000, 'deal-remaining': 350,
        'coin-flip': 1900, 'coin-result': 1100
    };
    const BEAT_MS_REDUCED = {
        'computer-response': 200, 'computer-think': 300, 'computer-lead': 200, 'trick-complete': 600,
        'trick-cleared': 400, 'round-end': 1500, 'computer-trump': 600, 'deal-remaining': 200,
        'coin-flip': 900, 'coin-result': 800
    };

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // ---- running-animation tracking -------------------------------------
    const pending = new Set(); // promises of running card animations
    function track(promise) {
        pending.add(promise);
        promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
    }
    async function whenIdle() {
        while (pending.size) await Promise.all([...pending]);
    }

    function beat(name, payload) {
        if (name === 'trick-cleared') return sweepTrick(payload);
        if (name === 'coin-flip') return coinFlip(payload);
        const table = canAnimate() ? BEAT_MS : BEAT_MS_REDUCED;
        return whenIdle().then(() => wait(table[name] || 0));
    }

    // ------------------------------------------------------------------
    // Sound hook (audio.js plugs in later; safe no-op until then)
    // ------------------------------------------------------------------
    const sfx = (name) => { if (window.GameAudio) window.GameAudio.play(name); };

    // ------------------------------------------------------------------
    // Log / status / thinking / toast
    // ------------------------------------------------------------------
    function log(message, type = '') {
        const logContent = $('game-log');
        if (!logContent) return;
        const logMessage = document.createElement('div');
        logMessage.className = `log-message ${type}`;
        logMessage.textContent = message;
        logContent.appendChild(logMessage);
        logContent.scrollTop = logContent.scrollHeight;
        const messages = logContent.querySelectorAll('.log-message');
        if (messages.length > 50) logContent.removeChild(messages[0]);
    }

    function clearLog() {
        const logContent = $('game-log');
        if (logContent) logContent.innerHTML = '<div class="log-message">Log cleared...</div>';
    }

    function status(message) {
        const el = $('game-status');
        if (el) el.innerHTML = `<span>${message}</span>`;
    }

    function thinking(show) {
        const el = $('thinking-indicator');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    let toastTimer = null;
    function toast(message, kind) {
        const el = $('toast');
        if (!el) return;
        el.textContent = message;
        el.className = `toast show ${kind || ''}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.className = 'toast'; }, 2400);
    }

    // ------------------------------------------------------------------
    // Persistent cards
    // ------------------------------------------------------------------
    const entries = new Map();   // key -> entry; key is the card id, or "h:<i>" for the computer's hidden hand cards
    let C = null;                // cached containers
    const prev = { cHand: [], slots: { player: [], computer: [] }, trump: null, counts: { player: 0, computer: 0 } };
    // The engine sometimes renders twice for one move (face-down reveal, then the card landing in the
    // trick). A card that vanishes is kept for exactly one render so it can fly to its next place.
    let limbo = new Map();
    let selectedEntry = null;

    function containers() {
        if (C) return C;
        const q = (s) => document.querySelector(s);
        C = {
            pHand: q('#player-hand .cards-container'), pUp: q('#player-faceup .cards-container'),
            cHand: q('#computer-hand .cards-container'), cUp: q('#computer-faceup .cards-container'),
            trickPlayer: q('.trick-slot.slot-player'), trickComputer: q('.trick-slot.slot-computer'),
            deck: $('deck'), board: q('.game-board')
        };
        [C.pUp, C.cUp].forEach((c) => { for (let i = 0; i < 5; i++) { const s = document.createElement('div'); s.className = 'slot'; c.appendChild(s); } });
        ['player', 'computer'].forEach((side) => {
            const m = document.querySelector(`#${side}-tricks .meter`);
            for (let i = 0; i < 15; i++) m.appendChild(document.createElement('i'));
        });
        return C;
    }

    function faceHTML(id) {
        const [rank, suit] = id.split('_');
        const g = GLYPH[suit];
        let center;
        if (rank === 'A') center = `<span class="ace">${g}</span>`;
        else if (PIPS[rank]) center = PIPS[rank].map(([x, y]) => `<span class="pip${y > 50 ? ' flip' : ''}" style="left:${x}%;top:${y}%">${g}</span>`).join('');
        else center = `<div class="court"><span class="court-letter">${rank}</span><span class="court-suit">${g}</span></div>`;
        return `<div class="idx tl"><b>${rank}</b><i>${g}</i></div><div class="center">${center}</div><div class="idx br"><b>${rank}</b><i>${g}</i></div>`;
    }

    function setIdentity(e, id) {
        const [, suit] = id.split('_');
        e.id = id;
        e.key = id;
        e.el.dataset.card = id;
        e.front.className = `card-face card-front ${suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black'} ${suit}`;
        e.front.innerHTML = faceHTML(id);
    }

    // The setup screen's cover illustration: the game's namesake 7 and 8 on the
    // felt. Built from the same faceHTML as live cards so it never drifts from
    // the deck's visual language. These are decorative and never enter `entries`.
    function initHero() {
        const fan = $('hero-fan');
        if (!fan || fan.childElementCount) return;
        [['7_hearts', 'left'], ['8_spades', 'right']].forEach(([id, spot]) => {
            const suit = id.split('_')[1];
            const card = document.createElement('div');
            card.className = `hero-card ${spot}`;
            const face = document.createElement('div');
            face.className = `card-face card-front ${suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black'} ${suit}`;
            face.innerHTML = faceHTML(id);
            card.appendChild(face);
            fan.appendChild(card);
        });
    }

    function makeEntry(key, id, face) {
        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = '<div class="card-lift"><div class="card-flip"><div class="card-face card-front"></div><div class="card-face card-back"></div></div></div>';
        const e = { key, id: null, el, leaving: false, front: el.querySelector('.card-front'), flip: el.querySelector('.card-flip'), lift: el.querySelector('.card-lift') };
        el.dataset.face = face;
        if (id) setIdentity(e, id);
        entries.set(key, e);
        return e;
    }

    function dropEntry(e) {
        killFx(e);
        e.el.remove();
        entries.delete(e.key);
        if (selectedEntry === e) selectedEntry = null;
    }

    function killFx(e) {
        if (!hasGsap) return;
        gsap.killTweensOf([e.el, e.lift, e.flip]);
        if (e.resolve) { e.resolve(); e.resolve = null; }
        e.el.classList.remove('flying');
    }

    // Deterministic little rotation so a card keeps its angle across re-renders.
    function jitter(id) {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
        return ((Math.abs(h) % 9) - 4) * 0.9;
    }

    // Move a card visually from rect r1 (where it was) to wherever it is now laid out (r2).
    function fly(e, r1, r2, o) {
        const el = e.el;
        const dx = r1.left - r2.left, dy = r1.top - r2.top, s = r2.width ? r1.width / r2.width : 1;
        const p = { t: 0 };
        const lift = o.lift || 0, rot = o.rot || 0;
        gsap.set(el, { transformOrigin: '0 0' });
        const apply = () => {
            const t = p.t, u = 1 - t;
            gsap.set(el, { x: dx * u, y: dy * u - lift * 4 * t * u, scale: s + (1 - s) * t });
            if (rot) gsap.set(e.lift, { rotation: rot * u });
        };
        apply();
        el.classList.add('flying');
        const promise = new Promise((resolve) => {
            e.resolve = resolve;
            gsap.to(p, {
                t: 1, duration: o.duration || 0.4, delay: o.delay || 0, ease: o.ease || 'power2.inOut', onUpdate: apply,
                onComplete: () => {
                    gsap.set(el, { clearProps: 'transform,transformOrigin' });
                    gsap.set(e.lift, { clearProps: 'transform' });
                    el.classList.remove('flying');
                    e.resolve = null;
                    resolve();
                }
            });
        });
        track(promise);
        return promise;
    }

    // Flip a card from back to front (or the reverse) in place.
    function flipTo(e, toFront, o) {
        const from = toFront ? 180 : 0, to = toFront ? 0 : 180;
        e.el.dataset.face = toFront ? 'front' : 'back';
        const promise = new Promise((resolve) => {
            const prevResolve = e.resolve;
            gsap.fromTo(e.flip, { rotationY: from }, {
                rotationY: to, duration: o.duration || 0.4, delay: o.delay || 0, ease: 'power2.out',
                onComplete: () => { gsap.set(e.flip, { clearProps: 'transform' }); resolve(); }
            });
            if (prevResolve) prevResolve();
        });
        track(promise);
        return promise;
    }

    // ------------------------------------------------------------------
    // Table rendering (state -> persistent DOM)
    // ------------------------------------------------------------------
    function handOrder(cards, trump) {
        return cards.slice().sort((a, b) => {
            const sa = GameEngine.getCardSuit(a.card), sb = GameEngine.getCardSuit(b.card);
            if (sa !== sb) {
                const ra = (sa === trump ? -10 : 0) + HAND_SUIT_ORDER.indexOf(sa);
                const rb = (sb === trump ? -10 : 0) + HAND_SUIT_ORDER.indexOf(sb);
                return ra - rb;
            }
            return GameEngine.getCardValue(b.card) - GameEngine.getCardValue(a.card);
        });
    }

    function cardLabel(card, state) {
        const [rank, suit] = card.split('_');
        return `${RANK_NAME[rank] || rank} of ${SUIT_NAME[suit]}${state ? ', ' + state : ''}`;
    }

    function render() {
        const gs = GameEngine.state;
        const c = containers();
        const animate = canAnimate();

        // 1. Measure where everything visually is right now, then snap to layout.
        const before = new Map();
        entries.forEach((e, k) => {
            if (e.leaving || !e.el.isConnected) return;
            before.set(k, e.el.getBoundingClientRect());
            if (hasGsap) { killFx(e); gsap.set(e.el, { clearProps: 'transform,transformOrigin' }); gsap.set([e.lift, e.flip], { clearProps: 'transform' }); }
        });

        // 2. Who plays next (computed from the table, so highlighting is right even
        //    when the engine renders just before it passes the turn).
        const trickLen = gs.trick.cards.length;
        const playerTurn = gs.gamePhase === 'playing' && !gs.resolvingTrick &&
            (trickLen === 1 ? gs.trick.cards[0].player === 'computer' : (trickLen === 0 && gs.currentPlayer === 'player'));
        const computerTurn = gs.gamePhase === 'playing' && !gs.resolvingTrick &&
            (trickLen === 1 ? gs.trick.cards[0].player === 'player' : (trickLen === 0 && gs.currentPlayer === 'computer'));

        // 3. Desired layout.
        const want = [];
        const sortedHand = handOrder(gs.player.hand.map((card, index) => ({ card, index })).filter((x) => x.card), gs.trumpSuit);
        sortedHand.forEach((x, pos) => want.push({ key: x.card, id: x.card, parent: c.pHand, pos, source: 'hand', index: x.index, side: 'player' }));
        gs.player.faceUp.forEach((card, i) => { if (card) want.push({ key: card, id: card, parent: c.pUp.children[i], slot: i, source: 'faceUp', index: i, side: 'player', up: true }); });
        const cHandIdx = [];
        gs.computer.hand.forEach((card, i) => { if (card) { cHandIdx.push(i); want.push({ key: `h:${i}`, id: null, parent: c.cHand, pos: cHandIdx.length - 1, side: 'computer' }); } });
        gs.computer.faceUp.forEach((card, i) => { if (card) want.push({ key: card, id: card, parent: c.cUp.children[i], slot: i, side: 'computer', up: true }); });
        gs.trick.cards.forEach((play) => want.push({ key: play.card, id: play.card, parent: play.player === 'player' ? c.trickPlayer : c.trickComputer, side: play.player, trick: true }));

        // 4. Hidden computer card that just left its hand becomes the card it played.
        const removedHidden = [];
        prev.cHand.forEach((idx) => { if (!cHandIdx.includes(idx)) removedHidden.push(idx); });

        const wantedKeys = new Set(want.map((w) => w.key));
        const created = [];
        want.forEach((w) => {
            let e = entries.get(w.key);
            if (!e && limbo.has(w.key)) {
                const l = limbo.get(w.key);
                e = l.e;
                entries.set(w.key, e);
                before.set(w.key, l.rect);
            }
            if (!e && w.id && w.trick) {
                // computer played from its hand: reuse the hidden element it came from
                const hiddenIdx = removedHidden.shift();
                const hidden = hiddenIdx === undefined ? null : entries.get(`h:${hiddenIdx}`);
                if (hidden && !wantedKeys.has(hidden.key)) {
                    entries.delete(hidden.key);
                    setIdentity(hidden, w.id);
                    entries.set(w.id, hidden);
                    e = hidden;
                    w.flipOpen = true;
                    before.set(w.id, before.get(`h:${hiddenIdx}`) || before.get(w.id));
                }
            }
            if (!e) {
                e = makeEntry(w.key, w.id, w.id ? 'front' : 'back');
                w.fresh = true;
                created.push(w);
            }
            w.entry = e;
        });

        // 5. Entries that are no longer on the table wait one render in limbo, then are discarded.
        const limboNext = new Map();
        entries.forEach((e, k) => {
            if (wantedKeys.has(k) || e.leaving) return;
            limboNext.set(k, { e, rect: before.get(k) });
            killFx(e);
            e.el.remove();
            entries.delete(k);
            if (selectedEntry === e) selectedEntry = null;
        });
        limbo = limboNext;

        // 6. Place elements.
        want.forEach((w) => {
            const e = w.entry, parent = w.parent;
            if (!parent) return;
            if (w.pos !== undefined) {
                const ref = parent.children[w.pos] || null;
                if (parent.children[w.pos] !== e.el) parent.insertBefore(e.el, ref);
            } else if (e.el.parentNode !== parent) {
                parent.appendChild(e.el);
            }
            const el = e.el;
            if (w.source) { el.dataset.source = w.source; el.dataset.index = w.index; } else { delete el.dataset.source; delete el.dataset.index; }
            el.classList.toggle('in-trick', !!w.trick);
            if (w.trick && !el.style.getPropertyValue('--rot')) el.style.setProperty('--rot', `${jitter(w.key)}deg`);
            if (!w.trick) el.style.removeProperty('--rot');
            el.classList.toggle('mine', w.side === 'player' && !w.trick);

            // playable / invalid (only the player's own cards, only on the player's turn)
            const mine = w.side === 'player' && !w.trick;
            el.classList.remove('playable', 'invalid', 'selected');
            if (mine) {
                let state = '';
                if (gs.gamePhase === 'playing' && playerTurn) {
                    // isValidPlay judges the side whose turn it is, so ask it only while that is the player
                    const ok = GameEngine.isValidPlayFor('player', w.id);
                    el.classList.add(ok ? 'playable' : 'invalid');
                    state = ok ? 'playable' : 'not playable, follow suit';
                }
                el.setAttribute('role', 'button');
                el.setAttribute('tabindex', '0');
                el.setAttribute('aria-label', cardLabel(w.id, state));
                el.setAttribute('aria-disabled', state.startsWith('not') ? 'true' : 'false');
            } else {
                el.removeAttribute('role'); el.removeAttribute('tabindex'); el.removeAttribute('aria-disabled');
                el.setAttribute('aria-label', w.id ? cardLabel(w.id, w.trick ? 'in the trick' : 'face up') : 'Hidden card');
            }
        });

        // Slots: show the hidden card peeking out beneath a face-up card.
        ['player', 'computer'].forEach((side) => {
            const slots = (side === 'player' ? c.pUp : c.cUp).children;
            for (let i = 0; i < 5; i++) slots[i].classList.toggle('has-under', !!gs[side].faceDown[i]);
        });

        // 7. Animate.
        const deckRect = c.deck ? c.deck.getBoundingClientRect() : null;
        if (animate) {
            let dealIdx = 0;
            want.forEach((w) => {
                const e = w.entry, r2 = e.el.getBoundingClientRect();
                const r1 = before.get(e.key);
                if (w.fresh && !w.trick) {
                    const reveal = w.up && prev.slots[w.side][w.slot];
                    if (reveal) {
                        flipTo(e, true, { duration: 0.5, delay: 0.05 });
                        sfx('flip');
                    } else if (deckRect) {
                        const delay = dealIdx++ * 0.05;
                        fly(e, deckRect, r2, { duration: 0.42, delay, lift: 18, ease: 'power2.out' });
                        if (w.id) flipTo(e, true, { duration: 0.32, delay: delay + 0.12 });
                        sfx('deal');
                    }
                } else if (w.fresh && w.trick) {
                    // a card that jumped straight into the trick (e.g. face-up card of the computer)
                    if (r1) fly(e, r1, r2, { duration: 0.4, lift: 36, rot: jitter(w.key) * 2 });
                } else if (r1) {
                    const moved = Math.abs(r1.left - r2.left) > 2 || Math.abs(r1.top - r2.top) > 2 || Math.abs(r1.width - r2.width) > 2;
                    if (!moved) return;
                    if (w.trick) {
                        fly(e, r1, r2, { duration: 0.46, lift: 46, rot: jitter(w.key) * 2.5, ease: 'power2.out' });
                        if (w.flipOpen) flipTo(e, true, { duration: 0.34, delay: 0.06 });
                        sfx('place');
                    } else {
                        fly(e, r1, r2, { duration: 0.32, ease: 'power2.out' });
                    }
                }
            });
        } else {
            want.forEach((w) => { if (w.flipOpen) w.entry.el.dataset.face = 'front'; });
        }

        // 8. Remember what this render looked like.
        prev.cHand = cHandIdx;
        prev.slots.player = gs.player.faceUp.slice();
        prev.slots.computer = gs.computer.faceUp.slice();

        renderHud(playerTurn, computerTurn, animate);
    }

    function renderHud(playerTurn, computerTurn, animate) {
        const gs = GameEngine.state;
        const c = containers();

        // Trump
        const td = $('trump-display');
        if (td) {
            if (gs.trumpSuit) {
                td.innerHTML = `<span class="trump-label">Trump</span><span class="trump-suit ${gs.trumpSuit}">${GLYPH[gs.trumpSuit]}</span>`;
                td.className = `trump-indicator trump-${gs.trumpSuit}`;
                td.setAttribute('aria-label', `Trump suit: ${gs.trumpSuit}`);
                if (c.board) c.board.dataset.trump = gs.trumpSuit;
                if (prev.trump !== gs.trumpSuit && animate) {
                    gsap.fromTo(td.querySelector('.trump-suit'), { scale: 0.2, rotation: -40 }, { scale: 1, rotation: 0, duration: 0.6, ease: 'back.out(2.2)' });
                    sfx('trump');
                }
            }
        }
        prev.trump = gs.trumpSuit;

        // Phase (lets the deck step back once the deal is complete)
        if (c.board) c.board.dataset.phase = gs.gamePhase;

        // Scores / round
        const sp = $('score-player'), sc = $('score-computer'), ri = $('round-info');
        if (sp) sp.textContent = gs.player.score;
        if (sc) sc.textContent = gs.computer.score;
        if (ri) ri.innerHTML = `<small>Round</small><b>${gs.roundNumber}</b>`;

        // Card-group counts and trick context
        const count = (id, n) => { const el = $(id); if (el) el.textContent = n; };
        count('player-hand-count', gs.player.hand.filter(Boolean).length);
        count('player-faceup-count', gs.player.faceUp.filter(Boolean).length);
        count('computer-hand-count', gs.computer.hand.filter(Boolean).length);
        count('computer-faceup-count', gs.computer.faceUp.filter(Boolean).length);
        const caption = $('trick-caption');
        if (caption) caption.textContent = `Trick ${Math.min(gs.trickCount + 1, 15)} of 15`;
        const lead = $('lead-chip');
        if (lead) {
            if (gs.trick.leadSuit) {
                lead.hidden = false;
                lead.innerHTML = `Lead <b>${GLYPH[gs.trick.leadSuit]}</b>`;
            } else {
                lead.hidden = true;
            }
        }

        // Tricks + targets + meters
        ['player', 'computer'].forEach((side) => {
            const box = $(`${side}-tricks`);
            const won = gs[side].tricksWon, target = GameEngine.getTrickTarget(side);
            box.querySelector('.trick-count').textContent = won;
            box.querySelector('.trick-target').textContent = target ? ` / ${target}` : '';
            const pips = box.querySelectorAll('.meter i');
            pips.forEach((pip, i) => {
                const isWon = i < won;
                const was = pip.classList.contains('won');
                pip.classList.toggle('won', isWon);
                pip.classList.toggle('target', !!target && i === target - 1);
                if (isWon && !was && animate && prev.counts[side] < won) gsap.fromTo(pip, { scale: 2.2 }, { scale: 1, duration: 0.45, ease: 'back.out(3)' });
            });
            prev.counts[side] = won;
        });

        // Turn indicator
        const pa = document.querySelector('.player-area'), ca = document.querySelector('.computer-area');
        if (pa) pa.classList.toggle('is-turn', !!playerTurn);
        if (ca) ca.classList.toggle('is-turn', !!computerTurn);
        const statusEl = $('game-status');
        if (statusEl) statusEl.classList.toggle('is-your-turn', !!playerTurn && gs.gamePhase === 'playing');

        updateRoundSummary(gs);
    }

    // End-of-round feedback lives on the table, not in a modal: it keeps the
    // final board readable while saying exactly why each side did or did not score.
    function updateRoundSummary(gs) {
        const el = $('round-summary');
        if (!el) return;
        const empty = (list) => !list.some(Boolean);
        const roundDone = gs.gamePhase === 'playing' && gs.trickCount >= 15 &&
            empty(gs.player.hand) && empty(gs.player.faceUp) && empty(gs.computer.hand) && empty(gs.computer.faceUp);
        const pTarget = GameEngine.getTrickTarget('player');
        const cTarget = GameEngine.getTrickTarget('computer');
        const board = document.querySelector('.game-board');
        if (!roundDone || pTarget === null || cTarget === null) {
            if (board) board.classList.remove('is-round-end');
            if (!el.hidden) { el.hidden = true; el.innerHTML = ''; }
            const st = $('game-status');
            if (st) st.classList.remove('is-muted');
            return;
        }
        const pPts = Math.max(0, gs.player.tricksWon - pTarget);
        const cPts = Math.max(0, gs.computer.tricksWon - cTarget);
        const pill = (name, won, target, pts) =>
            `<span class="round-pill${pts ? ' scored' : ''}"><b>${name}</b><span class="round-tricks">${won}<i> of ${target}</i></span><em>+${pts}</em></span>`;
        el.hidden = false;
        el.innerHTML = `<span class="round-summary-title">Round ${gs.roundNumber} complete</span>` +
            pill('You', gs.player.tricksWon, pTarget, pPts) +
            pill('Computer', gs.computer.tricksWon, cTarget, cPts);
        el.setAttribute('aria-label', `Round ${gs.roundNumber} complete. You won ${gs.player.tricksWon} of ${pTarget} tricks for ${pPts} points. Computer won ${gs.computer.tricksWon} of ${cTarget} tricks for ${cPts} points.`);
        if (board) board.classList.add('is-round-end');
        // The engine's plain status line would repeat this result word for word.
        const statusEl = $('game-status');
        if (statusEl) statusEl.classList.add('is-muted');
    }

    function hideRoundSummary() {
        const el = $('round-summary');
        if (!el) return;
        el.hidden = true;
        el.innerHTML = '';
        el.removeAttribute('aria-label');
        const statusEl = $('game-status');
        if (statusEl) statusEl.classList.remove('is-muted');
        const board = document.querySelector('.game-board');
        if (board) board.classList.remove('is-round-end');
    }

    // ------------------------------------------------------------------
    // Trick resolution: glow the winner, sweep both cards to their pile
    // ------------------------------------------------------------------
    let lastWinner = null;

    function highlightTrickWinner(winner) {
        lastWinner = winner;
        const winCard = document.querySelector(`.trick-slot.slot-${winner} .card`);
        if (winCard) winCard.classList.add('winning');
        const area = document.querySelector(winner === 'player' ? '.player-area' : '.computer-area');
        if (area) {
            area.classList.add('highlight-winner');
            setTimeout(() => area.classList.remove('highlight-winner'), 1200);
        }
    }

    function sweepTrick(payload) {
        const winner = (payload && payload.winner) || lastWinner || 'player';
        const els = [...document.querySelectorAll('.trick-slot .card')];
        const list = els.map((el) => [...entries.values()].find((e) => e.el === el)).filter(Boolean);
        list.forEach((e) => { e.leaving = true; });

        const finish = () => {
            list.forEach((e) => { e.leaving = false; dropEntry(e); });
        };

        if (!canAnimate() || !list.length) {
            return whenIdle().then(() => wait(canAnimate() ? BEAT_MS['trick-cleared'] : BEAT_MS_REDUCED['trick-cleared'])).then(finish);
        }

        sfx(winner === 'player' ? 'trickWin' : 'trickLose');
        const target = document.querySelector(`#${winner}-tricks .meter`).getBoundingClientRect();
        const tx = target.left + target.width / 2, ty = target.top + target.height / 2;
        const promise = new Promise((resolve) => {
            whenIdle().then(() => {
                const tl = gsap.timeline({ onComplete: () => { finish(); resolve(); } });
                list.forEach((e, i) => {
                    const r = e.el.getBoundingClientRect();
                    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                    e.el.classList.add('flying');
                    tl.to(e.el, { x: tx - cx, y: ty - cy, scale: 0.28, opacity: 0, rotation: winner === 'player' ? 12 : -12, duration: 0.5, ease: 'power3.in' }, 0.4 + i * 0.05);
                });
                tl.to({}, { duration: 0.05 });
            });
        });
        return track(promise);
    }

    // ------------------------------------------------------------------
    // Round / game buttons
    // ------------------------------------------------------------------
    function setDisplay(id, value) { const el = $(id); if (el) el.style.display = value; }
    // The start hero and the live table are two states of the same felt. The board
    // class drives which one is visible; the button keeps its inline display so the
    // engine/tests can still tell whether a game can be started.
    function setStartButton(show) {
        setDisplay('start-game', show ? 'block' : 'none');
        const board = document.querySelector('.game-board');
        if (board) board.classList.toggle('is-setup', !!show);
    }
    function setNewRoundButton(show) { setDisplay('new-round', show ? 'block' : 'none'); }
    function hideSelectTrumpButton() { setDisplay('select-trump-btn', 'none'); }

    function setSelectTrumpButton(eligible) {
        const btn = $('select-trump-btn');
        if (!btn) return;
        const modal = $('trump-selection-modal');
        const hidden = !modal || modal.style.display === 'none' || modal.style.display === '';
        btn.style.display = (eligible && hidden) ? 'block' : 'none';
    }

    // ------------------------------------------------------------------
    // Trump selection (a sheet over the table, your hand stays visible)
    // ------------------------------------------------------------------
    function showTrumpSelection(onPick) {
        const modal = $('trump-selection-modal');
        modal.style.display = 'flex';
        hideSelectTrumpButton();

        const counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
        GameEngine.state.player.hand.forEach((card) => { if (card) counts[GameEngine.getCardSuit(card)]++; });

        document.querySelectorAll('.trump-btn').forEach((btn) => {
            const suit = btn.dataset.suit;
            let hint = btn.querySelector('.suit-count');
            if (!hint) { hint = document.createElement('span'); hint.className = 'suit-count'; btn.appendChild(hint); }
            hint.textContent = counts[suit] === 1 ? '1 card' : `${counts[suit]} cards`;
            btn.onclick = () => {
                onPick(suit);
                modal.style.display = 'none';
            };
        });
        const first = modal.querySelector('.trump-btn');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
    }

    // ------------------------------------------------------------------
    // Coin toss (CSS 3D coin driven by GSAP)
    // ------------------------------------------------------------------
    function showCoinToss(onChoose) {
        const coin = $('coin'), coinChoice = $('coin-choice'), coinResult = $('coin-result');
        const btns = document.querySelectorAll('.coin-btn');
        if (hasGsap) gsap.set(coin, { clearProps: 'transform' });
        coin.className = 'coin';
        coinChoice.style.display = 'block';
        coinResult.style.display = 'none';
        btns.forEach((btn) => { btn.disabled = false; });
        $('coin-toss-modal').style.display = 'flex';
        btns.forEach((btn) => { btn.onclick = () => onChoose(btn.dataset.choice); });
        if (btns[0]) setTimeout(() => btns[0].focus({ preventScroll: true }), 50);
    }

    function coinTossBegin() {
        document.querySelectorAll('.coin-btn').forEach((btn) => { btn.disabled = true; });
        $('coin-choice').style.display = 'none';
        $('coin').className = 'coin flipping';
        sfx('coin');
    }

    function coinFlip(payload) {
        if (!canAnimate()) return wait(BEAT_MS_REDUCED['coin-flip']);
        const coin = $('coin');
        const turns = 360 * 5 + (payload && payload.result === 'tails' ? 180 : 0);
        const promise = new Promise((resolve) => {
            const tl = gsap.timeline({ onComplete: resolve });
            tl.fromTo(coin, { rotationX: 0 }, { rotationX: turns, duration: 1.7, ease: 'power2.out' }, 0);
            tl.to(coin, { y: -120, scale: 1.3, duration: 0.8, ease: 'power2.out' }, 0);
            tl.to(coin, { y: 0, scale: 1, duration: 0.9, ease: 'bounce.out' }, 0.8);
            tl.to({}, { duration: 0.15 });
        });
        return track(promise);
    }

    function coinTossReveal(result, playerWins) {
        const coin = $('coin'), coinResult = $('coin-result');
        if (hasGsap) gsap.set(coin, { clearProps: 'transform' });
        coin.className = `coin result-${result}`;
        coinResult.style.display = 'block';
        if (playerWins) {
            coinResult.className = 'coin-result win';
            coinResult.innerHTML = `<div class="coin-line">It's ${result.toUpperCase()}.</div><div>You won. You choose trump first.</div>`;
        } else {
            coinResult.className = 'coin-result lose';
            coinResult.innerHTML = `<div class="coin-line">It's ${result.toUpperCase()}.</div><div>Computer won. It chooses trump first.</div>`;
        }
        if (canAnimate()) gsap.fromTo(coinResult, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 });
    }

    function hideCoinToss() { setDisplay('coin-toss-modal', 'none'); }

    // ------------------------------------------------------------------
    // Game over
    // ------------------------------------------------------------------
    function showGameOver(winner, scores) {
        const modal = $('game-over-modal'), winnerText = $('winner-announcement'), finalScores = $('final-scores');
        if (!(modal && winnerText && finalScores)) return;
        if (winner === 'Player') {
            winnerText.textContent = 'You win';
            winnerText.className = 'winner-text win';
            sparks();
            sfx('victory');
        } else {
            winnerText.textContent = 'Computer wins';
            winnerText.className = 'winner-text lose';
            sfx('defeat');
        }
        finalScores.innerHTML = `<div class="final-line"><span>You</span><b>${scores.player}</b><i>&ndash;</i><b>${scores.computer}</b><span>Computer</span></div>`;
        modal.style.display = 'flex';
        const btn = $('play-again');
        if (btn) setTimeout(() => btn.focus({ preventScroll: true }), 80);
    }

    // A restrained burst of gold and ivory flecks (GSAP, cleaned up on completion).
    function sparks() {
        if (!canAnimate()) return;
        const layer = $('fx-layer');
        if (!layer) return;
        const colors = ['#e6c872', '#d6b25e', '#f6efdf', '#b8903a'];
        for (let i = 0; i < 36; i++) {
            const s = document.createElement('i');
            s.className = 'spark';
            s.style.background = colors[i % colors.length];
            s.style.left = `${Math.random() * 100}%`;
            layer.appendChild(s);
            gsap.fromTo(s, { y: -20, rotation: Math.random() * 360, opacity: 1 }, {
                y: window.innerHeight + 40, x: (Math.random() - 0.5) * 160, rotation: `+=${200 + Math.random() * 360}`,
                duration: 2.2 + Math.random() * 1.6, delay: Math.random() * 0.6, ease: 'power1.in',
                onComplete: () => s.remove()
            });
        }
    }

    // ------------------------------------------------------------------
    // Player input (delegated; mouse, touch, keyboard)
    // ------------------------------------------------------------------
    function entryOf(el) { return [...entries.values()].find((e) => e.el === el) || null; }

    function select(e) {
        if (selectedEntry && selectedEntry !== e) selectedEntry.el.classList.remove('selected');
        selectedEntry = e;
        if (e) e.el.classList.add('selected');
    }

    function reject(el) {
        const gs = GameEngine.state;
        let msg = 'Not your turn yet';
        if (gs.gamePhase === 'playing' && gs.currentPlayer === 'player' && !gs.resolvingTrick && gs.trick.leadSuit) {
            msg = `Follow suit: you must play a ${gs.trick.leadSuit.replace(/s$/, '')} ${GLYPH[gs.trick.leadSuit]}`;
        } else if (gs.gamePhase !== 'playing') {
            msg = 'Cards can be played once trump is chosen';
        }
        toast(msg, 'warn');
        sfx('invalid');
        if (canAnimate()) gsap.fromTo(el.querySelector('.card-lift'), { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.25)' });
    }

    function activate(el) {
        const e = entryOf(el);
        if (!e || el.dataset.source === undefined) return;
        // Touch: first tap raises the card, second tap plays it.
        if (mqCoarse.matches && selectedEntry !== e && el.classList.contains('playable')) { select(e); sfx('select'); return; }
        select(null);
        const ok = GameEngine.playCard(Number(el.dataset.index), el.dataset.source);
        if (!ok) reject(el);
    }

    function bindInput() {
        ['player-hand', 'player-faceup'].forEach((id) => {
            const root = $(id);
            root.addEventListener('click', (ev) => { const el = ev.target.closest('.card'); if (el && root.contains(el)) activate(el); });
            root.addEventListener('keydown', (ev) => {
                const el = ev.target.closest && ev.target.closest('.card');
                if (!el) return;
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(el); }
                else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
                    const row = [...document.querySelectorAll('#player-hand .card, #player-faceup .card')];
                    const next = row[row.indexOf(el) + (ev.key === 'ArrowRight' ? 1 : -1)];
                    if (next) { ev.preventDefault(); next.focus(); }
                }
            });
        });
        document.addEventListener('click', (ev) => { if (selectedEntry && !ev.target.closest('.card')) select(null); });
    }

    // ------------------------------------------------------------------
    // Restart
    // ------------------------------------------------------------------
    // The engine has already cancelled the old game's pending flow; this clears
    // everything visual that belongs to it, including running animations.
    function resetForRestart() {
        if (hasGsap) gsap.globalTimeline.clear();
        entries.forEach((e) => { if (e.resolve) e.resolve(); e.el.remove(); });
        entries.clear();
        limbo = new Map();
        pending.clear();
        selectedEntry = null;
        prev.cHand = []; prev.slots = { player: [], computer: [] }; prev.trump = null; prev.counts = { player: 0, computer: 0 };
        lastWinner = null;
        const layer = $('fx-layer'); if (layer) layer.innerHTML = '';

        const gameOverModal = $('game-over-modal'), trumpModal = $('trump-selection-modal');
        if (gameOverModal) gameOverModal.style.display = 'none';
        if (trumpModal) trumpModal.style.display = 'none';
        hideCoinToss();
        thinking(false);
        hideSelectTrumpButton();
        setStartButton(true);
        setNewRoundButton(false);

        if (C) {
            [C.pUp, C.cUp].forEach((cont) => [...cont.children].forEach((s) => { s.innerHTML = ''; s.classList.remove('has-under'); }));
            [C.pHand, C.cHand, C.trickPlayer, C.trickComputer].forEach((cont) => { cont.innerHTML = ''; });
            if (C.board) delete C.board.dataset.trump;
        }
        const td = $('trump-display');
        if (td) { td.innerHTML = '<span class="trump-label">Trump</span><span class="trump-suit">&ndash;</span>'; td.className = 'trump-indicator'; }
        const sp = $('score-player'), sc = $('score-computer'), ri = $('round-info');
        if (sp) sp.textContent = '0';
        if (sc) sc.textContent = '0';
        if (ri) ri.innerHTML = '<small>Round</small><b>1</b>';
        ['player', 'computer'].forEach((side) => {
            const box = $(`${side}-tricks`);
            box.querySelector('.trick-count').textContent = '0';
            box.querySelector('.trick-target').textContent = '';
            box.querySelectorAll('.meter i').forEach((p) => p.classList.remove('won', 'target'));
        });
        ['player-hand-count', 'player-faceup-count', 'computer-hand-count', 'computer-faceup-count'].forEach((id) => {
            const el = $(id); if (el) el.textContent = '0';
        });
        const caption = $('trick-caption');
        if (caption) caption.textContent = 'Trick 1 of 15';
        const lead = $('lead-chip');
        if (lead) { lead.hidden = true; lead.textContent = ''; }
        hideRoundSummary();
        const statusEl = $('game-status');
        if (statusEl) statusEl.classList.remove('is-your-turn');
        if (C && C.board) { C.board.dataset.phase = 'setup'; delete C.board.dataset.trump; }
        ['.player-area', '.computer-area'].forEach((s) => { const a = document.querySelector(s); if (a) a.classList.remove('is-turn', 'highlight-winner'); });
    }

    function init() { initHero(); containers(); bindInput(); }
    document.addEventListener('DOMContentLoaded', init);

    return {
        beat,
        log, clearLog, status, thinking, toast,
        render, highlightTrickWinner,
        setStartButton, setNewRoundButton, hideSelectTrumpButton, setSelectTrumpButton, hideRoundSummary,
        showTrumpSelection,
        showCoinToss, coinTossBegin, coinTossReveal, hideCoinToss,
        showGameOver,
        resetForRestart
    };
})();
