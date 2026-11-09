'use strict';
/*
 * Responsive layout E2E (dev only).
 *
 * Opens the real table at desktop and phone sizes, settles a deal with reduced
 * motion, then checks that the table, settings and result screens fit without
 * clipping the actions a player needs. Screenshots are written to tests/out.
 *
 *   node layout-e2e.js
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
    await new Promise((r) => server.listen(8102, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-layout-'));
    const port = 9600 + (process.pid % 300);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('could not connect to Edge'); }

    const problems = [];
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT/.test(m.text())) problems.push('console: ' + m.text());
    });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    const expect = (label, condition, detail) => {
        if (!condition) problems.push(`${label}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);
        console.log((condition ? 'ok - ' : 'FAIL - ') + label);
    };

    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(() => {
        // This suite reloads to measure fresh setups; start each document from
        // setup rather than resuming the previous viewport's deal.
        localStorage.removeItem('78-match-v1');
        localStorage.setItem('78-settings-v3', JSON.stringify({ motion: 'reduced', sound: false }));
    });

    // The collection homepage is the first thing a new player sees. Anne's
    // host line and the 7-8 live tile must both fit at phone sizes.
    await page.goto('http://127.0.0.1:8102/index.html', { waitUntil: 'load' });
    for (const view of [{ w: 1440, h: 900 }, { w: 390, h: 844 }, { w: 320, h: 568 }]) {
        await page.setViewport({ width: view.w, height: view.h });
        await page.reload({ waitUntil: 'load' });
        const homeScroll = await page.evaluate(() => {
            const doc = document.documentElement;
            const prevBehavior = doc.style.scrollBehavior;
            doc.style.scrollBehavior = 'auto';
            window.scrollTo(0, doc.scrollHeight);
            const reached = window.scrollY;
            window.scrollTo(0, 0);
            doc.style.scrollBehavior = prevBehavior;
            return { overflowY: getComputedStyle(doc).overflowY, docH: doc.scrollHeight, reached };
        });
        expect(`${view.w}x${view.h}: collection page scrolls to its footer`,
            homeScroll.overflowY !== 'hidden' && homeScroll.docH > view.h && homeScroll.reached > 20, homeScroll);
        await page.screenshot({ path: path.join(outDir, `layout-home-${view.w}x${view.h}.png`) });
        await page.evaluate(() => document.querySelector('.hero-host').scrollIntoView({ block: 'center' }));
        const home = await page.evaluate(() => {
            const host = document.querySelector('.hero-host');
            const drawn = document.querySelector('.hero-host-avatar .aa-photo');
            const tile = document.querySelector('.game-tile.is-live');
            const r = host.getBoundingClientRect();
            return {
                docW: document.documentElement.scrollWidth,
                host: r.toJSON(),
                avatar: drawn ? Math.round(drawn.getBoundingClientRect().width) : 0,
                tileHref: tile ? tile.getAttribute('href') : null
            };
        });
        expect(`${view.w}x${view.h}: collection fits without horizontal overflow`, home.docW <= view.w, home.docW);
        expect(`${view.w}x${view.h}: Anne host line is visible and loaded`, home.host.top >= 0 && home.host.bottom <= view.h && home.avatar > 0, home);
        expect(`${view.w}x${view.h}: live tile still opens 7-8`, /games\/7-8\/index\.html/.test(home.tileHref || ''), home.tileHref);
    }
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:8102/${gamePath}`, { waitUntil: 'load' });

    const measure = () => page.evaluate(() => {
        const rect = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display };
        };
        return {
            view: { w: innerWidth, h: innerHeight },
            docW: document.documentElement.scrollWidth,
            docH: document.documentElement.scrollHeight,
            scrollY: window.scrollY || window.pageYOffset || 0,
            board: rect('.game-board'),
            hud: rect('.game-header'),
            pHand: rect('#player-hand'),
            pUp: rect('#player-faceup'),
            cHand: rect('#computer-hand'),
            cUp: rect('#computer-faceup'),
            trick: rect('#current-trick'),
            trump: rect('#trump-display'),
            trumpText: (document.getElementById('trump-display')?.textContent || '').replace(/\s+/g, ' ').trim(),
            centerZ: getComputedStyle(document.querySelector('.center-area')).zIndex,
            seatZ: getComputedStyle(document.querySelector('.computer-area')).zIndex,
            avatar: rect('#anne-portrait'),
            // The seat portrait is an inline animated SVG now, so "loaded" means
            // the photograph actually loaded into the seat.
            avatarLoaded: (() => { const img = document.querySelector('#anne-portrait .aa-photo'); return img && img.complete && img.naturalWidth > 0 ? 1 : 0; })(),
            start: rect('#start-game'),
            settings: rect('#settings-btn'),
            controls: [...document.querySelectorAll('#player-hand .card, #player-faceup .card')].map((c) => {
                const r = c.getBoundingClientRect();
                return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
            })
        };
    });

    const checkTable = async (label) => {
        const m = await measure();
        expect(`${label}: no horizontal document overflow`, m.docW <= m.view.w, { docW: m.docW, width: m.view.w });
        // Every target viewport is a fixed table now. If this grows, the CSS
        // compact-fit rules have regressed and cards are being pushed below
        // the fold rather than fitting the screen.
        expect(`${label}: table fits without vertical page scrolling`, m.docH <= m.view.h + 1, { docH: m.docH, viewH: m.view.h });
        const inside = (r) => r && r.left >= -1 && r.right <= m.view.w + 1 && r.top >= -1 && r.bottom <= m.view.h + 1;
        expect(`${label}: player hand and table cards stay on screen`, [m.pHand, m.pUp, m.cHand, m.cUp, m.trick].every(inside), m);
        // Keep the cards at their real size: the compact layout may reclaim
        // chrome and felt, but it must not shrink the hand or face-up rows to
        // force a fit. Face-up cards are deliberately 0.86x the hand size.
        expect(`${label}: human cards keep a readable tap box`, m.controls.every((r) => r.right - r.left >= 40 && r.bottom - r.top >= 56), m.controls.slice(0, 3));
        expect(`${label}: Anne portrait loaded`, m.avatarLoaded > 0 && m.avatar && m.avatar.w >= 24, { loaded: m.avatarLoaded, avatar: m.avatar });
        expect(`${label}: this round's trump is visible`, m.trump && m.trump.display !== 'none' && inside(m.trump) && /trump/i.test(m.trumpText), { trump: m.trump, text: m.trumpText });
        expect(`${label}: played cards layer above both seats`, Number(m.centerZ) > Number(m.seatZ), { centerZ: m.centerZ, seatZ: m.seatZ });
        const overlaps = m.controls.filter((r) => r.left < -1 || r.right > m.view.w + 1 || r.bottom > m.view.h + 1);
        expect(`${label}: no clipped player cards`, overlaps.length === 0, overlaps.slice(0, 2));
    };

    const settleGame = async () => {
        await page.click('#start-game');
        await page.waitForSelector('#coin-toss-modal', { visible: true });
        await page.click('.coin-btn[data-choice="heads"]');
        // Do not require lastTrumpSelector here: when the human wins the toss
        // it is null until they choose, so waiting on it deadlocks before the
        // modal click below can happen.
        await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase), { timeout: 10000 });
        if (await page.$eval('#trump-selection-modal', (el) => getComputedStyle(el).display !== 'none').catch(() => false)) {
            await page.click('.trump-btn[data-suit="spades"]');
        }
        await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing' && document.querySelector('#player-hand .card, #player-faceup .card'), { timeout: 10000 });
        // Wait for the last dealt card to land before measuring the table.
        await page.waitForFunction(() => GameView.pendingCount() === 0, { timeout: 20000 }).catch(() => {});
    };

    const showResult = () => page.evaluate(() => {
        GameEngine.state.player.score = 3;
        GameEngine.state.computer.score = 1;
        GameEngine.state.matchTarget = 3;
        GameEngine.state.gameStarted = true;
        GameEngine.state.gameOver = false;
        checkGameEnd();
    });

    for (const view of [{ w: 1440, h: 900 }, { w: 390, h: 844 }, { w: 320, h: 568 }, { w: 844, h: 390 }]) {
        await page.setViewport({ width: view.w, height: view.h });
        await page.reload({ waitUntil: 'load' });
        const setup = await measure();
        expect(`${view.w}x${view.h}: setup fits without horizontal overflow`, setup.docW <= view.w, setup.docW);
        expect(`${view.w}x${view.h}: setup fits without vertical page scrolling`, setup.docH <= view.h + 1, { docH: setup.docH, viewH: view.h });
        expect(`${view.w}x${view.h}: start action is visible`, setup.start && setup.start.bottom <= view.h, setup.start);
        await page.screenshot({ path: path.join(outDir, `layout-setup-${view.w}x${view.h}.png`) });
    }

    await page.setViewport({ width: 1440, height: 900 });
    await page.reload({ waitUntil: 'load' });
    await settleGame();
    await checkTable('1440x900 live');
    await page.screenshot({ path: path.join(outDir, 'layout-playing-1440x900.png') });

    await page.setViewport({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'load' });
    await settleGame();
    await checkTable('390x844 live');
    await sleep(1600);
    await page.screenshot({ path: path.join(outDir, 'layout-playing-390x844.png') });

    const goal = await page.evaluate(() => (document.getElementById('round-info').textContent || '').replace(/\s+/g, ' ').trim());
    expect('390x844: the HUD states the point target, not a round count',
        /first to/i.test(goal) && /points/i.test(goal) && !/round/i.test(goal), goal);

    await page.evaluate(() => {
        const target = GameEngine.getTrickTarget('computer');
        GameEngine.state.computer.tricksWon = target;
        GameView.render();
    });
    // Her reaction is scheduled after the render beat; wait for the live
    // bubble instead of sampling it in the same frame it is requested.
    const targetLine = await page.waitForFunction(() => {
        const bubble = document.getElementById('anne-reaction');
        return bubble && !bubble.hidden && bubble.textContent.trim().length > 8
            ? { text: bubble.textContent.trim(), visible: true }
            : false;
    }, { timeout: 5000 }).then((handle) => handle.jsonValue()).catch(() => null);
    const target = await page.evaluate(() => GameEngine.getTrickTarget('computer'));
    // The wording is hers and changes between rounds; the behaviour is that she
    // says something the moment her target is reached.
    expect('390x844: Anne reacts once when she reaches her trick target', target > 0 && targetLine && targetLine.visible, { target, targetLine });

    // She has to read as a person saying the line: the living portrait present,
    // and the bubble attached to her plate rather than pinned under her cards.
    const face = await page.evaluate(() => {
        const avatar = document.getElementById('anne-portrait');
        const img = avatar.querySelector('.aa-photo');
        const bubble = document.getElementById('anne-reaction');
        TableCharacters.showReaction('Right beside you, like a person.', 4000);
        const ar = avatar.getBoundingClientRect();
        const br = bubble.getBoundingClientRect();
        return {
            drawn: !!(img && img.complete && img.naturalWidth > 0),
            size: Math.round(ar.width),
            gapY: Math.round(br.top - ar.bottom),
            aligned: Math.abs(br.left - ar.left) <= 28,
            onScreen: br.left >= 0 && br.right <= innerWidth && br.top >= 0 && br.bottom <= innerHeight
        };
    });
    expect('390x844: Anne is the living portrait with her line attached to her plate',
        face.drawn && face.size >= 60 && face.gapY >= 0 && face.gapY <= 120 && face.onScreen, face);

    await page.click('#settings-btn');
    await page.waitForSelector('#settings-modal', { visible: true });
    const settingsFit = await page.evaluate(() => {
        const modal = document.querySelector('#settings-modal .modal-content');
        const action = document.getElementById('settings-tutorial');
        const r = modal.getBoundingClientRect();
        const a = action.getBoundingClientRect();
        action.scrollIntoView({ block: 'nearest' });
        return { modal: r.toJSON(), action: a.toJSON(), canScroll: modal.scrollHeight > modal.clientHeight };
    });
    expect('390x844: settings dialog is usable and scrollable', settingsFit.modal.top >= 0 && settingsFit.modal.bottom <= 844 && settingsFit.canScroll, settingsFit);
    await page.screenshot({ path: path.join(outDir, 'layout-settings-390x844.png') });
    await page.click('#close-settings');

    // Keyboard: a real Tab-focusable card must accept Arrow keys and Enter.
    await page.waitForFunction(() => GameEngine.state.currentPlayer === 'player' && !GameEngine.state.resolvingTrick && document.querySelector('#player-hand .card.playable, #player-faceup .card.playable'), { timeout: 20000 });
    const beforeKeyboard = await page.evaluate(() => {
        const card = document.querySelector('#player-hand .card.playable, #player-faceup .card.playable');
        card.focus();
        return { active: document.activeElement === card, label: card.getAttribute('aria-label'), count: GameEngine.state.trick.cards.length + GameEngine.state.trickCount * 2 };
    });
    await page.keyboard.press('ArrowRight');
    const moved = await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('card'));
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    const keyboardPlayed = await page.waitForFunction((before) => GameEngine.state.trick.cards.length + GameEngine.state.trickCount * 2 > before, { timeout: 5000 }, beforeKeyboard.count).then(() => true).catch(() => false);
    expect('390x844: cards are keyboard focusable and playable', beforeKeyboard.active && !!beforeKeyboard.label && moved && keyboardPlayed, { beforeKeyboard, moved, keyboardPlayed });

    // The result screen is checked with full motion so the victory celebration
    // is exercised, not just the layout of a still panel.
    await page.evaluate(() => TableSettings.update({ motion: 'full', fireworks: true }));
    await showResult();
    await page.waitForSelector('#game-over-modal', { visible: true });
    await sleep(1450);
    const fireworks = await page.evaluate(() => ({
        active: !!(window.TableFireworks && TableFireworks.active()),
        live: document.getElementById('fireworks-canvas')?.classList.contains('is-live'),
        particles: window.TableFireworks ? TableFireworks.particleCount() : 0
    }));
    expect('390x844: victory produces premium fireworks', fireworks.active && fireworks.live && fireworks.particles > 0, fireworks);
    const resultFit = await page.evaluate(() => {
        const modal = document.querySelector('.gameover-modal');
        const play = document.getElementById('play-again');
        const home = document.querySelector('.result-home');
        const mr = modal.getBoundingClientRect();
        const pr = play.getBoundingClientRect();
        const hr = home.getBoundingClientRect();
        return { modal: mr.toJSON(), play: pr.toJSON(), home: hr.toJSON(), scroll: modal.scrollHeight, client: modal.clientHeight };
    });
    expect('390x844: result actions stay reachable', resultFit.play.bottom <= 844 && resultFit.home.bottom <= 844, resultFit);
    await page.screenshot({ path: path.join(outDir, 'layout-result-390x844.png') });

    await page.setViewport({ width: 320, height: 568 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const smallResult = await page.evaluate(() => {
        const modal = document.querySelector('.gameover-modal');
        const play = document.getElementById('play-again');
        play.scrollIntoView({ block: 'nearest' });
        const pr = play.getBoundingClientRect();
        return { play: pr.toJSON(), scroll: modal.scrollHeight, client: modal.clientHeight, canScroll: modal.scrollHeight > modal.clientHeight };
    });
    expect('320x568: result primary action is reachable', smallResult.play.top >= 0 && smallResult.play.bottom <= 568, smallResult);
    await page.screenshot({ path: path.join(outDir, 'layout-result-320x568.png') });

    // Landscape phone with the result still open.
    await page.setViewport({ width: 844, height: 390 });
    const landscapeResult = await page.evaluate(() => {
        const play = document.getElementById('play-again');
        play.scrollIntoView({ block: 'nearest' });
        const r = play.getBoundingClientRect();
        return { play: r.toJSON(), scroll: document.querySelector('.gameover-modal').scrollHeight, client: document.querySelector('.gameover-modal').clientHeight };
    });
    expect('844x390: result primary action is reachable', landscapeResult.play.top >= 0 && landscapeResult.play.bottom <= 390, landscapeResult);
    await page.screenshot({ path: path.join(outDir, 'layout-result-844x390.png') });

    // Fresh live table at the two smallest target sizes.
    await page.evaluate(() => GameEngine.restartGame());
    await sleep(300);
    for (const view of [{ w: 320, h: 568 }, { w: 844, h: 390 }]) {
        await page.setViewport({ width: view.w, height: view.h });
        await page.reload({ waitUntil: 'load' });
        await settleGame();
        await checkTable(`${view.w}x${view.h} live`);
        await page.screenshot({ path: path.join(outDir, `layout-playing-${view.w}x${view.h}.png`) });
    }

    console.log('\nPROBLEMS:', problems.length ? '\n  ' + problems.join('\n  ') : 'none');
    try { await browser.close(); } catch (e) { /* already gone */ }
    proc.kill();
    server.close();
    process.exit(problems.length ? 1 : 0);
})().catch((e) => {
    console.error('LAYOUT E2E FAILED:', e);
    server.close();
    process.exit(2);
});
