/* Private waitlist transport. No public feed, browser database key or local PII storage. */
(function () {
  'use strict';
  class WaitlistError extends Error {
    constructor(code, fields) {
      super(code);
      this.name = 'WaitlistError';
      this.code = code;
      this.fields = fields || {};
    }
  }
  function endpoint() {
    const value = (window.XETTL_SITE_CONFIG || {}).waitlistEndpoint;
    if (!value || typeof value !== 'string') return '';
    try {
      const url = new URL(value, window.location.origin);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.username || url.password || url.hash || url.search) return '';
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  async function submit(payload) {
    const url = endpoint();
    if (!url) throw new WaitlistError('unconfigured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      });
      if (response.status === 429) throw new WaitlistError('rate_limit');
      let data;
      try { data = await response.json(); } catch (_) { throw new WaitlistError('unconfirmed'); }
      if (!response.ok) {
        const fields = {};
        if ([400, 422].includes(response.status) && data && data.fieldErrors) {
          ['fullName', 'email', 'countryFrom', 'featureWish', 'adultConfirmed', 'termsAccepted'].forEach(key => {
            if (Object.prototype.hasOwnProperty.call(data.fieldErrors, key)) fields[key] = true;
          });
        }
        throw new WaitlistError(Object.keys(fields).length ? 'validation' : 'unconfirmed', fields);
      }
      const receipt = data && data.receipt;
      if (!data || data.version !== 4 || data.acknowledged !== true ||
          !receipt || receipt.saved !== true || typeof receipt.id !== 'string' ||
          !receipt.id.trim() || receipt.id.length > 128 || receipt.preferencesSaved !== true ||
          !['accepted', 'pending', 'failed'].includes(receipt.emailStatus)) {
        throw new WaitlistError('unconfirmed');
      }
      return { emailStatus: receipt.emailStatus };
    } catch (error) {
      if (error instanceof WaitlistError) throw error;
      throw new WaitlistError('unconfirmed');
    } finally { clearTimeout(timer); }
  }
  window.XettlWaitlistAPI = Object.freeze({ endpoint: endpoint, submit: submit });
})();
