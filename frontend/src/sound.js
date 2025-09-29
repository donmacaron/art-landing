// src/sound.js
// Robust sound init: Howler primary, multiple fallbacks, debug info
import { Howl } from 'howler';

export function initSound({ button = null, audioConfig = null } = {}) {
  const cfg = Object.assign({
    sources: ['/audio/ambience.ogg', '/audio/ambience.mp3'],
    volume: 0.8,
    fadeTime: 600, // ms
    preload: true,
    debug: false
  }, audioConfig || {});

  // internal state
  let howl = null;
  let htmlAudioEl = null; // final fallback's <audio>
  let audioCtx = null;
  let gainNode = null;
  let buffer = null;
  let bufferSource = null;
  let isReady = false;
  let isPlaying = false;
  let usingBuffer = false;
  let usingHowlHtml5 = false;

  function log(...args) { if (cfg.debug) console.log('[sound]', ...args); }

  function updateButtonUI() {
    if (!button) return;
    button.setAttribute('aria-pressed', String(Boolean(isPlaying)));
    const span = button.querySelector('span');
    if (span) span.textContent = isPlaying ? 'Sound off' : 'Sound on';
  }

  /* ---------------------------
     Howler primary (WebAudio) 
     --------------------------- */
  function createHowl(useHtml5 = false) {
    log('createHowl html5=', useHtml5);
    usingHowlHtml5 = !!useHtml5;
    howl = new Howl({
      src: cfg.sources,
      loop: true,
      volume: 0,
      preload: cfg.preload,
      html5: useHtml5, // try WebAudio (false) first, then true if fails
      onload: () => {
        log('Howl loaded (html5=' + useHtml5 + ')');
        isReady = true;
        // if localStorage says it should be playing, we won't auto-play due to autoplay rules
      },
      onloaderror: (id, err) => {
        log('Howl loaderror (html5=' + useHtml5 + ')', id, err);
        // fallback chain
        if (!useHtml5) {
          log('Retry Howl with html5=true fallback');
          createHowl(true);
        } else {
          log('Howl html5 also failed — try manual decode fallback');
          tryManualDecode();
        }
      },
      onplayerror: (id, err) => {
        log('Howl playerror', id, err);
        // try unlock behavior (Howler) and retry
        try {
          howl.once('unlock', () => {
            log('Howler unlock event — retry play');
            howl.play();
          });
        } catch (e) { log('unlock failed', e); }
      }
    });
    return howl;
  }

  /* ---------------------------
     Manual buffered fetch + decode
     (fallback if Howl fails or you want buffer-based playback)
     --------------------------- */
  async function tryManualDecode() {
    log('tryManualDecode');
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = audioCtx || new AC();
      gainNode = gainNode || audioCtx.createGain();
      gainNode.gain.value = 0;
      gainNode.connect(audioCtx.destination);

      for (const src of cfg.sources) {
        try {
          log('fetch', src);
          const res = await fetch(src);
          if (!res.ok) {
            log('fetch failed', src, res.status);
            continue;
          }
          const arr = await res.arrayBuffer();
          // decodeAudioData sometimes requires Promise wrapper for some browsers
          const decoded = await audioCtx.decodeAudioData(arr.slice(0)); // slice for safety
          buffer = decoded;
          usingBuffer = true;
          isReady = true;
          log('manual decode successful', src);
          return true;
        } catch (e) {
          log('decode failed for', src, e);
        }
      }
    } catch (err) {
      log('manual decode top-level error', err);
    }
    // if manual decode also failed -> fallback to html audio element streaming
    createHtmlAudioFallback();
    return false;
  }

  /* ---------------------------
     Final fallback: simple <audio> element streaming
     (may be blocked by autoplay policies)
     --------------------------- */
  function createHtmlAudioFallback() {
    log('createHtmlAudioFallback');
    htmlAudioEl = document.createElement('audio');
    htmlAudioEl.loop = true;
    htmlAudioEl.preload = 'auto';
    htmlAudioEl.style.display = 'none';
    for (const s of cfg.sources) {
      const srcEl = document.createElement('source');
      srcEl.src = s;
      htmlAudioEl.appendChild(srcEl);
    }
    document.body.appendChild(htmlAudioEl);

    try {
      // try to connect to AudioContext for fades if permitted
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = audioCtx || new AC();
      gainNode = gainNode || audioCtx.createGain();
      gainNode.gain.value = 0;
      gainNode.connect(audioCtx.destination);
      const srcNode = audioCtx.createMediaElementSource(htmlAudioEl);
      srcNode.connect(gainNode);
      usingBuffer = false;
      isReady = true;
      log('htmlAudio fallback created and wired to AudioContext');
    } catch (e) {
      // if cross-origin or other issues, we still have htmlAudioEl but no gain node
      log('could not wire htmlAudio to AudioContext', e);
      isReady = true;
    }
  }

  /* ---------------------------
     Start / Stop logic (unified)
     --------------------------- */
  async function start() {
    log('start called');
    try {
      // If Howler not even created yet, try to create the primary Howl
      if (!howl && !usingBuffer && !htmlAudioEl) {
        createHowl(false); // start attempt with WebAudio via Howler
      }

      // wait a short while if we have Howl loading
      if (howl && !isReady && !usingBuffer && !htmlAudioEl) {
        log('waiting for howl to load (short wait)');
        const waitUntil = performance.now() + 2500;
        while (!isReady && performance.now() < waitUntil) {
          await new Promise(r => setTimeout(r, 150));
        }
      }

      // If we have buffer (manual decode path)
      if (buffer && audioCtx) {
        log('playing from decoded buffer via AudioContext');
        if (audioCtx.state === 'suspended') {
          try { await audioCtx.resume(); } catch (e) { log('audioCtx.resume failed', e); }
        }
        if (bufferSource) try { bufferSource.stop(); } catch (e) {}
        bufferSource = audioCtx.createBufferSource();
        bufferSource.buffer = buffer;
        bufferSource.loop = true;
        bufferSource.connect(gainNode);
        bufferSource.start(0);
        // fade up
        const now = audioCtx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(cfg.volume, now + (cfg.fadeTime / 1000));
        isPlaying = true;
        updateButtonUI();
        return;
      }

      // If we have Howler instance (either webaudio or html5)
      if (howl) {
        log('playing via Howl (html5=' + usingHowlHtml5 + ')');
        try {
          howl.play();
        } catch (e) {
          log('howl.play threw', e);
        }
        // fade if available
        try {
          const curVol = howl.volume ? howl.volume() : 0;
          if (howl.fade) howl.fade(curVol, cfg.volume, cfg.fadeTime);
          else howl.volume(cfg.volume);
        } catch (e) { log('howl fade error', e); }
        isPlaying = true;
        updateButtonUI();
        return;
      }

      // If we have htmlAudioEl fallback
      if (htmlAudioEl) {
        log('playing htmlAudioEl fallback');
        try {
          await htmlAudioEl.play();
        } catch (e) {
          log('htmlAudioEl.play error', e);
        }
        // if wired to audioCtx with gainNode, fade
        if (gainNode && audioCtx) {
          const now = audioCtx.currentTime;
          gainNode.gain.cancelScheduledValues(now);
          gainNode.gain.setValueAtTime(0, now);
          gainNode.gain.linearRampToValueAtTime(cfg.volume, now + (cfg.fadeTime / 1000));
        }
        isPlaying = true;
        updateButtonUI();
        return;
      }

      // last resort: try manual decode now
      if (!isReady) {
        log('not ready — forcing manual decode attempt');
        await tryManualDecode();
        if (buffer) {
          await start(); // recursive but safe because buffer is present
          return;
        }
      }

      log('start finished — no playable source found');
    } catch (err) {
      console.error('start error', err);
    }
  }

  function stop() {
    log('stop called');
    try {
      // buffer source
      if (bufferSource && audioCtx) {
        const now = audioCtx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + (cfg.fadeTime / 1000));
        setTimeout(() => {
          try { bufferSource.stop(); } catch (e) {}
          bufferSource = null;
        }, Math.round(cfg.fadeTime + 50));
        isPlaying = false;
        updateButtonUI();
        return;
      }

      // Howler
      if (howl) {
        try {
          if (howl.fade) howl.fade(howl.volume(), 0, cfg.fadeTime);
          setTimeout(() => { try { howl.pause(); } catch (e) {} }, cfg.fadeTime + 80);
        } catch (e) {
          try { howl.pause(); } catch (e2) {}
        }
        isPlaying = false;
        updateButtonUI();
        return;
      }

      // htmlAudioEl
      if (htmlAudioEl) {
        try { htmlAudioEl.pause(); } catch (e) { log('html pause fail', e); }
        isPlaying = false;
        updateButtonUI();
        return;
      }
    } catch (err) {
      console.warn('stop error', err);
    }
  }

  async function toggle() { if (isPlaying) stop(); else await start(); }

  // attach to UI button
  if (button) {
    button.addEventListener('click', async (e) => { e.preventDefault(); await toggle(); });
  }

  // initialize primary loader
  createHowl(false); // try Howler WebAudio first

  // Expose debug helper
  function debugInfo() {
    return {
      cfg,
      isReady, isPlaying, usingBuffer, usingHowlHtml5, bufferPresent: !!buffer
    };
  }

  // destroy / cleanup
  function destroy() {
    try {
      if (bufferSource) try { bufferSource.stop(); } catch (e) {}
      if (audioCtx) try { audioCtx.close(); } catch (e) {}
      if (howl) try { howl.unload && howl.unload(); } catch (e) {}
      if (htmlAudioEl && htmlAudioEl.parentNode) htmlAudioEl.parentNode.removeChild(htmlAudioEl);
    } catch (e) {}
  }

  return { start, stop, toggle, isPlaying: () => isPlaying, debugInfo, destroy };
}
