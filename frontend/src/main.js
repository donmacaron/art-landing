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

const lottieContainer = document.getElementById(lottieContainerId);

/* ========== Lottie preloader ========== */
const animation = lottie.loadAnimation({
  container: lottieContainer,
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

/**
 * Replace the lottie SVG inside #lottie-container with a static image /main-logo.svg
 * using a true crossfade: fade out the SVG and fade in the <img> simultaneously.
 */
function replaceLottieWithMainLogo() {
  if (!lottieContainer) return;

  // Stop Lottie on last frame
  try {
    const total = animation.totalFrames ||
      Math.round((animation.getDuration ? animation.getDuration(true) : 2) * 60) || 1;
    if (typeof animation.goToAndStop === 'function') {
      animation.goToAndStop(Math.max(0, total - 1), true);
    } else if (typeof animation.pause === 'function') {
      animation.pause();
    }
  } catch (e) {
    console.warn('Could not stop lottie on last frame:', e);
  }

  try { animation.destroy(); } catch (e) {}

  const svg = lottieContainer.querySelector('svg');
  if (!svg) {
    lottieContainer.innerHTML = '';
    const img = document.createElement('img');
    img.src = '/main-logo.svg';
    img.alt = 'Main logo';
    img.id = 'main-logo';
    img.style.opacity = '1';
    img.style.maxWidth = '320px';
    img.style.display = 'block';
    img.style.margin = '0 auto';
    lottieContainer.appendChild(img);
    return img;
  }

  const prevPosition = lottieContainer.style.position;
  lottieContainer.style.position = 'relative';

  // Fade-out styling
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.opacity = '1';
  svg.style.transition = 'opacity 650ms cubic-bezier(0.4, 0, 0.2, 1)';
  svg.style.willChange = 'opacity';

  // Fade-in styling
  const img = document.createElement('img');
  img.src = '/main-logo.svg';
  img.alt = 'Main logo';
  img.id = 'main-logo';
  img.style.position = 'absolute';
  img.style.top = '0';
  img.style.left = '0';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.opacity = '0';
  img.style.transform = 'scale(0.98)';
  img.style.transition = 'opacity 650ms cubic-bezier(0.4, 0, 0.2, 1), transform 650ms cubic-bezier(0.4, 0, 0.2, 1)';
  img.style.willChange = 'opacity, transform';
  lottieContainer.appendChild(img);

  // Crossfade with slight stagger
  requestAnimationFrame(() => {
    svg.style.opacity = '0';
    setTimeout(() => {
      img.style.opacity = '1';
      img.style.transform = 'scale(1)';
    }, 100); // overlap delay
  });

  // Cleanup after fade
  setTimeout(() => {
    if (svg.parentNode) lottieContainer.removeChild(svg);
    lottieContainer.style.position = prevPosition;
    img.style.position = '';
    img.style.width = '';
    img.style.height = '';
  }, 500); // a bit longer than 420ms

  return img;
}


function finalizePreloader() {
  if (preloaderFinalized) return;
  preloaderFinalized = true;

  // Replace Lottie with main logo image (crossfade)
  replaceLottieWithMainLogo();

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

// initialize sound system and bind to button (if present)
const sound = initSound({ button: soundBtn });
window.__sound = sound;

/* expose for debug */
export { ink, sound };
