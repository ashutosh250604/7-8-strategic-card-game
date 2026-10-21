/*
 * tutorial.js - opt-in first-round tutorial.
 *
 * This is UI-only. It teaches the three ideas a new player needs (trump choice,
 * the 8-vs-7 target, and following suit) on a fixed sample hand, so it never
 * changes gameState, the deck, the AI, or any rule. Finishing it simply starts
 * the normal game; the player can skip it and use the Tutorial button later.
 */
(function () {
    const $ = (id) => document.getElementById(id);
    const SEEN_KEY = '78-tutorial-seen-v1';
    const GLYPH = { hearts: '\u2665\uFE0E', diamonds: '\u2666\uFE0E', clubs: '\u2663\uFE0E', spades: '\u2660\uFE0E' };
    const SUIT_NAME = { hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs', spades: 'Spades' };
    const RED = { hearts: true, diamonds: true };

    let step = 0;              // 0 trump, 1 target, 2 follow, 3 recap
    let trumpAnswer = null;    // 'hearts' once correct
    let wrongTrump = null;
    let targetAnswer = null;   // '8' once correct
    let wrongTarget = null;
    let followAnswer = null;   // card id once a legal diamond is chosen
    let wrongFollow = null;
    let returnFocus = null;

    const readSeen = () => {
        try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
    };
    const markSeen = () => {
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* file:// or private mode */ }
        const invite = $('tutorial-invite');
        if (invite) invite.hidden = true;
    };

    // Small face used by the tutorial. It deliberately mirrors the real card
    // proportions and palette but is independent of GameView's card pool.
    function face(id) {
        const [rank, suit] = id.split('_');
        const red = RED[suit] ? ' red' : '';
        // Reuse the table's own face renderer so sample cards have the same pips,
        // court cards and proportions as the real deal.
        const inner = (typeof GameView !== 'undefined' && GameView.cardFaceHTML)
            ? GameView.cardFaceHTML(id)
            : `<span class="tut-fallback">${rank}${GLYPH[suit]}</span>`;
        return `<div class="card-face card-front${red}">${inner}</div>`;
    }
    const card = (id, extra = '') => `<div class="tut-card ${extra}" data-card="${id}">${face(id)}</div>`;
    const cardButton = (id, extra = '', locked = false) =>
        `<button class="tut-card tut-card-btn ${extra}" type="button" data-follow="${id}" ` +
        `aria-label="${id.split('_')[0]} of ${id.split('_')[1]}"${locked ? ' disabled' : ''}>${face(id)}</button>`;

    function feedback(kind, html) {
        if (!html) return '';
        return `<p class="tut-feedback ${kind}" role="status" aria-live="polite">${html}</p>`;
    }

    function actions(primary) {
        return `<div class="tut-actions">${primary}<button class="text-btn tut-skip" type="button" data-tut-close>Skip the tour</button></div>`;
    }

    // ------------------------------------------------------------------ steps
    function stepTrump() {
        const suits = ['hearts', 'spades', 'diamonds', 'clubs'];
        const counts = { hearts: 4, spades: 1, diamonds: 0, clubs: 0 };
        const buttons = suits.map((suit) => {
            const best = suit === 'hearts' && (trumpAnswer || wrongTrump) ? ' is-best' : '';
            const pressed = (trumpAnswer === suit || wrongTrump === suit) ? 'true' : 'false';
            return `<button class="tut-suit${best}" type="button" data-suit="${suit}" aria-pressed="${pressed}">` +
                `<span class="tut-suit-symbol${RED[suit] ? ' red' : ''}">${GLYPH[suit]}</span>` +
                `<span class="tut-suit-name">${SUIT_NAME[suit]}</span>` +
                `<span class="tut-suit-count">${counts[suit]} ${counts[suit] === 1 ? 'card' : 'cards'}</span>` +
                `</button>`;
        }).join('');

        let note = 'Pick the suit that gives your five cards the most strength.';
        if (wrongTrump) note = 'Any suit is legal, but look at the hand: <strong>four hearts, including the ace and king.</strong> Hearts is clearly the strongest trump here.';
        if (trumpAnswer) note = '<strong>Hearts.</strong> Four cards, including the ace and king. A strong suit to call trump.';

        return `
            <p class="tut-kicker">The decision</p>
            <h3 id="tutorial-title" class="tut-title">Choose your trump</h3>
            <p id="tutorial-desc" class="tut-copy">Your five hand cards decide this. Trump beats every other suit, so choose where your strength already is.</p>
            <div class="tut-hand" aria-label="Sample hand: ace, king, queen and eight of hearts, nine of spades">
                ${card('A_hearts')}${card('K_hearts')}${card('Q_hearts')}${card('8_hearts')}${card('9_spades')}
            </div>
            <div class="tut-suits" role="group" aria-label="Choose a trump suit">${buttons}</div>
            ${feedback(wrongTrump ? 'is-wrong' : trumpAnswer ? 'is-right' : '', note)}
            ${trumpAnswer ? actions('<button class="control-btn primary tut-next" type="button" data-tut-next>Next: the 8-vs-7 target</button>') : ''}
        `;
    }

    function stepTarget() {
        let note = 'Choose the number of tricks <strong>you</strong> must win to reach your target.';
        if (wrongTarget) note = 'Seven is <strong>Anne\'s</strong> target. Because you chose trump, your own target is <strong>8</strong>, one trick harder.';
        if (targetAnswer) note = '<strong>Correct.</strong> You need 8; Anne needs 7. Points come only from tricks above your target: 10 tricks scores 2 points.';

        const target = (value, label, sub, cls) => `
            <div class="tut-target ${cls}">
                <span>${label}</span>
                <b>${value}</b>
                <em>${sub}</em>
            </div>`;

        return `
            <p class="tut-kicker">The trade-off</p>
            <h3 id="tutorial-title" class="tut-title">Two targets: 8 and 7</h3>
            <p id="tutorial-desc" class="tut-copy">Choosing trump gives you power, but also the harder job. Only tricks won above your target become points.</p>
            <div class="tut-targets" aria-label="Targets: you need 8 tricks, Anne needs 7">
                ${target(8, 'You', 'chose trump', 'is-you')}
                <span class="tut-vs" aria-hidden="true">vs</span>
                ${target(7, 'Anne', 'did not choose', 'is-cpu')}
            </div>
            <div class="tut-quiz" role="group" aria-label="How many tricks must you win?">
                <button class="tut-quiz-btn${wrongTarget === '7' ? ' is-wrong' : ''}${targetAnswer === '8' ? ' is-dim' : ''}" type="button" data-target="7" aria-pressed="${wrongTarget === '7'}">7 tricks</button>
                <button class="tut-quiz-btn${targetAnswer === '8' ? ' is-right' : ''}" type="button" data-target="8" aria-pressed="${targetAnswer === '8'}">8 tricks</button>
            </div>
            ${feedback(wrongTarget ? 'is-wrong' : targetAnswer ? 'is-right' : '', note)}
            ${targetAnswer ? actions('<button class="control-btn primary tut-next" type="button" data-tut-next>Next: follow suit</button>') : ''}
        `;
    }

    function stepFollow() {
        let note = 'Anne led the <strong>9\u2666</strong>. You hold two diamonds and the ace of spades. Which card is legal?';
        if (wrongFollow) note = 'Not legal. You still hold diamonds, so you must follow the led suit. The ace of spades has to wait.';
        if (followAnswer === 'K_diamonds') note = '<strong>Legal, and it wins the trick.</strong> You followed diamonds; the ace of spades could not be played while you still held one.';
        if (followAnswer === '8_diamonds') note = '<strong>Legal, though it loses to the 9.</strong> Following suit is about the suit, not about winning the trick.';

        const played = followAnswer ? card(followAnswer, 'is-played') : '<span class="tut-empty">Your card</span>';

        return `
            <p class="tut-kicker">The rule that catches everyone</p>
            <h3 id="tutorial-title" class="tut-title">Follow suit if you can</h3>
            <p id="tutorial-desc" class="tut-copy">Anne led a diamond. You must play a diamond if you have one, even if it loses.</p>
            <div class="tut-trick" aria-label="Anne played the nine of diamonds">
                <div class="tut-trick-slot">
                    <span class="tut-slot-who">Anne</span>
                    ${card('9_diamonds')}
                </div>
                <span class="tut-trick-arrow" aria-hidden="true">\u2192</span>
                <div class="tut-trick-slot is-yours ${followAnswer ? 'has-card' : ''}" id="tut-follow-slot">
                    <span class="tut-slot-who">You</span>
                    ${played}
                </div>
            </div>
            <div class="tut-hand tut-hand-play" role="group" aria-label="Choose a card to play">
                ${['K_diamonds', '8_diamonds', 'A_spades']
                    .filter((id) => id !== followAnswer)
                    .map((id) => cardButton(id, '', !!followAnswer))
                    .join('')}
            </div>
            ${feedback(wrongFollow ? 'is-wrong' : followAnswer ? 'is-right' : '', note)}
            ${followAnswer ? actions('<button class="control-btn primary tut-next" type="button" data-tut-next>Finish</button>') : ''}
            <p class="tut-footnote">If you had no diamonds, you could play anything, including a trump.</p>
        `;
    }

    function stepRecap() {
        const started = typeof GameEngine !== 'undefined' && GameEngine.state && GameEngine.state.gameStarted;
        return `
            <p class="tut-kicker">You're ready</p>
            <h3 id="tutorial-title" class="tut-title">Three things to remember</h3>
            <p id="tutorial-desc" class="tut-copy">That is the whole first round. The table will guide you from here.</p>
            <ul class="tut-recap">
                <li><span>1</span><p><strong>Call trump where your hand is strong.</strong> You are betting you can win 8 tricks with it.</p></li>
                <li><span>2</span><p><strong>You need 8 tricks; Anne needs 7.</strong> Only tricks above your target score points.</p></li>
                <li><span>3</span><p><strong>Follow the led suit whenever you can.</strong> If you are void, you may play anything.</p></li>
            </ul>
            <div class="tut-actions">
                <button class="control-btn primary" type="button" data-tut-play>${started ? 'Back to the table' : 'Play my first round'}</button>
                <button class="text-btn" type="button" data-tut-review>Review again</button>
            </div>
            <p class="tut-footnote">The tour uses sample cards. Your real deal is untouched.</p>
        `;
    }

    // ------------------------------------------------------------------ render
    function render(focusSelector) {
        const body = $('tutorial-body');
        const modal = $('tutorial-modal');
        if (!body || !modal) return;

        const views = [stepTrump, stepTarget, stepFollow, stepRecap];
        body.innerHTML = views[step]();
        const guide = $('tutorial-guide-line');
        if (guide) {
            const lines = [
                'Start with the five cards you can see. Trump is a promise about where your strength lives.',
                'The trade-off is simple: choose trump and you take on eight tricks, not seven.',
                'Now the rule that decides most arguments at a table: follow the led suit.',
                'That is enough to sit down. I will stay for the first real round.'
            ];
            guide.textContent = lines[step];
        }

        const progress = modal.querySelectorAll('.tutorial-progress i');
        progress.forEach((pip, i) => {
            pip.classList.toggle('is-done', i < step);
            pip.classList.toggle('is-active', i === step);
        });
        const label = $('tutorial-step-label');
        if (label) label.textContent = step < 3 ? `Step ${step + 1} of 3` : 'Recap';

        bind();
        if (focusSelector) {
            const target = body.querySelector(focusSelector);
            if (target) setTimeout(() => { try { target.focus({ preventScroll: true }); } catch (e) { /* detached */ } }, 20);
        }
    }

    function bind() {
        const body = $('tutorial-body');
        if (!body) return;

        body.querySelectorAll('.tut-suit').forEach((btn) => {
            btn.onclick = () => {
                if (trumpAnswer) return;
                const suit = btn.dataset.suit;
                if (suit === 'hearts') {
                    trumpAnswer = 'hearts';
                    wrongTrump = null;
                    render('[data-suit="hearts"]');
                } else {
                    wrongTrump = suit;
                    render(`[data-suit="${suit}"]`);
                }
            };
        });

        body.querySelectorAll('.tut-quiz-btn').forEach((btn) => {
            btn.onclick = () => {
                if (targetAnswer) return;
                if (btn.dataset.target === '8') {
                    targetAnswer = '8';
                    wrongTarget = null;
                    render('[data-target="8"]');
                } else {
                    wrongTarget = '7';
                    render('[data-target="7"]');
                }
            };
        });

        body.querySelectorAll('[data-follow]').forEach((btn) => {
            btn.onclick = () => {
                if (followAnswer) return;
                const id = btn.dataset.follow;
                if (id.endsWith('_diamonds')) {
                    followAnswer = id;
                    wrongFollow = null;
                    render(`[data-follow="${id}"]`);
                } else {
                    wrongFollow = id;
                    render(`[data-follow="${id}"]`);
                }
            };
        });

        const next = body.querySelector('[data-tut-next]');
        if (next) next.onclick = () => { step = Math.min(3, step + 1); render(focusForStep()); };
        const play = body.querySelector('[data-tut-play]');
        if (play) play.onclick = playFirstRound;
        const review = body.querySelector('[data-tut-review]');
        if (review) review.onclick = () => {
            step = 0;
            trumpAnswer = wrongTrump = targetAnswer = wrongTarget = followAnswer = wrongFollow = null;
            render('[data-suit="hearts"]');
        };
        body.querySelectorAll('[data-tut-close]').forEach((btn) => { btn.onclick = close; });
    }

    function focusForStep() {
        if (step === 1) return '[data-target="8"]';
        if (step === 2) return '[data-follow="K_diamonds"]';
        if (step === 3) return '[data-tut-play]';
        return '[data-suit="hearts"]';
    }

    // ------------------------------------------------------------------ open / close
    function open(origin) {
        returnFocus = origin || document.activeElement;
        step = 0;
        trumpAnswer = wrongTrump = targetAnswer = wrongTarget = followAnswer = wrongFollow = null;
        const modal = $('tutorial-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        render('[data-suit="hearts"]');
    }

    function close() {
        const modal = $('tutorial-modal');
        if (!modal || modal.style.display === 'none') return;
        modal.style.display = 'none';
        markSeen();
        const back = returnFocus && returnFocus.isConnected ? returnFocus : $('start-tutorial');
        if (back) setTimeout(() => { try { back.focus({ preventScroll: true }); } catch (e) { /* detached */ } }, 20);
        returnFocus = null;
    }

    function playFirstRound() {
        const started = typeof GameEngine !== 'undefined' && GameEngine.state && GameEngine.state.gameStarted;
        close();
        if (!started) {
            // The tour ends here, but the first real round continues the same lesson:
            // the real trump choice and the first live follow-suit turn get a coach note.
            if (window.LiveCoach) window.LiveCoach.arm();
            const start = $('start-game');
            if (start) start.click();
        }
    }

    // ------------------------------------------------------------------ init
    function init() {
        const modal = $('tutorial-modal');
        const invite = $('tutorial-invite');
        const startBtn = $('tutorial-start');
        const dismissBtn = $('tutorial-dismiss');
        const headerBtn = $('start-tutorial');

        if (invite && !readSeen()) invite.hidden = false;
        if (startBtn) startBtn.onclick = () => open(startBtn);
        if (headerBtn) headerBtn.onclick = () => open(headerBtn);

        if (dismissBtn) {
            dismissBtn.onclick = () => {
                markSeen();
                if (invite) invite.hidden = true;
                if (headerBtn) headerBtn.focus({ preventScroll: true });
            };
        }

        const closeBtn = $('tutorial-close');
        if (closeBtn) closeBtn.onclick = close;

        if (!modal) return;

        // Backdrop click closes the tour (unlike the coin toss, it is optional).
        modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });

        document.addEventListener('keydown', (ev) => {
            if (modal.style.display === 'none') return;
            if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
            if (ev.key !== 'Tab') return;
            // Keep focus inside the dialog while it is open.
            const focusable = [...modal.querySelectorAll('button:not(:disabled), [href]')];
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
            else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        });
    }

    window.Tutorial = { open, close };

    document.addEventListener('DOMContentLoaded', init);
})();
