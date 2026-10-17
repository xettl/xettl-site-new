'use strict';
// Capture the real hero, supplied assets and self-hosted type as a deterministic share card.
// This does not modify the original OG image, logo or product screenshots.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
async function run() {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await page.goto((process.env.QA_URL || 'http://127.0.0.1:8790') + '/?theme=light');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector('.journey-ready, .scene-fallback');
    await page.addStyleTag({ content: `
      body { margin: 0; }
      .site-header, .journey-artwork-footer, .hero-v2-actions .btn-text { display: none !important; }
      .hero-v2 { padding: 0; height: 630px !important; min-height: 630px !important; }
      .hero-v2-grid { top: 0; height: 630px; min-height: 630px; }
      .hero-v2-copy { gap: 20px; margin: -20px 0 0; max-width: 660px; }
      .hero-v2-copy > .brand { align-self: center; margin-bottom: 6px; font-size: 26px; }
      .hero-v2 h1 { font-size: 66px; line-height: 1.03; }
      .hero-v2 .hero-lead { font-size: 19px; line-height: 1.5; }
      .hero-v2-actions { margin-top: 0; }
      .concept-note { font-size: 15px; margin-top: 0; }
      .journey-artwork { inset: 0; width: 100%; height: 100%; }
    ` });
    await page.evaluate(() => {
      const brand = document.querySelector('.site-header .brand').cloneNode(true);
      brand.removeAttribute('href');
      document.querySelector('.hero-v2-copy').prepend(brand);
      const domain = document.createElement('p'); domain.className = 'concept-note'; domain.textContent = 'getxettl.com';
      document.querySelector('.hero-v2-copy').append(domain);
    });
    await page.screenshot({ path: path.join(__dirname, '../assets/images/og-launch.png') });
    console.log('Rendered 1200×630 launch card from the actual hero.');
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
