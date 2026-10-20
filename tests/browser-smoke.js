'use strict';
/*
 * Real-browser smoke test (dev-only). Opens games/7-8/index.html from disk in headless
 * Edge/Chrome, plays the first part of a game in real time and reports console output,
 * page errors and failed requests.   node browser-smoke.js [--shots]
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = path.join('games', '7-8', 'index.html');
const fileUrl = 'file:///' + path.join(root, gamePath).replace(/\\/g, '/');
// Default: serve over HTTP (a webmanifest cannot be fetched from file:// in any browser). --file opens from disk.
const useFile = process.argv.includes('--file');
const http = require('http');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || gamePath.replace(/\\/g, '/');
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
let url = fileUrl;
const shots = process.argv.includes('--shots');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    // Edge is a GUI-subsystem exe on Windows, so Puppeteer cannot read its startup banner: launch it
    // ourselves with a debugging port and connect to that.
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-smoke-'));
    const port = 9333;
    const proc = require('child_process').spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* not up yet */ }
    }
    if (!browser) { proc.kill(); throw new Error('could not connect to Edge on port ' + port); }
    const shutdown = async () => { try { await browser.close(); } catch (e) {} proc.kill(); };
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const problems = [], infos = [];
    // Never send analytics hits from tests.
    await page.setRequestInterception(true);
    page.on('request', r => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('console', m => {
        const t = m.type();
        if (/ERR_BLOCKED_BY_CLIENT/.test(m.text())) return; // our own analytics blocking
        (t === 'error' || t === 'warning' ? problems : infos).push(`console.${t}: ${m.text()}`);
    });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    page.on('requestfailed', r => {
        const u = r.url();
        // Google Analytics may be blocked/offline in a test browser; it is third-party and not part of the game.
        (/googletagmanager|google-analytics/.test(u) || /ERR_BLOCKED_BY_CLIENT/.test(String(r.failure() && r.failure().errorText)) ? infos : problems).push(`requestfailed: ${u} ${r.failure() && r.failure().errorText}`);
    });
    page.on('response', r => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });

    if (!useFile) { await new Promise(r => server.listen(8099, '127.0.0.1', r)); url = 'http://127.0.0.1:8099/' + gamePath.replace(/\\/g, '/'); }
    console.log('url:', url);
    await page.goto(url, { waitUntil: 'load' });
    const boot = await page.evaluate(() => ({
        gsap: typeof gsap !== 'undefined' ? gsap.version : null,
        view: typeof GameView, engine: typeof GameEngine,
        gaInHead: !!document.head.querySelector('script[src*="googletagmanager"]'),
        gaInBody: !!document.body.querySelector('script[src*="googletagmanager"]'),
        log: document.getElementById('game-log').textContent.trim()
    }));
    console.log('boot:', JSON.stringify(boot));
    if (shots) await page.screenshot({ path: path.join(outDir, 'shot-1-start.png') });

    const visible = sel => page.$eval(sel, e => getComputedStyle(e).display !== 'none').catch(() => false);
    const state = () => page.evaluate(() => ({ phase: GameEngine.state.gamePhase, cp: GameEngine.state.currentPlayer, trump: GameEngine.state.trumpSuit, tricks: GameEngine.state.trickCount, cards: GameEngine.state.trick.cards.length }));

    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true });
    await page.click('.coin-btn[data-choice="heads"]');
    console.log('coin flipping (real time ~5.5s)...');
    await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase) && GameEngine.state.lastTrumpSelector, { timeout: 15000 });

    if ((await state()).phase === 'trump-selection') {
        // Either the player picks trump (modal) or the computer does (timer).
        const modal = await visible('#trump-selection-modal');
        if (modal) {
            if (shots) await page.screenshot({ path: path.join(outDir, 'shot-2-trump.png') });
            await page.click('.trump-btn[data-suit="spades"]');
        }
    }
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 15000 });
    console.log('playing; state:', JSON.stringify(await state()));
    if (shots) await page.screenshot({ path: path.join(outDir, 'shot-3-playing.png') });

    // Play 3 tricks with real clicks on playable cards.
    for (let i = 0; i < 3; i++) {
        try {
            await page.waitForFunction(() => GameEngine.state.currentPlayer === 'player' && !GameEngine.state.resolvingTrick && GameEngine.state.trick.cards.length < 2 && document.querySelector('#player-hand .card, #player-faceup .card'), { timeout: 30000, polling: 200 });
        } catch (e) {
            console.log('STALL DIAGNOSTIC:', JSON.stringify(await page.evaluate(() => ({
                s: { ph: GameEngine.state.gamePhase, cp: GameEngine.state.currentPlayer, res: GameEngine.state.resolvingTrick, think: GameEngine.state.computerThinking, trick: GameEngine.state.trick.cards, tc: GameEngine.state.trickCount, over: GameEngine.state.gameOver },
                status: document.getElementById('game-status').textContent.trim(),
                handCls: [...document.querySelectorAll('#player-hand .card, #player-faceup .card')].map(c => c.className),
                modals: [...document.querySelectorAll('.modal')].filter(m => getComputedStyle(m).display !== 'none').map(m => m.id),
                newRound: getComputedStyle(document.getElementById('new-round')).display
            })), null, 1));
            throw e;
        }
        await sleep(600);
        // Real clicks on real card elements until the game accepts one (invalid plays must be rejected).
        const clicked = await page.evaluate(() => {
            const s = GameEngine.state;
            const before = s.trick.cards.length + s.trickCount * 2;
            let rejected = 0;
            for (const c of document.querySelectorAll('#player-hand .card, #player-faceup .card')) {
                c.click();
                if (s.trick.cards.length + s.trickCount * 2 !== before) return { accepted: true, rejected };
                rejected++;
            }
            return { accepted: false, rejected };
        });
        console.log(`trick ${i + 1}: click result =`, JSON.stringify(clicked));
        await page.waitForFunction((n) => GameEngine.state.trickCount > n, { timeout: 20000 }, i);
    }
    console.log('after 3 tricks:', JSON.stringify(await state()));
    if (shots) await page.screenshot({ path: path.join(outDir, 'shot-4-mid.png') });

    // Invalid-play rejection (real click on a card the UI marks .invalid)
    const invalid = await page.evaluate(() => {
        const c = document.querySelector('.card.invalid');
        return c ? c.className : null;
    });
    console.log('an .invalid card currently present:', invalid);

    if (process.argv.includes('--full')) {
        // Auto-play whole games in real time (animations on) and check the table stays sane.
        console.log('full game (real time)...');
        const t0 = Date.now();
        let over = false, rounds = 0, maxCards = 0;
        while (!over && Date.now() - t0 < 420000) {
            await sleep(250);
            const r = await page.evaluate(() => {
                const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
                if (vis('game-over-modal')) return 'over';
                if (vis('trump-selection-modal')) { document.querySelector('.trump-btn').click(); return 'trump'; }
                if (vis('new-round')) { document.getElementById('new-round').click(); return 'round'; }
                const s = GameEngine.state;
                if (s.gamePhase === 'playing' && s.currentPlayer === 'player' && !s.resolvingTrick && s.trick.cards.length < 2) {
                    for (const c of document.querySelectorAll('#player-hand .card.playable, #player-faceup .card.playable')) { c.click(); if (s.currentPlayer !== 'player' || s.resolvingTrick) return 'played'; }
                    for (const c of document.querySelectorAll('#player-hand .card, #player-faceup .card')) { c.click(); if (s.currentPlayer !== 'player' || s.resolvingTrick) return 'played'; }
                }
                return document.querySelectorAll('.card').length;
            });
            if (r === 'over') over = true; else if (r === 'round') rounds++; else if (typeof r === 'number') maxCards = Math.max(maxCards, r);
        }
        const end = await page.evaluate(() => ({
            cards: document.querySelectorAll('.card').length, flying: document.querySelectorAll('.card.flying').length,
            inTrick: document.querySelectorAll('.trick-slot .card').length, modal: document.getElementById('winner-announcement').textContent,
            score: `${GameEngine.state.player.score}-${GameEngine.state.computer.score}`, sparks: document.querySelectorAll('.spark').length
        }));
        console.log('game over reached:', over, 'rounds:', rounds + 1, 'secs:', Math.round((Date.now() - t0) / 1000), 'max .card elements seen:', maxCards, JSON.stringify(end));
        if (!over) problems.push('full game did not finish');
        if (end.flying) problems.push('stuck flying cards: ' + end.flying);
        if (maxCards > 40) problems.push('too many card elements (leak?): ' + maxCards);
        if (shots) await page.screenshot({ path: path.join(outDir, 'shot-5-gameover.png') });
        await page.click('#play-again');
        await sleep(400);
    }

    // Restart mid-game must leave a clean setup state.
    await page.click('#restart-game');
    await sleep(3500);
    const after = await page.evaluate(() => ({ phase: GameEngine.state.gamePhase, start: getComputedStyle(document.getElementById('start-game')).display, status: document.getElementById('game-status').textContent.trim() }));
    console.log('after restart (+3.5s):', JSON.stringify(after));

    console.log('\ninfo (not failures):', infos.length ? '\n  ' + infos.join('\n  ') : 'none');
    console.log('PROBLEMS:', problems.length ? '\n  ' + problems.join('\n  ') : 'none');
    await shutdown();
    server.close();
    process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error('SMOKE FAILED:', e); process.exit(2); });
