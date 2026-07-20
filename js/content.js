/* ============================================================
   content.js — live content layer for the site.
   Loaded on EVERY page (visitors included), before editor.js.

   Two jobs:
     1. Hydrate: overlay saved edits/blocks on top of the
        hand-written HTML on every load, for every visitor.
     2. Expose window.__content — a small backend-agnostic API
        (read/write page content, upload images, sign in/out,
        device-mockup wrapping) that js/editor.js drives.

   Backed by Firestore/Storage/Auth once js/firebase-config.js is
   filled in with a real project config; until then it falls back
   automatically to a browser-local backend so the editor can be
   built and tested without a live Firebase project.
   ============================================================ */
(function () {
  'use strict';

  const IMAGE_SELECTOR =
    '.cs-img-grid img, .project-card__img, .phone-mockup__screen img, ' +
    '.desktop-mockup__screen img, .hero__tag-avatar, .about__blockquote-avatar';
  const TEXT_EXCLUDE_SELECTOR = 'nav, .footer, .lang-toggle';

  const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">' +
    '<rect width="800" height="500" fill="#ddd"/>' +
    '<text x="400" y="260" font-size="28" text-anchor="middle" fill="#999" font-family="sans-serif">Click to replace image</text>' +
    '</svg>'
  );

  const STATUSBAR_ICONS =
    '<svg width="15" height="10" viewBox="0 0 16 10" fill="#fff"><rect x="0" y="6" width="2.3" height="4" rx="0.5"/><rect x="4.3" y="4" width="2.3" height="6" rx="0.5"/><rect x="8.6" y="2" width="2.3" height="8" rx="0.5"/><rect x="12.9" y="0" width="2.3" height="10" rx="0.5"/></svg>' +
    '<svg width="14" height="11" viewBox="0 0 16 12" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><path d="M1 4.5C5.5 0.5 10.5 0.5 15 4.5"/><path d="M3.7 7.3C6.5 4.8 9.5 4.8 12.3 7.3"/><circle cx="8" cy="10" r="1" fill="#fff" stroke="none"/></svg>' +
    '<svg width="22" height="11" viewBox="0 0 24 12" fill="none"><rect x="0.5" y="0.5" width="20" height="11" rx="2.5" stroke="#fff" stroke-opacity=".6"/><rect x="2" y="2" width="15" height="8" rx="1.2" class="icon-battery-fill"/><rect x="21.5" y="4" width="2" height="4" rx="1" fill="#fff" fill-opacity=".6"/></svg>';

  // -- Slug -------------------------------------------------------
  function computeSlug() {
    const path = location.pathname;
    if (/\/cv\.html$/.test(path)) return 'cv';
    const csMatch = path.match(/case-studies\/([\w-]+)\.html$/);
    if (csMatch) return 'cs-' + csMatch[1];
    return 'index';
  }
  const SLUG = computeSlug();
  const isCaseStudy = SLUG.indexOf('cs-') === 0;

  // -- Stable ids for pre-existing text elements -------------------
  // Position-based path from the nearest ancestor with an id (or body).
  // Safe as long as new content is only ever appended, never inserted
  // before existing elements.
  function computeStableId(el) {
    // The hero renders its title/subtitle/tag twice (a blurred layer and a
    // sharp layer revealed by the mouse-spotlight effect) and the two
    // layers aren't structurally identical (the sharp layer has an extra
    // gloss div), so a DOM-position path would diverge between them. Both
    // copies should edit as one, so pair them by their order among the
    // layer's own text elements instead of by DOM position.
    const heroLayer = el.closest('.hero__layer--blur, .hero__layer--sharp');
    if (heroLayer) {
      const siblings = Array.from(heroLayer.querySelectorAll('[data-en]'));
      return 'herolayer:' + siblings.indexOf(el);
    }

    const parts = [];
    let node = el;
    while (node && node !== document.body && node.parentElement) {
      if (node.id) { parts.unshift('#' + node.id); break; }
      const parent = node.parentElement;
      const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      const idx = sameTag.indexOf(node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + idx + ')');
      node = parent;
    }
    return parts.join('>') || 'body';
  }

  function textCandidates() {
    return Array.from(document.querySelectorAll('[data-en]')).filter(el => !el.closest(TEXT_EXCLUDE_SELECTOR));
  }

  // Original (as-authored) src is the permanent identity of a static
  // image, independent of later replacements or DOM position.
  function tagOriginalImages() {
    document.querySelectorAll(IMAGE_SELECTOR).forEach(img => {
      if (!img.dataset.origSrc) img.dataset.origSrc = img.getAttribute('src') || '';
    });
  }

  // ==============================================================
  // Device mockup wrapping (shared by hydration and the editor UI)
  // ==============================================================
  function getMockupTarget(img) {
    return img.closest('.phone-mockup, .desktop-mockup') || img;
  }

  function unwrapMockup(img) {
    const wrapper = img.closest('.phone-mockup, .desktop-mockup');
    if (wrapper) {
      wrapper.parentNode.insertBefore(img, wrapper);
      wrapper.remove();
    }
  }

  function wrapAsPhone(img, variant) {
    unwrapMockup(img);
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
    if (window.__updatePhoneClocks) window.__updatePhoneClocks();
    return wrapper;
  }

  function wrapAsDesktop(img, variant) {
    unwrapMockup(img);
    const isWindows = variant === 'windows';
    const wrapper = document.createElement('div');
    wrapper.className = isWindows ? 'desktop-mockup desktop-mockup--windows reveal reveal-tilt' : 'desktop-mockup reveal reveal-tilt';
    wrapper.dataset.editorMockup = isWindows ? 'desktop-windows' : 'desktop-mac';
    const bar = document.createElement('div');
    bar.className = 'desktop-mockup__bar';
    bar.innerHTML = isWindows
      ? '<span class="desktop-mockup__wincontrols">' +
        '<span class="desktop-mockup__winbtn">–</span>' +
        '<span class="desktop-mockup__winbtn">□</span>' +
        '<span class="desktop-mockup__winbtn desktop-mockup__winbtn--close">✕</span>' +
        '</span>'
      : '<span class="desktop-mockup__dot desktop-mockup__dot--red"></span>' +
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
    else if (type === 'desktop-mac') wrapAsDesktop(img, 'mac');
    else if (type === 'desktop-windows') wrapAsDesktop(img, 'windows');
    else unwrapMockup(img);
  }

  // Images are stored inline (as data URLs) in Firestore rather than in
  // Cloud Storage, so every upload is resized/re-compressed client-side to
  // keep each one small enough that a page's whole document stays well
  // under Firestore's 1MB-per-document limit.
  function compressImageToDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ==============================================================
  // Backends
  // ==============================================================
  function makeLocalBackend() {
    const KEY = 'siteContent:' + SLUG;
    let authed = localStorage.getItem('siteEditorAuthed') === '1';
    const authListeners = [];
    function notifyAuth() { authListeners.forEach(cb => cb(authed)); }
    return {
      kind: 'local',
      async getPage() {
        try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { edits: {}, blocks: [] }; }
        catch (e) { return { edits: {}, blocks: [] }; }
      },
      async savePage(data) {
        localStorage.setItem(KEY, JSON.stringify(data));
      },
      async uploadImage(_key, file) {
        return await compressImageToDataUrl(file, 1280, 0.72);
      },
      async signIn(_email, code) {
        // Local dev stand-in only: any non-empty code "unlocks" this
        // backend. The real Firebase backend uses a genuine password.
        if (!code) throw new Error('Code required');
        authed = true;
        localStorage.setItem('siteEditorAuthed', '1');
        notifyAuth();
      },
      async signOut() {
        authed = false;
        localStorage.removeItem('siteEditorAuthed');
        notifyAuth();
      },
      isSignedIn() { return authed; },
      onAuthChange(cb) { authListeners.push(cb); cb(authed); },
    };
  }

  function makeFirebaseBackend() {
    const cfg = window.__FIREBASE_CONFIG__;
    const ownerEmail = window.__OWNER_EMAIL__;
    firebase.initializeApp(cfg);
    const db = firebase.firestore();
    const auth = firebase.auth();
    const docRef = db.collection('pages').doc(SLUG);
    let signedIn = false;
    const authListeners = [];
    auth.onAuthStateChanged(user => {
      signedIn = !!user;
      authListeners.forEach(cb => cb(signedIn));
    });
    return {
      kind: 'firebase',
      async getPage() {
        const snap = await docRef.get();
        return snap.exists ? snap.data() : { edits: {}, blocks: [] };
      },
      async savePage(data) {
        await docRef.set(Object.assign({}, data, {
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }));
      },
      async uploadImage(_key, file) {
        // No Cloud Storage on the Spark (free) plan — store a compressed
        // data URL inline in Firestore instead. Fine for a handful of
        // replaced images per page; switch this to a real Storage upload
        // if/when the project moves to the Blaze plan.
        return await compressImageToDataUrl(file, 1280, 0.72);
      },
      async signIn(email, password) {
        await auth.signInWithEmailAndPassword(email || ownerEmail, password);
      },
      async signOut() { await auth.signOut(); },
      isSignedIn() { return signedIn; },
      onAuthChange(cb) { authListeners.push(cb); cb(signedIn); },
    };
  }

  function firebaseConfigured() {
    const cfg = window.__FIREBASE_CONFIG__;
    return !!(cfg && cfg.apiKey && cfg.apiKey !== 'REPLACE_ME' && window.firebase);
  }

  const backend = firebaseConfigured() ? makeFirebaseBackend() : makeLocalBackend();

  // ==============================================================
  // Blocks (case-study "add heading / mockup / running text")
  // ==============================================================
  function currentLangValue(el, en, he) {
    const lang = document.documentElement.getAttribute('data-lang') || 'en';
    return lang === 'he' ? (he || en || '') : (en || he || '');
  }

  function renderBlock(block) {
    const wrap = document.createElement('div');
    wrap.className = 'cs-block cs-block--' + block.type + ' reveal';
    wrap.dataset.blockId = block.id;

    const inner = document.createElement('div');
    inner.className = 'cs-block__inner';
    wrap.appendChild(inner);

    if (block.type === 'heading') {
      const h = document.createElement('h2');
      h.className = 'cs-section__title cs-block__field';
      h.dataset.blockField = 'text';
      h.setAttribute('data-en', block.en || 'New heading');
      h.setAttribute('data-he', block.he || 'כותרת חדשה');
      h.textContent = currentLangValue(h, h.getAttribute('data-en'), h.getAttribute('data-he'));
      inner.appendChild(h);
    } else if (block.type === 'paragraph') {
      const p = document.createElement('p');
      p.className = 'cs-section__body cs-block__field';
      p.dataset.blockField = 'text';
      p.setAttribute('data-en', block.en || 'New paragraph text.');
      p.setAttribute('data-he', block.he || 'טקסט פסקה חדש.');
      p.textContent = currentLangValue(p, p.getAttribute('data-en'), p.getAttribute('data-he'));
      inner.appendChild(p);
    } else if (block.type === 'mockup') {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = block.imageSrc || PLACEHOLDER_IMG;
      img.dataset.blockField = 'image';
      inner.appendChild(img);
      applyMockup(img, block.device || 'phone-ios');
      // Must come after applyMockup: the mockup frame's CSS forces the raw
      // <img> to fill its screen slot, so the width belongs on the wrapper.
      if (block.width) getMockupTarget(img).style.width = block.width;
    }

    requestAnimationFrame(() => wrap.classList.add('visible'));
    return wrap;
  }

  function renderBlocks(blocks) {
    const container = document.getElementById('cs-blocks');
    if (!container) return;
    container.innerHTML = '';
    (blocks || []).forEach(b => container.appendChild(renderBlock(b)));
  }

  // ==============================================================
  // Hydration — apply saved edits/blocks on top of the static HTML
  // ==============================================================
  function applyTextEdit(el, edit) {
    if (edit.en) el.setAttribute('data-en', edit.en);
    if (edit.he) el.setAttribute('data-he', edit.he);
  }

  function applyImageEdit(img, edit) {
    if (edit.mockup) applyMockup(img, edit.mockup);
    if (edit.src) img.setAttribute('src', edit.src);
    if (edit.width) {
      getMockupTarget(img).style.width = edit.width;
    }
  }

  // Last-known-good copy of the page's saved edits, kept in localStorage so
  // a repeat visit can apply them the instant the DOM is ready instead of
  // waiting on the Firestore round-trip — the edits are what visitors should
  // see first, not a flash of the original hand-written HTML beforehand.
  const CACHE_KEY = 'siteContentCache:' + SLUG;

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); }
    catch (e) { /* storage full/unavailable — cache is a best-effort optimization */ }
  }

  function applyData(data) {
    data = data || {};
    data.edits = data.edits || {};
    data.blocks = data.blocks || [];
    window.__pageContent = data;

    textCandidates().forEach(el => {
      const edit = data.edits[computeStableId(el)];
      if (edit && edit.kind === 'text') applyTextEdit(el, edit);
    });

    document.querySelectorAll(IMAGE_SELECTOR).forEach(img => {
      const edit = data.edits[img.dataset.origSrc];
      if (edit && edit.kind === 'image') applyImageEdit(img, edit);
    });

    if (isCaseStudy) renderBlocks(data.blocks);

    if (window.__refreshLang) window.__refreshLang();
    if (window.__updatePhoneClocks) window.__updatePhoneClocks();
  }

  async function hydrate() {
    tagOriginalImages();

    const cached = readCache();
    if (cached) applyData(cached);

    let data;
    try {
      data = await backend.getPage();
    } catch (e) {
      console.warn('[content] failed to load page content', e);
      data = cached || { edits: {}, blocks: [] };
    }
    data = data || {};
    data.edits = data.edits || {};
    data.blocks = data.blocks || [];

    // Only re-apply (and re-render case-study blocks) if the fetch actually
    // turned up something different from what was already on screen.
    if (!cached || JSON.stringify(data) !== JSON.stringify(cached)) applyData(data);
    writeCache(data);

    document.dispatchEvent(new CustomEvent('content:hydrated'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrate);
  } else {
    hydrate();
  }

  // ==============================================================
  // Public API for editor.js
  // ==============================================================
  window.__content = {
    slug: SLUG,
    isCaseStudy,
    backendKind: backend.kind,
    imageSelector: IMAGE_SELECTOR,
    textExcludeSelector: TEXT_EXCLUDE_SELECTOR,
    placeholderImage: PLACEHOLDER_IMG,
    computeStableId,
    textCandidates,
    getMockupTarget,
    applyMockup,
    renderBlock,
    getPage: () => backend.getPage(),
    savePage: (data) => backend.savePage(data).then(() => writeCache(data)),
    uploadImage: (key, file) => backend.uploadImage(key, file),
    signIn: (email, code) => backend.signIn(email, code),
    signOut: () => backend.signOut(),
    isSignedIn: () => backend.isSignedIn(),
    onAuthChange: (cb) => backend.onAuthChange(cb),
  };
})();
