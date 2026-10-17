'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? htmlFiles(path.join(directory, entry.name)) : entry.name.endsWith('.html') ? [path.join(directory, entry.name)] : []);
}
const pages = htmlFiles(publicRoot);
for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  const relative = path.relative(publicRoot, file).split(path.sep).join('/');
  check(/<html lang="en"/.test(html), relative + ': language');
  check(/<meta name="viewport"/.test(html), relative + ': viewport');
  check((html.match(/<h1\b/g) || []).length === 1, relative + ': one h1');
  check(!/constellation|public word cloud|public initials|first launch community|starting with international students/i.test(html), relative + ': no retired launch positioning');
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const value = match[1].replace(/&amp;/g, '&');
    const url = new URL(value, 'https://getxettl.com/' + relative);
    if (url.origin !== 'https://getxettl.com') continue;
    let target = path.join(publicRoot, decodeURIComponent(url.pathname));
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    check(fs.existsSync(target), relative + ': missing local link ' + value);
    if (url.hash && target.endsWith('.html')) {
      const targetHtml = fs.readFileSync(target, 'utf8');
      const fragment = decodeURIComponent(url.hash.slice(1));
      check(targetHtml.includes('id="' + fragment + '"'), relative + ': missing fragment ' + value);
    }
  }
  if (!relative.startsWith('waitlist/')) check(html.includes('https://getxettl.com/'), relative + ': canonical domain');
}
for (const forbidden of ['PRD.md', 'design.md', 'README.md', 'supabase_schema.sql', 'docs', 'archive', 'lib', 'netlify', 'supabase', '.env', '.env.example', 'assets/js/supabase-config.js']) {
  check(!fs.existsSync(path.join(publicRoot, forbidden)), 'internal file not published: ' + forbidden);
}
const config = fs.readFileSync(path.join(publicRoot, 'assets/js/site-config.js'), 'utf8');
check(!/service.role|supabase.*key|resend.*key/i.test(config), 'public config has no backend secret variables');
const release = spawnSync(process.execPath, ['scripts/build-site.cjs'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, XETTL_RELEASE_MODE: 'production', XETTL_WAITLIST_ENDPOINT: '', XETTL_CONTACT_EMAIL: '' }
});
check(release.status !== 0 && release.stderr.includes('Public launch blocked'), 'production build refuses disconnected signup');
console.log('Static checks passed: ' + checks + ' across ' + pages.length + ' pages.');
