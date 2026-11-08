'use strict';
/* Dev-only timing probe: how long do the shuffle / coin beats really take?
 *   node probe-timing.js [width] [height]
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = 'games/7-8/index.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || gamePath;
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const width = Number(process.argv[2]) || 1280;
    const height = Number(process.argv[3]) || 800;
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-timing-'));
    const port = 9500 + (process.pid % 200);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('no browser'); }
    await new Promise((r) => server.listen(8102, '127.0.0.1', r));
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.goto(`http://127.0.0.1:8102/${gamePath}`, { waitUntil: 'load' });

    const motion = await page.evaluate(() => ({
        motion: window.TableSettings.get().motion,
        scale: getComputedStyle(document.documentElement).getPropertyValue('--motion-scale'),
        reducedMq: matchMedia('(prefers-reduced-motion: reduce)').matches,
        deckDisplay: getComputedStyle(document.getElementById('deck')).display
    }));
    console.log('viewport', width + 'x' + height, JSON.stringify(motion));

    await page.evaluate(() => {
        window.__t = [];
        const t0 = performance.now();
        const note = (label) => window.__t.push([label, Math.round(performance.now() - t0)]);
        window.__note = note;
        const b = document.getElementById('start-game');
        b.addEventListener('click', () => {
            note('click');
            const start = performance.now();
            const watch = () => {
                if (document.querySelector('.game-board').classList.contains('is-shuffling')) note('is-shuffling');
                if (getComputedStyle(document.getElementById('coin-toss-modal')).display !== 'none') { note('coin-modal'); }
                if (performance.now() - start < 6000 && !window.__t.some(([l]) => l === 'coin-modal')) setTimeout(watch, 40);
            };
            setTimeout(watch, 20);
        }, { capture: true });
    });
    // Programmatic click: this is a timing probe, and a real mouse click aimed
    // at a hero that is still animating in (full motion) can land beside it.
    await page.evaluate(() => document.getElementById('start-game').click());
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 12000 });
    console.log('stages:', JSON.stringify(await page.evaluate(() => window.__t)));

    // The deal behind the modal
    console.log('deal visible:', await page.evaluate(() => ({
        hand: document.querySelectorAll('#player-hand .card').length,
        faceUp: document.querySelectorAll('#player-faceup .card').length,
        deckDisplay: getComputedStyle(document.getElementById('deck')).display
    })));

    await page.evaluate(() => { window.__coin = []; const t0 = performance.now(); window.__coinNote = (l) => window.__coin.push([l, Math.round(performance.now() - t0)]); });
    await page.click('.coin-btn[data-choice="heads"]');
    const t0 = Date.now();
    await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase), { timeout: 20000 });
    console.log('flip -> next phase ms:', Date.now() - t0);
    console.log('coin trace:', JSON.stringify(await page.evaluate(() => window.__coin)));

    // --match: how long does a real animated round actually take, and is the
    // match always moving? Plays like browser-smoke --full, but reports the
    // wall clock per round and any stretch where the table sat still.
    if (process.argv.includes('--match')) {
        const rounds = Number(process.env.MATCH_ROUNDS || 3);
        const play = async () => {
            await sleep(220);
            return page.evaluate(() => {
                const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
                if (vis('game-over-modal')) return 'over';
                if (vis('trump-selection-modal')) { document.querySelector('.trump-btn').click(); return 'trump'; }
                if (vis('new-round')) { document.getElementById('new-round').click(); return 'round'; }
                const s = GameEngine.state;
                if (s.gamePhase === 'playing' && s.currentPlayer === 'player' && !s.resolvingTrick && s.trick.cards.length < 2) {
                    for (const c of document.querySelectorAll('#player-hand .card.playable, #player-faceup .card.playable')) { c.click(); if (s.currentPlayer !== 'player' || s.resolvingTrick) return 'played'; }
                    for (const c of document.querySelectorAll('#player-hand .card, #player-faceup .card')) { c.click(); if (s.currentPlayer !== 'player' || s.resolvingTrick) return 'played'; }
                    return 'stuck';
                }
                return 'wait';
            });
        };
        let roundStart = Date.now(), roundNo = 0, stalls = [], lastProgress = Date.now(), lastLabel = '';
        const tStart = Date.now();
        const seen = [];
        while (roundNo < rounds && Date.now() - tStart < (Number(process.env.MATCH_MS) || 240000)) {
            const r = await play();
            if (r === 'round') {
                const took = Date.now() - roundStart;
                if (roundNo > 0) seen.push(took);
                roundNo++;
                console.log(`round ${roundNo} took ${(took / 1000).toFixed(1)}s`);
                roundStart = Date.now();
                lastProgress = Date.now(); lastLabel = 'round';
            } else if (r === 'played' || r === 'trump' || r === 'over') {
                lastProgress = Date.now(); lastLabel = r;
                if (r === 'over') break;
            } else if (Date.now() - lastProgress > 9000) {
                const snap = await page.evaluate(() => ({ phase: GameEngine.state.gamePhase, cp: GameEngine.state.currentPlayer,
                    resolving: !!GameEngine.state.resolvingTrick, trick: GameEngine.state.trick.cards.length,
                    playable: document.querySelectorAll('#player-hand .card.playable, #player-faceup .card.playable').length,
                    flying: document.querySelectorAll('.card.flying').length, score: `${GameEngine.state.player.score}-${GameEngine.state.computer.score}` }));
                stalls.push({ after: lastLabel, secs: Math.round((Date.now() - lastProgress) / 1000), ...snap });
                console.log('STALL', JSON.stringify(stalls[stalls.length - 1]));
                lastProgress = Date.now();
            }
        }
        const avg = seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : 0;
        console.log(`rounds: ${roundNo}, per-round avg ${(avg / 1000).toFixed(1)}s, total ${((Date.now() - tStart) / 1000).toFixed(1)}s, stalls: ${stalls.length}`);
        console.log('stalls:', JSON.stringify(stalls));
    }

    // --trace: play a round while sampling the table four times a second, then
    // print every stretch longer than 1.5s where the table did nothing, with
    // the state on both sides. This is what says which step really owns the
    // clock (a beat, a sweep animation, or a genuine hang).
    if (process.argv.includes('--trace')) {
        const label = () => `p:${GameEngine.state.gamePhase} cp:${GameEngine.state.currentPlayer}` +
            ` res:${GameEngine.state.resolvingTrick ? 1 : 0} trick:${GameEngine.state.trick.cards.length}` +
            ` hand:${document.querySelectorAll('#player-hand .card').length}` +
            ` play:${document.querySelectorAll('#player-hand .card.playable, #player-faceup .card.playable').length}` +
            ` fly:${document.querySelectorAll('.card.flying').length}` +
            ` shuf:${document.querySelector('.game-board').classList.contains('is-shuffling') ? 1 : 0}` +
            ` modal:${[...document.querySelectorAll('.modal, [id$="-modal"]')].filter((m) => getComputedStyle(m).display !== 'none').map((m) => m.id).join('+') || '-'}`;
        await page.evaluate(() => {
            window.__samples = [];
            window.__samp = () => {
                const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
                const s = GameEngine.state;
                window.__samples.push([Math.round(performance.now()), s.gamePhase, s.currentPlayer, s.resolvingTrick ? 1 : 0, s.trick.cards.length,
                    document.querySelectorAll('#player-hand .card').length,
                    document.querySelectorAll('#player-hand .card.playable, #player-faceup .card.playable').length,
                    document.querySelectorAll('.card.flying').length,
                    document.querySelector('.game-board').classList.contains('is-shuffling') ? 1 : 0,
                    [...document.querySelectorAll('[id$="-modal"]')].filter((m) => getComputedStyle(m).display !== 'none').map((m) => m.id).join('+') || '-',
                    (document.getElementById('game-status') || {}).textContent || '',
                    (document.querySelector('#game-log .log-message:last-child') || {}).textContent || '',
                    window.GameView && window.GameView.pendingCount ? window.GameView.pendingCount() : -1,
                    window.GameView && window.GameView.pendingLabels ? window.GameView.pendingLabels().join('+') : '']);
            };
            window.__sampTimer = setInterval(window.__samp, 250);
        });
        const rounds = Number(process.env.MATCH_ROUNDS || 1);
        let roundNo = 0, done = 0, t0 = Date.now();
        while (roundNo < rounds && Date.now() - t0 < (Number(process.env.MATCH_MS) || 240000)) {
            await sleep(200);
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
                return 'wait';
            });
            if (r === 'round') { roundNo++; done = Date.now() - t0; }
            if (r === 'over') break;
        }
        await page.evaluate(() => clearInterval(window.__sampTimer));
        const rows = await page.evaluate(() => window.__samples);
        const t = rows[0][0];
        const key = (r) => r.slice(1, -2).join('|');
        let prev = rows[0];
        const gaps = [];
        for (const r of rows) {
            if (key(r) !== key(prev)) { gaps.push([prev, r, r[0] - prev[0]]); prev = r; }
        }
        const minMs = Number(process.env.TRACE_MIN || 400);
        const big = gaps.filter(([, , ms]) => ms >= minMs).sort((a, b) => b[2] - a[2]).slice(0, 24);
        const sum = gaps.reduce((a, [, , ms]) => a + ms, 0);
        const busyMs = rows.reduce((a, r, i) => a + (r[12] > 0 && i ? rows[i][0] - rows[i - 1][0] : 0), 0);
        console.log(`trace: ${roundNo} round(s) in ${done}ms, samples ${rows.length}, span ${rows[rows.length - 1][0] - t}ms, accounted ${sum}ms in ${gaps.length} segments, animations pending for ${busyMs}ms`);
        const labels = {};
        for (const r of rows) if (r[12] > 0) labels[r[13]] = (labels[r[13]] || 0) + 1;
        console.log('pending labels (samples):', JSON.stringify(labels));
        for (const [a, b, ms] of big) {
            console.log(`${String(ms).padStart(6)}ms  ${key(a)}  ->  ${key(b)}   [pending ${a[12]}: ${a[13]}]`);
            console.log(`        status "${a[10]}" / log "${a[11]}"`);
        }
    }

    await browser.close();
    proc.kill();
    server.close();
})();
