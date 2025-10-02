// src/tel-panel.js
const panel = document.getElementById('tel-panel');
const toggle = document.getElementById('tel-toggle');
const actions = document.getElementById('tel-actions');

if (panel && toggle && actions) {
  function openPanel() {
    panel.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    actions.setAttribute('aria-hidden', 'false');
  }
  function closePanel() {
    panel.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    actions.setAttribute('aria-hidden', 'true');
  }
  function togglePanel(e) {
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });

  // close when clicking outside
  window.addEventListener('click', (e) => {
    if (!panel.contains(e.target)) closePanel();
  });

  // keyboard close with ESC
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  // optional: close on navigation (clicking an action)
  actions.addEventListener('click', (e) => {
    // allow normal link behavior but close panel
    closePanel();
  });
}
