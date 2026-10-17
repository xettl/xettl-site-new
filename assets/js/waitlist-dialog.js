/* Native modal enhancement. One existing form, no duplicated state or new transport. */
(function () {
  'use strict';
  window.XettlSignupDialog = { init: function () {
    const section = document.getElementById('waitlist');
    if (!section || typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return null;
    const dialog = document.createElement('dialog'); dialog.id = 'waitlist-dialog'; dialog.className = 'waitlist-dialog';
    dialog.setAttribute('aria-labelledby', 'waitlist-heading');
    dialog.setAttribute('aria-describedby', 'waitlist-dialog-description');
    const toolbar = document.createElement('div'); toolbar.className = 'dialog-toolbar';
    const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.className = 'dialog-close';
    closeButton.setAttribute('aria-label', 'Close waitlist form'); closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    toolbar.append(closeButton); dialog.append(toolbar);
    const invitation = document.createElement('section'); invitation.className = 'join-invitation';
    invitation.innerHTML = '<h2>Help shape Xettl.</h2><p>Tell us what would make banking easier for you.</p><button type="button" class="button" data-open-waitlist>Join the waitlist</button>';
    section.before(invitation); dialog.append(section); document.body.append(dialog);
    const intro = section.querySelector('.waitlist-intro'); intro.querySelector('p').id = 'waitlist-dialog-description';
    section.querySelectorAll('a[href]').forEach(link => {
      link.target = '_blank'; link.rel = 'noopener';
      const hint = document.createElement('span'); hint.className = 'visually-hidden'; hint.textContent = ' (opens in a new tab)'; link.append(hint);
    });
    document.querySelectorAll('a[href="#waitlist"]').forEach(link => {
      const button = document.createElement('button'); button.type = 'button'; button.className = link.className;
      button.innerHTML = link.innerHTML; button.dataset.openWaitlist = ''; link.replaceWith(button);
    });
    let trigger = null, closing = false, animation = null, backdropStart = false;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    function announce(open) { window.dispatchEvent(new CustomEvent('xettl:overlaychange', { detail: { open } })); }
    function open(source, direct) {
      if (dialog.open) return;
      if (animation) animation.cancel(); closing = false;
      trigger = source || document.querySelector('[data-open-waitlist]');
      document.querySelectorAll('.mobile-menu[open]').forEach(menu => { menu.open = false; });
      if (direct) scrollTo(0, 0);
      dialog.showModal(); document.documentElement.classList.add('signup-open'); announce(true);
      const area = direct ? 'direct' : source?.closest('.site-header') ? 'header' : source?.closest('.hero-v2-actions') ? 'hero' : source?.closest('.site-footer') ? 'footer' : source?.closest('.join-invitation') ? 'invitation' : 'other';
      window.XettlAnalytics?.track('waitlist_opened', { source: area });
      if (!motion.matches && dialog.animate) animation = dialog.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 200, easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out' });
      const status = document.getElementById('wl-status');
      const focus = section.querySelector('input:not(:disabled)') || (status.textContent ? status : document.getElementById('waitlist-heading'));
      if (focus === status) status.setAttribute('tabindex', '-1');
      focus.focus({ preventScroll: true });
      dialog.scrollTop = 0;
    }
    function finishClose() { if (dialog.open) dialog.close(); }
    function close() {
      if (!dialog.open || closing) return; closing = true;
      if (animation) animation.cancel();
      if (!motion.matches && dialog.animate) {
        animation = dialog.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.97)' }],
          { duration: 180, easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out' });
        animation.finished.then(finishClose, finishClose);
      } else finishClose();
    }
    document.querySelectorAll('[data-open-waitlist]').forEach(button => {
      button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', dialog.id);
      button.addEventListener('click', () => open(button));
    });
    closeButton.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('signup-open'); announce(false); closing = false;
      if (location.hash === '#waitlist') history.replaceState(null, '', location.pathname + location.search);
      if (trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
    });
    function outside(event) { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; }
    dialog.addEventListener('pointerdown', event => { backdropStart = event.target === dialog && outside(event); });
    dialog.addEventListener('click', event => { if (backdropStart && event.target === dialog && outside(event)) close(); backdropStart = false; });
    return { open, close, element: dialog };
  } };
})();
