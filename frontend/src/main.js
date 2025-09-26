// src/main.js
import lottie from 'lottie-web';
import './style.css';

import { initInkReveal } from './ink.js';
import { initSound } from './sound.js';

/* ===========================
   CODE-LEVEL SWITCH
   ===========================
*/
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
  clickHoldMin: 80,
  growthSpeed: 220,
  maxRadius: 360,
  feather: 0.55,
  permanentOnMax: false,
  multiple: false,
  followWhileGrowing: false,
  blobs: 10,
  jitter: 0.45,
  noiseFactor: 0.6
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
  fogFar: 12,
  bgImage: INK_CONFIG.imageUrl
};

/* ========== UI refs ========== */
const lottieContainerId = 'lottie-container';
const preloaderTitle = document.getElementById('preloader-title');
const topRight = document.getElementById('top-right');
const topLeft = document.getElementById('top-left');
const soundBtn = document.getElementById('sound-btn');

/* ========== Lottie preloader ========== */
const animation = lottie.loadAnimation({
  container: document.getElementById(lottieContainerId),
  renderer: 'svg',
  loop: false,
  autoplay: true,
  path: '/loader.json'
});

let animationCompleted = false;
let sceneLoaded = false;
let sceneModule = null;

animation.addEventListener('complete', () => {
  animationCompleted = true;
  if (!LOAD_3D) {
    finalizePreloader();
    return;
  }
  if (sceneLoaded) finalizePreloader();
});
animation.addEventListener('DOMLoaded', () => { /* no-op */ });

function finalizePreloader() {
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

  topLeft?.classList.add('visible');
  topRight?.classList.add('visible');

  if (preloaderTitle) {
    preloaderTitle.textContent = 'PRIVATE RESIDENCE';
    preloaderTitle.classList.add('visible');
  }
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

/* ===========================
   Initialize ink reveal and sound
   ===========================
*/
const ink = initInkReveal(INK_CONFIG);
window.__ink = ink; // debug

// initialize sound system and bind to button (if present)
const sound = initSound({ button: soundBtn }); // returns API (start/stop/toggle)
window.__sound = sound;
