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

  // --- MODIFICATIONS FOR SMOOTHNESS ---
  const DURATION = 3500; // ms (Increased from 850)
  const EASING = 'cubic-bezier(0.42, 0, 0.58, 1)'; // Changed to a standard 'ease-in-out'

  // stop and destroy lottie safely
  try {
    const total = animation && (animation.totalFrames ||
      Math.round((animation.getDuration ? animation.getDuration(true) : 2) * 160) || 1);
    if (animation && typeof animation.goToAndStop === 'function') {
      animation.goToAndStop(Math.max(0, total - 1), true);
    } else if (animation && typeof animation.pause === 'function') {
      animation.pause();
    }
  } catch (e) {
    console.warn('Could not stop lottie on last frame:', e);
  }
  try { animation && animation.destroy(); } catch (e) {}

  // if no svg (lottie failed to render) just swap immediately
  const svg = lottieContainer.querySelector('svg');
  if (!svg) {
    lottieContainer.innerHTML = '';
    const img = document.createElement('img');
    img.src = '/main-logo.svg';
    img.alt = 'Main logo';
    img.id = 'main-logo';
    img.style.maxWidth = '320px';
    img.style.display = 'block';
    img.style.margin = '0 auto';
    
    return lottieContainer.appendChild(img);
  }

  // prepare container and elements
  const prevPosition = lottieContainer.style.position;
  lottieContainer.style.position = prevPosition || 'relative';
  lottieContainer.style.overflow = 'hidden';

  // ensure both layers sit exactly on top of each other
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    opacity: '1',
    transform: 'translateZ(0) scale(1)',
    filter: 'blur(0px)',
    transition: `opacity ${DURATION}ms ${EASING}, filter ${DURATION}ms ${EASING}, transform ${DURATION}ms ${EASING}`,
    willChange: 'opacity, filter, transform',
    pointerEvents: 'none'
  });

  const img = document.createElement('img');
  img.src = '/main-logo.svg';
  img.alt = 'Main logo';
  img.id = 'main-logo';
  Object.assign(img.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    maxWidth: '',
    maxHeight: '',
    display: 'block',
    margin: '0',
    opacity: '0',
    // --- MODIFICATION: Start slightly smaller for a smoother zoom-in ---
    transform: 'translateZ(0) scale(0.97)',
    transition: `opacity ${DURATION}ms ${EASING}, transform ${DURATION}ms ${EASING}`,
    willChange: 'opacity, transform',
    pointerEvents: 'none'
  });

  lottieContainer.appendChild(img);

  // Force layout then start transition
  requestAnimationFrame(() => requestAnimationFrame(() => {
    svg.style.opacity = '0';
    svg.style.filter = 'blur(3px)'; // --- MODIFICATION: Slightly more blur for a softer exit ---
    // --- MODIFICATION: Have the old logo expand slightly as it fades for a "dissolve" effect ---
    svg.style.transform = 'translateZ(0) scale(1.03)';

    // slight stagger for perceived smoothness
    setTimeout(() => {
      img.style.opacity = '1';
      img.style.transform = 'translateZ(0) scale(1)';
    }, 200); // --- MODIFICATION: Increased stagger from 60ms to 200ms
  }));

  // Cleanup once transitions finish. Use both transitionend and a timeout fallback.
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;

    if (svg.parentNode) svg.parentNode.removeChild(svg);

    // make the img a normal flow element again
    Object.assign(img.style, {
      position: '',
      inset: '',
      width: '',
      height: '',
      transform: '',
      transition: '',
      willChange: '',
      pointerEvents: ''
    });

    lottieContainer.style.position = prevPosition || '';
    lottieContainer.style.overflow = '';
  };

  const onTransitionEnd = (e) => {
    // wait for the image opacity/transform to finish
    if (e.target === img) finish();
  };

  img.addEventListener('transitionend', onTransitionEnd, { once: true });

  // fallback in case transitionend doesn't fire
  const fallbackTimeout = setTimeout(() => finish(), DURATION + 250); // Adjusted fallback timeout

  // ensure cleanup of timeout if we finished earlier
  const wrappedFinish = () => {
    clearTimeout(fallbackTimeout);
    finish();
  };

  // replace finish function used by event and timeout
  img.addEventListener('transitionend', () => clearTimeout(fallbackTimeout), { once: true });
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
