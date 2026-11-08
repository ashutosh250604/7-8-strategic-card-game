/*
 * fireworks.js - the result-screen celebration.
 *
 * A small canvas particle system with rising rockets, gold/rose bursts and
 * short trails. It only runs while the result layer is open, caps its pixel
 * ratio and particle count, and stops on a rematch or restart. Calm mode gets a
 * single quiet burst with no rocket streaks.
 */
(function () {
    'use strict';

    const COLORS = ['#f2d79b', '#d6ae62', '#b86a72', '#f6e7cf', '#c9a35c'];
    // A smaller cap and a lower backing-store resolution are deliberate: the
    // result modal is already expensive, and 260 particles still read as a
    // generous show on a phone or a low-powered laptop.
    const MAX_PARTICLES = 260;
    const MAX_DPR = 1.5;
    let canvas = null;
    let ctx = null;
    let frame = 0;
    let running = false;
    let reduced = false;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let startedAt = 0;
    let lastFrame = 0;
    let nextLaunch = 0;
    let launches = 0;
    let starts = 0;
    let frames = 0;
    let planned = [];
    let particles = [];
    let rockets = [];

    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    function fit() {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        }
    }

    function add(x, y, options) {
        if (particles.length >= MAX_PARTICLES) particles.shift();
        particles.push({
            x, y,
            px: x, py: y,
            vx: options.vx,
            vy: options.vy,
            life: options.life,
            maxLife: options.life,
            size: options.size,
            color: options.color,
            gravity: options.gravity,
            drag: options.drag
        });
    }

    function burst(x, y, palette, strength) {
        const count = reduced ? 24 : Math.round(44 * strength);
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.08;
            const speed = (reduced ? 45 : 95) + Math.random() * (reduced ? 55 : 155);
            add(x, y, {
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: (reduced ? 650 : 900) + Math.random() * 850,
                size: 1 + Math.random() * 1.9,
                color: palette[i % palette.length],
                gravity: reduced ? 22 : 55,
                drag: 0.985
            });
        }
        if (reduced) return;
        // A thin expanding ring makes the burst read as a sphere, not a splash.
        for (let i = 0; i < 16; i++) {
            const angle = (Math.PI * 2 * i) / 16;
            add(x, y, {
                vx: Math.cos(angle) * 32,
                vy: Math.sin(angle) * 32,
                life: 420,
                size: 1,
                color: 'rgba(246, 231, 207, .5)',
                gravity: 0,
                drag: 0.94
            });
        }
    }

    function launch(palette) {
        if (reduced) {
            burst(width * (launches % 2 ? 0.62 : 0.38), height * 0.3, palette, 0.8);
            launches += 1;
            return;
        }
        const x = width * (0.2 + Math.random() * 0.6);
        const targetY = height * (0.18 + Math.random() * 0.25);
        rockets.push({
            x,
            y: height + 12,
            px: x,
            py: height + 12,
            vy: -(height * (0.62 + Math.random() * 0.15)),
            targetY,
            age: 0,
            color: palette[launches % palette.length]
        });
        launches += 1;
    }

    function drawParticle(p) {
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        // shadowBlur per particle was the biggest hidden cost here. Additive
        // compositing already gives the gold sparkle its lift.
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    }

    function tick(dt) {
        const elapsed = now() - startedAt;
        const launchEvery = reduced ? 1200 : 620;
        if (elapsed >= nextLaunch && launches < (reduced ? 1 : 4)) {
            launch(COLORS);
            nextLaunch = elapsed + launchEvery;
        }
        // The first impression is composed rather than random: three opening
        // bursts frame the result card, then the rockets take over.
        while (planned.length && elapsed >= planned[0].at) {
            const shot = planned.shift();
            burst(width * shot.x, height * shot.y, COLORS, shot.strength || 1);
        }

        ctx.clearRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'lighter';

        for (let i = rockets.length - 1; i >= 0; i--) {
            const r = rockets[i];
            r.px = r.x;
            r.py = r.y;
            r.y += r.vy * dt;
            r.vy += height * 0.08 * dt;
            r.age += dt;
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = r.color;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(r.px, r.py);
            ctx.lineTo(r.x, r.y);
            ctx.stroke();
            if (r.y <= r.targetY || r.vy >= 0 || r.age > 1.4) {
                burst(r.x, r.y, COLORS, 1);
                rockets.splice(i, 1);
            }
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.px = p.x;
            p.py = p.y;
            p.vx *= p.drag;
            p.vy = p.vy * p.drag + p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt * 1000;
            if (p.life <= 0 || p.y > height + 30) {
                particles.splice(i, 1);
                continue;
            }
            drawParticle(p);
        }

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = 'source-over';

        if (elapsed > 5400 && !rockets.length && !particles.length) {
            stop();
            return;
        }
        if (running) frame = requestAnimationFrame(loop);
    }

    function loop(ts) {
        if (!running) return;
        frames += 1;
        const dt = Math.min(1 / 30, Math.max(0.001, (ts - lastFrame) / 1000 || 0.016));
        lastFrame = ts;
        tick(dt);
    }

    function start(options) {
        canvas = document.getElementById('fireworks-canvas');
        if (!canvas) return false;
        stop();
        const prefs = window.TableSettings ? window.TableSettings.get() : {};
        // Default-off is enforced here too, not only in the result presenter.
        // A stray caller cannot start a full-screen loop behind an opted-out
        // result screen.
        if (prefs.fireworks === false) return false;
        ctx = canvas.getContext('2d');
        if (!ctx) return false;
        reduced = !!(options && options.reduced) || prefs.motion === 'reduced';
        startedAt = now();
        lastFrame = startedAt;
        nextLaunch = reduced ? 160 : 900;
        launches = 0;
        planned = reduced
            ? [{ at: 220, x: 0.5, y: 0.28, strength: 0.8 }]
            : [
                { at: 240, x: 0.17, y: 0.29, strength: 1.15 },
                { at: 570, x: 0.83, y: 0.24, strength: 1.05 },
                { at: 920, x: 0.5, y: 0.16, strength: 0.95 }
            ];
        particles = [];
        rockets = [];
        running = true;
        starts += 1;
        fit();
        canvas.classList.add('is-live');
        window.addEventListener('resize', fit);
        frame = requestAnimationFrame(loop);
        return true;
    }

    function stop() {
        running = false;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        particles = [];
        rockets = [];
        planned = [];
        if (canvas) {
            canvas.classList.remove('is-live');
            if (ctx) ctx.clearRect(0, 0, width, height);
        }
        window.removeEventListener('resize', fit);
    }

    window.TableFireworks = {
        start,
        stop,
        active: () => running,
        particleCount: () => particles.length,
        rocketCount: () => rockets.length,
        stats: () => ({ starts, frames, active: running, particles: particles.length, rockets: rockets.length }),
        bounds: () => ({
            width, height,
            canvasWidth: canvas ? canvas.width : 0,
            canvasHeight: canvas ? canvas.height : 0,
            opacity: canvas ? getComputedStyle(canvas).opacity : null,
            display: canvas ? getComputedStyle(canvas).display : null
        }),
        reduced: () => reduced
    };
})();
