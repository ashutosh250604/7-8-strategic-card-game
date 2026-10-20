'use strict';
/*
 * End-to-end acceptance check for the collection launcher, the opt-in
 * tutorial and the first-round live coach.
 *
 *   cd tests && node tutorial-e2e.js
 *
 * Runs the real pages in headless Edge/Chrome over HTTP (the manifest and shared
 * root scripts need a normal origin). Requires the dev dependencies in this
 * folder and a Chromium-based browser. Analytics is blocked, console errors fail
 * the run, and screenshots land in tests/out/.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const cp = require('child_process');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json'
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cleanup = async () => { try { server.close(); } catch (e) { /* not listening */ } };

const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end('not found');
    }
    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        // A dev server should never make a just-edited script look stale.
        'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
});

function browserExecutable() {
    const candidates = [
        process.env.EDGE_PATH,
        process.env.CHROME_PATH,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ].filter(Boolean);
    return candidates.find((file) => {
        try { return fs.statSync(file).isFile(); } catch (e) { return false; }
    }) || null;
}

(async () => {
    const executable = browserExecutable();
    if (!executable) {
        throw new Error('No Edge/Chrome executable found. Set EDGE_PATH or CHROME_PATH.');
    }

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-tutorial-e2e-'));
    const debugPort = 9400 + Math.floor(Math.random() * 300);
    const proc = cp.spawn(executable, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore' });

    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}` }); } catch (e) { /* not up yet */ }
    }
    if (!browser) {
        proc.kill();
        server.close();
        throw new Error('Could not connect to the headless browser.');
    }

    const problems = [];
    const bad = (message) => problems.push(message);
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport({ width: 1280, height: 900 });

    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        if (/ERR_BLOCKED_BY_CLIENT|googletagmanager|google-analytics/.test(m.text())) return;
        bad('console: ' + m.text());
    });
    page.on('pageerror', (e) => bad('pageerror: ' + e.message));
    page.on('requestfailed', (r) => {
        const text = String(r.failure() && r.failure().errorText);
        if (/googletagmanager|google-analytics/.test(r.url()) || /ERR_BLOCKED_BY_CLIENT/.test(text)) return;
        bad(`requestfailed: ${r.url()} ${text}`);
    });
    page.on('response', (r) => {
        if (r.status() >= 400 && !/googletagmanager|google-analytics/.test(r.url())) bad(`http ${r.status()}: ${r.url()}`);
    });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    const visible = (selector) => page.$eval(selector, (el) => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden';
    }).catch(() => false);
    const text = (selector) => page.$eval(selector, (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    const shot = async (name) => {
        await page.screenshot({ path: path.join(out, name) });
        console.log('shot:', name);
    };
    const waitGame = () => page.waitForFunction(
        () => typeof GameEngine !== 'undefined' && GameEngine.state && typeof GameView !== 'undefined',
        { timeout: 15000 }
    );

    const shutdown = async () => {
        try { await browser.close(); } catch (e) { /* already gone */ }
        try { proc.kill(); } catch (e) { /* already gone */ }
        server.close();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked profile */ }
    };
    cleanup = shutdown;

    // ------------------------------------------------------------ launcher
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.game-tile.is-live');
    const home = await page.evaluate(() => ({
        title: document.title,
        tiles: document.querySelectorAll('.game-tile').length,
        live: document.querySelectorAll('.game-tile.is-live').length,
        soon: document.querySelectorAll('.game-tile.is-soon').length,
        href: document.querySelector('.game-tile.is-live').getAttribute('href'),
        action: document.querySelector('.game-tile.is-live .tile-go').textContent.replace(/\s+/g, ' ').trim(),
        overflow: document.documentElement.scrollWidth - innerWidth
    }));
    console.log('HOME:', JSON.stringify(home));
    if (home.tiles !== 6 || home.live !== 1 || home.soon !== 4) bad('launcher tile counts are wrong');
    if (!home.href.endsWith('games/7-8/index.html')) bad('live tile href is wrong: ' + home.href);
    if (!/Deal the cards/i.test(home.action)) bad('live tile does not use the Deal action');
    if (home.overflow > 1) bad('launcher overflows at 1280x900: ' + home.overflow);
    await shot('e2e-home.png');

    await page.setViewport({ width: 390, height: 844 });
    await sleep(150);
    const homeMobile = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        cols: getComputedStyle(document.querySelector('.game-grid')).gridTemplateColumns.split(' ').length
    }));
    console.log('HOME MOBILE:', JSON.stringify(homeMobile));
    if (homeMobile.overflow > 1) bad('launcher overflows at 390x844: ' + homeMobile.overflow);
    if (homeMobile.cols !== 1) bad('launcher is not one column at 390px');
    await page.setViewport({ width: 1280, height: 900 });

    // Keyboard activation of the live tile (anchors navigate on Enter).
    await page.focus('.game-tile.is-live');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname.endsWith('/games/7-8/index.html'), { timeout: 10000 });
    await waitGame();
    console.log('keyboard tile navigation:', await page.evaluate(() => location.pathname));

    if (!/Deal the cards/i.test(await text('#start-game'))) bad('start button does not use the Deal action');
    if (!(await visible('#hud-rules'))) bad('Rules is not reachable from the game HUD');
    await page.click('#hud-rules');
    await page.waitForSelector('#rules-modal', { visible: true, timeout: 3000 });
    await page.keyboard.press('Escape');
    await sleep(120);
    const rulesClosed = await page.evaluate(() => ({
        open: getComputedStyle(document.getElementById('rules-modal')).display,
        focus: document.activeElement && document.activeElement.id
    }));
    if (rulesClosed.open !== 'none') bad('Escape did not close the in-play rules');
    if (rulesClosed.focus !== 'hud-rules') bad('rules did not return focus to the HUD trigger: ' + rulesClosed.focus);

    // The first-run invitation, Deal action and target note all share one panel.
    for (const [w, h] of [[1280, 900], [390, 844], [320, 568], [844, 390]]) {
        await page.setViewport({ width: w, height: h });
        await sleep(200);
        const fit = await page.evaluate(() => {
            const panel = document.querySelector('.start-panel').getBoundingClientRect();
            const board = document.querySelector('.game-board').getBoundingClientRect();
            const note = document.querySelector('.start-note').getBoundingClientRect();
            return {
                doc: document.documentElement.scrollWidth - innerWidth,
                panelTop: panel.top, panelBottom: panel.bottom,
                boardTop: board.top, boardBottom: board.bottom,
                noteH: note.height,
                invite: getComputedStyle(document.getElementById('tutorial-invite')).display,
                start: getComputedStyle(document.getElementById('start-game')).display
            };
        });
        console.log(`SETUP ${w}x${h}:`, JSON.stringify(fit));
        if (fit.doc > 1) bad(`setup overflows at ${w}x${h}: ${fit.doc}`);
        if (fit.panelTop < fit.boardTop - 1 || fit.panelBottom > fit.boardBottom + 1) bad(`setup panel leaves the board at ${w}x${h}`);
        if (fit.start === 'none') bad(`Deal action is hidden at ${w}x${h}`);
        if (h > 560 && fit.invite === 'none') bad(`first-run invite is missing at ${w}x${h}`);
        if (h <= 560 && fit.invite !== 'none') bad(`first-run invite should yield to short landscape at ${w}x${h}`);
    }
    await page.setViewport({ width: 1280, height: 900 });
    await sleep(200);

    // ------------------------------------------------- first-run localStorage
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitGame();
    await page.waitForSelector('#tutorial-invite:not([hidden])', { timeout: 5000 });
    if (!(await visible('#tutorial-invite'))) bad('first-run tutorial invite is not visible');
    if (!(await visible('#start-tutorial'))) bad('permanent Tutorial button is missing');

    await page.click('#tutorial-dismiss');
    await sleep(100);
    const dismissed = await page.evaluate(() => ({
        invite: getComputedStyle(document.getElementById('tutorial-invite')).display,
        seen: localStorage.getItem('78-tutorial-seen-v1'),
        focus: document.activeElement && document.activeElement.id
    }));
    console.log('dismissed:', JSON.stringify(dismissed));
    if (dismissed.invite !== 'none') bad('invite did not hide after Not now');
    if (dismissed.seen !== '1') bad('seen flag was not stored after Not now');
    if (dismissed.focus !== 'start-tutorial') bad('focus did not return to the Tutorial button after Not now');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitGame();
    const afterReload = await page.evaluate(() => ({
        invite: getComputedStyle(document.getElementById('tutorial-invite')).display,
        button: !!document.getElementById('start-tutorial')
    }));
    console.log('after reload:', JSON.stringify(afterReload));
    if (afterReload.invite !== 'none') bad('invite returned after reload');
    if (!afterReload.button) bad('Tutorial button disappeared after reload');

    // ------------------------------------------------------- tutorial keyboard
    await page.focus('#start-tutorial');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#tutorial-modal', { visible: true });
    await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.suit === 'hearts', { timeout: 3000 });
    await page.keyboard.press('Tab');
    const tabFocus = await page.evaluate(() => document.activeElement && document.activeElement.dataset.suit);
    if (tabFocus !== 'spades') bad('Tab did not move from hearts to spades: ' + tabFocus);
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    const shiftFocus = await page.evaluate(() => document.activeElement && document.activeElement.dataset.suit);
    if (shiftFocus !== 'hearts') bad('Shift+Tab did not move back to hearts: ' + shiftFocus);

    await page.keyboard.press('Escape');
    await sleep(160);
    const escaped = await page.evaluate(() => ({
        open: getComputedStyle(document.getElementById('tutorial-modal')).display,
        focus: document.activeElement && document.activeElement.id
    }));
    console.log('after Escape:', JSON.stringify(escaped));
    if (escaped.open !== 'none') bad('Escape did not close the tutorial');
    if (escaped.focus !== 'start-tutorial') bad('Escape did not return focus to the Tutorial button: ' + escaped.focus);

    // ----------------------------------------------------- wrong-answer flow
    await page.click('#start-tutorial');
    await page.waitForSelector('#tutorial-modal', { visible: true });
    await page.click('.tut-suit[data-suit="diamonds"]');
    if (!(await page.$('.tut-feedback.is-wrong'))) bad('wrong trump was not explained');
    if (await page.$('[data-tut-next]')) bad('Next appeared after a wrong trump');
    if (!(await page.$('.tut-suit.is-best'))) bad('strongest suit was not hinted after a wrong trump');
    await page.click('.tut-suit[data-suit="hearts"]');
    if (!(await page.$('.tut-feedback.is-right'))) bad('correct trump was not confirmed');
    await page.click('[data-tut-next]');

    await page.click('.tut-quiz-btn[data-target="7"]');
    if (!(await page.$('.tut-feedback.is-wrong'))) bad('wrong 8-vs-7 answer was not explained');
    await page.click('.tut-quiz-btn[data-target="8"]');
    if (!(await page.$('.tut-feedback.is-right'))) bad('correct 8-vs-7 answer was not confirmed');
    await page.click('[data-tut-next]');

    await page.click('[data-follow="A_spades"]');
    if (!(await page.$('.tut-feedback.is-wrong'))) bad('illegal follow-suit card was not rejected');
    if (await page.$('#tut-follow-slot .tut-card')) bad('illegal follow-suit card appeared in the trick');
    await page.click('[data-follow="K_diamonds"]');
    if (!(await page.$('.tut-feedback.is-right'))) bad('legal follow-suit card was not confirmed');
    if (!(await page.$('#tut-follow-slot .tut-card'))) bad('legal follow-suit card did not reach the trick');
    if (await page.$('[data-follow="K_diamonds"]')) bad('played sample card is still in the sample hand');
    await page.click('[data-tut-next]');
    if ((await text('#tutorial-step-label')) !== 'Recap') bad('tutorial did not reach the recap');

    const beforePlay = await page.evaluate(() => ({
        started: GameEngine.state.gameStarted,
        armed: LiveCoach.state().armed
    }));
    if (beforePlay.started) bad('the tutorial started a game before the play action');
    if (beforePlay.armed) bad('live coaching was armed before the tutorial was finished');

    await page.click('[data-tut-play]');
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 5000 });
    const afterPlay = await page.evaluate(() => ({
        phase: GameEngine.state.gamePhase,
        started: GameEngine.state.gameStarted,
        seen: localStorage.getItem('78-tutorial-seen-v1'),
        invite: getComputedStyle(document.getElementById('tutorial-invite')).display,
        armed: LiveCoach.state().armed
    }));
    console.log('after tutorial play:', JSON.stringify(afterPlay));
    if (!afterPlay.started || afterPlay.phase !== 'coin-toss') bad('tutorial play did not start the normal game');
    if (afterPlay.seen !== '1') bad('seen flag was not stored after finishing the tutorial');
    if (afterPlay.invite !== 'none') bad('invite is still visible after finishing the tutorial');
    if (!afterPlay.armed) bad('live coaching was not armed after finishing the tutorial');

    // ------------------------------------------------------ live trump coach
    await page.evaluate(() => { Math.random = () => 0.1; });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForSelector('#trump-selection-modal', { visible: true, timeout: 20000 });
    await page.waitForSelector('#live-coach-trump:not([hidden])', { timeout: 5000 });

    const trumpCoach = await page.evaluate(() => {
        const SUITS = ['hearts', 'spades', 'diamonds', 'clubs'];
        const stats = {};
        SUITS.forEach((suit) => { stats[suit] = { suit, count: 0, high: 0, cards: [] }; });
        GameEngine.state.player.hand.filter(Boolean).forEach((card) => {
            const suit = GameEngine.getCardSuit(card);
            const value = GameEngine.getCardValue(card);
            stats[suit].count++;
            if (value >= 11) stats[suit].high++;
            stats[suit].cards.push(card);
        });
        const score = (s) => s.high * 2 + s.count;
        const bestCard = (s) => Math.max.apply(null, s.cards.map(GameEngine.getCardValue));
        const best = SUITS.map((suit) => stats[suit]).filter((s) => s.count > 0).sort((a, b) => {
            if (score(b) !== score(a)) return score(b) - score(a);
            if (bestCard(b) !== bestCard(a)) return bestCard(b) - bestCard(a);
            return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
        })[0];
        return {
            expected: best.suit,
            pick: document.querySelector('.trump-btn.is-coach-pick') && document.querySelector('.trump-btn.is-coach-pick').dataset.suit,
            tags: document.querySelectorAll('.suit-coach').length,
            text: document.getElementById('live-coach-trump').innerText,
            trump: GameEngine.state.trumpSuit,
            hand: GameEngine.state.player.hand
        };
    });
    console.log('live trump coach:', JSON.stringify(trumpCoach));
    if (trumpCoach.pick !== trumpCoach.expected) bad(`coach picked ${trumpCoach.pick}, expected ${trumpCoach.expected}`);
    if (trumpCoach.tags !== 1) bad('exactly one Coach pick tag should be visible');
    if (trumpCoach.trump !== null) bad('coach changed trump before the player chose');
    if (!/strongest suit|safest call/.test(trumpCoach.text)) bad('trump coach did not explain the recommendation');
    if (!/8 tricks/.test(trumpCoach.text) || !/7/.test(trumpCoach.text)) bad('trump coach did not teach the 8-vs-7 target');
    await shot('e2e-live-trump.png');

    for (const [w, h] of [[390, 844], [320, 568], [844, 390]]) {
        await page.setViewport({ width: w, height: h });
        await sleep(250);
        const fit = await page.evaluate(() => {
            const content = document.querySelector('#trump-selection-modal .modal-content');
            const options = document.querySelector('.trump-options').getBoundingClientRect();
            const coach = document.getElementById('live-coach-trump').getBoundingClientRect();
            return {
                doc: document.documentElement.scrollWidth - innerWidth,
                ih: innerHeight,
                optionsBottom: options.bottom,
                coachBottom: coach.bottom,
                scroll: content.scrollHeight - content.clientHeight
            };
        });
        console.log(`TRUMP COACH ${w}x${h}:`, JSON.stringify(fit));
        if (fit.doc > 1) bad(`trump coach causes horizontal overflow at ${w}x${h}: ${fit.doc}`);
        if (fit.optionsBottom > fit.ih + 1) bad(`trump options are below the viewport at ${w}x${h}`);
        if (fit.coachBottom > fit.ih + 1) bad(`trump coach is off-screen at ${w}x${h}`);
        await shot(`e2e-trump-${w}x${h}.png`);
    }
    await page.setViewport({ width: 1280, height: 900 });
    await sleep(200);

    // The coach is advice only: choose a different suit and the engine must use it.
    const chosen = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('.trump-btn')];
        const nonPick = buttons.find((b) => !b.classList.contains('is-coach-pick')) || buttons[0];
        nonPick.click();
        return nonPick.dataset.suit;
    });
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 20000 });
    await page.waitForSelector('#live-coach:not([hidden])', { timeout: 5000 });
    const targetNote = await text('#live-coach');
    console.log('after choosing trump:', chosen, JSON.stringify(targetNote));
    if (await page.evaluate(() => GameEngine.state.trumpSuit) !== chosen) bad('player trump choice was not respected');
    if (!/You called/.test(targetNote)) bad('coach did not confirm the player-calling target');
    if (!/8/.test(targetNote) || !/7/.test(targetNote)) bad('coach did not restate the two targets');
    if (!(await page.evaluate(() => LiveCoach.state().armed))) bad('coach disarmed before the follow-suit lesson');

    // -------------------------------------------------- live follow-suit coach
    let followSeen = false;
    for (let i = 0; i < 10 && !followSeen; i++) {
        await page.waitForFunction(() => {
            const s = GameEngine.state;
            return s.gamePhase === 'playing' && s.currentPlayer === 'player' && !s.resolvingTrick &&
                (s.trick.cards.length === 0 || (s.trick.cards.length === 1 && s.trick.cards[0].player === 'computer')) &&
                !!document.querySelector('#player-hand .card.playable, #player-faceup .card.playable');
        }, { timeout: 25000 });

        const turn = await page.evaluate(() => ({
            len: GameEngine.state.trick.cards.length,
            ledBy: GameEngine.state.trick.cards.length ? GameEngine.state.trick.cards[0].player : null,
            trickCount: GameEngine.state.trickCount
        }));
        if (turn.len === 1 && turn.ledBy === 'computer') {
            followSeen = true;
            break;
        }

        await page.evaluate(() => {
            const card = document.querySelector('#player-hand .card.playable, #player-faceup .card.playable');
            if (card) card.click();
        });
        await page.waitForFunction((trickCount) => GameEngine.state.trickCount > trickCount, { timeout: 25000 }, turn.trickCount);
    }
    if (!followSeen) throw new Error('could not reach a computer-led trick in the first round');

    await page.waitForFunction(() => /The computer led/.test(document.getElementById('live-coach').innerText), { timeout: 5000 });
    const follow = await page.evaluate(() => {
        const s = GameEngine.state;
        const lead = s.trick.leadSuit;
        const cards = [];
        ['hand', 'faceUp'].forEach((source) => {
            s.player[source].forEach((card, index) => {
                if (!card) return;
                const el = document.querySelector(`#${source === 'hand' ? 'player-hand' : 'player-faceup'} .card[data-source="${source}"][data-index="${index}"]`);
                if (el) cards.push({
                    card,
                    suit: GameEngine.getCardSuit(card),
                    playable: el.classList.contains('playable'),
                    coach: el.classList.contains('coach-pick')
                });
            });
        });
        return {
            lead,
            played: s.trick.cards[0].card,
            cards,
            text: document.getElementById('live-coach').innerText,
            coach: LiveCoach.state()
        };
    });
    console.log('live follow coach:', JSON.stringify(follow));
    if (!/The computer led/.test(follow.text)) bad('follow coach did not name the led card');
    if (!/follow|any card is legal/i.test(follow.text)) bad('follow coach did not teach follow-suit');
    if (/heartss|diamondss|clubss|spadess/i.test(follow.text)) bad('coach text has a plural typo');
    if (!follow.coach.followActive || follow.coach.followTaught) bad('follow lesson state is wrong before the player plays');

    const suited = follow.cards.filter((c) => c.suit === follow.lead);
    const coachCard = follow.cards.find((c) => c.coach);
    if (suited.length) {
        if (!coachCard) bad('follow coach did not mark a recommended legal card');
        if (coachCard && !coachCard.playable) bad('coach recommended a card the UI marks unplayable');
        const wrongSuitPlayable = follow.cards.filter((c) => c.suit !== follow.lead && c.playable);
        if (wrongSuitPlayable.length) bad('cards outside the led suit are playable while following suit');
    } else if (coachCard) {
        bad('coach marked a card even though the hand is void in the led suit');
    }
    await shot('e2e-live-follow.png');

    // The coach bar is new chrome: prove it fits and stays above the player's table.
    for (const [w, h] of [[390, 844], [320, 568], [844, 390]]) {
        await page.setViewport({ width: w, height: h });
        await sleep(300);
        const fit = await page.evaluate(() => {
            const bar = document.getElementById('live-coach').getBoundingClientRect();
            const player = document.querySelector('.player-area').getBoundingClientRect();
            return {
                doc: document.documentElement.scrollWidth - innerWidth,
                barRight: bar.right, barBottom: bar.bottom, barTop: bar.top,
                playerTop: player.top, iw: innerWidth, ih: innerHeight
            };
        });
        console.log(`COACH ${w}x${h}:`, JSON.stringify(fit));
        if (fit.doc > 1) bad(`coach causes horizontal overflow at ${w}x${h}: ${fit.doc}`);
        if (fit.barRight > fit.iw + 1 || fit.barTop < 0 || fit.barBottom > fit.ih + 1) bad(`coach is off-screen at ${w}x${h}`);
        if (fit.barBottom > fit.playerTop + 1) bad(`coach overlaps the player area at ${w}x${h}`);
        await shot(`e2e-coach-${w}x${h}.png`);
    }
    await page.setViewport({ width: 1280, height: 900 });
    await sleep(200);

    await page.evaluate(() => {
        const card = document.querySelector('.card.coach-pick.playable, .card.playable');
        if (card) card.click();
    });
    await page.waitForFunction(() => /You followed suit/.test(document.getElementById('live-coach').innerText), { timeout: 5000 });
    const completion = await page.evaluate(() => ({
        text: document.getElementById('live-coach').innerText,
        coach: LiveCoach.state(),
        hidden: document.getElementById('live-coach').hidden
    }));
    console.log('coach completion:', JSON.stringify(completion));
    if (completion.hidden) bad('completion note was not visible');
    if (!completion.coach.followTaught || completion.coach.armed) bad('coach did not finish after the live follow turn');
    await shot('e2e-coach-complete.png');

    await sleep(7000);
    if (await visible('#live-coach')) bad('completion note did not retire after its time');

    // ------------------------------------- computer-wins toss / player target 7
    await page.click('#restart-game');
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'setup', { timeout: 5000 });
    await page.evaluate(() => {
        window.__coachTexts = [];
        const coach = document.getElementById('live-coach');
        new MutationObserver(() => window.__coachTexts.push(coach.innerText)).observe(coach, { childList: true, subtree: true });
        LiveCoach.arm();
        Math.random = () => 0.9;
    });
    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 5000 });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 25000 });
    const computerToss = await page.evaluate(() => (window.__coachTexts || []).find((t) => /The computer called/.test(t)) || '');
    console.log('computer-called trump:', JSON.stringify(computerToss));
    if (!/The computer called/.test(computerToss)) bad('coach did not explain the computer-called trump');
    if (!/You need 7/.test(computerToss) || !/needs 8/.test(computerToss)) bad('coach did not give the player the 7-trick target after losing the toss');

    console.log('\nPROBLEMS:', problems.length ? '\n  ' + problems.join('\n  ') : 'none');
    await shutdown();
    process.exit(problems.length ? 1 : 0);
})().catch(async (e) => {
    console.error('E2E FAILED:', e && e.stack || e);
    await cleanup();
    process.exit(2);
});
