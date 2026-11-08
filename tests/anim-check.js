'use strict';
/*
 * Animation check. The opening shuffle and the coin toss are the two moments a
 * new player sees first, so they are checked through real computed styles and
 * real audio nodes instead of "the script ran".
 *
 *   node anim-check.js            (1280x800)
 *   node anim-check.js 390 844    (phone)
 *
 * Fails when:
 *   - the pack is not visible at full opacity while `is-shuffling` is set,
 *   - the card backs never move during the shuffle,
 *   - the coin does not rotate through the flip,
 *   - no audio sources are created for the shuffle or the coin.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = 'games/7-8/index.html';
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json'
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(port) {
    const server = http.createServer((req, res) => {
        const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || gamePath;
        const f = path.join(root, rel);
        if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
            res.writeHead(404); return res.end();
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        fs.createReadStream(f).pipe(res);
    });
    return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

(async () => {
    const vw = Number(process.argv[2]) || 1280;
    const vh = Number(process.argv[3]) || 800;
    const port = 9400 + (process.pid % 180);
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-anim-'));
    const server = await serve(port + 1);
    const proc = spawn(EDGE, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); server.close(); throw new Error('no browser'); }

    const page = await browser.newPage();
    const failures = [];
    const notes = [];
    const check = (ok, label, detail) => {
        notes.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
        if (!ok) failures.push(label);
    };

    await page.setViewport({ width: vw, height: vh });
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url())
        ? r.abort('blockedbyclient') : r.continue()));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port + 1}/${gamePath}`, { waitUntil: 'load' });

    // Count every sound source the page creates, without changing behaviour.
    await page.evaluate(() => {
        window.__sound = { oscillators: 0, noises: 0, states: [] };
        const patch = (proto, key, counter) => {
            const orig = proto[key];
            if (!orig) return;
            proto[key] = function (...args) {
                window.__sound[counter]++;
                return orig.apply(this, args);
            };
        };
        patch(AudioContext.prototype, 'createOscillator', 'oscillators');
        patch(AudioContext.prototype, 'createBufferSource', 'noises');
        const stateOf = () => {
            try {
                const c = new AudioContext();
                const s = c.state;
                c.close();
                return s;
            } catch (e) { return 'unknown'; }
        };
        window.__sound.contextProbe = stateOf;
    });

    const sample = (ms) => page.evaluate((ms) => new Promise((resolve) => {
        const deck = document.getElementById('deck');
        const coin = document.getElementById('coin');
        const board = document.querySelector('.game-board');
        const rows = [];
        const t0 = performance.now();
        const id = setInterval(() => {
            const dcs = getComputedStyle(deck);
            const ccs = coin ? getComputedStyle(coin) : null;
            rows.push({
                t: Math.round(performance.now() - t0),
                cls: board.className,
                deckOpacity: Number(dcs.opacity),
                deckVisible: dcs.visibility,
                deckWidth: Math.round(deck.getBoundingClientRect().width),
                card: [...deck.querySelectorAll('.shuffle-card')].map((c) => getComputedStyle(c).transform).join('|'),
                coin: ccs ? ccs.transform : ''
            });
            if (performance.now() - t0 > ms) { clearInterval(id); resolve(rows); }
        }, 60);
    }), ms);

    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 15000 });
    await sleep(250);
    const before = await page.evaluate(() => window.__sound.oscillators + window.__sound.noises);
    await page.click('.coin-btn[data-choice="heads"]');
    const coin = await sample(1200);
    const distinctCoin = new Set(coin.map((r) => r.coin).filter(Boolean)).size;
    const afterCoin = await page.evaluate(() => window.__sound.oscillators + window.__sound.noises);
    check(distinctCoin >= 8, 'coin visibly flips', `${distinctCoin} distinct transforms`);
    // A recorded cue decodes to one buffer source; the old synth stack is gone.
    check(afterCoin - before >= 1, 'coin flip creates sound', `${afterCoin - before} new sources`);
    await page.waitForFunction(() => document.querySelector('.game-board').classList.contains('is-shuffling'), { timeout: 15000 });
    const shuffle = await sample(2400);
    const shuffling = shuffle.filter((r) => /is-shuffling/.test(r.cls));
    const visibleFrom = shuffling.find((r) => r.deckOpacity > 0.9 && r.deckVisible === 'visible');
    const movedCards = new Set(shuffling.map((r) => r.card)).size;
    const widest = Math.max(...shuffling.map((r) => r.deckWidth), 0);
    check(!!visibleFrom, 'shuffle pack is fully visible while shuffling',
        visibleFrom ? `from ${visibleFrom.t}ms` : 'never reached opacity 1');
    check(movedCards >= 6, 'shuffle card backs actually animate', `${movedCards} distinct transforms`);
    check(widest >= Math.min(110, vw * 0.1), 'shuffle pack is large enough to read',
        `${widest}px wide in a ${vw}px viewport`);
    check(shuffling.filter((r) => r.deckOpacity > 0.9).length >= shuffling.length * 0.5,
        'shuffle is visible for most of the beat',
        `${shuffling.filter((r) => r.deckOpacity > 0.9).length}/${shuffling.length} samples`);

    const sound = await page.evaluate(() => window.__sound);
    check(sound.oscillators + sound.noises >= 2, 'coin and shuffle created sound',
        `${sound.oscillators} tones, ${sound.noises} noises`);
    check(errors.length === 0, 'no page errors', errors.join(' | ') || 'none');

    const outDir = path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, `anim-${vw}x${vh}.png`) });

    console.log(notes.join('\n'));
    await browser.close();
    proc.kill();
    server.close();
    process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
