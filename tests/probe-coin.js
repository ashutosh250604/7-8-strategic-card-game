'use strict';
/*
 * Dev-only visual probe: captures the opening shuffle and the coin toss at a
 * few moments so the animation can be inspected as an image.
 *   node probe-coin.js
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || gamePath;
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-coin-'));
    const port = 9800 + (process.pid % 150);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('no browser'); }
    await new Promise(r => server.listen(8101, '127.0.0.1', r));
    const page = await browser.newPage();
    const vw = Number(process.argv[2]) || 1280;
    const vh = Number(process.argv[3]) || 800;
    await page.setViewport({ width: vw, height: vh });
    await page.setRequestInterception(true);
    page.on('request', r => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:8101/${gamePath}`, { waitUntil: 'load' });

    const shot = async (name) => { await page.screenshot({ path: path.join(outDir, `coin-${name}.png`) }); };
    const info = [];
    const deckInfo = await page.evaluate(() => {
        const d = document.getElementById('deck');
        const cs = getComputedStyle(d);
        return { display: cs.display, opacity: cs.opacity, visibility: cs.visibility, rect: d.getBoundingClientRect().toJSON() };
    });
    info.push('deck at rest: ' + JSON.stringify(deckInfo));

    await page.click('#start-game');
    await sleep(700);
    info.push('mid-shuffle board: ' + JSON.stringify(await page.evaluate(() => {
        const d = document.getElementById('deck');
        const cs = getComputedStyle(d);
        return { display: cs.display, opacity: cs.opacity, visibility: cs.visibility, cls: document.querySelector('.game-board').className, rect: d.getBoundingClientRect().toJSON() };
    })));
    await shot('1-shuffle');

    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 10000 });
    await sleep(300);
    await shot('2-coin-idle');
    info.push('coin idle: ' + JSON.stringify(await page.evaluate(() => {
        const c = document.getElementById('coin');
        const r = document.getElementById('coin-rig');
        return { coin: c.getBoundingClientRect().toJSON(), rig: r.getBoundingClientRect().toJSON(), modal: getComputedStyle(document.getElementById('coin-toss-modal')).display };
    })));

    await page.click('.coin-btn[data-choice="heads"]');
    await sleep(450);
    await shot('3-coin-air');
    const air = await page.evaluate(() => {
        const c = document.getElementById('coin');
        const cs = getComputedStyle(c);
        return { transform: cs.transform, rigTransform: getComputedStyle(document.getElementById('coin-rig')).transform };
    });
    info.push('coin in air: ' + JSON.stringify(air));
    await sleep(700);
    await shot('4-coin-air2');
    await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase), { timeout: 15000 });
    await sleep(400);
    await shot('5-coin-landed');

    console.log(info.join('\n'));
    console.log('pageerrors:', errors.length ? errors : 'none');
    await browser.close();
    proc.kill();
    server.close();
})();
