/* Optional measurement. No SDK load or events before a separate positive choice. */
(function () {
  'use strict';
  const config = (window.XETTL_SITE_CONFIG || {}).analytics || {};
  const storageKey = 'xettl-analytics-consent';
  const consentVersion = 2;
  const hasPostHog = Boolean(config.token);
  const ga4Id = /^G-[A-Z0-9]{5,20}$/.test(config.ga4Id || '') ? config.ga4Id : '';
  const consentScope = [hasPostHog && 'posthog', ga4Id && 'ga4'].filter(Boolean).join('+');
  const maxAge = 180 * 24 * 60 * 60 * 1000;
  const scriptURL = new URL(document.currentScript.src);
  const sdkURL = new URL('vendor/posthog.js', scriptURL).href;
  const events = new Set(['$pageview', 'waitlist_opened', 'waitlist_submit_attempted', 'waitlist_signup_completed', 'waitlist_signup_failed', 'product_step_selected']);
  const sources = new Set(['header', 'hero', 'footer', 'invitation', 'direct', 'other']);
  const errors = new Set(['validation', 'rate_limit', 'unconfirmed', 'unconfigured']);
  let choice = readChoice(), sdk = null, loading = false, pageCaptured = false, banner = null, settingsButton = null;
  let googleLoaded = false, googleLoading = false, googleConfigured = false, googlePageCaptured = false;
  const blocked = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  function readChoice() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && saved.version === consentVersion && saved.scope === consentScope && ['accepted', 'rejected'].includes(saved.choice) && saved.at <= Date.now() && Date.now() - saved.at < maxAge) return saved.choice;
    } catch (_) { /* A storage restriction does not grant consent. */ }
    return null;
  }
  function allowed() { return config.enabled === true && choice === 'accepted' && !blocked(); }
  function pagePath() { return location.pathname.replace(/\/index\.html$/, '/'); }
  function publicProperties(incoming) {
    const properties = {};
    if (sources.has(incoming.source)) properties.source = incoming.source;
    if (errors.has(incoming.error_type)) properties.error_type = incoming.error_type;
    if ([0, 1, 2, 3].includes(incoming.step)) properties.step = incoming.step;
    try { properties.referrer_domain = new URL(document.referrer).hostname; } catch (_) { properties.referrer_domain = 'direct'; }
    return properties;
  }
  function sanitize(event) {
    if (!allowed() || !events.has(event.event)) return null;
    const incoming = event.properties || {};
    const properties = { $current_url: location.origin + pagePath(), $pathname: pagePath(), $process_person_profile: false };
    // Keep only SDK routing/session keys and our enumerated properties. No DOM, form or raw URL data.
    for (const key of ['token', 'distinct_id', '$device_id', '$session_id', '$window_id', '$lib', '$lib_version']) {
      if (typeof incoming[key] === 'string') properties[key] = incoming[key];
    }
    event.properties = Object.assign(properties, publicProperties(incoming));
    return event;
  }
  function track(name, properties) {
    if (!allowed() || !events.has(name)) return;
    try { sdk?.capture(name, properties || {}); } catch (_) { /* Providers fail independently. */ }
    captureGoogle(name, properties || {});
  }
  function activatePostHog() {
    if (!hasPostHog) return;
    if (!allowed() || loading) return;
    if (sdk) {
      if (sdk.has_opted_out_capturing()) sdk.opt_in_capturing({ captureEventName: false });
      return;
    }
    loading = true;
    const script = document.createElement('script'); script.src = sdkURL; script.async = true;
    script.onload = () => {
      loading = false;
      if (!allowed() || !window.XettlPostHog) return;
      try {
        sdk = window.XettlPostHog.init(config.token, {
          api_host: config.host, persistence: 'sessionStorage', person_profiles: 'never',
          autocapture: false, capture_pageview: false, capture_pageleave: false,
          capture_dead_clicks: false, capture_heatmaps: false, capture_exceptions: false,
          capture_performance: false, disable_session_recording: true, disable_surveys: true,
          disable_external_dependency_loading: true, advanced_disable_flags: true,
          advanced_disable_feature_flags: true, save_referrer: false, store_google: false,
          ip: false, respect_dnt: true, before_send: sanitize,
          loaded: instance => {
            sdk = instance;
            if (allowed() && !pageCaptured) { pageCaptured = true; sdk.capture('$pageview'); }
          }
        });
      } catch (_) { sdk = null; }
    };
    script.onerror = () => { loading = false; };
    document.head.append(script);
  }
  function google() { window.dataLayer.push(arguments); }
  function googleConsent(granted) {
    return { analytics_storage: granted ? 'granted' : 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
  }
  function captureGoogle(name, properties) {
    if (!ga4Id || !allowed() || !googleConfigured || !events.has(name)) return;
    try {
      const clean = Object.assign(publicProperties(properties), {
        send_to: ga4Id, page_location: location.origin + pagePath(),
        page_title: document.title, page_referrer: ''
      });
      try { clean.page_referrer = new URL(document.referrer).origin + '/'; } catch (_) { /* No full referrer path/query. */ }
      google('event', name === '$pageview' ? 'page_view' : name, clean);
    } catch (_) { /* Measurement never blocks signup. */ }
  }
  function configureGoogle() {
    if (!allowed() || !googleLoaded) return;
    window['ga-disable-' + ga4Id] = false;
    google('consent', 'update', googleConsent(true));
    google('config', ga4Id, {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: location.origin + pagePath(), page_referrer: '', page_title: document.title,
      cookie_domain: 'none', cookie_path: '/', cookie_expires: 2592000, cookie_update: false
    });
    googleConfigured = true;
    if (!googlePageCaptured) { googlePageCaptured = true; captureGoogle('$pageview', {}); }
  }
  function activateGoogle() {
    if (!ga4Id || !allowed() || googleLoading || googleConfigured) return;
    if (googleLoaded) { configureGoogle(); return; }
    googleLoading = true;
    // Basic Consent Mode: neither the Google tag nor any commands load before Allow.
    window['ga-disable-' + ga4Id] = true;
    window.dataLayer = window.dataLayer || [];
    google('consent', 'default', googleConsent(false));
    google('set', 'ads_data_redaction', true);
    google('set', 'url_passthrough', false);
    google('js', new Date());
    const script = document.createElement('script');
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ga4Id);
    script.async = true; script.referrerPolicy = 'no-referrer';
    script.onload = () => { googleLoading = false; googleLoaded = true; configureGoogle(); };
    script.onerror = () => { googleLoading = false; };
    document.head.append(script);
  }
  function deactivateGoogle() {
    if (!ga4Id) return;
    // Disable hits before updating consent, including automatic events from a loaded tag.
    window['ga-disable-' + ga4Id] = true;
    googleConfigured = false;
    if (window.dataLayer) google('consent', 'update', googleConsent(false));
    // Our config uses host-only cookies at /; no broad domain cookies are created.
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      if (/^_ga(?:_|$)/.test(name)) document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax';
    });
  }
  function activate() {
    try { activatePostHog(); } catch (_) { /* Google can still run if PostHog is blocked. */ }
    try { activateGoogle(); } catch (_) { /* PostHog can still run if Google is blocked. */ }
  }
  function changeChoice(next, persist = true) {
    choice = next;
    if (persist) {
      try { localStorage.setItem(storageKey, JSON.stringify({ version: consentVersion, scope: consentScope, choice: next, at: Date.now() })); } catch (_) { /* Choice lasts for this page when storage is blocked. */ }
    }
    if (!allowed() && sdk) {
      try { sdk.opt_out_capturing({ clear_persistence: true }); } catch (_) { /* before_send also blocks pending events. */ }
    }
    if (!allowed()) deactivateGoogle();
    update(); activate();
  }
  function update() {
    if (!banner) return;
    banner.hidden = blocked() || choice !== null;
    settingsButton.textContent = blocked() ? 'Analytics disabled by browser' : 'Analytics preferences';
    settingsButton.disabled = blocked();
  }
  function init() {
    if (config.enabled !== true) return;
    banner = document.createElement('section'); banner.className = 'analytics-choice';
    banner.setAttribute('role', 'region'); banner.setAttribute('aria-label', 'Optional analytics');
    const providers = [hasPostHog && 'PostHog', ga4Id && 'Google Analytics'].filter(Boolean).join(' and ');
    const text = document.createElement('p'); text.textContent = 'Help us improve Xettl? Allow optional analytics from ' + providers + ' to measure visits and signup steps. We exclude form answers and session recordings.';
    const policy = document.createElement('a'); policy.href = new URL('../../privacy/#storage', scriptURL).href; policy.textContent = 'Privacy notice';
    const controls = document.createElement('div'); controls.className = 'analytics-choice-actions';
    const reject = document.createElement('button'); reject.type = 'button'; reject.className = 'button secondary'; reject.textContent = 'Reject analytics';
    const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'button'; accept.textContent = 'Allow analytics';
    reject.addEventListener('click', () => { changeChoice('rejected'); settingsButton.focus(); });
    accept.addEventListener('click', () => { changeChoice('accepted'); settingsButton.focus(); });
    controls.append(reject, accept); banner.append(text, policy, controls); document.body.append(banner);
    settingsButton = document.createElement('button'); settingsButton.type = 'button'; settingsButton.className = 'analytics-settings';
    settingsButton.addEventListener('click', () => {
      // Opening preferences withdraws collection immediately, before a replacement choice.
      changeChoice('rejected'); banner.hidden = false; reject.focus();
    });
    (document.querySelector('.footer-bottom') || document.querySelector('footer') || document.body).append(settingsButton);
    if (!allowed()) deactivateGoogle();
    update(); activate();
    window.addEventListener('storage', event => { if (event.key === storageKey || event.key === null) changeChoice(readChoice(), false); });
  }
  window.XettlAnalytics = Object.freeze({ track });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
