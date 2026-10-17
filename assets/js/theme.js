/**
 * Xettl theme state and shared-shell behavior.
 *
 * Load synchronously in <head> so <html data-theme> is set before first paint:
 *   <script src="assets/js/theme.js"></script>
 *
 * - <html data-theme="light|dark">: effective theme (what CSS and scenes use).
 * - <html data-theme-preference="light|dark|system">: visitor choice.
 * - Fires `xettl:themechange` (bubbles, detail { theme }) when the effective theme changes.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'xettl-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var preference = previewPreference() || readStoredPreference();
  var theme = null;

  // Review/QA aid: ?theme=light|dark applies for this page view only and is never stored.
  function previewPreference() {
    var match = /[?&]theme=(light|dark)\b/.exec(window.location.search);
    return match ? match[1] : null;
  }

  function readStoredPreference() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : 'system';
    } catch (error) {
      return 'system';
    }
  }

  function storePreference(value) {
    try {
      if (value === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      // Storage blocked: the choice still applies in memory for this page.
    }
  }

  function systemTheme() {
    return media && media.matches ? 'dark' : 'light';
  }

  function apply(notify) {
    var next = preference === 'system' ? systemTheme() : preference;
    var changed = next !== theme;
    theme = next;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-preference', preference);
    updateThemeColorMeta();
    syncControls();
    if (changed && notify) {
      root.dispatchEvent(new CustomEvent('xettl:themechange', { bubbles: true, detail: { theme: theme } }));
    }
  }

  function updateThemeColorMeta() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#071625' : '#fbfaf6');
  }

  function syncControls() {
    if (!document.body) return;
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('title', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode' + (preference === 'system' ? ' · Following your device' : ''));
    }
  }

  function setPreference(value) {
    if (value !== 'light' && value !== 'dark' && value !== 'system') return;
    preference = value;
    storePreference(value);
    apply(true);
  }

  function onSystemChange() {
    // When the device catches up with a manual choice, resume following the device.
    if (preference !== 'system' && preference === systemTheme()) { preference = 'system'; storePreference('system'); }
    if (preference === 'system') apply(true);
  }

  function toggleTheme() {
    var next = theme === 'dark' ? 'light' : 'dark';
    setPreference(next === systemTheme() ? 'system' : next);
  }

  if (media) {
    if (media.addEventListener) media.addEventListener('change', onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  // Another tab changed the saved choice.
  window.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    preference = readStoredPreference();
    apply(true);
  });

  root.setAttribute('data-theme-js', '');
  apply(false);

  window.XettlTheme = {
    get theme() { return theme; },
    get preference() { return preference; },
    setPreference: setPreference,
    color: function (name) {
      return window.getComputedStyle(root).getPropertyValue(name).trim();
    }
  };

  /* ---------- Shared shell: theme controls and mobile menu ---------- */

  function initShell() {
    document.addEventListener('click', function (event) {
      var choice = event.target.closest && event.target.closest('[data-theme-toggle]');
      if (choice) toggleTheme();
    });
    syncControls();
    var header = document.querySelector('.site-header');
    var headerFrame = null;
    function syncHeader() { headerFrame = null; if (header) header.classList.toggle('is-scrolled', window.scrollY > 24); }
    function queueHeader() { if (headerFrame === null) headerFrame = requestAnimationFrame(syncHeader); }
    window.addEventListener('scroll', queueHeader, { passive: true });
    syncHeader();

    var menus = document.querySelectorAll('.mobile-menu');
    for (var i = 0; i < menus.length; i++) initMobileMenu(menus[i]);

    var printButtons = document.querySelectorAll('[data-print]');
    for (var j = 0; j < printButtons.length; j++) {
      printButtons[j].addEventListener('click', function () { window.print(); });
    }
  }

  function initMobileMenu(menu) {
    var summary = menu.querySelector('summary');

    function close(returnFocus) {
      if (!menu.open) return;
      menu.removeAttribute('open');
      if (returnFocus && summary) summary.focus();
    }

    function syncLabel() {
      if (summary) summary.setAttribute('aria-label', menu.open ? 'Close navigation' : 'Open navigation');
    }

    menu.addEventListener('toggle', syncLabel);
    syncLabel();

    var links = menu.querySelectorAll('nav a');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () { close(false); });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close(true);
    });

    document.addEventListener('click', function (event) {
      if (menu.open && !menu.contains(event.target)) close(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initShell);
  else initShell();
})();
