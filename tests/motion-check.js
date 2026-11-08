'use strict';
/*
 * Animation and audio regression check (dev only).
 *
 * The operating system reduce-motion flag used to switch every animation off.
 * This opens the real table with that flag set and proves that:
 *   - Full still shuffles and flips the coin,
 *   - Calm still shows a short shuffle and coin movement,
 *   - the audio context is running and effects schedule nodes.
 *
 *   node motion-check.js
 */
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
    await new Promise((r) => server.listen(8113, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-anim-'));
    const port = 9920 + (process.pid % 70);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('could not connect to Edge'); }

    let failed = 0;
    const check = (label, ok, detail) => {
        console.log(`${ok ? 'ok' : 'FAIL'} - ${label}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);
        if (!ok) failed++;
    };

    async function run(motion) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        // Deliberately ask the OS for reduced motion; the in-app setting should win.
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.setRequestInterception(true);
        page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.evaluateOnNewDocument((mode) => {
            localStorage.setItem('78-settings-v3', JSON.stringify({
                difficulty: 'hard', matchTarget: 3, sound: true, volume: 0.8, motion: mode, haptics: true, voice: false
            }));
            window.__audio = { contexts: 0, states: [], starts: 0 };
            const Orig = window.AudioContext || window.webkitAudioContext;
            if (!Orig) return;
            const Wrapped = function (...args) {
                const ctx = new Orig(...args);
                window.__audio.contexts++;
                window.__audio.states.push(ctx.state);
                const start = ctx.createOscillator.bind(ctx);
                ctx.createOscillator = () => {
                    const osc = start();
                    const go = osc.start.bind(osc);
                    osc.start = (...a) => { window.__audio.starts++; return go(...a); };
                    return osc;
                };
                return ctx;
            };
            Wrapped.prototype = Orig.prototype;
            window.AudioContext = Wrapped;
            window.webkitAudioContext = Wrapped;
        }, motion);
        await page.goto(`http://127.0.0.1:8113/${gamePath}`, { waitUntil: 'networkidle0' });
        await sleep(500);

        const initial = await page.evaluate(() => ({
            reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
            motion: TableSettings.get().motion,
            attr: document.documentElement.dataset.motion
        }));
        check(`${motion}: OS reduce is visible but the in-app setting is kept`, initial.reduce === true && initial.motion === motion, initial);

        await page.click('#start-game');
        await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 8000 });

        // Sample inside the page: ten Node round trips with 80ms sleeps can
        // straddle the whole 900ms Calm flip and report only its endpoints.
        await page.evaluate(() => {
            window.__coinFrames = { matrix: new Set(), inline: new Set(), rotation: new Set() };
            const coin = document.getElementById('coin');
            const sample = () => {
                if (!coin) return;
                window.__coinFrames.matrix.add(getComputedStyle(coin).transform);
                window.__coinFrames.inline.add(coin.style.transform || '');
                if (window.gsap) window.__coinFrames.rotation.add(String(gsap.getProperty(coin, 'rotationX')));
            };
            const id = setInterval(sample, 25);
            setTimeout(() => clearInterval(id), 2400);
        });
        await page.bringToFront();
        await page.click('.coin-btn[data-choice="heads"]');
        // Leave room for the Calm shuffle, which starts right after the coin
        // result and only lasts 1.2 s.
        await sleep(1400);
        const coinFrames = await page.evaluate(() => Object.fromEntries(
            Object.entries(window.__coinFrames).map(([k, set]) => [k, set.size])));
        const distinctCoin = Math.max(coinFrames.matrix, coinFrames.inline, coinFrames.rotation);
        check(`${motion}: coin visibly flips`, distinctCoin > 3, { ...coinFrames, best: distinctCoin });
        await page.screenshot({ path: path.join(outDir, `anim-${motion}-coin.png`) });

        await page.waitForFunction(() => document.querySelector('.game-board').classList.contains('is-shuffling'), { timeout: 12000 });
        // Poll inside the page: a round trip per frame is slow enough to miss a
        // 1.2s shuffle in headless Edge, and this also records GSAP progress.
        const shuffleReport = await page.evaluate(() => new Promise((resolve) => {
            const board = document.querySelector('.game-board');
            const start = performance.now();
            const frames = new Set();
            let maxProgress = 0;
            let tweenCount = 0;
            function poll() {
                const cards = [...document.querySelectorAll('#deck .shuffle-card')];
                const tweens = cards.length ? gsap.getTweensOf(cards) : [];
                tweenCount = Math.max(tweenCount, tweens.length);
                if (tweens.length) maxProgress = Math.max(maxProgress, ...tweens.map((t) => t.progress()));
                frames.add(cards.map((c) => getComputedStyle(c).transform).join('|'));
                const elapsed = performance.now() - start;
                const shuffling = board.classList.contains('is-shuffling');
                if (shuffling && elapsed < 8000) requestAnimationFrame(poll);
                else resolve({ frames: frames.size, maxProgress, tweenCount, shuffling, elapsed: Math.round(elapsed) });
            }
            requestAnimationFrame(poll);
        }));
        check(`${motion}: shuffle visibly moves`, shuffleReport.tweenCount > 0 && shuffleReport.maxProgress > 0.4,
            shuffleReport);
        check(`${motion}: shuffle finishes`, !shuffleReport.shuffling && shuffleReport.elapsed < 8000, shuffleReport.elapsed);
        await page.screenshot({ path: path.join(outDir, `anim-${motion}-shuffle.png`) });

        const audio = await page.evaluate(() => window.__audio);
        check(`${motion}: audio context runs`, audio.contexts > 0 && audio.states.every((s) => s === 'running'), audio);
        check(`${motion}: effects schedule sound nodes`, audio.starts > 0, audio.starts);
        check(`${motion}: no page errors`, errors.length === 0, errors);
        await page.close();
    }

    await run('full');
    await run('fast');
    await run('reduced');

    console.log(failed ? `\n${failed} animation check(s) failed` : '\nall animation checks passed');
    await browser.close();
    proc.kill();
    server.close();
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
