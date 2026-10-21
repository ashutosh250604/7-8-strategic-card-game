/*
 * settings.js - small, reusable preference store for the card table.
 *
 * The store is deliberately defensive: a missing, malformed or outdated value
 * falls back to the default instead of breaking the page. Preferences are local
 * to this browser and never leave the device.
 */
(function () {
    'use strict';

    const STORAGE_KEY = '78-settings-v2';
    const DEFAULTS = Object.freeze({
        difficulty: 'medium',
        matchTarget: 5,
        sound: true,
        volume: 0.55,
        motion: 'full',
        haptics: true
    });
    const DIFFICULTIES = ['easy', 'medium', 'hard'];
    const TARGETS = [3, 5, 7];
    const MOTIONS = ['full', 'fast', 'reduced'];

    const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
    const clamp = (value, low, high, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback;
    };

    function normalise(raw) {
        const out = { ...DEFAULTS };
        if (!raw || typeof raw !== 'object') return out;
        out.difficulty = oneOf(raw.difficulty, DIFFICULTIES, DEFAULTS.difficulty);
        out.matchTarget = oneOf(Number(raw.matchTarget), TARGETS, DEFAULTS.matchTarget);
        out.sound = typeof raw.sound === 'boolean' ? raw.sound : DEFAULTS.sound;
        out.volume = clamp(raw.volume, 0, 1, DEFAULTS.volume);
        out.motion = oneOf(raw.motion, MOTIONS, DEFAULTS.motion);
        out.haptics = typeof raw.haptics === 'boolean' ? raw.haptics : DEFAULTS.haptics;
        return out;
    }

    function read() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return normalise(raw ? JSON.parse(raw) : null);
        } catch (e) {
            return { ...DEFAULTS };
        }
    }

    let current = read();

    function persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
            return true;
        } catch (e) {
            // Private mode, a full quota or file:// with storage disabled.
            return false;
        }
    }

    function get() {
        return { ...current };
    }

    function update(patch) {
        if (!patch || typeof patch !== 'object') return get();
        current = normalise({ ...current, ...patch });
        persist();
        document.dispatchEvent(new CustomEvent('tablesettings:change', { detail: get() }));
        return get();
    }

    function reset() {
        current = { ...DEFAULTS };
        persist();
        document.dispatchEvent(new CustomEvent('tablesettings:change', { detail: get() }));
        return get();
    }

    window.TableSettings = {
        STORAGE_KEY,
        DEFAULTS,
        DIFFICULTIES,
        TARGETS,
        MOTIONS,
        get,
        update,
        reset,
        normalise,
        hasHaptics: () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
    };
})();
