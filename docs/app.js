(function () {
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  const saved = localStorage.getItem('lecturelens-docs-theme');
  root.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');

  const syncIcon = () => {
    const isDark = root.getAttribute('data-theme') === 'dark';
    if (toggle) toggle.textContent = isDark ? '☀' : '🌙';
  };
  syncIcon();
  toggle?.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('lecturelens-docs-theme', next);
    syncIcon();
  });

  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy');
      if (!text || !navigator.clipboard) return;
      try {
        await navigator.clipboard.writeText(text);
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = original;
        }, 1500);
      } catch {
        // Ignore clipboard permission errors on file://
      }
    });
  });

  const markMissing = (img) => {
    const card = img.closest('.shot-card');
    const trigger = img.closest('.shot-trigger');
    card?.classList.add('is-missing');
    if (trigger instanceof HTMLButtonElement) {
      trigger.disabled = true;
    }
  };

  document.querySelectorAll('.shot-media img').forEach((img) => {
    img.addEventListener('error', () => markMissing(img));
    if (img.complete && img.naturalWidth === 0) {
      markMissing(img);
    }
  });

  const lightbox = document.getElementById('shot-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxDesc = document.getElementById('lightbox-desc');
  const lightboxCounter = document.getElementById('lightbox-counter');
  const prevBtn = document.getElementById('lightbox-prev');
  const nextBtn = document.getElementById('lightbox-next');
  const closeBtn = document.getElementById('lightbox-close');
  let activeTriggers = [];
  let activeIndex = 0;
  let lastFocused = null;

  const getLoadedTriggers = () =>
    Array.from(document.querySelectorAll('.shot-trigger')).filter(
      (btn) => !btn.closest('.shot-card')?.classList.contains('is-missing'),
    );

  const renderLightbox = () => {
    const trigger = activeTriggers[activeIndex];
    const img = trigger?.querySelector('img');
    const src = img?.getAttribute('src');
    if (!trigger || !img || !lightboxImg || !src) return;
    lightboxImg.setAttribute('src', src);
    lightboxImg.setAttribute('alt', img.getAttribute('alt') || '');
    if (lightboxTitle) {
      lightboxTitle.textContent =
        trigger.getAttribute('data-shot-title') || 'Screenshot';
    }
    if (lightboxDesc) {
      lightboxDesc.textContent = trigger.getAttribute('data-shot-desc') || '';
    }
    if (lightboxCounter) {
      lightboxCounter.textContent = `${activeIndex + 1} / ${activeTriggers.length}`;
    }
  };

  const openLightbox = (trigger) => {
    activeTriggers = getLoadedTriggers();
    activeIndex = activeTriggers.indexOf(trigger);
    if (activeIndex < 0 || !lightbox) return;
    lastFocused = document.activeElement;
    renderLightbox();
    lightbox.hidden = false;
    closeBtn?.focus();
  };

  const closeLightbox = () => {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lightboxImg?.removeAttribute('src');
    lightboxImg?.setAttribute('alt', '');
    if (lastFocused instanceof HTMLElement) {
      lastFocused.focus();
    }
  };

  const stepLightbox = (delta) => {
    if (!activeTriggers.length) return;
    activeIndex =
      (activeIndex + delta + activeTriggers.length) % activeTriggers.length;
    renderLightbox();
  };

  document.querySelectorAll('.shot-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => openLightbox(trigger));
  });

  closeBtn?.addEventListener('click', closeLightbox);
  prevBtn?.addEventListener('click', () => stepLightbox(-1));
  nextBtn?.addEventListener('click', () => stepLightbox(1));
  lightbox?.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  window.addEventListener('keydown', (e) => {
    if (!lightbox || lightbox.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepLightbox(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepLightbox(1);
    }
  });
})();
