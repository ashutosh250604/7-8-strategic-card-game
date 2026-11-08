'use strict';
/* Portrait probe: renders Anne alone at real UI sizes and every mood, so the
 * drawing can be judged before it is wired into the table. Dev only. */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, 'out', 'portrait');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/arcade.css">
<style>
  body { margin:0; background:#0b0716; color:#faf6ff; font-family:system-ui; }
  .big { display:grid; grid-template-columns: 460px 1fr; gap:32px; padding:28px; align-items:start; }
  #hero { width:460px; height:552px; border-radius:24px; overflow:hidden; box-shadow:0 24px 60px #000a; }
  #hero .aa { width:100%; height:100%; }
  .grid { display:flex; flex-wrap:wrap; gap:18px; align-items:flex-end; }
  .cell { text-align:center; font-size:12px; color:#b3a4d0; }
  .cell [data-anne-avatar] { display:inline-block; }
  h2 { font:700 13px/1 system-ui; letter-spacing:.12em; text-transform:uppercase; color:#c9ff45; margin:24px 0 10px; }
</style></head><body>
<div class="big">
  <div id="hero" data-anne-avatar data-hero></div>
  <div>
    <h2>At real sizes</h2>
    <div class="grid" id="sizes"></div>
    <h2>Moods</h2>
    <div class="grid" id="moods"></div>
  </div>
</div>
<script src="/anne-avatar.js"></script>
<script>
  const sizes = [96, 72, 56, 44, 34];
  const sizesBox = document.getElementById('sizes');
  sizes.forEach((s) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const host = document.createElement('div');
    host.setAttribute('data-anne-avatar', '');
    host.dataset.crop = 'face';
    host.style.setProperty('--aa-size', s + 'px');
    cell.appendChild(host);
    const label = document.createElement('div');
    label.textContent = s + 'px';
    cell.appendChild(label);
    sizesBox.appendChild(cell);
  });
  const moods = ['neutral', 'happy', 'tease', 'impressed', 'focused', 'sorry', 'thinking'];
  const moodBox = document.getElementById('moods');
  moods.forEach((m) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const host = document.createElement('div');
    host.setAttribute('data-anne-avatar', '');
    host.style.setProperty('--aa-size', '84px');
    cell.appendChild(host);
    const label = document.createElement('div');
    label.textContent = m;
    cell.appendChild(label);
    moodBox.appendChild(cell);
    setTimeout(() => { host.dataset.mood = m; }, 60);
  });
  TableAvatar.mountAll();
  // One close-up of the talking state.
  setTimeout(() => { TableAvatar.mood('happy', { beat: false }); TableAvatar.speak('hello', 60000); }, 300);
</script></body></html>`;

(async () => {
    fs.mkdirSync(outDir, { recursive: true });
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        if (url === '/' || url === '/probe') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(PAGE);
        }
        const file = path.join(root, url.replace(/^\/+/, ''));
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404); return res.end();
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => server.listen(8129, '127.0.0.1', r));

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-portrait-'));
    const port = 9930 + (process.pid % 40);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run', '--disable-background-timer-throttling',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(400);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) throw new Error('no browser');
    const page = await browser.newPage();
    await page.setViewport({ width: 1180, height: 760, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:8129/', { waitUntil: 'networkidle0' });
    await sleep(700);
    await page.screenshot({ path: path.join(outDir, 'portrait-board.png') });
    const hero = await page.$('#hero');
    await hero.screenshot({ path: path.join(outDir, 'portrait-hero.png') });
    await page.evaluate(() => {
        document.querySelectorAll('#moods .cell').forEach((cell, i) => {
            const host = cell.querySelector('[data-anne-avatar]');
            if (host) host.dataset.mood = ['neutral', 'happy', 'tease', 'impressed', 'focused', 'sorry', 'thinking'][i];
        });
    });
    await sleep(400);
    await page.screenshot({ path: path.join(outDir, 'portrait-moods.png') });
    console.log('errors:', JSON.stringify(errors));
    console.log('wrote', outDir);
    await browser.close();
    proc.kill();
    server.close();
})().catch((e) => { console.error(e); process.exit(1); });
