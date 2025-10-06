// Simple tel panel toggle script
const panel = document.getElementById('tel-panel');
const toggle = document.getElementById('tel-toggle');
const actions = panel.querySelectorAll('.tel-action');
actions.forEach(a => a.blur());



if (toggle && panel && actions) {
  function openPanel() {
    panel.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    actions.setAttribute('aria-hidden', 'false');
    // put focus on first action for keyboard users
    const first = actions.querySelector('.tel-action');
    if (first && typeof first.focus === 'function') first.focus();
  }

  function closePanel() {
    panel.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    actions.setAttribute('aria-hidden', 'true');
    if (typeof toggle.focus === 'function') toggle.focus();
  }

  toggle.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const isOpen = panel.classList.contains('open');
    if (isOpen) closePanel();
    else openPanel();
  });

  // close on outside click
  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('open')) return;
    if (!panel.contains(e.target)) closePanel();
  });

  // close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) {
      closePanel();
    }
  });

  // ensure links inside panel don't re-trigger collapse weirdly
  actions.addEventListener('click', (e) => {
    // let link do its thing; close panel after small delay so navigation works smoothly
    const targetLink = e.target.closest('.tel-action');
    if (targetLink) {
      setTimeout(() => closePanel(), 150);
    }
  });

  // optional: close when focus leaves panel (keyboard users)
  let focusTimeout = null;
  panel.addEventListener('focusout', (e) => {
    clearTimeout(focusTimeout);
    focusTimeout = setTimeout(() => {
      const active = document.activeElement;
      if (!panel.contains(active)) closePanel();
    }, 10);
  });
}
