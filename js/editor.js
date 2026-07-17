/* ============================================================
   editor.js — visual "editor mode" for assigning device mockups
   Loaded on demand by js/main.js the first time the corner
   toggle is clicked. Client-side only: no data leaves the browser
   except via the "Download updated HTML" export.
   ============================================================ */

(function () {
  'use strict';

  const CANDIDATE_SELECTOR =
    '.cs-img-grid img, .project-card__img, .phone-mockup__screen img, .desktop-mockup__screen img';
  const STORAGE_KEY = 'editorMockups:' + location.pathname;

  const STATUSBAR_ICONS =
    '<svg width="15" height="10" viewBox="0 0 16 10" fill="#fff"><rect x="0" y="6" width="2.3" height="4" rx="0.5"/><rect x="4.3" y="4" width="2.3" height="6" rx="0.5"/><rect x="8.6" y="2" width="2.3" height="8" rx="0.5"/><rect x="12.9" y="0" width="2.3" height="10" rx="0.5"/></svg>' +
    '<svg width="14" height="11" viewBox="0 0 16 12" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><path d="M1 4.5C5.5 0.5 10.5 0.5 15 4.5"/><path d="M3.7 7.3C6.5 4.8 9.5 4.8 12.3 7.3"/><circle cx="8" cy="10" r="1" fill="#fff" stroke="none"/></svg>' +
    '<svg width="22" height="11" viewBox="0 0 24 12" fill="none"><rect x="0.5" y="0.5" width="20" height="11" rx="2.5" stroke="#fff" stroke-opacity=".6"/><rect x="2" y="2" width="15" height="8" rx="1.2" class="icon-battery-fill"/><rect x="21.5" y="4" width="2" height="4" rx="1" fill="#fff" fill-opacity=".6"/></svg>';

  let badgeEl = null;
  let hideTimer = null;
  let panelEl = null;

  // -- Helpers ---------------------------------------------------
  function getTarget(img) {
    return img.closest('.phone-mockup, .desktop-mockup') || img;
  }

  function unwrap(img) {
    const wrapper = img.closest('.phone-mockup, .desktop-mockup');
    if (wrapper) {
      wrapper.parentNode.insertBefore(img, wrapper);
      wrapper.remove();
    }
  }

  function wrapAsPhone(img, variant) {
    unwrap(img);
    const wrapper = document.createElement('div');
    wrapper.className = variant === 'android' ? 'phone-mockup phone-mockup--android reveal reveal-tilt' : 'phone-mockup reveal reveal-tilt';
    wrapper.dataset.editorMockup = variant === 'android' ? 'phone-android' : 'phone-ios';
    const notch = document.createElement('div');
    notch.className = 'phone-mockup__notch';
    const screen = document.createElement('div');
    screen.className = 'phone-mockup__screen';
    const statusbar = document.createElement('div');
    statusbar.className = 'phone-mockup__statusbar';
    statusbar.innerHTML =
      '<span class="phone-mockup__time"></span>' +
      '<span class="phone-mockup__icons">' + STATUSBAR_ICONS + '</span>';
    img.parentNode.insertBefore(wrapper, img);
    screen.appendChild(statusbar);
    screen.appendChild(img);
    wrapper.appendChild(notch);
    wrapper.appendChild(screen);
    requestAnimationFrame(() => wrapper.classList.add('visible'));
    window.__updatePhoneClocks && window.__updatePhoneClocks();
    return wrapper;
  }

  function wrapAsDesktop(img) {
    unwrap(img);
    const wrapper = document.createElement('div');
    wrapper.className = 'desktop-mockup reveal reveal-tilt';
    wrapper.dataset.editorMockup = 'desktop';
    const bar = document.createElement('div');
    bar.className = 'desktop-mockup__bar';
    bar.innerHTML =
      '<span class="desktop-mockup__dot desktop-mockup__dot--red"></span>' +
      '<span class="desktop-mockup__dot desktop-mockup__dot--yellow"></span>' +
      '<span class="desktop-mockup__dot desktop-mockup__dot--green"></span>';
    const screen = document.createElement('div');
    screen.className = 'desktop-mockup__screen';
    img.parentNode.insertBefore(wrapper, img);
    screen.appendChild(img);
    wrapper.appendChild(bar);
    wrapper.appendChild(screen);
    requestAnimationFrame(() => wrapper.classList.add('visible'));
    return wrapper;
  }

  function applyMockup(img, type) {
    if (type === 'phone-ios') wrapAsPhone(img, 'ios');
    else if (type === 'phone-android') wrapAsPhone(img, 'android');
    else if (type === 'desktop') wrapAsDesktop(img);
    else unwrap(img);
    saveState();
    updatePanel();
  }

  // -- Persistence (convenience cache only, not source of truth) -
  function saveState() {
    const state = {};
    document.querySelectorAll(CANDIDATE_SELECTOR).forEach(img => {
      const wrapper = img.closest('.phone-mockup, .desktop-mockup');
      if (wrapper && wrapper.dataset.editorMockup) {
        state[img.getAttribute('src')] = wrapper.dataset.editorMockup;
      }
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function restoreState() {
    let state;
    try {
      state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {
      state = {};
    }
    document.querySelectorAll(CANDIDATE_SELECTOR).forEach(img => {
      const type = state[img.getAttribute('src')];
      if (type) applyMockup(img, type);
    });
  }

  // -- Hover badge -------------------------------------------------
  function ensureBadge() {
    if (badgeEl) return badgeEl;
    badgeEl = document.createElement('div');
    badgeEl.className = 'editor-badge';
    badgeEl.innerHTML =
      '<button class="editor-badge__btn" data-type="phone-ios" title="iPhone">\u{1F4F1}</button>' +
      '<button class="editor-badge__btn" data-type="phone-android" title="Android">\u{1F916}</button>' +
      '<button class="editor-badge__btn" data-type="desktop" title="Desktop">\u{1F5A5}</button>' +
      '<button class="editor-badge__btn" data-type="none" title="Remove mockup">✕</button>';
    document.body.appendChild(badgeEl);
    badgeEl.addEventListener('mouseenter', cancelHide);
    badgeEl.addEventListener('mouseleave', scheduleHide);
    badgeEl.addEventListener('click', e => {
      const btn = e.target.closest('.editor-badge__btn');
      if (!btn || !badgeEl.currentImg) return;
      applyMockup(badgeEl.currentImg, btn.dataset.type);
      hideBadge();
    });
    return badgeEl;
  }

  function positionBadge(img) {
    const rect = getTarget(img).getBoundingClientRect();
    const badge = ensureBadge();
    badge.style.display = 'flex';
    const top = Math.max(8, rect.top - 44);
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - 80),
      window.innerWidth - 168
    );
    badge.style.top = top + 'px';
    badge.style.left = left + 'px';
    badge.currentImg = img;
  }

  function cancelHide() {
    clearTimeout(hideTimer);
  }

  function scheduleHide() {
    hideTimer = setTimeout(hideBadge, 150);
  }

  function hideBadge() {
    if (badgeEl) badgeEl.style.display = 'none';
  }

  // -- Control panel ------------------------------------------------
  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.className = 'editor-panel';
    panelEl.innerHTML =
      '<span class="editor-panel__count"></span>' +
      '<button class="editor-panel__btn" data-action="reset">Reset</button>' +
      '<button class="editor-panel__btn editor-panel__btn--primary" data-action="download">Download updated HTML</button>';
    document.body.appendChild(panelEl);
    panelEl.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'reset') resetAll();
      if (btn.dataset.action === 'download') downloadHTML();
    });
    return panelEl;
  }

  function updatePanel() {
    if (!panelEl) return;
    const count = document.querySelectorAll('[data-editor-mockup]').length;
    panelEl.querySelector('.editor-panel__count').textContent =
      count + (count === 1 ? ' image tagged' : ' images tagged');
  }

  function resetAll() {
    document.querySelectorAll(CANDIDATE_SELECTOR).forEach(img => unwrap(img));
    localStorage.removeItem(STORAGE_KEY);
    updatePanel();
  }

  // -- Export --------------------------------------------------------
  function downloadHTML() {
    const clone = document.documentElement.cloneNode(true);
    clone.classList.remove('editor-mode');
    clone
      .querySelectorAll('.editor-toggle, .editor-badge, .editor-panel, [data-editor-script]')
      .forEach(el => el.remove());
    clone.querySelectorAll('.editor-candidate').forEach(el => el.classList.remove('editor-candidate', 'editor-hover'));
    clone.querySelectorAll('[data-editor-mockup]').forEach(el => el.removeAttribute('data-editor-mockup'));
    clone.querySelectorAll('.reveal.visible').forEach(el => el.classList.remove('visible'));

    const html = '<!DOCTYPE html>\n' + clone.outerHTML;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (location.pathname.split('/').pop() || 'index.html');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // -- Delegated hover / mode toggling --------------------------------
  function onMouseOver(e) {
    if (!document.body.classList.contains('editor-mode')) return;
    const img = e.target.closest('.editor-candidate');
    if (img) {
      cancelHide();
      positionBadge(img);
    }
  }

  function onMouseOut(e) {
    if (!document.body.classList.contains('editor-mode')) return;
    const img = e.target.closest('.editor-candidate');
    if (img) scheduleHide();
  }

  function init() {
    document.querySelectorAll(CANDIDATE_SELECTOR).forEach(img => {
      img.classList.add('editor-candidate');
    });
    ensureBadge();
    ensurePanel();
    restoreState();
    updatePanel();

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);

    document.body.classList.add('editor-mode');
    document.querySelector('.editor-toggle')?.classList.add('is-active');
    if (panelEl) panelEl.style.display = 'flex';
  }

  window.__editorInit = init;
  window.__editorToggle = function () {
    const isOpen = document.body.classList.toggle('editor-mode');
    document.querySelector('.editor-toggle')?.classList.toggle('is-active', isOpen);
    if (panelEl) panelEl.style.display = isOpen ? 'flex' : 'none';
    if (!isOpen) hideBadge();
  };
})();
