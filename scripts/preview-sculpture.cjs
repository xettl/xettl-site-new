'use strict';
// Capture the actual procedural scene, including static fallbacks; never edits supplied assets.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
const base = process.env.QA_URL || 'http://127.0.0.1:8790';
async function run() {
  fs.mkdirSync(path.join(__dirname, '../.qa'), { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => console.error(error));
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    for (const theme of ['light', 'dark']) {
      await page.goto(base + '/?theme=' + theme);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForSelector('.journey-ready, .scene-fallback');
      if (await page.locator('.scene-fallback').count()) throw new Error(await page.evaluate(() => window.XettlJourneyScene.failure));
      await page.mouse.move(1, 1);
      await page.screenshot({ path: path.join(__dirname, '../.qa/skyline-' + theme + '.png') });
      await page.mouse.move(1130, 530);
      await page.waitForTimeout(650);
      await page.screenshot({ path: path.join(__dirname, '../.qa/skyline-' + theme + '-lit.png') });
      console.log(theme, await page.evaluate(() => ({ ready: !!document.querySelector('.journey-ready'), calls: window.XettlJourneyScene.renderer.info.render.calls,
        glow: window.XettlJourneyScene.glow, meshes: window.XettlJourneyScene.cities.map(c => [c.name, c.blocks.count]) })));
      await page.mouse.move(1, 1);
      for (const [name, selector] of [['chicago', '#product'], ['san-francisco', '#faq']]) {
        await page.evaluate(selector => {
          const section = document.querySelector(selector); scrollTo(0, section.getBoundingClientRect().top + scrollY - 64);
        }, selector);
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(__dirname, '../.qa/skyline-' + theme + '-' + name + '.png') });
      }
      await page.evaluate(() => scrollTo(0,0));
      await page.locator('.hero-v2-actions [data-open-waitlist]').click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(__dirname, '../.qa/waitlist-dialog-' + theme + '.png') });
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/?theme=light');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(__dirname, '../.qa/skyline-mobile.png') });
    await page.locator('.hero-v2-actions [data-open-waitlist]').click(); await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(__dirname, '../.qa/waitlist-dialog-mobile.png') });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.goto(base + '/?theme=' + theme);
      await page.waitForSelector('.journey-ready');
      await page.addStyleTag({ content: 'html { scrollbar-gutter: auto !important; } html, body { background: transparent !important; } .site-header, main, .site-footer, .journey-artwork-footer { visibility: hidden !important; }' });
      await page.evaluate(() => window.XettlJourneyScene.resize());
      await page.locator('#spatial-hero-canvas').screenshot({ path: path.join(__dirname, '../assets/images/editorial/skyline-' + theme + (width === 390 ? '-mobile' : '') + '.png'), omitBackground: true });
    }
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
