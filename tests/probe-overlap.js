'use strict';
/*
 * Dev-only layout audit.
 *
 * Reaches a real playing table and reports, for each viewport:
 *   - pairs of elements that must never overlap (a curated list);
 *   - elements that must be centred on the board, and how far off they are;
 *   - the smallest gaps between stacked blocks;
 *   - every visible piece of text under 11px, with its colour and background,
 *     so the small print can be judged as a whole.
 *
 *   node probe-overlap.js [width] [height] [--all]
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = 'games/7-8/index.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || gamePath;
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAIRS = [
    ['#trick-caption', '#current-trick .card', 'trick caption vs the card in the trick'],
    ['#lead-chip', '#current-trick .card', 'lead chip vs the card in the trick'],
    ['.trick-meta', '#current-trick .card', 'trick meta row vs the card in the trick'],
    ['#current-trick .slot-computer', '#current-trick .slot-player', 'the two trick slots vs each other'],
    ['.computer-area .rival-bar', '.computer-area .seat-cards', 'Anne seat bar vs her cards'],
    ['#computer-tricks .meter', '.computer-hand-area .card', 'Anne trick meter vs her hand cards'],
    ['#score-display', '.hud-right', 'score chip vs the control row'],
    ['#score-display', '.hud-brand', 'score chip vs the brand'],
    ['#round-info', '#score-player', 'round info vs the player score'],
    ['#player-tricks', '#player-hand .card', 'player trick meter vs the hand cards'],
    ['#player-tricks', '#player-faceup .card', 'player trick meter vs the face-up cards'],
    ['#anne-reaction', '.hud-right', 'Anne bubble vs the control row'],
    ['#anne-reaction', '#computer-hand .card', 'Anne bubble vs her hand cards'],
    ['#anne-reaction', '.hud-brand', 'Anne bubble vs the brand'],
    ['#game-status', '.player-area .seat-cards', 'status line vs the player cards'],
    ['#game-status', '.game-controls', 'status line vs the controls'],
    ['#deck', '.trick-stage', 'deck vs the trick stage'],
    ['.start-panel', '.player-area', 'start panel vs the player seat'],
    ['#new-round', '.player-area', 'new round button vs the player seat'],
    ['#live-coach', '#game-status', 'coach vs the status line']
];

const CENTERED = [
    ['#score-display', null, 'score chip in the header'],
    ['#round-info', '#score-display', 'round info inside the score chip'],
    ['.trick-stage', '.center-area', 'trick stage in the centre area'],
    ['#current-trick', '.trick-stage', 'trick tray in the stage'],
    ['#game-status', '.center-area', 'status line in the centre area'],
    ['#game-status', null, 'status line in the viewport'],
    ['#player-tricks', null, 'bottom trick meter in the viewport'],
    ['.computer-area .seat-who', '.computer-area .rival-bar', 'Anne identity block in her bar']
];

(async () => {
    const width = Number(process.argv[2]) || 1440;
    const height = Number(process.argv[3]) || 900;
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-ovl-'));
    const port = 9200 + (process.pid % 500);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('no browser'); }
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${gamePath}`, { waitUntil: 'load' });
    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 15000 });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase), { timeout: 25000 });
    if (await page.evaluate(() => getComputedStyle(document.getElementById('trump-selection-modal')).display !== 'none')) {
        await page.click('.trump-btn[data-suit="spades"]');
    }
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 15000 });
    // Play one card so the trick tray holds a card and its caption is live.
    await page.waitForFunction(() => GameEngine.state.currentPlayer === 'player' && !GameEngine.state.resolvingTrick, { timeout: 20000 });
    await page.evaluate(() => {
        const gs = GameEngine.state;
        const pick = [];
        ['hand', 'faceUp'].forEach((src) => gs.player[src].forEach((card, index) => {
            if (card && GameEngine.isValidPlay(card, gs.trick.leadSuit)) pick.push({ index, source: src });
        }));
        if (pick.length) GameEngine.playCard(pick[0].index, pick[0].source);
    });
    // Measure with a card actually in the trick tray: that is when the label,
    // the lead chip and the slots all have to share the stage.
    await page.waitForFunction(() => document.querySelectorAll('#current-trick .card').length > 0, { timeout: 15000 });
    await page.evaluate(() => { if (window.TableCharacters) TableCharacters.showReaction('Nine of clubs? You are counting, I can tell.', 8000); });
    await sleep(120);

    const report = await page.evaluate((pairs, centered) => {
        const box = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            if (r.width < 1 && r.height < 1) return null;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
        };
        const overlaps = [];
        for (const [a, b, note] of pairs) {
            const A = box(a), B = box(b);
            if (!A || !B) { overlaps.push({ pair: `${a} / ${b}`, note, state: 'missing' }); continue; }
            const ix = Math.min(A.right, B.right) - Math.max(A.left, B.left);
            const iy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
            if (ix > 1 && iy > 1) {
                overlaps.push({ pair: `${a} / ${b}`, note, overlapW: Math.round(ix), overlapH: Math.round(iy), area: Math.round(ix * iy), a: { l: Math.round(A.left), t: Math.round(A.top), r: Math.round(A.right), b: Math.round(A.bottom) }, bb: { l: Math.round(B.left), t: Math.round(B.top), r: Math.round(B.right), b: Math.round(B.bottom) } });
            }
        }
        const offCentre = [];
        for (const [sel, refSel, note] of centered) {
            const A = box(sel);
            const R = refSel ? box(refSel) : { cx: innerWidth / 2 };
            if (!A || !R) { offCentre.push({ sel, note, state: 'missing' }); continue; }
            const dx = Math.round(A.cx - R.cx);
            if (Math.abs(dx) > 3) offCentre.push({ sel, note, dx, cx: Math.round(A.cx), ref: Math.round(R.cx) });
        }
        const small = [];
        document.querySelectorAll('body *').forEach((el) => {
            if (!el.textContent || el.children.length) return;
            const text = el.textContent.trim();
            if (!text) return;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.4) return;
            const size = parseFloat(cs.fontSize);
            if (size >= 11) return;
            let bgEl = el, bg = 'rgba(0, 0, 0, 0)';
            while (bgEl) {
                const c = getComputedStyle(bgEl).backgroundColor;
                if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
                bgEl = bgEl.parentElement;
            }
            small.push({ text: text.slice(0, 26), size: +size.toFixed(1), color: cs.color, bg, cls: el.className || el.id || el.tagName });
        });
        return {
            viewport: `${innerWidth}x${innerHeight}`,
            doc: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight },
            overlaps,
            offCentre,
            small
        };
    }, PAIRS, CENTERED);

    console.log(`\n===== ${report.viewport} =====`);
    console.log(`page: scrollW ${report.doc.scrollW} vs clientW ${report.doc.clientW} (overflow ${report.doc.scrollW - report.doc.clientW}); scrollH ${report.doc.scrollH} vs clientH ${report.doc.clientH} (overflow ${report.doc.scrollH - report.doc.clientH})`);
    console.log(`overlaps: ${report.overlaps.length}`);
    report.overlaps.forEach((o) => console.log(`  ${o.note}: ${o.state || `w ${o.overlapW} x h ${o.overlapH} (area ${o.area})  A=${JSON.stringify(o.a)} B=${JSON.stringify(o.bb)}`}`));
    console.log(`off centre: ${report.offCentre.length}`);
    report.offCentre.forEach((o) => console.log(`  ${o.note}: ${o.state || `dx ${o.dx}px (${o.cx} vs ${o.ref})`}`));
    console.log(`text under 11px: ${report.small.length}`);
    report.small.forEach((s) => console.log(`  ${String(s.size).padStart(4)}px  ${s.cls}  "${s.text}"  ${s.color} on ${s.bg}`));

    await page.screenshot({ path: path.join(__dirname, 'out', `overlap-${width}x${height}.png`) });
    await browser.disconnect();
    proc.kill();
    server.close();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
