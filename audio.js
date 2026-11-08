/*
 * audio.js - the table's sound and haptics.
 *
 * Every effect has a synthesised fallback, so the game is complete with no
 * audio assets and never waits on a download. `assets/audio/manifest.json` can
 * swap any slot for a recorded file; a missing or undecodable file simply keeps
 * the synth. The context is created or resumed from a real user gesture, and
 * every effect fails silently if audio is unavailable. Haptics use the
 * Vibration API where the browser supports it.
 */
(function () {
    'use strict';

    const settings = () => (window.TableSettings ? window.TableSettings.get() : {
        sound: true, volume: 0.55, haptics: true
    });

    let ctx = null;
    let master = null;
    let limiter = null;
    let noise = null;
    let unlocked = false;
    let failed = false;
    const lastPlayed = Object.create(null);
    const lastVibrated = Object.create(null);

    // Recorded sounds are optional. assets/audio/manifest.json names one file
    // per slot, plus the mix details a recording needs to sit beside the rest:
    // `gain` (files arrive at wildly different levels), `offset` (skip the dead
    // air before a one-shot) and `maxSeconds` (cut a long tail so repeated
    // effects do not pile up). Any slot without a file keeps the synth.
    const AUDIO_BASE = (function () {
        try {
            const tag = document.currentScript;
            return new URL('assets/audio/', tag && tag.src ? tag.src : document.baseURI);
        } catch (e) {
            return null;
        }
    })();
    const samples = Object.create(null);
    const localSamples = Object.create(null);
    const isFilePage = typeof location !== 'undefined' && location.protocol === 'file:';
    let samplesRequested = false;

    function ensureContext() {
        if (ctx || failed) return ctx;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) { failed = true; return null; }
            ctx = new Ctx();
            master = ctx.createGain();
            master.gain.value = settings().volume;
            // A gentle limiter lets the effects sit well forward on laptop
            // speakers without clipping when several land together.
            if (typeof ctx.createDynamicsCompressor === 'function') {
                limiter = ctx.createDynamicsCompressor();
                limiter.threshold.value = -10;
                limiter.knee.value = 12;
                limiter.ratio.value = 8;
                limiter.attack.value = 0.004;
                limiter.release.value = 0.18;
                master.connect(limiter);
                limiter.connect(ctx.destination);
            } else {
                master.connect(ctx.destination);
            }
            noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.7), ctx.sampleRate);
            const data = noise.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        } catch (e) {
            failed = true;
            ctx = null;
        }
        return ctx;
    }

    function unlock() {
        const c = ensureContext();
        if (!c) return;
        unlocked = true;
        if (c.state === 'suspended') c.resume().catch(() => { /* a later gesture can retry */ });
        loadSamples();
    }

    function loadSamples() {
        if (samplesRequested || !AUDIO_BASE) return;
        samplesRequested = true;
        const manifest = window.TableAudioSlots;
        const slots = manifest && manifest.slots;
        if (!slots) return;
        const slotValue = (slot, key, fallback) => num(slot && slot[key], fallback);
        const decode = (buffer, name, slot) => new Promise((resolve) => {
            try {
                ctx.decodeAudioData(buffer, (data) => {
                    samples[name] = {
                        buffer: data,
                        gain: slotValue(slot, 'gain', 1) || 1,
                        offset: slotValue(slot, 'offset', 0),
                        maxSeconds: slotValue(slot, 'maxSeconds', 0)
                    };
                    resolve();
                }, resolve);
            } catch (e) {
                resolve();
            }
        });
        // A file:// page cannot fetch the manifest or decode sibling files into
        // Web Audio, but an HTMLAudioElement can play a same-folder recording.
        // Use that path so the local build sounds like the served build.
        if (isFilePage) {
            Object.keys(slots).forEach((name) => {
                const slot = slots[name];
                if (!slot || !slot.file) return;
                try {
                    const url = new URL(slot.file, AUDIO_BASE).href;
                    const el = new Audio(url);
                    el.preload = 'auto';
                    el.setAttribute('playsinline', '');
                    localSamples[name] = {
                        url,
                        gain: slotValue(slot, 'gain', 1) || 1,
                        offset: slotValue(slot, 'offset', 0),
                        maxSeconds: slotValue(slot, 'maxSeconds', 0),
                        el
                    };
                    el.load();
                } catch (e) { /* keep the synth for this slot */ }
            });
            return;
        }
        if (!ctx) return;
        Object.keys(slots).forEach((name) => {
            const slot = slots[name];
            if (!slot || !slot.file) return;
            fetch(new URL(slot.file, AUDIO_BASE), { cache: 'force-cache' })
                .then((res) => (res.ok ? res.arrayBuffer() : null))
                .then((buf) => (buf ? decode(buf, name, slot) : null))
                .catch(() => { /* keep the synth for this slot */ });
        });
    }

    // file:// playback through a media element needs no decode and no fetch.
    // A fresh element per effect lets quick card sounds overlap naturally and
    // avoids one long effect cutting off the next; the browser caches the file.
    function playLocalSample(name, limit) {
        const sample = localSamples[name];
        if (!sample) return false;
        const volume = Math.max(0, Math.min(1, Number(settings().volume) * sample.gain));
        if (!volume) return true;
        try {
            const el = new Audio(sample.url);
            el.preload = 'auto';
            el.setAttribute('playsinline', '');
            el.volume = Math.max(0.0001, volume);
            const start = () => {
                try {
                    const duration = Number.isFinite(el.duration) ? el.duration : 0;
                    const offset = Math.min(sample.offset, Math.max(0, duration - 0.02));
                    if (offset > 0) el.currentTime = offset;
                } catch (e) { /* metadata not ready; start at zero */ }
                el.play().catch(() => { /* keep silent rather than break a turn */ });
            };
            if (el.readyState >= 1) start();
            else el.addEventListener('loadedmetadata', start, { once: true });
            const cap = Math.min(limit || Infinity, sample.maxSeconds || Infinity);
            if (Number.isFinite(cap)) {
                setTimeout(() => { try { el.pause(); } catch (e) { /* already ended */ } }, Math.max(60, cap * 1000));
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    const num = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
    };

    // Play a recorded effect. A one-shot is trimmed to its useful part and
    // faded rather than cut, so a two-second chime can fire on every trick
    // without its tail smearing into the next one.
    function playSample(name, when, limit) {
        if (!ctx || !master) return false;
        const sample = samples[name];
        if (!sample) return false;
        const src = ctx.createBufferSource();
        const amp = ctx.createGain();
        src.buffer = sample.buffer;
        const duration = sample.buffer.duration;
        const offset = Math.min(sample.offset, Math.max(0, duration - 0.02));
        const avail = duration - offset;
        const cap = Math.min(limit || Infinity, sample.maxSeconds || Infinity);
        const length = Math.max(0.04, Math.min(avail, cap));
        const gainValue = Math.max(0.0001, sample.gain);
        src.connect(amp);
        amp.connect(master);
        amp.gain.setValueAtTime(gainValue, when);
        if (length < avail - 0.02) {
            const fade = Math.min(0.14, length * 0.35);
            amp.gain.setValueAtTime(gainValue, when + Math.max(0, length - fade));
            amp.gain.linearRampToValueAtTime(0.0001, when + length);
        }
        src.start(when, offset);
        src.stop(when + length + 0.02);
        return true;
    }

    function tone(freq, when, duration, gain, type, pan) {
        if (!ctx || !master) return;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, when);
        const peak = Math.max(0.00001, gain);
        amp.gain.setValueAtTime(0.00001, when);
        amp.gain.exponentialRampToValueAtTime(peak, when + Math.min(0.018, duration * 0.3));
        amp.gain.exponentialRampToValueAtTime(0.00001, when + duration);
        osc.connect(amp);
        if (panner) {
            panner.pan.value = pan || 0;
            amp.connect(panner);
            panner.connect(master);
        } else {
            amp.connect(master);
        }
        osc.start(when);
        osc.stop(when + duration + 0.03);
    }

    function hiss(when, duration, gain, highpass, lowpass, pan) {
        if (!ctx || !master || !noise) return;
        const src = ctx.createBufferSource();
        const hp = ctx.createBiquadFilter();
        const lp = ctx.createBiquadFilter();
        const amp = ctx.createGain();
        const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
        src.buffer = noise;
        src.loop = true;
        hp.type = 'highpass';
        hp.frequency.value = highpass || 700;
        lp.type = 'lowpass';
        lp.frequency.value = lowpass || 5200;
        const peak = Math.max(0.00001, gain);
        amp.gain.setValueAtTime(0.00001, when);
        amp.gain.exponentialRampToValueAtTime(peak, when + Math.min(0.018, duration * 0.3));
        amp.gain.exponentialRampToValueAtTime(0.00001, when + duration);
        src.connect(hp);
        hp.connect(lp);
        lp.connect(amp);
        if (panner) {
            panner.pan.value = pan || 0;
            amp.connect(panner);
            panner.connect(master);
        } else {
            amp.connect(master);
        }
        src.start(when);
        src.stop(when + duration + 0.03);
    }

    const effects = {
        deal(now, v) {
            hiss(now, 0.075, 0.32 * v, 900, 5200, 0.14);
            tone(190 + Math.random() * 30, now, 0.055, 0.035 * v, 'triangle', 0.1);
        },
        flip(now, v) {
            hiss(now, 0.06, 0.22 * v, 1400, 6800, -0.08);
        },
        shuffle(now, v) {
            // A real riffle is a run of short papery snaps, not one soft hiss.
            // The cadence follows the visible riffle in the presentation layer:
            // pick up (0-0.3s), three riffles, square up (~1.7s).
            const riffleAt = [0.36, 0.78, 1.2];
            riffleAt.forEach((base) => {
                for (let i = 0; i < 5; i++) {
                    const at = now + base + i * 0.045;
                    hiss(at, 0.07, (0.3 + (i % 2) * 0.06) * v, 1500, 7000, i % 2 ? 0.3 : -0.3);
                }
            });
            // The squared pack landing on the felt.
            hiss(now + 1.62, 0.1, 0.4 * v, 500, 3200, 0);
            tone(124, now + 1.62, 0.2, 0.13 * v, 'sine', 0);
            tone(168, now + 0.02, 1.5, 0.035 * v, 'sine', 0);
        },
        select(now, v) {
            tone(1180, now, 0.035, 0.045 * v, 'sine', -0.05);
            hiss(now, 0.025, 0.07 * v, 2600, 7000, 0);
        },
        place(now, v) {
            hiss(now, 0.05, 0.38 * v, 700, 4200, 0.04);
            tone(150, now, 0.085, 0.13 * v, 'sine', 0);
            tone(92, now + 0.012, 0.12, 0.09 * v, 'triangle', 0);
        },
        trickWin(now, v) {
            tone(660, now, 0.42, 0.055 * v, 'sine', -0.1);
            tone(880, now + 0.075, 0.48, 0.05 * v, 'sine', 0.08);
            tone(1320, now + 0.15, 0.32, 0.022 * v, 'sine', 0.16);
        },
        trickLose(now, v) {
            tone(220, now, 0.32, 0.05 * v, 'sine', 0.08);
            tone(165, now + 0.1, 0.4, 0.045 * v, 'triangle', 0.08);
        },
        trump(now, v) {
            tone(440, now, 0.18, 0.04 * v, 'sine', 0);
            tone(660, now + 0.08, 0.24, 0.03 * v, 'sine', 0.06);
        },
        coin(now, v) {
            // Metallic partials ring for the whole flight, so the flip has a body
            // instead of a single "tick" nobody notices.
            tone(1180, now, 1.2, 0.06 * v, 'triangle', 0);
            tone(1770, now + 0.02, 1.4, 0.032 * v, 'sine', 0.04);
            tone(2630, now + 0.06, 0.9, 0.022 * v, 'sine', 0.08);
            hiss(now, 0.3, 0.16 * v, 2200, 9500, 0);
            // A slow whoosh that follows the coin up and back down.
            hiss(now + 0.03, 1.15, 0.06 * v, 500, 2400, 0);
            // The clink of the coin turning over at the top of the toss.
            tone(1560, now + 0.44, 0.18, 0.03 * v, 'sine', -0.06);
        },
        coinLand(now, v) {
            tone(720, now, 0.3, 0.075 * v, 'triangle', 0.02);
            tone(1080, now + 0.02, 0.42, 0.04 * v, 'sine', 0.04);
            tone(1620, now + 0.05, 0.5, 0.022 * v, 'sine', 0.06);
            hiss(now, 0.06, 0.2 * v, 800, 5200, 0);
        },
        invalid(now, v) {
            tone(190, now, 0.12, 0.06 * v, 'triangle', 0);
            tone(152, now + 0.055, 0.14, 0.05 * v, 'triangle', 0);
        },
        victory(now, v) {
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, now + i * 0.12, 0.7, 0.05 * v, 'triangle', i % 2 ? 0.12 : -0.08));
            tone(261.63, now, 0.9, 0.035 * v, 'sine', 0);
        },
        defeat(now, v) {
            [392, 329.63, 261.63].forEach((f, i) => tone(f, now + i * 0.16, 0.48, 0.045 * v, 'sine', 0.04));
        },
        matchPoint(now, v) {
            // One point from the match. A rising two-note bell with a shimmer
            // over a soft low body: bright enough to cut through the table,
            // deliberately short of the end-of-match fanfare. The recording in
            // assets/audio/matchPoint.wav is this exact cue, rendered offline by
            // tests/render-sound.js, so file and fallback cannot drift.
            tone(783.99, now, 0.42, 0.05 * v, 'triangle', -0.06);
            tone(1174.66, now + 0.085, 0.6, 0.042 * v, 'sine', 0.06);
            tone(1567.98, now + 0.09, 0.42, 0.016 * v, 'sine', 0.12);
            tone(196, now, 0.3, 0.022 * v, 'sine', 0);
            hiss(now + 0.02, 0.22, 0.05 * v, 3200, 9000, 0);
        }
    };

    const limits = { deal: 28, flip: 45, select: 22, place: 30, trickWin: 300, trickLose: 300, invalid: 180, coin: 400 };

    function play(name, opts) {
        const pref = settings();
        if (!pref.sound || pref.volume <= 0) return;
        const fn = effects[name];
        if (!fn) return;
        const nowMs = Date.now();
        const gap = limits[name] || 0;
        if (gap && lastPlayed[name] && nowMs - lastPlayed[name] < gap) return;
        lastPlayed[name] = nowMs;
        const limit = opts && num(opts.maxSeconds, 0);

        const c = ensureContext();
        if (!c) return;
        const fire = () => {
            try {
                const at = c.currentTime + 0.004;
                if (isFilePage && playLocalSample(name, limit)) {
                    // Local file playback uses the same slot gain and offset.
                } else if (samples[name] && playSample(name, at, limit)) {
                    // The file's own level is applied by its slot gain; master
                    // applies the saved volume and the limiter catches overlap.
                } else {
                    // Full-scale velocity: master already applies the saved
                    // volume, so do not attenuate it twice. The boost makes card
                    // sounds audible on ordinary laptop speakers at the default
                    // level.
                    fn(at, 2.2);
                }
            } catch (e) {
                // A closed or interrupted context must never break a card play.
            }
        };
        // Browsers start the context suspended until a gesture. Scheduling the
        // effect before resume() lands is the classic "the first sound is
        // silent" bug; wait for the context to actually run.
        if (c.state === 'suspended') {
            c.resume().then(fire, fire);
        } else {
            fire();
        }
    }

    function test() {
        unlock();
        play('coin');
        setTimeout(() => play('place'), 130);
        setTimeout(() => play('trickWin'), 260);
    }

    function setVolume(value) {
        if (master && ctx) master.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), ctx.currentTime, 0.02);
    }

    function toggle() {
        const next = !settings().sound;
        if (window.TableSettings) window.TableSettings.update({ sound: next });
        if (next) { unlock(); play('select'); }
        return next;
    }

    // ------------------------------------------------------------------ haptics
    const PATTERNS = {
        select: 8,
        play: 14,
        flip: 6,
        coin: [18, 52, 24],
        trickWin: [18, 42, 18],
        trickLose: 20,
        victory: [26, 55, 26, 55, 42],
        defeat: [20, 70, 30],
        invalid: [12, 40, 12]
    };

    function vibrate(name) {
        const pref = settings();
        if (!pref.haptics) return false;
        if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
        const pattern = PATTERNS[name];
        if (!pattern) return false;
        const now = Date.now();
        // A single event can be received twice (for example a click after a key
        // press); do not buzz twice for it.
        if (lastVibrated[name] && now - lastVibrated[name] < 90) return false;
        lastVibrated[name] = now;
        try {
            return navigator.vibrate(pattern);
        } catch (e) {
            return false;
        }
    }

    document.addEventListener('tablesettings:change', (ev) => {
        const detail = ev.detail || settings();
        if (detail.sound) unlock();
        setVolume(detail.volume);
    });

    // Browsers only allow audio after a gesture, and some mobile browsers
    // suspend the context again when the tab is backgrounded. Keep listening
    // (cheaply) instead of giving up after the first attempt.
    const gesture = () => unlock();
    ['pointerdown', 'touchstart', 'keydown'].forEach((name) => {
        document.addEventListener(name, gesture, { passive: true });
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') unlock();
    });

    window.GameAudio = {
        play,
        toggle,
        unlock,
        setVolume,
        test,
        isSupported: () => !failed,
        // Diagnostics for the dev probes: which slots came from a file.
        sampleStatus: () => [...new Set([...Object.keys(samples), ...Object.keys(localSamples)])],
        sampleInfo: () => Object.keys(samples).reduce((acc, name) => {
            const s = samples[name];
            acc[name] = { seconds: +s.buffer.duration.toFixed(2), gain: s.gain, offset: s.offset, maxSeconds: s.maxSeconds };
            return acc;
        }, Object.keys(localSamples).reduce((acc, name) => {
            const s = localSamples[name];
            acc[name] = { source: 'media-element', gain: s.gain, offset: s.offset, maxSeconds: s.maxSeconds, readyState: s.el.readyState };
            return acc;
        }, {}))
    };
    window.GameHaptics = { vibrate, isSupported: () => !!(typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') };
})();
