'use strict';
/* One-off character probe (dev only). */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || gamePath;
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
(async () => {
    await new Promise((r) => server.listen(8115, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-anne-'));
    const port = 9960 + (process.pid % 30);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run', '--disable-background-timer-throttling', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) { await sleep(500); try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) {} }
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 860 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('78-settings-v3', JSON.stringify({ difficulty: 'hard', matchTarget: 5, sound: false, volume: 0.55, motion: 'full', haptics: false }));
    });
    await page.goto(`http://127.0.0.1:8115/${gamePath}`, { waitUntil: 'networkidle0' });
    await sleep(400);
    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 8000 });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForFunction(() => {
        const m = document.getElementById('coin-toss-modal');
        return !m || getComputedStyle(m).display === 'none';
    }, { timeout: 20000 });
    await sleep(500);
    const trumpOpen = await page.evaluate(() => getComputedStyle(document.getElementById('trump-selection-modal')).display !== 'none');
    if (trumpOpen) await page.evaluate(() => document.querySelector('.trump-btn').click());
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 20000 });

    const seen = [];
    for (let trick = 0; trick < 6; trick++) {
        await page.waitForFunction(() => GameEngine.state.currentPlayer === 'player' && !GameEngine.state.resolvingTrick && GameEngine.state.trick.cards.length < 2, { timeout: 25000 }).catch(() => {});
        await page.evaluate(() => {
            const card = document.querySelector('#player-hand .card.playable, #player-faceup .card.playable');
            if (card) card.click();
        });
        await page.waitForFunction((n) => GameEngine.state.trickCount > n, { timeout: 25000 }, trick).catch(() => {});
        await sleep(420);
        seen.push(await page.evaluate(() => ({
            trick: GameEngine.state.trickCount,
            scores: `${GameEngine.state.player.tricksWon}:${GameEngine.state.computer.tricksWon}`,
            mood: document.querySelector('.computer-area').dataset.mood,
            status: document.getElementById('anne-mood').textContent,
            bubble: document.getElementById('anne-reaction').textContent,
            visible: !document.getElementById('anne-reaction').hidden && getComputedStyle(document.getElementById('anne-reaction')).opacity !== '0',
            lastTrick: GameEngine.state.lastTrick
        })));
        await page.screenshot({ path: path.join(outDir, `anne-trick-${trick + 1}.png`) });
    }
    console.log(JSON.stringify(seen, null, 1));
    console.log('errors:', JSON.stringify(errors));
    await browser.close(); proc.kill(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
