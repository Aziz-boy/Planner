(function configurePlanner() {
  const configuredBase = window.PLANNER_API_URL || 'https://life-planner-bot-1r4w.onrender.com';
  const apiBaseUrl = String(configuredBase).replace(/\/+$/, '');

  window.PLANNER_CONFIG = Object.freeze({
    apiBaseUrl,
    requestTimeoutMs: 90000,
  });

  window.apiRequest = async function apiRequest(path, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || window.PLANNER_CONFIG.requestTimeoutMs;
    const { timeoutMs: _ignoredTimeout, ...fetchOptions } = options;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cleanPath = String(path || '').startsWith('/') ? path : `/${path}`;

    try {
      const response = await fetch(`${apiBaseUrl}${cleanPath}`, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
          ...(fetchOptions.headers || {}),
        },
      });
      const raw = await response.text();
      let data = {};
      if (raw) {
        try { data = JSON.parse(raw); }
        catch { throw new Error(`The server returned an invalid response (${response.status}).`); }
      }
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status}).`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('The AI server took too long to respond. Please try again in a moment.');
      }
      if (error instanceof TypeError) {
        throw new Error('The AI server is unavailable right now. It may still be starting up.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
})();
