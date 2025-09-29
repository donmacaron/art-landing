// src/sound.js
export function initSound({ button = null, audioConfig = null, preload = true } = {}) {
  const cfg = Object.assign({
    sources: ['/audio/ambience.ogg', '/audio/ambience.mp3'],
    volume: 0.8,
    fadeTime: 0.6
  }, audioConfig || {});

  let audioCtx = null;
  let gainNode = null;
  let buffer = null;
  let sourceNode = null;
  let audioPlaying = false;
  let audioReady = false;
  let preloadPromise = null;

  function updateButtonUI() {
    if (!button) return;
    button.setAttribute('aria-pressed', String(Boolean(audioPlaying)));
    const span = button.querySelector('span');
    if (span) span.textContent = audioPlaying ? 'Sound off' : 'Sound on';
  }

  async function loadBuffer() {
    if (audioReady) return buffer;
    if (!preloadPromise) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      gainNode = audioCtx.createGain();
      gainNode.gain.value = 0;
      gainNode.connect(audioCtx.destination);

      preloadPromise = (async () => {
        for (const url of cfg.sources) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const arrBuf = await res.arrayBuffer();
            buffer = await audioCtx.decodeAudioData(arrBuf);
            audioReady = true;
            return buffer;
          } catch (err) {
            console.warn(`Failed to load ${url}`, err);
          }
        }
        throw new Error("No valid audio sources");
      })();
    }
    return preloadPromise;
  }

  function createSource() {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gainNode);
    return src;
  }

  async function startAmbient() {
    await loadBuffer();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    if (sourceNode) { try { sourceNode.stop(); } catch {} }
    sourceNode = createSource();
    sourceNode.start(0);

    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(cfg.volume, now + cfg.fadeTime);

    audioPlaying = true;
    localStorage.setItem('soundOn', 'true');
    updateButtonUI();
  }

  function stopAmbient() {
    if (!audioReady) return;
    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + cfg.fadeTime);

    if (sourceNode) {
      setTimeout(() => { try { sourceNode.stop(); } catch {}; sourceNode = null; }, Math.round(cfg.fadeTime * 1000 + 100));
    }

    audioPlaying = false;
    localStorage.setItem('soundOn', 'false');
    updateButtonUI();
  }

  async function handleSoundToggle() {
    if (!audioReady) await loadBuffer();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (audioPlaying) stopAmbient();
    else await startAmbient();
  }

  // auto preload on init
  if (preload) loadBuffer();

  if (button) {
    button.addEventListener('click', handleSoundToggle);
    const saved = localStorage.getItem('soundOn');
    if (saved === 'true') loadBuffer().then(() => updateButtonUI());
    else updateButtonUI();
  }

  // visibility duck
  document.addEventListener('visibilitychange', () => {
    if (!audioReady) return;
    const now = audioCtx.currentTime;
    if (document.hidden) {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.25);
    } else if (localStorage.getItem('soundOn') === 'true') {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.linearRampToValueAtTime(cfg.volume, now + 0.4);
    }
  });

  return {
    preload: loadBuffer,
    start: startAmbient,
    stop: stopAmbient,
    toggle: handleSoundToggle,
    isPlaying: () => audioPlaying
  };
}
