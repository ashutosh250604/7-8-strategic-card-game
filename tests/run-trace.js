'use strict';
/*
 * Usage (from the tests/ folder):
 *   node run-trace.js --write baseline [--root <dir>] [--group main|restart|all]
 *   (--root defaults to games/7-8, the game page; the launcher at the project root has no game scripts)
 *   node run-trace.js --compare baseline [--root <dir>] [--group ...]
 *   node run-trace.js --determinism            (runs the whole matrix twice, must match)
 *
 * Traces live in tests/traces/<name>/<group>/<scenario>.trace.txt
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { runScenario } = require('./harness');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const root = path.resolve(opt('--root', path.join(__dirname, '..', 'games', '7-8')));
const group = opt('--group', 'all');
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

function scenarios() {
    const list = [];
    if (group === 'all' || group === 'main') {
        for (const difficulty of ['easy', 'medium', 'hard']) {
            for (const profile of ['eager', 'quick', 'normal', 'slow']) {
                for (let seed = 1; seed <= 4; seed++) {
                    list.push({ group: 'main', id: `${difficulty}-${profile}-s${seed}`, difficulty, profile, seed, games: 2 });
                }
            }
        }
    }
    if (group === 'all' || group === 'restart') {
        for (const restartAt of ['comp-think', 'trick-pending', 'post-resolve', 'dealing', 'round-end', 'comp-trump']) {
            for (const difficulty of ['medium', 'hard']) {
                for (let seed = 1; seed <= 2; seed++) {
                    list.push({ group: 'restart', id: `${restartAt}-${difficulty}-s${seed}`, difficulty, profile: 'quick', seed, games: 1, restartAt });
                }
            }
        }
    }
    const only = opt('--only');
    return only ? list.filter(c => `${c.group}/${c.id}`.includes(only)) : list;
}

// Scenarios are independent, so they are spread over worker processes.
async function runAll() {
    const list = scenarios();
    const results = new Array(list.length);
    const nWorkers = Math.min(Number(opt('--workers', 4)), list.length);
    let next = 0;
    // One fresh process per scenario: long-lived jsdom/vm processes degrade badly.
    const runOne = (index) => new Promise((resolve, reject) => {
        const w = cp.fork(__filename, ['--worker', '--root', root], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        w.on('message', (m) => {
            if (m.error) { reject(new Error(m.error)); return; }
            results[m.index] = { cfg: list[m.index], text: m.text, summary: m.summary };
            if (args.includes('--progress')) console.error(`${list[m.index].group}/${list[m.index].id} ${m.ms}ms steps=${m.summary.end.steps}`);
            w.send({ done: true });
        });
        w.on('exit', resolve);
        w.on('error', reject);
        w.send({ index, cfg: list[index] });
    });
    await Promise.all(Array.from({ length: nWorkers }, async () => {
        while (next < list.length) await runOne(next++);
    }));
    return results;
}

if (args.includes('--worker')) {
    process.on('message', async (m) => {
        if (m.done) { process.exit(0); }
        try {
            const t0 = Date.now();
            const { text, summary } = await runScenario(m.cfg, root);
            process.send({ index: m.index, text, summary, ms: Date.now() - t0 });
        } catch (e) { process.send({ error: String(e && e.stack || e) }); }
    });
    return;
}

function diffContext(a, b) {
    const A = a.split('\n'), B = b.split('\n');
    let i = 0;
    while (i < A.length && i < B.length && A[i] === B[i]) i++;
    const show = (L) => L.slice(Math.max(0, i - 2), i + 4).join('\n');
    return `first difference at line ${i + 1}\n--- expected\n${show(A)}\n--- actual\n${show(B)}`;
}

(async () => {
    if (args.includes('--determinism')) {
        const r1 = await runAll(), r2 = await runAll();
        let bad = 0;
        r1.forEach((r, i) => { if (r.text !== r2[i].text) { bad++; console.log('NONDETERMINISTIC', r.cfg.group, r.cfg.id); } });
        console.log(`determinism: ${r1.length} scenarios, ${bad} mismatches`);
        process.exit(bad ? 1 : 0);
    }

    const writeName = opt('--write');
    const compareName = opt('--compare');
    if (!writeName && !compareName) { console.log('specify --write <name>, --compare <name> or --determinism'); process.exit(2); }

    const results = await runAll();
    const outDir = path.join(__dirname, 'traces', writeName || compareName);
    let bytes = 0, issues = 0;
    const lines = [];

    for (const { cfg, text, summary } of results) {
        bytes += text.length;
        const file = path.join(outDir, cfg.group, `${cfg.id}.trace.txt`);
        const flags = [];
        if (/\[console\]|\[unhandled\]|\[error\]/.test(text)) flags.push('CONSOLE/ERROR');
        if (summary.asserts.some(a => /FAIL/.test(a))) flags.push('ASSERT-FAIL');
        if (/guardHit=true/.test(text)) flags.push('GUARD');
        if (summary.games < cfg.games && cfg.group === 'main') flags.push('INCOMPLETE');
        if (writeName) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, text);
        } else {
            const actualFile = path.join(__dirname, 'out', 'actual', cfg.group, `${cfg.id}.trace.txt`);
            fs.mkdirSync(path.dirname(actualFile), { recursive: true });
            fs.writeFileSync(actualFile, text);
            if (!fs.existsSync(file)) { flags.push('NO-BASELINE'); }
            else {
                // The first line only lists which script files were loaded (they legitimately differ after the refactor).
                // --engine-only: compare engine state, logs, status and driver actions in order; ignore DOM output,
                // step numbers and virtual time (used after presentation/pacing changes; use patient profiles only).
                const engineOnly = args.includes('--engine-only');
                const body = s => {
                    const lines = s.split('\n').slice(1);
                    if (!engineOnly) return lines.join('\n');
                    // a [dom.*] entry may span several physical lines: skip until the next "  [" entry or step header
                    // Compared only up to the first game over: after a win, presentation effects (confetti/sparks) consume
                    // the shared Math.random differently, which legitimately changes the next game's shuffle.
                    const keep = []; let inDom = false; let over = false;
                    for (const l of lines) {
                        if (over && /^ {2}\[(log|status|state|hands|played)\]/.test(l) === false && !/^ {2}\[/.test(l)) continue;
                        if (/^t=/.test(l) || /^# end/.test(l)) { inDom = false; continue; }
                        if (/^ {2}\[/.test(l)) inDom = /^ {2}\[dom\./.test(l);
                        if (/^ {2}\[driver\] (click card|skip:)/.test(l)) continue; // note text depends on DOM; the resulting state is compared instead
                        if (!inDom) keep.push(l);
                        if (/Game Over! /.test(l)) { over = true; break; }
                    }
                    return keep.join('\n');
                };
                const expected = body(fs.readFileSync(file, 'utf8'));
                const actual = body(text);
                if (expected !== actual) { flags.push('DIFF'); if (!args.includes('--quiet')) console.log(`\n### ${cfg.group}/${cfg.id}\n${diffContext(expected, actual)}`); }
            }
        }
        if (flags.length) issues++;
        lines.push(`${cfg.group.padEnd(7)} ${cfg.id.padEnd(30)} games=${summary.games} end=${JSON.stringify(summary.end)} sha=${sha(text)} ${flags.join(' ')}`);
    }
    console.log(lines.join('\n'));
    console.log(`\n${writeName ? 'wrote' : 'compared'} ${results.length} scenarios, ${(bytes / 1024).toFixed(0)} KB, ${issues} flagged`);
    process.exit(compareName && issues ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
