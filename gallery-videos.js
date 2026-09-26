'use strict';
(() => {
  const panel = document.querySelector('#gallery-videos-panel');
  const columns = document.createElement('div');
  columns.className = 'gallery-columns video-columns';
  panel.append(columns);
  const dialog = document.querySelector('#gallery-video-dialog');
  const player = document.querySelector('#gallery-video-player');
  const caption = document.querySelector('#gallery-video-caption');
  const status = document.querySelector('#gallery-video-status');
  const close = document.querySelector('#gallery-video-close');
  const endpoint = new URL('/api/gallery/videos', galleryEndpoint).href;
  let items = [], loading = false, loaded = false, width = 0, entranceTimer, resizeTimer, opener;
  let entered = false, observer;
  const visible = new Set();
  const previews = new Set();
  const running = () => galleryActive && !galleryView.hidden && !panel.hidden && !document.hidden && !dialog.open;
  function playPreview(video) {
    if (!running() || galleryReducedMotion.matches || !visible.has(video)) { video.pause(); return; }
    if (!video.src) { video.src = video.dataset.src; video.load(); }
    const promise = video.play();
    if (promise) promise.then(() => {
      if (!running() || !visible.has(video) || galleryReducedMotion.matches) video.pause();
    }).catch(() => {});
  }
  function sync() {
    const enabled = running();
    panel.classList.toggle('is-running', enabled && entered && !galleryReducedMotion.matches);
    previews.forEach((video) => {
      if (enabled && visible.has(video)) playPreview(video);
      else video.pause();
    });
  }
  function shuffled() {
    const indices = items.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  }
  function render() {
    clearTimeout(entranceTimer);
    observer?.disconnect();
    previews.forEach((video) => { video.pause(); video.removeAttribute('src'); video.load(); });
    previews.clear(); visible.clear(); columns.replaceChildren();
    columns.classList.remove('is-entered'); entered = false;
    if (!items.length) return;
    const count = galleryColumnCount(); width = window.innerWidth;
    columns.style.setProperty('--gallery-count', count);
    const columnWidth = Math.min(window.innerWidth - 32, 1280) / count;
    const minimum = Math.ceil(window.innerHeight / Math.max(70, columnWidth * 16 / 9)) + 2;
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else {
          visible.delete(entry.target);
          entry.target.pause();
          if (entry.target.hasAttribute('src')) { entry.target.removeAttribute('src'); entry.target.load(); }
        }
        playPreview(entry.target);
      });
    }, { root: columns, threshold: .05 });
    for (let col = 0; col < count; col++) {
      const indices = shuffled();
      const sequence = indices.slice();
      while (sequence.length < minimum) sequence.push(...indices);
      const column = document.createElement('div'); column.className = 'gallery-column';
      column.dataset.direction = col % 2 ? 'down' : 'up';
      column.style.setProperty('--column-index', col);
      const track = document.createElement('div'); track.className = 'gallery-track';
      track.style.setProperty('--travel-duration', Math.max(32, Math.round(sequence.length * columnWidth / 18)) + 's');
      for (let copy = 0; copy < 2; copy++) {
        const set = document.createElement('div'); set.className = 'gallery-set';
        if (copy) set.setAttribute('aria-hidden', 'true');
        sequence.forEach((index, position) => {
          const item = items[index];
          const card = document.createElement('button'); card.type = 'button'; card.className = 'gallery-photo gallery-video-card';
          card.dataset.videoIndex = index;
          card.setAttribute('aria-label', 'Reproducir ' + (item.title || 'video'));
          if (copy || position >= indices.length) card.tabIndex = -1;
          const video = document.createElement('video');
          video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true;
          video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.preload = 'none';
          video.dataset.src = item.url; video.tabIndex = -1; video.setAttribute('aria-hidden', 'true');
          const play = document.createElement('span'); play.className = 'video-play-mark'; play.textContent = '▶'; play.setAttribute('aria-hidden', 'true');
          card.append(video, play); set.append(card); previews.add(video); observer.observe(video);
        });
        track.append(set);
      }
      column.append(track); columns.append(column);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      columns.classList.add('is-entered');
      entranceTimer = setTimeout(() => { entered = true; sync(); }, galleryReducedMotion.matches ? 0 : 700 + (count - 1) * 55);
    }));
    sync();
  }
  async function load() {
    if (loading || loaded) return;
    loading = true;
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error('Videos API HTTP ' + response.status);
      const payload = await response.json();
      if (!Array.isArray(payload.items)) throw new Error('Invalid videos list');
      items = payload.items.filter((item) => ![false, 0, '0', 'false'].includes(item.active)).map((item) => {
        try {
          const url = new URL(item.video_url || '/api/gallery/video/' + encodeURIComponent(item.id), endpoint);
          return ['http:', 'https:'].includes(url.protocol) ? { url: url.href, title: typeof item.title === 'string' ? item.title : '' } : null;
        } catch (_) { return null; }
      }).filter(Boolean);
      loaded = true; render();
    } catch (error) { console.error('No se pudo cargar la galería de videos:', error); }
    finally { loading = false; }
  }
  columns.addEventListener('click', (event) => {
    const card = event.target.closest('.gallery-video-card');
    if (!card) return;
    const item = items[Number(card.dataset.videoIndex)];
    if (!item) return;
    opener = card;
    player.src = item.url; player.currentTime = 0; player.muted = false;
    caption.textContent = item.title; caption.hidden = !item.title; status.textContent = '';
    dialog.showModal(); document.body.classList.add('gallery-video-open');
    document.dispatchEvent(new CustomEvent('gallery-video-audio', { detail: { open: true } }));
    sync(); close.focus();
    const promise = player.play();
    if (promise) promise.then(() => { if (!dialog.open || document.hidden) player.pause(); }).catch(() => { if (dialog.open) status.textContent = 'Pulsa reproducir para comenzar.'; });
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    player.pause(); player.removeAttribute('src'); player.load();
    document.body.classList.remove('gallery-video-open');
    document.dispatchEvent(new CustomEvent('gallery-video-audio', { detail: { open: false } }));
    opener?.focus({ preventScroll: true }); sync();
  });
  player.addEventListener('error', () => { if (dialog.open) status.textContent = 'No se pudo reproducir este video. Prueba con MP4 compatible con tu celular.'; });
  document.addEventListener('gallery-view-change', () => {
    if (!galleryActive || panel.hidden) { if (dialog.open) dialog.close(); }
    else load();
    sync();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) player.pause(); sync(); });
  window.addEventListener('pagehide', () => { player.pause(); previews.forEach((video) => video.pause()); });
  window.addEventListener('pageshow', sync);
  galleryReducedMotion.addEventListener('change', sync);
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (running() && items.length && Math.abs(width - window.innerWidth) > 40) render(); }, 180);
  });
})();