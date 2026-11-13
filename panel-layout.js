(function () {
  'use strict';
  const compact = window.matchMedia('(max-width: 900px)');
  const names = ['telemetry', 'controls'];
  const panels = [document.getElementById('telemetry-bar'), document.getElementById('control-panel')];
  const toggles = names.map(name => document.getElementById(`toggle-${name}`));
  const minimize = names.map(name => document.getElementById(`minimize-${name}`));
  let state;
  const key = () => `mars-panels-v1-${compact.matches ? 'compact' : 'desktop'}`;
  function read() {
    const defaults = compact.matches ? [false, false] : [true, true];
    try {
      const saved = JSON.parse(localStorage.getItem(key()));
      if (!Array.isArray(saved) || saved.length !== 2 || saved.some(value => typeof value !== 'boolean')) return defaults;
      return compact.matches && saved.every(Boolean) ? [false, true] : saved;
    } catch { return defaults; }
  }
  function render(save = true) {
    panels.forEach((panel, i) => {
      panel.classList.toggle('panel-minimized', !state[i]);
      panel.inert = !state[i];
      toggles[i].setAttribute('aria-expanded', String(state[i]));
      toggles[i].setAttribute('aria-label', `${state[i] ? 'Hide' : 'Show'} ${names[i] === 'controls' ? 'command center' : 'Mars telemetry'}`);
      toggles[i].classList.toggle('panel-is-open', state[i]);
    });
    if (save) { try { localStorage.setItem(key(), JSON.stringify(state)); } catch { /* Private storage may be unavailable. */ } }
  }
  function setOpen(index, open) {
    if (compact.matches && open) state = [false, false];
    state[index] = open;
    render();
    if (open) { panels[index].scrollTop = 0; minimize[index].focus({ preventScroll: true }); }
    else toggles[index].focus({ preventScroll: true });
  }
  names.forEach((_, i) => {
    toggles[i].addEventListener('click', () => setOpen(i, !state[i]));
    minimize[i].addEventListener('click', () => setOpen(i, false));
  });
  compact.addEventListener('change', () => {
    const activeIndex = panels.findIndex(panel => panel.contains(document.activeElement));
    state = read(); render(false);
    if (activeIndex >= 0 && !state[activeIndex]) toggles[activeIndex].focus({ preventScroll: true });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !compact.matches || document.querySelector('dialog[open]') || document.body.classList.contains('marswalk-open')) return;
    const index = state.findIndex(Boolean);
    if (index >= 0) setOpen(index, false);
  });
  state = read(); render(false);
})();
