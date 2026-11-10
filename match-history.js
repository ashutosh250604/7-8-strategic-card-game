/*
 * match-history.js - the last few finished matches, saved on this device.
 *
 * Presentation/debugging data only: match history never feeds the AI or the
 * rules. The engine records one entry when a match ends; this module validates
 * whatever localStorage actually contains before it reaches the DOM.
 */
(function () {
    'use strict';

    const KEY = '78-match-history-v1';
    const LIMIT = 8;
    const MAX_TRUMPS = 24;
    const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
    const GLYPH = { hearts: '♥︎', diamonds: '♦︎', clubs: '♣︎', spades: '♠︎' };
    const SUIT_NAME = { hearts: 'hearts', diamonds: 'diamonds', clubs: 'clubs', spades: 'spades' };
    const DIFFICULTIES = ['easy', 'medium', 'hard'];

    function normaliseTrump(value) {
        if (!value || typeof value !== 'object') return null;
        if (!SUITS.includes(value.suit)) return null;
        if (value.selector !== 'player' && value.selector !== 'computer') return null;
        return { suit: value.suit, selector: value.selector };
    }

    function normaliseEntry(value) {
        if (!value || typeof value !== 'object') return null;
        if (value.result !== 'win' && value.result !== 'loss') return null;
        if (!Number.isInteger(value.playerScore) || value.playerScore < 0 || value.playerScore > 99) return null;
        if (!Number.isInteger(value.computerScore) || value.computerScore < 0 || value.computerScore > 99) return null;
        if (![3, 5, 7].includes(value.target)) return null;
        let playedAt = Number.isFinite(value.playedAt) && value.playedAt > 0 ? value.playedAt : Date.now();
        if (!Number.isFinite(new Date(playedAt).getTime())) playedAt = Date.now();
        const difficulty = DIFFICULTIES.includes(value.difficulty) ? value.difficulty : 'medium';
        const trumps = Array.isArray(value.trumps)
            ? value.trumps.map(normaliseTrump).filter(Boolean).slice(0, MAX_TRUMPS)
            : [];
        return {
            result: value.result,
            playerScore: value.playerScore,
            computerScore: value.computerScore,
            target: value.target,
            difficulty,
            trumps,
            playedAt
        };
    }

    function read() {
        try {
            if (typeof localStorage === 'undefined') return [];
            const raw = localStorage.getItem(KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(normaliseEntry).filter(Boolean).slice(0, LIMIT);
        } catch (e) {
            return [];
        }
    }

    function add(entry) {
        const clean = normaliseEntry(entry);
        if (!clean) return read();
        const entries = [clean, ...read()].slice(0, LIMIT);
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(entries));
        } catch (e) {
            // Private mode or a full quota: show the history for this page load
            // rather than breaking the result screen.
        }
        return entries;
    }

    function callLabel(call) {
        return `${call.selector === 'player' ? 'You' : 'Anne'} called ${SUIT_NAME[call.suit]}`;
    }

    function shortDate(timestamp) {
        const date = new Date(timestamp);
        if (!Number.isFinite(date.getTime())) return '';
        return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
    }

    function fullDate(timestamp) {
        const date = new Date(timestamp);
        if (!Number.isFinite(date.getTime())) return '';
        return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
    }

    function summarize(entries) {
        const list = Array.isArray(entries) ? entries : [];
        const wins = list.filter((entry) => entry.result === 'win').length;
        const trumps = list.reduce((total, entry) => total + entry.trumps.length, 0);
        return {
            played: list.length,
            wins,
            losses: list.length - wins,
            winRate: list.length ? Math.round((wins / list.length) * 100) : 0,
            trumps
        };
    }

    function renderStats(target, entries) {
        if (!target) return;
        const stats = summarize(entries);
        target.replaceChildren();
        target.hidden = stats.played === 0;
        if (!stats.played) return;

        const list = document.createElement('dl');
        list.className = 'history-stats';
        list.setAttribute('aria-label', 'Recent match statistics');
        [
            ['Matches', String(stats.played)],
            ['Record', `${stats.wins}\u2013${stats.losses}`],
            ['Win rate', `${stats.winRate}%`],
            ['Trump calls', String(stats.trumps)]
        ].forEach(([label, value]) => {
            const cell = document.createElement('div');
            cell.className = 'history-stat';
            const term = document.createElement('dt');
            term.textContent = label;
            const detail = document.createElement('dd');
            detail.textContent = value;
            cell.append(term, detail);
            list.appendChild(cell);
        });
        target.appendChild(list);
    }

    function render(target, statsTarget) {
        if (!target) return [];
        const entries = read();
        renderStats(statsTarget, entries);
        target.textContent = '';
        if (!entries.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = 'No finished matches yet. Complete a match and it will appear here.';
            target.appendChild(empty);
            return entries;
        }

        const list = document.createElement('ol');
        list.className = 'history-list';
        list.setAttribute('aria-label', 'Recent finished matches, newest first');

        entries.forEach((entry) => {
            const item = document.createElement('li');
            item.className = `history-row ${entry.result === 'win' ? 'is-win' : 'is-loss'}`;
            const resultWord = entry.result === 'win' ? 'Win' : 'Loss';
            const calls = entry.trumps.map(callLabel);
            item.setAttribute('aria-label', `${resultWord}, ${entry.playerScore} to ${entry.computerScore}, first to ${entry.target}. ${calls.length ? calls.join('; ') + '.' : 'No trump calls recorded.'} ${fullDate(entry.playedAt)}`);

            const outcome = document.createElement('span');
            outcome.className = 'history-outcome';
            outcome.textContent = entry.result === 'win' ? 'W' : 'L';
            outcome.setAttribute('aria-hidden', 'true');

            const score = document.createElement('span');
            score.className = 'history-score';
            const player = document.createElement('b');
            player.textContent = String(entry.playerScore);
            const dash = document.createElement('i');
            dash.textContent = '–';
            const computer = document.createElement('b');
            computer.textContent = String(entry.computerScore);
            score.append(player, dash, computer);

            const meta = document.createElement('span');
            meta.className = 'history-meta';
            const targetLabel = document.createElement('span');
            targetLabel.className = 'history-target';
            targetLabel.textContent = `First to ${entry.target}`;
            const trumps = document.createElement('span');
            trumps.className = 'history-trumps';
            if (entry.trumps.length) {
                entry.trumps.slice(0, 8).forEach((call) => {
                    const mark = document.createElement('span');
                    mark.className = `history-trump is-${call.selector}`;
                    mark.textContent = GLYPH[call.suit];
                    mark.title = callLabel(call);
                    mark.setAttribute('aria-hidden', 'true');
                    trumps.appendChild(mark);
                });
                if (entry.trumps.length > 8) {
                    const more = document.createElement('span');
                    more.className = 'history-more';
                    more.textContent = `+${entry.trumps.length - 8}`;
                    more.title = calls.slice(8).join('; ');
                    more.setAttribute('aria-hidden', 'true');
                    trumps.appendChild(more);
                }
            } else {
                trumps.textContent = 'No trump calls';
                trumps.classList.add('is-empty');
            }
            if (calls.length) trumps.title = calls.join('; ');
            meta.append(targetLabel, trumps);

            const time = document.createElement('time');
            time.className = 'history-date';
            time.dateTime = new Date(entry.playedAt).toISOString();
            time.textContent = shortDate(entry.playedAt);
            time.title = fullDate(entry.playedAt);

            item.append(outcome, score, meta, time);
            list.appendChild(item);
        });

        target.appendChild(list);
        return entries;
    }

    window.MatchHistory = { key: KEY, limit: LIMIT, read, add, summarize, render };
})();
