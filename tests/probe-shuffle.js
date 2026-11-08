'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = path.join('games', '7-8', 'index.html').replace(/\\/g, '/');
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
    await new Promise((r) => server.listen(8114, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-sh-'));
    const port = 9980 + (process.pid % 15);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) { await sleep(500); try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) {} }
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('78-settings-v3', JSON.stringify({ difficulty: 'hard', matchTarget: 5, sound: true, volume: 0.8, motion: 'full', haptics: true }));
    });
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    await page.goto(`http://127.0.0.1:8114/${gamePath}`, { waitUntil: 'networkidle0' });
    await sleep(400);
    await page.click('#start-game');
    for (let i = 0; i < 16; i++) {
        await sleep(100);
        console.log(i, JSON.stringify(await page.evaluate(() => {
            const cards = [...document.querySelectorAll('#deck > *')];
            const tweens = gsap.getTweensOf(cards);
            return {
                t: Math.round(performance.now()),
                board: document.querySelector('.game-board').className,
                inline: cards[0] ? cards[0].style.transform : '',
                computed: cards[0] ? getComputedStyle(cards[0]).transform : '',
                tweens: tweens.length,
                progress: tweens.map((tw) => Math.round(tw.progress() * 100) / 100),
                paused: gsap.globalTimeline.paused(),
                gtime: Math.round(gsap.globalTimeline.time() * 100) / 100
            };
        })));
    }
    await browser.close(); proc.kill(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
