/* ============================================================
   main.js — Arye Kupersmidt Portfolio v2
   ============================================================ */

'use strict';

// -- Language Toggle ----------------------------------------
const html        = document.documentElement;
const langToggle  = document.getElementById('langToggle');

const translations = {
  en: { dir: 'ltr', lang: 'en' },
  he: { dir: 'rtl', lang: 'he' },
};

function setLang(lang) {
  const config = translations[lang];
  html.setAttribute('lang', config.lang);
  html.setAttribute('dir', config.dir);
  html.setAttribute('data-lang', lang);

  // Update all elements with data-en / data-he attributes
  document.querySelectorAll('[data-en]').forEach(el => {
    const text = el.getAttribute(`data-${lang}`);
    if (text) el.textContent = text;
  });

  localStorage.setItem('lang', lang);
}

function toggleLang() {
  const current = html.getAttribute('data-lang') || 'en';
  setLang(current === 'en' ? 'he' : 'en');
}

if (langToggle) {
  langToggle.addEventListener('click', toggleLang);
}

// Restore saved language
const savedLang = localStorage.getItem('lang');
if (savedLang && savedLang !== 'en') {
  setLang(savedLang);
}

// -- Reveal on Scroll (IntersectionObserver) ----------------
const revealEls = document.querySelectorAll('.reveal:not([data-stack])');

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  revealEls.forEach(el => observer.observe(el));
} else {
  // Fallback: show all immediately
  revealEls.forEach(el => el.classList.add('visible'));
}

// -- Nav scroll state ---------------------------------------
const nav = document.querySelector('.nav');
if (nav) {
  window.addEventListener('scroll', () => {
    nav.style.borderBottomColor = window.scrollY > 10
      ? 'rgba(26,26,24,.15)'
      : 'rgba(26,26,24,.08)';
  }, { passive: true });
}

// -- Hero spotlight effect ----------------------------------
const heroEl     = document.querySelector('.hero');
const sharpLayer = document.querySelector('.hero__layer--sharp');

if (heroEl && sharpLayer) {
  const R    = 460;   // base spotlight radius px
  const LERP = 0.09;  // easing factor — lower = more lag / organic feel

  let targetX = 0, targetY = 0;     // raw cursor position (hero-relative)
  let currentX = 0, currentY = 0;   // lerped position (hero-relative)
  let targetCX = 0, targetCY = 0;   // raw cursor (viewport)
  let currentCX = 0, currentCY = 0; // lerped (viewport)
  let active = false;
  let rafId  = null;

  function lerp(a, b, t) { return a + (b - a) * t; }

  function animate() {
    currentX  = lerp(currentX,  targetX,  LERP);
    currentY  = lerp(currentY,  targetY,  LERP);
    currentCX = lerp(currentCX, targetCX, LERP);
    currentCY = lerp(currentCY, targetCY, LERP);

    // Velocity — radius grows slightly when moving fast
    const vx    = targetX - currentX;
    const vy    = targetY - currentY;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const r     = R + speed * 0.35;

    sharpLayer.style.clipPath = `circle(${r}px at ${currentX}px ${currentY}px)`;
    sharpLayer.style.setProperty('--spot-x', `${currentCX}px`);
    sharpLayer.style.setProperty('--spot-y', `${currentCY}px`);

    rafId = requestAnimationFrame(animate);
  }

  heroEl.addEventListener('mousemove', (e) => {
    const rect = heroEl.getBoundingClientRect();
    targetX  = e.clientX - rect.left;
    targetY  = e.clientY - rect.top;
    targetCX = e.clientX;
    targetCY = e.clientY;

    if (!active) {
      active = true;
      // Teleport lerped position to cursor on first entry — avoids sweeping from 0,0
      currentX = targetX;   currentY = targetY;
      currentCX = targetCX; currentCY = targetCY;
      sharpLayer.classList.add('is-active');
      if (!rafId) animate();
    }
  }, { passive: true });

  heroEl.addEventListener('mouseleave', () => {
    active = false;
    sharpLayer.classList.remove('is-active');
    cancelAnimationFrame(rafId);
    rafId = null;
    sharpLayer.style.clipPath = 'circle(0px at 50% 50%)';
  }, { passive: true });
}

// -- Smooth anchor scrolling --------------------------------
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', e => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const navH = document.querySelector('.nav')?.offsetHeight || 0;
      const top  = target.getBoundingClientRect().top + window.scrollY - navH - 24;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// -- TOC active item on scroll --------------------------------
(function () {
  const toc = document.querySelector('.cs-toc');
  if (!toc) return;

  const tocLinks = toc.querySelectorAll('.cs-toc__item');
  if (!tocLinks.length) return;

  const sectionIds = Array.from(tocLinks)
    .map(a => a.getAttribute('href')?.replace('#', ''))
    .filter(Boolean);

  const sections = sectionIds
    .map(id => document.getElementById(id))
    .filter(Boolean);

  function onScroll() {
    const scrollY = window.scrollY;
    const navH    = document.querySelector('.nav')?.offsetHeight || 0;
    const offset  = navH + 80; // a bit below nav

    let current = sections[0]?.id || '';
    sections.forEach(sec => {
      if (sec.getBoundingClientRect().top + scrollY - offset <= scrollY) {
        current = sec.id;
      }
    });

    tocLinks.forEach(a => {
      const id = a.getAttribute('href')?.replace('#', '');
      a.classList.toggle('active', id === current);
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // run once on load
})();
