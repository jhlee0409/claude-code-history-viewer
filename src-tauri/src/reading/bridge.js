(() => {
  const nonce = '__BRIDGE_NONCE__';
  const send = (type, extra = {}) => window.parent.postMessage({channel: 'cchv-reading', version: 1, nonce, type, ...extra}, '*');
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (data.channel !== 'cchv-reading' || data.version !== 1 || data.nonce !== nonce) return;
    if (data.type === 'appearance') {
      document.documentElement.setAttribute('data-theme', data.isDark === true ? 'dark' : 'light');
      if (typeof data.fontScale === 'number' && data.fontScale >= 90 && data.fontScale <= 130) {
        document.documentElement.style.setProperty('--reading-font-scale', String(data.fontScale / 100));
      }
      document.documentElement.dataset.readingContrast = String(data.highContrast === true);
      const labels = data.labels;
      if (labels && typeof labels === 'object') {
        const mapping = {prompts:'[data-mn-depth="prompts"]', steps:'[data-mn-depth="steps"]', all:'[data-mn-depth="all"]', main:'[data-mn-branches="main"]', interleaved:'[data-mn-branches="interleaved"]', columns:'[data-mn-branches="columns"]'};
        for (const [key, selector] of Object.entries(mapping)) {
          if (typeof labels[key] !== 'string' || labels[key].length > 200) continue;
          document.querySelectorAll(selector).forEach(button => { button.textContent = labels[key]; button.title = labels[key]; });
        }
        if (typeof labels.search === 'string' && labels.search.length <= 200) {
          const search = document.getElementById('filterMessages');
          if (search) { search.title = labels.search; search.setAttribute('aria-label', labels.search); }
        }
      }
    }
    if (data.type === 'navigate' && typeof data.uuid === 'string' && data.uuid.length <= 200) {
      const found = typeof window.claudeLogRevealMessageByUuid === 'function' && window.claudeLogRevealMessageByUuid(data.uuid);
      send('navigated', {uuid: data.uuid, found: !!found});
    }
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (link && !link.getAttribute('href').startsWith('#')) event.preventDefault();
  }, true);
  let scheduled = false;
  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      const message = Array.from(document.querySelectorAll('[data-uuid]')).find(element => element.getBoundingClientRect().bottom > 80 && element.getClientRects().length);
      if (message) send('anchor', {uuid: message.dataset.uuid});
    }, 200);
  }, {passive: true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => send('ready'), {once: true});
  else send('ready');
})();
