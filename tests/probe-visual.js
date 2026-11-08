'use strict';
/* Visual check (dev only): real table, settings and result at four sizes. */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = path.join('games', '7-8', 'index.html').replace(/\\/g, '/');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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

(async () => {
    await new Promise((r) => server.listen(8111, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-visual-'));
    const port = 9910 + (process.pid % 80);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('could not connect to Edge'); }

    const problems = [];
    const views = [
        { name: 'desk', width: 1440, height: 900 },
        { name: 'phone', width: 390, height: 844 },
        { name: 'small', width: 320, height: 568 },
        { name: 'land', width: 844, height: 390 }
    ];

    for (const view of views) {
        const page = await browser.newPage();
        await page.setViewport({ width: view.width, height: view.height, deviceScaleFactor: 1 });
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
        await page.setRequestInterception(true);
        page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
        page.on('console', (m) => { if (m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT/.test(m.text())) problems.push(`${view.name} console: ${m.text()}`); });
        page.on('pageerror', (e) => problems.push(`${view.name} pageerror: ${e.message}`));

        await page.goto(`http://127.0.0.1:8111/${gamePath}`, { waitUntil: 'networkidle0' });
        await sleep(500);
        await page.screenshot({ path: path.join(outDir, `v-${view.name}-setup.png`) });

        await page.click('#start-game');
        await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 6000 }).catch(() => {});
        await page.click('.coin-btn[data-choice="heads"]').catch(() => {});
        await page.waitForFunction(() => {
            const m = document.getElementById('coin-toss-modal');
            return !m || getComputedStyle(m).display === 'none';
        }, { timeout: 20000 }).catch(() => problems.push(`${view.name}: coin modal stuck`));

        const trumpOpen = await page.evaluate(() => getComputedStyle(document.getElementById('trump-selection-modal')).display !== 'none');
        if (trumpOpen) {
            await page.screenshot({ path: path.join(outDir, `v-${view.name}-trump.png`) });
            await page.evaluate(() => document.querySelector('.trump-btn').click());
        }
        await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 20000 }).catch(() => problems.push(`${view.name}: game never reached playing`));
        await sleep(900);
        await page.screenshot({ path: path.join(outDir, `v-${view.name}-table.png`) });

        const metrics = await page.evaluate(() => {
            const rect = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
            };
            const hud = rect('#hud') || rect('.hud');
            const board = rect('.game-board');
            const player = rect('.player-area');
            const comp = rect('.computer-area');
            const bubble = rect('#anne-reaction');
            return {
                inner: { w: innerWidth, h: innerHeight },
                overflowX: document.documentElement.scrollWidth - innerWidth,
                overflowY: document.documentElement.scrollHeight - innerHeight,
                hud, board, player, comp, bubble,
                boardBelowHud: hud && board ? board.y >= hud.bottom : null,
                playerClipped: player ? player.bottom > innerHeight + 1 : null,
                bubbleClipped: bubble ? (bubble.right > innerWidth + 1 || bubble.x < -1) : null,
                bubbleText: (document.getElementById('anne-reaction') || {}).textContent || '',
                mood: (document.querySelector('.computer-area') || {}).dataset ? document.querySelector('.computer-area').dataset.mood : null
            };
        });
        console.log(view.name, JSON.stringify(metrics));
        if (metrics.overflowX > 1) problems.push(`${view.name}: horizontal overflow ${metrics.overflowX}px`);
        if (metrics.playerClipped) problems.push(`${view.name}: player seat clipped at the bottom`);
        if (metrics.bubbleClipped) problems.push(`${view.name}: Anne's speech bubble leaves the viewport`);
        if (metrics.boardBelowHud === false) problems.push(`${view.name}: HUD overlaps the board`);

        await page.evaluate(() => document.getElementById('settings-btn').click());
        await page.waitForSelector('#settings-modal', { visible: true, timeout: 3000 }).catch(() => {});
        await sleep(350);
        await page.screenshot({ path: path.join(outDir, `v-${view.name}-settings.png`) });
        await page.evaluate(() => document.getElementById('close-settings').click());
        await sleep(250);

        await page.evaluate(() => {
            GameEngine.state.player.score = 5;
            GameEngine.state.computer.score = 3;
            checkGameEnd();
        });
        await page.waitForSelector('#game-over-modal', { visible: true, timeout: 3000 }).catch(() => {});
        await sleep(700);
        await page.screenshot({ path: path.join(outDir, `v-${view.name}-result.png`) });
        const resultMetrics = await page.evaluate(() => {
            const m = document.getElementById('game-over-modal');
            return { scroll: m.scrollHeight - m.clientHeight, w: m.clientWidth, h: m.clientHeight };
        });
        console.log(view.name, 'result', JSON.stringify(resultMetrics));
        if (resultMetrics.scroll > 2) problems.push(`${view.name}: result modal scrolls ${resultMetrics.scroll}px`);
        await page.close();
    }

    console.log('PROBLEMS:', problems.length ? JSON.stringify(problems, null, 1) : 'none');
    await browser.close();
    proc.kill();
    server.close();
    process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
