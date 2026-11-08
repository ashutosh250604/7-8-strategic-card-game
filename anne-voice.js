/*
 * anne-voice.js - Anne speaking, using the browser's own voices.
 *
 * The browser is the only TTS engine used here. On Windows/Edge the installed
 * en-IN voices include Microsoft Heera (female) and Microsoft Ravi (male);
 * online neural voices may also appear. The selector therefore starts with a
 * female English pool, gives an Indian English voice the strongest weight, and
 * never deliberately routes her through a known male voice. If no female English
 * voice is installed, the platform default is used rather than selecting a man.
 *
 * Rules:
 *   - one line at a time. A new line cancels the old utterance, so she cannot
 *     talk over herself when two events land together;
 *   - sound off or master volume at zero means speech off;
 *   - nothing is spoken before the player has interacted with the page;
 *   - utterance start/end callbacks let the portrait ring follow the voice
 *     instead of running on an unrelated timer.
 */
(function () {
    'use strict';

    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    const Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null;
    const available = !!(synth && Utterance);
    let voices = [];
    let chosen = null;
    let spoken = 0;
    let active = null;
    let speechToken = 0;

    // Calm delivery. Pauses and a little less pitch matter more than volume for
    // making a compact system voice sound like a person across the table.
    const DELIVERY = {
        neutral: { rate: 0.96, pitch: 0.96, volume: 0.92 },
        happy: { rate: 0.98, pitch: 1.00, volume: 0.95 },
        tease: { rate: 0.96, pitch: 0.99, volume: 0.93 },
        impressed: { rate: 0.95, pitch: 1.00, volume: 0.94 },
        focused: { rate: 0.93, pitch: 0.96, volume: 0.90 },
        sorry: { rate: 0.90, pitch: 0.94, volume: 0.88 },
        thinking: { rate: 0.90, pitch: 0.95, volume: 0.86 }
    };

    const FEMALE = [
        /aria/i, /jenny/i, /neerja/i, /heera/i, /veena/i, /samantha/i, /hazel/i,
        /sonia/i, /libby/i, /natasha/i, /zira/i, /female/i, /karen/i, /moira/i,
        /tessa/i, /serena/i, /allison/i, /ava/i, /susan/i, /victoria/i, /fiona/i,
        /kalpana/i, /swara/i
    ];
    const MALE = [/david/i, /mark/i, /george/i, /daniel/i, /alex/i, /fred/i, /rishi/i, /ravi/i, /guy/i, /ryan/i];
    const INDIAN = /^en[-_]in$/;

    const normLang = (lang) => String(lang || '').toLowerCase().replace(/_/g, '-');
    const isEnglish = (voice) => normLang(voice.lang).startsWith('en');
    const isFemale = (voice) => FEMALE.some((re) => re.test(`${voice.name} ${voice.voiceURI || ''}`));
    const isMale = (voice) => MALE.some((re) => re.test(`${voice.name} ${voice.voiceURI || ''}`));
    const isNatural = (voice) => /natural|neural|online/i.test(`${voice.name} ${voice.voiceURI || ''}`);

    function score(voice) {
        const name = `${voice.name} ${voice.voiceURI || ''}`;
        const lang = normLang(voice.lang);
        if (!lang.startsWith('en')) return -Infinity;
        let value = 0;
        value += INDIAN.test(lang) ? 40 : 10;       // en-IN over en-US/en-GB
        value += isFemale(voice) ? 25 : 0;
        value += isNatural(voice) ? 8 : 0;
        value += voice.localService ? 2 : 0;
        if (isMale(voice)) value -= 35;              // Ravi/Rishi must not win
        if (/compact|espeak/i.test(name)) value -= 6;
        return value;
    }

    function refresh() {
        if (!available) return;
        try {
            voices = synth.getVoices() || [];
        } catch (e) {
            voices = [];
        }
        if (!voices.length) { chosen = null; return; }
        const english = voices.filter(isEnglish);
        // Prefer a female English voice even if it is not en-IN. A male en-IN
        // voice is a fallback, never the first choice for Anne.
        const female = english.filter(isFemale);
        // Never hand Anne a known male voice. If the platform has no female
        // English voice, leave the voice unset so the browser can use its
        // default rather than explicitly selecting a male en-IN voice.
        if (!female.length) { chosen = null; return; }
        const pool = female;
        let best = null;
        let bestScore = -Infinity;
        pool.forEach((voice) => {
            const value = score(voice);
            if (value > bestScore) { best = voice; bestScore = value; }
        });
        chosen = best;
    }

    function prefs() {
        return window.TableSettings ? window.TableSettings.get() : { sound: true, volume: 0.55, voice: true };
    }

    function enabled() {
        const p = prefs();
        return available && p.sound !== false && p.voice !== false && Number(p.volume) > 0;
    }

    // Speech reads punctuation aloud in odd places; give it a clean sentence.
    function clean(text) {
        return String(text || '')
            .replace(/[—–]/g, ', ')
            .replace(/&/g, ' and ')
            .replace(/\.\.\./g, ', ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function speak(text, mood, callbacks) {
        if (!enabled()) return false;
        const line = clean(text);
        if (!line) return false;
        if (!voices.length) refresh();
        try {
            synth.cancel();
            const u = new Utterance(line);
            const tone = DELIVERY[mood] || DELIVERY.neutral;
            const p = prefs();
            const master = Math.max(0, Math.min(1, Number(p.volume)));
            u.rate = Math.max(0.7, Math.min(1.4, tone.rate));
            u.pitch = Math.max(0.7, Math.min(1.4, tone.pitch));
            u.volume = Math.max(0, Math.min(1, tone.volume * master));
            if (chosen) {
                u.voice = chosen;
                u.lang = chosen.lang || 'en-IN';
            } else {
                u.lang = 'en-IN';
            }

            const token = ++speechToken;
            let started = false;
            let ended = false;
            const onStart = () => {
                if (token !== speechToken || started) return;
                started = true;
                if (callbacks && callbacks.onstart) callbacks.onstart();
            };
            const onEnd = () => {
                if (ended) return;
                ended = true;
                if (token === speechToken && active === u) active = null;
                if (callbacks && callbacks.onend) callbacks.onend();
            };
            u.onstart = onStart;
            u.onend = onEnd;
            u.onerror = onEnd;
            active = u;
            synth.speak(u);
            spoken += 1;
            return true;
        } catch (e) {
            return false;
        }
    }

    function stop() {
        speechToken += 1;
        if (!available) return;
        try { synth.cancel(); } catch (e) { /* nothing to cancel */ }
        active = null;
    }

    function greet() {
        if (!enabled()) return false;
        const name = chosen ? chosen.name.replace(/\s*\(.*?\)\s*/g, '').trim() : '';
        speak(name
            ? `Voice ready. This is ${name}.`
            : 'Voice ready.', 'happy');
        return true;
    }

    function voiceInfo() {
        if (!chosen) return null;
        const lang = normLang(chosen.lang);
        return {
            name: chosen.name,
            lang: chosen.lang,
            indian: INDIAN.test(lang),
            female: isFemale(chosen),
            natural: isNatural(chosen),
            local: !!chosen.localService
        };
    }

    if (available) {
        refresh();
        // Voices arrive asynchronously in Chromium; pick again when they do.
        if (typeof synth.addEventListener === 'function') {
            synth.addEventListener('voiceschanged', refresh);
        } else {
            synth.onvoiceschanged = refresh;
        }
        document.addEventListener('tablesettings:change', (ev) => {
            const p = (ev && ev.detail) || prefs();
            if (p.sound === false || p.voice === false || Number(p.volume) <= 0) stop();
        });
    }

    window.AnneVoice = {
        available,
        speak,
        stop,
        greet,
        refresh,
        enabled,
        delivery: DELIVERY,
        voiceName: () => (chosen ? chosen.name : ''),
        voiceInfo,
        spokenCount: () => spoken,
        active: () => !!active
    };
})();
