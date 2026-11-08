'use strict';
/*
 * Save/resume E2E (dev only).
 *
 * Starts a real match, leaves a card on the table, reloads, and proves the
 * exact turn comes back. Also checks the opening trump choice, the restart
 * clear, and a malformed localStorage value.
 *
 *   node resume-e2e.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = path.join('games', '7-8', 'index.html').replace(/\\/g, '/');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || gamePath;
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end();
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const problems = [];
function expect(label, ok, detail) {
    console.log(`${ok ? 'ok - ' : 'FAIL - '}${label}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);
    if (!ok) problems.push(label);
}

(async () => {
    await new Promise((r) => server.listen(8108, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-resume-'));
    const port = 9700 + (process.pid % 150);
    const proc = spawn(EDGE, [
        '--headless=new', '--disable-gpu', '--no-first-run',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows', '--mute-audio',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore' });

    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(300);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* starting */ }
    }
    if (!browser) {
        proc.kill();
        server.close();
        throw new Error('could not connect to Edge');
    }

    const page = await browser.newPage();
    await page.bringToFront();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT|googletagmanager|google-analytics/i.test(m.text())) {
            pageErrors.push('console: ' + m.text());
        }
    });
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    // Fine pointer on a phone-sized viewport: the test exercises the save API
    // through one click, while the touch path has its own mobile suite.
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });

    const gameUrl = `http://127.0.0.1:8108/${gamePath}`;
    const installPrefs = () => page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('78-settings-v3', JSON.stringify({
            difficulty: 'medium', matchTarget: 3, sound: false, volume: 0.4,
            motion: 'reduced', haptics: false, voice: false, fireworks: false
        }));
    });
    const waitSettled = async () => {
        try {
            await page.waitForFunction(
                () => typeof GameEngine !== 'undefined' && GameEngine.state.gameStarted && GameEngine.state.gamePhase === 'playing' &&
                    document.querySelector('#player-hand .card, #player-faceup .card'),
                { timeout: 20000, polling: 100 }
            );
        } catch (e) {
            const diag = await page.evaluate(() => ({
                phase: GameEngine.state.gamePhase,
                started: GameEngine.state.gameStarted,
                selector: GameEngine.state.lastTrumpSelector,
                current: GameEngine.state.currentPlayer,
                resolving: GameEngine.state.resolvingTrick,
                thinking: GameEngine.state.computerThinking,
                pending: GameView.pendingCount(),
                hand: GameEngine.state.player.hand.filter(Boolean).length,
                faceUp: GameEngine.state.player.faceUp.filter(Boolean).length,
                trick: GameEngine.state.trick.cards.length,
                modals: [...document.querySelectorAll('.modal')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.id)
            }));
            console.log('settle diagnostic:', JSON.stringify(diag), 'errors:', JSON.stringify(pageErrors));
            await page.screenshot({ path: path.join(outDir, 'resume-settle-failure.png') });
            throw e;
        }
        await page.waitForFunction(() => typeof GameView !== 'undefined' && GameView.pendingCount() === 0, { timeout: 15000, polling: 100 }).catch(() => {});
        await sleep(300);
    };
    const startAndReachTable = async () => {
        await page.click('#start-game');
        await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 5000 });
        await page.click('.coin-btn[data-choice="heads"]');
        await page.waitForFunction(
            () => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase),
            { timeout: 20000, polling: 100 }
        );
        if (await page.$eval('#trump-selection-modal', (el) => getComputedStyle(el).display !== 'none').catch(() => false)) {
            await page.click('.trump-btn[data-suit="spades"]');
        }
        await waitSettled();
    };
    const readTable = () => page.evaluate(() => {
        const gs = GameEngine.state;
        return {
            started: gs.gameStarted,
            phase: gs.gamePhase,
            over: gs.gameOver,
            scores: [gs.player.score, gs.computer.score],
            round: gs.roundNumber,
            tricks: gs.trickCount,
            trump: gs.trumpSuit,
            selector: gs.lastTrumpSelector,
            current: gs.currentPlayer,
            hand: gs.player.hand.slice(),
            faceUp: gs.player.faceUp.slice(),
            faceDown: gs.player.faceDown.slice(),
            computerHand: gs.computer.hand.slice(),
            computerFaceUp: gs.computer.faceUp.slice(),
            computerFaceDown: gs.computer.faceDown.slice(),
            trick: gs.trick.cards.map((p) => ({ card: p.card, player: p.player })),
            setup: document.querySelector('.game-board').classList.contains('is-setup'),
            startDisplay: getComputedStyle(document.getElementById('start-game')).display,
            saved: !!localStorage.getItem(GameEngine.saveKey)
        };
    });

    await page.goto(gameUrl, { waitUntil: 'load' });
    await installPrefs();
    await page.reload({ waitUntil: 'load' });
    await startAndReachTable();

    const playable = '#player-hand .card.playable, #player-faceup .card.playable';
    await page.waitForSelector(playable, { timeout: 10000 });
    await page.click(playable);
    let midTrick = true;
    try {
        await page.waitForFunction(
            () => GameEngine.state.currentPlayer === 'player' && GameEngine.state.trick.cards.length === 1 &&
                GameEngine.state.trick.cards[0].player === 'computer',
            { timeout: 6000, polling: 50 }
        );
    } catch (e) {
        midTrick = false;
    }
    const midProbe = await page.evaluate(() => ({
        phase: GameEngine.state.gamePhase,
        current: GameEngine.state.currentPlayer,
        trick: GameEngine.state.trick.cards.map((p) => ({ card: p.card, player: p.player })),
        resolving: GameEngine.state.resolvingTrick,
        pending: GameView.pendingCount(),
        selected: document.querySelectorAll('.card.selected').length
    }));
    console.log('mid-trick probe:', JSON.stringify(midProbe));
    expect('a played card produces a settled one-card trick', midTrick, midProbe);
    await sleep(250);
    const before = await readTable();
    expect('a settled mid-trick turn is checkpointed', before.saved && before.trick.length === 1, before);

    await page.reload({ waitUntil: 'load' });
    await waitSettled();
    const after = await readTable();
    const fields = ['scores', 'round', 'tricks', 'trump', 'selector', 'current', 'hand', 'faceUp', 'faceDown',
        'computerHand', 'computerFaceUp', 'computerFaceDown', 'trick'];
    const mismatches = fields.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    expect('the mid-trick table restores exactly', mismatches.length === 0, {
        mismatches,
        before: Object.fromEntries(fields.map((k) => [k, before[k]])),
        after: Object.fromEntries(fields.map((k) => [k, after[k]]))
    });
    expect('the restored table bypasses setup', after.started && !after.setup && after.startDisplay === 'none', after);

    const nextPlayable = await page.$(playable);
    expect('the restored turn still has a legal card', !!nextPlayable, after.hand.concat(after.faceUp));
    if (nextPlayable) await nextPlayable.click();
    const playedAfterRestore = await page.waitForFunction(
        () => GameEngine.state.trick.cards.some((p) => p.player === 'player') || GameEngine.state.resolvingTrick,
        { timeout: 5000 }
    ).then(() => true).catch(() => false);
    expect('a restored mid-trick can be played immediately', playedAfterRestore);

    await page.click('#restart-game');
    await page.waitForSelector('#confirm-modal', { visible: true });
    await page.click('#confirm-accept');
    await page.waitForFunction(() => !GameEngine.state.gameStarted, { timeout: 5000 });
    const cleared = await page.evaluate(() => localStorage.getItem(GameEngine.saveKey));
    expect('starting a new match clears the saved checkpoint', cleared === null, cleared);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#start-game', { visible: true, timeout: 5000 });
    const noResume = await page.evaluate(() => ({ started: GameEngine.state.gameStarted, saved: !!localStorage.getItem(GameEngine.saveKey) }));
    expect('a cleared match reloads to setup', !noResume.started && !noResume.saved, noResume);

    // A player-won toss leaves the five-card trump choice as the last stable
    // state before the remaining deal, which is exactly what should reopen.
    await page.evaluate(() => { Math.random = () => 0.1; });
    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForFunction(
        () => GameEngine.state.gamePhase === 'trump-selection' && GameEngine.state.lastTrumpSelector === 'player' &&
            GameEngine.state.player.hand.filter(Boolean).length === 5,
            { timeout: 20000, polling: 100 }
    );
    await page.waitForFunction(() => GameView.pendingCount() === 0, { timeout: 10000, polling: 100 }).catch(() => {});
    await sleep(250);
    const opening = await readTable();
    expect('the opening trump choice is checkpointed', opening.saved && opening.phase === 'trump-selection', opening);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#trump-selection-modal', { visible: true, timeout: 5000 });
    const reopened = await page.evaluate(() => ({
        phase: GameEngine.state.gamePhase,
        hand: GameEngine.state.player.hand.filter(Boolean).length,
        startDisplay: getComputedStyle(document.getElementById('start-game')).display,
        saved: !!localStorage.getItem(GameEngine.saveKey)
    }));
    expect('reload reopens the saved trump choice', reopened.phase === 'trump-selection' && reopened.hand === 5 && reopened.startDisplay === 'none', reopened);
    await page.click('.trump-btn[data-suit="spades"]');
    await waitSettled();
    expect('choosing trump on the restored hand reaches play', await page.evaluate(() => GameEngine.state.gamePhase === 'playing' && GameEngine.state.trumpSuit === 'spades'));
    const fullDeal = await page.evaluate(() => {
        const gs = GameEngine.state;
        const cards = [
            ...gs.player.hand, ...gs.player.faceUp, ...gs.player.faceDown,
            ...gs.computer.hand, ...gs.computer.faceUp, ...gs.computer.faceDown
        ].filter(Boolean);
        return { total: cards.length, unique: new Set(cards).size, remaining: (gs.remainingCards || []).length };
    });
    expect('the restored opening deals the remaining cards exactly once',
        fullDeal.total === 30 && fullDeal.unique === 30 && fullDeal.remaining === 0, fullDeal);

    await page.evaluate(() => {
        GameEngine.restartGame();
        localStorage.setItem(GameEngine.saveKey, '{not a match');
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#start-game', { visible: true, timeout: 5000 });
    const corrupt = await page.evaluate(() => ({
        started: GameEngine.state.gameStarted,
        saved: localStorage.getItem(GameEngine.saveKey)
    }));
    expect('malformed saved data falls back to a new table', !corrupt.started && corrupt.saved === null, corrupt);

    expect('no page or console errors during resume', pageErrors.length === 0, pageErrors);
    await page.screenshot({ path: path.join(outDir, 'resume-final.png') });
    console.log('\nPROBLEMS:', problems.length ? '\n  ' + problems.join('\n  ') : 'none');
    try { await browser.close(); } catch (e) { /* already gone */ }
    proc.kill();
    server.close();
    process.exit(problems.length ? 1 : 0);
})().catch((e) => {
    console.error('RESUME PASS FAILED:', e);
    server.close();
    process.exit(2);
});
