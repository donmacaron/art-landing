// src/main.js
import lottie from 'lottie-web';
import './style.css';

import { initInkReveal } from './ink.js';
import { initSound } from './sound.js';

export const LOAD_3D = false; // 3D off for now

/* ===========================
   INK CONFIG — adjust here
   ===========================
*/
export const INK_CONFIG = {
  imageUrl: '/bg_plants.png',
  veilColor: '#E9E6E4',
  activation: 'click',    // 'hold' or 'click'
  holdTime: 600,
  // animation timing (ms)
  growDuration: 1100,
  lifetime: 2400,
  shrinkDuration: 1600,
  // size/shape
  maxRadius: 360,
  minRadius: 120,
  pointCount: 20,
  blobs: 2,
  jitter: 0.45,
  edgeRoughness: 0.26,
  noiseFactor: 0.36,
  // performance / concurrency
  maxActiveSplashes: 3,       // <=3 active veins
  maxConcurrentDraw: 3,
  maxNoisePerSplash: 20,
  offscreenDPR: 1,            // offscreen canvas DPR (1 = cheaper)
  smallRadiusSkip: 2.0,
  // start behavior
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
const preloaderTitle = document.getElementById('preloader-title');
const edenLogo = document.getElementById('eden-logo');
const topBar = document.getElementById('topbar');
const bottomBar = document.getElementById('bottombar');
const topLeft = document.getElementById('top-left');
const topRight = document.getElementById('top-right');
const soundBtn = document.getElementById('sound-btn');

/* ========== Lottie preloader ========== */
const animation = lottie.loadAnimation({
  container: document.getElementById(lottieContainerId),
  renderer: 'svg',
  loop: false,
  autoplay: true,
  path: '/loader.json'
});

// create veil early (it will draw full veil immediately but not start splashes)
const ink = initInkReveal(Object.assign({}, INK_CONFIG, { autoStart: false }));
window.__ink = ink; // debug

let animationCompleted = false;
let sceneLoaded = false;
let sceneModule = null;
let preloaderFinalized = false;

animation.addEventListener('complete', () => {
  animationCompleted = true;
  if (!LOAD_3D) {
    finalizePreloader();
    return;
  }
  if (sceneLoaded) finalizePreloader();
});
animation.addEventListener('DOMLoaded', () => { /* no-op */ });


function disableButtons() {
  document.querySelectorAll('#sound-btn, #call-action, #wa-action')
    .forEach(el => el.addEventListener('click', e => e.preventDefault(), { once: false }));
}

function finalizePreloader() {
  if (preloaderFinalized) return;
  preloaderFinalized = true;

  // stop lottie on last frame (best-effort)
  try {
    const total = animation.totalFrames || Math.round((animation.getDuration ? animation.getDuration(true) : 1) * 60) || 1;
    if (typeof animation.goToAndStop === 'function') {
      animation.goToAndStop(Math.max(0, total - 1), true);
    } else if (typeof animation.pause === 'function') {
      animation.pause();
    }
  } catch (e) {
    console.warn('Could not stop lottie on last frame:', e);
  }

  // start ink interactions/animations only once preloader is done
  try {
    if (ink && typeof ink.start === 'function') {
      ink.start();
    }
  } catch (e) {
    console.warn('ink.start() failed:', e);
  }

  // reveal top bar
  if (topBar) topBar.classList.add('visible');

  // small stagger for corner items
  setTimeout(() => {
    topLeft?.classList.add('visible');
    topRight?.classList.add('visible');
  }, 60);

  // Show preloader title and eden logo — make title width match eden logo width.
  function revealBrand() {
    if (!preloaderTitle) return;

    if (edenLogo) {
      // measure element width (rendered). If not loaded yet, wait for load event.
      const apply = () => {
        // measure bounding width (CSS pixels)
        const rect = edenLogo.getBoundingClientRect();
        // ensure at least some width
        const w = Math.max(32, Math.round(rect.width || edenLogo.naturalWidth || 200));
        preloaderTitle.style.width = w + 'px';
        preloaderTitle.classList.add('visible');
        edenLogo.classList.add('visible');
      };

      if (edenLogo.complete && (edenLogo.naturalWidth || edenLogo.width)) {
        apply();
      } else {
        // if image not loaded, wait for it but also guard with a timeout fallback
        let applied = false;
        const onload = () => { if (!applied) { applied = true; apply(); } };
        edenLogo.addEventListener('load', onload, { once: true });

        // fallback in case load doesn't fire quickly (e.g. caching oddities)
        setTimeout(() => {
          if (!applied) { applied = true; apply(); }
        }, 300);
      }
    } else {
      // no eden logo present — just show title normally
      preloaderTitle.classList.add('visible');
    }
  }

  revealBrand();

  // SHOW main-logo and fade out lottie, then destroy lottie animation
try {
  const mainLogo = document.getElementById('main-logo');
  const lottieContainerEl = document.getElementById(lottieContainerId);

  // reveal logo then fade lottie
  setTimeout(() => {
    mainLogo?.classList.add('visible');
    setTimeout(() => {
      lottieContainerEl?.classList.add('fade-out');
      const fadeDur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--transition-med')) || 400;
      setTimeout(() => {
        try { if (typeof animation.destroy === 'function') animation.destroy(); else animation.pause(); } catch(e){}
        lottieContainerEl.innerHTML = ''; // keep element for layout
      }, fadeDur + 40);
    }, 40);
  }, 20);
} catch (e) { console.warn(e); }


  // show bottom bar after a small delay so entrance feels natural
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
disableButtons();
// initialize sound system and bind to button (if present)
// const sound = initSound({ button: soundBtn });
// window.__sound = sound;

/* expose for debug */
// export { ink, sound };
