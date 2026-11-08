'use strict';
/*
 * Dev-only dialogue probe.
 *
 * Plays one or more full first-to-five matches on Hard in a real browser,
 * auto-playing the human seat with a sensible baseline, and records every line
 * Anne says together with the situation that produced it (mood, score, round,
 * trick count). It then maps each line back to its category in character.js and
 * prints a report: per-category counts, consecutive repeats, and the ordered
 * transcript with context.
 *
 *   node probe-dialogue.js [matches=1] [seed=1]
 *
 * Writes tests/out/dialogue-hard.txt.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const gamePath = 'games/7-8/index.html';
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || gamePath;
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ card sense
const VAL = { '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const val = (card) => VAL[card.split('_')[0]];
const suit = (card) => card.split('_')[1];
const lowest = (a) => a.reduce((x, y) => (val(y.card) < val(x.card) ? y : x));

function sensible(cards, gs) {
    const trump = gs.trumpSuit;
    const lead = gs.trick.leadSuit;
    if (!lead) {
        const aces = cards.filter((x) => val(x.card) === 14 && suit(x.card) !== trump);
        if (aces.length) return aces[0];
        const kings = cards.filter((x) => val(x.card) === 13 && suit(x.card) !== trump);
        if (kings.length) return kings[0];
        const nonTrump = cards.filter((x) => suit(x.card) !== trump);
        return nonTrump.length ? lowest(nonTrump) : lowest(cards);
    }
    const opponent = gs.trick.cards[0].card;
    const follow = cards.filter((x) => suit(x.card) === lead);
    if (follow.length) {
        const winning = follow.filter((x) => val(x.card) > val(opponent));
        return winning.length ? lowest(winning) : lowest(follow);
    }
    const trumps = cards.filter((x) => suit(x.card) === trump);
    if (trumps.length && lead !== trump) return lowest(trumps);
    return lowest(cards);
}

const trumpHeuristic = (hand) => {
    const counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    const highs = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    hand.filter(Boolean).forEach((card) => {
        counts[suit(card)]++;
        if (val(card) >= 11) highs[suit(card)]++;
    });
    return ['hearts', 'spades', 'diamonds', 'clubs'].reduce((a, s) =>
        (highs[s] * 2 + counts[s] > highs[a] * 2 + counts[a] ? s : a), 'hearts');
};

(async () => {
    const matches = Number(process.argv[2] || 1);
    const seed = Number(process.argv[3] || 1);
    const width = 1440;
    const height = 900;
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-dlg-'));
    const port = 9600 + (process.pid % 300);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
        await sleep(500);
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('no browser'); }
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/${gamePath}`;

    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (r) => (/googletagmanager|google-analytics/.test(r.url()) ? r.abort('blockedbyclient') : r.continue()));
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
    // A muted, reduced-motion hard table: the dialogue is what is under test.
    await page.evaluateOnNewDocument((s) => {
        const seedFn = (function (a) {
            return function () {
                a = (a + 0x6D2B79F5) >>> 0;
                let t = a;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        })(s);
        Math.random = seedFn;
        localStorage.setItem('78-settings-v3', JSON.stringify({
            difficulty: 'hard', matchTarget: 5, sound: false, volume: 0, motion: 'reduced', haptics: false
        }));
    }, seed);

    await page.goto(url, { waitUntil: 'load' });

    const log = [];
    await page.evaluate(() => {
        window.__dlg = [];
        let lastText = null;
        setInterval(() => {
            const b = document.getElementById('anne-reaction');
            if (!b || b.hidden || !b.classList.contains('is-visible')) { lastText = null; return; }
            const t = b.textContent.replace(/\s+/g, ' ').trim();
            if (!t || t === lastText) return;
            lastText = t;
            const gs = typeof GameEngine !== 'undefined' && GameEngine.state ? GameEngine.state : null;
            const seat = document.querySelector('.computer-area');
            window.__dlg.push({
                text: t,
                mood: seat ? seat.dataset.mood : '',
                score: gs ? gs.player.score + '-' + gs.computer.score : '',
                round: gs ? gs.roundNumber : 0,
                trick: gs ? gs.trickCount : 0,
                phase: gs ? gs.gamePhase : '',
                at: Math.round(performance.now())
            });
        }, 40);
    });

    const state = () => page.evaluate(() => {
        const gs = GameEngine.state;
        return {
            phase: gs.gamePhase, started: gs.gameStarted, over: gs.gameOver,
            current: gs.currentPlayer, resolving: !!gs.resolvingTrick,
            playerScore: gs.player.score, computerScore: gs.computer.score,
            round: gs.roundNumber, trump: gs.trumpSuit, selector: gs.lastTrumpSelector,
            trick: gs.trickCount, cardsInTrick: gs.trick.cards.length,
            lead: gs.trick.leadSuit,
            firstCard: gs.trick.cards[0] ? gs.trick.cards[0].card : null,
            hand: gs.player.hand, faceUp: gs.player.faceUp,
            nextRound: (() => {
                const b = document.getElementById('new-round');
                return !!(b && !b.hidden && getComputedStyle(b).display !== 'none');
            })(),
            matchTarget: gs.matchTarget
        };
    });

    async function playOneMatch(matchNo) {
        // Start (or rematch) and walk the toss.
        const startBtn = matchNo === 1 ? '#start-game' : '#play-again';
        await page.waitForSelector(startBtn, { visible: true, timeout: 20000 });
        await page.click(startBtn);
        await page.waitForSelector('#coin-toss-modal', { visible: true, timeout: 20000 });
        await page.click('.coin-btn[data-choice="heads"]');

        let guard = 0;
        let lastProgress = Date.now();
        while (guard++ < 40000) {
            const s = await state();
            if (s.over) break;
            if (!s.started) { await sleep(120); continue; }
            // The deal ended: the table waits for the player to deal the next one.
            if (s.nextRound) { await page.click('#new-round'); lastProgress = Date.now(); continue; }
            if (s.phase === 'trump-selection' && s.selector === 'player') {
                await page.evaluate((suitName) => setTrump(suitName), trumpHeuristic(s.hand));
                continue;
            }
            if (s.phase === 'playing' && s.current === 'player' && !s.resolving && s.cardsInTrick < 2) {
                const legal = await page.evaluate(() => {
                    const gs = GameEngine.state;
                    const out = [];
                    ['hand', 'faceUp'].forEach((src) => gs.player[src].forEach((card, index) => {
                        if (card && GameEngine.isValidPlay(card, gs.trick.leadSuit)) out.push({ card, source: src, index });
                    }));
                    return out;
                });
                if (legal.length) {
                    const pick = sensible(legal, {
                        trumpSuit: s.trump,
                        trick: { leadSuit: s.lead, cards: s.firstCard ? [{ card: s.firstCard }] : [] }
                    });
                    await page.evaluate((p) => GameEngine.playCard(p.index, p.source), pick);
                    lastProgress = Date.now();
                    continue;
                }
            }
            if (Date.now() - lastProgress > 20000) throw new Error(`stalled in ${s.phase}: ${JSON.stringify({ ...s, hand: s.hand, faceUp: s.faceUp })}`);
            if (s.phase !== 'playing') lastProgress = Date.now();
            await sleep(80);
        }
        await page.waitForFunction(() => GameEngine.state.gameOver, { timeout: 20000 });
        await sleep(400);
    }

    const transcript = [];
    for (let m = 1; m <= matches; m++) {
        await playOneMatch(m);
        const seen = await page.evaluate(() => window.__dlg.slice());
        transcript.push({ match: m, lines: seen });
        await page.evaluate(() => { window.__dlg.length = 0; });
    }

    // ------------------------------------------------------- map text to category
    const src = fs.readFileSync(path.join(root, 'character.js'), 'utf8');
    const linesBlock = src.slice(src.indexOf('const LINES = {'), src.indexOf('const MOODS = {'));
    const templates = []; // { key, pattern }
    const keyRe = /^\s{8}(\w+): \[/gm;
    let m;
    const keyPositions = [];
    while ((m = keyRe.exec(linesBlock))) keyPositions.push({ key: m[1], at: m.index });
    keyPositions.forEach((entry, i) => {
        const end = i + 1 < keyPositions.length ? keyPositions[i + 1].at : linesBlock.length;
        const chunk = linesBlock.slice(entry.at, end);
        const literalRe = /'((?:[^'\\]|\\.)*)'/g;
        let l;
        while ((l = literalRe.exec(chunk))) {
            const text = l[1].replace(/\\'/g, "'");
            const pattern = new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '.+?') + '$');
            templates.push({ key: entry.key, pattern, template: text });
        }
    });
    const classify = (text) => {
        const hit = templates.find((t) => t.pattern.test(text));
        return hit ? hit.key : '?unmapped?';
    };

    const report = [];
    const push = (s) => { report.push(s); console.log(s); };
    push(`seed ${seed} | ${matches} match(es) | hard | reduced motion`);
    const allLines = [];
    transcript.forEach((t) => {
        t.lines.forEach((l) => allLines.push({ ...l, key: classify(l.text), match: t.match }));
    });
    push(`\nspoken lines: ${allLines.length}`);
    const byKey = new Map();
    allLines.forEach((l) => byKey.set(l.key, (byKey.get(l.key) || 0) + 1));
    push('\ncategory        count');
    [...byKey.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => push(`${k.padEnd(15)} ${String(n).padStart(4)}`));
    const unmapped = allLines.filter((l) => l.key === '?unmapped?');
    if (unmapped.length) push(`\nUNMAPPED (${unmapped.length}): ${unmapped.map((l) => JSON.stringify(l.text)).join(', ')}`);
    const adjacent = [];
    for (let i = 1; i < allLines.length; i++) {
        if (allLines[i].key === allLines[i - 1].key && allLines[i].key !== '?unmapped?') adjacent.push(i);
    }
    push(`\nback-to-back repeats of the same category: ${adjacent.length}`);
    adjacent.slice(0, 20).forEach((i) => push(`  #${i}: [${allLines[i].key}] ${allLines[i].text}`));
    // Within-match duplicates of the exact same sentence.
    const dupText = [];
    transcript.forEach((t) => {
        const seen = new Map();
        t.lines.forEach((l) => seen.set(l.text, (seen.get(l.text) || 0) + 1));
        [...seen.entries()].filter(([, n]) => n > 1).forEach(([text, n]) => dupText.push(`match ${t.match} x${n}: ${text}`));
    });
    push(`\nexact sentence repeated inside a match: ${dupText.length}`);
    dupText.slice(0, 20).forEach((d) => push(`  ${d}`));
    push('\n--- transcript ---');
    allLines.forEach((l, i) => push(`#${String(i + 1).padStart(3)} [${l.key}] ${l.mood} ${l.score} r${l.round} t${l.trick} :: ${l.text}`));

    fs.writeFileSync(path.join(outDir, 'dialogue-hard.txt'), report.join('\n') + '\n');
    console.log(`\nwritten: tests/out/dialogue-hard.txt`);

    await browser.disconnect();
    proc.kill();
    server.close();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
