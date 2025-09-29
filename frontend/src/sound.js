// src/sound.js
// Exports initSound({ button, audioConfig }) -> API { start, stop, toggle, destroy }

export function initSound({ button = null, audioConfig = null } = {}) {
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

  function updateButtonUI() {
    if (!button) return;
    const pressed = audioPlaying;
    button.setAttribute('aria-pressed', String(Boolean(pressed)));
    const span = button.querySelector('span');
    if (span) span.textContent = pressed ? 'Sound off' : 'Sound on';
  }

  async function loadBuffer() {
    if (audioReady) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(audioCtx.destination);

    // try sources until one works
    for (const url of cfg.sources) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const arrBuf = await res.arrayBuffer();
        buffer = await audioCtx.decodeAudioData(arrBuf);
        break;
      } catch (err) {
        console.warn(`Failed to load audio source ${url}:`, err);
      }
    }
    if (!buffer) throw new Error('No valid audio sources loaded');
    audioReady = true;
  }

  function createSource() {
    if (!buffer || !audioCtx) return null;
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gainNode);
    return src;
  }

  async function startAmbient() {
    try {
      if (!audioReady) await loadBuffer();
      if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      if (sourceNode) {
        try { sourceNode.stop(); } catch {}
      }
      sourceNode = createSource();
      sourceNode.start(0);

      const now = audioCtx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(cfg.volume, now + cfg.fadeTime);

      audioPlaying = true;
      localStorage.setItem('soundOn', 'true');
      updateButtonUI();
    } catch (err) {
      console.error('startAmbient error', err);
    }
  }

  function stopAmbient() {
    if (!audioReady || !gainNode) {
      audioPlaying = false;
      localStorage.setItem('soundOn', 'false');
      updateButtonUI();
      return;
    }
    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + cfg.fadeTime);
    if (sourceNode) {
      setTimeout(() => {
        try { sourceNode.stop(); } catch {}
        sourceNode = null;
      }, Math.round(cfg.fadeTime * 1000 + 100));
    }
    audioPlaying = false;
    localStorage.setItem('soundOn', 'false');
    updateButtonUI();
  }

  async function handleSoundToggle() {
    if (!audioReady) await loadBuffer();
    if (audioCtx && audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch {}
    }
    if (audioPlaying) stopAmbient();
    else await startAmbient();
  }

  // bind to provided button (if any)
  if (button) {
    button.addEventListener('click', async () => {
      await handleSoundToggle();
    });
    const saved = localStorage.getItem('soundOn');
    if (saved === 'true') {
      loadBuffer().then(() => updateButtonUI());
    } else {
      updateButtonUI();
    }
  }

  // duck on visibility change
  document.addEventListener('visibilitychange', () => {
    if (!audioReady || !audioCtx || !gainNode) return;
    const now = audioCtx.currentTime;
    if (document.hidden) {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.25);
    } else if (localStorage.getItem('soundOn') === 'true') {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(cfg.volume, now + 0.4);
    }
  });

  return {
    start: startAmbient,
    stop: stopAmbient,
    toggle: handleSoundToggle,
    isPlaying: () => audioPlaying,
    destroy() {
      try {
        if (sourceNode) sourceNode.stop();
        if (audioCtx) audioCtx.close();
      } catch (e) {}
    }
  };
}
