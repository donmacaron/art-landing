// src/ghost.js
// Ghost subsystem for ink reveal: exports createGhostSubsystem(cfg)
// The subsystem does NOT create its own RAF — ink.js calls update(now) and draw(ctx)

export function createGhostSubsystem(ghostCfg = {}) {
  // clone config with defaults
  const defaults = {
    enabled: true,
    ratePerSec: 0.6,
    maxConcurrent: 3,
    maxRadius: 120,
    alpha: 0.18,
    drift: 6,
    lifetime: 2200,
    jitter: 0.35,
    cacheSize: 256,
    useOffscreenCache: true
  };
  const cfg = Object.assign({}, defaults, ghostCfg);

  let ghosts = []; // {cx, cy, radius, targetRadius, lifeStart, lifeSpan, driftX, driftY, rotation, _last}
  let cacheCanvas = null;
  let cacheReady = false;
  let lastSpawnTick = performance.now();

  function ensureCache() {
    if (cacheReady || !cfg.useOffscreenCache) return;
    const size = Math.max(64, Math.min(1024, cfg.cacheSize || 256));
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d');

    // compose an irregular soft mask
    const center = size / 2;
    const baseR = size * 0.46;
    const parts = Math.max(4, Math.min(16, Math.floor(6)));
    // simple layout generator
    const layout = [];
    for (let i = 0; i < parts; i++) {
      const angle = (Math.PI * 2 * i) / parts + (Math.random() - 0.5) * 0.6;
      const ox = Math.cos(angle) * baseR * (0.25 + Math.random() * cfg.jitter);
      const oy = Math.sin(angle) * baseR * (0.25 + Math.random() * cfg.jitter);
      const rr = baseR * (0.4 + Math.random() * 0.6);
      layout.push({ ox, oy, rr });
    }

    octx.clearRect(0, 0, size, size);
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
      octx.arc(bx, by, br, 0, Math.PI*2);
      octx.fill();
    }

    // light noise dots
    const noiseCount = Math.max(6, Math.round(size * 0.06));
    octx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < noiseCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.random() * baseR;
      const nx = center + Math.cos(ang) * rr * (0.6 + Math.random() * 0.8);
      const ny = center + Math.sin(ang) * rr * (0.6 + Math.random() * 0.8);
      const nr = Math.random() * Math.max(0.6, size * 0.004);
      octx.beginPath();
      octx.arc(nx, ny, nr, 0, Math.PI*2);
      octx.fill();
    }

    cacheCanvas = off;
    cacheReady = true;
  }

  function spawn(x = null, y = null) {
    if (!cfg.enabled) return null;
    if (ghosts.length >= cfg.maxConcurrent) return null;

    const cx = x === null ? (20 + Math.random() * (window.innerWidth - 40)) : x;
    const cy = y === null ? (20 + Math.random() * (window.innerHeight - 40)) : y;

    const g = {
      cx,
      cy,
      radius: 0,
      targetRadius: (20 + Math.random() * (cfg.maxRadius - 20)),
      lifeStart: performance.now(),
      lifeSpan: cfg.lifetime * (0.8 + Math.random() * 0.8),
      driftX: (Math.random() - 0.5) * cfg.drift,
      driftY: (Math.random() - 0.5) * cfg.drift,
      rotation: Math.random() * Math.PI * 2,
      createdAt: performance.now(),
      _last: performance.now()
    };
    ghosts.push(g);
    return g;
  }

  function maybeSpawn(now) {
    // spawn with Poisson-ish probability
    const dt = Math.max(1, now - (maybeSpawn._last || now));
    maybeSpawn._last = now;
    const prob = (cfg.ratePerSec * dt) / 1000;
    if (Math.random() < prob) spawn();
  }

  function update(now) {
    if (!cfg.enabled) return;
    maybeSpawn(now);

    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i];
      const age = now - g.lifeStart;
      const t = age / g.lifeSpan;
      if (t >= 1) {
        ghosts.splice(i, 1);
        continue;
      }
      g.radius = g.targetRadius * easeOutQuad(Math.min(1, (age / (g.lifeSpan * 0.7))));
      g.cx += (g.driftX * (now - (g._last || g.lifeStart))) / 1000;
      g.cy += (g.driftY * (now - (g._last || g.lifeStart))) / 1000;
      g.rotation += 0.003 * ((age % 1000) / 1000);
      g._last = now;
    }
  }

  function draw(ctx) {
    if (!cfg.enabled) return;
    if (ghosts.length === 0) return;

    if (cfg.useOffscreenCache) ensureCache();

    for (let i = 0, L = Math.min(ghosts.length, cfg.maxConcurrent); i < L; i++) {
      const g = ghosts[i];
      if (!cacheReady) {
        // fallback cheap draw
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.radius, 0, Math.PI*2);
        ctx.fillStyle = `rgba(0,0,0,${cfg.alpha})`;
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }
      const off = cacheCanvas;
      const size = off.width;
      const drawSize = Math.max(4, (g.radius / (cfg.maxRadius || size)) * size * 2);
      const half = drawSize / 2;

      ctx.save();
      ctx.globalAlpha = cfg.alpha;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.translate(g.cx, g.cy);
      ctx.rotate(g.rotation || 0);
      ctx.drawImage(off, -half, -half, drawSize, drawSize);
      ctx.rotate(-(g.rotation || 0));
      ctx.translate(-g.cx, -g.cy);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function easeOutQuad(t) { return t * (2 - t); }

  function reset() { ghosts.length = 0; }

  function destroy() {
    ghosts.length = 0;
    cacheCanvas = null;
    cacheReady = false;
  }

  function setConfig(newCfg = {}) {
    Object.assign(cfg, newCfg);
    // if enabling cache and cache is not ready, prepare it later on next draw/init
    if (cfg.useOffscreenCache && !cacheReady) ensureCache();
  }

  function init() {
    if (cfg.useOffscreenCache) ensureCache();
  }

  return {
    init,
    update,
    draw,
    spawn,
    reset,
    destroy,
    setConfig
  };
}
