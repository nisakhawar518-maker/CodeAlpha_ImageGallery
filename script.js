// Prism Gallery — JavaScript
// Adds: Lightbox modal + category filters (no frameworks)

import { UNSPLASH_ACCESS_KEY } from './config.js';

(function () {
  'use strict';

  // Hardening: if anything throws before the async fetch resolves,
  // ensure we stop the loading spinner and show a clear error.
  const __prismTopLevelError = (err) => {
    // Log full error for debugging.
    console.error(err);

    const prismLoadingEl = $('#prism-loading');
    const prismErrorEl = $('#prism-error');

    if (prismLoadingEl) prismLoadingEl.hidden = true;
    if (prismErrorEl) {
      const msg = (err && (err.message || err.toString()))
        ? (err.message || err.toString())
        : 'Unknown error while loading Unsplash images.';
      prismErrorEl.textContent = `Unsplash gallery error: ${msg}`;
      prismErrorEl.hidden = false;
    }
  };



  /* --------------------------------------------
     Helpers (small, focused utilities)
  -------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Gallery items are static <article> cards in index.html.
  // We'll update their <img> src/alt and captions dynamically from Unsplash.
  const items = $$('[data-prism-item]');

  for (let i = 0; i < items.length; i++) {
    items[i].style.setProperty('--prism-index', String(i));
  }


  /* --------------------------------------------
     DOM references
  -------------------------------------------- */
  const filtersEl = $('.prism-filters');
  // In case filtersEl exists, search within container.
  const safeFilterButtons = filtersEl ? $$('.prism-filter', filtersEl) : [];


  const lightboxEl = $('#prism-lightbox');
  const overlayEl = $('[data-lightbox-overlay]', lightboxEl);
  const closeBtn = $('[data-lightbox-close]', lightboxEl);
  const prevBtn = $('[data-lightbox-prev]', lightboxEl);
  const nextBtn = $('[data-lightbox-next]', lightboxEl);
  const lightboxImg = $('[data-lightbox-image]', lightboxEl);
  const lightboxCaption = $('[data-lightbox-caption]', lightboxEl);
  const lightboxTitle = $('#prism-lightbox-title');

  const prismLoadingEl = $('#prism-loading');
  const prismErrorEl = $('#prism-error');

  const ALL_CATEGORIES = ['all', 'nature', 'city', 'people'];


  /* --------------------------------------------
     State
  -------------------------------------------- */
  let activeCategory = 'all';
  let activeSearchQuery = '';
  let activeIndexInView = 0;

  /* --------------------------------------------
     Hero sync
  -------------------------------------------- */
  const heroFeaturedImg = $('#prism-hero-featured-img');
  const heroFeaturedCaption = $('#prism-hero-featured-caption');
  const heroFeaturedTitle = $('#prism-hero-featured-title');

  // We keep a reference to the currently selected card (for hero sync).
  let selectedCard = null;

  function setSelectedCard(card) {
    selectedCard = card || null;
    syncHeroFeaturedFromCard(selectedCard);
  }

  function syncHeroFeaturedFromCard(card) {
    if (!heroFeaturedImg || !heroFeaturedCaption) return;

    if (!card || !$('.thumb-img', card)) {
      // Fallback to first visible item.
      const visible = getVisibleItems();
      card = visible[0] || null;
    }

    if (!card) return;

    const img = $('.thumb-img', card);
    const captionEl = $('.thumb-label', card);

    const thumbSrc = img ? (img.getAttribute('src') || '') : '';
    const fullSrc = img ? (img.dataset.fullSrc || '') : '';
    const nextSrc = fullSrc || thumbSrc;

    const nextCaption = captionEl ? (captionEl.textContent || '').trim() : '';

    // Fade transition.
    heroFeaturedImg.classList.add('is-transitioning');
    const swap = () => {
      if (nextSrc) heroFeaturedImg.src = nextSrc;
      heroFeaturedImg.alt = nextCaption || 'Featured photography';
      heroFeaturedCaption.textContent = nextCaption || 'Featured photography';

      heroFeaturedImg.classList.remove('is-transitioning');
    };

    window.setTimeout(swap, 240);
  }

  /* --------------------------------------------
     Hero auto-cycle (cycles featured hero image through visible items)
     - Pauses while user hovers or when the lightbox is open
     - Temporarily pauses after explicit user interaction (click)
  -------------------------------------------- */
  let heroAutoCycleInterval = 6000; // ms
  let heroCycleTimer = null;
  let heroAutoCyclePaused = false;
  let heroPauseTimeout = null;
  const HERO_USER_PAUSE_MS = 8000;

  function startHeroAutoCycle() {
    stopHeroAutoCycle();
    heroCycleTimer = setInterval(() => {
      if (heroAutoCyclePaused) return;
      const visible = getVisibleItems();
      if (!visible || visible.length === 0) return;
      const current = selectedCard || visible[0];
      const idx = Math.max(0, visible.indexOf(current));
      const next = visible[(idx + 1) % visible.length];
      setSelectedCard(next);
    }, heroAutoCycleInterval);
  }

  function stopHeroAutoCycle() {
    if (heroCycleTimer) {
      clearInterval(heroCycleTimer);
      heroCycleTimer = null;
    }
  }

  function pauseHeroAutoCycleTemporary(ms = HERO_USER_PAUSE_MS) {
    heroAutoCyclePaused = true;
    if (heroPauseTimeout) clearTimeout(heroPauseTimeout);
    heroPauseTimeout = setTimeout(() => {
      heroAutoCyclePaused = false;
      heroPauseTimeout = null;
    }, ms);
  }

  function pauseHeroAutoCycle() {
    heroAutoCyclePaused = true;
    if (heroPauseTimeout) { clearTimeout(heroPauseTimeout); heroPauseTimeout = null; }
  }

  function resumeHeroAutoCycle() {
    heroAutoCyclePaused = false;
    if (!heroCycleTimer) startHeroAutoCycle();
  }

  // Pause on hover/focus of hero image
  if (heroFeaturedImg) {
    heroFeaturedImg.addEventListener('mouseenter', () => pauseHeroAutoCycle());
    heroFeaturedImg.addEventListener('mouseleave', () => resumeHeroAutoCycle());
    heroFeaturedImg.addEventListener('focus', () => pauseHeroAutoCycle());
    heroFeaturedImg.addEventListener('blur', () => resumeHeroAutoCycle());
  }

  function getVisibleItems() {
    // Always get the current/fresh list of items (important: cards are dynamically added/removed).
    const currentItems = $$('[data-prism-item]');

    // Includes both category + hero search query.
    const q = activeSearchQuery.trim().toLowerCase();

    if (activeCategory === 'all') {
      if (!q) return currentItems;
      return currentItems.filter((it) => {
        const cap = $('.thumb-label', it)?.textContent?.trim().toLowerCase() || '';
        return cap.includes(q);
      });
    }

    // Category filter active
    const base = currentItems.filter((it) => it.dataset.category === activeCategory);
    if (!q) return base;

    return base.filter((it) => {
      const cap = $('.thumb-label', it)?.textContent?.trim().toLowerCase() || '';
      return cap.includes(q);
    });
  }


  /* --------------------------------------------
     Lightbox
  -------------------------------------------- */
  function openLightbox(index) {
    const visible = getVisibleItems();
    if (!visible.length) return;

    // Pause hero auto-cycle while lightbox is open so it doesn't change behind the modal.
    pauseHeroAutoCycle();

    // Normalize index into visible array.
    activeIndexInView = (index + visible.length) % visible.length;
    const item = visible[activeIndexInView];

    const img = $('.thumb-img', item);
    const caption = $('.thumb-label', item);

    // Fade strategy: briefly fade image, then swap src.
    lightboxImg.classList.add('is-fading');

    // Prepare content.
    // When we fetch from Unsplash, we store the best full-size URL in `data-full-src`.
    // Fallback to the thumbnail `src` if `data-full-src` isn't present.
    const largeSrc = img ? (img.dataset.fullSrc || img.getAttribute('src') || '') : '';
    const alt = img ? (img.getAttribute('alt') || '') : '';

    lightboxImg.src = largeSrc;
    lightboxImg.alt = alt;


    lightboxCaption.textContent = caption ? caption.textContent : '';
    lightboxTitle.textContent = caption ? caption.textContent : 'Prism image';

    // Ensure the fade-out completes before fade-in.
    requestAnimationFrame(() => {
      // Force reflow so the class toggling is reliable.
      void lightboxImg.offsetHeight;
      lightboxImg.classList.remove('is-fading');
    });

    lightboxEl.setAttribute('aria-hidden', 'false');

    // Prevent background scrolling.
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }


  function closeLightbox() {
    if (lightboxEl.getAttribute('aria-hidden') === 'true') return;

    lightboxEl.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';

    // Resume hero auto-cycle after closing the lightbox.
    resumeHeroAutoCycle();
  }

  function showNextImage() {
    const visible = getVisibleItems();
    if (!visible.length) return;

    openLightbox(activeIndexInView + 1);
  }

  function showPrevImage() {
    const visible = getVisibleItems();
    if (!visible.length) return;

    openLightbox(activeIndexInView - 1);
  }

  /* --------------------------------------------
     Unsplash integration (NEW)
  -------------------------------------------- */

  // Unsplash integration
  // We fetch images using the Search endpoint:
  //   GET https://api.unsplash.com/search/photos?query=<q>&per_page=<n>&page=<p>
  // and map the returned metadata into dynamically created gallery cards.

  const UNSPLASH_QUERIES = {
    nature: 'nature',
    city: 'city',
    people: 'people'
  };

  const CATEGORY_ORDER = ['nature', 'city', 'people'];

  // Initial + batch sizes (requirements ask 30–50 initially)
  const INITIAL_PER_CATEGORY = 12; // 12 * 3 = 36 total initially
  const LOAD_MORE_PER_CATEGORY = 8; // adds 24 more per click

  // Pagination state per category to avoid repeating results.
  const pageByCategory = {
    nature: 1,
    city: 1,
    people: 1
  };


  function showLoading(show) {

    if (!prismLoadingEl || !prismErrorEl) return;
    prismLoadingEl.hidden = !show;
    if (show) prismErrorEl.hidden = true;

  }

  function showError(message) {

    if (!prismLoadingEl || !prismErrorEl) return;
    prismErrorEl.textContent = message;
    prismErrorEl.hidden = false;

  }

  function captionFromUnsplash(photo) {
    // Use alt_description or description as requested, with a fallback.
    const alt = photo?.alt_description;
    const desc = photo?.description;
    return (alt || desc || 'Untitled').trim();
  }

  async function fetchImagesByCategory(category, count, page) {

    // IMPORTANT:
    // Unsplash API requires `Authorization: Client-ID <access_key>`.
    // In this project, we call the Search endpoint:
    //   GET https://api.unsplash.com/search/photos?query=<query>&per_page=<count>
    // and then return `count` mapped results.

    const query = UNSPLASH_QUERIES[category] || category;
    const url = new URL('https://api.unsplash.com/search/photos');
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(count));
    // Pagination: ensures each subsequent request returns a different page.
    url.searchParams.set('page', String(page));



    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`
      }
    });


    if (!res.ok) {
      // Try to parse Unsplash error payload for a friendlier message.
      let msg = `Unsplash request failed (${res.status}).`;
      try {
        const data = await res.json();
        msg = data?.errors?.[0]?.title || data?.errors?.[0]?.detail || msg;
      } catch {
        // ignore parse errors
      }
      throw new Error(msg);
    }

    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];


    // Unsplash might return fewer than `count` results.
    const picked = results.slice(0, count);

    return picked.map((photo) => {
      const caption = captionFromUnsplash(photo);
      const thumb = photo?.urls?.regular || photo?.urls?.small || '';
      const full = photo?.urls?.full || photo?.urls?.regular || thumb;

      return {
        category,
        caption,
        thumbUrl: thumb,
        fullUrl: full
      };
    });
  }

  function createCard(photo, indexInAll) {
    const category = photo.category;
    const caption = photo.caption || 'Untitled';

    const article = document.createElement('article');
    article.className = 'thumb-card';
    article.setAttribute('role', 'listitem');
    article.dataset.prismItem = '';
    article.dataset.category = category;
    article.style.setProperty('--prism-index', String(indexInAll));

    const figure = document.createElement('figure');
    figure.className = 'thumb-figure';

    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = '900';
    img.height = '650';
    img.alt = caption;
    img.src = photo.thumbUrl;
    img.dataset.fullSrc = photo.fullUrl;

    const figcaption = document.createElement('figcaption');
    figcaption.className = 'thumb-overlay';
    figcaption.setAttribute('aria-hidden', 'true');

    const span = document.createElement('span');
    span.className = 'thumb-label';
    span.textContent = caption;

    // Skeleton placeholder (visible until the image is decoded/loaded)
    const skeleton = document.createElement('div');
    skeleton.className = 'thumb-skeleton';

    figcaption.appendChild(span);

    // Insert order: skeleton (absolute), image, caption so skeleton sits above until removed
    figure.appendChild(skeleton);
    figure.appendChild(img);
    figure.appendChild(figcaption);
    article.appendChild(figure);

    // Mark newly created cards for staggered reveal
    article.classList.add('is-new');

    // Ensure the newly-created image starts hidden until ready
    img.dataset.loading = 'true';
    img.style.opacity = '0';

    // Click-to-open lightbox must work for newly created cards too.
    article.style.cursor = 'pointer';
    article.addEventListener('click', () => {
      // Pause auto-cycle briefly when user interacts directly.
      pauseHeroAutoCycleTemporary();

      // Sync hero to the selected card for immediate feedback.
      setSelectedCard(article);

      const visible = getVisibleItems();
      const visibleIndex = visible.indexOf(article);
      openLightbox(visibleIndex >= 0 ? visibleIndex : 0);
    });

    return article;
  }

  let cardCursor = 0;
  let isInitialLoadDone = false;


  async function populateGalleryFromUnsplash({ append }) {
  

    // If user forgot to set an access key, show an error and keep placeholders.
    if (!UNSPLASH_ACCESS_KEY || UNSPLASH_ACCESS_KEY.includes('YOUR_ACCESS_KEY')) {
      // Clear any previous state.
      if (prismErrorEl) prismErrorEl.hidden = true;
      showError('Unsplash access key is missing. Paste your API key in config.js.');
      return;
    }

    const galleryGrid = $('#gallery');
    const gridItems = $$('[data-prism-item]', galleryGrid);

    if (!galleryGrid) return;

    // On append:false we rebuild from scratch in loadInitial(), so we can assume a fresh DOM.
    // On append:true we may need to create new cards to fit new photos.


    // Hide stale errors at the very start of each load attempt (required).
    if (prismErrorEl) {
      prismErrorEl.hidden = true;
      prismErrorEl.textContent = '';
    }

    showLoading(true);



    // If appending and a category filter is active (not 'all'), only fetch that category.
    const perCategoryCount = append ? LOAD_MORE_PER_CATEGORY : INITIAL_PER_CATEGORY;
    const categoriesInOrder = (append && activeCategory && activeCategory !== 'all') ? [activeCategory] : CATEGORY_ORDER;

    // If a category has already reached many pages due to failures, we still keep it advancing.



    // Use allSettled so that partial success doesn't trigger the generic error bar.

    const fetches = categoriesInOrder.map((cat) => {
      const page = pageByCategory[cat] || 1;
      return fetchImagesByCategory(cat, perCategoryCount, page);
    });

    // Advance pagination only after requests are scheduled.
    // This ensures we don't repeat pages on subsequent clicks.
    for (const cat of categoriesInOrder) {
      pageByCategory[cat] = (pageByCategory[cat] || 1) + 1;
    }

    const settled = await Promise.allSettled(fetches);



    const failedCategories = settled
      .map((s, i) => ({ status: s.status, cat: categoriesInOrder[i], reason: s.reason }))
      .filter((x) => x.status === 'rejected');

    // Flatten only fulfilled results.
    const byCategory = settled
      .filter((s) => s.status === 'fulfilled')
      .map((s) => /** @type {any} */(s.value));

    // Flatten to a total set for this batch.
    // For this implementation we always use the full batch size.
    const maxPhotosThisBatch = categoriesInOrder.length * perCategoryCount;
    const allPhotos = byCategory.flat().slice(0, maxPhotosThisBatch);



    // Update existing cards / create more cards as needed.
    let successfulCards = 0;
    let successfulLoadedImages = 0;
    const updatedImgEls = [];
    const newCards = [];

    for (let i = 0; i < allPhotos.length; i++) {
      const photo = allPhotos[i];
      if (!photo) continue;

      // If we already have a card at this index, reuse it; otherwise create/append.
      let card = gridItems[i];
      if (!card) {
        card = createCard(photo, cardCursor);
        cardCursor++;
        galleryGrid.appendChild(card);
        gridItems.push(card);
        newCards.push(card);
      }

      successfulCards++;
      card.dataset.category = photo.category;

      const img = $('.thumb-img', card);
      const captionEl = $('.thumb-label', card);

      if (img) {
        // Start with image visually hidden until decode/load completes.
        img.dataset.loading = 'true';
        img.style.opacity = '0';

        // Ensure a skeleton placeholder exists for existing cards too.
        const fig = img.closest('figure');
        if (fig && !$('.thumb-skeleton', fig)) {
          const skeleton = document.createElement('div');
          skeleton.className = 'thumb-skeleton';
          fig.insertBefore(skeleton, img);
        }

        img.src = photo.thumbUrl;
        img.alt = photo.caption || 'Untitled';
        img.dataset.fullSrc = photo.fullUrl;
        updatedImgEls.push(img);
      }

      if (captionEl) {
        captionEl.textContent = photo.caption || 'Untitled';
      }
    }


    // Refresh items visibility state.
    for (const it of gridItems) {
      it.style.display = '';
      it.style.opacity = '1';
      it.style.transition = '';
    }

    // Ensure new cards also get updated filter state.
    filterImages(activeCategory);


    // Wait for images to be ready (decode/load) before hiding spinner.
    const waitForImgReady = (imgEl) => {

      if (imgEl) {
      } else {
      }
      if (!imgEl) return Promise.resolve();

      const timeoutMs = 5000;

      // If already complete (cached), decode/load may be instant.
      const alreadyComplete = imgEl.complete && imgEl.naturalWidth > 0;
      if (alreadyComplete) {
        // decode() is best-effort; if it fails, still resolve.
        const decodeResult = (typeof imgEl.decode === 'function' ? imgEl.decode() : Promise.resolve());
        return decodeResult.then(() => {
        }).catch((e) => {
          console.warn('[prism] waitForImgReady: decode failed (continuing)', e);
        });
      }

      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };

        const t = window.setTimeout(() => {
          console.warn('[prism] waitForImgReady: timeout hit', {
            srcAttr: imgEl.getAttribute('src'),
            currentSrc: imgEl.currentSrc
          });
          finish();
        }, timeoutMs);

        imgEl.addEventListener('load', () => {
          window.clearTimeout(t);
          finish();
        }, { once: true });

        imgEl.addEventListener('error', () => {
          window.clearTimeout(t);
          console.error('[prism] waitForImgReady: img error', {
            srcAttr: imgEl.getAttribute('src'),
            currentSrc: imgEl.currentSrc,
            complete: imgEl.complete,
            naturalWidth: imgEl.naturalWidth
          });
          finish();
        }, { once: true });

        if (typeof imgEl.decode === 'function') {
          imgEl.decode().then(() => {
            // decode can succeed even if load event hasn't fired yet.
            window.clearTimeout(t);
            finish();
          }).catch(() => {
            // ignore decode failure; load/error handlers will resolve.
          });
        }
      });
    };

    try {

      // Advance pagination only after this batch request cycle completed.
      // If some categories failed, their page will remain advanced from request scheduling;
      // this prevents repeats on subsequent clicks.


      // Ensure one bad image doesn't break the entire spinner flow.
      const readinessResults = await Promise.allSettled(
        updatedImgEls.map((imgEl) =>
          waitForImgReady(imgEl).then(() => {
            // Consider it successfully loaded if decode/load resolved and natural size exists.
            if (imgEl && imgEl.naturalWidth > 0) {
              successfulLoadedImages++;
            }
          })
        )
      );

      const failures = readinessResults.filter((r) => r.status === 'rejected').length;
    } catch (e) {
      console.warn('[prism] populateGalleryFromUnsplash: image readiness wait failed (continuing)', e);
      // Even if readiness waiting fails for some reason, we still hide spinner after best effort.
    }

    showLoading(false);

    // Reveal images: remove skeletons and fade-in images that updated/loaded
    try {
      // Remove skeleton overlays and fade in updated images
      updatedImgEls.forEach((imgEl) => {
        try {
          imgEl.dataset.loading = 'false';
          imgEl.style.opacity = '1';
          const fig = imgEl.closest('figure');
          const sk = fig ? fig.querySelector('.thumb-skeleton') : null;
          if (sk) {
            // Match the tuned animation timing
            sk.style.transition = 'opacity 200ms ease';
            sk.style.opacity = '0';
            // Remove skeleton slightly sooner for snappier feel
            window.setTimeout(() => { if (sk && sk.parentNode) sk.parentNode.removeChild(sk); }, 200);
          }
        } catch (e) {
          console.warn('[prism] reveal img error', e);
        }
      });

      // Staggered reveal for newly appended cards
      if (typeof newCards !== 'undefined' && newCards.length) {
        newCards.forEach((card, idx) => {
          const delay = idx * 45; // slightly faster, bolder stagger
          window.setTimeout(() => {
            card.classList.add('is-revealed');
            // remove the new-card marker after animation completes
            window.setTimeout(() => {
              card.classList.remove('is-new', 'is-revealed');
            }, 480); // keep reveal visible slightly longer for bolder effect
          }, delay);
        });
      }
    } catch (e) {
      console.warn('[prism] post-load reveal failed', e);
    }

    // If there were any request failures, but at least one image loaded successfully,
    // keep the error bar hidden (requirement) and log failed request count.
    if (failedCategories.length) {
      console.warn('[prism] Unsplash partial failures (error bar kept hidden)', {
        failedRequestCount: failedCategories.length,
        failedCategories: failedCategories.map((f) => f.cat)
      });
    }




    // Error bar ONLY when actual failure: 0 images successfully loaded/decoded.
    if (successfulLoadedImages === 0) {
      const details = failedCategories.length
        ? `Failed categories: ${failedCategories.map((f) => f.cat).join(', ')}.`
        : 'No results returned from Unsplash.';


      // Try to surface one rejection reason if present.
      const firstReason = failedCategories[0]?.reason;
      const reasonMsg = firstReason?.message || firstReason?.toString?.() || '';
      const suffix = reasonMsg ? ` ${reasonMsg}` : '';

      showError(`Could not load Unsplash images. ${details}${suffix}`.trim());
      return;
    }

    // Partial failures: keep error bar hidden as requested.
    if (failedCategories.length) {
      console.warn('Partial Unsplash failure:', {
        failedCategoryCount: failedCategories.length,
        failedCategories: failedCategories.map((f) => f.cat),
        successfulLoadedImages,
        totalUpdatedImgEls: updatedImgEls.length,
        imageLoadFailures: Math.max(0, updatedImgEls.length - successfulLoadedImages)
      });
    }



    // Update hero featured image to first visible card after this batch finishes.
    try {
      const first = getVisibleItems()[0] || null;
      setSelectedCard(first);
    } catch (e) {
      console.warn('[prism] Could not sync hero after populate:', e);
    }

    // Update gallery statistics (Visible / Total Images, Categories)
    try {
      const totalEl = $('#prism-stat-total');
      const categoriesEl = $('#prism-stat-categories');
      // Prefer freshly queried items inside the gallery, but fall back to `items` helper.
      const galleryItems = $$('[data-prism-item]');
      const totalCount = galleryItems.length;
      const visibleCount = getVisibleItems().length;
      const cats = new Set(galleryItems.map((it) => (it.dataset.category || '').trim()).filter(Boolean));
      if (totalEl) totalEl.textContent = `${visibleCount} / ${totalCount}`;
      if (categoriesEl) categoriesEl.textContent = String(cats.size);
    } catch (e) {
      console.warn('[prism] Could not update stats:', e);
    }
  }

  /* --------------------------------------------
     Filters
  -------------------------------------------- */

  function setActiveFilterButton(category) {
    const buttons = safeFilterButtons.length ? safeFilterButtons : [];
    for (const btn of buttons) {
      const isActive = btn.dataset.filter === category;
      btn.setAttribute('aria-pressed', String(isActive));
    }
  }

  function filterImages(category) {
    if (!ALL_CATEGORIES.includes(category)) category = 'all';
    activeCategory = category;

    setActiveFilterButton(activeCategory);

    const visibleSet = getVisibleItems();
    const visibleSetSet = new Set(visibleSet);

    // Smooth fade: fade out non-matching, fade in matching.
   const currentItems = $$('[data-prism-item]');
    for (const it of currentItems) {
      const shouldShow = visibleSetSet.has(it);

      if (shouldShow) {
        // Show then fade in.
        it.style.transition = 'opacity 220ms ease';
        it.style.opacity = '0';
        it.style.display = '';

        requestAnimationFrame(() => {
          it.style.opacity = '1';
        });
      } else {
        it.style.transition = 'opacity 180ms ease';
        it.style.opacity = '0';

        // After fade-out, hide from layout.
        window.setTimeout(() => {
          // Only hide if filter hasn't changed mid-transition.
          if (activeCategory !== category) return;
          it.style.display = 'none';
        }, 190);
      }
    }

    // If lightbox is open, keep it consistent with the new view.
    if (lightboxEl.getAttribute('aria-hidden') === 'false') {
      openLightbox(activeIndexInView);
    }

    // Sync hero to the first visible item after filtering/searching.
    const visibleAfter = getVisibleItems();
    setSelectedCard(visibleAfter[0] || null);
  }

  /* --------------------------------------------
     Event wiring
  -------------------------------------------- */
  // Thumbnail click opens lightbox.
  items.forEach((item) => {
    item.style.cursor = 'pointer';

    // Click anywhere on the card. Also sync hero featured image.
    item.addEventListener('click', () => {
      // Temporarily pause auto-cycle on direct user interaction
      pauseHeroAutoCycleTemporary();

      setSelectedCard(item);

      const index = items.indexOf(item);
      // Map global index -> visible index.
      const visible = getVisibleItems();
      const visibleIndex = visible.indexOf(item);
      openLightbox(visibleIndex >= 0 ? visibleIndex : 0);
    });
  });

  // Filter buttons.
  const buttons = safeFilterButtons.length ? safeFilterButtons : [];
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const category = btn.dataset.filter;
      filterImages(category);
    });
  }

  // Close actions
  closeBtn && closeBtn.addEventListener('click', closeLightbox);

  // Click outside the image/panel closes: overlay handles this.
  overlayEl && overlayEl.addEventListener('click', closeLightbox);

  // Keyboard navigation.
  document.addEventListener('keydown', (e) => {
    if (lightboxEl.getAttribute('aria-hidden') !== 'false') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      showNextImage();
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      showPrevImage();
      return;
    }
  });

  prevBtn && prevBtn.addEventListener('click', showPrevImage);
  nextBtn && nextBtn.addEventListener('click', showNextImage);

  /* --------------------------------------------
     UI: Search, reveal-on-scroll, header scroll state
  -------------------------------------------- */
  // Hero search input wiring (real-time, debounced)
  const heroSearch = $('#prism-hero-search');
  const heroSearchClear = $('#prism-search-clear');
  let searchDebounceTimer = null;
  const SEARCH_DEBOUNCE_MS = 180;

  function handleSearchInput() {
    if (!heroSearch) return;
    const q = heroSearch.value || '';
    activeSearchQuery = String(q).trim();
    filterImages(activeCategory);
  }

  if (heroSearch) {
    heroSearch.addEventListener('input', () => {
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      searchDebounceTimer = window.setTimeout(handleSearchInput, SEARCH_DEBOUNCE_MS);
    });

    heroSearch.addEventListener('keydown', (e) => {
      // Immediate search on Enter
      if (e.key === 'Enter') {
        if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
        handleSearchInput();
      }
    });
  }

  if (heroSearchClear) {
    heroSearchClear.addEventListener('click', () => {
      if (heroSearch) heroSearch.value = '';
      activeSearchQuery = '';
      filterImages(activeCategory);
      heroSearch && heroSearch.focus();
    });
  }

  // Reveal on scroll for elements with .reveal
  const revealEls = Array.from(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const ent of entries) {
        if (ent.isIntersecting) {
          ent.target.classList.add('is-visible');
          io.unobserve(ent.target);
        }
      }
    }, { threshold: 0.12 });

    for (const el of revealEls) io.observe(el);
  } else {
    // Fallback: mark visible
    for (const el of revealEls) el.classList.add('is-visible');
  }

  // Header scrolled state for subtle shadow
  const headerEl = document.querySelector('.site-header');
  function onScrollHeader() {
    if (!headerEl) return;
    if (window.scrollY > 12) headerEl.classList.add('is-scrolled');
    else headerEl.classList.remove('is-scrolled');
  }
  window.addEventListener('scroll', onScrollHeader, { passive: true });
  onScrollHeader();

  /* Smooth scrolling (accounts for sticky header) and mobile nav toggle */
  (function setupSmoothScroll(){
    const headerHeight = () => (headerEl ? headerEl.offsetHeight : 0);
    const scrollToElement = (target) => {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const y = rect.top + window.scrollY - headerHeight() - 12;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    };

    // CTA / any element with data-scroll-to-gallery
    const ctas = Array.from(document.querySelectorAll('[data-scroll-to-gallery]'));
    for (const cta of ctas) {
      cta.addEventListener('click', (ev) => {
        ev.preventDefault();
        const target = document.querySelector('#gallery');
        scrollToElement(target);
      });
    }

    // Nav links with hashes
    const navLinks = Array.from(document.querySelectorAll('.nav-link[href^="#"]'));
    for (const a of navLinks) {
      a.addEventListener('click', (ev) => {
        const href = a.getAttribute('href');
        if (!href || !href.startsWith('#')) return;
        ev.preventDefault();
        const target = document.querySelector(href);
        if (target) scrollToElement(target);

        // Close mobile nav if open
        const mobileNav = document.getElementById('mobile-nav');
        const navToggle = document.querySelector('.nav-toggle');
        if (mobileNav && navToggle) {
          mobileNav.setAttribute('aria-hidden', 'true');
          navToggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Mobile nav toggle
    const navToggle = document.querySelector('.nav-toggle');
    const mobileNav = document.getElementById('mobile-nav');
    if (navToggle) {
      navToggle.addEventListener('click', () => {
        const expanded = navToggle.getAttribute('aria-expanded') === 'true';
        navToggle.setAttribute('aria-expanded', String(!expanded));
        if (mobileNav) mobileNav.setAttribute('aria-hidden', String(expanded));
      });
    }
  })();

  /* --------------------------------------------
     Initialize default filter state
  -------------------------------------------- */
  // Ensure items are visible on first load.
  for (const it of items) {
    it.style.display = '';
    it.style.opacity = '1';
    it.style.transition = '';
  }

  const loadMoreBtn = $('#prism-load-more');
  let isLoadingMore = false;

  async function loadInitial() {
    // Initial load should create/append enough cards beyond the 12 placeholders.
    // We clear existing cards and rebuild from the first batch so UX is consistent.
    // NOTE: Lightbox/filter logic depends on data-category, which we set per-card.
    const existing = $$('[data-prism-item]');
    const container = $('#gallery');
    if (!container) return;

    for (const node of existing) {
      node.remove();
    }

    cardCursor = 0;

    // Reset pagination
    pageByCategory.nature = 1;
    pageByCategory.city = 1;
    pageByCategory.people = 1;

    await populateGalleryFromUnsplash({ append: false });
    filterImages('all');
    isInitialLoadDone = true;
    // Start automated hero cycling once initial gallery is ready.
    try { startHeroAutoCycle(); } catch (e) { console.warn('[prism] Could not start hero auto-cycle:', e); }

  }

  async function loadMore() {
    if (isLoadingMore) return;
    if (!loadMoreBtn) return;

    isLoadingMore = true;
    loadMoreBtn.disabled = true;

    try {
      // Append a new batch.
      await populateGalleryFromUnsplash({ append: true });
    } catch (err) {
      __prismTopLevelError(err);
    } finally {
      isLoadingMore = false;
      loadMoreBtn.disabled = false;
    }
  }

    // Wire up load more
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      // Avoid load-more before initial build completes.
      if (!isInitialLoadDone) return;
      loadMore();
    });
  }


  // Load Unsplash images (replaces the placeholders).
  // If the request fails, the existing placeholders remain and a message is shown.
  try {
    // Run initial load asynchronously but keep the surrounding try/catch.
    loadInitial().catch((err) => __prismTopLevelError(err));
    filterImages('all');
  } catch (err) {
    __prismTopLevelError(err);
  }
})();





