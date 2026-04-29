// tests/e2e/screenshots-pmf-survey.spec.ts
// #1598 / PR #1675: PMF 判定アンケート ops dashboard のスクリーンショット撮影専用 spec。
//
// 通常 CI に含めず、`npx playwright test --config playwright.cognito-dev.config.ts \
//   tests/e2e/screenshots-pmf-survey.spec.ts --project chromium` で手動実行する。
//
// playwright.config.ts (local mode) の BASE_TEST_IGNORE で除外済み (cognito 認証必須)。
//
// 出力先: docs/screenshots/pr-1675/
//   - ops-pmf-survey-desktop.png  (1280×800)
//   - ops-pmf-survey-mobile.png   (375×812)
//   - ops-pmf-survey-search-active-desktop.png (検索アクティブ状態 desktop)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Page, test } from '@playwright/test';

const OUT_DIR = path.join(process.cwd(), 'docs', 'screenshots', 'pr-1675');

async function loginAs(page: Page, email: string, password: string) {
	await page.goto('/auth/login', { waitUntil: 'commit', timeout: 180_000 });
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 180_000 });
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(ops|admin)/, { timeout: 60_000 });
}

test.beforeAll(() => {
	fs.mkdirSync(OUT_DIR, { recursive: true });
});

test.describe('PR #1675 ops/pmf-survey スクリーンショット', () => {
	test('desktop (1280×800)', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');

		await page.goto('/ops/pmf-survey', { waitUntil: 'domcontentloaded' });
		await page
			.getByRole('heading', { name: /PMF 判定/ })
			.first()
			.waitFor({ state: 'visible', timeout: 30_000 });

		await page.screenshot({
			path: path.join(OUT_DIR, 'ops-pmf-survey-desktop.png'),
			fullPage: true,
		});
	});

	test('mobile (375×812)', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');

		await page.goto('/ops/pmf-survey', { waitUntil: 'domcontentloaded' });
		await page
			.getByRole('heading', { name: /PMF 判定/ })
			.first()
			.waitFor({ state: 'visible', timeout: 30_000 });

		await page.screenshot({
			path: path.join(OUT_DIR, 'ops-pmf-survey-mobile.png'),
			fullPage: true,
		});
	});

	test('search active state — desktop', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await loginAs(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');

		// 検索キーワード「テスト」を投入した URL を直接開く（実データなしでも UI 状態を撮影）
		await page.goto('/ops/pmf-survey?q=テスト', { waitUntil: 'domcontentloaded' });
		await page
			.getByRole('heading', { name: /PMF 判定/ })
			.first()
			.waitFor({ state: 'visible', timeout: 30_000 });

		await page.screenshot({
			path: path.join(OUT_DIR, 'ops-pmf-survey-search-active-desktop.png'),
			fullPage: true,
		});
	});
});
