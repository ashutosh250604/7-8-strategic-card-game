'use strict';
/*
 * Dev-only sound renderer.
 *
 * Renders one of audio.js's synthesised effects offline (OfflineAudioContext)
 * and writes it into assets/audio/ as a 16-bit PCM WAV, so a slot can ship with
 * a real file without a recording being supplied. The effect body and the tone
 * and hiss helpers are read straight out of audio.js, so the file and the
 * in-game fallback can never drift apart.
 *
 *   node render-sound.js matchPoint [seconds]
 *
 * The effect is rendered at the game's own playback velocity (2.2), so the
 * manifest entry needs gain 1: the file is exactly as loud as the synth it
 * replaces, and the player's volume setting still applies on top.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const audioJs = fs.readFileSync(path.join(root, 'audio.js'), 'utf8');

function body(name) {
    const start = audioJs.indexOf(`        ${name}(now, v) {`);
    if (start < 0) throw new Error(`effect ${name} not found in audio.js`);
    const open = audioJs.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < audioJs.length; i++) {
        if (audioJs[i] === '{') depth++;
        else if (audioJs[i] === '}') {
            depth--;
            if (depth === 0) return audioJs.slice(open + 1, i);
        }
    }
    throw new Error(`effect ${name} is not balanced`);
}

function fnBody(name) {
    const start = audioJs.indexOf(`    function ${name}(`);
    if (start < 0) throw new Error(`helper ${name} not found in audio.js`);
    const open = audioJs.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < audioJs.length; i++) {
        if (audioJs[i] === '{') depth++;
        else if (audioJs[i] === '}') {
            depth--;
            if (depth === 0) return audioJs.slice(open + 1, i);
        }
    }
    throw new Error(`helper ${name} is not balanced`);
}

(async () => {
    const mode = process.argv[2] || 'matchPoint';
    const seconds = Number(process.argv[3] || 1.2);
    const levels = mode === '--levels';
    const effect = levels ? null : mode;
    const effectBody = levels ? null : body(effect);
    const toneBody = levels ? null : fnBody('tone');
    const hissBody = levels ? null : fnBody('hiss');
    const server = levels ? http.createServer((req, res) => {
        const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
        const f = path.join(root, rel);
        if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }[path.extname(f)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        fs.createReadStream(f).pipe(res);
    }) : null;

    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-render-'));
    const port = 9400 + (process.pid % 300);
    const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch (e) { /* wait */ }
    }
    if (!browser) { proc.kill(); throw new Error('no browser'); }
    if (server) await new Promise((r) => server.listen(0, '127.0.0.1', r));

    const page = await browser.newPage();
    await page.goto(levels
        ? `http://127.0.0.1:${server.address().port}/games/7-8/index.html`
        : 'about:blank');

    if (levels) {
        // Peak and RMS per slot, so a new file can be placed at the level the
        // rest of the table is mixed at. The synth fallbacks are measured too.
        const rows = await page.evaluate(async () => {
            const manifest = await (await fetch('../../assets/audio/manifest.json', { cache: 'no-cache' })).json();
            const ctx = new OfflineAudioContext(1, 44100, 44100);
            const out = [];
            for (const [name, slot] of Object.entries(manifest.slots)) {
                if (!slot.file) { out.push({ name, file: '(synth)', peak: null, rms: null, gain: slot.gain }); continue; }
                try {
                    const buf = await (await fetch('../../assets/audio/' + slot.file, { cache: 'no-cache' })).arrayBuffer();
                    const data = await ctx.decodeAudioData(buf);
                    const ch = data.getChannelData(0);
                    let peak = 0;
                    let sum = 0;
                    for (let i = 0; i < ch.length; i++) {
                        const a = Math.abs(ch[i]);
                        if (a > peak) peak = a;
                        sum += ch[i] * ch[i];
                    }
                    out.push({ name, file: slot.file, seconds: +data.duration.toFixed(2), peak: +peak.toFixed(3), rms: +Math.sqrt(sum / ch.length).toFixed(4), gain: slot.gain, mixed: +(Math.sqrt(sum / ch.length) * slot.gain).toFixed(4) });
                } catch (e) {
                    out.push({ name, file: slot.file, error: String(e && e.message) });
                }
            }
            return out;
        });
        console.log('slot         file                 secs   peak    rms     gain   mixed rms');
        rows.forEach((r) => console.log(
            `${r.name.padEnd(12)} ${String(r.file).padEnd(20)} ${String(r.seconds ?? '-').padStart(5)}  ${String(r.peak ?? '-').padStart(6)}  ${String(r.rms ?? '-').padStart(6)}  ${String(r.gain ?? '-').padStart(5)}  ${String(r.mixed ?? '-').padStart(8)}${r.error ? '  ERROR ' + r.error : ''}`
        ));
        await browser.disconnect();
        proc.kill();
        server.close();
        process.exit(0);
    }

    const result = await page.evaluate(async (effectSource, toneSource, hissSource, lengthSeconds, sampleRate) => {
        const ctx = new OfflineAudioContext(2, Math.ceil(lengthSeconds * sampleRate), sampleRate);
        const master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);
        const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.7), ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        // The effect calls tone()/hiss() with the game's own signature, so the
        // wrappers close over the offline context instead.
        const toneImpl = new Function('ctx', 'master', 'noise', 'freq', 'when', 'duration', 'gain', 'type', 'pan', toneSource);
        const tone = (freq, when, duration, gain, type, pan) => toneImpl(ctx, master, noise, freq, when, duration, gain, type, pan);
        const hissImpl = new Function('ctx', 'master', 'noise', 'when', 'duration', 'gain', 'highpass', 'lowpass', 'pan', hissSource);
        const hiss = (when, duration, gain, highpass, lowpass, pan) => hissImpl(ctx, master, noise, when, duration, gain, highpass, lowpass, pan);
        const play = new Function('ctx', 'master', 'noise', 'tone', 'hiss', 'now', 'v', effectSource);
        play(ctx, master, noise, tone, hiss, 0, 2.2);
        const rendered = await ctx.startRendering();

        // 16-bit PCM WAV, interleaved.
        const channels = rendered.numberOfChannels;
        const frames = rendered.length;
        const bytes = frames * channels * 2;
        const buffer = new ArrayBuffer(44 + bytes);
        const view = new DataView(buffer);
        const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
        ascii(0, 'RIFF');
        view.setUint32(4, 36 + bytes, true);
        ascii(8, 'WAVE');
        ascii(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * channels * 2, true);
        view.setUint16(32, channels * 2, true);
        view.setUint16(34, 16, true);
        ascii(36, 'data');
        view.setUint32(40, bytes, true);
        const rows = [];
        for (let c = 0; c < channels; c++) rows.push(rendered.getChannelData(c));
        let offset = 44;
        let peak = 0;
        for (let i = 0; i < frames; i++) {
            for (let c = 0; c < channels; c++) {
                const sample = Math.max(-1, Math.min(1, rows[c][i]));
                if (Math.abs(sample) > peak) peak = Math.abs(sample);
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
        }
        const bytesOut = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytesOut.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytesOut.subarray(i, i + chunk));
        }
        // Where the sound actually ends, so the slot can trim any silent tail.
        let lastLoud = 0;
        for (let i = frames - 1; i >= 0; i--) {
            if (Math.abs(rows[0][i]) > 0.002 || Math.abs(rows[1][i]) > 0.002) { lastLoud = i / sampleRate; break; }
        }
        return { base64: btoa(binary), peak, seconds: frames / sampleRate, lastLoud, channels, sampleRate };
    }, effectBody, toneBody, hissBody, seconds, 44100);

    const out = path.join(root, 'assets', 'audio', `${effect}.wav`);
    fs.writeFileSync(out, Buffer.from(result.base64, 'base64'));
    console.log(`${effect}: assets/audio/${effect}.wav  ${result.seconds.toFixed(2)}s  ${result.channels}ch @ ${result.sampleRate}Hz  peak ${result.peak.toFixed(3)}  sound ends at ${result.lastLoud.toFixed(2)}s  (${fs.statSync(out).size} bytes)`);

    await browser.disconnect();
    proc.kill();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
