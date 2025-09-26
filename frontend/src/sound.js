// src/sound.js
// Exports initSound({ button, audioConfig }) -> API { start, stop, toggle, destroy }

export function initSound({ button = null, audioConfig = null } = {}) {
  const cfg = Object.assign({
    sources: ['/audio/ambience.ogg', '/audio/ambience.mp3'],
    volume: 0.8,
    fadeTime: 0.6
  }, audioConfig || {});

  let audioCtx = null;
  let audioEl = null;
  let sourceNode = null;
  let gainNode = null;
  let audioPlaying = false;
  let audioReady = false;

  function updateButtonUI() {
    if (!button) return;
    const pressed = audioPlaying;
    button.setAttribute('aria-pressed', String(Boolean(pressed)));
    const span = button.querySelector('span');
    if (span) span.textContent = pressed ? 'Sound off' : 'Sound on';
  }

  function createAudioChain() {
    if (audioReady) return;
    audioEl = document.createElement('audio');
    audioEl.crossOrigin = 'anonymous';
    audioEl.loop = true;
    for (const s of cfg.sources) {
      const src = document.createElement('source');
      src.src = s;
      audioEl.appendChild(src);
    }
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    sourceNode = audioCtx.createMediaElementSource(audioEl);
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 0;
    sourceNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    audioReady = true;
  }

  async function startAmbient() {
    try {
      if (!audioReady) createAudioChain();
      if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      try { await audioEl.play(); } catch (e) { console.warn('audio play failed', e); }
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
    if (!audioReady) {
      audioPlaying = false;
      localStorage.setItem('soundOn', 'false');
      updateButtonUI();
      return;
    }
    try {
      const now = audioCtx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + cfg.fadeTime);
      setTimeout(() => {
        try { audioEl.pause(); } catch (e) {}
      }, Math.round(cfg.fadeTime * 1000 + 120));
      audioPlaying = false;
      localStorage.setItem('soundOn', 'false');
      updateButtonUI();
    } catch (err) { console.warn('stopAmbient error', err); }
  }

  async function handleSoundToggle() {
    if (!audioReady) createAudioChain();
    if (audioCtx && audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (e) {}
    }
    if (audioPlaying) stopAmbient();
    else await startAmbient();
  }

  // bind to provided button (if any)
  if (button) {
    button.addEventListener('click', async (e) => {
      await handleSoundToggle();
    });
    const saved = localStorage.getItem('soundOn');
    if (saved === 'true') {
      createAudioChain();
      updateButtonUI();
    } else {
      updateButtonUI();
    }
  }

  // duck on visibility change
  document.addEventListener('visibilitychange', () => {
    if (!audioReady || !audioCtx) return;
    if (document.hidden) {
      const now = audioCtx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.25);
    } else {
      if (localStorage.getItem('soundOn') === 'true') {
        const now = audioCtx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(cfg.volume, now + 0.4);
      }
    }
  });

  return {
    start: startAmbient,
    stop: stopAmbient,
    toggle: handleSoundToggle,
    isPlaying: () => audioPlaying,
    destroy() {
      try {
        if (audioEl && audioEl.parentNode) audioEl.parentNode.removeChild(audioEl);
      } catch (e) {}
    }
  };
}
