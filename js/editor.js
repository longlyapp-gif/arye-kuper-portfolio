/* ============================================================
   editor.js — visual editor mode.
   Loaded on demand by js/main.js the first time the corner
   toggle is clicked. Depends on js/content.js (window.__content)
   for hydration primitives, backend access, and stable ids.

   Entering edit mode requires signing in with the secret code
   (a real password behind Firebase Auth once configured; a local
   stand-in while testing against the browser-local backend).
   ============================================================ */
(function () {
  'use strict';

  const api = window.__content;
  if (!api) { console.error('[editor] js/content.js must load before js/editor.js'); return; }

  const IMAGE_CANDIDATE_SELECTOR = api.imageSelector + ', [data-block-field="image"]';

  let badgeEl = null;
  let resizeHandleEl = null;
  let panelEl = null;
  let modalEl = null;
  let saveTimer = null;
  let selectedImg = null;

  // -- Data helpers -----------------------------------------------
  function getData() {
    window.__pageContent = window.__pageContent || { edits: {}, blocks: [] };
    window.__pageContent.edits = window.__pageContent.edits || {};
    window.__pageContent.blocks = window.__pageContent.blocks || [];
    return window.__pageContent;
  }

  function currentLang() {
    return document.documentElement.getAttribute('data-lang') || 'en';
  }

  function blockOf(el) {
    const wrap = el.closest('.cs-block');
    if (!wrap) return null;
    return getData().blocks.find(b => b.id === wrap.dataset.blockId) || null;
  }

  function schedulePersist() {
    showSaveStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api.savePage(getData());
        showSaveStatus('Saved ✓');
        updatePanelCount();
      } catch (e) {
        console.error('[editor] save failed', e);
        showSaveStatus('Save failed');
      }
    }, 700);
  }

  // -- Text editing -------------------------------------------------
  function saveTextForEl(el) {
    const lang = currentLang();
    const value = el.textContent;
    const block = blockOf(el);
    if (block) {
      block[lang] = value;
    } else {
      const id = api.computeStableId(el);
      const data = getData();
      const existing = (data.edits[id] && data.edits[id].kind === 'text') ? data.edits[id] : { kind: 'text' };
      existing[lang] = value;
      data.edits[id] = existing;
      // Mirror onto any twin elements sharing this id (e.g. the hero's
      // blurred + sharp layers) so both stay in sync without a reload.
      api.textCandidates().forEach(other => {
        if (other !== el && api.computeStableId(other) === id) {
          other.setAttribute('data-' + lang, value);
          if (currentLang() === lang) other.textContent = value;
        }
      });
    }
    schedulePersist();
  }

  function makeEditableOnClick(el) {
    if (el.isContentEditable) return;
    el.setAttribute('contenteditable', 'true');
    el.classList.add('editor-editing');
    el.focus();
    document.execCommand && placeCaretAtEnd(el);

    function onKeydown(e) {
      if (e.key === 'Enter' && el.tagName !== 'P') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); el.blur(); }
    }
    function commit() {
      el.removeAttribute('contenteditable');
      el.classList.remove('editor-editing');
      el.removeEventListener('blur', commit);
      el.removeEventListener('keydown', onKeydown);
      saveTextForEl(el);
    }
    el.addEventListener('blur', commit);
    el.addEventListener('keydown', onKeydown);
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // -- Image editing --------------------------------------------------
  function setImageMockup(img, type) {
    api.applyMockup(img, type);
    const block = blockOf(img);
    if (block) {
      block.device = type;
    } else {
      const key = img.dataset.origSrc;
      const data = getData();
      const existing = (data.edits[key] && data.edits[key].kind === 'image') ? data.edits[key] : { kind: 'image' };
      existing.mockup = type;
      data.edits[key] = existing;
    }
    schedulePersist();
  }

  function setImageWidth(img, width) {
    api.getMockupTarget(img).style.width = width;
    const block = blockOf(img);
    if (block) {
      block.width = width;
    } else {
      const key = img.dataset.origSrc;
      const data = getData();
      const existing = (data.edits[key] && data.edits[key].kind === 'image') ? data.edits[key] : { kind: 'image' };
      existing.width = width;
      data.edits[key] = existing;
    }
    schedulePersist();
  }

  function setImageSrc(img, url) {
    img.src = url;
    const block = blockOf(img);
    if (block) {
      block.imageSrc = url;
    } else {
      const key = img.dataset.origSrc;
      const data = getData();
      const existing = (data.edits[key] && data.edits[key].kind === 'image') ? data.edits[key] : { kind: 'image' };
      existing.src = url;
      data.edits[key] = existing;
    }
    schedulePersist();
  }

  function pickReplacementImage(img) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const block = blockOf(img);
      const key = block ? block.id : img.dataset.origSrc;
      try {
        const url = await api.uploadImage(key, file);
        setImageSrc(img, url);
      } catch (e) {
        console.error('[editor] upload failed', e);
        alert('Upload failed: ' + e.message);
      }
    });
    input.click();
  }

  // -- Hover badge (mockup type + replace image) -----------------------
  function ensureBadge() {
    if (badgeEl) return badgeEl;
    badgeEl = document.createElement('div');
    badgeEl.className = 'editor-badge';
    badgeEl.innerHTML =
      '<button class="editor-badge__btn" data-type="replace" title="Replace image">\u{1F4F7}</button>' +
      '<button class="editor-badge__btn" data-type="phone-ios" title="iPhone">\u{1F4F1}</button>' +
      '<button class="editor-badge__btn" data-type="phone-android" title="Android">\u{1F916}</button>' +
      '<button class="editor-badge__btn" data-type="desktop-mac" title="Mac">\u{1F5A5}</button>' +
      '<button class="editor-badge__btn" data-type="desktop-windows" title="PC (Windows)">\u{1FA9F}</button>' +
      '<button class="editor-badge__btn" data-type="none" title="Remove mockup">✕</button>';
    document.body.appendChild(badgeEl);
    badgeEl.addEventListener('click', e => {
      const btn = e.target.closest('.editor-badge__btn');
      if (!btn || !badgeEl.currentImg) return;
      const img = badgeEl.currentImg;
      if (btn.dataset.type === 'replace') pickReplacementImage(img);
      else setImageMockup(img, btn.dataset.type);
      deselectImage();
    });
    return badgeEl;
  }

  function positionBadge(img) {
    const rect = api.getMockupTarget(img).getBoundingClientRect();
    const badge = ensureBadge();
    badge.style.display = 'flex';
    const top = Math.max(8, rect.top - 44);
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - 120),
      window.innerWidth - 248
    );
    badge.style.top = top + 'px';
    badge.style.left = left + 'px';
    badge.currentImg = img;
  }

  function hideBadge() { if (badgeEl) badgeEl.style.display = 'none'; }

  // -- Selection (click an image to pin its badge/handle open) -----------
  function selectImage(img) {
    if (selectedImg && selectedImg !== img) selectedImg.classList.remove('editor-selected');
    selectedImg = img;
    img.classList.add('editor-selected');
    positionBadge(img);
    positionResizeHandle(img);
  }

  function deselectImage() {
    if (!selectedImg) return;
    selectedImg.classList.remove('editor-selected');
    selectedImg = null;
    hideBadge();
    hideResizeHandle();
  }

  // Keep the badge/handle glued to the selected image while the page scrolls
  // or the viewport resizes, since the selection now persists indefinitely.
  function repositionSelection() {
    if (!selectedImg) return;
    positionBadge(selectedImg);
    positionResizeHandle(selectedImg);
  }
  window.addEventListener('scroll', repositionSelection, true);
  window.addEventListener('resize', repositionSelection);

  // -- Resize handle ----------------------------------------------------
  function ensureResizeHandle() {
    if (resizeHandleEl) return resizeHandleEl;
    resizeHandleEl = document.createElement('div');
    resizeHandleEl.className = 'editor-resize-handle';
    document.body.appendChild(resizeHandleEl);

    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    let target = null;

    resizeHandleEl.addEventListener('mousedown', e => {
      if (!resizeHandleEl.currentImg) return;
      dragging = true;
      target = api.getMockupTarget(resizeHandleEl.currentImg);
      startX = e.clientX;
      startWidth = target.getBoundingClientRect().width;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging || !target) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(80, Math.round(startWidth + delta));
      target.style.width = newWidth + 'px';
      positionResizeHandle(resizeHandleEl.currentImg);
    });
    window.addEventListener('mouseup', () => {
      if (dragging && target) setImageWidth(resizeHandleEl.currentImg, target.style.width);
      dragging = false;
      target = null;
    });
    return resizeHandleEl;
  }

  // NOTE: the handle is position:fixed, so its coordinates must stay
  // viewport-relative (no + window.scrollY/scrollX) — matching positionBadge.
  function positionResizeHandle(img) {
    const rect = api.getMockupTarget(img).getBoundingClientRect();
    const handle = ensureResizeHandle();
    handle.style.display = 'block';
    handle.style.top = (rect.bottom - 8) + 'px';
    handle.style.left = (rect.right - 8) + 'px';
    handle.currentImg = img;
  }

  function hideResizeHandle() { if (resizeHandleEl) resizeHandleEl.style.display = 'none'; }

  // -- Click delegation ---------------------------------------------------
  function markCandidates() {
    document.querySelectorAll(IMAGE_CANDIDATE_SELECTOR).forEach(el => {
      el.classList.add('editor-candidate');
      el.dataset.editorKind = 'image';
    });
    api.textCandidates().forEach(el => {
      el.classList.add('editor-candidate');
      el.dataset.editorKind = 'text';
    });
  }

  function onClick(e) {
    if (!document.body.classList.contains('editor-mode')) return;
    const el = e.target.closest('.editor-candidate');
    if (el && el.dataset.editorKind === 'text') {
      deselectImage();
      if (el.tagName === 'A' || el.closest('a')) e.preventDefault();
      makeEditableOnClick(el);
      return;
    }
    if (el && el.dataset.editorKind === 'image') {
      if (el.closest('a')) e.preventDefault(); // e.g. project-card images double as links
      selectImage(el);
      return;
    }
    // Clicking the badge/handle themselves is handled by their own listeners;
    // anything else clicked while an image is selected deselects it.
    if (badgeEl && badgeEl.contains(e.target)) return;
    if (resizeHandleEl && resizeHandleEl.contains(e.target)) return;
    deselectImage();
  }

  // -- Blocks (case-study pages) ------------------------------------------
  function setMockupBg(wrap, block, color) {
    const bgEl = wrap.querySelector('.cs-mockup-bg');
    if (!bgEl) return;
    if (color) {
      bgEl.classList.add('cs-mockup-bg--filled');
      bgEl.style.backgroundColor = color;
      block.bg = color;
    } else {
      bgEl.classList.remove('cs-mockup-bg--filled');
      bgEl.style.backgroundColor = '';
      block.bg = null;
    }
    schedulePersist();
  }

  function addBlockControls(wrap, block) {
    if (wrap.querySelector('.cs-block__controls')) return;
    const controls = document.createElement('div');
    controls.className = 'cs-block__controls';
    controls.innerHTML =
      '<button data-action="up" title="Move up">↑</button>' +
      '<button data-action="down" title="Move down">↓</button>' +
      '<button data-action="delete" title="Delete block">✕</button>';
    if (block.type === 'mockup') {
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'cs-block__bg-input';
      colorInput.title = 'Background color';
      colorInput.value = block.bg || '#f4efe6';
      colorInput.addEventListener('input', () => setMockupBg(wrap, block, colorInput.value));
      controls.insertBefore(colorInput, controls.firstChild);

      const noneBtn = document.createElement('button');
      noneBtn.dataset.action = 'bg-none';
      noneBtn.title = 'No background';
      noneBtn.textContent = '⊘';
      controls.insertBefore(noneBtn, colorInput.nextSibling);
    }
    controls.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'bg-none') { setMockupBg(wrap, block, null); return; }
      const data = getData();
      const idx = data.blocks.findIndex(b => b.id === block.id);
      if (idx === -1) return;
      if (btn.dataset.action === 'delete') {
        if (!confirm('Delete this block?')) return;
        data.blocks.splice(idx, 1);
        wrap.remove();
      } else if (btn.dataset.action === 'up' && idx > 0) {
        const tmp = data.blocks[idx - 1];
        data.blocks[idx - 1] = data.blocks[idx];
        data.blocks[idx] = tmp;
        wrap.parentNode.insertBefore(wrap, wrap.previousElementSibling);
      } else if (btn.dataset.action === 'down' && idx < data.blocks.length - 1) {
        const tmp = data.blocks[idx + 1];
        data.blocks[idx + 1] = data.blocks[idx];
        data.blocks[idx] = tmp;
        const next = wrap.nextElementSibling;
        if (next) wrap.parentNode.insertBefore(next, wrap);
      }
      schedulePersist();
    });
    wrap.appendChild(controls);
  }

  function ensureBlockControlsForExisting() {
    if (!api.isCaseStudy) return;
    const data = getData();
    document.querySelectorAll('#cs-blocks .cs-block').forEach(wrap => {
      const block = data.blocks.find(b => b.id === wrap.dataset.blockId);
      if (block) addBlockControls(wrap, block);
    });
  }

  function addBlock(type) {
    const container = document.getElementById('cs-blocks');
    if (!container) return;
    const data = getData();
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const block = { id, type };
    if (type === 'mockup') block.device = 'phone-ios';
    data.blocks.push(block);
    const wrap = api.renderBlock(block);
    addBlockControls(wrap, block);
    container.appendChild(wrap);
    markCandidates();
    schedulePersist();
  }

  // -- Panel --------------------------------------------------------------
  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.className = 'editor-panel';
    const addButtons = api.isCaseStudy
      ? '<button class="editor-panel__btn" data-action="add-heading">+ Heading</button>' +
        '<button class="editor-panel__btn" data-action="add-paragraph">+ Text</button>' +
        '<button class="editor-panel__btn" data-action="add-mockup">+ Mockup</button>'
      : '';
    panelEl.innerHTML =
      '<span class="editor-save-status"></span>' +
      '<span class="editor-panel__count"></span>' +
      addButtons +
      '<button class="editor-panel__btn" data-action="reset">Reset page</button>' +
      '<button class="editor-panel__btn" data-action="signout">Log out</button>';
    document.body.appendChild(panelEl);
    panelEl.addEventListener('click', async e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'reset') {
        if (!confirm('Reset all edits on this page? This cannot be undone.')) return;
        window.__pageContent = { edits: {}, blocks: [] };
        try { await api.savePage(window.__pageContent); } catch (e) { /* ignore, reload anyway */ }
        location.reload();
      } else if (action === 'signout') {
        await api.signOut();
        stopEditing();
      } else if (action === 'add-heading') addBlock('heading');
      else if (action === 'add-paragraph') addBlock('paragraph');
      else if (action === 'add-mockup') addBlock('mockup');
    });
    return panelEl;
  }

  function updatePanelCount() {
    if (!panelEl) return;
    const data = getData();
    const count = Object.keys(data.edits).length + data.blocks.length;
    panelEl.querySelector('.editor-panel__count').textContent = count + (count === 1 ? ' change' : ' changes');
  }

  function showSaveStatus(text) {
    if (!panelEl) return;
    panelEl.querySelector('.editor-save-status').textContent = text;
  }

  // -- Auth modal -----------------------------------------------------------
  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'editor-modal';
    modalEl.innerHTML =
      '<div class="editor-modal__card">' +
        '<p class="editor-modal__title">Enter editor</p>' +
        '<input type="password" class="editor-modal__input" placeholder="Secret code" autocomplete="off" />' +
        '<p class="editor-modal__error"></p>' +
        '<div class="editor-modal__actions">' +
          '<button class="editor-panel__btn" data-action="cancel">Cancel</button>' +
          '<button class="editor-panel__btn editor-panel__btn--primary" data-action="submit">Enter</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modalEl);
    const input = modalEl.querySelector('.editor-modal__input');
    const errorEl = modalEl.querySelector('.editor-modal__error');

    function close() {
      modalEl.style.display = 'none';
      input.value = '';
      errorEl.textContent = '';
    }
    async function submit() {
      errorEl.textContent = '';
      try {
        await api.signIn(window.__OWNER_EMAIL__, input.value);
        close();
        startEditing();
      } catch (e) {
        errorEl.textContent = 'Wrong code — try again.';
      }
    }
    modalEl.addEventListener('click', e => {
      if (e.target === modalEl) { close(); return; }
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'cancel') close();
      if (btn.dataset.action === 'submit') submit();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    return modalEl;
  }

  function showModal() {
    ensureModal();
    modalEl.style.display = 'flex';
    modalEl.querySelector('.editor-modal__input').focus();
  }

  // -- Mode lifecycle -------------------------------------------------------
  function startEditing() {
    markCandidates();
    ensureBadge();
    ensurePanel();
    ensureBlockControlsForExisting();
    updatePanelCount();
    document.addEventListener('click', onClick, true);
    document.body.classList.add('editor-mode');
    document.querySelector('.editor-toggle')?.classList.add('is-active');
    if (panelEl) panelEl.style.display = 'flex';
  }

  function stopEditing() {
    document.body.classList.remove('editor-mode');
    document.querySelector('.editor-toggle')?.classList.remove('is-active');
    if (panelEl) panelEl.style.display = 'none';
    deselectImage();
  }

  window.__editorInit = function () {
    if (api.isSignedIn()) startEditing();
    else showModal();
  };

  window.__editorToggle = function () {
    if (document.body.classList.contains('editor-mode')) {
      stopEditing();
    } else if (api.isSignedIn()) {
      startEditing();
    } else {
      showModal();
    }
  };
})();
