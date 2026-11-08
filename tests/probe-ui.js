'use strict';
/*
 * Dev-only UI probe: reaches the playing table in a real browser, then reports
 * duplicate card elements, vertical overflow, off-centre blocks and the sizes /
 * contrast of the small labels.   node probe-ui.js [width] [height]
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseColor(str) {
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return { r, g, b, a };
}
function lum({ r, g, b }) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
    const a = lum(fg), b = lum(bg);
    return ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
}

(async () => {
    const width = Number(process.argv[2]) || 1280;
    const height = Number(process.argv[3]) || 800;
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-ui-'));
    const port = 9600 + (process.pid % 300);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('no browser'); }
    await new Promise((r) => server.listen(8103, '127.0.0.1', r));
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.goto(`http://127.0.0.1:8103/${gamePath}`, { waitUntil: 'load' });

    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 12000 });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase), { timeout: 20000 });
    if (await page.evaluate(() => getComputedStyle(document.getElementById('trump-selection-modal')).display !== 'none')) {
        await page.click('.trump-btn[data-suit="spades"]');
    }
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 15000 });
    await sleep(1600);

    // Force one of Anne's lines so the bubble can be measured against the cards
    // it must never cover.
    await page.evaluate(() => { if (window.TableCharacters) TableCharacters.showReaction('Nice card, friend. Show me another.', 6000); });
    await sleep(400);

    const bubble = await page.evaluate(() => {
        const b = document.getElementById('anne-reaction');
        const r = b.getBoundingClientRect();
        const hits = [];
        ['#computer-faceup .cards-container', '#computer-hand .cards-container', '#player-hand .cards-container', '#player-faceup .cards-container']
            .forEach((sel) => {
                const el = document.querySelector(sel);
                if (!el) return;
                const o = el.getBoundingClientRect();
                if (r.left < o.right && o.left < r.right && r.top < o.bottom && o.top < r.bottom) hits.push(sel);
            });
        return {
            rect: r.toJSON(), cx: Math.round(r.x + r.width / 2), covers: hits, text: b.textContent,
            pos: getComputedStyle(b).position,
            anchor: b.offsetParent ? (b.offsetParent.id || b.offsetParent.className) : 'none',
            area: b.offsetParent ? b.offsetParent.getBoundingClientRect().toJSON() : null
        };
    });
    console.log('bubble', JSON.stringify(bubble));

    const report = await page.evaluate(() => {
        const rect = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), cx: Math.round(r.x + r.width / 2) };
        };
        const counts = {};
        document.querySelectorAll('.card[data-card]').forEach((c) => { counts[c.dataset.card] = (counts[c.dataset.card] || 0) + 1; });
        const duplicates = Object.entries(counts).filter(([, n]) => n > 1);
        const labels = [...document.querySelectorAll('.cards-label, .tricks-label, .difficulty-indicator, .brand-sub, .player-label, .legend-note, .start-note, .hint, .trick-caption, .game-status, .anne-role, .anne-mood')]
            .filter((el) => el.getBoundingClientRect().width > 0)
            .slice(0, 24)
            .map((el) => {
                const cs = getComputedStyle(el);
                let bgEl = el, bg = 'rgba(0, 0, 0, 0)';
                while (bgEl) {
                    const c = getComputedStyle(bgEl).backgroundColor;
                    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
                    bgEl = bgEl.parentElement;
                }
                return { text: el.textContent.trim().slice(0, 22), size: cs.fontSize, color: cs.color, bg, weight: cs.fontWeight, spacing: cs.letterSpacing };
            });
        return {
            viewport: { w: innerWidth, h: innerHeight },
            doc: { scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth },
            board: rect('.game-board'),
            seatTop: rect('.computer-area'),
            center: rect('.center-area'),
            seatBottom: rect('.player-area'),
            hand: rect('#player-hand .cards-container'),
            handCard: rect('#player-hand .card'),
            faceUpMine: rect('#player-faceup .cards-container'),
            annHand: rect('#computer-hand .cards-container'),
            annUp: rect('#computer-faceup .cards-container'),
            annUpLabel: rect('#computer-faceup .cards-label') || rect('.computer-area .card-area:last-child .cards-label'),
            annUpCard: rect('#computer-faceup .card'),
            myUpLabel: rect('#player-faceup .cards-label') || rect('.player-area .card-area:first-child .cards-label'),
            overlaps: (() => {
                const out = [];
                const pairs = [['#computer-faceup .cards-label', '#computer-faceup .card'], ['#player-faceup .cards-label', '#player-faceup .card'], ['#player-hand .cards-label', '#player-hand .card']];
                for (const [a, b] of pairs) {
                    const A = document.querySelector(a), B = document.querySelector(b);
                    if (!A || !B) continue;
                    const r1 = A.getBoundingClientRect(), r2 = B.getBoundingClientRect();
                    const hit = r1.left < r2.right && r2.left < r1.right && r1.top < r2.bottom && r2.top < r1.bottom;
                    out.push({ pair: a, hit, labelBottom: Math.round(r1.bottom), cardTop: Math.round(r2.top) });
                }
                return out;
            })(),
            trick: rect('.trick-stage'),
            seatBar: rect('.computer-area .seat-bar'),
            meter: rect('#computer-tricks .meter'),
            meterLastRight: (() => {
                const m = document.querySelector('#computer-tricks .meter');
                if (!m) return null;
                const last = [...m.children].pop();
                return last ? Math.round(last.getBoundingClientRect().right) : null;
            })(),
            meterDots: (() => {
                const m = document.querySelector('#computer-tricks .meter');
                return m ? m.children.length : 0;
            })(),
            status: rect('#game-status'),
            cards: document.querySelectorAll('.card').length,
            duplicates,
            labels
        };
    });
    console.log(JSON.stringify(report, null, 1));

    await page.screenshot({ path: path.join(outDir, `ui-${width}x${height}.png`) });
    await browser.close();
    proc.kill();
    server.close();
})();
