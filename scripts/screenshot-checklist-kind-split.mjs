// #1168: 持ち物チェックリスト / ルーティン 分離の検証スクリーンショット
// 使い方: npm run dev:cognito が port 5174 で起動済みの状態で実行
//   node scripts/screenshot-checklist-kind-split.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'docs/screenshots/1168-checklist-kind-split');
const BASE = process.env.BASE_URL || 'http://localhost:5174';

async function login(page, email, password) {
	await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 90000 });
	await page.waitForSelector('input[type="email"]', { timeout: 90000 });
	// Svelte 5 hydration timing: wait until the submit button stops being disabled
	// after bind:value propagates. We fill then wait for :not([disabled]).
	await page.locator('input[type="email"]').fill(email);
	await page.locator('input[type="password"]').fill(password);
	// Dispatch input event to nudge Svelte reactivity (in case fill skipped it)
	await page
		.locator('input[type="email"]')
		.evaluate((el) => el.dispatchEvent(new Event('input', { bubbles: true })));
	await page
		.locator('input[type="password"]')
		.evaluate((el) => el.dispatchEvent(new Event('input', { bubbles: true })));
	await page.locator('button[type="submit"]:not([disabled])').waitFor({ timeout: 10000 });
	await page.click('button[type="submit"]');
	await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
	await page.waitForTimeout(2000);
}

async function shot(page, name) {
	const p = path.join(OUT_DIR, `${name}.png`);
	await page.screenshot({ path: p, fullPage: true });
	console.log(`📸 ${name}.png`);
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();

	// 1. 親: 管理画面 チェックリスト（タブ: ルーティン / 持ち物）
	await login(page, 'family@example.com', 'Gq!Dev#Fam2026xyz');
	await page.goto(`${BASE}/admin/checklists`);
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(1000);
	await shot(page, 'admin-checklists-routine-tab');

	// 2. 持ち物タブをクリック
	const itemTab = page.locator('button[role="tab"]').filter({ hasText: '持ち物' });
	if (await itemTab.count()) {
		await itemTab.first().click();
		await page.waitForTimeout(500);
		await shot(page, 'admin-checklists-item-tab');
	}

	// 3. テンプレート作成ダイアログ (kind セレクタ付き)
	const addBtn = page.locator('button').filter({ hasText: 'テンプレート作成' }).first();
	if (await addBtn.count()) {
		await addBtn.click();
		await page.waitForTimeout(800);
		await shot(page, 'admin-checklists-create-dialog');
	} else {
		console.log('⚠️  "テンプレート作成" ボタンが見つからない');
	}

	await browser.close();
	console.log('✅ 完了');
})();
