// src/ink.js
// Move-driven brush-like veil reveal with improved idle strokes:
// - faster, non-blinking idle growth
// - seed grows smoothly while stroke paints
// - auto-shrink after painting completes
// Exports initInkReveal(options) -> { start, stop, destroy, resetAll, spawnAt, setOptimization, getStrokes }

export function initInkReveal(options = {}) {
  const defaults = {
    imageUrl: '/bg_plants.png',
    veilColor: '#E9E6E4',

    // pointer sampling
    sampleInterval: 24,
    minMove: 3,

    // brush appearance
    brushWidth: 190,
    brushSoftness: 18,
    brushJitter: 0.12,
    smoothing: 0.5,

    // width shaping
    widthNoise: 0.25,
    widthTaperTail: 0.65,
    widthTaperHead: 0.25,
    velocityInfluence: 0.35,

    // stroke lifetime (fallback for user strokes)
    strokeLifetime: 1600,
    strokeFade: 1200,

    // performance
    maxStrokes: 3,
    maxDrawPerFrame: 3,

    // idle behaviour (sane defaults)
    idleEnabled: true,
    idleTimeout: 2200,        // ms of inactivity before scheduling idle set
    idleSpacing: 2400,        // ms between idle sets
    idleMaxStrokes: 2,
    idleCurvePoints: 9,
    idleCurveLength: 1800,     // pixels — shorter = faster painting
    idleCurvature: 0.4,
    idleNoise: 0.08,
    idleGrowthInterval: 300,  // ms between appended points while painting
    idleStaggerMin: 390,
    idleStaggerMax: 720,
    idleBrushWidthMin: 140,
    idleBrushWidthMax: 840,
    idleSeedGrowMin: 3440,     // ms seed growth (how quickly the dot grows)
    idleSeedGrowMax: 5920,
    idleAvoidRadius: 140,
    idleMinSeedDistance: 1020,
    idleShrinkDuration: 4400, // ms to smoothly shrink after painting completes
    autoStart: false
  };

  const cfg = Object.assign({}, defaults, options || {});

  // sanitize
  cfg.sampleInterval     = Math.max(8, cfg.sampleInterval | 0);
  cfg.minMove            = Math.max(1, cfg.minMove | 0);
  cfg.brushWidth         = Math.max(1, cfg.brushWidth);
  cfg.brushSoftness      = Math.max(0, cfg.brushSoftness);
  cfg.maxStrokes         = Math.max(1, Math.floor(cfg.maxStrokes));
  cfg.strokeLifetime     = Math.max(0, cfg.strokeLifetime);
  cfg.strokeFade         = Math.max(0, cfg.strokeFade);

  cfg.idleEnabled        = !!cfg.idleEnabled;
  cfg.idleTimeout        = Math.max(100, cfg.idleTimeout | 0);
  cfg.idleSpacing        = Math.max(200, cfg.idleSpacing | 0);
  cfg.idleMaxStrokes     = Math.max(1, Math.floor(cfg.idleMaxStrokes));
  cfg.idleCurvePoints    = Math.max(3, Math.floor(cfg.idleCurvePoints));
  cfg.idleGrowthInterval = Math.max(8, cfg.idleGrowthInterval | 0);
  cfg.idleCurveLength    = Math.max(8, cfg.idleCurveLength);
  cfg.idleSeedGrowMin    = Math.max(20, cfg.idleSeedGrowMin | 0);
  cfg.idleSeedGrowMax    = Math.max(cfg.idleSeedGrowMin, cfg.idleSeedGrowMax | 0);
  cfg.idleMinSeedDistance= Math.max(8, cfg.idleMinSeedDistance | 0);
  cfg.idleShrinkDuration = Math.max(50, cfg.idleShrinkDuration | 0);

  // ---- DOM setup ----
  let bg = document.getElementById('ink-bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.id = 'ink-bg';
    document.body.insertBefore(bg, document.body.firstChild);
  }
  bg.style.cssText = [
    'background-position:center',
    'background-size:cover',
    'pointer-events:none',
    'z-index:0'
  ].join(';');
  bg.style.backgroundImage = cfg.imageUrl ? `url('${cfg.imageUrl}')` : '';

  let canvas = document.getElementById('ink-veil');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'ink-veil';
    document.body.appendChild(canvas);
  }
  canvas.style.cssText = [
    'position:fixed',
    'inset:0',
    'pointer-events:none',
    'z-index:30'
  ].join(';');
  const ctx = canvas.getContext('2d', { alpha: true });

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width  = Math.floor(window.innerWidth  * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width  = window.innerWidth  + 'px';
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

  // ---- state & helpers ----
  const strokes = [];
  const idleGenerators = [];
  let running = false;
  let raf = null;

  let lastSampleTime = 0;
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let lastAddedPos = { ...lastPointer };
  let lastMovementTime = now();
  let lastIdleSetTime = 0;

  let strokeIdCounter = 1;
  function now() { return performance.now(); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothPoint(prev, cur, s) {
    if (!prev) return { ...cur };
    return { x: lerp(prev.x, cur.x, 1 - s), y: lerp(prev.y, cur.y, 1 - s) };
  }
  function smoothstep01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function alphaForAge(age) {
    if (age <= cfg.strokeLifetime) return 1;
    if (age >= cfg.strokeLifetime + cfg.strokeFade) return 0;
    return 1 - smoothstep01((age - cfg.strokeLifetime) / cfg.strokeFade);
  }

  function widthForSegment(s, p0, p1, age1, dt, shrinkScale = 1) {
    const base = Math.max(1, s.baseWidth || s.width || cfg.brushWidth);
    const total = cfg.strokeLifetime + cfg.strokeFade;
    const ageN = Math.min(1, age1 / total);
    const tailF = 1 - cfg.widthTaperTail * ageN;
    const headF = 1 + cfg.widthTaperHead * (1 - ageN);

    const d = dist(p0, p1);
    const speed = dt > 0 ? d / dt : 0;
    const thin = Math.min(0.6, speed * 0.02);
    const velF = 1 - thin * cfg.velocityInfluence;

    const noiseF = 1 + cfg.widthNoise * (p1.n || 0);

    return Math.max(1, base * tailF * headF * velF * noiseF * shrinkScale);
  }

  // ---- stroke creation / appending ----
  function createStroke(x, y, isIdle = false, overrideWidth = null) {
    if (strokes.length >= cfg.maxStrokes) {
      strokes.sort((a, b) => a.created - b.created);
      strokes.shift();
    }
    const t0 = now();
    const jitter = (Math.random() - 0.5) * cfg.brushJitter;
    const w = overrideWidth != null ? overrideWidth : cfg.brushWidth * (1 + jitter);

    const s = {
      id: strokeIdCounter++,
      points: [{ x, y, t: t0, n: (Math.random() * 2 - 1) }],
      created: t0,
      baseWidth: w,
      lastSmoothedPoint: { x, y },
      isIdle: !!isIdle,
      // idle grow/shrink meta (may be undefined for user strokes)
      growStart: 0,
      growDuration: 0,
      autoShrink: false,
      shrinkStart: 0,
      shrinkDuration: 0
    };
    strokes.push(s);
    if (!isIdle) lastAddedPos = { x, y };
    return s;
  }

  function appendToStroke(x, y) {
    let s = strokes[strokes.length - 1];
    if (!s || s.isIdle) s = createStroke(x, y, false, null);
    const sp = smoothPoint(s.lastSmoothedPoint, { x, y }, cfg.smoothing);
    s.lastSmoothedPoint = sp;
    s.points.push({ x: sp.x, y: sp.y, t: now(), n: (Math.random() * 2 - 1) });
    return s;
  }

  // ---- pointer handling ----
  function onPointerMove(e) {
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? lastPointer.x;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? lastPointer.y;
    lastPointer = { x, y };
    lastMovementTime = now();
    if (idleGenerators.length) idleGenerators.length = 0;
  }

  // ---- idle utilities ----
  function generateIdleCurvePoints(x0, y0, angle, length, nPoints, curvature) {
    const pts = [{ x: x0, y: y0 }];
    let heading = angle;
    let px = x0, py = y0;
    const step = length / Math.max(1, nPoints - 1);

    for (let i = 1; i < nPoints; i++) {
      const curF = curvature * (1 - i / nPoints);
      heading += (Math.random() * 2 - 1) * cfg.idleNoise + curF * (Math.random() < 0.5 ? -1 : 1);
      px += Math.cos(heading) * step;
      py += Math.sin(heading) * step;
      pts.push({ x: px, y: py });
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < pts.length - 1; i++) {
        pts[i].x = (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3;
        pts[i].y = (pts[i - 1].y + pts[i].y + pts[i + 1].y) / 3;
      }
    }
    return pts;
  }

  function scheduleIdleCurves() {
    const t0 = now();
    if (!cfg.idleEnabled) return;
    if (t0 - lastIdleSetTime < cfg.idleSpacing) return;
    if (t0 - lastMovementTime < 60) return;

    lastIdleSetTime = t0;
    idleGenerators.length = 0;

    const w = window.innerWidth, h = window.innerHeight;
    const seeds = [];
    let attempts = 0;
    while (seeds.length < cfg.idleMaxStrokes && attempts < cfg.idleMaxStrokes * 8) {
      attempts++;
      const margin = 0.08;
      const sx = Math.round(w * (margin + Math.random() * (1 - margin * 2)));
      const sy = Math.round(h * (margin + Math.random() * (1 - margin * 2)));
      const cand = { x: sx, y: sy };

      if (dist(cand, lastPointer) < cfg.idleAvoidRadius) continue;
      if (dist(cand, lastAddedPos) < cfg.idleAvoidRadius) continue;

      let tooClose = false;
      for (let s of seeds) { if (dist(s, cand) < cfg.idleMinSeedDistance) { tooClose = true; break; } }
      if (tooClose) continue;

      seeds.push(cand);
    }

    if (seeds.length === 0) return;

    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const angle = Math.random() * Math.PI * 2;
      const length = cfg.idleCurveLength * (0.7 + Math.random() * 0.6);
      const pts = generateIdleCurvePoints(seed.x, seed.y, angle, length, cfg.idleCurvePoints, cfg.idleCurvature);

      const brushWidth = cfg.idleBrushWidthMin + Math.random() * (cfg.idleBrushWidthMax - cfg.idleBrushWidthMin);
      const seedGrow = cfg.idleSeedGrowMin + Math.random() * (cfg.idleSeedGrowMax - cfg.idleSeedGrowMin);
      const startAt = now() + ((i === 0) ? 0 : (cfg.idleStaggerMin + Math.random() * (cfg.idleStaggerMax - cfg.idleStaggerMin)));
      const growthInterval = Math.max(16, cfg.idleGrowthInterval * (0.8 + Math.random() * 0.6));

      idleGenerators.push({
        points: pts,
        brushWidth,
        startAt,
        seedGrow,
        growthInterval,
        nextIndex: 0,
        lastGrow: 0,
        strokeRef: null
      });
    }
  }

  function stepIdleGenerators(t) {
    for (let i = idleGenerators.length - 1; i >= 0; i--) {
      const gen = idleGenerators[i];
      if (t < gen.startAt) continue;

      if (!gen.strokeRef) {
        const seed = gen.points[0];
        const seedSmall = Math.max(1, Math.round(gen.brushWidth * 0.06));
        const s = createStroke(seed.x, seed.y, true, seedSmall);
        // attach growth meta on stroke:
        s.growStart = t;
        s.growDuration = gen.seedGrow;
        s.baseWidth = seedSmall; // will be lerped each frame
        gen.strokeRef = s;
        gen.nextIndex = 1;
        gen.lastGrow = t;
        continue;
      }

      const s = gen.strokeRef;

      // compute seed progress and update baseWidth (so drawing uses correct base)
      const seedElapsed = t - s.growStart;
      const seedProgress = Math.min(1, seedElapsed / Math.max(1, gen.seedGrow));
      const eased = smoothstep01(seedProgress);
      const seedSmall = Math.max(1, Math.round(gen.brushWidth * 0.06));
      s.baseWidth = lerp(seedSmall, gen.brushWidth, eased);

      // append points while growing (or after)
      if (gen.nextIndex < gen.points.length && (t - gen.lastGrow) >= gen.growthInterval) {
        const pt = gen.points[gen.nextIndex++];
        const sp = smoothPoint(s.lastSmoothedPoint, pt, cfg.smoothing);
        s.lastSmoothedPoint = sp;
        s.points.push({ x: sp.x, y: sp.y, t: t, n: (Math.random() * 2 - 1) });
        gen.lastGrow = t;
      }

      // finished: all points appended AND seed fully grown -> start autoShrink
      if (gen.nextIndex >= gen.points.length && seedProgress >= 1) {
        s.autoShrink = true;
        s.shrinkStart = t;
        s.shrinkDuration = cfg.idleShrinkDuration;
        idleGenerators.splice(i, 1);
        continue;
      }
    }
  }

  // ---- drawing ----
  function drawStrokeDirectional(s, tNow) {
    if (!s || s.points.length < 1) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.filter = (cfg.brushSoftness > 0 && ctx.filter !== undefined)
      ? `blur(${cfg.brushSoftness}px)` : 'none';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pts = s.points;

    // shrink scale & alpha (if auto-shrinking)
    let shrinkScale = 1;
    let shrinkAlpha = 1;
    if (s.autoShrink) {
      const elapsed = tNow - (s.shrinkStart || 0);
      const p = Math.max(0, Math.min(1, elapsed / Math.max(1, s.shrinkDuration || cfg.idleShrinkDuration)));
      const e = 1 - smoothstep01(p);
      shrinkScale = e;
      shrinkAlpha = e;
    }

    // growth progress (while seed is growing), clamp alpha to this to avoid pop
    let growProgress = 1;
    if (s.growDuration && !s.autoShrink) {
      growProgress = Math.max(0, Math.min(1, (tNow - (s.growStart || 0)) / s.growDuration));
    }
    const growAlpha = growProgress;

    if (pts.length === 1) {
      const age = tNow - pts[0].t;
      const a = alphaForAge(age) * shrinkAlpha * growAlpha;
      if (a > 0) {
        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(1, (s.baseWidth || cfg.brushWidth) * shrinkScale);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[0].x + 0.01, pts[0].y + 0.01);
        ctx.stroke();
      }
    } else {
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        const age = tNow - p1.t;
        const a = alphaForAge(age) * shrinkAlpha * growAlpha;
        if (a <= 0) continue;

        const dt = Math.max(0.0001, p1.t - p0.t);
        const lw = widthForSegment(s, p0, p1, age, dt, shrinkScale);
        ctx.globalAlpha = a;
        ctx.lineWidth = lw;

        const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
        ctx.stroke();
      }
    }

    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- main loop ----
  function tick() {
    const t = now();

    // user drawing
    if (t - lastSampleTime >= cfg.sampleInterval) {
      const p = lastPointer;
      if (dist(p, lastAddedPos) >= cfg.minMove) {
        appendToStroke(p.x, p.y);
        lastAddedPos = { ...p };
        lastSampleTime = t;
        lastMovementTime = t;
        if (idleGenerators.length) idleGenerators.length = 0;
      }
    }

    // schedule idle set if idle long enough
    if (cfg.idleEnabled && idleGenerators.length === 0 && (t - lastMovementTime) >= cfg.idleTimeout) {
      scheduleIdleCurves();
    }

    // advance idle generators
    if (idleGenerators.length) stepIdleGenerators(t);

    // prune strokes: remove fully-shrunk idle strokes and expired user strokes
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (s.autoShrink) {
        const elapsed = t - (s.shrinkStart || 0);
        if (elapsed >= (s.shrinkDuration || cfg.idleShrinkDuration)) {
          strokes.splice(i, 1);
          continue;
        }
      }

      const newest = s.points[s.points.length - 1];
      if (newest && (t - newest.t >= cfg.strokeLifetime + cfg.strokeFade) && !s.isIdle) {
        strokes.splice(i, 1);
      } else {
        const limit = Math.ceil((cfg.strokeLifetime + cfg.strokeFade) / cfg.sampleInterval) + 24;
        if (s.points.length > limit) s.points.splice(0, s.points.length - limit);
      }
    }

    // redraw
    drawFullVeil();
    if (strokes.length) {
      const drawList = strokes
        .slice()
        .sort((a, b) => b.created - a.created)
        .slice(0, Math.max(1, Math.min(cfg.maxDrawPerFrame, strokes.length)));
      for (let i = 0; i < drawList.length; i++) {
        drawStrokeDirectional(drawList[i], t);
      }
    }

    if (running) raf = requestAnimationFrame(tick);
  }

  // ---- public API ----
  function start() {
    if (running) return;
    running = true;
    window.addEventListener('mousemove', onPointerMove, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('resize', resize);
    resize();
    lastSampleTime = 0;
    lastAddedPos = { ...lastPointer };
    lastMovementTime = now();
    lastIdleSetTime = 0;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!running) return;
    running = false;
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('touchmove', onPointerMove);
    window.removeEventListener('resize', resize);
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    idleGenerators.length = 0;
  }

  function spawnAt(x, y) {
    return createStroke(x, y, false, null);
  }

  function resetAll() {
    strokes.length = 0;
    idleGenerators.length = 0;
    drawFullVeil();
  }

  function destroy() {
    stop();
    document.getElementById('ink-veil')?.remove();
    document.getElementById('ink-bg')?.remove();
    strokes.length = 0;
  }

  function setOptimization(opts = {}) {
    Object.assign(cfg, opts || {});
    // re-sanitize a few values
    cfg.sampleInterval     = Math.max(8, cfg.sampleInterval | 0);
    cfg.minMove            = Math.max(1, cfg.minMove | 0);
    cfg.brushWidth         = Math.max(1, cfg.brushWidth);
    cfg.brushSoftness      = Math.max(0, cfg.brushSoftness);
    cfg.maxStrokes         = Math.max(1, Math.floor(cfg.maxStrokes));
    cfg.strokeLifetime     = Math.max(0, cfg.strokeLifetime);
    cfg.strokeFade         = Math.max(0, cfg.strokeFade);
  }

  function getStrokes() { return strokes.slice(); }

  // init
  resize();
  if (cfg.autoStart) start();

  return { start, stop, destroy, resetAll, spawnAt, setOptimization, getStrokes };
}
