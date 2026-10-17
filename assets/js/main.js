/* Shared navigation, concept explorer and private waitlist. */
(function () {
  'use strict';
  function init() {
    const signupDialog = window.XettlSignupDialog ? window.XettlSignupDialog.init() : null;
    document.querySelectorAll('a[href="#waitlist"], a[href="#product"]').forEach(link => {
      link.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = document.querySelector(link.hash);
        if (!target) return;
        event.preventDefault();
        if (location.hash !== link.hash) history.pushState(null, '', link.hash);
        const heading = target.querySelector('h2');
        (heading || target).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
        if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
      });
    });

    const choices = [...document.querySelectorAll('.stage-choice')];
    const screen = document.getElementById('journey-screen');
    const caption = document.getElementById('screen-caption');
    function selectStage(choice, source) {
        if (!screen || !choice || choice.getAttribute('aria-pressed') === 'true') return;
        if (source === 'click') window.XettlAnalytics?.track('product_step_selected', { step: choices.indexOf(choice) });
        choices.forEach(button => {
          const selected = button.dataset.screen === choice.dataset.screen;
          button.setAttribute('aria-pressed', String(selected));
          const step = button.closest('.journey-step');
          if (step) step.classList.toggle('active', selected);
        });
        screen.src = choice.dataset.screen;
        screen.alt = choice.dataset.screenAlt;
        if (caption) {
          caption.setAttribute('aria-live', source === 'scroll' ? 'off' : 'polite');
          caption.textContent = choice.dataset.caption || choice.firstChild.textContent.trim();
        }
    }
    choices.forEach(choice => {
      choice.addEventListener('click', () => selectStage(choice, 'click'));
    });
    const steps = [...document.querySelectorAll('.journey-step')];
    let stageFrame = null;
    function followProductScroll() {
      stageFrame = null;
      if (!screen || !steps.length) return;
      const guide = innerHeight * .5;
      const visible = steps.filter(step => { const r = step.getBoundingClientRect(); return r.bottom > 80 && r.top < innerHeight; });
      if (!visible.length) return;
      const nearest = visible.reduce((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return Math.abs(ra.top + ra.height / 2 - guide) < Math.abs(rb.top + rb.height / 2 - guide) ? a : b;
      });
      selectStage(nearest.querySelector('.stage-choice'), 'scroll');
    }
    function queueProductScroll() { if (stageFrame === null) stageFrame = requestAnimationFrame(followProductScroll); }
    if (steps.length) {
      window.addEventListener('scroll', queueProductScroll, { passive: true });
      window.addEventListener('resize', queueProductScroll, { passive: true });
      window.addEventListener('load', queueProductScroll, { once: true });
      queueProductScroll();
      // Warm the real supplied screens before the scroll-driven swap, without blocking initial paint.
      [...new Set(choices.map(choice => choice.dataset.screen))].forEach(src => { const image = new Image(); image.src = src; });
    }
    if (document.getElementById('spatial-hero-container') && window.XettlSpatialScene) {
      window.XettlJourneyScene = window.XettlSpatialScene.init({ container: 'spatial-hero-container', canvas: 'spatial-hero-canvas' });
    }
    initContact();
    initWaitlist();
    function alignWaitlist(direct) {
      if (location.hash !== '#waitlist') return;
      if (signupDialog) { signupDialog.open(null, direct === true); return; }
      requestAnimationFrame(() => {
        const heading = document.getElementById('waitlist-heading');
        if (!heading) return;
        heading.scrollIntoView({ behavior: 'instant', block: 'start' });
        heading.focus({ preventScroll: true });
      });
    }
    if (location.hash === '#waitlist') {
      // Let native fragment targeting finish before opening/focusing the modal.
      if (document.readyState === 'complete') requestAnimationFrame(() => alignWaitlist(true));
      else window.addEventListener('load', () => requestAnimationFrame(() => alignWaitlist(true)), { once: true });
    }
    window.addEventListener('hashchange', () => requestAnimationFrame(() => alignWaitlist(false)));
    if (location.hash === '#open-waitlist') location.replace('#waitlist');
    if (location.hash === '#journey') location.replace('#product');
  }
  function initContact() {
    const email = (window.XETTL_SITE_CONFIG || {}).contactEmail || '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    document.querySelectorAll('[data-contact]').forEach(node => {
      const link = document.createElement('a');
      link.href = 'mailto:' + email;
      link.textContent = email;
      node.replaceChildren(link);
    });
  }
  function initWaitlist() {
    const form = document.getElementById('waitlist-form');
    if (!form) return;
    const fields = document.getElementById('waitlist-fields');
    const submit = document.getElementById('wl-submit-btn');
    const spinner = submit.querySelector('.submit-spinner');
    const status = document.getElementById('wl-status');
    const connection = document.getElementById('signup-connection');
    const api = window.XettlWaitlistAPI;
    const inputs = {
      fullName: document.getElementById('wl-name'),
      email: document.getElementById('wl-email'),
      countryFrom: document.getElementById('wl-country'),
      featureWish: document.getElementById('wl-feature'),
      adultConfirmed: document.getElementById('wl-adult'),
      termsAccepted: document.getElementById('wl-terms')
    };
    const fieldMessages = {
      fullName: 'Please enter your name (up to 160 characters).',
      email: 'Please enter a valid email address.',
      countryFrom: 'Please use 80 characters or fewer.',
      featureWish: 'Tell us one thing you need, using 3–1,000 characters.',
      adultConfirmed: 'You must be at least 18 to join. Confirm your age only if this is true.',
      termsAccepted: 'Please agree to the Website Terms and acknowledge the Privacy Notice to join.'
    };
    let pending = false;
    let confirmed = false;
    let lastSnapshot = '';
    let requestId = '';
    function say(message, state) {
      status.textContent = message;
      status.dataset.state = state;
    }
    function errorFor(key, message) {
      const input = inputs[key];
      document.getElementById(input.id + '-error').textContent = message || '';
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    function values() {
      return {
        fullName: inputs.fullName.value.trim(),
        email: inputs.email.value.trim().toLowerCase(),
        countryFrom: inputs.countryFrom.value.trim(),
        featureWish: inputs.featureWish.value.trim(),
        adultConfirmed: inputs.adultConfirmed.checked,
        termsAccepted: inputs.termsAccepted.checked,
        privacyAcknowledged: inputs.termsAccepted.checked,
        emailPreferences: {
          newsletter: document.getElementById('wl-newsletter').checked,
          marketing: document.getElementById('wl-marketing').checked
        }
      };
    }
    function validate(data) {
      const errors = {};
      if (!data.fullName || data.fullName.length > 160) errors.fullName = fieldMessages.fullName;
      if (!data.email || inputs.email.validity.typeMismatch || data.email.length > 254) errors.email = fieldMessages.email;
      if (data.countryFrom.length > 80) errors.countryFrom = fieldMessages.countryFrom;
      if (data.featureWish.length < 3 || data.featureWish.length > 1000) errors.featureWish = fieldMessages.featureWish;
      if (!data.adultConfirmed) errors.adultConfirmed = fieldMessages.adultConfirmed;
      if (!data.termsAccepted) errors.termsAccepted = fieldMessages.termsAccepted;
      Object.keys(inputs).forEach(key => errorFor(key, errors[key]));
      const first = Object.keys(errors)[0];
      if (first) inputs[first].focus();
      return !first;
    }
    Object.entries(inputs).forEach(([key,input]) => {
      input.addEventListener('input', () => {
        errorFor(key, '');
        if (!pending && !confirmed) say('', '');
      });
    });
    document.querySelectorAll('.signup-consents input').forEach(input => input.addEventListener('change', () => {
      if (input === inputs.termsAccepted) errorFor('termsAccepted', '');
      if (input === inputs.adultConfirmed) errorFor('adultConfirmed', '');
      if (!pending && !confirmed) say('', '');
    }));
    inputs.featureWish.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    if (!api || !api.endpoint()) {
      connection.textContent = 'Signup opens soon. This preview is not connected, so no answers can be saved yet.';
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending || confirmed) return;
      const data = values();
      if (!validate(data)) {
        say('Please check the highlighted fields.', 'error');
        return;
      }
      if (!api || !api.endpoint()) {
        say('Signup is not connected in this preview. Your answers have not been sent.', 'error');
        return;
      }
      const snapshot = JSON.stringify(data);
      if (snapshot !== lastSnapshot) {
        if (!window.crypto || !window.crypto.randomUUID) {
          say('A secure browser connection is needed to join. Please use HTTPS and try again.', 'error');
          return;
        }
        requestId = window.crypto.randomUUID();
        lastSnapshot = snapshot;
      }
      pending = true;
      window.XettlAnalytics?.track('waitlist_submit_attempted');
      fields.disabled = true;
      form.setAttribute('aria-busy', 'true');
      spinner.hidden = false;
      say('Saving your signup…', 'pending');
      try {
        const result = await api.submit({
          version: 4, requestId: requestId, ...data, privacyVersion: '2026-10-17-thank-you',
          termsVersion: '2026-10-17', emailPreferencesVersion: '2026-10-17'
        });
        confirmed = true;
        window.XettlAnalytics?.track('waitlist_signup_completed');
        say(result.emailStatus === 'accepted'
          ? 'You’re on the waitlist. Your signup is saved, and a thank-you email is on its way.'
          : window.XETTL_SITE_CONFIG?.emailEnabled
            ? 'You’re on the waitlist. Your signup is saved. A thank-you email will arrive shortly; no further action is needed.'
            : 'You’re on the waitlist. Your signup is saved. No need to sign up again.', 'success');
        submit.querySelector('span').textContent = 'You’re on the list';
        connection.textContent = '';
        form.reset();
        // Remove personally identifying values from retry memory after a confirmed save.
        lastSnapshot = '';
        requestId = '';
        status.setAttribute('tabindex', '-1');
        status.focus({ preventScroll: true });
      } catch (error) {
        window.XettlAnalytics?.track('waitlist_signup_failed', { error_type: error.code });
        if (error.code === 'validation') {
          fields.disabled = false;
          Object.keys(error.fields).forEach(key => errorFor(key, fieldMessages[key]));
          const first = Object.keys(error.fields)[0];
          if (first) inputs[first].focus();
          say('Please check the highlighted fields and try again.', 'error');
        } else if (error.code === 'unconfigured') {
          say('Signup is not connected in this preview. Your answers have not been sent.', 'error');
        } else if (error.code === 'rate_limit') {
          say('Too many attempts right now. Please wait a few minutes, then try again. Your details are still here.', 'error');
        } else {
          say('We couldn’t confirm your signup. Your details are still here; please try again.', 'error');
        }
      } finally {
        pending = false;
        fields.disabled = confirmed;
        form.removeAttribute('aria-busy');
        spinner.hidden = true;
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
