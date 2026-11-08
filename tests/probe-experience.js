'use strict';
/*
 * One-off diagnostic (dev only): what actually runs in the browser for sound,
 * shuffle, coin flip and layout. Writes screenshots to tests/out.
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
    await new Promise((r) => server.listen(8107, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-probe-'));
    const port = 9800 + (process.pid % 150);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('could not connect to Edge'); }

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    const logs = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));

    await page.evaluateOnNewDocument(() => {
        window.__audio = { contexts: 0, states: [], starts: 0, gains: [] };
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
    });

    await page.goto(`http://127.0.0.1:8107/${gamePath}`, { waitUntil: 'networkidle0' });
    await sleep(600);

    console.log('base:', JSON.stringify(await page.evaluate(() => ({
        gsap: typeof gsap !== 'undefined' ? gsap.version : null,
        audio: !!window.GameAudio,
        settings: window.TableSettings ? window.TableSettings.get() : null,
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches
    }))));
    await page.screenshot({ path: path.join(outDir, 'probe-setup.png') });

    // First gesture also unlocks audio.
    await page.click('#start-game');
    await sleep(420);
    console.log('after start (audio/shuffle):', JSON.stringify(await page.evaluate(() => ({
        audio: window.__audio,
        boardCls: document.querySelector('.game-board').className,
        deckCards: document.querySelectorAll('#deck > *').length
    }))));
    await page.screenshot({ path: path.join(outDir, 'probe-shuffle.png') });

    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 5000 }).catch(() => console.log('no coin modal'));
    await page.click('.coin-btn[data-choice="heads"]').catch(() => console.log('no heads button'));

    const coinSamples = [];
    for (let i = 0; i < 14; i++) {
        await sleep(90);
        coinSamples.push(await page.evaluate(() => {
            const coin = document.getElementById('coin');
            const modal = document.getElementById('coin-toss-modal');
            if (!coin) return null;
            return {
                modal: modal ? getComputedStyle(modal).display : 'missing',
                transform: getComputedStyle(coin).transform,
                cls: coin.className,
                result: document.getElementById('coin-result')?.textContent.trim() || ''
            };
        }));
    }
    console.log('coin samples:', JSON.stringify(coinSamples));
    await page.screenshot({ path: path.join(outDir, 'probe-coin.png') });

    await page.waitForFunction(() => {
        const m = document.getElementById('coin-toss-modal');
        return !m || getComputedStyle(m).display === 'none';
    }, { timeout: 30000 }).catch(() => console.log('coin modal never hid'));
    await sleep(800);
    await page.screenshot({ path: path.join(outDir, 'probe-table.png') });
    console.log('table state:', JSON.stringify(await page.evaluate(() => ({
        audio: window.__audio,
        boardCls: document.querySelector('.game-board').className,
        trumpModal: getComputedStyle(document.getElementById('trump-selection-modal')).display,
        status: document.getElementById('game-status').textContent.trim(),
        cHand: document.querySelectorAll('#computer-hand .cards-container .card').length,
        cUp: document.querySelectorAll('#computer-faceup .cards-container .card').length,
        pHand: document.querySelectorAll('#player-hand .cards-container .card').length
    }))));
    console.log('small text:', JSON.stringify(await page.evaluate(() => {
        const seen = new Map();
        [...document.querySelectorAll('body *')].forEach((el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') return;
            if (!el.children.length || el.matches('button, span, b, em, small, p, h1, h2, h3, h4, label, output')) {
                const size = parseFloat(cs.fontSize);
                if (size < 11.5 && el.textContent.trim().length) {
                    const key = (el.className || el.id || el.tagName) + '|' + size;
                    if (!seen.has(key)) seen.set(key, { sel: el.id ? '#' + el.id : '.' + String(el.className).split(' ').join('.'), size, text: el.textContent.trim().slice(0, 40) });
                }
            }
        });
        return [...seen.values()].slice(0, 60);
    })));
    console.log('layout:', JSON.stringify(await page.evaluate(() => {
        const out = {};
        ['hud', 'score-display', 'anne-reaction', 'game-board', 'player-hand', 'player-faceup', 'trick-stage'].forEach((id) => {
            const el = document.getElementById(id) || document.querySelector('.' + id);
            if (!el) return;
            const r = el.getBoundingClientRect();
            out[id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) };
        });
        return out;
    })));
    console.log('logs:', logs.slice(-10).join('\n'));
    await browser.close();
    proc.kill();
    server.close();
})().catch((e) => { console.error(e); process.exit(1); });
