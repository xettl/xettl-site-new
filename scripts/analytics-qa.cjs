'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { buildSync } = require('esbuild');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.QA_URL || 'http://127.0.0.1:8790';
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; console.log('PASS ' + label); }
// Controlled Google tag fixture: verifies our command ordering, consent and sanitized
// event transport without connecting test visitors to a real GA4 property.
const googleTagFixture = `
(() => {
  const id = new URL(document.currentScript.src).searchParams.get('id');
  let consent = {}, configured = false;
  const commands = window.__gaCommands = [], events = window.__gaEvents = [];
  function process(command) {
    const args = Array.from(command); commands.push(args);
    if (args[0] === 'consent') consent = args[2];
    if (args[0] === 'config') {
      configured = true;
      if (consent.analytics_storage === 'granted' && !window['ga-disable-' + id]) {
        document.cookie = '_ga=test-visitor; Path=/';
        document.cookie = '_ga_' + id.slice(2) + '=test-session; Path=/';
      }
      if (args[2].send_page_view !== false) process(['event', 'page_view', {}]);
    }
    if (args[0] === 'event' && configured && consent.analytics_storage === 'granted' && !window['ga-disable-' + id]) {
      events.push({ name: args[1], properties: args[2] });
      fetch('https://www.google-analytics.com/g/collect', { method: 'POST', body: JSON.stringify(events.at(-1)) }).catch(() => {});
    }
  }
  const layer = window.dataLayer, queued = layer.slice(), push = layer.push.bind(layer);
  layer.push = (...values) => { const result = push(...values); values.forEach(process); return result; };
  queued.forEach(process);
})();`;
async function run() {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../lib/posthog-entry.mjs')], bundle: true, write: false, minify: true, format: 'iife' }).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
    context.setDefaultTimeout(15000);
    const calls = [], pageErrors = [], sdkLoads = [], googleLoads = [], googleCalls = [];
    await context.route('**/assets/js/site-config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.XETTL_SITE_CONFIG={waitlistEndpoint:"/api/waitlist",analytics:{enabled:true,token:"phc_test_public_project",host:"https://us.i.posthog.com",ga4Id:"G-XETTLTEST1"}};' }));
    await context.route('**/assets/js/vendor/posthog.js', route => { sdkLoads.push(route.request().url()); return route.fulfill({ contentType: 'application/javascript', body: bundle }); });
    await context.route('https://us.i.posthog.com/**', route => { calls.push({ url: route.request().url(), body: route.request().postData() }); return route.fulfill({ contentType: 'application/json', body: '{"status":1}' }); });
    await context.route('https://www.googletagmanager.com/gtag/js?*', route => { googleLoads.push(route.request().url()); return route.fulfill({ contentType: 'application/javascript', body: googleTagFixture }); });
    await context.route('https://www.google-analytics.com/**', route => { googleCalls.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }); });
    await context.route('**/api/waitlist', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 4, acknowledged: true, receipt: { id: 'not-an-analytics-id', saved: true, preferencesSaved: true, emailStatus: 'pending' } }) }));
    // Keep production sanitizer/settings; make event transport inspectable and immediate in this test.
    await context.addInitScript(() => {
      let sdk;
      Object.defineProperty(window, 'XettlPostHog', { configurable: true, get: () => sdk, set: value => {
        sdk = value; const init = value.init.bind(value);
        value.init = (token, options) => {
          const sanitize = options.before_send;
          return init(token, { ...options, request_batching: false, disable_compression: true, opt_out_useragent_filter: true, before_send: event => {
            const clean = sanitize(event); if (clean) (window.__analyticsEvents ||= []).push(JSON.parse(JSON.stringify(clean))); return clean;
          } });
        };
      } });
    });
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base + '/?email=secret@example.test#private-answer');
    await page.getByRole('button', { name: 'Reject analytics', exact: true }).waitFor();
    await page.waitForTimeout(400);
    check(sdkLoads.length === 0 && calls.length === 0 && googleLoads.length === 0 && googleCalls.length === 0, 'neither provider loads or sends data before consent');
    await page.getByRole('button', { name: 'Reject analytics', exact: true }).click();
    await page.goto(base + '/resources/');
    check(await page.locator('.analytics-choice').isHidden() && calls.length === 0 && googleCalls.length === 0 && googleLoads.length === 0, 'rejection persists across pages without either provider');
    await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
    await page.waitForFunction(() => window.__analyticsEvents?.some(e => e.event === '$pageview'));
    await page.waitForFunction(() => window.__gaEvents?.some(e => e.name === 'page_view'));
    check(sdkLoads.length === 1, 'locally bundled SDK loads only after Allow');
    check(googleLoads.length === 1, 'Google tag loads only after Allow');
    check(await page.evaluate(() => {
      const commands = window.__gaCommands;
      const first = commands[0], config = commands.find(c => c[0] === 'config');
      return first[0] === 'consent' && first[1] === 'default' && first[2].analytics_storage === 'denied' &&
        commands.filter(c => c[0] === 'consent').every(c => c[2].ad_storage === 'denied' && c[2].ad_user_data === 'denied' && c[2].ad_personalization === 'denied') &&
        config[2].send_page_view === false && config[2].allow_google_signals === false && config[2].allow_ad_personalization_signals === false && config[2].cookie_expires === 2592000 && config[2].cookie_update === false;
    }), 'Basic Consent Mode precedes configuration; advertising/signals stay disabled');
    check(await page.evaluate(() => window.XettlPostHog.config.autocapture === false && window.XettlPostHog.config.disable_session_recording === true && window.XettlPostHog.config.person_profiles === 'never'), 'replay, autocapture and person profiles stay disabled');
    await page.goto(base + '/?email=secret@example.test#private-answer');
    await page.waitForFunction(() => window.__analyticsEvents?.some(e => e.event === '$pageview'));
    await page.waitForFunction(() => window.__gaEvents?.some(e => e.name === 'page_view'));
    await page.locator('.hero-v2-actions [data-open-waitlist]').click();
    await page.locator('#wl-name').fill('Private Name');
    await page.locator('#wl-email').fill('secret@example.test');
    await page.locator('#wl-feature').fill('PRIVATE FEATURE ANSWER');
    await page.locator('#wl-adult').check(); await page.locator('#wl-terms').check();
    await page.locator('#wl-submit-btn').click();
    await page.waitForFunction(() => document.querySelector('#wl-status').dataset.state === 'success');
    const events = await page.evaluate(() => window.__analyticsEvents);
    check(events.filter(e => e.event === '$pageview').length === 1, 'one pageview per page without automatic duplicates');
    check(await page.evaluate(() => window.__gaEvents.filter(e => e.name === 'page_view').length === 1), 'GA4 gets one independent pageview without automatic duplicates');
    check(['waitlist_opened', 'waitlist_submit_attempted', 'waitlist_signup_completed'].every(name => events.some(e => e.event === name)), 'signup funnel captures a durable receipt');
    check(await page.evaluate(() => ['waitlist_opened', 'waitlist_submit_attempted', 'waitlist_signup_completed'].every(name => window.__gaEvents.some(e => e.name === name))), 'the same successful signup reaches GA4 and PostHog');
    check(events.some(e => e.event === 'waitlist_opened' && e.properties.source === 'hero'), 'CTA source is an enumerated location');
    await page.evaluate(() => {
      window.XettlAnalytics.track('waitlist_signup_failed', { error_type: 'unconfirmed', email: 'secret@example.test', featureWish: 'PRIVATE FEATURE ANSWER', source: 'secret@example.test' });
      window.XettlPostHog.capture('arbitrary_event', { email: 'secret@example.test' });
    });
    const sanitized = JSON.stringify(await page.evaluate(() => window.__analyticsEvents));
    check(!/secret@example|PRIVATE FEATURE|Private Name|not-an-analytics-id|arbitrary_event|email=|private-answer/.test(sanitized), 'sanitizer removes form data, unknown events/properties, query and hash');
    const googleEvents = JSON.stringify(await page.evaluate(() => window.__gaEvents));
    check(!/secret@example|PRIVATE FEATURE|Private Name|not-an-analytics-id|arbitrary_event|email=|private-answer/.test(googleEvents), 'GA4 command payload excludes form data, unknown fields, query and hash');
    const wireBodies = calls.map(call => {
      const raw = call.body || '';
      if (/^[\[{]/.test(raw)) return JSON.stringify(JSON.parse(raw));
      const encoded = new URLSearchParams(raw).get('data');
      return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : raw;
    }).join('\n');
    check(!/secret@example|PRIVATE FEATURE|Private Name|not-an-analytics-id|email=|private-answer/.test(wireBodies), 'actual event transport excludes private form values and URL parameters');
    await page.keyboard.press('Escape'); await page.locator('#waitlist-dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
    const before = calls.length, beforeGoogle = googleCalls.length;
    await page.evaluate(() => window.XettlAnalytics.track('waitlist_signup_completed'));
    await page.waitForTimeout(300);
    check(calls.length === before && googleCalls.length === beforeGoogle, 'opening preferences stops both providers immediately');
    check(await page.evaluate(() => window['ga-disable-G-XETTLTEST1'] === true && !document.cookie.split(';').some(c => /^\s*_ga(?:_|=)/.test(c))), 'Google collection is disabled and host-only GA cookies are cleared');
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
    await page.waitForFunction(() => window.XettlPostHog && !window.XettlPostHog.has_opted_out_capturing());
    await page.waitForTimeout(200);
    check(await page.evaluate(() => window.XettlPostHog.config.before_send !== undefined), 'consent can be granted again after withdrawal');
    for (const pathname of ['/about-us/', '/resources/newsletter-welcome.html', '/privacy/', '/terms/']) {
      await page.goto(base + pathname);
      await page.waitForFunction(() => window.__analyticsEvents?.some(e => e.event === '$pageview'));
      check(await page.getByRole('button', { name: 'Analytics preferences', exact: true }).count() === 1, 'shared analytics/preferences on ' + pathname);
    }
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'consent controls fit ' + width + 'px');
      await page.getByRole('button', { name: 'Reject analytics', exact: true }).click();
    }
    const previousLoads = sdkLoads.length, previousGoogleLoads = googleLoads.length;
    await page.evaluate(() => localStorage.setItem('xettl-analytics-consent', JSON.stringify({ version: 2, scope: 'posthog+ga4', choice: 'accepted', at: Date.now() })));
    const gpc = await context.newPage();
    await gpc.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true }));
    await gpc.goto(base + '/');
    check(await gpc.getByRole('button', { name: 'Analytics disabled by browser', exact: true }).isDisabled() && sdkLoads.length === previousLoads && googleLoads.length === previousGoogleLoads, 'GPC blocks both providers even with saved consent');
    const dnt = await context.newPage();
    await dnt.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' }));
    await dnt.goto(base + '/resources/');
    check(await dnt.getByRole('button', { name: 'Analytics disabled by browser', exact: true }).isDisabled() && sdkLoads.length === previousLoads && googleLoads.length === previousGoogleLoads, 'DNT blocks both providers');
    const expired = await context.newPage();
    await expired.addInitScript(() => localStorage.setItem('xettl-analytics-consent', JSON.stringify({ version: 2, scope: 'posthog+ga4', choice: 'accepted', at: 1 })));
    await expired.goto(base + '/privacy/');
    check(await expired.getByRole('button', { name: 'Allow analytics', exact: true }).isVisible() && sdkLoads.length === previousLoads && googleLoads.length === previousGoogleLoads, 'expired consent asks again without either provider');
    const changed = await context.newPage();
    await changed.addInitScript(() => localStorage.setItem('xettl-analytics-consent', JSON.stringify({ version: 2, scope: 'posthog', choice: 'accepted', at: Date.now() })));
    await changed.goto(base + '/about-us/');
    check(await changed.getByRole('button', { name: 'Allow analytics', exact: true }).isVisible() && sdkLoads.length === previousLoads && googleLoads.length === previousGoogleLoads, 'PostHog-only consent does not authorize newly added GA4');
    check(pageErrors.length === 0, 'no analytics JavaScript errors: ' + pageErrors.join('; '));
    check(calls.length > 0 && calls.every(call => /\/e\//.test(new URL(call.url).pathname) || /\/capture/.test(new URL(call.url).pathname)), 'only event ingestion endpoints are used');
    await context.close();
    // Provider adapters must remain independent when a blocker rejects one script.
    for (const mode of ['google_blocked', 'posthog_blocked', 'ga4_only', 'posthog_only']) {
      const isolated = await browser.newContext(); isolated.setDefaultTimeout(15000);
      const posthogEnabled = mode !== 'ga4_only', googleEnabled = mode !== 'posthog_only';
      const probeConfig = { enabled: true, token: posthogEnabled ? 'phc_test_public_project' : '', host: 'https://us.i.posthog.com', ga4Id: googleEnabled ? 'G-XETTLTEST1' : '' };
      await isolated.route('**/assets/js/site-config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.XETTL_SITE_CONFIG={analytics:' + JSON.stringify(probeConfig) + '};' }));
      await isolated.route('**/assets/js/vendor/posthog.js', route => mode === 'posthog_blocked' ? route.abort() : route.fulfill({ contentType: 'application/javascript', body: `window.XettlPostHog={init(token,config){let out=false;const sdk={capture(event,properties={}){if(!out){const clean=config.before_send({event,properties});if(clean)(window.__analyticsEvents ||= []).push(clean)}},has_opted_out_capturing(){return out},opt_out_capturing(){out=true},opt_in_capturing(){out=false}};config.loaded(sdk);return sdk}};` }));
      await isolated.route('https://www.googletagmanager.com/**', route => mode === 'google_blocked' ? route.abort() : route.fulfill({ contentType: 'application/javascript', body: googleTagFixture }));
      await isolated.route('https://www.google-analytics.com/**', route => route.fulfill({ status: 204 }));
      const probe = await isolated.newPage(); await probe.goto(base + '/resources/');
      await probe.getByRole('button', { name: 'Allow analytics', exact: true }).click();
      const expectGoogle = googleEnabled && mode !== 'google_blocked';
      const expectPosthog = posthogEnabled && mode !== 'posthog_blocked';
      if (expectGoogle) await probe.waitForFunction(() => window.__gaEvents?.some(e => e.name === 'page_view'));
      if (expectPosthog) await probe.waitForFunction(() => window.__analyticsEvents?.some(e => e.event === '$pageview'));
      await probe.evaluate(() => window.XettlAnalytics.track('product_step_selected', { step: 2 }));
      check(await probe.evaluate(({ expectGoogle, expectPosthog }) =>
        Boolean(window.__gaEvents?.some(e => e.name === 'product_step_selected')) === expectGoogle &&
        Boolean(window.__analyticsEvents?.some(e => e.event === 'product_step_selected')) === expectPosthog,
        { expectGoogle, expectPosthog }), 'provider isolation and dispatch: ' + mode);
      await isolated.close();
    }
    console.log('Analytics browser checks passed: ' + checks);
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
