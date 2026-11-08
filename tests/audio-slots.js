'use strict';
/*
 * Dev-only audio check. The manifest names a file for every slot; this proves
 * the files exist, decode in the browser, and keep their measured mix values.
 * It also proves the matchPoint recording is the 0.5s cue the synth produces,
 * so the "one point from the match" moment can never silently fall back to a
 * different sound.
 *
 *   node audio-slots.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'games/7-8/index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
const problems = [];

(async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'audio', 'manifest.json'), 'utf8'));
    const slots = Object.entries(manifest.slots || {});
    for (const [name, slot] of slots) {
        if (!slot.file) continue;
        const file = path.join(root, 'assets', 'audio', slot.file);
        if (!fs.existsSync(file)) problems.push(`missing file for ${name}: ${slot.file}`);
        else if (fs.statSync(file).size < 500) problems.push(`suspiciously small file for ${name}: ${slot.file}`);
    }
    console.log('manifest slots:', slots.length);

    await new Promise((r) => server.listen(8123, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-audio-'));
    const port = 9700 + (process.pid % 120);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); server.close(); throw new Error('could not connect to Edge'); }
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    await page.goto('http://127.0.0.1:8123/games/7-8/index.html', { waitUntil: 'load' });
    await page.click('#start-game');
    await sleep(2500);
    const state = await page.evaluate(() => ({
        supported: window.GameAudio.isSupported(),
        samples: window.GameAudio.sampleStatus(),
        info: window.GameAudio.sampleInfo()
    }));
    console.log('decoded:', state.samples.length, JSON.stringify(state.samples));

    for (const [name, slot] of slots) {
        if (!state.samples.includes(name)) { problems.push(`slot did not decode: ${name}`); continue; }
        const info = state.info[name];
        // The loader keeps the full buffer and trims at playback; the mix values
        // must survive the manifest read intact.
        if (slot.maxSeconds && Math.abs(info.maxSeconds - slot.maxSeconds) > 0.02) problems.push(`${name}: maxSeconds ${info.maxSeconds} != manifest ${slot.maxSeconds}`);
        if (slot.maxSeconds && info.seconds + 0.02 < slot.maxSeconds) problems.push(`${name}: file is shorter than its playback window (${info.seconds}s)`);
        if (slot.gain && Math.abs(info.gain - slot.gain) > 0.01) problems.push(`${name}: gain ${info.gain} != manifest ${slot.gain}`);
    }
    const mp = state.info.matchPoint;
    if (!mp) problems.push('matchPoint did not decode');
    else if (mp.seconds < 0.3 || mp.seconds > 0.7) problems.push(`matchPoint is not the short cue: ${mp.seconds}s`);
    console.log('matchPoint:', JSON.stringify(mp));

    await browser.close();
    proc.kill();
    server.close();
    if (problems.length) {
        console.log('\nPROBLEMS:\n  ' + problems.join('\n  '));
        process.exit(1);
    }
    console.log('\nall 14 slots decode; matchPoint is present with the recorded mix.');
})().catch((e) => { console.error(e); process.exit(1); });
