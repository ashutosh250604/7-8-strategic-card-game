'use strict';
/*
 * Emulated-phone pass (dev only): touch selection, audio-unlock path,
 * haptics calls, and the fixed short-viewport tables.
 *
 * This drives a headless browser with a touch-capable mobile viewport. It is
 * not a substitute for a physical handset: real speaker output and vibration
 * hardware still need a device check.
 *
 *   node mobile-pass.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = path.join('games', '7-8', 'index.html').replace(/\\/g, '/');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};
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

const problems = [];
function expect(label, ok, detail) {
    if (ok) {
        console.log(`ok - ${label}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);
    } else {
        console.log(`FAIL - ${label}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);
        problems.push(label);
    }
}

(async () => {
    await new Promise((r) => server.listen(8106, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-mobile-'));
    const port = 9650 + (process.pid % 200);
    const proc = spawn(EDGE, [
        '--headless=new', '--disable-gpu', '--no-first-run',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows', '--mute-audio',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore' });

    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(300);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* starting */ }
    }
    if (!browser) {
        proc.kill();
        server.close();
        throw new Error('could not connect to Edge');
    }

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.evaluateOnNewDocument(() => {
        // Each viewport iteration needs its own fresh deal; the resume suite
        // covers restored matches separately. The first document is about:blank,
        // where storage is unavailable.
        try { localStorage.removeItem('78-match-v1'); } catch (e) { /* opaque document */ }
        window.__mobileProbe = { vibrations: [], audioContexts: 0, audioResumes: 0, unlocks: 0 };
        try {
            Object.defineProperty(navigator, 'vibrate', {
                configurable: true,
                value: (pattern) => {
                    window.__mobileProbe.vibrations.push(pattern);
                    return true;
                }
            });
        } catch (e) { /* browser refused the override */ }
        const Orig = window.AudioContext || window.webkitAudioContext;
        if (Orig) {
            function WrappedAudioContext(...args) {
                const ctx = new Orig(...args);
                window.__mobileProbe.audioContexts++;
                const resume = ctx.resume.bind(ctx);
                ctx.resume = () => {
                    window.__mobileProbe.audioResumes++;
                    return resume();
                };
                return ctx;
            }
            WrappedAudioContext.prototype = Orig.prototype;
            window.AudioContext = WrappedAudioContext;
            window.webkitAudioContext = WrappedAudioContext;
        }
    });

    const tap = async (selector) => {
        const point = await page.$eval(selector, (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.touchscreen.tap(point.x, point.y);
    };

    const load = async (w, h) => {
        await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await page.goto(`http://127.0.0.1:8106/${gamePath}`, { waitUntil: 'load' });
        await page.evaluate(() => {
            localStorage.setItem('78-settings-v3', JSON.stringify({
                difficulty: 'medium', matchTarget: 3, sound: true, volume: 0.35,
                motion: 'reduced', haptics: true, voice: false, fireworks: false
            }));
        });
        await page.reload({ waitUntil: 'load' });
    };

    const settle = async () => {
        await tap('#start-game');
        await page.waitForSelector('#coin-toss-modal', { visible: true });
        await tap('.coin-btn[data-choice="heads"]');
        // The selector is null while the human is choosing, so wait only for
        // the phase and handle the visible modal below.
        await page.waitForFunction(
            () => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase),
            { timeout: 12000 }
        );
        if (await page.$eval('#trump-selection-modal', (el) => getComputedStyle(el).display !== 'none').catch(() => false)) {
            await tap('.trump-btn[data-suit="spades"]');
        }
        await page.waitForFunction(
            () => GameEngine.state.gamePhase === 'playing' && document.querySelector('#player-hand .card, #player-faceup .card'),
            { timeout: 12000 }
        );
        // Measure the resting table, not cards still flying from the deal.
        await page.waitForFunction(() => GameView.pendingCount() === 0, { timeout: 20000 }).catch(() => {});
        await sleep(250);
    };

    const metrics = () => page.evaluate(() => {
        const rect = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
        };
        const cards = [...document.querySelectorAll('#player-hand .card, #player-faceup .card')].map((el) => {
            const r = el.getBoundingClientRect();
            return {
                source: el.closest('#player-hand') ? 'hand' : 'face-up',
                left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right),
                bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height)
            };
        });
        const visible = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
        const font = (selector) => {
            const el = document.querySelector(selector);
            return visible(el) ? parseFloat(getComputedStyle(el).fontSize) : null;
        };
        const controlSelectors = ['#hud-rules', '#restart-game', '#mute-btn', '#settings-btn'];
        return {
            view: { width: innerWidth, height: innerHeight },
            doc: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
            scrollY: window.scrollY || 0,
            board: rect('.game-board'),
            bubble: rect('#anne-reaction'),
            status: rect('.game-status'),
            trick: rect('#current-trick'),
            trump: visible(document.getElementById('trump-display')) ? rect('#trump-display') : null,
            trumpText: (document.getElementById('trump-display')?.textContent || '').replace(/\s+/g, ' ').trim(),
            cpuCardsBottom: Math.max(0, ...[...document.querySelectorAll('#computer-faceup .card')].map((el) => el.getBoundingClientRect().bottom)),
            cards,
            controls: controlSelectors.map((selector) => {
                const el = document.querySelector(selector);
                if (!visible(el)) return null;
                const r = el.getBoundingClientRect();
                return { selector, width: Math.round(r.width), height: Math.round(r.height) };
            }).filter(Boolean),
            fonts: {
                score: font('.score-name'),
                target: font('.round-info small'),
                hud: font('#hud-rules'),
                cards: font('.player-area .cards-label'),
                tricks: font('.tricks-label'),
                status: font('.game-status span'),
                anne: font('.anne-difficulty')
            }
        };
    });

    const checkFit = async (label) => {
        const m = await metrics();
        const contained = m.cards.every((c) => c.left >= -1 && c.right <= m.view.width + 1 && c.top >= -1 && c.bottom <= m.view.height + 1);
        expect(`${label}: no horizontal overflow`, m.doc.width <= m.view.width, m.doc);
        expect(`${label}: full table fits without page scrolling`, m.doc.height <= m.view.height + 1 && m.scrollY === 0, { doc: m.doc, view: m.view, scrollY: m.scrollY });
        expect(`${label}: every visible player card is on screen`, contained && m.cards.length >= 10, m.cards.slice(0, 2));
        const hand = m.cards.filter((c) => c.source === 'hand');
        const faceUp = m.cards.filter((c) => c.source === 'face-up');
        expect(`${label}: hand cards keep their full size`, hand.length > 0 && hand.every((c) => c.width >= 48 && c.height >= 66), hand.slice(0, 2));
        expect(`${label}: face-up cards keep their table size`, faceUp.length > 0 && faceUp.every((c) => c.width >= 43 && c.height >= 60), faceUp.slice(0, 2));
        expect(`${label}: HUD controls are thumb-sized`, m.controls.every((c) => c.width >= 36 && c.height >= 36), m.controls);
        expect(`${label}: phone labels are readable without zoom`, Object.values(m.fonts).every((px) => px === null || px >= 10.5), m.fonts);
        expect(`${label}: this round's trump is visible beside the trick`,
            m.trump && m.trump.width >= 40 && m.trump.height >= 18 &&
            m.trump.left >= -1 && m.trump.right <= m.view.width + 1 &&
            m.trump.top >= -1 && m.trump.bottom <= m.view.height + 1 && /trump/i.test(m.trumpText),
            { trump: m.trump, text: m.trumpText });
        expect(`${label}: the trump chip clears Anne's card row`,
            m.trump && m.trump.top >= m.cpuCardsBottom - 1,
            { trumpTop: m.trump && m.trump.top, cpuCardsBottom: m.cpuCardsBottom });
        const overlaps = (a, b) => !!(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
        expect(`${label}: turn status is clear of the trick`, !overlaps(m.status, m.trick), { status: m.status, trick: m.trick });
        await page.evaluate(() => TableCharacters.showReaction('Tea is imaginary, the cards are real, and I am watching every trick you play.', 6000));
        await sleep(250);
        const withLine = await metrics();
        expect(`${label}: Anne's long line stays inside the viewport`, withLine.bubble && withLine.bubble.left >= -1 && withLine.bubble.right <= withLine.view.width + 1 && withLine.bubble.top >= 0 && withLine.bubble.bottom <= withLine.view.height, withLine.bubble);
        await page.screenshot({ path: path.join(outDir, `mobile-${label.replace(/[^0-9x]/g, '')}.png`) });
    };

    await load(320, 568);
    const environment = await page.evaluate(() => ({
        coarse: matchMedia('(pointer: coarse)').matches,
        touchPoints: navigator.maxTouchPoints,
        haptics: typeof navigator.vibrate,
        audio: window.GameAudio ? GameAudio.isSupported() : false
    }));
    expect('emulated phone exposes a coarse touch pointer', environment.coarse && environment.touchPoints > 0, environment);
    await settle();
    await checkFit('320x568');
    const compactNew = await page.evaluate(() => {
        const button = document.getElementById('restart-game');
        const wide = button.querySelector('.hud-label-wide');
        const compact = button.querySelector('.hud-label-compact');
        const rect = button.getBoundingClientRect();
        return {
            text: button.innerText.replace(/\s+/g, ' ').trim(),
            wide: getComputedStyle(wide).display,
            compact: getComputedStyle(compact).display,
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        };
    });
    expect('320x568: new-match control uses its compact label',
        /^new$/i.test(compactNew.text) && compactNew.wide === 'none' && compactNew.compact !== 'none' &&
        compactNew.width >= 36 && compactNew.height >= 36, compactNew);

    const before = await page.evaluate(() => ({
        selected: document.querySelectorAll('#player-hand .card.selected, #player-faceup .card.selected').length,
        trick: GameEngine.state.trick.cards.length + GameEngine.state.trickCount * 2
    }));
    const cardSelector = '#player-hand .card.playable, #player-faceup .card.playable';
    await page.waitForFunction((selector) => !!document.querySelector(selector), { timeout: 12000 }, cardSelector);
    const card = await page.$eval(cardSelector, (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.touchscreen.tap(card.x, card.y);
    await sleep(120);
    const selected = await page.evaluate(() => ({
        selected: document.querySelectorAll('#player-hand .card.selected, #player-faceup .card.selected').length,
        trick: GameEngine.state.trick.cards.length + GameEngine.state.trickCount * 2
    }));
    expect('first touch selects a card without playing it', selected.selected === 1 && selected.trick === before.trick, selected);
    const selectedHint = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.player-area .cards-label')];
        const hints = labels.map((label) => getComputedStyle(label, '::after').content);
        return hints.find((text) => /tap again/i.test(text)) || hints.join(' | ');
    });
    expect('a selected touch card tells the player to tap again', /tap again/i.test(selectedHint || ''), selectedHint);

    await page.touchscreen.tap(card.x, card.y);
    const played = await page.waitForFunction(
        (beforeTrick) => GameEngine.state.trick.cards.length + GameEngine.state.trickCount * 2 > beforeTrick,
        { timeout: 6000 }, before.trick
    ).then(() => true).catch(() => false);
    expect('second touch plays the selected card', played, { before: before.trick });
    await sleep(180);
    const probe = await page.evaluate(() => window.__mobileProbe);
    expect('the touch path calls the haptics API', probe.vibrations.length > 0, probe.vibrations);
    expect('the touch path unlocks audio', !environment.audio || probe.audioContexts > 0, {
        contexts: probe.audioContexts, audioSupported: environment.audio, resumes: probe.audioResumes
    });

    for (const [w, h] of [[390, 844], [360, 800]]) {
        await load(w, h);
        await settle();
        await checkFit(`${w}x${h}`);
    }

    await load(844, 390);
    await settle();
    await checkFit('844x390');
    expect('no page errors during the mobile pass', pageErrors.length === 0, pageErrors);

    console.log('\nPROBLEMS:', problems.length ? '\n  ' + problems.join('\n  ') : 'none');
    try { await browser.close(); } catch (e) { /* already gone */ }
    proc.kill();
    server.close();
    process.exit(problems.length ? 1 : 0);
})().catch((e) => {
    console.error('MOBILE PASS FAILED:', e);
    server.close();
    process.exit(2);
});
