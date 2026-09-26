'use strict';
(() => {
  const endpoint = document.querySelector('meta[name="gallery-api-endpoint"]');
  if (!endpoint) return;
  const api = new URL(endpoint.content).origin;
  let visitorId;
  try {
    visitorId = localStorage.getItem('analytics-browser-id');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(visitorId || '')) {
      visitorId = crypto.randomUUID();
      localStorage.setItem('analytics-browser-id', visitorId);
    }
  } catch (_) {
    // Session fallback survives F5 when persistent storage is unavailable.
    try {
      visitorId = sessionStorage.getItem('analytics-browser-id') || crypto.randomUUID();
      sessionStorage.setItem('analytics-browser-id', visitorId);
    } catch (_) { return; } // No stable identifier: avoid misleading reload counts.
  }
  let registered = false;
  let pending = false;
  let lastSent = 0;
  async function send() {
    if (document.hidden || pending || Date.now() - lastSent < 120000) return;
    pending = true;
    lastSent = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(api + '/api/analytics/' + (registered ? 'heartbeat' : 'visit'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId }), signal: controller.signal,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
      });
      if (response.ok) registered = true;
    } catch (_) { /* Analytics never interrupts the public page. */ }
    finally { clearTimeout(timeout); pending = false; }
  }
  setTimeout(send, 0);
  setInterval(send, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void send(); });
})();
