'use strict';
/*
 * Dev-only probe for Anne's photograph and the speech bubble:
 * screenshots the seat with a line showing, and reports the gap between her
 * cheek and the bubble, plus what each mood does to the photo.
 *   node probe-face.js [width] [height]
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = 'games/7-8/index.html';
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
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
    const tag = `${width}x${height}`;
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-face-'));
    const port = 9700 + (process.pid % 200);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('no browser'); }
    await new Promise((r) => server.listen(8104, '127.0.0.1', r));
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
    await page.goto(`http://127.0.0.1:8104/${gamePath}`, { waitUntil: 'load' });

    const mounted = await page.evaluate(() => !!(window.TableAvatar && TableAvatar.isMounted()));
    const box = await page.evaluate(() => {
        const r = document.querySelector('#anne-portrait');
        const b = r.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), photo: !!r.querySelector('.aa-svg'), mood: r.dataset.mood };
    });
    console.log('mounted:', mounted, 'avatar:', JSON.stringify(box));
    await page.screenshot({ path: path.join(outDir, `face-${tag}-setup.png`) });

    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 12000 });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase), { timeout: 20000 });
    if (await page.evaluate(() => getComputedStyle(document.getElementById('trump-selection-modal')).display !== 'none')) {
        await page.click('.trump-btn[data-suit="spades"]');
    }
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 15000 });
    await sleep(1500);

    // A line with the bubble up, then measure it against her cheek.
    const line = 'Ruffing me? Rude. Also very good.';
    await page.evaluate((text) => TableCharacters.showReaction(text, 6000), line);
    await sleep(450);
    const geo = await page.evaluate(() => {
        const r = document.querySelector('#anne-portrait').getBoundingClientRect();
        const b = document.getElementById('anne-reaction').getBoundingClientRect();
        return {
            avatar: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), cy: Math.round(r.top + r.height / 2) },
            bubble: { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), cy: Math.round(b.top + b.height / 2) },
            gap: Math.round(b.left - r.right),
            onScreen: b.left >= 0 && b.right <= innerWidth,
            mood: document.querySelector('#anne-portrait').dataset.mood,
            talking: document.querySelector('#anne-portrait').classList.contains('is-talking'),
            visible: getComputedStyle(document.getElementById('anne-reaction')).opacity
        };
    });
    console.log('bubble:', JSON.stringify(geo));
    await page.screenshot({ path: path.join(outDir, `face-${tag}-speaking.png`) });
    await page.screenshot({ path: path.join(outDir, `face-${tag}-seat.png`), clip: await page.evaluate(() => {
        const r = document.querySelector('.computer-area').getBoundingClientRect();
        return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(innerWidth, r.width), height: Math.min(innerHeight, r.height + 40) };
    }) });

    // Every mood should change something visible in the drawing.
    const moods = {};
    for (const mood of ['neutral', 'happy', 'tease', 'impressed', 'focused', 'sorry', 'thinking']) {
        await page.evaluate((m) => TableCharacters.setMood(m), mood);
        await sleep(120);
        moods[mood] = await page.evaluate(() => {
            const host = document.querySelector('#anne-portrait');
            const img = host.querySelector('.aa-svg');
            return { mood: host.dataset.mood, filter: getComputedStyle(img).filter, animation: getComputedStyle(img).animationName };
        });
    }
    console.log('moods:', JSON.stringify(moods, null, 1));

    // Big renders of the photograph so the crop can be reviewed.
    await page.setViewport({ width, height, deviceScaleFactor: 4 });
    await sleep(250);
    for (const mood of ['neutral', 'tease', 'impressed', 'sorry', 'thinking']) {
        await page.evaluate((m) => TableCharacters.setMood(m), mood);
        await sleep(420);
        const el = await page.$('#anne-portrait');
        if (el) await el.screenshot({ path: path.join(outDir, `face-${tag}-${mood}.png`) });
    }
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await sleep(200);

    // Blink: catch the focus pulse over a few seconds.
    const blinked = await page.evaluate(() => new Promise((resolve) => {
        const svg = document.querySelector('#anne-portrait');
        const t0 = Date.now();
        const seen = [];
        const tick = () => {
            if (svg.classList.contains('is-blinking')) seen.push(1);
            if (Date.now() - t0 > 5200) return resolve(seen.length);
            requestAnimationFrame(tick);
        };
        tick();
    }));
    console.log('blink frames seen:', blinked);

    const audio = await page.evaluate(() => ({
        status: typeof GameAudio.sampleStatus === 'function' ? GameAudio.sampleStatus() : 'missing',
        supported: GameAudio.isSupported()
    }));
    console.log('audio files loaded:', JSON.stringify(audio));

    await browser.close();
    proc.kill();
    server.close();
})();
