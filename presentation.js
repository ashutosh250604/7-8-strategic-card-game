/*
 * presentation.js - everything the player SEES and WAITS for.
 *
 * The engine (script.js) never touches the DOM and never knows how long anything
 * takes. It calls GameView.* to show things and advances the game by awaiting
 * "beats": GameView.beat(name) returns a Promise that resolves when that
 * presentation moment is over. Beats first wait for every running card animation
 * to finish, so gameplay always continues from a settled table; under the
 * in-app Calm setting (or without GSAP) the same beats are short timers.
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
    const mqCoarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
    const pref = () => (window.TableSettings ? window.TableSettings.get() : { motion: 'full' });
    // The in-app motion setting is the explicit choice. Full and Fast always
    // animate, even when the operating system asks for reduced motion (the
    // earlier code let that OS flag silently switch every animation off).
    // Reduced becomes a short, calm version instead of a static table.
    const motionMode = () => {
        const value = pref().motion;
        return value === 'reduced' ? 'calm' : value === 'fast' ? 'fast' : 'full';
    };
    const canAnimate = () => hasGsap;
    const motionScale = () => motionMode() === 'fast' ? 0.55 : motionMode() === 'calm' ? 0.4 : 1;
    const isCalm = () => motionMode() === 'calm';

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
        'trick-cleared': 850, 'round-end': 2200, 'computer-trump': 1000, 'deal-face-down': 520,
        'deal-remaining': 350, 'coin-flip': 1900, 'coin-result': 1100
    };
    const BEAT_MS_REDUCED = {
        'computer-response': 200, 'computer-think': 300, 'computer-lead': 200, 'trick-complete': 600,
        'trick-cleared': 400, 'round-end': 1500, 'computer-trump': 600, 'deal-face-down': 180,
        'deal-remaining': 200, 'coin-flip': 900, 'coin-result': 800
    };

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Safety net for the whole presentation layer. A beat that waits for a
    // GSAP timeline must still end when the browser stops pumping animation
    // frames (background tab, battery saver, a stuck compositor). Without this
    // the deal never runs and the table sits on "Shuffling the deck..." forever.
    function raceAnim(promise, ms) {
        return new Promise((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            promise.then(finish, finish);
            setTimeout(finish, ms);
        });
    }

    // ---- running-animation tracking -------------------------------------
    const pending = new Set(); // promises of running card animations
    const pendingWhy = new Map(); // promise -> short label, diagnostics only
    function track(promise, why) {
        pending.add(promise);
        if (why) pendingWhy.set(promise, why);
        promise.then(
            () => { pending.delete(promise); pendingWhy.delete(promise); },
            () => { pending.delete(promise); pendingWhy.delete(promise); }
        );
        return promise;
    }
    async function whenIdle() {
        // A tween can be killed by a re-render before it settles. Waiting on that
        // promise forever freezes the whole turn, so cap the wait: the next beat
        // starts while any straggler finishes on screen.
        let guard = 0;
        while (pending.size && guard++ < 6) {
            await raceAnim(Promise.all([...pending]), 900);
        }
        if (pending.size) pending.clear();
    }

    function beat(name, payload) {
        if (name === 'trick-cleared') return sweepTrick(payload);
        if (name === 'coin-flip') return coinFlip(payload);
        if (name === 'shuffle') return shuffleSequence();
        // Reduced motion is a promise about time, not only about transforms:
        // when someone asks the game to calm down, every beat uses the short
        // table even though GSAP is still available.
        const animated = canAnimate() && !isCalm();
        const table = animated ? BEAT_MS : BEAT_MS_REDUCED;
        // Hard takes a visible breath before a decision; easy plays snappily.
        // This is theatre, not computation: the chosen card is identical.
        const difficulty = (window.TableSettings ? window.TableSettings.get().difficulty : 'medium');
        const think = name === 'computer-think' || name === 'computer-lead'
            ? (difficulty === 'hard' ? 1.45 : difficulty === 'easy' ? 0.7 : 1)
            : 1;
        const duration = (table[name] || 0) * (animated ? motionScale() : 1) * think;
        return whenIdle().then(() => wait(duration));
    }

    // ------------------------------------------------------------------
    // Local sound and haptics (both fail silently when unavailable)
    // ------------------------------------------------------------------
    const sfx = (name, opts) => { if (window.GameAudio) window.GameAudio.play(name, opts); };
    const haptic = (name) => { if (window.GameHaptics) window.GameHaptics.vibrate(name); };

    // A small public event seam for the character layer. It carries no game
    // state and never influences a rule; it exists so Anne can react in the
    // moment instead of only after a full render.
    function event(name, payload) {
        try {
            document.dispatchEvent(new CustomEvent('gameview:event', { detail: { name, payload } }));
        } catch (e) {
            // CustomEvent is unavailable only in exotic embedders.
        }
    }

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
        event('thinking', { show });
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

    // ------------------------------------------------------------------
    // The shuffle. A real riffle, timed to the recorded sound.
    //
    // The recording is a riffle of about 1.4 s (cards cascading), a gather,
    // then two taps as the pack is squared on the felt at 3.1 s and 3.5 s. The
    // animation uses the same clock, so the halves split as the cascade starts
    // and the taps land on the recording's taps. Thirty real deck's worth of
    // cards are built for the beat and removed afterwards: presentation only,
    // no engine state is read and the deal is still decided by startNewRound.
    // ------------------------------------------------------------------
    const SHUFFLE_SECONDS = 4.0;   // timeline length (the file runs to 4.3)
    const SHUFFLE_CALM_SECONDS = 1.2;

    function shuffleSequence() {
        const board = document.querySelector('.game-board');
        const deck = $('deck');
        const calm = isCalm();
        const total = calm ? SHUFFLE_CALM_SECONDS : SHUFFLE_SECONDS;

        // Sound first, before any waiting: it is the clock the picture follows.
        sfx('shuffle', calm ? { maxSeconds: SHUFFLE_CALM_SECONDS } : undefined);

        if (!board || !deck) return wait(total * 1000);

        board.classList.add('is-shuffling');
        // Skip the opacity transition: the pack must be on the table the moment
        // the beat starts, or the first half of the riffle is invisible.
        deck.style.opacity = '1';
        deck.style.visibility = 'visible';

        // The static eight-card pile is replaced by the animated pack. Keep the
        // elements, just hide them, so restoring the deck at the end is a
        // single style change rather than a rebuild.
        const pile = [...deck.children].filter((el) => el.tagName === 'I');
        pile.forEach((el) => { el.style.opacity = '0'; });

        let rig = null;
        let cards = [];
        const finish = () => {
            if (rig) rig.remove();
            pile.forEach((el) => { el.style.opacity = ''; });
            board.classList.remove('is-shuffling');
            deck.style.opacity = '';
            deck.style.visibility = '';
        };

        if (!canAnimate()) return whenIdle().then(() => wait(total * 1000)).then(finish);

        const COUNT = 30;              // the real deck: 28 + two sevens
        const half = COUNT / 2;
        rig = document.createElement('div');
        rig.className = 'shuffle-rig';
        rig.dataset.riffle = 'two-packet';
        rig.dataset.cards = String(COUNT);
        deck.appendChild(rig);
        for (let i = 0; i < COUNT; i++) {
            const el = document.createElement('span');
            el.className = 'shuffle-card';
            el.style.opacity = '0';
            rig.appendChild(el);
            cards.push(el);
        }

        const promise = whenIdle().then(() => new Promise((resolve) => {
            const cw = Math.max(24, deck.clientWidth || 44);
            // The halves stay close: a riffle interleaves at the inner corners,
            // it does not tear the pack in two across the table. At 0.62 of a
            // card width the cut edges almost touch, which is what a real riffle
            // looks like; a wider split reads as four separate cards.
            const splitX = cw * 0.62;
            // Show the cut edge of each fifteen-card packet. Without a few pixels
            // of vertical offset the packet collapses into one flat card.
            const packetStep = 1.2;
            const stackStep = 0.9;
            // Landing order alternates the two halves: that is the riffle.
            const order = [];
            for (let i = 0; i < half; i++) order.push(i, i + half);
            order.forEach((idx, n) => { cards[idx]._stackY = -n * stackStep; cards[idx]._land = n; });

            gsap.set(cards, {
                x: 0, y: (i) => -i * 0.35, rotation: 0, opacity: 0,
                transformOrigin: '50% 88%'
            });
            const tl = gsap.timeline({ onComplete: resolve });

            // The pack is on the felt, then lifted. The recording's first card
            // sound is at 0.3 s, so the split starts exactly there.
            tl.set(cards, { opacity: 1 }, 0.14)
                .to(rig, { y: -10, rotation: -1.4, duration: 0.24, ease: 'power2.out' }, 0.04);

            if (calm) {
                // Reduced motion: the pack is lifted and set down, no cascade.
                tl.to(rig, { y: -6, duration: 0.3, ease: 'sine.inOut' }, 0.34)
                    .to(rig, { y: 0, duration: 0.36, ease: 'power2.out' }, 0.66)
                    .to(rig, { y: 0, duration: 0.2 }, 1.02);
                return;
            }

            // Split into two packets, the right half riding slightly higher and
            // the cut edges clearly apart. Every card in a packet shares its
            // angle: a packet leans on the table, it does not fan like a hand.
            cards.forEach((el, i) => {
                const isLeft = i < half;
                const n = i % half;
                tl.to(el, {
                    x: (isLeft ? -1 : 1) * (splitX + n * 0.16),
                    y: (isLeft ? -3.4 : 0.8) - n * packetStep,
                    rotation: isLeft ? 9.5 : -8.5,
                    duration: 0.19,
                    ease: 'power3.out'
                }, 0.26 + n * 0.0035);
            });

            // The recording has three papery riffle bursts. Release the pack in
            // three short waves so the picture and the sound share the same
            // beats, with one card from each packet alternating inside a wave.
            const riffleStart = 0.38;
            const waveSeconds = 0.38;
            order.forEach((idx, n) => {
                const el = cards[idx];
                const wave = Math.floor(n / 10);
                const within = n % 10;
                const at = riffleStart + wave * waveSeconds + within * 0.034 + Math.random() * 0.008;
                const landY = el._stackY;
                tl.to(el, { y: landY - 3.5, duration: 0.07, ease: 'power1.out' }, at)
                    .to(el, { x: 0, duration: 0.14, ease: 'power1.inOut' }, at)
                    .to(el, { y: landY, rotation: (Math.random() - 0.5) * 1.6, duration: 0.16, ease: 'power2.in' }, at + 0.06)
                    .to(el, { rotation: 0, duration: 0.08, ease: 'power1.out' }, at + 0.2);
            });

            // Gather: the pile bows up in the middle (the bridge) and springs
            // back down flat, which is the moment the two halves become a pack.
            tl.to(cards, {
                y: (i, el) => el._stackY - 5 * Math.sin(Math.PI * (el._land / (COUNT - 1))),
                duration: 0.2, ease: 'sine.inOut'
            }, 1.74)
                .to(cards, { y: (i, el) => el._stackY, duration: 0.3, ease: 'bounce.out' }, 2.0);

            // Square the pack with a couple of small side-to-side nudges.
            tl.to(rig, { rotation: 1.4, duration: 0.16, ease: 'sine.inOut' }, 2.34)
                .to(rig, { rotation: -0.8, duration: 0.18, ease: 'sine.inOut' }, 2.5)
                .to(rig, { rotation: -1.4, duration: 0.2, ease: 'sine.inOut' }, 2.68)
                // Two taps on the felt, on the recording's taps (3.18 / 3.58).
                .to(rig, { y: 2, duration: 0.11, ease: 'power2.in' }, 3.12)
                .to(rig, { y: 0, duration: 0.06, ease: 'power2.out' }, 3.2)
                .to(rig, { y: -7, duration: 0.13, ease: 'power1.out' }, 3.26)
                .to(rig, { y: 2, duration: 0.1, ease: 'power2.in' }, 3.5)
                .to(rig, { y: 0, duration: 0.06, ease: 'power2.out' }, 3.58)
                .to(rig, { rotation: 0, duration: 0.36, ease: 'power2.out' }, 3.5)
                .to(rig, { y: 0, rotation: 0, duration: 0.2 }, 3.82)
                // Leave the squared pack on the table for a beat before the deal.
                .to(rig, { scale: 1.02, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 3.84);
        }));
        // The guard is only for a stalled ticker; the timeline owns the beat.
        return raceAnim(promise, total * 1000 + 2500).then(finish);
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
            const prevResolve = e.resolve;
            function finish() {
                if (e.resolve === finish) e.resolve = null;
                resolve();
            }
            e.resolve = finish;
            const scale = motionScale();
            gsap.to(p, {
                t: 1, duration: (o.duration || 0.4) * scale, delay: (o.delay || 0) * scale, ease: o.ease || 'power2.inOut', onUpdate: apply,
                onComplete: () => {
                    gsap.set(el, { clearProps: 'transform,transformOrigin' });
                    gsap.set(e.lift, { clearProps: 'transform' });
                    el.classList.remove('flying');
                    finish();
                }
            });
            if (prevResolve) prevResolve();
        });
        track(promise, `fly ${e.key}`);
        return promise;
    }

    // Flip a card from back to front (or the reverse) in place.
    // The promise must settle even when a newer render kills the tween, otherwise
    // whenIdle() waits forever and every following game beat stalls.
    function flipTo(e, toFront, o) {
        const from = toFront ? 180 : 0, to = toFront ? 0 : 180;
        e.el.dataset.face = toFront ? 'front' : 'back';
        const promise = new Promise((resolve) => {
            const prevResolve = e.resolve;
            function finish() {
                if (e.resolve === finish) e.resolve = null;
                resolve();
            }
            e.resolve = finish;
            const scale = motionScale();
            gsap.fromTo(e.flip, { rotationY: from }, {
                rotationY: to, duration: (o.duration || 0.4) * scale, delay: (o.delay || 0) * scale, ease: 'power2.out',
                onComplete: () => { gsap.set(e.flip, { clearProps: 'transform' }); finish(); }
            });
            if (prevResolve) prevResolve();
        });
        track(promise, `flip ${e.key}`);
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
                        // A face-up card lands as a back, then turns over. This keeps
                        // the deal readable instead of showing every face mid-flight.
                        if (w.up) e.el.dataset.face = 'back';
                        fly(e, deckRect, r2, { duration: 0.42, delay, lift: 18, ease: 'power2.out' });
                        if (w.up) flipTo(e, true, { duration: 0.32, delay: delay + 0.34 });
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
            want.forEach((w) => {
                if (w.flipOpen || (w.fresh && w.up)) w.entry.el.dataset.face = 'front';
            });
        }

        // 8. Remember what this render looked like.
        prev.cHand = cHandIdx;
        prev.slots.player = gs.player.faceUp.slice();
        prev.slots.computer = gs.computer.faceUp.slice();

        renderHud(playerTurn, computerTurn, animate);
        // UI-only listeners (the first-round coach) read settled state after every render.
        document.dispatchEvent(new Event('gameview:render'));
    }

    function renderHud(playerTurn, computerTurn, animate) {
        const gs = GameEngine.state;
        const c = containers();

        // Trump
        const td = $('trump-display');
        if (td) {
            // Before a trump exists the pill is just a dash; hide it so the setup
            // HUD stays quiet (and narrow layouts keep their one useful row).
            td.hidden = !gs.trumpSuit;
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
        if (ri) {
            // "Round 2 to 5" read like a five-round match. The match is decided
            // by match points; the HUD says so plainly and leaves the deal count
            // to the trick caption and the round summary.
            const target = gs.matchTarget || 5;
            ri.innerHTML = `<small>First to</small><b>${target}</b><em>points</em>`;
            ri.setAttribute('aria-label', `First player to ${target} points wins the match`);
            ri.title = 'Points decide the match, not the number of rounds';
        }

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
            pill('Anne', gs.computer.tricksWon, cTarget, cPts);
        el.setAttribute('aria-label', `Round ${gs.roundNumber} complete. You won ${gs.player.tricksWon} of ${pTarget} tricks for ${pPts} points. Anne won ${gs.computer.tricksWon} of ${cTarget} tricks for ${cPts} points.`);
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

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            list.forEach((e) => { e.leaving = false; dropEntry(e); });
        };

        if (!canAnimate() || !list.length) {
            return whenIdle().then(() => wait(canAnimate() ? BEAT_MS['trick-cleared'] : BEAT_MS_REDUCED['trick-cleared'])).then(finish);
        }

        sfx(winner === 'player' ? 'trickWin' : 'trickLose');
        haptic(winner === 'player' ? 'trickWin' : 'trickLose');
        const target = document.querySelector(`#${winner}-tricks .meter`).getBoundingClientRect();
        const tx = target.left + target.width / 2, ty = target.top + target.height / 2;
        const promise = new Promise((resolve) => {
            whenIdle().then(() => {
                const tl = gsap.timeline({ onComplete: resolve });
                list.forEach((e, i) => {
                    const r = e.el.getBoundingClientRect();
                    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                    e.el.classList.add('flying');
                    tl.to(e.el, { x: tx - cx, y: ty - cy, scale: 0.28, opacity: 0, rotation: winner === 'player' ? 12 : -12, duration: 0.5, ease: 'power3.in' }, 0.4 + i * 0.05);
                });
                tl.to({}, { duration: 0.05 });
            });
        });
        return track(raceAnim(promise, 4000)).then(finish);
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
    function trumpMiniCard(card) {
        const parts = String(card || '').split('_');
        const rank = parts[0] || '';
        const suit = parts[1] || '';
        const red = suit === 'hearts' || suit === 'diamonds';
        return `<span class="trump-mini${red ? ' red' : ''}" aria-hidden="true"><b>${rank}</b><i>${GLYPH[suit] || ''}</i></span>`;
    }

    function showTrumpSelection(onPick) {
        const modal = $('trump-selection-modal');
        if (!modal) return;
        // Reopening the sheet must cancel an old confirmation timer rather than
        // closing the fresh sheet a fraction of a second after it appears.
        if (modal._trumpTimer) { clearTimeout(modal._trumpTimer); modal._trumpTimer = null; }
        delete modal.dataset.picking;
        modal.style.display = 'flex';
        hideSelectTrumpButton();
        const anneLine = $('trump-anne-text');
        if (anneLine && window.TableCharacters) anneLine.textContent = TableCharacters.line('trumpPrompt');

        const counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
        const bySuit = { hearts: [], diamonds: [], clubs: [], spades: [] };
        GameEngine.state.player.hand.forEach((card) => {
            if (!card) return;
            const suit = GameEngine.getCardSuit(card);
            if (!Object.prototype.hasOwnProperty.call(counts, suit)) return;
            counts[suit] += 1;
            bySuit[suit].push(card);
        });
        Object.values(bySuit).forEach((cards) => {
            cards.sort((a, b) => GameEngine.getCardValue(b) - GameEngine.getCardValue(a));
        });

        document.querySelectorAll('.trump-btn').forEach((btn) => {
            const suit = btn.dataset.suit;
            const cards = bySuit[suit] || [];
            const count = counts[suit] || 0;
            let hint = btn.querySelector('.suit-count');
            if (!hint) { hint = document.createElement('span'); hint.className = 'suit-count'; btn.appendChild(hint); }
            hint.textContent = count === 1 ? '1 card' : `${count} cards`;

            const cardRow = btn.querySelector('.trump-cards');
            if (cardRow) {
                cardRow.innerHTML = cards.length
                    ? cards.map(trumpMiniCard).join('')
                    : '<span class="trump-no-cards">None in hand</span>';
            }
            btn.classList.toggle('is-empty', count === 0);
            btn.classList.remove('is-picked');
            btn.setAttribute('aria-pressed', 'false');
            const cardNames = cards.map((card) => {
                const [rank, cardSuit] = card.split('_');
                return `${RANK_NAME[rank] || rank} of ${SUIT_NAME[cardSuit] || cardSuit}`;
            });
            btn.setAttribute('aria-label', count === 0
                ? `${suit}, no cards in your hand`
                : `${suit}, ${hint.textContent}. ${cardNames.join(', ')}`);
            btn.onclick = () => {
                if (modal.dataset.picking === '1') return;
                modal.dataset.picking = '1';
                modal.querySelectorAll('.trump-btn').forEach((other) => {
                    other.classList.toggle('is-picked', other === btn);
                    other.setAttribute('aria-pressed', other === btn ? 'true' : 'false');
                });
                onPick(suit);
                // Leave the chosen option lit for a beat. The table behind has
                // already advanced; this only lets the eye register the choice.
                modal._trumpTimer = setTimeout(() => {
                    if (modal.dataset.picking === '1') {
                        modal.style.display = 'none';
                        delete modal.dataset.picking;
                    }
                    modal._trumpTimer = null;
                }, 180);
            };
        });
        const first = modal.querySelector('.trump-btn');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
        document.dispatchEvent(new Event('gameview:trump'));
    }

    // ------------------------------------------------------------------
    // Coin toss (CSS 3D coin driven by GSAP)
    // ------------------------------------------------------------------
    function showCoinToss(onChoose) {
        const coin = $('coin'), rig = $('coin-rig'), shadow = $('coin-shadow');
        const coinChoice = $('coin-choice'), coinResult = $('coin-result');
        const btns = document.querySelectorAll('.coin-btn');
        if (hasGsap) gsap.set([coin, rig, shadow], { clearProps: 'transform' });
        coin.className = 'coin';
        coin.setAttribute('aria-label', 'A gold coin, ready to flip');
        coinChoice.style.display = 'block';
        coinResult.style.display = 'none';
        coinResult.innerHTML = '';
        btns.forEach((btn) => { btn.disabled = false; });
        $('coin-toss-modal').style.display = 'flex';
        btns.forEach((btn) => { btn.onclick = () => onChoose(btn.dataset.choice); });
        if (btns[0]) setTimeout(() => btns[0].focus({ preventScroll: true }), 50);
    }

    function coinTossBegin() {
        document.querySelectorAll('.coin-btn').forEach((btn) => { btn.disabled = true; });
        $('coin-choice').style.display = 'none';
        $('coin').setAttribute('aria-label', 'The coin is in the air');
        sfx('coin');
    }

    function coinFlip(payload) {
        // The engine has already chosen the result. This animation only lands on it.
        if (!canAnimate()) return wait(180);
        const coin = $('coin'), rig = $('coin-rig'), shadow = $('coin-shadow'), halo = document.querySelector('.coin-halo');
        // Three clean turns read as a flip; six blur into a disc. The final half
        // turn is what puts the called face down on the felt.
        const turns = 360 * (isCalm() ? 2 : 3) + (payload && payload.result === 'tails' ? 180 : 0);
        const scale = motionScale();
        const flipSeconds = (isCalm() ? 0.9 : 1.25) * scale;
        const promise = new Promise((resolve) => {
            const tl = gsap.timeline({ onComplete: resolve });
            gsap.set(rig, { y: 0, scale: 1 });
            gsap.set(coin, { rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1 });
            gsap.set(shadow, { scale: 1, opacity: 1 });
            if (halo) gsap.set(halo, { scale: 1, opacity: 0.85 });
            // The coin flips inside its own frame: it rises, turns over in the
            // light, then drops back with a bounce. Nothing leaves the card.
            tl.to(rig, { y: isCalm() ? -22 : -42, scale: isCalm() ? 1.08 : 1.22, duration: 0.42 * scale, ease: 'power2.out' }, 0)
                .to(shadow, { scale: 0.55, opacity: 0.3, duration: 0.42 * scale, ease: 'power2.out' }, 0)
                .to(coin, { rotationX: turns, rotationZ: 5, duration: flipSeconds, ease: 'power2.out' }, 0.04 * scale)
                .to(coin, { rotationZ: 0, duration: 0.4 * scale, ease: 'power2.out' }, flipSeconds * 0.7)
                .to(rig, { y: 0, scale: 1, duration: 0.62 * scale, ease: 'bounce.out' }, 0.42 * scale + flipSeconds * 0.72)
                .to(shadow, { scale: 1, opacity: 1, duration: 0.62 * scale, ease: 'bounce.out' }, 0.42 * scale + flipSeconds * 0.72)
                .to(coin, { scale: 1.08, duration: 0.1 * scale, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 1.34 * scale)
                .to({}, { duration: 0.2 * scale });
            // A glint across the metal while it is in the air.
            if (halo) tl.to(halo, { scale: 1.45, opacity: 0.35, duration: flipSeconds * 0.75, ease: 'sine.out' }, 0.1 * scale);
        });
        return track(raceAnim(promise, 5000), 'coin');
    }

    function coinTossReveal(result, playerWins) {
        const coin = $('coin'), rig = $('coin-rig'), shadow = $('coin-shadow'), coinResult = $('coin-result');
        if (hasGsap) gsap.set([coin, rig, shadow], { clearProps: 'transform' });
        coin.className = `coin result-${result}`;
        coin.setAttribute('aria-label', `The coin landed on ${result}`);
        coinResult.style.display = 'block';
        const resultWord = result.toUpperCase();
        if (playerWins) {
            coinResult.className = 'coin-result win';
            coinResult.innerHTML = `<div class="coin-line">${resultWord}</div><div>Your call. You choose trump first.</div>`;
        } else {
            coinResult.className = 'coin-result lose';
            coinResult.innerHTML = `<div class="coin-line">${resultWord}</div><div>Anne's call. She chooses trump first.</div>`;
        }
        sfx('coinLand');
        haptic('coin');
        if (canAnimate()) gsap.fromTo(coinResult, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 * motionScale() });
    }

    function hideCoinToss() {
        setDisplay('coin-toss-modal', 'none');
        if (hasGsap) {
            gsap.set([$('coin'), $('coin-rig'), $('coin-shadow')].filter(Boolean), { clearProps: 'transform' });
        }
    }

    // ------------------------------------------------------------------
    // Game over
    // ------------------------------------------------------------------
    function showGameOver(winner, scores) {
        const modal = $('game-over-modal'), winnerText = $('winner-announcement'), finalScores = $('final-scores');
        if (!(modal && winnerText && finalScores)) return;
        if (modal.style.display === 'flex') return; // never stack two result layers
        const won = winner === 'Player';
        modal.classList.toggle('is-win', won);
        const title = $('gameover-title');
        if (title) title.textContent = won ? 'A match well played' : 'The table is Anne\'s';
        winnerText.textContent = won ? 'You win the match' : 'Anne wins the match';
        winnerText.className = `winner-text ${won ? 'win' : 'lose'}`;
        const context = $('match-context');
        if (context) context.textContent = `First to ${scores.target} match points`;
        finalScores.innerHTML = `<div class="final-line"><span>You</span><b>${scores.player}</b><i>&ndash;</i><b>${scores.computer}</b><span>Anne</span></div>`;
        if (window.TableCharacters) window.TableCharacters.matchResult(winner);
        modal.style.display = 'flex';
        // Fireworks are an opt-in celebration. Stopping first also cleans up a
        // previous result if a rematch ended before the last loop had drained.
        const fireworksOn = !!(window.TableSettings && window.TableSettings.get().fireworks);
        if (window.TableFireworks) {
            window.TableFireworks.stop();
            if (won && fireworksOn) window.TableFireworks.start();
        }
        if (won) {
            if (!window.TableFireworks && fireworksOn) sparks();
            sfx('victory');
            haptic('victory');
        } else {
            sfx('defeat');
            haptic('defeat');
        }
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
        if (e) {
            e.el.classList.add('selected');
            sfx('select');
            haptic('select');
        }
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
        haptic('invalid');
        event('invalid', { leadSuit: gs.trick.leadSuit, phase: gs.gamePhase });
        if (canAnimate()) gsap.fromTo(el.querySelector('.card-lift'), { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.25)' });
    }

    function activate(el) {
        const e = entryOf(el);
        if (!e || el.dataset.source === undefined) return;
        // Touch: first tap raises the card, second tap plays it.
        if (mqCoarse.matches && selectedEntry !== e && el.classList.contains('playable')) { select(e); return; }
        select(null);
        const ok = GameEngine.playCard(Number(el.dataset.index), el.dataset.source);
        if (!ok) reject(el);
        else haptic('play');
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
        if (window.TableFireworks) window.TableFireworks.stop();
        if (hasGsap) gsap.globalTimeline.clear();
        const board = document.querySelector('.game-board');
        if (board) board.classList.remove('is-shuffling');
        const deck = $('deck');
        if (deck) {
            // A restart can land mid-riffle: drop the animated pack and put the
            // static deck back instead of leaving thirty cards on the felt.
            deck.querySelectorAll('.shuffle-rig').forEach((el) => el.remove());
            [...deck.children].forEach((el) => { if (el.tagName === 'I') el.style.opacity = ''; });
            if (hasGsap) gsap.set([...deck.children], { clearProps: 'transform,opacity' });
        }
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
        const coin = $('coin');
        if (coin) { coin.className = 'coin'; coin.setAttribute('aria-label', 'A gold coin, ready to flip'); }
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
        if (td) { td.innerHTML = '<span class="trump-label">Trump</span><span class="trump-suit">&ndash;</span>'; td.className = 'trump-indicator'; td.hidden = true; }
        const sp = $('score-player'), sc = $('score-computer'), ri = $('round-info');
        if (sp) sp.textContent = '0';
        if (sc) sc.textContent = '0';
        if (ri) {
            const target = GameEngine.state.matchTarget || 5;
            ri.innerHTML = `<small>First to</small><b>${target}</b><em>points</em>`;
            ri.title = 'Points decide the match, not the number of rounds';
        }
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
        document.dispatchEvent(new Event('gameview:reset'));
    }

    function init() { initHero(); containers(); bindInput(); }
    document.addEventListener('DOMContentLoaded', init);

    return {
        beat, event,
        log, clearLog, status, thinking, toast,
        render, highlightTrickWinner,
        // Pure face markup, shared with the tutorial so sample cards match the real table.
        cardFaceHTML: faceHTML,
        setStartButton, setNewRoundButton, hideSelectTrumpButton, setSelectTrumpButton, hideRoundSummary,
        showTrumpSelection,
        showCoinToss, coinTossBegin, coinTossReveal, hideCoinToss,
        showGameOver,
        resetForRestart,
        // Diagnostics only: lets tests tell a visual stall from a rule stall.
        pendingCount: () => pending.size,
        pendingLabels: () => [...pendingWhy.values()]
    };
})();
