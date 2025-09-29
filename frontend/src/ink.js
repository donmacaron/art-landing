// src/ink.js
// Optimized ink veil with smoother time-based animation and organic splash shapes.
// Exports initInkReveal(options) -> API { destroy(), resetAll(), removeLast(), getSplashes(), setOptimization() }

export function initInkReveal(options = {}) {
  const defaults = {
    imageUrl: '/bg_plants.png',
    veilColor: '#E9E6E4',
    activation: 'click', // 'click' | 'hold'
    holdTime: 600,

    // animation timing (ms)
    growDuration: 2500,    // ms to grow from 0 -> final radius
    lifetime: 1200,       // ms to stay at final radius before shrinking
    shrinkDuration: 2800,  // ms to shrink final radius -> 0

    // radius
    maxRadius: 360,       // logical px maximum
    minRadius: 100,        // minimum final radius

    // shape / appearance
    pointCount: 28,       // points around circle to create shape
    blobs: 2,             // number of inner sub-blobs to add
    jitter: 0.55,         // irregularity amount for sub-blobs
    edgeRoughness: 0.2,  // 0..1 how spiky/irregular the main silhouette is
    noiseFactor: 0.36,    // noise holes intensity

    // performance
    maxActiveSplashes: 2,
    maxConcurrentDraw: 3,
    maxNoisePerSplash: 16,
    blurInMask: true,     // apply blur inside offscreen mask
    offscreenDPR: 1.0,    // 1 or devicePixelRatio (quality vs cost)

    // misc
    smallRadiusSkip: 1.0
  };

  const cfg = Object.assign({}, defaults, options || {});
  cfg.pointCount = Math.max(8, Math.min(64, cfg.pointCount));
  cfg.blobs = Math.max(0, cfg.blobs);
  cfg.maxActiveSplashes = Math.max(1, Math.floor(cfg.maxActiveSplashes));
  cfg.maxConcurrentDraw = Math.max(1, Math.floor(cfg.maxConcurrentDraw));

  // ---- DOM ----
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

  // ---- state ----
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let lastMoveTime = performance.now();
  let pointerWasDown = false;
  let pointerMoveDuringDown = 0;
  const splashes = []; // each: { cx,cy,phase,startTime,duration,startR,endR,radius,permanent,offcanvas,maskSize,createdAt }

  // ---- helpers: shape generation ----
  // returns array of points [ {x,y} ] around center at radius baseR (unscaled)
  function generateIrregularRing(baseR, pointCount, roughness) {
    const pts = [];
    const phase = Math.random() * Math.PI * 2;
    for (let i = 0; i < pointCount; i++) {
      const a = (i / pointCount) * Math.PI * 2;
      // combine several noise sources for organic shape
      const noise = 0.4 * (0.5 + Math.sin(a * (2 + Math.random() * 3) + phase) * 0.5)
                  + 0.6 * (0.5 + (Math.random() - 0.5));
      const r = baseR * (0.6 + roughness * noise);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      pts.push({ x, y });
    }
    return pts;
  }

  // convert ring points into smooth path on given context centered at cx,cy
  function drawSmoothPathToContext(octx, cx, cy, pts) {
    if (!pts || pts.length === 0) return;
    // move to first
    octx.beginPath();
    const first = pts[0];
    octx.moveTo(cx + first.x, cy + first.y);
    // use quadratic curves between points for smoothing
    for (let i = 1; i <= pts.length; i++) {
      const cur = pts[i % pts.length];
      const prev = pts[(i - 1) % pts.length];
      const midx = (prev.x + cur.x) / 2;
      const midy = (prev.y + cur.y) / 2;
      octx.quadraticCurveTo(cx + prev.x, cy + prev.y, cx + midx, cy + midy);
    }
    octx.closePath();
    octx.fill();
  }

  // create offscreen mask canvas for a splash (baseRadius = final radius)
  function createMaskCanvas(baseRadius, pointCount, blobs, jitter, roughness) {
    const offscreenDPR = Math.max(1, cfg.offscreenDPR || 1);
    // size in CSS px
    const size = Math.ceil(baseRadius * 2 + 8); // little padding
    const w = Math.max(8, Math.floor(size * offscreenDPR));
    const h = w;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d');

    // center
    const cx = w / 2;
    const cy = h / 2;
    octx.clearRect(0, 0, w, h);

    // draw main blot: white inner -> transparent outer by drawing filled path and optionally blurring later
    octx.save();
    octx.fillStyle = 'rgba(255,255,255,1)';
    const pts = generateIrregularRing(baseRadius, pointCount, roughness);
    // scale coords to offscreen DPR/size: pts are in px relative to baseRadius
    // convert pts (which use baseRadius) to off-canvas units
    // we used baseRadius in px, and size ~ baseRadius*2. We'll assume proportional mapping:
    const scale = (w / size);
    // compose scaled points
    const scaled = pts.map(p => ({ x: p.x * scale, y: p.y * scale }));
    // draw path
    drawSmoothPathToContext(octx, cx, cy, scaled);

    // draw a few inner blobs to produce petals/holes
    for (let b = 0; b < blobs; b++) {
      const br = baseRadius * (0.15 + Math.random() * 0.35) * scale;
      const ang = Math.random() * Math.PI * 2;
      const offx = Math.cos(ang) * baseRadius * (0.15 + Math.random() * jitter) * scale;
      const offy = Math.sin(ang) * baseRadius * (0.15 + Math.random() * jitter) * scale;
      const g = octx.createRadialGradient(cx + offx, cy + offy, Math.max(1, br * 0.12), cx + offx, cy + offy, br);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      octx.fillStyle = g;
      octx.beginPath();
      octx.arc(cx + offx, cy + offy, br, 0, Math.PI * 2);
      octx.fill();
    }

    // small noise dots inside blot to make texture
    const noiseCount = Math.max(4, Math.min(cfg.maxNoisePerSplash, Math.round((w / 100) * 6)));
    octx.fillStyle = 'rgba(255,255,255,0.65)';
    for (let n = 0; n < noiseCount; n++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.random() * (w / 2 * 0.85);
      const nx = cx + Math.cos(ang) * rr * (0.3 + Math.random() * 0.9);
      const ny = cy + Math.sin(ang) * rr * (0.3 + Math.random() * 0.9);
      const nr = Math.random() * Math.max(0.6, w * 0.005);
      octx.beginPath();
      octx.arc(nx, ny, nr, 0, Math.PI * 2);
      octx.fill();
    }

    octx.restore();

    // optional cheap blur inside offscreen canvas (smoothing edges)
    if (cfg.blurInMask && typeof octx.filter !== 'undefined') {
      try {
        // apply small blur via filter: copy to tmp, apply filter when drawing back
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tctx = tmp.getContext('2d');
        tctx.clearRect(0, 0, w, h);
        tctx.drawImage(off, 0, 0);
        octx.clearRect(0, 0, w, h);
        octx.filter = `blur(${Math.max(1, Math.round(w / 200))}px)`;
        octx.drawImage(tmp, 0, 0);
        octx.filter = 'none';
      } catch (e) {
        // ignore
        octx.filter = 'none';
      }
    }

    // returned mask: white->transparent image sized w x h, logical size = size (px)
    return { canvas: off, maskSize: size };
  }

  // create splash with time-based animation params
  function spawnSplash(cx, cy) {
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
        // accelerate removal of oldest by starting shrink immediately
        const s = splashes[foundIdx];
        s.phase = 'shrinking';
        s.startTime = performance.now();
        s.startR = s.radius;
        s.endR = 0;
        s.duration = cfg.shrinkDuration;
      } else {
        // all permanent, drop oldest
        const removed = splashes.shift();
        if (removed && removed.offcanvas) {
          // let GC handle offcanvas
        }
      }
    }

    const finalR = Math.max(cfg.minRadius, Math.min(cfg.maxRadius, Math.round(cfg.minRadius + Math.random() * (cfg.maxRadius - cfg.minRadius))));
    const parts = cfg.pointCount;
    const mask = createMaskCanvas(finalR, parts, cfg.blobs, cfg.jitter, cfg.edgeRoughness);

    const now = performance.now();
    const s = {
      cx,
      cy,
      phase: 'growing', // growing -> steady -> shrinking
      startTime: now,
      duration: cfg.growDuration,
      startR: 0,
      endR: finalR,
      radius: 0,
      permanent: false,
      createdAt: now,
      offcanvas: mask.canvas,
      maskSize: mask.maskSize
    };
    splashes.push(s);
    return s;
  }

  // pointer handling
  const MOVED_THRESH = 8;
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
  function onPointerDown() {
    pointerWasDown = true;
    pointerMoveDuringDown = 0;
  }
  function onPointerUp() {
    pointerWasDown = false;
    const moved = pointerMoveDuringDown || 0;
    if (cfg.activation === 'click') {
      if (moved <= MOVED_THRESH) spawnSplash(lastPointer.x, lastPointer.y);
    }
    pointerMoveDuringDown = 0;
  }
  window.addEventListener('mousemove', onPointerMove, { passive: true });
  window.addEventListener('touchmove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);

  // choose top N splashes by current radius (cheap selection)
  function pickTopN(array, N) {
    if (array.length <= N) return array.slice();
    const res = [];
    for (let i = 0; i < array.length; i++) {
      const s = array[i];
      let j = 0;
      while (j < res.length && res[j].radius >= s.radius) j++;
      if (j < N) {
        res.splice(j, 0, s);
        if (res.length > N) res.pop();
      }
    }
    return res;
  }

  // easing
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; }

  // main loop
  let raf = null;
  function tick() {
    const now = performance.now();

    // hold activation
    if (cfg.activation === 'hold') {
      const idle = now - lastMoveTime;
      if (idle >= cfg.holdTime) {
        const recently = splashes.length > 0 && (now - splashes[splashes.length - 1].createdAt < 250);
        if (!recently) spawnSplash(lastPointer.x, lastPointer.y);
        lastMoveTime = now + 80;
      }
    }

    // update splashes (phase/time-based)
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      const elapsed = Math.max(0, now - s.startTime);
      const t = s.duration > 0 ? Math.min(1, elapsed / s.duration) : 1;

      if (s.phase === 'growing') {
        s.radius = s.endR * easeOutCubic(t);
        if (t >= 1) {
          s.phase = 'steady';
          s.steadyStart = now;
          s.radius = s.endR;
          s.startTime = now;
          s.duration = cfg.lifetime;
        }
      } else if (s.phase === 'steady') {
        // hold at final radius until lifetime passes
        if (now - s.steadyStart >= cfg.lifetime) {
          s.phase = 'shrinking';
          s.startTime = now;
          s.startR = s.radius;
          s.endR = 0;
          s.duration = cfg.shrinkDuration;
        }
      } else if (s.phase === 'shrinking') {
        const tt = s.duration > 0 ? Math.min(1, elapsed / s.duration) : 1;
        s.radius = s.startR * (1 - easeOutCubic(tt));
        if (tt >= 1) {
          // remove
          if (s.offcanvas) {
            // dereference for GC
            s.offcanvas = null;
          }
          splashes.splice(i, 1);
        }
      }
    }

    // draw veil base
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = cfg.veilColor;
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.restore();

    // draw top splashes (fast drawImage)
    if (splashes.length > 0) {
      const toDraw = pickTopN(splashes, Math.max(1, Math.min(cfg.maxConcurrentDraw, splashes.length)));
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < toDraw.length; i++) {
        const s = toDraw[i];
        if (!s.offcanvas) {
          // fallback: simple circle (cheap)
          ctx.beginPath();
          ctx.arc(s.cx, s.cy, Math.max(1, s.radius), 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const drawSize = Math.max(2, s.radius * 2);
        const half = drawSize / 2;
        try {
          ctx.drawImage(s.offcanvas, s.cx - half, s.cy - half, drawSize, drawSize);
        } catch (e) {
          // fallback to circle
          ctx.beginPath();
          ctx.arc(s.cx, s.cy, Math.max(1, s.radius), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    raf = requestAnimationFrame(tick);
  }

  // start
  resize();
  raf = requestAnimationFrame(tick);
  window.addEventListener('resize', resize);

  // API
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
      splashes.length = 0;
    },

    resetAll() {
      splashes.length = 0;
      drawFullVeil();
    },

    removeLast() { splashes.pop(); },

    getSplashes() { return splashes.slice(); },

    setOptimization(opts = {}) {
      Object.assign(cfg, opts || {});
      cfg.pointCount = Math.max(8, Math.min(64, cfg.pointCount));
      cfg.blobs = Math.max(0, cfg.blobs);
      cfg.maxActiveSplashes = Math.max(1, Math.floor(cfg.maxActiveSplashes));
      cfg.maxConcurrentDraw = Math.max(1, Math.floor(cfg.maxConcurrentDraw));
    },

    // spawn programmatically
    spawnAt(x, y) { return spawnSplash(x, y); }
  };
}
