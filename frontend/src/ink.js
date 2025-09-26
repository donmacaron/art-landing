// src/ink.js
// Exports initInkReveal(options) -> API { destroy(), resetAll(), removeLast(), getSplashes(), setOptimization() }

export function initInkReveal(options = {}) {
  const defaults = {
    // visual / UX
    imageUrl: '/bg_plants.png',
    veilColor: '#E9E6E4',
    activation: 'click', // 'click' | 'hold'
    holdTime: 600,
    growthSpeed: 220,
    maxRadius: 360,
    permanentOnMax: false,
    blobs: 8,
    jitter: 0.45,

    // concurrency / optimization
    maxActiveSplashes: 3,
    maxConcurrentDraw: 3,
    maxNoisePerSplash: 40,
    blurThreshold: 6,
    smallRadiusSkip: 0.9,
    maxBlobParts: 10,
    noiseFactor: 0.6,

    // ghost ripples (autonomous water-touch)
    ghost: {
      enabled: true,
      ratePerSec: 0.6,       // average spawns per second
      maxConcurrent: 3,      // concurrent ghost ripples
      maxRadius: 120,        // ghost max radius
      alpha: 0.36,           // transparency when cutting the veil (0..1)
      drift: 6,              // px/sec drift
      lifetime: 2200,        // ms (approx) how long a ghost exists
      jitter: 0.35,          // shape jitter for ghosts
      cacheSize: 256,        // offscreen cache size for blob mask
      useOffscreenCache: true
    }
  };

  const cfg = Object.assign({}, defaults, options);
  // ensure nested ghost merges if options provided partially
  cfg.ghost = Object.assign({}, defaults.ghost, options.ghost || {});

  // clamp blob parts
  const blobCount = Math.max(3, Math.min(cfg.maxBlobParts, cfg.blobs));

  // create bg div
  let bg = document.getElementById('ink-bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.id = 'ink-bg';
    document.body.insertBefore(bg, document.body.firstChild);
  }
  bg.style.backgroundImage = `url('${cfg.imageUrl}')`;
  bg.style.backgroundPosition = 'center';
  bg.style.backgroundSize = 'cover';
  bg.style.pointerEvents = 'none';
  bg.style.zIndex = '0';

  // veil canvas
  let canvas = document.getElementById('ink-veil');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'ink-veil';
    document.body.appendChild(canvas);
  }
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.zIndex = '30';
  canvas.style.pointerEvents = 'none';
  const ctx = canvas.getContext('2d', { alpha: true });

  // DPR-aware resize
  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFullVeil();
  }

  function drawFullVeil() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = cfg.veilColor;
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.restore();
  }

  // state
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let lastMoveTime = performance.now();
  let pointerDownTime = 0;
  let pointerWasDown = false;
  let pointerMoveDuringDown = 0;

  const splashes = []; // interactive splashes
  const ghosts = [];   // autonomous ghost ripples

  // offscreen cache for a ghost mask (performance)
  let ghostCacheCanvas = null;
  let ghostCacheReady = false;

  function makeBlobLayout(baseRadius, parts = blobCount, jitter = cfg.jitter) {
    const layout = [];
    for (let i = 0; i < parts; i++) {
      const angle = (Math.PI * 2 * i) / parts + (Math.random() - 0.5) * 0.8;
      const ox = Math.cos(angle) * baseRadius * (0.2 + Math.random() * jitter);
      const oy = Math.sin(angle) * baseRadius * (0.2 + Math.random() * jitter);
      const rr = baseRadius * (0.35 + Math.random() * 0.7);
      layout.push({ ox, oy, rr });
    }
    return layout;
  }

  function createSplash(x, y) {
    // enforce active limit
    if (splashes.length >= cfg.maxActiveSplashes) {
      let foundIdx = -1, oldest = Infinity;
      for (let i = 0; i < splashes.length; i++) {
        if (!splashes[i].permanent && splashes[i].createdAt < oldest) {
          oldest = splashes[i].createdAt;
          foundIdx = i;
        }
      }
      if (foundIdx >= 0) {
        splashes[foundIdx].growing = false;
        splashes[foundIdx].targetRadius = 0;
      } else {
        splashes.shift();
      }
    }

    const s = {
      cx: x, cy: y,
      layout: makeBlobLayout(cfg.maxRadius),
      targetRadius: Math.max(6, cfg.maxRadius * 0.06),
      radius: 0,
      permanent: cfg.permanentOnMax === true ? false : false,
      growing: true,
      createdAt: performance.now()
    };
    splashes.push(s);
    return s;
  }

  // --- Ghosts ---
  function ensureGhostCache() {
    if (ghostCacheReady) return;
    if (!cfg.ghost.useOffscreenCache) {
      ghostCacheReady = false;
      return;
    }
    const size = Math.max(64, Math.min(1024, cfg.ghost.cacheSize || 256));
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d');

    // draw a soft irregular blob to the offscreen canvas
    const center = size / 2;
    const baseR = size * 0.46;
    const parts = Math.max(4, Math.min(16, Math.floor(cfg.blobs / 1.5)));
    const layout = makeBlobLayout(baseR, parts, cfg.ghost.jitter || 0.35);

    // start with full opaque circle and cut holes (we will use it as mask)
    octx.clearRect(0, 0, size, size);

    // Draw multiple radial gradients (white inner -> transparent outer)
    for (let i = 0; i < layout.length; i++) {
      const b = layout[i];
      const br = Math.max(2, b.rr);
      const bx = center + b.ox;
      const by = center + b.oy;
      const g = octx.createRadialGradient(bx, by, br * 0.12, bx, by, br);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      octx.fillStyle = g;
      octx.beginPath();
      octx.arc(bx, by, br, 0, Math.PI * 2);
      octx.fill();
    }

    // Add light noise dots to make it organic
    const noiseCount = Math.max(8, Math.min(180, Math.round(size * 0.08)));
    octx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < noiseCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.random() * baseR;
      const nx = center + Math.cos(ang) * rr * (0.6 + Math.random() * 0.8);
      const ny = center + Math.sin(ang) * rr * (0.6 + Math.random() * 0.8);
      const nr = Math.random() * (Math.max(0.6, size * 0.006));
      octx.beginPath();
      octx.arc(nx, ny, nr, 0, Math.PI * 2);
      octx.fill();
    }

    ghostCacheCanvas = off;
    ghostCacheReady = true;
  }

  // spawn ghost ripple at random position (or provide x,y)
  function spawnGhost(x = null, y = null) {
    if (!cfg.ghost.enabled) return null;
    if (ghosts.length >= cfg.ghost.maxConcurrent) return null;

    const cx = x === null ? (20 + Math.random() * (window.innerWidth - 40)) : x;
    const cy = y === null ? (20 + Math.random() * (window.innerHeight - 40)) : y;

    const g = {
      cx,
      cy,
      radius: 0,
      targetRadius: (20 + Math.random() * (cfg.ghost.maxRadius - 20)),
      lifeStart: performance.now(),
      lifeSpan: cfg.ghost.lifetime * (0.8 + Math.random() * 0.8),
      driftX: (Math.random() - 0.5) * cfg.ghost.drift,
      driftY: (Math.random() - 0.5) * cfg.ghost.drift,
      rotation: Math.random() * Math.PI * 2,
      createdAt: performance.now()
    };
    ghosts.push(g);
    return g;
  }

  // pointer handling (click/hold)
  function onPointerMove(e) {
    const x = e.clientX ?? (e.touches && e.touches[0] && e.touches[0].clientX) ?? lastPointer.x;
    const y = e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY) ?? lastPointer.y;
    const dx = x - lastPointer.x;
    const dy = y - lastPointer.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (pointerWasDown) pointerMoveDuringDown += dist;

    lastPointer.x = x;
    lastPointer.y = y;
    lastMoveTime = performance.now();
  }

  let pointerMoveDuringDownLocal = 0;
  function onPointerDown(e) {
    pointerWasDown = true;
    pointerDownTime = performance.now();
    pointerMoveDuringDown = 0;
    pointerMoveDuringDownLocal = 0;
  }
  function onPointerUp(e) {
    pointerWasDown = false;
    const moved = pointerMoveDuringDownLocal || pointerMoveDuringDown || 0;
    if (cfg.activation === 'click') {
      if (moved <= 8) createSplash(lastPointer.x, lastPointer.y);
    }
    pointerMoveDuringDownLocal = 0;
  }

  window.addEventListener('mousemove', onPointerMove, { passive: true });
  window.addEventListener('touchmove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);

  // draw a splash (interactive) — costlier but capped
  function drawSplashMask(s) {
    if (s.radius < cfg.smallRadiusSkip) return;
    if (s.radius > cfg.blurThreshold) ctx.filter = `blur(${Math.max(1, s.radius * 0.02)}px)`;
    else ctx.filter = 'none';

    ctx.globalCompositeOperation = 'destination-out';

    const scale = Math.max(0.01, s.radius / Math.max(1, cfg.maxRadius));
    for (let i = 0, L = s.layout.length; i < L; i++) {
      const b = s.layout[i];
      const br = Math.max(2, b.rr * scale * 1.2);
      const bx = s.cx + b.ox * scale;
      const by = s.cy + b.oy * scale;
      const g = ctx.createRadialGradient(bx, by, br * 0.12, bx, by, br);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }

    // capped noise holes
    const noiseCount = Math.min(cfg.maxNoisePerSplash, Math.max(6, Math.round(s.radius * cfg.noiseFactor)));
    for (let i = 0; i < noiseCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.random() * s.radius;
      const nx = s.cx + Math.cos(ang) * rr * (0.6 + Math.random() * 0.8);
      const ny = s.cy + Math.sin(ang) * rr * (0.6 + Math.random() * 0.8);
      const nr = Math.random() * Math.max(0.6, s.radius * 0.02);
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
  }

  // draw a ghost by blitting the cached mask (fast)
  function drawGhost(g) {
    if (!ghostCacheReady) {
      // fallback to drawing a cheap radial if cache missing
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${cfg.ghost.alpha})`;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
      return;
    }

    // draw cached mask scaled to desired radius
    const off = ghostCacheCanvas;
    const size = off.width; // square cache
    const drawSize = Math.max(4, (g.radius / (cfg.ghost.maxRadius || size)) * size * 2); // scale factor
    const half = drawSize / 2;

    ctx.save();
    // set alpha for subtle reveal
    ctx.globalAlpha = cfg.ghost.alpha;
    ctx.globalCompositeOperation = 'destination-out';

    // drawImage auto-smooths, so it's lightweight
    ctx.translate(g.cx, g.cy);
    ctx.rotate(g.rotation || 0);
    ctx.drawImage(off, -half, -half, drawSize, drawSize);
    ctx.rotate(-(g.rotation || 0));
    ctx.translate(-g.cx, -g.cy);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ghost spawn scheduler
  let lastGhostSpawn = performance.now();
  function maybeSpawnGhost(now) {
    if (!cfg.ghost.enabled) return;
    // spawn with Poisson-ish rate: probability per frame = ratePerSec * dt
    const dt = Math.max(1, now - (maybeSpawnGhost._last || now));
    maybeSpawnGhost._last = now;
    const prob = (cfg.ghost.ratePerSec * dt) / 1000;
    if (Math.random() < prob) {
      spawnGhost();
    }
  }

  // main loop
  let raf = null;
  function tick() {
    const now = performance.now();
    maybeSpawnGhost(now);

    // hold activation: create splash when idle
    if (cfg.activation === 'hold') {
      const idle = now - lastMoveTime;
      if (idle >= cfg.holdTime) {
        const recently = splashes.length > 0 && (now - splashes[splashes.length - 1].createdAt < 250);
        if (!recently) createSplash(lastPointer.x, lastPointer.y);
        lastMoveTime = now + 80;
      }
    }

    // update interactive splashes
    for (let i = 0; i < splashes.length; i++) {
      const s = splashes[i];
      if (s.growing) {
        s.targetRadius += (cfg.growthSpeed / 60);
        if (s.targetRadius >= cfg.maxRadius) {
          s.targetRadius = cfg.maxRadius;
          s.growing = false;
          if (cfg.permanentOnMax) s.permanent = true;
        }
      } else {
        if (!s.permanent) {
          s.targetRadius -= (cfg.growthSpeed / 60) * 1.6;
          if (s.targetRadius < 0) s.targetRadius = 0;
        }
      }
      s.radius += (s.targetRadius - s.radius) * 0.22;
    }

    // update ghosts
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i];
      const age = now - g.lifeStart;
      const t = age / g.lifeSpan;
      if (t >= 1) {
        ghosts.splice(i, 1);
        continue;
      }
      // ease radius growth and drift
      g.radius = g.targetRadius * easeOutQuad(Math.min(1, (age / (g.lifeSpan * 0.7))));
      // drift
      g.cx += (g.driftX * (now - (g._last || g.lifeStart))) / 1000;
      g.cy += (g.driftY * (now - (g._last || g.lifeStart))) / 1000;
      g.rotation += 0.003 * ((age % 1000) / 1000);
      g._last = now;
    }

    // cleanup fully-shrunk splashes
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      if (!s.permanent && s.radius <= 0.5 && s.targetRadius <= 0.5) splashes.splice(i, 1);
    }

    // draw veil
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = cfg.veilColor;
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.restore();

    // draw ghosts first
    if (ghosts.length > 0) {
      // draw up to ghost maxConcurrent
      for (let i = 0; i < Math.min(cfg.ghost.maxConcurrent, ghosts.length); i++) {
        drawGhost(ghosts[i]);
      }
    }

    // draw interactive splashes (largest first) limited by maxConcurrentDraw
    if (splashes.length > 0) {
      const copy = splashes.slice().sort((a, b) => b.radius - a.radius);
      const toDraw = copy.slice(0, Math.max(1, Math.min(cfg.maxConcurrentDraw, copy.length)));
      for (let i = 0; i < toDraw.length; i++) drawSplashMask(toDraw[i]);
    }

    raf = requestAnimationFrame(tick);
  }

  // helpers
  function easeOutQuad(t) { return t * (2 - t); }

  // start
  if (cfg.ghost.useOffscreenCache) ensureGhostCache();
  resize();
  raf = requestAnimationFrame(tick);
  window.addEventListener('resize', resize);

  // expose API
  return {
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      const cEl = document.getElementById('ink-veil');
      if (cEl && cEl.parentNode) cEl.parentNode.removeChild(cEl);
      const bEl = document.getElementById('ink-bg');
      if (bEl && bEl.parentNode) bEl.parentNode.removeChild(bEl);
      ghostCacheCanvas = null;
      ghostCacheReady = false;
    },

    resetAll() {
      splashes.length = 0;
      ghosts.length = 0;
      drawFullVeil();
    },

    removeLast() {
      splashes.pop();
    },

    getSplashes() {
      return splashes.slice();
    },

    // allow runtime tuning of optimization settings and ghost toggles
    setOptimization(opts = {}) {
      Object.assign(cfg, opts);
      if (opts.ghost) Object.assign(cfg.ghost, opts.ghost);
      // re-create cache if cacheSize changed
      if (opts.ghost && 'cacheSize' in opts.ghost) {
        ghostCacheReady = false;
        if (cfg.ghost.useOffscreenCache) ensureGhostCache();
      }
    }
  };
}
