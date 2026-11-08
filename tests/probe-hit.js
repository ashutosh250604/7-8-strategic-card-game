'use strict';
/*
 * Dev-only hit-test probe.
 *
 * A control can look right and still be unclickable when something invisible
 * (a veil, a transparent overlay, a stale layer) sits on top of it. This walks
 * the important controls at each viewport and asks the browser what is really
 * at the centre of each one.
 *
 *   node probe-hit.js [width] [height]
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = 'games/7-8/index.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
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
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-hit-'));
    const port = 9700 + (process.pid % 200);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* not up yet */ }
    }
    if (!browser) { proc.kill(); throw new Error('no browser'); }
    await new Promise((r) => server.listen(8103, '127.0.0.1', r));
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.goto(`http://127.0.0.1:8103/${gamePath}`, { waitUntil: 'load' });
    await sleep(1200);

    const probe = (sel) => page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return { sel: s, missing: true };
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const top = document.elementFromPoint(cx, cy);
        const hit = !!top && (top === el || el.contains(top) || top.contains(el));
        let cover = null;
        if (!hit && top) {
            const id = top.id ? `#${top.id}` : '';
            const cls = typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(/\s+/).join('.') : '';
            cover = `${top.tagName.toLowerCase()}${id}${cls}`;
        }
        const cs = getComputedStyle(el);
        const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1;
        return { sel: s, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
            display: cs.display, visibility: cs.visibility, opacity: cs.opacity, shown, hit, cover };
    }, sel);

    const rows = [];
    for (const sel of ['#start-game', '.hud-brand', '.hud-btn', '#restart-game', '.difficulty-indicator']) {
        rows.push(await probe(sel));
    }
    // Start a match so the in-play controls can be checked too.
    await page.evaluate(() => document.getElementById('start-game').click());
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 20000 });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase), { timeout: 25000 });
    const trumpOpen = await page.evaluate(() => getComputedStyle(document.getElementById('trump-selection-modal')).display !== 'none');
    if (trumpOpen) await page.click('.trump-btn[data-suit="spades"]');
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 25000 });
    await sleep(1500);
    for (const sel of ['#player-hand .card', '.hud-icon', '#new-round', '#select-trump-btn', '.coin-btn']) {
        rows.push(await probe(sel));
    }

    console.log(`===== hit test ${width}x${height} =====`);
    for (const r of rows) {
        if (r.missing) { console.log(`missing   ${r.sel}`); continue; }
        if (!r.shown) { console.log(`hidden    ${r.sel} (not on screen right now)`); continue; }
        const flag = r.hit ? 'clickable' : `COVERED BY ${r.cover}`;
        console.log(`${flag} ${r.sel.padEnd(20)} box ${r.box.join(',')} display ${r.display}`);
    }

    await browser.close();
    proc.kill();
    server.close();
})();
