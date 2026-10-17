'use strict';
// Run with an installed Playwright module; PLAYWRIGHT_MODULE and BROWSER_PATH support a managed desktop.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.QA_URL || 'http://127.0.0.1:8790';
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; console.log('PASS ' + message); }
async function run() {
  fs.mkdirSync(path.join(__dirname, '../.qa'), { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const localFailures = [];
    page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400 && !response.url().includes('/api/')) localFailures.push(response.url()); });
    for (const theme of ['light', 'dark']) {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + '/?theme=' + theme);
        await page.locator('#waitlist-form').waitFor({ state: 'attached' });
        await page.evaluate(() => document.fonts.ready);
        check(await page.evaluate(() => [...document.fonts].some(f => f.family === 'Geist' && f.status === 'loaded')), 'self-hosted Geist is loaded');
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), theme + ' ' + width + ': no horizontal overflow');
        check((await page.locator('h1').innerText()).replace(/\s+/g, ' ') === 'Bank before you board.', 'approved hero on ' + width + '/' + theme);
        const cta = await page.locator('.hero-v2-actions .button').boundingBox();
        check(cta && cta.y + cta.height < 900, 'hero CTA visible on ' + width + '/' + theme);
        check(await page.locator('#wl-country').getAttribute('required') === null, 'origin stays optional');
        check(await page.locator('[data-theme-toggle]').count()===1 && await page.locator('[data-theme-toggle]').isVisible(), 'one theme toggle is visible at '+width+'px');
        check(await page.locator('[data-theme-choice]').count()===0, 'three-option theme picker is removed');
        check(await page.locator('.site-header').evaluate(node=>getComputedStyle(node).borderBottomWidth==='0px'), 'header has no hard divider line');
        check(!(await page.locator('#wl-newsletter').isChecked()) && !(await page.locator('#wl-marketing').isChecked()), 'newsletter and marketing start unchecked');
        check(await page.locator('#wl-newsletter').getAttribute('required') === null && await page.locator('#wl-marketing').getAttribute('required') === null, 'email opt-ins are optional');
        check(await page.locator('#wl-terms').getAttribute('required') !== null && !(await page.locator('#wl-terms').isChecked()), 'terms acknowledgment requires an explicit check');
        check(await page.locator('#wl-adult').getAttribute('required') !== null && !(await page.locator('#wl-adult').isChecked()), 'adult confirmation is required and unchecked');
        if (width >= 768) {
          for(const index of [0,1,2,3,0]) {
            await page.evaluate(i => { const r=document.querySelectorAll('.journey-step')[i].getBoundingClientRect(); scrollTo(0,scrollY+r.top+r.height/2-innerHeight*.5); },index);
            await page.waitForFunction(i => document.querySelectorAll('.journey-step')[i].classList.contains('active'),index);
            check(await page.locator('#journey-screen').getAttribute('src') === await page.locator('.journey-steps .stage-choice').nth(index).getAttribute('data-screen'), width + '/' + theme + ': scroll updates screen ' + index);
          }
          check(await page.evaluate(() => document.querySelector('.resources-understated-inner').getBoundingClientRect().top-document.querySelector('.later-features').getBoundingClientRect().bottom <= 24), width + '/' + theme + ': compact guides spacing');
          await page.evaluate(()=>scrollTo(0,0));
        }
        if ([390, 1440].includes(width)) {
          await page.locator('#concept-screen').scrollIntoViewIfNeeded();
          await page.locator('#journey-screen').evaluate(async image => {
            // Scroll selection can legitimately replace a source during its first decode.
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            for(let attempt=0;attempt<3;attempt++) {
              const src=image.src;
              try { await image.decode(); } catch(error) { if(image.src===src) throw error; }
              if(image.src===src && image.naturalWidth>0) return;
            }
            throw new Error('Product screen did not settle to a decodable image');
          });
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: '.qa/home-' + width + '-' + theme + '.png', fullPage: true });
          await openSignup(page);
          await page.locator('#waitlist-dialog').screenshot({ path: '.qa/waitlist-' + width + '-' + theme + '.png' });
          await closeSignup(page);
        }
        await openSignup(page);
        check(await page.locator('#waitlist-dialog').evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), theme + ' ' + width + ': popup stays within viewport');
        check(await page.locator('#waitlist-dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1), theme + ' ' + width + ': popup has no horizontal overflow');
        if (width === 390) {
          await page.locator('#waitlist-dialog').evaluate(node => { node.scrollTop = node.scrollHeight; });
          const close = await page.locator('.dialog-close').boundingBox();
          check(close && close.y >= 0 && close.y + close.height < 900, 'mobile close control stays visible after form scroll');
        }
        await closeSignup(page);
      }
    }
    await page.goto(base + '/?theme=light');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.hero-v2-actions .button').click();
    check(await page.evaluate(() => document.querySelector('#waitlist-dialog').open && document.activeElement.id === 'wl-name'), 'join button opens modal and focuses name');
    check(await page.evaluate(() => !window.XettlJourneyScene.frame), 'modal pauses the background city');
    await page.locator('#wl-name').fill('Keep my draft');
    await page.locator('#wl-newsletter').check();
    await closeSignup(page);
    check(await page.locator('.hero-v2-actions .button').evaluate(node => node === document.activeElement), 'closing returns focus to the trigger');
    await openSignup(page);
    check(await page.locator('#wl-name').inputValue() === 'Keep my draft', 'reopening preserves unsent details');
    check(await page.locator('#wl-newsletter').isChecked() && !(await page.locator('#wl-marketing').isChecked()), 'reopening preserves separate email choices');
    let trapped = true;
    for (let i = 0; i < 16; i++) { await page.keyboard.press('Tab'); trapped = trapped && await page.evaluate(() => !document.hasFocus() || document.querySelector('#waitlist-dialog').contains(document.activeElement)); }
    check(trapped, 'native modal excludes background controls from keyboard traversal');
    await page.locator('#wl-name').focus();
    check(await page.evaluate(() => { document.querySelector('.header-cta').focus(); return document.activeElement.id === 'wl-name'; }), 'native modal makes background inert');
    await closeSignup(page);
    await page.goto(base + '/about-us/');
    await page.goto(base + '/?theme=light#waitlist');
    await page.waitForFunction(() => document.activeElement.id === 'wl-name');
    check(await page.locator('#waitlist-dialog').evaluate(node => node.open && node.getBoundingClientRect().top >= 0), 'direct waitlist link opens a visible modal');
    await page.locator('#wl-submit-btn').click();
    check(await page.locator('#wl-name').getAttribute('aria-invalid') === 'true', 'empty name gets inline error');
    check(await page.evaluate(() => document.activeElement.id === 'wl-name'), 'first invalid field receives focus');
    await fill(page);
      await page.locator('#wl-adult').uncheck();
      await page.locator('#wl-submit-btn').click();
      check(await page.locator('#wl-adult').getAttribute('aria-invalid') === 'true' && await page.evaluate(()=>document.activeElement.id==='wl-adult'), 'missing adult confirmation blocks submission and receives focus');
      await page.locator('#wl-adult').check();
    await page.locator('#wl-terms').uncheck();
    await page.locator('#wl-submit-btn').click();
    check(await page.locator('#wl-terms').getAttribute('aria-invalid') === 'true' && await page.evaluate(()=>document.activeElement.id==='wl-terms'), 'missing terms acknowledgment blocks submission and receives focus');
    await page.locator('#wl-terms').check();
    await page.locator('#wl-submit-btn').click();
    check((await page.locator('#wl-status').innerText()).includes('not connected'), 'disconnected preview cannot report success');
    check(await page.locator('#wl-email').inputValue() === 'qa@example.test', 'disconnected submission preserves answers');
    check(await page.locator('[name="displayConsent"]').count() === 0, 'no public sharing controls');
    check(await page.locator('#spiral-canvas').count() === 0, 'constellation removed');
    const requests = [];
    let mode = 'error';
    let emailStatus = 'accepted';
    await context.route('**/assets/js/site-config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.XETTL_SITE_CONFIG={waitlistEndpoint:"/api/waitlist",contactEmail:"owner@example.test"};' }));
    await context.route('**/api/waitlist', async route => {
      requests.push(route.request().postDataJSON());
      if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      if (mode === 'bad-ack') return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
      if (mode === 'missing-preferences') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({version:4,acknowledged:true,receipt:{id:'incomplete',saved:true,emailStatus:'accepted'}}) });
      if (mode === 'validation') return route.fulfill({ status: 422, contentType: 'application/json', body: '{"fieldErrors":{"email":"not displayed raw"}}' });
      if (mode === 'rate-limit') return route.fulfill({ status: 429, contentType: 'application/json', body: '{}' });
      await new Promise(resolve => setTimeout(resolve, 200));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 4, acknowledged: true, receipt: { id: 'qa-receipt', saved: true, preferencesSaved: true, emailStatus } }) });
    });
    await page.reload();
    await fill(page);
    await page.locator('#wl-submit-btn').click();
    await page.waitForFunction(() => document.querySelector('#wl-status').dataset.state === 'error');
    check(await page.locator('#wl-name').inputValue() === '李', 'mononym retained after server error');
    await page.locator('#wl-submit-btn').click();
    await page.waitForFunction(() => document.querySelector('#wl-status').dataset.state === 'error');
    check(requests.length === 2 && requests[0].requestId === requests[1].requestId, 'retry reuses idempotency identifier');
    check(requests[0].version === 4 && requests[0].adultConfirmed === true && requests[0].termsAccepted === true && requests[0].privacyAcknowledged === true && requests[0].emailPreferences.newsletter === false && requests[0].emailPreferences.marketing === false, 'signup works with no optional email subscriptions');
    check(requests[0].privacyVersion === '2026-10-17-dual-analytics' && requests[0].termsVersion === '2026-10-17' && requests[0].emailPreferencesVersion === '2026-10-17', 'legal and preference versions are sent with signup');
    await page.locator('#wl-feature').fill('A clear account setup before I arrive.');
    mode = 'bad-ack';
    await page.locator('#wl-submit-btn').click();
    await page.waitForFunction(() => document.querySelector('#wl-status').dataset.state === 'error');
    check(requests[2].requestId !== requests[1].requestId, 'edited payload gets new identifier');
    check((await page.locator('#wl-status').innerText()).includes('couldn’t confirm'), 'vague 200 response is not success');
    mode = 'missing-preferences';
    await page.locator('#wl-submit-btn').click();
    await page.waitForFunction(() => document.querySelector('#wl-status').dataset.state === 'error');
    check((await page.locator('#wl-status').innerText()).includes('couldn’t confirm') && await page.locator('#wl-terms').isChecked(), 'receipt without saved preferences cannot clear or confirm consent');
    mode = 'validation';
    await page.locator('#wl-submit-btn').click();
    await page.waitForFunction(() => document.querySelector('#wl-email').getAttribute('aria-invalid') === 'true');
    check(await page.evaluate(() => document.activeElement.id === 'wl-email'), 'server validation focuses editable email');
    mode = 'rate-limit';
    await page.locator('#wl-submit-btn').click();
    await page.waitForFunction(() => document.querySelector('#wl-status').textContent.includes('Too many'));
    check(await page.locator('#wl-feature').inputValue() !== '', 'rate limit retains feedback');
    await page.locator('#wl-newsletter').check();
    const beforePreferenceEdit = requests.at(-1).requestId;
    await page.locator('#wl-submit-btn').click();
    await page.waitForFunction(() => document.querySelector('#wl-status').textContent.includes('Too many'));
    check(requests.at(-1).requestId !== beforePreferenceEdit && requests.at(-1).emailPreferences.newsletter === true && requests.at(-1).emailPreferences.marketing === false, 'changing an email choice sends a new idempotent request without bundling subscriptions');
    mode = 'success';
    const before = requests.length;
    await page.locator('#wl-submit-btn').click();
    await page.evaluate(() => { document.querySelector('#waitlist-form').requestSubmit(); document.querySelector('#waitlist-form').requestSubmit(); });
    await page.waitForFunction(() => document.querySelector('#wl-status').dataset.state === 'success');
    check(requests.length === before + 1, 'concurrent submits send one request');
    check(await page.locator('#wl-email').inputValue() === '', 'confirmed save clears PII from form');
    check(await page.locator('#wl-submit-btn').isDisabled(), 'confirmed signup cannot submit again');
    check(!JSON.stringify(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).includes('example.test'), 'PII is not in browser storage');
    for (emailStatus of ['pending', 'failed']) {
      await page.reload(); await fill(page); await page.locator('#wl-submit-btn').click();
      await page.waitForFunction(() => document.querySelector('#wl-status').dataset.state === 'success');
      check((await page.locator('#wl-status').innerText()).includes('Your signup is saved.'), 'stored signup remains successful without promising email when status is ' + emailStatus);
    }
    emailStatus = 'accepted';
    for (const [newsletter,marketing] of [[false,false],[true,false],[false,true],[true,true]]) {
      await page.reload(); await fill(page);
      await page.locator('#wl-newsletter').setChecked(newsletter); await page.locator('#wl-marketing').setChecked(marketing);
      await page.locator('#wl-submit-btn').click(); await page.waitForFunction(() => document.querySelector('#wl-status').dataset.state==='success');
      check(requests.at(-1).emailPreferences.newsletter===newsletter && requests.at(-1).emailPreferences.marketing===marketing, 'independent email choices saved: newsletter='+newsletter+', marketing='+marketing);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/');
    await page.locator('.mobile-menu summary').click();
    check(await page.locator('.mobile-menu').getAttribute('open') !== null, 'mobile menu opens');
    await page.keyboard.press('Escape');
    check(await page.locator('.mobile-menu').getAttribute('open') === null, 'Escape closes mobile menu');
    check(await page.locator('.mobile-menu summary').evaluate(n => n === document.activeElement), 'menu returns keyboard focus');
    const mobileTheme=await page.locator('html').getAttribute('data-theme');
    await page.locator('[data-theme-toggle]').click();
    check(await page.locator('html').getAttribute('data-theme') !== mobileTheme, 'single mobile theme toggle changes the theme');
    await page.locator('.journey-steps .stage-choice').nth(1).click();
    check((await page.locator('#journey-screen').getAttribute('src')).includes('eSIM'), 'product choice shows actual eSIM concept');
    check(await page.locator('.journey-steps .journey-step:visible').count() === 4, 'mobile journey keeps every step readable while scrolling');
    check((await page.locator('.journey-steps .journey-step.active').innerText()).includes('eSIM'), 'mobile explanation matches selected phone screen');
    for (const index of [0,1,2,3,1]) {
      await page.evaluate(i => { const r = document.querySelectorAll('.journey-step')[i].getBoundingClientRect(); scrollTo(0,scrollY+r.top+r.height/2-innerHeight*.5); },index);
      await page.waitForFunction(i => document.querySelectorAll('.journey-step')[i].classList.contains('active'),index);
      check(await page.locator('#journey-screen').getAttribute('src') === await page.locator('.journey-steps .stage-choice').nth(index).getAttribute('data-screen'), 'mobile scroll selects product step ' + index);
    }
    check(await page.evaluate(() => { const a=document.querySelector('.later-features').getBoundingClientRect(),b=document.querySelector('.resources-understated-inner').getBoundingClientRect(); return b.top-a.bottom <= 24; }), 'later features and guides have no oversized mobile gap');
    await page.evaluate(() => scrollTo(0,0));
    check(await page.locator('.departure-interlude, .hero-v2 .phone-card-wrapper').count() === 0, 'hero has no human photo or phone composition');
    check(await page.locator('.hero-v2-copy').evaluate(node => { const r = node.getBoundingClientRect(), b = document.body.getBoundingClientRect(); return Math.abs(r.x + r.width / 2 - b.x - b.width / 2) < 2; }), 'hero copy is centered');
    await page.waitForTimeout(100);
    const surfaceY = await page.evaluate(() => window.XettlJourneyScene.liquid.geometry.attributes.position.getY(1164));
    await page.waitForTimeout(180);
    check(await page.evaluate(y => Math.abs(window.XettlJourneyScene.liquid.geometry.attributes.position.getY(1164) - y) > .00001, surfaceY), 'flowing surface actually deforms over time');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(100);
    const reduced = await page.evaluate(() => ({ elapsed: window.XettlJourneyScene.elapsed, frame: window.XettlJourneyScene.frame }));
    await page.waitForTimeout(150);
    check(await page.evaluate(value => window.XettlJourneyScene.elapsed === value && !window.XettlJourneyScene.frame, reduced.elapsed), 'reduced-motion stops the frame loop');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    check(await page.locator('[data-journey-pause],.journey-artwork-footer').count() === 0, 'no visible activity label or pause controls');
    await page.waitForFunction(() => !window.XettlJourneyScene.frame);
    const elapsed = await page.evaluate(() => window.XettlJourneyScene.elapsed);
    await page.waitForTimeout(180);
    check(await page.evaluate(value => window.XettlJourneyScene.elapsed === value, elapsed), 'decorative motion stops when idle without requiring a pause button');
    await page.mouse.move(250,400);
    await page.waitForTimeout(150);
    check(await page.evaluate(value => window.XettlJourneyScene.elapsed > value, elapsed), 'pointer input briefly wakes street life');
    await page.evaluate(() => {
      window.__qaLoseExtension = window.XettlJourneyScene.renderer.getContext().getExtension('WEBGL_lose_context');
      window.__qaLoseExtension.loseContext();
    });
    await page.waitForFunction(() => window.XettlJourneyScene.contextLost);
    check(await page.locator('.journey-static').isVisible(), 'context loss reveals poster');
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__qaLoseExtension.restoreContext());
    await page.waitForFunction(() => !window.XettlJourneyScene.contextLost && document.querySelector('.journey-ready'));
    check(await page.evaluate(() => !!window.XettlJourneyScene.frame && window.XettlJourneyScene.renderer.info.render.calls > 0), 'context restoration resumes skyline rendering');
    await page.locator('#product').scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    check(await page.evaluate(() => !!window.XettlJourneyScene.frame && document.querySelector('#spatial-hero-container').getBoundingClientRect().top === 0), 'city remains alive behind the product section');
    await page.goto(base + '/');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(()=>window.XettlTheme.setPreference('system'));
    check(await page.locator('html').getAttribute('data-theme') === 'dark', 'system theme follows dark OS preference');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    check(await page.locator('html').getAttribute('data-theme') === 'light', 'system theme reacts to OS changes');
    await page.locator('[data-theme-toggle]').click();
    check(await page.locator('[data-theme-toggle]').getAttribute('aria-pressed')==='true' && await page.locator('html').getAttribute('data-theme')==='dark', 'theme toggle exposes the active dark state');
    await page.reload();
    check(await page.locator('html').getAttribute('data-theme')==='dark', 'manual theme choice survives reload');
    await page.locator('[data-theme-toggle]').focus(); await page.keyboard.press('Space');
    check(await page.locator('html').getAttribute('data-theme-preference')==='system', 'keyboard toggle back to the device appearance restores system following');
    await page.emulateMedia({colorScheme:'dark'}); await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    check(await page.locator('html').getAttribute('data-theme')==='dark', 'restored system following reacts to OS changes');
    await page.emulateMedia({colorScheme:'light'});
    for(const colorScheme of ['light','dark']) {
      const systemContext=await browser.newContext({colorScheme});
      const systemPage=await systemContext.newPage(); await systemPage.goto(base+'/resources/');
      check(await systemPage.locator('html').getAttribute('data-theme')===colorScheme && await systemPage.locator('html').getAttribute('data-theme-preference')==='system', 'fresh visitor follows '+colorScheme+' OS theme');
      await systemPage.locator('[data-theme-toggle]').click();
      check(await systemPage.locator('html').getAttribute('data-theme')!==colorScheme, 'fresh visitor can override '+colorScheme+' with the one toggle');
      await systemPage.locator('[data-theme-toggle]').click();
      check(await systemPage.locator('html').getAttribute('data-theme-preference')==='system', 'second toggle restores '+colorScheme+' device default');
      await systemContext.close();
    }
    check(await page.locator('#wl-email').evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16), 'form fields use mobile-safe type size');
    await page.goto(base + '/?theme=light');
    check(await page.evaluate(() => window.XettlJourneyScene.cities.length === 3 && window.XettlJourneyScene.cities.every(city => city.blocks.isInstancedMesh)), 'three original skylines use instanced building geometry');
    check(await page.locator('.dialog-liquid').count() === 0, 'signup has no ribbon artwork');
    check(await page.locator('.journey-steps').evaluate(node => {
      const css = getComputedStyle(node); return css.backdropFilter.includes('blur') && css.backgroundColor.startsWith('rgba(');
    }), 'reading surfaces are translucent frosted glass');
    check(await page.evaluate(() => window.XettlJourneyScene.life.stores.length === 5), 'five miniature storefronts share the city street');
    check(await page.evaluate(() => new Set(window.XettlJourneyScene.life.stores.map(store=>store.type)).size===5), 'restaurant, florist, grocery, bank and bar have separate architecture');
    check(await page.evaluate(() => new Set(window.XettlJourneyScene.life.stores.map(store=>store.height)).size===5 && new Set(window.XettlJourneyScene.life.stores.map(store=>store.signBg)).size===5), 'storefront rooflines and sign materials are varied');
    check(await page.locator('#spatial-hero-canvas').evaluate(canvas=>canvas.width===canvas.clientWidth && getComputedStyle(canvas).imageRendering==='auto'), 'city renders at native resolution without pixelation');
    check(await page.evaluate(() => ['phone','cash','card','deposit'].every(method => window.XettlJourneyScene.life.stores.some(store => store.method === method))), 'street scenes include phone, cash, card and deposit actions');
    check(await page.evaluate(() => {
      const scene = window.XettlJourneyScene;
      return scene.life.planes.every(plane => {
        const point = new THREE.Vector3(plane.x, plane.y, scene.life.planes.indexOf(plane) ? -6 : -2);
        scene.group.localToWorld(point); point.project(scene.camera);
        return Math.abs(point.x) < .95 && point.y > 0 && point.y < .95;
      });
    }), 'both planes start visibly inside the desktop sky');
    const planeX = await page.evaluate(() => window.XettlJourneyScene.life.planes[0].x);
    await page.waitForTimeout(120);
    check(await page.evaluate(x => window.XettlJourneyScene.life.planes[0].x !== x, planeX), 'planes travel across the skyline');
    const gradual = await page.evaluate(() => {
      const scene = window.XettlJourneyScene, before = scene.progress;
      scrollTo(0, document.querySelector('#faq').getBoundingClientRect().top + scrollY - 64); scene.updateScroll();
      return scene.progress === before && scene.scrollTarget > .99;
    });
    check(gradual, 'scroll sets a target without snapping city geometry');
    await page.waitForFunction(() => window.XettlJourneyScene.progress > .01 && window.XettlJourneyScene.progress < .99);
    check(await page.evaluate(() => window.XettlJourneyScene.cities.filter(city => city.group.visible).length === 2), 'city transition blends adjacent skylines');
    await page.evaluate(() => {
      const scene = window.XettlJourneyScene; scrollTo(0,0); scene.updateScroll(); scene.setProgress(0);
      scene.elapsed = 13.4; scene.actorDelta = 0; scene.updateTravel(); scene.render();
    });
    check(await page.evaluate(() => window.XettlJourneyScene.life.stores[3].popup.visible && window.XettlJourneyScene.life.stores[3].amount.startsWith('+')), 'bank deposit emits a positive illustrated receipt');
    await page.evaluate(() => { const scene = window.XettlJourneyScene; scene.elapsed = 6.5; scene.actorDelta = 0; scene.updateTravel(); scene.render(); });
    check(await page.evaluate(() => window.XettlJourneyScene.life.stores[0].popup.visible && window.XettlJourneyScene.life.stores[0].amount.startsWith('−')), 'purchase emits a negative illustrated receipt');
    for (const [city, selector] of [['Chicago', '#product'], ['San Francisco', '#faq'], ['New York', '.product-hero']]) {
      await page.evaluate(selector => { scrollTo(0, Math.max(0, document.querySelector(selector).getBoundingClientRect().top + scrollY - 64)); }, selector);
      await page.waitForFunction(name => { const scene=window.XettlJourneyScene; return scene.cities[Math.round(scene.progress*2)].name===name; }, city);
      check(await page.evaluate(name => { const scene=window.XettlJourneyScene; return scene.cities[Math.round(scene.progress*2)].name===name; },city), 'scroll reaches ' + city + ' skyline');
      check(await page.locator('#spatial-hero-container').evaluate(node => node.getBoundingClientRect().top === 0 && getComputedStyle(node).position === 'fixed'), 'background stays fixed while revealing ' + city);
      check(await page.evaluate(() => window.XettlJourneyScene.renderer.info.render.calls < 45), city + ' uses a bounded draw-call budget');
    }
    await page.mouse.move(1120, 500);
    await page.waitForTimeout(500);
    check(await page.evaluate(() => window.XettlJourneyScene.shared.uGlow.value > .2), 'pointer activates liquid illumination');
    const trafficX = await page.evaluate(() => window.XettlJourneyScene.life.actors[2].x);
    await page.waitForTimeout(150);
    check(await page.evaluate(x => window.XettlJourneyScene.life.actors[2].x !== x, trafficX), 'miniature traffic moves through the city');
    check(await page.evaluate(() => window.XettlJourneyScene.cities.every(city => city.blocks.count > 1000)), 'city meshes have detailed voxel courses and street geometry');
    const personPoint = await page.evaluate(() => {
      const scene = window.XettlJourneyScene, person = scene.life.people[3];
      const point = new THREE.Vector3(person.x, .35, 3.75); scene.group.localToWorld(point); point.project(scene.camera);
      return { x: (point.x * .5 + .5) * scene.container.clientWidth, y: (1 - (point.y * .5 + .5)) * scene.container.clientHeight };
    });
    await page.mouse.move(personPoint.x, personPoint.y); await page.waitForTimeout(650);
    check(await page.evaluate(() => window.XettlJourneyScene.life.lastInteraction), 'miniature residents react locally to the pointer');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const frozenLight = await page.evaluate(() => window.XettlJourneyScene.shared.uTime.value);
    await page.mouse.move(200, 500); await page.waitForTimeout(150);
    check(await page.evaluate(value => window.XettlJourneyScene.shared.uTime.value === value, frozenLight), 'reduced motion freezes liquid illumination');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const touchContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    const touch = await touchContext.newPage(); await touch.goto(base + '/');
    check(await touch.evaluate(() => !window.XettlJourneyScene.frame && window.XettlJourneyScene.glow === 0), 'touch has static lighting with no continuous render loop');
    check(await touch.locator('.product-hero').evaluate(node => node.offsetHeight <= innerHeight), 'touch has no empty scroll runway');
    await touch.evaluate(() => { scrollTo(0, document.querySelector('#faq').getBoundingClientRect().top + scrollY - 64); window.XettlJourneyScene.updateScroll(); });
    check(await touch.evaluate(() => window.XettlJourneyScene.progress > .99 && !window.XettlJourneyScene.frame), 'touch city changes with native scroll without idle animation');
    await touchContext.close();
    const fallbackContext = await browser.newContext();
    await fallbackContext.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/i.test(type) ? null : original.call(this, type, ...args);
      };
    });
    const fallback = await fallbackContext.newPage();
    await fallback.goto(base + '/');
    await fallback.waitForSelector('.scene-fallback');
    check(await fallback.locator('.scene-fallback').count() === 1, 'unavailable WebGL selects static fallback');
    check(await fallback.locator('.journey-static').isVisible(), 'static journey artwork stays visible');
    check(await fallback.locator('[data-journey-pause]').count() === 0, 'static fallback has no nonfunctional motion control');
    await openSignup(fallback);
    await fill(fallback);
    await fallback.locator('#wl-submit-btn').click();
    check((await fallback.locator('#wl-status').innerText()).includes('not connected'), 'signup still works independently of WebGL');
    await fallbackContext.close();
    const noJSContext = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark', viewport: { width: 390, height: 844 } });
    const noJS = await noJSContext.newPage();
    await noJS.goto(base + '/');
    check(await noJS.locator('h1').isVisible(), 'hero renders without JavaScript');
    check(await noJS.locator('.journey-static').isVisible(), 'no-JS artwork is static and visible');
    check(await noJS.locator('.skyline-dark').isVisible() && !(await noJS.locator('.skyline-light').isVisible()), 'no-JS artwork follows dark OS theme');
    check(await noJS.locator('.skyline-dark img').evaluate(image => image.complete && image.naturalWidth === 390), 'no-JS mobile uses the portrait-composed skyline poster');
    check(await noJS.locator('[data-journey-pause]').count() === 0, 'no-JS page has no nonfunctional motion button');
    check(!(await noJS.locator('[data-theme-toggle]').isVisible()), 'no-JS page has no nonfunctional theme button');
    check(await noJS.locator('body').evaluate(node => getComputedStyle(node).backgroundColor) === 'rgb(7, 22, 37)', 'no-JS colors follow dark OS theme');
    await noJSContext.close();
    await page.goto(base + '/about-us/');
    check(!(await page.locator('main').innerText()).toLowerCase().includes('founder'), 'About has no founder story');
    check((await page.locator('main').innerText()).includes('partners and families'), 'About includes broad newcomer audience');
    await page.goto(base + '/resources/');
    check(await page.locator('.guide-card').count() === 6, 'resource hub contains six relevant guides');
    check(await page.locator('.archive-section,.archive-list').count() === 0, 'resource archive section is removed');
    check(await page.locator('main a[href^="newsletter-"]').count() === 0, 'duplicate newsletter editions are not promoted');
    for(const article of ['us-banking.html','foreign-card-declines.html','fx-fees-explained.html']) {
      check(await page.locator('.guide-card a[href="'+article+'"]').count()===1, 'relevant guide promoted: '+article);
    }
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), 'resources fit '+width+'px without overflow');
    }
    for(const article of ['us-banking.html','foreign-card-declines.html','fx-fees-explained.html']) {
      await page.goto(base+'/resources/'+article);
      check(await page.locator('.archive-notice').count()===0 && await page.locator('h1').isVisible(), 'promoted article is readable without archive banner: '+article);
    }
    await page.goto(base + '/privacy/');
    check((await page.locator('[data-contact]').innerText()) === 'owner@example.test', 'configured contact appears in privacy notice');
    check((await page.locator('main').innerText()).includes('Your answers are private, not a public feed.'), 'privacy reflects private feedback');
    check((await page.locator('main').innerText()).includes('101 North First Avenue') && (await page.locator('main').innerText()).includes('Delaware corporation'), 'privacy identifies the legal entity and mailing address');
    check((await page.locator('main').innerText()).includes('12 months') && (await page.locator('main').innerText()).includes('Global Privacy Control'), 'privacy covers retention and tracking signals');
    check(!(await page.locator('main').innerText()).includes('[insert') && !(await page.locator('main').innerText()).includes('unpublished draft'), 'public privacy has no drafting instructions');
    for(const legalPath of ['/privacy/','/terms/']) {
      for(const width of [320,1440]) {
        await page.setViewportSize({width,height:900});
        await page.goto(base+legalPath);
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), legalPath+' fits '+width+'px');
      }
      check((await page.locator('main').innerText()).includes('October 17, 2026') && (await page.locator('main').innerText()).includes('18'), legalPath+' has matching current date and adult scope');
    }
    check(errors.length === 0, 'no JavaScript page errors: ' + errors.join('; '));
    check(localFailures.length === 0, 'no broken local assets: ' + localFailures.join('; '));
    console.log('Browser checks passed: ' + checks);
  } finally { await browser.close(); }
}
async function fill(page) {
  await page.locator('#wl-name').fill('李');
  await page.locator('#wl-email').fill('qa@example.test');
  await page.locator('#wl-feature').fill('An account before I land.');
  await page.locator('#wl-adult').check();
  await page.locator('#wl-terms').check();
}
async function openSignup(page) {
  if (await page.locator('#waitlist-dialog').evaluate(dialog => dialog.open)) return;
  await page.locator('.hero-v2-actions [data-open-waitlist]').click();
  await page.waitForFunction(() => document.querySelector('#waitlist-dialog').open);
  await page.waitForTimeout(220);
}
async function closeSignup(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#waitlist-dialog').open);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
