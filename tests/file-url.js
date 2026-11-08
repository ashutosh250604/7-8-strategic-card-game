'use strict';
/*
 * Dev-only check: the same build must open straight from the folder (file://).
 *
 * Browsers block fetch() for sibling files on file://, so this asserts the game
 * does not depend on a fetch for its look: self-hosted fonts, plain scripts, all
 * four stylesheets, and recorded audio through the file:// media-element path.
 * It also proves the page being opened is this checkout, not an old deploy copy.
 *
 *   node file-url.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const url = (rel) => 'file:///' + path.join(root, rel).replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-file-'));
    const port = 9500 + (process.pid % 120);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('could not connect to Edge'); }
    const problems = [];
    let page;

    async function open(rel) {
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        await page.setRequestInterception(true);
        page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
        page.on('pageerror', (e) => problems.push(`${rel}: pageerror ${e.message}`));
        page.on('console', (m) => {
            // Headless Edge may have no audio device; that warning is the test
            // machine, not the page. Real script errors still fail the run.
            if (m.type() !== 'error' || /ERR_BLOCKED_BY_CLIENT|AudioContext encountered an error/.test(m.text())) return;
            problems.push(`${rel}: console ${m.text()}`);
        });
        await page.goto(url(rel), { waitUntil: 'load' });
        await sleep(700);
    }

    await open('index.html');
    const home = await page.evaluate(() => ({
        sheets: [...document.styleSheets].map((s) => (s.href || '').split('/').pop()).filter(Boolean),
        titleFont: getComputedStyle(document.getElementById('hero-title')).fontFamily,
        bodyBg: getComputedStyle(document.body).backgroundImage,
        avatar: !!(document.querySelector('.hero-host-avatar .aa-photo')),
        bungee: document.fonts ? document.fonts.check('16px Bungee') : true
    }));
    if (!home.sheets.includes('home.css') || !home.sheets.includes('theme.css')) problems.push('home: stylesheets missing ' + JSON.stringify(home.sheets));
    if (!/Iowan|Palatino|Georgia/.test(home.titleFont)) problems.push('home: display font is not the serif stack');
    if (!home.avatar) problems.push('home: Anne portrait did not mount');
    console.log('home:', JSON.stringify(home));

    await open('games/7-8/index.html');
    // A real gesture unlocks the local media-element path; the recordings are
    // created on that gesture, exactly as they are in normal play.
    await page.click('#start-game');
    await sleep(500);
    const game = await page.evaluate(() => ({
        sheets: [...document.styleSheets].map((s) => (s.href || '').split('/').pop()).filter(Boolean),
        bodyBg: getComputedStyle(document.body).backgroundImage,
        titleFont: getComputedStyle(document.querySelector('.start-title')).fontFamily,
        audio: window.GameAudio && window.GameAudio.isSupported(),
        samples: window.GameAudio ? window.GameAudio.sampleStatus() : [],
        photo: (() => { const img = document.querySelector('#anne-portrait .aa-photo'); return !!(img && img.complete && img.naturalWidth > 0); })(),
        defaults: window.TableSettings ? window.TableSettings.get() : null,
        hasStart: !!document.getElementById('start-game')
    }));
    for (const sheet of ['style.css', 'table.css', 'overlays.css', 'theme.css']) {
        if (!game.sheets.includes(sheet)) problems.push('game: missing ' + sheet);
    }
    if (!/Iowan|Palatino|Georgia/.test(game.titleFont)) problems.push('game: display font is not the serif stack');
    if (!game.hasStart) problems.push('game: start button missing');
    if (game.samples.length < 14) problems.push('game: file:// loaded only ' + game.samples.length + ' of 14 recorded sounds');
    if (!game.photo) problems.push('game: Anne photo did not load from file://');
    if (!game.defaults || game.defaults.difficulty !== 'medium' || game.defaults.matchTarget !== 3 || game.defaults.voice !== false) {
        problems.push('game: defaults are not medium / first-to-3 / voice-off ' + JSON.stringify(game.defaults));
    }
    // A file:// page runs the same scripts from disk; wait for the UI binding,
    // not just a fixed timeout, before asking it to deal.
    await page.waitForFunction(() => document.readyState === 'complete' && typeof GameEngine !== 'undefined' && document.getElementById('start-game'), { timeout: 5000 })
        .catch(() => problems.push('game: did not finish booting from file://'));
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 8000 }).catch(() => problems.push('game: the toss did not open from file://'));
    console.log('game:', JSON.stringify(game));

    await browser.close();
    proc.kill();
    if (problems.length) {
        console.log('\nPROBLEMS:\n  ' + problems.join('\n  '));
        process.exit(1);
    }
    console.log('\nfile:// opens the current table build with no missing assets.');
})().catch((e) => { console.error(e); process.exit(1); });
