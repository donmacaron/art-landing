// src/main.js
import lottie from 'lottie-web';
import './style.css';

import { initInkReveal } from './ink.js';
import { initSound } from './sound.js';

export const LOAD_3D = false; // 3D off for now

/* ===========================
   TRANSITION CONFIG — adjust here
=========================== */
export const TRANSITION_CONFIG = {
  fadeDuration: 600,         // ms
  fadeEasing: 'cubic-bezier(0.22, 0.9, 0.28, 1)', // smoother easing
  imgStartTranslateY: 8,     // px initial vertical offset for image
  imgStartScale: 0.985,      // initial scale for image
  svgEndScale: 1.02,         // slight scale up for outgoing svg
  svgEndBlur: 1.25,          // px blur for outgoing svg
  finalImage: '/main-logo.svg',
  maxWidth: 360
};

/* ===========================
   INK CONFIG — adjust here
=========================== */
export const INK_CONFIG = {
  imageUrl: '/bg_plants.png',
  veilColor: '#E9E6E4',
  activation: 'click',
  holdTime: 600,
  growDuration: 1100,
  lifetime: 2400,
  shrinkDuration: 1600,
  maxRadius: 360,
  minRadius: 120,
  pointCount: 20,
  blobs: 2,
  jitter: 0.45,
  edgeRoughness: 0.26,
  noiseFactor: 0.36,
  maxActiveSplashes: 3,
  maxConcurrentDraw: 3,
  maxNoisePerSplash: 20,
  offscreenDPR: 1,
  smallRadiusSkip: 2.0,
  autoStart: false
};

/* ========== params (shared with scene.js if loaded) ========== */
export const params = {
  modelPath: '/models/plants.glb',
  sceneBg: '#E9E6E4',
  modelColor: '#E9E6E4',
  frustumSize: 2.5,
  cameraStart: { x: 0, y: 0, z: 5 },
  fogColor: '#E9E6E4',
  fogNear: 1,
  fogFar: 12
};

/* ========== UI refs ========== */
const lottieContainerId = 'lottie-container';
const preloaderTitle     = document.getElementById('preloader-title');
const edenLogo           = document.getElementById('eden-logo');
const topBar             = document.getElementById('topbar');
const bottomBar          = document.getElementById('bottombar');
const topLeft            = document.getElementById('top-left');
const topRight           = document.getElementById('top-right');
const soundBtn           = document.getElementById('sound-btn');
const lottieContainer    = document.getElementById(lottieContainerId);

/* ========== Lottie preloader ========== */
const animation = lottie.loadAnimation({
  container: lottieContainer,
  renderer: 'svg',
  loop: false,
  autoplay: true,
  path: '/loader.json'
});

const ink = initInkReveal(Object.assign({}, INK_CONFIG, { autoStart: false }));
window.__ink = ink; // debug

let animationCompleted  = false;
let sceneLoaded         = false;
let sceneModule         = null;
let preloaderFinalized  = false;

animation.addEventListener('complete', () => {
  animationCompleted = true;
  if (!LOAD_3D) {
    finalizePreloader();
    return;
  }
  if (sceneLoaded) finalizePreloader();
});
animation.addEventListener('DOMLoaded', () => { /* no-op */ });

/**
 * Smooth crossfade: Lottie SVG -> static main logo
 * returns Promise that resolves when done
 */
function replaceLottieWithMainLogoSmooth() {
  const cfg = TRANSITION_CONFIG;
  return new Promise((resolve) => {
    if (!lottieContainer) return resolve();

    // Best-effort: stop Lottie on last frame (don't destroy yet)
    try {
      const total = animation.totalFrames ||
        Math.round((animation.getDuration ? animation.getDuration(true) : 1) * 60) || 1;
      if (typeof animation.goToAndStop === 'function') {
        animation.goToAndStop(Math.max(0, total - 1), true);
      } else if (typeof animation.pause === 'function') {
        animation.pause();
      }
    } catch (e) {
      console.warn('Could not stop lottie on last frame:', e);
    }

    // Find existing Lottie SVG (may not exist in some failure cases)
    const lottieSvg = lottieContainer.querySelector('svg');

    // Prepare container for absolute overlay
    const prevPosition = lottieContainer.style.position || '';
    lottieContainer.style.position = 'relative';
    lottieContainer.style.overflow = 'hidden';
    lottieContainer.style.willChange = 'transform, opacity';

    // Measure to avoid layout jump
    const measuredRect = lottieContainer.getBoundingClientRect();
    if (measuredRect.height) lottieContainer.style.height = `${measuredRect.height}px`;

    // Style outgoing SVG for a smooth animated exit
    if (lottieSvg) {
      lottieSvg.style.position = 'absolute';
      lottieSvg.style.left = '0';
      lottieSvg.style.top = '0';
      lottieSvg.style.width = '100%';
      lottieSvg.style.height = '100%';
      lottieSvg.style.transition =
        `opacity ${cfg.fadeDuration}ms ${cfg.fadeEasing}, transform ${cfg.fadeDuration}ms ${cfg.fadeEasing}, filter ${cfg.fadeDuration}ms ${cfg.fadeEasing}`;
      lottieSvg.style.transformOrigin = '50% 50%';
      lottieSvg.style.opacity = lottieSvg.style.opacity || '1';
      lottieSvg.style.filter = 'none';
      lottieSvg.style.pointerEvents = 'none';
      lottieSvg.style.willChange = 'opacity, transform, filter';
    }

    // Create final image element (but don't start fade until loaded)
    const img = new Image();
    img.src = cfg.finalImage;
    img.alt = 'Main logo';
    img.id = 'main-logo';
    img.style.position = 'absolute';
    img.style.left = '50%';
    img.style.top = '50%';
    img.style.transform = `translate(-50%, -50%) translateY(${cfg.imgStartTranslateY}px) scale(${cfg.imgStartScale})`;
    img.style.transition =
      `opacity ${cfg.fadeDuration}ms ${cfg.fadeEasing}, transform ${cfg.fadeDuration}ms ${cfg.fadeEasing}`;
    img.style.opacity = '0';
    img.style.maxWidth = `${cfg.maxWidth}px`;
    img.style.width = '100%';
    img.style.height = 'auto';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    img.style.pointerEvents = 'none';
    img.style.willChange = 'opacity, transform';

    // Append image hidden; start crossfade only after image loaded OR after a short fallback
    let started = false;
    const startCrossfade = () => {
      if (started) return;
      started = true;

      // ensure appended
      if (!img.parentNode) lottieContainer.appendChild(img);

      // force reflow
      // eslint-disable-next-line no-unused-expressions
      img.offsetHeight;

      // animate: in the image, out the svg
      requestAnimationFrame(() => {
        img.style.opacity = '1';
        img.style.transform = 'translate(-50%, -50%) translateY(0) scale(1)';
        if (lottieSvg) {
          lottieSvg.style.opacity = '0';
          lottieSvg.style.transform = `scale(${cfg.svgEndScale})`;
          lottieSvg.style.filter = `blur(${cfg.svgEndBlur}px)`;
        }
      });

      // clean up on transition end of image (fallback with timeout)
      const clean = () => {
        // remove svg element if still present
        if (lottieSvg && lottieSvg.parentNode === lottieContainer) {
          lottieSvg.remove();
        }
        // destroy animation instance now
        try { animation.destroy(); } catch (e) { /* ignore */ }

        // restore container sizing/styles
        lottieContainer.style.position = prevPosition;
        lottieContainer.style.height = '';
        lottieContainer.style.overflow = '';
        lottieContainer.style.willChange = '';

        // remove event listeners
        img.removeEventListener('transitionend', onTransitionEnd);
        setTimeout(() => resolve(img), 20);
      };

      const onTransitionEnd = (ev) => {
        if (ev.target === img && (ev.propertyName === 'opacity' || ev.propertyName === 'transform')) {
          clean();
        }
      };

      img.addEventListener('transitionend', onTransitionEnd, { passive: true });

      // safety fallback: if transitionend doesn't fire (older browsers), fallback after duration + small buffer
      setTimeout(() => {
        clean();
      }, cfg.fadeDuration + 80);
    };

    // append image now but only animate after load
    lottieContainer.appendChild(img);

    if (img.complete && img.naturalWidth) {
      // already loaded
      startCrossfade();
    } else {
      // wait for load, but also guard with timeout fallback
      let done = false;
      const onload = () => { if (!done) { done = true; startCrossfade(); } };
      img.addEventListener('load', onload, { once: true });
      setTimeout(() => { if (!done) { done = true; startCrossfade(); } }, 800);
    }
  });
}

function finalizePreloader() {
  if (preloaderFinalized) return;
  preloaderFinalized = true;

  // crossfade and wait for completion (not strictly necessary to await for UI but safer)
  replaceLottieWithMainLogoSmooth().catch((e) => {
    console.warn('replaceLottieWithMainLogoSmooth failed:', e);
  });

  // start ink
  try {
    if (ink && typeof ink.start === 'function') {
      ink.start();
    }
  } catch (e) {
    console.warn('ink.start() failed:', e);
  }

  // reveal top bar and corners with small stagger
  if (topBar) topBar.classList.add('visible');
  setTimeout(() => {
    topLeft?.classList.add('visible');
    topRight?.classList.add('visible');
  }, 60);

  // reveal brand (title width matching eden logo)
  function revealBrand() {
    if (!preloaderTitle) return;
    if (edenLogo) {
      const apply = () => {
        const rect = edenLogo.getBoundingClientRect();
        const w = Math.max(32, Math.round(rect.width || edenLogo.naturalWidth || 200));
        preloaderTitle.style.width = w + 'px';
        preloaderTitle.classList.add('visible');
        edenLogo.classList.add('visible');
      };
      if (edenLogo.complete && (edenLogo.naturalWidth || edenLogo.width)) {
        apply();
      } else {
        let applied = false;
        const onload = () => { if (!applied) { applied = true; apply(); } };
        edenLogo.addEventListener('load', onload, { once: true });
        setTimeout(() => {
          if (!applied) { applied = true; apply(); }
        }, 300);
      }
    } else {
      preloaderTitle.classList.add('visible');
    }
  }
  revealBrand();

  // show bottom bar after a small delay
  setTimeout(() => {
    if (bottomBar) bottomBar.classList.add('visible');
  }, 220);
}

/* ========== Scene loader guard (unchanged) ========== */
async function startSceneIfNeeded() {
  if (!LOAD_3D) {
    sceneLoaded = true;
    return;
  }
  try {
    sceneModule = await import('./scene.js');
    await sceneModule.initScene(params);
    sceneLoaded = true;
    if (animationCompleted) finalizePreloader();
  } catch (err) {
    console.error('Error initializing scene module:', err);
    sceneLoaded = true;
    setTimeout(() => { if (animationCompleted) finalizePreloader(); }, 300);
  }
}
startSceneIfNeeded();

// initialize sound system and bind to button (if present)
const sound = initSound({ button: soundBtn });
window.__sound = sound;

/* expose for debug */
export { ink, sound };
