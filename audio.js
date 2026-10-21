/*
 * audio.js - the table's sound and haptics.
 *
 * All effects are synthesised locally with Web Audio: no audio requests, no
 * external assets and no dependency on a network. The context is created or
 * resumed from a real user gesture, and every effect fails silently if audio is
 * unavailable. Haptics use the Vibration API where the browser supports it.
 */
(function () {
    'use strict';

    const settings = () => (window.TableSettings ? window.TableSettings.get() : {
        sound: true, volume: 0.55, haptics: true
    });

    let ctx = null;
    let master = null;
    let noise = null;
    let unlocked = false;
    let failed = false;
    const lastPlayed = Object.create(null);
    const lastVibrated = Object.create(null);

    function ensureContext() {
        if (ctx || failed) return ctx;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) { failed = true; return null; }
            ctx = new Ctx();
            master = ctx.createGain();
            master.gain.value = settings().volume;
            master.connect(ctx.destination);
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
            for (let i = 0; i < 5; i++) {
                const at = now + i * 0.115;
                hiss(at, 0.1, (0.2 + (i % 2) * 0.05) * v, 1200, 6200, i % 2 ? 0.22 : -0.22);
            }
            tone(150, now + 0.5, 0.12, 0.05 * v, 'sine', 0);
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
            tone(1240, now, 0.2, 0.05 * v, 'triangle', 0);
            tone(1860, now + 0.02, 0.3, 0.028 * v, 'sine', 0.03);
            tone(2480, now + 0.05, 0.18, 0.018 * v, 'sine', 0.06);
            hiss(now, 0.12, 0.08 * v, 2600, 9000, 0);
        },
        coinLand(now, v) {
            tone(760, now, 0.18, 0.045 * v, 'triangle', 0.02);
            tone(1140, now + 0.04, 0.22, 0.025 * v, 'sine', 0.04);
            hiss(now, 0.05, 0.12 * v, 900, 4200, 0);
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
            tone(783.99, now, 0.26, 0.04 * v, 'sine', 0);
            tone(1046.5, now + 0.08, 0.36, 0.035 * v, 'sine', 0.08);
        }
    };

    const limits = { deal: 28, flip: 45, select: 22, place: 30, trickWin: 300, trickLose: 300, invalid: 180, coin: 400 };

    function play(name) {
        const pref = settings();
        if (!pref.sound || pref.volume <= 0) return;
        const fn = effects[name];
        if (!fn) return;
        const nowMs = Date.now();
        const gap = limits[name] || 0;
        if (gap && lastPlayed[name] && nowMs - lastPlayed[name] < gap) return;
        lastPlayed[name] = nowMs;

        const c = ensureContext();
        if (!c) return;
        if (c.state === 'suspended' && unlocked) c.resume().catch(() => {});
        try {
            const at = c.currentTime + 0.004;
            const v = Math.pow(pref.volume, 1.35);
            fn(at, v);
        } catch (e) {
            // A closed or interrupted context must never break a card play.
        }
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

    const gesture = () => unlock();
    ['pointerdown', 'touchstart', 'keydown'].forEach((name) => {
        document.addEventListener(name, gesture, { once: true, passive: true });
    });

    window.GameAudio = { play, toggle, unlock, setVolume, isSupported: () => !failed };
    window.GameHaptics = { vibrate, isSupported: () => !!(typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') };
})();
