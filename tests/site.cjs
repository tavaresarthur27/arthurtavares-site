const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');
(async () => {
  mkdirSync('artifacts', { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto('http://127.0.0.1:4173/');
    assert.equal(response.status(), 200);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.game-card').count(), 2);
    await page.getByRole('button', { name: 'Arcade 3D', exact: true }).click();
    assert.equal(await page.locator('.game-card').count(), 1);
    assert.equal(await page.locator('.game-card h3').textContent(), 'Cosmic Cadet');
    await page.getByRole('button', { name: 'Arcade 2D', exact: true }).click();
    assert.equal(await page.locator('.game-card h3').textContent(), 'Orbit Pinball');
    await page.getByRole('button', { name: 'Sobre o jogo Orbit Pinball', exact: true }).click();
    assert.equal(await page.locator('dialog').evaluate(node => node.open), true);
    assert.match(await page.locator('#dialog-controls').textContent(), /Espaço/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog').evaluate(node => node.open), false);
    assert.equal(await page.getByRole('button', { name: 'Sobre o jogo Orbit Pinball', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.getByRole('button', { name: /Todos os jogos/ }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.menu-toggle').click();
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
    await page.locator('#navigation a[href="#jogos"]').click();
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, 0); });
    await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
    for (const href of await page.locator('a[href^="games/"]').evaluateAll(nodes => [...new Set(nodes.map(node => node.href))])) {
      assert.equal((await page.request.get(href)).status(), 200, href);
    }
    await page.goto('http://127.0.0.1:4173/games/orbit/');
    await page.locator('#start').click();
    assert.equal(await page.locator('#pause').isEnabled(), true);
    await page.keyboard.down('Space'); await page.waitForTimeout(100); await page.keyboard.up('Space');
    await page.getByRole('link', { name: 'Voltar ao portfólio de Arthur Tavares' }).click();
    assert.match(page.url(), /index.html#jogos/);
    await page.goto('http://127.0.0.1:4173/games/cosmic-cadet/jogo.html');
    await page.getByRole('button', { name: 'Novo jogo', exact: true }).click();
    assert.equal(await page.locator('#bPa').isVisible(), true);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('#c').screenshot({ path: 'artifacts/cosmic.webp' });
    assert.deepEqual(errors, []);
    console.log('PASS: gallery, filters, dialog, keyboard, mobile menu, 4 viewport widths, game links and both playable games.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
