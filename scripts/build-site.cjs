'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
const config = {
  waitlistEndpoint: process.env.XETTL_WAITLIST_ENDPOINT || '',
  contactEmail: process.env.XETTL_CONTACT_EMAIL || '',
  emailEnabled: process.env.XETTL_EMAIL_ENABLED === 'true',
  analytics: {
    enabled: Boolean((process.env.XETTL_POSTHOG_TOKEN || '').trim() || (process.env.XETTL_GA4_ID || '').trim()) && (process.env.CONTEXT === 'production' || process.env.XETTL_ANALYTICS_PREVIEW === 'true'),
    token: (process.env.XETTL_POSTHOG_TOKEN || '').trim(),
    host: process.env.XETTL_POSTHOG_HOST || 'https://us.i.posthog.com',
    ga4Id: (process.env.XETTL_GA4_ID || '').trim().toUpperCase()
  }
};
const release = process.env.CONTEXT === 'production' || process.env.XETTL_RELEASE_MODE === 'production';
if (!['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(config.analytics.host)) throw new Error('Use the US or EU PostHog ingestion host.');
if (config.analytics.token && !/^phc_[a-zA-Z0-9_-]+$/.test(config.analytics.token)) throw new Error('XETTL_POSTHOG_TOKEN must be a public project token, never a personal API key.');
if (config.analytics.ga4Id && !/^G-[A-Z0-9]{5,20}$/.test(config.analytics.ga4Id)) throw new Error('XETTL_GA4_ID must be a GA4 web Measurement ID, such as G-XXXXXXXXXX.');
if (config.waitlistEndpoint) {
  const url = new URL(config.waitlistEndpoint, 'https://getxettl.com');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('XETTL_WAITLIST_ENDPOINT must be an HTTPS URL or a same-site path, without credentials, query or fragment.');
  }
}
if (config.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.contactEmail)) {
  throw new Error('XETTL_CONTACT_EMAIL must be a real monitored email address.');
}
if (release && (!config.waitlistEndpoint || !config.contactEmail)) {
  throw new Error('Public launch blocked: configure the working private signup endpoint and monitored contact email first.');
}
// This explicit generated directory is the only location cleaned. Never delete source files.
if (path.dirname(output) !== root || path.basename(output) !== 'public') throw new Error('Invalid build destination');
fs.mkdirSync(output, { recursive: true });
fs.readdirSync(output).forEach(name => fs.rmSync(path.join(output, name), { recursive: true, force: true }));
const pages = ['index.html', 'about-us', 'resources', 'privacy', 'terms', 'waitlist', 'email-preferences', 'robots.txt', 'sitemap.xml'];
for (const name of pages) {
  fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true });
}
// Deliberately exclude planning documents, SQL, keys, tooling and the retired direct database client.
fs.cpSync(path.join(root, 'assets'), path.join(output, 'assets'), {
  recursive: true,
  filter: source => path.basename(source) !== 'supabase-config.js'
});
if (config.analytics.enabled && config.analytics.token) {
  buildSync({ entryPoints: [path.join(root, 'lib/posthog-entry.mjs')], outfile: path.join(output, 'assets/js/vendor/posthog.js'), bundle: true, minify: true, format: 'iife', legalComments: 'external', target: ['es2020'] });
  fs.copyFileSync(path.join(path.dirname(require.resolve('posthog-js/package.json')), 'LICENSE'), path.join(output, 'assets/js/vendor/POSTHOG-LICENSE.txt'));
}
function enhancePages(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) enhancePages(file);
    else if (entry.name.endsWith('.html') && !file.startsWith(path.join(output, 'email-preferences') + path.sep)) {
      const prefix = path.relative(path.dirname(file), output).split(path.sep).join('/') || '.';
      let html = fs.readFileSync(file, 'utf8');
      html = html.replace('</head>', '<link rel="stylesheet" href="' + prefix + '/assets/css/analytics.css" />\n</head>');
      const bootstrap = (html.includes('assets/js/site-config.js') ? '' : '<script src="' + prefix + '/assets/js/site-config.js"></script>') + '<script src="' + prefix + '/assets/js/analytics.js"></script>';
      html = html.replace('</body>', bootstrap + '\n</body>');
      fs.writeFileSync(file, html);
    }
  }
}
enhancePages(output);
const publicConfig = JSON.stringify(config).replace(/</g, '\\u003c');
fs.writeFileSync(path.join(output, 'assets/js/site-config.js'), 'window.XETTL_SITE_CONFIG = Object.freeze(' + publicConfig + ');\n');
console.log('Built static site in public/. Backend secrets are never read or included by this build.');
if (!config.waitlistEndpoint) console.log('Preview mode: waitlist is visibly disconnected; no answers will be sent.');
