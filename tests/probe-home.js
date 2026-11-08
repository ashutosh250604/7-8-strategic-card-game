'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, 'out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
(async () => {
    await new Promise((r) => server.listen(8117, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-home-'));
    const port = 9940 + (process.pid % 20);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) { await sleep(500); try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) {} }
    const errors = [];
    for (const view of [{ name: 'desk', w: 1440, h: 900 }, { name: 'phone', w: 390, h: 844 }]) {
        const page = await browser.newPage();
        await page.setViewport({ width: view.w, height: view.h });
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto('http://127.0.0.1:8117/index.html', { waitUntil: 'networkidle0' });
        await sleep(400);
        await page.screenshot({ path: path.join(outDir, `home-${view.name}.png`), fullPage: false });
        console.log(view.name, JSON.stringify(await page.evaluate(() => ({
            overflowX: document.documentElement.scrollWidth - innerWidth,
            bodyBg: getComputedStyle(document.body).backgroundColor,
            titleSize: getComputedStyle(document.getElementById('hero-title')).fontSize
        }))));
        await page.close();
    }
    console.log('errors:', JSON.stringify(errors));
    await browser.close(); proc.kill(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
