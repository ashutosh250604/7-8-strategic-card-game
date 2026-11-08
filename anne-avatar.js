/*
 * anne-avatar.js - Anne, the card-table host.
 *
 * The supplied portrait is the single source of her face: the same image is
 * mounted on the home page, the seat, the trump sheet, the tutorial and the
 * result card. Presentation-only; it never touches cards, scores or the AI.
 *
 * The photograph is kept still, but alive: a slow breath, a warm light pass,
 * a tilt on a strong beat and a soft speaking ring. The mood state also changes
 * the light grade, never the face, so she cannot drift between screens.
 */
(function () {
    'use strict';

    const FALLBACK_LABEL = 'Anne, your host';
    const MOODS = ['neutral', 'happy', 'tease', 'impressed', 'focused', 'sorry', 'thinking'];
    const script = document.currentScript;
    const PHOTO_URL = (() => {
        try {
            return new URL('assets/anne/anne-portrait.png?v=2', script && script.src ? script.src : document.baseURI).href;
        } catch (e) {
            return '../../assets/anne/anne-portrait.png?v=2';
        }
    })();

    let instance = 0;
    const mounted = new Set();

    function portrait() {
        return `
<span class="aa aa-portrait">
  <span class="aa-photo-live">
    <img class="aa-photo" src="${PHOTO_URL}" alt="" draggable="false" decoding="async">
  </span>
  <span class="aa-photo-tone" aria-hidden="true"></span>
  <span class="aa-photo-vignette" aria-hidden="true"></span>
</span>`;
    }

    function mount(host, options) {
        if (!host || host.nodeType !== 1) return null;
        if (host.dataset.anneMounted === '1') return host.querySelector('.aa-photo');
        host.innerHTML = portrait();
        host.dataset.anneMounted = '1';
        host.classList.add('anne-face-host');
        const opts = options || {};
        if (opts.size) host.style.setProperty('--aa-size', opts.size);
        const crop = opts.crop || 'bust';
        host.classList.toggle('aa-crop-face', crop === 'face');
        host.classList.toggle('aa-crop-bust', crop !== 'face');
        host.dataset.mood = 'neutral';
        if (!host.getAttribute('role')) host.setAttribute('role', 'img');
        if (!host.getAttribute('aria-label')) host.setAttribute('aria-label', opts.label || FALLBACK_LABEL);
        const img = host.querySelector('.aa-photo');
        if (img) {
            img.addEventListener('error', () => host.classList.add('is-missing'), { once: true });
        }
        mounted.add(host);
        return img;
    }

    function mountAll(root) {
        const scope = root || document;
        const nodes = scope.querySelectorAll('[data-anne-avatar]');
        nodes.forEach((node) => mount(node, {
            crop: node.dataset.crop || 'bust',
            size: node.dataset.size || undefined,
            label: node.dataset.label || undefined
        }));
        return nodes.length;
    }

    function eachHost(fn) {
        mounted.forEach((host) => {
            if (!document.body.contains(host)) { mounted.delete(host); return; }
            fn(host);
        });
    }

    function mood(name, opts) {
        const beat = !!(opts && opts.beat);
        const next = MOODS.includes(name) ? name : 'neutral';
        eachHost((host) => {
            host.dataset.mood = next;
            if (beat) {
                host.classList.remove('is-beating');
                void host.getBoundingClientRect();
                host.classList.add('is-beating');
            }
        });
    }

    let talkTimer = null;

    // A line starts. The ring and the small voice bars run for exactly as long
    // as the line is held. The photograph itself only breathes and leans.
    function speak(text, duration) {
        const ms = Math.max(500, Math.min(12000, Number(duration) || 3000));
        eachHost((host) => {
            host.classList.add('is-talking');
            const seat = host.closest('.computer-area');
            if (seat) seat.classList.add('is-speaking');
        });
        clearTimeout(talkTimer);
        talkTimer = setTimeout(() => quiet(), ms);
    }

    function quiet() {
        clearTimeout(talkTimer);
        talkTimer = null;
        eachHost((host) => {
            host.classList.remove('is-talking');
            const seat = host.closest('.computer-area');
            if (seat) seat.classList.remove('is-speaking');
        });
    }

    // Kept as a small API hook for the character layer. A photograph does not
    // have a drawn eyelid, so this is a brief light blink rather than a fake
    // facial redraw.
    function blink(host) {
        if (!host) return;
        host.classList.add('is-blinking');
        setTimeout(() => host.classList.remove('is-blinking'), 150);
    }

    function reset() {
        quiet();
        eachHost((host) => {
            host.dataset.mood = 'neutral';
            host.classList.remove('is-beating', 'is-blinking');
        });
    }

    function isMounted() {
        return mounted.size > 0;
    }

    function ready() {
        mountAll();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
    else ready();

    window.TableAvatar = {
        mount,
        mountAll,
        mood,
        speak,
        quiet,
        reset,
        blink,
        isMounted,
        crops: { bust: 'bust', face: 'face' },
        shapes: MOODS,
        portrait: PHOTO_URL,
        source: 'photo'
    };
})();
