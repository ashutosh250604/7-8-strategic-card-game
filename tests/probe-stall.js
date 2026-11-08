'use strict';
/*
 * Frozen-turn hunter (dev-only).
 *
 * Plays a real match in headless Edge the way a person does (clicks playable
 * cards, picks a trump, advances rounds) and watches every engine beat. If the
 * table stops moving for longer than STALL_MS it dumps the beat log, the stuck
 * presentation promises, the raf clock and every console message, then exits 3.
 *
 *   node probe-stall.js [seconds=240]
 *
 * The interesting failure it was written for: the table sits on "Anne is
 * playing..." forever after the player's card, with computerThinking already
 * false - i.e. a continuation that never came back.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = path.join('games', '7-8', 'index.html');
const budget = (Number(process.argv[2]) || 240) * 1000;
const STALL_MS = 12000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || gamePath.replace(/\\/g, '/');
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});

(async () => {
    await new Promise((r) => server.listen(8123, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-stall-'));
    const port = 9500 + (process.pid % 300);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) { await sleep(500); try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* not up yet */ } }
    if (!browser) { proc.kill(); throw new Error('could not connect to Edge'); }
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    const logs = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));

    await page.goto(`http://127.0.0.1:8123/${gamePath.replace(/\\/g, '/')}`, { waitUntil: 'load' });
    await page.evaluate(() => {
        window.__beats = [];
        window.__raf = 0;
        const tick = () => { window.__raf++; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const orig = GameView.beat;
        GameView.beat = function (name, payload) {
            const rec = { name, start: performance.now(), end: null, pending: GameView.pendingLabels() };
            window.__beats.push(rec);
            return orig.call(GameView, name, payload).then(
                (v) => { rec.end = performance.now(); return v; },
                (e) => { rec.end = -1; rec.error = String(e && e.message || e); throw e; }
            );
        };
        window.__errors = [];
        const origErr = console.error;
        console.error = function (...args) { window.__errors.push(args.map(String).join(' ')); origErr.apply(console, args); };
    });

    const snap = () => page.evaluate(() => ({
        phase: GameEngine.state.gamePhase,
        cp: GameEngine.state.currentPlayer,
        res: GameEngine.state.resolvingTrick,
        think: GameEngine.state.computerThinking,
        cards: GameEngine.state.trick.cards.length,
        tc: GameEngine.state.trickCount,
        over: GameEngine.state.gameOver,
        status: document.getElementById('game-status').textContent.trim(),
        pending: GameView.pendingLabels(),
        raf: window.__raf,
        beats: window.__beats.length,
        errors: window.__errors
    }));

    const t0 = Date.now();
    let last = Date.now();
    let lastState = '';
    let over = false;
    let beatsSeen = 0;
    while (!over && Date.now() - t0 < budget) {
        const r = await page.evaluate(() => {
            const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
            if (vis('game-over-modal')) return 'over';
            const start = document.getElementById('start-game');
            if (GameEngine.state.gamePhase === 'setup' && start && getComputedStyle(start).display !== 'none') { start.click(); return 'start'; }
            if (vis('coin-toss-modal')) { const b = document.querySelector('.coin-btn'); if (b) b.click(); return 'coin'; }
            if (vis('trump-selection-modal')) { document.querySelector('.trump-btn').click(); return 'trump'; }
            if (vis('new-round')) { document.getElementById('new-round').click(); return 'round'; }
            const s = GameEngine.state;
            if (s.gamePhase === 'playing' && s.currentPlayer === 'player' && !s.resolvingTrick && s.trick.cards.length < 2) {
                for (const c of document.querySelectorAll('#player-hand .card.playable, #player-faceup .card.playable')) {
                    c.click();
                    if (s.currentPlayer !== 'player' || s.resolvingTrick) return 'played';
                }
            }
            return 'idle';
        });
        if (r === 'over') { over = true; break; }
        if (r === 'trump' || r === 'coin' || r === 'round' || r === 'played' || r === 'start') last = Date.now();

        const st = await snap();
        const key = JSON.stringify([st.phase, st.cp, st.res, st.think, st.cards, st.tc, st.status]);
        // Progress for the heartbeat is any change in the beat log or the turn.
        if (st.beats !== beatsSeen) { beatsSeen = st.beats; last = Date.now(); }
        if (key !== lastState) { lastState = key; last = Date.now(); }
        if (Date.now() - last > STALL_MS) {
            const frozen = await page.evaluate(() => ({
                state: {
                    phase: GameEngine.state.gamePhase, cp: GameEngine.state.currentPlayer,
                    res: GameEngine.state.resolvingTrick, think: GameEngine.state.computerThinking,
                    trick: GameEngine.state.trick, tc: GameEngine.state.trickCount,
                    hand: GameEngine.state.computer.hand.filter(Boolean).length,
                    faceUp: GameEngine.state.computer.faceUp.filter(Boolean).length
                },
                pending: GameView.pendingLabels(),
                running: window.__beats.filter((b) => b.end === null).map((b) => ({ name: b.name, ms: Math.round(performance.now() - b.start), pending: b.pending })),
                recent: window.__beats.slice(-8).map((b) => ({ name: b.name, ms: b.end === null ? null : Math.round(b.end - b.start), err: b.error })),
                errors: window.__errors,
                raf: window.__raf
            }));
            console.log('STALL after', Math.round((Date.now() - last) / 1000), 's of no progress');
            console.log(JSON.stringify(frozen, null, 1));
            console.log('console tail:\n  ' + logs.slice(-14).join('\n  '));
            await browser.close(); proc.kill(); server.close();
            process.exit(3);
        }
        await sleep(450);
    }

    const final = await page.evaluate(() => ({
        over: GameEngine.state.gameOver,
        score: `${GameEngine.state.player.score}-${GameEngine.state.computer.score}`,
        rounds: GameEngine.state.roundNumber,
        beats: window.__beats.length,
        slow: window.__beats.filter((b) => b.end !== null && b.end > 0 && b.end - b.start > 6000).map((b) => ({ name: b.name, ms: Math.round(b.end - b.start) })),
        unresolved: window.__beats.filter((b) => b.end === null).map((b) => b.name),
        errors: window.__errors
    }));
    console.log(over ? 'match finished' : 'budget reached without finishing', JSON.stringify(final));
    await browser.close(); proc.kill(); server.close();
    process.exit(over && !final.unresolved.length && !final.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
