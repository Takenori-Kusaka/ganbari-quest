#!/usr/bin/env node
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://192.168.68.79:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // 1. Child selection page
  await page.goto(`${BASE_URL}/kinder/home`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tmp/nuc-1-childselect.png', fullPage: true });
  console.log('1. Child selection page saved');

  // 2. Select first child
  const childBtn = page.locator('[data-testid^="child-select-"]').first();
  if (await childBtn.isVisible({ timeout: 3000 })) {
    await childBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tmp/nuc-2-afterselect.png', fullPage: true });
    console.log('2. After child select saved');

    // 3. Dismiss any overlays
    for (let i = 0; i < 5; i++) {
      const btn = page.locator('button:visible').filter({ hasText: /やったね|とじる|閉じる|つぎへ|はじめる|スキップ/i }).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(1000);
      }
    }
    await page.screenshot({ path: 'tmp/nuc-3-home.png', fullPage: true });
    console.log('3. Home page saved');

    // 4. Check header for stamp button
    const stampBtn = page.locator('[data-testid="header-stamp-btn"]');
    const headerHtml = await page.locator('header, [class*="header"], [class*="Header"]').first().innerHTML().catch(() => 'not found');
    console.log('Header contains stamp btn:', await stampBtn.isVisible({ timeout: 2000 }).catch(() => false));

    // 5. Try clicking stamp button
    if (await stampBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await stampBtn.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: 'tmp/nuc-4-stampcard.png', fullPage: false });
      console.log('4. Stamp card dialog saved');
    } else {
      console.log('Stamp button NOT visible in header');
      // Screenshot the header area
      const header = page.locator('header').first();
      if (await header.isVisible().catch(() => false)) {
        await header.screenshot({ path: 'tmp/nuc-4-header.png' });
        console.log('4. Header screenshot saved');
      }
    }
  } else {
    console.log('No child buttons found');
  }

  await ctx.close();
  await browser.close();
  console.log('Done');
}

main().catch(console.error);
