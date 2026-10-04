/* NASA Image and Video Library: search metadata, then resolve playable assets. */
(function (root) {
  'use strict';
  const API = 'https://images-api.nasa.gov';
  function searchUrl(query, type = 'image,video', page = 1) {
    const url = new URL(`${API}/search`);
    url.search = new URLSearchParams({ q: query.trim() || 'Mars', media_type: type,
      page: String(page), page_size: '12' });
    return url.href;
  }
  function nasaUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:') url.protocol = 'https:';
      return url.protocol === 'https:' && (url.hostname === 'nasa.gov' || url.hostname.endsWith('.nasa.gov')) ? url.href : null;
    } catch { return null; }
  }
  function results(payload) {
    return (Array.isArray(payload?.collection?.items) ? payload.collection.items : []).flatMap(item => {
      const data = item.data?.[0];
      if (!data || typeof data.nasa_id !== 'string' || !['image', 'video'].includes(data.media_type)) return [];
      return [{ id: data.nasa_id, title: String(data.title || data.nasa_id), type: data.media_type,
        date: String(data.date_created || '').slice(0, 10), credit: String(data.photographer || data.secondary_creator || data.center || 'NASA'),
        description: String(data.description_508 || data.description || ''),
        thumbnail: nasaUrl(item.links?.find(link => link.rel === 'preview')?.href) }];
    });
  }
  function assetUrl(payload, type) {
    const urls = (Array.isArray(payload?.collection?.items) ? payload.collection.items : [])
      .map(item => nasaUrl(item.href)).filter(Boolean)
      .filter(url => type === 'video' ? /\.mp4(?:\?|$)/i.test(url) : /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(url));
    // Prefer browser-sized files over potentially huge originals.
    const rank = url => /~medium\./i.test(url) ? 0 : /~small\./i.test(url) ? 1 : /~large\./i.test(url) ? 2 : 3;
    return urls.sort((a, b) => rank(a) - rank(b))[0] || null;
  }
  const api = { searchUrl, nasaUrl, results, assetUrl };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.MarsMedia = Object.freeze(api);
  const $ = id => document.getElementById(id);
  const dialog = $('media-library'), searchRequests = root.MarsData.createRequests(), assetRequests = root.MarsData.createRequests();
  let query = 'Mars', type = 'image,video', page = 1, hasNext = false, searchVersion = 0, assetVersion = 0;
  let loaded = false, previousFocus = null;
  function status(text) { $('media-status').textContent = text; }
  function clearDetail() {
    ++assetVersion; assetRequests.abortAll();
    $('media-player').querySelector('video')?.pause();
    $('media-player').replaceChildren(); $('media-detail').hidden = true;
  }
  async function select(item) {
    clearDetail();
    const version = assetVersion;
    $('media-detail').hidden = false;
    $('media-title').textContent = item.title;
    $('media-credit').textContent = `${item.credit} · ${item.date || 'Date unavailable'} · ${item.type}`;
    const description = new DOMParser().parseFromString(item.description, 'text/html').body.textContent;
    $('media-description').textContent = description;
    $('media-source').href = `https://images.nasa.gov/details/${encodeURIComponent(item.id)}`;
    $('media-file').hidden = true;
    $('media-detail-status').textContent = 'Loading media…';
    $('media-detail').scrollIntoView({ block: 'nearest' });
    $('media-title').focus();
    try {
      const payload = await assetRequests.read(`${API}/asset/${encodeURIComponent(item.id)}`);
      if (version !== assetVersion || !dialog.open) return;
      const url = assetUrl(payload, item.type);
      if (!url) throw new Error('No browser-compatible file');
      const media = document.createElement(item.type === 'video' ? 'video' : 'img');
      if (item.type === 'video') { media.controls = true; media.preload = 'metadata'; media.playsInline = true; }
      else media.alt = item.title;
      media.addEventListener('error', () => {
        if (version === assetVersion) $('media-detail-status').textContent = 'This file could not play or load. Try Open media file or View on NASA.';
      });
      media.src = url;
      $('media-player').replaceChildren(media);
      $('media-file').href = url; $('media-file').hidden = false;
      $('media-detail-status').textContent = item.type === 'video' ? 'Press play to watch. NASA source may provide captions or alternate formats.' : '';
    } catch {
      if (version === assetVersion && dialog.open) $('media-detail-status').textContent = 'Media unavailable. Select the result to retry, or view it on NASA.';
    }
  }
  async function search() {
    const version = ++searchVersion;
    searchRequests.abortAll(); clearDetail();
    $('media-results').replaceChildren();
    $('media-prev').disabled = $('media-next').disabled = true;
    $('media-results').setAttribute('aria-busy', 'true');
    status(`Searching NASA for “${query}”…`);
    try {
      const payload = await searchRequests.read(searchUrl(query, type, page));
      if (version !== searchVersion || !dialog.open) return;
      const items = results(payload);
      hasNext = payload.collection?.links?.some(link => link.rel === 'next') || false;
      for (const item of items) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'media-card';
        if (item.thumbnail) {
          const image = document.createElement('img'); image.src = item.thumbnail; image.alt = ''; image.loading = 'lazy';
          image.addEventListener('error', () => { image.hidden = true; }); button.append(image);
        }
        const title = document.createElement('strong'); title.textContent = item.title;
        const meta = document.createElement('span'); meta.textContent = `${item.type === 'video' ? '▶ Video' : 'Image'} · ${item.date || 'Undated'}`;
        button.append(title, meta); button.addEventListener('click', () => select(item));
        $('media-results').append(button);
      }
      const count = Number(payload.collection?.metadata?.total_hits);
      status(items.length ? `${Number.isFinite(count) ? count.toLocaleString() + ' results · ' : ''}Page ${page} · ${query}` : 'No results. Try another search or media type.');
      loaded = true;
    } catch {
      if (version === searchVersion && dialog.open) { loaded = false; hasNext = false; status('NASA search unavailable. Check your connection and press Search to retry.'); }
    } finally {
      if (version === searchVersion) {
        $('media-results').setAttribute('aria-busy', 'false');
        $('media-prev').disabled = page <= 1; $('media-next').disabled = !hasNext;
      }
    }
  }
  $('site-media').addEventListener('click', event => {
    // Modified clicks retain the ordinary NASA search link behavior.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    query = $('site-media').dataset.query;
    if (!query) return;
    type = 'image,video'; page = 1; hasNext = false;
    $('media-query').value = query;
    $('media-type').value = type;
    $('media-heading').textContent = `NASA media · ${query}`;
    previousFocus = document.activeElement; dialog.showModal(); $('media-query').focus();
    search();
  });
  $('close-media').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  dialog.addEventListener('close', () => {
    ++searchVersion; searchRequests.abortAll(); clearDetail(); previousFocus?.focus();
    if ($('media-results').getAttribute('aria-busy') === 'true') loaded = false;
  });
  $('media-form').addEventListener('submit', event => {
    event.preventDefault(); query = $('media-query').value.trim() || 'Mars'; type = $('media-type').value; page = 1; search();
  });
  $('media-prev').addEventListener('click', () => { if (page > 1) { page--; search(); } });
  $('media-next').addEventListener('click', () => { if (hasNext) { page++; search(); } });
  window.addEventListener('pagehide', () => { searchRequests.abortAll(); clearDetail(); });
})(typeof window === 'object' ? window : globalThis);
