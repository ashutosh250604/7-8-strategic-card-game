/*
 * character.js - the table's host and her local dialogue.
 *
 * Anne is a presentation-only character. She reads state after a render, says
 * short lines from a fixed local script, and never changes the deal, a card, a
 * score or the AI. The registry is shaped so a future table can add another
 * host without changing the seat, result screen or tutorial chrome.
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const ANNE_AVATAR = '../../assets/anne.svg';

    const LINES = {
        welcome: [
            'Pull up a chair. The cards are ready when you are.',
            'Take your time with the first five cards. Trump is the whole round.'
        ],
        playerScored: [
            'A point to you. I will be watching the trump more closely.',
            'That round was yours. Well read.',
            'You found the extra trick. Nicely played.'
        ],
        anneScored: [
            'That round is mine. The target is not a suggestion.',
            'I held the right cards at the right time. Another round?',
            'One to me. I will try not to make a habit of it.'
        ],
        playerRound: [
            'Good round. You kept your trumps for the moments that mattered.',
            'You read that well. I will have to change something.'
        ],
        anneRound: [
            'That one went my way. The next deal is a fresh table.',
            'A useful round for me. You are still very much in this.'
        ],
        playerTarget: [
            'Seven tricks. From here, every trick you win is a match point.',
            'You have reached the target. Now the score starts to move.'
        ],
        anneTarget: [
            'I have my tricks. Anything more is a point on my side.',
            'Target reached. The rest of this round is profit.'
        ],
        playerMatchPoint: [
            'One point from the match. The next round is the one that counts.',
            'Match point to you. I am not done yet.'
        ],
        anneMatchPoint: [
            'Match point to me. I intend to use it.',
            'One point from the table. You will need a strong reply.'
        ],
        matchWin: [
            'You took the table. That was a match worth playing.',
            'You earned every point. Rematch?'
        ],
        matchLoss: [
            'The table is mine this time. You made me work for it.',
            'A good match. I will deal the next one.'
        ],
        tutorial: [
            'I will show you the first decision. No score attached.',
            'This is the part that decides most rounds.'
        ]
    };

    const CHARACTERS = {
        anne: {
            id: 'anne',
            name: 'Anne',
            role: 'The card-table host',
            avatar: ANNE_AVATAR,
            profile: 'Confident, warm and competitive. She plays the cards she is dealt.'
        }
    };

    const registry = new Map(Object.entries(CHARACTERS));
    const slots = ['anne', null, null]; // room for the 3-2-5 and Coat & Shuffle hosts
    let lineIndex = 0;
    let reactionTimer = null;
    let lastScores = null;
    let lastTricks = { player: 0, computer: 0 };
    let lastMatchOpen = false;
    let welcomed = false;

    function current() {
        return registry.get('anne');
    }

    function nextLine(key) {
        const list = LINES[key] || LINES.welcome;
        // A small deterministic rotation keeps repeat visits varied without
        // pulling dialogue from a network service.
        const text = list[lineIndex % list.length];
        lineIndex++;
        return text;
    }

    function line(key) {
        return nextLine(key);
    }

    function showReaction(text, hold) {
        const bubble = $('anne-reaction');
        if (!bubble) return;
        if (reactionTimer) clearTimeout(reactionTimer);
        bubble.textContent = text;
        bubble.hidden = false;
        bubble.classList.add('is-visible');
        reactionTimer = setTimeout(() => {
            bubble.classList.remove('is-visible');
            reactionTimer = setTimeout(() => { bubble.hidden = true; }, 260);
        }, hold || 4200);
    }

    function updateDifficulty() {
        const value = window.TableSettings ? window.TableSettings.get().difficulty : 'medium';
        const label = value.charAt(0).toUpperCase() + value.slice(1);
        const badge = $('anne-difficulty');
        if (badge) badge.textContent = label;
        const seat = document.querySelector('.computer-area');
        if (seat) seat.setAttribute('aria-label', `Anne, playing at ${label} difficulty`);
    }

    function matchResult(winner) {
        const won = winner === 'Player';
        const portrait = $('anne-result-avatar');
        if (portrait) portrait.src = ANNE_AVATAR;
        const text = $('anne-result-line');
        if (text) text.textContent = line(won ? 'matchWin' : 'matchLoss');
        const bubble = $('anne-reaction');
        if (bubble) { bubble.hidden = true; bubble.classList.remove('is-visible'); }
        lastMatchOpen = true;
        return won ? 'matchWin' : 'matchLoss';
    }

    function resetMatch() {
        lastMatchOpen = false;
        lastScores = null;
        lastTricks = { player: 0, computer: 0 };
        welcomed = false;
        const bubble = $('anne-reaction');
        if (bubble) { bubble.hidden = true; bubble.classList.remove('is-visible'); }
    }

    function sync() {
        if (typeof GameEngine === 'undefined' || !GameEngine.state) return;
        const gs = GameEngine.state;
        updateDifficulty();

        if (!gs.gameStarted || gs.gameOver) {
            if (gs.gameOver) lastMatchOpen = true;
            return;
        }
        if (lastMatchOpen) resetMatch();
        if (!welcomed && gs.gamePhase === 'coin-toss') {
            welcomed = true;
            showReaction(line('welcome'), 3600);
        }

        const score = `${gs.player.score}:${gs.computer.score}`;
        const scoreChanged = lastScores !== null && score !== lastScores;
        if (scoreChanged) {
            const pGain = gs.player.score - Number(lastScores.split(':')[0]);
            const cGain = gs.computer.score - Number(lastScores.split(':')[1]);
            if (pGain > 0 || cGain > 0) {
                const target = gs.matchTarget || 5;
                if (gs.player.score >= target - 1 || gs.computer.score >= target - 1) {
                    showReaction(line(pGain > 0 ? 'playerMatchPoint' : 'anneMatchPoint'), 5200);
                } else {
                    showReaction(line(pGain > 0 ? 'playerScored' : 'anneScored'));
                }
            }
        }
        lastScores = score;

        // A single line when either side first reaches its trick target. Do not
        // narrate ordinary tricks; the table is already talking.
        const tricks = { player: gs.player.tricksWon, computer: gs.computer.tricksWon };
        const targets = { player: GameEngine.getTrickTarget('player'), computer: GameEngine.getTrickTarget('computer') };
        if (!scoreChanged) {
            for (const side of ['player', 'computer']) {
                if (targets[side] && tricks[side] === targets[side] && lastTricks[side] < targets[side]) {
                    showReaction(line(side === 'player' ? 'playerTarget' : 'anneTarget'), 4800);
                    break;
                }
            }
        }
        lastTricks = tricks;
    }

    function init() {
        updateDifficulty();
        document.addEventListener('tablesettings:change', updateDifficulty);
        document.addEventListener('gameview:render', sync);
        document.addEventListener('gameview:reset', resetMatch);
        const profile = current();
        const img = $('anne-portrait');
        if (img) img.src = profile.avatar;
        const intro = $('anne-seat-role');
        if (intro) intro.textContent = profile.role;
        sync();
    }

    window.TableCharacters = {
        current,
        get: (id) => registry.get(id) || null,
        line,
        showReaction,
        matchResult,
        resetMatch,
        slots: () => slots.slice(),
        ANNE_AVATAR
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
