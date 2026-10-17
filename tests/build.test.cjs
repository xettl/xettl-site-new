'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
test('production builds support both providers, either independently, and no analytics', () => {
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, '.qa/build-analytics-'));
  for (const name of ['assets', 'lib', 'about-us', 'resources', 'privacy', 'terms', 'waitlist', 'email-preferences', 'index.html', 'robots.txt', 'sitemap.xml']) fs.cpSync(path.join(root, name), path.join(fixture, name), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'scripts'));
  fs.copyFileSync(path.join(root, 'scripts/build-site.cjs'), path.join(fixture, 'scripts/build-site.cjs'));
  const build = overrides => spawnSync(process.execPath, ['scripts/build-site.cjs'], { cwd: fixture, encoding: 'utf8', env: { ...process.env, CONTEXT: 'production', XETTL_WAITLIST_ENDPOINT: '/api/waitlist', XETTL_CONTACT_EMAIL: 'owner@example.test', XETTL_POSTHOG_TOKEN: '', XETTL_POSTHOG_HOST: 'https://us.i.posthog.com', XETTL_GA4_ID: '', XETTL_ANALYTICS_PREVIEW: '', ...overrides } });
  for (const [posthog, ga4] of [[true, true], [false, true], [true, false], [false, false]]) {
    const result = build({ XETTL_POSTHOG_TOKEN: posthog ? 'phc_test_build_only' : '', XETTL_GA4_ID: ga4 ? 'G-XETTLTEST1' : '' });
    assert.equal(result.status, 0, result.stderr);
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(fixture, 'public/assets/js/site-config.js'), 'utf8'), context);
    assert.equal(context.window.XETTL_SITE_CONFIG.analytics.enabled, posthog || ga4);
    assert.equal(context.window.XETTL_SITE_CONFIG.analytics.ga4Id, ga4 ? 'G-XETTLTEST1' : '');
    assert.equal(fs.existsSync(path.join(fixture, 'public/assets/js/vendor/posthog.js')), posthog);
    assert.equal(fs.existsSync(path.join(fixture, 'public/assets/js/vendor/POSTHOG-LICENSE.txt')), posthog);
    const preferences = fs.readFileSync(path.join(fixture, 'public/email-preferences/index.html'), 'utf8');
    assert.ok(!preferences.includes('analytics.js') && !preferences.includes('site-config.js'), 'signed email link pages must not load analytics');
  }
  const invalid = build({ XETTL_GA4_ID: 'not-a-measurement-id' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /GA4 web Measurement ID/);
  const preview = build({ CONTEXT: 'deploy-preview', XETTL_POSTHOG_TOKEN: 'phc_test_build_only', XETTL_GA4_ID: 'G-XETTLTEST1' });
  assert.equal(preview.status, 0, preview.stderr);
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(fixture, 'public/assets/js/site-config.js'), 'utf8'), context);
  assert.equal(context.window.XETTL_SITE_CONFIG.analytics.enabled, false);
  assert.equal(fs.existsSync(path.join(fixture, 'public/assets/js/vendor/posthog.js')), false);
});
