'use strict';
/*
 * Settings and match-control E2E (dev only).
 *
 * Verifies in a real browser that preferences survive a reload, malformed stored
 * values fall back safely, the match target cannot move inside a live match,
 * reduced motion settles quickly, and unsupported haptics stay harmless.
 *
 *   node settings-e2e.js
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
    await new Promise((r) => server.listen(8100, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-settings-'));
    const port = 9500 + (process.pid % 300);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* not up yet */ }
    }
    if (!browser) { proc.kill(); throw new Error('could not connect to Edge'); }

    const problems = [];
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT/.test(m.text())) problems.push('console: ' + m.text());
    });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => {
        const u = r.url();
        if (/googletagmanager|google-analytics/.test(u) || /ERR_BLOCKED_BY_CLIENT/.test(String(r.failure() && r.failure().errorText))) return;
        problems.push('requestfailed: ' + u);
    });

    const expect = (label, condition, detail) => {
        if (!condition) problems.push(`${label}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);
        console.log((condition ? 'ok - ' : 'FAIL - ') + label);
    };
    const prefs = () => page.evaluate(() => window.TableSettings.get());
    const openSettings = async () => {
        await page.click('#settings-btn');
        await page.waitForFunction(() => getComputedStyle(document.getElementById('settings-modal')).display !== 'none');
    };

    await page.goto(`http://127.0.0.1:8100/${gamePath}`, { waitUntil: 'load' });
    await page.evaluate(() => {
        localStorage.setItem('78-settings-v2', JSON.stringify({
            difficulty: 'nightmare', matchTarget: 4, volume: 12, motion: 'warp', sound: 'yes', haptics: 'maybe'
        }));
    });
    await page.reload({ waitUntil: 'load' });
    const safe = await prefs();
    // Out-of-range audio is clamped; unknown strategies, targets and motion
    // modes fall back to their defaults. Nothing malformed reaches the engine.
    expect('invalid stored values fall back safely',
        safe.difficulty === 'medium' && safe.matchTarget === 5 && safe.volume === 1 && safe.motion === 'full' && safe.sound === true,
        safe);

    await openSettings();
    await page.click('.target-btn[data-target="3"]');
    await page.click('.difficulty-btn[data-difficulty="hard"]');
    await page.click('.motion-btn[data-motion="reduced"]');
    await page.click('#settings-sound');
    const changed = await prefs();
    expect('settings controls update the store', changed.matchTarget === 3 && changed.difficulty === 'hard' && changed.motion === 'reduced' && changed.sound === false, changed);
    expect('engine receives the new difficulty', await page.evaluate(() => GameEngine.state.difficulty === 'hard'));
    const note = await page.$eval('#target-note', (el) => el.textContent.trim());
    expect('target note explains the next match', /next match/i.test(note) && /3/.test(note), note);
    await page.click('#close-settings');

    await openSettings();
    await page.$eval('#settings-volume', (el) => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    expect('master volume updates the store', Math.abs((await prefs()).volume - 0.35) < 0.001);
    await page.click('#close-settings');
    await page.click('#mute-btn');
    const unmuted = await page.evaluate(() => ({ sound: TableSettings.get().sound, pressed: document.getElementById('mute-btn').getAttribute('aria-pressed') }));
    expect('HUD mute control restores sound', unmuted.sound === true && unmuted.pressed === 'false', unmuted);
    const audio = await page.evaluate(() => {
        const names = ['shuffle', 'deal', 'select', 'place', 'trickWin', 'coin', 'coinLand', 'victory', 'defeat', 'invalid'];
        const results = {};
        for (const name of names) {
            try { GameAudio.play(name); results[name] = 'ok'; } catch (e) { results[name] = e.message; }
        }
        return { supported: GameAudio.isSupported(), results };
    });
    expect('every sound effect fails safely when called', Object.values(audio.results).every((v) => v === 'ok'), audio);

    await page.reload({ waitUntil: 'load' });
    const reloaded = await prefs();
    expect('preferences survive a reload', reloaded.matchTarget === 3 && reloaded.difficulty === 'hard' && reloaded.motion === 'reduced' && reloaded.sound === true, reloaded);
    expect('master volume survives a reload', Math.abs(reloaded.volume - 0.35) < 0.001, reloaded.volume);

    // Start with reduced motion and measure that the coin path stays short.
    const startedAt = Date.now();
    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase) && GameEngine.state.lastTrumpSelector, { timeout: 10000 });
    const settleMs = Date.now() - startedAt;
    expect('reduced motion settles the coin quickly', settleMs < 3500, settleMs);

    // If the player won the toss the sheet is open; pick a suit so the match is live.
    if (await page.$eval('#trump-selection-modal', (el) => getComputedStyle(el).display !== 'none').catch(() => false)) {
        await page.click('.trump-btn[data-suit="spades"]');
    }
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 10000 });

    await openSettings();
    await page.click('.target-btn[data-target="7"]');
    const live = await page.evaluate(() => ({ active: GameEngine.state.matchTarget, pending: GameEngine.state.pendingMatchTarget, note: document.getElementById('target-note').textContent.trim() }));
    expect('a live match keeps its target', live.active === 3 && live.pending === 7, live);
    expect('live note names the current target', /still first to 3/i.test(live.note), live.note);
    await page.click('#close-settings');
    await page.click('#restart-game');
    await page.waitForSelector('#confirm-modal', { visible: true });
    await page.click('#confirm-accept');
    await page.waitForFunction(() => GameEngine.state.matchTarget === 7 && GameEngine.state.player.score === 0 && !GameEngine.state.gameStarted, { timeout: 5000 });
    expect('the next match uses the pending target', await page.evaluate(() => GameEngine.state.matchTarget === 7));

    const haptics = await page.evaluate(() => {
        const supported = typeof navigator.vibrate === 'function';
        let result = null;
        try { result = GameHaptics.vibrate('select'); } catch (e) { return { supported, threw: e.message }; }
        return { supported, result, label: document.getElementById('settings-haptics').textContent.trim() };
    });
    console.log('haptics environment:', JSON.stringify(haptics));
    expect('haptics call is harmless', !haptics.threw, haptics);

    // Simulate a device without the Vibration API. The switch must become
    // disabled and explain why instead of pretending to work.
    if (haptics.supported) {
        const degraded = await page.evaluate(() => {
            try { Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true }); } catch (e) { /* older browser */ }
            TableSettings.update({});
            let result = null;
            try { result = GameHaptics.vibrate('select'); } catch (e) { return { threw: e.message }; }
            return { result };
        });
        await openSettings();
        const control = await page.evaluate(() => {
            const btn = document.getElementById('settings-haptics');
            return { disabled: btn.disabled, label: btn.textContent.trim(), note: document.getElementById('haptics-note').textContent.trim() };
        });
        expect('missing haptics API degrades gracefully', !degraded.threw && degraded.result === false, degraded);
        expect('haptics control explains an unsupported device', control.disabled && /not supported/i.test(control.label) && /no vibration/i.test(control.note), control);
        await page.click('#close-settings');
    }

    await page.screenshot({ path: path.join(outDir, 'settings-reduced.png') });
    console.log('\nPROBLEMS:', problems.length ? '\n  ' + problems.join('\n  ') : 'none');
    try { await browser.close(); } catch (e) { /* already gone */ }
    proc.kill();
    server.close();
    process.exit(problems.length ? 1 : 0);
})().catch((e) => {
    console.error('SETTINGS E2E FAILED:', e);
    server.close();
    process.exit(2);
});
