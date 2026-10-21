/*
 * coach.js - the tutorial's continuation at the real table.
 *
 * Armed only when a player finishes the sample-card tutorial. It is read-only:
 * it looks at GameEngine state, labels the strongest trump in the real hand and
 * explains the first live follow-suit decision. It never chooses a card, changes
 * the deal, or alters a rule. Coaching ends after the first follow-suit turn.
 */
(function () {
    const $ = (id) => document.getElementById(id);
    const GLYPH = { hearts: '\u2665\uFE0E', diamonds: '\u2666\uFE0E', clubs: '\u2663\uFE0E', spades: '\u2660\uFE0E' };
    const SUIT_NAME = { hearts: 'hearts', diamonds: 'diamonds', clubs: 'clubs', spades: 'spades' };
    const SUIT_LABEL = { hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs', spades: 'Spades' };
    const SUIT_SINGULAR = { hearts: 'heart', diamonds: 'diamond', clubs: 'club', spades: 'spade' };
    const SUITS = ['hearts', 'spades', 'diamonds', 'clubs'];

    let armed = false;
    let followTaught = false;
    let followActive = false;
    let leadTaught = false;
    let targetTaught = false;
    let completingUntil = 0;
    let hideTimer = null;
    let lastHTML = '';

    const short = (card) => {
        const [rank, suit] = card.split('_');
        return `${rank}${GLYPH[suit] || ''}`;
    };
    const value = (card) => GameEngine.getCardValue(card);
    const suitOf = (card) => GameEngine.getCardSuit(card);

    function visiblePlayerCards() {
        const gs = GameEngine.state;
        const cards = [];
        gs.player.hand.forEach((card, index) => { if (card) cards.push({ card, source: 'hand', index }); });
        gs.player.faceUp.forEach((card, index) => { if (card) cards.push({ card, source: 'faceUp', index }); });
        return cards;
    }

    function strongestSuit(hand) {
        const stats = {};
        SUITS.forEach((suit) => { stats[suit] = { suit, count: 0, high: 0, cards: [] }; });
        hand.filter(Boolean).forEach((card) => {
            const suit = suitOf(card);
            if (!stats[suit]) return;
            stats[suit].count++;
            stats[suit].cards.push(card);
            if (value(card) >= 11) stats[suit].high++;
        });
        return SUITS
            .map((suit) => stats[suit])
            .filter((s) => s.count > 0)
            .sort((a, b) => {
                const score = (s) => s.high * 2 + s.count;
                if (score(b) !== score(a)) return score(b) - score(a);
                const best = (s) => Math.max(...s.cards.map(value));
                if (best(b) !== best(a)) return best(b) - best(a);
                return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
            })[0] || null;
    }

    function clearPicks() {
        document.querySelectorAll('.card.coach-pick').forEach((el) => el.classList.remove('coach-pick'));
    }

    function findCardEl(entry) {
        const root = entry.source === 'hand' ? 'player-hand' : 'player-faceup';
        return document.querySelector(`#${root} .card[data-source="${entry.source}"][data-index="${entry.index}"]`);
    }

    // ------------------------------------------------------------------ bar
    function barEl() { return $('live-coach'); }

    function setBar(html) {
        const bar = barEl();
        if (!bar) return;
        if (html === lastHTML && !bar.hidden) return;
        lastHTML = html;
        bar.innerHTML = '<span class="live-coach-mark" aria-hidden="true">Coach</span>' +
            `<div class="live-coach-copy">${html}</div>` +
            '<button class="live-coach-close" type="button" data-coach-dismiss aria-label="Dismiss coaching">Got it</button>';
        bar.hidden = false;
        const info = bar.closest('.center-info');
        if (info) info.classList.add('is-coached');
    }

    function hideBar() {
        const bar = barEl();
        if (!bar) return;
        bar.hidden = true;
        bar.innerHTML = '';
        lastHTML = '';
        const info = bar.closest('.center-info');
        if (info) info.classList.remove('is-coached');
        clearPicks();
    }

    // ------------------------------------------------------------- trump note
    function clearTrumpCoach() {
        const box = $('live-coach-trump');
        if (box) { box.hidden = true; box.innerHTML = ''; }
        document.querySelectorAll('.trump-btn').forEach((btn) => {
            btn.classList.remove('is-coach-pick');
            btn.removeAttribute('aria-describedby');
            const tag = btn.querySelector('.suit-coach');
            if (tag) tag.remove();
        });
    }

    function trumpCoachMarkup(best) {
        const highCards = best.cards.filter((c) => value(c) >= 11).sort((a, b) => value(b) - value(a));
        const shown = best.cards.slice().sort((a, b) => value(b) - value(a)).map(short);
        let why;
        if (best.count === 1) {
            why = `Your hand is spread out, but <strong>${SUIT_LABEL[best.suit]}</strong> gives you its highest card, <strong>${short(best.cards[0])}</strong>. It is the safest call.`;
        } else if (highCards.length >= 2) {
            why = `<strong>${SUIT_LABEL[best.suit]}</strong> is your strongest suit: ${best.count} cards, including ${highCards.slice(0, 2).map(short).join(' and ')}. That is where your eight tricks can come from.`;
        } else {
            why = `<strong>${SUIT_LABEL[best.suit]}</strong> is your strongest suit: ${best.count} cards (${shown.join(', ')}). Calling it gives you the best chance at eight tricks.`;
        }
        return '<div class="trump-coach-head"><span>Coach pick</span><button class="trump-coach-off" type="button" data-coach-off>Skip coaching</button></div>' +
            `<p>${why} Trump beats every other suit, but calling it sets <strong>your target to 8 tricks</strong>; Anne needs 7.</p>`;
    }

    function renderTrumpCoach() {
        const gs = GameEngine.state;
        const modal = $('trump-selection-modal');
        const box = $('live-coach-trump');
        if (!box || !modal || modal.style.display === 'none' || gs.lastTrumpSelector !== 'player') {
            clearTrumpCoach();
            return;
        }
        const best = strongestSuit(gs.player.hand);
        if (!best) { clearTrumpCoach(); return; }

        box.innerHTML = trumpCoachMarkup(best);
        box.hidden = false;
        const off = box.querySelector('[data-coach-off]');
        if (off) off.onclick = disarm;

        document.querySelectorAll('.trump-btn').forEach((btn) => {
            const pick = btn.dataset.suit === best.suit;
            btn.classList.toggle('is-coach-pick', pick);
            if (pick) btn.setAttribute('aria-describedby', 'live-coach-trump');
            else btn.removeAttribute('aria-describedby');
            let tag = btn.querySelector('.suit-coach');
            if (pick && !tag) {
                tag = document.createElement('span');
                tag.className = 'suit-coach';
                tag.textContent = 'Coach pick';
                btn.appendChild(tag);
            } else if (!pick && tag) {
                tag.remove();
            }
        });
    }

    // ------------------------------------------------------------ table note
    function targetNote() {
        const gs = GameEngine.state;
        if (!gs.trumpSuit) return '';
        const playerTarget = GameEngine.getTrickTarget('player');
        const cpuTarget = GameEngine.getTrickTarget('computer');
        const who = gs.lastTrumpSelector === 'player' ? 'You called' : 'Anne called';
        return `${who} <strong>${SUIT_LABEL[gs.trumpSuit]} ${GLYPH[gs.trumpSuit]}</strong>. ` +
            `You need <strong>${playerTarget}</strong> tricks; Anne needs <strong>${cpuTarget}</strong>.`;
    }

    function showFollowCoach(gs, prefix = '') {
        const lead = gs.trick.leadSuit;
        const led = gs.trick.cards[0] && gs.trick.cards[0].card;
        if (!lead || !led) return;
        const visible = visiblePlayerCards();
        const suited = visible.filter((c) => suitOf(c.card) === lead).sort((a, b) => value(a.card) - value(b.card));
        const legal = visible.filter((c) => GameEngine.isValidPlayFor('player', c.card));

        clearPicks();
        if (!suited.length) {
            setBar(prefix + `Anne led <strong>${short(led)}</strong>. You have no ${SUIT_NAME[lead]}, so <strong>any card is legal</strong>, including a trump.`);
            return;
        }

        const ledValue = value(led);
        const winners = suited.filter((c) => value(c.card) > ledValue);
        const pick = winners.length ? winners[0] : suited[0];
        const el = findCardEl(pick);
        if (el) el.classList.add('coach-pick');

        if (suited.length === 1) {
            const wins = value(pick.card) > ledValue;
            setBar(prefix + `Anne led <strong>${short(led)}</strong>. You hold one ${SUIT_SINGULAR[lead]}, so you must follow ${SUIT_NAME[lead]}. Play <strong>${short(pick.card)}</strong>${wins ? ', and it wins the trick.' : ', even though it loses.'}`);
        } else if (winners.length) {
            setBar(prefix + `Anne led <strong>${short(led)}</strong>. You hold ${suited.length} ${SUIT_NAME[lead]}, so you must follow suit. <strong>${short(pick.card)}</strong> is legal and wins the trick.`);
        } else {
            setBar(prefix + `Anne led <strong>${short(led)}</strong>. You must follow ${SUIT_NAME[lead]}: <strong>${short(pick.card)}</strong> is legal, though it loses to the ${short(led)}.`);
        }

        // Keep the explanation honest: there should always be at least one legal card here.
        if (!legal.length) hideBar();
    }

    function finishFollow() {
        if (!followActive) return;
        followActive = false;
        followTaught = true;
        armed = false;
        completingUntil = Date.now() + 6500;
        setBar('<strong>You followed suit.</strong> That is the rule that catches everyone. The rest of the round is yours.');
        clearPicks();
        const until = completingUntil;
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (completingUntil === until) {
                completingUntil = 0;
                hideBar();
            }
        }, 6500);
    }

    function syncPlay(gs) {
        if (gs.currentPlayer !== 'player' || gs.resolvingTrick) {
            if (followActive) finishFollow();
            // While Anne takes the first turn, keep the target / called
            // trump on screen instead of a bare "Anne is playing" status.
            else if (!completingUntil && !targetTaught) {
                // Leave targetTaught false so the player's first follow/lead note
                // repeats the target once, at the moment they have to act.
                setBar(targetNote());
            }
            return;
        }
        if (gs.trick.cards.length === 0) {
            // Show this once and leave it up while the player considers the lead.
            if (!leadTaught) {
                leadTaught = true;
                const prefix = targetTaught ? '' : targetNote() + ' ';
                targetTaught = true;
                setBar(prefix + 'You lead the first trick. <strong>Any card is legal</strong>. Lead from the suit where your hand is strongest.');
            }
            return;
        }
        if (gs.trick.cards.length === 1) {
            // The engine renders once before it hands the turn over. Only the
            // computer's led card starts a follow-suit lesson; the player's own
            // lead is not a follow, even while currentPlayer still says player.
            if (gs.trick.cards[0].player !== 'computer') {
                return;
            }
            if (!followTaught) {
                followActive = true;
                const prefix = targetTaught ? '' : targetNote() + ' ';
                targetTaught = true;
                showFollowCoach(gs, prefix);
            } else if (!completingUntil) {
                hideBar();
            }
            return;
        }
        if (followActive) finishFollow();
        else if (!completingUntil) hideBar();
    }

    function sync() {
        if (typeof GameEngine === 'undefined' || !GameEngine.state) return;
        const gs = GameEngine.state;

        if (!armed) {
            if (completingUntil && Date.now() < completingUntil) return;
            completingUntil = 0;
            hideBar();
            clearTrumpCoach();
            return;
        }

        if (!gs.gameStarted) {
            hideBar();
            clearTrumpCoach();
            return;
        }
        if (gs.gameOver || gs.roundNumber > 1) {
            disarm();
            return;
        }

        if (gs.gamePhase === 'trump-selection') {
            hideBar();
            if (gs.lastTrumpSelector === 'player') {
                renderTrumpCoach();
            } else {
                clearTrumpCoach();
                setBar('Anne won the toss and is choosing trump. You will need <strong>7</strong> tricks this round; she needs 8.');
            }
            return;
        }

        clearTrumpCoach();

        if (gs.gamePhase === 'dealing-remaining') {
            // The next render (playing) carries the target note; do not flash a
            // second message while the remaining cards are still landing.
            return;
        }
        if (gs.gamePhase !== 'playing') {
            hideBar();
            return;
        }
        syncPlay(gs);
    }

    function arm() {
        armed = true;
        followTaught = false;
        followActive = false;
        leadTaught = false;
        targetTaught = false;
        completingUntil = 0;
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        hideBar();
        clearTrumpCoach();
        sync();
    }

    function disarm() {
        armed = false;
        followActive = false;
        completingUntil = 0;
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        hideBar();
        clearTrumpCoach();
    }

    function init() {
        const bar = barEl();
        if (bar) {
            bar.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-coach-dismiss]')) disarm();
            });
        }
        document.addEventListener('gameview:render', () => {
            sync();
            // currentPlayer is handed over immediately after render; one tick later
            // is the first moment the coach can see whose turn it really is.
            setTimeout(sync, 0);
        });
        document.addEventListener('gameview:trump', sync);
        document.addEventListener('gameview:reset', disarm);
        sync();
    }

    window.LiveCoach = {
        arm,
        disarm,
        sync,
        state: () => ({ armed, followTaught, followActive, leadTaught, targetTaught, completing: !!completingUntil })
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
