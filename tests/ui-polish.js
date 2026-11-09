'use strict';
/*
 * UI polish check (dev only).
 *
 * Covers the things that make the table feel finished:
 *   - the requested defaults (medium, first-to-3, Anne voice off),
 *   - one identical photographic portrait on every mount,
 *   - a two-packet riffle with the recorded effects loaded over HTTP,
 *   - the victory fireworks canvas,
 *   - no horizontal overflow at the four review viewports.
 *
 *   node ui-polish.js
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
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
    await new Promise((r) => server.listen(8104, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-ui-polish-'));
    const port = 9700 + (process.pid % 90);
    const proc = spawn(EDGE, ['--headless=new', '--no-first-run',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(400);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('could not connect to Edge'); }

    const problems = [];
    const check = (label, condition, detail) => {
        console.log(`${condition ? 'ok' : 'FAIL'} - ${label}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);
        if (!condition) problems.push(label + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
    };
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.bringToFront();
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT/.test(m.text())) errors.push(m.text()); });
    await page.evaluateOnNewDocument(() => localStorage.clear());
    await page.goto(`http://127.0.0.1:8104/${gamePath}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof GameEngine !== 'undefined' && document.getElementById('start-game'), { timeout: 8000 });

    const defaults = await page.evaluate(() => {
        const p = TableSettings.get();
        const activeTarget = document.querySelector('.target-btn.active');
        const activeDifficulty = document.querySelector('.difficulty-btn.active');
        return {
            prefs: p,
            goal: document.getElementById('match-goal').textContent.trim(),
            target: activeTarget ? activeTarget.dataset.target : null,
            difficulty: activeDifficulty ? activeDifficulty.dataset.difficulty : null,
            voice: document.getElementById('settings-voice')?.getAttribute('aria-checked'),
            voiceLabel: document.getElementById('settings-voice')?.querySelector('span').textContent.trim(),
            fireworks: document.getElementById('settings-fireworks')?.getAttribute('aria-checked'),
            fireworksLabel: document.getElementById('settings-fireworks')?.querySelector('span').textContent.trim(),
            source: TableAvatar.source,
            photos: [...document.querySelectorAll('[data-anne-avatar] .aa-photo')].map((img) => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 })),
            samePhoto: new Set([...document.querySelectorAll('[data-anne-avatar] .aa-photo')].map((img) => img.getAttribute('src'))).size,
            frames: [...document.querySelectorAll('[data-anne-avatar]')].map((host) => {
                const img = host.querySelector('.aa-photo');
                const hs = getComputedStyle(host), is = getComputedStyle(img);
                return {
                    cropFace: host.classList.contains('aa-crop-face'),
                    w: Math.round(parseFloat(hs.width)),
                    h: Math.round(parseFloat(hs.height)),
                    fit: is.objectFit,
                    pos: is.objectPosition,
                    transform: is.transform
                };
            })
        };
    });
    check('defaults are medium, first-to-3 and voice-off',
        defaults.prefs.difficulty === 'medium' && defaults.prefs.matchTarget === 3 && defaults.prefs.voice === false &&
        defaults.goal === '3' && defaults.target === '3' && defaults.difficulty === 'medium' &&
        defaults.voice === 'false' && /off/i.test(defaults.voiceLabel) &&
        defaults.prefs.fireworks === false && defaults.fireworks === 'false' && /off/i.test(defaults.fireworksLabel), defaults);
    check('every avatar mount uses the same loaded photograph',
        defaults.source === 'photo' && defaults.photos.length >= 3 && defaults.photos.every((p) => p.loaded) && defaults.samePhoto === 1,
        defaults.photos);
    check('every avatar mount uses the same full square frame',
        defaults.frames.length >= 3 && defaults.frames.every((f) =>
            !f.cropFace && f.w > 0 && f.w === f.h && f.fit === 'cover' &&
            f.pos === '50% 50%' && f.transform === 'none'),
        defaults.frames);

    // The machine's real voice list on Windows includes Heera (en-IN female),
    // Ravi (en-IN male) and Zira (en-US female). The selected voice must not be
    // a name-only guess: when an Indian female voice exists, it must win.
    const voice = await page.evaluate(async () => {
        if (!window.AnneVoice) return { available: false, info: null };
        AnneVoice.refresh();
        await new Promise((r) => setTimeout(r, 350));
        return { available: AnneVoice.available, info: AnneVoice.voiceInfo() };
    }).catch(() => ({ available: false, info: null }));
    check('Anne prefers an Indian English female voice when available',
        !voice.available || !voice.info || (voice.info.female && voice.info.indian), voice);

    // The trump sheet's card rows are generated from the same hand that is
    // being counted. This fixture covers every suit, including an empty one.
    const showTrump = () => page.evaluate(() => {
        GameEngine.state.player.hand = ['A_spades', 'K_spades', 'Q_hearts', '10_hearts', '7_clubs'];
        GameView.showTrumpSelection(() => {});
    });
    await showTrump();
    await page.waitForSelector('#trump-selection-modal', { visible: true, timeout: 3000 });
    await sleep(100);
    const trump = await page.evaluate(() => {
        const modal = document.getElementById('trump-selection-modal');
        const content = modal.querySelector('.modal-content');
        const avatar = modal.querySelector('.anne-line-avatar');
        const modalRect = content.getBoundingClientRect();
        const avatarRect = avatar.getBoundingClientRect();
        const buttons = [...modal.querySelectorAll('.trump-btn')].map((btn) => ({
            suit: btn.dataset.suit,
            count: btn.querySelector('.suit-count').textContent.trim(),
            minis: btn.querySelectorAll('.trump-mini').length,
            empty: btn.classList.contains('is-empty'),
            minWidth: Math.round(btn.getBoundingClientRect().width),
            minisVisible: [...btn.querySelectorAll('.trump-mini')].every((m) => m.getBoundingClientRect().width > 8)
        }));
        return {
            buttons,
            totalMinis: modal.querySelectorAll('.trump-mini').length,
            allMinisVisible: [...modal.querySelectorAll('.trump-mini')].every((m) => m.getBoundingClientRect().width > 8),
            backdropFilter: getComputedStyle(modal).backdropFilter || getComputedStyle(modal).webkitBackdropFilter,
            contentFilter: getComputedStyle(content).filter,
            avatarCenterDelta: Math.round((avatarRect.left + avatarRect.width / 2) - (modalRect.left + modalRect.width / 2)),
            pressed: [...modal.querySelectorAll('.trump-btn')].every((btn) => btn.getAttribute('aria-pressed') === 'false')
        };
    });
    check('trump choices show the actual held cards and accurate counts',
        trump.totalMinis === 5 && trump.allMinisVisible &&
        ['spades:2', 'hearts:2', 'diamonds:0', 'clubs:1'].every((entry) => {
            const [suit, count] = entry.split(':');
            const row = trump.buttons.find((b) => b.suit === suit);
            return row && row.minis === Number(count) && row.count === (count === '1' ? '1 card' : `${count} cards`);
        }), trump);
    check('trump sheet is sharp and Anne is centred in it',
        !/blur/.test(trump.backdropFilter || '') && !/blur/.test(trump.contentFilter || '') && Math.abs(trump.avatarCenterDelta) <= 2, trump);
    await page.screenshot({ path: path.join(outDir, 'ui-trump-1440.png') });
    await page.click('.trump-btn[data-suit="hearts"]');
    await sleep(35);
    const picked = await page.evaluate(() => {
        const btn = document.querySelector('.trump-btn[data-suit="hearts"]');
        return { picked: btn.classList.contains('is-picked'), pressed: btn.getAttribute('aria-pressed') };
    });
    check('the chosen trump has a visible selected state', picked.picked && picked.pressed === 'true', picked);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('trump-selection-modal')).display === 'none', { timeout: 1000 });
    for (const view of [{ w: 390, h: 844 }, { w: 320, h: 568 }]) {
        await page.setViewport({ width: view.w, height: view.h });
        await page.evaluate(() => { document.getElementById('trump-selection-modal').style.display = 'none'; });
        await showTrump();
        await sleep(100);
        const mobile = await page.evaluate(() => {
            const modal = document.getElementById('trump-selection-modal');
            const panel = modal.querySelector('.modal-content');
            const buttons = [...modal.querySelectorAll('.trump-btn')];
            return {
                docW: document.documentElement.scrollWidth,
                viewW: innerWidth,
                panelRight: Math.round(panel.getBoundingClientRect().right),
                visibleButtons: buttons.filter((b) => b.getBoundingClientRect().width > 0).length,
                rows: buttons.map((b) => b.querySelectorAll('.trump-mini').length)
            };
        });
        check(`${view.w}x${view.h}: trump choices fit with cards and counts visible`,
            mobile.docW <= mobile.viewW && mobile.panelRight <= mobile.viewW && mobile.visibleButtons === 4 && mobile.rows.join(',') === '2,2,0,1', mobile);
        await page.screenshot({ path: path.join(outDir, `ui-trump-${view.w}x${view.h}.png`) });
    }
    await page.setViewport({ width: 1440, height: 900 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof GameEngine !== 'undefined' && document.getElementById('start-game'), { timeout: 8000 });

    await page.click('#start-game');
    await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 8000 });
    await page.click('.coin-btn[data-choice="heads"]');
    await page.waitForFunction(() => document.querySelector('.game-board').classList.contains('is-shuffling'), { timeout: 12000 });
    // Sample the geometry before the screenshot: a screenshot pause can land
    // after the cascade has already collapsed into one pile.
    await page.evaluate(() => {
        window.__riffleProbe = { max: 0, cards: 0, deck: null };
        const start = performance.now();
        function poll() {
            const all = [...document.querySelectorAll('#deck .shuffle-card')];
            window.__riffleProbe.cards = Math.max(window.__riffleProbe.cards, all.length);
            if (all.length > 4) {
                const xs = all.map((c) => c.getBoundingClientRect().left);
                window.__riffleProbe.max = Math.max(window.__riffleProbe.max, Math.max(...xs) - Math.min(...xs));
                const deck = document.querySelector('.deck');
                if (deck) {
                    const r = deck.getBoundingClientRect();
                    window.__riffleProbe.deck = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), right: Math.round(r.right), cls: deck.className };
                }
            }
            if (document.querySelector('.game-board').classList.contains('is-shuffling') && performance.now() - start < 5000) requestAnimationFrame(poll);
        }
        requestAnimationFrame(poll);
    });
    // Mid-cascade: both packets and the release are visible, not just the
    // opening lift. The screenshot pause used to land after the pack closed.
    await sleep(620);
    await page.screenshot({ path: path.join(outDir, 'ui-riffle-1440.png') });
    await page.waitForFunction(() => !document.querySelector('.game-board').classList.contains('is-shuffling'), { timeout: 8000 });
    const riffle = await page.evaluate(() => {
        const rig = document.querySelector('.shuffle-rig');
        return {
            cards: window.__riffleProbe.cards,
            spread: Math.round(window.__riffleProbe.max),
            mode: rig ? rig.dataset.riffle : 'removed-after-finish',
            declared: rig ? rig.dataset.cards : 'removed-after-finish',
            deck: window.__riffleProbe.deck
        };
    });
    check('shuffle is a two-packet riffle', riffle.cards === 30 && riffle.spread > 80 && riffle.deck && Math.abs((riffle.deck.left + riffle.deck.width / 2) - 720) < 140, riffle);
    await page.waitForFunction(() => ['trump-selection', 'dealing-remaining', 'playing'].includes(GameEngine.state.gamePhase) && GameEngine.state.lastTrumpSelector, { timeout: 15000 });
    if (await page.$eval('#trump-selection-modal', (el) => getComputedStyle(el).display !== 'none').catch(() => false)) {
        await page.click('.trump-btn[data-suit="spades"]');
    }
    await page.waitForFunction(() => GameEngine.state.gamePhase === 'playing', { timeout: 10000 });
    await sleep(700);
    await page.screenshot({ path: path.join(outDir, 'ui-live-1440.png') });

    // A line is an overlay in a permanently reserved lane. Measure every card
    // before and after a long line to prove nothing jumps when Anne speaks.
    const subtitle = await page.evaluate(async () => {
        const bubble = document.getElementById('anne-reaction');
        const cards = [...document.querySelectorAll('#player-hand .card, #player-faceup .card, #computer-hand .card, #computer-faceup .card')];
        bubble.hidden = true;
        bubble.classList.remove('is-visible');
        if (window.TableAvatar) TableAvatar.quiet();
        const read = () => cards.map((card) => { const r = card.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; });
        const before = read();
        const lane = document.querySelector('.anne-speech-lane');
        const laneBefore = Math.round(lane.getBoundingClientRect().height);
        TableCharacters.showReaction('A longer line should wrap inside its own lane without moving a single card on the felt.', 3000);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const after = read();
        const laneAfter = Math.round(lane.getBoundingClientRect().height);
        const maxDelta = Math.max(...before.map((point, i) => Math.abs(point.left - after[i].left) + Math.abs(point.top - after[i].top)));
        const result = { maxDelta, laneBefore, laneAfter, visible: !bubble.hidden && getComputedStyle(bubble).visibility === 'visible' };
        bubble.hidden = true;
        bubble.classList.remove('is-visible');
        if (window.TableAvatar) TableAvatar.quiet();
        return result;
    });
    check('subtitles occupy a fixed lane and never move the cards',
        subtitle.maxDelta === 0 && subtitle.laneBefore === subtitle.laneAfter && subtitle.laneAfter >= 40 && subtitle.visible, subtitle);

    const sounds = await page.evaluate(() => ({
        samples: GameAudio.sampleStatus(),
        context: GameAudio.isSupported(),
        photo: (() => { const img = document.querySelector('#anne-portrait .aa-photo'); return !!(img && img.complete && img.naturalWidth > 0); })()
    }));
    check('recorded sounds load over localhost', sounds.samples.length === 14 && sounds.context, sounds.samples);
    check('the seat portrait is loaded', sounds.photo);

    await page.evaluate(() => {
        window.__fireworksOff = TableFireworks.stats();
        GameEngine.state.gameStarted = true;
        GameEngine.state.gameOver = false;
        GameView.showGameOver('Player', { player: 3, computer: 1, target: 3 });
    });
    await page.waitForSelector('#game-over-modal', { visible: true, timeout: 3000 });
    const off = await page.evaluate(() => ({
        stats: TableFireworks.stats(),
        active: TableFireworks.active(),
        live: document.getElementById('fireworks-canvas').classList.contains('is-live')
    }));
    check('fireworks are off by default and do no animation work',
        !off.active && !off.live && off.stats.starts === 0 && off.stats.frames === 0, off);

    await page.evaluate(() => {
        document.getElementById('game-over-modal').style.display = 'none';
        TableSettings.update({ fireworks: true });
        GameEngine.state.gameStarted = true;
        GameEngine.state.gameOver = false;
        GameView.showGameOver('Player', { player: 3, computer: 1, target: 3 });
    });
    await page.waitForSelector('#game-over-modal', { visible: true, timeout: 3000 });
    await page.waitForSelector('#fireworks-canvas.is-live', { timeout: 2000 });
    await sleep(1200);
    const victory = await page.evaluate(() => ({
        active: TableFireworks.active(),
        particles: TableFireworks.particleCount(),
        rockets: TableFireworks.rocketCount ? TableFireworks.rocketCount() : null,
        reduced: TableFireworks.reduced(),
        bounds: TableFireworks.bounds ? TableFireworks.bounds() : null,
        stats: TableFireworks.stats(),
        className: document.getElementById('fireworks-canvas').className,
        context: document.getElementById('match-context').textContent.trim(),
        winner: document.getElementById('winner-announcement').textContent.trim(),
        canStartAnother: !document.getElementById('play-again').disabled
    }));
    check('enabled victory fireworks run and use a bounded canvas',
        victory.active && victory.particles > 0 && /is-live/.test(victory.className) &&
        victory.stats.frames > 0 && victory.bounds && victory.bounds.canvasWidth <= victory.bounds.width * 1.5 + 2,
        victory);
    check('victory result states the new default target', /First to 3/i.test(victory.context) && /You win/i.test(victory.winner) && victory.canStartAnother, victory);
    await page.screenshot({ path: path.join(outDir, 'ui-victory-1440.png') });

    // The modal is above the canvas and every result action is still clickable.
    const targetHit = await page.evaluate(() => {
        const btn = document.getElementById('play-again');
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { visible: r.width > 0 && r.height > 0, hit: hit && hit.id };
    });
    check('result actions sit above the fireworks canvas', targetHit.visible && targetHit.hit === 'play-again', targetHit);

    for (const view of [{ w: 390, h: 844 }, { w: 320, h: 568 }, { w: 844, h: 390 }]) {
        await page.setViewport({ width: view.w, height: view.h });
        await page.goto(`http://127.0.0.1:8104/${gamePath}`, { waitUntil: 'load' });
        await page.waitForFunction(() => typeof GameEngine !== 'undefined', { timeout: 8000 });
        const layout = await page.evaluate(() => ({
            docW: document.documentElement.scrollWidth,
            viewW: innerWidth,
            photo: (() => { const img = document.querySelector('#anne-portrait .aa-photo'); return !!(img && img.complete && img.naturalWidth > 0); })()
        }));
        check(`${view.w}x${view.h}: no horizontal overflow and portrait loaded`, layout.docW <= layout.viewW && layout.photo, layout);
        await page.screenshot({ path: path.join(outDir, `ui-setup-${view.w}x${view.h}.png`), fullPage: true });
    }
    // Settings is a real interactive surface, not just a screenshot. The
    // selection highlight must travel between choices, switches must expose
    // their state, and the small notes must remain readable against the sheet.
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:8104/${gamePath}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof GameEngine !== 'undefined', { timeout: 8000 });
    await page.evaluate(() => TableSettings.reset());
    await page.click('#settings-btn');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('settings-modal')).display !== 'none', { timeout: 3000 });
    await sleep(300);
    const segmentBefore = await page.evaluate(() => {
        const group = document.querySelector('.target-options');
        const thumb = group.querySelector('.seg-thumb');
        return { left: thumb.getBoundingClientRect().left, active: group.querySelector('.active').dataset.target };
    });
    await page.click('.target-btn[data-target="5"]');
    await page.click('.difficulty-btn[data-difficulty="hard"]');
    await page.click('.motion-btn[data-motion="reduced"]');
    await sleep(320);
    const segments = await page.evaluate(() => {
        return [...document.querySelectorAll('.difficulty-options, .target-options, .motion-options')].map((group) => {
            const thumb = group.querySelector('.seg-thumb');
            const active = group.querySelector('.active');
            if (!thumb || !active) return { missing: true };
            const tr = thumb.getBoundingClientRect();
            const ar = active.getBoundingClientRect();
            return {
                key: Object.keys(active.dataset)[0],
                value: active.dataset[Object.keys(active.dataset)[0]],
                opacity: getComputedStyle(thumb).opacity,
                centerDelta: Math.round((tr.left + tr.width / 2) - (ar.left + ar.width / 2)),
                left: tr.left
            };
        });
    });
    check('segmented controls show every active choice', segments.length === 3 &&
        segments[0].value === '5' && segments[1].value === 'hard' && segments[2].value === 'reduced', segments);
    check('segmented selection thumb slides to the active choice',
        segments.every((s) => s.opacity === '1' && Math.abs(s.centerDelta) <= 2) && segments[0].left > segmentBefore.left + 10,
        { before: segmentBefore, after: segments });

    const switchBefore = await page.evaluate(() => {
        const btn = document.getElementById('settings-sound');
        const track = btn.querySelector('.switch-track');
        const knob = track.querySelector('i');
        return { checked: btn.getAttribute('aria-checked'), knobX: Math.round(knob.getBoundingClientRect().left - track.getBoundingClientRect().left) };
    });
    await page.click('#settings-sound');
    await sleep(240);
    const switchAfter = await page.evaluate(() => {
        const btn = document.getElementById('settings-sound');
        const track = btn.querySelector('.switch-track');
        const knob = track.querySelector('i');
        return { checked: btn.getAttribute('aria-checked'), knobX: Math.round(knob.getBoundingClientRect().left - track.getBoundingClientRect().left), label: btn.querySelector('span').textContent.trim() };
    });
    check('switch thumb travels across its track', switchBefore.checked === 'true' && switchAfter.checked === 'false' &&
        switchBefore.knobX - switchAfter.knobX >= 10 && /off/i.test(switchAfter.label), { before: switchBefore, after: switchAfter });
    await page.click('#settings-sound');
    await sleep(240);

    const settingsContrast = await page.evaluate(() => {
        const rgb = (value) => { const m = String(value).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? m.slice(1, 4).map(Number) : null; };
        const hex = (value) => { const m = String(value).trim().match(/^#([0-9a-f]{6})$/i); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
        const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * f[0] + .7152 * f[1] + .0722 * f[2]; };
        const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return +((Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)).toFixed(2); };
        const panel = hex(getComputedStyle(document.documentElement).getPropertyValue('--panel-2')) || [28, 21, 16];
        const out = {};
        for (const sel of ['.settings-modal .modal-kicker', '.settings-note', '.setting-label small', '#target-note', '#difficulty-desc', '.creator-attribution']) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const cs = getComputedStyle(el);
            const fg = rgb(cs.color);
            out[sel] = { color: cs.color, size: cs.fontSize, ratio: fg ? ratio(fg, panel) : null };
        }
        return out;
    });
    check('settings labels and notes pass WCAG AA contrast',
        Object.keys(settingsContrast).length >= 5 && Object.values(settingsContrast).every((v) => v.ratio >= 4.5), settingsContrast);
    await page.screenshot({ path: path.join(outDir, 'ui-settings-1440.png') });

    await page.setViewport({ width: 390, height: 844 });
    // The responsive sheet and its segment thumb re-measure on the next
    // ResizeObserver frame. Wait for the settled alignment rather than
    // sampling a fixed 320 ms into that layout change.
    await page.waitForFunction(() => {
        const group = document.querySelector('.target-options');
        const thumb = group && group.querySelector('.seg-thumb');
        const active = group && group.querySelector('.active');
        if (!thumb || !active) return false;
        const tr = thumb.getBoundingClientRect();
        const ar = active.getBoundingClientRect();
        return Math.abs((tr.left + tr.width / 2) - (ar.left + ar.width / 2)) <= 2;
    }, { timeout: 2500 }).catch(() => {});
    const settingsMobile = await page.evaluate(() => {
        const modal = document.getElementById('settings-modal');
        const panel = modal.querySelector('.settings-modal');
        const thumb = document.querySelector('.target-options .seg-thumb');
        const active = document.querySelector('.target-options .active');
        const tr = thumb.getBoundingClientRect();
        const ar = active.getBoundingClientRect();
        return {
            docW: document.documentElement.scrollWidth,
            viewW: innerWidth,
            panelRight: Math.round(panel.getBoundingClientRect().right),
            centerDelta: Math.round((tr.left + tr.width / 2) - (ar.left + ar.width / 2))
        };
    });
    check('390x844 settings has no overflow and keeps the thumb aligned',
        settingsMobile.docW <= settingsMobile.viewW && settingsMobile.panelRight <= settingsMobile.viewW && Math.abs(settingsMobile.centerDelta) <= 2,
        settingsMobile);
    await page.screenshot({ path: path.join(outDir, 'ui-settings-390.png'), fullPage: true });
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(220);
    await page.click('#close-settings');

    await page.goto('http://127.0.0.1:8104/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('.hero-host-avatar .aa-photo'), { timeout: 8000 });
    const home = await page.evaluate(() => {
        const rgb = (value) => { const m = String(value).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? m.slice(1, 4).map(Number) : null; };
        const hex = (value) => { const m = String(value).trim().match(/^#([0-9a-f]{6})$/i); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
        const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * f[0] + .7152 * f[1] + .0722 * f[2]; };
        const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return +((Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)).toFixed(2); };
        const bg = hex(getComputedStyle(document.documentElement).getPropertyValue('--void')) || [8, 6, 5];
        const out = { portrait: null, text: {} };
        const img = document.querySelector('.hero-host-avatar .aa-photo');
        out.portrait = { loaded: !!(img && img.complete && img.naturalWidth > 0), src: img && img.getAttribute('src') };
        for (const sel of ['.hero-host', '.hero-note span', '.tile-players', '.tile-footer', '.section-head p', '.eyebrow']) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const cs = getComputedStyle(el);
            const fg = rgb(cs.color);
            out.text[sel] = { ratio: fg ? ratio(fg, bg) : null, size: cs.fontSize };
        }
        return out;
    });
    check('home portrait loads and home labels stay readable',
        home.portrait.loaded && Object.keys(home.text).length >= 4 && Object.values(home.text).every((v) => v.ratio >= 4.5), home);
    await page.screenshot({ path: path.join(outDir, 'ui-home-1440.png') });

    check('no page or console errors', errors.length === 0, errors);

    console.log('\nPROBLEMS:' + (problems.length ? '\n  ' + problems.join('\n  ') : ' none'));
    try { await browser.close(); } catch (e) { /* already gone */ }
    proc.kill();
    server.close();
    process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('UI POLISH FAILED:', e); server.close(); process.exit(2); });
